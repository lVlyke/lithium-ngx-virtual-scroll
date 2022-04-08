import { Directive, TemplateRef } from "@angular/core";

@Directive({
    selector: "[liVirtualItem]"
})
export class VirtualItem {

    constructor(
        public readonly templateRef: TemplateRef<HTMLElement>
    ) {}
}