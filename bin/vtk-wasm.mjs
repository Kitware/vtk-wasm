#!/usr/bin/env node
// @kitware/vtk-wasm command-line tool.
//
//   vtk-wasm gen-types --url <bundle .tar.gz> --out <file.d.ts>
//   vtk-wasm gen-types --in  <dir of vtk*.json> --out <file.d.ts>
//
// `gen-types` emits a TypeScript module-augmentation file that makes
// `session.vtk` fully typed for the exact VTK.wasm binary your app loads. Point
// it at the same bundle you pass to `loadAsync({ url })`; the per-class serdes
// manifests (`types/*.json`) emitted by VTK's vtkWrapSerDes and shipped
// alongside the binary are the source of truth, so the generated types always
// match your VTK version and arch.
//
// The manifests are architecture-specific: word-width types are already baked
// to a concrete width by the VTK build, so they must come from the archive that
// matches your target (wasm32 or wasm64). No target flag needed.
//
// The manifest schema (per class) is JSON-Schema flavored:
//   { "title": "vtkActor", "inherits": "vtkProp3D",
//     "properties": { "Opacity": { "type": "number" },
//                     "Mapper":  { "$ref": "vtkMapper" } },
//     "methods": {
//       "GetMapper": { "parameters": {}, "returns": { "$ref": "vtkMapper" } },
//       // `maySuspend: true` marks a method that yields to the browser event
//       // loop (WebGPU/JSPI await); it is emitted as Promise<T>, all others T.
//       "WaitForCompletion": { "parameters": {}, "returns": { "type": "null" }, "maySuspend": true }
//     }
//   }
//
// Methods are keyed by name in the manifest, so C++ overloads collapse to a
// single surviving signature per class, and different classes in a hierarchy
// may keep different survivors. Combined with C++ signature hiding and
// covariant overrides, a child interface often redeclares an inherited member
// with a signature that TypeScript's `extends` rejects. We therefore emit
// `extends Omit<Parent, "redeclaredName" | ...>` so the child's declaration
// simply replaces the parent's instead of being compared against it.
//
// The same collapse also breaks *structural* substitutability at use-sites: a
// subclass (vtkPolyDataMapper) is often not assignable where its base
// (vtkMapper) is expected, even though the C++ is-a relationship holds. C++ is
// nominally typed, so we mirror that: every generated interface carries a
// phantom `$brands` member listing its full ancestor chain, and every
// class-typed parameter / settable-property position is typed as
// `VtkRef<"vtkMapper">` (defined in types/base.d.ts) which means "anything
// branded as a vtkMapper", instead of the structural interface. Return
// positions keep the full structural interface for proper member typing.

import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";

// TS reserved words that cannot be used verbatim as parameter identifiers.
const RESERVED = new Set([
  "class",
  "const",
  "default",
  "delete",
  "extends",
  "function",
  "in",
  "instanceof",
  "let",
  "new",
  "return",
  "super",
  "this",
  "typeof",
  "var",
  "void",
]);

// Member names the proxy get-trap resolves before consulting C++ (see
// src/core/proxy.js). Proxy plumbing is $-prefixed and can never collide with
// C++ members ($ is not legal in C++ identifiers).
const PLUMBING = new Set(["toJSON", "toString", "then"]);

// ---------------------------------------------------------------------------
// Command line
// ---------------------------------------------------------------------------

function usage(code = 1) {
  process.stderr.write(
    [
      "usage:",
      "  vtk-wasm gen-types --url <bundle .tar.gz>    --out <file.d.ts>",
      "  vtk-wasm gen-types --in  <dir of vtk*.json>  --out <file.d.ts>",
      "",
      "options:",
      "  --url <path|URL>   .tar.gz VTK.wasm bundle (local path or http(s) URL)",
      "  --in  <dir>        local directory of vtk*.json manifests (repeatable)",
      "  --out <file>       output .d.ts (default: ./vtk-wasm.gen.d.ts)",
      "",
    ].join("\n"),
  );
  process.exit(code);
}

