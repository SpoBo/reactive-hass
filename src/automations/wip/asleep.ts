import { EMPTY, interval, Observable, of } from "rxjs";
import {
  map,
  pluck,
  combineLatestWith,
  startWith,
  distinctUntilChanged,
  tap,
  switchMap,
  mergeWith,
  share,
  filter,
  withLatestFrom,
} from "rxjs/operators";
import { AutomationOptions } from "../index";
import inTimeRange from "../../helpers/inTimeRange";
import { IServicesCradle } from "../../services/cradle";

function inTimeRange$(start: string, stop: string): Observable<boolean> {
  const check = inTimeRange(start, stop);

  return interval(1000).pipe(
    startWith(null),
    map(() => check(new Date())),
    distinctUntilChanged()
  );
}

/**
 * Sets a boolean to true when everyone in the house is considered asleep.
 *
 * It's basically just checking when my phone is plugged in because I do charge it every might.
 *
 * TODO: Also check if there was some upstairs motion a little bit before plugging in. That way we know it with a little bit more certainty.
 * downstairs: binary_sensor.lumi_lumi_sensor_motion_aq2_387fec02_ias_zone
 * upstairs: binary_sensor.motion_sensor_staircase_upstairs
 *
 * TODO: Disable things when we go to sleep. treadmill, heater in office, etc.
 */
export default function (
  services: IServicesCradle,
  { debug }: AutomationOptions
) {
  const { states, notify } = services;

  // TODO: Add this via some kind of config.
  const pluggedIn$ = states.entity$("sensor.vincents_iphone_battery_state").pipe(
    pluck("state"),
    map((v) => v === "Charging")
  );

  const definitelySleeping$ = of(false); // inTimeRange$('00:30', '05:00')
  const mightBeGoingToSleep$ = inTimeRange$("21:30", "04:00");

  // TODO: Convert to an exposed binary sensor.
  const current$ = states.entity$("input_boolean.asleep").pipe(
    pluck("state"),
    map((v) => v === "on"),
    share()
  );

  const asleep$ = pluggedIn$.pipe(
    combineLatestWith(mightBeGoingToSleep$, definitelySleeping$),
    map(([pluggedIn, mightBeSleeping, definitelySleeping]) => {
      if (definitelySleeping) {
        return true;
      }

      return pluggedIn && mightBeSleeping;
    }),
    distinctUntilChanged(),
    tap((asleep) => {
      debug("asleep?", asleep);
    }),
    share()
  );

  const stateChange$ = asleep$.pipe(
    withLatestFrom(current$),
    switchMap(([asleep, currentlyAsleep]) => {
      if (asleep === currentlyAsleep) {
        return EMPTY;
      }

      return services.service.call$({
        domain: "input_boolean",
        service: asleep ? "turn_on" : "turn_off",
        target: { entity_id: "input_boolean.asleep" },
      });
    })
  );

  // When going from asleep false to asleep true ... so we need to also know the current state.
  const goingToSleep$ = asleep$.pipe(
    withLatestFrom(current$),
    filter(([asleep, currently]) => asleep && !currently),
    switchMap(() => {
      return notify.single$("Good night!");
    })
  );

  // When going from asleep true to asleep false ... so we need to also know the current state.
  // TODO: Improve to only do it when we are not really asleep anymore but that we also detected some movement. Only then am I really awake imo.
  const wakingUp$ = asleep$.pipe(
    withLatestFrom(current$),
    filter(([asleep, currently]) => !asleep && currently),
    switchMap(() => {
      return notify.single$("Good morning ...");
    })
  );

  return stateChange$.pipe(mergeWith(goingToSleep$, wakingUp$)); //, goingToSleep$, wakingUp$)
}
