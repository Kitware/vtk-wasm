import "./style.css";

import { createInstantiatorProxy } from "./core/proxy";
import { createHeapInterface, createTypedArrayInterface } from "./core/typedArrayInterface";
import { addCanvasEventListeners, removeCanvasEventListeners } from "./core/canvasEventListeners";

// Documented as `RemoteSession` in types/base.d.ts.
export class RemoteSession {
  #native = null;
  #module = null;
  #disposed = false;
  #vtkProxyCache = null;
  #idToRef = null;
  #typedArrayInterface = null;

  /**
   * @param {object} native - the C++ vtkRemoteSession instance.
   * @param {object} wasmModule - the Emscripten module the session belongs to.
   * @param {object|null} [methodTable] - resolves method names and maySuspend
   *        flags for the proxy (see src/core/methodTable.js).
   */
  constructor(native, wasmModule, methodTable = null) {
    this.#native = native;
    this.#module = wasmModule;
    //
    this._updateTail = Promise.resolve(); // serialize all updates on this session
    this._pendingUpdates = new Map(); // vtkId -> queued-but-not-started run (coalescing)
    this.currentMTime = 1;
    this.stateMTimes = {};
    this.hashesMTime = {};
    this.pendingArrays = {};
    this.networkFetchState = null;
    this.networkFetchHash = null;
    this.networkFetchStatus = null;
    this.networkFetchBatch = null;
    this.cameraIds = new Set();
    this.stateCache = {};
    this.progressCallbacks = new Set();
    this.progressState = null;
    this.renderWindowSizes = {};
    this.boundRenderWindows = new Set();
    this.renderWindowIdsWithRunningEventLoops = new Set();

    // renderWindowId -> { canvas, target } where `canvas` is the user-provided
    // element and `target` is the string handed to native.bindRenderWindow
    // (a specialHTMLTargets key when available, otherwise a CSS selector).
    this.canvasTargets = new Map();

    // vtkObject proxy handling (create + getVtkObject + result wrapping)
    this.#vtkProxyCache = new WeakMap();
    this.#idToRef = new Map();
    this.vtk = createInstantiatorProxy(native, this.#vtkProxyCache, this.#idToRef, methodTable);

    // Do not let server-side window sizes override the client canvas size.
    // skipProperty matches the state's leaf ClassName (the server's concrete render
    // window class), so list every platform variant; "vtkRenderWindow" also covers
    // the vtkOSOpenGLRenderWindow -> vtkRenderWindow remap in vtkSessionRegisterState.
    ["vtkRenderWindow",
      "vtkEGLRenderWindow",
      "vtkOSOpenGLRenderWindow",
      "vtkXOpenGLRenderWindow",
      "vtkWin32OpenGLRenderWindow",
      "vtkCocoaRenderWindow",
      "vtkWebGPURenderWindow"
    ].forEach((name) => native.skipProperty(name, "Size"));

    // The embedder owns canvas sizing (bindCanvas / setSizeAsync), so opt out of
    // VTK's interactor self-sizing, which otherwise couples multiple views on a page.
    this.#module?._setDefaultExpandVTKCanvasToContainer?.(false);
    this.#module?._setDefaultInstallHTMLResizeObserver?.(false);
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

  startEventLoop(renderWindowId) {
    // Ensure the canvas is bound before the loop starts: the per-update bind
    // can fail while the render window object is still being deserialized, but
    // by the time a caller starts the event loop the object provably exists,
    // so binding here makes startup deterministic. Without it, the native
    // StartEventLoop copies an unset canvas selector onto the interactor and
    // the emscripten callback registration throws inside the loop's first
    // tick, permanently breaking interaction for that view.
    const rwId = Number(renderWindowId);
    if (this.canvasTargets.has(rwId) && !this.boundRenderWindows.has(rwId)) {
      if (this.#native.bindRenderWindow(rwId, this.getCanvasTarget(rwId))) {
        this.boundRenderWindows.add(rwId);
      }
    }
    if (this.#native.startEventLoop(renderWindowId)) {
      this.renderWindowIdsWithRunningEventLoops.add(renderWindowId);
      return true;
    }
    return false;
  }

  stopEventLoop(renderWindowId) {
    this.renderWindowIdsWithRunningEventLoops.delete(renderWindowId);
    return this.#native.stopEventLoop(renderWindowId);
  }

  bindNetwork(fetchState, fetchHash, fetchStatus, fetchBatch=null) {
    this.networkFetchState = fetchState;
    this.networkFetchHash = fetchHash;
    this.networkFetchStatus = fetchStatus;
    this.networkFetchBatch = fetchBatch;
  }

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

  async fetchStateAsync(vtkId) {
    const serverState = await this.networkFetchState(vtkId);
    const state = serverState ? JSON.parse(serverState) : null;
    if (state) {
      this.stateMTimes[state.Id] = state.MTime;
    } else {
      delete this.stateMTimes[vtkId];
    }
    this.incrementProgress("state");
    return state;
  }

  async fetchHashAsync(hash) {
    let array;
    // pendingArray only filled via pushHashAsync
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
  async fetchBatchAsync(stateIds, hashKeys) {
    const results = [];
    const { states, hashes, next } = await this.networkFetchBatch(stateIds, hashKeys);

    // handle states
    for (let i = 0; i < states.length; i++) {
      const state = states[i];
      if (state) {
        this.stateMTimes[state.Id] = state.MTime;
        results.push(state);
      } else {
        delete this.stateMTimes[vtkId];
      }
      this.incrementProgress("state");
    }

    // handle hashes
    const entries = Object.entries(hashes);
    for (let i = 0; i < entries.length; i++) {
      const [hash, array] = entries[i];
      this.#native.registerBlob(hash, array);
      this.hashesMTime[hash] = this.currentMTime;
      this.incrementProgress("hash");
    }

    // request next batch if any
    if (next) {
      await this.fetchBatchAsync(next.states, next.hashes);
    }

    return results;
  }

  pushHashAsync(hash, arrayOrBlob) {
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

  updateAsync(vtkId) {
    const id = Number(vtkId);
    // Coalesce: a queued (not-yet-started) run for this id will capture the
    // latest server state, so redundant callers can await it instead of piling
    // on. Distinct ids are never coalesced; they queue behind one another.
    if (this._pendingUpdates.has(id)) {
      return this._pendingUpdates.get(id);
    }
    // Serialize every update on this session: they all mutate the shared native
    // object manager, so their state registration must never intermix.
    const run = this._updateTail.then(() => {
      // This run has started; later calls for this id queue a fresh run.
      this._pendingUpdates.delete(id);
      return this.#doUpdateAsync(id);
    });
    this._pendingUpdates.set(id, run);
    this._updateTail = run.catch(() => { }); // keep the chain alive on failure
    return run;
  }

  /**
   * Fetch and register the remote state for `vtkId`, then render it if it is a
   * bound render window. Serialized via `updateAsync`; do not call directly.
   */
  async #doUpdateAsync(vtkId) {
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

      const pendingWork = { states: [], hashes: [], batch: false };
      if (this.networkFetchBatch) {
        pendingWork.batch = this.fetchBatchAsync(statesToFetch, hashesToFetch);
      } else {
        pendingWork.states = statesToFetch.map((stateId) =>
          this.fetchStateAsync(stateId),
        );
        pendingWork.hashes = hashesToFetch.map((hash) => this.fetchHashAsync(hash));
      }

      // Capture cameras
      serverStatus.cameras.forEach((v) => this.cameraIds.add(Number(v)));

      // Remove state that should be ignored
      serverStatus.ignore_ids.forEach((vtkId) =>
        this.#native.unRegisterState(vtkId),
      );

      // Ensure completion of all network calls
      await Promise.all(pendingWork.hashes);
      await Promise.all(Object.values(this.pendingArrays));
      const statesToRegister = await (pendingWork.batch ? pendingWork.batch : Promise.all(pendingWork.states));
      this.currentMTime++;

      // Register states in a synchronous manner to prevent intermixed render from interactor
      while (statesToRegister.length) {
        const state = statesToRegister.pop();
        if (state) {
          this.#native.registerState(state);
        }
      }

      // Bump local mtime and process states to reflect server state
      try {
        this.#native.updateObjectsFromStates();
        // Upstream's vtkObjectManager::UpdateObjectFromState
        // discards ownership metadata such as the "vtk-object-manager-kept-alive"
        // key. Until then, this code should not run. Instead, it relies
        // upon consumers having called the bindCanvas(renderWindowId, canvasOrId) method.
        // This issue is tracked in https://gitlab.kitware.com/vtk/vtk/-/work_items/20099
        // const state = this.getVtkObject(vtkId).$state;
        // const isRenderWindow =
        //   state?.className === "vtkRenderWindow" ||
        //   state?.superClassNames?.includes("vtkRenderWindow");
        const rwId = Number(vtkId);
        const isRenderWindow = this.canvasTargets.has(rwId);
        if (isRenderWindow) {
          if (!this.boundRenderWindows.has(rwId)) {
            // Only mark the window bound when the native bind SUCCEEDED. The
            // bind fails when the render window object has not yet been
            // deserialized in this update; marking it bound anyway meant the
            // canvas selector was never assigned, and the interactor's event
            // callback registration later threw on the empty selector inside
            // the event loop's first tick — killing the tick chain and leaving
            // a page that renders but ignores all input.
            if (this.#native.bindRenderWindow(rwId, this.getCanvasTarget(rwId))) {
              this.boundRenderWindows.add(rwId);
            }
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
    }
  }

  getState(vtkId, useCache = false) {
    const wasmId = Number(vtkId);
    if (useCache && this.stateCache[wasmId]) {
      return this.stateCache[wasmId];
    }
    return this.#native.get(wasmId);
  }

  clearStateCache() {
    this.stateCache = {};
  }

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

  async setSizeAsync(renderWindowId, width, height) {
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

  getVtkObject(vtkId) {
    return this.vtk.getVtkObject(vtkId);
  }

  get disposed() {
    return this.#disposed;
  }

  dispose() {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    this.progressCallbacks.clear();
    this.#idToRef.clear();
    this.renderWindowIdsWithRunningEventLoops.forEach((id) => {
      this.#native.stopEventLoop(id);
    });
    this.renderWindowIdsWithRunningEventLoops.clear();
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
