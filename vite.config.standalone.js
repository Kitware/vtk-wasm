export default {
  base: "./",
  build: {
    lib: {
      entry: "src/standalone.js",
      formats: ["umd"],
      name: "vtkWASM",
      fileName: "vtk",
    },
    assetsDir: ".",
    outDir: "./dist/umd",
    emptyOutDir: false,
  },
};
