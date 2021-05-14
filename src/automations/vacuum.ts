import { EMPTY } from "rxjs"
import { IServicesCradle } from "../services/cradle"

/*
 * Makes the vacuum clean when nobody is home.
 * But it should ask permission then.
 *
 * Can also ask to clean when we go to sleep that evening.
 *
 * In any case it should always ask permission because there could be stuff on the ground.
 *
 * And finally when the bin is full (if I can detect it) or after X cleans it should drive to the trashcan.
 */
export default function vacuum$(cradle: IServicesCradle) {
    return EMPTY
}
