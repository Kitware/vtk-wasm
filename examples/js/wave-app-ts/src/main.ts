import { loadAsync, vtkInteractorStyleSwitch } from "@kitware/vtk-wasm";

// This app loads the VTK.wasm bundle it was typed against. `session.vtk` is
// fully typed because `npm run gen:types` ran `vtk-wasm gen-types` against the
// same tarball and emitted `src/vtk-wasm.gen.d.ts`, a module-augmentation file
// that gives every `vtk.vtkXxx(...)` a precise signature. The generated types
// also tell you which calls are asynchronous: only methods VTK marks
// `maySuspend` return a Promise (and need `await`); every other method returns
// its value synchronously.
//
// The scene is a procedural water surface: VTK owns the mesh, JavaScript owns
// the vertex data. Every frame the point positions, normals and scalars are
// rewritten in place through zero-copy TypedArray views onto the wasm heap —
// no per-frame allocation, no copies, no pipeline re-execution.
const BUNDLE_URL = "https://raw.githack.com/Kitware/vtk-wasm/dist/latest/vtk-wasm32-emscripten.tar.gz";
const CANVAS_SELECTOR = "#app > canvas";

/** Quads per side of the surface: (RESOLUTION + 1)^2 points. */
const RESOLUTION = 200;
/** The surface spans [-EXTENT, EXTENT] in x and y. */
const EXTENT = 1;

/** Height range the color map is stretched over. */
const HEIGHT_RANGE = [-0.24, 0.24] as const;

/**
 * Wave field: two ripple sources orbiting the origin, a directional swell and
 * a little high-frequency chop. Evaluated per point per frame, together with
 * its analytic gradient — a heightfield's exact normal is
 * `normalize(-dh/dx, -dh/dy, 1)`, which is both cheaper and smoother than
 * re-running vtkPolyDataNormals on 40k points every frame.
 */
const RIPPLE_AMPLITUDE = 0.12;
const RIPPLE_WAVE_NUMBER = 9.0;
const RIPPLE_FREQUENCY = 3.0;
const RIPPLE_DECAY = 1.1;
const ORBIT_RADIUS = 0.55;
/** Normalizes `r e^(-Dr)` (peak at r = 1/D) to RIPPLE_AMPLITUDE. */
const RIPPLE_ENVELOPE_SCALE = RIPPLE_AMPLITUDE * RIPPLE_DECAY * Math.E;

/** Scratch tuple for `evaluateWave`, reused so the loop allocates nothing. */
const wave = { height: 0, slopeX: 0, slopeY: 0 };

function evaluateWave(x: number, y: number, time: number): void {
  let height = 0;
  let slopeX = 0;
  let slopeY = 0;

  // Two ripple sources drifting in opposite directions.
  for (let source = 0; source < 2; source++) {
    const angularSpeed = source === 0 ? 0.7 : -0.5;
    const phase = source === 0 ? 0 : Math.PI;
    const centerX = ORBIT_RADIUS * Math.cos(angularSpeed * time + phase);
    const centerY = ORBIT_RADIUS * Math.sin(angularSpeed * time + phase);

    const dx = x - centerX;
    const dy = y - centerY;
    const distance = Math.hypot(dx, dy);
    if (distance < 1e-5) {
      continue; // The gradient is undefined at the source; it contributes none.
    }

    const argument = RIPPLE_WAVE_NUMBER * distance - RIPPLE_FREQUENCY * time;
    // r e^(-Dr), scaled so its maximum is exactly RIPPLE_AMPLITUDE. Rising out
    // of zero at the source keeps the rings smooth instead of spiking there.
    const decay = Math.exp(-RIPPLE_DECAY * distance);
    const envelope = RIPPLE_ENVELOPE_SCALE * distance * decay;
    const sine = Math.sin(argument);
    const cosine = Math.cos(argument);

    height += envelope * sine;
    // d/dr [ E(r) sin(Kr - wt) ] = E'(r) sin + E(r) K cos, with
    // E'(r) = S e^(-Dr) (1 - Dr), and dr/dx = dx/r.
    const derivative =
      RIPPLE_ENVELOPE_SCALE * decay * (1 - RIPPLE_DECAY * distance);
    const radial =
      (derivative * sine + envelope * RIPPLE_WAVE_NUMBER * cosine) / distance;
    slopeX += radial * dx;
    slopeY += radial * dy;
  }

  // A slow directional swell.
  const swell = Math.sin(2.4 * x + 1.6 * y - 1.2 * time);
  const swellSlope = 0.07 * Math.cos(2.4 * x + 1.6 * y - 1.2 * time);
  height += 0.07 * swell;
  slopeX += 2.4 * swellSlope;
  slopeY += 1.6 * swellSlope;

  // Fine chop, to keep the specular highlights alive.
  const chopSlope = 0.035 * Math.cos(6.1 * x - 4.7 * y + 1.9 * time);
  height += 0.035 * Math.sin(6.1 * x - 4.7 * y + 1.9 * time);
  slopeX += 6.1 * chopSlope;
  slopeY += -4.7 * chopSlope;

  wave.height = height;
  wave.slopeX = slopeX;
  wave.slopeY = slopeY;
}

