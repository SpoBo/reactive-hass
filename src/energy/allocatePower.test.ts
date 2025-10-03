import { describe, it, expect, vi } from "vitest";
import { allocatePower, LoadAllocationInput } from "./allocatePower";
import { DebugFn } from "./types";

// Test helper to create a mock debug function
const createMockDebug = (): DebugFn => {
  const fn = vi.fn() as any;
  fn.extend = vi.fn(() => fn);
  return fn;
};

// Test helper to create a load allocation input
const createLoadState = (
  overrides: Partial<LoadAllocationInput> = {}
): LoadAllocationInput => ({
  id: "test-load",
  name: "Test Load",
  control: {
    type: "modulated",
    minPower: 1000,
    maxPower: 3000,
    stepSize: 100,
  },
  state: {
    current: {
      isActive: false,
      power: 0,
      source: "mqtt",
      confidence: "high",
    },
    expected: {
      isActive: false,
      power: 0,
      hasPendingCommand: false,
    },
    desired: {
      power: 3000,
      reason: "wants max power",
    },
  },
  eligibility: {
    eligible: true,
  },
  priority: {
    score: 50,
  },
  ...overrides,
});

describe("allocatePower - Modulated Loads", () => {
  const debug = createMockDebug();

  it("should allocate power when sufficient power is available", () => {
    const load = createLoadState();
    const allocation = allocatePower([load], 2000, new Map(), debug);

    expect(allocation.get("test-load")).toBe(2000);
  });

  it("should allocate 0 when insufficient power (below minimum)", () => {
    const load = createLoadState();
    const allocation = allocatePower([load], 900, new Map(), debug); // Below 1000W min

    expect(allocation.get("test-load")).toBe(0);
  });

  it("should allocate minimum power when available power is just above minimum", () => {
    const load = createLoadState();
    const allocation = allocatePower([load], 1050, new Map(), debug);

    expect(allocation.get("test-load")).toBe(1000); // Rounded down to step size
  });

  it("should allocate maximum power when available power exceeds maximum", () => {
    const load = createLoadState();
    const allocation = allocatePower([load], 5000, new Map(), debug);

    expect(allocation.get("test-load")).toBe(3000); // Capped at max
  });

  it("should respect step size when calculating allocated power", () => {
    const load = createLoadState({
      control: {
        type: "modulated",
        minPower: 1000,
        maxPower: 3000,
        stepSize: 230, // e.g., 230W per amp
      },
    });
    const allocation = allocatePower([load], 1500, new Map(), debug);

    expect(allocation.get("test-load")).toBe(1380); // 1500 / 230 = 6.52 amps, floored to 6 * 230 = 1380W
  });

  it("should allocate 0 to active load when insufficient power", () => {
    const load = createLoadState({
      state: {
        current: {
          isActive: true,
          power: 2000,
          source: "ble",
          confidence: "high",
        },
        expected: {
          isActive: true,
          power: 2000,
          hasPendingCommand: false,
        },
        desired: {
          power: 3000,
          reason: "wants more",
        },
      },
    });
    // Algorithm: targetPower = min(maxPower=3000, desired=3000, current+available=2000+(-1100)=900)
    // targetPower = 900, which is < minPower (1000), so allocate 0
    const allocation = allocatePower([load], -1100, new Map(), debug);

    expect(allocation.get("test-load")).toBe(0);
  });

  it("should increase allocation when more power becomes available", () => {
    const load = createLoadState({
      state: {
        current: {
          isActive: true,
          power: 1500,
          source: "ble",
          confidence: "high",
        },
        expected: {
          isActive: true,
          power: 1500,
          hasPendingCommand: false,
        },
        desired: {
          power: 3000,
          reason: "wants max",
        },
      },
    });
    // Algorithm: targetPower = min(maxPower=3000, desired=3000, current+available=1500+1000=2500)
    // targetPower = 2500W
    const allocation = allocatePower([load], 1000, new Map(), debug);

    expect(allocation.get("test-load")).toBe(2500);
  });

  it("should decrease allocation when less power is available", () => {
    const load = createLoadState({
      state: {
        current: {
          isActive: true,
          power: 2500,
          source: "ble",
          confidence: "high",
        },
        expected: {
          isActive: true,
          power: 2500,
          hasPendingCommand: false,
        },
        desired: {
          power: 3000,
          reason: "wants max",
        },
      },
    });
    // Algorithm: targetPower = min(maxPower=3000, desired=3000, current+available=2500+(-1000)=1500)
    // targetPower = 1500W (reduced from 2500W)
    const allocation = allocatePower([load], -1000, new Map(), debug);

    expect(allocation.get("test-load")).toBe(1500);
  });

  it("should maintain allocation when power change is below step size threshold", () => {
    const load = createLoadState({
      state: {
        current: {
          isActive: true,
          power: 2000,
          source: "ble",
          confidence: "high",
        },
        expected: {
          isActive: true,
          power: 2000,
          hasPendingCommand: false,
        },
        desired: {
          power: 3000,
          reason: "wants max",
        },
      },
    });
    // Algorithm: targetPower = min(maxPower=3000, desired=3000, current+available=2000+50=2050)
    // After step rounding: floor(2050/100)*100 = 2000W
    const allocation = allocatePower([load], 50, new Map(), debug);

    expect(allocation.get("test-load")).toBe(2000); // Same as current
  });

  it("should not exceed desired power when allocating", () => {
    const load = createLoadState({
      state: {
        current: {
          isActive: false,
          power: 0,
          source: "mqtt",
          confidence: "medium",
        },
        expected: {
          isActive: false,
          power: 0,
          hasPendingCommand: false,
        },
        desired: {
          power: 1500, // Only wants 1500W
          reason: "partial charge needed",
        },
      },
    });
    const allocation = allocatePower([load], 5000, new Map(), debug); // Much more available

    expect(allocation.get("test-load")).toBe(1500); // Capped at desired, not max
  });

  it("should use optimistic power when command is pending", () => {
    const load = createLoadState({
      state: {
        current: {
          isActive: true,
          power: 1000, // Actual power (ignored when pending)
          source: "ble",
          confidence: "high",
        },
        expected: {
          isActive: true,
          power: 2000, // Expected after pending command (used for calculation)
          hasPendingCommand: true,
        },
        desired: {
          power: 3000,
          reason: "wants max",
        },
      },
    });
    // Algorithm uses expected power (2000W) when pending
    // targetPower = min(maxPower=3000, desired=3000, expected+available=2000+1000=3000)
    // targetPower = 3000W (at max)
    const allocation = allocatePower([load], 1000, new Map(), debug);

    expect(allocation.get("test-load")).toBe(3000);
  });
});

