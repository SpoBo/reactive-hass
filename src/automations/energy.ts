import { EMPTY, Observable } from "rxjs";
import {
  pluck,
  map,
  distinctUntilChanged,
  switchMap,
  withLatestFrom,
  share,
  mergeWith,
  tap,
  startWith,
} from "rxjs/operators";
import { AutomationOptions } from "./index";
import { IServicesCradle } from "../services/cradle";
import ms from "ms";
import { createRollingAverage$ } from "../helpers/createRollingAverage";

/**
 * Constantly monitor how much energy we are using and potentially start / stop certain services.
 * Like charge the car etc.
 *
 * The idea is that we will have a priority mechanism based on some configuration.
 */
export default function (
  { states, notify }: IServicesCradle,
  { debug }: AutomationOptions
): Observable<unknown> {
  // Monitor how much power we are using.
  const powerUsage$ = states.entity$("sensor.p1_meter_power").pipe(
    pluck("state"),
    map((v) => Number(v)),
    tap((v) => debug("powerUsage:", v)),
    distinctUntilChanged(),
    share()
  );

  // Create a rolling average of the power usage.
  // But make sure to instantly start outputting values.
  const rollingAverage$ = createRollingAverage$(powerUsage$, "10s").pipe(
    tap((v) => debug("rollingAverage:", v))
  );

  return rollingAverage$;
}
