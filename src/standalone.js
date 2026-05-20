import { VtkWASMLoader } from "./wasmLoader";
import { createFuture } from "./core/future";
import { createInstantiatorProxy } from "./core/proxy";
import { isGzipBundle } from "./core/gzipBundle";

/**
 * Create a VTK namespace for handling vtk object creation.
 *
 * @param {String} url - Optional directory to where VTK.wasm is getting served from,
 *                  or a `.gz` / `blob:` URL pointing to a gzip bundle.
 *                  If vtkWebAssemblyInterface.mjs is already loaded as a script,
 *                  this will be ignored.
 * @param {Object} config
 * @param {String} wasmBaseName
 *
 * @returns the vtk namespace for creating VTK objects.
 */
export async function createNamespace(url, config = {}, wasmBaseName = "vtk") {
  const vtkProxyCache = new WeakMap();
  const idToRef = new Map();

  const loader = new VtkWASMLoader();
  await loader.load(url || "loaded-module", config, wasmBaseName);
  const wasm = loader.createStandaloneSession();

  return createInstantiatorProxy(wasm, vtkProxyCache, idToRef);
}

/**
 * Create a VTK namespace by loading WASM from a gzip bundle URL.
 *
 * Accepts either:
 *  - A remote URL ending in `.gz` (e.g. `https://example.com/vtk.tar.gz`)
 *  - A `blob:` URL referencing an in-memory gzip bundle
 *
 * @param {String} url - A `.gz` remote URL or a `blob:` URL for the gzip bundle.
 * @param {Object} config
 * @param {String} wasmBaseName
 *
 * @returns the vtk namespace for creating VTK objects.
 */
export async function createNamespaceFromGzip(url, config = {}, wasmBaseName = "vtk") {
  if (!isGzipBundle(url)) {
    throw new Error(
      `createNamespaceFromGzip: expected a URL ending in ".gz" or a "blob:" URL, got "${url}".`
    );
  }
  return createNamespace(url, config, wasmBaseName);
}

/**
 * Create a VTK namespace by loading WASM from a base directory URL.
 *
 * The loader will look for a file named
 * `${wasmBaseName}WebAssembly${execModeSuffix}.mjs` under `url`, falling back
 * to the legacy `vtkWasmSceneManager.mjs` when necessary.
 *
 * @param {String} url - Base URL of the directory that serves the WASM files.
 * @param {Object} config
 * @param {String} wasmBaseName
 *
 * @returns the vtk namespace for creating VTK objects.
 */
export async function createNamespaceFromBaseURL(url, config = {}, wasmBaseName = "vtk") {
  if (isGzipBundle(url)) {
    throw new Error(
      `createNamespaceFromBaseURL: expected a base directory URL, not a gzip/blob URL. ` +
      `Use createNamespaceFromGzip for ".gz" or "blob:" URLs.`
    );
  }
  return createNamespace(url, config, wasmBaseName);
}

/**
 * If the script is tagged with id="vtk-wasm", a global "vtk" namespace
 * will be created automatically. Since the namespace creation is asynchronous,
 * a global "vtkReady" promise will be provided to enable code synchronization.
 *
 * Possible data attributes:
 *  - data-url="url to load VTK.wasm from" only needed if VTK.wasm is not already loaded.
 *  - data-config="{ rendering: 'webgl|webgpu', exec: 'sync|async' }" json config for
 *    WASM module configuration.
 */
const { promise, resolve, reject } = createFuture();
const script = document.querySelector("#vtk-wasm");
if (script) {
  const url = script.dataset.url || ".";
  const config = JSON.parse(script.dataset.config || "{}");
  window.vtkReady = promise;
  createNamespace(url, config)
    .then((vtk) => {
      window.vtk = vtk;
      resolve(vtk);
    })
    .catch(reject);
} else {
  reject("Automatic VTK namespace initialization is disabled because no <script id=\"vtk-wasm\"> tag was found. See https://kitware.github.io/vtk-wasm/guide/js/plain.html#defer-wasm-loading-with-annotation'");
}