describe("allocatePower - Binary Loads", () => {
  const debug = createMockDebug();

  it("should allocate full power to binary load when desired and sufficient power", () => {
    const load = createLoadState({
      control: {
        type: "binary",
        minPower: 2000,
        maxPower: 2000,
      },
      state: {
        current: {
          isActive: false,
          power: 0,
          source: "entity",
          confidence: "high",
        },
        expected: {
          isActive: false,
          power: 0,
          hasPendingCommand: false,
        },
        desired: {
          power: 2000,
          reason: "needs to heat water",
        },
      },
    });
    const allocation = allocatePower([load], 3000, new Map(), debug);

    expect(allocation.get("test-load")).toBe(2000);
  });

  it("should allocate 0 to binary load when insufficient power", () => {
    const load = createLoadState({
      control: {
        type: "binary",
        minPower: 2000,
        maxPower: 2000,
      },
    });
    const allocation = allocatePower([load], 1500, new Map(), debug);

    expect(allocation.get("test-load")).toBe(0);
  });

  it("should allocate 0 to binary load when no longer desired", () => {
    const load = createLoadState({
      control: {
        type: "binary",
        minPower: 2000,
        maxPower: 2000,
      },
      state: {
        current: {
          isActive: true,
          power: 2000,
          source: "entity",
          confidence: "high",
        },
        expected: {
          isActive: true,
          power: 2000,
          hasPendingCommand: false,
        },
        desired: {
          power: 0, // No longer wants power
          reason: "satisfied",
        },
      },
    });
    const allocation = allocatePower([load], 3000, new Map(), debug);

    expect(allocation.get("test-load")).toBe(0);
  });

  it("should allocate 0 to running binary load when power drops below minimum", () => {
    const load = createLoadState({
      control: {
        type: "binary",
        minPower: 2000,
        maxPower: 2000,
      },
      state: {
        current: {
          isActive: true,
          power: 2000,
          source: "entity",
          confidence: "high",
        },
        expected: {
          isActive: true,
          power: 2000,
          hasPendingCommand: false,
        },
        desired: {
          power: 2000,
          reason: "wants to run",
        },
      },
    });
    // Binary load checks: canSustain = currentPower + remainingPower >= minPower
    // canSustain = 2000 + (-500) = 1500 < 2000 (minPower) => false, allocate 0
    const allocation = allocatePower([load], -500, new Map(), debug);

    expect(allocation.get("test-load")).toBe(0);
  });

  it("should maintain binary load allocation when sufficient power", () => {
    const load = createLoadState({
      control: {
        type: "binary",
        minPower: 2000,
        maxPower: 2000,
      },
      state: {
        current: {
          isActive: true,
          power: 2000,
          source: "entity",
          confidence: "high",
        },
        expected: {
          isActive: true,
          power: 2000,
          hasPendingCommand: false,
        },
        desired: {
          power: 2000,
          reason: "wants to run",
        },
      },
    });
    const allocation = allocatePower([load], 3000, new Map(), debug);

    expect(allocation.get("test-load")).toBe(2000); // Stays at full power
  });
});

