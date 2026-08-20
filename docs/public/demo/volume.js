/**
 * GPU volume ray casting of an analytic scalar field.
 *
 * The field comes from `vtkRTAnalyticSource` -- the "wavelet" source VTK ships
 * for testing and demos -- so the data is computed inside wasm rather than
 * downloaded. Nothing here is a baked asset, and no IO module is involved
 * (none is currently marshalled into the JavaScript API anyway).
 *
 * The transfer-function presets below re-map colour and opacity only. Switching
 * them never touches the volume, which stays exactly where it is in wasm
 * memory -- that is what makes the switch feel instant.
 */

// Half-width of the sampled extent: (2 * HALF_EXTENT + 1)^3 voxels.
const HALF_EXTENT = 40;

// Banded opacity reads best on this field, so it is what a visitor lands on.
const DEFAULT_PRESET = "Shells";

/**
 * Presets are expressed as fractions of the field's scalar range, so they hold
 * regardless of what range the source actually reports.
 * @type {Record<string, {color: [number, number, number, number][], opacity: [number, number][]}>}
 */
const PRESETS = {
  Shells: {
    color: [
      [0.0, 0.02, 0.1, 0.16],
      [0.38, 0.1, 0.66, 0.62],
      [0.52, 0.5, 0.92, 0.78],
      [0.68, 0.98, 0.66, 0.32],
      [1.0, 0.72, 0.12, 0.2],
    ],
    opacity: [
      [0.0, 0.0],
      [0.3, 0.0],
      [0.38, 0.55],
      [0.46, 0.0],
      [0.58, 0.0],
      [0.66, 0.6],
      [0.74, 0.0],
      [0.86, 0.0],
      [0.93, 0.7],
      [1.0, 0.0],
    ],
  },
  "Full field": {
    color: [
      [0.0, 0.03, 0.05, 0.22],
      [0.3, 0.09, 0.36, 0.8],
      [0.52, 0.16, 0.76, 0.82],
      [0.72, 0.55, 0.92, 0.5],
      [0.88, 0.98, 0.76, 0.28],
      [1.0, 1.0, 0.97, 0.88],
    ],
    opacity: [
      [0.0, 0.0],
      [0.18, 0.0],
      [0.42, 0.05],
      [0.68, 0.25],
      [0.86, 0.6],
      [1.0, 0.95],
    ],
  },
  Peaks: {
    color: [
      [0.0, 0.08, 0.04, 0.16],
      [0.55, 0.35, 0.08, 0.42],
      [0.78, 0.95, 0.3, 0.18],
      [0.92, 1.0, 0.72, 0.25],
      [1.0, 1.0, 0.96, 0.75],
    ],
    opacity: [
      [0.0, 0.0],
      [0.66, 0.0],
      [0.78, 0.18],
      [0.9, 0.72],
      [1.0, 1.0],
    ],
  },
};

async function applyPreset(vtk, property, name, [low, high]) {
  const span = high - low;
  const at = (t) => low + t * span;

  const preset = PRESETS[name];
  const color = vtk.vtkColorTransferFunction();
  for (const [t, r, g, b] of preset.color) {
    color.addRGBPoint(at(t), r, g, b);
  }
  const opacity = vtk.vtkPiecewiseFunction();
  for (const [t, a] of preset.opacity) {
    opacity.addPoint(at(t), a);
  }
  property.setColor(color);
  property.setScalarOpacity(opacity);
}

async function buildVolumeScene(vtk, canvasSelector = "#vtk-wasm-window") {
  const source = vtk.vtkRTAnalyticSource();
  source.setWholeExtent(
    -HALF_EXTENT,
    HALF_EXTENT,
    -HALF_EXTENT,
    HALF_EXTENT,
    -HALF_EXTENT,
    HALF_EXTENT,
  );
  source.update();

  // Read the range back rather than hard-coding it, so the presets stay correct
  // if the extent or the source's defaults ever change.
  const scalarRange = source.getOutput().pointData.getScalars().getRange();

  const mapper = vtk.vtkSmartVolumeMapper();
  mapper.setInputConnection(source.getOutputPort());

  const property = vtk.vtkVolumeProperty();
  property.setInterpolationTypeToLinear();
  // Shading gives the field surface-like depth cues; without it the render is
  // a flat haze no matter how the opacity is tuned.
  property.setShade(1);
  property.setAmbient(0.3);
  property.setDiffuse(0.75);
  property.setSpecular(0.35);
  property.setSpecularPower(18);
  applyPreset(vtk, property, DEFAULT_PRESET, scalarRange);

  const volume = vtk.vtkVolume({ mapper, property });

  const renderer = vtk.vtkRenderer({ background: [0.04, 0.05, 0.07] });
  renderer.addVolume(volume);
  renderer.resetCamera();

  // Oblique view: straight down an axis collapses the field's symmetry into
  // flat rings and hides the depth the ray cast is resolving.
  const span = HALF_EXTENT * 4;
  const camera = renderer.getActiveCamera();
  camera.setPosition([-span * 0.95, -span * 0.72, span * 0.6]);
  camera.setFocalPoint([0, 0, 0]);
  camera.setViewUp([0, 0, 1]);
  renderer.resetCameraClippingRange();

  const renderWindow = vtk.vtkRenderWindow({ canvasSelector });
  renderWindow.addRenderer(renderer);

  const interactor = vtk.vtkRenderWindowInteractor({
    canvasSelector,
    renderWindow,
  });
  interactor.setInteractorStyle(vtk.vtkInteractorStyleTrackballCamera());
  interactor.start();

  const side = HALF_EXTENT * 2 + 1;
  return {
    presets: Object.keys(PRESETS),
    stats: {
      side,
      voxels: side ** 3,
      scalarRange,
    },
    async usePreset(name) {
      applyPreset(vtk, property, name, scalarRange);
      renderWindow.render();
    },
  };
}
