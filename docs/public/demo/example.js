function buildWASMScene(vtk, canvasSelector = "#vtk-wasm-window", titleText = "Sample VTK.wasm scene") {

  function createSharedTextProperty() {
    const textProperty = vtk.vtkTextProperty({fontSize: 22});
    return textProperty;
  }

  function createLookupTable(scalarRange) {
    const lut = vtk.vtkColorTransferFunction();
    lut.setColorSpaceToHSV();
    const colorSeries = vtk.vtkColorSeries({ colorScheme: 16 });
    const numColors = colorSeries.getNumberOfColors();
    const scalarDiff = (scalarRange[1] - scalarRange[0]) / numColors;
    for (let i = 0; i < numColors; i++) {
      const color = colorSeries.getColor(i);
      const t = scalarRange[0] + i * scalarDiff;
      lut.addRGBPoint(
        t,
        color[0] / 255,
        color[1] / 255,
        color[2] / 255,
      );
    }
    lut.build();
    return lut;
  }

  function createTitleTextActor(titleText, textProperty) {
    const textActor = vtk.vtkTextActor({ input: titleText, textProperty });
    const position = textActor.getPositionCoordinate();
    position.setCoordinateSystemToNormalizedViewport();
    return textActor;
  }

  // Create a VTK source. Output has a point data array named "Scalars" whose range is [0, PI].
  const shapes = vtk.vtkPartitionedDataSetCollectionSource({ numberOfShapes: 2 });
  const lut = createLookupTable([0.0, Math.PI]);

  const mapper = vtk.vtkCompositePolyDataMapper({ lookupTable: lut });
  mapper.setInputConnection(shapes.getOutputPort());
  const actor = vtk.vtkActor({ mapper, scale: [0.1, 0.1, 0.1] });
  actor.property.edgeVisibility = true;
  actor.property.edgeColor = [0.2, 0.2, 0.2];

  const textProperty = createSharedTextProperty();

  // Create an actor that displays the title.
  const titleTextActor = createTitleTextActor(titleText, textProperty);

  // Setup rendering part
  const renderer = vtk.vtkRenderer({ background: [0.384314, 0.364706, 0.352941] });
  renderer.addActor(actor);
  renderer.addActor(titleTextActor);
  renderer.resetCamera();

  // Create a RenderWindow and bind it to a canvas in the DOM
  const renderWindow = vtk.vtkRenderWindow({ canvasSelector });
  renderWindow.addRenderer(renderer);
  const interactor = vtk.vtkRenderWindowInteractor({
    canvasSelector,
    renderWindow,
  });
  interactor.interactorStyle.setCurrentStyleToTrackballCamera();

  // Create camera widget
  const cameraOrientation = vtk.vtkCameraOrientationWidget({ interactor, parentRenderer: renderer });
  cameraOrientation.enabled = true;

  // Display the scalar bar at the bottom with a horizontal orientation
  const scalarBarActor = vtk.vtkScalarBarActor({ 
    lookupTable: lut,
    title: "Scalars",
    titleTextProperty: textProperty,
    labelTextProperty: textProperty,
    annotationTextProperty: textProperty,
    unconstrainedFontSize: true,
  });
  const scalarBar = vtk.vtkScalarBarWidget({ scalarBarActor, interactor, defaultRenderer: renderer });
  const scalarBarRepresentation = scalarBar.getRepresentation();
  scalarBarRepresentation.setOrientation(0); // 1: vertical, 0: horizontal
  const lowerLeftPosition = scalarBarRepresentation.getPositionCoordinate();
  lowerLeftPosition.setValue([0.1, 0.05, 0.0]);
  scalarBar.enabled = true;

  // Trigger render and start interactor
  interactor.start();
}
