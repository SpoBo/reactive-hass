import DEBUG from "debug";
import {
  concat,
  EMPTY,
  merge,
  Observable,
  of,
  ReplaySubject,
  SubjectLike,
} from "rxjs";
import {
  map,
  mergeMapTo,
  pluck,
  shareReplay,
  switchMap,
  tap,
} from "rxjs/operators";

const debug = DEBUG("r-h.helpers.value-control");

type ValueControlPayload<T> = {
  id: string;
  defaultState: T;
  subject?: SubjectLike<T>;
  run$: Observable<unknown>;
  emit$: (value: boolean) => Observable<T>;
};

type ValueControlState<T> = {
  id: string;
  current: T;
};

// Could be something more generic .... like a switachable control.
// Can map to a BinarySensor, a Sensor, a Switch, etc ... .
// They can all have the exact same API.
// Just a different way of initializing it.
export class ValueControl<T> {
  private setSubject: SubjectLike<T>;
  private payload: ValueControlPayload<T>;
  state$: Observable<ValueControlState<T>>;

  constructor(payload: ValueControlPayload<T>) {
    this.setSubject = payload.subject || new ReplaySubject<T>(1);
    this.payload = payload;

    const default$ = of(this.payload.defaultState);

    const initial$ = default$.pipe(map((v) => v));

    const set$ = merge(
      this.setSubject as unknown as Observable<T>,
      initial$
    ).pipe(
      tap((v) => debug("set", v)),
      switchMap((value) => {
        debug("publishing!");
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return concat(this.payload.emit$(value as any), of(value));
      }),
      map((current) => {
        debug("getting value", current);
        return {
          id: this.payload.id,
          current,
        };
      })
    );

    this.state$ = merge(this.payload.run$.pipe(mergeMapTo(EMPTY)), set$).pipe(
      shareReplay(1)
    );
  }

  set(value: T): Observable<T> {
    debug("setting %s to %s", this.payload.id, value);
    this.setSubject.next(value);
    return this.state$.pipe(pluck("current"));
  }
}
