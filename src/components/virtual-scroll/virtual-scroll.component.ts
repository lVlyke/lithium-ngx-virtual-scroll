import {
    Component,
    Input,
    ContentChild,
    ElementRef,
    ChangeDetectionStrategy,
    ChangeDetectorRef,
    ViewChild,
    Renderer2,
    ViewContainerRef,
    TemplateRef,
    Inject,
    Output,
    NgZone,
    TrackByFunction
} from "@angular/core";
import { OnDestroy, AfterViewInit, AutoPush, DeclareState, ComponentState, ComponentStateRef, ManagedSubject } from "@lithiumjs/angular";
import { Observable, combineLatest, fromEvent, asyncScheduler, forkJoin, EMPTY } from "rxjs";
import {
    throttleTime,
    tap,
    switchMapTo,
    filter,
    switchMap,
    map,
    distinctUntilChanged,
    withLatestFrom,
    startWith,
    pairwise,
    delay,
    skip,
    take,
    mapTo
} from "rxjs/operators";
import { VirtualItem } from "../../directives/virtual-item.directive";
import { VirtualPlaceholder } from "../../directives/virtual-placeholder.directive";
import { VirtualScrollStrategy } from "./scroll-strategy/virtual-scroll-strategy";
import { LI_VIRTUAL_SCROLL_STRATEGY } from "./scroll-strategy/virtual-scroll-strategy.token";
import { VirtualScrollState } from "./scroll-state/virtual-scroll-state";
import { LI_VIRTUAL_SCROLL_STATE } from "./scroll-state/virtual-scroll-state.token";
import { withNextFrom } from "../../operators/with-next-from";
import { delayUntil } from "../../operators/delay-until";

const TRACK_BY_IDENTITY_FN = <T>(_index: number, item: T) => item;

@Component({
    selector: "li-virtual-scroll",
    changeDetection: ChangeDetectionStrategy.OnPush,
    providers: [
        {
            provide: LI_VIRTUAL_SCROLL_STATE,
            useExisting: VirtualScroll
        },
        ComponentState.create(VirtualScroll)
    ],
    host: {
        "[attr.grid-list]": "gridList || null"
    },
    template: `
        <div #virtualSpacerBefore class="virtual-spacer virtual-spacer-before"></div>
        <ng-container #hostView></ng-container>
        <div #virtualSpacerAfter class="virtual-spacer virtual-spacer-after"></div>
        <ng-template #placeholderTemplate let-item let-index="index">
            <ng-container *ngIf="virtualPlaceholder; else defaultPlaceholderTemplate">
                <ng-container *ngTemplateOutlet="virtualPlaceholder.templateRef; context: { $implicit: item, index: index }">
                </ng-container>
            </ng-container>

            <ng-template #defaultPlaceholderTemplate>
                <div class="virtual-placeholder"
                    [style.width]="itemWidth + 'px'"
                    [style.max-width]="itemWidth + 'px'"
                    [style.height]="itemHeight + 'px'"
                    [style.max-height]="itemHeight + 'px'"
                    [style.margin]="0">
                </div>
            </ng-template>
        </ng-template>
    `,
    styles: [
        ".virtual-spacer { width: 100%; }",
        ":host[grid-list] .virtual-placeholder { display: inline-block; }"
    ]
})
export class VirtualScroll<T> implements VirtualScrollState<T> {

    private static readonly DEFAULT_BUFFER_LENGTH = 1;
    private static readonly DEFAULT_SCROLL_THROTTLE_MS = 50;

    public readonly recalculateItemSize$ = new ManagedSubject<void>(this);

    @Output("renderedItemsChange")
    public readonly renderedItemsChange$ = this.stateRef.emitter("renderedItems");

    @Input()
    public items: T[] = [];

    @Input()
    public gridList = false;

    @Input()
    public asyncRendering = false;

    @Input()
    @DeclareState()
    public itemWidth?: number;

    @Input()
    @DeclareState()
    public itemHeight?: number;

    @Input()
    public scrollDebounceMs = VirtualScroll.DEFAULT_SCROLL_THROTTLE_MS;

    @Input()
    public bufferLength = VirtualScroll.DEFAULT_BUFFER_LENGTH;

    @Input()
    public viewCache: number | boolean = false;

