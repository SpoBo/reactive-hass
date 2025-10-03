import {
  combineLatest,
  EMPTY,
  Observable,
  timer,
  interval,
  merge,
  BehaviorSubject,
} from "rxjs";
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
  shareReplay,
} from "rxjs/operators";
import { AutomationOptions } from "./index";
import { IServicesCradle } from "../services/cradle";
import ms from "ms";
import { createRollingAverage$ } from "../helpers/createRollingAverage";
import { CHARGING_CONFIG } from "./charging/config";
import {
  calculateSolarOverhead,
  canStartCharging,
  shouldStopCharging,
  shouldAdjustAmps,
  calculateOptimalAmps,
} from "./charging/helpers";
import { median, weightedMean } from "../helpers/math/aggregations";
import { exponentialWeights } from "../helpers/math/weights";

const REALTIME_POLL_INTERVAL = "30s";

/**
 * Solar-powered Tesla charging automation.
 *
 * Monitors solar production and automatically controls Tesla charging to maximize
 * the use of excess solar power. Dynamically adjusts charging amperage (5-13A)
 * based on available solar overhead.
 *
 * Key features:
 * - Event-driven architecture with three decision streams (start/adjust/stop)
 * - Optimistic state management to eliminate command lag
 * - Conditional BLE polling (only when charging) to allow car sleep
 * - Multiple rolling averages (3m for start/stop, 30s for adjustments)
 * - Layered data sources: optimistic → BLE → MQTT
 *
 * See ENERGY_README.md for detailed architecture and design decisions.
 *
 * TODO: Add an absolute minimum to charge to.
 * TODO: Avoid charging the car when there is a high load on the grid.
 * TODO: Read out a source for destinations and times of arrival to determine a new desired charge %.
 *       As well as ensuring the car is charged by that time. So it'll then charge even when there is no solar. But it will still do peak shaving if possible.
 * TODO: Add something that can forecast how much power we may be getting from solar.
 */
