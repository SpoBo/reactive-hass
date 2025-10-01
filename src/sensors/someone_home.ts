import { of } from "rxjs";
import { distinctUntilChanged, map, mergeScan } from "rxjs/operators";
import { IServicesCradle } from "../services/cradle";
import { SensorOptions } from "./index";

// TODO: Put in config.
const OCCUPANTS = ["person.vincent", "person.marife"];

/**
 * Exposes if someone is home or not.
 */
export default function (services: IServicesCradle, { debug }: SensorOptions) {
  // TODO: We can extract this to a helper ...
  const entities$ = of(...OCCUPANTS).pipe(
    map((entity) => {
      return services.states.entity$(entity);
    })
  );

  const homePerPerson$ = entities$.pipe(
    mergeScan((acc: { [key: string]: string }, entity$) => {
      return entity$.pipe(
        map((v) => {
          acc[v.entity_id] = v.state;
          return acc;
        })
      );
    }, {})
  );

  return homePerPerson$.pipe(
    map((totals) => {
      debug("totals", totals);
      return Object.values(totals).some((v) => v === "home");
    }),
    distinctUntilChanged()
  );
}
