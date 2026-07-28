/**
 * Procedural terrain rendered entirely client-side.
 *
 * Nothing here is read from disk: the height field is generated in JavaScript
 * and handed to VTK as typed arrays. That matters because no VTK IO module is
 * currently marshalled into the JavaScript API — `vtkFloatArray.setArray` and
 * `vtkCellArray.setData` are the way to get bulk data into a wasm pipeline.
 *
 * Per-value writes are NOT available (`InsertNextValue` is rejected by the
 * object manager), so every array below is filled in JS first and pushed once.
 */

// --- height field ----------------------------------------------------------

// Integer hash -> [0,1). Deterministic, so the terrain is identical on reload.
function hash2(x, y, seed) {
  let n = x * 374761393 + y * 668265263 + seed * 1442695040888963407;
  n = (n ^ (n >> 13)) * 1274126177;
  return ((n ^ (n >> 16)) >>> 0) / 4294967295;
}

const smoothstep = (t) => t * t * (3 - 2 * t);

function valueNoise(x, y, seed) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const a = hash2(xi, yi, seed);
  const b = hash2(xi + 1, yi, seed);
  const c = hash2(xi, yi + 1, seed);
  const d = hash2(xi + 1, yi + 1, seed);
  const u = smoothstep(xf);
  const v = smoothstep(yf);
  return a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v;
}

// Ridged multifractal: inverted absolute noise, squared to sharpen the ridges,
// with each octave damped by the previous one so peaks stay connected.
function ridged(x, y, seedOffset, octaves) {
  let sum = 0;
  let amplitude = 0.5;
  let frequency = 1.0;
  let weight = 1;
  for (let o = 0; o < octaves; o++) {
    let n = valueNoise(x * frequency, y * frequency, o + seedOffset);
    n = 1 - Math.abs(n * 2 - 1);
    n *= n * weight;
    weight = Math.min(1, n * 1.6);
    sum += n * amplitude;
    amplitude *= 0.52;
    frequency *= 2.02;
  }
  return sum;
}

/**
 * Pick a random-but-safe parameter set.
 *
 * Deliberately NOT free randomness. Unconstrained parameters regularly produce
 * duds -- a sea level a little too high yields a flat plain with a few islets,
 * which reads as broken rather than varied. Every range below is clamped to a
 * band that stays well composed, so any press of "Generate" is presentable.
 */
/**
 * Fixed opening shot. The first thing a visitor sees should never be a bad
 * roll of the dice, so the initial surface is a known-good parameter set and
 * only the "Generate" button randomises.
 */
const OPENING_PARAMETERS = {
  originX: 11.3,
  originY: 7.7,
  seedOffset: 0,
  zoom: 3.2,
  exponent: 1.35,
  relief: 46,
  octaves: 7,
};

function randomTerrainParameters() {
  const rand = (min, max) => min + Math.random() * (max - min);
  return {
    // Where in the (infinite) noise field to sample. This is what actually
    // makes each terrain distinct; the rest only shapes it.
    originX: rand(0, 512),
    originY: rand(0, 512),
    seedOffset: Math.floor(rand(0, 64)),
    // Zoom: fewer repeats = broader massifs, more = busier ranges.
    zoom: rand(2.6, 3.9),
    // >1 pushes terrain toward valleys, keeping peaks distinct. Below ~1.2 the
    // surface turns into undifferentiated lumps.
    exponent: rand(1.25, 1.5),
    relief: rand(40, 52),
    octaves: 7,
  };
}

/**
 * Build point coordinates plus a normalised elevation scalar in [0,1].
 *
 * Elevation is normalised so the colour ramp and the mapper's scalar range stay
 * fixed across regenerations -- only the arrays change, never the pipeline.
 *
 * @param {number} resolution samples per side
 * @param {number} extent world-space width of the patch
 * @param {object} params see {@link randomTerrainParameters}
 */
