import { EMPTY, Observable, combineLatest, of } from "rxjs";
import {
  distinctUntilChanged,
  map,
  shareReplay,
  switchMap,
  tap,
} from "rxjs/operators";
import {
  ManagedLoad,
  PowerAllocation,
  DebugFn,
  LoadId,
  LoadPowerState,
  LoadState,
} from "./types";
import { allocatePower } from "./allocatePower";
import { isDeepStrictEqual } from "util";

/**
 * Configuration for load manager
 */
export interface LoadManagerConfig {
  loads: ManagedLoad[];
  availablePower$: Observable<number>; // Watts of power overhead
  debug: DebugFn;
}

type LoadManagerOutput<T extends LoadId[]> = Record<keyof T, PowerAllocation>;

/**
 * Creates a load manager that monitors all loads and allocates power
 *
 * Sets allocated power on each load based on available power and priorities.
 * Loads are responsible for reconciling themselves to match their allocation.
 *
 * @param config - Load manager configuration
 * @returns Observable that sets power allocations (never completes)
 */
export function createLoadManager$<T extends LoadId[]>({
  loads,
  availablePower$,
  debug,
}: LoadManagerConfig) {
  // Gather all load states.
  // Into a Map where the key is the load id.
  const allLoadStates$ = combineLatest(
    loads.map((load) => load.state$.pipe(map((state) => [load.id, state])))
  ).pipe(
    map((states) => Object.fromEntries(states) as Record<keyof T, LoadState>),
    distinctUntilChanged((prev, curr) => isDeepStrictEqual(prev, curr)),
    shareReplay(1)
  );

  const allLoadCurrentPower$ = combineLatest(
    loads.map((load) => load.powerState$.pipe(map((state) => [load.id, state])))
  ).pipe(
    map((states) => {
      console.log("1) load current power", states);
      return Object.fromEntries(states) as Record<keyof T, LoadPowerState>;
    }),
    tap((power) => {
      debug("2) load current power", Object.values(power));
    }),
    shareReplay(1)
  );

  // Decision stream - allocate power across loads and set allocations
  return combineLatest([
    allLoadStates$,
    allLoadCurrentPower$,
    availablePower$,
  ]).pipe(
    switchMap(([loadStates, loadCurrentPower, availablePower]) => {
      const stateValues = Object.values(loadStates);
      debug("reconciling", {
        loadStates: Object.values(loadStates).map((state) => state.expected),
        loadCurrentPower: Object.values(loadCurrentPower),
        availablePower,
      });

      // if (stateValues.some((state) => state.expected.hasPendingCommand)) {
      //   debug("pending commands, skipping new allocation");
      //   return EMPTY;
      // }

      if (
        Object.entries(loadStates).some(
          ([id, state]) =>
            state.expected.power !== loadCurrentPower[id as keyof T].power
        )
      ) {
        debug("power not in sync yet. skipping new allocation");
        return EMPTY;
      }

      // Calculate new allocation based on current allocation
      const allocation: LoadManagerOutput<T> = allocatePower<T>(
        loadStates,
        loadCurrentPower,
        availablePower,
        debug
      );

      debug("Power allocation:", allocation);

      // Return empty - we've set the allocations as side effects
      return of(allocation);
    }),
    shareReplay(1)
  );
}
