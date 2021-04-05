import { createContainer, InjectionMode, asClass, asFunction } from 'awilix'
import Config from './container/Config'
import Socket from './container/Socket'
import states$, { serviceType as states$Type } from './container/states$'
import events$, { serviceType as events$Type } from './container/events$'

export interface IServicesCradle {
  config: Config,
  socket: Socket,
  states$: typeof states$
  events$: events$Type
}

// sets up awilix ... .
const container = createContainer({
  injectionMode: InjectionMode.PROXY
})

// just register the services.
container.register({
    config: asClass(Config),
    socket: asClass(Socket),
    states$: asFunction(states$),
    events$: asFunction(events$)
})

export default container.cradle as IServicesCradle
