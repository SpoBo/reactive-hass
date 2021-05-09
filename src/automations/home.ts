import { EMPTY } from "rxjs";
import { tap } from "rxjs/operators";
import { AutomationOptions } from ".";
import { IServicesCradle } from "../services/cradle";

/**
 * Controls if someone is home or not.
 */
export default function (services: IServicesCradle, { debug }: AutomationOptions) {
    const current$ = services.states.entity$('group.occupants')

    return current$
        .pipe(
            tap(v => debug(v))
        )
}
