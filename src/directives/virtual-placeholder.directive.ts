import { Directive, Input, TemplateRef } from "@angular/core";

@Directive({
    selector: "[liVirtualPlaceholder]"
})
export class VirtualPlaceholder<T> {

    @Input()
    public className?: string;

    constructor(
        public readonly templateRef: TemplateRef<VirtualPlaceholder.ViewContext<T>>
    ) {}
}

export namespace VirtualPlaceholder {

    export type ViewContext<T> = { $implicit: T, index: number };
}