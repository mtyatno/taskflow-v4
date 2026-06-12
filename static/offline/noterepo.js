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
        list_id: input.list_id != null ? input.list_id : null,
        user_id: curUid(),
        last_edited_by: curUid(),
        last_editor_username: null, last_editor_display_name: null,
        created_at: now, updated_at: now, deleted: false, dirty: 1, base_rev: null,
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
          content: content,
          linked_to_cids: JSON.stringify(toCids),
          linked_task_cids: JSON.stringify(taskCids),
          last_edited_by: curUid(),
          updated_at: now, dirty: 1,
        });
        return putNote(next)
          .then(() => TFoutbox.outboxAdd({ op: "update", entity_type: "note", cid: cid, payload: next }))
          .then(() => (patch.tags != null ? TFtag.setEntityTags("note", cid, patch.tags) : null))
          .then(() => next);
      });
    });
  }

  function deleteNote(cid, opts) {
    return getNoteRaw(cid).then((rec) => {
      if (!rec || rec.deleted) return Promise.reject(new Error("Note not found"));
      const next = Object.assign({}, rec, { deleted: true, dirty: 1 });
      return putNote(next)
        .then(() => TFoutbox.outboxAdd({ op: "delete", entity_type: "note", cid: cid, payload: { cid: cid } }))
        .then(() => ({ ok: true }));
    });
  }

  function togglePin(cid, opts) {
    return getNoteRaw(cid).then((rec) => {
      if (!rec || rec.deleted) return Promise.reject(new Error("Note not found"));
      const next = Object.assign({}, rec, { pinned: !rec.pinned });
      return putNote(next)
        .then(() => TFoutbox.outboxAdd({ op: "pin", entity_type: "note", cid: cid, payload: { pinned: next.pinned } }))
        .then(() => next);
    });
  }

  const exported = { createNote, updateNote, deleteNote, togglePin, getNoteRaw, putNote, resolveLinkedTo, resolveLinkedTasks, setCurrentUser, getCurrentUser };
  if (root && typeof root === "object") { root.TF = root.TF || {}; root.TF.noterepo = exported; }
  return exported;
});
