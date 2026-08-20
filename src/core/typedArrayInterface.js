/**
 * Marshalling between JavaScript TypedArrays and the WebAssembly heap.
 *
 * Two layers, because they need different things:
 *  - the *heap interface* only needs the Emscripten module, so it lives on the
 *    runtime (`runtime.typedArrayInterface`) and deals in raw pointers;
 *  - the *typed-array interface* also needs a `vtk` namespace to instantiate
 *    C++ objects, so it lives on a session (`session.typedArrayInterface`) and
 *    adds `toVTKAoSArray`/`toJSTypedArray` on top of the heap primitives.
 */

/**
 * TypedArray constructor name -> the width-guaranteed VTK AoS array class whose
 * element type matches exactly. The `vtkTypeXxx` classes are used rather than
 * `vtkFloatArray`/`vtkIntArray`/... because their widths are fixed by name, the
 * same guarantee a JavaScript TypedArray gives.
 */
const AOS_CLASS_NAMES = new Map([
  ["Int8Array", "vtkTypeInt8Array"],
  ["Uint8Array", "vtkTypeUInt8Array"],
  ["Uint8ClampedArray", "vtkTypeUInt8Array"],
  ["Int16Array", "vtkTypeInt16Array"],
  ["Uint16Array", "vtkTypeUInt16Array"],
  ["Int32Array", "vtkTypeInt32Array"],
  ["Uint32Array", "vtkTypeUInt32Array"],
  ["BigInt64Array", "vtkTypeInt64Array"],
  ["BigUint64Array", "vtkTypeUInt64Array"],
  ["Float32Array", "vtkTypeFloat32Array"],
  ["Float64Array", "vtkTypeFloat64Array"],
]);

/**
 * VTK data type enum (`vtkType.h`) -> how to read the bytes. Deliberately not a
 * class-name table: `vtkIdTypeArray`, `vtkLongArray` and `vtkUnsignedLongArray`
 * hold 32-bit values on wasm32 and 64-bit values on wasm64, so the width has to
 * come from the array itself via `getDataTypeSize()`.
 *
 * VTK_BIT is absent on purpose — it packs 8 values per byte, so no TypedArray
 * view describes it.
 */
const VTK_DATA_TYPE_KINDS = new Map([
  [2, "signed"], // VTK_CHAR
  [15, "signed"], // VTK_SIGNED_CHAR
  [3, "unsigned"], // VTK_UNSIGNED_CHAR
  [4, "signed"], // VTK_SHORT
  [5, "unsigned"], // VTK_UNSIGNED_SHORT
  [6, "signed"], // VTK_INT
  [7, "unsigned"], // VTK_UNSIGNED_INT
  [8, "signed"], // VTK_LONG
  [9, "unsigned"], // VTK_UNSIGNED_LONG
  [10, "float"], // VTK_FLOAT
  [11, "float"], // VTK_DOUBLE
  [12, "signed"], // VTK_ID_TYPE
  [16, "signed"], // VTK_LONG_LONG
  [17, "unsigned"], // VTK_UNSIGNED_LONG_LONG
]);

/** (kind, size in bytes) -> the TypedArray constructor over those bytes. */
const TYPED_ARRAY_BY_KIND = {
  signed: { 1: Int8Array, 2: Int16Array, 4: Int32Array, 8: BigInt64Array },
  unsigned: {
    1: Uint8Array,
    2: Uint16Array,
    4: Uint32Array,
    8: BigUint64Array,
  },
  float: { 4: Float32Array, 8: Float64Array },
};

/** @returns {boolean} whether `value` is a numeric TypedArray (not a DataView). */
function isTypedArray(value) {
  return ArrayBuffer.isView(value) && !(value instanceof DataView);
}

/**
 * Create the pointer-level heap interface for an Emscripten module.
 *
 * Every view is built fresh from `module.HEAPU8.buffer` rather than cached:
 * growing the heap replaces the underlying `ArrayBuffer` and detaches any view
 * onto the old one.
 *
 * @param {object} module - the Emscripten module.
 */
