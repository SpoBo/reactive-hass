/**
 * Pure helper functions for Tesla charging logic.
 * These functions are stateless and easily testable.
 */

/**
 * Calculate the optimal charging amperage based on available solar power
 *
 * @param availableWatts - Available solar overhead in watts
 * @param wattsPerAmp - Watts consumed per amp (typically 230W for 230V)
 * @param minAmps - Minimum charging current
 * @param maxAmps - Maximum charging current
 * @returns Optimal amperage clamped between min and max
 */
export function calculateOptimalAmps(
  availableWatts: number,
  wattsPerAmp: number,
  minAmps: number,
  maxAmps: number
): number {
  const targetAmps = Math.floor(availableWatts / wattsPerAmp);
  return Math.max(minAmps, Math.min(maxAmps, targetAmps));
}

/**
 * Determine if there's enough solar power to start charging
 *
 * @param averageWatts - Rolling average of available solar overhead
 * @param minAmps - Minimum charging current required
 * @param wattsPerAmp - Watts consumed per amp
 * @returns true if we can start charging at minimum amps
 */
export function canStartCharging(
  averageWatts: number,
  minAmps: number,
  wattsPerAmp: number
): boolean {
  const minWattsNeeded = minAmps * wattsPerAmp;
  return averageWatts >= minWattsNeeded;
}

/**
 * Determine if we should stop charging due to insufficient solar
 *
 * @param averageWatts - Rolling average of available solar overhead
 * @param minAmps - Minimum charging current
 * @param wattsPerAmp - Watts consumed per amp
 * @returns true if solar overhead is below minimum charging requirement
 */
export function shouldStopCharging(
  averageWatts: number,
  minAmps: number,
  wattsPerAmp: number
): boolean {
  const minWattsNeeded = minAmps * wattsPerAmp;
  return averageWatts < minWattsNeeded;
}

/**
 * Determine if charging amperage should be adjusted
 *
 * @param currentAmps - Current charging amperage
 * @param averageWatts - Rolling average of available solar overhead
 * @param wattsPerAmp - Watts consumed per amp
 * @param minAmps - Minimum charging current
 * @param maxAmps - Maximum charging current
 * @returns Object with shouldAdjust flag and new amperage
 */
export function shouldAdjustAmps(
  currentAmps: number,
  averageWatts: number,
  wattsPerAmp: number,
  minAmps: number,
  maxAmps: number
): { shouldAdjust: boolean; newAmps: number } {
  const optimalAmps = calculateOptimalAmps(
    averageWatts,
    wattsPerAmp,
    minAmps,
    maxAmps
  );

  return {
    shouldAdjust: optimalAmps !== currentAmps,
    newAmps: optimalAmps,
  };
}

/**
 * Calculate house base load by subtracting car charging power from total power
 *
 * @param totalPowerWatts - Total power consumption from P1 meter
 * @param carPowerKw - Current car charging power in kW
 * @param isCharging - Whether the car is currently charging
 * @returns House base load in watts (excluding car charging)
 */
export function calculateHouseBaseLoad(
  totalPowerWatts: number,
  carPowerKw: number,
  isCharging: boolean
): number {
  const carWatts = isCharging ? carPowerKw * 1000 : 0;
  return totalPowerWatts - carWatts;
}

/**
 * Calculate solar overhead (available production)
 * Negative house load means we're producing more than we're consuming
 *
 * @param houseBaseLoadWatts - House power consumption excluding car
 * @returns Solar overhead in watts (positive = excess production)
 */
export function calculateSolarOverhead(houseBaseLoadWatts: number): number {
  return -houseBaseLoadWatts;
}
