import { TestScheduler } from "rxjs/testing";
import { rollingAverage } from "./rollingAverage";
import { median, weightedMean } from "../math/aggregations";
import { exponentialWeights } from "../math/weights";

describe("rollingAverage", () => {
  let testScheduler: TestScheduler;

  beforeEach(() => {
    testScheduler = new TestScheduler((actual, expected) => {
      expect(actual).toEqual(expected);
    });
  });

  it("should emit average immediately for single value", () => {
    testScheduler.run(({ cold, expectObservable }) => {
      const source$ = cold("a|", { a: 10 });
      const result$ = source$.pipe(rollingAverage(1000));

      expectObservable(result$).toBe("a|", { a: 10 });
    });
  });

  it("should calculate rolling average as values arrive", () => {
    testScheduler.run(({ cold, expectObservable }) => {
      const source$ = cold("a 99ms b 99ms c|", { a: 10, b: 20, c: 30 });
      const result$ = source$.pipe(rollingAverage(1000));

      // a: avg of [10] = 10
      // b at 100ms: avg of [10, 20] = 15
      // c at 200ms: avg of [10, 20, 30] = 20
      expectObservable(result$).toBe("a 99ms b 99ms c|", {
        a: 10,
        b: 15,
        c: 20,
      });
    });
  });

  it("should drop old values outside the window", () => {
    testScheduler.run(({ cold, expectObservable }) => {
      const source$ = cold("a 1001ms b|", { a: 10, b: 20 });
      const result$ = source$.pipe(rollingAverage(1000));

      // a: avg of [10] = 10
      // b at 1001ms: value 'a' is now outside 1000ms window, avg of [20] = 20
      expectObservable(result$).toBe("a 1001ms b|", { a: 10, b: 20 });
    });
  });

  it("should keep values within the sliding window", () => {
    testScheduler.run(({ cold, expectObservable }) => {
      const source$ = cold("a 999ms b 999ms c|", { a: 10, b: 20, c: 30 });
      const result$ = source$.pipe(rollingAverage(1000));

      // a at 0ms: avg of [10] = 10
      // b at 999ms: avg of [10, 20] = 15
      // c at 1998ms: only b and c are within 1000ms window, avg of [20, 30] = 25
      expectObservable(result$).toBe("a 999ms b 999ms c|", {
        a: 10,
        b: 15,
        c: 25,
      });
    });
  });

  it("should emit all values including duplicates", () => {
    testScheduler.run(({ cold, expectObservable }) => {
      const source$ = cold("a 99ms b 99ms c|", { a: 10, b: 10, c: 10 });
      const result$ = source$.pipe(rollingAverage(1000));

      // Unlike createRollingAverage$, this operator doesn't filter duplicates
      expectObservable(result$).toBe("a 99ms b 99ms c|", {
        a: 10,
        b: 10,
        c: 10,
      });
    });
  });

  it("should handle different window sizes", () => {
    testScheduler.run(({ cold, expectObservable }) => {
      const source$ = cold("a 99ms b 99ms c|", { a: 10, b: 20, c: 30 });
      const result$ = source$.pipe(rollingAverage(100));

      // a at 0ms: avg of [10] = 10
      // b at 100ms: a and b are both within 100ms window (0-100), avg of [10, 20] = 15
      // c at 200ms: b and c are both within 100ms window (100-200), avg of [20, 30] = 25
      expectObservable(result$).toBe("a 99ms b 99ms c|", {
        a: 10,
        b: 15,
        c: 25,
      });
    });
  });

  describe("with custom aggregation functions", () => {
    it("should use median to ignore outliers", () => {
      testScheduler.run(({ cold, expectObservable }) => {
        // Send mostly 50W with two 2000W spikes
        const source$ = cold("a 99ms b 99ms c 99ms d 99ms e|", {
          a: 50,
          b: 50,
          c: 2000, // spike
          d: 50,
          e: 2000, // spike
        });
        const result$ = source$.pipe(rollingAverage(1000, median));

        // Median ignores spikes:
        // a: median([50]) = 50
        // b: median([50, 50]) = 50
        // c: median([50, 50, 2000]) = 50 (not affected by spike!)
        // d: median([50, 50, 2000, 50]) = 50
        // e: median([50, 50, 2000, 50, 2000]) = 50
        expectObservable(result$).toBe("a 99ms b 99ms c 99ms d 99ms e|", {
          a: 50,
          b: 50,
          c: 50,
          d: 50,
          e: 50,
        });
      });
    });

    it("should use weighted mean to prioritize recent values", () => {
      testScheduler.run(({ cold, expectObservable }) => {
        // Three values: old=100, middle=100, recent=300
        const source$ = cold("a 99ms b 99ms c|", { a: 100, b: 100, c: 300 });

        // Exponential weights with strong recency bias
        // For 3 values with decay 0.5: [0.143, 0.286, 0.571]
        const result$ = source$.pipe(
          rollingAverage(1000, weightedMean(exponentialWeights(3, 0.5)))
        );

        // a: weighted([100]) = 100
        // b: weighted([100, 100]) with weights [0.333, 0.667] ≈ 100
        // c: weighted([100, 100, 300]) with weights [0.143, 0.286, 0.571]
        //    = 100*0.143 + 100*0.286 + 300*0.571 ≈ 214.29
        expectObservable(result$).toBe("a 99ms b 99ms c|", {
          a: 100,
          b: 100,
          c: 214.28571428571428, // Significantly influenced by recent spike (vs mean = 166)
        });
      });
    });

    it("should use weighted mean that adapts to window size", () => {
      testScheduler.run(({ cold, expectObservable }) => {
        const source$ = cold("a 99ms b 99ms c 99ms d|", {
          a: 100,
          b: 100,
          c: 100,
          d: 500,
        });

        // 20 weights but only 4 values - should use last 4 weights
        const result$ = source$.pipe(
          rollingAverage(1000, weightedMean(exponentialWeights(20, 0.5)))
        );

        // d: Last 4 weights from exponentialWeights(20, 0.5) heavily favor position 19
        // Should give very high weight to the 500 value
        expectObservable(result$).toBe("a 99ms b 99ms c 99ms d|", {
          a: 100,
          b: 100,
          c: 100,
          d: 313.3333333333333, // Heavily weighted toward 500 (vs mean = 225)
        });
      });
    });
  });
});
