import { describe, it, expect } from "vitest";
import {
  calculateOptimalAmps,
  canStartCharging,
  shouldStopCharging,
  shouldAdjustAmps,
  calculateHouseBaseLoad,
  calculateSolarOverhead,
} from "./helpers";

describe("calculateOptimalAmps", () => {
  const wattsPerAmp = 230;
  const minAmps = 5;
  const maxAmps = 13;

  it("should return minAmps when available watts is just above minimum", () => {
    const result = calculateOptimalAmps(1200, wattsPerAmp, minAmps, maxAmps);
    expect(result).toBe(5);
  });

  it("should return maxAmps when available watts exceeds maximum", () => {
    const result = calculateOptimalAmps(5000, wattsPerAmp, minAmps, maxAmps);
    expect(result).toBe(13);
  });

  it("should return calculated amps when in mid-range", () => {
    const result = calculateOptimalAmps(2000, wattsPerAmp, minAmps, maxAmps);
    expect(result).toBe(8); // 2000 / 230 = 8.69, floored to 8
  });

  it("should handle exactly minimum watts", () => {
    const result = calculateOptimalAmps(1150, wattsPerAmp, minAmps, maxAmps); // 5 * 230
    expect(result).toBe(5);
  });

  it("should handle exactly maximum watts", () => {
    const result = calculateOptimalAmps(2990, wattsPerAmp, minAmps, maxAmps); // 13 * 230
    expect(result).toBe(13);
  });
});

describe("canStartCharging", () => {
  const wattsPerAmp = 230;
  const minAmps = 5;

  it("should return true when average exceeds minimum requirement", () => {
    const result = canStartCharging(1500, minAmps, wattsPerAmp);
    expect(result).toBe(true);
  });

  it("should return false when average is below minimum requirement", () => {
    const result = canStartCharging(1000, minAmps, wattsPerAmp);
    expect(result).toBe(false);
  });

  it("should return true when average exactly matches minimum", () => {
    const result = canStartCharging(1150, minAmps, wattsPerAmp); // 5 * 230
    expect(result).toBe(true);
  });

  it("should return false when average is zero", () => {
    const result = canStartCharging(0, minAmps, wattsPerAmp);
    expect(result).toBe(false);
  });

  it("should return false when average is negative", () => {
    const result = canStartCharging(-500, minAmps, wattsPerAmp);
    expect(result).toBe(false);
  });
});

describe("shouldStopCharging", () => {
  const wattsPerAmp = 230;
  const minAmps = 5;

  it("should return true when average is below minimum requirement", () => {
    const result = shouldStopCharging(1000, minAmps, wattsPerAmp);
    expect(result).toBe(true);
  });

  it("should return false when average exceeds minimum requirement", () => {
    const result = shouldStopCharging(1500, minAmps, wattsPerAmp);
    expect(result).toBe(false);
  });

  it("should return false when average exactly matches minimum", () => {
    const result = shouldStopCharging(1150, minAmps, wattsPerAmp); // 5 * 230
    expect(result).toBe(false);
  });

  it("should return true when average is zero", () => {
    const result = shouldStopCharging(0, minAmps, wattsPerAmp);
    expect(result).toBe(true);
  });

  it("should return true when average is negative (consuming power)", () => {
    const result = shouldStopCharging(-500, minAmps, wattsPerAmp);
    expect(result).toBe(true);
  });
});

describe("shouldAdjustAmps", () => {
  const wattsPerAmp = 230;
  const minAmps = 5;
  const maxAmps = 13;

  it("should suggest increase when more power is available", () => {
    const result = shouldAdjustAmps(6, 2000, wattsPerAmp, minAmps, maxAmps);
    expect(result.shouldAdjust).toBe(true);
    expect(result.newAmps).toBe(8);
  });

  it("should suggest decrease when less power is available", () => {
    const result = shouldAdjustAmps(10, 1500, wattsPerAmp, minAmps, maxAmps);
    expect(result.shouldAdjust).toBe(true);
    expect(result.newAmps).toBe(6);
  });

  it("should not adjust when already at optimal level", () => {
    const result = shouldAdjustAmps(8, 2000, wattsPerAmp, minAmps, maxAmps);
    expect(result.shouldAdjust).toBe(false);
    expect(result.newAmps).toBe(8);
  });

  it("should not suggest going below minimum", () => {
    const result = shouldAdjustAmps(8, 1000, wattsPerAmp, minAmps, maxAmps);
    expect(result.shouldAdjust).toBe(true);
    expect(result.newAmps).toBe(5); // Clamped to minimum
  });

  it("should not suggest going above maximum", () => {
    const result = shouldAdjustAmps(8, 5000, wattsPerAmp, minAmps, maxAmps);
    expect(result.shouldAdjust).toBe(true);
    expect(result.newAmps).toBe(13); // Clamped to maximum
  });
});

describe("calculateHouseBaseLoad", () => {
  it("should return total power when not charging", () => {
    const result = calculateHouseBaseLoad(2000, 2.5, false);
    expect(result).toBe(2000);
  });

  it("should subtract car power when charging", () => {
    const result = calculateHouseBaseLoad(4000, 2.0, true); // 2kW = 2000W
    expect(result).toBe(2000); // 4000 - 2000
  });

  it("should handle zero car power while charging", () => {
    const result = calculateHouseBaseLoad(2000, 0, true);
    expect(result).toBe(2000);
  });

  it("should handle negative total power (solar export)", () => {
    const result = calculateHouseBaseLoad(-1000, 1.5, true); // -1000W = exporting
    expect(result).toBe(-2500); // -1000 - 1500
  });
});

describe("calculateSolarOverhead", () => {
  it("should return positive overhead for negative house load", () => {
    const result = calculateSolarOverhead(-1500);
    expect(result).toBe(1500);
  });

  it("should return negative overhead for positive house load", () => {
    const result = calculateSolarOverhead(2000);
    expect(result).toBe(-2000);
  });

  it("should return zero for zero house load", () => {
    const result = calculateSolarOverhead(0);
    expect(result).toBe(-0); // JavaScript -0 === 0, but Object.is distinguishes
  });
});
