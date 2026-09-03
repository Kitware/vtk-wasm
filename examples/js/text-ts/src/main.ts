import { loadAsync, vtkInteractorStyleSwitch } from "@kitware/vtk-wasm";

// A minimal typed VTK.wasm app: one `vtkTextActor` drawn over a sphere, with
// every setting on the actor and its `vtkTextProperty` wired to a live
// control panel.
//
// `TextScaleMode` gets its own callout because the three modes differ in
// what decides the font size actually drawn:
//
//   None     - the size on the text property is used verbatim, in pixels. The
//              text keeps its pixel size no matter how large the viewport is.
//   Prop     - the font is fit into the vtkTextActor's own rectangle, the box between
//              its position and position2 coordinates. Resizing the window
//              resizes the box, and the text with it.
//   Viewport - the font is scaled from the viewport size alone, through a
//              non-linear law whose exponent is `FontScaleExponent`. The actor's
//              rectangle plays no part.
const BUNDLE_URL =
  "https://raw.githack.com/Kitware/vtk-wasm/dist/latest/vtk-wasm32-emscripten.tar.gz";
const CANVAS_SELECTOR = "#app > canvas";

/** Font size (pixels) the text property carries, used as-is by `None`. */
const BASE_FONT_SIZE = 14;

/**
 * The actor's rectangle, in normalized viewport fractions: lower-left corner
 * plus a width and a height. `Prop` fits the font into it; the other two modes
 * only use the corner, as the anchor the text is drawn from.
 */
const BOX = { x: 0.08, y: 0.08, width: 0.5, height: 0.12 };

/** `vtkTextActor::MinimumSize`, in pixels, how small `Prop` can shrink the font. */
const MIN_SIZE = { width: 10, height: 10 };

/** `vtkTextProperty::ShadowOffset`, in pixels. Only visible while `Shadow` is on. */
const SHADOW_OFFSET = { x: 1, y: -1 };

/** `#rrggbb` -> the `[r, g, b]` (0-1) triple every VTK color setter expects. */
function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/** Wires a `<input type="number">` to `apply`, skipping non-finite input and values `guard` rejects. */
function bindNumberInput(
  id: string,
  apply: (value: number) => void,
  guard: (value: number) => boolean = () => true
): void {
  const input = document.querySelector<HTMLInputElement>(`#${id}`);
  input?.addEventListener("input", () => {
    const value = Number(input.value);
    if (Number.isFinite(value) && guard(value)) {
      apply(value);
    }
  });
}

/** Wires a `<input type="text">` to `apply`. */
function bindTextInput(id: string, apply: (value: string) => void): void {
  const input = document.querySelector<HTMLInputElement>(`#${id}`);
  input?.addEventListener("input", () => apply(input.value));
}

/** Wires a `<input type="checkbox">` to `apply`. */
function bindCheckboxInput(id: string, apply: (checked: boolean) => void): void {
  const input = document.querySelector<HTMLInputElement>(`#${id}`);
  input?.addEventListener("change", () => apply(input.checked));
}

/** Wires a `<input type="color">` to `apply`, converting hex to VTK's 0-1 RGB. */
function bindColorInput(
  id: string,
  apply: (r: number, g: number, b: number) => void
): void {
  const input = document.querySelector<HTMLInputElement>(`#${id}`);
  input?.addEventListener("input", () => apply(...hexToRgb(input.value)));
}

/** Wires a `<select>` to a map of option-value -> setter, keyed by the option's own value. */
function bindSelectInput(
  id: string,
  setters: Record<string, () => void>,
  fallback: string
): void {
  const select = document.querySelector<HTMLSelectElement>(`#${id}`);
  select?.addEventListener("change", () => (setters[select.value] ?? setters[fallback])());
}

