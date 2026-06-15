/**
 * Public entry point of `@kitware/vtk-wasm`: load the runtime and create
 * standalone or remote sessions.
 *
 * @module @kitware/vtk-wasm
 */
import { createFuture } from "./core/future";
import { loadVtkWasmAsync, VtkWasmRuntime } from "./runtime";
import { StandaloneSession } from "./standaloneSession";
import { RemoteSession } from "./remoteSession";

export { loadVtkWasmAsync, VtkWasmRuntime, StandaloneSession, RemoteSession };

/**
 * If the script is tagged with id="vtk-wasm", a global "vtk" namespace
 * will be created automatically. Since loading is asynchronous, a global
 * "vtkReady" promise (resolving to the namespace) is provided for code
 * synchronization, and the owning session is exposed as "vtkSession".
 *
 * Possible data attributes:
 *  - data-url="url to load VTK.wasm from" only needed if VTK.wasm is not already loaded.
 *  - data-config="{ rendering: 'webgl|webgpu', exec: 'sync|async' }" json config for
 *    WASM module configuration.
 */
if (typeof window !== "undefined") {
  const script = document.querySelector("#vtk-wasm");
  if (script) {
    const { promise, resolve, reject } = createFuture();
    const url = script.dataset.url || ".";
    const config = JSON.parse(script.dataset.config || "{}");
    window.vtkReady = promise;
    loadVtkWasmAsync({ url, ...config })
      .then((runtime) => {
        const session = runtime.createStandaloneSession();
        window.vtkSession = session;
        window.vtk = session.vtk;
        resolve(session.vtk);
      })
      .catch(reject);
  }
}
