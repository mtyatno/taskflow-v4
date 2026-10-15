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

  let _currentUser = null;
  function setCurrentUser(u) { _currentUser = u; }
  function getCurrentUser() { return _currentUser; }
  function curUid() { return (_currentUser && _currentUser.user_id != null) ? _currentUser.user_id : null; }

  const DEFAULT_DATA = '{"nodeData":{"id":"root","topic":"Untitled","root":true,"children":[]}}';
  const CONFLICT_PREFIX = "(konflik) ";

  function getRaw(cid) {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const r = db.transaction("mindmaps", "readonly").objectStore("mindmaps").get(cid);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    }));
  }
  function putRaw(rec) {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const tx = db.transaction("mindmaps", "readwrite");
      tx.objectStore("mindmaps").put(rec);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    }));
  }
  // Remove any pending 'update' ops for this cid (autosave fires frequently; keep outbox lean).
  // Aman dengan CAS rev (K5): push membaca record terkini saat mengirim, bukan payload op.
  function dedupeUpdates(cid) {
    return TFoutbox.outboxByEntity("mindmap", cid).then((ops) =>
      ops.filter((o) => o.op === "update").reduce((p, o) => p.then(() => TFoutbox.outboxRemove(o.qid)), Promise.resolve()));
  }

  // Baris server → bentuk record lokal (bersih, base_rev = updated_at server). Dipakai pull & adopsi 409.
  function recordFromServer(s, cid) {
    return {
      cid: cid, server_id: s.id,
      title: s.title != null ? s.title : "Untitled",
      data_json: s.data_json != null ? s.data_json : DEFAULT_DATA,
      pinned: !!s.is_pinned,
      list_id: s.list_id != null ? s.list_id : null,
      user_id: s.user_id != null ? s.user_id : null,
      last_edited_by: s.last_edited_by != null ? s.last_edited_by : null,
      last_editor_username: s.last_editor_username != null ? s.last_editor_username : null,
      last_editor_display_name: s.last_editor_display_name != null ? s.last_editor_display_name : null,
      created_at: s.created_at != null ? s.created_at : null,
      updated_at: s.updated_at != null ? s.updated_at : null,
      deleted: false, dirty: 0, base_rev: s.updated_at != null ? s.updated_at : null,
    };
  }
  function editorOf(s) {
    return (s && (s.last_editor_display_name || s.last_editor_username)) || "Pengguna lain";
  }

  // Record `rev` (prinsip 4 audit 2026-10-15): naik di SETIAP tulis lokal (create 1; update/pin/delete +1).
  // Push membaca sentRev sebelum request; setelah sukses markPushed hanya menandai bersih bila rev tidak berubah.
  function createMindmap(input, opts) {
    const now = (opts && opts.now) || new Date().toISOString();
    const rec = {
      cid: TFids.newCid(), server_id: null,
      title: input.title != null ? input.title : "Untitled",
      data_json: input.data_json != null ? input.data_json : DEFAULT_DATA,
      pinned: false,
      list_id: input.list_id != null ? input.list_id : null,
      user_id: curUid(),
      last_edited_by: curUid(),
      last_editor_username: null, last_editor_display_name: null,
      created_at: now, updated_at: now, deleted: false, dirty: 1, base_rev: null, rev: 1,
    };
    return putRaw(rec)
      .then(() => TFoutbox.outboxAdd({ op: "create", entity_type: "mindmap", cid: rec.cid, payload: { cid: rec.cid } }))
      .then(() => rec);
  }

  // Salinan konflik (prinsip 7): versi LOKAL yang kalah disimpan sebagai peta pribadi baru
  // "(konflik) <judul>" dengan cid (= client_id) baru, dirty + op create. Tidak ada yang dibuang.
  function conflictCopyOf(cur, localTitle, localData, now) {
    const cid = TFids.newCid();
    const baseTitle = localTitle != null ? localTitle : (cur.title != null ? cur.title : "Untitled");
    return {
      cid: cid, server_id: null, client_id: cid,
      title: (String(baseTitle).indexOf(CONFLICT_PREFIX) === 0 ? "" : CONFLICT_PREFIX) + baseTitle,
      data_json: localData != null ? localData : (cur.data_json != null ? cur.data_json : DEFAULT_DATA),
      pinned: false, list_id: null,
      user_id: curUid() != null ? curUid() : (cur.user_id != null ? cur.user_id : null),
      last_edited_by: curUid(),
      last_editor_username: null, last_editor_display_name: null,
      created_at: now, updated_at: now, deleted: false, dirty: 1, base_rev: null, rev: 1,
    };
  }
  function sameServerContent(cur, s) {
    const sData = s.data_json != null ? s.data_json : DEFAULT_DATA;
    const sTitle = s.title != null ? s.title : "Untitled";
    return String(cur.data_json) === String(sData) && String(cur.title) === String(sTitle);
  }

  // Adopsi baris server ke record asli + (bila isi lokal berbeda) buat salinan konflik — SATU transaksi
  // (mindmaps + _outbox): tidak pernah menulis objek basi, tidak ada jendela di mana edit lokal hilang.
  //   opts.expectRev  → CAS: batal (resolve null) bila rev record berubah sejak dibaca pemanggil.
  //   opts.now        → timestamp salinan.
  // Op create/update milik record asli dibuang (versi lokal kini hidup di salinan); op create salinan diantre.
  // Resolve { original, copy } (copy null bila isi lokal sama dengan server → cukup adopsi) atau null.
  function adoptServerWithConflictCopy(cid, serverRow, opts) {
    opts = opts || {};
    const now = opts.now || new Date().toISOString();
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      let out = null;
      let failed = null;
      let tx;
      try { tx = db.transaction(["mindmaps", "_outbox"], "readwrite"); } catch (err) { reject(err); return; }
      const ms = tx.objectStore("mindmaps");
      const ob = tx.objectStore("_outbox");
      const r = ms.get(cid);
      r.onsuccess = () => {
        const cur = r.result;
        if (!cur) return;
        if (opts.expectRev != null && (cur.rev || 0) !== opts.expectRev) return;
        const needCopy = !!cur.dirty && !cur.deleted && !sameServerContent(cur, serverRow);
        const copy = needCopy ? conflictCopyOf(cur, cur.title, cur.data_json, now) : null;
        const original = Object.assign(recordFromServer(serverRow, cid), {
          rev: (cur.rev || 0) + 1,
          pinned: !!cur.pinned, // pin lokal dipertahankan (op pin bisa tertunda); pull yang mengadopsi pin server
        });
        if (cur.client_id != null) original.client_id = cur.client_id;
        if (copy) {
          original.notice = { kind: "conflict_copy", title: cur.title, copyTitle: copy.title, editor: editorOf(serverRow) };
        } else if (cur.notice) {
          original.notice = cur.notice;
        }
        ms.put(original);
        if (copy) ms.put(copy);
        const all = ob.getAll();
        all.onsuccess = () => {
          for (const op of (all.result || [])) {
            if (op.entity_type === "mindmap" && op.cid === cid && (op.op === "create" || op.op === "update")) ob.delete(op.qid);
          }
          if (copy) ob.add({ ts: Date.now(), retries: 0, op: "create", entity_type: "mindmap", cid: copy.cid, payload: { cid: copy.cid } });
          out = { original, copy };
        };
        all.onerror = () => { failed = all.error; };
      };
      r.onerror = () => { failed = r.error; };
      tx.oncomplete = () => resolve(out);
      tx.onerror = () => reject(failed || tx.error);
      tx.onabort = () => reject(failed || tx.error || new Error("mindmaps adopt aborted"));
    }));
  }

  // Simpan edit lokal lewat TFdb.mutate (atomik). patch.if_updated_at (opsional, dari tab editor): updated_at
  // record saat tab memuat/menyimpan terakhir; bila record sudah diganti pull/adopsi (updated_at beda) →
  // JANGAN timpa versi server: edit tab disimpan sebagai salinan konflik, record asli tetap versi server dan
  // diberi notice. Resolve record asli dengan `conflict_copy` = record salinan (tab memuat ulang versi server).
  function updateMindmap(cid, patch, opts) {
    patch = patch || {};
    const now = (opts && opts.now) || new Date().toISOString();
    let stale = null;
    return TFdb.mutate("mindmaps", cid, (cur) => {
      if (!cur || cur.deleted) return undefined;
      if (patch.if_updated_at != null && String(cur.updated_at) !== String(patch.if_updated_at)) { stale = cur; return undefined; }
      return Object.assign({}, cur, {
        title: patch.title != null ? patch.title : cur.title,
        data_json: patch.data_json != null ? patch.data_json : cur.data_json,
        last_edited_by: curUid(),
        last_editor_username: null, last_editor_display_name: null,
        updated_at: now, dirty: 1, rev: (cur.rev || 0) + 1,
      });
    }).then((next) => {
      if (next) {
        return dedupeUpdates(cid)
          .then(() => TFoutbox.outboxAdd({ op: "update", entity_type: "mindmap", cid: cid, payload: { cid: cid } }))
          .then(() => next);
      }
      if (!stale) return Promise.reject(new Error("Mindmap not found"));
      return saveAsConflictCopy(cid, stale, patch, now);
    });
  }
  // Edit tab yang basis-nya sudah diganti → salinan konflik (satu transaksi mindmaps + _outbox).
  function saveAsConflictCopy(cid, stale, patch, now) {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      let out = null;
      const tx = db.transaction(["mindmaps", "_outbox"], "readwrite");
      const ms = tx.objectStore("mindmaps");
      const r = ms.get(cid);
      r.onsuccess = () => {
        const cur = r.result;
        if (!cur || cur.deleted) return;
        const copy = conflictCopyOf(cur, patch.title != null ? patch.title : stale.title, patch.data_json != null ? patch.data_json : stale.data_json, now);
        const original = Object.assign({}, cur, {
          notice: { kind: "conflict_copy", title: cur.title, copyTitle: copy.title, editor: editorOf(cur) },
        });
        ms.put(original);
        ms.put(copy);
        tx.objectStore("_outbox").add({ ts: Date.now(), retries: 0, op: "create", entity_type: "mindmap", cid: copy.cid, payload: { cid: copy.cid } });
        out = Object.assign({}, original, { conflict_copy: copy });
      };
      tx.oncomplete = () => (out ? resolve(out) : reject(new Error("Mindmap not found")));
      tx.onerror = () => reject(tx.error);
    }));
  }

  function deleteMindmap(cid) {
    return TFdb.mutate("mindmaps", cid, (cur) => {
      if (!cur || cur.deleted) return undefined;
      return Object.assign({}, cur, { deleted: true, dirty: 1, rev: (cur.rev || 0) + 1 });
    }).then((next) => {
      if (!next) return Promise.reject(new Error("Mindmap not found"));
      return TFoutbox.outboxAdd({ op: "delete", entity_type: "mindmap", cid: cid, payload: { cid: cid } })
        .then(() => ({ ok: true }));
    });
  }

  function togglePin(cid) {
    return TFdb.mutate("mindmaps", cid, (cur) => {
      if (!cur || cur.deleted) return undefined;
      return Object.assign({}, cur, { pinned: !cur.pinned, rev: (cur.rev || 0) + 1 }); // NOT dirty — pin orthogonal to LWW
    }).then((next) => {
      if (!next) return Promise.reject(new Error("Mindmap not found"));
      return TFoutbox.outboxAdd({ op: "pin", entity_type: "mindmap", cid: cid, payload: { pinned: next.pinned } })
        .then(() => next);
    });
  }

  const exported = {
    createMindmap, updateMindmap, deleteMindmap, togglePin, getRaw, putRaw, setCurrentUser, getCurrentUser,
    recordFromServer, adoptServerWithConflictCopy, CONFLICT_PREFIX, DEFAULT_DATA,
  };
  if (root && typeof root === "object") { root.TF = root.TF || {}; root.TF.mindmaprepo = exported; }
  return exported;
});