async function main(): Promise<void> {
  const runtime = await loadAsync({ url: BUNDLE_URL });
  const session = runtime.createStandaloneSession();
  const { vtk, typedArrayInterface } = session;

  // vtkPlaneSource is typed: the constructor only accepts real vtkPlaneSource
  // properties, and its methods are checked (note `update` takes a port index —
  // the surviving overload from VTK's serdes manifest). The plane is used for
  // its *topology* only: a regular grid of quads whose points this app then
  // takes ownership of.
  const plane = vtk.vtkPlaneSource({
    xResolution: RESOLUTION,
    yResolution: RESOLUTION,
    origin: [-EXTENT, -EXTENT, 0],
    point1: [EXTENT, -EXTENT, 0],
    point2: [-EXTENT, EXTENT, 0],
  });
  plane.update(0);

  const surface = plane.getOutput();
  const pointCount = (RESOLUTION + 1) * (RESOLUTION + 1);

  // Hand VTK three arrays this app allocated. `toVTKAoSArray` picks the VTK
  // array class from the TypedArray's own type (Float32Array ->
  // vtkTypeFloat32Array), copies the values onto the wasm heap and hands that
  // allocation to VTK, which frees it with the array. Because the class is
  // known statically, the views taken back out below are typed Float32Array
  // rather than the untyped TypedArray union.
  // Seeded at t = 0 so the polydata's bounds already cover the wave's full
  // height when the camera is reset below.
  const positions = new Float32Array(3 * pointCount);
  for (let j = 0, index = 0; j <= RESOLUTION; j++) {
    const y = -EXTENT + (2 * EXTENT * j) / RESOLUTION;
    for (let i = 0; i <= RESOLUTION; i++, index += 3) {
      const x = -EXTENT + (2 * EXTENT * i) / RESOLUTION;
      evaluateWave(x, y, 0);
      positions[index] = x;
      positions[index + 1] = y;
      positions[index + 2] = wave.height;
    }
  }
  const positionArray = typedArrayInterface.toVTKAoSArray(positions, 3, "Points");
  const normalArray = typedArrayInterface.toVTKAoSArray(
    new Float32Array(3 * pointCount),
    3,
    "Normals"
  );
  const heightArray = typedArrayInterface.toVTKAoSArray(
    new Float32Array(pointCount),
    1,
    "Height"
  );

  // Replacing the points' data array keeps the plane's quads and swaps in
  // memory this app can address directly.
  surface.points.setData(positionArray);
  surface.pointData.setNormals(normalArray);
  surface.pointData.setScalars(heightArray);

  // Deep water -> foam. Lab interpolation keeps the ramp perceptually even.
  const colorMap = vtk.vtkColorTransferFunction();
  colorMap.setColorSpaceToLab();
  colorMap.addRGBPoint(-0.24, 0.02, 0.09, 0.26);
  colorMap.addRGBPoint(-0.08, 0.05, 0.32, 0.56);
  colorMap.addRGBPoint(0.04, 0.11, 0.62, 0.7);
  colorMap.addRGBPoint(0.14, 0.53, 0.85, 0.72);
  colorMap.addRGBPoint(0.24, 0.97, 0.96, 0.86);

  // `setInputData` rather than `setInputConnection`: the pipeline has already
  // produced its geometry, and nothing downstream should re-execute when the
  // vertex data changes underneath it.
  const mapper = vtk.vtkPolyDataMapper();
  mapper.setInputData(surface);
  mapper.setLookupTable(colorMap);
  mapper.setScalarRange(HEIGHT_RANGE[0], HEIGHT_RANGE[1]);
  mapper.setScalarModeToUsePointData();
  mapper.scalarVisibilityOn();

  const property = vtk.vtkProperty();
  property.setInterpolationToPhong();
  property.setAmbient(0.15);
  property.setDiffuse(0.75);
  property.setSpecular(0.55);
  property.setSpecularPower(45);

  // Class-typed constructor properties and method parameters are nominal
  // `VtkRef<"...">` handles checked against the generated `$brands` ancestor
  // chain — the C++ is-a relationship — so a vtkPolyDataMapper is a valid
  // `mapper` and a vtkActor a valid `addActor` argument, no casts needed.
  const actor = vtk.vtkActor({ mapper, property });

  const renderer = vtk.vtkRenderer({
    background: [0.02, 0.03, 0.08],
    background2: [0.09, 0.13, 0.25],
    gradientBackground: true,
    twoSidedLighting: 1,
  });
  renderer.addActor(actor);

  // Two scene lights (world coordinates, `lightType` 3): a warm key from the
  // upper right and a cool fill from behind, so the crests read as water.
  renderer.addLight(
    vtk.vtkLight({
      lightType: 3,
      position: [2.2, -2.6, 3.2],
      focalPoint: [0, 0, 0],
      diffuseColor: [1.0, 0.95, 0.87],
      specularColor: [1.0, 0.98, 0.92],
      intensity: 1.0,
    })
  );
  renderer.addLight(
    vtk.vtkLight({
      lightType: 3,
      position: [-2.4, 2.2, 1.4],
      focalPoint: [0, 0, 0],
      diffuseColor: [0.42, 0.6, 0.95],
      specularColor: [0.5, 0.7, 1.0],
      intensity: 0.45,
    })
  );

  const camera = renderer.getActiveCamera();
  camera.setPosition(0, -2.9, 2.0);
  camera.setFocalPoint(0, 0, 0);
  camera.setViewUp(0, 0, 1);
  renderer.resetCamera();
  camera.zoom(1.25);

  // Construct the concrete WASM render-window/interactor classes directly:
  // unlike the generic vtkRenderWindow/vtkRenderWindowInteractor interfaces,
  // they carry the `canvasSelector` property that binds them to the canvas.
  const renderWindow = vtk.vtkWebAssemblyOpenGLRenderWindow({
    canvasSelector: CANVAS_SELECTOR,
  });
  renderWindow.addRenderer(renderer);

  const interactor = vtk.vtkWebAssemblyRenderWindowInteractor({
    renderWindow,
    canvasSelector: CANVAS_SELECTOR,
  });
  (interactor.getInteractorStyle() as vtkInteractorStyleSwitch).setCurrentStyleToTrackballCamera();
  interactor.start();

  const statsElement = document.querySelector<HTMLElement>("#stats");
  let frames = 0;
  let lastReport = performance.now();
  const startTime = performance.now();

  function animate(): void {
    const time = (performance.now() - startTime) / 1000;

    // Views alias the wasm heap and are invalidated whenever it grows, so take
    // fresh ones per frame instead of caching them across renders.
    const positionView = typedArrayInterface.toJSTypedArray(positionArray);
    const normalView = typedArrayInterface.toJSTypedArray(normalArray);
    const heightView = typedArrayInterface.toJSTypedArray(heightArray);

    for (let point = 0, index = 0; point < pointCount; point++, index += 3) {
      evaluateWave(positionView[index], positionView[index + 1], time);
      positionView[index + 2] = wave.height;
      heightView[point] = wave.height;

      const length = Math.hypot(wave.slopeX, wave.slopeY, 1);
      normalView[index] = -wave.slopeX / length;
      normalView[index + 1] = -wave.slopeY / length;
      normalView[index + 2] = 1 / length;
    }

    // Writes through a view are invisible to VTK until the array says so; the
    // mapper re-uploads its VBO because the points' MTime moved.
    positionArray.modified();
    normalArray.modified();
    heightArray.modified();
    renderWindow.render();

    frames++;
    const now = performance.now();
    if (statsElement && now - lastReport >= 500) {
      const fps = (frames * 1000) / (now - lastReport);
      statsElement.textContent =
        `${pointCount.toLocaleString()} points · ` +
        `${(RESOLUTION * RESOLUTION).toLocaleString()} quads · ` +
        `${fps.toFixed(0)} fps`;
      frames = 0;
      lastReport = now;
    }
    requestAnimationFrame(animate);
  }
  requestAnimationFrame(animate);
}

main().catch((err) => console.error(err));
