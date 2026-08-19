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
  const TFtag = req("./tagrepo.js", root.TF && root.TF.tagrepo);

  const BlobStore = TFblob.makeBlobStore();
  let _fetcher = null;

  function tsEpoch(ts) {
    if (ts == null) return 0;
    const s = String(ts);
    const hasTz = /[zZ]|[+-]\d\d:?\d\d$/.test(s);
    const v = Date.parse(hasTz ? s : s + "Z");
    return isNaN(v) ? 0 : v;
  }

  function getAllRaw() {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const r = db.transaction("drawings", "readonly").objectStore("drawings").getAll();
      r.onsuccess = () => resolve(r.result || []);
      r.onerror = () => reject(r.error);
    }));
  }

  function getRaw(idOrCid) {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const os = db.transaction("drawings", "readonly").objectStore("drawings");
      const r = os.get(idOrCid);
      r.onsuccess = () => {
        if (r.result) return resolve(r.result);
        const idx = os.index("server_id");
        const numericId = Number(idOrCid);
        const reqIdx = !isNaN(numericId) ? idx.get(numericId) : idx.get(idOrCid);
        reqIdx.onsuccess = () => resolve(reqIdx.result || null);
        reqIdx.onerror = () => resolve(null);
      };
      r.onerror = () => reject(r.error);
    }));
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

  // ── Standalone Drawing Methods ──────────────────────────────────────────────

  function createDrawing(doc, opts) {
    doc = doc || {};
    opts = opts || {};
    const now = opts.now || new Date().toISOString();
    const cid = TFids.newCid();
    const dataJson = doc.data_json || "{}";

    return BlobStore.put(dataJson, { mime: "application/json" }).then((ref) => {
      const rec = {
        cid,
        server_id: null,
        title: doc.title || "Untitled Drawing",
        blob_ref: ref,
        svg_preview: doc.svg_preview || "",
        is_pinned: doc.is_pinned ? 1 : 0,
        created_at: now,
        updated_at: now,
        deleted: false,
        dirty: 1,
        base_rev: null,
      };
      return putRec(rec).then(() => {
        const tagP = (doc.tags && TFtag && TFtag.setEntityTags)
          ? TFtag.setEntityTags("drawing", cid, doc.tags)
          : Promise.resolve();
        return tagP.then(() => {
          return TFoutbox.outboxAdd({
            op: "create",
            entity_type: "drawing",
            cid,
            payload: {
              title: rec.title,
              data_json: dataJson,
              svg_preview: rec.svg_preview,
              is_pinned: rec.is_pinned,
              tags: doc.tags || [],
            },
          }).then(() => ({
            id: rec.cid,
            cid: rec.cid,
            server_id: null,
            title: rec.title,
            data_json: dataJson,
            svg_preview: rec.svg_preview,
            is_pinned: rec.is_pinned,
            tags: doc.tags || [],
            dirty: rec.dirty,
            deleted: rec.deleted,
            created_at: rec.created_at,
            updated_at: rec.updated_at,
          }));
        });
      });
    });
  }

  function getDrawing(idOrCid, opts) {
    opts = opts || {};
    const fetcher = opts.fetch || _fetcher;
    const online = opts.online != null ? opts.online : true;

    return getRaw(idOrCid).then((rec) => {
      if (rec && !rec.deleted && rec.note_cid === undefined) {
        // Standalone drawing
        return Promise.resolve(BlobStore.getBytes(rec.blob_ref)).then((bytes) => {
          const tagP = (TFtag && TFtag.getEntityTags)
            ? TFtag.getEntityTags("drawing", rec.cid).then((tags) => tags.map((t) => t.name))
            : Promise.resolve([]);
          return tagP.then((tagNames) => ({
            id: rec.server_id != null ? rec.server_id : rec.cid,
            cid: rec.cid,
            server_id: rec.server_id,
            title: rec.title || "Untitled Drawing",
            data_json: bytes || "{}",
            svg_preview: rec.svg_preview || "",
            is_pinned: rec.is_pinned || 0,
            tags: tagNames,
            created_at: rec.created_at,
            updated_at: rec.updated_at,
          }));
        });
      }

      // Legacy / Note-attached drawing lookup
      return getDrawingLocal(idOrCid).then((local) => {
        const refreshP = (fetcher && online)
          ? Promise.resolve(fetcher(idOrCid)).then((srv) => {
              if (!srv || srv.data_json == null) return;
              if (!local || (local.dirty === 0 && tsEpoch(srv.updated_at) > tsEpoch(local.base_rev))) {
                return cacheServerDrawing(idOrCid, srv.data_json, srv.updated_at);
              }
            }).catch(() => {})
          : Promise.resolve();

        return refreshP.then(() => getDrawingLocal(idOrCid)).then((finalRec) => {
          if (!finalRec) return null;
          return Promise.resolve(BlobStore.getBytes(finalRec.blob_ref)).then((bytes) => ({
            data_json: bytes,
            updated_at: finalRec.updated_at,
          }));
        });
      });
    });
  }

  function listDrawings(opts) {
    opts = opts || {};
    return getAllRaw().then((all) => {
      const active = all.filter((r) => !r.deleted && r.note_cid === undefined);
      active.sort((a, b) => {
        const pinDiff = (b.is_pinned || 0) - (a.is_pinned || 0);
        if (pinDiff !== 0) return pinDiff;
        return tsEpoch(b.updated_at) - tsEpoch(a.updated_at);
      });

      const promises = active.map((r) => {
        const tagP = (TFtag && TFtag.getEntityTags)
          ? TFtag.getEntityTags("drawing", r.cid).then((tags) => tags.map((t) => t.name))
          : Promise.resolve([]);
        return tagP.then((tagNames) => ({
          id: r.server_id != null ? r.server_id : r.cid,
          cid: r.cid,
          server_id: r.server_id,
          title: r.title || "Untitled Drawing",
          svg_preview: r.svg_preview || "",
          is_pinned: r.is_pinned || 0,
          tags: tagNames,
          created_at: r.created_at,
          updated_at: r.updated_at,
        }));
      });

      return Promise.all(promises).then((list) => {
        if (opts.tag) {
          const filterTag = String(opts.tag).toLowerCase();
          return list.filter((d) => (d.tags || []).some((t) => t.toLowerCase() === filterTag));
        }
        return list;
      });
    });
  }

  function updateDrawing(idOrCid, patch, opts) {
    patch = patch || {};
    opts = opts || {};
    const now = opts.now || new Date().toISOString();

    return getRaw(idOrCid).then((rec) => {
      if (!rec || rec.deleted) {
        return Promise.reject(new Error("Drawing not found"));
      }

      const newTitle = patch.title !== undefined ? patch.title : rec.title;
      const newSvg = patch.svg_preview !== undefined ? patch.svg_preview : rec.svg_preview;
      const dataPromise = patch.data_json !== undefined
        ? BlobStore.put(patch.data_json, { mime: "application/json" }).then((newRef) => {
            const oldRef = rec.blob_ref;
            if (oldRef && oldRef !== newRef) BlobStore.delete(oldRef);
            rec.blob_ref = newRef;
            return patch.data_json;
          })
        : Promise.resolve(BlobStore.getBytes(rec.blob_ref));

      return dataPromise.then((dataJson) => {
        rec.title = newTitle;
        rec.svg_preview = newSvg;
        rec.updated_at = now;
        rec.dirty = 1;

        return putRec(rec).then(() => {
          const tagP = (patch.tags && Array.isArray(patch.tags) && TFtag && TFtag.setEntityTags)
            ? TFtag.setEntityTags("drawing", rec.cid, patch.tags)
            : Promise.resolve();

          return tagP.then(() => {
            return TFoutbox.outboxByEntity("drawing", rec.cid).then((ops) => {
              const pendingUpdate = ops.find((o) => o.op === "update");
              if (pendingUpdate) return rec;
              return TFoutbox.outboxAdd({
                op: "update",
                entity_type: "drawing",
                cid: rec.cid,
                payload: {
                  title: rec.title,
                  data_json: dataJson,
                  svg_preview: rec.svg_preview,
                  is_pinned: rec.is_pinned,
                  tags: patch.tags,
                },
              }).then(() => rec);
            }).then(() => ({
              id: rec.server_id != null ? rec.server_id : rec.cid,
              cid: rec.cid,
              server_id: rec.server_id,
              title: rec.title,
              data_json: dataJson,
              svg_preview: rec.svg_preview,
              is_pinned: rec.is_pinned || 0,
              tags: patch.tags || [],
              created_at: rec.created_at,
              updated_at: rec.updated_at,
            }));
          });
        });
      });
    });
  }

  function deleteDrawing(idOrCid) {
    return getRaw(idOrCid).then((rec) => {
      if (!rec) return { ok: true };
      rec.deleted = true;
      rec.dirty = 1;
      return putRec(rec).then(() => {
        return TFoutbox.outboxAdd({
          op: "delete",
          entity_type: "drawing",
          cid: rec.cid,
          payload: {},
        }).then(() => ({ ok: true }));
      });
    });
  }

  function togglePin(idOrCid) {
    return getRaw(idOrCid).then((rec) => {
      if (!rec || rec.deleted) {
        return Promise.reject(new Error("Drawing not found"));
      }
      rec.is_pinned = rec.is_pinned ? 0 : 1;
      return putRec(rec).then(() => {
        return TFoutbox.outboxAdd({
          op: "pin",
          entity_type: "drawing",
          cid: rec.cid,
          payload: { is_pinned: rec.is_pinned },
        }).then(() => ({
          id: rec.server_id != null ? rec.server_id : rec.cid,
          is_pinned: rec.is_pinned,
        }));
      });
    });
  }

  // ── Legacy Note-Attached Drawing Compatibility ──────────────────────────────

  function _store(noteCid, dataJson, updatedAt, dirty, baseRev, existing) {
    const oldRef = existing && existing.blob_ref;
    return BlobStore.put(dataJson, { mime: "application/json" }).then((ref) => {
      const rec = {
        cid: existing ? existing.cid : TFids.newCid(),
        note_cid: noteCid,
        blob_ref: ref,
        updated_at: updatedAt,
        deleted: false,
        dirty: dirty,
        base_rev: baseRev,
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
          if (ops.some((o) => o.op === "upsert")) return rec;
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

  function configureFetcher(fn) { _fetcher = fn; }

  const exported = {
    createDrawing,
    getDrawing,
    listDrawings,
    updateDrawing,
    deleteDrawing,
    togglePin,
    getRaw,
    putDrawing,
    getDrawingLocal,
    cacheServerDrawing,
    configureFetcher,
    _BlobStore: BlobStore,
  };
  if (root && typeof root === "object") { root.TF = root.TF || {}; root.TF.drawingrepo = exported; }
  return exported;
});
