# vtk-wasm

## Project Structure and Build Scripts

This repository provides the infrastructure to bundle the pure JavaScript library for loading VTK.wasm.

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
