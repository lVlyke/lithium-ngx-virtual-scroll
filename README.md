# lithium-ngx-virtual-scroll

A fast virtual scrolling solution for Angular that natively supports items with unequal heights. Built with @lithiumjs/angular.

## How to use

Import `NgxVirtualScrollModule`. Add the following to your template:

```html
    <!-- bufferLength is optional -->
    <li-virtual-scroll [items]="items" [bufferLength]="5">
        <ng-template let-item>
            <div>{{item}}</div>
        </ng-template>
    </li-virtual-scroll>
```