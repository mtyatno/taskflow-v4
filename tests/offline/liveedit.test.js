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
test("saveTrigger (R1, R19: project/context selalu blur)", () => {
  for (const [f, v, want] of [["title", "x", "blur"], ["progress", 10, "blur"], ["description", "x", "idle"], ["waiting_for", "x", "idle"],
    ["project", "Alpha", "blur"], ["project", "", "blur"], ["project", "   ", "blur"], ["context", "", "blur"], ["context", "Rapat", "blur"],
    ["priority", "P1", "now"], ["gtd_status", "done", "now"], ["deadline", "2026-10-30", "now"], ["assigned_to", 3, "now"]])
    assert.equal(le.saveTrigger(f, v), want, f + "=" + v);
});
test("mergeExternal: field dirty dipertahankan, lainnya ikut data baru", () => {
  const saved = le.formFromTask(T({ title: "Old" })), form = Object.assign({}, saved, { title: "Draft" });
  const out = le.mergeExternal({ form, saved }, T({ title: "Remote", priority: "P1" }));
  assert.equal(out.form.title, "Draft"); assert.equal(out.form.priority, "P1");
  assert.equal(out.saved.title, "Remote"); assert.equal(out.saved.priority, "P1");
});
test("mergeExternal: spasi di ujung judul yang sedang diketik tidak hilang (dirty = perbandingan mentah)", () => {
  const saved = le.formFromTask(T({ title: "Rapat" }));
  const form = Object.assign({}, saved, { title: "Rapat " });
  const out = le.mergeExternal({ form, saved }, T({ title: "Rapat", priority: "P1" }));
  assert.equal(out.form.title, "Rapat ");
  assert.equal(out.form.priority, "P1", "field yang tidak dirty tetap ikut data baru");
  assert.equal(out.saved.title, "Rapat");
  // changedFields (jalur simpan) tetap membandingkan judul setelah trim
  assert.deepEqual(le.changedFields(saved, form), []);
  // tanpa state / incoming kosong tidak melempar
  assert.doesNotThrow(() => le.mergeExternal(null, null));
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

// ---- createAutosaver (Task 4) ----
function timers() { let q = []; return { set: (fn, ms) => { const h = { fn, ms }; q.push(h); return h; },
  clear: h => { q = q.filter(x => x !== h); }, run: () => { const c = q; q = []; c.forEach(h => h.fn()); }, get q() { return q; } }; }
function deferred() { let res, rej; const p = new Promise((a, b) => { res = a; rej = b; }); return { p, res, rej }; }
function mk(task, putImpl) {
  const t = timers(), calls = [], states = [];
  const s = le.createAutosaver({ task, put: patch => { calls.push(patch); return putImpl ? putImpl(patch) : Promise.resolve(undefined); },
    onChange: st => states.push(st.saveState), setTimer: t.set, clearTimer: t.clear });
  return { s, t, calls, states };
}
const tick = () => new Promise(r => setImmediate(r));

test("dibuka tanpa diubah: flush tidak memanggil put", async () => { const { s, calls } = mk(T()); await s.flush(); assert.equal(calls.length, 0); });
test("pilihan langsung tersimpan", async () => {
  const { s, calls, states } = mk(T()); s.change("priority", "P1"); await tick();
  assert.deepEqual(calls, [{ priority: "P1" }]); assert.deepEqual(states.slice(-2), ["saving", "saved"]);
});
test("deskripsi menunggu idle 1500, ketik lagi mengulang timer, commit langsung", async () => {
  const { s, t, calls } = mk(T()); s.change("description", "x"); s.change("description", "xy");
  assert.equal(calls.length, 0); assert.equal(t.q.length, 1); assert.equal(t.q[0].ms, 1500);
  t.run(); await tick(); assert.deepEqual(calls, [{ description: "xy" }]);
  s.change("description", "xyz"); s.commit("description"); await tick();
  assert.equal(t.q.length, 0); assert.deepEqual(calls[1], { description: "xyz" });
});
test("judul hanya saat commit; kosong → titleError, revertTitle", async () => {
  const { s, t, calls } = mk(T({ title: "Lama" })); s.change("title", "Baru"); assert.equal(t.q.length, 0); assert.equal(calls.length, 0);
  s.commit("title"); await tick(); assert.deepEqual(calls, [{ title: "Baru" }]);
  s.change("title", "  "); s.commit("title"); await tick();
  assert.equal(calls.length, 1); assert.equal(s.getState().titleError, "Judul tidak boleh kosong");
  s.revertTitle(); assert.equal(s.getState().form.title, "Baru"); assert.equal(s.getState().titleError, null);
});
test("judul dengan #tag mengikuti respons", async () => {
  const { s } = mk(T(), () => Promise.resolve({ title: "Rapat" })); s.change("title", "Rapat #kantor"); s.commit("title"); await tick();
  assert.equal(s.getState().saved.title, "Rapat"); assert.equal(s.getState().form.title, "Rapat");
});
test("satu simpan berjalan; perubahan saat berjalan dikirim sekali sesudahnya", async () => {
  const d = deferred(); let n = 0; const { s, calls } = mk(T(), () => (n++ === 0 ? d.p : Promise.resolve()));
  s.change("priority", "P1"); s.change("priority", "P2"); assert.equal(calls.length, 1);
  d.res(); await tick(); await tick(); assert.deepEqual(calls, [{ priority: "P1" }, { priority: "P2" }]);
});
test("gagal → error, form tetap, retry", async () => {
  let fail = true; const { s, calls } = mk(T(), () => (fail ? Promise.reject(new Error("Gagal terhubung ke server")) : Promise.resolve()));
  s.change("title", "Rapat"); s.commit("title"); await tick();
  const st = s.getState(); assert.equal(st.saveState, "error"); assert.match(st.error, /terhubung/); assert.equal(st.form.title, "Rapat"); assert.equal(st.saved.title, "A");
  fail = false; s.change("title", "Benar #x"); await s.retry(); assert.equal(calls.length, 2); assert.equal(s.getState().saveState, "saved");
});
test("flush mengirim perubahan idle yang tertunda dan membatalkan timer", async () => {
  const { s, t, calls } = mk(T()); s.change("description", "draf"); await s.flush();
  assert.deepEqual(calls, [{ description: "draf" }]); assert.equal(t.q.length, 0);
});
test("perubahan luar saat simpan berjalan", async () => {
  const d = deferred(); const { s, calls } = mk(T({ title: "A", priority: "P3" }), () => d.p);
  s.change("priority", "P1"); s.external(T({ title: "Remote", priority: "P1" })); d.res(); await tick(); await tick();
  const st = s.getState(); assert.equal(st.form.title, "Remote"); assert.equal(st.form.priority, "P1"); assert.equal(calls.length, 1);
});
test('project kosong dari "+ Baru" tidak tersimpan sebelum blur; nama baru tersimpan saat commit', async () => {
  const { s, t, calls } = mk(T({ project: "Alpha" })); s.change("project", ""); assert.equal(t.q.length, 0); assert.equal(calls.length, 0);
  s.change("project", "Gamma"); assert.equal(t.q.length, 0); assert.equal(calls.length, 0);
  s.commit("project"); await tick(); assert.deepEqual(calls, [{ project: "Gamma" }]);
});
// R19 (tinjauan akhir #1): server membuat project/tahap untuk setiap nama yang belum ada, jadi nama yang sedang diketik
// ("Mark" sebelum "Marketing") tidak boleh tersimpan karena diam atau ikut simpan non-eksplisit field lain.
test("R19: project/context yang diketik tidak pernah tersimpan oleh timer idle; hanya commit/flush", async () => {
  const { s, t, calls } = mk(T({ project: "Alpha", context: "Kantor" }));
  s.change("project", "Mark"); s.change("context", "Ra");
  assert.equal(t.q.length, 0, "project/context tidak memasang timer idle"); assert.equal(calls.length, 0);
  s.change("description", "d"); assert.equal(t.q.length, 1);
  s.change("project", "Marketing");
  t.run(); await tick();
  assert.deepEqual(calls, [{ description: "d" }], "timer idle field lain tidak membawa project/context setengah jadi");
  s.change("priority", "P1"); await tick();
  assert.deepEqual(calls[1], { priority: "P1" }, "simpan 'now' juga tidak membawanya");
  s.commit("project"); await tick();
  assert.deepEqual(calls[2], { project: "Marketing", context: "Ra" }, "commit eksplisit mengirim nama lengkap");
  s.change("context", "Rapat"); await s.flush();
  assert.deepEqual(calls[3], { context: "Rapat" });
  assert.equal(calls.length, 4);
  assert.ok(!calls.some(c => c.project === "Mark"), "nama setengah jadi tidak pernah terkirim");
});
test("dispose membatalkan timer tanpa put", () => { const { s, t, calls } = mk(T()); s.change("description", "x"); s.dispose(); assert.equal(t.q.length, 0); assert.equal(calls.length, 0); });

test("R10: judul dengan spasi ujung dinormalkan setelah simpan berhasil", async () => {
  const { s, calls } = mk(T()); s.change("title", "Rapat "); s.commit("title"); await tick();
  assert.deepEqual(calls, [{ title: "Rapat" }]);
  const st = s.getState(); assert.equal(st.form.title, "Rapat"); assert.equal(st.saved.title, "Rapat");
  assert.deepEqual(le.changedFields(st.saved, st.form), []);
});
test("R10: form yang diubah lagi saat simpan berjalan tidak ditimpa", async () => {
  const d = deferred(); const { s } = mk(T(), () => d.p);
  s.change("title", "Rapat "); s.commit("title"); s.change("title", "Rapat besok");
  d.res({ title: "Rapat" }); await tick();
  const st = s.getState(); assert.equal(st.form.title, "Rapat besok", "ketikan baru bertahan");
  assert.notEqual(st.saved.title, "Rapat besok"); assert.deepEqual(le.changedFields(st.saved, st.form), ["title"]);
});
test("R10: assigned_to dinormalkan ke nilai terkirim sehingga bukan dirty bagi mergeExternal", async () => {
  const { s } = mk(T({ assigned_to: 5 })); s.change("assigned_to", null); await tick();
  const st = s.getState(); assert.equal(st.saved.assigned_to, 0); assert.equal(st.form.assigned_to, 0);
  s.external(T({ assigned_to: null, priority: "P1" })); assert.equal(s.getState().form.assigned_to, null);
  assert.equal(s.getState().form.priority, "P1");
});
test("judul tidak valid dikeluarkan saat commit; simpan non-commit tidak menyentuh judul maupun titleError", async () => {
  const { s, calls } = mk(T()); s.change("title", "  "); s.change("priority", "P1"); await tick();
  assert.deepEqual(calls, [{ priority: "P1" }]); assert.equal(s.getState().titleError, null, "belum commit: belum divalidasi");
  s.commit("title"); await tick();
  assert.equal(calls.length, 1); assert.equal(s.getState().titleError, "Judul tidak boleh kosong");
  s.change("gtd_status", "done"); await tick();
  assert.deepEqual(calls[1], { gtd_status: "done" }); assert.equal(s.getState().titleError, "Judul tidak boleh kosong", "simpan non-commit tidak menghapus error judul");
  s.change("title", "Baik"); s.commit("title"); await tick();
  assert.deepEqual(calls[2], { title: "Baik" }); assert.equal(s.getState().titleError, null);
});
test("commit bersama field lain: judul tidak valid dikeluarkan, field lain tersimpan", async () => {
  const { s, calls } = mk(T()); s.change("title", "#x"); s.change("description", "d"); await s.flush();
  assert.deepEqual(calls, [{ description: "d" }]); assert.equal(s.getState().titleError, "Judul tidak boleh kosong"); assert.equal(s.getState().saveState, "saved");
});
test("titleError hilang bila judul kembali sama dengan yang tersimpan", async () => {
  const { s, calls } = mk(T()); s.change("title", ""); s.commit("title"); await tick();
  assert.equal(s.getState().titleError, "Judul tidak boleh kosong");
  s.change("title", "A"); await s.flush(); assert.equal(s.getState().titleError, null); assert.equal(calls.length, 0);
});
test("gagal saat ada simpan tertunda: tidak diulang otomatis, retry mengirim perubahan terbaru", async () => {
  const d = deferred(); let n = 0; const { s, calls } = mk(T(), () => (n++ === 0 ? d.p : Promise.resolve()));
  s.change("priority", "P1"); s.change("priority", "P2"); d.rej(new Error("offline")); await tick(); await tick();
  assert.equal(calls.length, 1); assert.equal(s.getState().saveState, "error"); assert.equal(s.getState().error, "offline");
  await s.retry(); assert.deepEqual(calls[1], { priority: "P2" }); assert.equal(s.getState().saveState, "saved"); assert.equal(s.getState().error, null);
});
test("penolakan tanpa Error: pesan dari string atau 'Gagal menyimpan'", async () => {
  const a = mk(T(), () => Promise.reject("ditolak")); a.s.change("priority", "P1"); await tick(); assert.equal(a.s.getState().error, "ditolak");
  const b = mk(T(), () => Promise.reject(undefined)); b.s.change("priority", "P1"); await tick(); assert.equal(b.s.getState().error, "Gagal menyimpan");
  const c = mk(T(), () => { throw new Error("sinkron"); }); c.s.change("priority", "P1"); await tick(); assert.equal(c.s.getState().error, "sinkron");
});
test("flush menunggu simpan yang berjalan dan yang tertunda", async () => {
  const d = deferred(); let n = 0; const { s, calls } = mk(T(), () => (n++ === 0 ? d.p : Promise.resolve()));
  s.change("priority", "P1"); s.change("gtd_status", "done");
  let done = false; const f = s.flush().then(() => { done = true; });
  await tick(); assert.equal(done, false); d.res(); await f;
  assert.deepEqual(calls, [{ priority: "P1" }, { gtd_status: "done" }]); assert.equal(s.getState().saveState, "saved");
});
test("getState dan argumen onChange adalah salinan", async () => {
  const seen = []; const s = le.createAutosaver({ task: T(), put: () => Promise.resolve(), onChange: st => seen.push(st) });
  const a = s.getState(); a.form.title = "Rusak"; a.saved.title = "Rusak"; a.saveState = "error"; a.error = "x";
  assert.equal(s.getState().form.title, "A"); assert.equal(s.getState().saved.title, "A"); assert.equal(s.getState().saveState, "idle");
  s.change("priority", "P1"); const last = seen[seen.length - 1]; last.form.priority = "P9"; last.saved.priority = "P9";
  assert.equal(s.getState().form.priority, "P1"); assert.equal(s.getState().saved.priority, "P3");
  assert.notEqual(seen[0], seen[1]); await tick();
});
test("dispose: hasil put yang datang kemudian diabaikan dan simpan tertunda tidak jalan", async () => {
  const d = deferred(); const { s, calls, states } = mk(T(), () => d.p);
  s.change("priority", "P1"); s.change("priority", "P2"); s.dispose(); const n = states.length;
  d.res({ title: "X" }); await tick(); await tick();
  assert.equal(states.length, n); assert.equal(s.getState().saveState, "saving"); assert.equal(calls.length, 1);
  s.change("description", "x"); s.commit("description"); s.external(T({ title: "Z" })); await s.flush(); await s.retry();
  assert.equal(calls.length, 1); assert.equal(states.length, n);
});
test("dispose: put yang gagal kemudian juga diabaikan", async () => {
  const d = deferred(); const { s, states } = mk(T(), () => d.p); s.change("priority", "P1"); s.dispose(); const n = states.length;
  d.rej(new Error("x")); await tick(); assert.equal(states.length, n); assert.equal(s.getState().saveState, "saving");
});
test("timer idle yang sudah terlanjur dijadwalkan tidak menyimpan setelah dispose", async () => {
  const { s, t, calls } = mk(T()); s.change("description", "x"); const h = t.q[0]; s.dispose(); h.fn(); await tick(); assert.equal(calls.length, 0);
});
test("tanpa setTimer/clearTimer/idleMs bawaan memakai timer global dan TEXT_IDLE_MS", async () => {
  const calls = []; const s = le.createAutosaver({ task: T(), put: p => { calls.push(p); return Promise.resolve(); }, idleMs: 5 });
  s.change("description", "x"); assert.equal(calls.length, 0);
  await new Promise(r => setTimeout(r, 40)); assert.deepEqual(calls, [{ description: "x" }]);
  const s2 = le.createAutosaver({ task: T(), put: () => Promise.resolve() }); s2.change("description", "y"); s2.dispose();
});

// ---- perbaikan review Task 4 (R11-R13) ----
test("R13: validateTitle menolak judul yang kosong setelah #tag dibuang", () => {
  assert.equal(le.validateTitle("#x"), "Judul tidak boleh kosong");
  assert.equal(le.validateTitle("  #a #b "), "Judul tidak boleh kosong");
  assert.equal(le.validateTitle("#Café_1"), "Judul tidak boleh kosong");
  assert.equal(le.validateTitle("Rapat #x"), null);
  assert.equal(le.validateTitle("#x Rapat"), null);
  assert.equal(le.validateTitle("#"), null);
  assert.equal(le.validateTitle(null), "Judul tidak boleh kosong");
});
test("R11: judul hanya #tag ditolak di klien (titleError, tanpa put)", async () => {
  const { s, calls } = mk(T()); s.change("title", "#x"); s.commit("title"); await tick();
  assert.equal(calls.length, 0); assert.equal(s.getState().titleError, "Judul tidak boleh kosong"); assert.equal(s.getState().saveState, "idle");
});
test("R11 (a): timer idle yang sudah terpasang tidak menyimpan project kosong; commit menyimpannya", async () => {
  const { s, t, calls } = mk(T({ project: "Alpha" }));
  s.change("description", "d"); s.change("project", "Beta"); s.change("project", ""); assert.equal(t.q.length, 1);
  t.run(); await tick(); assert.deepEqual(calls, [{ description: "d" }]);
  s.commit("project"); await tick(); assert.deepEqual(calls[1], { project: "" });
});
test("R11 (a): project kosong ikut tersimpan saat flush; context kosong sama", async () => {
  const { s, calls } = mk(T({ project: "Alpha", context: "Kantor" })); s.change("project", ""); s.change("context", ""); await s.flush();
  assert.deepEqual(calls, [{ project: "", context: "" }]);
});
test("R11 (b): simpan tertunda non-commit tidak mengirim judul yang belum di-commit", async () => {
  const d = deferred(); let n = 0; const { s, calls } = mk(T(), () => (n++ === 0 ? d.p : Promise.resolve()));
  s.change("priority", "P1"); s.change("gtd_status", "done"); s.change("title", "Rapat #ka");
  d.res(); await tick(); await tick();
  assert.deepEqual(calls, [{ priority: "P1" }, { gtd_status: "done" }]); assert.equal(s.getState().form.title, "Rapat #ka");
});
test("R11 (b): timer idle tidak mengirim judul yang belum di-commit", async () => {
  const { s, t, calls } = mk(T()); s.change("description", "d"); s.change("title", "Baru"); t.run(); await tick();
  assert.deepEqual(calls, [{ description: "d" }]);
});
test("R11 (b): permintaan commit yang antre membuat putaran berikutnya eksplisit", async () => {
  const d = deferred(); let n = 0; const { s, calls } = mk(T(), () => (n++ === 0 ? d.p : Promise.resolve()));
  s.change("priority", "P1"); s.change("title", "Baru"); s.commit("title");
  d.res(); await tick(); await tick();
  assert.deepEqual(calls, [{ priority: "P1" }, { title: "Baru" }]);
});
test("R11 (b): permintaan non-eksplisit sesudah commit yang antre tidak menurunkan putaran berikutnya", async () => {
  const d = deferred(); let n = 0; const { s, calls } = mk(T(), () => (n++ === 0 ? d.p : Promise.resolve()));
  s.change("priority", "P1"); s.change("title", "Baru"); s.commit("title"); s.change("gtd_status", "done");
  d.res(); await tick(); await tick();
  assert.deepEqual(calls, [{ priority: "P1" }, { title: "Baru", gtd_status: "done" }]);
});
test("R11 (c): flush mengirim judul", async () => {
  const { s, calls } = mk(T()); s.change("title", "X"); await s.flush(); assert.deepEqual(calls, [{ title: "X" }]);
});
test("R11 (d): progress hanya tersimpan saat commit/flush", async () => {
  const { s, t, calls } = mk(T()); s.change("progress", 40); await tick();
  assert.equal(calls.length, 0); assert.equal(t.q.length, 0);
  s.change("priority", "P1"); await tick(); assert.deepEqual(calls, [{ priority: "P1" }], "progress di tengah drag tidak ikut");
  s.commit("progress"); await tick(); assert.deepEqual(calls[1], { progress: 40 });
});
test("R12: flush() lalu dispose() tetap mengirim perubahan yang antre di belakang simpan berjalan", async () => {
  const d = deferred(); let n = 0; const { s, calls, states } = mk(T(), () => (n++ === 0 ? d.p : Promise.resolve()));
  s.change("priority", "P1"); s.change("description", "draf"); const f = s.flush(); s.dispose(); const len = states.length;
  d.res(); await f;
  assert.deepEqual(calls, [{ priority: "P1" }, { description: "draf" }]);
  assert.equal(states.length, len, "tanpa onChange setelah dispose"); assert.equal(s.getState().saveState, "saving", "state beku saat dispose");
});
test("R12: flush yang antre tetap dicoba bila put yang berjalan gagal", async () => {
  const d = deferred(); let n = 0; const { s, calls } = mk(T(), () => (n++ === 0 ? d.p : Promise.resolve()));
  s.change("priority", "P1"); s.change("description", "draf"); const f = s.flush();
  d.rej(new Error("offline")); await f;
  assert.equal(calls.length, 2); assert.equal(calls[1].description, "draf"); assert.equal(s.getState().saveState, "saved");
});
test("R12: dispose tanpa flush membuang antrean non-eksplisit", async () => {
  const d = deferred(); const { s, calls } = mk(T(), () => d.p);
  s.change("priority", "P1"); s.change("priority", "P2"); s.dispose(); d.res(); await tick(); await tick(); assert.equal(calls.length, 1);
});
test("R12: flush yang antre dan put berjalan gagal setelah dispose tetap dicoba tanpa onChange", async () => {
  const d = deferred(); let n = 0; const { s, calls, states } = mk(T(), () => (n++ === 0 ? d.p : Promise.resolve()));
  s.change("priority", "P1"); s.change("description", "draf"); const f = s.flush(); s.dispose(); const len = states.length;
  d.rej(new Error("x")); await f; assert.equal(calls.length, 2); assert.equal(states.length, len);
});
test("error: judul dikembalikan lalu retry → idle, error null", async () => {
  const { s, calls } = mk(T(), () => Promise.reject(new Error("Gagal terhubung")));
  s.change("title", "Rapat"); s.commit("title"); await tick(); assert.equal(s.getState().saveState, "error");
  s.revertTitle(); assert.equal(s.getState().saveState, "error", "revertTitle saja belum menghapus error");
  await s.retry(); const st = s.getState(); assert.equal(st.saveState, "idle"); assert.equal(st.error, null); assert.equal(calls.length, 1);
});
test("error: field dikembalikan ke nilai tersimpan lewat change → idle, error null", async () => {
  const { s, states } = mk(T(), () => Promise.reject(new Error("x"))); s.change("priority", "P1"); await tick();
  assert.equal(s.getState().saveState, "error"); s.change("priority", "P3"); await tick();
  assert.equal(s.getState().saveState, "idle"); assert.equal(s.getState().error, null); assert.equal(states[states.length - 1], "idle");
});
test("error tetap bila judul yang gagal masih belum tersimpan dan simpan non-commit tidak punya apa-apa", async () => {
  const { s } = mk(T(), () => Promise.reject(new Error("x"))); s.change("title", "Rapat"); s.commit("title"); await tick();
  s.change("priority", "P3"); await tick(); assert.equal(s.getState().saveState, "error"); assert.equal(s.getState().error, "x");
});
