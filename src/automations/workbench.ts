/* eslint-disable */
import ms from "ms";
import { concat, EMPTY, interval, merge, Observable, of } from "rxjs";
import { delay, filter, map, switchMap, tap } from "rxjs/operators";
import { AutomationOptions } from ".";

import { IServicesCradle } from "../services/cradle";

const twoSecondsDelay$ = of(null).pipe(
  delay(ms("2s")),
  filter((v) => !!v)
);

export default function test$(
  cradle: IServicesCradle,
  { debug }: AutomationOptions
) {
  const turnOn$ = cradle.service.call$({
    domain: "light",
    service: "turn_on",
    target: { entity_id: "light.atmosphere_lamp" },
  });

  const interval$ = interval(ms("5s")).pipe(
    map((v) => v % 2 === 0),
    tap((n) => debug(n))
  );

  const binary = cradle.binarySensor.create("workbench", false);

  const intervalOnBinarySensor$ = interval$.pipe(
    switchMap((value) => {
      debug("going to set binary to", value);
      return binary.set(value);
    })
  );

  const toggleLampOnAfterTwoSecondsOff$ = cradle.states
    .entity$("light.atmosphere_lamp")
    .pipe(
      switchMap((v) => {
        return v.state === "off" ? concat(twoSecondsDelay$, turnOn$) : EMPTY;
      })
    );

  const stuff: Observable<any>[] = [
    intervalOnBinarySensor$,
    //cradle.states.all$,
    //cradle.states.entity$('light.atmosphere_lamp'),
    /*
        cradle.service.call$({
            domain: 'light',
            service: 'toggle',
            target: { entity_id: 'light.atmosphere_lamp'}
        })
        */
    //toggleLampOnAfterTwoSecondsOff$,
  ];

  if (stuff.length > 0) {
    return merge(...stuff);
  }

  return EMPTY;
}
