import { extractFilesFromGzipBundleAsync, fetchGzipBundleAsync } from "./core/gzipBundle";
import { createEmscriptenConfig, normalizeConfig, validateConfig } from "./core/configManager";
import { DEFAULT_CONFIG, DEFAULT_WASM_BASE_NAME, DEFAULT_WASM_URL_IS_GZIP, MIME_TYPES } from "./core/constants";
import { wasmModuleBaseNames } from "./core/wasmModuleNames";
import { createScriptURLAsync } from "./core/scriptLoader";
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
 * Dynamically import the Emscripten glue module and return its default export.
 * A single `...WebAssembly.mjs` glue module now serves both sync (`invoke`) and
 * async (`invokeAsync`) execution.
 *
 * @param {string} moduleURL - URL (or blob URL) of the glue `.mjs` module.
 * @returns {Promise<Function>} the module factory.
 */
async function importModuleFactoryAsync(moduleURL) {
  let namespace;
  try {
    // @vite-ignore keeps this a true runtime dynamic import (the URL is a
    // variable / blob URL that Vite must not try to statically resolve).
    namespace = await import(/* @vite-ignore */ moduleURL);
  } catch (cause) {
    throw new Error(
      [
        `Could not import the WebAssembly glue module from "${moduleURL}".`,
        "Possible causes include:",
        "  - Incorrect or unreachable 'url'",
        "  - Wrong 'wasmBaseName' or missing/misnamed .mjs/.wasm files in the bundle",
        "  - Network or script loading failures (e.g., 404/500 responses)",
        "  - Content Security Policy (CSP) blocking module execution",
        "",
        "Next steps:",
        "  - Verify that the expected .mjs and .wasm files are present and accessible under 'url'",
        "  - Check the browser's Network/Console tabs for failed module requests or CSP errors.",
      ].join("\n"),
      { cause },
    );
  }
  const factory = namespace?.default;
  if (typeof factory !== "function") {
    throw new Error(
      `The module at "${moduleURL}" did not provide a default export factory function.`,
    );
  }
  return factory;
}

/**
 * Resolve the glue module factory and the wasm binary descriptor (if any) for
 * the requested configuration. Returns `{ factory, wasmFile }`, where
 * `wasmFile` is non-null only when the binary had to be extracted from a gzip
 * bundle (so it can be handed to Emscripten).
 */
async function loadModuleFactoryAsync(url, urlIsGzip, wasmBaseName, config) {
  if (urlIsGzip) {
    const gzipArrayBuffer = await fetchGzipBundleAsync(url);
    const { js, wasm } = await extractFilesFromGzipBundleAsync(gzipArrayBuffer, config, wasmBaseName);
    const javaScriptBlobURL = createBlobURL(exposeSpecialHTMLTargets(js.buffer), MIME_TYPES.JAVASCRIPT);
    try {
      const factory = await importModuleFactoryAsync(javaScriptBlobURL);
      return { factory, wasmFile: wasm };
    } finally {
      // Safe to revoke now: the module is fully evaluated once import() resolves.
      disposeBlobURL(javaScriptBlobURL);
    }
  }

  const scriptURL = await createScriptURLAsync(url, wasmBaseName, config);
  if (scriptURL === null) {
    const names = wasmModuleBaseNames(wasmBaseName, config).map((n) => `'${n}.mjs'`).join(" or ");
    throw new Error(
      [
        `Could not locate the WebAssembly glue module (${names}) under "${url}".`,
        "The file was missing, returned a non-OK response, or the server replied with an HTML document.",
        "",
        "Next steps:",
        "  - Verify that the expected .mjs and .wasm files are present and accessible under 'url'",
        "  - Check the browser's Network/Console tabs for failed module requests or CSP errors.",
      ].join("\n"),
    );
  }
  const factory = await importModuleFactoryAsync(scriptURL);
  return { factory, wasmFile: null };
}

async function instantiateAsync(url, urlIsGzip, wasmBaseName, config, key) {
  try {
    const { factory, wasmFile } = await loadModuleFactoryAsync(url, urlIsGzip, wasmBaseName, config);
    const module = await factory(createEmscriptenConfig(config, wasmFile));
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
 *        With new single-binary bundles this only affects which legacy file is
 *        preferred when present; the proxy feature-detects `invokeAsync` at
 *        runtime. With old split bundles, "async" loads the `...Async` binary.
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

  /** The unique identifier for the wasm module that this runtime was created from.
   *  Looks like: `url::wasmBaseName::config.rendering::config.exec` */
  get id() {
    return this.#key
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
    return new StandaloneSession(new this.#module.vtkStandaloneSession(), this.#module);
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
