import { Observable } from "rxjs";
import { IServicesCradle } from "..";
import { HassEntityBase } from "../../types"

export type serviceType = Observable<HassEntityBase[]>

export default function(dependencies: IServicesCradle) {
    const socket = dependencies.socket

    const response$ = socket
        .command$('get_states')

    return <unknown>response$ as serviceType
}
