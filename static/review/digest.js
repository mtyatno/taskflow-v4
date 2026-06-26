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

function plusDaysISO(n, base) {
  const d = base ? new Date(base) : new Date();
  d.setDate(d.getDate() + n);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

function computeHealthScore(m) {
  const active = Math.max(1, m.active || 0);
  let score = 100;
  score -= Math.min(40, Math.round(40 * (m.overdue || 0) / active));
  score -= Math.min(24, 8 * (m.p1_overdue || 0));
  score -= Math.min(18, 6 * (m.projects_without_next || 0));
  score -= Math.min(10, 2 * (m.stale_next || 0));
  return Math.max(0, Math.min(100, score));
}

function healthBand(score) {
  if (score >= 80) return { label: "Tenang", color: "#16a34a" };
  if (score >= 50) return { label: "Waspada", color: "#f59e0b" };
  return { label: "Genting", color: "#dc2626" };
}

function buildActionQueue(tasks, cap) {
  const limit = cap || 15;
  const today = new Date();
  const days = (iso) => iso ? Math.floor((today - new Date(String(iso).replace("Z", ""))) / 864e5) : null;
  const active = (t) => t.gtd_status !== "done" && t.gtd_status !== "archived";
  const byDeadline = (a, b) => String(a.deadline || "").localeCompare(String(b.deadline || ""));
  const seen = new Set();
  const items = [];
  const push = (t, type) => { if (!seen.has(t.id)) { seen.add(t.id); items.push({ task: t, type }); } };
  tasks.filter(t => t.is_overdue && active(t)).sort(byDeadline).forEach(t => push(t, "overdue"));
  tasks.filter(t => active(t) && !t.is_overdue && t.deadline && days(t.deadline) !== null && days(t.deadline) <= 0 && days(t.deadline) >= -7)
    .sort(byDeadline).forEach(t => push(t, "due_soon"));
  tasks.filter(t => active(t) && (t.priority === "P1" || t.quadrant === "Q1")).forEach(t => push(t, "priority"));
  tasks.filter(t => t.gtd_status === "inbox").forEach(t => push(t, "inbox"));
  const byProj = {};
  tasks.filter(t => active(t) && t.project).forEach(t => { (byProj[t.project] = byProj[t.project] || []).push(t); });
  const stalled = Object.entries(byProj)
    .filter(([, ts]) => !ts.some(t => t.gtd_status === "next"))
    .map(([project]) => ({ project, type: "stalled_project" }));
  const all = items.concat(stalled);
  return { items: all.slice(0, limit), overflow: Math.max(0, all.length - limit) };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { buildReview, plusDaysISO, computeHealthScore, healthBand, buildActionQueue };
} else {
  try {
    window.buildReview = buildReview; window.plusDaysISO = plusDaysISO;
    window.computeHealthScore = computeHealthScore; window.healthBand = healthBand;
    window.buildActionQueue = buildActionQueue;
  } catch (e) {}
}
