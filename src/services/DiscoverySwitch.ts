import Config from "./Config"
import { IServicesCradle } from "./cradle"
import Mqtt from "./Mqtt"
import DEBUG from 'debug'
import { concat, merge, Observable, of } from "rxjs"
import { delay, switchMap, switchMapTo, takeUntil, tap } from "rxjs/operators"
import HassStatus from "./HassStatus"

const debug = DEBUG('reactive-hass.discovery-switch')

type SwitchState = {
    name: string,
    on: boolean
}

type SwitchOptions = {
    name?: string
}

export default class DiscoverySwitch {
    private mqtt: Mqtt
    private config: Config
    private hassStatus: HassStatus

    constructor(dependencies: IServicesCradle) {
        this.mqtt = dependencies.mqtt
        this.config = dependencies.config
        this.hassStatus = dependencies.hassStatus
    }

    create$(name: String, options?: SwitchOptions): Observable<SwitchState> {
        debug('asking for switch with name %s', name)
        const switch$ = this.config
            .root$()
            .pipe(
                switchMap(config => {
                    const id = `reactive_hass-${name}`
                    const root = `${config.mqttDiscoveryPrefix}/switch/${id}`
                    const cmdTopic = `${root}/set`
                    const configTopic = `${root}/config`
                    const stateTopic = `${root}/state`

                    const advertise$ = this.mqtt
                        .publish$(
                            configTopic,
                            {
                                unique_id: id,
                                name: options?.name || name,
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
                                    debug('advertising switch %s on mqtt discovery', name)
                                },
                                complete: () => {
                                    debug('advertised switch %s', name)
                                }
                            }),
                        )

                    const commands$ = this.mqtt
                        .subscribe$(cmdTopic, { assumed: 'ON' })
                        .pipe(
                            tap((v) => {
                                debug('command for %s -> %j', name, v)
                            })
                        )

                    const states$ = commands$
                        .pipe(
                            switchMap(v => {
                                const on = v === 'ON'

                                const set$ = this.mqtt
                                    .publish$(stateTopic, v)
                                    .pipe(
                                        tap({
                                            next: (v) => {
                                                debug('got switch value', v)
                                            },
                                            complete: () => {
                                                debug('completed switch publish')
                                            }
                                        })
                                    )

                                return concat(set$, of({ name, on } as SwitchState))
                            })
                        )

                    return merge(
                        advertise$,
                        states$,
                    ).pipe(
                        tap(v => {
                            debug('switch %j', v)
                        })
                    )
                })
            )

        return this.hassStatus.online$
            .pipe(switchMapTo(switch$))
    }
}
