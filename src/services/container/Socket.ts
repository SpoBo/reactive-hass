import { delay, filter, map, shareReplay, switchMap, switchMapTo, take, tap } from "rxjs/operators";
import DEBUG from "debug";

import { concat, empty, merge, Observable, of } from "rxjs";

import Config from "./Config";
import WebSocket from "../helpers/WebSocket";
import { URL } from "url";
import { Lifetime, RESOLVER } from "awilix";

const debug = DEBUG("reactive-hass.socket");

type SocketManager = {
    messages$: Observable<any>
    send$: (message: any) => Observable<boolean>
    next: () => number
    single$: (message: any) => Observable<any>,
    multiple$: (message: any) => Observable<any>
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

                    const parsedMessages$ = stringMessages$

                    const authRequired$ = parsedMessages$
                        .pipe(
                            filter(msg => {
                                if (!msg) {
                                    return false
                                }

                                const parsed = JSON.parse(msg)
                                return parsed.type === 'auth_required'
                            }),
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
                                tap((v) => debug('msg', v)),
                                filter((item: any) => {
                                    return !!item && item.id === id
                                }),
                                map(item => item.result)
                            )
                    }

                    return {
                        messages$,
                        send$,
                        single$(message: object) {
                            const id = next()

                            const result$ = messagesForId$(id)
                                .pipe(
                                    take(1)
                                )

                            return merge(result$, send$({...message, id}))
                        },
                        multiple$(message: object) {
                            const id = next()

                            const result$ = messagesForId$(id)

                            return merge(result$, send$({...message, id}))
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

    command$(type: string): Observable<any> {
        debug('command$ %s', type)
        return this
            .socket$
            .pipe(
                switchMap((socket) => {
                    return socket
                        .single$({ type })
                })
            )
    }

    stream$(message: object): Observable<any> {
        return this
            .socket$
            .pipe(
                switchMap((socket) => {
                    return socket
                        .multiple$(message)
                })
            )
    }

    // TODO: Filter to be only stuff possible for HA
    //       see types.ts. We have at least a 'type' attribute.
    get messages$(): Observable<Object> {
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
