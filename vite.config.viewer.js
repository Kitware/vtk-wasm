export default {
  base: "./",
  build: {
    lib: {
      entry: "src/viewer.js",
      formats: ["umd"],
      name: "vtkWASMViewer",
      // "type": "module" flips Vite's default UMD extension to .umd.cjs; keep
      // the published viewer.umd.js name (script-tag consumers, exports map).
      fileName: () => "viewer.umd.js",
      cssFileName: "viewer",
    },
    assetsDir: ".",
    outDir: "./dist/umd",
    emptyOutDir: false,
  },
};
