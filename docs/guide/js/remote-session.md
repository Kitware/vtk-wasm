# Remote Session

A **remote session** mirrors a scene that lives on a server. The server owns the real VTK pipeline; the browser receives serialized object **state** plus binary **blobs**, registers them into a local WebAssembly scene, and renders. This is the model used by [trame](../trame/) and the [data viewer](../viewer/).

Use a remote session when the data is large, generated server-side, or shared across clients. For purely in-browser work, reach for a [Standalone Session](./standalone-session.md) instead.

Create one from a [runtime](./loading.md):

```js
import { loadVtkWasm } from "@kitware/vtk-wasm";

const runtime = await loadVtkWasm({ url: VTK_WASM_BUNDLE_URL });
const remote = runtime.createRemoteSession();
```

## Wire up the network

A remote session does not know how to reach your server. You provide three fetchers through [`bindNetwork`](/api/@kitware/vtk-wasm/classes/RemoteSession#bindnetwork): one to fetch an object's state, one to fetch a blob by hash, and one to fetch the server's status (what changed since last time).

```js
remote.bindNetwork(fetchState, fetchHash, fetchStatus);
```

## Bring your own canvas

The session never creates, moves, or removes canvas elements — you own them. Create a `<canvas>` with an `id`, add it to the DOM, then associate it with a render window via [`bindCanvas`](/api/@kitware/vtk-wasm/classes/RemoteSession#bindcanvas):

```js
remote.bindCanvas(renderWindowId, "my-canvas");      // install interaction listeners
remote.setSize(renderWindowId, 800, 600);            // size the canvas + render window
```

When the canvas goes away, [`unbindCanvas`](/api/@kitware/vtk-wasm/classes/RemoteSession#unbindcanvas) removes the listeners and forgets the mapping, leaving the element itself untouched.

## Drive updates

Call [`update`](/api/@kitware/vtk-wasm/classes/RemoteSession#update) to pull the latest server state for a render window and render it. Pass `bindCanvas: true` the first time so the render window is connected to its canvas:

```js
await remote.update(renderWindowId, /* bindCanvas */ true);
```

To surface download progress (state + blob counts), register a callback with [`addProgressCallback`](/api/@kitware/vtk-wasm/classes/RemoteSession#addprogresscallback); it returns a function that removes the callback.

## Reading state

Once synchronized, inspect objects locally without another round trip via [`getState`](/api/@kitware/vtk-wasm/classes/RemoteSession#getstate) and [`getStateValue`](/api/@kitware/vtk-wasm/classes/RemoteSession#getstatevalue), or get a controllable proxy with [`getVtkObject`](/api/@kitware/vtk-wasm/classes/RemoteSession#getvtkobject).

## Cleaning up

[`remote.dispose()`](/api/@kitware/vtk-wasm/classes/RemoteSession#dispose) frees the C++ session and detaches the interaction listeners from your canvases (the canvas elements are left in place). As with standalone sessions, `using` works too:

```js
using remote = runtime.createRemoteSession();
```

---

**Reference:** [`RemoteSession`](/api/@kitware/vtk-wasm/classes/RemoteSession) · [`VtkWasmRuntime`](/api/@kitware/vtk-wasm/classes/VtkWasmRuntime)
