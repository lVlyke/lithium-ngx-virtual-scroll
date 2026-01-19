import { ModuleWithProviders, NgModule } from "@angular/core";
import { VirtualScroll } from "./components/virtual-scroll/virtual-scroll.component";
import { VirtualItem } from "./directives/virtual-item.directive";
import { VirtualPlaceholder } from "./directives/virtual-placeholder.directive";
import { LI_VIRTUAL_SCROLL_STRATEGY } from "./components/virtual-scroll/scroll-strategy/virtual-scroll-strategy.token";
import { DefaultVirtualScrollStrategy } from "./components/virtual-scroll/scroll-strategy/default-virtual-scroll-strategy";
import { NgxVirtualScrollOptions } from "./providers";

const EXPORTS = [
    VirtualScroll,
    VirtualItem,
    VirtualPlaceholder
];

@NgModule({
    imports: EXPORTS,
    providers: [
        {
            provide: LI_VIRTUAL_SCROLL_STRATEGY,
            useClass: DefaultVirtualScrollStrategy
        }
    ],
    exports: EXPORTS
})
export class NgxVirtualScrollModule {

    public static withOptions(options: NgxVirtualScrollOptions): ModuleWithProviders<NgxVirtualScrollModule> {
        return {
            ngModule: NgxVirtualScrollModule,
            providers: [
                ...options.scrollStrategy ? [{
                    provide: LI_VIRTUAL_SCROLL_STRATEGY,
                    useClass: options.scrollStrategy
                }] : []
            ]
        };
    }
}