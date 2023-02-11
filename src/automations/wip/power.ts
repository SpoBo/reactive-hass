import { EMPTY } from "rxjs";

/*
 * Detects when we are generating power or not. Exposes it as an input boolean.
 *
 * Will also announce when power generation starts and ends.
 * Will also try to emit it as a voice message to be played when someone arrives home.
 */
export default function outsideBrightness$() {
  return EMPTY;
}
