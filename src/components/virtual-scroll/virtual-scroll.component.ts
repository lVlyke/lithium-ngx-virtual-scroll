import {
    Component,
    Input,
    ContentChild,
    ElementRef,
    ChangeDetectionStrategy,
    ChangeDetectorRef
} from "@angular/core";
import { OnDestroy, AutoPush, DeclareState, ComponentState, ComponentStateRef } from "@lithiumjs/angular";
import { Observable, combineLatest, of, forkJoin, fromEvent, asyncScheduler } from "rxjs";
import { map, throttleTime, filter, mergeMap, take, delay, tap } from "rxjs/operators";
import { VirtualItem } from "../../directives/virtual-item.directive";

@Component({
    selector: "li-virtual-scroll",
    changeDetection: ChangeDetectionStrategy.OnPush,
    providers: [ComponentState.create(VirtualScroll)],
    template: `
        <ng-container *ngIf="virtualItem">
            <ng-container *ngFor="let renderedItem of renderedItems; let i = index">
                <ng-container *ngIf="renderedItem.visible; else placeholder">
                    <span class="li-virtual-item" [attr.data-li-virtual-index]="i">
                        <ng-container *ngTemplateOutlet="virtualItem.templateRef; context: { $implicit: renderedItem.item, index: i }">
                        </ng-container>
                    </span>
                </ng-container>

                <ng-template #placeholder>
                    <div [ngStyle]="{ 'width': referenceWidth + 'px', 'height': referenceHeight + 'px'  }"></div>
                </ng-template>
            </ng-container>
        </ng-container>
    `
})
export class VirtualScroll<T> {

    private static readonly DEFAULT_BUFFER_LENGTH = 3;
    private static readonly DEFAULT_SCROLL_THROTTLE_MS = 100;

    @Input()
    public items: T[] = [];

    @Input()
    public bufferLength = VirtualScroll.DEFAULT_BUFFER_LENGTH;

    @Input()
    @DeclareState()
    public scrollContainer?: HTMLElement;

    @Input()
    public eventCapture = false;

    @ContentChild(VirtualItem)
    public virtualItem!: VirtualItem;

    @OnDestroy()
    private readonly onDestroy$!: Observable<void>;

    @DeclareState("renderedItems")
    private _renderedItems: VirtualScroll.RenderedItem<T>[] = [];

    @DeclareState("scrollPosition")
    private _scrollPosition: VirtualScroll.ScrollPosition = { x: 0, y: 0 };

    @DeclareState("referenceWidth")
    private _referenceWidth = 0;

    @DeclareState("referenceWidth")
    private _referenceHeight = 0;

    private _listElement!: HTMLElement;

