import {
    Component,
    Input,
    ContentChild,
    ElementRef,
    ChangeDetectionStrategy,
    ChangeDetectorRef,
    ViewChild,
    Renderer2,
    EmbeddedViewRef,
    ViewContainerRef,
    TemplateRef,
    Inject,
    Output
} from "@angular/core";
import { OnDestroy, AfterViewInit, AutoPush, DeclareState, ComponentState, ComponentStateRef, ManagedSubject } from "@lithiumjs/angular";
import { Observable, combineLatest, fromEvent, asyncScheduler, forkJoin, EMPTY } from "rxjs";
import { throttleTime, tap, switchMapTo, filter, switchMap, map, distinctUntilChanged, withLatestFrom, startWith, pairwise, delay, skip, take, mapTo, mergeMap } from "rxjs/operators";
import { VirtualItem } from "../../directives/virtual-item.directive";
import { VirtualPlaceholder } from "../../directives/virtual-placeholder.directive";
import { VirtualScrollStrategy } from "./scroll-strategy/virtual-scroll-strategy";
import { LI_VIRTUAL_SCROLL_STRATEGY } from "./scroll-strategy/virtual-scroll-strategy.token";
import { VirtualScrollState } from "./scroll-state/virtual-scroll-state";
import { LI_VIRTUAL_SCROLL_STATE } from "./scroll-state/virtual-scroll-state.token";
import { withNextFrom } from "../../operators/with-next-from";
import { delayUntil } from "../../operators/delay-until";

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

    private static readonly DEFAULT_BUFFER_LENGTH = 2;
    private static readonly DEFAULT_SCROLL_THROTTLE_MS = 100;

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
    public bufferLength = VirtualScroll.DEFAULT_BUFFER_LENGTH;

    @Input()
    @DeclareState()
    public scrollContainer?: HTMLElement;

    @Input()
    public eventCapture = false;

    @Input()
    public viewCache: number | boolean = false;

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
    private _scrollPosition: VirtualScroll.ScrollPosition = { x: 0, y: 0 };

    @DeclareState("minIndex")
    private _minIndex = 0;

    @DeclareState("maxIndex")
    private _maxIndex = 0;

    @DeclareState("renderJobCount")
    private _renderJobCount = 0;

    private _cachedViews: VirtualScrollState.ViewRecord<T> = {};
    private _renderedViews: VirtualScrollState.ViewRecord<T> = {};
    private _listElement!: HTMLElement;

    constructor(
        @Inject(LI_VIRTUAL_SCROLL_STRATEGY) private readonly scrollStrategy: VirtualScrollStrategy<T>,
        private readonly stateRef: ComponentStateRef<VirtualScroll<T>>,
        private readonly renderer: Renderer2,
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
        ).subscribe(scrollPosition => this._scrollPosition = scrollPosition);

        // Clear all views if the list of items changes
        stateRef.get("items").pipe(
            switchMap(() => this.clearViewsSafe())
        ).subscribe();

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
                withLatestFrom(stateRef.get("minIndex")),
                pairwise(),
                startWith([[], [[] as T[], 0]] as const)
            )),
            mergeMap(([
                [prevRenderedItems, prevMinIndex],
                [renderedItems, minIndex],
            ]) => {
                if (!this.virtualItem) {
                    throw new Error("liVirtualItem directive is not defined.");
                }

                // Unrender all items that are no longer rendered
                prevRenderedItems?.forEach((renderedItem, index) => {
                    const globalIndex =  prevMinIndex! + index;
                    const viewRef = this._renderedViews[globalIndex] as EmbeddedViewRef<VirtualItem.ViewContext<T>>;

                    // Offload the view to be destroyed or cached if it's no longer being rendered
                    if (viewRef && !renderedItems.includes(renderedItem)) {
                        this.scrollStrategy.unrenderViewRefAt(this, viewRef, globalIndex);
                    }
                });

                // Purge the view cache to ensure it's within size limitations
                this.scrollStrategy.purgeViewCache(this);

                if (renderedItems.length === 0) {
                    return EMPTY;
                } else {
                    const renderedViewIndices = Object.keys(this._renderedViews).map(Number);

                    // Increment the render job counter
                    ++this._renderJobCount;

                    // Render the new list of items
                    return forkJoin(renderedItems.map((renderedItem, index) => {
                        return this.scrollStrategy.renderViewForItemAt(
                            this,
                            renderedItem,
                            minIndex + index,
                            renderedViewIndices,
                            this.asyncRendering && prevRenderedItems && prevRenderedItems.length > 0
                        );
                    }));
                }
            })
        ).subscribe(() => {
            if (this.viewContainerRef.length !== this._renderedItems.length) {
                console.warn(`[VirtualScroll] Expected ${this._renderedItems.length} items, got ${this.viewContainerRef.length}.`);
            }

            // Decrement render job count
            --this._renderJobCount;
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

        // Recalculate rendered items on scroll state changes
        this.afterViewInit$.pipe(
            switchMapTo(this.scrollStateChange),
            // Skip updates if we're ignoring scroll updates or item info isn't defined
            filter(([, , items, itemWidth, itemHeight]) => !this.renderingViews && !!itemWidth && !!itemHeight && items.length > 0)
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
            this._maxIndex = Math.min(items.length, Math.ceil(renderedBounds.bottom / itemHeight!) * itemsPerRow);
            this._renderedItems = items.slice(this._minIndex, this._maxIndex);

            cdRef.reattach();
            cdRef.markForCheck();

            // Calculate the virtual scroll space before/after the rendered items
            const spaceBeforePx = Math.floor(this._minIndex / itemsPerRow) * itemHeight!;
            const spaceAfterPx = Math.floor((items.length - this._maxIndex) / itemsPerRow) * itemHeight!;

            // Update the virtual spacers in the DOM
            renderer.setStyle(this._virtualSpacerBefore.nativeElement, "height", `${spaceBeforePx}px`);
            renderer.setStyle(this._virtualSpacerAfter.nativeElement, "height", `${spaceAfterPx}px`);
        });
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

    public get scrollPosition(): VirtualScroll.ScrollPosition {
        return this._scrollPosition;
    }

    public get cachedViews(): VirtualScrollState.ViewRecord<T> {
        return this._cachedViews;
    }

    public get renderedViews(): VirtualScrollState.ViewRecord<T> {
        return this._renderedViews;
    }

    public get renderJobCount(): number {
        return this._renderJobCount;
    }

    public get renderingViews(): boolean {
        return this.renderJobCount > 0;
    }

    public get waitForRenderComplete(): Observable<void> {
        return this.stateRef.get("renderJobCount").pipe(
            filter(count => count === 0),
            mapTo(undefined),
            take(1)
        );
    }

    public recalculateItemSize(): void {
        this.recalculateItemSize$.next();
    }

    private get scrollContainerResize(): Observable<unknown> {
        return this.stateRef.get("scrollContainer").pipe(
            filter(c => !!c),
            switchMap((scrollContainer) => new Observable((observer) => {
                const res = new ResizeObserver(() => observer.next());
                res.observe(scrollContainer!);
                this.onDestroy$.subscribe(() => (res.disconnect(), observer.complete()));
            }))
        );
    }

    private get scrollDebounce(): Observable<VirtualScroll.ScrollPosition> {
        return this.stateRef.get("scrollPosition").pipe(throttleTime(
            VirtualScroll.DEFAULT_SCROLL_THROTTLE_MS, // TODO - Make customizable
            asyncScheduler,
            { leading: true, trailing: true }
        ));
    }

    private get scrollStateChange() {
        return combineLatest([
            // Listen for resizes on the scroll container
            this.scrollContainerResize,
            // Listen for scroll position changes
            this.scrollDebounce,
            // Listen for list state changes that affect rendering
            ...this.stateRef.getAll("items", "itemWidth", "itemHeight", "scrollContainer", "bufferLength", "gridList")
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
        Object.values(this._cachedViews).forEach((viewRef) => {
            if (viewRef) {
                this.scrollStrategy.destroyViewRef(this, viewRef);
            }
        });

        this._cachedViews = {};
    }

    private clearRenderedViews(): void {
        this._renderedItems = [];

        Object.values(this._renderedViews).forEach((viewRef) => {
            if (viewRef) {
                this.scrollStrategy.destroyViewRef(this, viewRef);
            }
        });

        this._renderedViews = {};
    }
}

export namespace VirtualScroll {
    export interface Rect {
        left: number;
        top: number;
        right: number;
        bottom: number;
    }

    export interface ScrollPosition {
        x: number;
        y: number;
    }
}
