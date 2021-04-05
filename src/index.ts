import DEBUG from "debug";
import { timer } from "rxjs";

import { catchError, switchMapTo, tap } from "rxjs/operators";

import automations$ from "./automations/index"

const debug = DEBUG("reactive-hass.index");

const process$ = automations$
  .pipe(
    tap((output) => {
      debug(output)
    }),
  );

// TODO: log ENV var containing the commit hash.
// TODO: Set that ENV var during Dockerfile build.
debug("starting up");

process$
  .pipe(
    catchError((e, obs$) => {
      console.error('process errored', e);

      return timer(5000)
        .pipe(switchMapTo(obs$));
    }),
  )
  .subscribe({
    complete() {
      debug("completed process");
      process.exit(0)
    }
  });
