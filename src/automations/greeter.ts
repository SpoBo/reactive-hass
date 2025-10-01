import { Observable, of } from "rxjs";
import {
  pluck,
  map,
  distinctUntilChanged,
  switchMap,
  filter,
  withLatestFrom,
  share,
  mergeWith,
  tap,
} from "rxjs/operators";
import { AutomationOptions } from "./index";
import { IServicesCradle } from "../services/cradle";

/**
 * Greets the user with "Good night!" when going to sleep
 * and "Good morning!" when waking up.
 *
 * Uses the asleep and awake sensors to determine state transitions.
 */
export default function (
  { states, notify }: IServicesCradle,
  { debug }: AutomationOptions
): Observable<unknown> {
  // Get the asleep sensor state (from reactive-hass MQTT)
  const asleep$ = states.entity$("binary_sensor.reactive_hass_asleep").pipe(
    pluck("state"),
    map((v) => v === "on"),
    tap((v) => debug("asleep:", v)),
    distinctUntilChanged(),
    share()
  );

  // Get the awake sensor state (from reactive-hass MQTT)
  const awake$ = states.entity$("binary_sensor.reactive_hass_awake").pipe(
    pluck("state"),
    map((v) => v === "on"),
    tap((v) => debug("awake:", v)),
    distinctUntilChanged(),
    share()
  );

  // Say "Good night!" when going to sleep (asleep becomes true while awake)
  const goingToSleep$ = asleep$.pipe(
    withLatestFrom(awake$),
    filter(([asleep, awake]) => asleep && awake),
    switchMap(() => {
      debug("Good night!");
      return notify.single$("Good night!");
    })
  );

  // Say "Good morning!" when waking up (awake becomes true while asleep)
  const wakingUp$ = awake$.pipe(
    withLatestFrom(asleep$),
    filter(([awake, asleep]) => awake && asleep),
    switchMap(() => {
      debug("Good morning!");
      return notify.single$("Good morning!");
    })
  );

  return goingToSleep$.pipe(mergeWith(wakingUp$));
}