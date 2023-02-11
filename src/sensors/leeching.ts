import { Observable } from "rxjs";
import { map } from "rxjs/operators";
import { IServicesCradle } from "../services/cradle";
import { SensorConfig } from "../types";

/*
 * Detects when I am leeching.
 *
 * So either sab or qbit is active.
 */
export default function leeching$(
  cradle: IServicesCradle
): Observable<string | boolean> {
  // TODO: Also add qbit up/down
  return cradle.states.entity$("sensor.sabnzbd_speed").pipe(
    map((v) => {
      return Number(v.state) > 0;
    })
  );
}

export const config: SensorConfig = {
  type: "binary",
  name: "Server is leeching",
};
