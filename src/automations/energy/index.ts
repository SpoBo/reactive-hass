import { Observable, merge, combineLatest } from "rxjs";
import {
  map,
  distinctUntilChanged,
  share,
  switchMap,
  tap,
  catchError,
} from "rxjs/operators";
import { IServicesCradle } from "../../services/cradle";
import { AutomationOptions } from "../index";
import { createLoadManager$ } from "./loadManager";
import { teslaChargingLoad } from "./loads/teslaCharging";
import { calculateSolarOverhead } from "../charging/helpers";
import { createRollingAverage$ } from "../../helpers/createRollingAverage";
import { CHARGING_CONFIG } from "../charging/config";
import { median } from "../../helpers/math/aggregations";
import { EMPTY } from "rxjs";

/**
 * Energy automation - Solar-powered load management system
 *
 * Manages multiple loads (Tesla charging, etc.) to maximize use of excess solar power.
 * Dynamically allocates available solar overhead across loads by priority.
 *
 * Key features:
 * - Multi-load support with priority-based allocation
 * - Optimistic state management for immediate response
 * - Rolling averages for stable decision-making
 * - Modulated (variable power) and binary (on/off) load support
 */
export default function (
  cradle: IServicesCradle,
  { debug }: AutomationOptions
): Observable<unknown> {
  const { homeWizardP1, notify } = cradle;

  // Create managed loads
  const loads = [
    teslaChargingLoad(cradle, { debug: debug.extend("tesla") }),
    // Future loads can be added here
  ];

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
    CHARGING_CONFIG.startWindow, // 3 minutes
    median
  ).pipe(
    tap((avg) => debug("Available power (3m median):", avg, "W")),
    share()
  );

  // Create load manager - generates commands based on available power
  const commands$ = createLoadManager$({
    loads,
    availablePower$,
    debug: debug.extend("manager"),
  });

  // Execute commands and send notifications
  const run$ = commands$.pipe(
    switchMap((commands) => {
      if (commands.length === 0) {
        return EMPTY;
      }

      // Execute all commands in parallel
      const executions = commands.map((command) => {
        const load = loads.find((l) => l.id === command.loadId);
        if (!load) {
          debug(`Warning: Load ${command.loadId} not found`);
          return EMPTY;
        }

        debug(
          `Executing ${command.action} on ${command.loadId} (${command.targetPower}W)`
        );

        return load.executeCommand$(command).pipe(
          // Send notification on success
          switchMap(() => {
            const kw = (command.targetPower / 1000).toFixed(1);

            switch (command.action) {
              case "START":
                return notify.single$(`🔋 Started solar charging at (${kw}kW)`);
              case "ADJUST":
                return notify.single$(`⚡ Adjusted charging to (${kw}kW)`);
              case "STOP": {
                const reason =
                  command.reason === "insufficient-solar"
                    ? "insufficient solar power"
                    : command.reason === "not-eligible"
                      ? "charging complete"
                      : command.reason || "unknown reason";
                return notify.single$(`🛑 Stopped charging due to ${reason}`);
              }
              default:
                return EMPTY;
            }
          }),
          catchError((err) => {
            debug(`Command execution error:`, err.message);
            return notify.single$(
              `⚠️ Failed to ${command.action.toLowerCase()} charging: ${err.message}`
            );
          })
        );
      });

      return merge(...executions);
    })
  );

  return run$;
}