function buildHeightField(resolution, extent, params) {
  const { originX, originY, seedOffset, zoom, exponent, relief, octaves } =
    params;
  const coordinates = new Float32Array(resolution * resolution * 3);
  const elevation = new Float32Array(resolution * resolution);
  let c = 0;
  let maxElevation = 0;
  for (let j = 0; j < resolution; j++) {
    for (let i = 0; i < resolution; i++) {
      const u = i / (resolution - 1);
      const v = j / (resolution - 1);
      const z =
        Math.pow(
          ridged(u * zoom + originX, v * zoom + originY, seedOffset, octaves),
          exponent,
        ) * relief;
      coordinates[c++] = (u - 0.5) * extent;
      coordinates[c++] = (v - 0.5) * extent;
      coordinates[c++] = z;
      elevation[j * resolution + i] = z;
      if (z > maxElevation) maxElevation = z;
    }
  }
  const inverse = maxElevation > 0 ? 1 / maxElevation : 1;
  for (let i = 0; i < elevation.length; i++) {
    elevation[i] *= inverse;
  }
  return { coordinates, elevation, maxElevation };
}

/** Two triangles per grid cell, as vtkCellArray offset/connectivity arrays. */
function buildTriangles(resolution) {
  const quads = (resolution - 1) * (resolution - 1);
  const connectivity = new Int32Array(quads * 6);
  const offsets = new Int32Array(quads * 2 + 1);
  let k = 0;
  for (let j = 0; j < resolution - 1; j++) {
    for (let i = 0; i < resolution - 1; i++) {
      const a = j * resolution + i;
      const b = a + 1;
      const c = a + resolution;
      const d = c + 1;
      connectivity[k++] = a;
      connectivity[k++] = b;
      connectivity[k++] = d;
      connectivity[k++] = a;
      connectivity[k++] = d;
      connectivity[k++] = c;
    }
  }
  for (let t = 0; t < quads * 2 + 1; t++) {
    offsets[t] = t * 3;
  }
  return { offsets, connectivity };
}

// --- scene -----------------------------------------------------------------

/** Hypsometric ramp over normalised elevation: valley green -> rock -> snow. */
async function createElevationRamp(vtk) {
  const ctf = vtk.vtkColorTransferFunction();
  const stops = [
    [0.0, 0.16, 0.24, 0.2],
    [0.18, 0.28, 0.36, 0.24],
    [0.42, 0.48, 0.44, 0.29],
    [0.62, 0.46, 0.4, 0.36],
    [0.78, 0.62, 0.6, 0.6],
    [0.9, 0.92, 0.93, 0.95],
    [1.0, 1.0, 1.0, 1.0],
  ];
  for (const [t, r, g, b] of stops) {
    await ctf.addRGBPoint(t, r, g, b);
  }
  return ctf;
}

