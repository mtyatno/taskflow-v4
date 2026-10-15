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
  const TFtag = req("./tagrepo.js", root.TF && root.TF.tagrepo);
  const TFlogic = req("./notelogic.js", root.TF && root.TF.notelogic);

  let _currentUser = null;
  function setCurrentUser(u) { _currentUser = u; }
  function getCurrentUser() { return _currentUser; }
  function curUid() { return (_currentUser && _currentUser.user_id != null) ? _currentUser.user_id : null; }

  function getAll(store) {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const r = db.transaction(store, "readonly").objectStore(store).getAll();
      r.onsuccess = () => resolve(r.result || []);
      r.onerror = () => reject(r.error);
    }));
  }
  function getNoteRaw(cid) {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const r = db.transaction("scratchpad_notes", "readonly").objectStore("scratchpad_notes").get(cid);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    }));
  }
  function putNote(rec) {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const tx = db.transaction("scratchpad_notes", "readwrite");
      tx.objectStore("scratchpad_notes").put(rec);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    }));
  }
  // Record mentah dari id tampilan (server id) ATAU cid — dipakai editor (NoteModal) yang hanya tahu `note.id`.
  function findNoteRaw(idOrCid) {
    if (idOrCid == null) return Promise.resolve(null);
    return getNoteRaw(String(idOrCid)).then((rec) => {
      if (rec) return rec;
      return getAll("scratchpad_notes").then((all) =>
        all.find((n) => n.server_id != null && String(n.server_id) === String(idOrCid)) || null);
    });
  }
  // Event ke UI (hanya di browser): outbox terisi di luar mutasi API → jadwalkan push; daftar note berubah.
  function emitWindowEvent(name, detail) {
    try {
      const w = (typeof window !== "undefined") ? window : null;
      if (w && typeof w.dispatchEvent === "function" && typeof CustomEvent === "function") {
        w.dispatchEvent(new CustomEvent(name, { detail: detail || {} }));
      }
    } catch (_) {}
  }

  // T4: op `update` tertunda per cid DIGABUNG — satu transaksi _outbox: op update lama untuk cid itu dihapus,
  // satu op baru ditambah. Aman karena push membaca record TERKINI (bukan payload op) dan memakai CAS rev
  // (prinsip 4); tiap burst ketikan tidak lagi menumpuk op (dan PUT) baru.
  function coalesceUpdateOp(cid, payload) {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      let qid = null;
      const tx = db.transaction("_outbox", "readwrite");
      const os = tx.objectStore("_outbox");
      const r = os.getAll();
      r.onsuccess = () => {
        for (const o of (r.result || [])) {
          if (o.entity_type === "note" && o.cid === cid && o.op === "update") os.delete(o.qid);
        }
        const addReq = os.add({ ts: Date.now(), retries: 0, op: "update", entity_type: "note", cid: cid, payload: payload || {} });
        addReq.onsuccess = () => { qid = addReq.result; };
      };
      r.onerror = () => reject(r.error);
      tx.oncomplete = () => resolve(qid);
      tx.onerror = () => reject(tx.error);
    }));
  }

  // Resolve [[Title]] -> local note cids (case-insensitive, non-deleted, first match).
  function resolveLinkedTo(content) {
    const titles = TFlogic.parseWikilinks(content);
    if (!titles.length) return Promise.resolve([]);
    return getAll("scratchpad_notes").then((notes) => {
      const byTitle = {};
      for (const n of notes) {
        if (n.deleted) continue;
        const key = String(n.title || "").trim().toLowerCase();
        if (key && !(key in byTitle)) byTitle[key] = n.cid;
      }
      const out = [];
      for (const t of titles) {
        const cid = byTitle[t.trim().toLowerCase()];
        if (cid && out.indexOf(cid) === -1) out.push(cid);
      }
      return out;
    });
  }

  // Resolve frontend task ids (cid or server_id) -> task cids.
  function resolveLinkedTasks(ids) {
    const list = (ids || []).filter((x) => x != null);
    if (!list.length) return Promise.resolve([]);
    return getAll("tasks").then((tasks) => {
      const byCid = {}; const bySid = {};
      for (const t of tasks) { byCid[t.cid] = t.cid; if (t.server_id != null) bySid[String(t.server_id)] = t.cid; }
      const out = [];
      for (const id of list) {
        const cid = byCid[id] || bySid[String(id)];
        if (cid && out.indexOf(cid) === -1) out.push(cid);
      }
      return out;
    });
  }

  function createNote(input, opts) {
    const now = (opts && opts.now) || new Date().toISOString();
    const taskIds = (input.linked_task_ids || []).concat(input.linked_task_id != null ? [input.linked_task_id] : []);
    return Promise.all([resolveLinkedTo(input.content || ""), resolveLinkedTasks(taskIds)]).then(([toCids, taskCids]) => {
      const rec = {
        cid: TFids.newCid(), server_id: null,
        title: input.title != null ? input.title : "",
        content: input.content != null ? input.content : "",
        linked_task_cids: JSON.stringify(taskCids),
        linked_to_cids: JSON.stringify(toCids),
        pinned: false,
        meta_json: input.meta_json != null ? input.meta_json : '{}',
        list_id: input.list_id != null ? input.list_id : null,
        user_id: curUid(),
        last_edited_by: curUid(),
        last_editor_username: null, last_editor_display_name: null,
        created_at: now, updated_at: now, deleted: false, dirty: 1, base_rev: null,
        rev: 1, // penghitung versi lokal — CAS push (prinsip 4)
      };
      return putNote(rec)
        .then(() => TFoutbox.outboxAdd({ op: "create", entity_type: "note", cid: rec.cid, payload: rec }))
        .then(() => TFtag.setEntityTags("note", rec.cid, input.tags || []))
        .then(() => rec);
    });
  }

  function updateNote(cid, patch, opts) {
    const now = (opts && opts.now) || new Date().toISOString();
    return getNoteRaw(cid).then((rec) => {
      if (!rec || rec.deleted) return Promise.reject(new Error("Note not found"));
      const content = patch.content != null ? patch.content : rec.content;
      const taskIds = (patch.linked_task_ids || []).concat(patch.linked_task_id != null ? [patch.linked_task_id] : []);
      return Promise.all([resolveLinkedTo(content), resolveLinkedTasks(taskIds)]).then(([toCids, taskCids]) => {
        const next = Object.assign({}, rec, {
          title: patch.title != null ? patch.title : rec.title,
          meta_json: patch.meta_json !== undefined ? patch.meta_json : (rec.meta_json || '{}'),
          content: content,
          linked_to_cids: JSON.stringify(toCids),
          linked_task_cids: JSON.stringify(taskCids),
          last_edited_by: curUid(),
          last_editor_username: null, last_editor_display_name: null, // I edited it now — clear stale "edited by X"
          updated_at: now, dirty: 1, rev: (rec.rev || 0) + 1,
        });
        return putNote(next)
          .then(() => coalesceUpdateOp(cid, next))
          .then(() => (patch.tags != null ? TFtag.setEntityTags("note", cid, patch.tags) : null))
          .then(() => next);
      });
    });
  }

  // K4 klien: setelah PATCH /share sukses, record lokal mengadopsi list_id + updated_at → base_rev dari baris
  // server (share mem-bump updated_at). Tanpa ini pull tidak mengadopsi list_id (updated_at sama) dan PUT
  // berikutnya dengan base_rev lama ditolak 409. Hanya field itu yang disentuh (isi lokal/dirty tetap); rev naik.
  function adoptServerFields(idOrCid, row) {
    if (!row || typeof row !== "object") return Promise.resolve(null);
    return findNoteRaw(idOrCid).then((rec) => {
      if (!rec) return null;
      return TFdb.mutate("scratchpad_notes", rec.cid, (cur) => {
        if (!cur) return undefined;
        const next = Object.assign({}, cur, { rev: (cur.rev || 0) + 1 });
        if ("list_id" in row) next.list_id = row.list_id != null ? row.list_id : null;
        if (row.updated_at != null) { next.updated_at = row.updated_at; next.base_rev = row.updated_at; }
        if (next.server_id == null && row.id != null) next.server_id = row.id;
        return next;
      });
    });
  }

  // Pemetaan baris server → field record lokal (dipakai pull & adopsi 409 edit-vs-edit). linked_to (server id
  // note) → cid lewat noteCidCache (sid → cid yang sudah dipetakan pull) atau idmap; linked_task_ids → cid task
  // lewat idmap. Tidak menyentuh cid/server_id/dirty/base_rev/rev — pemanggil yang menentukan.
  function fieldsFromServer(s, noteCidCache) {
    const toP = (s.linked_to || []).reduce((p, sid) => p.then((acc) => {
      const cached = noteCidCache && noteCidCache[sid];
      return (cached ? Promise.resolve(cached) : TFidmap.cidOf("note", sid)).then((c) => { if (c && acc.indexOf(c) === -1) acc.push(c); return acc; });
    }), Promise.resolve([]));
    const taskP = (s.linked_task_ids || []).reduce((p, tid) => p.then((acc) =>
      TFidmap.cidOf("task", tid).then((c) => { if (c && acc.indexOf(c) === -1) acc.push(c); return acc; })), Promise.resolve([]));
    return Promise.all([toP, taskP]).then(([toCids, taskCids]) => ({
      title: s.title != null ? s.title : "", content: s.content != null ? s.content : "",
      linked_to_cids: JSON.stringify(toCids), linked_task_cids: JSON.stringify(taskCids),
      pinned: !!s.pinned,
      meta_json: s.meta_json != null ? s.meta_json : '{}',
      list_id: s.list_id != null ? s.list_id : null,
      user_id: s.user_id != null ? s.user_id : null,
      last_edited_by: s.last_edited_by != null ? s.last_edited_by : null,
      last_editor_username: s.last_editor_username != null ? s.last_editor_username : null,
      last_editor_display_name: s.last_editor_display_name != null ? s.last_editor_display_name : null,
      created_at: s.created_at != null ? s.created_at : null, updated_at: s.updated_at != null ? s.updated_at : null,
    }));
  }

  const CONFLICT_PREFIX = "(konflik) ";
  function conflictTitle(title) {
    const t = String(title == null ? "" : title);
    return t.indexOf(CONFLICT_PREFIX) === 0 ? t : CONFLICT_PREFIX + t;
  }
  // Record salinan konflik dari `src`: note PRIBADI baru (cid baru = client_id segar, list_id null, server_id
  // null, dirty 1, rev 1) berisi judul/isi/tautan/meta `src` apa adanya; judul diberi awalan "(konflik) ".
  function buildConflictCopy(src, now) {
    const uid = curUid();
    return {
      cid: TFids.newCid(), server_id: null,
      title: conflictTitle(src.title),
      content: src.content != null ? src.content : "",
      linked_task_cids: src.linked_task_cids || "[]",
      linked_to_cids: src.linked_to_cids || "[]",
      pinned: false,
      meta_json: src.meta_json != null ? src.meta_json : '{}',
      list_id: null,
      user_id: uid != null ? uid : (src.user_id != null ? src.user_id : null),
      last_edited_by: uid != null ? uid : null,
      last_editor_username: null, last_editor_display_name: null,
      created_at: now, updated_at: now, deleted: false, dirty: 1, base_rev: null, rev: 1,
      conflict_of: src.cid, // jejak asal (informasi saja)
    };
  }
  function copyTags(fromCid, toCid) {
    return TFtag.getEntityTags("note", fromCid).then((ts) => TFtag.setEntityTags("note", toCid, ts.map((t) => t.name)));
  }

  // Prinsip 7 (salinan konflik): versi LOKAL note `idOrCid` saat ini disalin menjadi note pribadi baru
  // "(konflik) <judul>" + op create (record asli tidak diubah). Dipakai "Simpan versi saya" / flush saat modal
  // ditutup: versi lain yang sudah masuk ke record lokal diselamatkan, lalu editor menulis versinya ke record asli.
  function makeConflictCopy(idOrCid, opts) {
    const now = (opts && opts.now) || new Date().toISOString();
    return findNoteRaw(idOrCid).then((rec) => {
      if (!rec || rec.deleted) return null;
      const copy = buildConflictCopy(rec, now);
      return putNote(copy)
        .then(() => TFoutbox.outboxAdd({ op: "create", entity_type: "note", cid: copy.cid, payload: copy }))
        .then(() => copyTags(rec.cid, copy.cid))
        .then(() => { emitWindowEvent("tf:outbox-queued", { entity: "note", cid: copy.cid }); return copy; });
    });
  }

  // Prinsip 7 untuk edit-vs-edit (push 409 REV_MISMATCH & pull dengan op tertunda): sisi lokal yang kalah
  // TIDAK dibuang. Satu transaksi (scratchpad_notes + _outbox):
  //   1. versi lokal record `cid` disalin ke note pribadi baru "(konflik) <judul>" (cid/client_id baru) + op create;
  //   2. record asli mengadopsi baris server `srv` (dirty 0, base_rev = srv.updated_at, rev naik, conflict/
  //      sync_error dihapus) + notice {kind:"conflict_copy", title, copyTitle, editor} untuk conflict bar;
  //   3. op create/update tertunda milik record asli dibuang (isinya sudah ada di salinan).
  // Tag: salinan memakai tag lokal, record asli memakai tag server. Field server dihitung SEBELUM transaksi
  // (idmap async); record dibaca di dalam transaksi → ketikan di sela-sela tidak hilang (masuk ke salinan).
  // Mengembalikan {copy, original} atau null (record tidak ada / sudah dihapus).
  function keepLocalAsConflictCopy(cid, srv, opts) {
    const o = opts || {};
    const now = o.now || new Date().toISOString();
    const editor = o.editor != null ? o.editor : (srv.last_editor_display_name || srv.last_editor_username || null);
    return Promise.all([fieldsFromServer(srv, o.noteCidCache), TFtag.getEntityTags("note", cid)]).then(([fields, localTags]) => {
      return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
        let out = null;
        const tx = db.transaction(["scratchpad_notes", "_outbox"], "readwrite");
        const notes = tx.objectStore("scratchpad_notes");
        const ob = tx.objectStore("_outbox");
        const r = notes.get(cid);
        r.onsuccess = () => {
          const cur = r.result;
          if (!cur || cur.deleted) return;
          // Isi lokal sama dengan versi server (mis. PUT kita sendiri diterima server tapi responsnya hilang →
          // base_rev tertinggal): bukan konflik → adopsi server (base_rev maju, op dibuang) TANPA salinan.
          const sameContent = (cur.title || "") === (fields.title || "")
            && (cur.content || "") === (fields.content || "")
            && (cur.meta_json || "{}") === (fields.meta_json || "{}");
          const copy = sameContent ? null : buildConflictCopy(cur, now);
          if (copy) {
            notes.put(copy);
            ob.add({ ts: Date.now(), retries: 0, op: "create", entity_type: "note", cid: copy.cid, payload: copy });
          }
          const original = Object.assign({}, cur, fields, {
            server_id: cur.server_id != null ? cur.server_id : (srv.id != null ? srv.id : null),
            deleted: false, dirty: 0,
            base_rev: srv.updated_at != null ? srv.updated_at : null,
            rev: (cur.rev || 0) + 1,
          });
          if (copy) original.notice = { kind: "conflict_copy", title: fields.title, copyTitle: copy.title, editor: editor };
          delete original.conflict;
          delete original.sync_error;
          notes.put(original);
          const ops = ob.getAll();
          ops.onsuccess = () => {
            for (const op of (ops.result || [])) {
              if (op.entity_type === "note" && op.cid === cid && (op.op === "create" || op.op === "update")) ob.delete(op.qid);
            }
          };
          out = { copy: copy, original: original };
        };
        r.onerror = () => reject(r.error);
        tx.oncomplete = () => resolve(out);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error || new Error("conflict copy aborted"));
      })).then((res) => {
        if (!res) return null;
        if (!res.copy) return TFtag.setEntityTags("note", cid, srv.tags || []).then(() => res);
        return TFtag.setEntityTags("note", res.copy.cid, localTags.map((t) => t.name))
          .then(() => TFtag.setEntityTags("note", cid, srv.tags || []))
          .then(() => { emitWindowEvent("tf:outbox-queued", { entity: "note", cid: res.copy.cid }); return res; });
      });
    });
  }

  // S15: setelah create task sukses (cid → server id), ganti [tasklink:<cid>] → [tasklink:<sid>] di semua note
  // lokal yang memuatnya (termasuk bentuk ter-escape \[tasklink:…\]). Note ditandai dirty + rev naik + op update
  // (digabung) supaya versi dengan id server terkirim; updated_at TIDAK diubah (bukan editan pengguna — editor
  // yang terbuka mendeteksi "diubah di tempat lain" lewat updated_at). Mengembalikan daftar cid note yang diubah;
  // event "tf:note-tasklinks-rewritten" {task_cid, task_id, cids} untuk editor yang sedang terbuka.
  function tasklinkRegex(id) {
    const esc = String(id).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp("(\\\\?\\[tasklink:)" + esc + "(\\\\?\\])", "g");
  }
  function rewriteTaskLinks(taskCid, taskSid) {
    if (!taskCid || taskSid == null) return Promise.resolve([]);
    // regex (bukan indexOf): "tasklink:abc" juga awalan dari "tasklink:abc-2" → hanya tautan utuh yang cocok
    const hasLink = (c) => typeof c === "string" && tasklinkRegex(taskCid).test(c);
    return getAll("scratchpad_notes").then((all) => {
      const targets = all.filter((n) => !n.deleted && hasLink(n.content));
      const done = [];
      return targets.reduce((p, n) => p.then(() =>
        TFdb.mutate("scratchpad_notes", n.cid, (cur) => {
          if (!cur || cur.deleted || !hasLink(cur.content)) return undefined;
          return Object.assign({}, cur, {
            content: cur.content.replace(tasklinkRegex(taskCid), "$1" + taskSid + "$2"),
            dirty: 1, rev: (cur.rev || 0) + 1,
          });
        }).then((next) => (next ? coalesceUpdateOp(n.cid, next).then(() => { done.push(n.cid); }) : null))
      ), Promise.resolve()).then(() => {
        if (done.length) {
          emitWindowEvent("tf:note-tasklinks-rewritten", { task_cid: taskCid, task_id: taskSid, cids: done.slice() });
          emitWindowEvent("tf:outbox-queued", { entity: "note", cids: done.slice() });
        }
        return done;
      });
    });
  }

  function deleteNote(cid, opts) {
    return getNoteRaw(cid).then((rec) => {
      if (!rec || rec.deleted) return Promise.reject(new Error("Note not found"));
      const next = Object.assign({}, rec, { deleted: true, dirty: 1, rev: (rec.rev || 0) + 1 });
      return putNote(next)
        .then(() => TFoutbox.outboxAdd({ op: "delete", entity_type: "note", cid: cid, payload: { cid: cid } }))
        .then(() => ({ ok: true }));
    });
  }

  // Setelah note berhasil dipulihkan dari Sampah (POST /api/scratchpad/trash/{id}/restore): buang op `delete`
  // yang masih tertunda untuk note itu (mis. DELETE sudah commit di server tapi responsnya hilang), beserta op
  // lain miliknya — note itu sudah dihapus user, isi yang dipulihkan = snapshot server. Rekaman lokal
  // `deleted:true` & idmap sengaja DIPERTAHANKAN: tanpa op tertunda, pull membuatnya ulang dengan cid yang sama
  // sehingga linked_to_cids note lain tetap valid. Tanpa op delete tertunda → tidak mengubah apa pun.
  function discardPendingDelete(serverId) {
    return TFidmap.cidOf("note", serverId).then((cid) => {
      if (!cid) return { dropped: 0 };
      return TFoutbox.outboxByEntity("note", cid).then((ops) => {
        if (!ops.some((o) => o.op === "delete")) return { dropped: 0 };
        return ops.reduce((p, o) => p.then(() => TFoutbox.outboxRemove(o.qid)), Promise.resolve())
          .then(() => ({ dropped: ops.length }));
      });
    });
  }

  function togglePin(cid, opts) {
    return getNoteRaw(cid).then((rec) => {
      if (!rec || rec.deleted) return Promise.reject(new Error("Note not found"));
      const next = Object.assign({}, rec, { pinned: !rec.pinned, rev: (rec.rev || 0) + 1 });
      return putNote(next)
        .then(() => TFoutbox.outboxAdd({ op: "pin", entity_type: "note", cid: cid, payload: { pinned: next.pinned } }))
        .then(() => next);
    });
  }

  const exported = {
    createNote, updateNote, deleteNote, discardPendingDelete, togglePin, getNoteRaw, findNoteRaw, putNote,
    resolveLinkedTo, resolveLinkedTasks, setCurrentUser, getCurrentUser,
    // audit 2026-10-15 workstream C: K4 klien, prinsip 7 (salinan konflik), S15, T4 (op update digabung)
    adoptServerFields, fieldsFromServer, makeConflictCopy, keepLocalAsConflictCopy, rewriteTaskLinks, coalesceUpdateOp, conflictTitle,
  };
  if (root && typeof root === "object") { root.TF = root.TF || {}; root.TF.noterepo = exported; }
  return exported;
});
