import { EmbeddedViewRef, TemplateRef, ViewContainerRef } from "@angular/core";
import { VirtualItem } from "../../../directives/virtual-item.directive";
import { VirtualPlaceholder } from "../../../directives/virtual-placeholder.directive";

export interface VirtualScrollState<T> {

    readonly items: T[];
    readonly renderedItems: T[];
    readonly viewCache: number | boolean;
    readonly minIndex: number;
    readonly maxIndex: number;

    readonly virtualItem: VirtualItem<T>;
    readonly viewContainerRef: ViewContainerRef;
    readonly placeholderTemplate: TemplateRef<VirtualPlaceholder.ViewContext<T>>
    readonly cachedViews: VirtualScrollState.ViewRecord<T>;
    readonly renderedViews: VirtualScrollState.ViewRecord<T>;
}

export namespace VirtualScrollState {

    export type ViewRecord<T> = Record<number, EmbeddedViewRef<VirtualItem.ViewContext<T>>>;
}