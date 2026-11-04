// Plugin Timeline (Fase 1, PR 1c-1) — Task 4: rencana tulis murni (TLPlan) — diff, aliran ke hilir, sakelar unit,
// jadwalkan ulang, gestur K33, pratinjau, CAS, Urungkan (rencana 1c-1 R11, R12, R14, R17; spec 1c §5.7, K32–K36).
// Semua tanggal tetap (November 2026 tanpa libur nasional); tidak ada "hari ini" selain argumen T.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const dir = path.join(__dirname, "../../static/plugins/timeline");
const C = require(path.join(dir, "calendar.js"));
const S = require(path.join(dir, "schedule.js"));
const M = require(path.join(dir, "cpm.js"));
const P = require(path.join(dir, "plan.js"));

const D = (s) => C.dn(s);
const std = () => C.compile(C.DEFAULT_CAL);

// Palsu `api.taskExt.read` (bentuk runtime: kunci milik plugin tanpa prefiks).
const readExt = (task) => {
  const out = {};
  const ext = task && task.ext;
  if (!ext || typeof ext !== "object") return out;
  for (const k of Object.keys(ext)) if (k.indexOf("timeline.") === 0) out[k.slice(9)] = JSON.parse(JSON.stringify(ext[k]));
  return out;
};

const LIST = 7;
// Pembangun task (pola timeline_cpm.test.js). deps: [[id, type?, lag?], …]. d undefined → kunci duration tidak ada.
function mk(o) {
  const ext = {};
  if (o.start !== undefined) ext["timeline.start"] = o.start;
  if (o.d !== undefined) ext["timeline.duration"] = o.d;
  if (o.deps) ext["timeline.deps"] = o.deps.map(([id, type, lag]) => Object.assign({ t: { $task: id }, lag: lag || 0 }, type ? { type } : {}));
  if (o.mode !== undefined) ext["timeline.mode"] = o.mode;
  if (o.constraint !== undefined) ext["timeline.constraint"] = o.constraint;
  return {
    id: o.id,
    title: "T" + o.id,
    list_id: o.list_id === undefined ? LIST : o.list_id,
    project: o.project === undefined ? "Alpha" : o.project,
    gtd_status: o.gtd_status || (o.done ? "done" : "next"),
    completed_at: o.completed_at === undefined ? (o.done ? "2026-11-05T17:30:00Z" : null) : o.completed_at,
    progress: o.progress || 0,
    pomodoros_done: o.pomo || 0,
    deadline: o.deadline === undefined ? null : o.deadline,
    parent_id: null,
    recurrence_type: null,
    archived: false,
    deleted: false,
    ext,
  };
}
const unitKey = (project, list_id = LIST) => S.unitOf({ list_id, project }).recId;
const autoUnits = (...projects) => new Map(projects.map((p) => [unitKey(p), { auto: true }]));
const ctxOf = (tasks, units = autoUnits("Alpha"), cal = std()) => ({ tasks, cal, units, readExt });
const keys = (items) => items.map((i) => i.key);
const byKey = (items) => new Map(items.map((i) => [i.key, i]));
const snap = (ctx) => JSON.stringify({ tasks: ctx.tasks, units: [...(ctx.units instanceof Map ? ctx.units : [])] });
const NOTHING = { start: null, duration: null, constraint: null, mode: null };
const SNET = (date) => ({ type: "SNET", date });

// Setiap patch rencana harus lolos sanitizePatch tanpa berubah (bentuk mentah readSched).
function assertSane(items) {
  for (const it of items) {
    const r = S.sanitizePatch(it.patch);
    assert.ok(r.ok, "patch " + it.key + " lolos sanitizePatch");
    assert.deepEqual(r.patch, it.patch, "patch " + it.key + " sudah bersih");
  }
}

// Urutan item = urutan topologis hasil mesin.
function assertTopo(items, result) {
  const pos = new Map(result.order.map((k, i) => [k, i]));
  for (let i = 1; i < items.length; i++) assert.ok(pos.get(items[i - 1].key) < pos.get(items[i].key), "urutan topologis " + keys(items));
}

