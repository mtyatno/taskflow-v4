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

  const DEFAULT_FREQ = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

  function getHabitRaw(cid) {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const r = db.transaction("habits", "readonly").objectStore("habits").get(cid);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    }));
  }
  function putHabit(rec) {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const tx = db.transaction("habits", "readwrite");
      tx.objectStore("habits").put(rec);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    }));
  }

  function createHabit(input, opts) {
    const now = (opts && opts.now) || new Date().toISOString();
    const ex = TFtag.extractTags(input.title);
    if (!ex.clean) return Promise.reject(new Error("Nama habit tidak boleh kosong setelah strip tag"));
    const phase = (input.phase === "pagi" || input.phase === "siang" || input.phase === "malam") ? input.phase : "pagi";
    const rec = {
      cid: TFids.newCid(), server_id: null, title: ex.clean, phase: phase,
      micro_target: input.micro_target != null ? input.micro_target : "",
      frequency: JSON.stringify(Array.isArray(input.frequency) ? input.frequency : DEFAULT_FREQ),
      identity_pillar: input.identity_pillar != null ? input.identity_pillar : "",
      created_at: now, deleted: false, dirty: 1,
    };
    return putHabit(rec)
      .then(() => TFoutbox.outboxAdd({ op: "create", entity_type: "habit", cid: rec.cid, payload: rec }))
      .then(() => TFtag.setEntityTags("habit", rec.cid, ex.tags))
      .then(() => rec);
  }

  function updateHabit(cid, patch, opts) {
    return getHabitRaw(cid).then((rec) => {
      if (!rec || rec.deleted) return Promise.reject(new Error("Habit not found"));
      const next = Object.assign({}, rec);
      let newTags = null;
      if (patch.title != null) {
        const ex = TFtag.extractTags(patch.title);
        if (!ex.clean) return Promise.reject(new Error("Nama habit tidak boleh kosong setelah strip tag"));
        next.title = ex.clean; newTags = ex.tags;
      }
      if (patch.phase != null && (patch.phase === "pagi" || patch.phase === "siang" || patch.phase === "malam")) next.phase = patch.phase;
      if (patch.micro_target != null) next.micro_target = patch.micro_target;
      if (patch.frequency != null) next.frequency = JSON.stringify(Array.isArray(patch.frequency) ? patch.frequency : []);
      if (patch.identity_pillar != null) next.identity_pillar = patch.identity_pillar;
      next.dirty = 1;
      return putHabit(next)
        .then(() => TFoutbox.outboxAdd({ op: "update", entity_type: "habit", cid: cid, payload: next }))
        .then(() => (newTags != null ? TFtag.setEntityTags("habit", cid, newTags) : null))
        .then(() => next);
    });
  }

  function deleteHabit(cid, opts) {
    return getHabitRaw(cid).then((rec) => {
      if (!rec || rec.deleted) return Promise.reject(new Error("Habit not found"));
      const next = Object.assign({}, rec, { deleted: true, dirty: 1 });
      return putHabit(next)
        .then(() => TFoutbox.outboxAdd({ op: "delete", entity_type: "habit", cid: cid, payload: { cid: cid } }))
        .then(() => ({ ok: true }));
    });
  }

  function checkin(habitCid, date, status, skipReason, opts) {
    if (status !== "done" && status !== "skipped") return Promise.reject(new Error("status harus done atau skipped"));
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const tx = db.transaction("habit_logs", "readwrite");
      const store = tx.objectStore("habit_logs");
      const idx = store.index("habit_date");
      let record = null;
      const g = idx.get([habitCid, date]);
      g.onsuccess = () => {
        if (g.result) { record = Object.assign({}, g.result, { status: status, skip_reason: skipReason || "", dirty: 1 }); store.put(record); }
        else { record = { cid: TFids.newCid(), habit_cid: habitCid, date: date, status: status, skip_reason: skipReason || "", dirty: 1 }; store.put(record); }
      };
      tx.oncomplete = () => resolve(record);
      tx.onerror = () => reject(tx.error);
    })).then((record) =>
      TFoutbox.outboxAdd({ op: "checkin", entity_type: "habit_log", cid: record.cid, payload: record }).then(() => record));
  }

  const exported = { createHabit, updateHabit, deleteHabit, checkin };
  if (root && typeof root === "object") { root.TF = root.TF || {}; root.TF.habitrepo = exported; }
  return exported;
});
