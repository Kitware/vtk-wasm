import { DEFAULT_SPHERE, MESH_TYPE_LABELS, type CameraView, type MeshType } from "./cameraView";
import type { CameraState } from "./cameraState";
import { fmt, fmtVec } from "./math";
import { GIZMO_PARTS, GIZMO_PART_INFO, type ObserverView } from "./observerView";

export interface PanelDeps {
  cameraView: CameraView;
  observerView: ObserverView;
  /** Ask the app to re-read the camera and redraw the observer view + panel. */
  refresh(): void;
}

export interface Panel {
  update(state: CameraState): void;
}

// ------------------------------------------------------------------ DOM helpers

type Child = Node | string | null | undefined;

function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<Record<string, string | boolean | number>> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null) {
      continue;
    }
    if (key === "className") {
      element.className = String(value);
    } else if (key === "textContent") {
      element.textContent = String(value);
    } else if (typeof value === "boolean") {
      if (value) {
        element.setAttribute(key, "");
      }
    } else {
      element.setAttribute(key, String(value));
    }
  }
  for (const child of children) {
    if (child === null || child === undefined) {
      continue;
    }
    element.append(child);
  }
  return element;
}

function section(title: string, subtitle: string | null, ...children: Child[]): HTMLDetailsElement {
  const details = h("details", { open: true });
  const summary = h("summary", {}, title);
  if (subtitle) {
    summary.append(h("small", {}, subtitle));
  }
  details.append(summary, h("div", { className: "section-body" }, ...children));
  return details;
}

function note(text: string): HTMLElement {
  return h("p", { className: "note" }, text);
}

/** A key/value table whose value cells are updated in place. */
function keyValueTable(rows: ReadonlyArray<readonly [string, string?]>): { table: HTMLTableElement; cells: HTMLTableCellElement[] } {
  const table = h("table", { className: "kv" });
  const cells: HTMLTableCellElement[] = [];
  for (const [label, tooltip] of rows) {
    const th = h("th", { title: tooltip ?? "" }, label);
    const td = h("td", {}, "–");
    table.append(h("tr", {}, th, td));
    cells.push(td);
  }
  return { table, cells };
}

/** A 4x4 matrix table whose cells are updated in place. */
function matrixTable(title: string, subtitle: string): { block: HTMLElement; cells: HTMLTableCellElement[] } {
  const table = h("table", { className: "matrix" });
  const cells: HTMLTableCellElement[] = [];
  for (let i = 0; i < 4; i++) {
    const tr = h("tr");
    for (let j = 0; j < 4; j++) {
      const td = h("td", {}, "0");
      cells.push(td);
      tr.append(td);
    }
    table.append(tr);
  }
  const heading = h("h4", {}, title, " ", h("small", {}, subtitle));
  return { block: h("div", { className: "matrix-block" }, heading, table), cells };
}

function planesTable(): { block: HTMLElement; cells: HTMLTableCellElement[]; sourceNote: HTMLElement } {
  const names = ["−x (left)", "+x (right)", "−y (bottom)", "+y (top)", "−z (near)", "+z (far)"];
  const table = h("table", { className: "matrix" });
  const header = h("tr", {}, h("th", {}, "plane"), ...["A", "B", "C", "D"].map((c) => h("th", {}, c)));
  table.append(header);
  const cells: HTMLTableCellElement[] = [];
  for (const name of names) {
    const tr = h("tr", {}, h("th", {}, name));
    for (let j = 0; j < 4; j++) {
      const td = h("td", {}, "0");
      cells.push(td);
      tr.append(td);
    }
    table.append(tr);
  }
  const sourceNote = note("");
  const heading = h("h4", {}, "Frustum planes ", h("small", {}, "A·x + B·y + C·z + D = 0, normals point inward"));
  return { block: h("div", { className: "matrix-block" }, heading, table, sourceNote), cells, sourceNote };
}

function isEditing(element: Element): boolean {
  return document.activeElement === element;
}

// ------------------------------------------------------------------ panel

