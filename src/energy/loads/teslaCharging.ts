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
import { LoadFactory, PowerAllocation } from "../types";

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
   * Watts per amp (based on 230V single-phase)
   */
  wattsPerAmp: 230,

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
  { debug }
) => {
  // Allocated power target (set by load manager)
  const allocatedPower$ = new BehaviorSubject<PowerAllocation>(0);

  // Expected state (optimistic) - updated immediately on commands
  const expectedState$ = new BehaviorSubject({
    isActive: false,
    power: 0,
    hasPendingCommand: false,
  });

  // Track if we're actively managing charging (determines BLE vs MQTT mode)
  const isActivelyCharging = expectedState$.pipe(
    map((s) => s.isActive),
    distinctUntilChanged(),
    tap((isCharging) =>
      debug(
        `Managed charging: ${isCharging} - ${isCharging ? "BLE only" : "MQTT monitoring"}`
      )
    ),
    shareReplay(1)
  );

  // BLE polling - ONLY when we expect to be charging
  const bleState$ = isActivelyCharging.pipe(
    switchMap((isManaged) => {
      if (!isManaged) {
        debug("Not managing charge - skipping BLE, car can sleep");
        return EMPTY;
      }

      debug("Managing charge - BLE polling active");
      return interval(ms(ENERGY_CONFIG.blePollInterval)).pipe(
        startWith(0),
        switchMap(() =>
          teslaBle.getChargeState$().pipe(
            tap((state) => {
              debug("BLE update:", {
                charging_state: state.charging_state,
                charger_power: state.charger_power,
                charger_amps: state.charger_actual_current,
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
          source: "ble" as const,
          confidence: "high" as const,
        }))
      );
    }),
    share()
  );

  // MQTT state - ONLY when NOT actively managing (for state transitions)
  const mqttState$ = isActivelyCharging.pipe(
    switchMap((isManaged) => {
      if (isManaged) {
        // When managing, ignore MQTT updates
        debug("Ignoring MQTT - using BLE");
        return EMPTY;
      }

      debug("Monitoring MQTT for state changes");
      return combineLatest([
        teslamateMqtt.chargingState$,
        teslamateMqtt.chargerPower$,
      ]).pipe(
        map(([state, powerKw]) => ({
          isActive: state === "Charging",
          power: state === "Charging" ? powerKw * 1000 : 0,
          source: "mqtt" as const,
          confidence: "medium" as const,
        }))
      );
    }),
    share()
  );

  // Current state - merge BLE and MQTT (only one will be active at a time)
  const currentState$ = merge(bleState$, mqttState$).pipe(
    startWith({
      isActive: false,
      power: 0,
      source: "mqtt" as const,
      confidence: "low" as const,
    }),
    distinctUntilChanged(
      (a, b) =>
        a.isActive === b.isActive &&
        a.power === b.power &&
        a.source === b.source
    ),
    tap((state) => debug("Current state:", state)),
    shareReplay(1)
  ) as Observable<{
    isActive: boolean;
    power: number;
    source: "ble" | "mqtt" | "entity" | "fixed";
    confidence: "high" | "medium" | "low";
  }>;

  // Desired power - what does the load WANT?
  const desiredPower$ = combineLatest([
    teslamateMqtt.batteryLevel$,
    teslamateMqtt.chargeLimitSoc$,
  ]).pipe(
    map(([battery, limit]) => {
      const remainingPercent = limit - battery;

      if (remainingPercent <= 0) {
        return { power: 0, reason: "battery-full" };
      }

      // Want max power - let decision engine decide how much we actually get
      return {
        power: ENERGY_CONFIG.maxAmps * ENERGY_CONFIG.wattsPerAmp,
        reason: `${remainingPercent}% remaining to charge`,
      };
    }),
    distinctUntilChanged((a, b) => a.power === b.power),
    shareReplay(1)
  );

  // Eligibility change notifications
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

  // Combined state
  const state$ = combineLatest([
    currentState$,
    expectedState$,
    desiredPower$,
  ]).pipe(
    map(([current, expected, desired]) => ({
      current,
      expected,
      desired,
    })),
    tap((state) =>
      debug("Full state:", {
        current: `${state.current.power}W (${state.current.source})`,
        expected: `${state.expected.power}W (pending: ${state.expected.hasPendingCommand})`,
        desired: `${state.desired.power}W (${state.desired.reason})`,
      })
    ),
    shareReplay(1)
  );

  // Control characteristics
  const control$ = new BehaviorSubject({
    type: "modulated" as const,
    minPower: ENERGY_CONFIG.minAmps * ENERGY_CONFIG.wattsPerAmp,
    maxPower: ENERGY_CONFIG.maxAmps * ENERGY_CONFIG.wattsPerAmp,
    stepSize: ENERGY_CONFIG.wattsPerAmp,
  });

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
    currentState$,
    expectedState$,
  ]).pipe(
    // Debounce to avoid rapid changes
    debounceTime(1000),
    switchMap(([targetPower, current, expected]) => {
      // Use expected power if command pending, otherwise use current
      const actualPower = expected.hasPendingCommand
        ? expected.power
        : current.power;

      debug(`Reconcile: target=${targetPower}W, actual=${actualPower}W`);

      // Already at target, nothing to do
      if (targetPower === actualPower) {
        debug(`Already at target power`);
        return EMPTY;
      }

      // Need to stop
      if (targetPower === 0 && actualPower > 0) {
        debug(`Stopping charging (allocated 0W)`);

        expectedState$.next({
          isActive: false,
          power: 0,
          hasPendingCommand: true,
        });

        return teslaBle.stopCharging$().pipe(
          tap(() => {
            debug(`✓ Stopped`);
            expectedState$.next({
              isActive: false,
              power: 0,
              hasPendingCommand: false,
            });
          }),
          switchMap(() => notify.single$(`🛑 Stopped charging (0W allocated)`)),
          catchError((err) => {
            debug(`✗ Stop failed:`, err.message);
            expectedState$.next({
              isActive: false,
              power: 0,
              hasPendingCommand: false,
            });
            return EMPTY;
          })
        );
      }

      // Need to start or adjust
      if (targetPower > 0) {
        const amps = Math.round(targetPower / ENERGY_CONFIG.wattsPerAmp);
        const isStarting = actualPower === 0;

        debug(
          `${isStarting ? "Starting" : "Adjusting"} to ${amps}A (${targetPower}W)`
        );

        expectedState$.next({
          isActive: true,
          power: targetPower,
          hasPendingCommand: true,
        });

        const action$ = isStarting
          ? teslaBle
              .setChargingAmps$(amps)
              .pipe(switchMap(() => teslaBle.startCharging$()))
          : teslaBle.setChargingAmps$(amps);

        return action$.pipe(
          tap(() => {
            debug(`✓ ${isStarting ? "Started" : "Adjusted"} to ${amps}A`);
            expectedState$.next({
              isActive: true,
              power: targetPower,
              hasPendingCommand: false,
            });
          }),
          switchMap(() => {
            const kw = (targetPower / 1000).toFixed(1);
            return notify.single$(
              `${isStarting ? "🔋 Started" : "⚡ Adjusted"} solar charging to ${kw}kW`
            );
          }),
          catchError((err) => {
            debug(`✗ ${isStarting ? "Start" : "Adjust"} failed:`, err.message);
            expectedState$.next({
              isActive: false,
              power: 0,
              hasPendingCommand: false,
            });
            return notify.single$(
              `⚠️ Failed to ${isStarting ? "start" : "adjust"} charging: ${err.message}`
            );
          })
        );
      }

      return EMPTY;
    })
  );

  // Combine side effects that need to run
  const sideEffects$ = merge(reconcile$, eligibilityNotifications$);

  return {
    id: "tesla-charging",
    name: "Tesla Model 3 Charging",
    control$,
    state$,
    eligibility$,
    priority$,
    allocatedPower$,
    setAllocatedPower: (power: PowerAllocation) => {
      debug(`setAllocatedPower: ${power}W`);
      allocatedPower$.next(power);
    },
    sideEffects$, // Expose for main automation to subscribe
  };
};

export default teslaChargingLoad;
