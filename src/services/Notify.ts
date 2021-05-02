import { Observable } from "rxjs";
import DEBUG from "debug";

import Config from "./Config";
import { IServicesCradle } from "./cradle";
import Service from "./Service";

const debug = DEBUG("reactive-hass.notify");

// TODO: Notification service.
//       Would be cool if we can also have responses to the notification.
export default class Notify {
    private config: Config
    private service: Service

    constructor(dependencies: IServicesCradle) {
        this.config = dependencies.config
        this.service = dependencies.service
    }

    /**
     * Sends a single notification.
     */
    single$(message: String): Observable<boolean> {
        debug('notifying:', message)
        return this.service.call$({
            domain: 'notify',
            service: 'mobile_app_mi_9t_pro',
            service_data: {
                message
            }
        })
    }
}
