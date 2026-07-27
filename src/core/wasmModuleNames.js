import { EXECUTION_MODES } from "./constants";

/**
 * Ordered list of candidate module base names (no extension) to look for.
 *
 * Newer VTK ships a single `${wasmBaseName}WebAssembly` binary that serves both
 * sync (`invoke`) and async (`invokeAsync`) execution. Older VTK shipped a split
 * pair: `${wasmBaseName}WebAssembly` (sync) and `${wasmBaseName}WebAssemblyAsync`
 * (async). When async is requested, try the `Async` name first so an old bundle
 * loads its async binary; a new bundle lacks it and falls through to the base.
 *
 * @param {string} wasmBaseName
 * @param {object} config
 * @returns {string[]}
 */
export function wasmModuleBaseNames(wasmBaseName, config) {
  const base = `${wasmBaseName}WebAssembly`;
  if (config?.exec === EXECUTION_MODES.ASYNC) {
    return [`${base}Async`, base];
  }
  return [base];
}
