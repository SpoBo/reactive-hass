import Config from "./Config"
import { IServicesCradle } from "./cradle"
import Mqtt from "./Mqtt"
import DEBUG from 'debug'
import { concat, merge, Observable, of, ReplaySubject, Subject } from "rxjs"
import { delay, map, share, shareReplay, switchMap, switchMapTo, take, takeUntil, tap } from "rxjs/operators"
import HassStatus from "./HassStatus"
import ms from "ms"
import Discovery from "./Discovery"

const debug = DEBUG('reactive-hass.discovery-switch')

type SwitchState = {
    id: string,
    on: boolean,
    set: (value: boolean) => Observable<boolean>
}

type SwitchOptions = {
    name?: string
}

export default class DiscoverySwitch {
    private mqtt: Mqtt
    private config: Config
    private hassStatus: HassStatus
    private discovery: Discovery

    constructor(dependencies: IServicesCradle) {
        this.mqtt = dependencies.mqtt
        this.config = dependencies.config
        this.hassStatus = dependencies.hassStatus
        this.discovery = dependencies.discovery
    }

    // TODO: Clean up this API. Want something which does not keep emitting the set function.
    // TODO: Have a similar API for the input boolean then.
    create$(id: string, defaultState: boolean, options?: SwitchOptions): Observable<SwitchState> {
        debug('asking for a switch with id %s and options %j', id, options)
        const config$ = this.discovery
            .create$(id, 'switch')
            .pipe(
                map((discovery) => {
                    const root = `${discovery.prefix}/switch/${discovery.id}`
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

        const switch$ = this.config
            .root$()
            .pipe(
                switchMap(config => {
                    const name = `reactive_hass-${id}`
                    // TODO: Create a kind of discovery service to make this discovery stuff easier ... .
                    const root = `${config.mqttDiscoveryPrefix}/switch/${name}`
                    const cmdTopic = `${root}/set`
                    const configTopic = `${root}/config`
                    const stateTopic = `${root}/state`

                    const setSubject = new ReplaySubject(1)

                    function set(value: boolean) {
                        setSubject.next(value)
                        return set$.pipe(take(1))
                    }

                    const advertise$ = this.mqtt
                        .publish$(
                            configTopic,
                            {
                                unique_id: id,
                                name: options?.name || id,
                                state_topic: stateTopic,
                                command_topic: cmdTopic,
                                /*
                                TODO: add availability. which is false when we are not online.
                                availability: {
                                    topic: `${id}/available`
                                },
                                */
                                optimistic: false,
                                retain: true
                            }
                        )
                        .pipe(
                            tap({
                                next: () => {
                                    debug('advertising switch %s on mqtt discovery', id)
                                },
                                complete: () => {
                                    debug('advertised switch %s', id)
                                }
                            }),
                        )

                    const commands$ = this.mqtt
                        .subscribe$(cmdTopic)
                        .pipe(
                            tap((v) => {
                                debug('command for %s -> %j', id, v)
                            })
                        )

                    const mqttState$ = commands$
                        .pipe(
                            switchMap(v => {
                                const on = v === 'ON'

                                const set$ = this.mqtt
                                    .publish$(stateTopic, v)
                                    .pipe(
                                        tap((v) => {
                                            debug('got switch value', v)
                                        })
                                    )

                                return concat(set$, of({ id, on, set } as SwitchState))
                            }),
                            share(),
                            tap((v => debug('got value in switch %o', v)))
                        )

                    const set$ = setSubject
                        .pipe(
                            switchMap(value => {
                                return this.mqtt.publish$(cmdTopic, value ? 'ON' : 'OFF')
                            })
                        )

                    const defaultState$ = of(defaultState)
                        .pipe(
                            delay(ms('2s')),
                            takeUntil(mqttState$),
                            tap((value) => set(value))
                        )

                    const states$ = merge(mqttState$, defaultState$)

                    return merge(
                        advertise$,
                        states$,
                        set$
                    ).pipe(
                        tap(v => {
                            debug('switch %o', v)
                        }),
                        shareReplay(1)
                    )
                })
            )

        return this.hassStatus.online$
            .pipe(switchMapTo(switch$))
    }
}