export function createHeapInterface(module) {
  // Under `-sMEMORY64` the heap is 64-bit addressable, so `_malloc` returns a
  // BigInt and C++ `vtkIdType` parameters expect BigInt too. Probe once with a
  // 1-byte allocation instead of guessing from the build configuration.
  let bigIntPointers = null;
  function usesBigIntPointers() {
    if (bigIntPointers === null) {
      const probe = module._malloc(1);
      bigIntPointers = typeof probe === "bigint";
      module._free(probe);
    }
    return bigIntPointers;
  }

  /** Pointers are byte offsets into the heap; JS needs them as Numbers. */
  function byteOffsetOf(pointer) {
    return typeof pointer === "bigint" ? Number(pointer) : pointer;
  }

  /**
   * Coerce a count/length to the integer flavour this build's C++ signatures
   * expect (`vtkIdType` is 64-bit under `-sMEMORY64`).
   * @param {number} value
   * @returns {number|bigint}
   */
  function toSizeType(value) {
    return usesBigIntPointers() ? BigInt(value) : value;
  }

  /**
   * `malloc` on the wasm heap. The caller owns the result and must pass it to
   * {@link free}, or hand ownership to a C++ object that frees with `free()`.
   * @param {number} byteLength
   * @returns {number|bigint} pointer
   */
  function alloc(byteLength) {
    const pointer = module._malloc(byteLength);
    if (!pointer) {
      throw new Error(
        `Could not allocate ${byteLength} bytes on the WebAssembly heap.`,
      );
    }
    return pointer;
  }

  /**
   * `free` a pointer obtained from {@link alloc} or {@link copyToHeap}.
   * @param {number|bigint} pointer
   */
  function free(pointer) {
    module._free(pointer);
  }

  /**
   * A TypedArray view onto heap memory. Zero-copy, and therefore only valid
   * until the heap grows or the memory is freed — never hold on to one.
   *
   * @param {number|bigint} pointer
   * @param {number} length - element count, not bytes.
   * @param {Function} TypedArrayConstructor - e.g. `Float32Array`.
   */
  function viewAt(pointer, length, TypedArrayConstructor) {
    return new TypedArrayConstructor(
      module.HEAPU8.buffer,
      byteOffsetOf(pointer),
      length,
    );
  }

  /**
   * Allocate heap memory and copy `typedArray` into it.
   * @param {ArrayBufferView} typedArray
   * @returns {number|bigint} pointer to the copy; the caller owns it.
   */
  function copyToHeap(typedArray) {
    if (!isTypedArray(typedArray)) {
      throw new TypeError(
        `Expected a TypedArray, received ${typeof typedArray}.`,
      );
    }
    const pointer = alloc(typedArray.byteLength);
    viewAt(pointer, typedArray.length, typedArray.constructor).set(typedArray);
    return pointer;
  }

  /**
   * Copy heap memory out into a new JavaScript-owned TypedArray. Unlike
   * {@link viewAt} the result survives heap growth and frees.
   *
   * @param {number|bigint} pointer
   * @param {number} length - element count, not bytes.
   * @param {Function} TypedArrayConstructor - e.g. `Float32Array`.
   */
  function copyFromHeap(pointer, length, TypedArrayConstructor) {
    return viewAt(pointer, length, TypedArrayConstructor).slice();
  }

  return {
    usesBigIntPointers,
    toSizeType,
    alloc,
    free,
    viewAt,
    copyToHeap,
    copyFromHeap,
  };
}

/**
 * Extend a heap interface with the conversions that need to instantiate VTK
 * objects. Used by the sessions; see {@link createHeapInterface}.
 *
 * @param {object} heap - from {@link createHeapInterface}.
 * @param {object} vtk - the session's `vtk` namespace proxy.
 */
