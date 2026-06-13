export default {
  base: "./",
  build: {
    lib: {
      entry: {
        index: "src/index.js",
        viewer: "src/viewer.js",
      },
      formats: ["es"],
    },
    assetsDir: ".",
    outDir: "./dist/esm",
  },
};
