import { EnvironmentProviders, makeEnvironmentProviders, Type } from "@angular/core";
import { VirtualScrollStrategy } from "./components/virtual-scroll/scroll-strategy/virtual-scroll-strategy";
import { LI_VIRTUAL_SCROLL_STRATEGY } from "./components/virtual-scroll/scroll-strategy/virtual-scroll-strategy.token";
import { DefaultVirtualScrollStrategy } from "./components/virtual-scroll/scroll-strategy/default-virtual-scroll-strategy";

export interface NgxVirtualScrollOptions {
    scrollStrategy?: Type<VirtualScrollStrategy<unknown>>;
}

export function provideVirtualScrollStrategy(options?: NgxVirtualScrollOptions): EnvironmentProviders {
    return makeEnvironmentProviders([
        {
            provide: LI_VIRTUAL_SCROLL_STRATEGY,
            useClass: options?.scrollStrategy ?? DefaultVirtualScrollStrategy
        }
    ]);
}