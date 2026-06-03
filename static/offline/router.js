;(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory(root);
  } else {
    root.TF = root.TF || {};
    factory(root);
  }
})(typeof self !== "undefined" ? self : globalThis, function (root) {
  "use strict";

  function splitPath(path) {
    const qIdx = path.indexOf("?");
    const pathname = qIdx === -1 ? path : path.slice(0, qIdx);
    const search = qIdx === -1 ? "" : path.slice(qIdx + 1);
    const query = {};
    if (search) {
      for (const pair of search.split("&")) {
        if (!pair) continue;
        const eq = pair.indexOf("=");
        const k = decodeURIComponent(eq === -1 ? pair : pair.slice(0, eq));
        const v = eq === -1 ? "" : decodeURIComponent(pair.slice(eq + 1));
        query[k] = v;
      }
    }
    return { pathname: pathname.replace(/\/+$/, "") || "/", query };
  }

  function compile(pattern) {
    const segs = pattern.replace(/\/+$/, "").split("/");
    const params = [];
    let specificity = 0; // count of static segments — higher wins
    const matchers = segs.map((seg) => {
      if (seg.startsWith(":")) { params.push(seg.slice(1)); return null; }
      specificity++;
      return seg;
    });
    return { matchers, params, specificity, segLen: segs.length };
  }

  function makeRouter() {
    const routes = []; // { method, compiled, handler }

    function register(method, pattern, handler) {
      routes.push({ method: method.toUpperCase(), compiled: compile(pattern), handler });
    }

    function find(method, path) {
      const { pathname, query } = splitPath(path);
      const segs = pathname.split("/");
      const candidates = [];
      for (const route of routes) {
        if (route.method !== method.toUpperCase()) continue;
        const { matchers, params, specificity, segLen } = route.compiled;
        if (segLen !== segs.length) continue;
        let ok = true;
        for (let i = 0; i < matchers.length; i++) {
          if (matchers[i] === null) continue; // param segment matches anything
          if (matchers[i] !== segs[i]) { ok = false; break; }
        }
        if (!ok) continue;
        // Extract param values by index.
        const paramValues = {};
        let p = 0;
        for (let i = 0; i < matchers.length; i++) {
          if (matchers[i] === null) paramValues[params[p++]] = decodeURIComponent(segs[i]);
        }
        candidates.push({ route, params: paramValues, specificity, query });
      }
      if (!candidates.length) return null;
      candidates.sort((a, b) => b.specificity - a.specificity);
      return candidates[0];
    }

    function hasRoute(method, path) {
      return find(method, path) !== null;
    }

    function dispatch(method, path, body) {
      const m = find(method, path);
      if (!m) return Promise.reject(new Error(`no local route for ${method} ${path}`));
      return Promise.resolve(m.route.handler({ params: m.params, query: m.query, body, method, path }));
    }

    return { register, dispatch, hasRoute };
  }

  const exported = { makeRouter };
  if (root && typeof root === "object") { root.TF = root.TF || {}; root.TF.router = exported; }
  return exported;
});
