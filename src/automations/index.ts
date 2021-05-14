import { EMPTY, merge, Observable } from 'rxjs'

import servicesCradle, { IServicesCradle } from '../services/cradle'

import requireDir from 'require-dir'

import DEBUG from 'debug'
import { switchMap } from 'rxjs/operators'

const services = requireDir('./')

const debug = DEBUG('reactive-hass.automations')

export type AutomationOptions = {
    debug: (message?: any, ...optionalParams: any[]) => void;
}

type Automation = (services: IServicesCradle, options: AutomationOptions) => Observable<any>

// NOTE: This is not ideal. But using RxJS causes a lot of listeners to build up at once.
//       I should hunt down where exactly the issue is. Perhaps it could be avoided by sharing.
require('events').EventEmitter.defaultMaxListeners = Infinity;

// NOTE: Every service expects the servicesCradle to be injected.
//       And every service is expected to output an observable.
// TODO: The output of the observable is never logged. Instead, use special services to log output from a specific automation.
// TODO: Every automation will automatically restart when it crashes. A crashing automation should not impact other automations.

const { discoverySwitch } = servicesCradle

const { RUN } = process.env

let observable$: Observable<any> = EMPTY

if (RUN) {
    if (!services[RUN]) {
        throw new Error(`Running automation ${RUN} but it does not exist. Either start it without RUN env parameter or give it the name of an automation that does exist.`)
    }

    observable$ = services[RUN].default(servicesCradle, { debug: DEBUG('reactive-hass.run-automation.' + RUN) })
} else {
    const mapped = Object
        .entries(services as Record<string, { default: Automation }>)
        .map(([ name, automation ]) => {
            console.log('found automation', name)
            const switch$ = discoverySwitch.create$(
                name,
                true,
                {
                    name: `Reactive Hass Automation: ${name}`
                }
            )

            // TODO: maybe create a scoped container specifically for the automation.
            // TODO: maybe inject extra services specific for the automation.
            // TODO: every automation can have a piece of config

            return switch$
                .pipe(
                    switchMap(state => {
                        if (state.on) {
                            console.log('starting automation', name)
                            return automation.default(servicesCradle, { debug: DEBUG('reactive-hass.automation.' + name) })
                        }

                        console.log('stopping automation', name)
                        return EMPTY
                    })
                )
        })

    observable$ = merge(...mapped)
}

export default observable$
