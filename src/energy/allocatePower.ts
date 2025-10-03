import {
  LoadControl,
  LoadState,
  EligibilityResult,
  PriorityResult,
  PowerAllocation,
  DebugFn,
} from "./types";

/**
 * Combined load metadata and state for power allocation
 */
export interface LoadAllocationInput {
  id: string;
  name: string;
  control: LoadControl;
  state: LoadState;
  eligibility: EligibilityResult;
  priority: PriorityResult;
}

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
  loads: LoadAllocationInput[],
  availablePower: number,
  currentAllocation: Map<string, PowerAllocation>,
  debug: DebugFn
): Map<string, PowerAllocation> {
  // Filter to eligible loads
  const eligible = loads.filter((l) => l.eligibility.eligible);

  // Sort by priority (high to low)
  eligible.sort((a, b) => b.priority.score - a.priority.score);

  debug("Allocating power:", {
    availablePower,
    eligibleLoads: eligible.length,
  });

  let remainingPower = availablePower;
  const allocation = new Map<string, PowerAllocation>();

  for (const load of eligible) {
    const { control, state } = load;

    // Use expected power for accounting (optimistic)
    const currentPower = state.expected.hasPendingCommand
      ? state.expected.power
      : state.current.power;

    // How much does this load WANT?
    const desiredPower = state.desired.power;

    debug(`Load ${load.id}:`, {
      current: currentPower,
      desired: desiredPower,
      available: remainingPower,
      priority: load.priority.score,
    });

    if (control.type === "modulated") {
      // Calculate how much we can give this load
      const maxAllocatable = Math.min(
        control.maxPower,
        desiredPower,
        currentPower + remainingPower // Can add remaining to current
      );

      const minRequired = control.minPower;

      // Round to step size
      let targetPower = control.stepSize
        ? Math.floor(maxAllocatable / control.stepSize) * control.stepSize
        : maxAllocatable;

      // If below minimum, allocate 0 (load should stop)
      if (targetPower < minRequired) {
        targetPower = 0;
      }

      allocation.set(load.id, targetPower);

      // Update remaining power
      const delta = targetPower - currentPower;
      remainingPower -= delta;

      debug(`→ Allocate ${targetPower}W to ${load.id} (Δ${delta}W)`);
    } else {
      // Binary load
      const wantsPower = desiredPower > 0;
      const canSustain = currentPower + remainingPower >= control.minPower;

      let targetPower = 0;

      if (wantsPower && canSustain) {
        // Allocate full power
        targetPower = control.minPower;
      }

      allocation.set(load.id, targetPower);

      // Update remaining power
      const delta = targetPower - currentPower;
      remainingPower -= delta;

      debug(`→ Allocate ${targetPower}W to ${load.id}`);
    }
  }

  // Explicitly set 0W for ineligible loads
  for (const load of loads) {
    if (!load.eligibility.eligible && !allocation.has(load.id)) {
      allocation.set(load.id, 0);
      debug(`→ Allocate 0W to ${load.id} (ineligible)`);
    }
  }

  debug("Allocation complete:", {
    remainingPower,
    allocatedLoads: allocation.size,
  });

  return allocation;
}
