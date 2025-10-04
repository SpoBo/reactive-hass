import {
  PowerAllocation,
  DebugFn,
  LoadId,
  LoadState,
  LoadPowerState,
} from "./types";

/**
 * Allocates available power across loads by priority
 *
 * Pure function that determines how much power each load should receive
 * based on available power and load priorities.
 *
 * Algorithm:
 * 1. Filter to eligible loads only
 * 2. Sort by priority (high to low)
 * 3. For each load in priority order:
 *    - Calculate how much power it can receive
 *    - Allocate power respecting min/max/step constraints
 *    - Track remaining power for next load
 *
 * @param loads - Array of load states with metadata
 * @param availablePower - Available power in watts
 * @param currentAllocation - Current power allocation per load
 * @param debug - Debug function for logging
 * @returns Map of load ID to allocated power (watts)
 */
export function allocatePower<T extends LoadId[]>(
  loads: Record<keyof T, LoadState>,
  loadCurrentPower: Record<keyof T, LoadPowerState>,
  availablePower: number,
  debug: DebugFn
): Record<keyof T, PowerAllocation> {
  // Filter to eligible loads
  const eligible = Object.entries(loads).filter(
    ([_, l]) => l.eligibility.eligible
  ) as [keyof T, LoadState][];

  // Sort by priority (high to low)
  eligible.sort((a, b) => b[1].priority.score - a[1].priority.score);

  debug("Allocating power:", {
    availablePower,
    eligibleLoads: eligible.length,
  });

  let remainingPower = availablePower;
  const allocations: Record<keyof T, PowerAllocation> = {} as Record<
    keyof T,
    PowerAllocation
  >;

  for (const [loadId, load] of eligible) {
    const { control, expected } = load;

    // How much does this load WANT?
    const availablePowerLevels = control.levels;

    debug(`Load ${loadId.toString()}:`, {
      levels: availablePowerLevels,
      available: remainingPower,
      priority: load.priority.score,
    });

    // Find the highest level supported.
    const levelsAllowed = availablePowerLevels
      .slice(0)
      .filter(
        (level) => level <= remainingPower + loadCurrentPower[loadId].power
      )
      .sort((a, b) => b - a);

    debug(`Levels allowed:`, levelsAllowed);
    debug(`Load current power:`, loadCurrentPower[loadId].power);
    debug(`Load remaining power:`, remainingPower);
    const maximumLevelForCurrentLoad = levelsAllowed[0];

    if (!maximumLevelForCurrentLoad) {
      debug(`→ Allocate 0W to ${loadId.toString()} (no available power)`);
      allocations[loadId] = 0;
    } else {
      debug(
        `→ Allocate ${maximumLevelForCurrentLoad}W to ${loadId.toString()}`
      );
      allocations[loadId] = maximumLevelForCurrentLoad;

      // Update remaining power
      remainingPower -= maximumLevelForCurrentLoad;
    }
  }

  // Explicitly set 0W for ineligible loads
  for (const [loadId, load] of eligible) {
    if (!load.eligibility.eligible && !allocations[loadId]) {
      allocations[loadId] = 0;
      debug(`→ Allocate 0W to ${loadId.toString()} (ineligible)`);
    }
  }

  debug("Allocation complete:", {
    remainingPower,
    allocatedLoads: Object.keys(allocations).length,
  });

  return allocations;
}
