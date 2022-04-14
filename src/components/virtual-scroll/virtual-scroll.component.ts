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
    Inject
} from "@angular/core";
import { OnDestroy, AfterViewInit, AutoPush, DeclareState, ComponentState, ComponentStateRef } from "@lithiumjs/angular";
import { Observable, combineLatest, fromEvent, asyncScheduler, forkJoin, EMPTY } from "rxjs";
import { throttleTime, tap, switchMapTo, filter, switchMap, map, distinctUntilChanged, withLatestFrom, mergeMap, startWith, pairwise } from "rxjs/operators";
import { VirtualItem } from "../../directives/virtual-item.directive";
import { VirtualPlaceholder } from "../../directives/virtual-placeholder.directive";
import { VirtualScrollStrategy } from "./scroll-strategy/virtual-scroll-strategy";
import { LI_VIRTUAL_SCROLL_STRATEGY } from "./scroll-strategy/virtual-scroll-strategy.token";
import { VirtualScrollState } from "./scroll-state/virtual-scroll-state";
import { LI_VIRTUAL_SCROLL_STATE } from "./scroll-state/virtual-scroll-state.token";
import { withNextFrom } from "../../operators/with-next-from";

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
    template: `
        <div #virtualSpacerBefore class="virtual-spacer virtual-spacer-before"></div>
        <ng-container #hostView></ng-container>
        <div #virtualSpacerAfter class="virtual-spacer virtual-spacer-after"></div>
        <ng-template #placeholderTemplate let-item let-index="index">
            <div class="virtual-placeholder"
                 [style.width]="itemWidth + 'px'"
                 [style.max-width]="itemWidth + 'px'"
                 [style.height]="itemHeight + 'px'"
                 [style.max-height]="itemHeight + 'px'"
                 [style.margin]="0"
                 [ngClass]="virtualPlaceholder?.className ?? ''">
                <ng-container *ngIf="virtualPlaceholder">
                    <ng-container *ngTemplateOutlet="virtualPlaceholder.templateRef; context: { $implicit: item, index: index }">
                    </ng-container>
                </ng-container>
            </div>
        </ng-template>
    `,
    styles: [
        ".virtual-spacer { width: 100% }"
    ]
})
export class VirtualScroll<T> implements VirtualScrollState<T> {

    private static readonly DEFAULT_BUFFER_LENGTH = 2;
    private static readonly DEFAULT_SCROLL_THROTTLE_MS = 100;

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

    private _cachedViews: VirtualScrollState.ViewRecord<T> = {};
    private _renderedViews: VirtualScrollState.ViewRecord<T> = {};
    private _listElement!: HTMLElement;

    constructor(
        @Inject(LI_VIRTUAL_SCROLL_STRATEGY) private readonly scrollStrategy: VirtualScrollStrategy<T>,
        private readonly stateRef: ComponentStateRef<VirtualScroll<T>>,
        cdRef: ChangeDetectorRef,
        renderer: Renderer2,
        { nativeElement: listElement }: ElementRef<HTMLElement>
    ) {
        AutoPush.enable(this, cdRef);

        let ignoreScrollUpdates = false;

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
        stateRef.get("items").subscribe(() => {
            this.clearRenderedViews();
            this.clearViewCache();
        });

        // Clear the view cache if disabled
        stateRef.get("viewCache").pipe(
            distinctUntilChanged(),
            filter(viewCache => !viewCache),
        ).subscribe(() => this.clearViewCache());

        // Clear all views and stop listening for scrolls on destroy
        this.onDestroy$.subscribe(() => {
            this.clearViewCache();
            this.clearRenderedViews();
            scrollSubscription.unsubscribe();
        });

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

                    // Ignore scroll changes while rendering the new list of items
                    ignoreScrollUpdates = true;

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
            ignoreScrollUpdates = false;

            if (this.viewContainerRef.length !== this._renderedItems.length) {
                console.warn(`[VirtualScroll] Expected ${this._renderedItems.length} items, got ${this.viewContainerRef.length}.`);
            }
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

        // Recalculate rendered items on changes
        this.afterViewInit$.pipe(
            switchMapTo(combineLatest([
                // Listen for scroll position changes
                stateRef.get("scrollPosition").pipe(throttleTime(
                    VirtualScroll.DEFAULT_SCROLL_THROTTLE_MS, // TODO - Make customizable
                    asyncScheduler,
                    { leading: true, trailing: true }
                )),
                // Listen for list state changes
                ...stateRef.getAll("items", "itemWidth", "itemHeight", "scrollContainer", "bufferLength", "gridList")
            ])),
            // Skip updates if we're ignoring scroll updates or item info isn't defined
            filter(([, items, itemWidth, itemHeight]) => !ignoreScrollUpdates && !!itemWidth && !!itemHeight && items.length > 0)
        ).subscribe(([
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

            // Adjust the bounds by the buffer length
            renderedBounds.top -= bufferLengthPx;
            renderedBounds.bottom += bufferLengthPx;

            // Calculate the number of rendered items per row
            const itemsPerRow = gridList ? Math.floor(scrollContainer!.clientWidth / itemWidth!) : 1;

            cdRef.detach();

            // Calculate which items should be rendered on screen
            this._minIndex = Math.min(items.length - 1, Math.floor(Math.max(0, renderedBounds.top) / itemHeight!) * itemsPerRow);
            this._maxIndex = Math.min(items.length, Math.ceil(Math.max(0, renderedBounds.bottom) / itemHeight!) * itemsPerRow);
            this._renderedItems = items.slice(this._minIndex, this._maxIndex);

            cdRef.reattach();
            cdRef.markForCheck();

            // Calculate the virtual scroll space before/after the rendered items
            const spaceBeforePx = this._minIndex * itemHeight! / itemsPerRow;
            const spaceAfterPx = (items.length - this._maxIndex) * itemHeight! / itemsPerRow;

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

    private get refItemChange(): Observable<HTMLElement> {
        return combineLatest(this.stateRef.getAll("items", "scrollContainer")).pipe(
            filter(([items, scrollContainer]) => !!scrollContainer && items.length > 0),
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

    private clearViewCache(): void {
        Object.values(this._cachedViews).forEach((viewRef) => {
            if (viewRef) {
                this.scrollStrategy.destroyViewRef(this, viewRef);
            }
        });

        this._cachedViews = {};
    }

    private clearRenderedViews(): void {
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
