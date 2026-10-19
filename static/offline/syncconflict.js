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
  const TFidmap = req("./idmap.js", root.TF && root.TF.idmap);
  // drawingrepo dibaca malas: di browser bisa berasal dari cache SW lama tanpa ensureDrawingUpdateOp → fallback op polos
  function drawingRepo() {
    try { return isNode ? require("./drawingrepo.js") : (root.TF && root.TF.drawingrepo); } catch (_) { return null; }
  }

  const STORE = {
    task: "tasks", note: "scratchpad_notes", mindmap: "mindmaps", habit: "habits", drawing: "drawings",
    // entitas "anak" tanpa judul sendiri: hanya sync_error (4xx permanen saat push) yang ditampilkan
    habit_log: "habit_logs", recurring_exception: "recurring_exceptions",
  };
  const ENTITIES = ["task", "note", "mindmap", "habit", "drawing", "habit_log", "recurring_exception"];
  const CHILD = { habit_log: true, recurring_exception: true };

  function getAll(store) {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const r = db.transaction(store, "readonly").objectStore(store).getAll();
      r.onsuccess = () => resolve(r.result || []);
      r.onerror = () => reject(r.error);
    }));
  }
  function getRaw(store, cid) {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const r = db.transaction(store, "readonly").objectStore(store).get(cid);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    }));
  }
  function deleteRaw(store, cid) {
    // drawing: record + blob (+ blob dasar) dibuang bersama (tidak ada blob yatim)
    if (store === "drawings") {
      const repo = drawingRepo();
      if (repo && typeof repo.purgeDrawing === "function") return repo.purgeDrawing(cid).then(() => undefined);
    }
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const tx = db.transaction(store, "readwrite");
      tx.objectStore(store).delete(cid);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    }));
  }
  function dropOutbox(entity, cid) {
    return TFoutbox.outboxByEntity(entity, cid).then((ops) =>
      ops.reduce((p, o) => p.then(() => TFoutbox.outboxRemove(o.qid)), Promise.resolve()));
  }

  // Konflik yang ditampilkan di conflict bar:
  //   conflict: "remote_deleted"  → pilihan discard / keep_as_new
  //   conflict: "access_lost"     → pilihan discard / keep_as_personal (S1: list_id null, dibuat ulang sebagai pribadi)
  //   conflict: "sync_error" (record.sync_error, 4xx permanen saat push) → pilihan retry / discard_local
  function listConflicts() {
    return Promise.all(ENTITIES.map((e) => getAll(STORE[e]))).then((rowsPerEntity) => {
      const out = [];
      const habitTitle = {}; for (const h of rowsPerEntity[ENTITIES.indexOf("habit")]) habitTitle[h.cid] = h.title;
      const taskTitle = {}; for (const t of rowsPerEntity[ENTITIES.indexOf("task")]) taskTitle[t.cid] = t.title;
      const titleOf = (entity, r) => {
        if (entity === "habit_log") return "Check-in " + (r.date || "") + (habitTitle[r.habit_cid] ? " — " + habitTitle[r.habit_cid] : "");
        if (entity === "recurring_exception") return "Occurrence " + (r.occurrence_date || "") + (taskTitle[r.task_cid] ? " — " + taskTitle[r.task_cid] : "");
        return r.title;
      };
      ENTITIES.forEach((entity, i) => {
        for (const r of rowsPerEntity[i]) {
          if (r.conflict && !CHILD[entity]) {
            out.push({ entity: entity, cid: r.cid, title: r.title, conflict: r.conflict, list_id: r.list_id != null ? r.list_id : null });
          } else if (r.sync_error && !r.deleted) {
            out.push({
              entity: entity, cid: r.cid, title: titleOf(entity, r), conflict: "sync_error",
              status: r.sync_error.status != null ? r.sync_error.status : null,
              detail: r.sync_error.detail != null ? r.sync_error.detail : "",
              at: r.sync_error.at != null ? r.sync_error.at : null,
              list_id: r.list_id != null ? r.list_id : null,
            });
          }
        }
      });
      return out;
    });
  }

  function drawingMeta(rec) {
    return { title: rec.title, svg_preview: rec.svg_preview || "", is_pinned: rec.is_pinned ? 1 : 0 };
  }
  // Antre op yang tepat untuk record: create bila belum punya server_id, else update.
  // Drawing memakai bentuk op yang dibaca syncpush (payload metadata; data dibaca dari blob saat push).
  function queueRetryOp(entity, rec) {
    if (entity === "habit_log") return TFoutbox.outboxAdd({ op: "checkin", entity_type: "habit_log", cid: rec.cid, payload: rec });
    if (entity === "recurring_exception") return TFoutbox.outboxAdd({ op: "mark_occurrence", entity_type: "recurring_exception", cid: rec.cid, payload: rec });
    if (entity === "drawing") {
      if (rec.server_id == null) {
        return TFoutbox.outboxAdd({ op: "create", entity_type: "drawing", cid: rec.cid, payload: drawingMeta(rec) });
      }
      const repo = drawingRepo();
      if (repo && typeof repo.ensureDrawingUpdateOp === "function") return repo.ensureDrawingUpdateOp(rec.cid, drawingMeta(rec));
      return TFoutbox.outboxAdd({ op: "update", entity_type: "drawing", cid: rec.cid, payload: drawingMeta(rec) });
    }
    return TFoutbox.outboxAdd({ op: rec.server_id == null ? "create" : "update", entity_type: entity, cid: rec.cid, payload: {} });
  }

  // Semua penulisan record memakai TFdb.mutate (prinsip 4): perubahan diterapkan ke record TERKINI, bukan ke
  // objek yang dibaca sebelum jeda async (pengguna bisa mengedit saat conflict bar ditekan).
  function patchRec(store, cid, fn) {
    return TFdb.mutate(store, cid, (cur) => (cur ? fn(Object.assign({}, cur), cur) : undefined));
  }

  function repoUid() {
    const r = drawingRepo();
    return (r && typeof r.currentUid === "function") ? r.currentUid() : null;
  }

  function resolveConflict(entity, cid, choice) {
    const store = STORE[entity];
    if (!store) return Promise.reject(new Error("unknown entity: " + entity));
    return getRaw(store, cid).then((rec) => {
      if (!rec) return { ok: false };
      if (choice === "retry") {
        // "Coba lagi": hapus sync_error, antre op lagi (record tetap dirty → dikirim pada push berikutnya)
        return dropOutbox(entity, cid)
          .then(() => patchRec(store, cid, (next) => { next.dirty = 1; delete next.sync_error; return next; }))
          .then((next) => (next ? queueRetryOp(entity, next) : null))
          .then(() => ({ ok: true }));
      }
      if (choice === "discard_local") {
        // "Buang perubahan lokal": ambil versi server. Belum pernah di-push (server_id null) → tidak ada versi server → hapus.
        // Entitas anak (log habit / occurrence) tidak punya server_id: hapus lokal → pull berikutnya memulihkan versi server bila ada.
        if (rec.server_id == null || CHILD[entity]) {
          return dropOutbox(entity, cid).then(() => deleteRaw(store, cid)).then(() => ({ ok: true }));
        }
        // base_rev null → pull berikutnya melihat revisi server "lebih baru" dan menimpa record ini.
        return dropOutbox(entity, cid)
          .then(() => patchRec(store, cid, (next) => { next.dirty = 0; next.base_rev = null; delete next.sync_error; return next; }))
          .then(() => ({ ok: true }));
      }
      const cleanup = dropOutbox(entity, cid)
        .then(() => (rec.server_id != null ? TFidmap.mapDelete(entity, rec.server_id) : null));
      if (choice === "discard") {
        return cleanup.then(() => deleteRaw(store, cid)).then(() => ({ ok: true }));
      }
      if (choice === "keep_as_new" || choice === "keep_as_personal") {
        // Dibuat ulang sebagai entitas baru: server_id dikosongkan, op create diantre. `client_id` SEGAR (T11):
        // cid tetap kunci lokal, tetapi payload create memakai client_id → server tidak mengembalikan baris
        // LAMA (yang terhapus / tidak bisa diakses) untuk salinan ini.
        const personal = (choice === "keep_as_personal" || rec.conflict === "access_lost");
        let oldBase = null;
        return cleanup
          .then(() => patchRec(store, cid, (next, cur) => {
            next.server_id = null;
            next.dirty = 1;
            next.rev = (cur.rev || 0) + 1;
            next.client_id = TFids.newCid();
            next.base_rev = null; // entitas baru: revisi server lama tidak berlaku (push create mengisi yang baru)
            delete next.conflict;
            delete next.sync_error;
            // S1 keep_as_personal (akses ke list hilang) / keep_as_new pada access_lost: simpan sebagai entitas
            // pribadi — list_id (dan list_cid task) dikosongkan.
            if (personal) {
              if ("list_id" in next || entity !== "drawing") next.list_id = null;
              if ("list_cid" in next || entity === "task") next.list_cid = null;
            }
            if (entity === "drawing") {
              oldBase = cur.base_blob_ref || null; next.base_blob_ref = null; next.base_title = null;
              // Salinan baru milik pengguna saat ini: jangan mewarisi pemilik/editor lama (guard pemilik offline).
              const me = repoUid();
              if (me != null) { next.user_id = me; next.last_edited_by = me; }
              delete next.last_editor_username; delete next.last_editor_display_name;
            }
            return next;
          }))
          .then((next) => {
            const repo = entity === "drawing" ? drawingRepo() : null;
            const relP = (repo && repo.releaseBlobs && oldBase) ? repo.releaseBlobs([oldBase], [next && next.blob_ref]) : Promise.resolve();
            return relP.then(() => (entity === "drawing"
              ? TFoutbox.outboxAdd({ op: "create", entity_type: "drawing", cid: cid, payload: drawingMeta(next || rec) })
              : TFoutbox.outboxAdd({ op: "create", entity_type: entity, cid: cid, payload: {} })));
          })
          .then(() => ({ ok: true }));
      }
      return Promise.reject(new Error("unknown choice: " + choice));
    });
  }

  // Notice (informasi, hanya tombol "Tutup"):
  //   kind "overwritten"   → edit lokal ditimpa versi server (LWW lama)
  //   kind "delete_refused"→ hapus ditolak server (hanya pemilik)
  //   kind "conflict_copy" → prinsip 7: edit lokal disimpan sebagai salinan "(konflik) <judul>" (copyTitle),
  //                          record asli mengadopsi versi server dari `editor`
  //   kind "merge_conflict"→ #4: merge per node; `count` node bentrok (topik ≤3 di `nodes`), versi lokal utuh
  //                          disimpan sebagai salinan copyTitle
  function listNotices() {
    return Promise.all([getAll("scratchpad_notes"), getAll("mindmaps")]).then(([notes, mindmaps]) => {
      const out = [];
      const add = (entity, rows) => {
        for (const r of rows) {
          if (!r.notice) continue;
          out.push({
            entity: entity, cid: r.cid, kind: r.notice.kind, title: r.notice.title,
            editor: r.notice.editor != null ? r.notice.editor : null,
            copyTitle: r.notice.copyTitle != null ? r.notice.copyTitle : null,
            count: r.notice.count != null ? r.notice.count : null,
            nodes: Array.isArray(r.notice.nodes) ? r.notice.nodes : null,
          });
        }
      };
      add("note", notes); add("mindmap", mindmaps);
      return out;
    });
  }

  function dismissNotice(entity, cid) {
    const store = STORE[entity];
    if (!store) return Promise.reject(new Error("unknown entity: " + entity));
    // prinsip 4: hapus notice pada record TERKINI (pengguna bisa sedang mengedit note itu)
    return patchRec(store, cid, (next) => { delete next.notice; return next; })
      .then((next) => ({ ok: !!next }));
  }

  const exported = { listConflicts, resolveConflict, listNotices, dismissNotice };
  if (root && typeof root === "object") { root.TF = root.TF || {}; root.TF.syncconflict = exported; }
  return exported;
});