function parseArgs(argv) {
  if (argv[0] !== "gen-types") usage();
  const opts = {
    dirs: [],
    url: null,
    out: "vtk-wasm.gen.d.ts",
  };
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--in") opts.dirs.push(argv[++i]);
    else if (a === "--url") opts.url = argv[++i];
    else if (a === "--out") opts.out = argv[++i];
    else if (a === "-h" || a === "--help") usage(0);
    else {
      process.stderr.write(`unknown argument: ${a}\n`);
      usage();
    }
  }
  if (opts.dirs.length === 0 && !opts.url) usage();
  if (opts.dirs.length > 0 && opts.url) {
    process.stderr.write("provide either --in or --url, not both\n");
    usage();
  }
  return opts;
}

// ---------------------------------------------------------------------------
// Manifest loading
// ---------------------------------------------------------------------------

// Fetch the bundle bytes: http(s) URL via global fetch, otherwise a local path.
async function readBundleAsync(urlOrPath) {
  if (/^https?:\/\//.test(urlOrPath)) {
    const res = await fetch(urlOrPath);
    if (!res.ok) {
      throw new Error(
        `Could not fetch bundle from ${urlOrPath} - response status: ${res.status}`,
      );
    }
    return new Uint8Array(await res.arrayBuffer());
  }
  return new Uint8Array(readFileSync(urlOrPath));
}

// Gunzip when the buffer carries the gzip magic (0x1F 0x8B); otherwise assume
// it is already a plain tar (mirrors src/core/gzipBundle.js).
function maybeGunzip(bytes) {
  if (bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b) {
    return new Uint8Array(gunzipSync(bytes));
  }
  return bytes;
}

// Minimal POSIX/ustar tar reader: walk 512-byte records, read the file name
// (bytes 0-99, NUL-terminated) and octal size (bytes 124-135), yield each
// regular file's name and bytes. Stops at the terminating zero block. Only the
// `types/vtk*.json` entries are needed, so exotic long-name/pax records (never
// used for these short paths) are skipped as non-regular entries.
function* readTar(buf) {
  const decoder = new TextDecoder();
  const readStr = (off, len) => {
    let end = off;
    while (end < off + len && buf[end] !== 0) end++;
    return decoder.decode(buf.subarray(off, end));
  };
  let pos = 0;
  while (pos + 512 <= buf.length) {
    // A block of all zero bytes marks end-of-archive.
    let allZero = true;
    for (let i = 0; i < 512; i++) {
      if (buf[pos + i] !== 0) {
        allZero = false;
        break;
      }
    }
    if (allZero) break;

    const name = readStr(pos, 100);
    const sizeStr = readStr(pos + 124, 12).trim();
    const size = parseInt(sizeStr, 8) || 0;
    const typeFlag = buf[pos + 156];
    const dataStart = pos + 512;
    // Regular file: type flag '0' (0x30) or NUL (older tars).
    if (typeFlag === 0x30 || typeFlag === 0) {
      yield { name, data: buf.subarray(dataStart, dataStart + size) };
    }
    // Advance past the data, padded up to the next 512-byte boundary.
    pos = dataStart + Math.ceil(size / 512) * 512;
  }
}

