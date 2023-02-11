import { EMPTY, merge, Observable } from 'rxjs'

import servicesCradle, { IServicesCradle } from '../services/cradle'

import requireDir from 'require-dir'

import DEBUG from 'debug'
import { switchMap } from 'rxjs/operators'
import { SensorConfig } from '../types'

const services = requireDir('./')

const debug = DEBUG('reactive-hass.sensors')

export type SensorOptions = {
    debug: (message?: any, ...optionalParams: any[]) => void;
}

type Sensor = (services: IServicesCradle, options: SensorOptions) => Observable<string | boolean>

const { hassStatus } = servicesCradle;

let observable$: Observable<any> = EMPTY
const mapped = Object
    .entries(services as Record<string, { default?: Sensor, config?: SensorConfig }>)
    .map(([name, sensor]) => {
        if (!sensor.default) {
            throw new Error(`sensor '${name} does not expose a default function.'`)
        }

        debug(`found sensor '${name}'.`);
        const state$ = hassStatus
            .online$
            .pipe(
                switchMap(() => {
                    switch (sensor.config?.type ?? 'binary') {
                        case 'binary':
                            return sensor.default!(servicesCradle, { debug: DEBUG('reactive-hass.sensor.' + name) }) as Observable<boolean>;
                        default:
                            throw new Error(`sensor '${name} is not of a supported type.'`)
                    }
                })
            )

        return servicesCradle.binarySensor.create$(state$, name, false, { name: sensor.config?.name ?? name });
    });

observable$ = merge(...mapped);

export default observable$
