import requireDir from "require-dir";
import { LoadFactory, LoadId } from "../types";

/**
 * Auto-load all load factories from the loads directory.
 *
 * Each load file should export a default LoadFactory function.
 * Loads are automatically discovered and can be dropped into this directory.
 */
const loadModules = requireDir("./");

export const getLoadFactories = (): {
  factory: LoadFactory;
  id: LoadId;
  name: string;
}[] =>
  Object.entries(
    loadModules as Record<
      string,
      { default: LoadFactory; config?: { id: LoadId; name: string } }
    >
  ).map(([name, module]) => {
    if (!module.default) {
      throw new Error(`Load '${name}' does not export a default LoadFactory`);
    }
    console.log("found energy load", name);

    const config = module.config ?? {
      id: name as LoadId,
      name,
    };

    return {
      factory: module.default,
      id: config.id as LoadId,
      name: config.name,
    };
  });
