# wave-app-ts

A TypeScript + Vite demo that animates a procedural water surface with VTK.wasm
and shows the end-to-end typed-`session.vtk` developer experience.

## What it demonstrates

- `npm run gen:types` runs the `vtk-wasm gen-types` CLI against the exact
  VTK.wasm bundle the app loads. It writes `src/vtk-wasm.gen.d.ts`, a
  `declare module "@kitware/vtk-wasm"` augmentation that makes every
  `session.vtk.vtkXxx(...)` call precisely typed.
- `tsc --noEmit` (run as part of `npm run build`) is the acceptance check that
  the typed scene code compiles against the generated declarations.
- `src/main.ts` builds a 200×200 quad grid with `vtkPlaneSource`, replaces its
  point positions, normals and scalars with arrays this app allocated, and
  rewrites all three every frame through zero-copy `TypedArray` views onto the
  wasm heap — no per-frame allocation, no copies, no pipeline re-execution.
  Normals are the analytic heightfield gradient, so the surface shades smoothly
  without re-running `vtkPolyDataNormals` on 40k points per frame.

## Local bundle dependency

This app is intentionally **not** wired into the repository's `build:examples`
CI chain: it depends on a local, absolute path to a VTK.wasm build artifact.

The tarball in `public/` is what Vite serves and what `gen:types` generates the
declarations from. Point both at whatever VTK.wasm `.tar.gz` you have (update
the path in `package.json` and the `BUNDLE_URL` in `src/main.ts`).

## Run

```bash
npm install
npm run dev      # generates types, starts Vite
```

Open the printed URL; the animated surface renders with a live point/quad/fps
readout in the overlay. Drag to orbit, scroll to zoom.

```bash
npm run build    # generates types + tsc --noEmit + vite build
```
