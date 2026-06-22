# Remote Session

A **remote session** mirrors a scene that lives on a server. The server owns the real VTK pipeline; the browser receives serialized object **state** plus binary **blobs**, registers them into a local WebAssembly scene, and renders. This is the model used by [trame](../trame/) and the [data viewer](../viewer/).

Use a remote session when the data is large, generated server-side, or shared across clients. For purely in-browser work, reach for a [Standalone Session](./standalone-session.md) instead.

Create one from a [runtime](./loading.md):

```js
import { loadAsync } from "@kitware/vtk-wasm";

const runtime = await loadAsync({ url: VTK_WASM_BUNDLE_URL });
const remote = runtime.createRemoteSession();
```

## Wire up the network

A remote session does not know how to reach your server. You supply three async fetchers through [`bindNetwork`](/api/@kitware/vtk-wasm/classes/RemoteSession#bindnetwork) — one for state, one for blobs, one for status — and the session calls them whenever it needs data:

```js
remote.bindNetwork(fetchState, fetchHash, fetchStatus);
```

Each fetcher wraps one server RPC. The trame server side lives in [protocol.py](https://github.com/Kitware/trame-vtklocal/blob/master/src/trame_vtklocal/module/protocol.py); a typical client implementation just forwards the arguments over your transport (e.g. `session.call("vtklocal.get.state", [vtkId])`).

- **`fetchState(vtkId) => Promise<string>`** — given an object id, return that object's serialized **state** as a JSON string (the wire format). Backs `vtklocal.get.state`.

- **`fetchHash(hash) => Promise<Uint8Array>`** — given a content hash, return the corresponding binary **blob**. The transport may hand you a `Blob` or a `TypedArray`, so convert the result to a `Uint8Array` before returning. Backs `vtklocal.get.hash`.

- **`fetchStatus(renderWindowId) => Promise<Status>`** — given a render window id, return a manifest of **what exists and what changed since last time**, so the session knows what to pull on the next [`updateAsync`](#drive-updates). Backs `vtklocal.get.status`. The returned object carries:
  - `ids` — `[id, mtime]` pairs for every object reachable from the render window
  - `hashes` — content hashes of the blobs those objects reference
  - `cameras` — ids of the active cameras; `force_push` and `ignore_ids` select which to push to the server or leave alone (e.g. to keep the client's local camera)
  - `interactor` — the interactor id for the render window

## Hydrate a scene

The example below stands in for a server with a handful of **canned object states**: a render window that owns a renderer whose `Background` is gray. The three fetchers read from that in-memory scene exactly as they would read from the wire, so the session hydrates and renders without any backend.

The state objects mirror what `vtklocal.get.state` returns: each carries an `Id`, a `ClassName`, its `SuperClassNames`, and the properties to apply. References to other objects are `{ "Id": n }`, and `fetchStatus` advertises every object so the session knows what to pull on the first [`updateAsync`](#drive-updates). This scene has no binary data, so `fetchHash` is never called.

<Playground display-i-frame>
    <textarea data-lang="html" style="display:none"><!doctype html>
<html lang="en">
  <head>
    <style>
      html, body { margin: 0; padding: 0; overflow: hidden; }
    </style>
    <script src="https://unpkg.com/@kitware/vtk-wasm/vtk-umd.js"></script>
  </head>
  <body>
    <div style="position: absolute; width: 100%; height: 100%;">
      <div id="container">
      </div>
    </div>
  </body>
</html></textarea>
    <pre data-lang="js" style="display:none">
const runtime = await vtkwasm.loadAsync({
  url: "https://gitlab.kitware.com/api/v4/projects/13/packages/generic/vtk-wasm32-emscripten/9.6.20260621/vtk-9.6.20260621-wasm32-emscripten.tar.gz",
});
const remote = runtime.createRemoteSession();
// The "server": 
// a render window (1)
//  -> interactor (2)
//  -> renderer collection (3)
//     -> renderer (4) with a gray background
//        -> a prop collection (5)
//        -> a vtkTextActor (6)
//           -> a vtkTextProperty (7)
const RENDER_WINDOW_ID = 1;
const SCENE = {
  1: {
    ClassName: "vtkRenderWindow",
    SuperClassNames: ["vtkObjectBase", "vtkObject", "vtkWindow"],
    Id: 1, MTime: 10,
    Interactor: { Id: 2 },
    NumberOfLayers: 1,
    Renderers: { Id: 3 },
    "vtk-object-manager-kept-alive": true,
  },
  2: {
    ClassName: "vtkRenderWindowInteractor",
    SuperClassNames: ["vtkObjectBase", "vtkObject"],
    Id: 2, MTime: 10,
    RenderWindow: { Id: 1 },
  },  
  3: {
    ClassName: "vtkRendererCollection",
    SuperClassNames: ["vtkObjectBase", "vtkObject", "vtkCollection"],
    Id: 3, MTime: 10,
    Items: [{ Id: 4 }],
  },
  4: {
    ClassName: "vtkRenderer",
    SuperClassNames: ["vtkObjectBase", "vtkObject", "vtkViewport"],
    Id: 4, MTime: 10,
    Background: [0.2, 0.2, 0.2], // gray
    RenderWindow: { Id: 1 },
    ViewProps: { Id: 5 },
  },
  5: {
    ClassName: "vtkPropCollection",
    SuperClassNames: ["vtkObjectBase", "vtkObject", "vtkCollection"],
    Id: 5, MTime: 10,
    Items: [{ Id: 6 },],
  },
  6: {
    ClassName: "vtkTextActor",
    SuperClassNames: ["vtkObjectBase", "vtkObject",
        "vtkProp", "vtkActor2D", "vtkTexturedActor2D"],
    Id: 6, MTime: 10,
    Input: "Hello VTK.wasm RemoteSession",
    DisplayPosition: [20, 20],
    TextProperty: { Id: 7 },
  },
  7: {
    ClassName: "vtkTextProperty",
    SuperClassNames: ["vtkObjectBase", "vtkObject"],
    Id: 7, MTime: 10,
    FontSize: 36,
  }
};
// One object's serialized state, as a JSON string (the wire format).
async function fetchState(vtkId) {
  return JSON.stringify(SCENE[vtkId]);
}
// A binary blob by hash. This scene has none, so this is never called.
async function fetchHash(hash) {
  return new Uint8Array();
}
// What exists and what changed since last time.
async function fetchStatus(vtkId) {
  return {
    ids: Object.values(SCENE).map((s) => [s.Id, s.MTime]),
    hashes: [],
    cameras: [],
    force_push: [],
    ignore_ids: [],
  };
}
remote.bindNetwork(fetchState, fetchHash, fetchStatus);
// Own the canvas, size it, then pull the scene in and render it.
const container = document.getElementById("container");
const canvas = document.createElement("canvas");
canvas.tabindex = -1;
container.appendChild(canvas);
remote.bindCanvas(RENDER_WINDOW_ID, canvas);
const resizeObserver = new ResizeObserver((entries) => {
  // Content box already in device pixels — no devicePixelRatio math needed.
  const { inlineSize, blockSize } = entries[0].devicePixelContentBoxSize[0];
  remote.setSizeAsync(RENDER_WINDOW_ID, inlineSize, blockSize);
});
resizeObserver.observe(container);
await remote.updateAsync(RENDER_WINDOW_ID);
    </pre>
</Playground>

## Bring your own canvas

The session never creates, moves, or removes canvas elements — you own them. Create a `<canvas>` and associate it with a render window via [`bindCanvas`](/api/@kitware/vtk-wasm/classes/RemoteSession#bindcanvas), passing either the element itself or the `id` of one already in the DOM:

```js
const canvas = document.createElement("canvas");
remote.bindCanvas(renderWindowId, canvas);           // pass the element directly…
// remote.bindCanvas(renderWindowId, "my-canvas");   // …or the id of a canvas in the DOM
remote.setSizeAsync(renderWindowId, 800, 600);       // size the canvas + render window
```

Passing the element directly registers it with Emscripten's `specialHTMLTargets`, so the canvas needs neither an `id` nor to be attached to the document — handy for off-screen or framework-managed canvases. (On builds that don't expose `specialHTMLTargets`, the canvas must have an `id` so a CSS selector can be used instead.)

When the canvas goes away, [`unbindCanvas`](/api/@kitware/vtk-wasm/classes/RemoteSession#unbindcanvas) removes the listeners, unregisters the target, and forgets the mapping, leaving the element itself untouched.

## Drive updates

Call [`updateAsync`](/api/@kitware/vtk-wasm/classes/RemoteSession#updateasync) to pull the latest server state for a render window and render it.

```js
await remote.updateAsync(renderWindowId);
```

To surface download progress (state + blob counts), register a callback with [`addProgressCallback`](/api/@kitware/vtk-wasm/classes/RemoteSession#addprogresscallback); it returns a function that removes the callback.

## Reading state

Once synchronized, inspect objects locally without another round trip via [`getState`](/api/@kitware/vtk-wasm/classes/RemoteSession#getstate) and [`getStateValue`](/api/@kitware/vtk-wasm/classes/RemoteSession#getstatevalue), or get a controllable proxy with [`getVtkObject`](/api/@kitware/vtk-wasm/classes/RemoteSession#getvtkobject).

## Objects are owned by the server

The server owns the scene's object lifecycle, so a remote session **cannot create or destroy objects** from the client. The `remote.vtk` namespace exists only to *control existing* objects: use [`getVtkObject`](/api/@kitware/vtk-wasm/classes/RemoteSession#getvtkobject) (or `remote.vtk.getVtkObject(id)`) to obtain a proxy for an object the server already created.

Calling a constructor such as `remote.vtk.vtkActor()` or `proxy.delete()` is a no-op: it logs a warning to the console and returns `undefined` / `false` rather than mutating the scene. To add or remove objects, do it on the server and pull the change in with [`update`](#drive-updates).

```js
const actor = remote.getVtkObject(actorId); // ✅ control an existing object
actor.visibility = false;

remote.vtk.vtkActor();                       // ⚠️ warns, returns undefined
actor.delete();                              // ⚠️ warns, returns false
```

## Cleaning up

[`remote.dispose()`](/api/@kitware/vtk-wasm/classes/RemoteSession#dispose) frees the C++ session and detaches the interaction listeners from your canvases (the canvas elements are left in place). As with standalone sessions, `using` works too:

```js
using remote = runtime.createRemoteSession();
```

---

**Reference:** [`RemoteSession`](/api/@kitware/vtk-wasm/classes/RemoteSession) · [`VtkWasmRuntime`](/api/@kitware/vtk-wasm/classes/VtkWasmRuntime)
