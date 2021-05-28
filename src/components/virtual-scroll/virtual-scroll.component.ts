import {
    Component,
    Input,
    ContentChild,
    TemplateRef,
    ElementRef,
    ChangeDetectionStrategy,
    ChangeDetectorRef
} from "@angular/core";
import { LiComponent, StateEmitter, OnDestroy, AutoPush } from "@lithiumjs/angular";
import { Subject, Observable, combineLatest, of, forkJoin, fromEvent } from "rxjs";
import { map, throttleTime, filter, mergeMap, take, delay, tap } from "rxjs/operators";

export function DEFAULT_SCROLL_POSITION(): VirtualScroll.ScrollPosition {
    return { x: 0, y: 0 };
}

export function EMPTY_ARRAY<T>(): T[] {
    return [];
}

@Component({
    selector: "li-virtual-scroll",
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <ng-container *ngFor="let renderedItem of renderedItems; let i = index">
            <ng-container *ngIf="renderedItem.visible">
                <div [attr.data-li-virtual-index]="i">
                    <ng-container *ngTemplateOutlet="templateRef; context: { $implicit: renderedItem.item, index: i }">
                    </ng-container>
                </div>
            </ng-container>
        </ng-container>
    `
})
export class VirtualScroll extends LiComponent {

    private static readonly DEFAULT_BUFFER_LENGTH = 3;

    @ContentChild(TemplateRef)
    public readonly templateRef: TemplateRef<any>;

    @Input()
    public items: any[];

    @StateEmitter({ propertyName: "items", initial: EMPTY_ARRAY })
    public readonly items$: Subject<any[]>;

    @Input()
    public bufferLength: number;

    @StateEmitter({ propertyName: "bufferLength", initialValue: VirtualScroll.DEFAULT_BUFFER_LENGTH })
    public readonly bufferLength$: Subject<number>;

    @Input()
    public scrollContainer: HTMLElement;

    @StateEmitter({ propertyName: "scrollContainer" })
    public readonly scrollContainer$: Subject<HTMLElement>;

    @Input()
    public eventCapture: boolean;

    @StateEmitter({ propertyName: "eventCapture", initialValue: false })
    public readonly eventCapture$: Subject<boolean>;

    @StateEmitter({ initial: DEFAULT_SCROLL_POSITION })
    private readonly scrollPosition$: Subject<VirtualScroll.ScrollPosition>;

    @StateEmitter({ initial: EMPTY_ARRAY })
    private readonly renderedItems$: Subject<VirtualScroll.RenderedItem[]>;

    @OnDestroy()
    private readonly onDestroy$: Observable<void>;

    private readonly listElement: HTMLElement;

    constructor(
        private readonly cdRef: ChangeDetectorRef,
        { nativeElement: listElement }: ElementRef<HTMLElement>
    ) {
        super();

        AutoPush.enable(this, cdRef);

        this.listElement = listElement;

        this.scrollContainer$.next(listElement);

        const scrollSubscription = combineLatest([
            this.scrollContainer$,
            this.eventCapture$
        ]).pipe(
            tap(([scrollContainer]) => this.applyScrollContainerStyles(scrollContainer === listElement)),
            mergeMap(([scrollContainer, capture]) => fromEvent<MouseEvent>(scrollContainer, "scroll", { capture }))
        ).subscribe((scrollEvent) => {
            this.scrollPosition$.next({
                x: (scrollEvent.target as HTMLElement).scrollLeft,
                y: (scrollEvent.target as HTMLElement).scrollTop
            });
        });

        this.onDestroy$.subscribe(() => scrollSubscription.unsubscribe());

        this.items$.pipe(
            map((items): VirtualScroll.RenderedItem[] => items.map((item) => ({
                item,
                visible: false
            })))
        ).subscribe(this.renderedItems$);

        // Make the first element visible (TODO- always?)
        this.renderedItems$.pipe(
            filter(renderedItems => renderedItems.length > 0),
            take(1)
        ).subscribe(renderedItems => renderedItems[0].visible = true);

        combineLatest([
            this.scrollPosition$.pipe(throttleTime(50, undefined, { leading: true, trailing: true })) /* TODO - Make customizable */,
            this.renderedItems$,
            this.scrollContainer$,
            this.bufferLength$
        ]).pipe(
            filter(([, renderedItems]) => renderedItems.length > 0),
            delay(0), // Wait for DOM rendering to occur
            mergeMap(([scrollPosition, renderedItems, scrollContainer, bufferLength]) => {
                const [bestRenderedIndex, renderedElement] = this.findBestOnScreenItem(renderedItems);

                if (renderedElement) {
                    const offset = { x: renderedElement.offsetLeft, y: renderedElement.offsetTop };
                    const elementDimensions = {
                        left: offset.x,
                        top: offset.y,
                        right: offset.x + renderedElement.clientWidth,
                        bottom: offset.y + renderedElement.clientHeight
                    };
                    const renderedBounds: VirtualScroll.Rect = {
                        left: scrollPosition.x,
                        top: scrollPosition.y,
                        right: scrollPosition.x + scrollContainer.clientWidth,
                        bottom: scrollPosition.y + scrollContainer.clientHeight
                    };
                    const bufferLengthPx = (scrollContainer.clientHeight || window.innerHeight) * bufferLength;

                    renderedBounds.top -= bufferLengthPx;
                    renderedBounds.bottom += bufferLengthPx;

                    return forkJoin([
                        this.walkList(renderedItems, renderedBounds, bestRenderedIndex, 1, elementDimensions),
                        this.walkList(renderedItems, renderedBounds, bestRenderedIndex, -1, elementDimensions)
                    ]);
                } else {
                    return of(null);
                }
            })
        ).subscribe();
    }

    public checkScroll(scrollPosition?: VirtualScroll.ScrollPosition): void {
       (scrollPosition ? of(scrollPosition) : this.scrollPosition$.pipe(take(1)))
            .subscribe(scrollPosition => this.scrollPosition$.next(scrollPosition));
    }

    private applyScrollContainerStyles(apply: boolean) {
        this.listElement.style.overflowY = apply ? "scroll" : "initial";
        this.listElement.style.display = apply ? "block" : "initial";
    }

    private findBestOnScreenItem(renderedItems: VirtualScroll.RenderedItem[]): [number, HTMLElement] {
        const minRenderedIndex = renderedItems.findIndex(renderedItem => renderedItem.visible);
        const maxRenderedIndex = minRenderedIndex + renderedItems.slice(minRenderedIndex).findIndex(renderedItem => !renderedItem.visible);

        // Grab any rendered element (that is currently being rendered in the DOM)
        let bestRenderedIndex = minRenderedIndex;
        let renderedElement: HTMLElement;
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
            const renderedElement = this.getRenderedElement(index);
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
                this.cdRef.detectChanges();

                // Wait for the DOM element to render, then continue walking the list
                return of(null).pipe(
                    delay(0),
                    mergeMap(() => this.walkList(renderedItems, renderedBounds, index, direction))
                );
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