async function main(): Promise<void> {
  const runtime = await loadAsync({ url: BUNDLE_URL });
  const session = runtime.createStandaloneSession();
  const { vtk } = session;

  // Something in the scene for the text to sit over.
  const sphere = vtk.vtkSphereSource({ phiResolution: 48 });
  const sphereMapper = vtk.vtkPolyDataMapper();
  sphereMapper.setInputConnection(0, sphere.getOutputPort(0));
  const sphereActor = vtk.vtkActor({ mapper: sphereMapper });
  sphereActor.getProperty().setColor(0.24, 0.58, 0.86);
  sphereActor.getProperty().setEdgeVisibility(1);
  sphereActor.getProperty().setVertexVisibility(1);

  // Every scalar/color/flag `vtkTextProperty` exposes, given an explicit
  // starting value so the control panel below always reflects the live
  // state. `FontFamily`, `Justification` and `VerticalJustification` are
  // enums set through their readable `setXToY()` spelling instead, same as
  // `TextScaleMode` on the actor further down.
  const textProperty = vtk.vtkTextProperty({
    fontSize: BASE_FONT_SIZE,
    color: [1.0, 0.86, 0.4],
    opacity: 1.0,
    backgroundColor: [0, 0, 0],
    backgroundOpacity: 0,
    frame: 0,
    frameColor: [0.35, 0.45, 0.6],
    frameWidth: 1,
    fontFile: "",
    bold: 1,
    italic: 0,
    shadow: 1,
    shadowOffset: [SHADOW_OFFSET.x, SHADOW_OFFSET.y],
    useTightBoundingBox: 0,
    orientation: 0,
    lineSpacing: 1.1,
    lineOffset: 0,
    cellOffset: 0,
    interiorLinesVisibility: false,
    interiorLinesWidth: 1,
    interiorLinesColor: [0.35, 0.45, 0.6],
  });
  textProperty.setFontFamilyToArial();
  // Anchored at the rectangle's lower-left corner. `Prop` and `Viewport`
  // override the justification with their own layout, so left/bottom is what
  // keeps all three modes drawing from the same corner.
  textProperty.setJustificationToLeft();
  textProperty.setVerticalJustificationToBottom();

  const textActor = vtk.vtkTextActor({
    input: "This scene shows a blue sphere",
    textProperty,
    // Pixel floor `Prop` won't shrink the font past, however small the box gets.
    minimumSize: [MIN_SIZE.width, MIN_SIZE.height],
    // Fraction of the actor's rectangle a wrapped line of text may occupy.
    maximumLineHeight: 1.0,
    useBorderAlign: 0,
    // Actor-level rotation, in degrees, independent of the text property's own.
    orientation: 0,
    // Only consulted in `Viewport` mode: 1.0 scales the font linearly with the
    // viewport, lower exponents damp the growth of large viewports.
    fontScaleExponent: 1.0,
  });

  // Both coordinates are normalized viewport fractions, and position2 is
  // relative to position, VTK's width/height, not a second corner.
  textActor.getPositionCoordinate().setCoordinateSystemToNormalizedViewport();
  textActor.getPosition2Coordinate().setCoordinateSystemToNormalizedViewport();
  textActor.setPosition([BOX.x, BOX.y]);
  textActor.setPosition2([BOX.width, BOX.height]);

  // The same rectangle, drawn so the `Prop` fit is visible. A 2D mapper maps
  // its input through a vtkCoordinate, so the outline's coordinates are the
  // normalized viewport fractions above; the degenerate z extent makes the box
  // a flat rectangle.
  const outline = vtk.vtkOutlineSource();
  outline.setBounds(BOX.x, BOX.x + BOX.width, BOX.y, BOX.y + BOX.height, 0, 0);
  const outlineMapper = vtk.vtkPolyDataMapper2D();
  outlineMapper.setInputConnection(0, outline.getOutputPort(0));
  const outlineCoordinate = vtk.vtkCoordinate();
  outlineCoordinate.setCoordinateSystemToNormalizedViewport();
  outlineMapper.setTransformCoordinate(outlineCoordinate);
  const outlineActor = vtk.vtkActor2D({ mapper: outlineMapper });
  outlineActor.getProperty().setColor(0.35, 0.45, 0.6);

  const renderer = vtk.vtkRenderer({ background: [0.02, 0.03, 0.08] });
  renderer.addActor(sphereActor);
  renderer.addActor(outlineActor);
  renderer.addActor(textActor);
  renderer.resetCamera();

  const renderWindow = vtk.vtkWebAssemblyOpenGLRenderWindow({
    canvasSelector: CANVAS_SELECTOR,
  });
  renderWindow.addRenderer(renderer);

  const interactor = vtk.vtkWebAssemblyRenderWindowInteractor({
    renderWindow,
    canvasSelector: CANVAS_SELECTOR,
  });
  (
    interactor.getInteractorStyle() as vtkInteractorStyleSwitch
  ).setCurrentStyleToTrackballCamera();
  interactor.start();

  // `Viewport` scale mode reads its font size off the render window's *own*
  // size (`vtkTextActor::GetFontScale`), not the canvas element's CSS box, so
  // that size has to be pushed to VTK explicitly whenever the canvas resizes.
  // Without this the render window keeps the size it had when the WASM module
  // first attached to the canvas.
  const canvas = document.querySelector<HTMLCanvasElement>(CANVAS_SELECTOR)!;
  function resizeRenderWindow(): void {
    const { width, height } = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    renderWindow.setSize(
      Math.max(1, Math.round(width * dpr)),
      Math.max(1, Math.round(height * dpr))
    );
    // `vtkTextActor::ComputeScaledFont` only recomputes `Viewport`-mode font
    // sizes when the renderer, its window, or the text property report a
    // fresher MTime than its own last build, and resizing the WASM render
    // window doesn't bump any of those (the GL viewport still resizes fine,
    // only the *font* stays stuck at whatever size it last computed).
    // Touching the text property directly forces that recompute.
    textProperty.modified();
  }
  new ResizeObserver(resizeRenderWindow).observe(canvas);
  resizeRenderWindow();

  // `setTextScaleModeTo*` are the readable spelling of `setTextScaleMode(n)`;
  // `getTextScaleMode` reads the enum value back out. Keyed by the dropdown's
  // own option values so a `<select>` change maps straight onto a setter.
  const modeSetters: Record<string, () => void> = {
    None: () => textActor.setTextScaleModeToNone(),
    Prop: () => textActor.setTextScaleModeToProp(),
    Viewport: () => textActor.setTextScaleModeToViewport(),
  };
  const modeBlurbs: Record<string, string> = {
    None: "fixed font size, viewport ignored",
    Prop: "fit to the vtkTextActor's own rectangle",
    Viewport: "scaled from the viewport by the exponent below",
  };
  const fontFamilySetters: Record<string, () => void> = {
    Arial: () => textProperty.setFontFamilyToArial(),
    Courier: () => textProperty.setFontFamilyToCourier(),
    Times: () => textProperty.setFontFamilyToTimes(),
  };
  const justificationSetters: Record<string, () => void> = {
    Left: () => textProperty.setJustificationToLeft(),
    Centered: () => textProperty.setJustificationToCentered(),
    Right: () => textProperty.setJustificationToRight(),
  };
  const verticalJustificationSetters: Record<string, () => void> = {
    Bottom: () => textProperty.setVerticalJustificationToBottom(),
    Centered: () => textProperty.setVerticalJustificationToCentered(),
    Top: () => textProperty.setVerticalJustificationToTop(),
  };

  const statusElement = document.querySelector<HTMLElement>("#status");
  const modeSelect = document.querySelector<HTMLSelectElement>("#modeSelect");

  // --- App ------------------------------------------------------------------
  bindCheckboxInput("showOutlineInput", (checked) =>
    checked ? outlineActor.visibilityOn() : outlineActor.visibilityOff()
  );

  // --- vtkTextActor -------------------------------------------------------
  bindTextInput("textInput", (value) => textActor.setInput(value));
  bindSelectInput("modeSelect", modeSetters, "Prop");
  bindNumberInput("exponentInput", (value) => {
    textActor.setFontScaleExponent(value);
    // `FontScaleExponent` lives on the actor, not the property, so changing
    // it doesn't bump the property's MTime, force the `Viewport` recompute.
    textActor.textProperty.modified();
  });

  // Position and position2 drive both the actor (position anchors the text,
  // position2 is the box `Prop` fits it into) and the outline that traces that
  // same box, so the two stay visibly in sync.
  function applyBox(): void {
    outline.setBounds(BOX.x, BOX.x + BOX.width, BOX.y, BOX.y + BOX.height, 0, 0);
    textActor.setPosition([BOX.x, BOX.y]);
    textActor.setPosition2([BOX.width, BOX.height]);
  }
  bindNumberInput("pos1XInput", (value) => {
    BOX.x = value;
    applyBox();
  });
  bindNumberInput("pos1YInput", (value) => {
    BOX.y = value;
    applyBox();
  });
  bindNumberInput("pos2WInput", (value) => {
    BOX.width = value;
    applyBox();
  });
  bindNumberInput("pos2HInput", (value) => {
    BOX.height = value;
    applyBox();
  });

  function applyMinimumSize(): void {
    textActor.setMinimumSize(MIN_SIZE.width, MIN_SIZE.height);
  }
  bindNumberInput(
    "minSizeWInput",
    (value) => {
      MIN_SIZE.width = value;
      applyMinimumSize();
    },
    (value) => value >= 0
  );
  bindNumberInput(
    "minSizeHInput",
    (value) => {
      MIN_SIZE.height = value;
      applyMinimumSize();
    },
    (value) => value >= 0
  );

  bindNumberInput(
    "maxLineHeightInput",
    (value) => textActor.setMaximumLineHeight(value),
    (value) => value >= 0
  );
  bindCheckboxInput("useBorderAlignInput", (checked) =>
    checked ? textActor.useBorderAlignOn() : textActor.useBorderAlignOff()
  );
  bindNumberInput("actorOrientationInput", (value) => textActor.setOrientation(value));

  // --- vtkTextProperty ------------------------------------------------------
  bindNumberInput(
    "fontSizeInput",
    (value) => textProperty.setFontSize(value),
    (value) => value > 0
  );
  bindSelectInput("fontFamilySelect", fontFamilySetters, "Arial");
  bindTextInput("fontFileInput", (value) => textProperty.setFontFile(value));
  bindCheckboxInput("boldInput", (checked) =>
    checked ? textProperty.boldOn() : textProperty.boldOff()
  );
  bindCheckboxInput("italicInput", (checked) =>
    checked ? textProperty.italicOn() : textProperty.italicOff()
  );
  bindColorInput("colorInput", (r, g, b) => textProperty.setColor(r, g, b));
  bindNumberInput(
    "opacityInput",
    (value) => textProperty.setOpacity(value),
    (value) => value >= 0 && value <= 1
  );
  bindSelectInput("justificationSelect", justificationSetters, "Left");
  bindSelectInput("vJustificationSelect", verticalJustificationSetters, "Bottom");
  bindNumberInput("tpOrientationInput", (value) => textProperty.setOrientation(value));
  bindNumberInput(
    "lineSpacingInput",
    (value) => textProperty.setLineSpacing(value),
    (value) => value >= 0
  );
  bindNumberInput("lineOffsetInput", (value) => textProperty.setLineOffset(value));
  bindNumberInput("cellOffsetInput", (value) => textProperty.setCellOffset(value));
  bindCheckboxInput("tightBBoxInput", (checked) =>
    checked ? textProperty.useTightBoundingBoxOn() : textProperty.useTightBoundingBoxOff()
  );

  bindCheckboxInput("shadowInput", (checked) =>
    checked ? textProperty.shadowOn() : textProperty.shadowOff()
  );
  function applyShadowOffset(): void {
    textProperty.setShadowOffset(SHADOW_OFFSET.x, SHADOW_OFFSET.y);
  }
  bindNumberInput("shadowOffsetXInput", (value) => {
    SHADOW_OFFSET.x = value;
    applyShadowOffset();
  });
  bindNumberInput("shadowOffsetYInput", (value) => {
    SHADOW_OFFSET.y = value;
    applyShadowOffset();
  });

  bindCheckboxInput("frameInput", (checked) =>
    checked ? textProperty.frameOn() : textProperty.frameOff()
  );
  bindColorInput("frameColorInput", (r, g, b) => textProperty.setFrameColor(r, g, b));
  bindNumberInput(
    "frameWidthInput",
    (value) => textProperty.setFrameWidth(value),
    (value) => value >= 0
  );

  bindColorInput("bgColorInput", (r, g, b) => textProperty.setBackgroundColor(r, g, b));
  bindNumberInput(
    "bgOpacityInput",
    (value) => textProperty.setBackgroundOpacity(value),
    (value) => value >= 0 && value <= 1
  );

  bindCheckboxInput("interiorLinesVisInput", (checked) =>
    textProperty.setInteriorLinesVisibility(checked)
  );
  bindNumberInput(
    "interiorLinesWidthInput",
    (value) => textProperty.setInteriorLinesWidth(value),
    (value) => value >= 0
  );
  bindColorInput("interiorLinesColorInput", (r, g, b) =>
    textProperty.setInteriorLinesColor(r, g, b)
  );

  modeSetters[modeSelect?.value ?? "Prop"]();

  function updateStatus(): void {
    if (!statusElement) {
      return;
    }
    const modeName = modeSelect?.value ?? "Prop";
    // The size the text occupies right now, in pixels. `getScaledTextProperty`
    // reports the font size VTK settled on for the current mode and viewport,
    // which is the number the three modes actually disagree about.
    const [width, height] = textActor.getSize(renderer);
    const scaledFontSize = textActor.getScaledTextProperty().getFontSize();
    statusElement.textContent =
      `mode ${textActor.getTextScaleMode()} · ${modeName} — ${modeBlurbs[modeName]}\n` +
      `scaledFontSize: ${scaledFontSize} pt · textActor rect: ${Math.round(width)}×${Math.round(height)} px`;
    statusElement.style.whiteSpace = "pre-line";
  }

  function animate(): void {
    // `getSize`/`getScaledTextProperty` only report the mode's effect once the
    // actor has been laid out against the current viewport, so render first.
    renderWindow.render();
    updateStatus();
    requestAnimationFrame(animate);
  }
  requestAnimationFrame(animate);
}

main().catch((err) => console.error(err));