describe("allocatePower - Multiple Loads with Priority", () => {
  const debug = createMockDebug();

  it("should allocate power to high priority load first", () => {
    const highPriority = createLoadState({
      id: "high",
      priority: { score: 80 },
      control: {
        type: "modulated",
        minPower: 1000,
        maxPower: 2000,
        stepSize: 100,
      },
    });

    const lowPriority = createLoadState({
      id: "low",
      priority: { score: 30 },
      control: {
        type: "modulated",
        minPower: 1000,
        maxPower: 2000,
        stepSize: 100,
      },
    });

    const allocation = allocatePower(
      [lowPriority, highPriority],
      2500,
      new Map(),
      debug
    );

    // High priority gets 2000W, leaving 500W
    // Low priority needs min 1000W but only 500W available, gets 0
    expect(allocation.get("high")).toBe(2000);
    expect(allocation.get("low")).toBe(0);
  });

  it("should deallocate lower priority load when insufficient power", () => {
    const highPriority = createLoadState({
      id: "high",
      priority: { score: 80 },
      control: {
        type: "modulated",
        minPower: 1000,
        maxPower: 3000,
        stepSize: 100,
      },
      state: {
        current: {
          isActive: false,
          power: 0,
          source: "mqtt",
          confidence: "high",
        },
        expected: { isActive: false, power: 0, hasPendingCommand: false },
        desired: { power: 3000, reason: "needs full power" },
      },
    });

    const lowPriority = createLoadState({
      id: "low",
      priority: { score: 30 },
      control: {
        type: "binary",
        minPower: 2000,
        maxPower: 2000,
      },
      state: {
        current: {
          isActive: true,
          power: 2000,
          source: "entity",
          confidence: "high",
        },
        expected: { isActive: true, power: 2000, hasPendingCommand: false },
        desired: { power: 2000, reason: "running" },
      },
    });

    // With -1000W available (grid import):
    // High can't start (not active, needs positive power), gets 0
    // Low: canSustain = 2000 + (-1000) = 1000 < 2000 => gets 0
    const allocation = allocatePower(
      [lowPriority, highPriority],
      -1000,
      new Map(),
      debug
    );

    expect(allocation.get("high")).toBe(0);
    expect(allocation.get("low")).toBe(0);
  });

  it("should distribute power across multiple loads when sufficient", () => {
    const load1 = createLoadState({
      id: "load1",
      priority: { score: 70 },
      control: {
        type: "modulated",
        minPower: 1000,
        maxPower: 2000,
        stepSize: 100,
      },
    });

    const load2 = createLoadState({
      id: "load2",
      priority: { score: 50 },
      control: {
        type: "modulated",
        minPower: 1000,
        maxPower: 2000,
        stepSize: 100,
      },
    });

    const allocation = allocatePower([load1, load2], 4000, new Map(), debug);

    expect(allocation.get("load1")).toBe(2000); // Gets max
    expect(allocation.get("load2")).toBe(2000); // Gets remaining (also max)
  });

  it("should allocate 0 to ineligible loads", () => {
    const eligible = createLoadState({
      id: "eligible",
      eligibility: { eligible: true },
    });

    const ineligible = createLoadState({
      id: "ineligible",
      eligibility: { eligible: false, reason: "battery full" },
    });

    const allocation = allocatePower(
      [eligible, ineligible],
      5000,
      new Map(),
      debug
    );

    expect(allocation.get("eligible")).toBe(3000); // Gets power
    expect(allocation.get("ineligible")).toBe(0); // Gets 0 due to ineligibility
  });
});