    @Input()
    public trackBy: TrackByFunction<T> = TRACK_BY_IDENTITY_FN;

    @Input()
    @DeclareState()
    public scrollContainer?: HTMLElement;

    @Input()
    public eventCapture = false;

    @ContentChild(VirtualItem)
    @DeclareState()
    public virtualItem!: VirtualItem<T>;

    @ContentChild(VirtualPlaceholder)
    @DeclareState()
    public virtualPlaceholder?: VirtualPlaceholder<T>;

    @ViewChild("hostView", { read: ViewContainerRef, static: true })
    public viewContainerRef!: ViewContainerRef;

    @ViewChild("placeholderTemplate", { static: true })
    public placeholderTemplate!: TemplateRef<VirtualPlaceholder.ViewContext<T>>;

    @ViewChild("virtualSpacerBefore", { static: true })
    public _virtualSpacerBefore!: ElementRef;

    @ViewChild("virtualSpacerAfter", { static: true })
    public _virtualSpacerAfter!: ElementRef;

    @AfterViewInit()
    private readonly afterViewInit$!: Observable<void>;

    @OnDestroy()
    private readonly onDestroy$!: Observable<void>;

    @DeclareState("renderedItems")
    private _renderedItems: T[] = [];

    @DeclareState("scrollPosition")
    private _scrollPosition: VirtualScrollState.Point = { x: 0, y: 0 };

    @DeclareState("minIndex")
    private _minIndex = 0;

    @DeclareState("maxIndex")
    private _maxIndex = 0;

    @DeclareState("renderingViews")
    private _renderingViews = false;

    private _cachedViews: VirtualScrollState.ViewRecord<T> = new Map();
    private _renderedViews: VirtualScrollState.ViewRecord<T> = new Map();
    private _lastScrollOffset: VirtualScrollState.Point = { x: 0, y: 0 };
    private _listElement!: HTMLElement;

