import { merge, of } from "rxjs";
import { distinctUntilChanged, map, mergeScan, switchMap } from "rxjs/operators";
import { AutomationOptions } from "./index";
import { IServicesCradle } from "../services/cradle";

// TODO: Put in config
const OCCUPANTS = [ 'person.vincent', 'person.marife' ]

/**
 * Controls if someone is home or not.
 *
 * TODO: determine if someone is arriving home or not and expose extra states around that.
 */
export default function (services: IServicesCradle, { debug }: AutomationOptions) {
    const entities$ = of(...OCCUPANTS)
        .pipe(
            map(entity => {
                return services.states.entity$(entity)
            })
        )

    const homePerPerson$ = entities$
        .pipe(
            mergeScan((acc: {[key: string]: string}, entity$) => {
                return entity$
                .pipe(
                    map(v => {
                        acc[v.entity_id] = v.state
                        return acc
                    })
                )
            }, {})
        )

    const someoneHome$ = homePerPerson$
        .pipe(
            map(totals => {
                debug('totals', totals)
                return Object.values(totals).some(v => v === 'home')
            }),
            distinctUntilChanged()
        )

    const homeSwitch = services.binarySensor
        .create(`someone_home`, false, { name: 'Someone Home' })

    const set$ = someoneHome$
        .pipe(
            switchMap((value) => {
                debug('setting someone home to', value)
                return homeSwitch.set(value)
            })
        )

    return merge(
        homeSwitch.state$,
        set$
    )
}
