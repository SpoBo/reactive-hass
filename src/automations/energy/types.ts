import { Observable } from "rxjs";
import { IServicesCradle } from "../../services/cradle";

/**
 * Type of load control mechanism
 */
export type LoadType = "binary" | "modulated";

/**
 * Control characteristics of a load
 */
export interface LoadControl {
  type: LoadType;
  minPower: number; // Watts
  maxPower: number; // Watts
  stepSize?: number; // For modulated loads (e.g., 230W per amp)
}

/**
 * Complete state information for a load
 */
export interface LoadState {
  // Current actual power consumption (from sensors)
  current: {
    isActive: boolean;
    power: number; // Watts
    source: "ble" | "mqtt" | "entity" | "fixed";
    confidence: "high" | "medium" | "low";
  };

  // Expected power after pending commands execute (optimistic)
  expected: {
    isActive: boolean;
    power: number; // Watts
    hasPendingCommand: boolean;
  };

  // Desired power from load's perspective (what it WANTS)
  desired: {
    power: number; // Watts (0 if satisfied, higher if wants more)
    reason?: string; // Why it wants this amount
  };
}

/**
 * Result of eligibility check (hard constraints)
 */
export interface EligibilityResult {
  eligible: boolean;
  reason?: string;
}

/**
 * Result of priority calculation (soft scoring)
 */
export interface PriorityResult {
  score: number;
  breakdown?: Record<string, number>; // For debugging
}

/**
 * Command to execute on a load
 */
export interface LoadCommand {
  loadId: string;
  action: "START" | "ADJUST" | "STOP";
  targetPower: number; // Watts
  reason?: string;
}

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
 * Interface that all managed loads must implement
 */
export interface ManagedLoad {
  id: string;
  name: string;

  // Observable streams
  control$: Observable<LoadControl>;
  state$: Observable<LoadState>;
  eligibility$: Observable<EligibilityResult>;
  priority$: Observable<PriorityResult>;

  // Command execution
  executeCommand$(command: LoadCommand): Observable<void>;
}

/**
 * Factory function signature for creating loads
 */
export type LoadFactory = (
  cradle: IServicesCradle,
  options: LoadOptions
) => ManagedLoad;
