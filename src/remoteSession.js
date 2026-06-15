import "./style.css";

import { createInstantiatorProxy } from "./core/proxy";
import { addCanvasEventListeners, removeCanvasEventListeners } from "./core/canvasEventListeners";

/**
 * A server-driven VTK session. Wraps a C++ `vtkRemoteSession` and synchronizes
 * object state fetched over the network into the local WebAssembly scene.
 *
 * Obtain one from {@link VtkWasmRuntime#createRemoteSession}.
 */
export class RemoteSession {
  #native = null;
  #module = null;
  #disposed = false;
  #vtkProxyCache = null;
  #idToRef = null;

  /**
   * @param {object} native - the C++ vtkRemoteSession instance.
   * @param {object} wasmModule - the Emscripten module the session belongs to.
   */
  constructor(native, wasmModule) {
    this.#native = native;
    this.#module = wasmModule;
    //
    this.updateInProgress = 0;
    this.currentMTime = 1;
    this.stateMTimes = {};
    this.hashesMTime = {};
    this.pendingArrays = {};
    this.networkFetchState = null;
    this.networkFetchHash = null;
    this.networkFetchStatus = null;
    this.cameraIds = new Set();
    this.stateCache = {};
    this.progressCallbacks = new Set();
    this.progressState = null;
    this.renderWindowSizes = {};
    this.boundRenderWindows = new Set();

    // renderWindowId -> { canvas, target } where `canvas` is the user-provided
    // element and `target` is the string handed to native.bindRenderWindow
    // (a specialHTMLTargets key when available, otherwise a CSS selector).
    this.canvasTargets = new Map();

    // vtkObject proxy handling (create + getVtkObject + result wrapping)
    this.#vtkProxyCache = new WeakMap();
    this.#idToRef = new Map();
    this.vtk = createInstantiatorProxy(native, this.#vtkProxyCache, this.#idToRef);

    // Do not let server-side window sizes override the client canvas size.
    native.skipProperty("vtkRenderWindow", "Size");
  }

  /** The underlying C++ session. Escape hatch; prefer {@link RemoteSession#vtk}. */
  get native() {
    return this.#native;
  }

  /**
   * Inject network implementation for fetching state and blob
   */
  bindNetwork(fetchState, fetchHash, fetchStatus) {
    this.networkFetchState = fetchState;
    this.networkFetchHash = fetchHash;
    this.networkFetchStatus = fetchStatus;
  }

  /**
   * Register a callback to monitor download progress.
   *
   * @param {Function} callback
   * @returns {Function} cleanup function
   */
  addProgressCallback(callback) {
    if (callback) {
      this.progressCallbacks.add(callback);
    }
    return () => {
      this.progressCallbacks.delete(callback);
    };
  }

  emitProgress() {
    if (!this.progressCallbacks.size || !this.progressState) {
      return;
    }
    const { active, state, hash } = this.progressState;
    const payload = {
      active,
      state: {
        current: state.current,
        total: state.total,
      },
      hash: {
        current: hash.current,
        total: hash.total,
      },
    };
    this.progressCallbacks.forEach((cb) => cb(payload));
  }

  incrementProgress(kind) {
    if (!this.progressState) {
      return;
    }
    const bucket = this.progressState[kind];
    if (!bucket) {
      return;
    }
    bucket.current = Math.min(bucket.current + 1, bucket.total);
    this.emitProgress();
  }

  /**
   * Free old blobs if they go beyond the allowed cache size in Bytes
   * starting with the older ones.
   *
   * @param {int} cacheSize
   */
  freeMemory(cacheSize = 0) {
    const memArrays = this.#native.getTotalBlobMemoryUsage();
    const threshold = Number(cacheSize);

    if (memArrays > threshold) {
      // Need to remove old blobs
      const tsMap = {};
      let mtimeToFree = this.currentMTime;
      Object.entries(this.hashesMTime).forEach(([hash, mtime]) => {
        if (mtime < mtimeToFree) {
          mtimeToFree = mtime;
        }
        const sMtime = mtime.toString();
        if (tsMap[sMtime]) {
          tsMap[sMtime].push(hash);
        } else {
          tsMap[sMtime] = [hash];
        }
      });

      // Remove blobs starting by the old ones
      while (this.#native.getTotalBlobMemoryUsage() > threshold) {
        const hashesToDelete = tsMap[mtimeToFree];
        if (hashesToDelete) {
          for (let i = 0; i < hashesToDelete.length; i++) {
            this.#native.unRegisterBlob(hashesToDelete[i]);
            delete this.hashesMTime[hashesToDelete[i]];
          }
        }
        mtimeToFree++;
      }
    }
  }

  /**
   * Fetch and register state inside the session
   *
   * @param {int} vtkId
   * @returns fetched state as string
   */
  async fetchState(vtkId) {
    const serverState = await this.networkFetchState(vtkId);
    const patchedState = this.patchState(serverState);
    this.incrementProgress("state");
    return patchedState;
  }

  /**
   * Record the MTime of an incoming state.
   *
   * @param {str} state
   * @returns {str} the unchanged state
   */
  patchState(state) {
    if (state.length > 0) {
      const { Id, MTime } = JSON.parse(state);
      this.stateMTimes[Id] = MTime;
      return state;
    }
  }

  /**
   * Fetch and register blob inside the session
   *
   * @param {str} hash
   * @returns typed array matching blob content
   */
  async fetchHash(hash) {
    let array;
    // pendingArray only filled via pushHash
    if (this.pendingArrays[hash]) {
      await this.pendingArrays[hash];
      this.hashesMTime[hash] = this.currentMTime;
      delete this.pendingArrays[hash];
    } else {
      // regular network call
      array = await this.networkFetchHash(hash);
      this.#native.registerBlob(hash, array);
      this.hashesMTime[hash] = this.currentMTime;
    }
    this.incrementProgress("hash");
    return array;
  }

  /**
   * Push blob to internal structure
   * @param {str} hash
   * @param {TypedArry or Blob} arrayOrBlob
   */
  pushHash(hash, arrayOrBlob) {
    this.pendingArrays[hash] = new Promise((resolve) => {
      if (arrayOrBlob.arrayBuffer) {
        arrayOrBlob.arrayBuffer().then((buffer) => {
          this.#native.registerBlob(hash, new Uint8Array(buffer));
          this.hashesMTime[hash] = this.currentMTime;
          resolve();
        });
      } else {
        this.#native.registerBlob(hash, arrayOrBlob);
        this.hashesMTime[hash] = this.currentMTime;
        resolve();
      }
    });
    return this.pendingArrays[hash];
  }

  /**
   * Update object with its dependencies to match remote version.
   *
   * @param {int} vtkId
   */
  async update(vtkId) {
    this.updateInProgress++;
    if (this.updateInProgress !== 1) {
      // console.error("Skip concurrent update");
      return;
    }

    try {
      const serverStatus = await this.networkFetchStatus(vtkId);
      const hashesToFetch = [];
      const statesToFetch = [];

      // Handle forcepush if any
      const resetIds = serverStatus.force_push || [];
      for (let i = 0; i < resetIds.length; i++) {
        delete this.stateMTimes[resetIds[i]];
      }

      // Fetch any state that needs update
      serverStatus.ids.forEach(([vtkId, mtime]) => {
        if (!this.stateMTimes[vtkId] || this.stateMTimes[vtkId] < mtime) {
          statesToFetch.push(vtkId);
        }
      });

      // Fetch any blob that is missing
      serverStatus.hashes.forEach((hash) => {
        if (!this.hashesMTime[hash]) {
          hashesToFetch.push(hash);
        }
        this.hashesMTime[hash] = this.currentMTime;
      });

      this.progressState = {
        active: !!(statesToFetch.length + hashesToFetch.length),
        state: { current: 0, total: statesToFetch.length },
        hash: { current: 0, total: hashesToFetch.length },
      };
      this.emitProgress();
      const pendingStates = statesToFetch.map((stateId) =>
        this.fetchState(stateId),
      );
      const pendingHashes = hashesToFetch.map((hash) => this.fetchHash(hash));

      // Capture cameras
      serverStatus.cameras.forEach((v) => this.cameraIds.add(Number(v)));

      // Remove state that should be ignored
      serverStatus.ignore_ids.forEach((vtkId) =>
        this.#native.unRegisterState(vtkId),
      );

      // Ensure completion of all network calls
      await Promise.all(pendingHashes);
      await Promise.all(Object.values(this.pendingArrays));
      const statesToRegister = await Promise.all(pendingStates);
      this.currentMTime++;

      // Register states in a synchronous manner to prevent intermixed render from interactor
      while (statesToRegister.length) {
        const state = statesToRegister.pop();
        if (state) {
          this.#native.registerState(JSON.parse(state));
        }
      }

      // Bump local mtime and process states to reflect server state
      try {
        this.#native.updateObjectsFromStates();
        const state = this.getVtkObject(vtkId).state;
        const isRenderWindow =
          state?.className === "vtkRenderWindow" ||
          state?.superClassNames?.includes("vtkRenderWindow");
        if (isRenderWindow) {
          const rwId = Number(vtkId);
          if (this.canvasTargets.has(rwId) && !this.boundRenderWindows.has(rwId)) {
            this.#native.bindRenderWindow(rwId, this.getCanvasTarget(rwId));
            this.boundRenderWindows.add(rwId);
          }
          if (rwId in this.renderWindowSizes) {
            const [w, h] = this.renderWindowSizes[rwId];
            this.#native.setSize(rwId, w, h);
          }
          await this.#native.render(rwId);
        }
      } catch (e) {
        console.error("WASM update failed");
        console.log(e);
      }
    } catch (e) {
      console.error("Error in update", e);
    } finally {
      if (this.progressState) {
        this.progressState.active = false;
        this.emitProgress();
        this.progressState = null;
      }
      this.updateInProgress--;
      if (this.updateInProgress) {
        this.updateInProgress = 0;
        await this.update(vtkId);
      }
    }
  }

  /**
   * Helper to retrieve local object state
   *
   * @param {int} vtkId
   * @returns state of given vtk object
   */
  getState(vtkId, useCache = false) {
    const wasmId = Number(vtkId);
    if (useCache && this.stateCache[wasmId]) {
      return this.stateCache[wasmId];
    }
    return this.#native.get(wasmId);
  }

  /**
   * Clear state cache
   */
  clearStateCache() {
    this.stateCache = {};
  }

  /**
   * Helper to query local object value for a given property
   *
   * @param {Array or vtkId} valuePath
   * @returns property value
   */
  getStateValue(valuePath, useCache = false) {
    const expression = Array.isArray(valuePath) ? valuePath : [valuePath];
    let value = null;
    for (let i = 0; i < expression.length; i++) {
      const token = expression[i];
      if (i === 0) {
        value = this.getState(token, useCache);
      } else {
        value = value[token];
        if (value.Id) {
          value = this.getState(value.Id, useCache);
        }
      }
    }
    return value;
  }

  /**
   * Return the native event-target string for the canvas registered to a render
   * window. This is a `specialHTMLTargets` key when the build exposes that map,
   * otherwise a CSS selector. Pass it to `native.bindRenderWindow`.
   *
   * @param {int} renderWindowId
   * @returns {string} the event-target string for the given canvas
   */
  getCanvasTarget(renderWindowId) {
    const entry = this.canvasTargets.get(Number(renderWindowId));
    if (!entry) {
      throw new Error(
        `No canvas registered for render window ${renderWindowId}. ` +
          `Call bindCanvas(renderWindowId, canvas) first.`,
      );
    }
    return entry.target;
  }

  /**
   * Associate a render window with a user-provided canvas and install the
   * interaction listeners on it.
   *
   * RemoteSession never creates, moves, or removes canvas elements: the caller
   * owns the canvas lifecycle. The canvas may be passed as the element itself or
   * as the `id` of an element already in the DOM. When the Emscripten build
   * exposes `specialHTMLTargets`, the element is registered there directly, so it
   * needs neither an `id` nor to be attached to the document; otherwise the
   * element must have an `id` so a CSS selector can be used as a fallback.
   *
   * @param {int} renderWindowId
   * @param {HTMLCanvasElement|string} canvasOrId - the canvas element or its DOM `id`.
   * @returns {string} the native event-target string (see {@link RemoteSession#getCanvasTarget}).
   */
  bindCanvas(renderWindowId, canvasOrId) {
    const rwId = Number(renderWindowId);
    const canvas =
      typeof canvasOrId === "string"
        ? document.getElementById(canvasOrId)
        : canvasOrId;
    if (!canvas) {
      throw new Error(
        `bindCanvas: no canvas found for render window ${renderWindowId}.`,
      );
    }

    let target;
    const specialHTMLTargets = this.#module?.specialHTMLTargets;
    if (specialHTMLTargets) {
      // Register the element directly; the canvas needs no id and need not be
      // attached to the document.
      target = `!vtk-canvas-${rwId}`;
      specialHTMLTargets[target] = canvas;
    } else if (canvas.id) {
      // Fallback: resolve via CSS selector at bind time inside Emscripten.
      target = `#${canvas.id}`;
    } else {
      throw new Error(
        `bindCanvas: this build does not expose specialHTMLTargets, so the ` +
          `canvas for render window ${renderWindowId} must have an 'id'.`,
      );
    }

    this.canvasTargets.set(rwId, { canvas, target });
    addCanvasEventListeners(canvas);
    return target;
  }

  /**
   * Remove the interaction listeners installed by {@link RemoteSession#bindCanvas}
   * and forget the render window -> canvas mapping. The canvas element itself is
   * left untouched.
   *
   * @param {int} renderWindowId
   */
  unbindCanvas(renderWindowId) {
    const rwId = Number(renderWindowId);
    const entry = this.canvasTargets.get(rwId);
    if (!entry) {
      return;
    }
    removeCanvasEventListeners(entry.canvas);
    if (this.boundRenderWindows.has(rwId)) {
      this.#native.bindRenderWindow(rwId, "");
      this.boundRenderWindows.delete(rwId);
    }
    const specialHTMLTargets = this.#module?.specialHTMLTargets;
    if (specialHTMLTargets) {
      delete specialHTMLTargets[entry.target];
    }
    this.canvasTargets.delete(rwId);
  }

  /**
   * Set size to the given RenderWindow
   *
   * @param {int} renderWindowId
   * @param {int} width
   * @param {int} height
   */
  async setSize(renderWindowId, width, height)  {
    const rwId = Number(renderWindowId);
    this.renderWindowSizes[rwId] = [width, height];

    const entry = this.canvasTargets.get(rwId);
    if (entry?.canvas) {
      entry.canvas.width = width;
      entry.canvas.height = height;
    }

    if (this.boundRenderWindows.has(rwId)) {  // RW exists in C++
      this.#native.setSize(rwId, width, height);
      await this.#native.render(rwId);
    }
  }

  /**
   * Get a helper proxy for controlling the vtkObject available on the WASM side.
   *
   * The returned proxy exposes:
   * - `id` — the WASM id, and `obj` — the id wrapped as `{ Id: wasmId }`.
   * - `state` — the full object state.
   * - `delete()` — remove the object from the WASM stack.
   * - `set(kwargs)` — update a batch of properties at once.
   * - `observe(eventName, fn) -> tag` / `unObserve(tag)` / `unObserveAll()` — manage listeners.
   * - each VTK property as a getter/setter, and each VTK method as an async call.
   *
   * @param {number} vtkId - wasm id for the given vtkObject
   * @returns {object} the vtkObject proxy
   */
  getVtkObject(vtkId) {
    return this.vtk.getVtkObject(vtkId);
  }

  /**
   * Free the C++ session and detach the interaction listeners installed on the
   * user-provided canvases. The canvas elements themselves are left untouched.
   * The session is unusable afterwards.
   */
  dispose() {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    this.progressCallbacks.clear();
    this.#idToRef.clear();
    const specialHTMLTargets = this.#module?.specialHTMLTargets;
    this.canvasTargets.forEach(({ canvas, target }) => {
      removeCanvasEventListeners(canvas);
      if (specialHTMLTargets) {
        delete specialHTMLTargets[target];
      }
    });
    this.canvasTargets.clear();
    // The native session is destroyed below, so no need to unbind render
    // windows individually; just drop our bookkeeping.
    this.boundRenderWindows.clear();
    if (typeof this.#native?.delete === "function") {
      this.#native.delete();
    }
    this.#native = null;
    this.#module = null;
  }

  [Symbol.dispose]() {
    this.dispose();
  }
}
