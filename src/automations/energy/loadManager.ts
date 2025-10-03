import { Observable, combineLatest } from "rxjs";
import { map, tap, shareReplay, distinctUntilChanged } from "rxjs/operators";
import { ManagedLoad, LoadCommand, DebugFn } from "./types";
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
 * Creates a load manager that monitors all loads and makes decisions
 *
 * @param config - Load manager configuration
 * @returns Observable of commands to execute
 */
export function createLoadManager$(
  config: LoadManagerConfig
): Observable<LoadCommand[]> {
  const { loads, availablePower$, debug } = config;

  // Gather all load states
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

  // Decision stream - allocate power across loads
  const decisions$ = combineLatest([allLoadStates$, availablePower$]).pipe(
    map(([loadStates, availablePower]) =>
      allocatePower(loadStates, availablePower, debug)
    ),
    // Only emit when commands actually change
    distinctUntilChanged(
      (a, b) =>
        a.length === b.length &&
        a.every(
          (cmd, i) =>
            cmd.loadId === b[i].loadId &&
            cmd.action === b[i].action &&
            cmd.targetPower === b[i].targetPower
        )
    ),
    tap((commands) => debug("Commands:", commands)),
    shareReplay(1)
  );

  return decisions$;
}
