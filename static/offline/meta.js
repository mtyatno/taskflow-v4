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

  function metaDel(key) {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const tx = db.transaction("_meta", "readwrite");
      tx.objectStore("_meta").delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    }));
  }

  // Kunci string berawalan `prefix` (urut), mis. ruang plugin `plugin:<id>:`.
  function metaKeys(prefix) {
    const p = String(prefix || "");
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const store = db.transaction("_meta", "readonly").objectStore("_meta");
      const r = p ? store.getAllKeys(IDBKeyRange.bound(p, p + "\uffff")) : store.getAllKeys();
      r.onsuccess = () => resolve((r.result || []).filter((k) => typeof k === "string" && k.indexOf(p) === 0));
      r.onerror = () => reject(r.error);
    }));
  }

  const exported = { metaGet, metaSet, metaDel, metaKeys };
  if (root && typeof root === "object") { root.TF = root.TF || {}; root.TF.meta = exported; }
  return exported;
});
