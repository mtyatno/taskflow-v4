;(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory(root);
  } else {
    root.TF = root.TF || {};
    factory(root);
  }
})(typeof self !== "undefined" ? self : globalThis, function (root) {
  "use strict";

  // Logika murni hero Dashboard (spec docs/superpowers/specs/2026-10-27-hero-dashboard-design.md §3).

  // Habit dengan streak terbesar (> 0); seri -> yang pertama di urutan masukan.
  function bestStreak(habits) {
    if (!Array.isArray(habits)) return null;
    let best = null;
    for (const h of habits) {
      const s = Number(h && h.streak) || 0;
      if (s > 0 && (!best || s > best.days)) best = { days: s, title: h.title || h.name || "Habit" };
    }
    return best;
  }

  // Urutan chip: belum dicentang di fase sekarang, belum dicentang lainnya, dilewati, lalu selesai.
  function habitChips(habits, phase, limit) {
    const list = Array.isArray(habits) ? habits : [];
    const n = limit == null ? 3 : limit;
    const now = [], other = [], skipped = [], done = [];
    for (const h of list) {
      if (!h) continue;
      const isDone = h.today_status === "done";
      const isSkipped = h.today_status === "skipped";
      const item = Object.assign({}, h, { done: isDone, skipped: isSkipped });
      if (isDone) done.push(item);
      else if (isSkipped) skipped.push(item);
      else if (h.phase === phase) now.push(item);
      else other.push(item);
    }
    const all = now.concat(other, skipped, done);
    return { shown: all.slice(0, n), more: Math.max(0, all.length - n) };
  }

  // action null saat Pomodoro menunggu pilihan (istirahat/lanjut) atau sedang istirahat:
  // tombol Mulai/Jeda di hero di fase itu membingungkan; pengguna diarahkan ke Fokus Hari Ini.
  function focusChip(focusTask, timer) {
    if (!focusTask) return { kind: "invite", title: null, action: null };
    let action = timer && timer.isRunning ? "pause" : "start";
    if (timer && (timer.phase === "awaiting" || timer.isBreak)) action = null;
    return { kind: "active", title: focusTask.title || "", action };
  }

  const exported = { bestStreak, habitChips, focusChip };
  if (root && typeof root === "object") { root.TF = root.TF || {}; root.TF.hero = exported; }
  return exported;
});
