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
    ViewRef
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

    constructor(
        cdRef: ChangeDetectorRef,
        private readonly stateRef: ComponentStateRef<VirtualScroll<T>>,
        renderer: Renderer2,
        { nativeElement: listElement }: ElementRef<HTMLElement>
    ) {
        AutoPush.enable(this, cdRef);

        let ignoreChanges = false;

        this.scrollContainer = this._listElement = listElement;

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

        stateRef.get("items").subscribe(() => this.clearViewCache());

        stateRef.get("viewCache").pipe(
            filter(viewCache => !viewCache)
        ).subscribe(() => this.clearViewCache());

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

        this.afterViewInit$.pipe(
            switchMapTo(combineLatest([
                stateRef.get("scrollPosition").pipe(throttleTime(
                    VirtualScroll.DEFAULT_SCROLL_THROTTLE_MS, // TODO - Make customizable
                    asyncScheduler,
                    { leading: true, trailing: true }
                )),
                ...stateRef.getAll("items", "scrollContainer", "bufferLength", "itemWidth", "itemHeight", "gridList")
            ])),
            filter(([, items]) => !ignoreChanges && items.length > 0)
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
                return; // TODO
            }

            const viewportStartX = scrollPosition.x;
            const viewportStartY = scrollPosition.y;
            const viewportEndX = viewportStartX + scrollContainer!.clientWidth;
            const viewportEndY = viewportStartY + scrollContainer!.clientHeight;
            const renderedBounds: VirtualScroll.Rect = {
                left: viewportStartX,
                top: viewportStartY,
                right: viewportEndX,
                bottom: viewportEndY
            };
            const bufferLengthPx = (scrollContainer!.clientHeight) * bufferLength;

            renderedBounds.top -= bufferLengthPx;
            renderedBounds.bottom += bufferLengthPx;

            const itemsPerRow = gridList ? Math.floor(scrollContainer!.clientWidth / itemWidth) : 1;

            cdRef.detach();

            this._minIndex = Math.min(items.length - 1, Math.floor(Math.max(0, renderedBounds.top) / itemHeight) * itemsPerRow);
            this._maxIndex = Math.min(items.length - 1, Math.ceil(Math.max(0, renderedBounds.bottom) / itemHeight) * itemsPerRow);
            this._renderedItems = items.slice(this._minIndex, this._maxIndex);

            cdRef.reattach();
            cdRef.detectChanges();

            const spaceBeforePx = this._minIndex * itemHeight / itemsPerRow;
            const spaceAfterPx = (items.length - 1 - this._maxIndex) * itemHeight / itemsPerRow;

            renderer.setStyle(this._virtualSpacerBefore.nativeElement, "height", `${spaceBeforePx}px`);
            renderer.setStyle(this._virtualSpacerAfter.nativeElement, "height", `${spaceAfterPx}px`);
        });

        stateRef.get("renderedItems").pipe(
            withLatestFrom(stateRef.get("minIndex")),
            pairwise()
        ).subscribe(([
            [prevRenderedItems, prevMinIndex],
            [renderedItems, minIndex]
        ]) => {
            if (!this.virtualItem) {
                throw new Error("liVirtualItem not defined.");
            }

            const movedViews = new Map<T, ViewRef>();

            ignoreChanges = true;

            prevRenderedItems.forEach((renderedItem, index) => {
                const globalIndex =  prevMinIndex + index;
                const viewRef = this._renderedViews[globalIndex];

                if (viewRef) {
                    if (renderedItems.includes(renderedItem)) {
                        // Mark the view to be moved
                        movedViews.set(renderedItem, viewRef);
                    } else {
                        const viewIndex = this._viewContainerRef.indexOf(viewRef);

                        if (viewIndex !== -1) {
                            if (this.viewCache) {
                                // Add the view to the cache
                                this._viewCache[globalIndex] = viewRef as EmbeddedViewRef<VirtualItem.ViewContext<T>>;

                                // Detach the view from the container
                                this._viewContainerRef.detach(viewIndex);
                            } else {
                                // Destroy the view
                                delete this._viewCache[globalIndex];
                                this._viewContainerRef.remove(viewIndex);
                            }
                        } else {
                            // Destroy the view
                            delete this._viewCache[globalIndex];
                            viewRef.destroy();
                        }
                    }

                    delete this._renderedViews[globalIndex];
                }
            });

            if (this.viewCache && this.cacheFull) {
                const cachedIndices = Object.keys(this._viewCache).map(Number);
                const direction = minIndex >= this.items.length / 2 ? 1 : -1;
                const startIndex = direction === 1 ? 0 : cachedIndices.length - 1;
                const endIndex = direction === 1 ? cachedIndices.length - 1 : 0;
                for (let i = startIndex; i != endIndex && this.cacheFull; i += direction) {
                    const viewIndex = cachedIndices[i];
                    // If this view isn't about to be rendered, evict it from the cache and destroy it
                    if (viewIndex < minIndex || viewIndex >= minIndex + renderedItems.length) {
                        const viewRef = this._viewCache[viewIndex];
                        delete this._viewCache[viewIndex];
                        const viewRefIndex = this._viewContainerRef.indexOf(viewRef);

                        if (viewRefIndex !== -1) {
                            this._viewContainerRef.remove(viewIndex);
                        } else {
                            viewRef.destroy();
                        }
                    }
                }
            }

            this.clearRenderedViews();

            renderedItems.forEach((renderedItem, index) => {
                const globalIndex = minIndex + index;
                let viewRef: ViewRef = this._viewCache[globalIndex];
                let skipUpdate = false;
                
                if (movedViews.has(renderedItem)) {
                    viewRef = movedViews.get(renderedItem)!;
                    const newIndex = this._viewContainerRef.length - 1;

                    if (this._viewContainerRef.indexOf(viewRef) !== newIndex) {
                        this._viewContainerRef.move(viewRef, newIndex);
                    } else {
                        skipUpdate = true;
                    }
                } else if (viewRef) {
                    this._viewContainerRef.insert(viewRef);
                } else {
                    viewRef = this._viewContainerRef.createEmbeddedView(
                        this.virtualItem.templateRef,
                        { $implicit: renderedItem, index: globalIndex }
                    );
                }

                this._renderedViews[globalIndex] = viewRef as EmbeddedViewRef<VirtualItem.ViewContext<T>>;

                if (!skipUpdate) {
                    // Initialize the view state
                    viewRef.detectChanges();
                }
            });

            ignoreChanges = false;
            movedViews.clear();
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

    private clearViewCache(): void {
        Object.values(this._viewCache).forEach((viewRef) => {
            if (viewRef) {
                const viewIndex = this._viewContainerRef.indexOf(viewRef);

                if (viewIndex !== -1) {
                    this._viewContainerRef.remove(viewIndex);
                }

                viewRef.destroy();
            }
        });

        this._viewCache = {};
    }

    private clearRenderedViews(): void {
        Object.values(this._renderedViews).forEach((viewRef) => {
            if (viewRef) {
                const viewIndex = this._viewContainerRef.indexOf(viewRef);

                if (viewIndex !== -1) {
                    this._viewContainerRef.remove(viewIndex);
                }

                viewRef.destroy();
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
