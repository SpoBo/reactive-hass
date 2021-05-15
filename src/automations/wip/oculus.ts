import { EMPTY } from "rxjs"
import { IServicesCradle } from "../services/cradle"

/*
 * Turns on the kitchen lights when the Oculus is active and it is becoming dark outside.
 * It's important because if the Oculus does not have enough light to work you get VR sickness.
 */
export default function oculus$(cradle: IServicesCradle) {
    return EMPTY
}
