import { extractFilesFromGzipBundleAsync, fetchGzipBundleAsync } from "./core/gzipBundle";
import { createEmscriptenConfig, normalizeConfig, validateConfig } from "./core/configManager";
import { DEFAULT_CONFIG, DEFAULT_WASM_BASE_NAME, DEFAULT_WASM_URL_IS_GZIP, MIME_TYPES } from "./core/constants";
import { createScriptURLAsync, loadWebAssemblyModuleFromExistingScriptAsync, loadWebAssemblyModuleFromScriptAsync } from "./core/scriptLoader";
import { createBlobURL, disposeBlobURL } from "./core/blobURL";
import { StandaloneSession } from "./standaloneSession";
import { RemoteSession } from "./remoteSession";

// cacheKey => Promise<VtkWasmRuntime> for in-flight loads
const RUNTIME_PROMISES = new Map();
// cacheKey => VtkWasmRuntime for resolved runtimes
const RUNTIME_CACHE = new Map();

/**
 * Build a stable cache key. Only the inputs that change the loaded binary are
 * considered, so callbacks like `print` do not fragment the cache.
 */
function cacheKey(url, wasmBaseName, config) {
  return `${url}::${wasmBaseName}::${config.rendering}::${config.exec}`;
}

// Emscripten keeps `specialHTMLTargets` as a module-private variable, so there
// is no way to register a canvas element (vs. a CSS selector) from the outside.
// Alias it onto `Module` at its declaration so the runtime can expose it. The
// symbol is a non-minified library name, so this string match is stable.
const SPECIAL_TARGETS_DECL = "var specialHTMLTargets=[";
const SPECIAL_TARGETS_PATCH = "var specialHTMLTargets=Module.specialHTMLTargets=[";

/**
 * Patch the Emscripten glue source so `specialHTMLTargets` is reachable as
 * `Module.specialHTMLTargets`. No-op if the pattern is absent or already
 * patched (e.g. a build that already exports it).
 *
 * @param {ArrayBufferLike} buffer - the glue JavaScript source bytes.
 * @returns {ArrayBufferLike} the (possibly patched) source bytes.
 */
function exposeSpecialHTMLTargets(buffer) {
  const text = new TextDecoder().decode(buffer);
  if (text.includes(SPECIAL_TARGETS_PATCH) || !text.includes(SPECIAL_TARGETS_DECL)) {
    return buffer;
  }
  return new TextEncoder().encode(text.replace(SPECIAL_TARGETS_DECL, SPECIAL_TARGETS_PATCH)).buffer;
}

/**
 * Ensure `window.createVTKWASM` is available, loading the glue script if needed.
 * Returns the wasm binary descriptor when it had to be extracted from a gzip
 * bundle (so it can be handed to Emscripten), otherwise null.
 */
async function prepareModuleFactoryAsync(url, urlIsGzip, wasmBaseName, config) {
  if (!window.createVTKWASM) {
    await loadWebAssemblyModuleFromExistingScriptAsync(wasmBaseName);
  }
  if (window.createVTKWASM) {
    return null;
  }

  if (urlIsGzip) {
    const gzipArrayBuffer = await fetchGzipBundleAsync(url);
    const { js, wasm } = await extractFilesFromGzipBundleAsync(gzipArrayBuffer, config, wasmBaseName);
    const javaScriptBlobURL = createBlobURL(exposeSpecialHTMLTargets(js.buffer), MIME_TYPES.JAVASCRIPT);
    try {
      await loadWebAssemblyModuleFromScriptAsync(javaScriptBlobURL);
    } finally {
      disposeBlobURL(javaScriptBlobURL);
    }
    return wasm;
  }

  const scriptURL = await createScriptURLAsync(url, wasmBaseName, config);
  if (scriptURL !== null) {
    await loadWebAssemblyModuleFromScriptAsync(scriptURL);
  }
  return null;
}

