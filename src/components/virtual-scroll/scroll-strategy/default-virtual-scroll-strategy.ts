import { EmbeddedViewRef, Injectable, ViewContainerRef } from "@angular/core";
import { delay, map, Observable, of, tap } from "rxjs";
import { VirtualItem } from "../../../directives/virtual-item.directive";
import { VirtualScrollState } from "../scroll-state/virtual-scroll-state";
import { VirtualScrollStrategy } from "./virtual-scroll-strategy";

@Injectable()
export class DefaultVirtualScrollStrategy<T> implements VirtualScrollStrategy<T> {

    public destroyViewRef(
        scrollState: VirtualScrollState<T>,
        viewRef: EmbeddedViewRef<VirtualItem.ViewContext<T>>
    ): void {
        const viewIndex = scrollState.viewContainerRef.indexOf(viewRef);

        // Destroy the view
        if (viewIndex !== -1) {
            scrollState.viewContainerRef.remove(viewIndex);
        } else {
            viewRef.destroy();
        }
    }

    public createViewRefForItemAt(
        scrollState: VirtualScrollState<T>,
        item: T,
        globalIndex: number,
        viewIndex?: number
    ): EmbeddedViewRef<VirtualItem.ViewContext<T>> {
        return scrollState.viewContainerRef.createEmbeddedView(
            scrollState.virtualItem.templateRef,
            { $implicit: item, index: globalIndex },
            viewIndex
        );
    }

    public destroyViewRefAt(
        scrollState: VirtualScrollState<T>,
        viewRef: EmbeddedViewRef<VirtualItem.ViewContext<T>>,
        globalIndex: number
    ): void {
        delete scrollState.cachedViews[globalIndex];
        delete scrollState.renderedViews[globalIndex];
        this.destroyViewRef(scrollState, viewRef);
    }

    public cacheViewRefAt(
        scrollState: VirtualScrollState<T>,
        viewRef: EmbeddedViewRef<VirtualItem.ViewContext<T>>,
        globalIndex: number
    ): void {
        delete scrollState.renderedViews[globalIndex];
        scrollState.cachedViews[globalIndex] = viewRef;
        const viewIndex = scrollState.viewContainerRef.indexOf(viewRef);

        if (viewIndex !== -1) {
            // Detach the view from the container if active
            scrollState.viewContainerRef.detach(viewIndex);
        }
    }

    public unrenderViewRefAt(
        scrollState: VirtualScrollState<T>,
        viewRef: EmbeddedViewRef<VirtualItem.ViewContext<T>>,
        globalIndex: number
    ): void {
        if (this.viewCacheLimit(scrollState) > 0) {
            // Add the view to the cache
            this.cacheViewRefAt(scrollState, viewRef, globalIndex);
        } else {
            // Destroy the view
            this.destroyViewRefAt(scrollState, viewRef, globalIndex);
        }
    }

    public renderViewForItemAt(
        scrollState: VirtualScrollState<T>,
        item: T,
        globalIndex: number,
        renderedViewIndices: number[],
        deferViewCreation?: boolean
    ): Observable<EmbeddedViewRef<VirtualItem.ViewContext<T>>> {
        let viewRef = scrollState.cachedViews[globalIndex] as EmbeddedViewRef<VirtualItem.ViewContext<T>>;
        let skipUpdate = false;
        let result$: Observable<EmbeddedViewRef<VirtualItem.ViewContext<T>>>;
        
        // If this object is still rendered, just move it to the end of the container
        if (renderedViewIndices.includes(globalIndex)) {
            viewRef = scrollState.renderedViews[globalIndex];
            const newIndex = scrollState.viewContainerRef.length - 1;

            if (scrollState.viewContainerRef.indexOf(viewRef) !== newIndex) {
                scrollState.viewContainerRef.move(viewRef, newIndex);
            } else {
                skipUpdate = true;
            }
        } else if (viewRef) {
            // If the view is cached, insert it at the end of the container
            scrollState.viewContainerRef.insert(viewRef);
        } else {
            if (deferViewCreation) {
                // Create an initial placeholder view for the item
                const placeholderViewRef = scrollState.viewContainerRef.createEmbeddedView(
                    scrollState.placeholderTemplate,
                    { $implicit: item, index: globalIndex }
                );

                result$ = of(true).pipe(
                    delay(0),
                    map(() => {
                        // Remove the placeholder view
                        const placholderIndex = scrollState.viewContainerRef.indexOf(placeholderViewRef);
                        scrollState.viewContainerRef.remove(placholderIndex);

                        // Create the real view where the placeholder used to be
                        return this.createViewRefForItemAt(scrollState, item, globalIndex, placholderIndex);
                    })
                );
            } else {
                // Create the view and add it to the end of the container
                viewRef = this.createViewRefForItemAt(scrollState, item, globalIndex);
            }
        }

        result$ ??= of(viewRef);

        // Resolve the resulting view
        return result$.pipe(
            tap((viewRef) => {
                if (!skipUpdate) {
                    // Add the view to the list of rendered views
                    scrollState.renderedViews[globalIndex] = viewRef;
        
                    // Initialize the view state
                    viewRef.detectChanges();
                }
            })
        );
    }

    public purgeViewCache(scrollState: VirtualScrollState<T>): void {
        if (this.cacheFull(scrollState)) {
            const minIndex = scrollState.minIndex;
            const cachedIndices = Object.keys(scrollState.cachedViews).map(Number);
            const direction = minIndex >= scrollState.items.length / 2 ? 1 : -1;
            const startIndex = direction === 1 ? 0 : cachedIndices.length - 1;
            const endIndex = direction === 1 ? cachedIndices.length - 1 : 0;

            // Iterate through the cache starting from the point furthest from the first rendered index
            for (let i = startIndex; i != endIndex && this.cacheFull(scrollState); i += direction) {
                const viewIndex = cachedIndices[i];
                // If this view isn't about to be rendered, evict it from the cache and destroy it
                if (viewIndex < minIndex || viewIndex >= minIndex + scrollState.renderedItems.length) {
                    this.destroyViewRefAt(scrollState, scrollState.cachedViews[viewIndex], viewIndex);
                }
            }
        }
    }

    private viewCacheLimit(scrollState: VirtualScrollState<T>): number {
        return (typeof scrollState.viewCache === "boolean")
            ? (scrollState.viewCache ? Number.MAX_SAFE_INTEGER : 0)
            : scrollState.viewCache;
    }

    private cacheFull(scrollState: VirtualScrollState<T>): boolean {
        return Object.keys(scrollState.cachedViews).length > this.viewCacheLimit(scrollState);
    }
}
