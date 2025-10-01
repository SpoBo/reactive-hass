import Config from "./Config";
import { IServicesCradle } from "./cradle";
import { Observable } from "rxjs";
import { map, switchMapTo, tap } from "rxjs/operators";
import HassStatus from "./HassStatus";
import DEBUG from "debug";

const debug = DEBUG("reactive-hass.discovery");

type DiscoveryDevice = {
  model: string;
  identifiers: string[];
};

type DiscoveryPayload = {
  unique_id: string;
  name: string;
  state_topic: string;
  object_id: string;
  device: DiscoveryDevice;
};

type DiscoveryState = {
  topics: {
    root: string;
    config: string;
  };
  payload: DiscoveryPayload;
};

/**
 * Discovery helps us build discovery services.
 * The problem with home assistant discovery is that it will not see your discovery entities after a restart of home assistant.
 * Unless the entities re-announce themselves.
 */
export default class Discovery {
  private config: Config;
  private hassStatus: HassStatus;

  constructor(dependencies: IServicesCradle) {
    this.config = dependencies.config;
    this.hassStatus = dependencies.hassStatus;
  }

  /**
   * TODO: Would be nice if we could receive the config and automatically emit it when needed.
   **/
  create$(
    id: string,
    categoryName: string,
    options?: { name?: string }
  ): Observable<DiscoveryState> {
    const prefix$ = this.config.root$().pipe(
      map((config) => {
        const uniqueId = [config.idPrefix, categoryName, id]
          .filter((v) => v)
          .join("-");

        const objectId = `${config.objectId}_${id}`;
        const root = `${config.mqttDiscoveryPrefix}/${categoryName}/${uniqueId}`;

        debug(`Creating discovery for ${categoryName}/${id} with object_id: ${objectId}`);

        return {
          topics: {
            root,
            config: `${root}/config`,
          },
          payload: {
            object_id: objectId,
            unique_id: uniqueId,
            state_topic: `${root}/state`,
            name: options?.name ?? id,
            device: {
              model: "Reactive HASS",
              identifiers: [config.objectId],
            },
          },
        };
      })
    );

    return this.hassStatus.online$.pipe(switchMapTo(prefix$));
  }
}
