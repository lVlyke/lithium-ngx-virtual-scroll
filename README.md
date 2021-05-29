# @lithiumjs/ngx-virtual-scroll

A lightweight virtual scrolling solution for Angular that supports single column lists and grid lists. Built with [@lithiumjs/angular](https://github.com/lVlyke/lithium-angular).

## How to use

```bash
npm install @lithiumjs/angular @lithiumjs/ngx-virtual-scroll
```

Import the `NgxVirtualScrollModule`. Add the following to your component template:

```html
    <!-- bufferLength is optional -->
    <li-virtual-scroll [items]="items" [bufferLength]="3">
        <!-- liVirtualItem defines a list item element for each item -->
        <div *liVirtualItem="let item">
            {{ item.name }}
        </div>
    </li-virtual-scroll>
```

## Properties

* **```items```** - The list of items to render.
* **```bufferLength```** - (Optional) How much extra list content should be rendered, measured in multiples of the list container's client height. This helps improve scrolling responsiveness for fast scrolling. Defaults to ```3```.
* **```scrollContainer```** - (Optional) The HTML entity to use as the scroll container. Defaults to the host element.
* **```eventCapture```** - (Optional) Whether or not to use event capture mode for capturing scroll events from ```scrollContainer```. Defaults to ```false```.

## Other information

* [Lithium for Angular](https://github.com/lVlyke/lithium-angular)