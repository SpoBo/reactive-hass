import { delay, filter, map, shareReplay, switchMap, switchMapTo, take, tap } from "rxjs/operators";
import DEBUG from "debug";

import { concat, empty, merge, Observable, of } from "rxjs";

import Config from "./Config";
import WebSocket from "../helpers/WebSocket";
import { URL } from "url";
import { Lifetime, RESOLVER } from "awilix";
import { MessageBase } from "../../types";

const debug = DEBUG("reactive-hass.socket");

type SocketManager = {
    messages$: Observable<any>
    send$: (message: any) => Observable<boolean>
    next: () => number
    sendWithId$: (message: any) => Observable<any>,
}

export type SocketErrorType = {
    code: string
    message: string
}

export default class Socket {
    config: Config;

    socket$: Observable<SocketManager>;

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

                    const socket = new WebSocket(ws)

                    const stringMessages$ = socket
                        .messages$
                        .pipe(
                            map(msg => typeof msg.data === 'string' ? msg.data : null),
                            filter(v => !!v)
                        )

                    // We know for a fact it can only be a string here.
                    const parsedMessages$: Observable<MessageBase> = (stringMessages$ as Observable<string>)
                        .pipe(
                            map(v => JSON.parse(v))
                        )

                    const authRequired$ = parsedMessages$
                        .pipe(
                            filter(msg => msg.type === 'auth_required'),
                            tap(() => debug('auth required!'))
                        )

                    const rawSend$ = (msg: any) => {
                        return socket.send$(JSON.stringify(msg))
                    }


                    const sendAuth$ = rawSend$({ type: 'auth', access_token: config.token })
                        .pipe(
                            switchMapTo(empty())
                        )

                    const respondToAuthentication$ = authRequired$
                        .pipe(
                            tap(() => {
                                debug('sending auth!')
                            }),
                            switchMap(() => sendAuth$)
                        )

                    const ensureAuthenticated$ = of(1)
                        .pipe(
                            delay(1000),
                            switchMapTo(empty())
                        )

                    let i = 0;
                    function next() {
                        i += 1
                        return i
                    }

                    const messages$ = merge(respondToAuthentication$, parsedMessages$)

                    const send$ = (msg: any) => {
                        return concat(ensureAuthenticated$, rawSend$(msg))
                    }

                    const messagesForId$ = (id: number) => {
                        return messages$
                            .pipe(
                                filter((item: any) => {
                                    return !!item && item.id === id
                                })
                            )
                    }

                    return {
                        messages$,
                        send$,
                        sendWithId$(message: Record<string, unknown>) {
                            const id = next()

                            const result$ = messagesForId$(id)

                            const sendAndHide$ = send$({...message, id})
                                .pipe(switchMapTo(empty()))

                            return merge(result$, sendAndHide$)
                        },
                        next
                    };
                }),
                shareReplay(1)
            )
    }

    // TODO: Filter to be only stuff possible for HA
    /**
     * This is a way to send raw stuff on the socket.
     * Normally you should not be using this.
     */
    send$(message: any): Observable<boolean> {
        return this
            .socket$
            .pipe(
                switchMap((socket) => {
                    return socket.send$(message)
                })
            )
    }

    single$(type: string): Observable<any> {
        return this
            .socket$
            .pipe(
                switchMap((socket) => {
                    return socket
                        .sendWithId$({ type })
                        .pipe(
                            take(1)
                        )
                })
            )
    }

    subscribe$(message: Record<string, unknown>): Observable<any> {
        return this
            .socket$
            .pipe(
                switchMap((socket) => {
                    return socket
                        .sendWithId$(message)
                        .pipe(
                            filter(v => {
                                return v.type !== 'result'
                            })
                        )
                })
            )
    }

    invoke$(message: Record<string, unknown>): Observable<any> {
        return this
            .socket$
            .pipe(
                switchMap((socket) => {
                    return socket
                        .sendWithId$(message)
                        .pipe(
                            filter(v => {
                                return v.type === 'result'
                            }),
                        )
                })
            )
    }

    // TODO: Filter to be only stuff possible for HA
    //       see types.ts. We have at least a 'type' attribute.
    get messages$(): Observable<Record<string, unknown>> {
        return this
            .socket$
            .pipe(
                switchMap(socket => {
                    return socket.messages$
                })
            )
    }
}

(Socket as any)[RESOLVER] = {
  lifetime: Lifetime.SINGLETON
}
