import { describe, it, expect } from "vitest";
import { mean, median, trimmedMean, weightedMean } from "./aggregations";

describe("aggregations", () => {
  describe("mean", () => {
    it("should calculate arithmetic mean", () => {
      expect(mean([10, 20, 30])).toBe(20);
      expect(mean([5, 10, 15, 20])).toBe(12.5);
    });

    it("should return 0 for empty array", () => {
      expect(mean([])).toBe(0);
    });

    it("should handle single value", () => {
      expect(mean([42])).toBe(42);
    });

    it("should be affected by outliers", () => {
      // Mean is susceptible to spikes
      expect(mean([50, 50, 50, 2000, 50])).toBe(440);
    });
  });

  describe("median", () => {
    it("should calculate median for odd number of values", () => {
      expect(median([10, 20, 30])).toBe(20);
      expect(median([1, 2, 3, 4, 5])).toBe(3);
    });

    it("should calculate median for even number of values", () => {
      expect(median([10, 20, 30, 40])).toBe(25);
      expect(median([1, 2, 3, 4])).toBe(2.5);
    });

    it("should return 0 for empty array", () => {
      expect(median([])).toBe(0);
    });

    it("should handle single value", () => {
      expect(median([42])).toBe(42);
    });

    it("should be robust to outliers", () => {
      // Median ignores extreme values
      expect(median([50, 50, 50, 2000, 50])).toBe(50);
      expect(median([10, 50, 50, 50, 2000])).toBe(50);
    });

    it("should handle unsorted input", () => {
      expect(median([30, 10, 20])).toBe(20);
      expect(median([100, 1, 50, 25, 75])).toBe(50);
    });
  });

  describe("trimmedMean", () => {
    it("should calculate trimmed mean by removing outliers", () => {
      const trim10 = trimmedMean(10);

      // 10% trim on 10 values = remove 1 from each end
      // [10, 50, 50, 50, 50, 50, 50, 50, 50, 2000]
      // After trim: [50, 50, 50, 50, 50, 50, 50, 50]
      expect(trim10([10, 50, 50, 50, 50, 50, 50, 50, 50, 2000])).toBe(50);
    });

    it("should handle 20% trim", () => {
      const trim20 = trimmedMean(20);

      // 20% trim on 10 values = remove 2 from each end
      // [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
      // After trim: [3, 4, 5, 6, 7, 8] = mean 5.5
      expect(trim20([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])).toBe(5.5);
    });

    it("should fall back to mean for small arrays", () => {
      const trim10 = trimmedMean(10);

      // Not enough values to trim
      expect(trim10([10, 20])).toBe(15);
      expect(trim10([42])).toBe(42);
    });

    it("should return 0 for empty array", () => {
      const trim10 = trimmedMean(10);
      expect(trim10([])).toBe(0);
    });

    it("should throw for invalid trim percent", () => {
      expect(() => trimmedMean(-5)).toThrow(
        "trimPercent must be between 0 and 50"
      );
      expect(() => trimmedMean(50)).toThrow(
        "trimPercent must be between 0 and 50"
      );
      expect(() => trimmedMean(100)).toThrow(
        "trimPercent must be between 0 and 50"
      );
    });
  });

  describe("weightedMean", () => {
    it("should calculate weighted mean", () => {
      const weights = [0.1, 0.2, 0.7];
      const weighted = weightedMean(weights);

      // (100*0.1 + 200*0.2 + 300*0.7) / (0.1 + 0.2 + 0.7) = 260
      expect(weighted([100, 200, 300])).toBe(260);
    });

    it("should normalize weights that don't sum to 1", () => {
      const weights = [1, 2, 7]; // Same ratio as [0.1, 0.2, 0.7]
      const weighted = weightedMean(weights);

      expect(weighted([100, 200, 300])).toBe(260);
    });

    it("should handle more values than weights by using most recent", () => {
      const weights = [0.3, 0.7]; // Only 2 weights
      const weighted = weightedMean(weights);

      // Should use last 2 values: 200 and 300
      // (200*0.3 + 300*0.7) / (0.3 + 0.7) = 270
      expect(weighted([100, 200, 300])).toBe(270);
    });

    it("should handle fewer values than weights by using matching weights", () => {
      const weights = [0.1, 0.2, 0.3, 0.4]; // 4 weights
      const weighted = weightedMean(weights);

      // Should use last 2 weights: 0.3 and 0.4
      // (100*0.3 + 200*0.4) / (0.3 + 0.4) ≈ 157.14
      expect(weighted([100, 200])).toBeCloseTo(157.14, 2);
    });

    it("should return 0 for empty array", () => {
      const weighted = weightedMean([1, 2, 3]);
      expect(weighted([])).toBe(0);
    });

    it("should handle single value", () => {
      const weighted = weightedMean([1]);
      expect(weighted([42])).toBe(42);
    });

    it("should throw for empty weights", () => {
      expect(() => weightedMean([])).toThrow("weights array cannot be empty");
    });

    it("should throw for negative weights", () => {
      expect(() => weightedMean([1, -2, 3])).toThrow(
        "weights must be non-negative"
      );
    });

    it("should prioritize recent values with exponential weights", () => {
      // Exponential weights favor recent values
      const weights = [0.05, 0.1, 0.2, 0.65]; // Strong recency bias
      const weighted = weightedMean(weights);

      // Values: [100, 100, 100, 500]
      // Most weight on last value (500)
      const result = weighted([100, 100, 100, 500]);
      expect(result).toBeGreaterThan(200); // Should be much higher than 200 (uniform mean)
      expect(result).toBeCloseTo(360, 0);
    });
  });
});
