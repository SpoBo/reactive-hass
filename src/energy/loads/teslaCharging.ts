import {
  BehaviorSubject,
  combineLatest,
  EMPTY,
  interval,
  merge,
  timer,
  Observable,
} from "rxjs";
import {
  map,
  distinctUntilChanged,
  switchMap,
  tap,
  startWith,
  catchError,
  retry,
  shareReplay,
  share,
  debounceTime,
} from "rxjs/operators";
import ms from "ms";
import { LoadFactory, ManagedLoad } from "../types";

/**
 * Configuration for energy management system
 */
const ENERGY_CONFIG = {
  /**
   * BLE poll interval
   */
  blePollInterval: "30s",

  /**
   * Minimum charging current in Amps
   * At 230V, this is approximately 1.2 kW
   */
  minAmps: 5,

  /**
   * Maximum charging current in Amps
   * At 230V, this is approximately 3.0 kW
   */
  maxAmps: 13,

  /**
   * Watts per amp (based on 210V system)
   */
  wattsPerAmp: 220,

  /**
   * Total usable battery capacity in kWh
   * Model 3 Standard Range Plus: 78.7 kWh usable
   */
  batteryCapacityKwh: 78.7,

  /**
   * Rolling average window for starting charging
   * Conservative 3-minute average to avoid starting on temporary spikes
   */
  startWindow: "3m" as const,

  /**
   * Rolling average window for adjusting charging amperage
   * Quick 30-second response for dynamic adjustment
   */
  adjustWindow: "30s" as const,

  /**
   * Rolling average window for stopping charging
   * Conservative 3-minute average to avoid stopping on temporary dips
   */
  stopWindow: "3m" as const,
} as const;

export const CHARGE_LOAD_ID = "tesla-charging";

/**
 * Tesla Ble + TeslaMate MQTT + Universal Mobile Charger charging
 *
 * Features:
 * - Modulated load (5-13A / 1150-2990W)
 * - BLE polling only when actively charging (lets car sleep otherwise)
 * - MQTT monitoring when not managing charge
 * - Optimistic state management for immediate response
 * - Priority based on battery level
 */
