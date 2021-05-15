import { EMPTY } from "rxjs"
import { IServicesCradle } from "../../services/cradle"

/*
 * Detects when it is dark outside.
 * When it is dark outside we will want other stuff to happen.
 *
 * It exposes an input boolean.
 */
export default function outsideBrightness$(cradle: IServicesCradle) {
    return EMPTY
}
