import { Directive, TemplateRef } from "@angular/core";
import { LiComponent } from "@lithiumjs/angular";

@Directive({
    selector: "[liVirtualItem]"
})
export class VirtualItem extends LiComponent {

    constructor(
        public readonly templateRef: TemplateRef<HTMLElement>
    ) {
        super();
    }
}