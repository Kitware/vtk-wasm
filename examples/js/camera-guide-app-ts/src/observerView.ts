import type {
  TypedArrayInterface,
  VtkNamespace,
  vtkActor,
  vtkCaptionActor2D,
  vtkMatrix4x4,
  vtkPolyData,
  vtkRenderer,
  vtkSphereSource,
  vtkTubeFilter,
  vtkWebAssemblyOpenGLRenderWindow,
  vtkWebAssemblyRenderWindowInteractor,
  vtkInteractorStyleSwitch,
} from "@kitware/vtk-wasm";
import type { CameraView } from "./cameraView";
import type { CameraState } from "./cameraState";
import { add, arrowMatrix, lerp, scale, type Vec3 } from "./math";

/** Toggleable pieces of the camera gizmo. */
export const GIZMO_PARTS = [
  "nearPlane",
  "farPlane",
  "frustumEdges",
  "projectionDirection",
  "viewUp",
  "focalPlane",
  "markers",
  "labels",
  "sceneObject",
  "axes",
] as const;
export type GizmoPart = (typeof GIZMO_PARTS)[number];

export interface GizmoPartInfo {
  label: string;
  color: Vec3;
  css: string;
  description: string;
}

export const GIZMO_PART_INFO: Record<GizmoPart, GizmoPartInfo> = {
  nearPlane: {
    label: "Near clipping plane",
    color: [0.29, 0.87, 0.5],
    css: "#4ade80",
    description: "ClippingRange[0] along the direction of projection",
  },
  farPlane: {
    label: "Far clipping plane",
    color: [0.97, 0.44, 0.44],
    css: "#f87171",
    description: "ClippingRange[1] along the direction of projection",
  },
  frustumEdges: {
    label: "Frustum edges",
    color: [0.8, 0.84, 0.88],
    css: "#cbd5e1",
    description: "near→far corner edges (+ apex lines in perspective)",
  },
  projectionDirection: {
    label: "Direction of projection",
    color: [0.98, 0.57, 0.24],
    css: "#fb923c",
    description: "unit vector Position → FocalPoint (= −ViewPlaneNormal)",
  },
  viewUp: {
    label: "View up",
    color: [0.38, 0.65, 0.98],
    css: "#60a5fa",
    description: "ViewUp, drawn from Position",
  },
  focalPlane: {
    label: "Focal plane",
    color: [0.13, 0.83, 0.93],
    css: "#22d3ee",
    description: "frustum cross-section at Distance (through FocalPoint)",
  },
  markers: {
    label: "Position (white) / FocalPoint (yellow)",
    color: [1, 1, 1],
    css: "#ffffff",
    description: "spheres at Position and FocalPoint",
  },
  labels: {
    label: "Labels",
    color: [0.9, 0.9, 0.9],
    css: "#e5e7eb",
    description: "vtkCaptionActor2D captions",
  },
  sceneObject: {
    label: "Scene object",
    color: [0.7, 0.7, 0.7],
    css: "#b3b3b3",
    description: "the same vtkPartitionedDataSetCollectionSource output",
  },
  axes: {
    label: "World axes",
    color: [0.8, 0.8, 0.8],
    css: "#cccccc",
    description: "vtkAxesActor at the world origin",
  },
};

const FOCAL_COLOR: Vec3 = [0.98, 0.8, 0.08];

// Point layout inside the shared vtkPoints.
const NEAR = 0; // 0..3: near BL, BR, TR, TL
const FAR = 4; // 4..7: far BL, BR, TR, TL
const POSITION = 8;
const FOCAL_POINT = 9;
const FOCAL = 10; // 10..13: focal-plane BL, BR, TR, TL
const NUM_POINTS = 14;

// VTK cell types.
const VTK_LINE = 3;
const VTK_POLY_LINE = 4;
const VTK_QUAD = 9;

/** The one vtkProp member the visibility toggles need (avoids structural vtkProp casts). */
interface VisibleProp {
  setVisibility(visible: number): void;
}

export interface ObserverView {
  readonly renderer: vtkRenderer;
  readonly renderWindow: vtkWebAssemblyOpenGLRenderWindow;
  readonly interactor: vtkWebAssemblyRenderWindowInteractor;
  /** Rewrite the gizmo geometry from a fresh camera state (does not render). */
  update(state: CameraState): void;
  render(): void;
  start(): void;
  /** Frame everything and look at the frustum from an oblique angle. */
  resetView(): void;
  setPartVisible(part: GizmoPart, visible: boolean): void;
  isPartVisible(part: GizmoPart): boolean;
}

