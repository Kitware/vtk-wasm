/**
 * Public type entry point for `@kitware/vtk-wasm`.
 *
 * Exports the hand-written runtime/session API and the open interfaces
 * (vtkObject, VtkNamespace, ...) that the `vtk-wasm gen-types` CLI augments
 * with per-class VTK members. See ./base.d.ts.
 *
 * @module @kitware/vtk-wasm
 */

export * from "./base.js";
