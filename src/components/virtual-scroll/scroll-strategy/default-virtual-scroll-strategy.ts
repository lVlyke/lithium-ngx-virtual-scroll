import { EmbeddedViewRef, Injectable } from "@angular/core";
import { delay, map, Observable, of, tap } from "rxjs";
import { VirtualItem } from "../../../directives/virtual-item.directive";
import { VirtualScrollState } from "../scroll-state/virtual-scroll-state";
import { VirtualScrollStrategy } from "./virtual-scroll-strategy";

@Injectable()
export class DefaultVirtualScrollStrategy<T> implements VirtualScrollStrategy<T> {

    public createViewRefForItem(
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

    public destroyView(
        scrollState: VirtualScrollState<T>,
        view: VirtualScrollState.ViewInfo<T>
    ): void {
        scrollState.deleteCachedView(view.itemIndex, view.item);
        scrollState.deleteRenderedView(view.itemIndex, view.item);
        this.destroyViewRef(scrollState, view.viewRef);
    }

    public cacheView(
        scrollState: VirtualScrollState<T>,
        view: VirtualScrollState.ViewInfo<T>
    ): void {
        scrollState.deleteRenderedView(view.itemIndex, view.item);
        scrollState.setCachedView(view);
        const viewIndex = scrollState.viewContainerRef.indexOf(view.viewRef);

        if (viewIndex !== -1) {
            // Detach the view from the container if active
            scrollState.viewContainerRef.detach(viewIndex);
        }
    }

    public renderViewForItem(
        scrollState: VirtualScrollState<T>,
        item: T,
        globalIndex: number,
        deferViewCreation?: boolean
    ): Observable<VirtualScrollState.ViewInfo<T>> {
        let view = scrollState.getRenderedView(globalIndex, item);
        let skipUpdate = false;
        
        // If this object is still rendered, just move it to the end of the container
        if (view) {
            const newIndex = scrollState.viewContainerRef.length - 1;

            if (scrollState.viewContainerRef.indexOf(view.viewRef) !== newIndex) {
                scrollState.viewContainerRef.move(view.viewRef, newIndex);
            } else {
                skipUpdate = true;
            }
        } else if (view = scrollState.getCachedView(globalIndex, item)) {
            // If the view is cached, insert it at the end of the container
            scrollState.viewContainerRef.insert(view.viewRef);
        } else {
            if (deferViewCreation) {
                // Create an initial placeholder view for the item
                const placeholderViewRef = scrollState.viewContainerRef.createEmbeddedView(
                    scrollState.placeholderTemplate,
                    { $implicit: item, index: globalIndex }
                );

                view = {
                    placeholder: true,
                    viewRef: placeholderViewRef,
                    itemIndex: globalIndex,
                    item
                };
            } else {
                // Create the view and add it to the end of the container
                view = {
                    viewRef: this.createViewRefForItem(scrollState, item, globalIndex),
                    itemIndex: globalIndex,
                    item
                };
            }
        }

        // Add the view to the list of rendered views
        scrollState.setRenderedView(view);

        let result$: Observable<VirtualScrollState.ViewInfo<T>>;

        // If the view is a placeholder, we need to replace it with the real view asynchronously
        if (view.placeholder) {
            result$ = of(view).pipe(
                delay(0),
                map((placeholderView) => {
                    // Remove the placeholder view
                    const placholderIndex = scrollState.viewContainerRef.indexOf(placeholderView.viewRef);
                    scrollState.viewContainerRef.remove(placholderIndex);

                    // Create the real view where the placeholder used to be
                    const asyncView = {
                        viewRef: this.createViewRefForItem(scrollState, item, globalIndex, placholderIndex),
                        itemIndex: globalIndex,
                        item
                    };

                    // Add the view to the list of rendered views
                    scrollState.setRenderedView(asyncView);

                    return asyncView;
                })
            );
        } else {
            result$ = of(view);
        }

        return result$.pipe(
            tap((view) => {
                if (!skipUpdate) {
                    // Initialize the view state
                    view.viewRef.detectChanges();
                }
            })
        );
    }

    public unrenderView(
        scrollState: VirtualScrollState<T>,
        view: VirtualScrollState.ViewInfo<T>
    ): void {
        if (this.viewCacheLimit(scrollState) > 0) {
            // Add the view to the cache
            this.cacheView(scrollState, view);
        } else {
            // Destroy the view
            this.destroyView(scrollState, view);
        }
    }

    public purgeViewCache(scrollState: VirtualScrollState<T>): void {
        if (this.cacheFull(scrollState)) {
            const cachedViews = scrollState.cachedViews;
            const minIndex = scrollState.minIndex;
            const direction = minIndex >= scrollState.items.length / 2 ? 1 : -1;
            const startIndex = direction === 1 ? 0 : cachedViews.length - 1;
            const endIndex = direction === 1 ? cachedViews.length - 1 : 0;

            // Iterate through the cache starting from the point furthest from the first rendered index
            for (let i = startIndex; i != endIndex && this.cacheFull(scrollState); i += direction) {
                const view = cachedViews[i];
                // If this view isn't about to be rendered, evict it from the cache and destroy it
                if (view.itemIndex < minIndex || view.itemIndex >= minIndex + scrollState.renderedItems.length) {
                    this.destroyView(scrollState, view);
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
        return scrollState.cachedViews.length > this.viewCacheLimit(scrollState);
    }
}
