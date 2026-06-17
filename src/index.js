/**
 * Public entry point of `@kitware/vtk-wasm`: load the runtime and create
 * standalone or remote sessions.
 *
 * @module @kitware/vtk-wasm
 */
import { loadAsync, VtkWasmRuntime } from "./runtime";
import { StandaloneSession } from "./standaloneSession";
import { RemoteSession } from "./remoteSession";

export { loadAsync, VtkWasmRuntime, StandaloneSession, RemoteSession };

/**
 * If the script is tagged with id="vtk-wasm", the runtime is loaded
 * automatically and `ready` resolves to the VTK namespace. Reach it via the
 * UMD global (`vtkwasm.ready`) or an ESM import
 * (`import { ready } from "@kitware/vtk-wasm"`). The owning standalone session
 * is kept module-private.
 *
 * Possible data attributes:
 *  - data-url="url to load VTK.wasm from" only needed if VTK.wasm is not already loaded.
 *  - data-config="{ rendering: 'webgl|webgpu', exec: 'sync|async' }" json config for
 *    WASM module configuration.
 */
export let ready;

if (typeof window !== "undefined") {
  const script = document.querySelector("#vtk-wasm");
  if (script) {
    const url = script.dataset.url || ".";
    const config = JSON.parse(script.dataset.config || "{}");
    ready = loadAsync({ url, ...config }).then(
      (runtime) => runtime.createStandaloneSession().vtk,
    );
  }
}
