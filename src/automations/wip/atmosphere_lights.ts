import { EMPTY } from "rxjs";

/*
 * Controls the atmosphere lights.
 *
 * When it is dark outside and somebody is home they should be on.
 * When gaming they should turn to some gamey colors.
 * When media is streaming they should dim.
 * When media is paused they should brighten.
 * The max brightness should also depend on how dark it is outside.
 */
export default function atmosphereLights$() {
  return EMPTY;
}
