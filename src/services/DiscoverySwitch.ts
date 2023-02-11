import { IServicesCradle } from "./cradle"
import Mqtt from "./Mqtt"
import DEBUG from 'debug'
import { concat, EMPTY, merge, Observable, of, ReplaySubject, Subject } from "rxjs"
import { delay, map, share, shareReplay, switchMap, switchMapTo, take, takeUntil, tap, withLatestFrom } from "rxjs/operators"
import ms from "ms"
import Discovery from "./Discovery"
import { ValueControl } from "../helpers/ValueControl"

const debug = DEBUG('reactive-hass.discovery-switch')

type SwitchOptions = {
    name?: string
}

/**
 * This is something which can be set by us or by the outside.
 * We can consume the state to see the latest value.
 * Whenever we set the value we will also emit the state.
 */
export default class DiscoverySwitch {
    private mqtt: Mqtt
    private discovery: Discovery

    constructor(dependencies: IServicesCradle) {
        this.mqtt = dependencies.mqtt
        this.discovery = dependencies.discovery
    }

    create(id: string, defaultState: boolean, options?: SwitchOptions): ValueControl<boolean> {
        debug('asking for a switch with id %s and options %j', id, options)
        // TODO: improve the discovery API a bit further.
        const config$ = this.discovery
            .create$(id, 'switch', { name: options?.name })
            .pipe(
                map((discovery) => {
                    const cmdTopic = `${discovery.topics.root}/set`
                    return {
                        topic: discovery.topics.config,
                        payload: {
                            ...discovery.payload,
                            command_topic: cmdTopic,
                            optimistic: false,
                            retain: true
                        }
                    }
                }),
                shareReplay(1)
            )

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

        // TODO: Figure out how to put all this in ... .
        const commands$ = config$
            .pipe(
                switchMap(config => {
                    debug('going to subscribe to command topic %s', config.payload.command_topic)
                    return this.mqtt
                        .subscribe$(config.payload.command_topic)
                        .pipe(
                            tap((v) => {
                                debug('command for %s -> %j', id, v)
                            })
                        )
                })
            )

        const mqttState$ = commands$
            .pipe(
                tap((value) => {
                    const on = value === 'ON'

                    setSubject.next(on)
                })
            )

        const setSubject = new Subject<boolean>()

        const set$ = config$
            .pipe(
                withLatestFrom(setSubject),
                switchMap(([ config, value ]) => {
                    return this.mqtt.publish$(config.payload.state_topic, value ? 'ON' : 'OFF')
                })
            )

        const run$ = merge(advertise$, set$, mqttState$)


        return new ValueControl<boolean>({
            id,
            defaultState,
            subject: setSubject,
            run$,
            emit$: (value: boolean) => {
                return config$
                    .pipe(
                        take(1),
                        switchMap((config) => {
                            return this.mqtt.publish$(config.payload.state_topic, value ? 'ON' : 'OFF')
                                .pipe(tap((v) => debug(v)))
                        })
                    )
            }
        })
    }
}
