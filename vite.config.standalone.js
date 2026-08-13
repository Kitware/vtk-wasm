export default {
  base: "./",
  build: {
    lib: {
      entry: "src/index.js",
      formats: ["umd"],
      name: "vtkwasm",
      // "type": "module" flips Vite's default UMD extension to .umd.cjs; keep
      // the published vtk.umd.js name (script-tag consumers, exports map).
      fileName: () => "vtk.umd.js",
      cssFileName: "vtk",
    },
    assetsDir: ".",
    outDir: "./dist/umd",
    emptyOutDir: false,
  },
};
