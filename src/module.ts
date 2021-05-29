import { NgModule } from "@angular/core";
import { CommonModule } from "@angular/common";
import { VirtualScroll } from "./components/virtual-scroll/virtual-scroll.component";
import { VirtualItem } from "./directives/virtual-item.directive";

@NgModule({
    imports: [
        CommonModule
    ],
    declarations: [
        VirtualScroll,
        VirtualItem
    ],
    exports: [
        VirtualScroll,
        VirtualItem
    ]
})
export class NgxVirtualScrollModule {}
