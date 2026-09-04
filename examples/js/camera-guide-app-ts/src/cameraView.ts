import type {
  VtkNamespace,
  vtkActor,
  vtkAlgorithmOutput,
  vtkCamera,
  vtkCompositePolyDataMapper,
  vtkInteractorStyle,
  vtkInteractorStyleSwitch,
  vtkPartitionedDataSetCollectionSource,
  vtkProperty,
  vtkRenderer,
  vtkSphereSource,
  vtkWebAssemblyOpenGLRenderWindow,
  vtkWebAssemblyRenderWindowInteractor,
} from "@kitware/vtk-wasm";

/** Which source feeds the mappers of both views. */
export type MeshType = "partitionedDataSetCollection" | "sphere";

export const MESH_TYPE_LABELS: Record<MeshType, string> = {
  partitionedDataSetCollection: "vtkPartitionedDataSetCollectionSource",
  sphere: "vtkSphereSource",
};

export const DEFAULT_SPHERE = { center: [0, 0, 0] as [number, number, number], radius: 4 };

/** Backface color shared by the scene actors of both views. */
export const BACKFACE_COLOR: [number, number, number] = [0.29, 0.87, 0.5];

/** View 2: the camera being explained, looking at a source picked via `setMeshType`. */
export interface CameraView {
  readonly source: vtkPartitionedDataSetCollectionSource;
  readonly sphere: vtkSphereSource;
  readonly mapper: vtkCompositePolyDataMapper;
  readonly actor: vtkActor;
  /** Green backface property; the observer view's scene copy shares it. */
  readonly backfaceProperty: vtkProperty;
  /** Full-window renderer that keeps the canvas clean outside `renderer`'s viewport. */
  readonly backgroundRenderer: vtkRenderer;
  /** The renderer whose active camera is visualized. */
  readonly renderer: vtkRenderer;
  readonly renderWindow: vtkWebAssemblyOpenGLRenderWindow;
  readonly interactor: vtkWebAssemblyRenderWindowInteractor;
  readonly camera: vtkCamera;
  /** The trackball-camera style (owns `AutoAdjustCameraClippingRange`). */
  readonly style: vtkInteractorStyle;
  /** Aspect ratio (width / height) VTK feeds to the camera's projection for this renderer. */
  aspect(): number;
  render(): void;
  start(): void;
  /** Re-frame the scene once the canvas has its real size (keeps the orientation). */
  frame(): void;
  meshType(): MeshType;
  /** Switch the source feeding this view; listeners (the observer view) follow. */
  setMeshType(type: MeshType): void;
  /** Output port of the active source, for other mappers that mirror the scene. */
  activeOutputPort(): vtkAlgorithmOutput;
  onMeshChange(listener: (type: MeshType) => void): void;
}

export const DEFAULT_NUMBER_OF_SHAPES = 3;

export function createCameraView(vtk: VtkNamespace, canvasSelector: string): CameraView {
  const source = vtk.vtkPartitionedDataSetCollectionSource({
    numberOfShapes: DEFAULT_NUMBER_OF_SHAPES,
  });

  const sphere = vtk.vtkSphereSource({
    center: DEFAULT_SPHERE.center,
    radius: DEFAULT_SPHERE.radius,
    thetaResolution: 64,
    phiResolution: 48,
  });

  let activeMeshType: MeshType = "partitionedDataSetCollection";
  const meshListeners: Array<(type: MeshType) => void> = [];
  const activeOutputPort = (): vtkAlgorithmOutput =>
    activeMeshType === "sphere" ? sphere.getOutputPort(0) : source.getOutputPort(0);

  const mapper = vtk.vtkCompositePolyDataMapper();
  mapper.setInputConnection(0, activeOutputPort());

  const backfaceProperty = vtk.vtkProperty();
  backfaceProperty.setColor(BACKFACE_COLOR[0], BACKFACE_COLOR[1], BACKFACE_COLOR[2]);
  backfaceProperty.setAmbient(0.25);
  backfaceProperty.setDiffuse(0.75);

  const actor = vtk.vtkActor({ mapper, backfaceProperty });
  const property = actor.getProperty();
  property.setAmbient(0.15);
  property.setDiffuse(0.8);
  property.setSpecular(0.3);
  property.setSpecularPower(30);

  // Second layer-0 renderer clears the whole window so a shrunk viewport
  // leaves a clean border instead of stale pixels.
  const backgroundRenderer = vtk.vtkRenderer({
    background: [0.04, 0.05, 0.08],
    interactive: 0,
  });
  const renderer = vtk.vtkRenderer({
    background: [0.11, 0.14, 0.22],
    background2: [0.02, 0.03, 0.06],
    gradientBackground: true,
    interactive: 1,
  });
  renderer.addActor(actor);

  const renderWindow = vtk.vtkWebAssemblyOpenGLRenderWindow({ canvasSelector });
  renderWindow.addRenderer(backgroundRenderer);
  renderWindow.addRenderer(renderer);

  const interactor = vtk.vtkWebAssemblyRenderWindowInteractor({
    renderWindow,
    canvasSelector,
  });
  const switchStyle = interactor.getInteractorStyle() as vtkInteractorStyleSwitch;
  switchStyle.setCurrentStyleToTrackballCamera();
  const style = switchStyle.getCurrentStyle();

  renderer.resetCamera();
  const camera = renderer.getActiveCamera();
  camera.azimuth(-35);
  camera.elevation(20);
  camera.orthogonalizeViewUp();
  renderer.resetCameraClippingRange();

  return {
    source,
    sphere,
    mapper,
    actor,
    backfaceProperty,
    backgroundRenderer,
    renderer,
    renderWindow,
    interactor,
    camera,
    style,
    aspect() {
      const tiled = renderer.getTiledAspectRatio();
      if (Number.isFinite(tiled) && tiled > 0) {
        return tiled;
      }
      const size = renderer.getSize();
      return size[1] > 0 ? size[0] / size[1] : 1;
    },
    render() {
      void renderWindow.render();
    },
    start() {
      interactor.start();
    },
    frame() {
      renderer.resetCamera();
      renderer.resetCameraClippingRange();
      void renderWindow.render();
    },
    meshType() {
      return activeMeshType;
    },
    setMeshType(type) {
      if (type === activeMeshType) {
        return;
      }
      activeMeshType = type;
      mapper.setInputConnection(0, activeOutputPort());
      for (const listener of meshListeners) {
        listener(type);
      }
    },
    activeOutputPort,
    onMeshChange(listener) {
      meshListeners.push(listener);
    },
  };
}
