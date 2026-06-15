import { createFuture } from "./future";
import { isHTMLDocument } from "./stringOps";
import { MODULE_JS_FILE_EXTENSION } from "./constants";

const LOADED_URLS = [];
const PROMISES = {};

/**
 * Wait for existing wasm script to be loaded.
 * This is useful when the script tag with a path to the wasm module already
 * exists in the HTML document.
 * 
 * @param {string} wasmBaseName 
 * @returns {Promise<void>}
 */
export function loadWebAssemblyModuleFromExistingScriptAsync(wasmBaseName) {
  if (window.createVTKWASM) {
    return Promise.resolve();
  }

  let scriptPromise = null;
  const scriptName = `${wasmBaseName}WebAssembly`;
  const scripts = document.querySelectorAll("script");
  for (const script of scripts) {
    if (script.src.includes(scriptName)) {
      const { promise, resolve, reject } = createFuture();
      script.onload = resolve;
      script.onerror = () => {
        reject(new Error(`Failed to load script: ${script.src}`));
      };
      scriptPromise = promise;
      break;
    }
  }
  if (scriptPromise) {
    return scriptPromise;
  } else {
    return Promise.resolve();
  }
}

/**
 * Add script tag with provided URL with type="module"
 *
 * @param {string} url a URL to the wasm module JavaScript file
 * @return {Promise<void>} to know when the script is ready
 */
export function loadWebAssemblyModuleFromScriptAsync(url) {
  if (PROMISES[url]) {
    return PROMISES[url];
  }

  PROMISES[url] = new Promise(function (resolve, reject) {
    if (LOADED_URLS.indexOf(url) === -1) {
      LOADED_URLS.push(url);
      const newScriptTag = document.createElement("script");
      newScriptTag.type = "module";
      newScriptTag.src = url;
      newScriptTag.onload = resolve;
      newScriptTag.onerror = () => {
        reject(new Error(`Failed to load script: ${url}`));
      };
      document.body.appendChild(newScriptTag);
    } else {
      // Already loaded.
      resolve(false);
    }
  });

  return PROMISES[url];
}

/**
 * Get the URL of the WebAssembly module JavaScript file. This is the glue
 * code that loads the WebAssembly binary. It tries to fetch the file to
 * ensure it exists, and resolves with null if the fetch fails for any reason.
 *
 * This is a fallback when not using GZIP bundles.
 *
 * @param {string} wasmBaseURL URL where the wasm module JavaScript file is located
 * @param {string} wasmBaseName Base name of the wasm module JavaScript file
 * @param {object} config Configuration object
 * @returns {Promise<string>} URL of the wasm module JavaScript file
 */
export async function createScriptURLAsync(wasmBaseURL, wasmBaseName, config) {
  const execModeSuffix = config?.exec === "async" ? "Async" : "";
  const filename = `${wasmBaseName}WebAssembly${execModeSuffix}${MODULE_JS_FILE_EXTENSION}`;
  const url = `${wasmBaseURL}/${filename}`;
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