    constructor(
        private readonly cdRef: ChangeDetectorRef,
        stateRef: ComponentStateRef<VirtualScroll<T>>,
        { nativeElement: listElement }: ElementRef<HTMLElement>
    ) {
        AutoPush.enable(this, cdRef);

        this.scrollContainer = this._listElement = listElement;

        const scrollSubscription = combineLatest(stateRef.getAll(
            "scrollContainer",
            "eventCapture"
        )).pipe(
            tap(([scrollContainer]) => this.applyScrollContainerStyles(scrollContainer === listElement)),
            mergeMap(([scrollContainer, capture]) => fromEvent<MouseEvent>(scrollContainer!, "scroll", { capture }))
        ).subscribe((scrollEvent) => {
            this._scrollPosition = {
                x: (scrollEvent.target as HTMLElement).scrollLeft,
                y: (scrollEvent.target as HTMLElement).scrollTop
            };
        });

        this.onDestroy$.subscribe(() => scrollSubscription.unsubscribe());

        stateRef.get("items").pipe(
            map((items): VirtualScroll.RenderedItem<T>[] => items.map((item) => ({
                item,
                visible: false
            })))
        ).subscribe(renderedItems => this._renderedItems = renderedItems);

        // Make the first element visible (TODO- always?)
        stateRef.get("renderedItems").pipe(
            filter(renderedItems => renderedItems.length > 0),
            take(1)
        ).subscribe(renderedItems => renderedItems[0].visible = true);

        combineLatest([
            stateRef.get("scrollPosition").pipe(throttleTime(
                VirtualScroll.DEFAULT_SCROLL_THROTTLE_MS, // TODO - Make customizable
                asyncScheduler,
                { leading: true, trailing: true }
            )),
            ...stateRef.getAll("renderedItems", "scrollContainer", "bufferLength")
        ]).pipe(
            filter(([, renderedItems]) => renderedItems.length > 0),
            delay(0), // Wait for DOM rendering to occur
            mergeMap(([scrollPosition, renderedItems, scrollContainer, bufferLength]) => {
                const renderedBounds: VirtualScroll.Rect = {
                    left: scrollPosition.x,
                    top: scrollPosition.y,
                    right: scrollPosition.x + scrollContainer!.clientWidth,
                    bottom: scrollPosition.y + scrollContainer!.clientHeight
                };
                const bufferLengthPx = (scrollContainer!.clientHeight) * bufferLength;
                const [bestRenderedIndex, renderedElement] = this.findBestOnScreenItem(renderedItems);

                renderedBounds.top -= bufferLengthPx;
                renderedBounds.bottom += bufferLengthPx;

                if (renderedElement) {
                    // TODO
                    this._referenceWidth = renderedElement.clientWidth;
                    this._referenceHeight = renderedElement.clientHeight;

                    const offset = { x: renderedElement.offsetLeft, y: renderedElement.offsetTop };
                    const elementDimensions = {
                        left: offset.x,
                        top: offset.y,
                        right: offset.x + renderedElement.clientWidth,
                        bottom: offset.y + renderedElement.clientHeight
                    };

                    return forkJoin([
                        this.walkList(renderedItems, renderedBounds, bestRenderedIndex, 1, true, elementDimensions),
                        this.walkList(renderedItems, renderedBounds, bestRenderedIndex, -1, true, elementDimensions)
                    ]).pipe(
                        delay(VirtualScroll.DEFAULT_SCROLL_THROTTLE_MS * 2),
                        tap(() => {
                            // Re-check the rendering status if there are no rendered items or if the scroll position changed quickly
                            if (this._listElement.scrollLeft !== scrollPosition.x
                             || this._listElement.scrollTop !== scrollPosition.y
                             || this.getAllRenderedElements().length === 0) {
                                this._scrollPosition = { x: this._listElement.scrollLeft, y: this._listElement.scrollTop };
                            }
                        })
                    );
                } else if (renderedItems.length > 0 && this._referenceWidth > 0 && this._referenceHeight > 0) {
                    // If there are no rendered items, walk the list from the beginning to find the rendered segment
                    return this.walkList(renderedItems, renderedBounds, 0, 1, false, {
                        left: 0,
                        top: 0,
                        right: this._referenceWidth,
                        bottom: this._referenceHeight
                    });
                } else {
                    return of(null);
                }
            })
        ).subscribe();
    }

    public get renderedItems(): VirtualScroll.RenderedItem<T>[] {
        return this._renderedItems;
    }

    public get scrollPosition(): VirtualScroll.ScrollPosition {
        return this._scrollPosition;
    }

    public get referenceWidth(): number {
        return this._referenceWidth;
    }

    public get referenceHeight(): number {
        return this._referenceHeight;
    }

    public checkScroll(scrollPosition?: VirtualScroll.ScrollPosition): void {
       this._scrollPosition = scrollPosition ?? this._scrollPosition;
    }

    private applyScrollContainerStyles(apply: boolean) {
        this._listElement.style.overflowY = apply ? "scroll" : "initial";
        this._listElement.style.display = apply ? "block" : "initial";
    }

    private findBestOnScreenItem(renderedItems: VirtualScroll.RenderedItem<T>[]): [number, HTMLElement] {
        const minRenderedIndex = renderedItems.findIndex(renderedItem => renderedItem.visible);
        const maxRenderedIndex = minRenderedIndex + renderedItems.slice(minRenderedIndex).findIndex(renderedItem => !renderedItem.visible);

        // Grab any rendered element (that is currently being rendered in the DOM)
        let bestRenderedIndex = minRenderedIndex;
        let renderedElement: HTMLElement | null;
        do {
            renderedElement = this.getRenderedElement(bestRenderedIndex);
        } while (!renderedElement && ++bestRenderedIndex < (maxRenderedIndex === -1 ? renderedItems.length : maxRenderedIndex));
 
        if (!renderedElement) {
            // Fallback to looking behind the min rendered index (sometimes needed if user is scrolling very fast)
            bestRenderedIndex = minRenderedIndex;
            while (!renderedElement && --bestRenderedIndex >= 0) {
                renderedElement = this.getRenderedElement(bestRenderedIndex);
            }
        }

        return [bestRenderedIndex, renderedElement!];
    }

