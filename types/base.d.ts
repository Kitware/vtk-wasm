// Hand-written base types for @kitware/vtk-wasm.
//
// These describe the proxy plumbing and the public session/runtime API. The
// per-class VTK interfaces and the concrete `vtk.vtkXxx(...)` constructor
// signatures on `VtkNamespace` are added by module augmentation: run the
// `vtk-wasm gen-types` CLI (see bin/vtk-wasm.mjs) against the same VTK.wasm
// bundle your app loads, and it emits a
// `declare module "@kitware/vtk-wasm"` file that merges the per-class members
// into the open interfaces declared here. Without that generated file, the
// loose index signature on `VtkNamespace` keeps untyped use compiling.

/**
 * Root of the generated `*Properties` chain. Every generated per-class
 * `*Properties` interface ultimately extends this; `Partial<...Properties>` is
 * what a `vtk.vtkXxx(args)` constructor call accepts. Kept separate from
 * {@link vtkObjectProperties} (which the augmentation merges VTK's own
 * `vtkObject` data properties into) so the two never form an inheritance cycle
 * — VTK's `vtkObject` is a child of `vtkObjectBase`, not the absolute root.
 */
export interface VtkObjectPropertiesBase {}

/**
 * Open data-properties interface for VTK's `vtkObject`. The `vtk-wasm
 * gen-types` augmentation merges `vtkObject`'s own data properties into it.
 */
export interface vtkObjectProperties extends VtkObjectPropertiesBase {}

/**
 * Nominal reference to a VTK class: accepts any object whose generated
 * `$brands` set (its full ancestor chain) contains `K`. Class-typed
 * parameters and settable properties in the generated declarations use
 * `VtkRef<"vtkMapper">` rather than the structural `vtkMapper` interface,
 * because C++ overload collapse makes subclasses structurally incompatible
 * with their bases even though the C++ is-a relationship holds — this mirrors
 * C++'s nominal typing instead. `$brands` is a phantom type-level member; it
 * never exists at runtime.
 */
export type VtkRef<K extends string> = {
  readonly $brands: { [P in K]: true };
};

/**
 * Root of every VTK object proxy returned by the `vtk` namespace — carries the
 * proxy plumbing shared by all objects. Every generated per-class interface
 * ultimately extends this, so the plumbing lives here (on the absolute root)
 * rather than on {@link vtkObject}, which the augmentation merges VTK's own
 * `vtkObject` members into (and which is itself a child of `vtkObjectBase`).
 *
 * Data properties (camelCase) are read/written synchronously. Methods
 * (camelCase) are forwarded to C++ and return their result synchronously,
 * except methods marked `[[vtk::maysuspend]]` in VTK, which are dispatched
 * through the Promise-returning `invokeAsync` binding on JSPI builds. Both are
 * added to the per-class interfaces by the generated augmentation.
 *
 * Proxy plumbing members are `$`-prefixed so they can never collide with C++
 * members (`$` is not legal in C++ identifiers). `toJSON`/`toString` stay
 * unprefixed because `JSON.stringify` and string coercion look them up by
 * exactly those names.
 */
export interface VtkObjectProxyBase extends VtkObjectPropertiesBase {
  /** Numeric WASM object id. */
  readonly $id: number;
  /** `{ Id }` wrapper used when this object is passed to C++. */
  readonly $obj: { Id: number };
  /** Snapshot of the full object state, keys translated to camelCase. */
  readonly $state: Record<string, unknown>;
  /** Properties that are not recognized VTK properties are stored here. */
  $userData: Record<string, unknown>;
  /** Batch-set data properties (camelCase keys). */
  $set(props: Partial<vtkObjectProperties> & Record<string, unknown>): void;
  /**
   * Register an observer for a VTK event. The callback receives the sender
   * object's id and the event name (matching the C++
   * `void(vtkObjectHandle sender, const char* eventName)` signature). Returns a
   * tag usable with {@link VtkObjectProxyBase.$unObserve}.
   */
  $observe(
    event: string,
    callback: (sender: number, eventName: string) => void,
  ): number;
  /** Remove a single observer by its tag. */
  $unObserve(tag: number): unknown;
  /** Remove every observer registered through this proxy. */
  $unObserveAll(): void;
  /** Destroy the underlying C++ object. Returns whether it was destroyed. */
  $delete(): boolean;
  /** Full state as a plain object (camelCase keys). */
  toJSON(): Record<string, unknown>;
  /** C++ `PrintSelf` representation. */
  toString(): string;
}

