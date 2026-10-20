;(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory(root);
  } else {
    root.TF = root.TF || {};
    factory(root);
  }
})(typeof self !== "undefined" ? self : globalThis, function (root) {
  "use strict";

  // Model papan Kanban murni (tanpa DOM / IndexedDB): membentuk kolom dari task + tahap (context) dan
  // memutuskan aksi drop. Bentuk kolom: {key, kind: none|stage|orphan|done|priority|project, label, tasks,
  // item?, value?, color?}. Id task/tahap dipakai apa adanya dan dibandingkan lewat String(a) === String(b).
  const isNode = (typeof module !== "undefined" && module.exports);
  const req = (m, g) => (isNode ? require(m) : g);
  const TFproj = req("./projectcache.js", root.TF && root.TF.projectcache);
  const TFctx = req("./contextcache.js", root.TF && root.TF.contextcache);

  const nocaseKey = TFproj.nocaseKey, nocaseCompare = TFproj.nocaseCompare, nocaseEq = TFproj.nocaseEq;

  const JKT_OFFSET_MS = 7 * 3600 * 1000;
  const DAY_MS = 86400000;
  const OFFLINE_MSG = "Tidak bisa dilakukan saat offline";
  const PRI_LABELS = {
    P1: "🔴 P1 Critical", P2: "🟠 P2 High", P3: "🟡 P3 Medium", P4: "🟢 P4 Low",
  };
  const NO_PRI_LABEL = "(Tanpa Priority)";
  const PRIS = ["P1", "P2", "P3", "P4"];

  const sid = (v) => String(v);
  const cmpStr = (a, b) => (a < b ? -1 : (a > b ? 1 : 0));

  // ---- waktu (Asia/Jakarta = UTC+7) ----
  function jktDay(nowMs) {
    const ms = (nowMs == null ? Date.now() : nowMs) + JKT_OFFSET_MS;
    return new Date(ms).toISOString().slice(0, 10);
  }
  // String ISO → epoch ms. Tanpa zona = UTC; mikrodetik dipotong ke milidetik; kosong/rusak → NaN.
  function tsMs(s) {
    if (s == null || s === "") return NaN;
    let v = String(s).trim().replace(" ", "T");
    if (v === "") return NaN;
    v = v.replace(/(\.\d{3})\d+/, "$1");
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) v += "T00:00:00";
    if (!/(Z|[+-]\d{2}:?\d{2})$/i.test(v)) v += "Z";
    return Date.parse(v);
  }
  function dayShift(iso, delta) {
    return new Date(Date.parse(iso + "T00:00:00Z") + delta * DAY_MS).toISOString().slice(0, 10);
  }
  // Selesai dalam jendela 7 hari Jakarta: [today-6, today].
  function isDoneRecent(task, todayIso) {
    if (!task || task.gtd_status !== "done") return false;
    const ms = tsMs(task.completed_at);
    if (Number.isNaN(ms)) return false;
    const day = jktDay(ms);
    return day >= dayShift(todayIso, -6) && day <= todayIso;
  }

  // ---- urutan kartu ----
  function priRank(p) {
    const i = PRIS.indexOf(p);
    return i < 0 ? 4 : i;
  }
  function sortCards(tasks) {
    return (tasks || []).slice().sort((a, b) => {
      const pa = priRank(a.priority), pb = priRank(b.priority);
      if (pa !== pb) return pa - pb;
      const da = a.deadline || null, db = b.deadline || null;
      if (da !== db) {
        if (da == null) return 1;
        if (db == null) return -1;
        return cmpStr(da, db);
      }
      const c = nocaseCompare(a.title, b.title);
      if (c !== 0) return c;
      return cmpStr(sid(a.id), sid(b.id));
    });
  }
  function sortDone(tasks) {
    return (tasks || []).slice().sort((a, b) => {
      const ta = tsMs(a.completed_at), tb = tsMs(b.completed_at);
      const na = Number.isNaN(ta), nb = Number.isNaN(tb);
      if (na !== nb) return na ? 1 : -1;
      if (!na && ta !== tb) return tb - ta;
      return cmpStr(sid(a.id), sid(b.id));
    });
  }

  // ---- scope ----
  function taskScope(task, sharedLists) {
    const lid = task && task.list_id;
    if (lid == null || lid === "") return "";
    const hit = (sharedLists || []).some((l) => l && sid(l.id) === sid(lid));
    return hit ? sid(lid) : "";
  }
  function scopeOptions(tasks, sharedLists) {
    const have = new Set();
    for (const t of tasks || []) {
      const s = taskScope(t, sharedLists);
      if (s !== "") have.add(s);
    }
    const ws = (sharedLists || []).filter((l) => l && have.has(sid(l.id)))
      .sort((a, b) => nocaseCompare(a.name, b.name) || cmpStr(sid(a.id), sid(b.id)))
      .map((l) => ({ value: sid(l.id), label: "👥 " + l.name }));
    return [{ value: "", label: "Pribadi" }].concat(ws);
  }
  const itemScope = (item) => (item.list_id == null || item.list_id === "" ? "" : sid(item.list_id));

  // ---- pembangun kolom ----
  function doneColumn(donePool) {
    return { key: "done", kind: "done", label: "Selesai", tasks: sortDone(donePool) };
  }
  function withDoneColumn(columns, donePool) {
    return (columns || []).concat([doneColumn(donePool)]);
  }

  function buildContextBoard(opts) {
    const scope = opts.scope == null ? "" : sid(opts.scope);
    const sharedLists = opts.sharedLists || [];
    const scoped = TFctx.sortItems((opts.items || []).filter((i) => itemScope(i) === scope));
    const live = scoped.filter((i) => !i.archived);
    const archived = scoped.filter((i) => i.archived);

    let hiddenOtherScope = 0;
    const none = [];
    const byStage = new Map(live.map((i) => [sid(i.id), []]));
    const archivedCols = new Map(); // key → {item, tasks}
    const unsyncedCols = new Map(); // key → {name, tasks}

    const pushArchived = (it, t) => {
      const k = "orphan:" + nocaseKey(it.name);
      if (!archivedCols.has(k)) archivedCols.set(k, { item: it, tasks: [] });
      archivedCols.get(k).tasks.push(t);
    };

    for (const t of opts.tasks || []) {
      if (taskScope(t, sharedLists) !== scope) { hiddenOtherScope++; continue; }
      const hasId = t.context_id != null && t.context_id !== "";
      const name = t.context == null ? "" : String(t.context);
      let stage = hasId ? live.find((i) => sid(i.id) === sid(t.context_id)) : null;
      if (!stage && name !== "") stage = live.find((i) => nocaseEq(i.name, name));
      if (stage) { byStage.get(sid(stage.id)).push(t); continue; }
      let arch = hasId ? archived.find((i) => sid(i.id) === sid(t.context_id)) : null;
      if (!arch && name !== "") arch = archived.find((i) => nocaseEq(i.name, name));
      if (arch) { pushArchived(arch, t); continue; }
      if (name === "") { none.push(t); continue; }
      const k = "orphan:" + nocaseKey(name);
      if (!unsyncedCols.has(k)) unsyncedCols.set(k, { name, tasks: [] });
      unsyncedCols.get(k).tasks.push(t);
    }

    const columns = [{ key: "none", kind: "none", label: "Belum ada tahap", tasks: sortCards(none) }];
    for (const i of live) {
      columns.push({
        key: "stage:" + sid(i.id), kind: "stage", label: i.name, tasks: sortCards(byStage.get(sid(i.id))),
        item: i, color: i.color == null ? null : i.color,
      });
    }
    for (const [k, v] of archivedCols) {
      columns.push({ key: k, kind: "orphan", label: v.item.name + " (diarsip)", tasks: sortCards(v.tasks), color: null });
    }
    const un = Array.from(unsyncedCols.entries()).sort((a, b) => nocaseCompare(a[1].name, b[1].name));
    for (const [k, v] of un) {
      if (archivedCols.has(k)) continue; // kunci nama sama sudah dipakai kolom diarsip
      columns.push({ key: k, kind: "orphan", label: v.name + " (belum tersinkron)", tasks: sortCards(v.tasks), color: null });
    }
    columns.push(doneColumn(opts.donePool));
    return { columns, hiddenOtherScope };
  }

  function buildPriorityBoard(opts) {
    const buckets = { P1: [], P2: [], P3: [], P4: [], "": [] };
    for (const t of opts.tasks || []) {
      const p = PRIS.indexOf(t.priority) >= 0 ? t.priority : "";
      buckets[p].push(t);
    }
    const columns = PRIS.map((p) => ({
      key: "pri:" + p, kind: "priority", label: PRI_LABELS[p], value: p, tasks: sortCards(buckets[p]),
    }));
    if (buckets[""].length) {
      columns.push({ key: "pri:", kind: "priority", label: NO_PRI_LABEL, value: "", tasks: sortCards(buckets[""]) });
    }
    columns.push(doneColumn(opts.donePool));
    return { columns };
  }

  // ---- aksi drop ----
  // Kolom project: patch ditentukan pemanggil lewat projectDropTarget(task, meta); di sini hanya columnKey.
  function dropAction(a) {
    const { task, from, to } = a;
    if (!from || !to || from.key === to.key) return { type: "none" };
    if (to.kind === "orphan") return { type: "none" };
    if (to.kind === "done") {
      if (task && task.recurrence_type) {
        return a.online ? { type: "occurrence", date: a.todayIso } : { type: "blocked", message: OFFLINE_MSG };
      }
      return { type: "done" };
    }
    let patch = null, columnKey;
    if (to.kind === "stage") patch = { context_id: to.item.id, context: to.item.name };
    else if (to.kind === "none") patch = { context_id: null, context: "" };
    else if (to.kind === "priority") patch = { priority: to.value || "" };
    else if (to.kind === "project") columnKey = to.key;
    else return { type: "none" };

    if (from.kind === "done") {
      const out = { type: "reopen", patch: Object.assign({ gtd_status: "next" }, patch || {}) };
      if (columnKey !== undefined) out.columnKey = columnKey;
      return out;
    }
    if (columnKey !== undefined) return { type: "project", columnKey };
    return { type: "patch", patch };
  }

  function moveTargets(columns, fromKey) {
    return (columns || []).filter((c) => c.key !== fromKey && c.kind !== "orphan")
      .map((c) => ({ key: c.key, label: c.label }));
  }

  // Urutan id server (tidak diarsip, scope itu) setelah item `id` digeser; null bila di ujung / tidak ada /
  // pending. Item pending tidak ikut (belum punya id server).
  function reorderIds(items, scope, id, dir) {
    const sc = scope == null ? "" : sid(scope);
    const seq = TFctx.sortItems((items || []).filter((i) => itemScope(i) === sc && !i.archived && !i.pending));
    const idx = seq.findIndex((i) => sid(i.id) === sid(id));
    if (idx < 0) return null;
    const j = idx + (dir < 0 ? -1 : 1);
    if (j < 0 || j >= seq.length) return null;
    const out = seq.map((i) => i.id);
    const tmp = out[idx]; out[idx] = out[j]; out[j] = tmp;
    return out;
  }

  const exported = {
    jktDay, tsMs, isDoneRecent, sortCards, sortDone, taskScope, scopeOptions,
    buildContextBoard, buildPriorityBoard, withDoneColumn, dropAction, moveTargets, reorderIds,
  };
  if (root && typeof root === "object") { root.TF = root.TF || {}; root.TF.kanbanboard = exported; }
  return exported;
});