// Pull the `types/vtk*.json` manifests out of a (possibly gzipped) tar bundle.
function manifestsFromBundle(bytes) {
  const decoder = new TextDecoder();
  const byTitle = new Map();
  for (const { name, data } of readTar(maybeGunzip(bytes))) {
    if (!/(?:^|\/)types\/vtk[^/]+\.json$/.test(name.replace(/^\.\//, ""))) {
      continue;
    }
    let manifest;
    try {
      manifest = JSON.parse(decoder.decode(data));
    } catch {
      process.stderr.write(`skipping ${name}: invalid JSON\n`);
      continue;
    }
    if (!manifest.title) {
      process.stderr.write(`skipping ${name}: no "title"\n`);
      continue;
    }
    byTitle.set(manifest.title, manifest);
  }
  return byTitle;
}

// Read already-unpacked manifests from local directories.
function manifestsFromDirs(dirs) {
  const byTitle = new Map();
  for (const dir of dirs) {
    for (const name of readdirSync(dir)) {
      if (!name.endsWith(".json")) continue;
      const manifest = JSON.parse(readFileSync(join(dir, name), "utf8"));
      if (!manifest.title) {
        process.stderr.write(`skipping ${name}: no "title"\n`);
        continue;
      }
      byTitle.set(manifest.title, manifest);
    }
  }
  return byTitle;
}

// ---------------------------------------------------------------------------
// Declaration emission
// ---------------------------------------------------------------------------

// First-letter lowercase — mirrors toJsName() in src/core/javaScriptCxxTranslators.js
function toJsName(cxxName) {
  return cxxName.charAt(0).toLowerCase() + cxxName.slice(1);
}

// Note: every non-identifier parameter name maps to "arg", so two such
// parameters in one signature would collide. Not observed in any manifest.
function safeParam(name) {
  let p = name;
  if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(p)) p = "arg";
  if (RESERVED.has(p)) p = `${p}_`;
  return p;
}

function createTypeResolver(generatedNames) {
  // When the manifest set contains vtkObject (any real VTK build), the
  // generated interface is the true runtime shape and is the fallback for
  // unresolved $refs; the hand-written base alias covers sparse manifest sets.
  const fallback = generatedNames.has("vtkObject")
    ? "vtkObject"
    : "VtkObjectProxyBase";
  // Concrete numeric `type` values emitted by VTK's serdes manifest. The
  // manifest is architecture-specific: word-width C types (long, size_t,
  // vtkIdType) are already baked to a concrete width by the VTK build (int32 on
  // wasm32, int64 on wasm64), so no per-target resolution is needed here.
  // JS Numbers hold every integer up to 2^53 exactly, so anything that fits in
  // 32 bits (or an IEEE-754 float) maps to `number`; 64-bit integers exceed
  // that range and map to `bigint`.
  const NUMERIC = new Map([
    ["Int8", "number"],
    ["Int16", "number"],
    ["Int32", "number"],
    ["UInt8", "number"],
    ["UInt16", "number"],
    ["UInt32", "number"],
    ["Float32", "number"],
    ["Float64", "number"],
    ["Int64", "bigint"],
    ["UInt64", "bigint"],
  ]);
  // Resolve a class name to the interface that represents it.
  function resolveClass(name) {
    if (generatedNames.has(name)) return name;
    return fallback; // covers base names and not-yet-generated refs
  }
  // Map a JSON-Schema fragment to a TypeScript type.
  // `asReturn` makes the `null` type render as `void` (for Promise<void>).
  function tsType(schema, asReturn = false) {
    if (!schema) return "any";
    if (schema.$ref) return resolveClass(schema.$ref);
    if (NUMERIC.has(schema.type)) return NUMERIC.get(schema.type);
    switch (schema.type) {
      case "boolean":
        return "boolean";
      case "integer":
      case "number":
        return "number";
      case "string":
        return "string";
      case "array":
        return `${tsType(schema.items)}[]`;
      case "object":
        return fallback;
      case "null":
        return asReturn ? "void" : "null";
      default:
        return "any";
    }
  }
  // Type for a parameter or settable-property position. Class references
  // become nominal `VtkRef<"name">` handles (accepting any subclass via its
  // `$brands` chain) because overload collapse makes subclasses structurally
  // incompatible with their bases; everything else falls through to tsType.
  function tsRefType(schema) {
    if (schema?.$ref && generatedNames.has(schema.$ref)) {
      return `VtkRef<${JSON.stringify(schema.$ref)}>`;
    }
    if (schema?.type === "array") {
      return `${tsRefType(schema.items)}[]`;
    }
    return tsType(schema);
  }
  return { tsType, tsRefType };
}

// Precompute, per class, its own members (by JS name) and the union of member
// names declared by its in-set ancestors — the inputs to the Omit computation.
function buildMemberIndex(byTitle, names) {
  const own = new Map();
  for (const [title, manifest] of byTitle) {
    const parent =
      manifest.inherits && names.has(manifest.inherits)
        ? manifest.inherits
        : null; // missing or out-of-set parent → treat as root
    const props = new Map();
    for (const [cxxName, schema] of Object.entries(manifest.properties || {})) {
      props.set(toJsName(cxxName), schema);
    }
    const methods = new Map();
    for (const [cxxName, method] of Object.entries(manifest.methods || {})) {
      const js = toJsName(cxxName);
      // The proxy resolves plumbing first, then property getters, then
      // synthesizes a method — so a method shadowed by either never runs.
      if (PLUMBING.has(js) || props.has(js)) continue;
      methods.set(js, method);
    }
    const mainNames = new Set(methods.keys());
    for (const name of props.keys()) {
      if (!PLUMBING.has(name)) mainNames.add(name);
    }
    own.set(title, { parent, props, methods, mainNames });
  }

  function makeInheritedLookup(pick) {
    const cache = new Map();
    function lookup(title, visiting = new Set()) {
      if (cache.has(title)) return cache.get(title);
      if (visiting.has(title)) {
        process.stderr.write(`inheritance cycle at ${title}; treating as root\n`);
        return new Set();
      }
      visiting.add(title);
      const out = new Set();
      const { parent } = own.get(title);
      if (parent) {
        for (const n of lookup(parent, visiting)) out.add(n);
        for (const n of pick(own.get(parent))) out.add(n);
      }
      visiting.delete(title);
      cache.set(title, out);
      return out;
    }
    return lookup;
  }

  // In-set ancestor chain (root first, self last) — the `$brands` set that
  // makes nominal VtkRef assignability mirror the C++ is-a relationship.
  const chainCache = new Map();
  function brandChain(title, visiting = new Set()) {
    if (chainCache.has(title)) return chainCache.get(title);
    if (visiting.has(title)) return [title]; // cycle already warned above
    visiting.add(title);
    const { parent } = own.get(title);
    const chain = parent ? [...brandChain(parent, visiting), title] : [title];
    visiting.delete(title);
    chainCache.set(title, chain);
    return chain;
  }

  return {
    get: (title) => own.get(title),
    inheritedMainNames: makeInheritedLookup((entry) => entry.mainNames),
    inheritedPropNames: makeInheritedLookup((entry) => entry.props.keys()),
    brandChain,
  };
}

function emitClass(title, index, { tsType, tsRefType }) {
  const { parent, props, methods, mainNames } = index.get(title);
  const q = (n) => JSON.stringify(n);
  const withOmit = (base, keys) =>
    keys.length ? `Omit<${base}, ${keys.map(q).join(" | ")}>` : base;

  const lines = [];

  // Data properties interface (drives the `vtk.vtkXxx(args)` Partial). Kept
  // complete — plumbing-colliding names are still settable through the
  // constructor args, which go through wasm.set rather than the proxy.
  const inheritedProps = index.inheritedPropNames(title);
  const propOmits = [...props.keys()]
    .filter((n) => inheritedProps.has(n))
    .sort();
  const propsParent = parent
    ? `${parent}Properties`
    : "VtkObjectPropertiesBase";
  lines.push(
    `export interface ${title}Properties extends ${withOmit(propsParent, propOmits)} {`,
  );
  for (const [js, schema] of props) {
    const ro = schema.readOnly ? "readonly " : "";
    // Write position (constructor args / $set): class-typed values accept any
    // subclass through the nominal VtkRef handle.
    lines.push(`  ${ro}${js}: ${tsRefType(schema)};`);
  }
  lines.push(`}`);
  lines.push(``);

  // The proxy interface: single parent, own properties inlined (minus
  // plumbing-shadowed ones), own methods appended. Any inherited name this
  // class redeclares is Omitted from the parent so the redeclaration replaces
  // it instead of being signature-compared against it.
  const inheritedMain = index.inheritedMainNames(title);
  const mainOmits = [...mainNames].filter((n) => inheritedMain.has(n)).sort();
  const mainParent = parent ?? "VtkObjectProxyBase";
  lines.push(
    `export interface ${title} extends ${withOmit(mainParent, mainOmits)} {`,
  );
  // Phantom nominal brand: the full in-set ancestor chain. Never exists at
  // runtime — proxies only reach consumers through generated signatures, so
  // nothing ever has to construct it. A child's wider brand set is assignable
  // to its parent's, so no Omit is needed for it.
  const brands = index
    .brandChain(title)
    .map((n) => `${n}: true`)
    .join("; ");
  lines.push(`  readonly $brands: { ${brands} };`);
  for (const [js, schema] of props) {
    if (PLUMBING.has(js)) continue; // unreachable through the proxy
    const ro = schema.readOnly ? "readonly " : "";
    lines.push(`  ${ro}${js}: ${tsType(schema)};`);
  }
  for (const [js, method] of methods) {
    const params = Object.entries(method.parameters || {})
      .map(([pName, pSchema]) => `${safeParam(pName)}: ${tsRefType(pSchema)}`)
      .join(", ");
    const ret = tsType(method.returns, true);
    // Only methods flagged `maySuspend` in the manifest suspend (WebGPU/JSPI
    // await) and are dispatched through the Promise-returning invokeAsync
    // binding; all others resolve synchronously and return T directly.
    const retType = method.maySuspend ? `Promise<${ret}>` : ret;
    lines.push(`  ${js}(${params}): ${retType};`);
  }
  lines.push(`}`);

  return lines.join("\n");
}

function generate(byTitle) {
  const names = new Set(byTitle.keys());
  const resolver = createTypeResolver(names);
  const index = buildMemberIndex(byTitle, names);
  // Stable, deterministic output order.
  const titles = [...names].sort();

  // Module-augmentation output: `declare module "@kitware/vtk-wasm"` merges the
  // per-class interfaces and the concrete `vtk.vtkXxx(...)` constructor
  // signatures into the open interfaces hand-declared in types/base.d.ts.
  // Names used inside the augmentation do NOT resolve against the target
  // module's exports — they resolve against the generated file's scope — so the
  // roots (VtkObjectProxyBase, VtkObjectPropertiesBase) and VtkRef must be
  // imported explicitly. (An unresolved name there would silently become `any`
  // in consumer projects with `skipLibCheck: true`, defeating all checking.)
  const header = [
    "// AUTO-GENERATED by `vtk-wasm gen-types` — DO NOT EDIT BY HAND.",
    "// Regenerate against the same VTK.wasm bundle your app loads:",
    "//   npx vtk-wasm gen-types --url <bundle .tar.gz> --out <this file>",
    "// Ensure this file is included by your tsconfig `include`.",
    "",
    "import type {",
    "  VtkRef,",
    "  VtkObjectProxyBase,",
    "  VtkObjectPropertiesBase,",
    '} from "@kitware/vtk-wasm";',
    "",
    'declare module "@kitware/vtk-wasm" {',
  ];

  const blocks = titles.map((t) => emitClass(t, index, resolver));

  const ns = [];
  ns.push(
    "/** The `vtk` namespace proxy: each method instantiates a VTK object. */",
  );
  ns.push("interface VtkNamespace {");
  for (const t of titles) {
    ns.push(`  ${t}(args?: Partial<${t}Properties>): ${t};`);
  }
  ns.push("}");

  const body = `${blocks.join("\n\n")}\n\n${ns.join("\n")}`;
  return `${header.join("\n")}\n${body}\n}\n`;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const byTitle = opts.url
    ? manifestsFromBundle(await readBundleAsync(opts.url))
    : manifestsFromDirs(opts.dirs);

  if (byTitle.size === 0) {
    process.stderr.write(
      `No vtk*.json manifests found in ${opts.url ?? opts.dirs.join(", ")}\n`,
    );
    process.exit(1);
  }

  writeFileSync(opts.out, generate(byTitle));
  process.stdout.write(
    `Generated types for ${byTitle.size} class(es) -> ${opts.out}\n` +
      `Ensure this file is included by your tsconfig "include".\n`,
  );
}

main().catch((err) => {
  process.stderr.write(`${err?.stack || err}\n`);
  process.exit(1);
});