/**
 * The base type for any VTK object proxy. This is the fallback return type of
 * the loose {@link VtkNamespace} index signature, so untyped `vtk.vtkXxx(...)`
 * use always resolves to something with the proxy plumbing typed. When the
 * `vtk-wasm gen-types` augmentation is present it merges VTK's own `vtkObject`
 * members into this interface.
 */
export interface vtkObject extends VtkObjectProxyBase {}

/**
 * Members of the `vtk` namespace proxy that are not VTK class constructors.
 * The constructors themselves (`vtkActor`, `vtkRenderer`, ...) are added to
 * {@link VtkNamespace} by the generated augmentation.
 */
export interface VtkNamespaceBase {
  /**
   * Re-wrap an existing object id (or `{ Id }`) as a proxy. The argument is
   * required at runtime.
   *
   * The `?` and the `| object` widening are deliberate: they keep this member
   * compatible with the loose `[vtkClassName: string]: (args?: object) => ...`
   * index signature on {@link VtkNamespace} — an accurate
   * `(idOrObj: number | { Id: number })` fails that check on both parameter
   * arity (index callable with zero args) and parameter type.
   */
  getVtkObject(idOrObj?: number | { Id: number } | object): vtkObject;
}

/**
 * The `vtk` namespace proxy: `vtk.vtkActor({ ... })` creates a C++ object and
 * returns its proxy. This interface is the module-augmentation target — the
 * `vtk-wasm gen-types` CLI emits a `declare module "@kitware/vtk-wasm"` file
 * that merges a precisely-typed constructor for every VTK class in your bundle
 * (e.g. `vtkActor(args?: Partial<vtkActorProperties>): vtkActor;`) into it.
 *
 * The loose index signature is the fallback when no generated file is present:
 * any `vtk.vtkAnything(...)` call still compiles and returns the plumbing root
 * {@link VtkObjectProxyBase}. Generated per-class constructors are narrower
 * and take precedence over it. The index value type must be
 * `VtkObjectProxyBase` (not {@link vtkObject}): C++ overload collapse leaves
 * some generated classes structurally incompatible with `vtkObject`, but the
 * `$`-prefixed plumbing root is never redeclared, so every generated
 * constructor stays assignable to the signature.
 */
export interface VtkNamespace extends VtkNamespaceBase {
  [vtkClassName: string]: (args?: object) => VtkObjectProxyBase;
}

/**
 * A byte offset into the WebAssembly heap. Builds configured with `-sMEMORY64`
 * address memory with 64-bit pointers, which reach JavaScript as `bigint`.
 */
export type WasmPointer = number | bigint;

/** The numeric TypedArrays that can be marshalled to and from the wasm heap. */
export type MarshallableTypedArray =
  | Int8Array
  | Uint8Array
  | Uint8ClampedArray
  | Int16Array
  | Uint16Array
  | Int32Array
  | Uint32Array
  | BigInt64Array
  | BigUint64Array
  | Float32Array
  | Float64Array;

/**
 * The width-guaranteed VTK array-of-structs class whose element type matches
 * `T` exactly. `Uint8ClampedArray` shares `vtkTypeUInt8Array` with `Uint8Array`.
 */
export type VtkAoSArrayClassName<T extends MarshallableTypedArray> =
  T extends Int8Array
    ? "vtkTypeInt8Array"
    : T extends Uint8ClampedArray
      ? "vtkTypeUInt8Array"
      : T extends Uint8Array
        ? "vtkTypeUInt8Array"
        : T extends Int16Array
          ? "vtkTypeInt16Array"
          : T extends Uint16Array
            ? "vtkTypeUInt16Array"
            : T extends Int32Array
              ? "vtkTypeInt32Array"
              : T extends Uint32Array
                ? "vtkTypeUInt32Array"
                : T extends BigInt64Array
                  ? "vtkTypeInt64Array"
                  : T extends BigUint64Array
                    ? "vtkTypeUInt64Array"
                    : T extends Float32Array
                      ? "vtkTypeFloat32Array"
                      : T extends Float64Array
                        ? "vtkTypeFloat64Array"
                        : never;

