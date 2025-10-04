import {
  BehaviorSubject,
  EMPTY,
  Observable,
  combineLatest,
  merge,
  of,
} from "rxjs";
import deepEqual from "fast-deep-equal";
import {
  map,
  distinctUntilChanged,
  share,
  tap,
  switchMap,
  startWith,
  scan,
  shareReplay,
} from "rxjs/operators";
import servicesCradle from "../services/cradle";
import DEBUG from "debug";
import { createLoadManager$ } from "./loadManager";
import { loadFactories } from "./loads/index";
import { calculateSolarOverhead } from "./helpers";
import { createRollingAverage$ } from "../helpers/createRollingAverage";
import { median, weightedMean } from "../helpers/math/aggregations";
import { InputState, LoadId, LoadState, ManagedLoad } from "./types";
import { exponentialWeights } from "src/helpers/math/weights";

const debug = DEBUG("r-h.energy");

const FAKE_SOLAR_OVERHEAD = 0;

/**
 * Energy system - Solar-powered load management
 *
 * Manages multiple loads (Tesla charging, etc.) to maximize use of excess solar power.
 * Dynamically allocates available solar overhead across loads by priority.
 * Loads self-reconcile to match their allocated power.
 *
 * Key features:
 * - Multi-load support with priority-based allocation
 * - Declarative state-based architecture (loads reconcile themselves)
 * - Optimistic state management for immediate response
 * - Rolling averages for stable decision-making
 * - Modulated (variable power) and binary (on/off) load support
 */
function createEnergySystem$(): Observable<unknown> {
  const cradle = servicesCradle;
  const { homeWizardP1 } = cradle;

  const powerAllocation$ = new BehaviorSubject<InputState | null>(null);

  const inputState$ = combineLatest([powerAllocation$, of(0)]).pipe(
    map(([allocation, availaleSolarPercentage]) => ({
      allocatedPower: allocation?.allocatedPower ?? {},
      availaleSolarPercentage,
    })),
    distinctUntilChanged((prev, curr) => deepEqual(prev, curr)),
    tap((allocation) => debug(`allocation update`, allocation)),
    shareReplay(1)
  );

  // Create managed loads from auto-discovered factories
  const loads = loadFactories.map((factory) => {
    const load = factory(cradle, inputState$, {
      debug: debug.extend(`load-${factory.name}`),
    });
    debug(`Initialized load: ${load.name} (${load.id})`);
    return load;
  });

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

  // Create load manager - allocates power and loads self-reconcile
  const manager$ = createLoadManager$({
    loads,
    availablePower$,
    debug: debug.extend("manager"),
  }).pipe(
    switchMap((allocation) => {
      powerAllocation$.next({
        allocatedPower: allocation,
        availaleSolarPercentage: 0,
      });
      return EMPTY;
    })
  );

  // Gather runs from loads (reconciliation, notifications, etc.)
  const loadRuns$ = loads.map((load: ManagedLoad) => load.run$);

  // The manager sets allocated power on each load
  // Each load reconciles itself to match its allocation
  // Merge manager with all load side effects
  return merge(manager$, ...loadRuns$);
}

// Create toggle switch for energy system
const { discoverySwitch } = servicesCradle;
const energySwitch = discoverySwitch.create("energy", true, {
  name: "Reactive Hass Energy System",
});

// Export observable that respects the toggle
export default energySwitch.state$.pipe(
  switchMap((state) => {
    debug("Energy system state change:", state.current);
    if (state.current) {
      console.log("starting energy system");
      return createEnergySystem$();
    }
    console.log("stopping energy system");
    return merge(); // Empty observable when disabled
  })
);
