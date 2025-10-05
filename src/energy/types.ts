import { Observable } from "rxjs";
import { IServicesCradle } from "../services/cradle";

export type LoadId = string;

/**
 * Control characteristics of a load.
 *
 * To be updated in real time and used when allocating power.
 */
interface LoadControl {
  levels: Power[]; // Watts
  /**
   * It can be used to explain why the levels are the way they are.
   * For example, we may only ask a high power level at times.
   * Or we may emit no power levels at all.
   */
  reasoning: string;
}

/**
 * Combined load metadata and state for power allocation
 */
export interface LoadAllocationInput {
  id: LoadId;
  name: string;
  control: LoadControl;
  state: LoadState;
  priority: PriorityResult;
}

export type LoadPower = {
  /**
   * The power of the load. In watts.
   * 0 means the load should be off/stopped.
   */
  power: Power;

  /**
   * The confidence in the power reading.
   */
  confidence: "high" | "medium" | "low";

  // TODO: add a timestamp?
};

/**
 * Complete state information for a load.
 * This is updated realtime.
 */
export interface LoadState {
  /**
   * The load will constantly emit how it can be controlled.
   * This is inside the LoadState because it could change dynamically in the future.
   *
   * When the load should not charge, it will return no levels.
   */
  control: LoadControl;

  /**
   * The load will emit what it feels is its own priority.
   * The manager will then spread the load according to this priority.
   */
  priority: PriorityResult;
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
export type Power = number;

/**
 * Debug function signature (from debug package)
 */
export type DebugFn = {
  (message?: any, ...optionalParams: any[]): void;
  extend: (namespace: string) => DebugFn;
};

/**
 * Interface that all managed loads must implement.
 *
 */
export interface ManagedLoad {
  id: LoadId;
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
  power$: Observable<LoadPower>;

  start(input$: Observable<InputState>): Observable<void>;
}

/**
 * This is used for the load to change its state dynamically.
 */
export interface InputState {
  /**
   * Allocated power to all the other loads. Since we can have rules in a load that determine to for example not run one airco if another one is running.
   */
  allocatedPower: Record<LoadId, Power>;

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
  options: {
    debug: DebugFn;
  }
) => ManagedLoad;