async function buildTerrainScene(vtk, canvasSelector = "#vtk-wasm-window") {
  const RESOLUTION = 420;
  const EXTENT = 100;

  let parameters = OPENING_PARAMETERS;
  const first = buildHeightField(RESOLUTION, EXTENT, parameters);
  const { coordinates, elevation } = first;
  let maxElevation = first.maxElevation;
  // Topology never changes -- only the point coordinates and scalars do -- so
  // the triangles are built once and reused across regenerations.
  const { offsets, connectivity } = buildTriangles(RESOLUTION);

  // Bulk-upload geometry. Each setArray/setData is a single call into wasm.
  const pointArray = vtk.vtkFloatArray();
  await pointArray.setNumberOfComponents(3);
  await pointArray.setArray(coordinates);
  const points = vtk.vtkPoints();
  await points.setData(pointArray);

  const offsetArray = vtk.vtkTypeInt32Array();
  await offsetArray.setArray(offsets);
  const connectivityArray = vtk.vtkTypeInt32Array();
  await connectivityArray.setArray(connectivity);
  const polys = vtk.vtkCellArray();
  await polys.setData(offsetArray, connectivityArray);

  const elevationArray = vtk.vtkFloatArray();
  await elevationArray.setName("Elevation");
  await elevationArray.setNumberOfComponents(1);
  await elevationArray.setArray(elevation);

  const polyData = vtk.vtkPolyData();
  await polyData.setPoints(points);
  await polyData.setPolys(polys);
  await (await polyData.getPointData()).setScalars(elevationArray);

  // Smooth shading; the feature angle keeps ridge lines crisp.
  const normals = vtk.vtkPolyDataNormals();
  await normals.setInputData(polyData);
  await normals.setFeatureAngle(75);
  await normals.update();

  const mapper = vtk.vtkPolyDataMapper({
    lookupTable: await createElevationRamp(vtk),
  });
  await mapper.setInputConnection(await normals.getOutputPort());
  await mapper.setScalarRange([0, 1]);

  const actor = vtk.vtkActor({ mapper });
  await actor.property.setDiffuse(1.0);
  await actor.property.setAmbient(0.12);
  await actor.property.setSpecular(0.08);

  const renderer = vtk.vtkRenderer({ background: [0.05, 0.07, 0.1] });
  await renderer.addActor(actor);

  // Low sun angle so the relief reads through shading, not just colour.
  const sun = vtk.vtkLight();
  await sun.setPosition([-1, -0.6, 0.55]);
  await sun.setFocalPoint([0, 0, 0]);
  await sun.setIntensity(1.35);
  await renderer.addLight(sun);

  const camera = await renderer.getActiveCamera();
  await camera.setViewUp([0, 0, 1]);
  await camera.setViewAngle(34);

  // Frame from the patch extent and the tallest peak rather than hard-coded
  // numbers: relief varies between generations, and a fixed eye point ends up
  // buried inside a slope on some of them.
  async function frameCamera() {
    const half = EXTENT * 0.5;
    await camera.setPosition([-half * 1.55, -half * 1.55, maxElevation * 1.3]);
    await camera.setFocalPoint([0, 0, maxElevation * 0.22]);
    await renderer.resetCameraClippingRange();
  }
  await frameCamera();

  const renderWindow = vtk.vtkRenderWindow({ canvasSelector });
  await renderWindow.addRenderer(renderer);

  const interactor = vtk.vtkRenderWindowInteractor({
    canvasSelector,
    renderWindow,
  });

  // NOTE: the `setCurrentStyleTo*` convenience switchers on the style-switch
  // object are not marshalled -- calling them logs
  // "Call to vtkObjectBase::SetCurrentStyleToTerrain is not permitted" and
  // silently leaves the default style in place. Construct the style and assign
  // it instead. Terrain keeps the up vector pinned, so dragging orbits the
  // horizon rather than tumbling the landscape.
  await interactor.setInteractorStyle(vtk.vtkInteractorStyleTerrain());

  await interactor.start();

  return {
    interactor,
    renderWindow,
    stats: {
      points: RESOLUTION * RESOLUTION,
      triangles: (RESOLUTION - 1) * (RESOLUTION - 1) * 2,
    },

    /**
     * Rebuild the surface with fresh parameters, reusing every VTK object:
     * only the two point arrays are re-uploaded, and the topology is untouched.
     * The camera is re-framed so each new landscape is composed the same way.
     * @returns {Promise<number>} wall-clock milliseconds for the rebuild
     */
    async regenerate() {
      const start = performance.now();
      parameters = randomTerrainParameters();
      const next = buildHeightField(RESOLUTION, EXTENT, parameters);
      maxElevation = next.maxElevation;
      await pointArray.setArray(next.coordinates);
      await elevationArray.setArray(next.elevation);
      await points.modified();
      await polyData.modified();
      await frameCamera();
      await renderWindow.render();
      return performance.now() - start;
    },
  };
}
