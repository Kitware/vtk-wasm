import assert from "node:assert/strict";
import test from "node:test";

// js-untar detects browser URL support during module evaluation. The public
// vtk-wasm entry point therefore expects a Window even though these tests only
// instantiate RemoteSession with a mocked native session.
globalThis.window = globalThis;
globalThis.document = { querySelector: () => null };
const { RemoteSession } = await import("../dist/esm/index.mjs");

function nativeSession({ starts = true } = {}) {
  const calls = {
    binds: [],
    invokes: [],
    skips: [],
    starts: [],
    stops: [],
  };
  return {
    calls,
    bindRenderWindow(id, target) {
      calls.binds.push([id, target]);
      return true;
    },
    invoke(id, method, args) {
      calls.invokes.push([id, method, args]);
    },
    skipProperty(className, property) {
      calls.skips.push([className, property]);
    },
    startEventLoop(id) {
      calls.starts.push(id);
      return starts;
    },
    stopEventLoop(id) {
      calls.stops.push(id);
      return true;
    },
  };
}

function canvas() {
  return {
    addEventListener() {},
    removeEventListener() {},
  };
}

test("remote sessions ignore the server Size for every interactor variant", () => {
  const native = nativeSession();
  new RemoteSession(native, { specialHTMLTargets: {} });

  const skippedInteractorClasses = native.calls.skips
    .filter(([, property]) => property === "Size")
    .map(([className]) => className)
    .filter((className) => className.endsWith("Interactor"));

  assert.deepEqual(skippedInteractorClasses, [
    "vtkRenderWindowInteractor",
    "vtkGenericRenderWindowInteractor",
    "vtkXRenderWindowInteractor",
    "vtkWin32RenderWindowInteractor",
    "vtkCocoaRenderWindowInteractor",
    "vtkAndroidRenderWindowInteractor",
    "vtkWebAssemblyRenderWindowInteractor",
  ]);
});

test("a view whose native event loop is occupied gets one stoppable rAF pump", async (t) => {
  const callbacks = [];
  const previousRequestAnimationFrame = globalThis.requestAnimationFrame;
  globalThis.requestAnimationFrame = (callback) => {
    callbacks.push(callback);
    return callbacks.length;
  };
  t.after(() => {
    globalThis.requestAnimationFrame = previousRequestAnimationFrame;
  });

  const native = nativeSession({ starts: false });
  const session = new RemoteSession(native, { specialHTMLTargets: {} });
  session.bindCanvas(41, canvas());
  session.bindNetwork(
    async () => null,
    async () => null,
    async () => ({
      ids: [],
      hashes: [],
      cameras: [],
      ignore_ids: [],
      force_push: [],
      interactor: 73,
    }),
  );
  await session.updateAsync(41);

  assert.equal(session.startEventLoop(41), true);
  assert.deepEqual(native.calls.binds, [[41, "!vtk-canvas-41"]]);
  assert.equal(callbacks.length, 1);

  callbacks.shift()();
  assert.deepEqual(native.calls.invokes, [[73, "ProcessEvents", []]]);
  assert.equal(callbacks.length, 1);

  // Re-entering start is harmless and must not create a second animation pump.
  assert.equal(session.startEventLoop(41), true);
  assert.equal(callbacks.length, 1);

  session.stopEventLoop(41);
  callbacks.shift()();
  assert.equal(callbacks.length, 0);
  assert.equal(native.calls.invokes.length, 1);
});

test("a successful native event loop is not also pumped from JavaScript", async (t) => {
  const callbacks = [];
  const previousRequestAnimationFrame = globalThis.requestAnimationFrame;
  globalThis.requestAnimationFrame = (callback) => {
    callbacks.push(callback);
    return callbacks.length;
  };
  t.after(() => {
    globalThis.requestAnimationFrame = previousRequestAnimationFrame;
  });

  const native = nativeSession();
  const session = new RemoteSession(native, { specialHTMLTargets: {} });
  session.bindNetwork(
    async () => null,
    async () => null,
    async () => ({
      ids: [],
      hashes: [],
      cameras: [],
      ignore_ids: [],
      force_push: [],
      interactor: 73,
    }),
  );
  await session.updateAsync(41);

  assert.equal(session.startEventLoop(41), true);
  assert.equal(callbacks.length, 0);
  assert.equal(native.calls.invokes.length, 0);
});

test("disposing a session retires a queued JavaScript event pump", async (t) => {
  const callbacks = [];
  const previousRequestAnimationFrame = globalThis.requestAnimationFrame;
  globalThis.requestAnimationFrame = (callback) => {
    callbacks.push(callback);
    return callbacks.length;
  };
  t.after(() => {
    globalThis.requestAnimationFrame = previousRequestAnimationFrame;
  });

  const native = nativeSession({ starts: false });
  const session = new RemoteSession(native, { specialHTMLTargets: {} });
  session.bindNetwork(
    async () => null,
    async () => null,
    async () => ({
      ids: [],
      hashes: [],
      cameras: [],
      ignore_ids: [],
      force_push: [],
      interactor: 73,
    }),
  );
  await session.updateAsync(41);

  assert.equal(session.startEventLoop(41), true);
  assert.equal(callbacks.length, 1);
  session.dispose();
  callbacks.shift()();

  assert.equal(callbacks.length, 0);
  assert.equal(native.calls.invokes.length, 0);
  assert.deepEqual(native.calls.stops, [41]);
});
