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

  const keyFor = (type, serverId) => `${type}:${serverId}`;

  function mapPut(type, serverId, cid) {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const tx = db.transaction("_idmap", "readwrite");
      tx.objectStore("_idmap").put({ key: keyFor(type, serverId), entity_type: type, server_id: serverId, cid });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    }));
  }

  function cidOf(type, serverId) {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const r = db.transaction("_idmap", "readonly").objectStore("_idmap").get(keyFor(type, serverId));
      r.onsuccess = () => resolve(r.result ? r.result.cid : undefined);
      r.onerror = () => reject(r.error);
    }));
  }

  function serverIdOf(cid) {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const r = db.transaction("_idmap", "readonly").objectStore("_idmap").index("cid").get(cid);
      r.onsuccess = () => resolve(r.result ? r.result.server_id : undefined);
      r.onerror = () => reject(r.error);
    }));
  }

  const exported = { mapPut, cidOf, serverIdOf };
  if (root && typeof root === "object") { root.TF = root.TF || {}; root.TF.idmap = exported; }
  return exported;
});
