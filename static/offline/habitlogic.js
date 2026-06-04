;(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory(root);
  } else {
    root.TF = root.TF || {};
    factory(root);
  }
})(typeof self !== "undefined" ? self : globalThis, function (root) {
  "use strict";

  function todayJkt(nowMs) {
    const ms = (nowMs != null ? nowMs : Date.now()) + 7 * 3600 * 1000;
    return new Date(ms).toISOString().slice(0, 10);
  }
  function addDays(dateStr, n) {
    const [y, m, d] = String(dateStr).slice(0, 10).split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d) + n * 86400000).toISOString().slice(0, 10);
  }
  function weekDates(todayStr) {
    const [y, m, d] = String(todayStr).split("-").map(Number);
    const dow = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
    const monday = addDays(todayStr, -dow);
    const out = [];
    for (let i = 0; i < 7; i++) out.push(addDays(monday, i));
    return out;
  }
  function deriveToday(habit, logsByDate, todayStr) {
    const wk = weekDates(todayStr);
    const week_log = wk.map((dt) => (logsByDate[dt] ? logsByDate[dt].status : null));
    const todayLog = logsByDate[todayStr];
    let streak = 0;
    let cur = todayStr;
    while (true) {
      const log = logsByDate[cur];
      if (log && log.status === "done") { streak++; cur = addDays(cur, -1); }
      else if (log && log.status === "skipped") { cur = addDays(cur, -1); }
      else break;
    }
    return {
      today_status: todayLog ? todayLog.status : null,
      skip_reason: todayLog ? (todayLog.skip_reason || "") : "",
      streak: streak,
      week_log: week_log,
    };
  }
  function monthly(logs, year, month, todayDay) {
    const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const prefix = `${year}-${String(month).padStart(2, "0")}`;
    const doneByDay = {};
    for (const l of (logs || [])) {
      if (l.status !== "done") continue;
      if (String(l.date).slice(0, 7) !== prefix) continue;
      const day = Number(String(l.date).slice(8, 10));
      doneByDay[day] = (doneByDay[day] || 0) + 1;
    }
    const days = [];
    for (let d = 1; d <= daysInMonth; d++) days.push({ day: d, done: doneByDay[d] || 0 });
    const withData = days.filter((r) => r.day <= todayDay);
    const sum = withData.reduce((s, r) => s + r.done, 0);
    const avg = withData.length ? Math.round((sum / withData.length) * 10) / 10 : 0;
    return { days: days, avg: avg, today_day: todayDay, days_in_month: daysInMonth };
  }

  const exported = { todayJkt, weekDates, deriveToday, monthly, addDays };
  if (root && typeof root === "object") { root.TF = root.TF || {}; root.TF.habitlogic = exported; }
  return exported;
});
