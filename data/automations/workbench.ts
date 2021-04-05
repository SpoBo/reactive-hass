import ms from 'ms'
import { concat, empty, merge, of } from 'rxjs'
import { delay, filter, switchMap } from 'rxjs/operators'

import { IServicesCradle } from '../../src/services/cradle'

const twoSecondsDelay$ = of(null).pipe(delay(ms('2s')), filter(v => !!v))

export default function test$(cradle: IServicesCradle) {
    const turnOn$ = cradle.service.call$({
        domain: 'light',
        service: 'turn_on',
        target: { entity_id: 'light.atmosphere_lamp'}
    })

    const toggleLampOnAfterTwoSecondsOff$ = cradle.states
        .entity$('light.atmosphere_lamp')
        .pipe(
            switchMap(v => {
                return v.state === 'off' ? concat(twoSecondsDelay$, turnOn$) : empty()
            })
        )

    const stuff = [
        //cradle.states.all$,
        cradle.states.entity$('light.atmosphere_lamp'),
        /*
        cradle.service.call$({
            domain: 'light',
            service: 'toggle',
            target: { entity_id: 'light.atmosphere_lamp'}
        })
        */
        toggleLampOnAfterTwoSecondsOff$,
    ]

    return empty()
    /*
    return merge(
        ...stuff
    )
    */
}
