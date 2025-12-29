# vtk-wasm

## Project Structure and Build Scripts

This repository provides the infrastructure to bundle the pure JavaScript library for loading VTK.wasm.

The full usage documentation of vtk-wasm can be found at: https://kitware.github.io/vtk-wasm/

### File Structure

- `src/` — Source code for the library.
- `dist/` — Bundled output files.
- `wasm/` — WebAssembly binaries and related assets.
- `scripts/` — Utility scripts for building and packaging.
- `README.md` — Project documentation.
- `package.json` — Project metadata and build scripts.

### Build Scripts

The following scripts are available in `package.json`:

- **`npm run docs:build`** - Builds the guide pages for VTK.wasm
- **`npm run build`** — Builds the ESM and UMD bundles for both RemoteSession and StandaloneSession.
- **`npm run build:esm`** — Builds only the ESM bundles.
- **`npm run build:vtk`** — Builds only the UMD bundle for StandaloneSession.
- **`npm run build:viewer`** - Builds the vtkWASMViewer JavaScript library.
- **`npm run clean`** — Cleans the `dist/` directory.
- **`npm run lint`** — Runs code linting on the source files.

### Bundles

- **ESM Bundles:** For both RemoteSession and StandaloneSession.
- **UMD Bundle:** For StandaloneSession, exposed as the `VTK` namespace for use in browser environments.

Refer to the `package.json` for the full list of scripts and configuration details.

### ESM imports

```js
import { RemoteSession } from "@kitware/vtk-wasm/remote"
import { createVtkObjectProxy, createNamespace } from "@kitware/vtk-wasm/vtk"
import { ExportViewer, createViewer } from "@kitware/vtk-wasm/viewer"
```

### RemoteSession progress

```js
import { RemoteSession } from "@kitware/vtk-wasm/remote"

const session = new RemoteSession()
const removeProgress = session.addProgressCallback(({ active, state, hash }) => {
  // state: { current, total }, hash: { current, total }
  // active is true while states/blobs are being fetched
})

// Later, to stop listening:
removeProgress()
```

### UMD imports

```js
import "@kitware/vtk-wasm/viewer.css";
import "@kitware/vtk-wasm/viewer-umd.js";

import "@kitware/vtk-wasm/vtk-umd.js";
```
