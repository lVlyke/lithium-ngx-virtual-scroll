import {
    Component,
    Input,
    ContentChild,
    ElementRef,
    ChangeDetectionStrategy,
    ChangeDetectorRef,
    ViewChild,
    Renderer2
} from "@angular/core";
import { OnDestroy, AfterViewInit, AutoPush, DeclareState, ComponentState, ComponentStateRef } from "@lithiumjs/angular";
import { Observable, combineLatest, fromEvent, asyncScheduler } from "rxjs";
import { throttleTime, tap, switchMapTo, filter, switchMap, map, distinctUntilChanged, delay } from "rxjs/operators";
import { VirtualItem } from "../../directives/virtual-item.directive";

@Component({
    selector: "li-virtual-scroll",
    changeDetection: ChangeDetectionStrategy.OnPush,
    providers: [ComponentState.create(VirtualScroll)],
    template: `
        <div #virtualSpacerBefore class="virtual-spacer virtual-spacer-before"></div>
        <ng-container *ngIf="virtualItem">
            <ng-container *ngFor="let renderedItem of renderedItems; let i = index">
                <ng-container *ngTemplateOutlet="virtualItem.templateRef; context: { $implicit: renderedItem, index: minIndex + i }">
                </ng-container>
            </ng-container>
        </ng-container>
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

    @ContentChild(VirtualItem)
    public virtualItem!: VirtualItem;

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

    private _listElement!: HTMLElement;

    constructor(
        cdRef: ChangeDetectorRef,
        private readonly stateRef: ComponentStateRef<VirtualScroll<T>>,
        renderer: Renderer2,
        { nativeElement: listElement }: ElementRef<HTMLElement>
    ) {
        AutoPush.enable(this, cdRef);

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

        this.onDestroy$.subscribe(() => scrollSubscription.unsubscribe());

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
                return; // TODO
            }

            console.log(itemWidth, itemHeight);

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
            cdRef.markForCheck();

            const spaceBeforePx = this._minIndex * itemHeight / itemsPerRow;
            const spaceAfterPx = (items.length - 1 - this._maxIndex) * itemHeight / itemsPerRow;

            console.log(scrollPosition, itemsPerRow, this._minIndex, this._maxIndex, spaceBeforePx, spaceAfterPx);

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

    private get refItemChange(): Observable<HTMLElement> {
        return combineLatest(this.stateRef.getAll("items", "scrollContainer")).pipe(
            filter(([items, scrollContainer]) => !!scrollContainer && items.length > 0),
            tap(([items]) => {
                if (this._renderedItems.length === 0) {
                    this._renderedItems = [items[0]];
                }
            }),
            delay(0),
            map(([, scrollContainer]) => scrollContainer!.querySelector<HTMLElement>(":not(.virtual-spacer)")),
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