test("modul: pola part R2 (tanpa global, require fallback, ekspor beku, CASCADE_MAX 20)", () => {
  const src = fs.readFileSync(path.join(dir, "plan.js"), "utf8");
  assert.match(src, /const TLPlan = \(function \(CAL, SCHED, CPM\)/);
  assert.match(src, /typeof TLCal !== "undefined" \? TLCal : require\("\.\/calendar\.js"\)/);
  assert.match(src, /typeof TLSched !== "undefined" \? TLSched : require\("\.\/schedule\.js"\)/);
  assert.match(src, /typeof TLCpm !== "undefined" \? TLCpm : require\("\.\/cpm\.js"\)/);
  assert.match(src, /module\.exports = TLPlan/);
  assert.doesNotMatch(src, /\bwindow\b|\bself\b|\bglobalThis\b/);
  assert.ok(Object.isFrozen(P));
  assert.equal(P.CASCADE_MAX, 20);
  for (const f of ["diff", "cascade", "toggleUnit", "reschedule", "gesture", "modePatch", "preview", "revalidate", "undoItems"]) {
    assert.equal(typeof P[f], "function", f);
  }
});

test("sumber plan.js murni: tanpa Date.parse/new Date/Date.now/localeCompare, tanpa api/store/fetch/localStorage/innerHTML", () => {
  const src = fs.readFileSync(path.join(dir, "plan.js"), "utf8").replace(/\/\/.*$/gm, "");
  assert.ok(!/Date\.parse\(|new Date\(|Date\.now\(|localeCompare\(/.test(src), "plan.js tanpa Date.parse/new Date/Date.now/localeCompare");
  assert.ok(!/\bapi\.|\bfetch\(|localStorage|innerHTML|#[0-9a-fA-F]{3,6}\b/.test(src), "plan.js tanpa api/fetch/localStorage/innerHTML/hex");
});

test("diff: hanya simpul yang berubah; jangkar tidak pernah; tanpa Mulai berpendahulu → kind new + duration 1 bila hilang; urutan topologis", () => {
  const tasks = [
    mk({ id: 1, start: "2026-11-02", d: 3 }), // akar Sen–Rab, tetap
    mk({ id: 9, start: "2026-11-03", d: 2, deps: [[1]] }), // hasil Kam 5 → move +2 hk
    mk({ id: 10, deps: [[9]] }), // tanpa Mulai, tanpa durasi → new, duration 1
    mk({ id: 11, d: 3, deps: [[9]] }), // tanpa Mulai, durasi ada → new tanpa duration
    mk({ id: 2, start: "2026-11-03", d: 1, mode: "manual", deps: [[1]] }), // Manual berpelanggaran → jangkar
    mk({ id: 3, start: "2026-11-03", d: 1, done: true, deps: [[1]] }), // selesai → jangkar
    mk({ id: 4, start: "2026-11-03", d: 1, progress: 50, deps: [[1]] }), // sudah mulai → jangkar
    mk({ id: 5, start: "2026-11-02", d: 1 }), // akar tetap
    mk({ id: 6, start: "2026-11-02", d: 1, constraint: { type: "MFO", date: "2026-11-13" } }), // MFO: ES Jum 13 ≠ tersimpan → tetap jangkar
  ];
  const ctx = ctxOf(tasks);
  const before = snap(ctx);
  const r = M.run(ctx);
  assert.equal(r.nodes.get("6").es, D("2026-11-13"), "prasyarat: ES MFO berbeda dari Mulai tersimpan");
  const items = P.diff(r, ctx);
  // urutan topologis (9 → 10, 11), bukan urutan kunci ("10" < "11" < "9")
  assert.deepEqual(keys(items), ["9", "10", "11"]);
  assertTopo(items, r);
  const m = byKey(items);
  assert.deepEqual(m.get("9").patch, { start: "2026-11-05" });
  assert.equal(m.get("9").kind, "move");
  assert.equal(m.get("9").deltaHk, 2);
  assert.deepEqual(m.get("9").before, { start: "2026-11-03", duration: 2, constraint: null, mode: null });
  assert.equal(m.get("9").task, tasks[1]);
  assert.deepEqual(m.get("10").patch, { start: "2026-11-09", duration: 1 });
  assert.equal(m.get("10").kind, "new");
  assert.equal(m.get("10").deltaHk, null);
  assert.deepEqual(m.get("10").before, NOTHING);
  assert.deepEqual(m.get("11").patch, { start: "2026-11-09" });
  assert.equal(m.get("11").kind, "new");
  assert.deepEqual(m.get("11").before, { start: null, duration: 3, constraint: null, mode: null });
  assertSane(items);
  // dibatasi onlyKeys
  assert.deepEqual(keys(P.diff(r, ctx, new Set(["10"]))), ["10"]);
  assert.deepEqual(P.diff(r, ctx, new Set(["2", "3", "4", "1"])), [], "jangkar dan akar tetap tidak pernah ditulis");
  assert.equal(snap(ctx), before, "ctx tidak diubah");
});

// Data aliran: A akar (Sen–Sel) → B FS (Rab–Kam) → C SS dari B (Rab); Z → D drift; E selesai; F di unit Manual (Beta).
function cascadeData() {
  return [
    mk({ id: 1, start: "2026-11-02", d: 2 }),
    mk({ id: 2, start: "2026-11-04", d: 2, deps: [[1]] }),
    mk({ id: 3, start: "2026-11-04", d: 1, deps: [[2, "SS"]] }),
    mk({ id: 4, start: "2026-11-02", d: 1 }),
    mk({ id: 5, start: "2026-11-02", d: 1, deps: [[4]] }), // drift: hasil Sel 3
    mk({ id: 6, start: "2026-11-04", d: 1, done: true, deps: [[1]] }),
    mk({ id: 7, start: "2026-11-04", d: 1, project: "Beta", deps: [[1]] }),
  ];
}

test("cascade: geser A (akar) +2 hk → B (FS) dan C (SS dari B) ikut; D drift tapi bukan turunan → tidak ikut; E selesai turunan → tidak ikut; F di unit Manual turunan → tidak ikut (jangkar)", () => {
  const tasks = cascadeData();
  const ctx = ctxOf(tasks);
  const before = snap(ctx);
  const out = P.cascade(ctx, [{ task: tasks[0], patch: { start: "2026-11-04" } }]);
  assert.deepEqual(keys(out.items), ["1", "2", "3"]);
  assertTopo(out.items, out.result);
  const m = byKey(out.items);
  assert.deepEqual(m.get("1").patch, { start: "2026-11-04" });
  assert.deepEqual(m.get("2").patch, { start: "2026-11-06" });
  assert.deepEqual(m.get("3").patch, { start: "2026-11-06" });
  for (const k of ["1", "2", "3"]) assert.equal(m.get(k).deltaHk, 2, "Δ hk " + k);
  assert.equal(out.gestureCount, 1);
  assert.equal(out.over, false);
  assert.ok(out.result.drift.has("5"), "D tetap drift di hasil (tidak diselundupkan)");
  assert.equal(out.result.nodes.get("7").fixed, "manual");
  assertSane(out.items);
  assert.equal(snap(ctx), before, "ctx/tasks/units tidak diubah");
});

test("cascade: patch gestur batasan pada task otomatis → item gestur ditambah start hasil mesin; turunan ikut; patch masukan tidak diubah", () => {
  const tasks = cascadeData();
  const ctx = ctxOf(tasks);
  const patch = { constraint: SNET("2026-11-12") };
  const out = P.cascade(ctx, [{ task: tasks[1], patch }]);
  assert.deepEqual(patch, { constraint: SNET("2026-11-12") }, "patch pemanggil utuh");
  assert.deepEqual(keys(out.items), ["2", "3"]);
  const m = byKey(out.items);
  assert.deepEqual(m.get("2").patch, { constraint: SNET("2026-11-12"), start: "2026-11-12" });
  assert.equal(m.get("2").kind, "move");
  assert.deepEqual(m.get("3").patch, { start: "2026-11-12" });
  // gestur jatuh Sabtu pada akar otomatis → mesin menjepret ke Senin (tanpa drift setelah tulis)
  const sat = P.cascade(ctx, [{ task: tasks[0], patch: { start: "2026-11-07" } }]);
  assert.deepEqual(byKey(sat.items).get("1").patch, { start: "2026-11-09" });
  // gestur pada task Manual (unit Beta) → patch apa adanya, tanpa start dari mesin
  const man = P.cascade(ctx, [{ task: tasks[6], patch: { start: "2026-11-03" } }]);
  assert.deepEqual(keys(man.items), ["7"]);
  assert.deepEqual(man.items[0].patch, { start: "2026-11-03" });
  assertSane([...out.items, ...sat.items, ...man.items]);
});

test("cascade: 25 turunan berubah → over true; 20 → false; 21 → true", () => {
  const fan = (n) => {
    const tasks = [mk({ id: 1, start: "2026-11-02", d: 1 })];
    for (let i = 0; i < n; i++) tasks.push(mk({ id: 100 + i, start: "2026-11-03", d: 1, deps: [[1]] }));
    return P.cascade(ctxOf(tasks), [{ task: tasks[0], patch: { start: "2026-11-04" } }]);
  };
  const o25 = fan(25);
  assert.equal(o25.items.length, 26);
  assert.equal(o25.gestureCount, 1);
  assert.equal(o25.over, true);
  assert.ok(o25.items.slice(1).every((i) => i.patch.start === "2026-11-05"));
  const o20 = fan(20);
  assert.equal(o20.items.length, 21);
  assert.equal(o20.over, false);
  assert.equal(fan(21).over, true);
});

test("gesture: akar → patch start saja; berpendahulu jatuh setelah syarat → start + constraint SNET tanggal jatuh; jatuh sebelum syarat → {ok:false, reason:'early', es}; task Manual → patch apa adanya", () => {
  const tasks = [
    mk({ id: 1, start: "2026-11-02", d: 2 }), // akar Sen–Sel → syarat B Rab 4
    mk({ id: 2, start: "2026-11-04", d: 2, deps: [[1]] }),
    mk({ id: 3, start: "2026-11-05", d: 2 }), // akar Kam–Jum → syarat 4 Sen 9
    mk({ id: 4, start: "2026-11-09", d: 1, deps: [[3]] }),
    mk({ id: 5, start: "2026-11-04", d: 1, mode: "manual", deps: [[1]] }),
    mk({ id: 6, start: "2026-11-09", d: 1, constraint: SNET("2026-11-09") }), // akar ber-SNET
    mk({ id: 7 }), // belum dijadwalkan (bukan simpul)
  ];
  const ctx = ctxOf(tasks);
  const r = M.run(ctx);
  const c = ctx.cal;
  const g = (i, patch) => P.gesture(r, tasks[i], readExt(tasks[i]), patch, c);
  assert.deepEqual(g(0, { start: "2026-11-05" }), { ok: true, patch: { start: "2026-11-05" } });
  assert.deepEqual(g(1, { start: "2026-11-05" }), { ok: true, patch: { start: "2026-11-05", constraint: SNET("2026-11-05") } });
  assert.deepEqual(g(1, { start: "2026-11-04" }), { ok: true, patch: { start: "2026-11-04", constraint: SNET("2026-11-04") } }, "tepat di syarat");
  assert.deepEqual(g(1, { start: "2026-11-03" }), { ok: false, reason: "early", es: D("2026-11-04") });
  // seret-kiri mengubah start + durasi sekaligus → tetap diperiksa
  assert.deepEqual(g(1, { start: "2026-11-03", duration: 3 }), { ok: false, reason: "early", es: D("2026-11-04") });
  // Sabtu sebelum syarat Senin → ditolak (start < req harfiah; lihat komentar gesture)
  assert.deepEqual(g(3, { start: "2026-11-07" }), { ok: false, reason: "early", es: D("2026-11-09") });
  assert.deepEqual(g(4, { start: "2026-11-02" }), { ok: true, patch: { start: "2026-11-02" } }, "Manual: apa adanya walau lebih awal");
  assert.deepEqual(g(5, { start: "2026-11-10" }), { ok: true, patch: { start: "2026-11-10", constraint: SNET("2026-11-10") } });
  assert.deepEqual(g(1, { duration: 3 }), { ok: true, patch: { duration: 3 } }, "tanpa start → apa adanya");
  assert.deepEqual(g(6, { start: "2026-11-10", duration: 1 }), { ok: true, patch: { start: "2026-11-10", duration: 1 } }, "akar baru");
  const patch = { start: "2026-11-05" };
  const res = g(1, patch);
  assert.deepEqual(patch, { start: "2026-11-05" }, "patch masukan tidak diubah");
  assert.notEqual(res.patch, patch);
  assert.ok(S.sanitizePatch(res.patch).ok);
});

test("toggleUnit ON: unit dengan rantai berpelanggaran → item = penerus yang dipindah; akar tetap; OFF → []", () => {
  const tasks = [
    mk({ id: 1, start: "2026-11-02", d: 3 }), // akar Alpha
    mk({ id: 2, start: "2026-11-03", d: 2, deps: [[1]] }), // melanggar → Kam 5
    mk({ id: 3, start: "2026-11-05", d: 1, deps: [[2]] }), // → Sen 9
    mk({ id: 4, start: "2026-11-03", d: 1, mode: "manual", deps: [[1]] }), // Manual eksplisit → tetap
    mk({ id: 5, start: "2026-11-02", d: 1, project: "Beta" }),
    mk({ id: 6, start: "2026-11-02", d: 1, project: "Beta", deps: [[5]] }), // drift di unit lain → tidak ikut
  ];
  const ctx = ctxOf(tasks, autoUnits("Beta"));
  const before = snap(ctx);
  const on = P.toggleUnit(ctx, unitKey("Alpha"), true);
  assert.deepEqual(keys(on.items), ["2", "3"]);
  assert.deepEqual(byKey(on.items).get("2").patch, { start: "2026-11-05" });
  assert.deepEqual(byKey(on.items).get("3").patch, { start: "2026-11-09" });
  assert.equal(on.units.get(unitKey("Alpha")).auto, true);
  assert.equal(on.units.get(unitKey("Beta")).auto, true);
  assert.notEqual(on.units, ctx.units);
  assert.equal(snap(ctx), before, "ctx.units tidak diubah");
  assertSane(on.items);
  const ctx2 = ctxOf(tasks, autoUnits("Alpha", "Beta"));
  const off = P.toggleUnit(ctx2, unitKey("Alpha"), false);
  assert.deepEqual(off.items, []);
  assert.equal(off.units.get(unitKey("Alpha")).auto, false);
  assert.equal(ctx2.units.get(unitKey("Alpha")).auto, true);
});

test("reschedule (T = 2026-11-09): belum mulai Mulai lampau di unit otomatis → constraint SNET T; di Manual → start T (milestone ikut); sudah mulai d 10 progress 40 EF < T → durasi = hari kerja start..add(T, 5); selesai tetap; Manual: broken = jumlah pelanggaran baru", () => {
  const T = D("2026-11-09");
  const tasks = [
    // Alpha (otomatis)
    mk({ id: 1, start: "2026-11-02", d: 2 }), // belum mulai, lampau → SNET T
    mk({ id: 2, start: "2026-11-10", d: 1, constraint: SNET("2026-11-10"), deps: [[1]] }), // ES Sel 10 ≥ T → hanya mengalir
    mk({ id: 3, start: "2026-10-19", d: 10, progress: 40 }), // sudah mulai, EF Jum 30 Okt < T
    mk({ id: 4, start: "2026-11-02", d: 1, deps: [[3]] }), // belum mulai, lampau → SNET T, lalu mengalir
    mk({ id: 5, start: "2026-10-26", d: 1, done: true }), // selesai → tetap
    mk({ id: 6, start: "2026-11-02", d: 10, progress: 50 }), // sudah mulai, EF Jum 13 ≥ T → tetap
    mk({ id: 7, start: "2026-11-04", d: 0 }), // milestone otomatis → SNET T
    // Beta (Manual)
    mk({ id: 11, start: "2026-11-03", d: 2, project: "Beta" }), // → start T
    mk({ id: 12, start: "2026-11-04", d: 0, project: "Beta" }), // milestone → start T
    mk({ id: 13, start: "2026-11-06", d: 1, project: "Beta", deps: [[11]] }), // → start T, pelanggaran baru
    mk({ id: 14, start: "2026-11-10", d: 1, project: "Beta", deps: [[11]] }), // tidak dipindah, pelanggaran baru
    mk({ id: 15, start: "2026-11-02", d: 1, project: "Beta", done: true }),
    mk({ id: 16, start: "2026-11-04", d: 1, project: "Beta", deps: [[11]] }), // sudah melanggar sebelumnya → bukan baru
    // Gamma (otomatis, bukan unit halaman)
    mk({ id: 21, start: "2026-11-02", d: 1, project: "Gamma" }),
  ];
  const ctx = ctxOf(tasks, autoUnits("Alpha", "Gamma"));
  const before = snap(ctx);
  const r = M.run(ctx);
  const out = P.reschedule(ctx, r, T, new Set([unitKey("Alpha"), unitKey("Beta")]));
  const m = byKey(out.items);
  assert.deepEqual([...m.keys()].sort(), ["1", "11", "12", "13", "16", "2", "3", "4", "7"]);
  assertTopo(out.items, out.result);
  assert.deepEqual(m.get("1").patch, { constraint: SNET("2026-11-09"), start: "2026-11-09" });
  assert.deepEqual(m.get("2").patch, { start: "2026-11-11" });
  const c = ctx.cal;
  const dur = C.workdays(c, D("2026-10-19"), C.addWork(c, T, 5));
  assert.equal(dur, 21);
  assert.deepEqual(m.get("3").patch, { duration: 21 });
  assert.equal(m.get("3").kind, "duration");
  assert.equal(m.get("3").deltaHk, 0);
  assert.deepEqual(m.get("4").patch, { constraint: SNET("2026-11-09"), start: "2026-11-17" });
  assert.deepEqual(m.get("7").patch, { constraint: SNET("2026-11-09"), start: "2026-11-09" });
  for (const k of ["11", "12", "13", "16"]) assert.deepEqual(m.get(k).patch, { start: "2026-11-09" }, "Manual " + k);
  assert.equal(out.broken, 2, "11→13 dan 11→14 baru; 11→16 sudah dilanggar");
  assertSane(out.items);
  assert.equal(snap(ctx), before);
  // T sebagai ISO setara
  assert.deepEqual(P.reschedule(ctx, r, "2026-11-09", new Set([unitKey("Alpha"), unitKey("Beta")])).items, out.items);
  // unit di luar unitKeys → kosong
  const none = P.reschedule(ctx, r, T, new Set());
  assert.deepEqual(none.items, []);
  assert.equal(none.broken, 0);
});

test("reschedule: sisa r = max(1, ⌈d × (1 − p/100)⌉) — progress ≥ 100 → r 1; durasi dijepit ≤ 999", () => {
  const T = D("2026-11-09");
  const tasks = [mk({ id: 1, start: "2026-10-19", d: 10, progress: 100, gtd_status: "next" })];
  const ctx = ctxOf(tasks);
  const out = P.reschedule(ctx, M.run(ctx), T, new Set([unitKey("Alpha")]));
  // r = 1 → selesai T → hari kerja 19 Okt..9 Nov = 16
  assert.deepEqual(out.items[0].patch, { duration: 16 });
  const far = [mk({ id: 1, start: "2020-01-06", d: 1, pomo: 1 })];
  const ctx2 = ctxOf(far);
  const out2 = P.reschedule(ctx2, M.run(ctx2), T, new Set([unitKey("Alpha")]));
  assert.deepEqual(out2.items[0].patch, { duration: 999 });
});

test("revalidate: start sama → ok; constraint berubah → {ok:false, keys}", () => {
  const tasks = cascadeData();
  const ctx = ctxOf(tasks);
  const { items } = P.cascade(ctx, [{ task: tasks[1], patch: { constraint: SNET("2026-11-12") } }]);
  assert.deepEqual(keys(items), ["2", "3"]);
  const rawNow = () => new Map(tasks.map((t) => [String(t.id), readExt(t)]));
  assert.deepEqual(P.revalidate(items, rawNow()), { ok: true });
  const changedStart = rawNow();
  changedStart.set("2", Object.assign({}, changedStart.get("2"), { start: "2026-11-05" }));
  assert.deepEqual(P.revalidate(items, changedStart), { ok: false, keys: ["2"] });
  const changedCst = rawNow();
  changedCst.set("3", Object.assign({}, changedCst.get("3"), { constraint: SNET("2026-11-20") }));
  assert.deepEqual(P.revalidate(items, changedCst), { ok: false, keys: ["3"] });
  const changedMode = rawNow();
  changedMode.set("2", Object.assign({}, changedMode.get("2"), { mode: "manual" }));
  assert.deepEqual(P.revalidate(items, changedMode), { ok: false, keys: ["2"] });
  const gone = rawNow();
  gone.delete("3");
  assert.deepEqual(P.revalidate(items, gone), { ok: false, keys: ["3"] }, "task hilang = berubah");
  // kunci di luar start/duration/constraint/mode (deps lain, kunci asing) tidak memengaruhi
  const other = rawNow();
  other.set("2", Object.assign({}, other.get("2"), { foo: 1 }));
  assert.deepEqual(P.revalidate(items, other), { ok: true });
  // nilai mentah, urutan kunci objek tidak relevan
  const t2 = mk({ id: 2, start: "2026-11-04", d: 2, deps: [[1]], constraint: { date: "2026-11-01", type: "SNET" } });
  const it2 = P.cascade(ctxOf([tasks[0], t2]), [{ task: t2, patch: { constraint: SNET("2026-11-12") } }]).items;
  const now2 = new Map([["2", Object.assign(readExt(t2), { constraint: SNET("2026-11-01") })]]);
  assert.deepEqual(P.revalidate(it2, now2), { ok: true });
});

test("undoItems: kunci constraint/mode yang dulu tidak ada → null; urutan sama", () => {
  const tasks = cascadeData();
  const ctx = ctxOf(tasks);
  const { items } = P.cascade(ctx, [{ task: tasks[1], patch: { constraint: SNET("2026-11-12") } }]);
  const undo = P.undoItems(items);
  assert.deepEqual(undo, [
    { taskId: 2, patch: { start: "2026-11-04", duration: 2, constraint: null, mode: null } },
    { taskId: 3, patch: { start: "2026-11-04", duration: 1, constraint: null, mode: null } },
  ]);
  for (const u of undo) assert.ok(S.sanitizePatch(u.patch).ok);
  undo[0].patch.start = "x";
  assert.equal(items[0].before.start, "2026-11-04", "salinan, bukan alias");
  // Mulai yang dulu tidak ada (new) → start null; durasi lama dipertahankan persis
  const t = [mk({ id: 1, start: "2026-11-02", d: 1 }), mk({ id: 2, deps: [[1]] }), mk({ id: 3, d: 4, deps: [[1]], mode: "auto" })];
  const ctx2 = ctxOf(t);
  const u2 = P.undoItems(P.diff(M.run(ctx2), ctx2));
  assert.deepEqual(u2, [
    { taskId: 2, patch: NOTHING },
    { taskId: 3, patch: { start: null, duration: 4, constraint: null, mode: "auto" } },
  ]);
  // gestur tautkan (patch deps) → before ikut memuat deps lama agar Urungkan melepas tautan
  const link = P.cascade(ctx, [{ task: tasks[3], patch: { deps: [{ t: { $task: 2 }, type: "FS", lag: 0 }] } }]);
  const u3 = P.undoItems(link.items);
  assert.equal(u3[0].taskId, 4);
  assert.deepEqual(u3[0].patch, { start: "2026-11-02", duration: 1, constraint: null, mode: null, deps: null });
});

test("preview: moved, Selesai project lama → baru + Δ hk, late, notMoved (jangkar bertabrakan, cycle), brokenDeps", () => {
  const tasks = [
    mk({ id: 1, start: "2026-11-02", d: 2 }), // A akar
    mk({ id: 2, start: "2026-11-04", d: 2, deadline: "2026-11-06", deps: [[1]] }), // B → Jum 6–Sen 9, lewat tenggat 1
    mk({ id: 3, start: "2026-11-09", d: 1, mode: "manual", deps: [[2]] }), // Manual → bertabrakan (baru)
    mk({ id: 4, start: "2026-11-09", d: 1, constraint: { type: "MFO", date: "2026-11-09" }, deps: [[2]] }), // MFO bertabrakan
    mk({ id: 5, start: "2026-11-06", d: 1, deps: [[2]] }), // D → Sel 10
    mk({ id: 6, deps: [[5]] }), // N tanpa Mulai/durasi → baru dijadwalkan
    mk({ id: 7, start: "2026-11-02", d: 1, deps: [[2], [8]] }), // Y ↔ Z lingkaran (sudah melanggar sebelumnya)
    mk({ id: 8, start: "2026-11-02", d: 1, deps: [[7]] }),
  ];
  const ctx = ctxOf(tasks);
  const before = M.run(ctx);
  const out = P.cascade(ctx, [{ task: tasks[0], patch: { start: "2026-11-04" } }]);
  assert.deepEqual(keys(out.items), ["1", "2", "5", "6"]);
  const pv = P.preview(out.items, out.result, ctx, before);
  assert.deepEqual(
    pv.rows.map((r) => [r.key, r.kind, r.from, r.to, r.deltaHk, r.isNew, r.durChanged, r.durGuess, r.late]),
    [
      ["1", "move", "2026-11-02", "2026-11-04", 2, false, false, false, 0],
      ["2", "move", "2026-11-04", "2026-11-06", 2, false, false, false, 1],
      ["5", "move", "2026-11-06", "2026-11-10", 2, false, false, false, 0],
      ["6", "new", null, "2026-11-11", null, true, false, true, 0],
    ],
  );
  assert.equal(pv.rows[0].task, tasks[0]);
  assert.equal(pv.moved, 4);
  assert.equal(pv.endBefore, D("2026-11-09"));
  assert.equal(pv.endAfter, D("2026-11-11"));
  assert.equal(pv.endDelta, 2);
  assert.equal(pv.late, 1);
  assert.deepEqual(pv.notMoved, [
    { key: "3", why: "anchor" },
    { key: "4", why: "mfo" },
    { key: "7", why: "cycle" },
    { key: "8", why: "cycle" },
  ]);
  assert.equal(pv.brokenDeps, 2, "B→Manual dan B→MFO baru; B→Y sudah dilanggar sebelumnya");
  // tanpa item
  const empty = P.preview([], out.result, ctx, before);
  assert.deepEqual(empty, { rows: [], moved: 0, endBefore: null, endAfter: null, endDelta: null, late: 0, notMoved: [], brokenDeps: 0 });
});

test("preview: baris durasi berubah (jadwalkan ulang task sudah mulai) — from = to, durFrom → durTo", () => {
  const tasks = [mk({ id: 3, start: "2026-10-19", d: 10, progress: 40 })];
  const ctx = ctxOf(tasks);
  const r = M.run(ctx);
  const out = P.reschedule(ctx, r, D("2026-11-09"), new Set([unitKey("Alpha")]));
  const pv = P.preview(out.items, out.result, ctx, r);
  assert.equal(pv.rows.length, 1);
  const row = pv.rows[0];
  assert.deepEqual([row.kind, row.from, row.to, row.durFrom, row.durTo, row.durChanged, row.deltaHk], ["duration", "2026-10-19", "2026-10-19", 10, 21, true, 0]);
  assert.equal(pv.moved, 0);
  assert.equal(pv.endBefore, D("2026-10-30"));
  assert.equal(pv.endAfter, D("2026-11-16"));
  assert.equal(pv.endDelta, 11);
});

test("modePatch: pilih nilai sama dengan unit → {mode: null}", () => {
  const t = mk({ id: 1, start: "2026-11-02", d: 1 });
  const auto = autoUnits("Alpha");
  const manual = new Map();
  assert.deepEqual(P.modePatch(t, auto, "auto"), { mode: null });
  assert.deepEqual(P.modePatch(t, auto, "manual"), { mode: "manual" });
  assert.deepEqual(P.modePatch(t, manual, "manual"), { mode: null });
  assert.deepEqual(P.modePatch(t, manual, "auto"), { mode: "auto" });
  assert.deepEqual(P.modePatch(t, new Map([[unitKey("Alpha"), { auto: false }]]), "manual"), { mode: null });
  assert.deepEqual(P.modePatch(t, null, "manual"), { mode: null }, "units bukan Map = Manual");
});
