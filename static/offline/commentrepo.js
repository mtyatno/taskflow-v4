;(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory(root);
  } else {
    root.TF = root.TF || {};
    factory(root);
  }
})(typeof self !== "undefined" ? self : globalThis, function (root) {
  "use strict";

  // Komentar note offline (PR 2). Record lokal = field server + cid/server_id/note_cid/parent_cid/pending/
  // sync_error/server_copy. Perubahan lokal dilebur per cid (satu op per jenis); push membaca record.
  const isNode = (typeof module !== "undefined" && module.exports);
  const req = (m, g) => (isNode ? require(m) : g);
  const TFdb = req("./db.js", root.TF && root.TF.db);
  const TFids = req("./ids.js", root.TF && root.TF.ids);
  const TFoutbox = req("./outbox.js", root.TF && root.TF.outbox);
  const TFidmap = req("./idmap.js", root.TF && root.TF.idmap);
  const TFmeta = req("./meta.js", root.TF && root.TF.meta);
  const TFchat = req("./chatrepo.js", root.TF && root.TF.chatrepo);

  const STORE = "note_comments";
  const CURSOR_KEY = "comments_cursor";
  const READS_KEY = "comment_reads";
  const SERVER_FIELDS = ["note_id", "list_id", "parent_id", "user_id", "username", "display_name", "body", "quote",
    "resolved_at", "resolved_by", "resolved_by_name", "edited_at", "deleted_at", "client_id", "created_at", "updated_at"];

  const nowIso = () => new Date().toISOString();
  const ts = (s) => { const t = s ? Date.parse(s) : NaN; return isNaN(t) ? 0 : t; };
  const isReply = (r) => r.parent_cid != null || r.parent_id != null;
  function fail(status, msg, code) {
    return Object.assign(new Error(msg), code ? { status, code } : { status });
  }
  function user() {
    return (TFchat && TFchat.getCurrentUser && TFchat.getCurrentUser()) || {};
  }

  // --- raw IndexedDB helpers (dipakai ulang oleh push/pull) ---
  function storeOp(store, mode, fn) {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const tx = db.transaction(store, mode);
      let out;
      const r = fn(tx.objectStore(store));
      if (r) r.onsuccess = () => { out = r.result; };
      tx.oncomplete = () => resolve(out);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error("aborted"));
    }));
  }
  const getRaw = (cid) => storeOp(STORE, "readonly", (os) => os.get(cid));
  const getAll = () => storeOp(STORE, "readonly", (os) => os.getAll()).then((r) => r || []);
  const putRaw = (rec) => storeOp(STORE, "readwrite", (os) => { os.put(rec); });
  const deleteRaw = (cid) => storeOp(STORE, "readwrite", (os) => { os.delete(cid); });
  const getNote = (cid) => storeOp("scratchpad_notes", "readonly", (os) => os.get(cid));
  const getNotes = () => storeOp("scratchpad_notes", "readonly", (os) => os.getAll()).then((r) => r || []);

  function removeOps(cid, kinds) {
    return TFoutbox.outboxAll().then((ops) => ops
      .filter((o) => o.entity_type === "comment" && o.cid === cid && (!kinds || kinds.indexOf(o.op) >= 0))
      .reduce((p, o) => p.then(() => TFoutbox.outboxRemove(o.qid)), Promise.resolve()));
  }
  function addOpOnce(entityType, op, cid) {
    return TFoutbox.outboxAll().then((ops) => {
      if (ops.some((o) => o.entity_type === entityType && o.op === op && o.cid === cid)) return false;
      return TFoutbox.outboxAdd({ entity_type: entityType, op: op, cid: cid }).then(() => true);
    });
  }
  function readsGet() { return TFmeta.metaGet(READS_KEY).then((v) => (v && typeof v === "object" ? v : {})); }

  // --- bentuk tampilan ---
  function shape(rec) {
    const out = {};
    for (const f of SERVER_FIELDS) out[f] = rec[f] != null ? rec[f] : null;
    out.id = rec.server_id != null ? rec.server_id : rec.cid;
    out.cid = rec.cid;
    out.server_id = rec.server_id != null ? rec.server_id : null;
    out.parent_cid = rec.parent_cid != null ? rec.parent_cid : null;
    out.parent_id = rec.parent_id != null ? rec.parent_id : out.parent_cid;
    out.client_id = rec.client_id != null ? rec.client_id : rec.cid;
    out.pending = !!rec.pending;
    out.sync_error = rec.sync_error || null;
    return out;
  }

  function byTime(a, b) {
    const d = ts(a.created_at) - ts(b.created_at);
    if (d) return d;
    return a.cid < b.cid ? -1 : (a.cid > b.cid ? 1 : 0);
  }

  // Komentar tampil hanya bila list_id-nya = list_id note saat ini (spec §6.2).
  function matchesNote(rec, note) {
    if (!note || note.list_id == null || rec.deleted_at) return false;
    if (rec.list_id != note.list_id) return false;
    return rec.note_cid === note.cid || (note.server_id != null && rec.note_id != null && rec.note_id == note.server_id);
  }
  function visibleFor(all, note) { return all.filter((r) => matchesNote(r, note)).sort(byTime).map(shape); }

  function listForNote(noteCid) {
    return getNote(noteCid).then((note) => {
      if (!note || note.deleted || note.list_id == null) return [];
      return getAll().then((all) => visibleFor(all, note));
    });
  }

  function threads(rows, tab) {
    const list = (rows || []).slice().sort(byTime);
    const tops = list.filter((r) => r.parent_id == null && r.parent_cid == null);
    const wantDone = tab === "done";
    return tops.filter((t) => (t.resolved_at != null) === wantDone).map((t) => Object.assign({}, t, {
      replies: list.filter((r) => r !== t && isReply(r)
        && (r.parent_cid === t.cid || (t.server_id != null && r.parent_id == t.server_id))),
    }));
  }

  function parts(body) {
    const out = [];
    const s = String(body || "");
    const re = /@\w+/g;
    let last = 0, m;
    while ((m = re.exec(s))) {
      if (m.index > last) out.push({ s: s.slice(last, m.index), m: false });
      out.push({ s: m[0], m: true });
      last = m.index + m[0].length;
    }
    if (last < s.length) out.push({ s: s.slice(last), m: false });
    return out;
  }

  // parent_id boleh server id atau cid; record induk dicari lewat cid lalu idmap.
  function findComment(idOrCid) {
    if (idOrCid == null) return Promise.resolve(undefined);
    return getRaw(String(idOrCid)).then((rec) => {
      if (rec) return rec;
      return TFidmap.cidOf("comment", idOrCid).then((cid) => (cid ? getRaw(cid) : undefined));
    });
  }

  function create(noteCid, input) {
    const inp = input || {};
    return getNote(noteCid).then((note) => {
      if (!note || note.deleted) throw fail(404, "Note not found");
      if (note.list_id == null) throw fail(409, "Catatan ini belum dibagikan ke workspace", "NOTE_NOT_SHARED");
      const parentP = inp.parent_id != null
        ? findComment(inp.parent_id).then((p) => {
          if (!p || p.deleted_at) throw fail(404, "Komentar tidak ditemukan");
          if (!isReply(p)) return p;
          return (p.parent_cid ? getRaw(p.parent_cid) : findComment(p.parent_id)).then((t) => {
            if (!t || t.deleted_at) throw fail(404, "Komentar tidak ditemukan");
            return t;
          });
        })
        : Promise.resolve(null);
      return parentP.then((thread) => {
        const u = user();
        const cid = TFids.newCid();
        const now = nowIso();
        const rec = {
          cid: cid, server_id: null, note_cid: note.cid,
          note_id: note.server_id != null ? note.server_id : null, list_id: note.list_id,
          parent_cid: thread ? thread.cid : null,
          parent_id: thread && thread.server_id != null ? thread.server_id : null,
          user_id: u.user_id != null ? u.user_id : null,
          username: u.username || null, display_name: u.display_name || null,
          body: String(inp.body || ""), quote: thread ? null : (inp.quote != null ? inp.quote : null),
          resolved_at: null, resolved_by: null, resolved_by_name: null, edited_at: null, deleted_at: null,
          client_id: cid, created_at: now, updated_at: now,
          pending: "create", sync_error: null, server_copy: null,
        };
        return putRaw(rec)
          .then(() => TFoutbox.outboxAdd({ entity_type: "comment", op: "create", cid: cid }))
          .then(() => shape(rec));
      });
    });
  }

  function loadLive(cid) {
    return getRaw(cid).then((rec) => {
      if (!rec || rec.deleted_at) throw fail(404, "Komentar tidak ditemukan");
      return rec;
    });
  }
  function snapshot(rec) {
    const c = {};
    for (const f of SERVER_FIELDS) c[f] = rec[f] != null ? rec[f] : null;
    return c;
  }

  // Ubah komentar yang sudah ada: pending create → hanya record; ber-server_id → server_copy + op jenisnya.
  // Perubahan baru pada record ber-sync_error = coba lagi: push sudah membuang op-nya, jadi op dipastikan ada lagi.
  function retryOps(rec, kind) {
    const prior = rec.sync_error && (rec.pending === "edit" || rec.pending === "resolve") && rec.pending !== kind
      && kind !== "delete" ? rec.pending : null;
    rec.sync_error = null;
    return prior ? addOpOnce("comment", prior, rec.cid) : Promise.resolve();
  }
  function change(rec, kind, mutate) {
    const now = nowIso();
    if (rec.pending === "create") {
      mutate(rec, now, false);
      rec.sync_error = null;
      return putRaw(rec).then(() => addOpOnce("comment", "create", rec.cid)).then(() => rec);
    }
    if (!rec.server_copy) rec.server_copy = snapshot(rec);
    mutate(rec, now, true);
    rec.updated_at = now;
    const retry = retryOps(rec, kind);
    rec.pending = kind;
    return retry.then(() => putRaw(rec)).then(() => addOpOnce("comment", kind, rec.cid)).then(() => rec);
  }

  function edit(cid, body) {
    return loadLive(cid).then((rec) => change(rec, "edit", (r, now, synced) => {
      r.body = String(body || "");
      if (synced) r.edited_at = now;
      else r.updated_at = now;
    })).then(shape);
  }

  function resolve(cid, resolved) {
    return loadLive(cid).then((rec) => {
      if (isReply(rec)) throw fail(422, "Hanya thread yang bisa diselesaikan");
      const u = user();
      return change(rec, "resolve", (r, now) => {
        r.resolved_at = resolved ? now : null;
        r.resolved_by = resolved ? (u.user_id != null ? u.user_id : null) : null;
        r.resolved_by_name = resolved ? (u.display_name || u.username || null) : null;
      });
    }).then(shape);
  }

  // Hapus record yang belum terkirim beserta semua op-nya.
  function dropUnsent(cid) { return deleteRaw(cid).then(() => removeOps(cid)); }
  function dropUnsentReplies(threadCid) {
    return getAll().then((all) => all
      .filter((r) => r.parent_cid === threadCid && r.pending === "create")
      .reduce((p, r) => p.then(() => dropUnsent(r.cid)), Promise.resolve()));
  }

  function remove(cid) {
    return loadLive(cid).then((rec) => {
      if (rec.pending === "create") return dropUnsentReplies(rec.cid).then(() => dropUnsent(rec.cid));
      if (!rec.server_copy) rec.server_copy = snapshot(rec);
      const now = nowIso();
      rec.deleted_at = now;
      rec.updated_at = now;
      rec.sync_error = null;
      rec.pending = "delete";
      return putRaw(rec)
        .then(() => removeOps(rec.cid, ["edit", "resolve"]))
        .then(() => addOpOnce("comment", "delete", rec.cid))
        .then(() => dropUnsentReplies(rec.cid));
    }).then(() => true);
  }

  function discard(cid) {
    return getRaw(cid).then((rec) => {
      if (!rec) return removeOps(cid);
      if (rec.pending === "create") return dropUnsentReplies(rec.cid).then(() => dropUnsent(rec.cid));
      if (rec.server_copy) Object.assign(rec, rec.server_copy);
      rec.pending = null;
      rec.sync_error = null;
      rec.server_copy = null;
      return putRaw(rec).then(() => removeOps(rec.cid));
    });
  }

  function serverRecord(item, cid, noteCid, parentCid) {
    const rec = snapshot(item);
    return Object.assign(rec, {
      cid: cid, server_id: item.id, note_cid: noteCid, parent_cid: parentCid,
      pending: null, sync_error: null, server_copy: null,
    });
  }

  function mergePulled(items, opts) {
    const list = items || [];
    const o = opts || {};
    const changed = new Set();
    const seen = new Set();
    return list.reduce((p, item) => p.then(() => {
      if (!item || item.id == null) return null;
      seen.add(String(item.id));
      return TFidmap.cidOf("comment", item.id)
        .then((cid) => (cid ? getRaw(cid) : undefined))
        .then((local) => (local || !item.client_id ? local : getRaw(item.client_id)))
        .then((local) => {
          const tomb = !!item.deleted_at;
          if (local && local.pending === "create" && item.client_id === local.cid) {
            changed.add(item.note_id);
            if (tomb) return dropUnsent(local.cid).then(() => TFidmap.mapDelete("comment", item.id));
            // Perubahan lokal yang dilebur ke create (edit/resolve) dipertahankan sebagai op lanjutan.
            const rec = serverRecord(item, local.cid, local.note_cid, local.parent_cid);
            const bodyDiff = local.body !== rec.body;
            const resDiff = (local.resolved_at != null) !== (rec.resolved_at != null);
            const kinds = (bodyDiff ? ["edit"] : []).concat(resDiff ? ["resolve"] : []);
            if (kinds.length) {
              rec.server_copy = snapshot(item);
              if (bodyDiff) rec.body = local.body;
              if (resDiff) {
                rec.resolved_at = local.resolved_at;
                rec.resolved_by = local.resolved_by;
                rec.resolved_by_name = local.resolved_by_name;
              }
              rec.pending = kinds[0];
            }
            return putRaw(rec)
              .then(() => TFidmap.mapPut("comment", item.id, local.cid))
              .then(() => removeOps(local.cid, ["create"]))
              .then(() => kinds.reduce((q, k) => q.then(() => addOpOnce("comment", k, local.cid)), Promise.resolve()));
          }
          if (local && (local.pending || local.sync_error)) return null;
          if (tomb) {
            changed.add(item.note_id);
            return (local ? deleteRaw(local.cid) : Promise.resolve()).then(() => TFidmap.mapDelete("comment", item.id));
          }
          return Promise.all([
            TFidmap.cidOf("note", item.note_id),
            item.parent_id != null ? TFidmap.cidOf("comment", item.parent_id) : Promise.resolve(null),
          ]).then(([noteCid, parentCid]) => {
            const cid = local ? local.cid : TFids.newCid();
            changed.add(item.note_id);
            return putRaw(serverRecord(item, cid, noteCid != null ? noteCid : null, parentCid != null ? parentCid : null))
              .then(() => TFidmap.mapPut("comment", item.id, cid));
          });
        });
    }), Promise.resolve()).then(() => {
      if (o.replaceForNoteId == null) return null;
      return getAll().then((all) => all
        .filter((r) => r.note_id == o.replaceForNoteId && !r.pending && !r.sync_error
          && !(r.server_id != null && seen.has(String(r.server_id))))
        .reduce((p, r) => p.then(() => {
          changed.add(o.replaceForNoteId);
          return deleteRaw(r.cid).then(() => (r.server_id != null ? TFidmap.mapDelete("comment", r.server_id) : null));
        }), Promise.resolve()));
    }).then(() => ({ changedNoteIds: Array.from(changed).filter((n) => n != null) }));
  }

  function clearSynced() {
    return getAll().then((all) => all.filter((r) => !r.pending && !r.sync_error)
      .reduce((p, r) => p.then(() => deleteRaw(r.cid)
        .then(() => (r.server_id != null ? TFidmap.mapDelete("comment", r.server_id) : null))), Promise.resolve()));
  }

  function markRead(noteCid) {
    return readsGet().then((reads) => {
      reads[noteCid] = nowIso();
      return TFmeta.metaSet(READS_KEY, reads);
    }).then(() => addOpOnce("comment_read", "mark", noteCid)).then(() => true);
  }

  function seedReadMarkers(serverNotes, now) {
    const list = (serverNotes || []).filter((n) => n && n.id != null && n.comment_unread === false);
    return readsGet().then((reads) => {
      let dirty = false;
      return list.reduce((p, n) => p.then(() => TFidmap.cidOf("note", n.id).then((cid) => {
        if (cid && reads[cid] == null) { reads[cid] = now; dirty = true; }
      })), Promise.resolve()).then(() => (dirty ? TFmeta.metaSet(READS_KEY, reads) : null));
    });
  }

  function decorateNotes(rows) {
    const list = rows || [];
    return Promise.all([getAll(), getNotes(), readsGet()]).then(([all, notes, reads]) => {
      const byCid = {};
      for (const n of notes) byCid[n.cid] = n;
      const me = user().user_id;
      return list.map((row) => {
        if (!row || row.list_id == null) return Object.assign(row || {}, { comment_open_count: 0, comment_unread: false });
        const stored = byCid[row.cid];
        const note = { cid: row.cid, list_id: row.list_id,
          server_id: stored && stored.server_id != null ? stored.server_id : (row.server_id != null ? row.server_id : null) };
        const shown = visibleFor(all, note);
        const open = threads(shown, "open");
        const visible = open.concat(threads(shown, "done"))
          .reduce((acc, t) => acc.concat([t], t.replies), []);
        const mark = ts(reads[row.cid]);
        row.comment_open_count = open.length;
        row.comment_unread = visible.some((c) => c.user_id != me && ts(c.created_at) > mark);
        return row;
      });
    });
  }

  const exported = {
    CURSOR_KEY, READS_KEY, getRaw, putRaw, deleteRaw, shape, listForNote, threads, parts,
    create, edit, resolve, remove, discard, mergePulled, clearSynced, markRead, seedReadMarkers, decorateNotes,
  };
  if (root && typeof root === "object") { root.TF = root.TF || {}; root.TF.commentrepo = exported; }
  return exported;
});
