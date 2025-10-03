import DEBUG from "debug";
import { Observable, combineLatest } from "rxjs";
import { map, distinctUntilChanged, shareReplay, tap } from "rxjs/operators";
import Mqtt from "./Mqtt";
import { IServicesCradle } from "./cradle";

const debug = DEBUG("reactive-hass.teslamate-mqtt");

/**
 * Service for subscribing to Teslamate MQTT topics.
 * Teslamate publishes car data to topics like: teslamate/cars/{car_id}/{field}
 *
 * This service provides reactive observables for all relevant car state fields
 * needed for smart charging decisions.
 */
export default class TeslamateMqtt {
  private mqtt: Mqtt;
  private carId: number;
  private baseTopicPrefix: string;

  constructor(dependencies: IServicesCradle, carId: number = 1) {
    this.mqtt = dependencies.mqtt;
    this.carId = carId;
    this.baseTopicPrefix = `teslamate/cars/${this.carId}`;
    debug(`Initialized TeslamateMqtt for car ${carId}`);
  }

  /**
   * Subscribe to a specific field from Teslamate MQTT
   */
  private subscribeField$<T>(
    field: string,
    transform: (value: string) => T
  ): Observable<T> {
    const topic = `${this.baseTopicPrefix}/${field}`;
    debug(`Subscribing to topic: ${topic}`);

    return this.mqtt.subscribe$(topic).pipe(
      tap(() => debug(`First emission for topic ${topic}`)),
      map((value) => {
        const stringValue = value.toString();
        const transformed = transform(stringValue);
        debug(
          `Received ${field}: "${stringValue}" -> ${JSON.stringify(transformed)}`
        );
        return transformed;
      }),
      distinctUntilChanged(),
      shareReplay(1)
    );
  }

  /**
   * Geofence location (e.g., "Home", "Work", etc.)
   */
  get geofence$(): Observable<string> {
    return this.subscribeField$("geofence", (v) => v);
  }

  /**
   * Whether the car is plugged in (true/false)
   */
  get pluggedIn$(): Observable<boolean> {
    return this.subscribeField$("plugged_in", (v) => v === "true");
  }

  /**
   * Charging state: "Charging", "Complete", "Disconnected", "Stopped", etc.
   */
  get chargingState$(): Observable<string> {
    return this.subscribeField$("charging_state", (v) => v);
  }

  /**
   * Current battery level (0-100%)
   */
  get batteryLevel$(): Observable<number> {
    return this.subscribeField$("battery_level", (v) => Number(v));
  }

  /**
   * Charge limit set by user (0-100%)
   */
  get chargeLimitSoc$(): Observable<number> {
    return this.subscribeField$("charge_limit_soc", (v) => Number(v));
  }

  /**
   * Current charging rate in kW
   */
  get chargerPower$(): Observable<number> {
    return this.subscribeField$("charger_power", (v) => Number(v));
  }

  /**
   * Actual charging current in Amps
   */
  get chargerActualCurrent$(): Observable<number> {
    return this.subscribeField$("charger_actual_current", (v) => Number(v));
  }

  /**
   * Charging voltage
   */
  get chargerVoltage$(): Observable<number> {
    return this.subscribeField$("charger_voltage", (v) => Number(v));
  }

  /**
   * Car state: "online", "asleep", "offline", etc.
   */
  get state$(): Observable<string> {
    return this.subscribeField$("state", (v) => v);
  }

  /**
   * Time to full charge in hours
   */
  get timeToFullCharge$(): Observable<number> {
    return this.subscribeField$("time_to_full_charge", (v) => Number(v));
  }

  /**
   * Ideal battery range in km/miles
   */
  get idealBatteryRange$(): Observable<number> {
    return this.subscribeField$("ideal_battery_range_km", (v) => Number(v));
  }

  /**
   * Whether the car is currently at home (convenience observable)
   */
  get isAtHome$(): Observable<boolean> {
    return this.geofence$.pipe(
      map((geofence) => geofence === "Home"),
      distinctUntilChanged()
    );
  }

  /**
   * Whether the car is eligible to charge
   * (at home, plugged in, connected, and below charge limit)
   */
  get isEligibleToCharge$(): Observable<boolean> {
    return combineLatest([
      this.isAtHome$,
      this.pluggedIn$,
      this.isConnected$,
      this.batteryLevel$,
      this.chargeLimitSoc$,
    ]).pipe(
      map(([isAtHome, pluggedIn, isConnected, batteryLevel, chargeLimit]) => {
        const needsCharging = batteryLevel < chargeLimit;
        const eligible = isAtHome && pluggedIn && isConnected && needsCharging;
        debug(
          `Eligible to charge: ${eligible} (home=${isAtHome}, plugged=${pluggedIn}, connected=${isConnected}, battery=${batteryLevel}%, limit=${chargeLimit}%)`
        );
        return eligible;
      }),
      distinctUntilChanged(),
      shareReplay(1)
    );
  }

  /**
   * Whether charging is currently active
   */
  get isCharging$(): Observable<boolean> {
    return this.chargingState$.pipe(
      map((state) => state === "Charging"),
      distinctUntilChanged()
    );
  }

  /**
   * Whether the car is connected to charger (plugged in and state is Connected/Charging/Complete)
   */
  get isConnected$(): Observable<boolean> {
    return this.chargingState$.pipe(
      map((state) => {
        return (
          state === "Connected" ||
          state === "Charging" ||
          state === "Complete" ||
          state === "Stopped"
        );
      }),
      distinctUntilChanged()
    );
  }

  /**
   * Whether the battery needs charging (current level < target limit)
   */
  get needsCharging$(): Observable<boolean> {
    return combineLatest([this.batteryLevel$, this.chargeLimitSoc$]).pipe(
      map(([batteryLevel, chargeLimit]) => {
        const needs = batteryLevel < chargeLimit;
        debug(
          `Needs charging: ${needs} (battery=${batteryLevel}%, limit=${chargeLimit}%)`
        );
        return needs;
      }),
      distinctUntilChanged(),
      shareReplay(1)
    );
  }
}