export function createPanel(root: HTMLElement, deps: PanelDeps): Panel {
  const { cameraView, observerView, refresh } = deps;
  const { camera, renderer, source, sphere, style } = cameraView;

  /** Apply a camera change and re-render view 2; the observers do the rest. */
  function apply(change: () => void): void {
    change();
    cameraView.render();
    refresh();
  }

  function clipIfAuto(): void {
    if (style.getAutoAdjustCameraClippingRange()) {
      renderer.resetCameraClippingRange();
    }
  }

  // ---------------------------------------------------------- parameters
  const parameterRows = [
    ["Position", "vtkCamera::GetPosition — the eye point, in world coordinates"],
    ["FocalPoint", "vtkCamera::GetFocalPoint — what the camera looks at"],
    ["ViewUp", "vtkCamera::GetViewUp — the direction that maps to screen-up"],
    ["DirectionOfProjection", "Unit vector from Position to FocalPoint"],
    ["ViewPlaneNormal", "Points from FocalPoint toward Position (= −DirectionOfProjection)"],
    ["Distance", "|FocalPoint − Position|"],
    ["ViewAngle", "Full vertical (or horizontal) opening angle, degrees; unused in parallel projection"],
    ["UseHorizontalViewAngle", "Whether ViewAngle spans the width instead of the height"],
    ["ParallelProjection", "Orthographic instead of perspective"],
    ["ParallelScale", "Half of the view height in world units (parallel projection)"],
    ["ClippingRange", "Near and far distances from Position along DirectionOfProjection"],
    ["Thickness", "far − near"],
    ["Roll", "Rotation about DirectionOfProjection, degrees"],
    ["WindowCenter", "Off-center projection shift, in normalized [-1, 1] units"],
    ["FocalDisk / FocalDistance", "Depth-of-field parameters used by ray tracers"],
    ["Orientation (x, y, z)", "Euler angles of the camera, degrees"],
    ["OrientationWXYZ", "Axis-angle form of the orientation"],
    ["EyeAngle", "Stereo eye separation angle, degrees"],
    ["ViewShear", "Oblique projection shear (dx/dz, dy/dz, center)"],
    ["Flags", "UseOffAxisProjection / UseExplicitProjectionTransformMatrix / FreezeFocalPoint"],
    ["MTime / ViewingRaysMTime", "Modification timestamps"],
  ] as const;
  const params = keyValueTable(parameterRows);

  // ---------------------------------------------------------- controls
  const parallelCheckbox = h("input", { type: "checkbox" }) as HTMLInputElement;
  parallelCheckbox.addEventListener("change", () =>
    apply(() => {
      camera.setParallelProjection(parallelCheckbox.checked ? 1 : 0);
      clipIfAuto();
    }),
  );

  const viewAngleRange = h("input", { type: "range", min: 1, max: 170, step: 1 }) as HTMLInputElement;
  const viewAngleValue = h("span", { className: "value" });
  viewAngleRange.addEventListener("input", () =>
    apply(() => {
      camera.setViewAngle(Number(viewAngleRange.value));
      clipIfAuto();
    }),
  );

  const horizontalCheckbox = h("input", { type: "checkbox" }) as HTMLInputElement;
  horizontalCheckbox.addEventListener("change", () =>
    apply(() => camera.setUseHorizontalViewAngle(horizontalCheckbox.checked ? 1 : 0)),
  );

  const parallelScaleInput = h("input", { type: "number", step: 0.1, min: 0.001 }) as HTMLInputElement;
  parallelScaleInput.addEventListener("change", () => {
    const value = Number(parallelScaleInput.value);
    if (Number.isFinite(value) && value > 0) {
      apply(() => camera.setParallelScale(value));
    }
  });

  const rollRange = h("input", { type: "range", min: -180, max: 180, step: 1 }) as HTMLInputElement;
  const rollValue = h("span", { className: "value" });
  rollRange.addEventListener("input", () => apply(() => camera.setRoll(Number(rollRange.value))));

  const windowCenterX = h("input", { type: "range", min: -1, max: 1, step: 0.05 }) as HTMLInputElement;
  const windowCenterY = h("input", { type: "range", min: -1, max: 1, step: 0.05 }) as HTMLInputElement;
  const windowCenterValue = h("span", { className: "value" });
  const applyWindowCenter = (): void =>
    apply(() => camera.setWindowCenter(Number(windowCenterX.value), Number(windowCenterY.value)));
  windowCenterX.addEventListener("input", applyWindowCenter);
  windowCenterY.addEventListener("input", applyWindowCenter);

  const autoClipCheckbox = h("input", { type: "checkbox" }) as HTMLInputElement;
  const nearInput = h("input", { type: "number", step: 0.01, min: 0.0001 }) as HTMLInputElement;
  const farInput = h("input", { type: "number", step: 0.1, min: 0.0002 }) as HTMLInputElement;
  autoClipCheckbox.addEventListener("change", () =>
    apply(() => {
      style.setAutoAdjustCameraClippingRange(autoClipCheckbox.checked ? 1 : 0);
      nearInput.disabled = autoClipCheckbox.checked;
      farInput.disabled = autoClipCheckbox.checked;
      clipIfAuto();
    }),
  );
  const applyClipping = (): void => {
    const near = Number(nearInput.value);
    const far = Number(farInput.value);
    if (Number.isFinite(near) && Number.isFinite(far) && near > 0 && far > near) {
      apply(() => camera.setClippingRange(near, far));
    }
  };
  nearInput.addEventListener("change", applyClipping);
  farInput.addEventListener("change", applyClipping);

  const shapesInput = h("input", { type: "number", step: 1, min: 1 }) as HTMLInputElement;
  const maxShapes = source.getNumberOfShapesMaxValue();
  if (Number.isFinite(maxShapes) && maxShapes > 0) {
    shapesInput.max = String(maxShapes);
  }
  shapesInput.value = String(source.getNumberOfShapes());
  shapesInput.addEventListener("change", () => {
    const value = Math.round(Number(shapesInput.value));
    if (Number.isFinite(value) && value >= 1) {
      apply(() => {
        source.setNumberOfShapes(value);
        clipIfAuto();
      });
    }
  });

  function button(label: string, title: string, onClick: () => void): HTMLButtonElement {
    const element = h("button", { type: "button", title }, label);
    element.addEventListener("click", () => apply(onClick));
    return element;
  }

  const rotate = (method: "azimuth" | "elevation" | "yaw" | "pitch", degrees: number) => (): void => {
    camera[method](degrees);
    camera.orthogonalizeViewUp();
    clipIfAuto();
  };

  const buttonRows = [
    h(
      "div",
      { className: "button-row" },
      h("span", { className: "group-label" }, "Orbit focal point"),
      button("Azimuth −15°", "vtkCamera::Azimuth — rotate about ViewUp through FocalPoint", rotate("azimuth", -15)),
      button("Azimuth +15°", "vtkCamera::Azimuth", rotate("azimuth", 15)),
      button("Elevation −15°", "vtkCamera::Elevation — rotate about the screen x axis through FocalPoint", rotate("elevation", -15)),
      button("Elevation +15°", "vtkCamera::Elevation", rotate("elevation", 15)),
    ),
    h(
      "div",
      { className: "button-row" },
      h("span", { className: "group-label" }, "Turn in place"),
      button("Yaw −15°", "vtkCamera::Yaw — rotate about ViewUp through Position (moves FocalPoint)", rotate("yaw", -15)),
      button("Yaw +15°", "vtkCamera::Yaw", rotate("yaw", 15)),
      button("Pitch −15°", "vtkCamera::Pitch — rotate about the screen x axis through Position", rotate("pitch", -15)),
      button("Pitch +15°", "vtkCamera::Pitch", rotate("pitch", 15)),
    ),
    h(
      "div",
      { className: "button-row" },
      h("span", { className: "group-label" }, "Distance vs. angle"),
      button("Dolly ×1.25", "vtkCamera::Dolly — move Position toward FocalPoint (Distance / 1.25)", () => {
        camera.dolly(1.25);
        clipIfAuto();
      }),
      button("Dolly ÷1.25", "vtkCamera::Dolly", () => {
        camera.dolly(1 / 1.25);
        clipIfAuto();
      }),
      button("Zoom ×1.25", "vtkCamera::Zoom — narrow ViewAngle (or ParallelScale); Position stays", () => camera.zoom(1.25)),
      button("Zoom ÷1.25", "vtkCamera::Zoom", () => camera.zoom(1 / 1.25)),
    ),
    h(
      "div",
      { className: "button-row" },
      button("Reset camera", "vtkRenderer::ResetCamera — frame the visible props", () => {
        renderer.resetCamera();
      }),
      button("Reset clipping range", "vtkRenderer::ResetCameraClippingRange — fit near/far to the visible props", () => {
        renderer.resetCameraClippingRange();
      }),
      button("Orthogonalize ViewUp", "vtkCamera::OrthogonalizeViewUp", () => camera.orthogonalizeViewUp()),
    ),
    h(
      "div",
      { className: "button-row" },
      button(
        "Reset controls",
        "Restore the vtkCamera defaults for every control above (perspective, ViewAngle 30°, Roll 0, WindowCenter 0/0, auto clipping); Position and FocalPoint stay",
        () => {
          camera.setParallelProjection(0);
          camera.setViewAngle(30);
          camera.setUseHorizontalViewAngle(0);
          camera.setWindowCenter(0, 0);
          camera.setRoll(0);
          camera.orthogonalizeViewUp();
          style.setAutoAdjustCameraClippingRange(1);
          renderer.resetCameraClippingRange();
        },
      ),
    ),
  ];

  const controls = h(
    "div",
    { className: "control-grid" },
    h("label", {}, "ParallelProjection"),
    parallelCheckbox,
    h("span"),
    h("label", {}, "ViewAngle"),
    viewAngleRange,
    viewAngleValue,
    h("label", {}, "UseHorizontalViewAngle"),
    horizontalCheckbox,
    h("span"),
    h("label", {}, "ParallelScale"),
    parallelScaleInput,
    h("span"),
    h("label", {}, "Roll"),
    rollRange,
    rollValue,
    h("label", {}, "WindowCenter x"),
    windowCenterX,
    windowCenterValue,
    h("label", {}, "WindowCenter y"),
    windowCenterY,
    h("span"),
    h("label", {}, "Auto clipping range"),
    autoClipCheckbox,
    h("span", { className: "note" }, "interactor style"),
    h("label", {}, "ClippingRange near"),
    nearInput,
    h("span"),
    h("label", {}, "ClippingRange far"),
    farInput,
    h("span"),
  );

  // ---------------------------------------------------------- mesh controls
  const meshTypeSelect = h("select") as HTMLSelectElement;
  for (const [value, label] of Object.entries(MESH_TYPE_LABELS)) {
    meshTypeSelect.append(h("option", { value }, label));
  }
  meshTypeSelect.value = cameraView.meshType();

  const pdcControls = h(
    "div",
    { className: "control-grid" },
    h("label", {}, "NumberOfShapes"),
    shapesInput,
    h("span", { className: "note" }, `1 – ${Number.isFinite(maxShapes) && maxShapes > 0 ? maxShapes : "?"}`),
  );

  const sphereCenterInputs = DEFAULT_SPHERE.center.map((value) => {
    const input = h("input", { type: "number", step: 0.5 }) as HTMLInputElement;
    input.value = String(value);
    return input;
  });
  const sphereRadiusInput = h("input", { type: "number", step: 0.5, min: 0.01 }) as HTMLInputElement;
  sphereRadiusInput.value = String(DEFAULT_SPHERE.radius);
  const applySphere = (): void => {
    const center = sphereCenterInputs.map((input) => Number(input.value));
    const radius = Number(sphereRadiusInput.value);
    if (!center.every(Number.isFinite) || !Number.isFinite(radius) || radius <= 0) {
      return;
    }
    apply(() => {
      sphere.setCenter(center[0], center[1], center[2]);
      sphere.setRadius(radius);
      clipIfAuto();
    });
  };
  for (const input of [...sphereCenterInputs, sphereRadiusInput]) {
    input.addEventListener("change", applySphere);
  }
  const sphereControls = h(
    "div",
    { className: "control-grid" },
    ...(["Center x", "Center y", "Center z"] as const).flatMap((label, i) => [h("label", {}, label), sphereCenterInputs[i], h("span")]),
    h("label", {}, "Radius"),
    sphereRadiusInput,
    h("span"),
  );

  const showMeshControls = (type: MeshType): void => {
    pdcControls.hidden = type !== "partitionedDataSetCollection";
    sphereControls.hidden = type !== "sphere";
  };
  showMeshControls(cameraView.meshType());
  meshTypeSelect.addEventListener("change", () => {
    const type = meshTypeSelect.value as MeshType;
    showMeshControls(type);
    apply(() => {
      cameraView.setMeshType(type);
      clipIfAuto();
    });
  });

  const meshControls = h(
    "div",
    {},
    h("div", { className: "control-grid" }, h("label", {}, "Type"), meshTypeSelect, h("span")),
    pdcControls,
    sphereControls,
  );

  // ---------------------------------------------------------- matrices
  const viewMatrix = matrixTable("ViewTransformMatrix", "world → camera (eye) coordinates");
  const projectionMatrix = matrixTable("ProjectionTransformMatrix", "(aspect, −1, +1): eye → normalized device coordinates");
  const compositeMatrix = matrixTable("CompositeProjectionTransformMatrix", "projection · view: world → NDC");
  const modelViewMatrix = matrixTable("ModelViewTransformMatrix", "view · ModelTransformMatrix");
  const modelMatrix = matrixTable("ModelTransformMatrix", "user model transform (identity unless set)");
  const planes = planesTable();
  const aspectNote = note("");

  // ---------------------------------------------------------- viewport
  const viewportRows = [
    ["Viewport (normalized)", "vtkViewport::GetViewport — xmin, ymin, xmax, ymax as fractions of the window"],
    ["Viewport (pixels)", "The same rectangle in device pixels"],
    ["Renderer size", "vtkViewport::GetSize — width, height in pixels"],
    ["Renderer origin", "vtkViewport::GetOrigin — lower-left corner in pixels"],
    ["RenderWindow size", "vtkWindow::GetSize"],
    ["Aspect (w / h)", "What the projection matrix is built with"],
    ["PixelAspect", "vtkViewport::GetPixelAspect"],
    ["TiledAspectRatio", "vtkRenderer::GetTiledAspectRatio"],
  ] as const;
  const viewport = keyValueTable(viewportRows);

  const SVG_NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", "viewport-diagram");
  svg.setAttribute("viewBox", "0 0 200 120");
  const windowRect = document.createElementNS(SVG_NS, "rect");
  windowRect.setAttribute("fill", "#0b0f19");
  windowRect.setAttribute("stroke", "#4b5563");
  windowRect.setAttribute("stroke-width", "1");
  const viewportRect = document.createElementNS(SVG_NS, "rect");
  viewportRect.setAttribute("fill", "rgba(125, 211, 252, 0.25)");
  viewportRect.setAttribute("stroke", "#7dd3fc");
  viewportRect.setAttribute("stroke-width", "1.5");
  const svgLabel = document.createElementNS(SVG_NS, "text");
  svgLabel.setAttribute("fill", "#9ca3af");
  svgLabel.setAttribute("font-size", "9");
  svgLabel.setAttribute("x", "4");
  svgLabel.setAttribute("y", "11");
  svgLabel.textContent = "render window";
  svg.append(windowRect, viewportRect, svgLabel);

  const viewportInputs = (["xmin", "ymin", "xmax", "ymax"] as const).map((name) => {
    const input = h("input", { type: "range", min: 0, max: 1, step: 0.01 }) as HTMLInputElement;
    input.dataset.name = name;
    return input;
  });
  const viewportValues = viewportInputs.map(() => h("span", { className: "value" }));
  const applyViewport = (): void => {
    let [xmin, ymin, xmax, ymax] = viewportInputs.map((i) => Number(i.value));
    // Keep at least 5 % of extent in each direction.
    if (xmax - xmin < 0.05) {
      if (document.activeElement === viewportInputs[0]) {
        xmin = xmax - 0.05;
      } else {
        xmax = xmin + 0.05;
      }
    }
    if (ymax - ymin < 0.05) {
      if (document.activeElement === viewportInputs[1]) {
        ymin = ymax - 0.05;
      } else {
        ymax = ymin + 0.05;
      }
    }
    apply(() => {
      renderer.setViewport(xmin, ymin, xmax, ymax);
      clipIfAuto();
    });
  };
  for (const input of viewportInputs) {
    input.addEventListener("input", applyViewport);
  }
  const viewportControls = h(
    "div",
    { className: "control-grid" },
    ...viewportInputs.flatMap((input, i) => [h("label", {}, `Viewport ${input.dataset.name}`), input, viewportValues[i]]),
  );
  const fullViewportButton = h("button", { type: "button" }, "Full window");
  fullViewportButton.addEventListener("click", () =>
    apply(() => {
      renderer.setViewport(0, 0, 1, 1);
      clipIfAuto();
    }),
  );

  // ---------------------------------------------------------- observer view
  const legend = h("div", { className: "checkbox-list" });
  for (const part of GIZMO_PARTS) {
    const info = GIZMO_PART_INFO[part];
    const checkbox = h("input", { type: "checkbox" }) as HTMLInputElement;
    checkbox.checked = observerView.isPartVisible(part);
    checkbox.addEventListener("change", () => observerView.setPartVisible(part, checkbox.checked));
    const swatch = h("span", { className: "swatch" });
    swatch.style.background = info.css;
    legend.append(h("label", { title: info.description }, checkbox, swatch, info.label));
  }
  const resetObserverButton = h("button", { type: "button" }, "Reset observer view");
  resetObserverButton.addEventListener("click", () => observerView.resetView());

  // ---------------------------------------------------------- assemble
  root.replaceChildren(
    section(
      "Camera parameters",
      "vtkCamera getters",
      note("Every value is read back from the live vtkCamera after each interaction or render."),
      params.table,
    ),
    section("Camera controls", "setters + Azimuth / Elevation / Yaw / Pitch / Dolly / Zoom", controls, ...buttonRows),
    section(
      "Mesh controls",
      "what both views render",
      meshControls,
      note("Changing the mesh changes the visible bounds, so the auto clipping range follows; use Reset camera to re-frame it."),
    ),
    section(
      "Transform matrices",
      "row-major, as vtkMatrix4x4 stores them",
      aspectNote,
      viewMatrix.block,
      projectionMatrix.block,
      compositeMatrix.block,
      modelViewMatrix.block,
      modelMatrix.block,
      planes.block,
    ),
    section(
      "Viewport",
      "renderer inside the render window",
      viewport.table,
      svg,
      viewportControls,
      h("div", { className: "button-row" }, fullViewportButton),
      note("The observer view's frustum uses this renderer's aspect ratio, so squeezing the viewport reshapes the frustum."),
    ),
    section("Observer view", "what the gizmo draws", legend, h("div", { className: "button-row" }, resetObserverButton)),
  );

  // ---------------------------------------------------------- update
  function setCells(cells: HTMLTableCellElement[], values: ArrayLike<number>, digits: number): void {
    for (let i = 0; i < cells.length; i++) {
      cells[i].textContent = fmt(values[i], digits);
    }
  }

  function setRange(input: HTMLInputElement, value: number): void {
    if (!isEditing(input)) {
      input.value = String(value);
    }
  }

  function update(state: CameraState): void {
    const [near, far] = state.clippingRange;
    const values = [
      fmtVec(state.position),
      fmtVec(state.focalPoint),
      fmtVec(state.viewUp),
      fmtVec(state.directionOfProjection),
      fmtVec(state.viewPlaneNormal),
      fmt(state.distance),
      `${fmt(state.viewAngle, 2)}°${state.parallelProjection ? " (ignored: parallel)" : ""}`,
      state.useHorizontalViewAngle ? "on (spans width)" : "off (spans height)",
      state.parallelProjection ? "on (orthographic)" : "off (perspective)",
      `${fmt(state.parallelScale)}${state.parallelProjection ? "" : " (ignored: perspective)"}`,
      `near ${fmt(near)}, far ${fmt(far)}`,
      fmt(state.thickness),
      `${fmt(state.roll, 2)}°`,
      fmtVec(state.windowCenter, 2),
      `${fmt(state.focalDisk)} / ${fmt(state.focalDistance)}`,
      `${fmtVec(state.orientation, 2)}°`,
      fmtVec(state.orientationWXYZ, 3),
      `${fmt(state.eyeAngle, 2)}°`,
      fmtVec(state.viewShear),
      `${state.useOffAxisProjection ? "on" : "off"} / ${state.useExplicitProjectionTransformMatrix ? "on" : "off"} / ${state.freezeFocalPoint ? "on" : "off"}`,
      `${state.mtime} / ${state.viewingRaysMTime}`,
    ];
    values.forEach((value, i) => {
      params.cells[i].textContent = value;
    });

    // Controls follow the camera unless the user is dragging them.
    if (!isEditing(parallelCheckbox)) {
      parallelCheckbox.checked = state.parallelProjection;
    }
    setRange(viewAngleRange, Math.round(state.viewAngle));
    viewAngleValue.textContent = `${fmt(state.viewAngle, 1)}°`;
    if (!isEditing(horizontalCheckbox)) {
      horizontalCheckbox.checked = state.useHorizontalViewAngle;
    }
    if (!isEditing(parallelScaleInput)) {
      parallelScaleInput.value = fmt(state.parallelScale, 3);
    }
    setRange(rollRange, Math.round(state.roll));
    rollValue.textContent = `${fmt(state.roll, 1)}°`;
    setRange(windowCenterX, state.windowCenter[0]);
    setRange(windowCenterY, state.windowCenter[1]);
    windowCenterValue.textContent = fmtVec(state.windowCenter, 2);
    const autoClip = style.getAutoAdjustCameraClippingRange() !== 0;
    if (!isEditing(autoClipCheckbox)) {
      autoClipCheckbox.checked = autoClip;
    }
    nearInput.disabled = autoClip;
    farInput.disabled = autoClip;
    if (!isEditing(nearInput)) {
      nearInput.value = fmt(near, 4);
    }
    if (!isEditing(farInput)) {
      farInput.value = fmt(far, 4);
    }

    aspectNote.textContent = `Projection built with aspect = ${fmt(state.aspect, 4)} and the OpenGL depth range (nearz = −1, farz = +1); the clipping range [${fmt(near)}, ${fmt(far)}] maps onto it.`;
    setCells(viewMatrix.cells, state.viewMatrix, 4);
    setCells(projectionMatrix.cells, state.projectionMatrix, 4);
    setCells(compositeMatrix.cells, state.compositeMatrix, 4);
    setCells(modelViewMatrix.cells, state.modelViewMatrix, 4);
    setCells(modelMatrix.cells, state.modelMatrix, 4);
    setCells(planes.cells, state.frustumPlanes, 4);
    planes.sourceNote.textContent = `Source: ${state.frustumPlanesSource}${state.corners ? "" : " — degenerate frustum, corners not drawn"}`;

    const [xmin, ymin, xmax, ymax] = state.viewport;
    const [winW, winH] = state.windowSize;
    viewport.cells[0].textContent = fmtVec(state.viewport, 3);
    viewport.cells[1].textContent = `x ${Math.round(xmin * winW)}–${Math.round(xmax * winW)}, y ${Math.round(ymin * winH)}–${Math.round(ymax * winH)}`;
    viewport.cells[2].textContent = `${state.rendererSize[0]} × ${state.rendererSize[1]}`;
    viewport.cells[3].textContent = `${state.rendererOrigin[0]}, ${state.rendererOrigin[1]}`;
    viewport.cells[4].textContent = `${winW} × ${winH}`;
    viewport.cells[5].textContent = fmt(state.aspect, 4);
    viewport.cells[6].textContent = fmtVec(state.pixelAspect, 2);
    viewport.cells[7].textContent = fmt(state.tiledAspectRatio, 4);

    // Mini diagram: the window rectangle keeps the real aspect ratio.
    const windowAspect = winH > 0 ? winW / winH : 1.6;
    const diagramWidth = 200;
    const diagramHeight = Math.min(160, Math.max(40, diagramWidth / windowAspect));
    svg.setAttribute("viewBox", `0 0 ${diagramWidth} ${diagramHeight}`);
    windowRect.setAttribute("x", "0.5");
    windowRect.setAttribute("y", "0.5");
    windowRect.setAttribute("width", String(diagramWidth - 1));
    windowRect.setAttribute("height", String(diagramHeight - 1));
    // VTK's y axis points up; SVG's points down.
    viewportRect.setAttribute("x", String(xmin * diagramWidth));
    viewportRect.setAttribute("y", String((1 - ymax) * diagramHeight));
    viewportRect.setAttribute("width", String((xmax - xmin) * diagramWidth));
    viewportRect.setAttribute("height", String((ymax - ymin) * diagramHeight));

    state.viewport.forEach((value, i) => {
      setRange(viewportInputs[i], value);
      viewportValues[i].textContent = fmt(value, 2);
    });
  }

  return { update };
}
