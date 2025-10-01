import { TestScheduler } from "rxjs/testing";
import { createRollingAverage$ } from "./createRollingAverage";

describe("createRollingAverage$", () => {
  let testScheduler: TestScheduler;

  beforeEach(() => {
    testScheduler = new TestScheduler((actual, expected) => {
      expect(actual).toEqual(expected);
    });
  });

  it("should emit average immediately for single value", () => {
    testScheduler.run(({ cold, expectObservable }) => {
      const source$ = cold("a|", { a: 10 });
      const result$ = createRollingAverage$(source$, 1000);

      expectObservable(result$).toBe("a|", { a: 10 });
    });
  });

  it("should calculate rolling average as values arrive", () => {
    testScheduler.run(({ cold, expectObservable }) => {
      const source$ = cold("a 99ms b 99ms c|", { a: 10, b: 20, c: 30 });
      const result$ = createRollingAverage$(source$, 1000);

      // a: avg of [10] = 10
      // b at 100ms: avg of [10, 20] = 15
      // c at 200ms: avg of [10, 20, 30] = 20
      expectObservable(result$).toBe("a 99ms b 99ms c|", { a: 10, b: 15, c: 20 });
    });
  });

  it("should drop old values outside the window", () => {
    testScheduler.run(({ cold, expectObservable }) => {
      const source$ = cold("a 1001ms b|", { a: 10, b: 20 });
      const result$ = createRollingAverage$(source$, 1000);

      // a: avg of [10] = 10
      // b at 1001ms: value 'a' is now outside 1000ms window, avg of [20] = 20
      expectObservable(result$).toBe("a 1001ms b|", { a: 10, b: 20 });
    });
  });

  it("should keep values within the sliding window", () => {
    testScheduler.run(({ cold, expectObservable }) => {
      const source$ = cold("a 999ms b 999ms c|", { a: 10, b: 20, c: 30 });
      const result$ = createRollingAverage$(source$, 1000);

      // a at 0ms: avg of [10] = 10
      // b at 999ms: avg of [10, 20] = 15
      // c at 1998ms: only b and c are within 1000ms window, avg of [20, 30] = 25
      expectObservable(result$).toBe("a 999ms b 999ms c|", { a: 10, b: 15, c: 25 });
    });
  });

  it("should filter duplicate consecutive averages", () => {
    testScheduler.run(({ cold, expectObservable }) => {
      const source$ = cold("a 99ms b 99ms c|", { a: 10, b: 10, c: 10 });
      const result$ = createRollingAverage$(source$, 1000);

      // All emissions are 10, filtered by distinctUntilChanged
      expectObservable(result$).toBe("a 200ms |", { a: 10 });
    });
  });
});
