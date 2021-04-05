import { createContainer, InjectionMode, asClass, asFunction } from 'awilix'
import Config from './container/Config'
import Socket from './container/Socket'
import States from './container/States'
import Events from './container/Events'
import Service from './container/Service'

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