    constructor(
        @Inject(LI_VIRTUAL_SCROLL_STRATEGY) private readonly scrollStrategy: VirtualScrollStrategy<T>,
        private readonly stateRef: ComponentStateRef<VirtualScroll<T>>,
        private readonly renderer: Renderer2,
        private readonly zone: NgZone,
        cdRef: ChangeDetectorRef,
        { nativeElement: listElement }: ElementRef<HTMLElement>
    ) {
        AutoPush.enable(this, cdRef);

        this.scrollContainer = this._listElement = listElement;

        // Update the current scroll position on scroll changes
        const scrollSubscription = combineLatest(stateRef.getAll(
            "scrollContainer",
            "eventCapture"
        )).pipe(
            tap(([scrollContainer]) => this.applyScrollContainerStyles(scrollContainer === listElement)),
            switchMap(([scrollContainer, capture]) => fromEvent<MouseEvent>(scrollContainer!, "scroll", { capture })),
            map((scrollEvent) => ({
                x: (scrollEvent.target as HTMLElement).scrollLeft,
                y: (scrollEvent.target as HTMLElement).scrollTop
            })),
            startWith({ x: 0, y: 0 }),
            distinctUntilChanged((prev, cur) => prev.x === cur.x && prev.y === cur.y)
        ).subscribe(scrollPosition => {
            this._lastScrollOffset.x = scrollPosition.x - this._scrollPosition.x;
            this._lastScrollOffset.y = scrollPosition.y - this._scrollPosition.y;
            this._scrollPosition = scrollPosition;
        });

        // Clear all views if the trackBy changes
        stateRef.get("trackBy").pipe(
            switchMap(() => this.clearViewsSafe())
        ).subscribe();

        // Clean the view cache when the list of items changes
        stateRef.get("items").pipe(
            switchMap(() => this.waitForRenderComplete)
        ).subscribe(() => this.cleanViewCache());

        // Clear views and recalculate item size if changing grid list view state
        stateRef.get("gridList").pipe(
            distinctUntilChanged(),
            skip(1),
            delay(0), // Wait for any DOM updates to occur
            switchMap(() => this.clearViewsSafe())
        ).subscribe(() => this.recalculateItemSize());

        // Clear the view cache if disabled
        stateRef.get("viewCache").pipe(
            distinctUntilChanged(),
            filter(viewCache => !viewCache),
        ).subscribe(() => this.clearCachedViews());

        // Clear all views and stop listening for scrolls on destroy
        this.onDestroy$.pipe(
            switchMap(() => this.clearViewsSafe())
        ).subscribe(() => scrollSubscription.unsubscribe());

        // Recalculate views on rendered items changes
        this.afterViewInit$.pipe(
            switchMap(() => stateRef.get("renderedItems").pipe(
                withLatestFrom(...stateRef.getAll("minIndex", "items")),
                pairwise(),
                startWith([[], [[] as T[], 0, [] as T[]]] as const)
            )),
            tap(() => {
                if (!this.virtualItem) {
                    throw new Error("liVirtualItem directive is not defined.");
                }
            }),
            filter(([
                [prevRenderedItems, prevMinIndex, prevItems],
                [renderedItems, minIndex, items],
            ]) => {
                // Skip updates if nothing has changed and we're not currently re-rendering views
                return this._renderingViews
                    || !(prevItems === items && renderedItems.length === prevRenderedItems?.length && minIndex === prevMinIndex);
            }),
            switchMap(([, [renderedItems, minIndex]]) => {
                const prevRenderedViews = this.renderedViews;

                // Remove any prior views that are no longer being rendered
                prevRenderedViews.forEach((view: VirtualScrollState.ViewInfo<T>) => {
                    if (!this.isViewForAnyItems(view, renderedItems, minIndex)) {
                        this.scrollStrategy.unrenderView(this, view);
                    }
                });

                // Purge the view cache
                this.scrollStrategy.purgeViewCache(this);

                if (renderedItems.length === 0) {
                    this._renderingViews = false;
                    return EMPTY;
                } else {
                    this._renderingViews = true;

                    // Render the new list of items
                    return forkJoin(renderedItems.map((renderedItem, index) => this.scrollStrategy.renderViewForItem(
                        this,
                        renderedItem,
                        minIndex + index,
                        this.asyncRendering && prevRenderedViews.length > 0
                    )));
                }
            })
        ).subscribe((renderedViews) => {
            if (this.viewContainerRef.length !== renderedViews.length) {
                console.warn(`[VirtualScroll] Expected ${renderedViews.length} views, got ${this.viewContainerRef.length}.`);
            }

            this._renderingViews = false;
        });

        // Recalculate rendered items on scroll state changes
        this.afterViewInit$.pipe(
            switchMapTo(this.scrollStateChange),
            // Skip updates if we're ignoring scroll updates or item info isn't defined
            filter(([, , , itemWidth, itemHeight]) => !this.renderingViews && ((!!itemWidth || !this.gridList) && !!itemHeight)),
        ).subscribe(([
            ,
            scrollPosition,
            items,
            itemWidth,
            itemHeight,
            scrollContainer,
            bufferLength,
            gridList
        ]) => {
            // The bounds of the scroll container, in pixels
            const renderedBounds: VirtualScroll.Rect = {
                left: scrollPosition.x,
                top: scrollPosition.y,
                right: scrollPosition.x + scrollContainer!.clientWidth,
                bottom: scrollPosition.y + scrollContainer!.clientHeight
            };
            const bufferLengthPx = (scrollContainer!.clientHeight) * bufferLength;

            // Calculate the number of rendered items per row
            const itemsPerRow = gridList ? Math.floor(scrollContainer!.clientWidth / itemWidth!) : 1;
            const virtualScrollHeight = items.length * itemHeight! / itemsPerRow;

            // Adjust the bounds by the buffer length and clamp to the edges of the container
            renderedBounds.top -= bufferLengthPx;
            renderedBounds.top = Math.max(0, renderedBounds.top);
            renderedBounds.bottom += bufferLengthPx;
            renderedBounds.bottom = Math.min(virtualScrollHeight, renderedBounds.bottom);

            cdRef.detach();

            // Calculate which items should be rendered on screen
            this._minIndex = Math.min(items.length - 1, Math.floor(renderedBounds.top / itemHeight!) * itemsPerRow);
            this._maxIndex = Math.min(items.length - 1, Math.ceil(renderedBounds.bottom / itemHeight!) * itemsPerRow);
            this._renderedItems = items.slice(this._minIndex, this._maxIndex + 1);

            cdRef.reattach();
            cdRef.markForCheck();

            // Calculate the virtual scroll space before/after the rendered items
            const spaceBeforePx = Math.floor(this._minIndex / itemsPerRow) * itemHeight!;
            const spaceAfterPx = Math.floor((items.length - this._maxIndex) / itemsPerRow) * itemHeight!;

            // Update the virtual spacers in the DOM
            renderer.setStyle(this._virtualSpacerBefore.nativeElement, "height", `${spaceBeforePx}px`);
            renderer.setStyle(this._virtualSpacerAfter.nativeElement, "height", `${spaceAfterPx}px`);
        });

        // Dynamically calculate itemWidth if not explicitly passed as an input
        this.afterViewInit$.pipe(
            withNextFrom(stateRef.get("itemWidth")),
            filter(([, itemWidth]) => itemWidth === undefined),
            switchMap(() => this.refItemChange)
        ).subscribe(refItem => this.itemWidth = this.calculateItemWidth(refItem));

        // Dynamically calculate itemHeight if not explicitly passed as an input
        this.afterViewInit$.pipe(
            withNextFrom(stateRef.get("itemHeight")),
            filter(([, itemHeight]) => itemHeight === undefined),
            switchMap(() => this.refItemChange)
        ).subscribe(refItem => this.itemHeight = this.calculateItemHeight(refItem));
    }

