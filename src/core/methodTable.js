import { toJsName } from "./javaScriptCxxTranslators";

/**
 * A method table resolves (className, jsMethodName) to the C++ method that the
 * proxy may invoke, along with its `maySuspend` flag (methods hinted with
 * `[[vtk::maysuspend]]` must be dispatched through the Promise-returning
 * `invokeAsync` binding on JSPI-enabled builds).
 *
 * Two sources feed it:
 *  - the per-class serdes manifests (`types/<vtkClass>.json`) shipped inside
 *    the `.tar.gz` bundle, kept as raw strings and parsed lazily, and
 *  - a merged index (`vtk-methods.json`) for loose-URL hosting where per-class
 *    files cannot be read synchronously.
 */

/**
 * Normalize one class's method info to `{ inherits, methods }` where
 * `methods` maps camelCase JS names to `{ cxxName, maySuspend }`.
 *
 * Accepts either a full serdes manifest (`methods` values are schema objects
 * with an optional `maySuspend` flag) or a merged-index entry (`methods`
 * values are `0`/`1`).
 */
function normalizeEntry(entry) {
  const methods = new Map();
  for (const [cxxName, value] of Object.entries(entry.methods ?? {})) {
    const maySuspend =
      typeof value === "object" && value !== null
        ? Boolean(value.maySuspend)
        : Boolean(value);
    methods.set(toJsName(cxxName), { cxxName, maySuspend });
  }
  return { inherits: entry.inherits || null, methods };
}

/**
 * @param {(className: string) => object | null} getEntry - returns the raw
 *        manifest / merged-index entry for a class, or null when unknown.
 * @param {(className: string) => boolean} hasEntry
 */
function createTable(getEntry, hasEntry) {
  const normalized = new Map();
  function entryFor(className) {
    if (!normalized.has(className)) {
      const raw = getEntry(className);
      normalized.set(className, raw ? normalizeEntry(raw) : null);
    }
    return normalized.get(className);
  }

  // className -> Map<jsName, {cxxName, maySuspend}> with inherited methods
  // merged in (own declarations win over ancestors').
  const resolved = new Map();
  function methodsFor(className, visiting = new Set()) {
    if (resolved.has(className)) {
      return resolved.get(className);
    }
    if (visiting.has(className)) {
      console.warn(`Inheritance cycle at ${className}; treating as root.`);
      return new Map();
    }
    visiting.add(className);
    const entry = entryFor(className);
    const merged = new Map(
      entry?.inherits ? methodsFor(entry.inherits, visiting) : undefined,
    );
    if (entry) {
      for (const [jsName, method] of entry.methods) {
        merged.set(jsName, method);
      }
    }
    visiting.delete(className);
    resolved.set(className, merged);
    return merged;
  }

  return {
    /** Whether the table knows anything about `className`. */
    hasClass(className) {
      return hasEntry(className);
    },
    /**
     * @returns {{cxxName: string, maySuspend: boolean} | undefined} the method
     *          named `jsName` on `className` or any of its ancestors.
     */
    lookup(className, jsName) {
      return methodsFor(className).get(jsName);
    },
  };
}

/**
 * Build a method table from per-class serdes manifests.
 * @param {Map<string, string>} rawManifests - className -> raw JSON text of
 *        `types/<className>.json`. Parsed lazily, one class at a time.
 */
export function createMethodTableFromManifests(rawManifests) {
  return createTable(
    (className) => {
      const raw = rawManifests.get(className);
      if (raw === undefined) {
        return null;
      }
      try {
        return JSON.parse(raw);
      } catch (error) {
        console.warn(`Could not parse manifest for ${className}:`, error);
        return null;
      }
    },
    (className) => rawManifests.has(className),
  );
}

/**
 * Build a method table from a merged index (`vtk-methods.json`):
 * `{ className: { inherits?: string, methods: { CxxName: 0|1 } } }`.
 * @param {object} index - the parsed JSON.
 */
export function createMethodTableFromMergedIndex(index) {
  return createTable(
    (className) => index[className] ?? null,
    (className) => Object.hasOwn(index, className),
  );
}
