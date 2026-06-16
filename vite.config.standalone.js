export default {
  base: "./",
  build: {
    lib: {
      entry: "src/index.js",
      formats: ["umd"],
      name: "vtkwasm",
      fileName: "vtk",
    },
    assetsDir: ".",
    outDir: "./dist/umd",
    emptyOutDir: false,
  },
};
