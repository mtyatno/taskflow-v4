;(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory(root);
  } else {
    root.TF = root.TF || {};
    factory(root);
  }
})(typeof self !== "undefined" ? self : globalThis, function (root) {
  "use strict";

  // Helper murni untuk UI komentar note (hak aksi, waktu relatif, view model). Tanpa DOM.
  // commentrepo/commentanchor dibaca saat dipanggil (urutan muat di browser tidak dijamin).
  const isNode = (typeof module !== "undefined" && module.exports);
  const repo = () => (isNode ? require("./commentrepo.js") : root.TF && root.TF.commentrepo);
  const anchor = () => (isNode ? require("./commentanchor.js") : root.TF && root.TF.commentanchor);

  const MAX_QUOTE = 500;
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];

  const same = (a, b) => a != null && b != null && String(a) === String(b);

  function canEdit(c, meId) { return !!c && same(c.user_id, meId); }
  function isReplyRow(c) { return c.parent_id != null || c.parent_cid != null; }
  function canResolve(thread, meId, noteOwnerId) {
    if (!thread || isReplyRow(thread)) return false;
    return same(thread.user_id, meId) || same(noteOwnerId, meId);
  }
  function canDelete(c, meId, noteOwnerId) {
    return !!c && (same(c.user_id, meId) || same(noteOwnerId, meId));
  }

  function dayStart(ms) {
    const d = new Date(ms);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  }

  function relTime(iso, nowMs) {
    const t = Date.parse(iso);
    if (!Number.isFinite(t)) return "";
    const diff = nowMs - t;
    if (diff < 60000) return "baru saja";
    if (diff < 3600000) return Math.floor(diff / 60000) + " menit lalu";
    if (diff < 86400000) return Math.floor(diff / 3600000) + " jam lalu";
    const today = new Date(dayStart(nowMs));
    const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1).getTime();
    if (dayStart(t) === yesterday) return "kemarin";
    if (diff < 7 * 86400000) return Math.floor(diff / 86400000) + " hari lalu";
    const d = new Date(t);
    return d.getDate() + " " + MONTHS[d.getMonth()] + " " + d.getFullYear();
  }

  function initials(name) {
    const w = String(name == null ? "" : name).trim().split(/\s+/).filter(Boolean);
    if (!w.length) return "";
    if (w.length === 1) return w[0].slice(0, 2).toUpperCase();
    return (w[0][0] + w[1][0]).toUpperCase();
  }

  function mentionCandidates(listDetail, meId) {
    const d = listDetail || {};
    const out = [];
    const seen = new Set();
    const add = (u) => {
      if (!u || u.id == null) return;
      const k = String(u.id);
      if (seen.has(k) || same(u.id, meId)) return;
      seen.add(k);
      out.push({ id: u.id, username: u.username, display_name: u.display_name });
    };
    add(d.owner);
    for (const m of d.members || []) add(m);
    return out;
  }

  function normalizeQuote(text) {
    return String(text == null ? "" : text).replace(/\s+/g, " ").trim().slice(0, MAX_QUOTE);
  }

  function flags(c, ctx) {
    const code = c.sync_error && c.sync_error.code;
    return {
      canEdit: canEdit(c, ctx.meId),
      canResolve: canResolve(c, ctx.meId, ctx.noteOwnerId),
      canDelete: canDelete(c, ctx.meId, ctx.noteOwnerId),
      failed: !!c.sync_error && code !== "rejected",
      rejected: code === "rejected",
    };
  }

  function viewModel(rows, opts) {
    const o = opts || {};
    const ctx = { meId: o.meId, noteOwnerId: o.noteOwnerId };
    const R = repo();
    const hasDoc = typeof o.docText === "string";
    const threads = R.threads(rows, o.tab).map((t) => {
      const lost = hasDoc && !!t.quote && !anchor().findQuote(o.docText, t.quote);
      return Object.assign({}, t, flags(t, ctx), {
        anchorLost: lost,
        replies: (t.replies || []).map((r) => Object.assign({}, r, flags(r, ctx))),
      });
    });
    return {
      threads,
      openCount: R.threads(rows, "open").length,
      doneCount: R.threads(rows, "done").length,
    };
  }

  // Penanda sekali pakai: daftar catatan → buka panel komentar saat note dibuka.
  let pendingOpen = null;
  const OPEN_TTL_MS = 30000;
  function requestOpen(noteId) {
    pendingOpen = noteId == null ? null : { id: String(noteId), at: Date.now() };
    if (pendingOpen && typeof window !== "undefined" && window && typeof window.dispatchEvent === "function" && typeof CustomEvent === "function") {
      try { window.dispatchEvent(new CustomEvent("tf:comments-open", { detail: { noteId: pendingOpen.id } })); } catch (_) {}
    }
  }
  function consumeOpen(noteId, nowMs) {
    if (pendingOpen === null || pendingOpen.id !== String(noteId)) return false;
    const fresh = (nowMs == null ? Date.now() : nowMs) - pendingOpen.at <= OPEN_TTL_MS;
    pendingOpen = null;
    return fresh;
  }

  const exported = {
    canEdit, canResolve, canDelete, relTime, initials, mentionCandidates, normalizeQuote,
    viewModel, requestOpen, consumeOpen,
  };
  if (root && typeof root === "object") { root.TF = root.TF || {}; root.TF.commentui = exported; }
  return exported;
});
