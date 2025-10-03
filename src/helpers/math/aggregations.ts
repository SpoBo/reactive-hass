/**
 * Aggregation functions for calculating statistics on arrays of numbers.
 * Used primarily for rolling averages with different outlier handling strategies.
 */

/**
 * Standard arithmetic mean (average).
 * Susceptible to outliers - spikes can significantly affect the result.
 *
 * @param values - Array of numbers to average
 * @returns The arithmetic mean
 */
export function mean(values: number[]): number {
  if (values.length === 0) return 0;
  const sum = values.reduce((total, value) => total + value, 0);
  return sum / values.length;
}

/**
 * Median - middle value when sorted.
 * Very robust to outliers - spikes have minimal impact on the result.
 * Best for: Solar data with occasional spikes/dips.
 *
 * Example: [50, 50, 50, 2000, 50] → median = 50 (vs mean = 440)
 *
 * @param values - Array of numbers
 * @returns The median value
 */
export function median(values: number[]): number {
  if (values.length === 0) return 0;

  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);

  // If even number of values, average the two middle values
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }

  return sorted[mid];
}

/**
 * Trimmed mean - removes top/bottom X% of values before averaging.
 * Balances robustness with sensitivity - reduces outlier impact while maintaining some responsiveness.
 * Best for: Reducing spikes while still tracking trends.
 *
 * Example with 20% trim: [10, 50, 50, 50, 2000] → removes 10 and 2000 → mean([50, 50, 50]) = 50
 *
 * @param trimPercent - Percentage (0-50) to trim from each end (e.g., 10 = remove top/bottom 10%)
 * @returns Function that calculates trimmed mean for an array
 */
export function trimmedMean(trimPercent: number): (values: number[]) => number {
  if (trimPercent < 0 || trimPercent >= 50) {
    throw new Error("trimPercent must be between 0 and 50");
  }

  return (values: number[]): number => {
    if (values.length === 0) return 0;
    if (values.length <= 2) return mean(values); // Not enough values to trim

    const sorted = [...values].sort((a, b) => a - b);
    const trimCount = Math.floor((sorted.length * trimPercent) / 100);

    // Remove trimCount values from each end
    const trimmed = sorted.slice(trimCount, sorted.length - trimCount);

    return mean(trimmed);
  };
}

/**
 * Weighted mean - applies custom weights to each value.
 * Allows prioritizing recent values or emphasizing central values.
 * Best for: Time-series where recent data is more relevant.
 *
 * Example with weights [0.1, 0.2, 0.7] and values [100, 200, 300]:
 * result = (100*0.1 + 200*0.2 + 300*0.7) / (0.1 + 0.2 + 0.7) = 250
 *
 * @param weights - Array of weight values (will be normalized to sum to 1)
 * @returns Function that calculates weighted mean for an array
 */
export function weightedMean(weights: number[]): (values: number[]) => number {
  if (weights.length === 0) {
    throw new Error("weights array cannot be empty");
  }
  if (weights.some((w) => w < 0)) {
    throw new Error("weights must be non-negative");
  }

  return (values: number[]): number => {
    if (values.length === 0) return 0;

    // If more values than weights, use the last N values
    // If fewer values than weights, use corresponding weights
    const numValues = values.length;
    const numWeights = weights.length;

    let effectiveValues = values;
    let effectiveWeights = weights;

    if (numValues > numWeights) {
      // Take the most recent values
      effectiveValues = values.slice(numValues - numWeights);
    } else if (numValues < numWeights) {
      // Take the most recent weights
      effectiveWeights = weights.slice(numWeights - numValues);
    }

    // Calculate weighted sum
    let weightedSum = 0;
    let weightSum = 0;

    for (let i = 0; i < effectiveValues.length; i++) {
      weightedSum += effectiveValues[i] * effectiveWeights[i];
      weightSum += effectiveWeights[i];
    }

    // Normalize by total weight (handles cases where weights don't sum to 1)
    return weightSum > 0 ? weightedSum / weightSum : 0;
  };
}
