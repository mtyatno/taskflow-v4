;(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory(root);
  } else {
    root.TF = root.TF || {};
    root.TF.focusfilter = factory(root);
  }
})(typeof self !== "undefined" ? self : globalThis, function (root) {
  "use strict";

  const FILTER_KEY = "tf_focus_filter";
  const COLLAPSED_KEY = "tf_focus_collapsed";
  const MAX_COLLAPSED = 200;
  const PROJ_KEY_MAX = 300;
  const PROJ_LABEL_MAX = 120;

  // Urutan kanonis = urutan di lembar filter.
  const STATUSES = Object.freeze(["next", "inbox", "waiting", "someday"]);
  const PRIORITIES = Object.freeze(["P1", "P2", "P3", "P4"]);
  const QUADRANTS = Object.freeze(["Q1", "Q2", "Q3", "Q4"]);
  // Chip cepat selalu terlihat; sisanya (P4, Q2, Q4) hanya ada di lembar dan masuk badge.
  const QUICK_PRI = Object.freeze(["P1", "P2", "P3"]);
  const QUICK_QUAD = Object.freeze(["Q1", "Q3"]);
  const TIMES = Object.freeze(["all", "today", "late"]);

  const DEFAULT_FILTER = Object.freeze({
    time: "all",
    status: Object.freeze(["next"]),
    pri: Object.freeze([]),
    quad: Object.freeze([]),
    proj: null,
  });

  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

  // Bucket waktu dari tanggal LOKAL pemanggil (todayISO); `is_overdue` dari server sengaja
  // tidak dipakai karena bisa basi di data IndexedDB lama. Done/archived tidak pernah "late".
  function timeBucket(task, todayISO) {
    if (!task || typeof todayISO !== "string") return "none";
    const dl = task.deadline;
    if (typeof dl !== "string") return "none";
    const day = dl.slice(0, 10);
    if (!DATE_RE.test(day)) return "none";
    if (day === todayISO) return "today";
    if (day < todayISO) {
      return task.gtd_status === "done" || task.gtd_status === "archived" ? "none" : "late";
    }
    return "none";
  }

  // Cakupan "hari ini": Q1, terlambat, deadline hari ini, ditandai ⭐, atau task aktif Pomodoro.
  function inTodayScope(task, opts) {
    if (!task) return false;
    const o = opts || {};
    if (task.gtd_status === "archived") return false;
    if (task.gtd_status === "done" && !o.includeDone) return false;
    if (task.quadrant === "Q1") return true;
    if (timeBucket(task, o.todayISO) !== "none") return true;
    if (task.is_focused) return true;
    return o.focusTaskId != null && String(task.id) === String(o.focusTaskId);
  }

  // Nilai yang dikenal saja, tanpa duplikat, dalam urutan kanonis.
  function canonical(list, raw) {
    if (!Array.isArray(raw)) return null;
    return list.filter(v => raw.includes(v));
  }

  function normalizeProj(raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    if (typeof raw.key !== "string" || !raw.key || raw.key.length > PROJ_KEY_MAX) return null;
    const label = typeof raw.label === "string" ? raw.label.slice(0, PROJ_LABEL_MAX) : "";
    return { key: raw.key, label };
  }

  // Selalu mengembalikan filter baru yang valid (array tidak dibekukan, aman diubah pemanggil).
  function normalizeFilter(raw) {
    const r = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
    return {
      time: TIMES.includes(r.time) ? r.time : "all",
      status: canonical(STATUSES, r.status) || ["next"],
      pri: canonical(PRIORITIES, r.pri) || [],
      quad: canonical(QUADRANTS, r.quad) || [],
      proj: normalizeProj(r.proj),
    };
  }

  // `status` yang sudah ternormalisasi; hanya ["next"] yang default.
  function isDefaultStatus(status) {
    return Array.isArray(status) && status.length === 1 && status[0] === "next";
  }

  // Jumlah pilihan tersembunyi yang berbeda dari default (badge tombol Filter).
  function nonDefaultCount(filter) {
    const f = normalizeFilter(filter);
    let n = 0;
    if (!isDefaultStatus(f.status)) n += 1;
    if (f.proj) n += 1;
    n += f.pri.filter(p => !QUICK_PRI.includes(p)).length;
    n += f.quad.filter(q => !QUICK_QUAD.includes(q)).length;
    return n;
  }

  function isFilterDefault(filter) {
    const f = normalizeFilter(filter);
    return f.time === "all" && isDefaultStatus(f.status) && f.pri.length === 0 &&
      f.quad.length === 0 && f.proj === null;
  }

  // ---- kelompok, urutan, pembagian target/pool ----

  // Sama dengan `projectNameFold` di index.html: hanya A–Z yang dilipat (Ä tetap Ä).
  function fold(s) {
    return String(s == null ? "" : s).replace(/[A-Z]/g, c => c.toLowerCase());
  }

  // Kunci kelompok Workspace › Project; Pribadi = "p". Task tanpa project berakhiran ":".
  function groupKey(task) {
    const t = task || {};
    const scope = t.list_id == null || t.list_id === "" ? "p" : String(t.list_id);
    return scope + ":" + fold(t.project || "");
  }

  // Tanggal (YYYY-MM-DD) deadline, atau null bila kosong/tak berbentuk (sama dengan bucket "none").
  function deadlineDay(task) {
    const dl = task && task.deadline;
    if (typeof dl !== "string") return null;
    const day = dl.slice(0, 10);
    return DATE_RE.test(day) ? day : null;
  }

  // id numerik dibandingkan sebagai angka (9 sebelum 10); id teks menurut abjad.
  function compareId(a, b) {
    return String(a == null ? "" : a).localeCompare(String(b == null ? "" : b), "id", { numeric: true });
  }

  function priorityRank(task) {
    const i = PRIORITIES.indexOf(task && task.priority);
    return i < 0 ? PRIORITIES.length : i;
  }

  // P1 < P2 < P3 < P4 < lainnya → deadline terawal (tanpa deadline terakhir) → judul → id.
  function comparePriority(a, b) {
    const pr = priorityRank(a) - priorityRank(b);
    if (pr) return pr;
    const da = deadlineDay(a), db = deadlineDay(b);
    if (da !== db) {
      if (da === null) return 1;
      if (db === null) return -1;
      return da < db ? -1 : 1;
    }
    const title = String(a && a.title != null ? a.title : "")
      .localeCompare(String(b && b.title != null ? b.title : ""), "id");
    return title || compareId(a && a.id, b && b.id);
  }

  // Target = task aktif (bila ada di scope) di depan, lalu task ⭐ lain menurut comparePriority.
  // Pool = sisanya dengan urutan masuk terjaga; hanya pool yang disaring dan dikelompokkan.
  function splitTarget(scope, focusTaskId) {
    let active = null;
    const starred = [];
    const pool = [];
    for (const task of Array.isArray(scope) ? scope : []) {
      if (!task) continue;
      if (active === null && focusTaskId != null && String(task.id) === String(focusTaskId)) active = task;
      else if (task.is_focused) starred.push(task);
      else pool.push(task);
    }
    starred.sort(comparePriority);
    return { target: active ? [active, ...starred] : starred, pool };
  }

  // ---- pencocokan dan hitungan ----

  // Huruf kecil (locale id), spasi berulang dirapatkan, di-trim.
  function foldQuery(s) {
    return String(s == null ? "" : s).toLocaleLowerCase("id").replace(/\s+/g, " ").trim();
  }

  // Daftar kosong = tidak menyaring jenis itu.
  function allows(list, value) {
    return !Array.isArray(list) || list.length === 0 || list.includes(value);
  }

  // `filter` = hasil normalizeFilter (null → default). Atau di dalam satu jenis, dan antarjenis.
  // `opts.except` ("time" | "status") melewati jenis itu, untuk menghitung angka tab/status.
  function matches(task, filter, opts) {
    if (!task) return false;
    const f = filter || DEFAULT_FILTER;
    const o = opts || {};
    if (o.except !== "time" && f.time && f.time !== "all" && timeBucket(task, o.todayISO) !== f.time) return false;
    const q = foldQuery(o.query);
    if (q && !foldQuery(task.title).includes(q)) return false;
    if (o.except !== "status" && !allows(f.status, task.gtd_status)) return false;
    if (!allows(f.pri, task.priority)) return false;
    if (!allows(f.quad, task.quadrant)) return false;
    if (f.proj && groupKey(task) !== f.proj.key) return false;
    return true;
  }

  // Angka tab waktu: filter.time sendiri diabaikan; "all" termasuk task tanpa deadline.
  function timeCounts(pool, filter, opts) {
    const o = { ...opts, except: "time" };
    const counts = { all: 0, today: 0, late: 0 };
    for (const task of Array.isArray(pool) ? pool : []) {
      if (!matches(task, filter, o)) continue;
      counts.all += 1;
      const bucket = timeBucket(task, o.todayISO);
      if (bucket === "today" || bucket === "late") counts[bucket] += 1;
    }
    return counts;
  }

  // Angka chip status: filter.status sendiri diabaikan.
  function statusCounts(pool, filter, opts) {
    const o = { ...opts, except: "status" };
    const counts = { next: 0, inbox: 0, waiting: 0, someday: 0 };
    for (const task of Array.isArray(pool) ? pool : []) {
      if (matches(task, filter, o) && STATUSES.includes(task.gtd_status)) counts[task.gtd_status] += 1;
    }
    return counts;
  }

  // Task yang lolos semua filter kecuali status, tetapi tersaring oleh status.
  function hiddenByStatus(pool, filter, opts) {
    const skipStatus = { ...opts, except: "status" };
    const full = { ...opts, except: null };
    let n = 0;
    for (const task of Array.isArray(pool) ? pool : []) {
      if (matches(task, filter, skipStatus) && !matches(task, filter, full)) n += 1;
    }
    return n;
  }

  // ---- kelompok Workspace › Project ----

  function workspaceName(listId, sharedLists) {
    const list = (Array.isArray(sharedLists) ? sharedLists : [])
      .find(l => l && String(l.id) === String(listId));
    return list && typeof list.name === "string" && list.name ? list.name : "Workspace";
  }

  // Urutan: Pribadi dulu, lalu workspace menurut label (sensitivity base) lalu list_id;
  // di dalam scope, project menurut nama ter-fold (`<`/`>`) dengan "Tanpa project" terakhir.
  // Task dalam kelompok menurut comparePriority. Label project = task pertama dalam urutan masuk.
  function groupTasks(tasks, sharedLists) {
    const map = new Map();
    for (const task of Array.isArray(tasks) ? tasks : []) {
      if (!task) continue;
      const key = groupKey(task);
      let entry = map.get(key);
      if (!entry) {
        const personal = task.list_id == null || task.list_id === "";
        const folded = fold(task.project || "");
        entry = {
          personal,
          folded,
          group: {
            key,
            listId: personal ? null : task.list_id,
            workspaceLabel: personal ? "Pribadi" : workspaceName(task.list_id, sharedLists),
            projectLabel: folded === "" ? "Tanpa project" : String(task.project),
            tasks: [],
          },
        };
        map.set(key, entry);
      }
      entry.group.tasks.push(task);
    }
    const entries = [...map.values()].sort((a, b) => {
      if (a.personal !== b.personal) return a.personal ? -1 : 1;
      if (!a.personal) {
        const ws = a.group.workspaceLabel.localeCompare(b.group.workspaceLabel, "id", { sensitivity: "base" });
        if (ws) return ws;
        const id = compareId(a.group.listId, b.group.listId);
        if (id) return id;
      }
      if ((a.folded === "") !== (b.folded === "")) return a.folded === "" ? 1 : -1;
      return a.folded < b.folded ? -1 : a.folded > b.folded ? 1 : 0;
    });
    return entries.map(e => {
      e.group.tasks.sort(comparePriority);
      return e.group;
    });
  }

  // Opsi project di lembar filter: dari seluruh pool, urutan groupTasks. Project terpilih yang
  // sudah tak punya task tetap muncul di akhir dengan count 0 dan label tersimpan.
  function projectOptions(pool, sharedLists, filter) {
    const options = groupTasks(pool, sharedLists).map(g => ({
      key: g.key,
      label: g.workspaceLabel + " · " + g.projectLabel,
      count: g.tasks.length,
    }));
    const proj = filter && filter.proj;
    if (proj && typeof proj.key === "string" && !options.some(o => o.key === proj.key)) {
      options.push({ key: proj.key, label: proj.label, count: 0 });
    }
    return options;
  }

  // ---- penyimpanan per perangkat: setiap akses dibungkus try/catch, tidak pernah melempar ----

  function readFilter(storage) {
    try {
      const raw = storage.getItem(FILTER_KEY);
      return normalizeFilter(raw == null ? null : JSON.parse(raw));
    } catch (_) {
      return normalizeFilter(null);
    }
  }

  function writeFilter(storage, filter) {
    try { storage.setItem(FILTER_KEY, JSON.stringify(normalizeFilter(filter))); } catch (_) { /* abaikan */ }
  }

  // String saja, tanpa duplikat, paling banyak MAX_COLLAPSED entri (yang tertua dibuang).
  function cleanCollapsed(keys) {
    if (!Array.isArray(keys)) return [];
    const uniq = Array.from(new Set(keys.filter(k => typeof k === "string")));
    return uniq.slice(-MAX_COLLAPSED);
  }

  function readCollapsed(storage) {
    try {
      const raw = storage.getItem(COLLAPSED_KEY);
      return raw == null ? [] : cleanCollapsed(JSON.parse(raw));
    } catch (_) {
      return [];
    }
  }

  function writeCollapsed(storage, keys) {
    try { storage.setItem(COLLAPSED_KEY, JSON.stringify(cleanCollapsed(keys))); } catch (_) { /* abaikan */ }
  }

  return {
    FILTER_KEY, COLLAPSED_KEY, MAX_COLLAPSED,
    STATUSES, PRIORITIES, QUADRANTS, QUICK_PRI, QUICK_QUAD, DEFAULT_FILTER,
    timeBucket, inTodayScope,
    groupKey, comparePriority, splitTarget,
    matches, timeCounts, statusCounts, hiddenByStatus,
    groupTasks, projectOptions,
    normalizeFilter, isDefaultStatus, nonDefaultCount, isFilterDefault,
    readFilter, writeFilter, readCollapsed, writeCollapsed,
  };
});
