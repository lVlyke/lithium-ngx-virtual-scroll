# @lithiumjs/ngx-virtual-scroll

A fast virtual scrolling solution for Angular that natively supports items with unequal heights. Built with [@lithiumjs/angular](https://github.com/lVlyke/lithium-angular).

## How to use

```bash
npm install @lithiumjs/angular @lithiumjs/ngx-virtual-scroll
```

Import `NgxVirtualScrollModule` in your project. Add the following to your template:

```html
    <!-- bufferLength is optional -->
    <li-virtual-scroll [items]="items" [bufferLength]="5">
        <ng-template let-item>
            <!-- Your custom content goes here -->
            <div>{{item}}</div>
        </ng-template>
    </li-virtual-scroll>
```

```li-virtual-scroll``` automatically handles rendering items of different heights without any further config needed.

## Properties

* **```items```** - The list of items to display.
* **```bufferLength```** - (Optional) How much extra content should be rendered, measured in multiples of window height. This helps improve scrolling performance. Defaults to ```3```.
* **```scrollContainer```** - (Optional) The HTML entity to use as the scroll container. Defaults to the host element.
* **```eventCapture```** - (Optional) Whether or not to use event capture mode for capturing scroll events from ```scrollContainer```. Defaults to ```false```.

## Other information

* [Lithium for Angular](https://github.com/lVlyke/lithium-angular)