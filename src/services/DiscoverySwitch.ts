import Config from "./Config"
import { IServicesCradle } from "./cradle"
import Mqtt from "./Mqtt"
import DEBUG from 'debug'
import { concat, merge, Observable, of } from "rxjs"
import { switchMap, tap } from "rxjs/operators"

const debug = DEBUG('reactive-hass.discovery-switch')

type SwitchState = {
    name: string,
    on: boolean
}

export default class DiscoverySwitch {
    private mqtt: Mqtt
    private config: Config

    constructor(dependencies: IServicesCradle) {
        this.mqtt = dependencies.mqtt
        this.config = dependencies.config
    }

    create$(name: String): Observable<SwitchState> {
        return this.config
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
                                name,
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
                            tap(() => {
                                debug('advertising switch %s on mqtt discovery', name)
                            }),
                        )

                    const commands$ = this.mqtt
                        .subscribe$(cmdTopic)
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

                                return concat(set$, of({ name, on }))
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
    }
}
