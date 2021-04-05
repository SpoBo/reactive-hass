import { merge } from 'rxjs'
import { IServicesCradle } from '../../services/index'

export default function test$(cradle: IServicesCradle) {
    const stuff = [
        //cradle.states.all$,
        cradle.states.entity$('sensor.tx')
    ]

    return merge(
        ...stuff
    )
}
