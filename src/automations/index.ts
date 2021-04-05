import { merge, Observable } from 'rxjs'

import servicesCradle, { IServicesCradle } from '../services/cradle'

import requireDir from 'require-dir'

const services = requireDir('../../data/automations')

type Automation = (services: IServicesCradle) => Observable<any>

// NOTE: Every service expects the servicesCradle to be injected.
//       And every service is expected to output an observable.
// TODO: The output of the observable is never logged. Instead, use special services to log output from a specific automation.
// TODO: Every automation will automatically restart when it crashes. A crashing automation should not impact other automations.

const mapped = Object
    .entries(services as Record<string, { default: Automation }>)
    .reduce((acc, [ name, automation ]) => {
        // TODO: maybe create a scoped container specifically for the automation.
        // TODO: maybe inject extra services specific for the automation.
        // TODO: every automation can have a piece of config
        console.log('found automation', name)
        acc.push(automation.default(servicesCradle))
        return acc;
    }, [] as any[])

export default merge(...mapped)
