;(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory(root);
  } else {
    root.TF = root.TF || {};
    root.TF.emailadmin = factory(root);
  }
})(typeof self !== "undefined" ? self : globalThis, function (root) {
  "use strict";

  // Kartu "Email" di halaman Admin (fase 0b): label, badge, dan keputusan polling email tes.
  const POLL_MS = 3000;
  const POLL_MAX_MS = 30000;
  const MAX_ATTEMPTS = 5; // sama dengan email_outbox.MAX_ATTEMPTS
  const STATUS_LABELS = { sent: "Terkirim", queued: "Antre", sending: "Mengirim", failed: "Gagal", expired: "Kedaluwarsa" };
  const KIND_LABELS = { reset: "Reset password", test: "Email tes" };
  const BADGES = { sent: "ok", queued: "warn", sending: "warn", failed: "err", expired: "muted" };
  const DONE = { sent: true, failed: true, expired: true };
  const TIMEOUT_OUTCOME = Object.freeze({ type: "info", text: "Email tes masih dalam antrean" });

  function statusLabel(status) {
    if (status == null) return "";
    return Object.prototype.hasOwnProperty.call(STATUS_LABELS, status) ? STATUS_LABELS[status] : String(status);
  }

  function kindLabel(kind) {
    if (kind == null) return "";
    return Object.prototype.hasOwnProperty.call(KIND_LABELS, kind) ? KIND_LABELS[kind] : String(kind);
  }

  function badgeFor(status) {
    return Object.prototype.hasOwnProperty.call(BADGES, status) ? BADGES[status] : "muted";
  }

  // Badge mode pengiriman. worker_alive === false paling penting (email tidak akan pernah terkirim).
  function modeBadge(summary) {
    const s = summary || {};
    if (s.worker_alive === false) return { tone: "err", text: "Worker email tidak berjalan" };
    if (s.mode === "smtp") return { tone: "ok", text: `SMTP: ${s.host}:${s.port} · ${s.security}` };
    return { tone: "warn", text: "Dev mode — email hanya dicetak ke log server" };
  }

  function isPollingDone(row) {
    return !!(row && DONE[row.status]);
  }

  function formatAttempts(n) {
    const v = Number(n);
    return `${Number.isFinite(v) ? v : 0}/${MAX_ATTEMPTS}`;
  }

  // Timestamp server = ISO UTC naif (tanpa zona) → tambahkan "Z" agar Date membacanya sebagai UTC.
  function parseUtc(iso) {
    if (!iso) return null;
    let s = String(iso);
    if (!/(Z|[+-]\d\d:?\d\d)$/.test(s)) s += "Z";
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
  }

  function truncate(text, max) {
    const n = max || 60;
    if (text == null) return "";
    const s = String(text);
    return s.length > n ? s.slice(0, n - 1) + "…" : s;
  }

  function findRow(summary, id) {
    const rows = summary && Array.isArray(summary.recent) ? summary.recent : [];
    for (const r of rows) if (r && r.id === id) return r;
    return null;
  }

  // Hasil akhir email tes → { type, text } untuk toast, atau null bila belum selesai.
  function testOutcome(row) {
    if (row && row.status === "queued" && row.attempts >= 1 && row.last_error) {
      return { type: "error", text: "Email tes gagal (akan dicoba lagi): " + row.last_error };
    }
    if (!isPollingDone(row)) return null;
    if (row.status === "sent") return { type: "success", text: "Email tes terkirim" };
    return { type: "error", text: "Email tes gagal: " + (row.last_error || statusLabel(row.status)) };
  }

  return {
    POLL_MS, POLL_MAX_MS, MAX_ATTEMPTS, TIMEOUT_OUTCOME,
    statusLabel, kindLabel, badgeFor, modeBadge, isPollingDone, formatAttempts, parseUtc, truncate, findRow, testOutcome
  };
});
