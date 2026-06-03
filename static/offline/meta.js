;(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory(root);
  } else {
    root.TF = root.TF || {};
    factory(root);
  }
})(typeof self !== "undefined" ? self : globalThis, function (root) {
  "use strict";

  const TFdb = (typeof module !== "undefined" && module.exports)
    ? require("./db.js")
    : root.TF.db;

  function metaGet(key) {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const r = db.transaction("_meta", "readonly").objectStore("_meta").get(key);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    }));
  }

  function metaSet(key, val) {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const tx = db.transaction("_meta", "readwrite");
      tx.objectStore("_meta").put(val, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    }));
  }

  const exported = { metaGet, metaSet };
  if (root && typeof root === "object") { root.TF = root.TF || {}; root.TF.meta = exported; }
  return exported;
});
