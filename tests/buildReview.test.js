const test = require("node:test");
const assert = require("node:assert");
const { buildReview } = require("../static/review/digest.js"); // the one real module

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
