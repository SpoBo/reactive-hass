import { createContainer, InjectionMode, asClass, asFunction } from "awilix";

import Config from "./Config";
import Socket from "./Socket";
import States from "./States";
import Events from "./Events";
import Service from "./Service";
import Mqtt from "./Mqtt";
import DiscoverySwitch from "./DiscoverySwitch";
import Notify from "./Notify";
import HassStatus from "./HassStatus";
import BinarySensor from "./BinarySensor";
import Discovery from "./Discovery";
import Rest from "./Rest";
import History from "./History";
import TeslaBle from "./TeslaBle";
import TeslamateMqtt from "./TeslamateMqtt";

const TESLA_CONFIG = {
  baseUrl: "http://10.0.0.15:8080",
  vin: "LRW3E7EK9NC512649",
  teslamateCarId: 1,
} as const;

export interface IServicesCradle {
  config: Config;
  socket: Socket;
  states: States;
  events: Events;
  service: Service;
  mqtt: Mqtt;
  rest: Rest;
  history: History;
  discovery: Discovery;
  discoverySwitch: DiscoverySwitch;
  notify: Notify;
  hassStatus: HassStatus;
  binarySensor: BinarySensor;
  teslaBle: TeslaBle;
  teslamateMqtt: TeslamateMqtt;
}

// sets up awilix ... .
const container = createContainer({
  injectionMode: InjectionMode.PROXY,
});

// just register the services.
container.register({
  config: asClass(Config, { lifetime: "SINGLETON" }),
  socket: asClass(Socket, { lifetime: "SINGLETON" }),
  states: asClass(States, { lifetime: "SINGLETON" }),
  events: asClass(Events, { lifetime: "SINGLETON" }),
  service: asClass(Service, { lifetime: "SINGLETON" }),
  mqtt: asClass(Mqtt, { lifetime: "SINGLETON" }),
  rest: asClass(Rest, { lifetime: "SINGLETON" }),
  history: asClass(History, { lifetime: "SINGLETON" }),
  discovery: asClass(Discovery, { lifetime: "SINGLETON" }),
  discoverySwitch: asClass(DiscoverySwitch, { lifetime: "SINGLETON" }),
  notify: asClass(Notify, { lifetime: "SINGLETON" }),
  hassStatus: asClass(HassStatus, { lifetime: "SINGLETON" }),
  binarySensor: asClass(BinarySensor, { lifetime: "SINGLETON" }),
  teslaBle: asFunction(
    () => new TeslaBle(TESLA_CONFIG.baseUrl, TESLA_CONFIG.vin),
    { lifetime: "SINGLETON" }
  ),
  teslamateMqtt: asFunction(
    (cradle) => new TeslamateMqtt(cradle, TESLA_CONFIG.teslamateCarId),
    { lifetime: "SINGLETON" }
  ),
});

export default container.cradle as IServicesCradle;
