import { from, Observable } from "rxjs";

import convict from "convict";

import yaml from "js-yaml";

import { url } from "convict-format-with-validator";
import { shareReplay } from "rxjs/operators";
import DEBUG from "debug";

const debug = DEBUG("r-h.config");

convict.addParser({ extension: ["yml", "yaml"], parse: yaml.load });
convict.addFormat(url);

const CONVICT_SCHEMA = {
  host: {
    default: "https://homeassistant.local",
    doc: "The host for your Home Assistant instance. Needs to include the port if it is not the default port.",
    env: "HASS_HOST",
    format: "url",
  },
  token: {
    default: "1234",
    doc: "A long-lived access token. Create one on your account profile. https://www.home-assistant.io/docs/authentication/#your-account-profile",
    env: "HASS_TOKEN",
    format: String,
  },
  mqttDiscoveryPrefix: {
    default: "homeassistant",
    doc: "The prefix to use in MQTT for everything related to Reactive HASS.",
    env: "HASS_MQTT_DISCOVERY_PREFIX",
    format: String,
  },
  idPrefix: {
    default: "reactive_hass",
    doc: "A prefix to put on the IDs. Maybe you want to have a secondary instance during development with different IDs so there is no overlap.",
    env: "HASS_ID_PREFIX",
    format: String,
  },
  mqttUrl: {
    default: "mqtt://mqtt.local",
    doc: "The URL to use for MQTT",
    env: "HASS_MQTT_PREFIX",
    format: String,
  },
};

export interface IRootConfig {
  host: string;
  token: string;
  idPrefix?: string;
  mqttDiscoveryPrefix: string;
  mqttUrl: string;
  objectId: string;
}

export default class Config {
  root$(): Observable<IRootConfig> {
    const config = convict(CONVICT_SCHEMA).loadFile(
      process.env.CONFIG_PATH || "./config.yaml"
    );

    config.validate();

    const root: IRootConfig = {
      host: config.get("host"),
      token: config.get("token"),
      idPrefix: config.get("idPrefix"),
      mqttDiscoveryPrefix: config.get("mqttDiscoveryPrefix"),
      mqttUrl: config.get("mqttUrl"),
      objectId: "reactive-hass",
    };
    debug("root:", root);

    return from([root]).pipe(shareReplay(1));
  }
}
