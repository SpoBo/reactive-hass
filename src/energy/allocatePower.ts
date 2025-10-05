import { Power, DebugFn, LoadId, LoadState, LoadPower } from "./types";

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
export function allocatePower(
  loads: Record<LoadId, LoadState>,
  loadCurrentPower: Record<LoadId, LoadPower>,
  availablePower: number,
  debug: DebugFn
): Record<LoadId, Power> {
  // Sort by priority (high to low)
  const sorted = Object.entries(loads).sort(
    (a, b) => b[1].priority.score - a[1].priority.score
  ) as [LoadId, LoadState][];

  const [remainingPower, allocations] = sorted.reduce(
    ([remainingPower, allocations], [loadId, load]) => {
      if (remainingPower <= 0 || load.control.levels.length === 0) {
        debug(`No levels allowed for load ${loadId.toString()}`);
        allocations[loadId] = 0;
        return [remainingPower, allocations];
      }

      const allocatedPower = loadCurrentPower[loadId].power;
      debug(
        "allocaited power for load",
        loadId,
        allocatedPower,
        "remainingPower",
        remainingPower
      );

      const levelsAllowed = load.control.levels
        .slice(0)
        .filter((level) => level <= remainingPower + allocatedPower)
        .sort((a, b) => b - a);

      debug(`Levels allowed:`, levelsAllowed);

      allocations[loadId] = levelsAllowed[0] ?? 0;

      return [remainingPower - levelsAllowed[0], allocations];
    },
    [availablePower, {} as Record<LoadId, Power>]
  );

  debug("Allocation complete:", {
    remainingPower,
    allocatedLoads: Object.keys(allocations).length,
  });

  return allocations;
}
