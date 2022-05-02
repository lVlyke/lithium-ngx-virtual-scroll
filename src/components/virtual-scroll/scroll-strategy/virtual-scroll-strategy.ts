import { EmbeddedViewRef } from "@angular/core";
import { Observable } from "rxjs";
import { VirtualItem } from "../../../directives/virtual-item.directive";
import { VirtualScrollState } from "../scroll-state/virtual-scroll-state";

export interface VirtualScrollStrategy<T> {

    destroyViewRef(
        scrollState: VirtualScrollState<T>,
        viewRef: EmbeddedViewRef<VirtualItem.ViewContext<T>>
    ): void;
    destroyViewRefAt(
        scrollState: VirtualScrollState<T>,
        viewRef: EmbeddedViewRef<VirtualItem.ViewContext<T>>,
        globalIndex: number
    ): void;
    cacheViewRefAt(
        scrollState: VirtualScrollState<T>,
        viewRef: EmbeddedViewRef<VirtualItem.ViewContext<T>>,
        globalIndex: number
    ): void;
    renderViewForItemAt(
        scrollState: VirtualScrollState<T>,
        item: T,
        globalIndex: number,
        renderedViewIndices: number[],
        deferViewCreation?: boolean
    ): Observable<EmbeddedViewRef<VirtualItem.ViewContext<T>>>;
    unrenderViewRefAt(
        scrollState: VirtualScrollState<T>,
        viewRef: EmbeddedViewRef<VirtualItem.ViewContext<T>>,
        globalIndex: number
    ): void;
    purgeViewCache(scrollState: VirtualScrollState<T>): void;
}