export function createTypedArrayInterface(heap, vtk) {
  /**
   * Copy a JavaScript TypedArray into a VTK array-of-structs data array.
   *
   * The heap allocation is handed to VTK (`SetArray` with `save` 0), which
   * frees it with `free()` when the array is destroyed or reallocates — so
   * there is nothing for the caller to release. The VTK class is chosen from
   * the TypedArray's own type, so no widening or narrowing takes place.
   *
   * @param {ArrayBufferView} typedArray - source values, copied not aliased.
   * @param {number} [numberOfComponents] - components per tuple (default 1).
   * @param {string} [name] - the array's name (default "").
   * @returns {object} a proxy for the new `vtkTypeXxxArray`.
   */
  function toVTKAoSArray(typedArray, numberOfComponents = 1, name = "") {
    if (!isTypedArray(typedArray)) {
      throw new TypeError(
        `Expected a TypedArray, received ${typeof typedArray}.`,
      );
    }
    const className = AOS_CLASS_NAMES.get(typedArray.constructor.name);
    if (!className) {
      throw new TypeError(
        `${typedArray.constructor.name} has no VTK array-of-structs equivalent. ` +
          `Supported: ${[...new Set(AOS_CLASS_NAMES.keys())].join(", ")}.`,
      );
    }
    if (!Number.isInteger(numberOfComponents) || numberOfComponents < 1) {
      throw new RangeError(
        `numberOfComponents must be a positive integer, received ${numberOfComponents}.`,
      );
    }
    if (typedArray.length % numberOfComponents !== 0) {
      throw new RangeError(
        `A ${typedArray.length}-element array does not divide into tuples of ${numberOfComponents}.`,
      );
    }

    const pointer = heap.copyToHeap(typedArray);
    try {
      const array = vtk[className]({ numberOfComponents, name });
      // `save` 0 transfers ownership of `pointer` to the VTK array.
      array.setArray(pointer, heap.toSizeType(typedArray.length), 0);
      return array;
    } catch (error) {
      // Ownership never reached C++, so the allocation is still ours to release.
      heap.free(pointer);
      throw error;
    }
  }

  /**
   * A TypedArray view onto a VTK data array's own memory. Zero-copy: writes
   * through the view change the VTK array in place (call `modified()` after,
   * so downstream filters and mappers notice).
   *
   * The view aliases the wasm heap, so it is invalidated by anything that grows
   * the heap or reallocates the array — take a fresh one per use rather than
   * caching it. Use `copyFromHeap` if you need a snapshot that outlives that.
   *
   * @param {object} vtkTypedArray - a `vtkDataArray` proxy.
   * @returns {ArrayBufferView} view over `getNumberOfValues()` elements.
   */
  function toJSTypedArray(vtkTypedArray) {
    const dataType = Number(vtkTypedArray.getDataType());
    const kind = VTK_DATA_TYPE_KINDS.get(dataType);
    // Ask the array how wide its values are: VTK_ID_TYPE and VTK_LONG are
    // 32-bit on wasm32 and 64-bit on wasm64.
    const size = Number(vtkTypedArray.getDataTypeSize());
    const TypedArrayConstructor = kind
      ? TYPED_ARRAY_BY_KIND[kind][size]
      : undefined;
    if (!TypedArrayConstructor) {
      throw new TypeError(
        `${vtkTypedArray.className} holds ${size}-byte values of VTK data type ` +
          `${dataType}, which has no JavaScript TypedArray equivalent.`,
      );
    }
    // `getPointer` takes a vtkIdType, which is BigInt on 64-bit builds, and
    // `getNumberOfValues` returns one, which a TypedArray length must not be.
    return heap.viewAt(
      vtkTypedArray.getPointer(heap.toSizeType(0)),
      Number(vtkTypedArray.getNumberOfValues()),
      TypedArrayConstructor,
    );
  }

  return { ...heap, toVTKAoSArray, toJSTypedArray };
}
