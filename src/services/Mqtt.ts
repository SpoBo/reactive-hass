import DEBUG from "debug";

import {
    connect,
    IClientPublishOptions,
    IPubrecPacket,
} from "mqtt";

import { concat, Observable, fromEvent, Subject } from "rxjs";
import { filter, map, switchMap, tap, shareReplay, take, takeUntil } from "rxjs/operators";
import Config from "./Config";
import { IServicesCradle } from "./cradle";

export interface ISimplifiedMqttClient {
    message$: Observable<[ string, Buffer, IPubrecPacket ]>;
    subscribe$: ({ topic }: { topic: string }) => Observable<any>;
    publish$: ({
        topic,
        payload,
        options,
    }: { topic: string; payload: string | Buffer; options?: IClientPublishOptions }) => Observable<any>;
}

const debug = DEBUG("reactive-hass.mqtt");

function mqttClient (url: string): Observable<ISimplifiedMqttClient> {
    return new Observable((subscriber) => {
        debug("going to connect");

        const client = connect(url);

        client.on("close", () => {
            debug("close");
        });

        client.on("connect", () => {
            debug("connect");

            subscriber.next({
                message$: fromEvent(client, "message"),
                publish$: ({
                    options,
                    payload,
                    topic,
                }: { topic: string; payload: string | Buffer; options?: IClientPublishOptions }) => {
                    debug('publishing to topic %s -> %j', topic, payload)

                    return new Observable((publishSubscriber) => {
                        if (!options) {
                            options = { qos: 1 };
                        }

                        client.publish(topic, payload, options, (err) => {
                            if (err) {
                                publishSubscriber.error(err);
                            }

                            debug('completing')
                            publishSubscriber.complete();
                        });
                    });
                },
                subscribe$: ({ topic }: { topic: string }) => {
                    return new Observable((subscribeSubscriber) => {
                        client.subscribe(topic, (err) => {
                            if (err) {
                                subscribeSubscriber.error(err);
                            }

                            subscribeSubscriber.complete();
                        });
                    });
                },
            });
        });

        if (process.env.DEBUG_MQTT_EVENTS) {
            client.on("reconnect", () => {
                debug("reconnect");
            });

            client.on("disconnect", () => {
                debug("disconnect");
            });

            client.on("offline", () => {
                debug("offline");
            });

            client.on("error", () => {
                debug("error");
            });

            client.on("message", (msg) => {
                debug("message", msg);
            });

            client.on("packetsend", (packet) => {
                debug("packetsend", packet);
            });

            client.on("packetreceive", (packet) => {
                debug("packereceive", packet);
            });
        }

        client.on("end", () => {
            subscriber.complete();

            if (process.env.DEBUG_MQTT_EVENTS) {
                debug("end");
            }
        });

        return () => {
            debug("request for socket termination");
            client.end();
        };
    })
    .pipe(
        // This hacky stuff is needed because of TypeScript.
        // Can this be fixed ?
        // In any case shareReplay is needed otherwise we thrash the socket after our first connection.
        (v) => shareReplay(1)(v) as Observable<ISimplifiedMqttClient>,
    );
}

export default class Mqtt {
    private config: Config;

    constructor(dependencies: IServicesCradle) {
        this.config = dependencies.config;
    }

    private get client$(): Observable<ISimplifiedMqttClient> {
        return this.config.root$()
        .pipe(
            switchMap(config => {
                return mqttClient(config.mqttUrl)
                    .pipe(shareReplay(1))
            })
        )
    }

    public subscribe$(topic: string) {
        return this.client$
            .pipe(
                switchMap((d) => {
                    const subscribe$ = d.subscribe$({ topic });

                    const replies$ = d.message$
                        .pipe(
                            filter(([ incomingTopic ]) => incomingTopic === topic),
                            map(([ _, buffer ]) => buffer.toString()),
                            tap({
                                next(msg) {
                                    debug("got message for topic %s -> %s", topic, msg);
                                },
                            }),
                        );

                    return concat(subscribe$, replies$);
                }),
            );
    }

    public publish$(topic: string, payload: string | Buffer | object, options?: IClientPublishOptions) {
        const done$ = new Subject()
        return this.client$
            .pipe(
                takeUntil(done$),
                switchMap((d) => {
                    if (typeof payload === "object") {
                        payload = JSON.stringify(payload);
                    }

                    return d
                        .publish$({ topic, payload, options }).pipe(tap({ complete() { done$.next() } }));
                }),
            );
    }
}
