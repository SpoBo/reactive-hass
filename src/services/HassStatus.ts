import { IServicesCradle } from "./cradle"
import Mqtt from "./Mqtt"
import DEBUG from 'debug'
import { Observable } from "rxjs"
import { filter, map, share, shareReplay, startWith, tap } from "rxjs/operators"

const debug = DEBUG('reactive-hass.hass-status')

export default class HassStatus {
    private mqtt: Mqtt
    private status$: Observable<string>

    constructor(dependencies: IServicesCradle) {
        this.mqtt = dependencies.mqtt

        this.status$ = this.mqtt
            .subscribe$('hass/status')
            .pipe(
                tap((v) => {
                    debug('status %s', v)
                }),
                shareReplay(1)
            )
    }

    /**
     * nexts whenever HASS goes online.
     */
    get online$(): Observable<boolean> {
        return this.status$
            .pipe(
                map(v => v === 'online'),
                filter(v => v),
                startWith(true)
            )
    }
}
