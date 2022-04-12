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
    ViewContainerRef
} from "@angular/core";
import { OnDestroy, AfterViewInit, AutoPush, DeclareState, ComponentState, ComponentStateRef } from "@lithiumjs/angular";
import { Observable, combineLatest, fromEvent, asyncScheduler } from "rxjs";
import { throttleTime, tap, switchMapTo, filter, switchMap, map, distinctUntilChanged, pairwise, withLatestFrom } from "rxjs/operators";
import { VirtualItem } from "../../directives/virtual-item.directive";

@Component({
    selector: "li-virtual-scroll",
    changeDetection: ChangeDetectionStrategy.OnPush,
    providers: [ComponentState.create(VirtualScroll)],
    template: `
        <div #virtualSpacerBefore class="virtual-spacer virtual-spacer-before"></div>
        <ng-container #hostView></ng-container>
        <div #virtualSpacerAfter class="virtual-spacer virtual-spacer-after"></div>
    `,
    styles: [
        ".virtual-spacer { width: 100% }"
    ]
})
export class VirtualScroll<T> {

    private static readonly DEFAULT_BUFFER_LENGTH = 2;
    private static readonly DEFAULT_SCROLL_THROTTLE_MS = 100;

    @Input()
    public items: T[] = [];

    @Input()
    public gridList = false;

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

    @ViewChild("hostView", { read: ViewContainerRef, static: true })
    public _viewContainerRef!: ViewContainerRef;

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

    private _viewCache: Record<number, EmbeddedViewRef<VirtualItem.ViewContext<T>>> = {};
    private _renderedViews: Record<number, EmbeddedViewRef<VirtualItem.ViewContext<T>>> = {};
    private _listElement!: HTMLElement;
    private _stats = { moves: 0, hits: 0, misses: 0 };

