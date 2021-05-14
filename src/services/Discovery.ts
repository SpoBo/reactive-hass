import Config from "./Config"
import { IServicesCradle } from "./cradle"
import { Observable } from "rxjs"
import { map, switchMapTo } from "rxjs/operators"
import HassStatus from "./HassStatus"

type DiscoveryState = {
    prefix: string,
    id: string
}

/**
 * Discovery helps us build discovery services.
 * The problem with home assistant discovery is that it will not see your discovery entities after a restart of home assistant.
 * Unless the entities re-announce themselves.
 */
export default class Discovery {
    private config: Config
    private hassStatus: HassStatus

    constructor(dependencies: IServicesCradle) {
        this.config = dependencies.config
        this.hassStatus = dependencies.hassStatus
    }

    /**
     * TODO: Would be nice if we could receive the config and automatically emit it when needed.
     **/
    create$(id: string, categoryName: string): Observable<DiscoveryState> {
        const prefix$ = this.config
            .root$()
            .pipe(
                map(config => {
                    return {
                        prefix: config.mqttDiscoveryPrefix,
                        id: `reactive_hass-${categoryName}-${id}`
                    }
                })
            )

        return this.hassStatus.online$
            .pipe(switchMapTo(prefix$))
    }
}
