import { empty, Observable, of, throwError } from "rxjs";
import { IServicesCradle } from "..";
import DEBUG from "debug";
import Socket, { SocketErrorType } from "./Socket";
import { map, switchMap } from "rxjs/operators";
import { HassServiceTarget } from '../../types'

const debug = DEBUG("reactive-hass.service");

type CallServiceParameters = {
    domain: string
    service: string
    target?: HassServiceTarget;
    service_data?: {
        [key: string]: any
    }
}

export default class Service {
    socket: Socket

    constructor(dependencies: IServicesCradle) {
        this.socket = dependencies.socket
    }

    call$(options: CallServiceParameters): Observable<any> {
        debug('triggering %j', options)
        return this
            .socket
            .invoke$({ type: 'call_service', ...options })
            .pipe(
                switchMap(v => v.success ? empty() : throwError(new ServiceInvocationError(options, v.error)))
            )
    }
}

class ServiceInvocationError extends Error {
    constructor(public request: CallServiceParameters, public error: SocketErrorType) {
        super(`failed to invoke service ${request.domain}:${request.service}`)
    }
}
