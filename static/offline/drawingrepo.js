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
      try {
        const os = db.transaction("drawings", "readonly").objectStore("drawings");
        const r = os.get(idOrCid);
        r.onsuccess = () => {
          if (r.result) return resolve(r.result);
          if (os.indexNames.contains("server_id")) {
            try {
              const idx = os.index("server_id");
              const numericId = Number(idOrCid);
              const reqIdx = !isNaN(numericId) ? idx.get(numericId) : idx.get(idOrCid);
              reqIdx.onsuccess = () => resolve(reqIdx.result || null);
              reqIdx.onerror = () => resolve(null);
              return;
            } catch (_) {}
          }
          // Fallback scan if index doesn't exist
          const allReq = os.getAll();
          allReq.onsuccess = () => {
            const num = Number(idOrCid);
            const found = (allReq.result || []).find(d => d && (d.server_id == idOrCid || (!isNaN(num) && d.server_id == num)));
            resolve(found || null);
          };
          allReq.onerror = () => resolve(null);
        };
        r.onerror = () => reject(r.error);
      } catch (err) {
        resolve(null);
      }
    }));
  }

  function getByNoteCid(noteCid) {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      try {
        const os = db.transaction("drawings", "readonly").objectStore("drawings");
        if (os.indexNames.contains("note_cid")) {
          const r = os.index("note_cid").get(noteCid);
          r.onsuccess = () => resolve(r.result || null);
          r.onerror = () => resolve(null);
        } else {
          const allReq = os.getAll();
          allReq.onsuccess = () => {
            const found = (allReq.result || []).find(d => d && d.note_cid === noteCid);
            resolve(found || null);
          };
          allReq.onerror = () => resolve(null);
        }
      } catch (err) {
        resolve(null);
      }
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
      // If we don't have it locally or we want to sync it, we should fetch it if online
      const doFetch = (fetcher && online) ? Promise.resolve(fetcher(idOrCid)).catch(()=>null) : Promise.resolve(null);

      return doFetch.then((srv) => {
        if (srv && srv.title !== undefined) {
           // It's a standalone drawing from the server!
           const newTitle = srv.title;
           const newSvg = srv.svg_preview || "";
           const isPinned = srv.is_pinned || 0;
           const tags = srv.tags || [];

           if (!rec) {
              // Create local record for standalone drawing
              return BlobStore.put(srv.data_json, { mime: "application/json" }).then((ref) => {
                 const newRec = {
                    cid: TFids.newCid(),
                    server_id: srv.id,
                    blob_ref: ref,
                    title: newTitle,
                    svg_preview: newSvg,
                    is_pinned: isPinned,
                    updated_at: srv.updated_at,
                    created_at: srv.created_at || srv.updated_at,
                    deleted: false,
                    dirty: 0,
                    base_rev: srv.updated_at
                 };
                 return putRec(newRec).then(() => {
                    const tagP = (TFtag && TFtag.setEntityTags) ? TFtag.setEntityTags("drawing", newRec.cid, tags) : Promise.resolve();
                    return tagP.then(() => newRec);
                 });
              });
           } else {
              // Update existing local record if not dirty or server is newer
              if (rec.dirty === 0 || tsEpoch(srv.updated_at) > tsEpoch(rec.base_rev)) {
                 return BlobStore.put(srv.data_json, { mime: "application/json" }).then((ref) => {
                    const oldRef = rec.blob_ref;
                    if (oldRef && oldRef !== ref) BlobStore.delete(oldRef);
                    rec.server_id = srv.id;
                    rec.blob_ref = ref;
                    rec.title = newTitle;
                    rec.svg_preview = newSvg;
                    rec.is_pinned = isPinned;
                    rec.updated_at = srv.updated_at;
                    rec.base_rev = srv.updated_at;
                    // Note: intentionally keeping rec.dirty as is if there's an outbox conflict, but updating base_rev might be dangerous if dirty.
                    // For now, simple LWW:
                    rec.dirty = 0;
                    return putRec(rec).then(() => {
                       const tagP = (TFtag && TFtag.setEntityTags) ? TFtag.setEntityTags("drawing", rec.cid, tags) : Promise.resolve();
                       return tagP.then(() => {
                           return TFoutbox.outboxByEntity("drawing", rec.cid).then(ops => {
                               return Promise.all(ops.map(o => TFoutbox.outboxDelete(o.id)));
                           }).then(() => rec);
                       });
                    });
                 });
              }
              return rec; // keep local dirty changes
           }
        } else if (srv && srv.data_json != null) {
           // Legacy note-attached drawing fetched from server
           return getDrawingLocal(idOrCid).then((local) => {
              if (!local || (local.dirty === 0 && tsEpoch(srv.updated_at) > tsEpoch(local.base_rev))) {
                 return cacheServerDrawing(idOrCid, srv.data_json, srv.updated_at).then(() => getByNoteCid(idOrCid));
              }
              return local;
           });
        }

        // Fetch failed or not online, fallback to whatever we have locally
        if (rec && !rec.deleted && rec.note_cid === undefined) {
           return rec;
        }
        return getDrawingLocal(idOrCid);
      }).then((finalRec) => {
         if (!finalRec || finalRec.deleted) return null;
         
         if (finalRec.note_cid === undefined) {
            // Standalone drawing format
            return Promise.resolve(BlobStore.getBytes(finalRec.blob_ref)).then((bytes) => {
              const tagP = (typeof TFtag !== "undefined" && TFtag.getEntityTags)
                ? TFtag.getEntityTags("drawing", finalRec.cid).then((tags) => tags.map((t) => t.name))
                : Promise.resolve([]);
              return tagP.then((tagNames) => ({
                id: finalRec.server_id != null ? finalRec.server_id : finalRec.cid,
                cid: finalRec.cid,
                server_id: finalRec.server_id,
                title: finalRec.title || "Untitled Drawing",
                data_json: bytes || "{}",
                svg_preview: finalRec.svg_preview || "",
                is_pinned: finalRec.is_pinned || 0,
                tags: tagNames,
                created_at: finalRec.created_at,
                updated_at: finalRec.updated_at,
              }));
            });
         } else {
            // Legacy Note-attached format
            return Promise.resolve(BlobStore.getBytes(finalRec.blob_ref)).then((bytes) => ({
              data_json: bytes,
              updated_at: finalRec.updated_at,
            }));
         }
      });
    });
  }

  function listDrawings(opts) {
    opts = opts || {};
    const token = typeof localStorage !== "undefined" ? localStorage.getItem("tf_token") : null;
    const fetchOnline = (typeof navigator !== "undefined" && navigator.onLine && token)
      ? window.fetch("/api/drawings", { headers: { Authorization: "Bearer " + token } }).then(r => r.ok ? r.json() : []).catch(()=>[])
      : Promise.resolve([]);

    return Promise.all([fetchOnline, getAllRaw()]).then(([serverData, all]) => {
      const active = all.filter((r) => !r.deleted && r.note_cid === undefined);

      const promises = active.map((r) => {
        const tagP = (typeof TFtag !== "undefined" && TFtag.getEntityTags)
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

      return Promise.all(promises).then((localList) => {
        const map = new Map();
        for (const d of serverData) map.set(String(d.id), d);
        for (const d of localList) {
          const sid = d.server_id != null ? String(d.server_id) : null;
          if (sid && map.has(sid)) {
             if (new Date(d.updated_at).getTime() > new Date(map.get(sid).updated_at).getTime()) {
                map.set(sid, d);
             }
          } else {
             map.set(sid || String(d.id || d.cid), d);
          }
        }
        let list = Array.from(map.values());
        list.sort((a, b) => {
          const pinDiff = (b.is_pinned || 0) - (a.is_pinned || 0);
          if (pinDiff !== 0) return pinDiff;
          const tsA = new Date(a.updated_at).getTime() || 0;
          const tsB = new Date(b.updated_at).getTime() || 0;
          return tsB - tsA;
        });

        if (opts.tag) {
          const filterTag = String(opts.tag).toLowerCase();
          list = list.filter((d) => (d.tags || []).some((t) => String(t).toLowerCase() === filterTag));
        }
        if (opts.is_pinned) {
          list = list.filter((d) => String(d.is_pinned) === "1" || d.is_pinned === true || d.is_pinned === 1);
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
