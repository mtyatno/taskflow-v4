;(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory(root);
  } else {
    root.TF = root.TF || {};
    factory(root);
  }
})(typeof self !== "undefined" ? self : globalThis, function (root) {
  "use strict";

  function newCid() {
    return crypto.randomUUID();
  }

  const exported = { newCid };
  if (root && typeof root === "object") { root.TF = root.TF || {}; root.TF.ids = exported; }
  return exported;
});