    private getRenderedElement(renderedIndex: number): HTMLElement | null {
        return this._listElement.querySelector(`[data-li-virtual-index="${renderedIndex}"]`);
    }

    private getAllRenderedElements(): NodeListOf<HTMLElement> {
        return this._listElement.querySelectorAll(".li-virtual-item");
    }

    private intersects(a: VirtualScroll.Rect, b: VirtualScroll.Rect): boolean {
        return b.left <= a.right && b.right >= a.left && b.top <= a.bottom && b.bottom >= a.top;
    }

    private walkList(
        renderedItems: VirtualScroll.RenderedItem<T>[],
        renderedBounds: VirtualScroll.Rect,
        index: number,
        direction: 1 | -1,
        stopOnUnrendered: boolean,
        lastElementDimensions?: VirtualScroll.Rect
    ): Observable<VirtualScroll.RenderedItem<T>[]> {
        const item = renderedItems[index];
        const nextIndex = index + direction;

        // Stop walking the list if we hit an unrendered segment
        if (nextIndex >= renderedItems.length || (stopOnUnrendered && !lastElementDimensions && !item?.visible)) {
            return of(renderedItems);
        }

        let renderedElement: HTMLElement | null;
        if (item?.visible && (renderedElement = this.getRenderedElement(index))) {
            const offset = { x: renderedElement.offsetLeft, y: renderedElement.offsetTop };
            
            // Update the element dimensions based on the current element
            lastElementDimensions = {
                left: offset.x,
                top: offset.y,
                right: offset.x + renderedElement.clientWidth,
                bottom: offset.y + renderedElement.clientHeight
            };

            // Check if this element should still be rendered
            if (!this.intersects(renderedBounds, lastElementDimensions)) {
                item.visible = false;
                this.cdRef.markForCheck();
            }
        } else if (lastElementDimensions) {
            const lastElementSize = {
                x: lastElementDimensions.right - lastElementDimensions.left,
                y: lastElementDimensions.bottom - lastElementDimensions.top,
            };
            const offsetX = lastElementSize.x * direction;
            const offsetY = lastElementSize.y * direction;

            // Walk to the next item in the list
            if (lastElementDimensions.right + offsetX <= this._listElement.scrollWidth && lastElementDimensions.left + offsetX >= 0) {
                lastElementDimensions.left += offsetX;
                lastElementDimensions.right += offsetX;
            } else {
                lastElementDimensions.left = direction > 0 ? 0 : this._listElement.scrollWidth;
                lastElementDimensions.right = lastElementDimensions.left + offsetX;

                lastElementDimensions.top += offsetY;
                lastElementDimensions.bottom += offsetY;
            }

            // If the current item should be rendered, make it visible
            if (this.intersects(renderedBounds, lastElementDimensions)) {
                if (!!item) {
                    item.visible = true;
                    this.cdRef.markForCheck();
                }

                // Continue walking the list
                return this.walkList(renderedItems, renderedBounds, nextIndex, direction, stopOnUnrendered, lastElementDimensions);
            }
        }

        // Keep walking the list (unless we hit the end of the array)
        if (nextIndex >= 0 && nextIndex < renderedItems.length) {
            return this.walkList(
                renderedItems,
                renderedBounds,
                nextIndex,
                direction,
                stopOnUnrendered,
                (!stopOnUnrendered || item?.visible) ? lastElementDimensions : undefined
            );
        } else {
            return of(renderedItems);
        }
    }
}

export namespace VirtualScroll {

    export interface Rect {
        left: number;
        top: number;
        right: number;
        bottom: number;
    }

    export interface RenderedItem<T> {
        item: T;
        visible: boolean;
        lastElementSize?: ScrollPosition;
    }

    export interface ScrollPosition {
        x: number;
        y: number;
    }
}
