import { combineLatest, Observable, OperatorFunction } from "rxjs";
import { take } from "rxjs/operators";

export function withNextFrom<T, U>(input: Observable<U>): OperatorFunction<T, [T, U]> {
    return function (src$: Observable<T>) {
        return combineLatest([
            src$,
            input.pipe(take(1))
        ]);
    };
}
