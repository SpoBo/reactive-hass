import { concat, empty, merge, Observable, of } from 'rxjs'

import servicesCradle, { IServicesCradle } from '../services/cradle'

import requireDir from 'require-dir'

import DEBUG from 'debug'
import { switchMap } from 'rxjs/operators'

const services = requireDir('./')

const debug = DEBUG('reactive-hass.automations')

type Automation = (services: IServicesCradle) => Observable<any>

// NOTE: This is not ideal. But using RxJS causes a lot of listeners to build up at once.
//       I should hunt down where exactly the issue is. Perhaps it could be avoided by sharing.
require('events').EventEmitter.defaultMaxListeners = Infinity;

// NOTE: Every service expects the servicesCradle to be injected.
//       And every service is expected to output an observable.
// TODO: The output of the observable is never logged. Instead, use special services to log output from a specific automation.
// TODO: Every automation will automatically restart when it crashes. A crashing automation should not impact other automations.

const { discoverySwitch } = servicesCradle

const mapped = Object
    .entries(services as Record<string, { default: Automation }>)
    .map(([ name, automation ]) => {
        console.log('found automation', name)
        const switch$ = discoverySwitch.create$(name)

        // TODO: maybe create a scoped container specifically for the automation.
        // TODO: maybe inject extra services specific for the automation.
        // TODO: every automation can have a piece of config

        return switch$
            .pipe(
                switchMap(state => {
                    if (state.on) {
                        console.log('starting automation', name)
                        return automation.default(servicesCradle)
                    }

                    console.log('stopping automation', name)
                    return empty()
                })
            )
    })

export default merge(...mapped)
