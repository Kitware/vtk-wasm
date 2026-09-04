import type { vtkMatrix4x4 } from "@kitware/vtk-wasm";
import type { CameraView } from "./cameraView";
import { frustumCorners, planesFromCompositeMatrix, v3, type Vec3 } from "./math";

/** One consistent read of everything the gizmo and the panel display. */
export interface CameraState {
  // --- vtkCamera parameters
  position: Vec3;
  focalPoint: Vec3;
  viewUp: Vec3;
  directionOfProjection: Vec3;
  viewPlaneNormal: Vec3;
  distance: number;
  viewAngle: number;
  useHorizontalViewAngle: boolean;
  parallelProjection: boolean;
  parallelScale: number;
  clippingRange: [number, number];
  thickness: number;
  roll: number;
  windowCenter: [number, number];
  focalDisk: number;
  focalDistance: number;
  orientation: Vec3;
  orientationWXYZ: [number, number, number, number];
  eyeAngle: number;
  viewShear: Vec3;
  useOffAxisProjection: boolean;
  useExplicitProjectionTransformMatrix: boolean;
  freezeFocalPoint: boolean;
  mtime: number;
  viewingRaysMTime: number;

  // --- renderer / window
  aspect: number;
  viewport: number[];
  rendererSize: number[];
  rendererOrigin: number[];
  windowSize: number[];
  pixelAspect: number[];
  tiledAspectRatio: number;

  // --- matrices (row-major, 16 values)
  viewMatrix: number[];
  projectionMatrix: number[];
  compositeMatrix: number[];
  modelViewMatrix: number[];
  modelMatrix: number[];

  // --- frustum
  frustumPlanes: number[];
  frustumPlanesSource: "vtkCamera::GetFrustumPlanes" | "derived from composite matrix";
  /** near BL, BR, TR, TL, far BL, BR, TR, TL — or `null` when degenerate. */
  corners: Vec3[] | null;
}

/** Copy a `vtkMatrix4x4` into a plain row-major array. */
export function readMatrix(matrix: vtkMatrix4x4): number[] {
  const data = matrix.getData() as unknown;
  if (Array.isArray(data) && data.length === 16) {
    return data.map(Number);
  }
  if (ArrayBuffer.isView(data)) {
    const view = data as unknown as ArrayLike<number>;
    if (view.length === 16) {
      return Array.from(view);
    }
  }
  const out = new Array<number>(16);
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      out[4 * i + j] = matrix.getElement(i, j);
    }
  }
  return out;
}

function pair(a: ArrayLike<number>): [number, number] {
  return [a[0], a[1]];
}

export function readCameraState(view: CameraView): CameraState {
  const { camera, renderer, renderWindow } = view;
  const aspect = view.aspect();

  const viewMatrix = readMatrix(camera.getViewTransformMatrix());
  const projectionMatrix = readMatrix(camera.getProjectionTransformMatrix(aspect, -1, 1));
  const compositeMatrix = readMatrix(camera.getCompositeProjectionTransformMatrix(aspect, -1, 1));
  const modelViewMatrix = readMatrix(camera.getModelViewTransformMatrix());
  const modelMatrix = readMatrix(camera.getModelTransformMatrix());

  let frustumPlanes: number[] | null = null;
  let frustumPlanesSource: CameraState["frustumPlanesSource"] = "derived from composite matrix";
  try {
    const planes = camera.getFrustumPlanes(aspect) as unknown;
    if (Array.isArray(planes) && planes.length === 24 && planes.every((p) => Number.isFinite(p))) {
      frustumPlanes = planes.map(Number);
      frustumPlanesSource = "vtkCamera::GetFrustumPlanes";
    }
  } catch {
    // fall through to the derived planes
  }
  if (!frustumPlanes) {
    frustumPlanes = planesFromCompositeMatrix(compositeMatrix);
  }

  const wxyz = camera.getOrientationWXYZ();

  return {
    position: v3(camera.getPosition()),
    focalPoint: v3(camera.getFocalPoint()),
    viewUp: v3(camera.getViewUp()),
    directionOfProjection: v3(camera.getDirectionOfProjection()),
    viewPlaneNormal: v3(camera.getViewPlaneNormal()),
    distance: camera.getDistance(),
    viewAngle: camera.getViewAngle(),
    useHorizontalViewAngle: camera.getUseHorizontalViewAngle() !== 0,
    parallelProjection: camera.getParallelProjection() !== 0,
    parallelScale: camera.getParallelScale(),
    clippingRange: pair(camera.getClippingRange()),
    thickness: camera.getThickness(),
    roll: camera.getRoll(),
    windowCenter: pair(camera.getWindowCenter()),
    focalDisk: camera.getFocalDisk(),
    focalDistance: camera.getFocalDistance(),
    orientation: v3(camera.getOrientation()),
    orientationWXYZ: [wxyz[0], wxyz[1], wxyz[2], wxyz[3]],
    eyeAngle: camera.getEyeAngle(),
    viewShear: v3(camera.getViewShear()),
    useOffAxisProjection: camera.getUseOffAxisProjection() !== 0,
    useExplicitProjectionTransformMatrix: camera.getUseExplicitProjectionTransformMatrix(),
    freezeFocalPoint: camera.getFreezeFocalPoint(),
    mtime: camera.getMTime(),
    viewingRaysMTime: camera.getViewingRaysMTime(),

    aspect,
    viewport: Array.from(renderer.getViewport()),
    rendererSize: Array.from(renderer.getSize()),
    rendererOrigin: Array.from(renderer.getOrigin()),
    windowSize: Array.from(renderWindow.getSize()),
    pixelAspect: Array.from(renderer.getPixelAspect()),
    tiledAspectRatio: renderer.getTiledAspectRatio(),

    viewMatrix,
    projectionMatrix,
    compositeMatrix,
    modelViewMatrix,
    modelMatrix,

    frustumPlanes,
    frustumPlanesSource,
    corners: frustumCorners(frustumPlanes),
  };
}
