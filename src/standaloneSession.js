import { createInstantiatorProxy } from "./core/proxy";

/**
 * An in-browser VTK session. Wraps a C++ `vtkStandaloneSession` and exposes the
 * `vtk` namespace proxy used to instantiate and drive VTK objects.
 *
 * Obtain one from {@link VtkWasmRuntime#createStandaloneSession}.
 */
export class StandaloneSession {
  #native = null;
  #disposed = false;
  #vtkProxyCache = new WeakMap();
  #idToRef = new Map();

  /**
   * @param {object} native - the C++ vtkStandaloneSession instance.
   */
  constructor(native) {
    this.#native = native;
    /**
     * The `vtk` namespace: call `vtk.vtkActor({ ... })` to create objects.
     * @type {object}
     */
    this.vtk = createInstantiatorProxy(native, this.#vtkProxyCache, this.#idToRef);
  }

  /** The underlying C++ session. Escape hatch; prefer {@link StandaloneSession#vtk}. */
  get native() {
    return this.#native;
  }

  /**
   * @returns {boolean}
   */
  get disposed(){
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
