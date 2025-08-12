export default {
  base: "./",
  build: {
    lib: {
      entry: {
        remote: "src/remote.js",
        vtk: "src/standalone.js",
        viewer: "src/viewer.js",
      },
      formats: ["es"],
    },
    assetsDir: ".",
    outDir: "./dist/esm",
  },
};
