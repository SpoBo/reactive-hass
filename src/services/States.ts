import { merge, Observable, of } from "rxjs";
import { filter, groupBy, map, pluck, switchMap, take } from "rxjs/operators";
import globToRegexp from "glob-to-regexp";
import { IServicesCradle } from "./cradle";
import { HassEntityBase } from "../types";
import Events from "./Events";
import Socket from "./Socket";

export default class States {
  socket: Socket;
  events: Events;

  constructor(dependencies: IServicesCradle) {
    this.socket = dependencies.socket;
    this.events = dependencies.events;
  }

  /**
   * Returns an observable with all the states.
   */
  get all$(): Observable<HassEntityBase[]> {
    return this.socket.single$("get_states").pipe(map((v) => v.result));
  }

  private updatesForEntityId$(entityId: string): Observable<HassEntityBase> {
    return this.events.stateChanged$.pipe(
      filter((v) => v.entity_id === entityId),
      map((v) => v.new_state as HassEntityBase)
    );
  }

  entity$(entityId: string): Observable<HassEntityBase> {
    const initial$ = this.all$.pipe(
      map((all) => all.find((item) => item.entity_id === entityId)),
      filter((v) => !!v)
    ) as Observable<HassEntityBase>;

    // First, grab all of them and fetch the one for that specific entityId.
    // Then, subscribe to the state_change events for that entityId.
    return merge(initial$, this.updatesForEntityId$(entityId));
  }

  /**
   * Returns a Higher-Order Observable per entity_id that matches the glob pattern.
   */
  entities$(entityGlob: string): Observable<Observable<HassEntityBase>> {
    const regex = globToRegexp(entityGlob);

    const initial$ = this.all$.pipe(
      map((entities) => {
        return entities.filter((v) => v.entity_id.match(regex));
      })
    );

    const individual$ = initial$.pipe(
      switchMap((entities) => {
        return of(...entities);
      })
    );

    return individual$.pipe(
      groupBy((state) => state.entity_id),
      map((entity$) => {
        const entityName$ = entity$.pipe(take(1), pluck("entity_id"));

        const updates$ = entityName$.pipe(
          switchMap((entityId) => {
            return this.updatesForEntityId$(entityId);
          })
        );

        return merge(entity$, updates$);
      })
    );
  }
}
