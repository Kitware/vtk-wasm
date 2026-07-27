import { isHTMLDocument } from "./stringOps";
import { MODULE_JS_FILE_EXTENSION } from "./constants";
import { wasmModuleBaseNames } from "./wasmModuleNames";

/**
 * Probe a single glue-module URL. Resolves with the absolute URL if it exists
 * and is not an HTML fallback page, otherwise with null.
 *
 * @param {string} url absolute URL of a candidate glue module
 * @returns {Promise<string|null>}
 */
async function probeScriptURLAsync(url) {
  let response;
  try {
    response = await fetch(url);
  } catch {
    return null;
  }
  if (!response.ok) {
    return null;
  }
  const content = await response.text();
  // In docker we serve the index.html when the file doesn't exist, so test that
  // this is not html.
  if (isHTMLDocument(content)) {
    return null;
  }
  return url;
}

/**
 * Get the URL of the WebAssembly module JavaScript file. This is the glue
 * code that loads the WebAssembly binary. It tries to fetch each candidate to
 * ensure it exists, and resolves with null if none can be located.
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
 * @param {object} config Configuration object (selects sync/async candidates)
 * @returns {Promise<string|null>} Absolute URL of the wasm module JavaScript file
 */
export async function createScriptURLAsync(wasmBaseURL, wasmBaseName, config) {
  // Strip trailing slashes
  wasmBaseURL = String(wasmBaseURL).replace(/\/+$/, "");
  const base = typeof document !== "undefined" ? document.baseURI : undefined;
  // Try the single-binary name first (or the legacy async name ahead of it when
  // async is requested); resolve with the first candidate that exists.
  for (const moduleBaseName of wasmModuleBaseNames(wasmBaseName, config)) {
    const filename = `${moduleBaseName}${MODULE_JS_FILE_EXTENSION}`;
    const url = new URL(`${wasmBaseURL}/${filename}`, base).href;
    const resolved = await probeScriptURLAsync(url);
    if (resolved !== null) {
      return resolved;
    }
  }
  return null;
}
