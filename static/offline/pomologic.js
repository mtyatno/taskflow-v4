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

  return { POMO_SECONDS, EST_MIN, EST_MAX, clampEstimate, nextEstimate, estimateHoursLabel,
    headerSummary, sessionClientId, isOverEstimate };
});
