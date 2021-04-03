import { map, share, switchMap } from "rxjs/operators";
import DEBUG from "debug";

import { Observable } from "rxjs";

import Config from "./Config";
import WebSocket from "../helpers/WebSocket";
import { URL } from "url";
import { Lifetime, RESOLVER } from "awilix";

const debug = DEBUG("reactive-hass.socket");

type MessageType = object

export default class Socket {
    config: Config;

    socket$: Observable<WebSocket>;

    constructor({ config }: { config: Config }) {
        this.config = config

        this.socket$ = this
            .config
            .root$()
            .pipe(
                map((config) => {
                    // TODO: Automatically log in when needed !
                    //       Do this by observing the messages we see and inject a auth,access_token request when we see auth_required.
                    debug('making new websocket for HA with config %j', config)

                    const url = new URL(config.host)
                    const ws = `ws${url.protocol === 'https:' ? 's' : ''}://${url.host}/api/websocket`
                    return new WebSocket(ws)
                }),
                share()
            )
    }

    // TODO: Filter to be only stuff possible for HA
    send$(message: MessageType): Observable<boolean> {
        return this
            .socket$
            .pipe(
                switchMap((socket) => {
                    debug('sending message!', message)
                    return socket.send$(JSON.stringify(message))
                })
            )
    }

    // TODO: Filter to be only stuff possible for HA
    //       see types.ts. We have at least a 'type' attribute.
    messages$(): Observable<any> {
        return this
            .socket$
            .pipe(
                switchMap(socket => {
                    return socket.messages$()
                    .pipe(
                        map(event => {
                            if (typeof event.data === 'string') {
                                return JSON.parse(event.data)
                            }

                            return event
                        })
                    )
                })
            )
    }
}

(Socket as any)[RESOLVER] = {
  lifetime: Lifetime.SINGLETON
}
