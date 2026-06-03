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
  const TFids = (typeof module !== "undefined" && module.exports)
    ? require("./ids.js")
    : root.TF.ids;

  function indexedDBBlobStore() {
    function put(bytes, meta) {
      const id = "blob_" + TFids.newCid();
      const record = { id, mime: (meta && meta.mime) || "application/octet-stream", bytes };
      return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
        const tx = db.transaction("blobs", "readwrite");
        tx.objectStore("blobs").put(record);
        tx.oncomplete = () => resolve(id);
        tx.onerror = () => reject(tx.error);
      }));
    }
    function getRecord(ref) {
      return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
        const r = db.transaction("blobs", "readonly").objectStore("blobs").get(ref);
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      }));
    }
    function getBytes(ref) {
      return getRecord(ref).then((rec) => (rec ? rec.bytes : undefined));
    }
    function getURL(ref) {
      return getRecord(ref).then((rec) => {
        if (!rec) return undefined;
        const blob = new Blob([rec.bytes], { type: rec.mime });
        return URL.createObjectURL(blob);
      });
    }
    function del(ref) {
      return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
        const tx = db.transaction("blobs", "readwrite");
        tx.objectStore("blobs").delete(ref);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      }));
    }
    return { kind: "indexeddb", put, getBytes, getURL, delete: del };
  }

  function makeBlobStore(env) {
    const hasTauri = env && typeof env.hasTauri === "boolean"
      ? env.hasTauri
      : (typeof root !== "undefined" && !!root.__TAURI__);
    if (hasTauri) {
      // Filesystem implementation arrives in a later sub-project; fall back to IndexedDB for now.
      return indexedDBBlobStore();
    }
    return indexedDBBlobStore();
  }

  const exported = { makeBlobStore };
  if (root && typeof root === "object") { root.TF = root.TF || {}; root.TF.blobstore = exported; }
  return exported;
});
