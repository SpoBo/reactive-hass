import { Observable } from "rxjs";
import { scan, map, distinctUntilChanged, share, timestamp } from "rxjs/operators";

/**
 * Creates a rolling average of the source observable.
 *
 * Maintains a sliding window of values within the specified time span.
 * Each emission calculates the average of all values received in the last `windowSize` milliseconds.
 *
 * @param source$ - Source observable emitting numeric values
 * @param windowSize - Time window in milliseconds for calculating the rolling average
 * @returns Observable emitting the rolling average of values within the time window
 */
export function createRollingAverage$(
  source$: Observable<number>,
  windowSize: number
): Observable<number> {
  return source$.pipe(
    // Add timestamp to each value using RxJS's timestamp operator
    timestamp(),
    // Maintain array of values within the time window
    scan((acc, curr) => {
      // Add current value
      const updated = [...acc, curr];
      // Filter out values older than window size
      const cutoffTime = curr.timestamp - windowSize;
      return updated.filter((item) => item.timestamp >= cutoffTime);
    }, [] as Array<{ value: number; timestamp: number }>),
    // Calculate average
    map((values) => {
      if (values.length === 0) return 0;
      const sum = values.reduce((total, item) => total + item.value, 0);
      return sum / values.length;
    }),
    distinctUntilChanged(),
    share()
  );
}
