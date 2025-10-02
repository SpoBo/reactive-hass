import { combineLatest, EMPTY, Observable, timer, interval, merge, BehaviorSubject } from "rxjs";
import {
  map,
  distinctUntilChanged,
  switchMap,
  share,
  tap,
  startWith,
  catchError,
  retry,
  filter,
  withLatestFrom,
  take,
  scan,
} from "rxjs/operators";
import { AutomationOptions } from "./index";
import { IServicesCradle } from "../services/cradle";
import ms from "ms";
import { createRollingAverage$ } from "../helpers/createRollingAverage";
import { CHARGING_CONFIG } from "./charging/config";
import {
  calculateHouseBaseLoad,
  calculateSolarOverhead,
  canStartCharging,
  shouldStopCharging,
  shouldAdjustAmps,
  calculateOptimalAmps,
} from "./charging/helpers";

const REALTIME_POLL_INTERVAL = "30s";

/**
 * Constantly monitor how much energy we are using and potentially start / stop certain services.
 * Like charge the car etc.
 *
 * The idea is that we will have a priority mechanism based on some configuration.
 */
export default function (
  { states, notify, teslaBle, teslamateMqtt, homeWizardP1 }: IServicesCradle,
  { debug }: AutomationOptions
): Observable<unknown> {
  // Monitor how much power we are using directly from HomeWizard P1 meter
  const powerUsage$ = homeWizardP1.activePower$.pipe(
    tap((v) => debug("powerUsage:", v, "W")),
    distinctUntilChanged(),
    share()
  );

  // Tesla MQTT observables - event triggers
  const teslaIsEligibleToCharge$ = teslamateMqtt.isEligibleToCharge$.pipe(
    distinctUntilChanged(),
    tap((v) => debug("Tesla eligibility changed:", v)),
    share()
  );

  const teslaChargingState$ = teslamateMqtt.chargingState$.pipe(
    distinctUntilChanged(),
    tap((v) => debug("Tesla charging state changed:", v)),
    share()
  );

  const teslaChargerPower$ = teslamateMqtt.chargerPower$.pipe(
    tap((v) => debug("Tesla charger power (MQTT):", v, "kW")),
    share()
  );

  // Track expected charging state based on commands sent
  // This allows us to optimistically calculate power before MQTT/BLE updates
  type ExpectedChargeState = {
    isCharging: boolean;
    expectedAmps: number;
    expectedPowerKw: number;
  };

  const expectedChargeState$ = new BehaviorSubject<ExpectedChargeState>({
    isCharging: false,
    expectedAmps: 0,
    expectedPowerKw: 0,
  });

  // Poll Tesla BLE charge state every 30 seconds - ONLY when actively charging
  // This allows the car to sleep when not charging
  // Uses optimistic state to determine if charging (responds immediately to commands)
  // Includes error handling and automatic retry with exponential backoff
  const teslaBleChargeState$ = expectedChargeState$.pipe(
    map((state) => state.isCharging),
    distinctUntilChanged(),
    tap((isCharging) => debug(`Expected charging state changed to: ${isCharging} - ${isCharging ? "starting" : "stopping"} BLE polling`)),
    switchMap((isCharging) => {
      // Only poll BLE when actively charging (based on optimistic state)
      if (!isCharging) {
        debug("Not charging - skipping BLE polling to allow car to sleep");
        return EMPTY;
      }

      debug("Actively charging - starting BLE polling");
      return interval(ms(REALTIME_POLL_INTERVAL)).pipe(
        startWith(0), // Start immediately when charging begins
        switchMap(() => {
          debug("polling Tesla charge state...");
          return teslaBle.getChargeState$().pipe(
            tap((state) => {
              debug("Tesla BLE charge state received:", {
                battery_level: state.battery_level,
                charge_limit: state.charge_limit_soc,
                charging_state: state.charging_state,
                charger_power: state.charger_power,
                charger_amps: state.charger_actual_current,
              });
            }),
            catchError((err) => {
              debug("Error fetching Tesla charge state:", err.message);
              return EMPTY;
            }),
            retry({
              count: 3,
              delay: (_error, retryCount) => {
                const delayMs = Math.min(1000 * Math.pow(2, retryCount), 10000);
                debug(
                  `Retrying Tesla API call (attempt ${retryCount + 1}) in ${delayMs}ms`
                );
                return timer(delayMs);
              },
            })
          );
        })
      );
    }),
    share()
  );

  // Sync expected state with actual data from multiple sources
  // Priority: BLE (when charging) > MQTT (fallback)

  // BLE updates (most accurate when charging) - every 30 seconds
  teslaBleChargeState$.pipe(
    tap((bleState) => {
      const isCharging = bleState.charging_state === "Charging";
      const actualAmps = bleState.charger_actual_current;
      const actualPowerKw = bleState.charger_power;

      debug(`↻ Syncing expected state with BLE: ${actualAmps}A (${actualPowerKw}kW) [${bleState.charging_state}]`);
      expectedChargeState$.next({
        isCharging,
        expectedAmps: actualAmps,
        expectedPowerKw: actualPowerKw,
      });
    })
  ).subscribe();

  // MQTT updates (fallback when BLE not available or not charging)
  teslaChargerPower$.pipe(
    withLatestFrom(teslaChargingState$),
    tap(([actualPowerKw, chargingState]) => {
      const isCharging = chargingState === "Charging";
      const actualAmps = isCharging
        ? Math.round((actualPowerKw * 1000) / CHARGING_CONFIG.wattsPerAmp)
        : 0;

      const current = expectedChargeState$.value;
      // Only update from MQTT if there's a significant difference
      // (BLE will override this when it polls)
      if (Math.abs(current.expectedPowerKw - actualPowerKw) > 0.1 ||
          current.isCharging !== isCharging) {
        debug(`↻ Syncing expected state with MQTT: ${actualAmps}A (${actualPowerKw}kW)`);
        expectedChargeState$.next({
          isCharging,
          expectedAmps: actualAmps,
          expectedPowerKw: actualPowerKw,
        });
      }
    })
  ).subscribe();

  // Calculate house base load using EXPECTED charging power for immediate response
  // This prevents lag between command execution and MQTT updates
  const houseBaseLoad$ = powerUsage$.pipe(
    withLatestFrom(expectedChargeState$),
    map(([totalPower, expectedState]) => {
      const carWatts = expectedState.isCharging ? expectedState.expectedPowerKw * 1000 : 0;
      const baseLoad = totalPower - carWatts;
      debug("House base load:", baseLoad, "W",
            `(total: ${totalPower}W, car expected: ${carWatts}W)`);
      return baseLoad;
    }),
    share()
  );

  // Calculate solar overhead (negative house load = production)
  const solarOverhead$ = houseBaseLoad$.pipe(
    map((baseLoad) => {
      const overhead = calculateSolarOverhead(baseLoad);
      debug("Solar overhead:", overhead, "W");
      return overhead;
    }),
    share()
  );

  // Multiple rolling averages for different decision points
  const startAverage$ = createRollingAverage$(
    solarOverhead$,
    CHARGING_CONFIG.startWindow
  ).pipe(tap((v) => debug("Start average (3m):", v, "W")));

  const adjustAverage$ = createRollingAverage$(
    solarOverhead$,
    CHARGING_CONFIG.adjustWindow
  ).pipe(tap((v) => debug("Adjust average (30s):", v, "W")));

  const stopAverage$ = createRollingAverage$(
    solarOverhead$,
    CHARGING_CONFIG.stopWindow
  ).pipe(tap((v) => debug("Stop average (3m):", v, "W")));

  // ========== CHARGING DECISION STREAMS ==========

  // START CHARGING: Triggered when eligible and sufficient solar available
  const startChargingDecisions$ = teslaIsEligibleToCharge$.pipe(
    filter((eligible) => eligible),
    withLatestFrom(teslaChargingState$),
    filter(([, state]) => state !== "Charging"),
    tap(() => debug("Eligible to start - checking solar...")),
    switchMap(() =>
      startAverage$.pipe(
        map((avgWatts) => ({
          canStart: canStartCharging(
            avgWatts,
            CHARGING_CONFIG.minAmps,
            CHARGING_CONFIG.wattsPerAmp
          ),
          averageWatts: avgWatts,
        })),
        filter(({ canStart }) => canStart),
        map(({ averageWatts }) => {
          const amps = calculateOptimalAmps(
            averageWatts,
            CHARGING_CONFIG.wattsPerAmp,
            CHARGING_CONFIG.minAmps,
            CHARGING_CONFIG.maxAmps
          );
          debug(
            `Decision: START charging at ${amps}A (${averageWatts}W available)`
          );
          return { action: "START" as const, amps };
        }),
        take(1)
      )
    )
  );

  // ADJUST CHARGING: Triggered while charging, monitors adjust average
  const adjustChargingDecisions$ = teslaChargingState$.pipe(
    filter((state) => state === "Charging"),
    tap(() => debug("Charging active - monitoring for adjustments...")),
    switchMap(() =>
      adjustAverage$.pipe(
        withLatestFrom(teslaChargerPower$),
        map(([avgWatts, currentPowerKw]) => {
          const currentAmps = Math.round(
            (currentPowerKw * 1000) / CHARGING_CONFIG.wattsPerAmp
          );
          return { currentAmps, avgWatts };
        }),
        map(({ currentAmps, avgWatts }) =>
          shouldAdjustAmps(
            currentAmps,
            avgWatts,
            CHARGING_CONFIG.wattsPerAmp,
            CHARGING_CONFIG.minAmps,
            CHARGING_CONFIG.maxAmps
          )
        ),
        filter(({ shouldAdjust }) => shouldAdjust),
        map(({ newAmps }) => {
          debug(`Decision: ADJUST charging to ${newAmps}A`);
          return { action: "ADJUST" as const, amps: newAmps };
        }),
        distinctUntilChanged((a, b) => a.amps === b.amps)
      )
    )
  );

  // STOP CHARGING: Triggered by low solar OR lost eligibility
  const stopChargingDecisions$ = merge(
    // Stop due to insufficient solar
    teslaChargingState$.pipe(
      filter((state) => state === "Charging"),
      tap(() => debug("Charging active - monitoring for stop conditions...")),
      switchMap(() =>
        stopAverage$.pipe(
          map((avgWatts) =>
            shouldStopCharging(
              avgWatts,
              CHARGING_CONFIG.minAmps,
              CHARGING_CONFIG.wattsPerAmp
            )
          ),
          filter((shouldStop) => shouldStop),
          map(() => {
            debug("Decision: STOP charging (insufficient solar)");
            return { action: "STOP" as const, reason: "insufficient-solar" };
          }),
          take(1)
        )
      )
    ),
    // Stop due to lost eligibility
    teslaIsEligibleToCharge$.pipe(
      filter((eligible) => !eligible),
      withLatestFrom(teslaChargingState$),
      filter(([, state]) => state === "Charging"),
      map(() => {
        debug("Decision: STOP charging (not eligible)");
        return { action: "STOP" as const, reason: "not-eligible" };
      })
    )
  );

  // ========== COMMAND EXECUTION ==========

  const chargingCommands$ = merge(
    startChargingDecisions$,
    adjustChargingDecisions$,
    stopChargingDecisions$
  ).pipe(
    tap((cmd) => debug("Executing charging command:", cmd)),
    switchMap((command) => {
      switch (command.action) {
        case "START": {
          const expectedPowerKw = (command.amps * CHARGING_CONFIG.wattsPerAmp) / 1000;

          // Optimistically update expected state BEFORE command executes
          expectedChargeState$.next({
            isCharging: true,
            expectedAmps: command.amps,
            expectedPowerKw,
          });
          debug(`→ Expected state updated: ${command.amps}A (${expectedPowerKw.toFixed(2)}kW)`);

          return teslaBle.setChargingAmps$(command.amps).pipe(
            switchMap(() => teslaBle.startCharging$()),
            tap(() => debug(`✓ Started charging at ${command.amps}A`)),
            catchError((err) => {
              debug(`✗ Failed to start charging:`, err.message);
              // Revert expected state on failure
              expectedChargeState$.next({
                isCharging: false,
                expectedAmps: 0,
                expectedPowerKw: 0,
              });
              return EMPTY;
            })
          );
        }
        case "ADJUST": {
          const expectedPowerKw = (command.amps * CHARGING_CONFIG.wattsPerAmp) / 1000;

          // Optimistically update expected state
          expectedChargeState$.next({
            isCharging: true,
            expectedAmps: command.amps,
            expectedPowerKw,
          });
          debug(`→ Expected state updated: ${command.amps}A (${expectedPowerKw.toFixed(2)}kW)`);

          return teslaBle.setChargingAmps$(command.amps).pipe(
            tap(() => debug(`✓ Adjusted charging to ${command.amps}A`)),
            catchError((err) => {
              debug(`✗ Failed to adjust charging:`, err.message);
              return EMPTY;
            })
          );
        }
        case "STOP":
          // Optimistically update expected state
          expectedChargeState$.next({
            isCharging: false,
            expectedAmps: 0,
            expectedPowerKw: 0,
          });
          debug(`→ Expected state updated: STOPPED (0kW)`);

          return teslaBle.stopCharging$().pipe(
            tap(() => debug(`✓ Stopped charging (${command.reason})`)),
            catchError((err) => {
              debug(`✗ Failed to stop charging:`, err.message);
              return EMPTY;
            })
          );
      }
    }),
    share()
  );

  return chargingCommands$;
}
