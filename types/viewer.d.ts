/**
 * Hand-written declarations for `@kitware/vtk-wasm/viewer`: load a serialized
 * VTK scene (`.vtk-wasm` export) into a remote session and display it.
 *
 * @module @kitware/vtk-wasm/viewer
 */

import type { RemoteSession, LoadOptions } from "./base.js";

/**
 * Displays a serialized VTK scene (`.vtk-wasm` export) inside a container
 * element using a remote session.
 */
export class ExportViewer {
  constructor(containerSelector: string, remoting: RemoteSession);
  /** Load and display a `.vtk-wasm` scene from the given URL. */
  loadAsync(url: string): Promise<void>;
  /** Resize observer that keeps the canvas sized to the container. */
  readonly resizeObserver: ResizeObserver;
}

/**
 * Convenience: load the WASM runtime, create a remote session, instantiate an
 * {@link ExportViewer}, and load the scene — all in one call.
 */
export function createViewerAsync(
  containerSelector: string,
  dataURL: string,
  wasmURL?: string,
  wasmConfig?: LoadOptions,
): Promise<ExportViewer>;
