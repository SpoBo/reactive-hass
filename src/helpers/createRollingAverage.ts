import { Observable } from "rxjs";
import { distinctUntilChanged, map, share } from "rxjs/operators";
import ms from "ms";
import { rollingAverage, AggregationFn } from "./operators/rollingAverage";

/**
 * Creates a rolling average of the source observable.
 *
 * This is a convenience helper that combines the rollingAverage operator
 * with distinctUntilChanged (to avoid emitting duplicate values) and share
 * (to multicast the result to multiple subscribers).
 *
 * @param source$ - Source observable emitting numeric values
 * @param windowSize - Time window for calculating the rolling average (number in ms or string like "5m", "1h")
 * @param aggregationFn - Optional aggregation function (default: arithmetic mean)
 *                        Common options: median, trimmedMean(10), weightedMean(exponentialWeights(20, 0.5))
 * @returns Observable emitting the rolling average of values within the time window
 */
export function createRollingAverage$(
  source$: Observable<number>,
  windowSize: number | string,
  aggregationFn?: AggregationFn
): Observable<number> {
  const windowMs = typeof windowSize === "string" ? ms(windowSize) : windowSize;
  return source$.pipe(
    rollingAverage(windowMs, aggregationFn),
    map((v) => Math.floor(v)),
    distinctUntilChanged(),
    share()
  );
}