const teslaChargingLoad: LoadFactory = (
  { teslaBle, teslamateMqtt, notify },
  input$,
  { debug }
) => {
  // Allocated power target (set by load manager)
  const allocatedPower$ = input$.pipe(
    map((input) => input?.allocatedPower[CHARGE_LOAD_ID] ?? 0)
  );

  // Expected state (optimistic) - updated immediately on commands
  const expectedState$ = new BehaviorSubject({
    isActive: false,
    power: 0,
    hasPendingCommand: false,
  });

  // Track if we're actively managing charging (determines BLE vs MQTT mode)
  const isActivelyCharging = teslamateMqtt.chargingState$.pipe(
    map((s) => s === "Charging"),
    distinctUntilChanged(),
    tap((isCharging) => debug("isActivelyCharging", isCharging)),
    shareReplay(1)
  );

  // /**
  //  * Whenever this is not null, the load will request the power amount.
  //  */
  // const realtimePowerRequest$ = new BehaviorSubject<null | number>(null);

  const realtimePowerRequest$ = new BehaviorSubject<null | number>(null);

  // BLE polling - ONLY when we expect to be charging
  const bleState$ = isActivelyCharging.pipe(
    switchMap((isManaged) => {
      if (!isManaged) {
        debug("Not managing charge - skipping BLE, car can sleep");
        return EMPTY;
      }

      debug("Managing charge - BLE polling active");
      return combineLatest([
        interval(ms(ENERGY_CONFIG.blePollInterval)),
        realtimePowerRequest$,
      ]).pipe(
        startWith(0),
        tap(() => {
          debug("Realtime power request");
        }),
        switchMap(() =>
          teslaBle.getChargeState$().pipe(
            tap((state) => {
              debug("BLE update:", {
                state,
              });
            }),
            catchError((err) => {
              debug("BLE error:", err.message);
              return EMPTY;
            }),
            retry({
              count: 3,
              delay: (_error, retryCount) => {
                const delayMs = Math.min(1000 * Math.pow(2, retryCount), 10000);
                debug(
                  `Retrying BLE (attempt ${retryCount + 1}) in ${delayMs}ms`
                );
                return timer(delayMs);
              },
            })
          )
        ),
        map((bleData) => ({
          isActive: bleData.charging_state === "Charging",
          power: bleData.charger_power * 1000,
          confidence: "high" as const,
        }))
      );
    }),
    share()
  );

  // MQTT state - ONLY when NOT actively managing (for state transitions)
  const mqttState$ = isActivelyCharging.pipe(
    switchMap((isActivelyCharging) => {
      if (isActivelyCharging) {
        // When managing, ignore MQTT updates
        debug("Ignoring MQTT - using BLE");
        return EMPTY;
      }

      // TODO: When we stop charging we don't necessarily re-send this. And so the charging sync doesn't work.
      debug("Monitoring MQTT for state changes");

      return interval(ms(ENERGY_CONFIG.blePollInterval)).pipe(
        switchMap(() => {
          return combineLatest([
            teslamateMqtt.chargingState$,
            teslamateMqtt.chargerPower$,
          ]).pipe(
            map(([state, powerKw]) => ({
              isActive: state === "Charging",
              power: state === "Charging" ? powerKw * 1000 : 0,
              confidence: "medium" as const,
            }))
          );
        })
      );

      // }),
      // shareReplay(1)
    })
  );

  // Current state - merge BLE and MQTT (only one will be active at a time)
  const powerState$ = merge(bleState$, mqttState$).pipe(
    startWith({
      isActive: false,
      power: 0,
      confidence: "low" as const,
    }),
    distinctUntilChanged(
      (a, b) => a.isActive === b.isActive && a.power === b.power
    ),
    tap((state) => debug("Current state:", state)),
    shareReplay(1)
  ) as Observable<{
    isActive: boolean;
    power: number;
    confidence: "high" | "medium" | "low";
  }>;

  // Eligibility - all conditions must be met
  const eligibility$ = combineLatest([
    teslamateMqtt.batteryLevel$,
    teslamateMqtt.chargeLimitSoc$,
    teslamateMqtt.pluggedIn$,
  ]).pipe(
    map(([battery, limit, pluggedIn]) => {
      if (!pluggedIn) {
        return { eligible: false, reason: "not-plugged-in" };
      }
      if (battery >= limit) {
        return { eligible: false, reason: "battery-full" };
      }
      return { eligible: true };
    }),
    distinctUntilChanged(
      (a, b) => a.eligible === b.eligible && a.reason === b.reason
    ),
    tap((eligibility) => debug("Eligibility:", eligibility)),
    shareReplay(1)
  );

  // Priority - higher when battery is lower
  const priority$ = combineLatest([
    teslamateMqtt.batteryLevel$,
    teslamateMqtt.chargeLimitSoc$,
  ]).pipe(
    map(([battery, limit]) => {
      // TODO: rewire what this returns.
      const remainingPercent = limit - battery;
      const urgencyBoost = Math.min(30, remainingPercent * 0.6);

      return {
        score: 50 + urgencyBoost,
        breakdown: {
          base: 50,
          lowBatteryBoost: urgencyBoost,
        },
      };
    }),
    distinctUntilChanged((a, b) => a.score === b.score),
    tap((priority) =>
      debug("Priority:", priority.score, "breakdown:", priority.breakdown)
    ),
    shareReplay(1)
  );

  // Reconciliation - match actual state to allocated power
  const reconcile$ = combineLatest([
    allocatedPower$,
    powerState$,
    expectedState$,
  ]).pipe(
    // Debounce to avoid rapid changes
    debounceTime(1000),
    switchMap(([targetPower, current, expected]) => {
      // Use expected power if command pending, otherwise use current
      const actualPower = current.power;

      debug(`Reconcile: target=${targetPower}W, actual=${actualPower}W`);

      // return EMPTY;

      // Already at target, nothing to do
      if (targetPower === actualPower) {
        debug(
          `Already ${targetPower === 0 ? "stopped" : `at target power ${targetPower}W`}`
        );
        return EMPTY;
      } else {
        const targetActualPower = targetPower > 0 ? targetPower : 0;

        if (expected.power !== targetActualPower) {
          debug(
            `Expected power mismatch: expected=${expected.power}W, actual=${actualPower}W`
          );
          expectedState$.next({
            isActive: targetPower > 0,
            power: targetPower,
            hasPendingCommand: false,
          });
        }
      }

      // Need to stop
      if (targetPower === 0 && actualPower > 0) {
        debug(`Stopping charging (allocated 0W)`);

        realtimePowerRequest$.next(0);

        return teslaBle.stopCharging$().pipe(
          tap(() => {
            debug(`✓ Stopped`);
            realtimePowerRequest$.next(0);
          }),
          // switchMap(() => notify.single$(`🛑 Stopped charging (0W allocated)`)),
          catchError((err) => {
            debug(`✗ Stop failed:`, err.message);
            realtimePowerRequest$.next(0);
            return EMPTY;
          })
        );
      }

      // Need to start or adjust
      if (targetPower > 0) {
        const amps = Math.round(targetPower / ENERGY_CONFIG.wattsPerAmp);

        debug("target amps", amps);
        const isStarting = actualPower === 0;

        debug(
          `${isStarting ? "Starting" : "Adjusting"} to ${amps}A (${targetPower}W)`
        );

        realtimePowerRequest$.next(0);

        const action$ = isStarting
          ? teslaBle
              .setChargingAmps$(amps)
              .pipe(switchMap(() => teslaBle.startCharging$()))
          : teslaBle.setChargingAmps$(amps);

        return action$.pipe(
          tap(() => {
            debug(`✓ ${isStarting ? "Started" : "Adjusted"} to ${amps}A`);
            realtimePowerRequest$.next(targetPower);
          }),
          // switchMap(() => {
          //   const kw = (targetPower / 1000).toFixed(1);
          //   return notify.single$(
          //     `${isStarting ? "🔋 Started" : "⚡ Adjusted"} solar charging to ${kw}kW`
          //   );
          // }),
          catchError((err) => {
            debug(`✗ ${isStarting ? "Start" : "Adjust"} failed:`, err.message);
            realtimePowerRequest$.next(0);
            return notify.single$(
              `⚠️ Failed to ${isStarting ? "start" : "adjust"} charging: ${err.message}`
            );
          })
        );
      }

      return EMPTY;
    })
  );

  // Eligibility change notifications (temporary. should eventually be reported by the load manager)
  const eligibilityNotifications$ = combineLatest([
    teslamateMqtt.batteryLevel$,
    teslamateMqtt.chargeLimitSoc$,
    teslamateMqtt.pluggedIn$,
  ]).pipe(
    map(([battery, limit, pluggedIn]) => ({
      eligible: pluggedIn && battery < limit,
      battery,
      limit,
    })),
    distinctUntilChanged(
      (a, b) =>
        a.eligible === b.eligible &&
        a.battery === b.battery &&
        a.limit === b.limit
    ),
    switchMap(({ eligible, battery, limit }) => {
      const remainingPercent = limit - battery;
      const remainingKwh =
        (remainingPercent / 100) * ENERGY_CONFIG.batteryCapacityKwh;

      if (eligible) {
        return notify.single$(
          `🔌 Tesla eligible for solar charging - ${remainingKwh.toFixed(1)} kWh needed (${battery}% → ${limit}%)`
        );
      } else {
        return notify.single$(
          `⏸️ Tesla not eligible for charging (${battery}% / ${limit}%)`
        );
      }
    }),
    share()
  );

  // Combine side effects that need to run
  const run$ = merge(
    reconcile$
    // eligibilityNotifications$
  ).pipe(map(() => undefined));

  return {
    id: CHARGE_LOAD_ID,
    name: "Tesla Model 3 Charging",
    state$: combineLatest([eligibility$, priority$, expectedState$]).pipe(
      map(([eligibility, priority, expected]) => ({
        eligibility,
        priority,
        control: {
          levels: [1000, 2000, 2990],
        },
        expected,
      }))
    ),
    powerState$: powerState$.pipe(
      shareReplay(1),
      tap((state) => debug("!!! powerState", state))
    ),
    run$, // Expose for main automation to subscribe
  } satisfies ManagedLoad;
};

export default teslaChargingLoad;

function calculateAvailablePowerLevels(
  minAmps: number,
  maxAmps: number,
  wattsPerAmp: number
) {
  return Array.from(
    { length: maxAmps - minAmps + 1 },
    (_, i) => (minAmps + i) * wattsPerAmp
  );
}