describe("allocatePower - Edge Cases", () => {
  const debug = createMockDebug();

  it("should handle zero available power", () => {
    const load = createLoadState({
      state: {
        current: {
          isActive: true,
          power: 2000,
          source: "ble",
          confidence: "high",
        },
        expected: { isActive: true, power: 2000, hasPendingCommand: false },
        desired: { power: 3000, reason: "wants more" },
      },
    });

    // Algorithm: targetPower = min(maxPower=3000, desired=3000, current+available=2000+0=2000)
    // targetPower = 2000W (same as current)
    const allocation = allocatePower([load], 0, new Map(), debug);

    expect(allocation.get("test-load")).toBe(2000);
  });

  it("should handle negative available power (grid import)", () => {
    const load = createLoadState({
      state: {
        current: {
          isActive: true,
          power: 2000,
          source: "ble",
          confidence: "high",
        },
        expected: { isActive: true, power: 2000, hasPendingCommand: false },
        desired: { power: 3000, reason: "wants more" },
      },
    });

    // Algorithm: targetPower = min(maxPower=3000, desired=3000, current+available=2000+(-500)=1500)
    // targetPower = 1500W, which is >= minPower (1000)
    const allocation = allocatePower([load], -500, new Map(), debug);

    expect(allocation.get("test-load")).toBe(1500);
  });

  it("should handle load with no step size (continuous modulation)", () => {
    const load = createLoadState({
      control: {
        type: "modulated",
        minPower: 1000,
        maxPower: 3000,
        // No stepSize specified
      },
    });

    const allocation = allocatePower([load], 1750, new Map(), debug);

    expect(allocation.get("test-load")).toBe(1750); // No rounding when no step size
  });

  it("should allocate 0 when no eligible loads", () => {
    const ineligible = createLoadState({
      eligibility: { eligible: false, reason: "not plugged in" },
    });

    const allocation = allocatePower([ineligible], 5000, new Map(), debug);

    expect(allocation.get("test-load")).toBe(0);
  });

  it("should return empty map when no loads provided", () => {
    const allocation = allocatePower([], 5000, new Map(), debug);

    expect(allocation.size).toBe(0);
  });
});
