import untar from "js-untar";
import { stripLeadingDotSlash } from "./stringOps.js";
import { MODULE_JS_FILE_EXTENSION, WASM_FILE_EXTENSION } from "./constants.js";
import { wasmModuleBaseNames } from "./wasmModuleNames.js";

/**
 * Fetch gzip bundle from provided URL
 * @param {string} url 
 * @returns {Promise<ArrayBuffer>} The decompressed tar archive contents from the gzip bundle.
 */
export async function fetchGzipBundleAsync(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Could not fetch gzip bundle from ${url} - response status: ${response.status}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const uint8View = new Uint8Array(arrayBuffer);

  // Check if it's already decompressed by the browser/server.
  // Gzip magic number: 0x1F 0x8B.
  if (uint8View.length >= 2 && uint8View[0] === 0x1F && uint8View[1] === 0x8B) {
    // If it is gzipped, decompress it using DecompressionStream.
    const decompressedStream = new Response(arrayBuffer).body.pipeThrough(new DecompressionStream('gzip'));
    return await new Response(decompressedStream).arrayBuffer();
  }

  // Not gzipped (already decompressed by server/browser).
  return arrayBuffer;
}

/**
 * Extract the JavaScript and WebAssembly files from gzip bundle, along with
 * the per-class serdes manifests (`types/<vtkClass>.json`) when the bundle
 * ships them. Manifests are returned as raw JSON text keyed by class name;
 * they are parsed lazily by the method table.
 * @param {ArrayBuffer} contents
 * @param {object} config
 * @param {string} wasmBaseName
 * @returns {Promise<{js: {name: string, buffer: ArrayBufferLike}, wasm: {name: string, buffer: ArrayBufferLike}, manifests: Map<string, string> | null}>}
 */
export async function extractFilesFromGzipBundleAsync(contents, config, wasmBaseName) {
  const files = await untar(contents);
  // New single-binary bundles ship `${wasmBaseName}WebAssembly.{mjs,wasm}`; older
  // split bundles also carry a `${wasmBaseName}WebAssemblyAsync.{mjs,wasm}` pair.
  // Try each candidate base name in order and use the first complete js+wasm pair.
  const tried = [];
  for (const moduleBaseName of wasmModuleBaseNames(wasmBaseName, config)) {
    const jsFileMatch = `${moduleBaseName}${MODULE_JS_FILE_EXTENSION}`;
    const wasmFileMatch = `${moduleBaseName}${WASM_FILE_EXTENSION}`;
    tried.push(jsFileMatch, wasmFileMatch);
    const jsFile = files.find((file) => stripLeadingDotSlash(file.name) === jsFileMatch);
    const wasmFile = files.find((file) => stripLeadingDotSlash(file.name) === wasmFileMatch);
    if (jsFile !== undefined && wasmFile !== undefined) {
      const decoder = new TextDecoder();
      const manifests = new Map();
      for (const file of files) {
        const match = stripLeadingDotSlash(file.name).match(/(?:^|\/)types\/(vtk[^/]+)\.json$/);
        if (match) {
          manifests.set(match[1], decoder.decode(file.buffer));
        }
      }
      return { js: jsFile, wasm: wasmFile, manifests: manifests.size > 0 ? manifests : null };
    }
  }
}
