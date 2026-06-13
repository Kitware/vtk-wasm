# @kitware/vtk-wasm

JavaScript bindings for loading and driving [VTK](https://www.vtk.org) compiled to WebAssembly — build 3D visualizations in the browser with no C++ required.

**Full documentation, guides, and API reference:** https://kitware.github.io/vtk-wasm/

## Usage

Install the package:

```bash
npm install @kitware/vtk-wasm
```

Load the runtime, create a session, and use its `vtk` namespace:

```js
import { loadVtkWasm } from "@kitware/vtk-wasm";

const runtime = await loadVtkWasm({ url: VTK_WASM_BUNDLE_URL });
const session = runtime.createStandaloneSession();
const vtk = session.vtk;

const cone = vtk.vtkConeSource();
// ... build and render your scene
```

No build step? Load the UMD bundle from a CDN and use the global `vtkWASM`:

```html
<script src="https://unpkg.com/@kitware/vtk-wasm/vtk-umd.js"></script>
```

See the [Loading VTK.wasm guide](https://kitware.github.io/vtk-wasm/guide/js/loading) to get started and the [API reference](https://kitware.github.io/vtk-wasm/api/) for every export.

## Contributing

Requires [Node.js](https://nodejs.org/) (LTS).

```bash
npm install        # install dependencies
npm run build      # build the ESM + UMD bundles into dist/
npm run docs:dev   # run the documentation site locally
npm run lint       # lint the source
```

### Repository layout

- `src/` — library source.
- `examples/` — example applications.
- `docs/` — documentation site (VitePress); the API reference is generated from source JSDoc.
- `dist/` — build output.
