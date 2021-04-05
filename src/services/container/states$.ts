import { Observable } from "rxjs";
import { IServicesCradle } from "..";
import { HassEntityBase } from "../../types"

export default function(dependencies: IServicesCradle) {
    const socket = dependencies.socket

    const response$ = socket
        .command$('get_states')

    return <Observable<HassEntityBase[]>><unknown>response$
}