    public get minIndex(): number {
        return this._minIndex;
    }

    public get maxIndex(): number {
        return this._maxIndex;
    }

    public get renderedItems(): T[] {
        return this._renderedItems;
    }

    public get scrollPosition(): VirtualScrollState.Point {
        return this._scrollPosition;
    }

    public get lastScrollOffset(): VirtualScrollState.Point {
        return this._lastScrollOffset;
    }

    public get renderingViews(): boolean {
        return this._renderingViews;
    }

    public get cachedViews(): VirtualScrollState.ViewInfo<T>[] {
        return Array.from(this._cachedViews.values());
    }

    public get renderedViews(): VirtualScrollState.ViewInfo<T>[] {
        return Array.from(this._renderedViews.values());
    }

    public get waitForRenderComplete(): Observable<void> {
        return this.stateRef.get("renderingViews").pipe(
            filter(rendering => !rendering),
            mapTo(undefined),
            take(1)
        );
    }

    public recalculateItemSize(): void {
        this.recalculateItemSize$.next();
    }

    public getCachedView(index: number, item: T): VirtualScrollState.ViewInfo<T> | undefined {
        return this.getViewInfo(this._cachedViews, index, item);
    }

    public getRenderedView(index: number, item: T): VirtualScrollState.ViewInfo<T> | undefined {
        return this.getViewInfo(this._renderedViews, index, item);
    }

    public deleteCachedView(index: number, item: T): boolean {
        return this.deleteViewInfo(this._cachedViews, index, item);
    }

    public deleteRenderedView(index: number, item: T): boolean {
        return this.deleteViewInfo(this._renderedViews, index, item);
    }

    public setCachedView(view: VirtualScrollState.ViewInfo<T>): void {
        this.updateViewInfo(this._cachedViews, view);
    }

    public setRenderedView(view: VirtualScrollState.ViewInfo<T>): void {
        this.updateViewInfo(this._renderedViews, view);
    }

    private get scrollContainerResize(): Observable<unknown> {
        return this.stateRef.get("scrollContainer").pipe(
            filter(c => !!c),
            switchMap((scrollContainer) => new Observable((observer) => {
                const res = new ResizeObserver(() => this.zone.run(() => observer.next()));
                res.observe(scrollContainer!);
                this.onDestroy$.subscribe(() => (res.disconnect(), observer.complete()));
            }))
        );
    }

    private get scrollDebounce(): Observable<VirtualScrollState.Point> {
        return this.stateRef.get("scrollDebounceMs").pipe(
            switchMap((scrollDebounceMs) => this.stateRef.get("scrollPosition").pipe(throttleTime(
                scrollDebounceMs,
                asyncScheduler,
                { leading: true, trailing: true }
            )))
        );
    }

