import DEBUG from "debug";
import { EMPTY, Observable, throwError } from "rxjs";
import { switchMap, tap } from "rxjs/operators";
import { HassServiceTarget } from "../types";
import { IServicesCradle } from "./cradle";
import Socket, { SocketErrorType } from "./Socket";

const debug = DEBUG("reactive-hass.service");

type CallServiceParameters = {
  domain: string;
  service: string;
  target?: HassServiceTarget;
  service_data?: {
    // TODO: type the callserviceparams for the service_data.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    [key: string]: any;
  };
};

export default class Service {
  socket: Socket;

  constructor(dependencies: IServicesCradle) {
    this.socket = dependencies.socket;
  }

  call$(options: CallServiceParameters): Observable<never> {
    return this.socket.invoke$({ type: "call_service", ...options }).pipe(
      tap(() => debug("triggering %j", options)),
      switchMap((v) =>
        v.success
          ? EMPTY
          : throwError(new ServiceInvocationError(options, v.error))
      )
    );
  }
}

class ServiceInvocationError extends Error {
  constructor(
    public request: CallServiceParameters,
    public error: SocketErrorType
  ) {
    super(`failed to invoke service ${request.domain}:${request.service}`);
  }
}
