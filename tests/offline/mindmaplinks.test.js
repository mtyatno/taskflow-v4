"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const L = require("../../static/offline/mindmaplinks.js");
const MO = require("../../static/offline/mindmapoutline.js");
const { mindmaptabs: MT } = require("../../static/offline/mindmaptabs.js");

const tree = { id: "root", topic: "R", children: [
  { id: "a", topic: "A", links: [{ type: "task", id: "u-1", title: "Lama", priority: "P3" }, { type: "note", id: 7, title: "N" }], children: [
    { id: "b", topic: "B", links: [{ type: "task", id: "u-1", title: "Lama" }, { type: "mindmap", id: "m9", title: "Peta" }] }] }] };

test("collectLinkRefs is unique per type:id", () => {
  assert.deepEqual(L.collectLinkRefs(tree).map(L.linkKey), ["task:u-1", "note:7", "mindmap:m9"]);
});

test("resolveLinkInfo reads local routes; failures → null", async () => {
  const get = (url) => {
    if (url === "/api/tasks/u-1") return Promise.resolve({ id: 3, title: "Baru", priority: "P1", deadline: "2026-10-20T00:00:00", gtd_status: "done" });
    if (url === "/api/scratchpad/7") return Promise.resolve({ id: 7, title: "Catatan", content: "  isi panjang " + "x".repeat(100) });
    return Promise.reject(new Error("Mindmap not found"));
  };
  const info = await L.resolveLinkInfo(L.collectLinkRefs(tree), get);
  assert.deepEqual(info["task:u-1"], { type: "task", title: "Baru", priority: "P1", deadline: "2026-10-20T00:00:00", status: "done", done: true });
  assert.equal(info["note:7"].title, "Catatan");
  assert.ok(info["note:7"].preview.endsWith("…") && info["note:7"].preview.length <= 81);
  assert.equal(info["mindmap:m9"], null);
});

test("linkDisplay: live info wins, snapshot fallback is marked not live", () => {
  const link = { type: "task", id: "u-1", title: "Lama", priority: "P3", deadline: "2026-10-01", status: "next" };
  assert.deepEqual(L.linkDisplay(link, { type: "task", title: "Baru", priority: "P1", deadline: "2026-10-20T00:00:00", status: "done", done: true }),
    { title: "Baru", meta: "P1 · Due 2026-10-20 · Selesai", live: true, stale: false, done: true });
  assert.deepEqual(L.linkDisplay(link, null), { title: "Lama", meta: "P3 · Due 2026-10-01 · Next", live: false, stale: true, done: false });
  assert.deepEqual(L.linkDisplay({ type: "mindmap", id: 1, title: "" }, null), { title: "(tanpa judul)", meta: "", live: false, stale: true, done: false });
});

test("linkDisplay: undefined info = pending (snapshot, not stale); null = unavailable (stale)", () => {
  const link = { type: "task", id: "u-1", title: "Lama", status: "archived" };
  const pending = L.linkDisplay(link, undefined);
  assert.equal(pending.live, false);
  assert.equal(pending.stale, false);
  assert.equal(pending.title, "Lama");
  assert.equal(pending.meta, "Arsip");
  assert.equal(pending.done, true);
  const gone = L.linkDisplay(link, null);
  assert.equal(gone.live, false);
  assert.equal(gone.stale, true);
});

test("STATUS_LABEL matches spec (archived → Arsip; others as-is)", () => {
  assert.deepEqual(L.STATUS_LABEL, { inbox: "Inbox", next: "Next", waiting: "Waiting", someday: "Someday", done: "Selesai", archived: "Arsip" });
  assert.equal(L.linkDisplay({ type: "task", id: 1, title: "T", status: "project" }, undefined).meta, "project");
});

test("filterExistingTargets matches id or client_id", () => {
  const res = { notes: [{ id: 7, client_id: "n-7" }, { id: 8 }], tasks: [{ id: 3, client_id: "u-1" }], mindmaps: [{ id: 9, client_id: "m9" }] };
  const out = MO.filterExistingTargets(res, [{ type: "note", id: 7 }, { type: "task", id: "u-1" }, { type: "mindmap", id: "m9" }]);
  assert.deepEqual([out.notes.map((n) => n.id), out.tasks, out.mindmaps], [[8], [], []]);
});

test("localLinkSearch passes client_id through", () => {
  const out = MO.localLinkSearch("peta", { mindmaps: [{ id: 1, title: "Peta A", client_id: "c1" }] });
  assert.equal(out.mindmaps[0].client_id, "c1");
});

test("filterSidebar: title query + workspace filter", () => {
  const list = [{ id: 1, title: "Pribadi A", list_id: null }, { id: 2, title: "Tim A", list_id: 4 }, { id: 3, title: "Tim B", list_id: 5 }];
  assert.deepEqual(MT.filterSidebar(list, { q: "", filter: null }).map((m) => m.id), [1, 2, 3]);
  assert.deepEqual(MT.filterSidebar(list, { q: "", filter: "personal" }).map((m) => m.id), [1]);
  assert.deepEqual(MT.filterSidebar(list, { q: "a", filter: "4" }).map((m) => m.id), [2]);
  assert.deepEqual(MT.filterSidebar(list, { q: "TIM", filter: null }).map((m) => m.id), [2, 3]);
});
