;(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory(root);
  } else {
    root.TF = root.TF || {};
    factory(root);
  }
})(typeof self !== "undefined" ? self : globalThis, function (root) {
  "use strict";

  const isNode = (typeof module !== "undefined" && module.exports);
  const req = (m, g) => (isNode ? require(m) : g);
  const TFdb = req("./db.js", root.TF && root.TF.db);
  const TFids = req("./ids.js", root.TF && root.TF.ids);
  const TFoutbox = req("./outbox.js", root.TF && root.TF.outbox);
  const TFblob = req("./blobstore.js", root.TF && root.TF.blobstore);

  const BlobStore = TFblob.makeBlobStore();
  let _fetcher = null;

  function tsEpoch(ts) {
    if (ts == null) return 0;
    const s = String(ts);
    const hasTz = /[zZ]|[+-]\d\d:?\d\d$/.test(s);
    const v = Date.parse(hasTz ? s : s + "Z");
    return isNaN(v) ? 0 : v;
  }
  function getByNoteCid(noteCid) {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const r = db.transaction("drawings", "readonly").objectStore("drawings").index("note_cid").get(noteCid);
      r.onsuccess = () => resolve(r.result || null);
      r.onerror = () => reject(r.error);
    }));
  }
  function putRec(rec) {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const tx = db.transaction("drawings", "readwrite");
      tx.objectStore("drawings").put(rec);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    }));
  }

  function _store(noteCid, dataJson, updatedAt, dirty, baseRev, existing) {
    const oldRef = existing && existing.blob_ref;
    return BlobStore.put(dataJson, { mime: "application/json" }).then((ref) => {
      const rec = {
        cid: existing ? existing.cid : TFids.newCid(),
        note_cid: noteCid, blob_ref: ref, updated_at: updatedAt,
        deleted: false, dirty: dirty, base_rev: baseRev,
      };
      return putRec(rec)
        .then(() => (oldRef && oldRef !== ref ? BlobStore.delete(oldRef) : null))
        .then(() => rec);
    });
  }

  function putDrawing(noteCid, dataJson, opts) {
    const now = (opts && opts.now) || new Date().toISOString();
    return getByNoteCid(noteCid).then((existing) =>
      _store(noteCid, dataJson, now, 1, existing ? existing.base_rev : null, existing).then((rec) =>
        TFoutbox.outboxByEntity("drawing", rec.cid).then((ops) => {
          if (ops.some((o) => o.op === "upsert")) return rec; // dedupe: one pending upsert per drawing
          return TFoutbox.outboxAdd({ op: "upsert", entity_type: "drawing", cid: rec.cid, payload: { note_cid: noteCid } }).then(() => rec);
        })));
  }

  function getDrawingLocal(noteCid) {
    return getByNoteCid(noteCid).then((rec) => (rec && !rec.deleted ? rec : null));
  }

  function cacheServerDrawing(noteCid, dataJson, updatedAt) {
    return getByNoteCid(noteCid).then((existing) =>
      _store(noteCid, dataJson, updatedAt, 0, updatedAt, existing));
  }

  function getDrawing(noteCid, opts) {
    opts = opts || {};
    const fetcher = opts.fetch || _fetcher;
    const online = opts.online != null ? opts.online : true;
    return getDrawingLocal(noteCid).then((local) => {
      const refreshP = (fetcher && online)
        ? Promise.resolve(fetcher(noteCid)).then((srv) => {
            if (!srv || srv.data_json == null) return;
            if (!local || (local.dirty === 0 && tsEpoch(srv.updated_at) > tsEpoch(local.base_rev))) {
              return cacheServerDrawing(noteCid, srv.data_json, srv.updated_at);
            }
          }).catch(() => {})
        : Promise.resolve();
      return refreshP.then(() => getDrawingLocal(noteCid)).then((rec) => {
        if (!rec) return null;
        return Promise.resolve(BlobStore.getBytes(rec.blob_ref)).then((bytes) => ({ data_json: bytes, updated_at: rec.updated_at }));
      });
    });
  }

  function configureFetcher(fn) { _fetcher = fn; }

  const exported = { putDrawing, getDrawingLocal, cacheServerDrawing, getDrawing, configureFetcher, _BlobStore: BlobStore };
  if (root && typeof root === "object") { root.TF = root.TF || {}; root.TF.drawingrepo = exported; }
  return exported;
});