export function createObserverView(
  vtk: VtkNamespace,
  typedArrayInterface: TypedArrayInterface,
  canvasSelector: string,
  cameraView: CameraView,
): ObserverView {
  // shared points, updated in place every refresh through a zero-copy view
  const pointArray = typedArrayInterface.toVTKAoSArray(new Float32Array(NUM_POINTS * 3), 3, "Points");
  const points = vtk.vtkPoints();
  points.setData(pointArray);

  function makePolyData(cells: ReadonlyArray<readonly [number, readonly number[]]>): vtkPolyData {
    const polyData = vtk.vtkPolyData();
    polyData.setPoints(points);
    polyData.allocate(cells.length, 16);
    for (const [type, ids] of cells) {
      polyData.insertNextCell(type, ids.length, [...ids]);
    }
    return polyData;
  }

  const tubes: vtkTubeFilter[] = [];

  function polyActor(
    polyData: vtkPolyData,
    color: Vec3,
    options: { opacity?: number; tube?: boolean; lineWidth?: number } = {},
  ): vtkActor {
    const mapper = vtk.vtkPolyDataMapper();
    if (options.tube) {
      // WebGL2 has no wide lines; use real tubes for the important loops.
      const tube = vtk.vtkTubeFilter({ radius: 0.01, numberOfSides: 10, capping: 1 });
      tube.setInputData(polyData);
      tubes.push(tube);
      mapper.setInputConnection(0, tube.getOutputPort(0));
    } else {
      mapper.setInputData(polyData);
    }
    mapper.scalarVisibilityOff();
    const actor = vtk.vtkActor({ mapper });
    // vtkProperty: use explicit setters, not $set (resets color to white).
    const property = actor.getProperty();
    property.setColor(color[0], color[1], color[2]);
    property.setOpacity(options.opacity ?? 1);
    property.setLineWidth(options.lineWidth ?? 1);
    property.setAmbient(options.tube ? 0.3 : 1);
    property.setDiffuse(options.tube ? 0.7 : 0);
    property.setSpecular(0);
    property.setLighting(options.tube ?? false);
    return actor;
  }

  const nearLoop = makePolyData([[VTK_POLY_LINE, [NEAR, NEAR + 1, NEAR + 2, NEAR + 3, NEAR]]]);
  const nearFill = makePolyData([[VTK_QUAD, [NEAR, NEAR + 1, NEAR + 2, NEAR + 3]]]);
  const farLoop = makePolyData([[VTK_POLY_LINE, [FAR, FAR + 1, FAR + 2, FAR + 3, FAR]]]);
  const farFill = makePolyData([[VTK_QUAD, [FAR, FAR + 1, FAR + 2, FAR + 3]]]);
  const sideEdges = makePolyData([
    [VTK_LINE, [NEAR, FAR]],
    [VTK_LINE, [NEAR + 1, FAR + 1]],
    [VTK_LINE, [NEAR + 2, FAR + 2]],
    [VTK_LINE, [NEAR + 3, FAR + 3]],
  ]);
  const apexEdges = makePolyData([
    [VTK_LINE, [POSITION, NEAR]],
    [VTK_LINE, [POSITION, NEAR + 1]],
    [VTK_LINE, [POSITION, NEAR + 2]],
    [VTK_LINE, [POSITION, NEAR + 3]],
  ]);
  const dopLine = makePolyData([[VTK_LINE, [POSITION, FOCAL_POINT]]]);
  const focalLoop = makePolyData([[VTK_POLY_LINE, [FOCAL, FOCAL + 1, FOCAL + 2, FOCAL + 3, FOCAL]]]);
  const focalFill = makePolyData([[VTK_QUAD, [FOCAL, FOCAL + 1, FOCAL + 2, FOCAL + 3]]]);

  const info = GIZMO_PART_INFO;
  const nearLoopActor = polyActor(nearLoop, info.nearPlane.color, { tube: true });
  const nearFillActor = polyActor(nearFill, info.nearPlane.color, { opacity: 0.22 });
  const farLoopActor = polyActor(farLoop, info.farPlane.color, { tube: true });
  const farFillActor = polyActor(farFill, info.farPlane.color, { opacity: 0.18 });
  const sideEdgesActor = polyActor(sideEdges, info.frustumEdges.color);
  const apexEdgesActor = polyActor(apexEdges, info.frustumEdges.color, { opacity: 0.6 });
  const dopLineActor = polyActor(dopLine, info.projectionDirection.color, { tube: true });
  const focalLoopActor = polyActor(focalLoop, info.focalPlane.color);
  const focalFillActor = polyActor(focalFill, info.focalPlane.color, { opacity: 0.12 });

  // arrows: unit vtkArrowSource placed by a user matrix rebuilt each refresh
  function arrow(color: Vec3): { actor: vtkActor; matrix: vtkMatrix4x4 } {
    const source = vtk.vtkArrowSource({ tipResolution: 16, shaftResolution: 16, tipLength: 0.3, tipRadius: 0.08, shaftRadius: 0.025 });
    const mapper = vtk.vtkPolyDataMapper();
    mapper.setInputConnection(0, source.getOutputPort(0));
    const matrix = vtk.vtkMatrix4x4();
    const actor = vtk.vtkActor({ mapper, userMatrix: matrix });
    const property = actor.getProperty();
    property.setColor(color[0], color[1], color[2]);
    property.setAmbient(0.3);
    property.setDiffuse(0.7);
    return { actor, matrix };
  }
  const viewUpArrow = arrow(info.viewUp.color);
  const dopArrow = arrow(info.projectionDirection.color);

  // markers
  function sphere(color: Vec3): { actor: vtkActor; source: vtkSphereSource } {
    const source = vtk.vtkSphereSource({ thetaResolution: 24, phiResolution: 16, radius: 0.05 });
    const mapper = vtk.vtkPolyDataMapper();
    mapper.setInputConnection(0, source.getOutputPort(0));
    const actor = vtk.vtkActor({ mapper });
    const property = actor.getProperty();
    property.setColor(color[0], color[1], color[2]);
    property.setAmbient(0.35);
    property.setDiffuse(0.65);
    return { actor, source };
  }
  const positionMarker = sphere(info.markers.color);
  const focalMarker = sphere(FOCAL_COLOR);

  // labels
  const labels: Array<{ actor: vtkCaptionActor2D; place: (state: CameraState, corners: Vec3[]) => Vec3 }> = [];
  function label(text: string, color: Vec3, place: (state: CameraState, corners: Vec3[]) => Vec3): void {
    const actor = vtk.vtkCaptionActor2D({
      caption: text,
      border: 0,
      leader: 1,
      threeDimensionalLeader: 0,
      padding: 1,
    });
    actor.getCaptionTextProperty().$set({
      color,
      fontSize: 13,
      bold: 1,
      italic: 0,
      shadow: 1,
      justification: 0,
      verticalJustification: 0,
    });
    actor.getTextActor().setTextScaleModeToNone();
    actor.getProperty().setColor(color[0], color[1], color[2]);
    actor.setPosition([12, 10]);
    labels.push({ actor, place });
  }
  label("Position", info.markers.color, (s) => s.position);
  label("FocalPoint", FOCAL_COLOR, (s) => s.focalPoint);
  label("ViewUp", info.viewUp.color, (s) => add(s.position, scale(s.viewUp, arrowLength(s))));
  label("Near", info.nearPlane.color, (_, c) => c[NEAR + 2]);
  label("Far", info.farPlane.color, (_, c) => c[FAR + 2]);

  // scene copy and axes
  const sceneMapper = vtk.vtkCompositePolyDataMapper();
  sceneMapper.setInputConnection(0, cameraView.activeOutputPort());
  cameraView.onMeshChange(() => {
    sceneMapper.setInputConnection(0, cameraView.activeOutputPort());
    render();
  });
  const sceneActor = vtk.vtkActor({ mapper: sceneMapper, backfaceProperty: cameraView.backfaceProperty });
  const sceneProperty = sceneActor.getProperty();
  sceneProperty.setAmbient(0.15);
  sceneProperty.setDiffuse(0.8);
  sceneProperty.setSpecular(0.3);
  sceneProperty.setSpecularPower(30);

  const sceneBounds = sceneActor.getBounds();
  const sceneExtent = Math.max(
    sceneBounds[1] - sceneBounds[0],
    sceneBounds[3] - sceneBounds[2],
    sceneBounds[5] - sceneBounds[4],
    1e-3,
  );
  const axesLength = 0.6 * sceneExtent;
  const axes = vtk.vtkAxesActor({
    totalLength: [axesLength, axesLength, axesLength],
    axisLabels: 1,
    shaftType: 1,
    coneRadius: 0.3,
  });
  // Pin axis caption size; default captions scale with the viewport.
  for (const caption of [
    axes.getXAxisCaptionActor2D(),
    axes.getYAxisCaptionActor2D(),
    axes.getZAxisCaptionActor2D(),
  ]) {
    caption.getTextActor().setTextScaleModeToNone();
    caption.getCaptionTextProperty().$set({ fontSize: 14, bold: 1, italic: 0, shadow: 0 });
  }

  // renderer / window / interactor
  const renderer = vtk.vtkRenderer({
    background: [0.07, 0.08, 0.12],
    background2: [0.14, 0.16, 0.24],
    gradientBackground: true,
  });

  const partProps: Record<GizmoPart, VisibleProp[]> = {
    nearPlane: [nearLoopActor, nearFillActor],
    farPlane: [farLoopActor, farFillActor],
    frustumEdges: [sideEdgesActor, apexEdgesActor],
    projectionDirection: [dopLineActor, dopArrow.actor],
    viewUp: [viewUpArrow.actor],
    focalPlane: [focalLoopActor, focalFillActor],
    markers: [positionMarker.actor, focalMarker.actor],
    labels: labels.map((l) => l.actor),
    sceneObject: [sceneActor],
    axes: [axes],
  };
  const visible: Record<GizmoPart, boolean> = Object.fromEntries(
    GIZMO_PARTS.map((part) => [part, true]),
  ) as Record<GizmoPart, boolean>;

  // Opaque geometry first so the translucent fills blend over it.
  for (const prop of [
    sceneActor,
    axes,
    positionMarker.actor,
    focalMarker.actor,
    viewUpArrow.actor,
    dopArrow.actor,
    dopLineActor,
    nearLoopActor,
    farLoopActor,
    sideEdgesActor,
    apexEdgesActor,
    focalLoopActor,
    nearFillActor,
    farFillActor,
    focalFillActor,
    ...labels.map((l) => l.actor),
  ]) {
    renderer.addViewProp(prop);
  }

  const renderWindow = vtk.vtkWebAssemblyOpenGLRenderWindow({ canvasSelector });
  renderWindow.addRenderer(renderer);
  const interactor = vtk.vtkWebAssemblyRenderWindowInteractor({ renderWindow, canvasSelector });
  (interactor.getInteractorStyle() as vtkInteractorStyleSwitch).setCurrentStyleToTrackballCamera();

  let lastPerspective = true;

  function arrowLength(state: CameraState): number {
    return Math.max(state.distance * 0.3, 1e-3);
  }

  function setMatrix(matrix: vtkMatrix4x4, data: number[]): void {
    matrix.setData(data);
  }

  function applyVisibility(): void {
    for (const part of GIZMO_PARTS) {
      for (const prop of partProps[part]) {
        prop.setVisibility(visible[part] ? 1 : 0);
      }
    }
    // Apex lines only mean something for a perspective projection.
    apexEdgesActor.setVisibility(visible.frustumEdges && lastPerspective ? 1 : 0);
  }

  function update(state: CameraState): void {
    lastPerspective = !state.parallelProjection;

    const view = typedArrayInterface.toJSTypedArray(pointArray);
    const write = (index: number, p: Vec3): void => {
      view[3 * index] = p[0];
      view[3 * index + 1] = p[1];
      view[3 * index + 2] = p[2];
    };

    const corners = state.corners;
    if (corners) {
      for (let k = 0; k < 8; k++) {
        write(NEAR + k, corners[k]);
      }
      const [near, far] = state.clippingRange;
      const t = far !== near ? (state.distance - near) / (far - near) : 0;
      for (let k = 0; k < 4; k++) {
        write(FOCAL + k, lerp(corners[NEAR + k], corners[FAR + k], t));
      }
    }
    write(POSITION, state.position);
    write(FOCAL_POINT, state.focalPoint);
    pointArray.modified();

    const length = arrowLength(state);
    setMatrix(viewUpArrow.matrix, arrowMatrix(state.position, state.viewUp, length, length * 0.5));
    setMatrix(dopArrow.matrix, arrowMatrix(state.position, state.directionOfProjection, length, length * 0.5));

    const markerRadius = Math.max(state.distance * 0.018, 1e-4);
    positionMarker.source.$set({ center: state.position, radius: markerRadius });
    focalMarker.source.$set({ center: state.focalPoint, radius: markerRadius });
    for (const tube of tubes) {
      tube.radius = Math.max(state.distance * 0.004, 1e-4);
    }

    if (corners) {
      for (const { actor, place } of labels) {
        actor.setAttachmentPoint(place(state, corners));
      }
    }
    applyVisibility();
  }

  function render(): void {
    void renderWindow.render();
  }

  function resetView(): void {
    renderer.resetCamera();
    const camera = renderer.getActiveCamera();
    camera.azimuth(40);
    camera.elevation(25);
    camera.orthogonalizeViewUp();
    camera.zoom(1.15);
    renderer.resetCameraClippingRange();
    render();
  }

  applyVisibility();

  return {
    renderer,
    renderWindow,
    interactor,
    update,
    render,
    start() {
      interactor.start();
    },
    resetView,
    setPartVisible(part, isVisible) {
      visible[part] = isVisible;
      applyVisibility();
      render();
    },
    isPartVisible(part) {
      return visible[part];
    },
  };
}
