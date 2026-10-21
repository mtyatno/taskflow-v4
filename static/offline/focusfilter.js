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
    normalizeFilter, isDefaultStatus, nonDefaultCount, isFilterDefault,
    readFilter, writeFilter, readCollapsed, writeCollapsed,
  };
});
