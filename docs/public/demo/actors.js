/**
 * Many-actor scale test: a process plant where every object is its own actor.
 *
 * The point of this demo is the *count*, not the geometry. Each piece of
 * equipment is an independent `vtkActor` with its own transform and material,
 * so the renderer is doing real per-actor work rather than drawing one merged
 * mesh. Press "+1000 actors" until the frame rate bends.
 *
 * Geometry comes from `FiltersSources` primitives because that is what the
 * JavaScript API offers: there is no image reader for PBR textures, and
 * `vtkAssembly` / `vtkTransformPolyDataFilter` are not marshalled, so hierarchy
 * has to be flat and every actor is positioned directly.
 *
 * One mapper per primitive type is shared across every actor that uses it --
 * only the actor-level transform and colour differ.
 */

const MAX_ACTORS = 24000; // guard rail; well past where the frame rate bends

const STEEL = [0.6, 0.63, 0.67];
const DARK = [0.32, 0.34, 0.38];
const PIPE = [0.28, 0.5, 0.7];
const BEAM = [0.55, 0.38, 0.2];

/** Deterministic PRNG so a reload gives the same plant. */
function makeRandom(seed) {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };
}

async function buildActorScene(vtk, canvasSelector = "#vtk-wasm-window") {
  const cylinder = vtk.vtkCylinderSource();
  await cylinder.setResolution(16);
  await cylinder.setCapping(1);
  const cube = vtk.vtkCubeSource();
  const plane = vtk.vtkPlaneSource();
  const sphere = vtk.vtkSphereSource();
  await sphere.setThetaResolution(12);
  await sphere.setPhiResolution(10);

  const makeMapper = async (source) => {
    const mapper = vtk.vtkPolyDataMapper();
    await mapper.setInputConnection(await source.getOutputPort());
    return mapper;
  };
  const mappers = {
    cylinder: await makeMapper(cylinder),
    cube: await makeMapper(cube),
    plane: await makeMapper(plane),
    sphere: await makeMapper(sphere),
  };

  const renderer = vtk.vtkRenderer({ background: [0.05, 0.06, 0.08] });
  let actorCount = 0;

  async function addActor(mapper, position, scale, orientation, color) {
    const actor = vtk.vtkActor({ mapper });
    await actor.setPosition(position);
    await actor.setScale(scale);
    await actor.setOrientation(orientation);
    await actor.property.setColor(color);
    await actor.property.setSpecular(0.4);
    await actor.property.setSpecularPower(30);
    await renderer.addActor(actor);
    actorCount++;
  }

  /** One storage tank: shell, roof rim, stanchions, strakes. ~17 actors. */
  async function addTank(random, x, y) {
    const radius = 5 + random() * 3;
    const height = 9 + random() * 11;
    await addActor(
      mappers.cylinder,
      [x, y, height / 2],
      [radius, height, radius],
      [90, 0, 0],
      STEEL,
    );
    await addActor(
      mappers.cylinder,
      [x, y, height + 0.5],
      [radius * 1.06, 1, radius * 1.06],
      [90, 0, 0],
      DARK,
    );
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * Math.PI * 2;
      await addActor(
        mappers.cube,
        [
          x + Math.cos(a) * radius * 1.02,
          y + Math.sin(a) * radius * 1.02,
          height / 2,
        ],
        [0.35, 0.35, height],
        [0, 0, 0],
        DARK,
      );
    }
    for (let s = 0; s < 5; s++) {
      await addActor(
        mappers.cylinder,
        [x, y, (height * (s + 1)) / 6],
        [radius * 1.03, 0.25, radius * 1.03],
        [90, 0, 0],
        DARK,
      );
    }
  }

  /** A pipe rack bay: lanes of pipe with flanges, on a trestle. ~20 actors. */
  async function addRackBay(x, y) {
    for (let lane = 0; lane < 8; lane++) {
      const z = 3 + lane * 2.6;
      await addActor(
        mappers.cylinder,
        [x, y, z],
        [0.55, 23, 0.55],
        [0, 0, 90],
        PIPE,
      );
      await addActor(
        mappers.sphere,
        [x + 11, y, z],
        [0.8, 0.8, 0.8],
        [0, 0, 0],
        DARK,
      );
    }
    await addActor(mappers.cube, [x, y, 11], [1.4, 26, 1.4], [0, 0, 0], BEAM);
    await addActor(
      mappers.cube,
      [x, y - 13, 11],
      [1.2, 1.2, 22],
      [0, 0, 0],
      BEAM,
    );
    await addActor(
      mappers.cube,
      [x, y + 13, 11],
      [1.2, 1.2, 22],
      [0, 0, 0],
      BEAM,
    );
  }

  /** Actor cost of each unit, so a batch can hit its target exactly. */
  const TANK_ACTORS = 17; // shell + rim + 10 stanchions + 5 strakes
  const RACK_ACTORS = 19; // 8 lanes x (pipe + flange) + 3 trestle members

  /** A single drum. Used to top a batch up to an exact count. */
  async function addDrum(random, index) {
    // Drums sit in the open band between the tank rows and the pipe corridor,
    // so they cannot collide with either.
    const x = -140 + (index % 40) * 7;
    const y = -55 + (Math.floor(index / 40) % 12) * 7;
    await addActor(
      mappers.cylinder,
      [x, y, 1.6],
      [1.5, 3.2, 1.5],
      [90, 0, 0],
      random() > 0.5 ? STEEL : BEAM,
    );
  }

  // Layout is partitioned so equipment can never intersect: tank rows march
  // outward in +/-y, while the pipe corridor stays on a fixed y and only grows
  // along x. Racks can intersect with each other.
  const RACK_Y = 55;
  const pending = [];
  const rackColumns = new Set();
  let ring = 0;
  let yardSpan = 150;
  let drumIndex = 0;
  const random = makeRandom(7);

  function planRing() {
    const span = 150 + ring * 34;
    yardSpan = span;
    const columns = 9 + ring * 2;
    for (let i = 0; i < columns; i++) {
      const x = -span + (i * (span * 2)) / Math.max(1, columns - 1);
      pending.push({ kind: "tank", x, y: -90 - ring * 34 });
      pending.push({ kind: "tank", x, y: 150 + ring * 34 });
      const column = Math.round(x);
      if (!rackColumns.has(column)) {
        rackColumns.add(column);
        pending.push({ kind: "rack", x, y: RACK_Y });
      }
    }
    ring++;
  }

  /**
   * Add exactly `target` actors. Whole units are placed while they fit, then
   * the remainder is filled with single-actor drums -- otherwise the count
   * overshoots by up to one unit and the HUD reads 1,008 instead of 1,000.
   */
  async function addBatch(target) {
    let remaining = target;
    while (remaining > 0 && actorCount < MAX_ACTORS) {
      if (pending.length === 0) planRing();
      const next = pending[0];
      const cost = next.kind === "tank" ? TANK_ACTORS : RACK_ACTORS;
      if (cost > remaining) break;
      pending.shift();
      if (next.kind === "tank") await addTank(random, next.x, next.y);
      else await addRackBay(next.x, next.y);
      remaining -= cost;
    }
    while (remaining > 0 && actorCount < MAX_ACTORS) {
      await addDrum(random, drumIndex++);
      remaining--;
    }
    return actorCount;
  }

  // Ground plane, then the opening plant.
  await addActor(
    mappers.plane,
    [0, 0, -1],
    [900, 900, 2],
    [0, 0, 0],
    [1.0, 1.0, 1.0],
  );
  await addBatch(1000 - actorCount);

  function computeLightPosition(rho, phi, theta) {
    return [
      rho * Math.sin(phi) * Math.cos(theta),
      rho * Math.sin(phi) * Math.sin(theta),
      rho * Math.cos(phi)
    ];
  }

  const lightCoords = [
    [1.0, -Math.PI * 0.25, -Math.PI * 0.25],
    [1.0, -Math.PI * 0.25, Math.PI * 0.25],
    [1.0, Math.PI * 0.25, -Math.PI * 0.25],
    [1.0, Math.PI * 0.25, Math.PI * 0.25],
  ]
  lightCoords.forEach(async (coordinates) => {
    const light = vtk.vtkLight();
    await light.setPosition(computeLightPosition(...coordinates));
    await light.setFocalPoint([0, 0, 0]);
    await light.setIntensity(0.8);
    await renderer.addLight(light);
  })

  const camera = await renderer.getActiveCamera();
  await camera.setViewUp([0, 0, 1]);
  await camera.setViewAngle(32);

  async function frameYard() {
    await camera.setPosition([
      -yardSpan * 1.25,
      -yardSpan * 1.45,
      yardSpan * 0.7,
    ]);
    await camera.setFocalPoint([0, yardSpan * 0.1, 12]);
    await renderer.resetCameraClippingRange();
  }
  await frameYard();

  const renderWindow = vtk.vtkRenderWindow({ canvasSelector });
  await renderWindow.addRenderer(renderer);
  const interactor = vtk.vtkRenderWindowInteractor({
    canvasSelector,
    renderWindow,
  });
  await interactor.setInteractorStyle(vtk.vtkInteractorStyleTrackballCamera());
  await interactor.start();

  // --- frame loop --------------------------------------------------------
  // Rendering continuously is what makes the frame rate meaningful: a static
  // scene would report whatever the last idle frame cost. Auto-rotation pauses
  // while the pointer is down so it does not fight a drag.
  let autoRotate = true;
  let fps = 0;
  let last = performance.now();
  let busy = false;

  const canvas = document.querySelector(canvasSelector);
  canvas.addEventListener("pointerdown", () => (autoRotate = false));
  window.addEventListener("pointerup", () => (autoRotate = true));

  async function frame() {
    if (!busy) {
      busy = true;
      if (autoRotate) await camera.azimuth(0.12);
      await renderWindow.render();
      const now = performance.now();
      const instant = 1000 / Math.max(1, now - last);
      last = now;
      // Exponential moving average: raw per-frame numbers are far too jittery
      // to read off a HUD.
      fps = fps === 0 ? instant : fps * 0.9 + instant * 0.1;
      busy = false;
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  return {
    get actorCount() {
      return actorCount;
    },
    get fps() {
      return fps;
    },
    maxActors: MAX_ACTORS,
    async addActors(count) {
      const started = performance.now();
      await addBatch(count);
      await frameYard();
      return performance.now() - started;
    },
  };
}
