import { createContainer, InjectionMode, asClass } from 'awilix'

import Config from './Config'
import Socket from './Socket'
import States from './States'
import Events from './Events'
import Service from './Service'

export interface IServicesCradle {
  config: Config,
  socket: Socket,
  states: States,
  events: Events,
  service: Service,
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
})

export default container.cradle as IServicesCradle
