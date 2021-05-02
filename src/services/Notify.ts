import { Observable } from "rxjs";
import DEBUG from "debug";

import { IServicesCradle } from "./cradle";
import Service from "./Service";

const debug = DEBUG("reactive-hass.notify");

// TODO: Would be cool if we can also have responses to the notification.
export default class Notify {
    private service: Service

    constructor(dependencies: IServicesCradle) {
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
