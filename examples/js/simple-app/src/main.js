import "./style.css";
import { loadVtkWasm } from "@kitware/vtk-wasm";
import { buildWASMScene } from "./example";

const runtime = await loadVtkWasm({
  url: "https://gitlab.kitware.com/api/v4/projects/13/packages/generic/vtk-wasm32-emscripten/9.5.20251215/vtk-9.5.20251215-wasm32-emscripten.tar.gz",
});
const session = runtime.createStandaloneSession();
buildWASMScene(session.vtk, "#app > canvas", "This scene passes the VTK.wasm bundle from GitLab registry to loadVtkWasm()");
