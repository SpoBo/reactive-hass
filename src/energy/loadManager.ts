import { Observable, combineLatest, EMPTY } from "rxjs";
import { map, shareReplay, switchMap } from "rxjs/operators";
import { ManagedLoad, PowerAllocation, DebugFn } from "./types";
import { allocatePower, LoadAllocationInput } from "./allocatePower";

/**
 * Combined load metadata and state
 * @deprecated Use LoadAllocationInput from allocatePower.ts instead
 */
export type LoadRuntimeState = LoadAllocationInput;

/**
 * Configuration for load manager
 */
export interface LoadManagerConfig {
  loads: ManagedLoad[];
  availablePower$: Observable<number>; // Watts of solar overhead
  debug: DebugFn;
}

/**
 * Creates a load manager that monitors all loads and allocates power
 *
 * Sets allocated power on each load based on available power and priorities.
 * Loads are responsible for reconciling themselves to match their allocation.
 *
 * @param config - Load manager configuration
 * @returns Observable that sets power allocations (never completes)
 */
export function createLoadManager$(
  config: LoadManagerConfig
): Observable<void> {
  const { loads, availablePower$, debug } = config;

  // Track current allocation to avoid circular dependency with allocatedPower$
  const currentAllocation = new Map<string, PowerAllocation>(
    loads.map((load) => [load.id, 0])
  );

  // Gather all load states
  // NOTE: We do NOT subscribe to allocatedPower$ here to avoid circular dependency
  // The manager sets allocatedPower, it doesn't read it
  const allLoadStates$ = combineLatest(
    loads.map((load) =>
      combineLatest([
        load.control$,
        load.state$,
        load.eligibility$,
        load.priority$,
      ]).pipe(
        map(
          ([control, state, eligibility, priority]): LoadAllocationInput => ({
            id: load.id,
            name: load.name,
            control,
            state,
            eligibility,
            priority,
          })
        )
      )
    )
  ).pipe(shareReplay(1));

  // Decision stream - allocate power across loads and set allocations
  const allocations$ = combineLatest([allLoadStates$, availablePower$]).pipe(
    switchMap(([loadStates, availablePower]) => {
      // Calculate new allocation based on current allocation
      const allocation = allocatePower(
        loadStates,
        availablePower,
        currentAllocation,
        debug
      );

      debug("Power allocation:", Object.fromEntries(allocation));

      // Set allocated power on each load and update our tracking map
      loads.forEach((load) => {
        const power = allocation.get(load.id) ?? 0;
        currentAllocation.set(load.id, power);
        load.setAllocatedPower(power);
      });

      // Return empty - we've set the allocations as side effects
      return EMPTY;
    }),
    shareReplay(1)
  );

  return allocations$;
}
