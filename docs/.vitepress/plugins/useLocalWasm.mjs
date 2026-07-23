import { readFile } from "node:fs/promises";
import { join } from "node:path";

// unpkg CDN references in the docs, mapped to the locally-served build copies
// (see the `docs:assets` npm script, which drops the built UMD bundles under
// `docs/public/js/`). Committed sources keep the unpkg URLs so the production
// build ships the CDN links unchanged; these rewrites apply only under
// `docs:dev` (guarded by the VITE_USE_LOCAL_WASM env flag in config.mjs).
const UNPKG = "https://unpkg.com/@kitware/vtk-wasm";
const REPLACEMENTS = [
  [`${UNPKG}/vtk-umd.js`, "js/vtk.umd.js"],
  [`${UNPKG}/viewer-umd.js`, "js/viewer.umd.js"],
  [`${UNPKG}/viewer.css`, "js/viewer.css"],
];

/**
 * Repoint every unpkg CDN reference at the locally-served build copy.
 * @param {string} text
 * @param {string} base site base (e.g. "/vtk-wasm").
 * @returns {string}
 */
export function rewriteUnpkg(text, base) {
  const normalizedBase = base.replace(/\/+$/, "");
  let out = text;
  for (const [from, rel] of REPLACEMENTS) {
    out = out.split(from).join(`${normalizedBase}/${rel}`);
  }
  return out;
}

/**
 * markdown-it plugin that rewrites unpkg references in the raw markdown source
 * (the `<Playground>` snippets embed the script tag). Registered from
 * config.mjs only when local-wasm mode is on.
 *
 * @param {string} base site base.
 * @returns {(md: import('markdown-it')) => void}
 */
export function localWasmMarkdown(base) {
  return (md) => {
    md.core.ruler.before("normalize", "use-local-wasm", (state) => {
      if (state.src.includes(UNPKG)) {
        state.src = rewriteUnpkg(state.src, base);
      }
    });
  };
}

/**
 * Dev-server Vite plugin that rewrites unpkg references in the static demo
 * pages under `public/` (Vite serves `public/` verbatim, so a middleware is the
 * only interception point). Markdown pages are handled separately by
 * {@link localWasmMarkdown}.
 *
 * @param {object} options
 * @param {string} options.publicDir absolute path to the docs `public/` dir.
 * @param {string} [options.base] site base (default "/vtk-wasm").
 */
export function useLocalWasm({ publicDir, base = "/vtk-wasm" }) {
  const normalizedBase = base.replace(/\/+$/, "");
  return {
    name: "use-local-wasm",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = (req.url || "").split("?")[0];
        if (!url.endsWith(".html")) {
          return next();
        }
        // Resolve the request within public/ (strip the site base prefix).
        const rel = url.startsWith(`${normalizedBase}/`)
          ? url.slice(normalizedBase.length + 1)
          : url.replace(/^\/+/, "");
        readFile(join(publicDir, rel), "utf8").then(
          (data) => {
            if (!data.includes(UNPKG)) {
              return next(); // let Vite's static handler serve it as-is
            }
            res.setHeader("Content-Type", "text/html");
            res.end(rewriteUnpkg(data, normalizedBase));
          },
          () => next(), // not a public html file; fall through
        );
      });
    },
  };
}
