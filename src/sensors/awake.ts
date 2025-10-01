import { Observable, combineLatest } from "rxjs";
import { startOfDay } from "date-fns";
import { map, pluck } from "rxjs/operators";
import { IServicesCradle } from "../services/cradle";
import { SensorConfig } from "../types";

const DOWNSTAIRS_MOTION_SENSORS = [
  "binary_sensor.storage_motion_sensor",
] as const;

/*
 * Someone is considered awake if there is downstairs activity (not bedroom/bathroom/hallway).
 * Combines historical data (any motion today) with real-time motion detection.
 * Once awake, stays awake until asleep sensor triggers.
 */
export default function awake$(cradle: IServicesCradle): Observable<boolean> {
  const { history, states } = cradle;

  // Check if there was any motion today (from midnight)
  const hadMotionToday$ = history
    .entity$(DOWNSTAIRS_MOTION_SENSORS[0], startOfDay(new Date()))
    .pipe(map((v) => v.some((v) => v.state === "on")));

  // Real-time motion detection
  const currentMotion$ = states
    .entity$(DOWNSTAIRS_MOTION_SENSORS[0])
    .pipe(map((v) => v.state === "on"));

  // Awake if either had motion today OR currently detecting motion
  return combineLatest([hadMotionToday$, currentMotion$]).pipe(
    map(([hadMotion, hasMotion]) => hadMotion || hasMotion)
  );
}

export const config: SensorConfig = {
  type: "binary",
  name: "Someone is awake",
};
