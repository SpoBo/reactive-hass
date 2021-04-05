import { empty, Observable } from "rxjs";
import { IServicesCradle } from "..";
import DEBUG from "debug";
import { HassEntityBase } from "../../types";

const debug = DEBUG("reactive-hass.events$");

export type serviceType = (eventType?: string) => Observable<any>

export default function(dependencies: IServicesCradle) {
    const socket = dependencies.socket

    return function(eventType?: string) {
        debug('creating observable to fetch events for %s', eventType)
        const response$ = socket
            .stream$({ type: 'subscribe_events', event_type: eventType })
        return <Observable<HassEntityBase[]>><unknown>response$
    } as serviceType
}
