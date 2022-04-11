# @lithiumjs/ngx-virtual-scroll

A lightweight and efficient virtual scrolling solution for Angular that supports single column lists and grid lists. Built with [@lithiumjs/angular](https://github.com/lVlyke/lithium-angular).

## How to use

```bash
npm install @lithiumjs/angular @lithiumjs/ngx-virtual-scroll
```

Import `NgxVirtualScrollModule` into your application's module. Add the following to your component template:

```html
    <!-- bufferLength is optional -->
    <li-virtual-scroll [items]="items" [bufferLength]="3">
        <!-- liVirtualItem defines a list item element for each item -->
        <div *liVirtualItem="let item">
            {{ item.name }}
        </div>
    </li-virtual-scroll>
```

### Grid lists (multiple items per row)

If the list being rendered is a grid list with multiple items per row, make sure to set `gridList` to `true`:

```html
    <li-virtual-scroll [items]="items" [gridList]="true">
        <div *liVirtualItem="let item">
            {{ item.name }}
        </div>
    </li-virtual-scroll>
```

## API reference

### `VirtualScroll` (`li-virtual-scroll`)

Component used to create a virtual scrolling container.
#### **Inputs**

* **`items`** - The list of items to render.
* **`gridList`** - (Optional) Whether or not the list is a grid list with multiple items per row. Defaults to `false`.
* **`itemWidth`** - (Optional) The width of each item being rendered, in pixels. Calculated automatically if not given.
* **`itemHeight`** - (Optional) The height of each item being rendered, in pixels. Calculated automatically if not given.
* **`bufferLength`** - (Optional) How much extra list content should be rendered, measured in multiples of the list container's client height. This helps improve scrolling responsiveness for fast scrolling. Defaults to `2`.
* **`scrollContainer`** - (Optional) The HTML element to use as the scroll container. Defaults to the host element.
* **`eventCapture`** - (Optional) Whether or not to use event capture mode for capturing scroll events from `scrollContainer`. Defaults to `false`.

### `VirtualItem` (`[liVirtualItem]`)

Structural directive used to render items inside a `li-virtual-scroll` component.

## Other information

* [Lithium for Angular](https://github.com/lVlyke/lithium-angular)