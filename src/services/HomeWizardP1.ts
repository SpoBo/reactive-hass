import DEBUG from "debug";
import {
  Observable,
  shareReplay,
  map,
  interval,
  switchMap,
  startWith,
  catchError,
  EMPTY,
} from "rxjs";
import { P1MeterApi } from "homewizard-energy-api";

const debug = DEBUG("r-h.homewizard-p1");

const POLL_INTERVAL_MS = 1000; // Poll every 1 second

export interface HomeWizardP1Data {
  active_power_w: number;
  active_power_l1_w?: number;
  active_power_l2_w?: number;
  active_power_l3_w?: number;
  total_power_import_t1_kwh: number;
  total_power_import_t2_kwh: number;
  total_power_export_t1_kwh: number;
  total_power_export_t2_kwh: number;
  total_gas_m3?: number;
  gas_timestamp?: number;
}

/**
 * Service for connecting to HomeWizard P1 Meter via local API
 * Uses the homewizard-energy-api package for type-safe access
 */
export default class HomeWizardP1 {
  private api: P1MeterApi;

  constructor(ipAddress: string) {
    this.api = new P1MeterApi(`http://${ipAddress}`);
    debug(`Initialized HomeWizard P1 API at ${ipAddress}`);
  }

  /**
   * Observable stream of P1 meter data
   * Polls the API every second for fresh data
   */
  get data$(): Observable<HomeWizardP1Data> {
    return interval(POLL_INTERVAL_MS).pipe(
      startWith(0), // Start immediately
      switchMap(() => this.api.getData()),
      map((response) => {
        debug("P1 data received:", {
          active_power_w: response.active_power_w,
          active_power_l1_w: response.active_power_l1_w,
          active_power_l2_w: response.active_power_l2_w,
          active_power_l3_w: response.active_power_l3_w,
        });
        return response as HomeWizardP1Data;
      }),
      catchError((err) => {
        debug("Error fetching P1 data:", err.message);
        return EMPTY;
      }),
      shareReplay(1)
    );
  }

  /**
   * Observable of current active power in watts
   * Negative values indicate power export (solar production)
   */
  get activePower$(): Observable<number> {
    return this.data$.pipe(
      map((data) => data.active_power_w),
      shareReplay(1)
    );
  }

  /**
   * Observable of active power on phase 1
   */
  get activePowerL1$(): Observable<number | undefined> {
    return this.data$.pipe(
      map((data) => data.active_power_l1_w),
      shareReplay(1)
    );
  }

  /**
   * Observable of active power on phase 2
   */
  get activePowerL2$(): Observable<number | undefined> {
    return this.data$.pipe(
      map((data) => data.active_power_l2_w),
      shareReplay(1)
    );
  }

  /**
   * Observable of active power on phase 3
   */
  get activePowerL3$(): Observable<number | undefined> {
    return this.data$.pipe(
      map((data) => data.active_power_l3_w),
      shareReplay(1)
    );
  }

  /**
   * Observable of total power import (both tariffs combined)
   */
  get totalPowerImport$(): Observable<number> {
    return this.data$.pipe(
      map(
        (data) =>
          data.total_power_import_t1_kwh + data.total_power_import_t2_kwh
      ),
      shareReplay(1)
    );
  }

  /**
   * Observable of total power export (both tariffs combined)
   */
  get totalPowerExport$(): Observable<number> {
    return this.data$.pipe(
      map(
        (data) =>
          data.total_power_export_t1_kwh + data.total_power_export_t2_kwh
      ),
      shareReplay(1)
    );
  }

  /**
   * Observable of total gas consumption in m³
   */
  get totalGas$(): Observable<number | undefined> {
    return this.data$.pipe(
      map((data) => data.total_gas_m3),
      shareReplay(1)
    );
  }

  /**
   * Get device information (one-time call)
   */
  async getBasicInfo() {
    debug("Fetching basic device info...");
    const info = await this.api.getBasicInformation();
    debug("Device info:", info);
    return info;
  }
}
