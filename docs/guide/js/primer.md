# Primer on VTK.wasm

This primer introduces the **vtk** namespace and the core interaction patterns used to create and manipulate VTK objects. If you want to jump straight to rendering, go to [WebGL2 rendering within HTML canvas](#webgl2-rendering-within-html-canvas)

All of these code snippets load the vtk-wasm JS library and the binaries using a `<script>` tag in the HTML - for convenience. See [HTML Script Tag](./integration.md#html-script-tag) for details.

## Print VTK version

This is how you can print the version of VTK in use.

<Playground>
    <textarea data-lang="html" style="display:none"><!doctype html>
<html lang="en">
    <head>
        <script
            src="https://unpkg.com/@kitware/vtk-wasm/vtk-umd.js"
            id="vtk-wasm"
            data-url="https://raw.githack.com/Kitware/vtk-wasm/dist/latest/vtk-wasm32-emscripten.tar.gz">
        </script>
    </head>
    <body>
    </body>
</html></textarea>
    <pre data-lang="js" style="display:none">const vtk = await vtkwasm.ready;
console.log(`VTK version: ${vtkwasm.session.wasmModule.getVTKVersion()}`);</pre>
</Playground>


## Create objects

Start by instantiating the class you need from the `vtk` namespace.

<Playground>
    <textarea data-lang="html" style="display:none"><!doctype html>
<html lang="en">
    <head>
        <script
            src="https://unpkg.com/@kitware/vtk-wasm/vtk-umd.js"
            id="vtk-wasm"
            data-url="https://raw.githack.com/Kitware/vtk-wasm/dist/latest/vtk-wasm32-emscripten.tar.gz">
        </script>
    </head>
    <body>
    </body>
</html></textarea>
    <pre data-lang="js" style="display:none">const vtk = await vtkwasm.ready;
const camera = vtk.vtkCamera();
console.log("Created a camera: ", camera.toString());</pre>
</Playground>

## Print objects to console

Once you have an object, inspection usually comes next. Use `toString()` to invoke the underlying C++ `vtkObject::Print()` implementation, or use `toJSON()` to retrieve a JSON representation. In practice, the two outputs are often very similar.

<Playground>
    <textarea data-lang="html" style="display:none"><!doctype html>
<html lang="en">
    <head>
        <script
            src="https://unpkg.com/@kitware/vtk-wasm/vtk-umd.js"
            id="vtk-wasm"
            data-url="https://raw.githack.com/Kitware/vtk-wasm/dist/latest/vtk-wasm32-emscripten.tar.gz">
        </script>
    </head>
    <body>
    </body>
</html></textarea>
    <pre data-lang="js" style="display:none">const vtk = await vtkwasm.ready;
const camera = vtk.vtkCamera();
// directly calls C++ vtkObject::Print()
console.log(camera.toString());
console.log(camera.$state);
// console.log("Camera proxy: ", camera.proxy);</pre>
</Playground>

The second `console.log` prints `camera.$state` instead of `camera` because objects created through the `vtk` namespace are returned as JavaScript `Proxy` instances. In browser developer tools, the `$state` property provides the most useful serialized view of that proxy. Proxy plumbing members are `$`-prefixed so they never shadow a C++ property or method of the same name.

The full proxy structure looks like this. Uncomment the last line to inspect it in the developer console:

```js
Proxy(Object) {$id: 1, $obj: {…}, $set: ƒ, $observe: ƒ, toJSON: ƒ, …}
[[Handler]] : Object
    get : get(d,h,O){return d[h]!==void 0?d[h]:d.$userData[h]!==void 0?d.$userData[h]:h==="then"?O:h==="$state"?e.get?V(e.get(n)):(e.updateStateFromObject(n),V(e.getState(n))):h==="$delete"?a:l[h]?l[h]():(d[h]=async(...Ee)=> {…}
    set : ƒ set(d,h,O)
    [[Prototype]] : Object
[[Target]] : Object
    $id : 1
    $obj : {Id: 1}
    $observe : ƒ p(d,h)
    $set : ƒ S(d)
    toJSON : ƒ b()
    toString : ƒ u()
    $unObserve : ƒ c(d)
    $unObserveAll : ƒ o()
    $userData : {}
    [[Prototype]] : Object
[[IsRevoked]] : false
```

## Edit object properties

Object properties can be read and assigned with standard `.` notation.

<Playground console-min-height=80px>
    <textarea data-lang="html" style="display:none"><!doctype html>
<html lang="en">
    <head>
        <script
            src="https://unpkg.com/@kitware/vtk-wasm/vtk-umd.js"
            id="vtk-wasm"
            data-url="https://raw.githack.com/Kitware/vtk-wasm/dist/latest/vtk-wasm32-emscripten.tar.gz">
        </script>
    </head>
    <body>
    </body>
</html></textarea>
    <pre data-lang="js" style="display:none">const vtk = await vtkwasm.ready;
const camera = vtk.vtkCamera();
console.log("Initial position: ", camera.position);
camera.position = [10, 20, 30];
console.log("New position: ", camera.position);</pre>
</Playground>

## Call functions on objects

Member functions are also accessed with `.` notation. These calls return `Promise` objects, so use `await` when you need the resolved result.

<Playground console-min-height=100px>
    <textarea data-lang="html" style="display:none"><!doctype html>
<html lang="en">
    <head>
        <script
            src="https://unpkg.com/@kitware/vtk-wasm/vtk-umd.js"
            id="vtk-wasm"
            data-url="https://raw.githack.com/Kitware/vtk-wasm/dist/latest/vtk-wasm32-emscripten.tar.gz">
        </script>
    </head>
    <body>
    </body>
</html></textarea>
    <pre data-lang="js" style="display:none">const vtk = await vtkwasm.ready;
const camera = vtk.vtkCamera();
await camera.azimuth(10.0);
console.log("New position after azimuth: ", camera.position);
const renderer = vtk.vtkRenderer();
console.log("Old active camera at: ", renderer.activeCamera.position)
renderer.activeCamera = camera;
// await renderer.setActiveCamera(camera); // same as above
console.log("New active camera at: ", renderer.activeCamera.position);</pre>
</Playground>

## Pass objects as arguments

The same object model extends to method arguments. When an API expects another VTK object, pass the proxy directly.

<Playground console-min-height=80px>
    <textarea data-lang="html" style="display:none"><!doctype html>
<html lang="en">
    <head>
        <script
            src="https://unpkg.com/@kitware/vtk-wasm/vtk-umd.js"
            id="vtk-wasm"
            data-url="https://raw.githack.com/Kitware/vtk-wasm/dist/latest/vtk-wasm32-emscripten.tar.gz">
        </script>
    </head>
    <body>
    </body>
</html></textarea>
    <pre data-lang="js" style="display:none">const vtk = await vtkwasm.ready;
const camera = vtk.vtkCamera();
camera.position = [10, 20, 30];
const renderer = vtk.vtkRenderer();
console.log("Old active camera at: ", renderer.activeCamera.position)
await renderer.setActiveCamera(camera);
// renderer.activeCamera = camera; // same as above
console.log("New active camera at: ", renderer.activeCamera.position);</pre>
</Playground>

## Delete

When an object is no longer needed, call `delete()` to release its external JavaScript reference to the underlying C++ instance. If another VTK object still owns that instance, the C++ object may remain alive. In JavaScript, clear your local reference immediately afterward so the handle is not reused accidentally.

<Playground>
    <textarea data-lang="html" style="display:none"><!doctype html>
<html lang="en">
    <head>
        <script
            src="https://unpkg.com/@kitware/vtk-wasm/vtk-umd.js"
            id="vtk-wasm"
            data-url="https://raw.githack.com/Kitware/vtk-wasm/dist/latest/vtk-wasm32-emscripten.tar.gz">
        </script>
    </head>
    <body>
    </body>
</html></textarea>
<pre data-lang="js" style="display:none">
const vtk = await vtkwasm.ready;
let actor = vtk.vtkActor();
actor.$delete();
// console.log(actor.toString()) // prints (null)
actor = null;
</pre>
</Playground>

## Arrays

VTK provides array classes for typed data exchange. These arrays accept JavaScript `TypedArray` instances directly, which makes initialization straightforward.

<Playground>
    <textarea data-lang="html" style="display:none"><!doctype html>
<html lang="en">
    <head>
        <script
            src="https://unpkg.com/@kitware/vtk-wasm/vtk-umd.js"
            id="vtk-wasm"
            data-url="https://raw.githack.com/Kitware/vtk-wasm/dist/latest/vtk-wasm32-emscripten.tar.gz">
        </script>
    </head>
    <body>
    </body>
</html></textarea>
<pre data-lang="js" style="display:none">
const vtk = await vtkwasm.ready;
const coordinates = vtk.vtkTypeFloat64Array();
coordinates.number_of_components = 3;
await coordinates.SetArray(new Float64Array([-1, -1, 0, 1, -1, 0]));
console.log(await coordinates.GetTuple1(0));
</pre>
</Playground>

## User data

In addition to VTK-managed state, you can attach custom JavaScript properties to store application-specific metadata.

<Playground>
    <textarea data-lang="html" style="display:none"><!doctype html>
<html lang="en">
    <head>
        <script
            src="https://unpkg.com/@kitware/vtk-wasm/vtk-umd.js"
            id="vtk-wasm"
            data-url="https://raw.githack.com/Kitware/vtk-wasm/dist/latest/vtk-wasm32-emscripten.tar.gz">
        </script>
    </head>
    <body>
    </body>
</html></textarea>
<pre data-lang="js" style="display:none">
const vtk = await vtkwasm.ready;
const actor = vtk.vtkActor();
actor.partName = "Body-1";
console.log(`Part name: ${actor.partName}`);
</pre>
</Playground>

## Observers

For interactive workflows, register event handlers with `$observe()`. Remove a handler later by passing its returned tag to `object.$unObserve()`.

<Playground>
    <textarea data-lang="html" style="display:none"><!doctype html>
<html lang="en">
    <head>
        <script
            src="https://unpkg.com/@kitware/vtk-wasm/vtk-umd.js"
            id="vtk-wasm"
            data-url="https://raw.githack.com/Kitware/vtk-wasm/dist/latest/vtk-wasm32-emscripten.tar.gz">
        </script>
    </head>
    <body>
    </body>
</html></textarea>
<pre data-lang="js" style="display:none">
const vtk = await vtkwasm.ready;
const actor = vtk.vtkActor();
const tag = actor.$observe('ModifiedEvent', () => { console.log("Actor modified"); });
actor.visibility = false;
actor.visibility = true;
actor.visibility = false;
actor.$unObserve(tag);
actor.visibility = true;
</pre>
</Playground>


## WebGL2 rendering within HTML canvas

Create a canvas in your HTML and ensure that you assign the `id` of the canvas to the `renderWindow.canvasSelector` property so VTK knows where to render, and to the `renderWindowInteractor.canvasSelector` property so VTK knows which element to receive events from.

<Playground display-i-frame>
    <textarea data-lang="html" style="display:none"><!doctype html>
<html lang="en">
  <head>
    <style>
      html, body {
        margin: 0;
        padding: 0;
        overflow: hidden;
      }
    </style>
    <script
      src="https://unpkg.com/@kitware/vtk-wasm/vtk-umd.js"
      id="vtk-wasm"
      data-url="https://raw.githack.com/Kitware/vtk-wasm/dist/latest/vtk-wasm32-emscripten.tar.gz"></script>
  </head>
  <body>
    <div style="min-height:300px">
      <canvas
        id="vtk-wasm-window"
        tabindex="-1"
        onclick="focus()"
        oncontextmenu="event.preventDefault()"></canvas>
    </div>
  </body>
</html></textarea>
<pre data-lang="js" style="display:none">
const vtk = await vtkwasm.ready;
const mesh = vtk.vtkPartitionedDataSetCollectionSource({
    numberOfShapes: 1
});
const mapper = vtk.vtkCompositePolyDataMapper();
await mapper.setInputConnection(await mesh.getOutputPort());
const actor = vtk.vtkActor({mapper})
const renderer = vtk.vtkRenderer({background: [0.2, 0.2, 0.2]});
renderer.addViewProp(actor);
const canvasSelector = "#vtk-wasm-window";
const renderWindow = vtk.vtkRenderWindow({ canvasSelector });
await renderWindow.addRenderer(renderer);
const interactor = vtk.vtkRenderWindowInteractor({
    canvasSelector,
    renderWindow,
});
await renderer.resetCamera();
await interactor.interactorStyle.setCurrentStyleToTrackballCamera();
await interactor.start();</pre>
</Playground>

## WebGL2 rendering into a canvas without an `id`

Normally VTK locates the canvas via a CSS selector, which requires the element to have a DOM `id`. If your canvas is framework-managed, dynamically created, or simply has no `id`, register it directly with `session.registerCanvas(key, canvas)`. The key must start with `!` (Emscripten convention) and is then used as the `canvasSelector`.

When using the annotation auto-load (`id="vtk-wasm"`), the owning session is available as `vtkwasm.session` after `ready` resolves. When using [`loadAsync`](./loading.md) directly, the session is returned from `createStandaloneSession()`:

```js
const runtime = await loadAsync({ url: "..." });
const session = runtime.createStandaloneSession();
const canvasSelector = session.registerCanvas("!vtk-canvas", canvas);
const vtk = session.vtk;
```

<Playground display-i-frame>
    <textarea data-lang="html" style="display:none"><!doctype html>
<html lang="en">
  <head>
    <style>
      html, body {
        margin: 0;
        padding: 0;
        overflow: hidden;
      }
    </style>
    <script
      src="https://unpkg.com/@kitware/vtk-wasm/vtk-umd.js"
      id="vtk-wasm"
      data-url="https://raw.githack.com/Kitware/vtk-wasm/dist/latest/vtk-wasm32-emscripten.tar.gz"></script>
  </head>
  <body>
    <div style="min-height:300px">
      <canvas
        tabindex="-1"
        onclick="focus()"
        oncontextmenu="event.preventDefault()"></canvas>
    </div>
  </body>
</html></textarea>
<pre data-lang="js" style="display:none">
const vtk = await vtkwasm.ready;
const canvas = document.querySelector("canvas");
const canvasSelector = vtkwasm.session.registerCanvas("!vtk-canvas", canvas);
const mesh = vtk.vtkPartitionedDataSetCollectionSource({
    numberOfShapes: 1
});
const mapper = vtk.vtkCompositePolyDataMapper();
await mapper.setInputConnection(await mesh.getOutputPort());
const actor = vtk.vtkActor({mapper})
const renderer = vtk.vtkRenderer({background: [0.2, 0.2, 0.2]});
renderer.addViewProp(actor);
const renderWindow = vtk.vtkRenderWindow({ canvasSelector });
await renderWindow.addRenderer(renderer);
const interactor = vtk.vtkRenderWindowInteractor({
    canvasSelector,
    renderWindow,
});
await renderer.resetCamera();
await interactor.interactorStyle.setCurrentStyleToTrackballCamera();
await interactor.start();</pre>
</Playground>
