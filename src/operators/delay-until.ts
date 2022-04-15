import { MonoTypeOperatorFunction, Observable } from "rxjs";
import { map } from "rxjs/operators";
import { withNextFrom } from "./with-next-from";

export function delayUntil<T, U>(input: Observable<U>): MonoTypeOperatorFunction<T> {
    return function (src$: Observable<T>) {
        return src$.pipe(
            withNextFrom(input),
            map(([src]) => src)
        );
    };
}
