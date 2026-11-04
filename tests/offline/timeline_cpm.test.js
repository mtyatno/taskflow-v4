// Plugin Timeline (Fase 1, PR 1c-1) — Task 2: mesin CPM (TLCpm.run) — SCC, forward/backward pass, slack, jalur kritis,
// drift, jangkar (rencana 1c-1 R8–R10, R24; spec 1c §5.1–§5.5). Semua tanggal tetap; tidak ada "hari ini".
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const dir = path.join(__dirname, "../../static/plugins/timeline");
const C = require(path.join(dir, "calendar.js"));
const S = require(path.join(dir, "schedule.js"));
const M = require(path.join(dir, "cpm.js"));

const D = (s) => C.dn(s);
const I = (n) => C.iso(n);
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
// Pembangun task. deps: [[id, type?, lag?], …]. d undefined → kunci duration tidak ada (durasi hilang).
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
    parent_id: o.parent === undefined ? null : o.parent,
    recurrence_type: o.recurrence_type || null,
    archived: !!o.archived,
    deleted: !!o.deleted,
    ext,
  };
}
const unitKey = (project, list_id = LIST) => S.unitOf({ list_id, project }).recId;
const autoUnits = (...projects) => new Map(projects.map((p) => [unitKey(p), { auto: true }]));
const run = (tasks, units = autoUnits("Alpha"), cal = std()) => M.run({ tasks, cal, units, readExt });
const node = (r, id) => r.nodes.get(String(id));

