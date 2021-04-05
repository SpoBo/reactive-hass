import { empty, merge, Observable } from "rxjs";
import { filter, map, tap } from "rxjs/operators";
import { IServicesCradle } from "./cradle";
import { HassEntityBase } from "../types"
import Events from "./Events";
import Socket from "./Socket";

export default class States {
    socket: Socket
    events: Events

    constructor(dependencies: IServicesCradle) {
        this.socket = dependencies.socket
        this.events = dependencies.events
    }

    get all$(): Observable<HassEntityBase[]> {
        return this.socket
            .single$('get_states')
            .pipe(
                map(v => v.result)
            )
    }

    entity$(entityId: string): Observable<HassEntityBase> {
        const initial$ = this.all$
            .pipe(
                map(all => all.find(item => item.entity_id === entityId)),
                filter(v => !!v)
            ) as Observable<HassEntityBase>

        const updates$ = this.events.stateChanged$
            .pipe(
                filter(v => v.entity_id === entityId),
                map(v => v.new_state as HassEntityBase)
            )

        // First, grab all of them and fetch the one for that specific entityId.
        // Then, subscribe to the state_change events for that entityId.
        return merge(initial$, updates$)
    }
}
