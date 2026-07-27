import { toCxxName, toCxxKeys, toJsName, toJsKeys } from "./javaScriptCxxTranslators";


export function createPropGetter(wasm, wrapMethods, vtkId) {
  const fullState = wasm.get(vtkId);
  const getPropHandler = {};
  Object.keys(fullState).forEach((propName) => {
    // console.log("Prop key:", propName);
    getPropHandler[toJsName(propName)] = () =>
      wrapMethods.decorateResult(wasm.get(vtkId)[propName]);
  });
  return getPropHandler;
}

function createPropSetter(wasm, wrapMethods, vtkId) {
  const fullState = wasm.get(vtkId);
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
  const propGetters = createPropGetter(wasm, wrapMethods, vtkId);
  const propSetters = createPropSetter(wasm, wrapMethods, vtkId);

  // Create proxy for given vtk object
  const target = {
    id: vtkId,
    obj: { Id: vtkId },
    set,
    observe,
    toJSON,
    toString,
    unObserve,
    unObserveAll,
    userData: {},
  };
  const vtkProxy = new Proxy(target, {
    get(target, prop, resolver) {
      if (target[prop] !== undefined) {
        return target[prop];
      }
      if (target.userData[prop] !== undefined) {
        return target.userData[prop];
      }
      if (prop === "then") {
        return resolver;
      }
      if (prop === "state") {
        return toJsKeys(wasm.get(vtkId));
      }
      if (prop === "delete") {
        return deleteObject;
      }
      if (propGetters[prop]) {
        return propGetters[prop]();
      }
      // ideally we should have a json structure to check available methods
      target[prop] = async (...args) => {
        const cxxName = toCxxName(prop);
        const decoratedArgs = wrapMethods.decorateArgs(args);
        const result = await invokeFn(vtkId, cxxName, decoratedArgs);
        return wrapMethods.decorateResult(result);
      };
      return target[prop];
    },
    set(target, property, value) {
      if (propSetters[property]) {
        propSetters[property](value);
      } else {
        target.userData[property] = value;
      }
      return true;
    },
  });

  // Update maps
  idToRef.set(vtkId, new WeakRef(vtkProxy));
  vtkProxyCache.set(vtkProxy, true);

  return vtkProxy;
}

export function createInstantiatorProxy(wasm, vtkProxyCache, idToRef) {
  function isVtkObject(obj) {
    return vtkProxyCache.has(obj);
  }

  function decorateKwargs(kwargs) {
    const wrapped = {};
    Object.entries(kwargs).forEach(([k, v]) => {
      if (vtkProxyCache.has(v)) {
        wrapped[k] = v.obj;
      } else {
        wrapped[k] = v;
      }
    });
    return wrapped;
  }

  function decorateArgs(args) {
    return args.map((v) => (vtkProxyCache.has(v) ? v.obj : v));
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
