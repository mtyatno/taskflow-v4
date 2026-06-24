// Weekly Review digest — pure function over the in-memory tasks array.
// Loaded as a plain script before the app (exposes window.buildReview) and
// importable in Node tests (module.exports). No app/React dependencies.
function buildReview(tasks) {
  const today = new Date();
  const days = (iso) => iso ? Math.floor((today - new Date(String(iso).replace("Z",""))) / 864e5) : null;
  const active = (t) => t.gtd_status !== "done" && t.gtd_status !== "archived";
  const inbox = tasks.filter(t => t.gtd_status === "inbox");
  const overdue = tasks.filter(t => t.is_overdue && active(t));
  const doneThisWeek = tasks.filter(t => t.gtd_status === "done" && days(t.updated_at) !== null && days(t.updated_at) >= 0 && days(t.updated_at) <= 7);
  const staleNext = tasks.filter(t => t.gtd_status === "next" && days(t.updated_at) !== null && days(t.updated_at) > 7);
  const waiting = tasks.filter(t => t.gtd_status === "waiting");
  const someday = tasks.filter(t => t.gtd_status === "someday");
  const dueNextWeek = tasks.filter(t => active(t) && t.deadline && days(t.deadline) !== null && days(t.deadline) <= 0 && days(t.deadline) >= -7);
  const byProj = {};
  tasks.filter(t => active(t) && t.project).forEach(t => { (byProj[t.project] = byProj[t.project] || []).push(t); });
  const projectsNoNext = Object.entries(byProj)
    .filter(([, ts]) => !ts.some(t => t.gtd_status === "next"))
    .map(([project, ts]) => ({ project, tasks: ts }));
  return { inbox, overdue, doneThisWeek, staleNext, waiting, projectsNoNext, dueNextWeek, someday };
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = { buildReview };
} else {
  try { window.buildReview = buildReview; } catch (e) {}
}
