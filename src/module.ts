import { NgModule } from "@angular/core";
import { CommonModule } from "@angular/common";
import { VirtualScroll } from "./components/virtual-scroll/virtual-scroll.component";

@NgModule({
    imports: [
        CommonModule
    ],
    declarations: [
        VirtualScroll
    ],
    exports: [
        VirtualScroll
    ]
})
export class NgxVirtualScrollModule {}
