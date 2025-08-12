export default {
  base: "./",
  build: {
    lib: {
      entry: "src/viewer.js",
      formats: ["umd"],
      name: "vtkWASMViewer",
      fileName: "viewer",
    },
    assetsDir: ".",
    outDir: "./dist/umd",
    emptyOutDir: false,
  },
};
