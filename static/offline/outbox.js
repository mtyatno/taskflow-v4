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

  function outboxAdd(op) {
    const record = Object.assign({ ts: Date.now(), retries: 0 }, op);
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const tx = db.transaction("_outbox", "readwrite");
      const r = tx.objectStore("_outbox").add(record);
      r.onsuccess = () => { record.qid = r.result; };
      tx.oncomplete = () => resolve(record.qid);
      tx.onerror = () => reject(tx.error);
    }));
  }

  function outboxAll() {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const r = db.transaction("_outbox", "readonly").objectStore("_outbox").getAll();
      r.onsuccess = () => resolve(r.result || []);
      r.onerror = () => reject(r.error);
    }));
  }

  function outboxRemove(qid) {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const tx = db.transaction("_outbox", "readwrite");
      tx.objectStore("_outbox").delete(qid);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    }));
  }

  function outboxByEntity(type, cid) {
    return outboxAll().then((all) => all.filter((o) => o.entity_type === type && o.cid === cid));
  }

  const exported = { outboxAdd, outboxAll, outboxRemove, outboxByEntity };
  if (root && typeof root === "object") { root.TF = root.TF || {}; root.TF.outbox = exported; }
  return exported;
});
