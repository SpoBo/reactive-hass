import { Observable } from "rxjs";
import { map } from "rxjs/operators";
import { IServicesCradle } from "../services/cradle";
import { SensorConfig } from "../types";

/*
 */
export default function gaming$(
  cradle: IServicesCradle
): Observable<string | boolean> {
  return cradle.states.entity$("sensor.ps5_750_activity").pipe(
    map((v) => {
      return v.state === 'playing';
    })
  );
}

export const config: SensorConfig = {
  type: "binary",
  name: "Someone is gaming",
};
