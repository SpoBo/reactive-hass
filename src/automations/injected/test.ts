import { merge } from 'rxjs'
import { IServicesCradle } from '../../services/index'

export default function test$(cradle: IServicesCradle) {
    console.log(cradle.events$)
    const stuff = [
        cradle.events$('state_changed')
    ]

    return merge(
        ...stuff
    )
}
