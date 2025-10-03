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
} from "rxjs/operators";
import ms from "ms";
import { LoadFactory, LoadCommand } from "../types";

const WATTS_PER_AMP = 230;
const MIN_AMPS = 5;
const MAX_AMPS = 13;
const REALTIME_POLL_INTERVAL = "30s";

/**
 * Tesla Model 3 charging load
 *
 * Features:
 * - Modulated load (5-13A / 1150-2990W)
 * - BLE polling only when actively charging (lets car sleep otherwise)
 * - MQTT monitoring when not managing charge
 * - Optimistic state management for immediate response
 * - Priority based on battery level
 */
export const teslaChargingLoad: LoadFactory = (cradle, { debug }) => {
  const { teslaBle, teslamateMqtt, notify } = cradle;

  // Expected state (optimistic) - updated immediately on commands
  const expectedState$ = new BehaviorSubject({
    isActive: false,
    power: 0,
    hasPendingCommand: false,
  });

  // Track if we're actively managing charging (determines BLE vs MQTT mode)
  const isManagedCharging$ = expectedState$.pipe(
    map((s) => s.isActive),
    distinctUntilChanged(),
    tap((isManaged) =>
      debug(
        `Managed charging: ${isManaged} - ${isManaged ? "BLE only" : "MQTT monitoring"}`
      )
    ),
    shareReplay(1)
  );

  // BLE polling - ONLY when we expect to be charging
  const bleState$ = isManagedCharging$.pipe(
    switchMap((isManaged) => {
      if (!isManaged) {
        debug("Not managing charge - skipping BLE, car can sleep");
        return EMPTY;
      }

      debug("Managing charge - BLE polling active");
      return interval(ms(REALTIME_POLL_INTERVAL)).pipe(
        startWith(0),
        switchMap(() =>
          teslaBle.getChargeState$().pipe(
            tap((state) =>
              debug("BLE update:", {
                charging_state: state.charging_state,
                charger_power: state.charger_power,
                charger_amps: state.charger_actual_current,
              })
            ),
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
  const mqttState$ = isManagedCharging$.pipe(
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
        power: MAX_AMPS * WATTS_PER_AMP,
        reason: `${remainingPercent}% remaining to charge`,
      };
    }),
    distinctUntilChanged((a, b) => a.power === b.power),
    shareReplay(1)
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
    minPower: MIN_AMPS * WATTS_PER_AMP,
    maxPower: MAX_AMPS * WATTS_PER_AMP,
    stepSize: WATTS_PER_AMP,
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

  // Command execution
  const executeCommand$ = (command: LoadCommand) => {
    debug(`Executing command:`, command);

    switch (command.action) {
      case "START": {
        const amps = Math.round(command.targetPower / WATTS_PER_AMP);

        // Set expected state IMMEDIATELY
        expectedState$.next({
          isActive: true,
          power: command.targetPower,
          hasPendingCommand: true,
        });

        return teslaBle.setChargingAmps$(amps).pipe(
          switchMap(() => teslaBle.startCharging$()),
          tap(() => {
            debug(`✓ Started at ${amps}A (${command.targetPower}W)`);
            const current = expectedState$.value;
            expectedState$.next({ ...current, hasPendingCommand: false });
          }),
          map(() => undefined),
          catchError((err) => {
            debug(`✗ Start failed:`, err.message);
            expectedState$.next({
              isActive: false,
              power: 0,
              hasPendingCommand: false,
            });
            return EMPTY;
          })
        );
      }

      case "ADJUST": {
        const amps = Math.round(command.targetPower / WATTS_PER_AMP);

        expectedState$.next({
          isActive: true,
          power: command.targetPower,
          hasPendingCommand: true,
        });

        return teslaBle.setChargingAmps$(amps).pipe(
          tap(() => {
            debug(`✓ Adjusted to ${amps}A (${command.targetPower}W)`);
            const current = expectedState$.value;
            expectedState$.next({ ...current, hasPendingCommand: false });
          }),
          map(() => undefined),
          catchError((err) => {
            debug(`✗ Adjust failed:`, err.message);
            const current = expectedState$.value;
            expectedState$.next({ ...current, hasPendingCommand: false });
            return EMPTY;
          })
        );
      }

      case "STOP": {
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
          map(() => undefined),
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
    }
  };

  // Eligibility change notifications for Tesla
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
      const remainingKwh = (remainingPercent / 100) * 78.7; // Battery capacity

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
    switchMap(() => EMPTY)
  );

  return {
    id: "tesla-charging",
    name: "Tesla Model 3 Charging",
    control$,
    state$: merge(state$, eligibilityNotifications$),
    eligibility$,
    priority$,
    executeCommand$,
  };
};
