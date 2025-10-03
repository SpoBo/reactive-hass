import { Observable, combineLatest, merge } from "rxjs";
import {
  map,
  distinctUntilChanged,
  share,
  tap,
  switchMap,
} from "rxjs/operators";
import servicesCradle from "../services/cradle";
import DEBUG from "debug";
import { createLoadManager$ } from "./loadManager";
import { loadFactories } from "./loads/index";
import { calculateSolarOverhead } from "./helpers";
import { createRollingAverage$ } from "../helpers/createRollingAverage";
import { median } from "../helpers/math/aggregations";

const debug = DEBUG("r-h.energy");

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

  // Create managed loads from auto-discovered factories
  const loads = loadFactories.map((factory, index) => {
    const load = factory(cradle, { debug: debug.extend(`load-${index}`) });
    debug(`Initialized load: ${load.name} (${load.id})`);
    return load;
  });

  // Monitor total power usage from P1 meter
  const powerUsage$ = homeWizardP1.activePower$.pipe(
    distinctUntilChanged(),
    tap((power) => debug("Power usage (P1):", power, "W")),
    share()
  );

  // Calculate total expected load from all managed loads
  const totalManagedLoad$ = combineLatest(
    loads.map((load) => load.state$)
  ).pipe(
    map((states) =>
      states.reduce((sum, state) => {
        // Use expected power if command pending, otherwise use current
        const power = state.expected.hasPendingCommand
          ? state.expected.power
          : state.current.power;
        return sum + power;
      }, 0)
    ),
    tap((load) => debug("Total managed load:", load, "W")),
    distinctUntilChanged(),
    share()
  );

  // Calculate house base load (excluding managed loads)
  const houseBaseLoad$ = combineLatest([powerUsage$, totalManagedLoad$]).pipe(
    map(([totalPower, managedLoad]) => totalPower - managedLoad),
    tap((baseLoad) => debug("House base load:", baseLoad, "W")),
    share()
  );

  // Calculate solar overhead (negative house load = production)
  const solarOverhead$ = houseBaseLoad$.pipe(
    map((baseLoad) => calculateSolarOverhead(baseLoad)),
    tap((overhead) => debug("Solar overhead:", overhead, "W")),
    share()
  );

  // Apply rolling average for stable decision-making
  // Using median to be robust against spikes
  const availablePower$ = createRollingAverage$(
    solarOverhead$,
    "3m", // 3 minutes
    median
  ).pipe(
    tap((avg) => debug("Available power (3m median):", avg, "W")),
    share()
  );

  // Create load manager - allocates power and loads self-reconcile
  const manager$ = createLoadManager$({
    loads,
    availablePower$,
    debug: debug.extend("manager"),
  });

  // Gather side effects from loads (reconciliation, notifications, etc.)
  const loadSideEffects$ = loads
    .map((load: any) => load.sideEffects$)
    .filter((s$) => s$ !== undefined);

  // The manager sets allocated power on each load
  // Each load reconciles itself to match its allocation
  // Merge manager with all load side effects
  return merge(manager$, ...loadSideEffects$);
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
