import { Observable } from "rxjs";
import { IServicesCradle } from "../services/cradle";

export type LoadId = string;

/**
 * Control characteristics of a load
 *
 * TODO: We could use a discriminated union here to make the type more precise.
 * TODO: We can also make it something dynamic that's returned as part of the state updates. So it would indicate what the available options are.
 *       And then it can be more dynamic?
 */
interface LoadControl {
  levels: number[]; // Watts
}

/**
 * Combined load metadata and state for power allocation
 */
export interface LoadAllocationInput {
  id: LoadId;
  name: string;
  control: LoadControl;
  state: LoadState;
  eligibility: EligibilityResult;
  priority: PriorityResult;
}

export type LoadPowerState = {
  isActive: boolean;
  power: number; // Watts
  confidence: "high" | "medium" | "low";
};

/**
 * Complete state information for a load.
 * This is updated realtime.
 */
export interface LoadState {
  // Expected power after pending commands execute (optimistic)
  expected: {
    isActive: boolean;
    power: number; // Watts
    hasPendingCommand: boolean;
  };

  /**
   * The load will constantly emit how it can be controlled.
   * This is inside the LoadState because it could change dynamically in the future.
   */
  control: LoadControl;

  /**
   * The load will emit what it feels is its own eligibility.
   * It could be baked into the priority but having it separate makes it easier to debug.
   */
  eligibility: EligibilityResult;

  /**
   * The load will emit what it feels is its own priority.
   * The manager will then spread the load according to this priority.
   */
  priority: PriorityResult;
}

/**
 * Result of eligibility check (hard constraints)
 */
interface EligibilityResult {
  eligible: boolean;
  reason?: string;
}

/**
 * Result of priority calculation (soft scoring)
 */
interface PriorityResult {
  score: number;
  breakdown?: Record<string, number>; // For debugging
}

/**
 * Power allocation for a load (in watts)
 * 0 means the load should be off/stopped
 */
export type PowerAllocation = number;

/**
 * Debug function signature (from debug package)
 */
export type DebugFn = {
  (message?: any, ...optionalParams: any[]): void;
  extend: (namespace: string) => DebugFn;
};

/**
 * Options passed to load factory functions
 */
export interface LoadOptions {
  debug: DebugFn;
}

/**
 * Interface that all managed loads must implement.
 *
 */
export interface ManagedLoad {
  id: LoadId;
  name: string;

  /**
   * The load will constantly emit its state.
   * And based on that the manager will allocate power to the load.
   *
   * This is not expected to update this often. Only when the load makes a change to itself.
   */
  state$: Observable<LoadState>;

  /**
   * The load will constantly emit its current state.
   * This is used for the load to determine if it should run or not.
   */
  powerState$: Observable<LoadPowerState>;

  // Method to run the load.
  run$: Observable<void>;
}

/**
 * This is used for the load to change its state dynamically.
 */
export interface InputState {
  /**
   * Allocated power to all the other loads. Since we can have rules in a load that determine to for example not run one airco if another one is running.
   */
  allocatedPower: Record<LoadId, PowerAllocation>;

  /**
   * How much of the power currently on target is coming from solar.
   * Can be used by the rules engine to determine if the load wants to increase its priority or not.
   */
  availaleSolarPercentage: number;
}

/**
 * Factory function signature for creating loads
 */
export type LoadFactory = (
  cradle: IServicesCradle,
  input$: Observable<InputState | null>,
  options: LoadOptions
) => ManagedLoad;
