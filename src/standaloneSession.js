import { createInstantiatorProxy } from "./core/proxy";
import { createHeapInterface, createTypedArrayInterface } from "./core/typedArrayInterface";

/**
 * An in-browser VTK session. Wraps a C++ `vtkStandaloneSession` and exposes the
 * `vtk` namespace proxy used to instantiate and drive VTK objects.
 *
 * Obtain one from {@link VtkWasmRuntime#createStandaloneSession}.
 */
export class StandaloneSession {
  #native = null;
  #module = null;
  #disposed = false;
  #vtkProxyCache = new WeakMap();
  #idToRef = new Map();
  #typedArrayInterface = null;

  /**
   * @param {object} native - the C++ vtkStandaloneSession instance.
   * @param {object} module - the Emscripten module (for specialHTMLTargets access).
   * @param {object|null} [methodTable] - resolves method names and maySuspend
   *        flags for the proxy (see src/core/methodTable.js).
   */
  constructor(native, module, methodTable = null) {
    this.#native = native;
    this.#module = module;
    /**
     * The `vtk` namespace: call `vtk.vtkActor({ ... })` to create objects.
     * @type {object}
     */
    this.vtk = createInstantiatorProxy(native, this.#vtkProxyCache, this.#idToRef, methodTable);
  }

  /** The underlying C++ session. Escape hatch; prefer {@link StandaloneSession#vtk}. */
  get native() {
    return this.#native;
  }

  /** The underlying WASM module */
  get wasmModule() {
    return this.#module;
  }

  /**
   * Marshalling between JavaScript TypedArrays and the wasm heap. Adds
   * `toVTKAoSArray(typedArray, numberOfComponents, name)` — which creates the
   * matching `vtkTypeXxxArray` in *this* session — to the pointer-level
   * primitives of {@link VtkWasmRuntime#typedArrayInterface}.
   */
  get typedArrayInterface() {
    if (!this.#typedArrayInterface) {
      this.#typedArrayInterface = createTypedArrayInterface(
        createHeapInterface(this.#module),
        this.vtk,
      );
    }
    return this.#typedArrayInterface;
  }

  /**
   * Register `canvas` under `key` in `specialHTMLTargets` so it can be used as
   * a `canvasSelector` without requiring a DOM `id`. The key must start with `!`
   * (Emscripten convention). Returns `key` for convenience.
   *
   * @param {string} key - selector key, e.g. `"!my-canvas"`.
   * @param {HTMLCanvasElement} canvas
   * @returns {string} the key
   */
  registerCanvas(key, canvas) {
    if (this.#module?.specialHTMLTargets) {
      this.#module.specialHTMLTargets[key] = canvas;
    }
    return key;
  }

  /**
   * @returns {boolean}
   */
  get disposed() {
    return this.#disposed;
  }

  /**
   * Free the C++ session and all objects it owns, and drop proxy caches.
   * The session is unusable afterwards.
   */
  dispose() {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    this.#idToRef.clear();
    if (typeof this.#native?.delete === "function") {
      this.#native.delete();
    }
    this.#native = null;
  }

  [Symbol.dispose]() {
    this.dispose();
  }
}
