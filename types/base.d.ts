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
 * Pointer-level marshalling between JavaScript TypedArrays and the wasm heap.
 * Available as {@link VtkWasmRuntime.typedArrayInterface}.
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

/** An in-browser VTK session wrapping a C++ `vtkStandaloneSession`. */
export class StandaloneSession {
  /** The `vtk` namespace: call `vtk.vtkActor({ ... })` to create objects. */
  readonly vtk: VtkNamespace;
  /** The underlying C++ session. Escape hatch; prefer {@link StandaloneSession.vtk}. */
  readonly native: object;
  readonly wasmModule: object;
  /** Marshalling between TypedArrays and the wasm heap, bound to this session. */
  readonly typedArrayInterface: TypedArrayInterface;
  readonly disposed: boolean;
  /**
   * Register `canvas` under `key` in `specialHTMLTargets` so it can be used as
   * a `canvasSelector` without a DOM `id`. `key` must start with `!`.
   */
  registerCanvas(key: string, canvas: HTMLCanvasElement): string;
  /** Free the C++ session and all objects it owns. */
  dispose(): void;
  [Symbol.dispose](): void;
}

/** A server-driven VTK session wrapping a C++ `vtkRemoteSession`. */
export class RemoteSession {
  /** The `vtk` namespace proxy. */
  readonly vtk: VtkNamespace;
  readonly native: object;
  readonly wasmModule: object;
  /** Marshalling between TypedArrays and the wasm heap, bound to this session. */
  readonly typedArrayInterface: TypedArrayInterface;
  readonly disposed: Boolean;
  bindNetwork(
    fetchState: (vtkId: number) => unknown,
    fetchHash: (hash: string) => unknown,
    fetchStatus: (...args: any[]) => unknown,
  ): void;
  bindCanvas(
    renderWindowId: number,
    canvasOrId: HTMLCanvasElement | string,
  ): void;
  unbindCanvas(renderWindowId: number): void;
  setSizeAsync(
    renderWindowId: number,
    width: number,
    height: number,
  ): Promise<void>;
  startEventLoop(renderWindowId: number): void;
  stopEventLoop(renderWindowId: number): void;
  updateAsync(vtkId: number): Promise<void>;
  fetchStateAsync(vtkId: number): Promise<unknown>;
  fetchHashAsync(hash: string): Promise<unknown>;
  getState(vtkId: number, useCache?: boolean): unknown;
  getStateValue(valuePath: string, useCache?: boolean): unknown;
  clearStateCache(): void;
  addProgressCallback(callback: (...args: any[]) => void): void;
  freeMemory(cacheSize?: number): void;
}

/** Options accepted by {@link loadAsync}. */
export interface LoadOptions {
  /** Directory URL or `.tar.gz` bundle URL hosting the VTK.wasm files. */
  url?: string;
  /** Base name of the `.mjs`/`.wasm` files (without extension). */
  wasmBaseName?: string;
  /** Rendering backend. */
  rendering?: "webgl" | "webgpu";
  /** Execution model. */
  exec?: "sync" | "async";
  [key: string]: unknown;
}

/** A loaded VTK.wasm runtime. Create sessions from it. */
export class VtkWasmRuntime {
  readonly disposed: boolean;
  readonly id: string;
  readonly module: object;
  /**
   * Pointer-level heap marshalling. Creating VTK arrays needs a session, so
   * `toVTKAoSArray` lives on {@link StandaloneSession.typedArrayInterface}.
   */
  readonly typedArrayInterface: HeapInterface;
  isAsync(): boolean;
  createStandaloneSession(): StandaloneSession;
  createRemoteSession(): RemoteSession;
  dispose(): void;
}

/**
 * Load (and cache) a VTK.wasm runtime.
 */
export function loadAsync(options?: LoadOptions): Promise<VtkWasmRuntime>;

/**
 * When the script tag has `id="vtk-wasm"`, resolves to the `vtk` namespace of
 * the auto-created standalone session; otherwise `undefined`.
 */
export const ready: Promise<VtkNamespace> | undefined;

/** The auto-load standalone session, set after {@link ready} resolves. */
export const session: StandaloneSession | undefined;
