import untar from "js-untar";
import { stripLeadingDotSlash } from "./stringOps.js";
import { createFuture } from "./future.js";
import { MODULE_JS_FILE_EXTENSION, WASM_FILE_EXTENSION } from "./constants.js";

/**
 * Check if provided URL points to a gzip bundle.
 * Accepts both remote URLs ending in `.gz` and `blob:` URLs (which are assumed
 * to represent in-memory gzip bundle data).
 * @param {string} url 
 * @returns {boolean}
 */
export function isGzipBundle(url) {
  return typeof url === "string" && (url.endsWith(".gz") || url.startsWith("blob:"));
}

/**
 * Fetch gzip bundle from provided URL
 * @param {string} url 
 * @returns {Promise<ArrayBuffer>} The decompressed tar archive contents from the gzip bundle.
 */
export function fetchGzipBundle(url) {
  const { promise, resolve, reject } = createFuture();
  fetch(url).then((response) => {
    if (response.ok) {
      const decompressedStream = response.body.pipeThrough(new DecompressionStream('gzip'));
      const decompressionResponse = new Response(decompressedStream);
      decompressionResponse
        .blob()
        .then((blob) => blob.arrayBuffer())
        .then(resolve)
        .catch(reject);
    }
    else {
      reject(new Error(`Could not fetch gzip bundle from ${url} - response status: ${response.status}`));
    }
  }).catch(reject);
  return promise;
}

/**
 * Extract the JavaScript and WebAssembly files from gzip bundle.
 * @param {ArrayBuffer} contents 
 * @param {object} config 
 * @param {string} wasmBaseName 
 * @returns {Promise<{js: {name: string, buffer: ArrayBufferLike}, wasm: {name: string, buffer: ArrayBufferLike}}>}
 */
export function extractFilesFromGzipBundle(contents, config, wasmBaseName) {
  const { promise, resolve, reject } = createFuture();
  untar(contents)
    .then((files) => {
      const execModeSuffix = config?.exec === "async" ? "Async" : "";
      const jsFileMatch = `${wasmBaseName}WebAssembly${execModeSuffix}${MODULE_JS_FILE_EXTENSION}`;
      const wasmFileMatch = `${wasmBaseName}WebAssembly${execModeSuffix}${WASM_FILE_EXTENSION}`;
      const jsFile = files.find((file) => stripLeadingDotSlash(file.name) === jsFileMatch);
      const wasmFile = files.find((file) => stripLeadingDotSlash(file.name) === wasmFileMatch);
      if (jsFile === undefined || wasmFile === undefined) {
        reject(new Error(`Could not find expected files ${jsFileMatch} and ${wasmFileMatch} in the gzip bundle`));
      }
      else {
        resolve({ js: jsFile, wasm: wasmFile });
      }
    })
    .catch(reject);
  return promise;
}
