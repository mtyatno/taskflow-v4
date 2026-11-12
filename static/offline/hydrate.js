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
  const TFidmap = req("./idmap.js", root.TF && root.TF.idmap);
  const TFtaskext = req("./taskext.js", root.TF && root.TF.taskext);

  const COPY = [
    "title", "description", "gtd_status", "priority", "quadrant", "project", "project_id", "context", "context_id",
    "deadline", "waiting_for", "completed_at", "progress", "is_focused", "assigned_to",
    "recurrence_type", "recurrence_days", "recurrence_end_date", "recurrence_notif_level",
    "created_at", "updated_at", "estimated_pomodoros", "pomodoros_done", "checklist_total",
    // Checklist offline Fase 2 (spec §4.1, E1): versi checklist server — field turunan, dibandingkan pullChecklists
    // dengan rev tersimpan checklistrepo.
    "checklist_rev",
  ];
  // Nilai bawaan bila server tidak mengirim / null.
  const ZERO = { is_focused: 1, progress: 1, pomodoros_done: 1, checklist_total: 1, checklist_rev: 1 };
  const dflt = (k) => (ZERO[k] ? 0 : k === "estimated_pomodoros" ? 1 : null);

  // Pure: server task dict → local record. `getCid(serverId)` returns the cid for any server id.
  function taskFromServer(dict, getCid) {
    const rec = { cid: getCid(dict.id), server_id: dict.id };
    for (const k of COPY) rec[k] = dict[k] != null ? dict[k] : dflt(k);
    rec.title = dict.title;
    rec.parent_cid = dict.parent_id != null ? getCid(dict.parent_id) : null;
    rec.list_cid = null;
    rec.list_id = dict.list_id != null ? dict.list_id : null;
    // F1: nama yang mengikat project_id (lihat projectcache.payloadProjectId)
    rec.project_ref_name = rec.project_id != null ? (rec.project != null ? rec.project : "") : null;
    // Kanban tahap: nama yang mengikat context_id (lihat contextcache.payloadContextId)
    rec.context_ref_name = rec.context_id != null ? (rec.context != null ? rec.context : "") : null;
    rec.deleted = false;
    rec.dirty = 0;
    rec.base_rev = dict.updated_at != null ? dict.updated_at : null;
    // client_id server (= cid perangkat pembuat; id link node mindmap) → resolver lokal bisa menemukan record ini
    if (dict.client_id != null && dict.client_id !== "") rec.client_id = String(dict.client_id);
    // Field plugin (spec plugin Fase 1 K5, rencana 1a-1 R3): hanya bila server mengirim OBJEK. Server lama
    // (jendela deploy) tidak mengirim ext atau meneruskan kolom mentah sebagai string "{}" → dianggap tidak dikirim.
    if (TFtaskext.isPlainObject(dict.ext)) rec.ext = dict.ext;
    return rec;
  }

  // Field inti dari dict server untuk diadopsi ke record yang sudah ada (spec 1c K25; rencana 1c-0 R5): kunci
  // COPY kecuali created_at/updated_at, HANYA yang ada di `dict`, dengan nilai bawaan yang sama seperti
  // taskFromServer; plus project_ref_name/context_ref_name bila project*/context* ikut. parent/list/client_id/ext
  // dan rev tidak disentuh (ext diurus taskAdopt).
  const CORE_SKIP = { created_at: 1, updated_at: 1 };
  function coreFromServer(dict) {
    const out = {};
    if (!dict || typeof dict !== "object") return out;
    const has = (k) => Object.prototype.hasOwnProperty.call(dict, k);
    for (const k of COPY) {
      if (CORE_SKIP[k] || !has(k)) continue;
      out[k] = dict[k] != null ? dict[k] : dflt(k);
    }
    if (has("project_id") || has("project")) {
      const pid = out.project_id != null ? out.project_id : null;
      out.project_ref_name = pid != null ? (out.project != null ? out.project : "") : null;
    }
    if (has("context_id") || has("context")) {
      const xid = out.context_id != null ? out.context_id : null;
      out.context_ref_name = xid != null ? (out.context != null ? out.context : "") : null;
    }
    return out;
  }

  // Ensure a stable cid for a server id via _idmap; create + persist if missing.
  function ensureCid(serverId, cache) {
    if (cache[serverId]) return Promise.resolve(cache[serverId]);
    return TFidmap.cidOf("task", serverId).then((cid) => {
      if (cid) { cache[serverId] = cid; return cid; }
      const fresh = TFids.newCid();
      cache[serverId] = fresh;
      return TFidmap.mapPut("task", serverId, fresh).then(() => fresh);
    });
  }

  function putTask(rec) {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const tx = db.transaction("tasks", "readwrite");
      tx.objectStore("tasks").put(rec);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    }));
  }

  function hydrateTasks(serverTasks) {
    const list = serverTasks || [];
    const cache = {};
    // Pass 1: assign a cid to every server id (so parents resolve in pass 2).
    return list.reduce((p, d) => p.then(() => ensureCid(d.id, cache)), Promise.resolve())
      .then(() => {
        const getCid = (sid) => cache[sid] || null;
        // Pass 2: upsert each record.
        return list.reduce((p, d) => p.then(() => putTask(taskFromServer(d, getCid))), Promise.resolve());
      });
  }

  const exported = { taskFromServer, coreFromServer, hydrateTasks };
  if (root && typeof root === "object") { root.TF = root.TF || {}; root.TF.hydrate = exported; }
  return exported;
});
