# VTK.wasm viewer

Thanks to VTK.wasm we are getting close to full parity with what is available in VTK C++ and therefore we can create viewers that display scenes equivalent to what you can produce with ParaView or VTK.

The code snippet available below show you how you can embed a static 3D scene inside a web page.

<<< ../../public/demo/viewer-basic.html

The `createViewerAsync` method give you the opportunity to fill a DOM element using a selector and the path of the data to load. Additionally, you can provide the path to the WASM library to load unless it is imported as a script. Finally, you can configure your running by setting the rendering backend and execution mode.

Below is the result of the code above.

<div style="width: 100%; height: 25vh; border-radius: 12px; overflow: hidden; margin: 1rem 0;">
<iframe src="/vtk-wasm/demo/viewer-basic.html" style="width: 100%; height: 100%; border: none;">
</iframe>
</div>
