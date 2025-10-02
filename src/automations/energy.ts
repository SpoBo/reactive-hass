import { combineLatest, EMPTY, Observable, timer, interval } from "rxjs";
import {
  map,
  distinctUntilChanged,
  switchMap,
  share,
  tap,
  startWith,
  catchError,
  retry,
} from "rxjs/operators";
import { AutomationOptions } from "./index";
import { IServicesCradle } from "../services/cradle";
import ms from "ms";
import { createRollingAverage$ } from "../helpers/createRollingAverage";

const REALTIME_POLL_INTERVAL = "30s";
const ROLLING_AVERAGE_FOR_STARTING = "3m";

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

  // Create a rolling average of the power usage.
  // But make sure to instantly start outputting values.
  const rollingAverage$ = createRollingAverage$(powerUsage$, "10s").pipe(
    tap((v) => debug("rollingAverage:", v))
  );

  // const asleep$ = states.entity$("binary_sensor.electra_asleep").pipe(
  //   pluck("state"),
  //   map((v) => v === "on"),
  //   distinctUntilChanged(),
  //   share(),
  //   tap((v) => debug("asleep:", v))
  // );

  // const doNotDisturbDesiredChargeLimit$ = states
  //   .entity$("number.electra_charge_limit")
  //   .pipe(
  //     pluck("state"),
  //     map((v) => Number(v)),
  //     distinctUntilChanged(),
  //     share(),
  //     tap((v) => debug("doNotDisturbDesiredChargeLimit:", v))
  //   );

  // const allowedToPoll$ = asleep$.pipe(
  //   map((v) => !v),
  //   share(),
  //   tap((v) => debug("allowedToPoll:", v))
  // );

  // Poll Tesla BLE charge state every 30 seconds when allowed to poll
  // Includes error handling and automatic retry with exponential backoff
  const teslaBleChargeState$ = interval(ms(REALTIME_POLL_INTERVAL)).pipe(
    startWith(0), // Start immediately
    switchMap(() => {
      debug("polling Tesla charge state...");
      return teslaBle.getChargeState$().pipe(
        tap((state) => {
          debug("Tesla charge state received:", {
            battery_level: state.battery_level,
            charge_limit: state.charge_limit_soc,
            charging_state: state.charging_state,
            charger_power: state.charger_power,
            charger_amps: state.charger_actual_current,
          });
        }),
        catchError((err) => {
          debug("Error fetching Tesla charge state:", err.message);
          // Return empty to continue the interval
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
    }),
    share()
  );

  // Tesla MQTT observables from Teslamate
  const teslaIsEligibleToCharge$ = teslamateMqtt.isEligibleToCharge$.pipe(
    tap((v) => debug("Tesla is eligible to charge:", v))
  );

  const teslaState$ = teslamateMqtt.state$.pipe(
    tap((v) => debug("Tesla car state:", v))
  );

  return combineLatest([
    rollingAverage$,
    teslaIsEligibleToCharge$,
    teslaState$,
  ]).pipe(tap((v) => debug("energy:", v)));
  // .pipe(mergeWith(teslaBleChargeState$));
}
