import { createContainer, InjectionMode, asClass, Lifetime, asFunction } from 'awilix'
import Config from './container/Config'
import Socket from './container/Socket'
import states$ from './container/states$'

export interface IServicesCradle {
  config: Config,
  socket: Socket,
  states$: typeof states$
}

// sets up awilix ... .
const container = createContainer({
  injectionMode: InjectionMode.PROXY
})

// just register the services.
container.register({
    config: asClass(Config, { lifetime: Lifetime.SINGLETON }),
    socket: asClass(Socket, { lifetime: Lifetime.SINGLETON }),
    states$: asFunction(states$, { lifetime: Lifetime.SINGLETON })
})

export default container.cradle as IServicesCradle
