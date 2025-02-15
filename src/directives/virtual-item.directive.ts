import { Directive, TemplateRef } from "@angular/core";

@Directive({
    standalone: false,
    selector: "[liVirtualItem]"
})
export class VirtualItem<T> {

    constructor(
        public readonly templateRef: TemplateRef<VirtualItem.ViewContext<T>>
    ) {}
}

export namespace VirtualItem {

    export type ViewContext<T> = { $implicit: T, index: number };
}