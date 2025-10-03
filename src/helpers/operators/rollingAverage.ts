import { Observable } from "rxjs";
import { scan, map, timestamp } from "rxjs/operators";
import { mean } from "../math/aggregations";

/**
 * Function that aggregates an array of numbers into a single value.
 */
export type AggregationFn = (values: number[]) => number;

/**
 * RxJS operator that calculates a rolling aggregate over a time window.
 *
 * Maintains a sliding window of values within the specified time span.
 * Each emission calculates an aggregate of all values received in the last `windowSize` milliseconds.
 *
 * @param windowSize - Time window in milliseconds for calculating the rolling aggregate
 * @param aggregationFn - Function to aggregate values (default: arithmetic mean)
 *                        Common options: mean, median, trimmedMean(10), weightedMean(exponentialWeights(20, 0.5))
 * @returns Operator function that transforms a number stream into rolling aggregates
 *
 * @example
 * ```typescript
 * // Standard rolling average
 * source$.pipe(
 *   rollingAverage(1000),
 *   distinctUntilChanged()
 * )
 *
 * // Robust to outliers using median
 * source$.pipe(
 *   rollingAverage(1000, median),
 *   distinctUntilChanged()
 * )
 *
 * // Weighted toward recent values
 * source$.pipe(
 *   rollingAverage(1000, weightedMean(exponentialWeights(20, 0.5))),
 *   distinctUntilChanged()
 * )
 * ```
 */
export function rollingAverage(
  windowSize: number,
  aggregationFn: AggregationFn = mean
) {
  return (source$: Observable<number>): Observable<number> => {
    return source$.pipe(
      // Add timestamp to each value using RxJS's timestamp operator
      timestamp(),
      // Maintain array of values within the time window
      scan(
        (acc, curr) => {
          // Add current value
          const updated = [...acc, curr];
          // Filter out values older than window size
          const cutoffTime = curr.timestamp - windowSize;
          return updated.filter((item) => item.timestamp >= cutoffTime);
        },
        [] as Array<{ value: number; timestamp: number }>
      ),
      // Calculate aggregate
      map((timestampedValues) => {
        if (timestampedValues.length === 0) return 0;
        const values = timestampedValues.map((item) => item.value);
        return aggregationFn(values);
      })
    );
  };
}
