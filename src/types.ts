// This comes from https://github.com/home-assistant/home-assistant-js-websocket/blob/master/lib/types.ts

type Error = 1 | 2 | 3 | 4;

type UnsubscribeFunc = () => void;

export type MessageBase = {
  id?: number;
  type: string;
  [key: string]: any;
};

type HassContext = {
    id: string;
    user_id: string | null;
    parent_id: string | null;
}

type HassEventBase = {
  origin: string;
  time_fired: string;
  context: HassContext;
};

type HassEvent = HassEventBase & {
  event_type: string;
  data: { [key: string]: any };
};

type StateChangedEvent = HassEventBase & {
  event_type: "state_changed";
  data: StateChangedEventData;
};

export type StateChangedEventData = {
  entity_id: string;
  new_state: HassEntity | null;
  old_state: HassEntity | null;
  context: HassContext;
};

 type HassConfig = {
  latitude: number;
  longitude: number;
  elevation: number;
  unit_system: {
    length: string;
    mass: string;
    volume: string;
    temperature: string;
  };
  location_name: string;
  time_zone: string;
  components: string[];
  config_dir: string;
  allowlist_external_dirs: string[];
  allowlist_external_urls: string[];
  version: string;
  config_source: string;
  safe_mode: boolean;
  state: "NOT_RUNNING" | "STARTING" | "RUNNING" | "STOPPING" | "FINAL_WRITE";
  external_url: string | null;
  internal_url: string | null;
};

export type HassEntityBase = {
  entity_id: string;
  state: string;
  last_changed: string;
  last_updated: string;
  attributes: HassEntityAttributeBase;
  context: { id: string; user_id: string | null };
};

type HassEntityAttributeBase = {
  friendly_name?: string;
  unit_of_measurement?: string;
  icon?: string;
  entity_picture?: string;
  supported_features?: number;
  hidden?: boolean;
  assumed_state?: boolean;
  device_class?: string;
  // catch-all for attributes ... .
  [key: string]: any;
};

type HassEntity = HassEntityBase & {
  attributes: { [key: string]: any };
};

type HassEntities = { [entity_id: string]: HassEntity };

type HassService = {
  name?: string;
  description: string;
  target?: HassServiceTarget | null;
  fields: {
    [field_name: string]: {
      name?: string;
      description: string;
      example: string | boolean | number;
      selector?: Record<string, unknown>;
    };
  };
};

type HassDomainServices = {
  [service_name: string]: HassService;
};

type HassServices = {
  [domain: string]: HassDomainServices;
};

type HassUser = {
  id: string;
  is_owner: boolean;
  name: string;
};

export type HassServiceTarget = {
  entity_id?: string | string[];
  device_id?: string | string[];
  area_id?: string | string[];
};
