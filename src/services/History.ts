import DEBUG from "debug";
import { map, Observable } from "rxjs";
import { HassEntityBase } from "../types";
import Rest from "./Rest";

const debug = DEBUG("reactive-hass.history");

type HistoryHassEntityType = HassEntityBase;

export default class History {
  rest: Rest;

  constructor({ rest }: { rest: Rest }) {
    this.rest = rest;
  }

  // TODO: Would be cool if we could put in an observable for the Date.
  //       That would rebuild the URL every time the observable changes and would trigger the request again.
  entity$(id: string, since?: Date): Observable<HistoryHassEntityType[]> {
    const raw$ = this
      .rest
      .get$<HistoryHassEntityType[][]>(['history', 'period', since], { queryParams: new URLSearchParams({ filter_entity_id: id }) });

    return raw$.pipe(
      map((result) => {
        debug(`history for ${id}`, result)
        return result[0].filter(v => v.entity_id === id);
      }),
    );
  }
}
