// Public entry point of `@kitware/vtk-wasm`. The public API is documented on
// the declarations in types/base.d.ts, which is what TypeDoc renders.
import { loadAsync, VtkWasmRuntime } from "./runtime";
import { StandaloneSession } from "./standaloneSession";
import { RemoteSession } from "./remoteSession";

export { loadAsync, VtkWasmRuntime, StandaloneSession, RemoteSession };

export let ready;

export let session;

if (typeof window !== "undefined") {
  const script = document.querySelector("#vtk-wasm");
  if (script) {
    const url = script.dataset.url || ".";
    const config = JSON.parse(script.dataset.config || "{}");
    ready = loadAsync({ url, ...config }).then((runtime) => {
      session = runtime.createStandaloneSession();
      return session.vtk;
    });
  }
}
