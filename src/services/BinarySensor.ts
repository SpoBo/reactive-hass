import DEBUG from 'debug'
import { EMPTY } from 'rxjs'
import { map, shareReplay, switchMap, switchMapTo, take, tap } from 'rxjs/operators'
import { ValueControl } from '../helpers/ValueControl'
import { IServicesCradle } from './cradle'
import Discovery from './Discovery'
import Mqtt from './Mqtt'
const debug = DEBUG('reactive-hass.binary-sensor')

type BinarySensorOptions = {
    name?: string
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

    create(id: string, defaultState: boolean, options?: BinarySensorOptions): ValueControl<boolean> {
        debug('asking for a binary sensor with id %s with defaultState %s and options %o', id, defaultState, options)

        const config$ = this
            .discovery
            .create$(id, 'binary_sensor', { name: options?.name })
            .pipe(
                map((discovery) => {
                    return {
                        topic: discovery.topics.config,
                        payload: {
                            ...discovery.payload
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

        return new ValueControl<boolean>({
            id,
            defaultState,
            run$: advertise$,
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
