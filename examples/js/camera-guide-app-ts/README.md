# vtkCamera guide

An interactive, browser-only explainer for `vtkCamera`, built with
[VTK.wasm](https://kitware.github.io/vtk-wasm/) and TypeScript. One view lets you drive a
camera looking at a mesh; a second view draws that camera as geometry (position, focal
point, view-up, frustum, clipping planes) while a side panel lists every parameter, matrix
and viewport value live.

## Run

```bash
npm install
npm run dev      # generates src/vtk-wasm.gen.d.ts, starts Vite
```

```bash
npm run build    # gen types + tsc --noEmit + vite build (output in dist/)
npm run preview
```