export default function (
  { notify, teslaBle, teslamateMqtt, homeWizardP1 }: IServicesCradle,
  { debug }: AutomationOptions
): Observable<unknown> {
  // Monitor how much power we are using directly from HomeWizard P1 meter
  // Keep raw values - rolling averages will be applied later for specific decisions
  const powerUsage$ = homeWizardP1.activePower$.pipe(
    distinctUntilChanged(),
    share()
  );

  // Tesla MQTT observables - event triggers
  const teslaIsEligibleToCharge$ = teslamateMqtt.isEligibleToCharge$.pipe(
    distinctUntilChanged(),
    tap((v) => debug("Tesla eligibility changed:", v)),
    share()
  );

  // Notify on eligibility changes with kWh remaining info
  // Using combineLatest to ensure we get an initial emission when all values are available
  const eligibilityNotifications$ = combineLatest([
    teslaIsEligibleToCharge$,
    teslamateMqtt.batteryLevel$,
    teslamateMqtt.chargeLimitSoc$,
  ]).pipe(
    distinctUntilChanged(
      (
        [prevEligible, prevBattery, prevLimit],
        [currEligible, currBattery, currLimit]
      ) =>
        prevEligible === currEligible &&
        prevBattery === currBattery &&
        prevLimit === currLimit
    ),
    switchMap(([isEligible, batteryLevel, chargeLimit]) => {
      const remainingPercent = chargeLimit - batteryLevel;
      const remainingKwh =
        (remainingPercent / 100) * CHARGING_CONFIG.batteryCapacityKwh;

      if (isEligible) {
        return notify.single$(
          `🔌 Tesla eligible for solar charging - ${remainingKwh.toFixed(1)} kWh needed (${batteryLevel}% → ${chargeLimit}%)`
        );
      } else {
        return notify.single$(
          `⏸️ Tesla not eligible for charging (${batteryLevel}% / ${chargeLimit}%)`
        );
      }
    })
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
    tap((isCharging) =>
      debug(
        `Expected charging state changed to: ${isCharging} - ${isCharging ? "starting" : "stopping"} BLE polling`
      )
    ),
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
  teslaBleChargeState$
    .pipe(
      tap((bleState) => {
        const isCharging = bleState.charging_state === "Charging";
        const actualAmps = bleState.charger_actual_current;
        const actualPowerKw = bleState.charger_power;

        debug(
          `↻ Syncing expected state with BLE: ${actualAmps}A (${actualPowerKw}kW) [${bleState.charging_state}]`
        );
        expectedChargeState$.next({
          isCharging,
          expectedAmps: actualAmps,
          expectedPowerKw: actualPowerKw,
        });
      })
    )
    .subscribe();

  // MQTT updates (fallback when BLE not available or not charging)
  teslaChargerPower$
    .pipe(
      withLatestFrom(teslaChargingState$),
      tap(([actualPowerKw, chargingState]) => {
        const isCharging = chargingState === "Charging";
        const actualAmps = isCharging
          ? Math.round((actualPowerKw * 1000) / CHARGING_CONFIG.wattsPerAmp)
          : 0;

        const current = expectedChargeState$.value;
        // Only update from MQTT if there's a significant difference
        // (BLE will override this when it polls)
        if (
          Math.abs(current.expectedPowerKw - actualPowerKw) > 0.1 ||
          current.isCharging !== isCharging
        ) {
          debug(
            `↻ Syncing expected state with MQTT: ${actualAmps}A (${actualPowerKw}kW)`
          );
          expectedChargeState$.next({
            isCharging,
            expectedAmps: actualAmps,
            expectedPowerKw: actualPowerKw,
          });
        }
      })
    )
    .subscribe();

  const expectedLoad$ = expectedChargeState$.pipe(
    map((v) => (v.isCharging ? v.expectedPowerKw * 1000 : 0)),
    tap((v) => debug("expectedLoad:", v, "W")),
    distinctUntilChanged()
  );

  // Calculate house base load using EXPECTED charging power for immediate response
  // This prevents lag between command execution and MQTT updates
  // Recalculates whenever EITHER power usage OR expected charging state changes
  // Uses RAW power values - rolling averages applied later for decision-making
  const houseBaseLoad$ = combineLatest([
    powerUsage$, // Using raw values instead of pre-averaged
    expectedLoad$,
  ]).pipe(
    map(([totalPower, expectedLoad]) => {
      return totalPower - expectedLoad;
    }),
    share()
  );

  // Calculate energy available (negative house load = production)
  const energyAvailable$ = houseBaseLoad$.pipe(
    map((baseLoad) => {
      const overhead = calculateSolarOverhead(baseLoad);
      debug("Energy available:", overhead, "W");
      return overhead;
    }),
    share()
  );

  // Multiple rolling averages for different decision points
  // Start/Stop: Use median for robustness against spikes - better for long-term decisions
  const startAverage$ = createRollingAverage$(
    energyAvailable$,
    CHARGING_CONFIG.startWindow,
    median // Robust to spikes - ignores outliers when deciding to start
  ).pipe(tap((v) => debug("Start average (3m, median):", v, "W")));

  // Adjust: Use weighted mean with exponential decay - prioritize recent values for quick response
  const adjustAverage$ = createRollingAverage$(
    energyAvailable$,
    CHARGING_CONFIG.adjustWindow,
    weightedMean(exponentialWeights(20, 0.5)) // Recent values weighted higher for responsive adjustments
  ).pipe(tap((v) => debug("Adjust average (30s, weighted):", v, "W")));

  const stopAverage$ = createRollingAverage$(
    energyAvailable$,
    CHARGING_CONFIG.stopWindow,
    median // Robust to spikes - prevents premature stopping
  ).pipe(tap((v) => debug("Stop average (3m, median):", v, "W")));

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
          const expectedPowerKw =
            (command.amps * CHARGING_CONFIG.wattsPerAmp) / 1000;

          // Optimistically update expected state BEFORE command executes
          expectedChargeState$.next({
            isCharging: true,
            expectedAmps: command.amps,
            expectedPowerKw,
          });
          debug(
            `→ Expected state updated: ${command.amps}A (${expectedPowerKw.toFixed(2)}kW)`
          );

          const commandResult$ = teslaBle.setChargingAmps$(command.amps).pipe(
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

          const successNotification$ = commandResult$.pipe(
            switchMap(() =>
              notify.single$(
                `🔋 Started solar charging at ${command.amps}A (${expectedPowerKw.toFixed(1)}kW)`
              )
            )
          );

          const errorNotification$ = teslaBle
            .setChargingAmps$(command.amps)
            .pipe(
              switchMap(() => teslaBle.startCharging$()),
              switchMap(() => EMPTY),
              catchError((err) =>
                notify.single$(`⚠️ Failed to start charging: ${err.message}`)
              )
            );

          return merge(
            commandResult$,
            successNotification$,
            errorNotification$
          );
        }
        case "ADJUST": {
          const expectedPowerKw =
            (command.amps * CHARGING_CONFIG.wattsPerAmp) / 1000;

          // Optimistically update expected state
          expectedChargeState$.next({
            isCharging: true,
            expectedAmps: command.amps,
            expectedPowerKw,
          });
          debug(
            `→ Expected state updated: ${command.amps}A (${expectedPowerKw.toFixed(2)}kW)`
          );

          const commandResult$ = teslaBle.setChargingAmps$(command.amps).pipe(
            tap(() => debug(`✓ Adjusted charging to ${command.amps}A`)),
            catchError((err) => {
              debug(`✗ Failed to adjust charging:`, err.message);
              return EMPTY;
            })
          );

          const successNotification$ = commandResult$.pipe(
            switchMap(() =>
              notify.single$(
                `⚡ Adjusted charging to ${command.amps}A (${expectedPowerKw.toFixed(1)}kW)`
              )
            )
          );

          const errorNotification$ = teslaBle
            .setChargingAmps$(command.amps)
            .pipe(
              switchMap(() => EMPTY),
              catchError((err) =>
                notify.single$(`⚠️ Failed to adjust charging: ${err.message}`)
              )
            );

          return merge(
            commandResult$,
            successNotification$,
            errorNotification$
          );
        }
        case "STOP": {
          // Optimistically update expected state
          expectedChargeState$.next({
            isCharging: false,
            expectedAmps: 0,
            expectedPowerKw: 0,
          });
          debug(`→ Expected state updated: STOPPED (0kW)`);

          const reasonText =
            command.reason === "insufficient-solar"
              ? "insufficient solar power"
              : "charging complete or not eligible";

          const commandResult$ = teslaBle.stopCharging$().pipe(
            tap(() => debug(`✓ Stopped charging (${command.reason})`)),
            catchError((err) => {
              debug(`✗ Failed to stop charging:`, err.message);
              return EMPTY;
            })
          );

          const successNotification$ = commandResult$.pipe(
            switchMap(() =>
              notify.single$(`🛑 Stopped charging due to ${reasonText}`)
            )
          );

          const errorNotification$ = teslaBle.stopCharging$().pipe(
            switchMap(() => EMPTY),
            catchError((err) =>
              notify.single$(`⚠️ Failed to stop charging: ${err.message}`)
            )
          );

          return merge(
            commandResult$,
            successNotification$,
            errorNotification$
          );
        }
      }
    }),
    share()
  );

  // Merge all streams together
  return merge(chargingCommands$, eligibilityNotifications$);
}
