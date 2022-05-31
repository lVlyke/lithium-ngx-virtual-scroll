import { EmbeddedViewRef } from "@angular/core";
import { Observable } from "rxjs";
import { VirtualItem } from "../../../directives/virtual-item.directive";
import { VirtualScrollState } from "../scroll-state/virtual-scroll-state";

export interface VirtualScrollStrategy<T> {

    destroyViewRef(
        scrollState: VirtualScrollState<T>,
        viewRef: EmbeddedViewRef<VirtualItem.ViewContext<T>>
    ): void;

    destroyView(
        scrollState: VirtualScrollState<T>,
        view: VirtualScrollState.ViewInfo<T>
    ): void;

    cacheView(
        scrollState: VirtualScrollState<T>,
        view: VirtualScrollState.ViewInfo<T>
    ): void;

     renderViewForItem(
        scrollState: VirtualScrollState<T>,
        item: T,
        globalIndex: number,
        deferViewCreation?: boolean
    ): Observable<VirtualScrollState.ViewInfo<T>>;

    unrenderView(
        scrollState: VirtualScrollState<T>,
        view: VirtualScrollState.ViewInfo<T>
    ): void;

    purgeViewCache(scrollState: VirtualScrollState<T>): void;
}