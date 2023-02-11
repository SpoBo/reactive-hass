import { Observable } from "rxjs";
import { IServicesCradle } from "./cradle";
import DEBUG from "debug";
import { StateChangedEvent } from "../types";
import Socket from "./Socket";
import { map } from "rxjs/operators";

const debug = DEBUG("reactive-hass.events");

type StateChangedEventData = StateChangedEvent["data"];

type CreateEventStreamOptions = {
  type: string;
  event_type?: string;
};

export default class Events {
  socket: Socket;

  constructor(dependencies: IServicesCradle) {
    this.socket = dependencies.socket;
  }

  private createEventStream$(
    msg: CreateEventStreamOptions
  ): Observable<StateChangedEventData> {
    debug("creating events stream for %j", msg);
    return this.socket.subscribe$(msg).pipe(
      map((item) => {
        return item.event.data;
      })
    );
  }

  get all$(): Observable<StateChangedEventData> {
    return this.createEventStream$({ type: "subscribe_events" });
  }

  type$(eventType: string): Observable<StateChangedEventData> {
    return this.createEventStream$({
      type: "subscribe_events",
      event_type: eventType,
    });
  }

  get stateChanged$(): Observable<StateChangedEventData> {
    return this.type$("state_changed");
  }
}
