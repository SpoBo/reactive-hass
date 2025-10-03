/**
 * Weight generation functions for weighted moving averages.
 * Used to create weight arrays that prioritize recent or central values.
 */

/**
 * Generates exponentially decaying weights where recent values have more impact.
 * Most recent value has the highest weight, older values decay exponentially.
 *
 * Perfect for: Real-time adjustments where latest data is most relevant.
 *
 * Example with count=5, decay=0.5:
 * - Index 0 (oldest): 0.5^4 = 0.0625
 * - Index 1: 0.5^3 = 0.125
 * - Index 2: 0.5^2 = 0.25
 * - Index 3: 0.5^1 = 0.5
 * - Index 4 (newest): 0.5^0 = 1.0
 * After normalization: [0.032, 0.065, 0.129, 0.258, 0.516]
 *
 * @param count - Number of weights to generate
 * @param decay - Decay factor (0-1). Lower = more emphasis on recent values
 *                0.5 = heavy recency bias, 0.9 = mild recency bias
 * @returns Array of normalized weights (sum to 1)
 */
export function exponentialWeights(count: number, decay: number): number[] {
  if (count <= 0) {
    throw new Error("count must be positive");
  }
  if (decay <= 0 || decay >= 1) {
    throw new Error("decay must be between 0 and 1");
  }

  // Generate weights: oldest has highest power, newest has power 0
  const weights: number[] = [];
  for (let i = 0; i < count; i++) {
    const power = count - 1 - i; // Oldest = count-1, newest = 0
    weights.push(Math.pow(decay, power));
  }

  // Normalize to sum to 1
  const sum = weights.reduce((acc, w) => acc + w, 0);
  return weights.map((w) => w / sum);
}

/**
 * Generates linear weights where recent values have more impact.
 * Weights increase linearly from oldest to newest.
 *
 * Example with count=5:
 * - Index 0 (oldest): weight 1
 * - Index 1: weight 2
 * - Index 2: weight 3
 * - Index 3: weight 4
 * - Index 4 (newest): weight 5
 * After normalization: [0.067, 0.133, 0.200, 0.267, 0.333]
 *
 * @param count - Number of weights to generate
 * @returns Array of normalized weights (sum to 1)
 */
export function linearWeights(count: number): number[] {
  if (count <= 0) {
    throw new Error("count must be positive");
  }

  // Generate weights: 1, 2, 3, ..., count
  const weights = Array.from({ length: count }, (_, i) => i + 1);

  // Normalize to sum to 1
  const sum = weights.reduce((acc, w) => acc + w, 0);
  return weights.map((w) => w / sum);
}

/**
 * Generates Gaussian (bell curve) weights where central values have more impact.
 * Values in the middle of the window are weighted highest, edges are weighted lowest.
 *
 * Perfect for: Smoothing while maintaining signal integrity.
 *
 * @param count - Number of weights to generate
 * @param sigma - Standard deviation (controls width of bell curve). Default: count/6
 *                Smaller = narrower peak (emphasizes center more)
 * @returns Array of normalized weights (sum to 1)
 */
export function gaussianWeights(count: number, sigma?: number): number[] {
  if (count <= 0) {
    throw new Error("count must be positive");
  }

  // Default sigma: places ~99.7% of distribution within the window
  const effectiveSigma = sigma ?? count / 6;
  const mean = (count - 1) / 2; // Center of the window

  // Generate Gaussian weights using PDF formula
  const weights: number[] = [];
  for (let i = 0; i < count; i++) {
    const exponent = -Math.pow(i - mean, 2) / (2 * Math.pow(effectiveSigma, 2));
    weights.push(Math.exp(exponent));
  }

  // Normalize to sum to 1
  const sum = weights.reduce((acc, w) => acc + w, 0);
  return weights.map((w) => w / sum);
}
