import {
    Component,
    Input,
    ContentChild,
    TemplateRef,
    ElementRef
} from "@angular/core";
import { AotAware, StateEmitter, OnDestroy } from "@lithiumjs/angular";
import { Subject, Observable, combineLatest, of, forkJoin, fromEvent } from "rxjs";
import { map, throttleTime, withLatestFrom, filter, mergeMap, take, delay } from "rxjs/operators";

@Component({
    selector: "li-virtual-scroll",
    template: `
        <ng-container *ngFor="let renderedItem of renderedItems; let i = index">
            <ng-container *ngIf="renderedItem.visible">
                <div [attr.data-li-virtual-index]="i">
                    <ng-container *ngTemplateOutlet="templateRef; context: { $implicit: renderedItem.item }">
                    </ng-container>
                </div>
            </ng-container>
        </ng-container>
    `
})
export class VirtualScroll extends AotAware {

    private static readonly DEFAULT_BUFFER_LENGTH = 3;

    @OnDestroy()
    private readonly onDestroy$: Observable<void>;

    @Input("items")
    @StateEmitter({ initialValue: [] })
    private readonly items$: Subject<any[]>;

    @Input("bufferLength")
    @StateEmitter({ initialValue: VirtualScroll.DEFAULT_BUFFER_LENGTH })
    private readonly bufferLength$: Subject<number>;

    @StateEmitter({ initialValue: { x: 0, y: 0 } })
    private readonly scrollPosition$: Subject<VirtualScroll.ScrollPosition>;

    @StateEmitter({ initialValue: [] })
    private readonly renderedItems$: Subject<VirtualScroll.RenderedItem[]>;

    private readonly listElement: HTMLElement;

    @ContentChild(TemplateRef)
    public readonly templateRef: TemplateRef<any>;

    constructor({ nativeElement: listElement }: ElementRef) {
        super();

        const onScroll$ = fromEvent(document, "scroll", { capture: true });

        this.listElement = listElement;

        const scrollSubscription = onScroll$.subscribe((scrollEvent) => {
            // TODO - Check if scroll is relevant to list
            this.scrollPosition$.next({ x: scrollEvent.srcElement.scrollLeft, y: scrollEvent.srcElement.scrollTop });
        });

        this.onDestroy$.subscribe(() => {
            scrollSubscription.unsubscribe();
        });

        this.items$
            .pipe(map((items): VirtualScroll.RenderedItem[] => items.map((item) => ({
                item,
                visible: false
            }))))
            .subscribe(this.renderedItems$);

        // Make the first element visible (TODO- always?)
        this.renderedItems$
            .pipe(filter(renderedItems => renderedItems.length > 0))
            .pipe(take(1))
            .subscribe(renderedItems => renderedItems[0].visible = true);

        combineLatest(
            this.scrollPosition$.pipe(throttleTime(50)) /* TODO - Make customizable */,
            this.renderedItems$
        ).pipe(filter(([, renderedItems]) => renderedItems.length > 0))
        .pipe(withLatestFrom(this.bufferLength$))
        .pipe(delay(0)) // Wait for DOM rendering to occur
        .pipe(mergeMap(([[scrollPosition, renderedItems], bufferLength]) => {
            const [bestRenderedIndex, renderedElement] = this.findBestOnScreenItem(renderedItems);
            const renderedBounds: VirtualScroll.Rect = {
                left: scrollPosition.x,
                top: scrollPosition.y,
                right: scrollPosition.x + listElement.clientWidth,
                bottom: scrollPosition.y + listElement.clientHeight
            };

            if (renderedElement) {
                const offset = { x: renderedElement.offsetLeft, y: renderedElement.offsetTop };
                const elementDimensions = {
                    left: offset.x,
                    top: offset.y,
                    right: offset.x + renderedElement.clientWidth,
                    bottom: offset.y + renderedElement.clientHeight
                };
                const bufferLengthPx = window.innerHeight * bufferLength;

                renderedBounds.top -= bufferLengthPx;
                renderedBounds.bottom += bufferLengthPx;

                return forkJoin(
                    this.walkList(renderedItems, renderedBounds, bestRenderedIndex, 1, elementDimensions),
                    this.walkList(renderedItems, renderedBounds, bestRenderedIndex, -1, elementDimensions)
                );
            } else {
                return of(null);
            }
        }))
        .subscribe();
    }

    public checkScroll(scrollPosition?: VirtualScroll.ScrollPosition): void {
       scrollPosition ? of(scrollPosition) : this.scrollPosition$.pipe(take(1))
            .subscribe(scrollPosition => this.scrollPosition$.next(scrollPosition));
    }

    private findBestOnScreenItem(renderedItems: VirtualScroll.RenderedItem[]): [number, HTMLElement] {
        const minRenderedIndex = renderedItems.findIndex(renderedItem => renderedItem.visible);
        const maxRenderedIndex = minRenderedIndex + renderedItems.slice(minRenderedIndex).findIndex(renderedItem => !renderedItem.visible);

        let bestRenderedIndex = minRenderedIndex;
        let renderedElement: HTMLElement;
        do {
            renderedElement = this.getRenderedElement(bestRenderedIndex);
        } while (!renderedElement && ++bestRenderedIndex < (maxRenderedIndex === -1 ? renderedItems.length : maxRenderedIndex));

        return [bestRenderedIndex, renderedElement];
    }

    private getRenderedElement(renderedIndex: number): HTMLElement {
        return this.listElement.querySelector(`[data-li-virtual-index="${renderedIndex}"]`);
    }

    private intersects(a: VirtualScroll.Rect, b: VirtualScroll.Rect): boolean {
        return b.left <= a.right && b.right >= a.left && b.top <= a.bottom && b.bottom >= a.top;
    }

    private walkList(
        renderedItems: VirtualScroll.RenderedItem[],
        renderedBounds: VirtualScroll.Rect,
        index: number,
        direction: 1 | -1,
        lastElementDimensions?: VirtualScroll.Rect
    ): Observable<VirtualScroll.RenderedItem[]> {
        const item = renderedItems[index];
        const nextIndex = index + direction;

        // Stop walking the list if we hit an unrendered segment
        if (!lastElementDimensions && !item.visible) {
            return of(renderedItems);
        }

        if (item.visible) {
            const renderedElement: HTMLElement = this.listElement.querySelector(`[data-li-virtual-index="${index}"]`);
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
            }
        } else {
            const lastElementSize = {
                x: lastElementDimensions.right - lastElementDimensions.left,
                y: lastElementDimensions.bottom - lastElementDimensions.top,
            };
            const offsetY = lastElementSize.y * direction;
            lastElementDimensions.top += offsetY;
            lastElementDimensions.bottom += offsetY;

            // If the current item should be rendered, make it visible
            if (this.intersects(renderedBounds, lastElementDimensions)) {
                item.visible = true;

                // Wait for the DOM element to render, then continue walking the list
                return of(null)
                    .pipe(delay(0))
                    .pipe(mergeMap(() => this.walkList(renderedItems, renderedBounds, index, direction)));
            }
        }

        // Keep walking the list (unless we hit the end of the array)
        if (nextIndex >= 0 && nextIndex < renderedItems.length) {
            return this.walkList(renderedItems, renderedBounds, nextIndex, direction, item.visible ? lastElementDimensions : undefined);
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

    export interface RenderedItem {
        item: any;
        visible: boolean;
        lastElementSize?: ScrollPosition;
    }

    export interface ScrollPosition {
        x: number;
        y: number;
    }
}
