/// <reference lib="dom" />
/* eslint-disable no-undef */
import DEBUG from "debug";
import { from, Observable, switchMap, timeout, catchError, tap } from "rxjs";
import { exec } from "child_process";
import { promisify } from "util";

const debug = DEBUG("reactive-hass.tesla-ble");
const execAsync = promisify(exec);

const REQUEST_TIMEOUT_MS = 15000; // 15 seconds timeout for RxJS operators
const FETCH_TIMEOUT_MS = 60000; // 1 minute timeout for fetch calls
const SSH_HOST = "vincent@10.0.0.15";
const DOCKER_CONTAINER = "tesla-ble-http-proxy";

export interface TeslaChargeState {
  battery_level: number;
  charge_limit_soc: number;
  charging_state: "Charging" | "Stopped" | "Complete" | "Disconnected";
  charger_actual_current: number;
  charger_voltage: number;
  charger_power: number;
  charge_current_request: number;
  charge_current_request_max: number;
  battery_range: number;
  time_to_full_charge: number;
}

interface TeslaVehicleDataResponse {
  response: {
    response: {
      charge_state: TeslaChargeState;
    };
  };
}

interface TeslaCommandResponse {
  response: {
    result: boolean;
    reason?: string;
  };
}

/**
 * https://github.com/wimaha/TeslaBleHttpProxy
 *
 * It's a direct way to talk to your car via BLuetooth.
 * As if you were using the paid Fleet API but it's free.
 *
 * The problem is that using this API will keep the car awake.
 * Therefore it should only be used when the car is kept awake already to avoid phantom drain
 */
export default class TeslaBle {
  private baseUrl: string;
  private vin: string;

  constructor(baseUrl: string, vin: string) {
    this.baseUrl = baseUrl;
    this.vin = vin;
  }

  /**
   * Get the current charge state from the Tesla
   */
  getChargeState$(): Observable<TeslaChargeState> {
    const url = `${this.baseUrl}/api/1/vehicles/${this.vin}/vehicle_data?endpoints=charge_state`;

    debug("fetching charge state from", url);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    return from(
      fetch(url, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
        },
        signal: controller.signal,
      })
    ).pipe(
      tap(() => clearTimeout(timeoutId)),
      timeout(REQUEST_TIMEOUT_MS),
      switchMap(async (response) => {
        if (!response.ok) {
          throw new Error(
            `Failed to fetch charge state: ${response.status} ${response.statusText}`
          );
        }
        const data: TeslaVehicleDataResponse = await response.json();
        debug("charge state received:", data.response.response.charge_state);
        return data.response.response.charge_state;
      }),
      catchError((err) => {
        if (err.name === "TimeoutError") {
          debug(
            `Request timed out after ${REQUEST_TIMEOUT_MS}ms, restarting Tesla BLE proxy...`
          );
          return this.restartProxy$().pipe(
            switchMap(() => {
              throw new Error(
                "Tesla BLE proxy was hung and has been restarted"
              );
            })
          );
        }
        throw err;
      })
    );
  }

  /**
   * Restart the Tesla BLE HTTP Proxy docker container via SSH
   */
  private restartProxy$(): Observable<string> {
    const command = `ssh ${SSH_HOST} "docker restart ${DOCKER_CONTAINER}"`;
    debug(`Executing: ${command}`);

    return from(execAsync(command)).pipe(
      tap(({ stdout, stderr }) => {
        if (stdout) debug(`SSH stdout: ${stdout.trim()}`);
        if (stderr) debug(`SSH stderr: ${stderr.trim()}`);
        debug("Tesla BLE proxy container restarted successfully");
      }),
      switchMap(({ stdout }) => from([stdout.trim()]))
    );
  }

  /**
   * Start charging the Tesla
   */
  startCharging$(): Observable<boolean> {
    return this.sendCommand$("charge_start");
  }

  /**
   * Stop charging the Tesla
   */
  stopCharging$(): Observable<boolean> {
    return this.sendCommand$("charge_stop");
  }

  /**
   * Set the charging amperage (5-16A typical range)
   */
  setChargingAmps$(amps: number): Observable<boolean> {
    return this.sendCommand$("set_charging_amps", { charging_amps: amps });
  }

  /**
   * Set the charge limit percentage
   */
  setChargeLimit$(percent: number): Observable<boolean> {
    return this.sendCommand$("set_charge_limit", { percent });
  }

  /**
   * Send a command to the Tesla via the BLE HTTP Proxy
   */
  private sendCommand$(
    command: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    params?: Record<string, any>
  ): Observable<boolean> {
    const url = `${this.baseUrl}/api/1/vehicles/${this.vin}/command/${command}?wait=true`;

    debug("sending command", command, "with params", params);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    return from(
      fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: params ? JSON.stringify(params) : undefined,
        signal: controller.signal,
      })
    ).pipe(
      tap(() => clearTimeout(timeoutId)),
      timeout(REQUEST_TIMEOUT_MS),
      switchMap(async (response) => {
        if (!response.ok) {
          throw new Error(
            `Failed to send command ${command}: ${response.status} ${response.statusText}`
          );
        }
        const data: TeslaCommandResponse = await response.json();
        debug("command response:", data.response);

        if (!data.response.result) {
          throw new Error(
            `Command ${command} failed: ${data.response.reason || "unknown reason"}`
          );
        }

        return data.response.result;
      }),
      catchError((err) => {
        if (err.name === "TimeoutError") {
          debug(
            `Command ${command} timed out after ${REQUEST_TIMEOUT_MS}ms, restarting Tesla BLE proxy...`
          );
          return this.restartProxy$().pipe(
            switchMap(() => {
              throw new Error(
                `Tesla BLE proxy was hung during command ${command} and has been restarted`
              );
            })
          );
        }
        throw err;
      })
    );
  }
}
