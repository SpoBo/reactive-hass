/**
 * Configuration for Tesla smart charging system
 */
export const CHARGING_CONFIG = {
  /**
   * Minimum charging current in Amps
   * At 230V, this is approximately 1.2 kW
   */
  minAmps: 5,

  /**
   * Maximum charging current in Amps
   * At 230V, this is approximately 3.0 kW
   */
  maxAmps: 13,

  /**
   * Watts per amp (based on 230V single-phase)
   */
  wattsPerAmp: 230,

  /**
   * Total usable battery capacity in kWh
   * Model 3 Standard Range Plus: 78.7 kWh usable
   */
  batteryCapacityKwh: 78.7,

  /**
   * Rolling average window for starting charging
   * Conservative 3-minute average to avoid starting on temporary spikes
   */
  startWindow: "3m" as const,

  /**
   * Rolling average window for adjusting charging amperage
   * Quick 30-second response for dynamic adjustment
   */
  adjustWindow: "30s" as const,

  /**
   * Rolling average window for stopping charging
   * Conservative 3-minute average to avoid stopping on temporary dips
   */
  stopWindow: "3m" as const,
} as const;

export type ChargingConfig = typeof CHARGING_CONFIG;