async function instantiateAsync(url, urlIsGzip, wasmBaseName, config, key) {
  try {
    const wasmFile = await prepareModuleFactoryAsync(url, urlIsGzip, wasmBaseName, config);
    if (!window.createVTKWASM) {
      throw new Error(
        [
          "Could not load WebAssembly module: window.createVTKWASM is not available after loading scripts.",
          "Possible causes include:",
          `  - Incorrect or unreachable 'url' ("${url}")`,
          `  - Wrong 'wasmBaseName' ("${wasmBaseName}") or missing/misnamed .mjs/.wasm files in the bundle`,
          "  - Network or script loading failures (e.g., 404/500 responses)",
          "  - Content Security Policy (CSP) blocking script execution",
          "",
          "Next steps:",
          "  - Verify that the expected .mjs and .wasm files are present and accessible under 'url'",
          "  - Check the browser's Network/Console tabs for failed script requests or CSP errors.",
        ].join("\n"),
      );
    }
    const module = await window.createVTKWASM(createEmscriptenConfig(config, wasmFile));
    const runtime = new VtkWasmRuntime(module, key);
    RUNTIME_CACHE.set(key, runtime);
    return runtime;
  } finally {
    RUNTIME_PROMISES.delete(key);
  }
}

/**
 * Load the VTK.wasm runtime and return a {@link VtkWasmRuntime} ready to create
 * sessions. Runtimes are cached per (url, wasmBaseName, rendering, exec), so
 * repeated calls with the same options share a single WebAssembly module.
 *
 * If you want to pipe std::cout/std::cerr to the console, pass `print`/`printErr`.
 *
 * @param {object} [options]
 * @param {string} [options.url] - Directory or .tar.gz bundle to load VTK.wasm from.
 *        Ignored when the glue script is already present on the page.
 * @param {boolean} [options.urlIsGzip] - (default is `true`) specifies whether the 
 *        resource at `options.url` is a Gzip archive.
 * @param {string} [options.wasmBaseName] - Base name of the wasm bundle (default "vtk").
 * @param {"webgl"|"webgpu"} [options.rendering] - Rendering backend (default "webgl").
 * @param {"sync"|"async"} [options.exec] - Method execution mode (default "sync").
 * @param {Function} [options.print] - std::cout sink.
 * @param {Function} [options.printErr] - std::cerr sink.
 * @returns {Promise<VtkWasmRuntime>}
 */
export async function loadAsync(options = {}) {
  const {
    url = "loaded-module",
    urlIsGzip = DEFAULT_WASM_URL_IS_GZIP,
    wasmBaseName = DEFAULT_WASM_BASE_NAME,
    ...rest
  } = options;
  const config = normalizeConfig({ ...DEFAULT_CONFIG, ...rest });
  validateConfig(config);

  const key = cacheKey(url, wasmBaseName, config);
  if (RUNTIME_CACHE.has(key)) {
    return RUNTIME_CACHE.get(key);
  }
  if (!RUNTIME_PROMISES.has(key)) {
    RUNTIME_PROMISES.set(key, instantiateAsync(url, urlIsGzip, wasmBaseName, config, key));
  }
  return RUNTIME_PROMISES.get(key);
}

/**
 * A loaded VTK.wasm WebAssembly module. Acts as the single factory for sessions.
 */
export class VtkWasmRuntime {
  #module = null;
  #key = null;
  #disposed = false;

  constructor(module, key) {
    this.#module = module;
    this.#key = key;
  }

  /** The underlying Emscripten module. Escape hatch; prefer the session API. */
  get module() {
    return this.#module;
  }

  /** @returns {boolean} whether this runtime executes methods asynchronously (JSPI). */
  isAsync() {
    return typeof this.#module?.isAsync === "function" && this.#module.isAsync();
  }

  /**
   * Create an in-browser standalone session.
   * @returns {StandaloneSession}
   */
  createStandaloneSession() {
    this.#assertLive();
    return new StandaloneSession(new this.#module.vtkStandaloneSession());
  }

  /**
   * Create a server-driven remote session.
   * @returns {RemoteSession}
   */
  createRemoteSession() {
    this.#assertLive();
    return new RemoteSession(new this.#module.vtkRemoteSession(), this.#module);
  }

  /**
   * Drop this runtime from the shared cache and release the module reference.
   * Note: Emscripten cannot reclaim a runtime's heap before page reload;
   * disposing individual sessions is what actually frees C++ memory.
   */
  dispose() {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    if (RUNTIME_CACHE.get(this.#key) === this) {
      RUNTIME_CACHE.delete(this.#key);
    }
    this.#module = null;
  }

  [Symbol.dispose]() {
    this.dispose();
  }

  #assertLive() {
    if (this.#disposed) {
      throw new Error("VtkWasmRuntime has been disposed.");
    }
  }
}
