import { interval, Observable, of } from "rxjs";
import {
  map,
  pluck,
  combineLatestWith,
  startWith,
  distinctUntilChanged,
} from "rxjs/operators";
import inTimeRange from "../helpers/inTimeRange";
import { IServicesCradle } from "../services/cradle";
import { SensorConfig } from "../types";

function inTimeRange$(start: string, stop: string): Observable<boolean> {
  const check = inTimeRange(start, stop);

  return interval(1000).pipe(
    startWith(null),
    map(() => check(new Date())),
    distinctUntilChanged()
  );
}

/**
 * Determines when everyone in the house is considered asleep.
 *
 * Based on phone being plugged in (charging every night) and time range.
 *
 * TODO: Also check if there was some upstairs motion a little bit before plugging in.
 * That way we know it with a little bit more certainty.
 */
export default function asleep$(cradle: IServicesCradle): Observable<boolean> {
  const { states } = cradle;

  // TODO: Add this via some kind of config.
  const pluggedIn$ = states
    .entity$("sensor.vincents_iphone_battery_state")
    .pipe(
      pluck("state"),
      map((v) => v === "Charging")
    );

  const definitelySleeping$ = of(false); // inTimeRange$('00:30', '05:00')
  const mightBeGoingToSleep$ = inTimeRange$("21:30", "04:00");

  return pluggedIn$.pipe(
    combineLatestWith(mightBeGoingToSleep$, definitelySleeping$),
    map(([pluggedIn, mightBeSleeping, definitelySleeping]) => {
      if (definitelySleeping) {
        return true;
      }

      return pluggedIn && mightBeSleeping;
    }),
    distinctUntilChanged()
  );
}

export const config: SensorConfig = {
  type: "binary",
  name: "Everyone is asleep",
};
