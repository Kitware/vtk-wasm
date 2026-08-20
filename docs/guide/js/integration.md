# Adding VTK.wasm to a Project

There are two ways to get VTK.wasm into a web project:

- **HTML Script Tag** — load a prebuilt bundle from a CDN, no build step required. Best for quick prototypes, demos, and embedding into existing pages.
- **Bundler** — install the `@kitware/vtk-wasm` package and `import` it. Best for application development with a tool like Vite.

Either way you end up calling [`loadAsync`](./loading.md); only how it reaches the page differs.

## HTML Script Tag

Use VTK.wasm directly in an HTML file using a `<script>` tag without a build step.

The following examples rely on loading the `vtk.umd.js` bundle from a CDN. To focus on the initialization part, we've externalized the JS/WASM scene code since that part does not change.

### Load WASM as a module

In this example we pre-load the WASM module, so we don't need to provide any URL when loading it.

::: code-group
<<< ../../public/demo/plain-javascript-preload.html
<<< ../../public/demo/example.js
:::

### Defer WASM loading

Since we didn't pre-load the WASM module here, we provide the URL where the WASM bundle can be found.

::: code-group
<<< ../../public/demo/plain-javascript.html
<<< ../../public/demo/example.js
:::

<iframe src="/vtk-wasm/demo/plain-javascript.html" style="width: 100%; height: 40vh; border: none;"></iframe>

[Full Screen Viewer](../../demo/plain-javascript.html){target="_blank"}

### Defer WASM loading with annotation

Here we tag the script to autoload WASM directly from the VTK repository's package registry; the VTK namespace is then reached by awaiting `vtkwasm.ready`. You can customize the wasm architecture and version by changing the `data-url`.

::: code-group
<<< ../../public/demo/plain-javascript-annotation-wasm-registry.html
<<< ../../public/demo/example.js
:::

<iframe src="/vtk-wasm/demo/plain-javascript-annotation-wasm-registry.html" style="width: 100%; height: 40vh; border: none;"></iframe>

[Full Screen Viewer](../../demo/plain-javascript-annotation-wasm-registry.html){target="_blank"}

The `data-config` attribute on the annotation `<script>` accepts the same settings as the options object passed to `loadAsync(...)` — for example, add `data-config='{"rendering": "webgpu"}'` to switch the rendering backend. See [Loading VTK.wasm](./loading.md) for what each option does, or the [`loadAsync` reference](/api/@kitware/vtk-wasm/functions/loadAsync) for the exact option types.


## Bundler with TypeScript

`@kitware/vtk-wasm` ships hand-written types for the runtime and session API. See
[TypeScript types](./typescript.md).

### Project setup

The example below is a [Vite](https://vite.dev/) + TypeScript app; the full code
lives [here](https://github.com/Kitware/vtk-wasm/tree/main/examples/js/wave-app-ts).
Three pieces wire the types together:

- **`gen:types`** runs `vtk-wasm gen-types --url <bundle> --out src/vtk-wasm.gen.d.ts`
  against the same URL `main.ts` passes to `loadAsync`. Keeping one URL for both
  guarantees the declarations describe the binary that actually runs.
- **`predev` / `prebuild`** call it, so the declarations are refreshed before
  every dev server start and every build, so that you don't accidentally use stale types.
- **`tsconfig.json`** has `"include": ["src"]`, which picks up the generated file
  automatically. `build` runs `tsc --noEmit` before `vite build`, so a scene that
  no longer matches the bundle fails the build instead of the browser showing a runtime type error.

::: code-group
<<< ../../../examples/js/wave-app-ts/package.json
<<< ../../../examples/js/wave-app-ts/tsconfig.json
<<< ../../../examples/js/wave-app-ts/index.html
<<< ../../../examples/js/wave-app-ts/src/main.ts [src/main.ts]
```bash [Install/Build]
npm install
npm run build
```
:::

### Result

<iframe src="/vtk-wasm/demo/wave-app-ts/index.html" style="width: 100%; height: 25vh; border: none;"></iframe>

[Full Screen Viewer](../../demo/wave-app-ts/index.html){target="_blank"}

## Bundler with pure Javascript

Modern web development relies on a package manager to bring in project dependencies. This section covers how published releases are used within a JavaScript project.

### Project setup

In this simple example we use [Vite](https://vite.dev/) with Vanilla JavaScript. The full code is available for reference [here](https://github.com/Kitware/vtk-wasm/tree/main/examples/js/simple-app). Use a concrete version, or `"latest"`, for the `@kitware/vtk-wasm` package. Here, the example uses a relative path to the `vtk-wasm` project root so the in-repo documentation stays relevant.

::: code-group
<<< ../../../examples/js/simple-app/package.json
<<< ../../../examples/js/simple-app/index.html
<<< ../../../examples/js/simple-app/src/main.js [src/main.js]
<<< ../../../examples/js/simple-app/src/style.css [src/style.css]
```bash [Install/Build]
npm install
npm run build
```
:::

Here, the VTK.wasm bundle is downloaded in the browser directly from the GitLab package registry. See the `src/main.js` file for the relevant code.

### Result

<iframe src="/vtk-wasm/demo/simple-app/index.html" style="width: 100%; height: 25vh; border: none;"></iframe>

[Full Screen Viewer](../../demo/simple-app/index.html){target="_blank"}
