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
  if (o.actual !== undefined) ext["timeline.actual"] = o.actual;
  const extra = {};
  if (o.cid !== undefined) extra.cid = o.cid;
  if (o.est !== undefined) extra.estimated_pomodoros = o.est;
  return {
    ...extra,
    id: o.id,
    title: "T" + o.id,
    list_id: o.list_id === undefined ? LIST : o.list_id,
    project: o.project === undefined ? "Alpha" : o.project,
    gtd_status: o.gtd_status || (o.done ? "done" : "next"),
    completed_at: o.completed_at === undefined ? (o.done ? "2026-11-05T17:30:00Z" : null) : o.completed_at,
    progress: o.progress || 0,
    pomodoros_done: o.pomo || 0,
    deadline: o.deadline === undefined ? null : o.deadline,
    parent_id: o.parent === undefined ? null : o.parent,
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

test("sumber plan.js murni: tanpa Date sama sekali (termasuk Date.UTC), tanpa localeCompare, tanpa api/store/fetch/localStorage/innerHTML", () => {
  const src = fs.readFileSync(path.join(dir, "plan.js"), "utf8").replace(/\/\/.*$/gm, "");
  assert.ok(!/\bDate\b/.test(src), "plan.js tanpa Date");
  assert.ok(!/localeCompare\(/.test(src), "plan.js tanpa localeCompare");
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

test("cascade (K32): hanya turunan yang DIGESER gestur yang ditulis — drift di belakang jangkar yang tidak bergeser, dan drift turunan langsung yang ES-nya tidak berubah, tidak ikut; patch tetap relatif ke nilai tersimpan", () => {
  const tasks = [
    mk({ id: 1, start: "2026-11-02", d: 2 }), // A akar, digeser ke Sen 9
    mk({ id: 2, start: "2026-11-04", d: 1, mode: "manual", deps: [[1]] }), // M jangkar Manual, tidak bergeser
    mk({ id: 3, start: "2026-11-02", d: 1, deps: [[2]] }), // C drift di belakang M (ES Kam 5 sebelum & sesudah)
    mk({ id: 4, start: "2026-11-02", d: 1, deps: [[2], [1]] }), // D di belakang M DAN A: jalur A menggesernya
    mk({ id: 5, start: "2026-11-02", d: 1, constraint: SNET("2026-11-20"), deps: [[1]] }), // B drift, ES Jum 20 tetap
    mk({ id: 6, start: "2026-11-04", d: 1, deps: [[1]] }), // E konsisten → digeser
  ];
  const ctx = ctxOf(tasks);
  const before = M.run(ctx);
  assert.ok(before.drift.has("3") && before.drift.has("4") && before.drift.has("5"), "prasyarat drift");
  const out = P.cascade(ctx, [{ task: tasks[0], patch: { start: "2026-11-09" } }]);
  assert.deepEqual(keys(out.items), ["1", "4", "6"]);
  assert.equal(out.gestureCount, 1);
  assert.equal(out.over, false);
  const m = byKey(out.items);
  // (iii) D digeser jalur A (Kam 5 → Rab 11); patch & Δ relatif ke Mulai tersimpan Sen 2
  assert.deepEqual(m.get("4").patch, { start: "2026-11-11" });
  assert.equal(m.get("4").deltaHk, 7);
  assert.equal(m.get("4").before.start, "2026-11-02");
  assert.deepEqual(m.get("6").patch, { start: "2026-11-11" });
  assert.ok(out.result.drift.has("3") && out.result.drift.has("5"), "C dan B tetap drift (tidak diselundupkan)");
  // hasil sebelum boleh diberikan pemanggil (tanpa hitung ulang) → hasil sama
  assert.deepEqual(P.cascade(ctx, [{ task: tasks[0], patch: { start: "2026-11-09" } }], before).items, out.items);
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

test("reschedule: milestone yang sudah mulai ikut cabang belum-mulai (otomatis SNET T + start T; Manual start T), durasi tidak pernah ditulis; drift hilir yang tidak digeser tidak ditulis", () => {
  const T = D("2026-11-09");
  const tasks = [
    mk({ id: 1, start: "2026-11-04", d: 0, progress: 10 }), // milestone otomatis sudah mulai
    mk({ id: 2, start: "2026-11-04", d: 0, pomo: 1, project: "Beta" }), // milestone Manual sudah mulai
    mk({ id: 3, start: "2026-11-02", d: 1 }), // akar lampau → SNET T
    mk({ id: 4, start: "2026-11-02", d: 1, constraint: SNET("2026-11-20"), deps: [[3]] }), // drift, ES Jum 20 tetap
  ];
  const ctx = ctxOf(tasks);
  const r = M.run(ctx);
  const out = P.reschedule(ctx, r, T, new Set([unitKey("Alpha"), unitKey("Beta")]));
  const m = byKey(out.items);
  assert.deepEqual([...m.keys()].sort(), ["1", "2", "3"]);
  assert.deepEqual(m.get("1").patch, { constraint: SNET("2026-11-09"), start: "2026-11-09" });
  assert.deepEqual(m.get("2").patch, { start: "2026-11-09" });
  assert.ok(out.items.every((i) => !("duration" in i.patch)), "milestone tidak menjadi bar");
  assert.equal(out.result.nodes.get("1").es, T);
  assertSane(out.items);
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
  const sane = (list) => assertSane(list.map((u) => ({ key: String(u.taskId), patch: u.patch })));
  sane(undo);
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
  sane(u2);
  // gestur tautkan (patch deps) → before ikut memuat deps lama agar Urungkan melepas tautan
  const link = P.cascade(ctx, [{ task: tasks[3], patch: { deps: [{ t: { $task: 2 }, type: "FS", lag: 0 }] } }]);
  const u3 = P.undoItems(link.items);
  assert.equal(u3[0].taskId, 4);
  assert.deepEqual(u3[0].patch, { start: "2026-11-02", duration: 1, constraint: null, mode: null, deps: null });
  sane(u3);
});

test("undoItems: nilai before yang korup (gagal sanitizePatch per kunci) → null; batch Urungkan tetap sah", () => {
  const tasks = [
    mk({ id: 1, start: "2026-11-02", d: 2 }),
    mk({ id: 2, start: "2026-11-04", d: "x", mode: "kacau", constraint: { type: "XX", date: "2026-11-01" }, deps: [[1]] }),
  ];
  const ctx = ctxOf(tasks);
  const { items } = P.cascade(ctx, [{ task: tasks[1], patch: { constraint: SNET("2026-11-12") } }]);
  assert.deepEqual(items[0].before, { start: "2026-11-04", duration: "x", constraint: { type: "XX", date: "2026-11-01" }, mode: "kacau" }, "before tetap mentah (CAS)");
  const undo = P.undoItems(items);
  assert.deepEqual(undo, [{ taskId: 2, patch: { start: "2026-11-04", duration: null, constraint: null, mode: null } }]);
  assertSane(undo.map((u) => ({ key: String(u.taskId), patch: u.patch })));
});

test("undoItems: deps lama dengan SATU entri format masa depan → ditulis MENTAH apa adanya (tidak menghapus semua dependensi)", () => {
  const tasks = [
    mk({ id: 1, start: "2026-11-02", d: 1 }),
    mk({ id: 2, start: "2026-11-03", d: 1 }),
    mk({ id: 3, start: "2026-11-04", d: 1, deps: [[1], [2, "ZZ", 2]] }), // "ZZ" = tipe versi mendatang
  ];
  tasks[2].ext["timeline.deps"][0].note = "kunci tak dikenal"; // bentuk masa depan lain pada entri sah
  const ctx = ctxOf(tasks);
  const rawDeps = JSON.parse(JSON.stringify(tasks[2].ext["timeline.deps"]));
  assert.equal(S.sanitizePatch({ deps: rawDeps }).ok, false, "prasyarat: deps lama gagal sanitizePatch");
  const link = P.cascade(ctx, [{ task: tasks[2], patch: { deps: [{ t: { $task: 1 }, type: "FS", lag: 0 }] } }]);
  assert.deepEqual(link.items[0].before.deps, rawDeps, "before mentah");
  const undo = P.undoItems(link.items);
  assert.deepEqual(undo[0].patch.deps, rawDeps, "Urungkan membawa deps mentah verbatim");
  assert.notEqual(undo[0].patch.deps, link.items[0].before.deps, "salinan, bukan alias");
  // kunci lain tetap dipetakan null bila korup (R22)
  const bad = P.undoItems([{ task: { id: 9 }, before: { start: "2026-11-04", duration: "x", deps: null } }]);
  assert.deepEqual(bad[0].patch, { start: "2026-11-04", duration: null, deps: null });
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

test("preview: before null → null (pelanggaran yang sudah ada tidak pernah dianggap baru)", () => {
  const tasks = cascadeData();
  const ctx = ctxOf(tasks);
  const out = P.cascade(ctx, [{ task: tasks[0], patch: { start: "2026-11-04" } }]);
  assert.equal(P.preview(out.items, out.result, ctx, null), null);
  assert.equal(P.preview(out.items, out.result, ctx, undefined), null);
});

test("preview seedKeys (pratinjau sakelar): lingkaran unit yang tidak di hilir item tetap tercantum di notMoved", () => {
  const tasks = [
    mk({ id: 1, start: "2026-11-02", d: 3 }),
    mk({ id: 2, start: "2026-11-03", d: 2, deps: [[1]] }), // berpelanggaran → dipindah saat ON
    mk({ id: 7, start: "2026-11-02", d: 1, deps: [[8]] }), // Y ↔ Z lingkaran, terpisah dari rantai
    mk({ id: 8, start: "2026-11-02", d: 1, deps: [[7]] }),
  ];
  const ctx = ctxOf(tasks, new Map());
  const before = M.run(ctx);
  const on = P.toggleUnit(ctx, unitKey("Alpha"), true);
  assert.deepEqual(keys(on.items), ["2"]);
  assert.deepEqual(P.preview(on.items, on.result, ctx, before).notMoved, [], "tanpa seedKeys: tidak terjangkau");
  const unitNodes = new Set([...on.result.nodes.values()].filter((n) => n.g === unitKey("Alpha")).map((n) => n.key));
  const pv = P.preview(on.items, on.result, ctx, before, unitNodes);
  assert.deepEqual(pv.notMoved, [
    { key: "7", why: "cycle" },
    { key: "8", why: "cycle" },
  ]);
  assert.equal(pv.rows.length, 1);
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

// ---- PR 1c-2 Task 3: kodek baseline + pembanding rencana-vs-baseline (K41, Review Focus 3) ----

const utf8 = (data) => Buffer.byteLength(JSON.stringify(data), "utf8");
const META = { n: 2, name: "Rencana awal ✓🌸", savedAt: "2026-11-05T03:00:00Z", by: "Yatno" };

// Unit Alpha (otomatis) + Beta (Manual): terjadwal biasa, selesai (K41: ikut), tanpa Mulai (bukan simpul), ringkasan.
function blTasks() {
  return [
    mk({ id: 1, start: "2026-11-02", d: 2, est: 4 }), // Sen 2 → Sel 3
    mk({ id: 2, start: "2026-11-04", d: 3, deps: [[1]] }), // Rab 4 → Jum 6
    mk({ id: 3, start: "2026-10-26", d: 1, done: true }), // selesai: completed_at 17:30Z Kam 5 → Jum 6 Jakarta
    mk({ id: 4, d: 2 }), // tanpa Mulai, tanpa pendahulu → bukan simpul
    mk({ id: 5, start: "2026-11-02", d: 1 }), // ringkasan (punya anak 6) → tidak ikut
    mk({ id: 6, start: "2026-11-03", d: 1, parent: 5 }),
    mk({ id: 11, start: "2026-11-05", d: 1, project: "Beta" }),
  ];
}

test("modul 1c-2: ekspor BL_MAX 65536 + baselineEncode/baselineByteSize/baselineDecode/compareBaseline", () => {
  assert.equal(P.BL_MAX, 65536);
  for (const f of ["baselineEncode", "baselineByteSize", "baselineDecode", "compareBaseline"]) assert.equal(typeof P[f], "function", f);
});

test("baselineEncode: simpul terjadwal non-ringkasan di unit TERMASUK selesai (K41); t = [[{$task: id}, iso(es), iso(ef), d, w]] urut cmpKey; w = estimated_pomodoros (tak ada → 0); bytes = UTF-8 JSON", () => {
  const ctx = ctxOf(blTasks(), autoUnits("Alpha"));
  const before = snap(ctx);
  const r = M.run(ctx);
  const out = P.baselineEncode(r, ctx, META, unitKey("Alpha"));
  assert.deepEqual(out.data, {
    v: 1,
    n: 2,
    name: "Rencana awal ✓🌸",
    savedAt: "2026-11-05T03:00:00Z",
    by: "Yatno",
    t: [
      [{ $task: 1 }, "2026-11-02", "2026-11-03", 2, 4],
      [{ $task: 2 }, "2026-11-04", "2026-11-06", 3, 0],
      [{ $task: 3 }, "2026-10-26", "2026-11-06", 1, 0],
      [{ $task: 6 }, "2026-11-03", "2026-11-03", 1, 0],
    ],
  });
  assert.equal(out.count, 4);
  assert.equal(out.bytes, utf8(out.data), "byte UTF-8 (nama multibyte ✓🌸)");
  assert.equal(P.baselineByteSize(out.data), out.bytes);
  assert.notEqual(out.bytes, JSON.stringify(out.data).length, "bukan panjang unit kode");
  // tanpa unit → semua simpul (urut cmpKey: "11" sebelum "2")
  const all = P.baselineEncode(r, ctx, META);
  assert.deepEqual(all.data.t.map((e) => e[0].$task), [1, 11, 2, 3, 6]);
  // id task mentah dipertahankan (cid string tetap string; host menulis ulang ke id server)
  const ctx2 = ctxOf([mk({ id: "c-7", start: "2026-11-02", d: 1 })]);
  assert.deepEqual(P.baselineEncode(M.run(ctx2), ctx2, META).data.t, [[{ $task: "c-7" }, "2026-11-02", "2026-11-02", 1, 0]]);
  // w: hanya bilangan bulat ≥ 0
  const ctx3 = ctxOf([mk({ id: 1, start: "2026-11-02", d: 1, est: -1 }), mk({ id: 2, start: "2026-11-02", d: 1, est: 2.5 }), mk({ id: 3, start: "2026-11-02", d: 0, est: 0 })]);
  assert.deepEqual(P.baselineEncode(M.run(ctx3), ctx3, META).data.t.map((e) => e[4]), [0, 0, 0]);
  assert.equal(snap(ctx), before, "ctx tidak diubah");
});

test("baselineEncode: determinisme — urutan task masukan diacak → data identik (cmpKey, bukan urutan lokal)", () => {
  const tasks = blTasks();
  const a = ctxOf(tasks, autoUnits("Alpha"));
  const b = ctxOf(tasks.slice().reverse(), autoUnits("Alpha"));
  const ea = P.baselineEncode(M.run(a), a, META);
  const eb = P.baselineEncode(M.run(b), b, META);
  assert.equal(JSON.stringify(ea.data), JSON.stringify(eb.data));
  // kunci string campuran: urut unit kode ("B" < "a" < "c-1")
  const c = ctxOf([mk({ id: "c-1", start: "2026-11-02", d: 1 }), mk({ id: "a", start: "2026-11-02", d: 1 }), mk({ id: "B", start: "2026-11-02", d: 1 })]);
  assert.deepEqual(P.baselineEncode(M.run(c), c, META).data.t.map((e) => e[0].$task), ["B", "a", "c-1"]);
});

test("baselineByteSize: ±55 B/task — 1000 task muat < 65536 dan 1300 task > BL_MAX (ditolak di T5); ukuran akurat", () => {
  const big = (n) => {
    const tasks = [];
    for (let i = 0; i < n; i++) tasks.push(mk({ id: 100000 + i, start: "2026-11-02", d: 10, est: 12 }));
    const ctx = ctxOf(tasks);
    return P.baselineEncode(M.run(ctx), ctx, META);
  };
  const k = big(1000);
  assert.equal(k.count, 1000);
  assert.equal(k.bytes, utf8(k.data));
  assert.ok(k.bytes / 1000 <= 55, "≤ 55 B/task: " + k.bytes);
  assert.ok(k.bytes < P.BL_MAX);
  const over = big(1300);
  assert.ok(over.bytes > P.BL_MAX, "1300 task > 64 KB: " + over.bytes);
  assert.equal(over.bytes, utf8(over.data));
  // pasangan surrogate (emoji) = 4 byte, BMP non-ASCII = 3/2 byte
  for (const name of ["🌸", "✓", "é", "abc", ""]) {
    const d = { v: 1, n: 1, name, savedAt: null, by: null, t: [] };
    assert.equal(P.baselineByteSize(d), utf8(d), name);
  }
});

test("baselineDecode: round-trip encode → JSON → decode; rows Map<key, {s: dn, f: dn, d, w}> (w dibaca sejak 1d-2)", () => {
  const ctx = ctxOf(blTasks(), autoUnits("Alpha"));
  const enc = P.baselineEncode(M.run(ctx), ctx, META, unitKey("Alpha"));
  const dec = P.baselineDecode(JSON.parse(JSON.stringify(enc.data)));
  assert.equal(dec.n, 2);
  assert.equal(dec.name, "Rencana awal ✓🌸");
  assert.equal(dec.savedAt, "2026-11-05T03:00:00Z");
  assert.equal(dec.by, "Yatno");
  assert.ok(dec.rows instanceof Map);
  assert.deepEqual([...dec.rows.keys()], ["1", "2", "3", "6"]);
  assert.deepEqual(dec.rows.get("1"), { s: D("2026-11-02"), f: D("2026-11-03"), d: 2, w: 4 });
  assert.deepEqual(dec.rows.get("3"), { s: D("2026-10-26"), f: D("2026-11-06"), d: 1, w: 0 });
});

test("baselineDecode 1d-2 (R3): w = e[4] bila bilangan bulat ≥ 0; absen (baseline 1c-2 larik 4) / negatif / pecahan / string / null / NaN / Infinity / boolean → 0; baris tetap sah", () => {
  const row = (id, w) => (w === undefined ? [{ $task: id }, "2026-11-02", "2026-11-03", 2] : [{ $task: id }, "2026-11-02", "2026-11-03", 2, w]);
  const cases = [
    [1, 7, 7],
    [2, 0, 0],
    [3, undefined, 0], // larik 4 elemen (baseline lama) → w 0
    [4, -1, 0],
    [5, 2.5, 0],
    [6, "5", 0],
    [7, null, 0],
    [8, NaN, 0],
    [9, Infinity, 0],
    [10, true, 0],
    [11, 99, 99],
  ];
  const dec = P.baselineDecode({ v: 1, n: 1, name: "Baseline 1", savedAt: null, by: null, t: cases.map(([id, w]) => row(id, w)) });
  assert.ok(dec);
  assert.equal(dec.rows.size, cases.length, "w rusak tidak membuang baris");
  for (const [id, , want] of cases) {
    assert.deepEqual(dec.rows.get(String(id)), { s: D("2026-11-02"), f: D("2026-11-03"), d: 2, w: want }, "task " + id);
  }
  // elemen setelah w diabaikan (bentuk masa depan), w tetap dibaca
  const fut = P.baselineDecode({ v: 1, n: 2, t: [[{ $task: 1 }, "2026-11-02", "2026-11-02", 1, 3, "x"]] });
  assert.deepEqual(fut.rows.get("1"), { s: D("2026-11-02"), f: D("2026-11-02"), d: 1, w: 3 });
});

test("baselineDecode review F1 (M2): w sah hanya bilangan bulat 0..BATAS (BATAS = EST_MAX host 99, tes silang pomologic + TLLoad); 1e300 / −1 / 1,5 / BATAS+1 → 0, baris tetap sah", () => {
  const pomologic = require(path.join(__dirname, "../../static/offline/pomologic.js"));
  const LD = require(path.join(dir, "load.js"));
  const BATAS = pomologic.EST_MAX;
  assert.equal(BATAS, 99);
  assert.equal(LD.EST_MAX, BATAS, "batas w decode = batas target 🍅 Timeline");
  const cases = [
    [1, 1e300, 0], // bilangan bulat menurut Number.isInteger, tetapi di luar batas → 0 (BAC tidak meledak)
    [2, -1, 0],
    [3, 1.5, 0],
    [4, BATAS, BATAS],
    [5, BATAS + 1, 0],
    [6, Number.MAX_SAFE_INTEGER, 0],
    [7, 0, 0],
    [8, 1, 1],
  ];
  const dec = P.baselineDecode({ v: 1, n: 1, t: cases.map(([id, w]) => [{ $task: id }, "2026-11-02", "2026-11-03", 2, w]) });
  assert.equal(dec.rows.size, cases.length, "w di luar batas tidak membuang baris");
  for (const [id, w, want] of cases) {
    assert.deepEqual(dec.rows.get(String(id)), { s: D("2026-11-02"), f: D("2026-11-03"), d: 2, w: want }, "w " + w);
  }
});

test("compareBaseline 1d-2: tambahan w di baris tidak mengubah keluaran (w diabaikan)", () => {
  const units = autoUnits("Alpha");
  const tasks = [mk({ id: 1, start: "2026-11-04", d: 2 }), mk({ id: 2, start: "2026-11-02", d: 1 })];
  const ctx = ctxOf(tasks, units);
  const r = M.run(ctx);
  const rows = (w) => new Map([
    ["1", Object.assign({ s: D("2026-11-02"), f: D("2026-11-03"), d: 2 }, w === undefined ? {} : { w })],
    ["2", Object.assign({ s: D("2026-11-02"), f: D("2026-11-02"), d: 1 }, w === undefined ? {} : { w })],
  ]);
  const ser = (c) => JSON.stringify({ perTask: [...c.perTask], group: [...c.group] });
  const base = ser(P.compareBaseline(r, { n: 1, rows: rows() }, ctx));
  for (const w of [0, 5, 99]) assert.equal(ser(P.compareBaseline(r, { n: 1, rows: rows(w) }, ctx)), base, "w " + w);
});

test("baselineDecode (Review Focus 3): v 2 / bukan objek / t bukan larik / n di luar 1–3 → null; entri rusak dan ref tak terpecahkan → dilewati, bukan null total", () => {
  const ok = [{ $task: 1 }, "2026-11-02", "2026-11-03", 2, 0];
  const base = (t, extra) => Object.assign({ v: 1, n: 1, name: "Baseline 1", savedAt: "2026-11-05T03:00:00Z", by: null, t }, extra || {});
  assert.equal(P.baselineDecode(base([ok], { v: 2 })), null);
  assert.equal(P.baselineDecode(null), null);
  assert.equal(P.baselineDecode("x"), null);
  assert.equal(P.baselineDecode([ok]), null);
  assert.equal(P.baselineDecode(base({})), null);
  assert.equal(P.baselineDecode(base([ok], { n: 4 })), null);
  assert.equal(P.baselineDecode(base([ok], { n: "1" })), null);
  const dec = P.baselineDecode(
    base([
      ["x"], // pendek
      "baris", // bukan larik
      [null, "2026-11-02", "2026-11-03", 1, 0], // ref null (task tak pernah terkirim)
      [{ $task: true }, "2026-11-02", "2026-11-03", 1, 0], // ref tak sah
      [{}, "2026-11-02", "2026-11-03", 1, 0], // tanpa $task
      [{ $task: 2 }, "2026-13-40", "2026-11-03", 1, 0], // tanggal rusak
      [{ $task: 3 }, "2026-11-04", "2026-11-03", 1, 0], // f < s
      [{ $task: 4 }, "2026-11-02", "2026-11-03", -1, 0], // durasi tak sah
      [{ $task: 5 }, "2026-11-02", "2026-11-03", 1.5, 0],
      ok,
      [{ $task: 1 }, "2026-11-09", "2026-11-09", 1, 0], // ganda → yang pertama menang
      [{ $task: "c-9" }, "2026-11-04", "2026-11-04", 0], // tanpa w (larik 4) → tetap sah; cid string
    ]),
  );
  assert.ok(dec, "data dengan entri rusak tidak null total");
  assert.deepEqual([...dec.rows.keys()], ["1", "c-9"]);
  assert.deepEqual(dec.rows.get("1"), { s: D("2026-11-02"), f: D("2026-11-03"), d: 2, w: 0 });
  assert.deepEqual(dec.rows.get("c-9"), { s: D("2026-11-04"), f: D("2026-11-04"), d: 0, w: 0 });
  // meta asing → bentuk aman
  const odd = P.baselineDecode({ v: 1, n: 3, t: [] });
  assert.deepEqual([odd.n, odd.name, odd.savedAt, odd.by, odd.rows.size], [3, "", null, null, 0]);
});

test("compareBaseline: mundur 2 hk → ds 2 (positif = mundur, akhir pekan tidak dihitung); durasi beda → dd; task terhapus / ref asing → dilewati; cid → id server; blEnd/nowEnd per kelompok", () => {
  const units = autoUnits("Alpha");
  const v1 = [
    mk({ id: 1, start: "2026-11-02", d: 2 }), // Sen 2 → Sel 3
    mk({ id: 2, start: "2026-11-04", d: 3, deps: [[1]] }), // Rab 4 → Jum 6
    mk({ id: 3, start: "2026-11-02", d: 1 }), // akan dihapus
    mk({ id: 6, start: "2026-11-03", d: 1 }),
    mk({ id: 8, start: "2026-11-06", d: 1 }), // Jum 6
    mk({ id: 9, start: "2026-11-04", d: 1 }), // Rab 4
    mk({ id: "c-7", start: "2026-11-05", d: 1 }), // dibuat offline
    mk({ id: 11, start: "2026-11-05", d: 1, project: "Beta" }), // Kam 5
  ];
  const c1 = ctxOf(v1, units);
  const dec = P.baselineDecode(JSON.parse(JSON.stringify(P.baselineEncode(M.run(c1), c1, META).data)));
  dec.rows.set("999", { s: D("2026-11-02"), f: D("2026-11-02"), d: 1 }); // task asing / sudah dihapus dari scope
  const v2 = [
    mk({ id: 1, start: "2026-11-04", d: 2 }), // Rab 4 → Kam 5: +2 hk
    mk({ id: 2, start: "2026-11-04", d: 5, deps: [[1]] }), // FS → Jum 6, d 5 → Kam 12
    mk({ id: 6, start: "2026-11-03", d: 1 }), // tetap
    mk({ id: 8, start: "2026-11-09", d: 1 }), // Jum 6 → Sen 9: +1 hk (Sab/Min tidak dihitung)
    mk({ id: 9, start: "2026-11-02", d: 1 }), // Rab 4 → Sen 2: −2 hk (maju)
    Object.assign(mk({ id: 70, start: "2026-11-05", d: 1 }), { cid: "c-7" }), // sudah terkirim: id server 70
    mk({ id: 11, start: "2026-11-10", d: 1, project: "Beta" }), // Kam 5 → Sel 10: +3 hk
  ];
  const c2 = ctxOf(v2, units);
  const before = snap(c2);
  const r2 = M.run(c2);
  const cmp = P.compareBaseline(r2, dec, c2);
  assert.ok(cmp.perTask instanceof Map && cmp.group instanceof Map);
  assert.deepEqual([...cmp.perTask.keys()], ["1", "11", "2", "6", "8", "9", "70"]);
  assert.deepEqual(cmp.perTask.get("1"), { ds: 2, df: 2, dd: 0 });
  assert.deepEqual(cmp.perTask.get("2"), { ds: 2, df: 4, dd: 2 });
  assert.deepEqual(cmp.perTask.get("6"), { ds: 0, df: 0, dd: 0 });
  assert.deepEqual(cmp.perTask.get("8"), { ds: 1, df: 1, dd: 0 });
  assert.deepEqual(cmp.perTask.get("9"), { ds: -2, df: -2, dd: 0 });
  assert.deepEqual(cmp.perTask.get("70"), { ds: 0, df: 0, dd: 0 }, "ref cid c-7 → task id 70");
  assert.deepEqual(cmp.perTask.get("11"), { ds: 3, df: 3, dd: 0 });
  assert.ok(!cmp.perTask.has("3") && !cmp.perTask.has("999") && !cmp.perTask.has("c-7"));
  assert.ok(!Object.is(cmp.perTask.get("6").ds, -0), "tanpa −0");
  const gA = unitKey("Alpha");
  const gB = unitKey("Beta");
  assert.deepEqual([...cmp.group.keys()].sort(), [gA, gB].sort());
  assert.deepEqual(cmp.group.get(gA), { blEnd: D("2026-11-06"), nowEnd: D("2026-11-12") });
  assert.deepEqual(cmp.group.get(gB), { blEnd: D("2026-11-05"), nowEnd: D("2026-11-10") });
  assert.equal(snap(c2), before, "ctx tidak diubah");
  // task di result tapi tidak di baseline → tidak ada entri; baseline null/rusak → kosong tanpa lempar
  const c3 = ctxOf([mk({ id: 50, start: "2026-11-02", d: 1 })], units);
  assert.equal(P.compareBaseline(M.run(c3), dec, c3).perTask.size, 0);
  const empty = P.compareBaseline(r2, null, c2);
  assert.deepEqual([empty.perTask.size, empty.group.size], [0, 0]);
});

// ---- PR 1c-2 Task 3 (carry-over T2): Jadwalkan ulang selaras jangkar aktual (K30/K36) ----

test("reschedule (K30/K36): task otomatis berjalan karena actual.start saja → perpanjangan durasi diukur dari es = actual.start (bukan Mulai tersimpan)", () => {
  const T = D("2026-11-09");
  // Mulai tersimpan Sen 19 Okt, aktual Sen 26 Okt, progress 0: jangkar started es Sen 26 Okt, ef Jum 6 Nov < T
  const tasks = [mk({ id: 1, start: "2026-10-19", d: 10, actual: { start: "2026-10-26" } })];
  const ctx = ctxOf(tasks);
  const r = M.run(ctx);
  assert.equal(r.nodes.get("1").fixed, "started");
  assert.equal(r.nodes.get("1").es, D("2026-10-26"));
  const out = P.reschedule(ctx, r, T, new Set([unitKey("Alpha")]));
  const c = ctx.cal;
  // r = 10 → selesai add(T, 9) = Jum 20 Nov; hari kerja 26 Okt..20 Nov = 20 (dari Mulai tersimpan akan 25)
  assert.equal(C.workdays(c, D("2026-10-26"), C.addWork(c, T, 9)), 20);
  assert.deepEqual(out.items.map((i) => [i.key, i.patch]), [["1", { duration: 20 }]]);
  assertSane(out.items);
});

test("reschedule (K30/K36): Manual d ≥ 1 dengan actual.start saja (progress 0) = sudah mulai → durasi diperpanjang dari Mulai tersimpan (jangkar Manual), tidak dipindah ke T; EF ≥ T → tidak ditulis", () => {
  const T = D("2026-11-09");
  const tasks = [
    mk({ id: 11, start: "2026-10-19", d: 5, project: "Beta", actual: { start: "2026-10-20" } }), // EF Jum 23 Okt < T
    mk({ id: 12, start: "2026-11-04", d: 5, project: "Beta", actual: { start: "2026-11-04" } }), // EF Sel 10 ≥ T
    mk({ id: 13, start: "2026-11-04", d: 5, project: "Beta" }), // kontrol: belum mulai → start T
  ];
  const ctx = ctxOf(tasks);
  const r = M.run(ctx);
  const out = P.reschedule(ctx, r, T, new Set([unitKey("Beta")]));
  const m = byKey(out.items);
  assert.deepEqual([...m.keys()].sort(), ["11", "13"]);
  // r = 5 → selesai add(T, 4) = Jum 13 Nov; hari kerja 19 Okt..13 Nov = 20
  assert.deepEqual(m.get("11").patch, { duration: 20 });
  assert.deepEqual(m.get("13").patch, { start: "2026-11-09" });
  assertSane(out.items);
});

test("reschedule (K36): milestone dengan actual.start — Manual → start T (jangkar Manual = tersimpan, tulisan efektif); otomatis → DILEWATI seluruhnya (SNET/start inert terhadap jangkar aktual); otomatis tanpa aktual (progress) tetap SNET T + start T", () => {
  const T = D("2026-11-09");
  const tasks = [
    mk({ id: 1, start: "2026-11-04", d: 0, actual: { start: "2026-11-04" } }), // otomatis, berjangkar aktual → lewati
    mk({ id: 2, start: "2026-11-04", d: 0, progress: 10 }), // otomatis, started tanpa aktual → amandemen 1c-1
    mk({ id: 3, start: "2026-11-04", d: 0, project: "Beta", actual: { start: "2026-11-04" } }), // Manual → start T
  ];
  const ctx = ctxOf(tasks);
  const r = M.run(ctx);
  const out = P.reschedule(ctx, r, T, new Set([unitKey("Alpha"), unitKey("Beta")]));
  const m = byKey(out.items);
  assert.deepEqual([...m.keys()].sort(), ["2", "3"]);
  assert.deepEqual(m.get("2").patch, { constraint: SNET("2026-11-09"), start: "2026-11-09" });
  assert.deepEqual(m.get("3").patch, { start: "2026-11-09" });
  assert.equal(out.result.nodes.get("1").es, D("2026-11-04"), "jangkar aktual tetap");
  assert.ok(out.items.every((i) => !("duration" in i.patch)));
  assertSane(out.items);
});
