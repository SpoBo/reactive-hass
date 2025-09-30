import DEBUG from "debug";
import { merge, timer } from "rxjs";

import { catchError, switchMap, tap } from "rxjs/operators";

import sensors$ from "./sensors/index";
import automations$ from "./automations/index";

const debug = DEBUG("reactive-hass.index");

// NOTE: This is not ideal. But using RxJS causes a lot of listeners to build up at once.
//       I should hunt down where exactly the issue is. Perhaps it could be avoided by sharing.
 
require("events").EventEmitter.defaultMaxListeners = Infinity;

const process$ = merge(sensors$, automations$).pipe(
  tap((output) => {
    debug(output);
  })
);

// TODO: log ENV var containing the commit hash.
// TODO: Set that ENV var during Dockerfile build.
debug("starting up");

process$
  .pipe(
    catchError((e, obs$) => {
      console.error("process errored", e);

      return timer(5000).pipe(switchMap(() => obs$));
    })
  )
  .subscribe({
    complete() {
      debug("completed process");
      process.exit(0);
    },
  });
