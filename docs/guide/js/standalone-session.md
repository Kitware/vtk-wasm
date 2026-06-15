# Standalone Session

A **standalone session** runs everything in the browser: you create VTK objects, build a pipeline, and render to a canvas — all client-side, with no server involved. This is the most common way to use VTK.wasm.

Create one from a [runtime](./loading.md):

```js
import { loadVtkWasmAsync } from "@kitware/vtk-wasm";

const runtime = await loadVtkWasmAsync({ url: VTK_WASM_BUNDLE_URL });
const session = runtime.createStandaloneSession();

const vtk = session.vtk; // the namespace
```

## The `vtk` namespace

[`session.vtk`](/api/@kitware/vtk-wasm/classes/StandaloneSession#vtk) is the single object you create everything from. Calling `vtk.vtkActor({ ... })` instantiates the corresponding C++ class and returns a proxy you drive with plain JavaScript.

The interaction patterns — creating objects, reading and writing properties, calling methods, observers, and rendering to a `<canvas>` — are covered in the [Primer on VTK.wasm](./primer.md). The primer reaches the namespace through the annotation shortcut (`window.vtkReady`); `session.vtk` is the exact same namespace obtained explicitly.

## Cleaning up

When you are done, call [`session.dispose()`](/api/@kitware/vtk-wasm/classes/StandaloneSession#dispose) to free the underlying C++ session and every object it owns:

```js
session.dispose();
```

Sessions also implement `Symbol.dispose`, so a `using` declaration disposes automatically at the end of the scope:

```js
using session = runtime.createStandaloneSession();
// ... session.dispose() runs automatically here
```

Disposing a session is what actually reclaims C++ memory — see [Releasing a runtime](./loading.md#releasing-a-runtime) for why disposing the runtime is not enough.

## Escape hatch

If you need a C++ API that the namespace does not surface, [`session.native`](/api/@kitware/vtk-wasm/classes/StandaloneSession#native) exposes the raw `vtkStandaloneSession`. Prefer `session.vtk` for everyday use.

---

**Reference:** [`StandaloneSession`](/api/@kitware/vtk-wasm/classes/StandaloneSession) · [`VtkWasmRuntime`](/api/@kitware/vtk-wasm/classes/VtkWasmRuntime)
