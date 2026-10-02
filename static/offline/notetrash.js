;(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory(root);
  } else {
    root.TF = root.TF || {};
    factory(root);
  }
})(typeof self !== "undefined" ? self : globalThis, function (root) {
  "use strict";

  // Sampah note (Trash & Restore) — teks UI & logika label murni untuk NoteTrashModal (index.html).
  // Data dari GET /api/scratchpad/trash: [{id,title,preview,tags,list_id,deleted_at,days_left}].

  const CONFIRM_MOVE = "Pindahkan catatan ini ke Sampah? Bisa dipulihkan dalam 30 hari.";
  const TOAST_MOVED = "🗑 Dipindahkan ke Sampah";
  const TOAST_RESTORED = "♻️ Catatan dipulihkan";
  const OFFLINE_MSG = "Perlu koneksi internet untuk melihat Sampah";
  const CONFIRM_PURGE = "Hapus catatan ini secara permanen? Tindakan ini tidak bisa dibatalkan.";
  const CONFIRM_EMPTY = "Kosongkan Sampah? Semua catatan di Sampah akan dihapus permanen.";
  const DAY_MS = 86400000;

  // Jumlah hari penuh sejak deleted_at (ISO bertimezone). Tidak pernah negatif; input buruk → 0.
  function daysAgo(deletedAt, now) {
    if (!deletedAt) return 0;
    const t = new Date(deletedAt).getTime();
    if (isNaN(t)) return 0;
    const n = (now instanceof Date ? now : new Date()).getTime();
    return Math.max(0, Math.floor((n - t) / DAY_MS));
  }

  function deletedAgoLabel(deletedAt, now) {
    const d = daysAgo(deletedAt, now);
    return d === 0 ? "dihapus hari ini" : `dihapus ${d} hari lalu`;
  }

  function daysLeftLabel(daysLeft) {
    const d = Number(daysLeft);
    return d > 0 ? `sisa ${d} hari` : "dihapus permanen hari ini";
  }

  function isExpiringSoon(daysLeft) {
    return !(Number(daysLeft) > 3);
  }

  function titleLabel(item) {
    const t = item && typeof item.title === "string" ? item.title.trim() : "";
    return t || "(tanpa judul)";
  }

  // Hanya navigator.onLine === false yang dianggap offline (sama dengan schedulePush/isOfflineErr).
  function isOnline(nav) {
    return !(nav && nav.onLine === false);
  }

  // "offline" | "loading" | "error" | "empty" | "list" — offline didahulukan: Sampah tidak dimuat sama sekali.
  function trashViewState(s) {
    if (!s || s.online === false) return "offline";
    if (s.loading) return "loading";
    if (s.error) return "error";
    return (s.items && s.items.length) ? "list" : "empty";
  }

  const exported = {
    CONFIRM_MOVE, TOAST_MOVED, TOAST_RESTORED, OFFLINE_MSG, CONFIRM_PURGE, CONFIRM_EMPTY,
    daysAgo, deletedAgoLabel, daysLeftLabel, isExpiringSoon, titleLabel, isOnline, trashViewState,
  };
  if (root && typeof root === "object") { root.TF = root.TF || {}; root.TF.notetrash = exported; }
  return exported;
});