    private get scrollStateChange() {
        return combineLatest([
            // Listen for resizes on the scroll container
            this.scrollContainerResize,
            // Listen for scroll position changes
            this.scrollDebounce,
            // Listen for list state changes that affect rendering
            ...this.stateRef.getAll(
                "items",
                "itemWidth",
                "itemHeight",
                "scrollContainer",
                "bufferLength",
                "gridList",
                "trackBy"
            )
        ]);
    }

    private get refItemChange(): Observable<HTMLElement> {
        return combineLatest([
            ...this.stateRef.getAll("items", "scrollContainer"),
            this.recalculateItemSize$.pipe(startWith(true))
        ]).pipe(
            filter(([items, scrollContainer]) => !!scrollContainer && items.length > 0),
            delayUntil(this.waitForRenderComplete),
            tap(([items]) => {
                if (this._renderedItems.length === 0) {
                    this._renderedItems = [items[0]];
                }
            }),
            map(([, scrollContainer]) => scrollContainer!.querySelector<HTMLElement>(":scope > :not(.virtual-spacer)")),
            filter((refItem): refItem is HTMLElement => !!refItem)
        );
    }

    private applyScrollContainerStyles(apply: boolean) {
        this._listElement.style.overflowY = apply ? "scroll" : "initial";
        this._listElement.style.display = apply ? "block" : "initial";
    }

    private calculateItemWidth(itemEl: HTMLElement): number {
        const style = getComputedStyle(itemEl);
        return itemEl.offsetWidth + parseInt(style.marginLeft) + parseInt(style.marginRight);
    }

    private calculateItemHeight(itemEl: HTMLElement): number {
        const style = getComputedStyle(itemEl);
        return itemEl.offsetHeight + parseInt(style.marginTop) + parseInt(style.marginBottom);
    }

    private isViewForAnyItems(
        view: VirtualScrollState.ViewInfo<T>,
        items: T[] = this.items,
        indexOffset = 0
    ): boolean {
        const trackByValue = this.trackBy(view.itemIndex, view.item);

        return !!items.find((curItem, curIndex) => Object.is(
            trackByValue,
            this.trackBy(indexOffset + curIndex, curItem)
        ));
    }

    private getViewInfo(
        viewRecord: VirtualScrollState.ViewRecord<T>,
        index: number,
        item: T
    ): VirtualScrollState.ViewInfo<T> | undefined {
        return viewRecord.get(this.trackBy(index, item));
    }

    private deleteViewInfo(
        viewRecord: VirtualScrollState.ViewRecord<T>,
        index: number,
        item: T
    ): boolean {
        return viewRecord.delete(this.trackBy(index, item));
    }

    private updateViewInfo(
        viewRecord: VirtualScrollState.ViewRecord<T>,
        view: VirtualScrollState.ViewInfo<T>
    ): VirtualScrollState.ViewRecord<T> {
        return viewRecord.set(
            this.trackBy(view.itemIndex, view.item),
            view
        );
    }

    private cleanViewCache(): void {
        // Destroy all cached views that are no longer valid for current items
        for (let [trackByKey, view] of this._cachedViews.entries()) {
            if (!this.isViewForAnyItems(view) || view.viewRef.destroyed) {
                this.scrollStrategy.destroyViewRef(this, view.viewRef);
                this._cachedViews.delete(trackByKey);
            }
        }
    }

    private clearViewsSafe(): Observable<void> {
        return this.waitForRenderComplete.pipe(
            map(() => {
                this.clearRenderedViews();
                this.clearCachedViews();

                this.renderer.setStyle(this._virtualSpacerBefore.nativeElement, "height", 0);
                this.renderer.setStyle(this._virtualSpacerAfter.nativeElement, "height", 0);
            })
        );
    }

    private clearCachedViews(): void {
        for (let cachedView of this._cachedViews.values()) {
            this.scrollStrategy.destroyViewRef(this, cachedView.viewRef);
        }

        this._cachedViews = new Map();
    }

    private clearRenderedViews(): void {
        this._renderedItems = [];

        for (let renderedView of this._renderedViews.values()) {
            this.scrollStrategy.destroyViewRef(this, renderedView.viewRef);
        }

        this.viewContainerRef.clear();
        this._renderedViews = new Map();
    }
}

export namespace VirtualScroll {
    export interface Rect {
        left: number;
        top: number;
        right: number;
        bottom: number;
    }
}
