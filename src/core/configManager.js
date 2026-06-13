import { EXECUTION_MODES, MIME_TYPES, RENDERING_BACKENDS } from "./constants";
import { createBlobURL } from "./blobURL";
import { stripLeadingDotSlash } from "./stringOps";

/**
 * Validate provided config
 * @param {object} config 
 */
export function validateConfig(config) {
  const validRenderings = Object.values(RENDERING_BACKENDS);
  const validExecModes = Object.values(EXECUTION_MODES);
  if (config.rendering !== undefined && !validRenderings.includes(config.rendering)) {
    throw new Error(`Invalid rendering backend: ${config.rendering}. Valid options are: ${validRenderings.join(', ')}`);
  }
  if (config.exec !== undefined && !validExecModes.includes(config.exec)) {
    throw new Error(`Invalid execution mode: ${config.exec}. Valid options are: ${validExecModes.join(', ')}`);
  }
}

/**
 * Normalize provided config based on constraints. WebGPU requires async execution.
 * @param {object} config 
 * @returns {object}
 */
export function normalizeConfig(config) {
  if (config?.rendering === RENDERING_BACKENDS.WEBGPU) {
    if (config?.exec !== EXECUTION_MODES.ASYNC) {
      console.warn('WebGPU rendering requires async execution mode. Switching exec to "async".');
      return { ...config, exec: EXECUTION_MODES.ASYNC };
    }
  }
  return config;
}


/**
 * Create Emscripten config from provided config
 * @param {object} config 
 * @param {{name: string, buffer: ArrayBufferLike}} wasmFile 
 * @returns {object}
 */
export function createEmscriptenConfig(config, wasmFile) {
  const emscriptenConfig = {};
  let wasmURL = null;
  if (wasmFile !== null && wasmFile !== undefined) {
    emscriptenConfig.locateFile = (fileName) => {
      const normalizedFileName = stripLeadingDotSlash(fileName);
      const normalizedTargetName = stripLeadingDotSlash(wasmFile.name);
      if (normalizedFileName === normalizedTargetName) {
        wasmURL = createBlobURL(wasmFile.buffer, MIME_TYPES.WASM);
        return wasmURL;
      }
      // Resolve other files relative to this module's URL, not the page URL.
      return new URL(fileName, import.meta.url).href;
    };
  }
  let userOnRuntimeInitialized = config?.onRuntimeInitialized;
  emscriptenConfig.onRuntimeInitialized = () => {
    if (typeof userOnRuntimeInitialized === 'function') {
      userOnRuntimeInitialized();
    }
    // Free the object URL after runtime is initialized
    if (wasmURL !== null) {
      URL.revokeObjectURL(wasmURL);
    }
  };
  if (config?.rendering === RENDERING_BACKENDS.WEBGPU) {
    const userPreRun = Array.isArray(config?.preRun)
      ? config.preRun
      : (config?.preRun ? [config.preRun] : []);
    emscriptenConfig.preRun = [(module) => {
      module.ENV.VTK_GRAPHICS_BACKEND = 'WEBGPU';
    },
    ...userPreRun];
  }
  {
    const print = config?.print;
    if (print != null) {
      if (typeof print !== 'function') {
        throw new Error(`config.print must be a function, if provided`);
      }
      // Wrap the user-provided config.print() function in another
      // function to ensure that we control the function signature
      // that is provided to the final emscriptenConfig object.
      emscriptenConfig.print = (text) => {
        print(text);
      };
    }
  }
  {
    const printErr = config?.printErr;
    if (printErr != null) {
      if (typeof printErr !== 'function') {
        throw new Error(`config.printErr must be a function, if provided`);
      }
      // Wrap the user-provided config.printErr() function in another
      // function to ensure that we control the function signature
      // that is provided to the final emscriptenConfig object.
      emscriptenConfig.printErr = (text) => {
        printErr(text);
      };
    }
  }
  return emscriptenConfig;
}
