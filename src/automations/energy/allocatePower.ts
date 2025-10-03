import {
  LoadControl,
  LoadState,
  EligibilityResult,
  PriorityResult,
  LoadCommand,
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
 * Pure function that determines which loads should start, adjust, or stop
 * based on available power and load priorities.
 *
 * Algorithm:
 * 1. Filter to eligible loads only
 * 2. Sort by priority (high to low)
 * 3. For each load in priority order:
 *    - Calculate how much power it can receive
 *    - Generate START/ADJUST/STOP commands as needed
 *    - Track remaining power for next load
 *
 * @param loads - Array of load states with metadata
 * @param availablePower - Available power in watts
 * @param debug - Debug function for logging
 * @returns Array of commands to execute
 */
export function allocatePower(
  loads: LoadAllocationInput[],
  availablePower: number,
  debug: DebugFn
): LoadCommand[] {
  // Filter to eligible loads
  const eligible = loads.filter((l) => l.eligibility.eligible);

  // Sort by priority (high to low)
  eligible.sort((a, b) => b.priority.score - a.priority.score);

  debug("Allocating power:", {
    availablePower,
    eligibleLoads: eligible.length,
  });

  let remainingPower = availablePower;
  const commands: LoadCommand[] = [];

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
      const targetPower = control.stepSize
        ? Math.floor(maxAllocatable / control.stepSize) * control.stepSize
        : maxAllocatable;

      if (!state.current.isActive && targetPower >= minRequired) {
        // Can start
        commands.push({
          loadId: load.id,
          action: "START",
          targetPower,
          reason: `sufficient-power (${targetPower}W available)`,
        });
        remainingPower -= targetPower;
        debug(`→ START ${load.id} at ${targetPower}W`);
      } else if (state.current.isActive && targetPower < minRequired) {
        // Must stop - not enough power
        commands.push({
          loadId: load.id,
          action: "STOP",
          targetPower: 0,
          reason: "insufficient-power",
        });
        remainingPower += currentPower; // Free up current consumption
        debug(`→ STOP ${load.id} (insufficient power)`);
      } else if (
        state.current.isActive &&
        Math.abs(targetPower - currentPower) >= (control.stepSize || 100)
      ) {
        // Should adjust
        const delta = targetPower - currentPower;
        commands.push({
          loadId: load.id,
          action: "ADJUST",
          targetPower,
          reason: delta > 0 ? "more-power-available" : "reduce-consumption",
        });
        // Adjust remaining power by the delta, not the target power
        remainingPower -= delta;
        debug(`→ ADJUST ${load.id} to ${targetPower}W (Δ${delta}W)`);
      } else if (state.current.isActive) {
        // Already optimal
        remainingPower -= currentPower;
        debug(`→ ${load.id} already optimal at ${currentPower}W`);
      }
    } else {
      // Binary load
      const wantsPower = desiredPower > 0;

      if (
        !state.current.isActive &&
        wantsPower &&
        remainingPower >= control.minPower
      ) {
        commands.push({
          loadId: load.id,
          action: "START",
          targetPower: control.minPower,
        });
        remainingPower -= control.minPower;
        debug(`→ START ${load.id}`);
      } else if (state.current.isActive) {
        // Check if we can sustain current power or need to stop
        const canSustain = currentPower + remainingPower >= control.minPower;

        if (!wantsPower) {
          // Load doesn't want power anymore
          commands.push({
            loadId: load.id,
            action: "STOP",
            targetPower: 0,
            reason: "satisfied",
          });
          remainingPower += currentPower;
          debug(`→ STOP ${load.id} (satisfied)`);
        } else if (!canSustain) {
          // Can't sustain - need to stop for higher priority
          commands.push({
            loadId: load.id,
            action: "STOP",
            targetPower: 0,
            reason: "insufficient-power",
          });
          remainingPower += currentPower;
          debug(`→ STOP ${load.id} (insufficient power)`);
        } else {
          // Staying on
          remainingPower -= currentPower;
          debug(`→ ${load.id} staying on`);
        }
      }
    }
  }

  debug("Allocation complete:", {
    remainingPower,
    commands: commands.length,
  });

  return commands;
}