test("modul: pola part R2 (tanpa global, require fallback, ekspor beku)", () => {
  const src = fs.readFileSync(path.join(dir, "cpm.js"), "utf8");
  assert.match(src, /const TLCpm = \(function \(CAL, SCHED\)/);
  assert.match(src, /typeof TLCal !== "undefined" \? TLCal : require\("\.\/calendar\.js"\)/);
  assert.match(src, /typeof TLSched !== "undefined" \? TLSched : require\("\.\/schedule\.js"\)/);
  assert.match(src, /module\.exports = TLCpm/);
  assert.doesNotMatch(src, /\bwindow\b|\bself\b|\bglobalThis\b/);
  assert.ok(Object.isFrozen(M));
  assert.equal(typeof M.run, "function");
});

test("FS/SS/FF/SF × lag −2..3 × penerus milestone/biasa: ES/EF penerus otomatis = depReq; ES = nw(ES) untuk d ≥ 1, milestone tidak dijepret", () => {
  const c = std();
  let weekendMilestones = 0;
  let n = 0;
  // pendahulu: biasa (Rab, 3 hk) dan milestone Sabtu (akar otomatis: milestone tidak dijepret → tetap Sabtu)
  for (const pred of [{ start: "2026-11-04", d: 3 }, { start: "2026-11-07", d: 0 }]) {
    for (const type of S.TYPES) {
      for (let lag = -2; lag <= 3; lag++) {
        for (const d of [0, 1, 2]) {
          const r = run([mk({ id: 1, start: pred.start, d: pred.d }), mk({ id: 2, start: "2026-10-01", d, deps: [[1, type, lag]] })]);
          const p = node(r, 1);
          assert.equal(p.es, D(pred.start), "akar = Mulai tersimpan");
          const req = S.depReq(c, type, p.es, p.ef, lag, d);
          const es = d >= 1 ? C.nextWork(c, req) : req;
          const s = node(r, 2);
          assert.equal(s.es, es, `${type} lag ${lag} d ${d} pred ${pred.start}`);
          assert.equal(s.ef, S.fin(c, es, d));
          assert.deepEqual(s.driver, { kind: "pred", from: "1", type, lag });
          assert.equal(s.fixed, undefined);
          assert.equal(s.mode, "auto");
          assert.ok(r.drift.has("2"), "Mulai tersimpan 1 Okt ≠ hasil hitung → drift");
          if (d === 0 && !C.isWork(c, s.es)) weekendMilestones++;
          n++;
        }
      }
    }
  }
  assert.equal(n, 2 * 4 * 6 * 3);
  // FF lag 0 dari milestone Sabtu → milestone penerus Sabtu (tidak dijepret ke Senin)
  assert.ok(weekendMilestones >= 1);
  const r = run([mk({ id: 1, start: "2026-11-07", d: 0 }), mk({ id: 2, start: "2026-11-07", d: 0, deps: [[1, "FF", 0]] })]);
  assert.equal(I(node(r, 2).es), "2026-11-07");
  assert.ok(!r.drift.has("2"));
});

// Rantai 6 simpul, satu kelompok project. Identitas berlaku bila ujung rantai adalah EF terbesar kelompok (LF = P_g);
// rantai yang "mundur" (SF / lag negatif) memberi slack ke simpul yang selesai sebelum akhir project — itu CPM yang benar.
function chain(type, lag, durs, start, projectOf) {
  const tasks = durs.map((d, i) =>
    mk({ id: 101 + i, start: i === 0 ? start : "2026-01-05", d, deps: i ? [[100 + i, type, lag]] : undefined, project: projectOf ? projectOf(i) : "Alpha" }),
  );
  return tasks;
}

test("identitas: rantai 6 simpul tanpa cabang/tenggat, setiap tipe → ES = LS dan slack 0 di semua simpul", () => {
  const DURS = [[1, 1, 1, 1, 1, 1], [3, 0, 2, 4, 1, 2], [0, 0, 0, 0, 0, 0], [2, 5, 1, 0, 3, 1]];
  const STARTS = ["2026-11-04", "2026-12-21", "2026-12-31"]; // termasuk lewat Natal/cuti bersama dan Tahun Baru
  const qualified = { FS: 0, SS: 0, FF: 0, SF: 0 };
  for (const type of S.TYPES)
    for (let lag = -2; lag <= 3; lag++)
      for (const durs of DURS)
        for (const start of STARTS) {
          // (a) satu kelompok: identitas tidak tertutup oleh P_g bila ujung rantai = EF terbesar
          const r = run(chain(type, lag, durs, start));
          const last = node(r, 106);
          if (last.ef === r.groupEnd.get(unitKey("Alpha"))) {
            qualified[type]++;
            for (let i = 0; i < 6; i++) {
              const n = node(r, 101 + i);
              assert.equal(n.ls, n.es, `${type} lag ${lag} durs ${durs} ${start} simpul ${i}`);
              assert.equal(n.lf, n.ef);
              assert.ok(Object.is(n.slack, 0));
              assert.equal(n.critical, true);
            }
          }
          // (b) setiap simpul di project sendiri (workspace sama): semua kombinasi
          const r2 = run(chain(type, lag, durs, start, (i) => "P" + i), autoUnits("P0", "P1", "P2", "P3", "P4", "P5"));
          for (let i = 0; i < 6; i++) {
            const n = node(r2, 101 + i);
            assert.equal(n.ls, n.es);
            assert.ok(Object.is(n.slack, 0));
          }
        }
  for (const t of S.TYPES) assert.ok(qualified[t] >= 6, `${t}: ${qualified[t]} kombinasi`);
});

test("akar otomatis: ES = Mulai tersimpannya sendiri (bukan ditarik ke awal project); akar dengan SNET lebih lambat → SNET", () => {
  const r = run([
    mk({ id: 1, start: "2026-11-02", d: 1 }),
    mk({ id: 2, start: "2026-11-10", d: 2 }),
    mk({ id: 3, start: "2026-11-10", d: 2, constraint: { type: "SNET", date: "2026-11-12" } }),
    mk({ id: 4, start: "2026-11-10", d: 2, constraint: { type: "SNET", date: "2026-11-03" } }),
    mk({ id: 5, start: "2026-11-10", d: 2, constraint: { type: "SNET", date: "2026-11-14" } }), // SNET Sabtu → nw = Senin
  ]);
  assert.equal(I(node(r, 2).es), "2026-11-10");
  assert.deepEqual(node(r, 2).driver, { kind: "root" });
  assert.ok(!r.drift.has("2"));
  assert.equal(I(node(r, 3).es), "2026-11-12");
  assert.deepEqual(node(r, 3).driver, { kind: "snet" });
  assert.ok(r.drift.has("3"));
  assert.equal(I(node(r, 4).es), "2026-11-10");
  assert.deepEqual(node(r, 4).driver, { kind: "root" });
  assert.equal(I(node(r, 5).es), "2026-11-16");
  assert.equal(I(node(r, 5).ef), "2026-11-17");
});

test("driver seri: urutan deps tersimpan, lalu SNET, lalu jangkar akar", () => {
  const r = run([
    mk({ id: 1, start: "2026-11-02", d: 3 }), // selesai Rab → FS Kam
    mk({ id: 2, start: "2026-11-03", d: 2 }), // selesai Rab → FS Kam
    mk({ id: 3, start: "2026-11-05", d: 1, deps: [[2], [1]] }),
    mk({ id: 4, start: "2026-11-05", d: 1, deps: [[1], [2]] }),
    mk({ id: 5, start: "2026-11-05", d: 1, deps: [[1]], constraint: { type: "SNET", date: "2026-11-05" } }),
    mk({ id: 6, start: "2026-11-05", d: 1, constraint: { type: "SNET", date: "2026-11-05" } }),
  ]);
  assert.deepEqual(node(r, 3).driver, { kind: "pred", from: "2", type: "FS", lag: 0 });
  assert.deepEqual(node(r, 4).driver, { kind: "pred", from: "1", type: "FS", lag: 0 });
  assert.deepEqual(r.pred.get("3").map((p) => p.key), ["2", "1"], "pred mengikuti urutan deps tersimpan");
  assert.deepEqual(node(r, 5).driver, { kind: "pred", from: "1", type: "FS", lag: 0 });
  assert.deepEqual(node(r, 6).driver, { kind: "snet" });
});

test("task tanpa Mulai dan tanpa pendahulu → bukan simpul", () => {
  const r = run([mk({ id: 1, d: 2 }), mk({ id: 2, start: "2026-11-02", d: 1 })]);
  assert.ok(!r.nodes.has("1"));
  assert.ok(!r.order.includes("1"));
  assert.ok(!r.drift.has("1"));
});

test("tanpa Mulai, berpendahulu, otomatis → simpul, durGuess bila durasi hilang", () => {
  const r = run([
    mk({ id: 1, start: "2026-11-10", d: 2 }),
    mk({ id: 2, deps: [[1]] }), // tanpa Mulai, tanpa durasi
    mk({ id: 3, d: 3, deps: [[2]] }), // rantai tanpa Mulai: simpul lewat pendahulu yang juga simpul
    mk({ id: 4, mode: "manual", deps: [[1]] }), // Manual tanpa Mulai → bukan simpul
  ]);
  const n2 = node(r, 2);
  assert.equal(I(n2.es), "2026-11-12");
  assert.equal(n2.d, 1);
  assert.equal(n2.durGuess, true);
  assert.ok(r.drift.has("2"));
  const n3 = node(r, 3);
  assert.equal(I(n3.es), "2026-11-13");
  assert.equal(I(n3.ef), "2026-11-17");
  assert.equal(n3.durGuess, undefined);
  assert.ok(r.drift.has("3"));
  assert.ok(!r.nodes.has("4"));
  assert.deepEqual(r.ignored.filter((x) => x.to === "4"), [{ from: "1", to: "4", reason: "notNode" }]);
  assert.deepEqual(r.order, ["1", "2", "3"]);
});

test("jangkar: manual, selesai (ef dari completed_at '2026-11-05T17:30:00Z' → 2026-11-06 Jakarta), sudah mulai (progress 10 / pomodoros_done 1), MFO; pendahulu memaksa lebih lambat → conflict true, nilai tetap", () => {
  // P: Sen 2 Nov, 5 hk → Jum 6 Nov; syarat FS penerus = Sen 9 Nov
  const P = mk({ id: 1, start: "2026-11-02", d: 5 });
  const r = run([
    P,
    mk({ id: 2, start: "2026-11-04", d: 2, mode: "manual", deps: [[1]] }),
    mk({ id: 3, start: "2026-11-04", d: 3, done: true, completed_at: "2026-11-05T17:30:00Z", deps: [[1]] }),
    mk({ id: 4, start: "2026-11-04", d: 2, progress: 10, deps: [[1]] }),
    mk({ id: 5, start: "2026-11-04", d: 2, pomo: 1, deps: [[1]] }),
    mk({ id: 6, start: "2026-11-30", d: 2, constraint: { type: "MFO", date: "2026-11-08" }, deps: [[1]] }), // MFO Minggu
    mk({ id: 7, start: "2026-11-30", d: 0, constraint: { type: "MFO", date: "2026-11-08" } }), // milestone MFO: tanpa pw
    mk({ id: 8, start: "2026-11-09", d: 1, mode: "manual", deps: [[1]] }), // tidak bertabrakan
    mk({ id: 9, start: "2026-11-04", d: 3, done: true, completed_at: "2026-11-01T02:00:00Z" }), // selesai sebelum Mulai → ef = es
    mk({ id: 10, start: "2026-11-04", d: 2, done: true, completed_at: null }), // tanpa completed_at → fin(es, d)
    mk({ id: 11, start: "2026-11-04", d: 2, gtd_status: "done", completed_at: "2026-11-05 20:00:00" }), // tanpa zona = UTC
  ]);
  const chk = (id, fixed, es, ef, conflict) => {
    const n = node(r, id);
    assert.equal(n.fixed, fixed, "fixed " + id);
    assert.equal(I(n.es), es, "es " + id);
    assert.equal(I(n.ef), ef, "ef " + id);
    assert.equal(n.conflict, conflict, "conflict " + id);
    assert.deepEqual(n.driver, { kind: "fixed" });
    assert.ok(!r.drift.has(String(id)), "jangkar tidak pernah drift");
  };
  chk(2, "manual", "2026-11-04", "2026-11-05", true);
  chk(3, "done", "2026-11-04", "2026-11-06", true);
  chk(4, "started", "2026-11-04", "2026-11-05", true);
  chk(5, "started", "2026-11-04", "2026-11-05", true);
  chk(6, "mfo", "2026-11-05", "2026-11-06", true);
  chk(7, "mfo", "2026-11-08", "2026-11-08", undefined);
  chk(8, "manual", "2026-11-09", "2026-11-09", undefined);
  chk(9, "done", "2026-11-04", "2026-11-04", undefined);
  chk(10, "done", "2026-11-04", "2026-11-05", undefined);
  chk(11, "done", "2026-11-04", "2026-11-06", undefined);
  assert.equal(node(r, 3).slack, null);
  assert.equal(node(r, 3).critical, false);
});

test("jangkar dan violations memakai SATU aturan 'terlalu awal' (TLSched.isEarly): conflict ⇔ violations, juga milestone akhir pekan", () => {
  const c = std();
  assert.equal(typeof S.isEarly, "function");
  assert.equal(S.isEarly(c, D("2026-11-07"), D("2026-11-09")), false, "milestone Sabtu, syarat Senin: nw(Sab) = Sen, aman");
  assert.equal(S.isEarly(c, D("2026-11-06"), D("2026-11-09")), true);
  assert.equal(S.isEarly(c, NaN, D("2026-11-09")), false);
  let n = 0;
  let hits = 0;
  for (const ps of ["2026-11-02", "2026-11-06", "2026-11-07"])
    for (const pd of [0, 1, 3])
      for (const ss of ["2026-11-04", "2026-11-06", "2026-11-07", "2026-11-08", "2026-11-09", "2026-11-11"])
        for (const sd of [0, 1, 2])
          for (const type of S.TYPES)
            for (const lag of [-1, 0, 2]) {
              const tasks = [mk({ id: 1, start: ps, d: pd }), mk({ id: 2, start: ss, d: sd, deps: [[1, type, lag]] })];
              const r = run(tasks, new Map()); // unit Manual → semua jangkar
              const spans = new Map([
                ["1", { s: D(ps), f: S.fin(c, D(ps), pd), d: pd }],
                ["2", { s: D(ss), f: S.fin(c, D(ss), sd), d: sd }],
              ]);
              const v = S.violations(c, spans, [{ from: "1", to: "2", type, lag, ok: true }]);
              assert.equal(!!node(r, 2).conflict, v.has("2"), `${ps}/${pd} → ${ss}/${sd} ${type} ${lag}`);
              if (v.has("2")) hits++;
              n++;
            }
  assert.ok(hits > 50 && hits < n);
});

test("backward: LF = maks EF kelompok project (dua project di workspace tidak saling memberi slack); tenggat sebelum EF → slack negatif (−1); kritis = slack ≤ 0 ∧ tidak selesai; selesai → slack null", () => {
  const r = run(
    [
      mk({ id: 1, start: "2026-11-02", d: 3 }), // Alpha: Sen–Rab
      mk({ id: 2, start: "2026-11-05", d: 2, deps: [[1]] }), // Alpha: Kam–Jum = akhir Alpha
      mk({ id: 3, start: "2026-11-02", d: 10, project: "Beta" }), // Beta: sampai Jum 13 Nov
      mk({ id: 4, start: "2026-11-02", d: 1 }), // Alpha, lepas
      mk({ id: 5, start: "2026-11-02", d: 3, deadline: "2026-11-03T00:00:00" }), // tenggat Sel, selesai Rab
      mk({ id: 6, start: "2026-11-02", d: 1, done: true, completed_at: "2026-11-02T03:00:00Z" }),
      mk({ id: 7, start: "2026-11-02", d: 1, deadline: "rusak" }),
    ],
    autoUnits("Alpha", "Beta"),
  );
  assert.equal(I(r.groupEnd.get(unitKey("Alpha"))), "2026-11-06");
  assert.equal(I(r.groupEnd.get(unitKey("Beta"))), "2026-11-13");
  assert.equal(node(r, 1).g, unitKey("Alpha"));
  assert.equal(node(r, 3).g, unitKey("Beta"));
  for (const id of [1, 2, 3]) {
    assert.ok(Object.is(node(r, id).slack, 0), "slack 0: " + id);
    assert.equal(node(r, id).critical, true);
  }
  assert.equal(node(r, 4).slack, 4); // Sel–Jum
  assert.equal(node(r, 4).critical, false);
  const n5 = node(r, 5);
  assert.equal(I(n5.lf), "2026-11-03");
  assert.equal(n5.slack, -1);
  assert.equal(n5.critical, true);
  assert.equal(n5.late, 1);
  assert.equal(node(r, 4).late, null, "tanpa tenggat → late null");
  assert.equal(node(r, 6).slack, null);
  assert.equal(node(r, 6).critical, false);
  assert.equal(node(r, 7).slack, 4, "tenggat rusak diabaikan");
  // MFO membatasi LF ≤ ef MFO: MFO Jum 6 Nov di kelompok yang berakhir 13 Nov → slack 0, kritis
  const rm = run([mk({ id: 1, start: "2026-11-02", d: 2, constraint: { type: "MFO", date: "2026-11-06" } }), mk({ id: 2, start: "2026-11-02", d: 10 })]);
  assert.equal(I(node(rm, 1).lf), "2026-11-06");
  assert.ok(Object.is(node(rm, 1).slack, 0));
  assert.equal(node(rm, 1).critical, true);
  // tenggat milestone tidak di-pw: milestone Sabtu, tenggat Sabtu → slack 0, tidak negatif
  const r2 = run([mk({ id: 1, start: "2026-11-07", d: 0, deadline: "2026-11-07" }), mk({ id: 2, start: "2026-11-02", d: 10 })]);
  assert.equal(I(node(r2, 1).lf), "2026-11-07");
  assert.ok(Object.is(node(r2, 1).slack, 0));
});

test("tepi (dikenal): pendahulu milestone akhir pekan — LF ≠ EF; slack dijepit 0 (bukan −0) bila LF < EF; bila LF > EF slack 1 dan keluar jalur kritis", () => {
  // Rumus §5.4 dihitung dari hari kerja; milestone Sabtu bukan hari kerja sehingga depLimit(depReq) ≠ EF di hampir semua
  // kombinasi (284/288 di vektor Task 1). Perilaku yang dikunci di sini (dicatat di laporan Task 2):
  // FS: LF = pw(Sen − 1) = Jum < EF Sab → slack = −workdays(Sab, Sab) = 0 (dijepit, kritis).
  const fs1 = run([mk({ id: 1, start: "2026-11-07", d: 0 }), mk({ id: 2, start: "2026-11-09", d: 1, deps: [[1, "FS", 0]] })]);
  assert.equal(I(node(fs1, 1).lf), "2026-11-06");
  assert.ok(Object.is(node(fs1, 1).slack, 0));
  assert.equal(node(fs1, 1).critical, true);
  // SS: LS_p = pw(Sen) = Sen → LF = Sen > EF Sab → slack = workdays(Min, Sen) = 1 → tidak kritis.
  const ss1 = run([mk({ id: 1, start: "2026-11-07", d: 0 }), mk({ id: 2, start: "2026-11-09", d: 1, deps: [[1, "SS", 0]] })]);
  assert.equal(I(node(ss1, 2).es), "2026-11-09");
  assert.ok(Object.is(node(ss1, 2).slack, 0));
  assert.equal(I(node(ss1, 1).lf), "2026-11-09");
  assert.equal(node(ss1, 1).slack, 1);
  assert.equal(node(ss1, 1).critical, false);
  // Tidak pernah −0 di seluruh vektor milestone akhir pekan.
  for (const type of S.TYPES)
    for (let lag = -2; lag <= 3; lag++)
      for (const d of [0, 1, 3]) {
        const r = run([mk({ id: 1, start: "2026-11-07", d: 0 }), mk({ id: 2, start: "2026-11-09", d, deps: [[1, type, lag]] })]);
        for (const k of ["1", "2"]) assert.ok(!Object.is(r.nodes.get(k).slack, -0), `${type} ${lag} ${d} ${k}`);
      }
});

test("milestone akhir pekan tersimpan di unit otomatis dengan pendahulu → drift (bukan conflict); akar d ≥ 1 di Sabtu → nw → drift; akar milestone Sabtu tetap", () => {
  const r = run([
    mk({ id: 1, start: "2026-11-06", d: 1 }),
    mk({ id: 2, start: "2026-11-07", d: 0, deps: [[1]] }),
    mk({ id: 3, start: "2026-11-07", d: 2 }),
    mk({ id: 4, start: "2026-11-07", d: 0 }),
  ]);
  assert.equal(I(node(r, 2).es), "2026-11-09");
  assert.equal(node(r, 2).conflict, undefined);
  assert.ok(r.drift.has("2"));
  assert.equal(I(node(r, 3).es), "2026-11-09");
  assert.ok(r.drift.has("3"));
  assert.equal(I(node(r, 4).es), "2026-11-07");
  assert.ok(!r.drift.has("4"));
});

test("SCC: 2-lingkaran, sisi diri, lingkaran dengan hilir → anggota fixed 'cycle', hilir tetap dihitung dari nilai tersimpan; cycles berisi kunci terurut; tidak menggantung", () => {
  const r = run([
    mk({ id: 22, start: "2026-11-02", d: 2, deps: [[21]] }),
    mk({ id: 21, start: "2026-11-04", d: 3, deps: [[22]] }), // 21: Rab–Jum
    mk({ id: 23, start: "2026-10-01", d: 1, deps: [[21]] }), // hilir
    mk({ id: 24, start: "2026-11-03", d: 1, deps: [[24]] }), // sisi diri
  ]);
  assert.deepEqual(r.cycles, [["21", "22"], ["24"]]);
  for (const id of [21, 22, 24]) {
    assert.equal(node(r, id).fixed, "cycle");
    assert.ok(!r.drift.has(String(id)));
  }
  assert.equal(I(node(r, 21).es), "2026-11-04");
  assert.equal(I(node(r, 22).es), "2026-11-02");
  assert.equal(I(node(r, 23).es), "2026-11-09");
  assert.deepEqual(node(r, 23).driver, { kind: "pred", from: "21", type: "FS", lag: 0 });
  assert.ok(r.drift.has("23"));
  const cyc = r.ignored.filter((x) => x.reason === "cycle");
  assert.deepEqual(cyc, [
    { from: "22", to: "21", reason: "cycle" },
    { from: "21", to: "22", reason: "cycle" },
    { from: "24", to: "24", reason: "cycle" },
  ]);
  assert.deepEqual(r.succ.get("21"), ["23"]);
  assert.deepEqual(r.pred.get("23"), [{ key: "21", type: "FS", lag: 0 }]);
  assert.equal(r.order.length, 4);
  // cincin 3.000 simpul: Tarjan iteratif, tidak menggantung / stack overflow
  const ring = [];
  for (let i = 0; i < 3000; i++) ring.push(mk({ id: 1000 + i, start: "2026-11-02", d: 1, deps: [[1000 + ((i + 1) % 3000)]] }));
  const t0 = process.hrtime.bigint();
  const rr = run(ring);
  assert.ok(Number(process.hrtime.bigint() - t0) / 1e6 < 5000);
  assert.equal(rr.cycles.length, 1);
  assert.equal(rr.cycles[0].length, 3000);
  assert.equal(rr.order.length, 3000);
});

test("diabaikan dengan alasan: ref hilang (unresolved), lintas scope (scope), ke/dari ringkasan (summary), ujung bukan simpul (notNode)", () => {
  const r = run([
    mk({ id: 1, start: "2026-11-02", d: 1 }),
    mk({ id: 2, start: "2026-11-03", d: 1, deps: [[999]] }),
    mk({ id: 3, start: "2026-11-02", d: 1, list_id: 8 }), // workspace lain
    mk({ id: 4, start: "2026-11-03", d: 1, deps: [[3]] }),
    mk({ id: 5, start: "2026-11-02", d: 4, deps: [[1]] }), // ringkasan (punya anak 6), dengan dep sendiri
    mk({ id: 6, start: "2026-11-02", d: 1, parent: 5 }),
    mk({ id: 7, start: "2026-11-09", d: 1, deps: [[5]] }),
    mk({ id: 8, d: 1 }), // tanpa Mulai, tanpa pendahulu → bukan simpul
    mk({ id: 9, start: "2026-11-09", d: 1, deps: [[8]] }),
  ]);
  const by = (to) => r.ignored.filter((x) => x.to === String(to));
  assert.deepEqual(by(2), [{ from: "999", to: "2", reason: "unresolved" }]);
  assert.deepEqual(by(4), [{ from: "3", to: "4", reason: "scope" }]);
  assert.deepEqual(by(5), [{ from: "1", to: "5", reason: "summary" }]);
  assert.deepEqual(by(7), [{ from: "5", to: "7", reason: "summary" }]);
  assert.deepEqual(by(9), [{ from: "8", to: "9", reason: "notNode" }]);
  assert.ok(!r.nodes.has("5"), "ringkasan bukan simpul");
  assert.deepEqual(r.summaries.get("5"), ["6"]);
  assert.ok(r.nodes.has("6"));
  for (const id of [2, 4, 7, 9]) assert.deepEqual(node(r, id).driver, { kind: "root" });
  assert.deepEqual(r.pred.get("2"), []);
});

test("berulang/archived/deleted dibuang", () => {
  const r = run([
    mk({ id: 1, start: "2026-11-02", d: 1, recurrence_type: "daily" }),
    mk({ id: 2, start: "2026-11-02", d: 1, gtd_status: "archived" }),
    mk({ id: 3, start: "2026-11-02", d: 1, archived: true }),
    mk({ id: 4, start: "2026-11-02", d: 1, deleted: true }),
    mk({ id: 5, start: "2026-11-03", d: 1, deps: [[1], [2], [3], [4]] }),
    mk({ id: 6, start: "2026-11-02", d: 1, parent: 7 }),
    mk({ id: 7, start: "2026-11-02", d: 1, archived: true }), // induk dibuang → bukan ringkasan
    mk({ id: 8, start: "2026-11-02", d: 1, deleted: true, parent: 9 }),
    mk({ id: 9, start: "2026-11-02", d: 1 }), // anak terhapus → bukan ringkasan
  ]);
  assert.deepEqual([...r.nodes.keys()].sort(), ["5", "6", "9"]);
  assert.deepEqual(
    r.ignored.map((x) => x.from + ">" + x.reason),
    ["1>unresolved", "2>unresolved", "3>unresolved", "4>unresolved"],
  );
  assert.equal(r.summaries.size, 0);
});

test("drift: otomatis non-jangkar dengan iso(es) ≠ start tersimpan → di drift; jangkar tidak pernah", () => {
  const r = run([
    mk({ id: 1, start: "2026-11-02", d: 3 }),
    mk({ id: 2, start: "2026-11-02", d: 1, deps: [[1]] }), // seharusnya Kam 5 Nov
    mk({ id: 3, start: "2026-11-05", d: 1, deps: [[1]] }), // sudah benar
    mk({ id: 4, start: "2026-11-02", d: 1, deps: [[1]], mode: "manual" }),
    mk({ id: 5, start: "2026-11-02", d: 1, deps: [[1]], progress: 50 }),
  ]);
  assert.deepEqual([...r.drift].sort(), ["2"]);
  assert.equal(node(r, 4).conflict, true);
  assert.equal(node(r, 5).conflict, true);
});

test("unit Manual → semua jangkar, slack tetap dihitung", () => {
  const r = run(
    [mk({ id: 1, start: "2026-11-02", d: 3 }), mk({ id: 2, start: "2026-11-09", d: 1, deps: [[1]] }), mk({ id: 3, start: "2026-11-02", d: 1, mode: "auto" })],
    new Map(),
  );
  assert.equal(node(r, 1).fixed, "manual");
  assert.equal(node(r, 1).mode, "manual");
  assert.equal(node(r, 2).fixed, "manual");
  assert.equal(node(r, 3).fixed, undefined, "ext.mode auto menang atas unit");
  assert.equal(node(r, 3).mode, "auto");
  assert.ok(Object.is(node(r, 2).slack, 0));
  assert.equal(I(node(r, 1).lf), "2026-11-06");
  assert.equal(node(r, 1).slack, 2);
  assert.equal(node(r, 1).critical, false);
  assert.equal(r.drift.size, 0);
});

test("kalender buntu (weekdays [1], semua Senin libur) → simpul uncomputable, run tidak melempar", () => {
  const off = new Set();
  for (let d = D("2020-01-06"); d <= D("2070-12-31"); d += 7) off.add(d);
  const synth = { mask: new Set([1]), off, work: new Set(), key: "sintetis" };
  let r;
  assert.doesNotThrow(() => {
    r = run(
      [
        mk({ id: 1, start: "2026-11-04", d: 2 }),
        mk({ id: 2, start: "2026-11-04", d: 1, deps: [[1]] }),
        mk({ id: 3, start: "2026-11-04", d: 0 }),
        mk({ id: 4, start: "2026-11-04", d: 2, mode: "manual" }),
      ],
      autoUnits("Alpha"),
      synth,
    );
  });
  assert.deepEqual([...r.uncomputable].sort(), ["1", "2", "4"]);
  for (const k of ["1", "2", "4"]) {
    const n = r.nodes.get(k);
    assert.equal(n.es, null);
    assert.equal(n.slack, null);
    assert.equal(n.critical, false);
    assert.ok(!r.drift.has(k));
  }
  assert.equal(I(node(r, 3).es), "2026-11-04", "milestone tanpa panggilan kalender tetap terhitung");
});

// ---- generator deterministik (LCG) ----
function lcg(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
function gen(nTasks, nDeps, seed, opts = {}) {
  const rnd = lcg(seed);
  const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1));
  const base = D("2026-11-02");
  const tasks = [];
  for (let i = 0; i < nTasks; i++) {
    const o = { id: 5000 + i, start: rnd() < 0.08 ? undefined : I(base + ri(0, 120)), d: rnd() < 0.05 ? undefined : ri(0, 8), project: opts.oneProject ? "Alpha" : ["Alpha", "Beta", "Gamma"][ri(0, 2)], deps: [] };
    if (!opts.plain) {
      const x = rnd();
      if (x < 0.05) o.mode = "manual";
      else if (x < 0.1) o.done = true;
      else if (x < 0.13) o.progress = 20;
      else if (x < 0.16) o.constraint = { type: "SNET", date: I(base + ri(0, 60)) };
      else if (x < 0.18) o.constraint = { type: "MFO", date: I(base + ri(10, 90)) };
      if (rnd() < 0.1) o.deadline = I(base + ri(0, 150));
    }
    tasks.push(o);
  }
  for (let k = 0; k < nDeps; k++) {
    let a = ri(0, nTasks - 1);
    let b = ri(0, nTasks - 1);
    if (opts.acyclic) {
      if (a === b) continue;
      if (a > b) [a, b] = [b, a];
    }
    const succ = tasks[b];
    if (succ.deps.some((x) => x[0] === 5000 + a) || succ.deps.length >= 20) continue;
    succ.deps.push([5000 + a, S.TYPES[ri(0, 3)], ri(-2, 3)]);
  }
  return tasks.map(mk);
}
function ser(r) {
  const ent = (m) => [...m.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return JSON.stringify({
    nodes: ent(r.nodes).map(([k, n]) => [k, Object.assign({}, n, { task: n.task.id })]),
    order: r.order,
    succ: ent(r.succ),
    pred: ent(r.pred),
    cycles: r.cycles,
    ignored: r.ignored,
    groupEnd: ent(r.groupEnd),
    drift: [...r.drift].sort(),
    summaries: ent(r.summaries),
    uncomputable: [...r.uncomputable].sort(),
  });
}

test("determinisme: 50 permutasi acak (benih tetap, LCG di tes) dari 120 task/150 dep → JSON hasil terurut identik", () => {
  const tasks = gen(120, 150, 12345);
  const units = autoUnits("Alpha", "Beta");
  const ref = ser(run(tasks, units));
  const r0 = run(tasks, units);
  assert.ok(r0.nodes.size > 90 && r0.cycles.length >= 1, "generator mencakup lingkaran");
  const rnd = lcg(777);
  for (let p = 0; p < 50; p++) {
    const arr = tasks.slice();
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    assert.equal(ser(run(arr, units)), ref, "permutasi " + p);
  }
});

test("kinerja: 500 simpul / 400 sisi (generator tetap) → median 5 putaran dicatat console.log, asersi ≤ 150 ms", () => {
  const tasks = gen(500, 400, 4242, { acyclic: true, plain: true, oneProject: true }).map((t) => {
    if (!t.ext["timeline.start"]) t.ext["timeline.start"] = "2026-11-02";
    return t;
  });
  const units = autoUnits("Alpha");
  const cal = std();
  const r = run(tasks, units, cal);
  assert.equal(r.nodes.size, 500);
  let edges = 0;
  for (const v of r.pred.values()) edges += v.length;
  assert.ok(edges >= 380 && edges <= 400, "sisi " + edges);
  const times = [];
  for (let i = 0; i < 5; i++) {
    const t0 = process.hrtime.bigint();
    M.run({ tasks, cal, units, readExt });
    times.push(Number(process.hrtime.bigint() - t0) / 1e6);
  }
  times.sort((a, b) => a - b);
  console.log(`TLCpm.run 500 simpul / ${edges} sisi: median ${times[2].toFixed(2)} ms (${times.map((t) => t.toFixed(1)).join(", ")})`);
  assert.ok(times[2] <= 150, "median " + times[2]);
});
