import { Observable } from "rxjs";
import { startOfDay } from "date-fns";
import { map } from "rxjs/operators";
import { IServicesCradle } from "../services/cradle";
import { SensorConfig } from "../types";

const DOWNSTAIRS_MOTION_SENSORS = ['binary_sensor.lumi_lumi_sensor_motion_aq2_occupancy'] as const;

// TODO: keep bedtime into account! Since then we are no longer awake.
// TODO: Need to have a timerange that updates for every day which tells us when to expect activity

/*
 * The idea is that if there is some activity not in the bedroom, bathroom or hallway on the day, that means someone is awake.
 * So if we are at midnight, and there is no activity anywhere, then nobody is awake.
 */
export default function awake$(
  cradle: IServicesCradle
): Observable<string | boolean> {
  // TODO: need to create an observable for today ... . Or at least something that triggers at every midnight.
  const history$ = cradle.history.entity$(DOWNSTAIRS_MOTION_SENSORS[0], startOfDay(new Date())).pipe(
    map((v) => {
      return v.some(v => v.state === 'on');
    })
  );

  // TODO: race between all the realtime events.
  // TODO: we can have multiple sources. and when one says false and another says true, we actually care about the true and not the false.
  return history$
}

export const config: SensorConfig = {
  type: "binary",
  name: "Someone is awake",
};
