;(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory(root);
  } else {
    root.TF = root.TF || {};
    root.TF.pomologic = factory(root);
  }
})(typeof self !== "undefined" ? self : globalThis, function (root) {
  "use strict";

  const POMO_SECONDS = 1500;
  const EST_MIN = 1;
  const EST_MAX = 20;

  // Angka dibulatkan, dijepit 1-20; non-angka -> 1.
  function clampEstimate(n) {
    const v = Number(n);
    if (n == null || n === "" || !Number.isFinite(v)) return EST_MIN;
    return Math.min(EST_MAX, Math.max(EST_MIN, Math.round(v)));
  }

  // Klik 1-4 menetapkan nilai; klik 5 menetapkan 5 bila kurang, selain itu +1.
  function nextEstimate(current, clicked) {
    const cur = clampEstimate(current);
    if (clicked < 5) return clampEstimate(clicked);
    return cur < 5 ? 5 : clampEstimate(cur + 1);
  }

  // y pomodoro * 25 menit -> jam, dibulatkan ke 0.5 terdekat (tie naik).
  function estimateHoursLabel(y) {
    const h = Math.round((Number(y) * 25 / 60) * 2) / 2;
    return "~" + String(h) + " jam";
  }

  function headerSummary(o) {
    const count = (o && o.count) || 0;
    const done = (o && o.done) || 0;
    const estimate = (o && o.estimate) || 0;
    const tasksText = count + " tugas";
    if (count > 0) {
      return { tasksText, pomoText: done + " / " + estimate, hoursText: estimateHoursLabel(estimate) };
    }
    return { tasksText, pomoText: String(done), hoursText: null };
  }

  function sessionClientId(userId, workStartedAt) {
    return "pomo-" + userId + "-" + workStartedAt + "-s";
  }

  function isOverEstimate(done, estimate) {
    return done > estimate;
  }

  // --- Overtime ---
  const OVERTIME_CAP = 7200;
  const OVERTIME_MIN_LOG = 60;

  // Detik overtime = akumulasi + putaran berjalan, dijepit 0..OVERTIME_CAP.
  function overtimeSeconds(o) {
    const run = o.runStartedAt != null ? Math.floor((o.now - o.runStartedAt) / 1000) : 0;
    return Math.min(OVERTIME_CAP, Math.max(0, Math.floor(o.accumSec || 0) + run));
  }

  function overtimePomodoros(sec) {
    return Math.floor(sec / POMO_SECONDS);
  }

  function formatOvertime(sec) {
    const s = Math.max(0, Math.floor(sec));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const ss = s % 60;
    const p2 = (n) => (n < 10 ? "0" : "") + n;
    return "+" + (h > 0 ? h + ":" + p2(m) : p2(m)) + ":" + p2(ss);
  }

  function overtimeProgress(sec) {
    return (sec % POMO_SECONDS) / POMO_SECONDS;
  }

  function overtimeClientId(userId, workStartedAt) {
    return "pomo-" + userId + "-" + workStartedAt + "-o";
  }

  // Istirahat panjang bila hitungan sesi melewati kelipatan 4.
  function breakAfter(countBefore, countAfter) {
    return Math.floor(countAfter / 4) > Math.floor(countBefore / 4) ? "longBreak" : "shortBreak";
  }

  function overtimeLogEntry(o) {
    if (!(o.sec >= OVERTIME_MIN_LOG)) return null;
    return {
      client_id: overtimeClientId(o.userId, o.workStartedAt),
      kind: "overtime",
      pomodoros: overtimePomodoros(o.sec),
      focus_seconds: o.sec,
      log_date: o.logDate,
      ended_at: o.endedAt
    };
  }

  // Log untuk sesi yang tertinggal di tf_pomo_state hari sebelumnya.
  function staleSessionLogs(saved, ctx) {
    if (!saved || saved.date === ctx.todayISO) return [];
    const taskId = saved.sessionTaskId ?? saved.focusTaskId;
    if (taskId == null) return [];
    if (saved.phase === "overtime") {
      const start = saved.workStartedAt ?? saved.otRunStartedAt ?? saved.targetEndTime;
      if (start == null) return [];
      const sec = overtimeSeconds({ accumSec: saved.otAccumSec || 0, runStartedAt: saved.otRunStartedAt ?? null, now: ctx.now });
      const entry = overtimeLogEntry({
        sec, workStartedAt: start, userId: ctx.userId,
        logDate: saved.date, endedAt: new Date(ctx.now).toISOString()
      });
      return entry ? [{ taskId, entry }] : [];
    }
    const countdown = saved.phase == null || saved.phase === "countdown";
    if (countdown && saved.mode === "work" && saved.isRunning && saved.targetEndTime != null && saved.targetEndTime <= ctx.now) {
      const end = saved.targetEndTime;
      return [{
        taskId,
        entry: {
          client_id: sessionClientId(ctx.userId, saved.workStartedAt ?? end - POMO_SECONDS * 1000),
          kind: "session",
          pomodoros: 1,
          focus_seconds: POMO_SECONDS,
          log_date: ctx.toLocalISO(end),
          ended_at: new Date(end).toISOString()
        }
      }];
    }
    return [];
  }

  return { POMO_SECONDS, EST_MIN, EST_MAX, clampEstimate, nextEstimate, estimateHoursLabel,
    headerSummary, sessionClientId, isOverEstimate,
    OVERTIME_CAP, OVERTIME_MIN_LOG, overtimeSeconds, overtimePomodoros, formatOvertime,
    overtimeProgress, overtimeClientId, breakAfter, overtimeLogEntry, staleSessionLogs };
});
