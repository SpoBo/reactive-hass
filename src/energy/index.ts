import { BehaviorSubject, EMPTY, Observable } from "rxjs";
import { switchMap } from "rxjs/operators";
import servicesCradle from "../services/cradle";
import DEBUG from "debug";
import { createLoadManager$ } from "./loadManager";
import { getLoadFactories } from "./loads/index";
import { LoadId, Power } from "./types";

const debug = DEBUG("r-h.energy");

/**
 * Reactive Hass Energy System
 *
 * Responsible for creating the loads and sending them off to the load manager.
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

  const powerAllocation$ = new BehaviorSubject<Record<LoadId, Power> | null>(
    null
  );

  // Create managed loads from auto-discovered factories
  const loads = getLoadFactories().map(({ factory, id, name }) => {
    debug(`Initializing load: ${name} (${id.toString()})`);
    return factory(cradle, {
      debug: debug.extend(`load-${id.toString()}`),
    });
  });

  // Create load manager - allocates power and loads self-reconcile
  const manager$ = createLoadManager$(cradle, {
    loads,
    powerAllocation$,
    debug: debug.extend("manager"),
  }).pipe(
    switchMap((allocation) => {
      // TODO: Is this the right way to do this in RxJS?
      //       Feels a bit hacky.
      powerAllocation$.next(allocation);

      return EMPTY;
    })
  );

  // The manager sets allocated power on each load
  // Each load reconciles itself to match its allocation
  // Merge manager with all load side effects
  return manager$;
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

    return EMPTY; // Empty observable when disabled
  })
);
