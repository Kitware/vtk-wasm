# TypeScript types

`@kitware/vtk-wasm` ships hand-written types for the runtime and session API
(`loadAsync`, `StandaloneSession`, the proxy plumbing, ...). The per-class VTK
surface — every `session.vtk.vtkXxx(...)` constructor and the methods and
properties on the objects it returns — is **generated on demand** from the exact
VTK.wasm bundle your app loads.

## Why generate locally?

The wrapper's npm version is independent of the VTK version, and the per-class
serdes manifests (`types/*.json`) that describe the type surface ship _with the
VTK.wasm binary_ — they vary by VTK version and by architecture (wasm32 vs
wasm64). Bundling a single snapshot in the package would type the wrong VTK for
most users. Instead, a CLI derives the types from the binary you actually use,
so they always match — releases, nightlies, and custom builds alike.

## Generate the declarations

Point the `vtk-wasm gen-types` CLI at the same bundle you pass to
[`loadAsync`](./loading.md):

```bash
npx vtk-wasm gen-types \
  --url https://.../vtk-9.5.1-wasm32.tar.gz \
  --out src/vtk-wasm.gen.d.ts
```

`--url` accepts a `.tar.gz` bundle as a local path or an `http(s)` URL. If you
already have the manifests unpacked, use `--in <dir>` (repeatable) instead. The
default `--out` is `./vtk-wasm.gen.d.ts`.

Make sure the output file is picked up by your `tsconfig.json` `include` (a file
under `src/` usually is). That is all — no imports or configuration at your call
sites:

```ts
import { loadAsync } from "@kitware/vtk-wasm";

const runtime = await loadAsync({ url: "/vtk-9.5.1-wasm32.tar.gz" });
const session = runtime.createStandaloneSession();

const cone = session.vtk.vtkConeSource({ resolution: 32 }); // typed vtkConeSource
cone.update(0);
const output = cone.getOutput(); // typed vtkPolyData
```

Only methods VTK marks `maySuspend` return a `Promise` (their generated
signature is `Promise<T>`); every other proxy method returns synchronously, so
no `await` is needed.

The generated file is a
[module augmentation](https://www.typescriptlang.org/docs/handbook/declaration-merging.html#module-augmentation)
(`declare module "@kitware/vtk-wasm" { ... }`) that merges a precise signature
for every VTK class in your bundle into the open `VtkNamespace` interface.

## Fallback without generated types

If you skip generation, everything still compiles: `VtkNamespace` carries a loose
index signature, so `session.vtk.vtkAnything(...)` type-checks and returns the
base `vtkObject` — with the proxy plumbing (`$id`, `$set`, `$observe`, ...) fully
typed. You lose per-class property/method checking until you generate.

## Architecture note

The manifests are architecture-specific: word-width C++ types are already baked
to a concrete width by the VTK build (32-bit integers → `number`; 64-bit
integers → `bigint`). The CLI is arch-agnostic — it simply reflects whatever
bundle you feed it. If you ship both wasm32 and wasm64, generate against your
**primary** architecture; the two differ only where 64-bit integer types appear.

## A note on C++ overloads

VTK's C++ overloads collapse to a single surviving signature per class in the
serdes manifest, and signature hiding means a subclass sometimes redeclares an
inherited method with an incompatible signature — so a subclass (e.g.
`vtkPolyDataMapper`) is not always _structurally_ assignable to its base (e.g.
`vtkMapper`).

The generated types mirror C++'s **nominal** typing instead: every interface
carries a phantom `$brands` member listing its full ancestor chain, and every
class-typed parameter or settable property is typed `VtkRef<"vtkMapper">` —
"anything branded as a vtkMapper". Passing a `vtkPolyDataMapper` where a
`vtkMapper` is expected therefore just works, with no casts and no `$set`
detour, while passing an unrelated class (say, a `vtkRenderer`) is still a
compile error. Return values keep the full structural interface, so
autocomplete on results is unaffected. `$brands` never exists at runtime.

One limit: _direct assignment_ to a class-typed property on the main interface
(`actor.mapper = mapper`) is still checked structurally. Set such properties
through the constructor (`vtk.vtkActor({ mapper })`) or `$set` instead.
