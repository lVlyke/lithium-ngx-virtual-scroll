import { ModuleWithProviders, NgModule, Type } from "@angular/core";
import { CommonModule } from "@angular/common";
import { VirtualScroll } from "./components/virtual-scroll/virtual-scroll.component";
import { VirtualItem } from "./directives/virtual-item.directive";
import { VirtualPlaceholder } from "./directives/virtual-placeholder.directive";
import { LI_VIRTUAL_SCROLL_STRATEGY } from "./components/virtual-scroll/scroll-strategy/virtual-scroll-strategy.token";
import { DefaultVirtualScrollStrategy } from "./components/virtual-scroll/scroll-strategy/default-virtual-scroll-strategy";
import { VirtualScrollStrategy } from "./components/virtual-scroll/scroll-strategy/virtual-scroll-strategy";

const EXPORTS = [
    VirtualScroll,
    VirtualItem,
    VirtualPlaceholder
];

@NgModule({
    imports: [
        CommonModule
    ],
    providers: [
        {
            provide: LI_VIRTUAL_SCROLL_STRATEGY,
            useClass: DefaultVirtualScrollStrategy
        }
    ],
    declarations: EXPORTS,
    exports: EXPORTS
})
export class NgxVirtualScrollModule {

    public static withOptions(options: NgxVirtualScrollModule.Options): ModuleWithProviders<NgxVirtualScrollModule> {
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

export namespace NgxVirtualScrollModule {

    export interface Options {
        scrollStrategy?: Type<VirtualScrollStrategy<unknown>>;
    }
}