    constructor(
        cdRef: ChangeDetectorRef,
        private readonly stateRef: ComponentStateRef<VirtualScroll<T>>,
        renderer: Renderer2,
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

        // Dynamically calculate itemWidth if not explicitly passed as an input
        this.afterViewInit$.pipe(
            filter(() => this.itemWidth === undefined),
            switchMap(() => this.refItemChange)
        ).subscribe(refItem => this.itemWidth = this.calculateItemWidth(refItem));

        // Dynamically calculate itemHeight if not explicitly passed as an input
        this.afterViewInit$.pipe(
            filter(() => this.itemHeight === undefined),
            switchMap(() => this.refItemChange)
        ).subscribe(refItem => this.itemHeight = this.calculateItemHeight(refItem));

        // Recalculate rendered items on changes
        this.afterViewInit$.pipe(
            switchMapTo(combineLatest([
                stateRef.get("scrollPosition").pipe(throttleTime(
                    VirtualScroll.DEFAULT_SCROLL_THROTTLE_MS, // TODO - Make customizable
                    asyncScheduler,
                    { leading: true, trailing: true }
                )),
                ...stateRef.getAll("items", "scrollContainer", "bufferLength", "itemWidth", "itemHeight", "gridList")
            ])),
            filter(([, items]) => items.length > 0)
        ).subscribe(([
            scrollPosition,
            items,
            scrollContainer,
            bufferLength,
            itemWidth,
            itemHeight,
            gridList
        ]) => {
            if (!itemWidth || !itemHeight) {
                throw new Error("[VirtualScroll] Unable to calculate item width/height.")
            }

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
            const itemsPerRow = gridList ? Math.floor(scrollContainer!.clientWidth / itemWidth) : 1;

            cdRef.detach();

            // Calculate which items should be rendered on screen
            this._minIndex = Math.min(items.length - 1, Math.floor(Math.max(0, renderedBounds.top) / itemHeight) * itemsPerRow);
            this._maxIndex = Math.min(items.length - 1, Math.ceil(Math.max(0, renderedBounds.bottom) / itemHeight) * itemsPerRow);
            this._renderedItems = items.slice(this._minIndex, this._maxIndex);

            cdRef.reattach();
            cdRef.markForCheck();

            // Calculate the virtual scroll space before/after the rendered items
            const spaceBeforePx = this._minIndex * itemHeight / itemsPerRow;
            const spaceAfterPx = (items.length - 1 - this._maxIndex) * itemHeight / itemsPerRow;

            console.log(scrollPosition, itemsPerRow, this._minIndex, this._maxIndex, spaceBeforePx, spaceAfterPx);

            // Update the virtual spacers in the DOM
            renderer.setStyle(this._virtualSpacerBefore.nativeElement, "height", `${spaceBeforePx}px`);
            renderer.setStyle(this._virtualSpacerAfter.nativeElement, "height", `${spaceAfterPx}px`);
        });

        // Recalculate views on rendered items changes
        stateRef.get("renderedItems").pipe(
            withLatestFrom(stateRef.get("minIndex")),
            pairwise()
        ).subscribe(([
            [prevRenderedItems, prevMinIndex],
            [renderedItems, minIndex]
        ]) => {
            if (!this.virtualItem) {
                throw new Error("liVirtualItem directive is not defined.");
            }

            // Unrender all items that are no longer rendered
            prevRenderedItems.forEach((renderedItem, index) => {
                const globalIndex =  prevMinIndex + index;
                const viewRef = this._renderedViews[globalIndex] as EmbeddedViewRef<VirtualItem.ViewContext<T>>;

                if (viewRef) {
                    // Unrender this view if it's no longer being rendered
                    if (!renderedItems.includes(renderedItem)) {
                        // Offload the view to be destroyed or cached
                        this.unrenderViewRefAt(viewRef, globalIndex);
                    }
                } else {
                    console.warn(`[VirtualScroll] Item ${globalIndex} view is missing.`);
                }
            });

            // Purge the view cache to ensure it's within size limitations
            this.purgeViewCache();

            this._stats = { hits: 0, misses: 0, moves: 0 };

            // Render the new list of items
            const renderedViewIndices = Object.keys(this._renderedViews).map(Number);
            renderedItems.forEach((renderedItem, index) => {
                this.renderViewForItemAt(renderedItem, minIndex + index, renderedViewIndices);
            });

            if (this._viewContainerRef.length !== renderedItems.length) {
                console.warn(`[VirtualScroll] Expected ${renderedItems.length} items, got ${this._viewContainerRef.length}.`);
            }

            console.log(
                "moves ", this._stats.moves,
                "hits ", this._stats.hits,
                "misses ", this._stats.misses,
                "cache size ", Object.keys(this._viewCache).length,
                "rendered items ", this._viewContainerRef.length, 
                " (", Object.keys(this._renderedItems).length, " refs)"
            );
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

    private get cacheFull(): boolean {
        return (typeof this.viewCache === "boolean")
        ? !this.viewCache
        : Object.keys(this._viewCache).length > this.viewCache;
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

    private destroyViewRef(viewRef: EmbeddedViewRef<VirtualItem.ViewContext<T>>): void {
        const viewIndex = this._viewContainerRef.indexOf(viewRef);

        // Destroy the view
        if (viewIndex !== -1) {
            this._viewContainerRef.remove(viewIndex);
        } else {
            viewRef.destroy();
        }
    }

    private destroyViewRefAt(viewRef: EmbeddedViewRef<VirtualItem.ViewContext<T>>, globalIndex: number): void {
        delete this._viewCache[globalIndex];
        delete this._renderedViews[globalIndex];
        this.destroyViewRef(viewRef);
    }

    private cacheViewRefAt(viewRef: EmbeddedViewRef<VirtualItem.ViewContext<T>>, globalIndex: number): void {
        delete this._renderedViews[globalIndex];
        this._viewCache[globalIndex] = viewRef;
        const viewIndex = this._viewContainerRef.indexOf(viewRef);

        if (viewIndex !== -1) {
            // Detach the view from the container if active
            this._viewContainerRef.detach(viewIndex);
        }
    }

    private unrenderViewRefAt(viewRef: EmbeddedViewRef<VirtualItem.ViewContext<T>>, globalIndex: number): void {
        if (this.viewCache) {
            // Add the view to the cache
            this.cacheViewRefAt(viewRef, globalIndex);
        } else {
            // Destroy the view
            this.destroyViewRefAt(viewRef, globalIndex);
        }
    }

    private renderViewForItemAt(item: T, globalIndex: number, renderedViewIndices: number[]): void {
        let viewRef = this._viewCache[globalIndex] as EmbeddedViewRef<VirtualItem.ViewContext<T>>;
        let skipUpdate = false;
        
        // If this object is still rendered, just move it to the end of the container
        if (renderedViewIndices.includes(globalIndex)) {
            this._stats.moves++;
            viewRef = this._renderedViews[globalIndex];
            const newIndex = this._viewContainerRef.length - 1;

            if (this._viewContainerRef.indexOf(viewRef) !== newIndex) {
                this._viewContainerRef.move(viewRef, newIndex);
            } else {
                skipUpdate = true;
            }
        } else if (viewRef) {
            this._stats.hits++;
            // If the view is cached, insert it at the end of the container
            this._viewContainerRef.insert(viewRef);
        } else {
            this._stats.misses++;
            // Create the view and add it to the end of the container
            viewRef = this._viewContainerRef.createEmbeddedView(
                this.virtualItem.templateRef,
                { $implicit: item, index: globalIndex }
            );
        }

        if (!skipUpdate) {
            this._renderedViews[globalIndex] = viewRef;

            // Initialize the view state
            viewRef.detectChanges();
        }
    }

    private purgeViewCache(): void {
        if (this.viewCache && this.cacheFull) {
            const cachedIndices = Object.keys(this._viewCache).map(Number);
            const direction = this.minIndex >= this.items.length / 2 ? 1 : -1;
            const startIndex = direction === 1 ? 0 : cachedIndices.length - 1;
            const endIndex = direction === 1 ? cachedIndices.length - 1 : 0;

            // Iterate through the cache starting from the point furthest from the first rendered index
            for (let i = startIndex; i != endIndex && this.cacheFull; i += direction) {
                const viewIndex = cachedIndices[i];
                // If this view isn't about to be rendered, evict it from the cache and destroy it
                if (viewIndex < this.minIndex || viewIndex >= this.minIndex + this.renderedItems.length) {
                    this.destroyViewRefAt(this._viewCache[viewIndex], viewIndex);
                }
            }
        }
    }

    private clearViewCache(): void {
        Object.values(this._viewCache).forEach((viewRef) => {
            if (viewRef) {
                this.destroyViewRef(viewRef);
            }
        });

        this._viewCache = {};
    }

    private clearRenderedViews(): void {
        Object.values(this._renderedViews).forEach((viewRef) => {
            if (viewRef) {
                this.destroyViewRef(viewRef);
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
