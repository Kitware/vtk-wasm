import { loadAsync } from "@kitware/vtk-wasm";
import { MESH_TYPE_LABELS, createCameraView } from "./cameraView";
import { readCameraState } from "./cameraState";
import { createObserverView } from "./observerView";
import { createPanel } from "./panel";
import "./style.css";

// Same URL as `gen:types` in package.json, so the generated declarations match.
const BUNDLE_URL = "https://raw.githack.com/Kitware/vtk-wasm/dist/latest/vtk-wasm32-emscripten.tar.gz";

const OBSERVER_CANVAS = "#observer-canvas";
const CAMERA_CANVAS = "#camera-canvas";

async function main(): Promise<void> {
  const status = document.querySelector<HTMLElement>("#status");
  const setStatus = (text: string): void => {
    if (status) {
      status.textContent = text;
    }
  };

  setStatus("Loading VTK.wasm…");
  const runtime = await loadAsync({ url: BUNDLE_URL });
  const session = runtime.createStandaloneSession();
  const { vtk, typedArrayInterface } = session;

  setStatus("Building scene…");
  const cameraView = createCameraView(vtk, CAMERA_CANVAS);
  const observerView = createObserverView(vtk, typedArrayInterface, OBSERVER_CANVAS, cameraView);

  // refresh loop: camera or render-window events mark the app dirty; one RAF
  // tick then reads the camera and redraws the gizmo + panel.
  let dirty = false;
  let scheduled = false;
  let firstRefresh = true;
  let lastFramedMTime = -1;
  let panelUpdate: ((state: ReturnType<typeof readCameraState>) => void) | null = null;

  function tick(): void {
    scheduled = false;
    if (!dirty) {
      return;
    }
    dirty = false;
    if (firstRefresh) {
      // Canvases now have their real size, so the aspect ratio is known.
      firstRefresh = false;
      cameraView.frame();
    }
    const state = readCameraState(cameraView);
    observerView.update(state);
    panelUpdate?.(state);
    if (state.mtime !== lastFramedMTime && lastFramedMTime < 0) {
      lastFramedMTime = state.mtime;
      observerView.resetView();
    } else {
      observerView.render();
    }
  }

  function refresh(): void {
    dirty = true;
    if (!scheduled) {
      scheduled = true;
      requestAnimationFrame(tick);
    }
  }

  const panel = createPanel(document.querySelector<HTMLElement>("#panel")!, {
    cameraView,
    observerView,
    refresh,
  });
  panelUpdate = panel.update;

  const sourceLabel = document.querySelector<HTMLElement>("#camera-view-source");
  cameraView.onMeshChange((type) => {
    if (sourceLabel) {
      sourceLabel.textContent = MESH_TYPE_LABELS[type];
    }
  });

  cameraView.camera.$observe("ModifiedEvent", refresh);
  cameraView.renderWindow.$observe("EndEvent", refresh);

  cameraView.start();
  observerView.start();
  cameraView.render();
  refresh();

  const wasmModule = session.wasmModule as { getVTKVersion?: () => string };
  const version = typeof wasmModule.getVTKVersion === "function" ? wasmModule.getVTKVersion() : "unknown";
  setStatus(`VTK ${version} · ${runtime.isAsync() ? "async" : "sync"} · WebGL`);

  // Handy for the browser console.
  Object.assign(window, { vtkCameraGuide: { session, vtk, cameraView, observerView, refresh } });
}

main().catch((error: unknown) => {
  console.error(error);
  const status = document.querySelector<HTMLElement>("#status");
  if (status) {
    status.textContent = `Failed to start: ${error instanceof Error ? error.message : String(error)}`;
  }
});
