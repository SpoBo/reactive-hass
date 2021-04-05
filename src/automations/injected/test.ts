import { merge } from 'rxjs'
import { IServicesCradle } from '../../services/index'

export default function test$(cradle: IServicesCradle) {
    const stuff = [
        cradle.states$
    ]

    return merge(
        ...stuff
    )
}