/**
 * The proxy type `toVTKAoSArray` returns for a given TypedArray. Resolves
 * through {@link VtkNamespace}, so it is the precise generated interface when a
 * `vtk-wasm gen-types` augmentation is present and {@link VtkObjectProxyBase}
 * otherwise.
 */
export type VtkAoSArrayOf<T extends MarshallableTypedArray> = ReturnType<
  VtkNamespace[VtkAoSArrayClassName<T>]
>;

/**
 * The JavaScript TypedArray whose element type matches VTK array proxy `T`.
 *
 * Discriminates on the generated `$brands` ancestor chain, so the fixed-width
 * aliases resolve through their concrete base — `vtkTypeFloat32Array` brands
 * include `vtkFloatArray`, and both yield `Float32Array`.
 *
 * `vtkIdTypeArray`, `vtkLongArray` and `vtkUnsignedLongArray` are deliberately
 * absent: they hold 32-bit values on wasm32 and 64-bit values on wasm64, so no
 * single static type is correct for both. They fall through to the
 * {@link MarshallableTypedArray} union and need narrowing at the call site;
 * prefer the `vtkTypeInt32Array`/`vtkTypeInt64Array` aliases when the width
 * matters. `vtkBitArray` is absent because it packs 8 values per byte.
 */
export type JSTypedArrayOf<T> = T extends { $brands: { vtkFloatArray: true } }
  ? Float32Array
  : T extends { $brands: { vtkDoubleArray: true } }
    ? Float64Array
    : T extends { $brands: { vtkCharArray: true } }
      ? Int8Array
      : T extends { $brands: { vtkSignedCharArray: true } }
        ? Int8Array
        : T extends { $brands: { vtkUnsignedCharArray: true } }
          ? Uint8Array
          : T extends { $brands: { vtkShortArray: true } }
            ? Int16Array
            : T extends { $brands: { vtkUnsignedShortArray: true } }
              ? Uint16Array
              : T extends { $brands: { vtkIntArray: true } }
                ? Int32Array
                : T extends { $brands: { vtkUnsignedIntArray: true } }
                  ? Uint32Array
                  : T extends { $brands: { vtkLongLongArray: true } }
                    ? BigInt64Array
                    : T extends { $brands: { vtkUnsignedLongLongArray: true } }
                      ? BigUint64Array
                      : MarshallableTypedArray;

/**
 * Pointer-level marshalling between JavaScript TypedArrays and the wasm heap:
 * `alloc`, `free`, `copyToHeap`, `copyFromHeap`, `viewAt`. Available as
 * {@link VtkWasmRuntime.heapInterface}.
 */
export interface HeapInterface {
  /** Whether this build addresses memory with 64-bit (BigInt) pointers. */
  usesBigIntPointers(): boolean;
  /** Coerce a count to the integer type this build's C++ signatures expect. */
  toSizeType(value: number): WasmPointer;
  /** `malloc`. The caller owns the result until it frees or transfers it. */
  alloc(byteLength: number): WasmPointer;
  /** `free` a pointer from {@link HeapInterface.alloc} or `copyToHeap`. */
  free(pointer: WasmPointer): void;
  /**
   * A zero-copy view onto heap memory, valid only until the heap grows or the
   * memory is freed. `length` counts elements, not bytes.
   */
  viewAt<T extends MarshallableTypedArray>(
    pointer: WasmPointer,
    length: number,
    TypedArrayConstructor: new (
      buffer: ArrayBufferLike,
      byteOffset: number,
      length: number,
    ) => T,
  ): T;
  /** Allocate and copy `typedArray` onto the heap; the caller owns the copy. */
  copyToHeap(typedArray: MarshallableTypedArray): WasmPointer;
  /** Copy heap memory out into a new JavaScript-owned TypedArray. */
  copyFromHeap<T extends MarshallableTypedArray>(
    pointer: WasmPointer,
    length: number,
    TypedArrayConstructor: new (
      buffer: ArrayBufferLike,
      byteOffset: number,
      length: number,
    ) => T,
  ): T;
}

/**
 * {@link HeapInterface} plus the conversions that instantiate VTK objects, and
 * therefore belong to a session rather than the runtime.
 */
