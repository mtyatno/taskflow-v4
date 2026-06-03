;(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory(root);
  } else {
    root.TF = root.TF || {};
    factory(root);
  }
})(typeof self !== "undefined" ? self : globalThis, function (root) {
  "use strict";

  const IMPORTANCE_MAP = { P1: 10, P2: 7, P3: 4, P4: 1 };
  const IMPORTANCE_DEFAULT = 4;
  const IMPORTANCE_THRESHOLD = 5;
  const URGENCY_THRESHOLD = 5;
  const URGENCY_NO_DEADLINE = 2;
  const URGENCY_OVERDUE = 10;
  // [maxDays, score] — first bracket whose maxDays >= days_left wins.
  const URGENCY_BRACKETS = [[0, 10], [1, 9], [3, 7], [7, 5], [14, 3], [30, 2]];

  function parseDateUTC(iso) {
    // iso is "YYYY-MM-DD" (date-only). Build a UTC midnight timestamp to avoid TZ/DST drift.
    const [y, m, day] = String(iso).slice(0, 10).split("-").map(Number);
    return Date.UTC(y, m - 1, day);
  }

  // Whole calendar days between two YYYY-MM-DD dates: (deadline - today).
  function daysUntil(deadlineISO, todayISO) {
    return Math.round((parseDateUTC(deadlineISO) - parseDateUTC(todayISO)) / 86400000);
  }

  function todayLocalISO() {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, "0");
    const d = String(now.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  function urgencyScore(deadlineISO, todayISO) {
    if (!deadlineISO) return URGENCY_NO_DEADLINE;
    const daysLeft = daysUntil(deadlineISO, todayISO);
    if (daysLeft < 0) return URGENCY_OVERDUE;
    for (const [maxDays, score] of URGENCY_BRACKETS) {
      if (daysLeft <= maxDays) return score;
    }
    return 1;
  }

  function calculateQuadrant(task, todayISO) {
    const today = todayISO || todayLocalISO();
    const importance = IMPORTANCE_MAP[task.priority] != null
      ? IMPORTANCE_MAP[task.priority]
      : IMPORTANCE_DEFAULT;
    const important = importance >= IMPORTANCE_THRESHOLD;
    const urgent = urgencyScore(task.deadline, today) >= URGENCY_THRESHOLD;
    if (urgent && important) return "Q1";
    if (important && !urgent) return "Q2";
    if (urgent && !important) return "Q3";
    return "Q4";
  }

  function deriveTaskFields(task, todayISO) {
    const today = todayISO || todayLocalISO();
    let daysLeft = null;
    let isOverdue = false;
    if (task.deadline) {
      daysLeft = daysUntil(task.deadline, today);
      isOverdue = daysLeft < 0 && task.gtd_status !== "done" && task.gtd_status !== "archived";
    }
    return { days_until_deadline: daysLeft, is_overdue: isOverdue };
  }

  const exported = { calculateQuadrant, deriveTaskFields };
  if (root && typeof root === "object") { root.TF = root.TF || {}; root.TF.tasklogic = exported; }
  return exported;
});
