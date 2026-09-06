// Build-time Shiki highlighting for the landing page code panels.
//
// VitePress data loaders run in Node during build, so the highlighted markup is
// baked into the page and no highlighter ships to the browser. Themes match the
// ones VitePress uses for markdown code fences; `defaultColor: false` emits
// `--shiki-light` / `--shiki-dark` custom properties instead of a fixed colour,
// which the default theme's `.vp-code` CSS resolves per colour scheme.
//
// Consumed by theme/components/Landing.vue.
import { createHighlighter } from "shiki";

const BUNDLE_URL =
  "https://raw.githack.com/Kitware/vtk-wasm/dist/latest/vtk-wasm32-emscripten.tar.gz";

const THEMES = { light: "github-light", dark: "github-dark" };
const LANGS = ["html", "javascript", "typescript", "cpp", "python"];

const js = `import { loadAsync } from "@kitware/vtk-wasm";

const runtime = await loadAsync({
  url: "${BUNDLE_URL}",
  rendering: "webgl", // or "webgpu"
});
const session = runtime.createStandaloneSession();
const vtk = session.vtk;

const cone = vtk.vtkConeSource();
const mapper = vtk.vtkPolyDataMapper();
mapper.setInputConnection(cone.getOutputPort());

const actor = vtk.vtkActor({ mapper });
const renderer = vtk.vtkRenderer();
renderer.addActor(actor);

const canvasSelector = session.registerCanvas("!vtk-canvas", canvas);
const interactor = vtk.vtkRenderWindowInteractor({ canvasSelector });
const window = vtk.vtkRenderWindow({ interactor, canvasSelector });
window.addRenderer(renderer);
await window.render();
interactor.start();
`;

const ts = `import { loadAsync, type StandaloneSession } from "@kitware/vtk-wasm";

const runtime = await loadAsync({
  url: "${BUNDLE_URL}",
  rendering: "webgl", // or "webgpu"
});
const session: StandaloneSession = runtime.createStandaloneSession();
const vtk = session.vtk;

const cone = vtk.vtkConeSource({ resolution: 32 });
const mapper = vtk.vtkPolyDataMapper();
mapper.setInputConnection(cone.getOutputPort());

const actor = vtk.vtkActor({ mapper });
const renderer = vtk.vtkRenderer();
renderer.addActor(actor);

const canvasSelector = session.registerCanvas("!vtk-canvas", canvas);
const interactor = vtk.vtkRenderWindowInteractor({ canvasSelector });
const window = vtk.vtkRenderWindow({ interactor, canvasSelector });
window.addRenderer(renderer);
await window.render();
interactor.start();
`;

const cpp = `#include <vtkActor.h>
#include <vtkConeSource.h>
#include <vtkNew.h>
#include <vtkPolyDataMapper.h>
#include <vtkRenderWindow.h>
#include <vtkRenderWindowInteractor.h>
#include <vtkRenderer.h>

int main()
{
  vtkNew<vtkConeSource> cone;

  vtkNew<vtkPolyDataMapper> mapper;
  mapper->SetInputConnection(cone->GetOutputPort());

  vtkNew<vtkActor> actor;
  actor->SetMapper(mapper);

  vtkNew<vtkRenderer> renderer;
  renderer->AddActor(actor);

  vtkNew<vtkRenderWindow> window;
  window->AddRenderer(renderer);

  vtkNew<vtkRenderWindowInteractor> interactor;
  interactor->SetRenderWindow(window);
  interactor->Start();
  return 0;
}`;

const trame = `from trame.app import get_server
from trame.ui.vuetify3 import SinglePageLayout
from trame.widgets import vtklocal
import vtk

server = get_server()

cone_pipeline = vtk.vtkConeSource() >> vtk.vtkPolyDataMapper()
actor = vtk.vtkActor(mapper=cone_pipeline.last)

renderer = vtk.vtkRenderer()
renderer.AddActor(actor)

window = vtk.vtkRenderWindow()
window.AddRenderer(renderer)

interactor = vtk.vtkRenderWindowInteractor(render_window=window)

with SinglePageLayout(server) as layout:
    with layout.content:
        vtklocal.LocalView(render_window)

server.start()`;

const SNIPPETS = [
  { key: "js", lang: "javascript", code: js },
  { key: "ts", lang: "typescript", code: ts },
  { key: "cpp", lang: "cpp", code: cpp },
  { key: "trame", lang: "python", code: trame },
];

export default {
  async load() {
    const highlighter = await createHighlighter({
      themes: Object.values(THEMES),
      langs: LANGS,
    });

    const out = {};
    for (const { key, lang, code } of SNIPPETS) {
      out[key] = highlighter.codeToHtml(code, {
        lang,
        themes: THEMES,
        defaultColor: false,
        transformers: [
          {
            // Shiki writes the theme background and a tabindex onto <pre>; the
            // landing supplies its own panel chrome, so drop both.
            pre(node) {
              delete node.properties.style;
              delete node.properties.tabindex;
            },
          },
        ],
      });
    }

    highlighter.dispose();
    return out;
  },
};
