import requireDir from "require-dir";
import { LoadFactory } from "../types";

/**
 * Auto-load all load factories from the loads directory.
 *
 * Each load file should export a default LoadFactory function.
 * Loads are automatically discovered and can be dropped into this directory.
 */
const loadModules = requireDir("./");

export const loadFactories: LoadFactory[] = Object.entries(
  loadModules as Record<string, { default: LoadFactory }>
).map(([name, module]) => {
  if (!module.default) {
    throw new Error(`Load '${name}' does not export a default LoadFactory`);
  }
  console.log("found energy load", name);
  return module.default;
});
