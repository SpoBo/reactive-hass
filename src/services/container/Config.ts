import { from, Observable } from "rxjs";

import convict from "convict";

import yaml from "js-yaml";

convict.addParser({ extension: ['yml', 'yaml'], parse: yaml.load });
convict.addFormat(require('convict-format-with-validator').url);

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
};

export interface IRootConfig {
    host: string;
    token: string;
}

export default class Config {

    root$(): Observable<IRootConfig> {
        const config = convict(CONVICT_SCHEMA).loadFile("./data/config.yaml");

        config.validate();

        const root: IRootConfig = { host: config.get('host'), token: config.get('token') }

        return from([ root ]);
    }
}
