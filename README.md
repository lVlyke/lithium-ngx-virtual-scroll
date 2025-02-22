# @lithiumjs/ngx-virtual-scroll

A fast and lightweight virtual scrolling solution for Angular that supports single column lists, grid lists and view caching.

## [Live demo](https://lvlyke.github.io/lithium-ngx-virtual-scroll-demo/) ([Code](https://github.com/lVlyke/lithium-ngx-virtual-scroll-demo))

> * [**Installing**](#installing)
> * [**Usage guide**](#usage-guide)
> * [**Troubleshooting**](#troubleshooting)
> * [**API reference**](#api-reference)
> * [**Other information**](#other-information)

# Installing

@lithiumjs/ngx-virtual-scroll requires [@lithiumjs/angular](https://github.com/lVlyke/lithium-angular). Both can be installed from npm:

```bash
npm install @lithiumjs/angular @lithiumjs/ngx-virtual-scroll
```

# Usage guide

Import `NgxVirtualScrollModule`. Use the `li-virtual-scroll` component to declare a list with virtual scrolling:

```html
<li-virtual-scroll [items]="items">
    <!-- liVirtualItem defines a list item element for each item -->
    <div *liVirtualItem="let item">
        {{ item.name }}
    </div>
</li-virtual-scroll>
```

**Note:** The `li-virtual-scroll` element is a scroll container and needs to have a defined maximum size to ensure scrolling occurs.

## Item element size

The size of the list item elements can either be explicitly passed in, or calculated automatically. Width is only required for grid lists.

> [!IMPORTANT]
> All item elements in the list must be the same size. For best results, make sure that the elements have a constant size that does not change. If the element size is not constant and changes based on the number of elements in the container (i.e. flexbox), then the item size **must** be declared explicitly.

### Automatic item size

If `itemWidth` or `itemHeight` are not explicitly passed, they will be automatically calculated by rendering the first item in the list and recording its size. This method only works for list items that have a constant size.

### Explicit item size

Use the `itemWidth` and `itemHeight` inputs to explicitly declare the width/height (in pixels) of the list item elements:

```html
<li-virtual-scroll [items]="items" [itemWidth]="128" [itemHeight]="128">
    <div *liVirtualItem="let item">
        {{ item.name }}
    </div>
</li-virtual-scroll>
```

> [!NOTE]
> Include the element's margins as part of the width/height.

## Grid lists (multiple items per row)

If the list being rendered is a grid list with multiple items per row, make sure to set `gridList` to `true`:

```html
<li-virtual-scroll [items]="items" [gridList]="true">
    <div *liVirtualItem="let item">
        {{ item.name }}
    </div>
</li-virtual-scroll>
```

## Asynchronous view rendering

Asynchronous view rendering can be used to improve scrolling responsiveness for items with complex views. When enabled, a placeholder element will be temporarily be shown while the item is rendered asynchronously. The placeholder element can be customized using the `liVirtualPlaceholder` directive:

```html
<li-virtual-scroll [items]="items" [asyncRendering]="true">
     <!-- Items contain complex components: -->
    <div *liVirtualItem="let item">
        {{ item.name }}

        <app-complex-component>...</app-complex-component>
    </div>

    <!-- Placeholder only prints the item name: -->
    <div *liVirtualPlaceholder="let item">
        {{ item.name }}
    </div>
</li-virtual-scroll>
```

Note that the placeholder should be lightweight so that it can be rendered quickly.

## View caching

View caching can be enabled to improve scrolling performance by caching views that are not being rendered for later re-use. View caching can be toggled on or off, or enabled with a maximum cache size (recommended for very large lists or complex views, as these could cause high memory usage):

```html
<!-- Up to 256 views will be cached -->
<li-virtual-scroll [items]="items" [viewCache]="256">
    <div *liVirtualItem="let item">
        {{ item.name }}
    </div>
</li-virtual-scroll>
```

## Scroll debounce

The scroll debounce controls how often the virtual scroll should respond to scroll position changes. The default is 50 milliseconds.

```html
<!-- Virtual scroll will render on scroll changes every 100ms -->
<li-virtual-scroll [items]="items" [scrollDebounceMs]="100">
    <div *liVirtualItem="let item">
        {{ item.name }}
    </div>
</li-virtual-scroll>
```

## Scroll buffer

Increasing the scroll buffer length will render more items outside of the viewport, which can reduce view pop-in when scrolling quickly. The buffer length is expressed in multiples of the list container's client height:

```html
<li-virtual-scroll [items]="items" [bufferLength]="3">
    <div *liVirtualItem="let item">
        {{ item.name }}
    </div>
</li-virtual-scroll>
```

## Providing a custom virtual scroll strategy

The default virtual scroll strategy can be overriden by providing a custom `VirtualScrollStrategy` service implementation using the `LI_VIRTUAL_SCROLL_STRATEGY` injection token:

```ts
@NgModule({
    providers: [
        {
            provide: LI_VIRTUAL_SCROLL_STRATEGY,
            useClass: AppFooVirtualScrollStrategy
        }
    ]
})
export class AppFooModule {}
```

The default virtual scroll strategy can also be overriden using `NgxVirtualScrollModule.withOptions`:

```ts
@NgModule({
    imports: [
        NgxVirtualScrollModule.withOptions({
            scrollStrategy: AppFooVirtualScrollStrategy
        })
    ]
})
export class AppModule {}
```

# Troubleshooting

## All items are rendered

This can happen when your list element has an unlimited height. The `li-virtual-scroll` component is a scroll container that needs a maximum height for virtual scrolling to work. You must apply a maximum height to the list element for virtual scrolling to work.

## Only one item is rendered

This usually happens when your list item elements do not have a constant size and you have not explicitly declared `itemWidth`/`itemHeight`.

If your list container uses a layout that dynamically resizes elements (i.e. flexbox), you must ensure that the items have a constant size for the automatic width/height calculation to work correctly. The easiest way to achieve this is to add a fixed width/height in CSS. If this is not possible, you must instead explicitly declare the item size using the `itemWidth`/`itemHeight` inputs. See [this section](#item-element-size) for more information.

## Not enough items are rendered

This can happen when incorrect `itemWidth`/`itemHeight` values are given. Make sure that you have calculated the size of your elements correctly (this should also include margins). See [this section](#explicit-item-size) for more information.

# API reference

## `VirtualScroll` (`li-virtual-scroll`)

Component used to create a virtual scrolling container.
### **Inputs**

* **`items`** - The list of items to render.
* **`asyncRendering`** - (Optional) Whether or not to enable asynchronous rendering of views, which loads in placeholder elements while rendering items. Defaults to `false`.
* **`bufferLength`** - (Optional) How much extra list content should be rendered, measured in multiples of the list container's client height. This helps improve scrolling responsiveness for fast scrolling. Defaults to `1`.
* **`eventCapture`** - (Optional) Whether or not to use event capture mode for capturing scroll events from `scrollContainer`. Defaults to `false`.
* **`gridList`** - (Optional) Whether or not the list is a grid list with multiple items per row. Defaults to `false`.
* **`itemWidth`** - (Optional) The width of each item being rendered, in pixels. Calculated automatically based on the width of the first item if not given.
* **`itemHeight`** - (Optional) The height of each item being rendered, in pixels. Calculated automatically based on the height of the first item if not given.
* **`scrollDebounceMs`** - (Optional) How often to respond to scroll position changes, in milliseconds. Defaults to `50`.
* **`trackBy`** - (Optional) A [`TrackByFunction`](https://angular.io/api/core/TrackByFunction) used to compute the identity of items. Defaults to a function returning the item reference.
* **`viewCache`** - (Optional) Whether views can be cached. Can be a boolean or a number representing the maximum number of views to cache at a given time. Defaults to `false`.

## `VirtualItem` (`[liVirtualItem]`)

Structural directive used to render items inside a `li-virtual-scroll` component.

## `VirtualPlaceholder` (`[liVirtualPlaceholder]`)

Structural directive used to render placeholder elements inside a `li-virtual-scroll` component.

## `NgxVirtualScrollModule`

The Angular module for this library.
### `NgxVirtualScrollModule.Options`

The options to configure the module with.

```ts
export interface Options {
    scrollStrategy?: Type<VirtualScrollStrategy<unknown>>;
}
```

* `scrollStrategy` - The custom `VirtualScrollStrategy` service implementation to use.

### `NgxVirtualScrollModule.withOptions`

Allows configuration of the module with custom options.

```ts
export class NgxVirtualScrollModule {

    public static withOptions(
        options: NgxVirtualScrollModule.Options
    ): ModuleWithProviders<NgxVirtualScrollModule>;
}
```

* `options` - The options to configure the module with.

## `VirtualScrollStrategy`

Interface for defining a custom virtual scroll strategy.

```ts
export interface VirtualScrollStrategy<T> {

    destroyViewRef(
        scrollState: VirtualScrollState<T>,
        viewRef: EmbeddedViewRef<VirtualItem.ViewContext<T>>
    ): void;

    destroyView(
        scrollState: VirtualScrollState<T>,
        view: VirtualScrollState.ViewInfo<T>
    ): void;

    cacheView(
        scrollState: VirtualScrollState<T>,
        view: VirtualScrollState.ViewInfo<T>
    ): void;

    renderViewForItem(
        scrollState: VirtualScrollState<T>,
        item: T,
        globalIndex: number,
        deferViewCreation?: boolean
    ): Observable<VirtualScrollState.ViewInfo<T>>;

    unrenderView(
        scrollState: VirtualScrollState<T>,
        view: VirtualScrollState.ViewInfo<T>
    ): void;

    purgeViewCache(scrollState: VirtualScrollState<T>): void;
}
```

## `DefaultVirtualScrollStrategy`

The default `VirtualScrollStrategy` service implementation.

# Other information

* [Lithium for Angular](https://github.com/lVlyke/lithium-angular)