export interface TypedArrayInterface extends HeapInterface {
  /**
   * Copy a TypedArray into a new VTK data array in this session. The VTK class
   * follows from the TypedArray's own type, so no values are widened or
   * narrowed. The heap allocation is handed to VTK, which frees it along with
   * the array — the caller has nothing to release.
   *
   * @param typedArray - source values, copied rather than aliased.
   * @param numberOfComponents - components per tuple; defaults to 1. Must
   *        divide `typedArray.length`.
   * @param name - the array's name; defaults to `""`.
   */
  toVTKAoSArray<T extends MarshallableTypedArray>(
    typedArray: T,
    numberOfComponents?: number,
    name?: string,
  ): VtkAoSArrayOf<T>;

  /**
   * A zero-copy TypedArray view onto a VTK data array's own memory. Writes
   * through the view change the array in place — call `modified()` afterwards.
   *
   * The view aliases the wasm heap and is invalidated whenever the heap grows
   * or the array reallocates, so take a fresh one per use instead of caching
   * it. Use {@link HeapInterface.copyFromHeap} for a lasting snapshot.
   */
  toJSTypedArray<T extends VtkObjectProxyBase>(
    vtkTypedArray: T,
  ): JSTypedArrayOf<T>;
}

/**
 * An in-browser VTK session. Wraps a C++ `vtkStandaloneSession` and exposes the
 * `vtk` namespace proxy used to instantiate and drive VTK objects.
 *
 * Obtain one from {@link VtkWasmRuntime.createStandaloneSession}.
 */
export class StandaloneSession {
  /** The `vtk` namespace: call `vtk.vtkActor({ ... })` to create objects. */
  readonly vtk: VtkNamespace;
  /** The underlying C++ session. Escape hatch; prefer {@link StandaloneSession.vtk}. */
  readonly native: object;
  /** The underlying WASM module. */
  readonly wasmModule: object;
  /**
   * Marshalling between JavaScript TypedArrays and the wasm heap. Adds
   * `toVTKAoSArray(typedArray, numberOfComponents, name)` — which creates the
   * matching `vtkTypeXxxArray` in *this* session — to the pointer-level
   * primitives of {@link VtkWasmRuntime.heapInterface}.
   */
  readonly typedArrayInterface: TypedArrayInterface;
  /** Whether {@link StandaloneSession.dispose} has already run. */
  readonly disposed: boolean;
  /**
   * Register `canvas` under `key` in `specialHTMLTargets` so it can be used as
   * a `canvasSelector` without requiring a DOM `id`. The key must start with
   * `!` (Emscripten convention). Returns `key` for convenience.
   *
   * @param key - selector key, e.g. `"!my-canvas"`.
   * @param canvas - the canvas element to register.
   */
  registerCanvas(key: string, canvas: HTMLCanvasElement): string;
  /**
   * Free the C++ session and all objects it owns, and drop proxy caches.
   * The session is unusable afterwards.
   */
  dispose(): void;
  [Symbol.dispose](): void;
}

/**
 * A server-driven VTK session. Wraps a C++ `vtkRemoteSession` and synchronizes
 * object state fetched over the network into the local WebAssembly scene.
 *
 * Obtain one from {@link VtkWasmRuntime.createRemoteSession}.
 */
export class RemoteSession {
  /** The `vtk` namespace proxy. */
  readonly vtk: VtkNamespace;
  /** The underlying C++ session. Escape hatch; prefer {@link RemoteSession.vtk}. */
  readonly native: object;
  /** The underlying WASM module. */
  readonly wasmModule: object;
  /**
   * Marshalling between JavaScript TypedArrays and the wasm heap. Adds
   * `toVTKAoSArray(typedArray, numberOfComponents, name)` — which creates the
   * matching `vtkTypeXxxArray` in *this* session — to the pointer-level
   * primitives of {@link VtkWasmRuntime.heapInterface}.
   */
  readonly typedArrayInterface: TypedArrayInterface;
  /** Whether {@link RemoteSession.dispose} has already run. */
  readonly disposed: boolean;
  /** Render window ids currently bound to a canvas. */
  readonly boundRenderWindows: Set<number>;

