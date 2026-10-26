;(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory(root);
  } else {
    root.TF = root.TF || {};
    root.TF.taskdetail = factory(root);
  }
})(typeof self !== "undefined" ? self : globalThis, function (root) {
  "use strict";

  // Redesain detail task: logika murni (tab awal, terlambat, format tanggal, opsi, nama tag, posisi popover).
  // Spec docs/superpowers/specs/2026-10-26-redesain-detail-task-design.md §7. Tanpa DOM/React.

  const isNode = typeof module !== "undefined" && module.exports;
  const TL = () => (isNode ? require("./tasklogic.js") : root.TF && root.TF.tasklogic);

  const TAB_ORDER = Object.freeze(["subtask", "checklist", "notes", "attachments"]);
  const PROGRESS_PRESETS = Object.freeze([0, 25, 50, 75, 100]);
  const STATUS_ORDER = Object.freeze(["inbox", "next", "waiting", "someday", "done"]);
  const PRIORITY_ORDER = Object.freeze(["P1", "P2", "P3", "P4"]);
  const MONTHS_SHORT = Object.freeze(["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"]);
  const TAG_EMPTY = "Tulis nama tag";
  const TAG_INVALID = "Tag hanya boleh huruf, angka, dan _";

  const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})/;

  function initialTab(counts) {
    const c = counts || {};
    for (const k of TAB_ORDER) if (Number(c[k]) > 0) return k;
    return "subtask";
  }

  function isOverdue(deadline, status, todayISO) {
    if (!deadline) return false;
    return !!TL().deriveTaskFields({ deadline, gtd_status: status }, todayISO).is_overdue;
  }

  function parts(iso) {
    const m = DATE_RE.exec(typeof iso === "string" ? iso : "");
    if (!m) return null;
    const mo = Number(m[2]);
    if (mo < 1 || mo > 12) return null;
    return { y: m[1], mon: MONTHS_SHORT[mo - 1], d: Number(m[3]) };
  }

  function formatCreated(iso) {
    const p = parts(iso);
    return p ? `${p.d} ${p.mon} ${p.y}` : "";
  }
  const formatDeadline = formatCreated;

  function formatShortDate(iso, todayISO) {
    const p = parts(iso);
    if (!p) return "";
    const t = parts(todayISO);
    return t && t.y === p.y ? `${p.d} ${p.mon}` : `${p.d} ${p.mon} ${p.y}`;
  }

  function filterOptions(options, query) {
    const list = Array.isArray(options) ? options : [];
    const q = String(query == null ? "" : query).trim().toLowerCase();
    if (!q) return list.slice();
    return list.filter(o => String(o).toLowerCase().includes(q));
  }

  function exactOption(query, options) {
    const q = String(query == null ? "" : query).trim().toLowerCase();
    if (!q || !Array.isArray(options)) return null;
    const hit = options.find(o => String(o).toLowerCase() === q);
    return hit === undefined ? null : hit;
  }

  function canCreate(query, options) {
    const q = String(query == null ? "" : query).trim();
    return !!q && exactOption(q, options) === null;
  }

  function normalizeTagName(raw) {
    const name = String(raw == null ? "" : raw).trim().replace(/^#+/, "").trim();
    if (!name) return { error: TAG_EMPTY };
    if (!/^[A-Za-z0-9_À-ɏ]+$/.test(name)) return { error: TAG_INVALID };
    return { name };
  }

  function clampProgress(v) {
    let n = Number(v);
    if (!Number.isFinite(n)) n = 0;
    return Math.min(100, Math.max(0, Math.round(n / 5) * 5));
  }

  function popoverPosition({ anchor, size, viewport }) {
    const vw = viewport.width, vh = viewport.height;
    const width = vw < 640 ? vw - 16 : Math.min(320, vw - 16);
    const cap = Math.min(420, Math.floor(vh * 0.7));
    const h = Math.min(size.height, cap);
    const below = vh - anchor.bottom - 4 - 8;
    const above = anchor.top - 4 - 8;
    const placement = (below >= h || below >= above) ? "below" : "above";
    const maxHeight = Math.max(0, Math.min(cap, placement === "below" ? below : above));
    const top = placement === "below" ? anchor.bottom + 4 : anchor.top - 4 - Math.min(h, maxHeight);
    const left = vw < 640 ? 8 : Math.min(Math.max(anchor.left, 8), vw - 8 - width);
    return { top, left, width, maxHeight, placement };
  }

  return {
    TAB_ORDER, PROGRESS_PRESETS, MONTHS_SHORT, STATUS_ORDER, PRIORITY_ORDER, TAG_EMPTY, TAG_INVALID,
    initialTab, isOverdue, formatCreated, formatDeadline, formatShortDate,
    filterOptions, exactOption, canCreate, normalizeTagName, clampProgress, popoverPosition,
  };
});
