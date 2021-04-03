import DEBUG from "debug";
import { timer } from "rxjs";

import { catchError, map, switchMapTo } from "rxjs/operators";
import { config$ } from "./config";

const debug = DEBUG("reactive-hass.index");

const process$ = config$()
  .pipe(
    map((config) => {
      // TODO: Add the automations.
      return config
    }),
  );

// TODO: log ENV var containing the commit hash.
// TODO: Set that ENV var during Dockerfile build.
debug("starting up");

process$
  .pipe(
    catchError((e, obs$) => {
      console.error(e);

      return timer(5000)
        .pipe(switchMapTo(obs$));
    }),
  )
  .subscribe({
    complete() {
      debug("completed process");
      process.exit(0)
    },
  });
