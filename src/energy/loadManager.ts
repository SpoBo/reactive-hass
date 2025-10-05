import { EMPTY, Observable, combineLatest, merge, of } from "rxjs";
import {
  distinctUntilChanged,
  map,
  share,
  shareReplay,
  switchMap,
  tap,
} from "rxjs/operators";
import {
  ManagedLoad,
  Power,
  DebugFn,
  LoadId,
  LoadPower,
  LoadState,
} from "./types";
import { allocatePower } from "./allocatePower";
import { isDeepStrictEqual } from "util";
import { IServicesCradle } from "src/services/cradle";
import { calculateSolarOverhead } from "./helpers";
import { createRollingAverage$ } from "src/helpers/createRollingAverage";
import { median } from "src/helpers/math/aggregations";

/**
 * Configuration for load manager
 */
export interface LoadManagerConfig {
  loads: ManagedLoad[];
  powerAllocation$: Observable<Record<LoadId, Power> | null>;
  debug: DebugFn;
}

type LoadManagerOutput = Record<LoadId, Power>;

const FAKE_SOLAR_OVERHEAD = 0;

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
  { homeWizardP1 }: IServicesCradle,
  { loads, powerAllocation$, debug }: LoadManagerConfig
) {
  // Monitor total power usage from P1 meter
  const powerUsage$ = homeWizardP1.activePower$.pipe(
    distinctUntilChanged(),
    share()
  );

  // Calculate house base load (excluding managed loads)
  const houseBaseLoad$ = powerUsage$;

  // Calculate power overhead (negative house load = production)
  const powerOverhead = houseBaseLoad$.pipe(
    map((baseLoad) => calculateSolarOverhead(baseLoad) + FAKE_SOLAR_OVERHEAD),
    share()
  );

  // Apply rolling average for stable decision-making
  // Using median to be robust against spikes
  const availablePower$ = createRollingAverage$(
    powerOverhead,
    "3m", // 3 minutes
    // weightedMean(exponentialWeights(20, 0.2))
    median
  ).pipe(
    tap((avg) => debug("Available power (3m weighted mean):", avg, "W")),
    share()
  );

  const inputState$ = powerAllocation$.pipe(
    switchMap((allocation) =>
      allocation
        ? of({
            allocatedPower: allocation,
            availaleSolarPercentage: 0,
          })
        : EMPTY
    )
  );

  // Gather runs from loads (reconciliation, notifications, etc.)
  const loadRuns$ = loads.map((load: ManagedLoad) => load.start(inputState$));

  // Gather all load states.
  // Into a Map where the key is the load id.
  const allLoadStates$ = combineLatest(
    loads.map((load) => load.state$.pipe(map((state) => [load.id, state])))
  ).pipe(
    map((states) => Object.fromEntries(states) as Record<LoadId, LoadState>),
    distinctUntilChanged((prev, curr) => isDeepStrictEqual(prev, curr)),
    shareReplay(1)
  );

  const loadsActualPower = combineLatest(
    loads.map((load) => load.power$.pipe(map((state) => [load.id, state])))
  ).pipe(
    map((states) => {
      return Object.fromEntries(states) as Record<LoadId, LoadPower>;
    }),
    shareReplay(1)
  );

  // Decision stream - allocate power across loads and set allocations
  const decision$ = combineLatest([
    allLoadStates$,
    loadsActualPower,
    availablePower$,
    powerAllocation$.pipe(
      distinctUntilChanged((a, b) => isDeepStrictEqual(a, b))
    ),
  ]).pipe(
    switchMap(
      ([loadStates, loadsActualPower, availablePower, powerAllocation]) => {
        debug("reconciling", {
          loadStates: Object.values(loadStates),
          loadCurrentPower: Object.values(loadsActualPower),
          availablePower,
          powerAllocation,
        });

        // As long as there is a load that is not in sync, we skip the allocation.
        const loadsNotInSync =
          powerAllocation &&
          Object.keys(loadStates).filter((id) => {
            return powerAllocation?.[id] !== loadsActualPower[id].power;
          });

        if (loadsNotInSync && loadsNotInSync.length > 0) {
          debug(
            "some loads are not in sync yet. skipping new allocation",
            loadsNotInSync
          );
          return EMPTY;
        }

        // Calculate new allocation based on current allocation
        const allocation: LoadManagerOutput = allocatePower(
          loadStates,
          loadsActualPower,
          availablePower,
          debug
        );

        debug("Power allocation:", allocation);

        // Return empty - we've set the allocations as side effects
        return of(allocation);
      }
    ),
    shareReplay(1)
  );

  return merge(
    decision$,
    // Merge in observables that never complete but need to stay active.
    combineLatest(loadRuns$).pipe(switchMap(() => EMPTY))
  );
}
