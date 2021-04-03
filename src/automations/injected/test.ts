import { merge, of } from 'rxjs'
import { IServicesCradle } from '../../services/index'

export default function test$(cradle: IServicesCradle) {
    const messages$ = cradle.socket.messages$()

    const login$ = cradle.socket.send$({ type: 'auth' })

    const test$ = of('test')

    return merge(
        messages$,
        login$,
        test$
    )
}
