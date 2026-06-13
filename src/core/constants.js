export const RENDERING_BACKENDS = Object.freeze({
  WEBGL: 'webgl',
  WEBGPU: 'webgpu',
});

export const EXECUTION_MODES = Object.freeze({
  SYNC: 'sync',
  ASYNC: 'async',
});

export const DEFAULT_WASM_BASE_NAME = 'vtk';
export const DEFAULT_WASM_URL_IS_GZIP = true;

export const DEFAULT_CONFIG = Object.freeze({
  rendering: RENDERING_BACKENDS.WEBGL,
  exec: EXECUTION_MODES.SYNC,
});

export const WASM_FILE_EXTENSION = '.wasm';

export const MODULE_JS_FILE_EXTENSION = '.mjs';

export const MIME_TYPES = Object.freeze({
  WASM: 'application/wasm',
  JAVASCRIPT: 'application/javascript',
});
