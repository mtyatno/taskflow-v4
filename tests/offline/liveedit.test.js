"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const le = require("../../static/offline/liveedit.js");
const indexHtml = fs.readFileSync(path.resolve(__dirname, "../../static/index.html"), "utf8").replace(/\r\n/g, "\n");
const swJs = fs.readFileSync(path.resolve(__dirname, "../../static/sw.js"), "utf8").replace(/\r\n/g, "\n");

function fakeStorage(seed) {
  const m = new Map(Object.entries(seed || {}));
  return { m, getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); } };
}
const throwing = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } };

const T = (o) => Object.assign({ id: 1, cid: "c1", title: "A", priority: "P3", gtd_status: "next" }, o);
test("konstanta", () => {
  assert.equal(le.MIN_CONTENT_WIDTH, 760); assert.equal(le.PANEL_MIN, 420); assert.equal(le.PANEL_MAX, 680);
  assert.equal(le.PANEL_RATIO, 0.5); assert.equal(le.TEXT_IDLE_MS, 1500); assert.equal(le.STORAGE_KEY, "tf_liveedit");
  assert.ok(Object.isFrozen(le.EDITABLE_FIELDS) && Object.isFrozen(le.EMPTY_SELECTION));
  assert.deepEqual([...le.EDITABLE_FIELDS], ["title", "description", "priority", "gtd_status", "project", "context",
    "deadline", "waiting_for", "assigned_to", "progress"]);
  assert.deepEqual(le.EMPTY_SELECTION, { ref: null, snapshot: null, cleared: false });
});
test("isAvailable / panelWidth", () => {
  assert.equal(le.isAvailable(759), false); assert.equal(le.isAvailable(760), true);
  assert.equal(le.panelWidth(800), 420); assert.equal(le.panelWidth(1000), 500); assert.equal(le.panelWidth(1600), 680);
});
test("readOn / writeOn", () => {
  assert.equal(le.readOn(null), false); assert.equal(le.readOn(throwing), false);
  assert.equal(le.readOn(fakeStorage({ tf_liveedit: "1" })), true); assert.equal(le.readOn(fakeStorage({ tf_liveedit: "yes" })), false);
  const s = fakeStorage(); le.writeOn(s, true); assert.equal(s.m.get("tf_liveedit"), "1"); le.writeOn(s, false); assert.equal(s.m.get("tf_liveedit"), "0");
  assert.doesNotThrow(() => le.writeOn(throwing, true));
});
test("sameTask cocok lewat cid setelah id berubah ke id server", () => {
  const ref = le.taskRef(T({ id: "c1" }));
  assert.deepEqual(ref, { id: "c1", cid: "c1" });
  assert.equal(le.sameTask(T({ id: 12, cid: "c1" }), ref), true);
  assert.equal(le.sameTask(T({ id: "12", cid: null }), { id: "12", cid: null }), true);
  assert.equal(le.sameTask(T({ id: 13, cid: "c8" }), ref), false);
  assert.equal(le.sameTask(T(), null), false);
  assert.equal(le.findTask([T({ id: 5, cid: "c5" }), T({ id: 12, cid: "c1" })], ref).id, 12);
});
test("pickInitial", () => {
  const a = T({ id: 1, cid: "a" }), b = T({ id: 2, cid: "b" }), c = T({ id: 3, cid: "c" });
  assert.deepEqual(le.pickInitial([a, b], [a, b, c], le.taskRef(c), true), le.taskRef(c));
  assert.deepEqual(le.pickInitial([a, b], [a, b, c], le.taskRef(c), false), le.taskRef(a));
  assert.deepEqual(le.pickInitial([a, b], [a, b], { id: "9", cid: "z" }, true), le.taskRef(a));
  assert.equal(le.pickInitial([], [a], null, true), null);
});
test("selectionReducer", () => {
  const a = T({ id: 1, cid: "a" }), b = T({ id: 2, cid: "b" });
  const s1 = le.selectionReducer(le.EMPTY_SELECTION, { type: "select", task: b });
  assert.deepEqual(s1, { ref: le.taskRef(b), snapshot: b, cleared: false });
  const del = le.selectionReducer(s1, { type: "deleted" });
  assert.deepEqual(del, { ref: null, snapshot: null, cleared: true });
  assert.equal(le.selectionReducer(del, { type: "init", visible: [a], all: [a], keep: true }), del, "tetap 'Pilih task di daftar'");
  assert.deepEqual(le.selectionReducer(del, { type: "init", visible: [a], all: [a], keep: false }).ref, le.taskRef(a));
  assert.deepEqual(le.selectionReducer(le.EMPTY_SELECTION, { type: "init", visible: [], all: [], keep: true }), le.EMPTY_SELECTION);
  const fresh = Object.assign({}, b, { title: "Baru" });
  assert.equal(le.selectionReducer(s1, { type: "snapshot", task: fresh }).snapshot.title, "Baru");
  assert.equal(le.selectionReducer(s1, { type: "snapshot", task: a }), s1);
});
test("selectionReducer init: pilihan yang sama (id dan cid) mengembalikan objek yang sama; aksi tak dikenal = sel", () => {
  const a = T({ id: 1, cid: "a" }), b = T({ id: 2, cid: "b" });
  const s = le.selectionReducer(le.EMPTY_SELECTION, { type: "select", task: a });
  assert.equal(le.selectionReducer(s, { type: "init", visible: [a, b], all: [a, b], keep: true }), s);
  assert.equal(le.selectionReducer(s, { type: "init", visible: [a, b], all: [a, b], keep: false }), s);
  // pilihan yang tak ada lagi di daftar -> task pertama, snapshot dari task itu
  const gone = le.selectionReducer(s, { type: "init", visible: [b], all: [b], keep: true });
  assert.deepEqual(gone, { ref: le.taskRef(b), snapshot: b, cleared: false });
  // daftar kosong setelah ada pilihan -> EMPTY_SELECTION
  assert.equal(le.selectionReducer(s, { type: "init", visible: [], all: [], keep: false }), le.EMPTY_SELECTION);
  assert.equal(le.selectionReducer(s, { type: "nope" }), s);
});
test("formFromTask / changedFields / buildPatch", () => {
  assert.deepEqual(le.formFromTask({}), { title: "", description: "", priority: "P3", gtd_status: "inbox", project: "", context: "",
    deadline: "", waiting_for: "", assigned_to: null, progress: 0 });
  const f = le.formFromTask(T({ assigned_to: null, progress: 40 }));
  assert.deepEqual(le.changedFields(f, f), []);
  assert.deepEqual(le.changedFields(f, Object.assign({}, f, { title: " A " })), []);
  assert.deepEqual(le.changedFields(f, Object.assign({}, f, { assigned_to: 0, progress: "40" })), []);
  assert.deepEqual(le.changedFields(f, Object.assign({}, f, { priority: "P1", title: "B" })), ["title", "priority"]);
  assert.deepEqual(le.buildPatch({ title: "  X  ", deadline: "", assigned_to: null, progress: "40", priority: "P1" },
    ["title", "deadline", "assigned_to", "progress"]), { title: "X", deadline: "", assigned_to: 0, progress: 40 });
});
test("saveTrigger (R1)", () => {
  for (const [f, v, want] of [["title", "x", "blur"], ["progress", 10, "blur"], ["description", "x", "idle"], ["waiting_for", "x", "idle"],
    ["project", "Alpha", "idle"], ["project", "", "blur"], ["context", "", "blur"], ["context", "Rapat", "idle"],
    ["priority", "P1", "now"], ["gtd_status", "done", "now"], ["deadline", "2026-10-30", "now"], ["assigned_to", 3, "now"]])
    assert.equal(le.saveTrigger(f, v), want, f + "=" + v);
});
test("mergeExternal: field dirty dipertahankan, lainnya ikut data baru", () => {
  const saved = le.formFromTask(T({ title: "Old" })), form = Object.assign({}, saved, { title: "Draft" });
  const out = le.mergeExternal({ form, saved }, T({ title: "Remote", priority: "P1" }));
  assert.equal(out.form.title, "Draft"); assert.equal(out.form.priority, "P1");
  assert.equal(out.saved.title, "Remote"); assert.equal(out.saved.priority, "P1");
});
test("validateTitle / isNotFound", () => {
  assert.equal(le.validateTitle("  "), "Judul tidak boleh kosong"); assert.equal(le.validateTitle("A"), null);
  assert.equal(le.isNotFound({ status: 404 }), true); assert.equal(le.isNotFound(new Error("Task not found")), true);
  assert.equal(le.isNotFound(new Error("Failed to fetch")), false);
});
test("isNotFound: pesan Indonesia, null, dan objek tanpa pesan", () => {
  assert.equal(le.isNotFound(new Error("Task tidak ditemukan")), true);
  assert.equal(le.isNotFound(null), false);
  assert.equal(le.isNotFound(undefined), false);
  assert.equal(le.isNotFound({}), false);
  assert.equal(le.isNotFound({ status: 500 }), false);
});
test("titleWithTags (R9): tag yang belum ada di judul ditambahkan sebagai #tag", () => {
  assert.equal(le.titleWithTags("Rapat", ["kantor", "Q4"]), "Rapat #kantor #Q4");
  assert.equal(le.titleWithTags("Rapat #Kantor", [{ name: "kantor" }]), "Rapat #Kantor");
  assert.equal(le.titleWithTags("  A ", []), "A");
  assert.equal(le.titleWithTags("A", null), "A");
  assert.equal(le.titleWithTags("A #kantorbaru", ["kantor"]), "A #kantorbaru #kantor");
});
test("titleWithTags (R9): tanpa duplikat, tag di tengah judul, undefined, entri kosong", () => {
  assert.equal(le.titleWithTags("A", undefined), "A");
  assert.equal(le.titleWithTags("A", ["x", "X", { name: "x" }]), "A #x");
  assert.equal(le.titleWithTags("Bahas #kantor, lalu pulang", ["kantor", "rumah"]), "Bahas #kantor, lalu pulang #rumah");
  assert.equal(le.titleWithTags("A", ["", null, {}, { name: "ok" }]), "A #ok");
  assert.doesNotThrow(() => le.titleWithTags("A", ["c++", "(x", "[y", "a.b"]), "karakter regex dalam nama tag tidak melempar");
  assert.equal(le.titleWithTags("A #aXb", ["a.b"]), "A #aXb #a.b", "titik dalam nama tag bukan wildcard");
  assert.equal(le.titleWithTags("A #kantoré", ["kantor"]), "A #kantoré #kantor", "huruf beraksen sama dengan karakter tag di server");
  assert.equal(le.titleWithTags(null, ["x"]), "#x");
});
test("dimuat di index.html setelah kanbanboard.js dan di-precache", () => {
  const i = indexHtml.indexOf('<script src="/static/offline/liveedit.js"></script>');
  assert.ok(i > indexHtml.indexOf("/static/offline/kanbanboard.js") && i < indexHtml.indexOf("/static/offline/taskroutes.js"));
  assert.match(swJs, /"\/static\/offline\/liveedit\.js",/);
});
