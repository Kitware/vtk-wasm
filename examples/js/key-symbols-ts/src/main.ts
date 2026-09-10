import { loadAsync, vtkInteractorObserver } from "@kitware/vtk-wasm";

const BUNDLE_URL =
  "https://raw.githack.com/Kitware/vtk-wasm/dist/latest/vtk-wasm32-emscripten.tar.gz";
const CANVAS_SELECTOR = "#app > canvas";

function setupKeycodeOverlay(
  canvas: HTMLCanvasElement,
): (vtkKeyCode: string, vtkKeySym: string) => void {
  const statusTitle = document.getElementById("status-title")!;
  const statusSub = document.getElementById("status-sub")!;
  const idleIcon = document.getElementById("idle-icon")!;
  const keyBox = document.getElementById("key-box")!;
  const keyGrid = document.getElementById("key-grid")!;
  const vtkGrid = document.getElementById("vtk-grid")!;
  const valKey = document.getElementById("val-key")!;
  const valCode = document.getElementById("val-code")!;
  const valKeyCode = document.getElementById("val-keycode")!;
  const valWhich = document.getElementById("val-which")!;
  const valVtkKeyCode = document.getElementById("val-vtk-keycode")!;
  const valVtkKeySym = document.getElementById("val-vtk-keysym")!;

  window.addEventListener("keydown", (event: KeyboardEvent) => {
    statusTitle.textContent = "Key Detected!";
    statusSub.textContent = "Press another key to test";
    idleIcon.setAttribute("hidden", "");
    keyBox.removeAttribute("hidden");
    keyGrid.removeAttribute("hidden");
    keyBox.textContent = event.key === " " ? "Space" : event.key;
    valKey.textContent = event.key.includes(" ") ? `"${event.key}"` : event.key;
    valCode.textContent = event.code;
    valKeyCode.textContent = String(event.keyCode);
    valWhich.textContent = String(event.which);
  });

  // The canvas must always keep focus so it can receive keypress events.
  const refocus = (): void => canvas.focus();
  canvas.addEventListener("blur", () => setTimeout(refocus, 0));
  document.addEventListener("click", refocus);
  refocus();

  return (vtkKeyCode: string, vtkKeySym: string): void => {
    vtkGrid.removeAttribute("hidden");
    valVtkKeyCode.textContent = vtkKeyCode;
    valVtkKeySym.textContent = vtkKeySym.includes(" ")
      ? `"${vtkKeySym}"`
      : vtkKeySym;
  };
}

async function main(): Promise<void> {
  const canvas = document.querySelector<HTMLCanvasElement>(CANVAS_SELECTOR)!;
  const updateVtkRow = setupKeycodeOverlay(canvas);

  const runtime = await loadAsync({ url: BUNDLE_URL });
  const session = runtime.createStandaloneSession();
  const { vtk } = session;

  const renderer = vtk.vtkRenderer({ background: [0.1, 0.1, 0.1] });
  const window_ = vtk.vtkWebAssemblyOpenGLRenderWindow({
    canvasSelector: CANVAS_SELECTOR,
  });
  window_.addRenderer(renderer);
  const interactor = vtk.vtkWebAssemblyRenderWindowInteractor({
    renderWindow: window_,
    canvasSelector: CANVAS_SELECTOR,
  });
  interactor.setInteractorStyle(null as unknown as vtkInteractorObserver);
  console.log("Adding observer");
  interactor.$observe("KeyPressEvent", (sender: number, eventName: string) => {
    const vtkKeyCode = interactor.getKeyCode();
    const vtkKeySym = interactor.getKeySym();
    updateVtkRow(String(vtkKeyCode), String(vtkKeySym));
  });
  await window_.render();
  interactor.start();
  canvas.focus();
}

main().catch((err) => console.error(err));
