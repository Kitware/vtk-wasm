import { createInstantiatorProxy } from "./core/proxy";
import { createHeapInterface, createTypedArrayInterface } from "./core/typedArrayInterface";

// Documented as `StandaloneSession` in types/base.d.ts.
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
    this.vtk = createInstantiatorProxy(native, this.#vtkProxyCache, this.#idToRef, methodTable);
  }

  get native() {
    return this.#native;
  }

  get wasmModule() {
    return this.#module;
  }

  get typedArrayInterface() {
    if (!this.#typedArrayInterface) {
      this.#typedArrayInterface = createTypedArrayInterface(
        createHeapInterface(this.#module),
        this.vtk,
      );
    }
    return this.#typedArrayInterface;
  }

  registerCanvas(key, canvas) {
    if (this.#module?.specialHTMLTargets) {
      this.#module.specialHTMLTargets[key] = canvas;
    }
    return key;
  }

  get disposed() {
    return this.#disposed;
  }

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
