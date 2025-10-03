import { describe, it, expect } from "vitest";
import { exponentialWeights, linearWeights, gaussianWeights } from "./weights";

describe("weights", () => {
  describe("exponentialWeights", () => {
    it("should generate weights that sum to 1", () => {
      const weights = exponentialWeights(10, 0.5);
      const sum = weights.reduce((acc, w) => acc + w, 0);
      expect(sum).toBeCloseTo(1, 10);
    });

    it("should place highest weight on most recent value", () => {
      const weights = exponentialWeights(5, 0.5);
      const lastWeight = weights[weights.length - 1];

      // Last weight should be highest
      weights.slice(0, -1).forEach((w) => {
        expect(w).toBeLessThan(lastWeight);
      });
    });

    it("should increase weights from oldest to newest", () => {
      const weights = exponentialWeights(5, 0.5);

      // Each weight should be greater than the previous
      for (let i = 1; i < weights.length; i++) {
        expect(weights[i]).toBeGreaterThan(weights[i - 1]);
      }
    });

    it("should have stronger recency bias with lower decay", () => {
      const weights05 = exponentialWeights(5, 0.5); // Strong recency bias
      const weights09 = exponentialWeights(5, 0.9); // Mild recency bias

      // Last weight should be much higher with lower decay
      expect(weights05[4]).toBeGreaterThan(weights09[4]);
    });

    it("should handle single weight", () => {
      const weights = exponentialWeights(1, 0.5);
      expect(weights).toEqual([1]);
    });

    it("should throw for invalid count", () => {
      expect(() => exponentialWeights(0, 0.5)).toThrow(
        "count must be positive"
      );
      expect(() => exponentialWeights(-5, 0.5)).toThrow(
        "count must be positive"
      );
    });

    it("should throw for invalid decay", () => {
      expect(() => exponentialWeights(5, 0)).toThrow(
        "decay must be between 0 and 1"
      );
      expect(() => exponentialWeights(5, 1)).toThrow(
        "decay must be between 0 and 1"
      );
      expect(() => exponentialWeights(5, 1.5)).toThrow(
        "decay must be between 0 and 1"
      );
    });
  });

  describe("linearWeights", () => {
    it("should generate weights that sum to 1", () => {
      const weights = linearWeights(10);
      const sum = weights.reduce((acc, w) => acc + w, 0);
      expect(sum).toBeCloseTo(1, 10);
    });

    it("should place highest weight on most recent value", () => {
      const weights = linearWeights(5);
      const lastWeight = weights[weights.length - 1];

      // Last weight should be highest
      weights.slice(0, -1).forEach((w) => {
        expect(w).toBeLessThan(lastWeight);
      });
    });

    it("should increase linearly from oldest to newest", () => {
      const weights = linearWeights(5);

      // Each weight should increase by the same amount
      const diff1 = weights[1] - weights[0];
      const diff2 = weights[2] - weights[1];
      const diff3 = weights[3] - weights[2];
      const diff4 = weights[4] - weights[3];

      expect(diff1).toBeCloseTo(diff2, 10);
      expect(diff2).toBeCloseTo(diff3, 10);
      expect(diff3).toBeCloseTo(diff4, 10);
    });

    it("should handle single weight", () => {
      const weights = linearWeights(1);
      expect(weights).toEqual([1]);
    });

    it("should match expected pattern", () => {
      const weights = linearWeights(5);
      // Weights should be [1, 2, 3, 4, 5] normalized
      // Sum = 15, so normalized = [1/15, 2/15, 3/15, 4/15, 5/15]
      expect(weights[0]).toBeCloseTo(1 / 15, 10);
      expect(weights[1]).toBeCloseTo(2 / 15, 10);
      expect(weights[2]).toBeCloseTo(3 / 15, 10);
      expect(weights[3]).toBeCloseTo(4 / 15, 10);
      expect(weights[4]).toBeCloseTo(5 / 15, 10);
    });

    it("should throw for invalid count", () => {
      expect(() => linearWeights(0)).toThrow("count must be positive");
      expect(() => linearWeights(-5)).toThrow("count must be positive");
    });
  });

  describe("gaussianWeights", () => {
    it("should generate weights that sum to 1", () => {
      const weights = gaussianWeights(10);
      const sum = weights.reduce((acc, w) => acc + w, 0);
      expect(sum).toBeCloseTo(1, 10);
    });

    it("should place highest weight at center", () => {
      const weights = gaussianWeights(11); // Odd number for clear center
      const centerIndex = Math.floor(weights.length / 2);
      const centerWeight = weights[centerIndex];

      // Center weight should be highest
      weights.forEach((w, i) => {
        if (i !== centerIndex) {
          expect(w).toBeLessThanOrEqual(centerWeight);
        }
      });
    });

    it("should be symmetric", () => {
      const weights = gaussianWeights(10);

      // Weights should be symmetric around center
      for (let i = 0; i < weights.length / 2; i++) {
        const leftWeight = weights[i];
        const rightWeight = weights[weights.length - 1 - i];
        expect(leftWeight).toBeCloseTo(rightWeight, 10);
      }
    });

    it("should have narrower peak with smaller sigma", () => {
      const weights1 = gaussianWeights(11, 1); // Narrow peak
      const weights3 = gaussianWeights(11, 3); // Wide peak

      const centerIndex = 5;

      // Narrower sigma should have higher center weight
      expect(weights1[centerIndex]).toBeGreaterThan(weights3[centerIndex]);

      // Narrower sigma should have lower edge weights
      expect(weights1[0]).toBeLessThan(weights3[0]);
    });

    it("should handle single weight", () => {
      const weights = gaussianWeights(1);
      expect(weights).toEqual([1]);
    });

    it("should throw for invalid count", () => {
      expect(() => gaussianWeights(0)).toThrow("count must be positive");
      expect(() => gaussianWeights(-5)).toThrow("count must be positive");
    });
  });
});
