import { createContainer, InjectionMode, asClass, Lifetime } from 'awilix'
import Config from './container/Config'
import Socket from './container/Socket'

export interface IServicesCradle {
  config: Config,
  socket: Socket
}

// sets up awilix ... .
const container = createContainer({
  injectionMode: InjectionMode.PROXY
})

// just register the services.
container.register({
    config: asClass(Config, { lifetime: Lifetime.SINGLETON }),
    socket: asClass(Socket, { lifetime: Lifetime.SINGLETON })
})

export default container.cradle as IServicesCradle
