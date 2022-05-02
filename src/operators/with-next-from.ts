import { Observable, OperatorFunction } from "rxjs";
import { mergeMap, take, map } from "rxjs/operators";

export function withNextFrom<T, U>(input: Observable<U>): OperatorFunction<T, [T, U]> {
    return function (src$: Observable<T>) {
        return src$.pipe(
            mergeMap((srcVal: T) => input.pipe(
                take(1),
                map((inputVal: U): [T, U] => [srcVal, inputVal])
            ))
        );
    };
}
