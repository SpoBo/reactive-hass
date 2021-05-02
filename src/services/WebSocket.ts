import { map, share, shareReplay, switchMap } from "rxjs/operators";
import WS, { MessageEvent } from "ws";
import DEBUG from "debug";

import { fromEvent, Observable, of } from "rxjs";

const debug = DEBUG("reactive-hass.web-socket");

export type WebSocketMessageType =
  | ArrayBufferLike
  | ArrayBufferView
  | string

export type SocketManager = {
    messages$: Observable<MessageEvent>,
    send$: (message: WebSocketMessageType) => Observable<boolean>
}

/**
 * NOTE: This is not injected with awilix.
 */
export default class WebSocket {
    url: string;

    private manager$: Observable<SocketManager>

    constructor(url: string) {
        debug('building WebSocket instance for url %s', url)
        this.url = url

        const socket$ = new Observable<WS>(function(observer) {
            debug('creating socket with url %s', url)
            const ws = new WS(url)

            const error$ = fromEvent(ws, 'error')
            const close$ = fromEvent(ws, 'close')

            const open$ = fromEvent(ws, 'open')

            const cleanup = [
                error$.subscribe({
                    next(error: any) { // ErrorEvent
                        debug('got error event %j', error)
                        observer.error(error)
                    }
                }),
                close$.subscribe({
                    next() {
                        debug('completed websocket')
                        observer.complete()
                    }
                }),
                open$.subscribe({
                    next() {
                        observer.next(ws)
                    }
                })
            ]

            return () => {
                debug('cleaning up after websocket')
                cleanup.forEach(v => v.unsubscribe())
            }
        })

        const sharedSocket$ = socket$
            .pipe(
                shareReplay(1)
            )

        const messages$ = sharedSocket$
            .pipe(
                switchMap(socket => {
                    return fromEvent(socket, 'message')
                        .pipe(
                            map(event => {
                                return event as MessageEvent
                            })
                        )
                })
            )

        function send$(message: WebSocketMessageType) {
            return sharedSocket$
                .pipe(
                    switchMap(socket => {
                        debug('sending message %j', message)
                        // TODO: ensure we connect first ... .
                        socket.send(message)

                        return of(true)
                    })
                )
        }

        this.manager$ = of({
            messages$,
            send$
        })
        .pipe(
            share()
        )
    }

    send$(message: WebSocketMessageType): Observable<boolean> {
        return this
            .manager$
            .pipe(
                switchMap((manager) => {
                    return manager.send$(message)
                })
            )
    }

    get messages$(): Observable<MessageEvent> {
        return this
            .manager$
            .pipe(
                switchMap(socket => {
                    return socket.messages$
                })
            )
    }
}
