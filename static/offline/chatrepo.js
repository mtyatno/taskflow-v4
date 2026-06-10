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

  let _fetcher = null;
  let _currentUser = null;
  function configureFetcher(fn) { _fetcher = fn; }
  function getFetcher() { return _fetcher; }
  function setCurrentUser(u) { _currentUser = u; }
  function getCurrentUser() { return _currentUser; }

  function getAll() {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const r = db.transaction("chat_messages", "readonly").objectStore("chat_messages").getAll();
      r.onsuccess = () => resolve(r.result || []);
      r.onerror = () => reject(r.error);
    }));
  }
  function getAllFrom(store) {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const r = db.transaction(store, "readonly").objectStore(store).getAll();
      r.onsuccess = () => resolve(r.result || []);
      r.onerror = () => reject(r.error);
    }));
  }
  function putRaw(rec) {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const tx = db.transaction("chat_messages", "readwrite");
      tx.objectStore("chat_messages").put(rec);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    }));
  }

  // Local record -> server-shaped display object the ChatRoom renders.
  function shape(rec) {
    return {
      id: rec.server_id != null ? rec.server_id : rec.cid, // pending -> cid
      client_id: rec.cid,
      list_id: rec.list_id, user_id: rec.user_id, content: rec.content,
      task_id: rec.task_id, note_id: rec.note_id, msg_type: rec.msg_type,
      reply_to_id: rec.reply_to_id, created_at: rec.created_at,
      username: rec.username, display_name: rec.display_name,
      task_title: rec.task_title, task_priority: rec.task_priority, task_deadline: rec.task_deadline,
      task_quadrant: rec.task_quadrant, task_status: rec.task_status,
      note_title: rec.note_title,
      reply_to_username: rec.reply_to_username, reply_to_display_name: rec.reply_to_display_name,
      reply_to_content: rec.reply_to_content,
      pending: rec.pending ? 1 : 0,
    };
  }

  // Upsert one server message dict into the store, deduping by server_id then client_id.
  // `all` is the current snapshot (kept current by the caller for batch dedup).
  function upsertOne(all, msg) {
    let existing = null;
    if (msg.id != null) existing = all.find((r) => r.server_id != null && String(r.server_id) === String(msg.id));
    if (!existing && msg.client_id) existing = all.find((r) => r.cid === msg.client_id);
    const cid = existing ? existing.cid : TFids.newCid();
    const rec = {
      cid: cid,
      server_id: msg.id != null ? msg.id : (existing ? existing.server_id : null),
      list_id: msg.list_id, user_id: msg.user_id,
      content: msg.content != null ? msg.content : "",
      task_id: msg.task_id != null ? msg.task_id : null,
      note_id: msg.note_id != null ? msg.note_id : null,
      msg_type: msg.msg_type || "text",
      reply_to_id: msg.reply_to_id != null ? msg.reply_to_id : null,
      created_at: msg.created_at,
      username: msg.username != null ? msg.username : null,
      display_name: msg.display_name != null ? msg.display_name : null,
      task_title: msg.task_title != null ? msg.task_title : null,
      task_priority: msg.task_priority != null ? msg.task_priority : null,
      task_deadline: msg.task_deadline != null ? msg.task_deadline : null,
      task_quadrant: msg.task_quadrant != null ? msg.task_quadrant : null,
      task_status: msg.task_status != null ? msg.task_status : null,
      note_title: msg.note_title != null ? msg.note_title : null,
      reply_to_username: msg.reply_to_username != null ? msg.reply_to_username : null,
      reply_to_display_name: msg.reply_to_display_name != null ? msg.reply_to_display_name : null,
      reply_to_content: msg.reply_to_content != null ? msg.reply_to_content : null,
      pending: 0,
    };
    return putRaw(rec)
      .then(() => (rec.server_id != null ? TFidmap.mapPut("message", rec.server_id, cid) : null))
      .then(() => rec);
  }

  function cacheMessages(serverMsgs) {
    const list = serverMsgs || [];
    return getAll().then((all) =>
      list.reduce((p, msg) => p.then(() => upsertOne(all, msg).then((rec) => {
        const idx = all.findIndex((r) => r.cid === rec.cid);
        if (idx >= 0) all[idx] = rec; else all.push(rec);
      })), Promise.resolve()));
  }

  function upsertIncoming(msg) {
    return getAll().then((all) => upsertOne(all, msg)).then(() => undefined);
  }

  function getMessages(listId, query) {
    query = query || {};
    const limit = query.limit != null ? Number(query.limit) : 50;
    const beforeId = query.before_id != null ? query.before_id : null;
    return getAll().then((all) => {
      let rows = all.filter((r) => String(r.list_id) === String(listId));
      rows.sort((a, b) => {
        if (a.created_at < b.created_at) return -1;
        if (a.created_at > b.created_at) return 1;
        const as = a.server_id != null ? a.server_id : Infinity;
        const bs = b.server_id != null ? b.server_id : Infinity;
        return as - bs;
      });
      if (beforeId != null) {
        const refIdx = rows.findIndex((r) => r.server_id != null && String(r.server_id) === String(beforeId));
        if (refIdx >= 0) rows = rows.slice(0, refIdx);
      }
      const sliced = rows.slice(Math.max(0, rows.length - limit));
      return sliced.map(shape);
    });
  }

  function sendMessage(listId, payload, currentUser, opts) {
    payload = payload || {};
    const cu = currentUser || _currentUser || {};
    const now = (opts && opts.now) || new Date().toISOString();
    const cid = (opts && opts.cid) || TFids.newCid();
    return Promise.all([
      payload.task_id != null ? getAllFrom("tasks") : Promise.resolve([]),
      payload.note_id != null ? getAllFrom("scratchpad_notes") : Promise.resolve([]),
      payload.reply_to_id != null ? getAll() : Promise.resolve([]),
    ]).then(([tasks, notes, msgs]) => {
      const task = payload.task_id != null ? tasks.find((t) => String(t.server_id) === String(payload.task_id) || t.cid === payload.task_id) : null;
      const note = payload.note_id != null ? notes.find((n) => String(n.server_id) === String(payload.note_id) || n.cid === payload.note_id) : null;
      const reply = payload.reply_to_id != null ? msgs.find((m) => String(m.server_id) === String(payload.reply_to_id) || m.cid === payload.reply_to_id) : null;
      const rec = {
        cid: cid, server_id: null, list_id: Number(listId),
        user_id: cu.user_id != null ? cu.user_id : null,
        content: payload.content != null ? payload.content : "",
        task_id: payload.task_id != null ? payload.task_id : null,
        note_id: payload.note_id != null ? payload.note_id : null,
        msg_type: payload.msg_type || "text",
        reply_to_id: payload.reply_to_id != null ? payload.reply_to_id : null,
        created_at: now,
        username: cu.username != null ? cu.username : null,
        display_name: cu.display_name != null ? cu.display_name : null,
        task_title: task ? task.title : null,
        task_priority: task ? task.priority : null,
        task_deadline: task ? task.deadline : null,
        task_quadrant: task ? task.quadrant : null,
        task_status: task ? task.gtd_status : null,
        note_title: note ? note.title : null,
        reply_to_username: reply ? reply.username : null,
        reply_to_display_name: reply ? reply.display_name : null,
        reply_to_content: reply ? reply.content : null,
        pending: 1,
      };
      return putRaw(rec)
        .then(() => TFoutbox.outboxAdd({ op: "send", entity_type: "message", cid: cid, payload: { cid: cid } }))
        .then(() => shape(rec));
    });
  }

  const exported = {
    cacheMessages, getMessages, sendMessage, upsertIncoming,
    configureFetcher, getFetcher, setCurrentUser, getCurrentUser,
  };
  if (root && typeof root === "object") { root.TF = root.TF || {}; root.TF.chatrepo = exported; }
  return exported;
});
