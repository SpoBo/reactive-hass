import DEBUG from 'debug'
import { concat, EMPTY, merge, Observable, of, ReplaySubject, Subject } from 'rxjs'
import { delay, map, mergeMapTo, pluck, share, shareReplay, switchMap, switchMapTo, take, tap } from 'rxjs/operators'
import { IServicesCradle } from './cradle'
import Discovery from './Discovery'
import Mqtt from './Mqtt'
const debug = DEBUG('reactive-hass.binary-sensor')

type BinarySensorOptions = {
    name?: string
}

type BinarySensorState = {
    id: string,
    on: boolean
}

type BinarySensorControlPayload = {
    id: string,
    defaultState: boolean,
    advertise$: Observable<boolean>,
    emit$: (value: boolean) => Observable<boolean>
}

// Could be something more generic .... like a switachable control.
// Can map to a BinarySensor, a Sensor, a Switch, etc ... .
// They can all have the exact same API.
// Just a different way of initializing it.
class BinarySensorControl {
    private setSubject: ReplaySubject<boolean>
    private payload: BinarySensorControlPayload
    state$: Observable<BinarySensorState>

    constructor(payload: BinarySensorControlPayload) {
        this.setSubject = new ReplaySubject<boolean>(1)
        this.payload = payload

        const initial$ = of(this.payload.defaultState)

        const set$ = merge(initial$, this.setSubject)
            .pipe(
                tap((v) => debug('set', v)),
                switchMap(value => {
                    debug('publishing!')
                    return this.payload.emit$(value)
                }),
                map((on) => {
                    debug('getting value', on)
                    return {
                        id: this.payload.id,
                        on
                    }
                })
            )

        this.state$ = merge(this.payload.advertise$.pipe(mergeMapTo(EMPTY)), set$)
            .pipe(shareReplay(1))
    }

    set(value: boolean): Observable<boolean> {
        debug('setting %s to %s', this.payload.id, value)
        this.setSubject.next(value)
        return this.state$
            .pipe(
                pluck('on')
            )
    }
}

/**
 * https://www.home-assistant.io/integrations/binary_sensor.mqtt/
 *
 * It exposes something which is either on or off.
 * Which is controlled by us. No external party can turn it on or off.
 */
export default class BinarySensor {
    private discovery: Discovery
    private mqtt: Mqtt

    constructor(services: IServicesCradle) {
        this.discovery = services.discovery
        this.mqtt = services.mqtt
    }

    create(id: string, defaultState: boolean, options?: BinarySensorOptions): BinarySensorControl {
        debug('asking for a binary sensor with id %s with defaultState %s and options %o', id, defaultState, options)

        const config$ = this
            .discovery
            .create$(id, 'binary_sensor')
            .pipe(
                map((discovery) => {
                    const root = `${discovery.prefix}/binary_sensor/${discovery.id}`
                    return {
                        topic: `${root}/config`,
                        payload: {
                            unique_id: id,
                            name: options?.name || id,
                            state_topic: `${root}/state`,
                            // expire_after
                            // icon
                            // off_delay
                            // payload_available
                            // payload_not_available
                            // payload_off
                            // payload_on
                            //
                            /*
                              TODO: add availability. which is false when we are not online.
                              availability: {
                              topic: `${id}/available`
                              },
                            */
                        }
                    }
                }),
                shareReplay(1)
            )

        // This advertises the thing ....
        // but we need a way to advertise it when somebody becomes interested in the BinarySensorControl.
        const advertise$ = config$
            .pipe(
                switchMap(config => {
                    return this.mqtt
                        .publish$(
                            config.topic,
                            config.payload
                        )
                        .pipe(
                            take(1),
                            switchMapTo(EMPTY)
                        )
                })
            )

        return new BinarySensorControl({
            id,
            defaultState,
            advertise$: advertise$,
            emit$: (value: boolean) => {
                return config$
                    .pipe(
                        switchMap((config) => {
                            return this.mqtt.publish$(config.payload.state_topic, value ? 'ON' : 'OFF')
                                .pipe(tap((v) => debug(v)))
                        })
                    )
            }
        })
    }
}
