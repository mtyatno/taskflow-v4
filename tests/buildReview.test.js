const test = require("node:test");
const assert = require("node:assert");
const { buildReview, plusDaysISO, computeHealthScore, healthBand } = require("../static/review/digest.js"); // the one real module

const ago = (d) => new Date(Date.now() - d * 864e5).toISOString();

const tasks = [
  { id: 1, gtd_status: "inbox", title: "a" },
  { id: 2, gtd_status: "next", title: "b", is_overdue: true, deadline: "2000-01-01" },
  { id: 3, gtd_status: "next", title: "c", updated_at: ago(10) },
  { id: 4, gtd_status: "waiting", title: "d" },
  { id: 5, gtd_status: "someday", title: "e" },
  { id: 6, gtd_status: "done", title: "f", updated_at: ago(2) },
  { id: 7, gtd_status: "inbox", title: "g", project: "P" },
];

test("buildReview buckets", () => {
  const r = buildReview(tasks);
  assert.equal(r.inbox.length, 2);
  assert.equal(r.overdue.length, 1);
  assert.equal(r.staleNext.length, 1);
  assert.equal(r.waiting.length, 1);
  assert.equal(r.someday.length, 1);
  assert.equal(r.doneThisWeek.length, 1);
  assert.ok(r.projectsNoNext.some((p) => p.project === "P"));
});

test("plusDaysISO adds days and formats YYYY-MM-DD", () => {
  const base = new Date("2026-06-25T10:00:00");
  assert.equal(plusDaysISO(7, base), "2026-07-02");
  assert.equal(plusDaysISO(0, base), "2026-06-25");
  assert.match(plusDaysISO(7), /^\d{4}-\d{2}-\d{2}$/);
});

test("computeHealthScore clean board is 100 / Tenang", () => {
  const s = computeHealthScore({ overdue: 0, active: 10, p1_overdue: 0, projects_without_next: 0, stale_next: 0 });
  assert.equal(s, 100);
  assert.equal(healthBand(s).label, "Tenang");
});

test("computeHealthScore penalizes overdue/P1/stalled and clamps", () => {
  const s = computeHealthScore({ overdue: 20, active: 25, p1_overdue: 5, projects_without_next: 3, stale_next: 5 });
  // 100 - min(40,round(40*20/25=32))=32 - min(24,40)=24 - min(18,18)=18 - min(10,10)=10 => 16
  assert.equal(s, 16);
  assert.equal(healthBand(s).label, "Genting");
  const floor = computeHealthScore({ overdue: 100, active: 1, p1_overdue: 99, projects_without_next: 99, stale_next: 99 });
  assert.equal(floor, 0);
});

test("healthBand boundaries", () => {
  assert.equal(healthBand(80).label, "Tenang");
  assert.equal(healthBand(79).label, "Waspada");
  assert.equal(healthBand(50).label, "Waspada");
  assert.equal(healthBand(49).label, "Genting");
});