  /** Inject the network implementation used to fetch state and blobs. */
  bindNetwork(
    fetchState: (vtkId: number) => unknown,
    fetchHash: (hash: string) => unknown,
    fetchStatus: (...args: any[]) => unknown,
    fetchBatch?:
      | ((
          vtkIds: number[],
          hashes: string[],
        ) => Promise<{ states: unknown[]; hashes: Record<string, unknown> }>)
      | null,
  ): void;

  /**
   * Associate a render window with a user-provided canvas and install the
   * interaction listeners on it.
   *
   * RemoteSession never creates, moves, or removes canvas elements: the caller
   * owns the canvas lifecycle. The canvas may be passed as the element itself
   * or as the `id` of an element already in the DOM. When the Emscripten build
   * exposes `specialHTMLTargets`, the element is registered there directly, so
   * it needs neither an `id` nor to be attached to the document; otherwise the
   * element must have an `id` so a CSS selector can be used as a fallback.
   *
   * @param renderWindowId - id of the render window to bind.
   * @param canvasOrId - the canvas element or its DOM `id`.
   * @returns the native event-target string (see
   *          {@link RemoteSession.getCanvasTarget}).
   */
  bindCanvas(
    renderWindowId: number,
    canvasOrId: HTMLCanvasElement | string,
  ): string;

  /**
   * Return the native event-target string for the canvas registered to a
   * render window. This is a `specialHTMLTargets` key when the build exposes
   * that map, otherwise a CSS selector. Pass it to `native.bindRenderWindow`.
   */
  getCanvasTarget(renderWindowId: number): string;

  /**
   * Remove the interaction listeners installed by
   * {@link RemoteSession.bindCanvas} and forget the render window -> canvas
   * mapping. The canvas element itself is left untouched.
   */
  unbindCanvas(renderWindowId: number): void;

  /** Set the size of the given render window. */
  setSizeAsync(
    renderWindowId: number,
    width: number,
    height: number,
  ): Promise<void>;

  /** Start the event loop on the given render window. */
  startEventLoop(renderWindowId: number): void;
  /** Stop the event loop on the given render window. */
  stopEventLoop(renderWindowId: number): void;

  /** Update an object and its dependencies to match the remote version. */
  updateAsync(vtkId: number): Promise<void>;

  /**
   * Fetch and decode a state; registering it still has to be done separately.
   *
   * @returns the state of the VTK object, or `null` if the server has none.
   */
  fetchStateAsync(vtkId: number): Promise<unknown>;

  /**
   * Fetch a blob and register it inside the session.
   *
   * @returns the typed array matching the blob content.
   */
  fetchHashAsync(hash: string): Promise<unknown>;

  /**
   * Combine {@link RemoteSession.fetchStateAsync} and
   * {@link RemoteSession.fetchHashAsync} into a single network call.
   *
   * @returns the fetched states.
   */
  fetchBatchAsync(vtkIds: number[], hashes: string[]): Promise<unknown[]>;

  /** Push a blob into the session's internal structures. */
  pushHashAsync(
    hash: string,
    arrayOrBlob: Blob | MarshallableTypedArray,
  ): Promise<void>;

  /** Retrieve the local state of an object. */
  getState(vtkId: number, useCache?: boolean): unknown;
  /** Query the local value of a single property. */
  getStateValue(valuePath: string, useCache?: boolean): unknown;
  /** Clear the local state cache. */
  clearStateCache(): void;

  /**
   * Get a helper proxy for controlling a vtkObject on the WASM side.
   *
   * The returned proxy exposes:
   * - `id` — the WASM id, and `obj` — the id wrapped as `{ Id: wasmId }`.
   * - `state` — the full object state.
   * - `delete()` — remove the object from the WASM stack.
   * - `set(kwargs)` — update a batch of properties at once.
   * - `observe(eventName, fn) -> tag` / `unObserve(tag)` / `unObserveAll()` —
   *   manage listeners.
   * - each VTK property as a getter/setter, and each VTK method as an async call.
   */
  getVtkObject(vtkId: number): vtkObject;

  /**
   * Register a callback to monitor download progress.
   *
   * @returns a cleanup function that unregisters the callback.
   */
  addProgressCallback(callback: (...args: any[]) => void): () => void;

  /**
   * Free old blobs once they exceed the allowed cache size in bytes, starting
   * with the oldest.
   */
  freeMemory(cacheSize?: number): void;

