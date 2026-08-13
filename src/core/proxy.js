import { toCxxKeys, toCxxName, toJsName, toJsKeys } from "./javaScriptCxxTranslators";


export function createPropGetter(wasm, wrapMethods, vtkId, fullState) {
  const getPropHandler = {};
  Object.keys(fullState).forEach((propName) => {
    // console.log("Prop key:", propName);
    getPropHandler[toJsName(propName)] = () =>
      wrapMethods.decorateResult(wasm.get(vtkId)[propName]);
  });
  return getPropHandler;
}

function createPropSetter(wasm, wrapMethods, vtkId, fullState) {
  const setPropHandler = {};
  Object.keys(fullState).forEach((propName) => {
    setPropHandler[toJsName(propName)] = (value) =>
      wasm.set(vtkId, wrapMethods.decorateKwargs({ [propName]: value }));
  });
  return setPropHandler;
}

export function createVtkObjectProxy(
  wasm,
  vtkProxyCache,
  idToRef,
  wrapMethods,
  vtkId,
  methodTable,
) {
  // Reuse vtkProxy if already available
  if (idToRef.has(vtkId) && idToRef.get(vtkId).deref()) {
    return idToRef.get(vtkId).deref();
  }

  // Newer single-binary bundles expose `invokeAsync` (JSPI); older split
  // sync/async bundles only expose `invoke` (which is itself a promise in
  // the async binary). Both are awaited, so feature-detect once and use
  // whichever the loaded module provides.
  const invokeFn =
    typeof wasm.invokeAsync === "function"
      ? wasm.invokeAsync.bind(wasm)
      : wasm.invoke.bind(wasm);

  // Create methods
  const observerTags = [];
  function deleteObject() {
    if (typeof wasm.destroy !== "function") {
      console.warn(
        "Cannot delete object: this session does not support destroying objects.",
      );
      return false;
    }
    const result = wasm.destroy(vtkId);
    if (result) {
      const removedProxy = idToRef.delete(vtkId);
      vtkProxyCache.delete(removedProxy);
    }
    return result;
  }
  function set(props) {
    return wasm.set(vtkId, wrapMethods.decorateKwargs(toCxxKeys(props)));
  }
  function observe(event, callback) {
    const tag = wasm.observe(vtkId, event, callback);
    observerTags.push(tag);
    return tag;
  }
  function unObserve(tag) {
    const tagIdx = observerTags.indexOf(tag);
    if (tagIdx !== -1) {
      observerTags.splice(tagIdx, 1);
    }
    return wasm.unObserve(vtkId, tag);
  }
  function unObserveAll() {
    while (observerTags.length) {
      unObserve(observerTags.pop());
    }
  }
  function toString() {
    return wasm.printObjectToString(vtkId);
  }

  function toJSON() {
    return toJsKeys(wasm.get(vtkId));
  }
  // Extract properties and unCapitalize them & add setter
  const fullState = wasm.get(vtkId);
  const className = fullState?.ClassName;
  const propGetters = createPropGetter(wasm, wrapMethods, vtkId, fullState);
  const propSetters = createPropSetter(wasm, wrapMethods, vtkId, fullState);

  // Plumbing members are $-prefixed so they can never collide
  // with C++ members ($ is not legal in C++ names);
  // toJSON/toString stay unprefixed because JSON.stringify and string
  // coercion look them up by exactly those names.
  const target = {
    $id: vtkId,
    $obj: { Id: vtkId },
    $set: set,
    $observe: observe,
    toJSON,
    toString,
    $unObserve: unObserve,
    $unObserveAll: unObserveAll,
    $userData: {},
  };
  const vtkProxy = new Proxy(target, {
    get(target, prop, resolver) {
      if (target[prop] !== undefined) {
        return target[prop];
      }
      if (target.$userData[prop] !== undefined) {
        return target.$userData[prop];
      }
      if (prop === "then") {
        return resolver;
      }
      if (prop === "$state") {
        return toJsKeys(wasm.get(vtkId));
      }
      if (prop === "$delete") {
        return deleteObject;
      }
      if (typeof prop !== "string") {
        // Symbols (Symbol.toPrimitive, Symbol.toStringTag, ...) are protocol
        // probes, never VTK methods.
        return undefined;
      }
      if (propGetters[prop]) {
        return propGetters[prop]();
      }
      // Method dispatch: only names the method table validates are invoked.
      if (!methodTable) {
        // fallback for old wasm package that didn't ship method table.
        target[prop] = async (...args) => {
          const cxxName = toCxxName(prop);
          const decoratedArgs = wrapMethods.decorateArgs(args);
          const result = await invokeFn(vtkId, cxxName, decoratedArgs);
          return wrapMethods.decorateResult(result);
        };
        return target[prop];
        // Remove fallback and uncomment when we drop support for wasm package that do not have method table.
        // throw new Error(
        //   `Cannot access '${prop}' on ${className}: no method manifest is available. ` +
        //     "Load from a .tar.gz bundle that contains types/*.json, or host " +
        //     "vtk-methods.json next to the .mjs/.wasm files.",
        // );
      }
      const method = methodTable.lookup(className, prop);
      if (!method) {
        throw new TypeError(
          methodTable.hasClass(className)
            ? `'${prop}' is not a property or method of ${className}.`
            : `Unknown class ${className}: cannot resolve '${prop}'.`,
        );
      }
      if (method.maySuspend && typeof wasm.invokeAsync === "function") {
        // [[vtk::maysuspend]] methods run on a JSPI-suspendable stack and
        // return a Promise; callers are expected to `await` them.
        target[prop] = (...args) =>
          wasm
            .invokeAsync(vtkId, method.cxxName, wrapMethods.decorateArgs(args))
            .then((result) => wrapMethods.decorateResult(result));
      } else {
        // Everything else (and every method on sync builds, where invokeAsync
        // does not exist) resolves synchronously and returns the value.
        target[prop] = (...args) =>
          wrapMethods.decorateResult(
            wasm.invoke(vtkId, method.cxxName, wrapMethods.decorateArgs(args)),
          );
      }
      return target[prop];
    },
    set(target, property, value) {
      if (propSetters[property]) {
        propSetters[property](value);
      } else {
        target.$userData[property] = value;
      }
      return true;
    },
  });

  // Update maps
  idToRef.set(vtkId, new WeakRef(vtkProxy));
  vtkProxyCache.set(vtkProxy, true);

  return vtkProxy;
}

