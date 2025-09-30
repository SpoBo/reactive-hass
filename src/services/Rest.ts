/// <reference lib="dom" />
import DEBUG from "debug";
import { differenceInMilliseconds } from 'date-fns';
import { from, Observable, switchMap } from "rxjs";
import Config from "./Config";

const debug = DEBUG("reactive-hass.events");

type RestOptions = {
    method: 'GET' | 'POST',
    queryParams?: URLSearchParams
}

type PathType = string | (string | Date | undefined | null)[]

export default class Rest {
  config: Config;

  constructor({ config }: { config: Config }) {
      this.config = config;
  }

    fetch$<T extends any>(path: PathType, options: RestOptions): Observable<T> {
        return this
            .config
            .root$()
            .pipe(
                switchMap((config) => {
                    const doPromise = async () => {
                      const basePath = createBasePath(path)
                      const actualPath = options.queryParams ? `${basePath}?${options.queryParams.toString()}` : basePath;
                      const url = `${config.host}/api${actualPath}`;

                      debug('fetching URL', options.method, url);
                      const start = new Date().getTime();
                      try {
                        const result = await fetch(
                          url,
                          {
                            method: options.method, headers: { authorization: `Bearer ${config.token}` }
                          })
                        debug('success fetching', options.method, url, `${differenceInMilliseconds(new Date(), start)}ms`);

                        if (result.status >= 400) {
                          throw new Error(`bad status code ${result.status}`)
                        }

                        return result.json();
                      } catch(err: unknown) {
                        debug('failed fetching', options.method, url, typeof err === 'object' && err !== null && 'message' in err ? err.message : '', `${differenceInMilliseconds(new Date(), start)}ms`);
                        throw err;
                      }
                    }

                    return from(doPromise());
                })
            )
    }

    get$<T extends any>(path: PathType, options: Omit<RestOptions, 'method'>) {
        return this.fetch$<T>(path, { ...options, method: 'GET' });
    }
}

function createBasePath(path: PathType): string {
  return (typeof path === 'string' ? [path] : path)
    .reduce((acc: string, v) => {
      if (typeof v === 'undefined' || v === null) {
        return acc;
      }

      const append = (v instanceof Date ? v.toJSON() : v);
      return acc + (append.startsWith('/') ? append : `/${append}`);
    }, '');
}
