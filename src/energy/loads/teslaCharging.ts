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
  debounce,
} from "rxjs/operators";
import ms from "ms";
import { InputState, LoadFactory, LoadId, ManagedLoad } from "../types";

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

export const CHARGE_LOAD_ID = "tesla-charging" as LoadId;

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
  { teslaBle, teslamateMqtt },
  { debug }
) => {
  const input$ = new BehaviorSubject<Observable<InputState> | null>(null);

  // Allocated power target (set by load manager)
  const allocatedPower$ = input$.pipe(
    switchMap((input) => input ?? EMPTY),
    map((input) => input.allocatedPower[CHARGE_LOAD_ID] ?? 0)
  );

  // Expected state (optimistic) - updated immediately on commands
  const expectedState$ = new BehaviorSubject({
    isActive: false,
    power: 0,
    hasPendingCommand: false,
  });

  // Track if we're actively managing charging (determines BLE vs MQTT mode)
  const isActivelyCharging$ = teslamateMqtt.chargingState$.pipe(
    map((s) => s === "Charging"),
    distinctUntilChanged(),
    tap((isCharging) => debug("isActivelyCharging", isCharging)),
    shareReplay(1)
  );

  const realtimePowerRequest$ = new BehaviorSubject<null | number>(null);

  // BLE polling - ONLY when we expect to be charging
  const bleState$ = isActivelyCharging$.pipe(
    switchMap((isManaged) => {
      if (!isManaged) {
        debug("Not managing charge - skipping BLE, car can sleep");
        return EMPTY;
      }

      debug("Managing charge - BLE polling active");
      return combineLatest([
        interval(ms(ENERGY_CONFIG.blePollInterval)),
        realtimePowerRequest$.pipe(debounceTime(ms("5s"))),
      ]).pipe(
        startWith(0),
        switchMap(() =>
          teslaBle.getChargeState$().pipe(
            catchError((err) => {
              debug("BLE error:", err.message);
              return EMPTY;
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
  const mqttState$ = combineLatest([
    teslamateMqtt.chargingState$,
    teslamateMqtt.chargerPower$,
  ]).pipe(
    tap(() => {
      debug("MQTT state polling");
    }),
    startWith([]),
    map(([state, powerKw]) => ({
      isActive: state === "Charging",
      power: state === "Charging" ? powerKw * 1000 : 0,
      confidence: "medium" as const,
    }))
  );

  // Current state - merge BLE and MQTT (only one will be active at a time)
  const powerState$ = isActivelyCharging$.pipe(
    tap((isActivelyCharging) =>
      debug("isActivelyCharging", isActivelyCharging)
    ),
    switchMap((isActivelyCharging) => {
      if (isActivelyCharging) {
        debug("BLE state polling");
        return bleState$;
      }
      debug("MQTT state polling");
      return mqttState$;
    }),
    tap((state) => debug("Current state:", state)),
    distinctUntilChanged(
      (a, b) => a.isActive === b.isActive && a.power === b.power
    ),
    tap((state) => debug("Current state:", state))
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
      return { eligible: true, reason: "car-is-in-need-of-charging" };
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
          catchError((err) => {
            debug(`✗ ${isStarting ? "Start" : "Adjust"} failed:`, err.message);
            realtimePowerRequest$.next(0);

            // TODO: Maybe we need some sort of retry mechanism with a backoff?
            //       Of we need to emit the failure at least.
            return EMPTY;
          })
        );
      }

      return EMPTY;
    })
  );

  // Combine side effects that need to run
  const run$ = merge(reconcile$).pipe(switchMap(() => EMPTY));

  return {
    state$: combineLatest([eligibility$, priority$, expectedState$]).pipe(
      map(([eligibility, priority, expected]) => ({
        priority,
        control: {
          levels: eligibility.eligible ? [1000, 2000] : [],
          reasoning: eligibility.reason,
        },
        expected,
      }))
    ),
    power$: powerState$,
    id: CHARGE_LOAD_ID,
    // Start accepts the input$ from the main automation and runs the load.
    // It also reacts to the input$ values and makes sure the run effect reacts to it.
    start: (inputObservable$) => {
      input$.next(inputObservable$);

      return run$;
    }, // Expose for main automation to subscribe
  } satisfies ManagedLoad;
};

export default teslaChargingLoad;

export const config = {
  id: CHARGE_LOAD_ID,
  name: "Tesla Model 3 Charging",
} as const;