export function createInstantiatorProxy(wasm, vtkProxyCache, idToRef, methodTable) {
  function isVtkObject(obj) {
    return vtkProxyCache.has(obj);
  }

  function decorateKwargs(kwargs) {
    const wrapped = {};
    Object.entries(kwargs).forEach(([k, v]) => {
      if (vtkProxyCache.has(v)) {
        wrapped[k] = v.$obj;
      } else {
        wrapped[k] = v;
      }
    });
    return wrapped;
  }

  function decorateArgs(args) {
    return args.map((v) => (vtkProxyCache.has(v) ? v.$obj : v));
  }

  const internalMethods = { isVtkObject, decorateKwargs, decorateArgs };

  function decorateResult(result) {
    if (result == null) {
      return result;
    }
    if (result?.Id) {
      return createVtkObjectProxy(
        wasm,
        vtkProxyCache,
        idToRef,
        internalMethods,
        result.Id,
        methodTable,
      );
    }
    return result;
  }
  internalMethods.decorateResult = decorateResult;

  function getVtkObject(obj_or_id) {
    return createVtkObjectProxy(
      wasm,
      vtkProxyCache,
      idToRef,
      internalMethods,
      obj_or_id.Id || obj_or_id,
      methodTable,
    );
  }

  function create(name, args) {
    if (typeof wasm.create !== "function") {
      console.warn(
        `Cannot create '${name}': this session does not support creating objects.`,
      );
      return undefined;
    }
    const vtkId = wasm.create(name);
    if (args) {
      wasm.set(vtkId, decorateKwargs(toCxxKeys(args)));
    }
    return createVtkObjectProxy(
      wasm,
      vtkProxyCache,
      idToRef,
      internalMethods,
      vtkId,
      methodTable,
    );
  }

  return new Proxy(
    { getVtkObject },
    {
      get(target, prop, resolver) {
        if (prop === "then") {
          return resolver;
        }
        if (!target[prop]) {
          // console.log("register create method for", prop);
          target[prop] = (args) => create(prop, args);
        }
        return target[prop];
      },
    },
  );
}
