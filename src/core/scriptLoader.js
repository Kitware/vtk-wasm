import { createFuture } from "./future";
import { isHTMLDocument } from "./stringOps";
import { MODULE_JS_FILE_EXTENSION } from "./constants";

/**
 * Get the URL of the WebAssembly module JavaScript file. This is the glue
 * code that loads the WebAssembly binary. It tries to fetch the file to
 * ensure it exists, and resolves with null if the fetch fails for any reason.
 *
 * This is a fallback when not using GZIP bundles.
 *
 * The returned URL is resolved to an absolute URL against the document base so
 * it can be handed to a dynamic `import()`. Unlike `fetch()`, `import()` does
 * not resolve relative specifiers against the page origin (a bare specifier
 * like "vtk/wasm/vtkWebAssembly.mjs" would throw, and a "./"-relative one would
 * resolve against the bundle's location, not the page). Resolving here keeps a
 * relative `wasmBaseURL` (e.g. "myapp/wasm32/9.6.0") pointing at the page
 * origin, exactly as the prior `fetch`-based loader did. Absolute `wasmBaseURL`
 * values pass through unchanged.
 *
 * @param {string} wasmBaseURL URL where the wasm module JavaScript file is located
 * @param {string} wasmBaseName Base name of the wasm module JavaScript file
 * @param {object} config Configuration object
 * @returns {Promise<string>} Absolute URL of the wasm module JavaScript file
 */
export async function createScriptURLAsync(wasmBaseURL, wasmBaseName, config) {
  const execModeSuffix = config?.exec === "async" ? "Async" : "";
  const filename = `${wasmBaseName}WebAssembly${execModeSuffix}${MODULE_JS_FILE_EXTENSION}`;
  // Strip trailing slashes
  wasmBaseURL = String(wasmBaseURL).replace(/\/+$/, "");
  const base = typeof document !== "undefined" ? document.baseURI : undefined;
  const url = new URL(`${wasmBaseURL}/${filename}`, base).href;
  const { promise, resolve, reject } = createFuture();
  fetch(url)
    .then((response) => {
      if (!response.ok) {
        return null;
      }
      return response.text();
    })
    .then((content) => {
      if (content === null) {
        resolve(null);
      }
      // In docker we serve the index.html when the file doesn't exist, so test that this is not html.
      if (isHTMLDocument(content)) {
        resolve(null);
      }
      // Not html content
      resolve(url);
    })
    .catch(reject);
  return promise;
}