  /**
   * Free the C++ session and detach the interaction listeners installed on the
   * user-provided canvases. The canvas elements themselves are left untouched.
   * The session is unusable afterwards.
   */
  dispose(): void;
  [Symbol.dispose](): void;
}

/** Options accepted by {@link loadAsync}. */
export interface LoadOptions {
  /**
   * Directory or `.tar.gz` bundle to load VTK.wasm from. Ignored when the glue
   * script is already present on the page.
   */
  url?: string;
  /** Whether the resource at {@link LoadOptions.url} is a gzip archive. Defaults to `true`. */
  urlIsGzip?: boolean;
  /** Base name of the wasm bundle. Defaults to `"vtk"`. */
  wasmBaseName?: string;
  /** Rendering backend. Defaults to `"webgl"`. */
  rendering?: "webgl" | "webgpu";
  /**
   * Method execution mode. Defaults to `"sync"`. With the single-binary
   * bundles this only affects which legacy file is preferred when present; the
   * proxy feature-detects `invokeAsync` at runtime. With old split bundles,
   * `"async"` loads the `...Async` binary.
   */
  exec?: "sync" | "async";
  /** `std::cout` sink. */
  print?: (text: string) => void;
  /** `std::cerr` sink. */
  printErr?: (text: string) => void;
  [key: string]: unknown;
}

/**
 * A loaded VTK.wasm WebAssembly module. Acts as the single factory for sessions.
 */
export class VtkWasmRuntime {
  /** Whether {@link VtkWasmRuntime.dispose} has already run. */
  readonly disposed: boolean;
  /**
   * The unique identifier for the wasm module this runtime was created from.
   * Looks like `url::wasmBaseName::config.rendering::config.exec`.
   */
  readonly id: string;
  /** The underlying Emscripten module. Escape hatch; prefer the session API. */
  readonly module: object;
  /**
   * Pointer-level marshalling between JavaScript TypedArrays and the wasm heap:
   * `alloc`, `free`, `copyToHeap`, `copyFromHeap`, `viewAt`. Creating VTK data
   * arrays needs a session, so `toVTKAoSArray` lives on
   * {@link StandaloneSession.typedArrayInterface} instead.
   */
  readonly heapInterface: HeapInterface;
  /** Whether this runtime executes methods asynchronously (JSPI). */
  isAsync(): boolean;
  /** Create an in-browser standalone session. */
  createStandaloneSession(): StandaloneSession;
  /** Create a server-driven remote session. */
  createRemoteSession(): RemoteSession;
  /**
   * Drop this runtime from the shared cache and release the module reference.
   * Note: Emscripten cannot reclaim a runtime's heap before page reload;
   * disposing individual sessions is what actually frees C++ memory.
   */
  dispose(): void;
  [Symbol.dispose](): void;
}

/**
 * Load the VTK.wasm runtime and return a {@link VtkWasmRuntime} ready to create
 * sessions. Runtimes are cached per (url, wasmBaseName, rendering, exec), so
 * repeated calls with the same options share a single WebAssembly module.
 *
 * To pipe `std::cout`/`std::cerr` to the console, pass
 * {@link LoadOptions.print} / {@link LoadOptions.printErr}.
 */
export function loadAsync(options?: LoadOptions): Promise<VtkWasmRuntime>;

/**
 * When the script tag has `id="vtk-wasm"`, the runtime is loaded automatically
 * and this resolves to the `vtk` namespace of the auto-created standalone
 * session; otherwise `undefined`. Reach it via the UMD global
 * (`vtkwasm.ready`) or an ESM import
 * (`import { ready } from "@kitware/vtk-wasm"`).
 *
 * Data attributes recognized on the script tag:
 *  - `data-url="url to load VTK.wasm from"` — only needed when VTK.wasm is not
 *    already loaded.
 *  - `data-config="{ rendering: 'webgl|webgpu', exec: 'sync|async' }"` — JSON
 *    configuration for the WASM module.
 */
export const ready: Promise<VtkNamespace> | undefined;

/**
 * The {@link StandaloneSession} created by the annotation auto-load. Set after
 * {@link ready} resolves; `undefined` before then and when auto-load is not
 * active. Use it to call `session.registerCanvas()` and similar helpers.
 */
export const session: StandaloneSession | undefined;
