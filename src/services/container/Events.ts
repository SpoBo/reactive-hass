import { Observable } from "rxjs";
import { IServicesCradle } from "..";
import DEBUG from "debug";
import { StateChangedEventData } from "../../types";
import Socket from "./Socket";
import { map } from "rxjs/operators";

const debug = DEBUG("reactive-hass.events");

export default class Events {
    socket: Socket

    constructor(dependencies: IServicesCradle) {
        this.socket = dependencies.socket
    }

    private createEventStream$(msg: object): Observable<StateChangedEventData> {
        return this.socket
            .subscribe$(msg)
        .pipe(
            map(item => {
                return item.event.data
            })
        )
    }

    get all$(): Observable<StateChangedEventData> {
        return this.createEventStream$({ type: 'subscribe_events' })
    }

    type$(eventType:string): Observable<StateChangedEventData> {
        return this.createEventStream$({ type: 'subscribe_events', event_type: eventType })
    }

    get stateChanged$(): Observable<StateChangedEventData> {
        return this.type$('state_changed')
    }
}
