import DEBUG from "debug";

import { connect, IClientPublishOptions, IPublishPacket } from "mqtt";
import ms from "ms";

import { concat, Observable, fromEvent, Subject, EMPTY, merge, of } from "rxjs";
import {
  filter,
  map,
  switchMap,
  tap,
  shareReplay,
  takeUntil,
  delay,
} from "rxjs/operators";
import Config from "./Config";
import { IServicesCradle } from "./cradle";

export interface ISimplifiedMqttClient {
  message$: Observable<[string, Buffer, IPublishPacket]>;
  subscribe$: ({ topic }: { topic: string }) => Observable<unknown>;
  publish$: ({
    topic,
    payload,
    options,
  }: // TODO: Improve output type of MQTT Client.

  {
    topic: string;
    payload: string | Buffer;
    options?: IClientPublishOptions;
  }) => Observable<any>;
}

type MqttSubscribeOptions = {
  assumed?: string | object | Buffer;
};

const debug = DEBUG("reactive-hass.mqtt");

function mqttClient(url: string): Observable<ISimplifiedMqttClient> {
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
        }: {
          topic: string;
          payload: string | Buffer;
          options?: IClientPublishOptions;
        }) => {
          debug("publishing to topic %s -> %j", topic, payload);

          return new Observable((publishSubscriber) => {
            if (!options) {
              options = { qos: 1 };
            }

            client.publish(topic, payload, options, (err) => {
              if (err) {
                publishSubscriber.error(err);
              }

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
  }).pipe(
    // This hacky stuff is needed because of TypeScript.
    // Can this be fixed ?
    // In any case shareReplay is needed otherwise we thrash the socket after our first connection.
    (v) => shareReplay(1)(v) as Observable<ISimplifiedMqttClient>
  );
}

export default class Mqtt {
  private config: Config;
  private client$: Observable<ISimplifiedMqttClient>;

  constructor(dependencies: IServicesCradle) {
    this.config = dependencies.config;

    debug("constructing mqtt instance");
    this.client$ = this.config.root$().pipe(
      switchMap((config) => {
        return mqttClient(config.mqttUrl);
      }),
      shareReplay(1)
    );
  }

  public subscribe$(topic: string, options?: MqttSubscribeOptions) {
    const stream$ = this.client$.pipe(
      switchMap((d) => {
        const subscribe$ = d.subscribe$({ topic });

        const replies$ = d.message$.pipe(
          filter(([incomingTopic]) => incomingTopic === topic),
          map((args) => args[1].toString()),
          tap({
            next(msg) {
              debug("got message for topic %s -> %s", topic, msg);
            },
          })
        );

        return concat(subscribe$, replies$);
      })
    );

    const assumed$ = isPresent(options?.assumed)
      ? of(options?.assumed).pipe(
          delay(ms("2s")),
          takeUntil(stream$),
          switchMap((value) => {
            if (typeof value === "undefined") {
              return EMPTY;
            }

            return this.publish$(topic, value);
          })
        )
      : EMPTY;

    return merge(stream$, assumed$);
  }

  public publish$(
    topic: string,
    payload: string | Buffer | object,
    options?: IClientPublishOptions
  ) {
    const done$ = new Subject();
    return this.client$.pipe(
      takeUntil(done$),
      switchMap((d) => {
        if (typeof payload === "object") {
          payload = JSON.stringify(payload);
        }

        return d.publish$({ topic, payload, options }).pipe(
          tap({
            complete() {
              done$.next(true);
            },
          })
        );
      }),
      tap({
        complete() {
          debug("completed publish");
        },
      })
    );
  }
}

function isPresent(value: unknown) {
  return value !== null && typeof value !== "undefined";
}
