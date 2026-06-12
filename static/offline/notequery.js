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
  const TFtag = req("./tagrepo.js", root.TF && root.TF.tagrepo);

  function getAll(store) {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const r = db.transaction(store, "readonly").objectStore(store).getAll();
      r.onsuccess = () => resolve(r.result || []);
      r.onerror = () => reject(r.error);
    }));
  }
  const displayId = (rec) => (rec.server_id != null ? rec.server_id : rec.cid);
  const parseArr = (s) => { try { return JSON.parse(s || "[]"); } catch (_) { return []; } };

  function shape(rec, ctx) {
    const toDisplay = parseArr(rec.linked_to_cids).map((c) => ctx.noteDisp[c]).filter((x) => x != null);
    const taskCids = parseArr(rec.linked_task_cids);
    const taskDisplay = taskCids.map((c) => (ctx.taskById[c] ? displayId(ctx.taskById[c]) : null)).filter((x) => x != null);
    const linkedTasks = taskCids.map((c) => ctx.taskById[c]).filter(Boolean).map((t) => ({
      id: displayId(t), title: t.title, priority: t.priority, gtd_status: t.gtd_status,
    }));
    return {
      id: displayId(rec), title: rec.title, content: rec.content,
      tags: (ctx.tagsByCid[rec.cid] || []).map((t) => t.name),
      pinned: !!rec.pinned,
      linked_task_ids: taskDisplay, linked_tasks: linkedTasks, linked_to: toDisplay,
      list_id: rec.list_id != null ? rec.list_id : null,
      user_id: rec.user_id != null ? rec.user_id : null,
      last_edited_by: rec.last_edited_by != null ? rec.last_edited_by : null,
      last_editor_username: rec.last_editor_username != null ? rec.last_editor_username : null,
      last_editor_display_name: rec.last_editor_display_name != null ? rec.last_editor_display_name : null,
      created_at: rec.created_at, updated_at: rec.updated_at,
    };
  }

  function personalSorted(notes) {
    return notes.filter((n) => !n.deleted)
      .sort((a, b) => (String(b.updated_at) < String(a.updated_at) ? -1 : String(b.updated_at) > String(a.updated_at) ? 1 : 0));
  }

  function buildCtx(notes) {
    return Promise.all([getAll("tasks"), getAll("entity_tags"), getAll("tags")]).then(([tasks, ets, tags]) => {
      const noteDisp = {}; for (const n of notes) noteDisp[n.cid] = displayId(n);
      const taskById = {}; for (const t of tasks) taskById[t.cid] = t;
      const tagByCid = {}; for (const t of tags) tagByCid[t.cid] = t;
      const tagsByCid = {};
      for (const et of ets) {
        if (et.entity_type !== "note") continue;
        const t = tagByCid[et.tag_cid]; if (!t) continue;
        (tagsByCid[et.entity_cid] = tagsByCid[et.entity_cid] || []).push({ name: t.name });
      }
      for (const cid in tagsByCid) tagsByCid[cid].sort((a, b) => (a.name < b.name ? -1 : 1));
      return { noteDisp, taskById, tagsByCid };
    });
  }

  function getNotes(query) {
    const q = (query && query.q ? String(query.q) : "").toLowerCase();
    const tag = query && query.tag ? String(query.tag) : "";
    return getAll("scratchpad_notes").then((all) => {
      const notes = personalSorted(all);
      const tagP = tag ? TFtag.cidsForTag("note", tag) : Promise.resolve(null);
      return Promise.all([buildCtx(all), tagP]).then(([ctx, tagSet]) => {
        let list = notes;
        if (q) list = list.filter((n) => String(n.title || "").toLowerCase().includes(q) || String(n.content || "").toLowerCase().includes(q));
        if (tagSet) list = list.filter((n) => tagSet.has(n.cid));
        return list.map((n) => shape(n, ctx));
      });
    });
  }

  function getNote(cid) {
    return getAll("scratchpad_notes").then((all) => {
      const rec = all.find((n) => n.cid === cid);
      if (!rec) return null;
      return buildCtx(all).then((ctx) => shape(rec, ctx));
    });
  }

  function getRecent() {
    return getAll("scratchpad_notes").then((all) =>
      buildCtx(all).then((ctx) => personalSorted(all).slice(0, 5).map((n) => shape(n, ctx))));
  }

  function getTitles() {
    return getAll("scratchpad_notes").then((all) =>
      personalSorted(all).map((n) => ({ id: displayId(n), title: n.title })));
  }

  function getBacklinks(cid) {
    return getAll("scratchpad_notes").then((all) => {
      const sources = personalSorted(all).filter((n) => n.cid !== cid && parseArr(n.linked_to_cids).indexOf(cid) !== -1);
      return buildCtx(all).then((ctx) => sources.map((n) => shape(n, ctx)));
    });
  }

  const exported = { getNotes, getNote, getRecent, getTitles, getBacklinks };
  if (root && typeof root === "object") { root.TF = root.TF || {}; root.TF.notequery = exported; }
  return exported;
});
