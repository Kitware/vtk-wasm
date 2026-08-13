export default {
  base: "./",
  build: {
    lib: {
      entry: {
        index: "src/index.js",
        viewer: "src/viewer.js",
      },
      formats: ["es"],
      // "type": "module" flips Vite's default ES extension to .js; keep the
      // published .mjs contract (package.json exports point at index.mjs).
      fileName: (format, entryName) => `${entryName}.mjs`,
    },
    rollupOptions: {
      output: {
        chunkFileNames: "[name]-[hash].mjs",
      },
    },
    assetsDir: ".",
    outDir: "./dist/esm",
  },
};
