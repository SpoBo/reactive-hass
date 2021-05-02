import { createContainer, InjectionMode, asClass } from 'awilix'

import Config from './Config'
import Socket from './Socket'
import States from './States'
import Events from './Events'
import Service from './Service'
import Mqtt from './Mqtt'
import DiscoverySwitch from './DiscoverySwitch'
import Notify from './Notify'

export interface IServicesCradle {
  config: Config,
  socket: Socket,
  states: States,
  events: Events,
  service: Service,
  mqtt: Mqtt,
  discoverySwitch: DiscoverySwitch
  notify: Notify
}

// sets up awilix ... .
const container = createContainer({
  injectionMode: InjectionMode.PROXY
})

// just register the services.
container.register({
    config: asClass(Config),
    socket: asClass(Socket),
    states: asClass(States),
    events: asClass(Events),
    service: asClass(Service),
    mqtt: asClass(Mqtt),
    discoverySwitch: asClass(DiscoverySwitch),
    notify: asClass(Notify),
})

export default container.cradle as IServicesCradle
