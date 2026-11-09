// Plugin Timeline (Fase 1, PR 1d-1) — Task 1: mesin Beban Tim murni (TLLoad) — distribusi 🍅 ke hari kerja jendela bar
// (R1, R8; K46–K47), kapasitas/cuti (K47–K48, R9), penanggung jawab (K49, R4), saran leveling (K50, R6), target dan
// format jam (R3). Semua tanggal tetap (Oktober–Desember 2026); "hari ini" hanya argumen D.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const dir = path.join(__dirname, "../../static/plugins/timeline");
const C = require(path.join(dir, "calendar.js"));
const S = require(path.join(dir, "schedule.js"));
const M = require(path.join(dir, "cpm.js"));
const L = require(path.join(dir, "layout.js"));
const LD = require(path.join(dir, "load.js"));
const pomologic = require(path.join(__dirname, "../../static/offline/pomologic.js"));

const D = (s) => C.dn(s);
const I = (n) => C.iso(n);
const std = () => C.compile(C.DEFAULT_CAL); // Sen–Jum, libur nasional + cuti bersama SKB ON
const D0 = D("2026-11-02"); // Senin

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
// est/pomo/to = estimated_pomodoros / pomodoros_done / assigned_to (est undefined → kolom tidak ada).
function mk(o) {
  const ext = {};
  if (o.start !== undefined) ext["timeline.start"] = o.start;
  if (o.d !== undefined) ext["timeline.duration"] = o.d;
  if (o.deps) ext["timeline.deps"] = o.deps.map(([id, type, lag]) => Object.assign({ t: { $task: id }, lag: lag || 0 }, type ? { type } : {}));
  if (o.mode !== undefined) ext["timeline.mode"] = o.mode;
  if (o.constraint !== undefined) ext["timeline.constraint"] = o.constraint;
  if (o.actual !== undefined) ext["timeline.actual"] = o.actual;
  const t = {
    id: o.id,
    title: "T" + o.id,
    created_at: "2026-10-01T00:00:" + String(o.id).padStart(5, "0"),
    list_id: o.list_id === undefined ? LIST : o.list_id,
    project: o.project === undefined ? "Alpha" : o.project,
    gtd_status: o.gtd_status || (o.done ? "done" : "next"),
    completed_at: o.completed_at !== undefined ? o.completed_at : o.done ? "2026-11-05T17:30:00Z" : null,
    progress: o.progress || 0,
    pomodoros_done: o.pomo === undefined ? 0 : o.pomo,
    deadline: null,
    parent_id: o.parent === undefined ? null : o.parent,
    recurrence_type: o.recurrence_type || null,
    archived: !!o.archived,
    deleted: !!o.deleted,
    assigned_to: o.to === undefined ? null : o.to,
    ext,
  };
  if (o.est !== undefined) t.estimated_pomodoros = o.est;
  return t;
}
const unitKey = (project, list_id = LIST) => S.unitOf({ list_id, project }).recId;
const autoUnits = (...projects) => new Map(projects.map((p) => [unitKey(p), { auto: true }]));

// TLCpm.run lalu TLLoad.run atas data yang sama (pola useEngine: result + ctx dari daftar lengkap halaman).
function load(tasks, o = {}) {
  const cal = o.cal || std();
  const units = o.units || autoUnits("Alpha");
  const result = o.result || M.run({ tasks, cal, units, readExt });
  return LD.run({
    tasks,
    cal,
    readExt,
    result,
    units,
    people: o.people || [],
    byAssignee: o.byAssignee !== false,
    ownerUid: o.ownerUid === undefined ? 1 : o.ownerUid,
    D: o.D === undefined ? D0 : o.D,
  });
}
const rowOf = (ld, uid) => ld.rows.find((r) => r.uid === uid);
const dayLoads = (row) => Object.fromEntries([...row.days].map(([dn, d]) => [I(dn), d.load]));
// Porsi satu task per hari (iso → milli), dari semua baris.
function sharesOf(ld, key) {
  const out = {};
  for (const r of ld.rows) for (const [dn, d] of r.days) for (const p of d.parts) if (p.key === String(key)) out[I(dn)] = p.share;
  return out;
}
// Hari kerja di [a, b] inklusif.
function workIn(cal, a, b) {
  const out = [];
  for (let d = a; d <= b; d++) if (C.isWork(cal, d)) out.push(d);
  return out;
}
// Kalender buntu (pola timeline_cpm.test.js): hanya Senin hari kerja, semua Senin 2020–2070 libur → TL_CAL_LOOP.
function deadCal() {
  const off = new Set();
  for (let d = D("2020-01-06"); d <= D("2070-12-31"); d += 7) off.add(d);
  return { mask: new Set([1]), off, work: new Set(), key: "sintetis", national: true, cutiBersama: true };
}

test("modul: pola part (UMD/IIFE seperti plan.js, require fallback, ekspor beku, konstanta)", () => {
  const src = fs.readFileSync(path.join(dir, "load.js"), "utf8");
  assert.match(src, /const TLLoad = \(function \(CAL, SCHED, CPM\)/);
  assert.match(src, /typeof TLCal !== "undefined" \? TLCal : require\("\.\/calendar\.js"\)/);
  assert.match(src, /typeof TLSched !== "undefined" \? TLSched : require\("\.\/schedule\.js"\)/);
  assert.match(src, /typeof TLCpm !== "undefined" \? TLCpm : require\("\.\/cpm\.js"\)/);
  assert.match(src, /module\.exports = TLLoad/);
  assert.doesNotMatch(src, /\bwindow\b|\bself\b|\bglobalThis\b/);
  assert.ok(Object.isFrozen(LD));
  assert.equal(LD.EST_MAX, 99);
  assert.equal(LD.DEFAULT_CAP, 8);
  assert.equal(LD.CAP_MAX, 40);
  assert.equal(LD.MILLI, 1000);
  assert.equal(LD.LEAVE_MAX, 50);
  assert.equal(LD.NOTE_MAX, 60);
  for (const f of ["resourceDecode", "resourceEncode", "resourceByteSize", "capAt", "run", "suggest", "fmtPomo", "hoursLabel", "uidOf", "isLive", "isDone"]) {
    assert.equal(typeof LD[f], "function", f);
  }
});

test("sumber load.js tanpa Date(, Date.parse, localeCompare, Math.random (termasuk komentar)", () => {
  const src = fs.readFileSync(path.join(dir, "load.js"), "utf8");
  for (const bad of ["Date(", "Date.parse", "localeCompare", "Math.random"]) assert.ok(src.indexOf(bad) < 0, "load.js memuat " + bad);
});

test("lint sumber load.js (review T1): tanpa kata Date utuh (/\\bDate\\b/), localeCompare, Math.random — termasuk komentar", () => {
  const src = fs.readFileSync(path.join(dir, "load.js"), "utf8");
  assert.doesNotMatch(src, /\bDate\b/);
  assert.doesNotMatch(src, /localeCompare/);
  assert.doesNotMatch(src, /Math\.random/);
});

test("uidOf (review T1): bilangan bulat aman > 0 ATAU string /^\\d+$/ yang menjadi bilangan bulat aman > 0; selain itu null", () => {
  for (const [v, want] of [[3, 3], ["3", 3], ["07", 7], [Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER], [String(Number.MAX_SAFE_INTEGER), Number.MAX_SAFE_INTEGER]]) {
    assert.equal(LD.uidOf(v), want, JSON.stringify(v));
  }
  for (const v of [0, "0", "00", -1, "-1", 2.5, "2.5", "3.0", " 3", "3 ", "", "abc", "1e3", "0x10", null, undefined, true, NaN, Infinity, [3], { id: 3 }, Number.MAX_SAFE_INTEGER + 1, "9007199254740993", 1e21]) {
    assert.equal(LD.uidOf(v), null, JSON.stringify(v) + " / " + String(v));
  }
});

test("uid string angka (review T1): assigned_to \"5\", people uid \"5\", ownerUid \"3\" → baris uid bilangan (bukan string, bukan Belum ditugaskan)", () => {
  const people = [{ uid: "5", name: "Budi", res: LD.resourceDecode({ v: 1, capacity: 1, leave: [] }) }, { uid: "x", name: "Rusak", res: null }];
  const ld = load([mk({ id: 1, start: "2026-11-02", d: 1, est: 2, to: "5" }), mk({ id: 2, start: "2026-11-02", d: 1, est: 1, to: 5 })], { people });
  assert.deepEqual(ld.rows.map((r) => [r.uid, r.name, r.capacity, r.total]), [[5, "Budi", 1, 3000]]);
  assert.deepEqual(rowOf(ld, 5).overDays.map(I), ["2026-11-02"]);
  const own = load([mk({ id: 1, start: "2026-11-02", d: 1, est: 2 })], { byAssignee: false, ownerUid: "3", people: [{ uid: 3, name: "Sari", res: null }] });
  assert.deepEqual(own.rows.map((r) => [r.uid, r.name, r.total]), [[3, "Sari", 2000]], "ownerUid string angka → pemilik, bukan Belum ditugaskan");
});

test("uid ganda di people (review T1): 50 permutasi → hasil identik (nama cmpKey terkecil, lalu isi res)", () => {
  const tasks = [mk({ id: 1, start: "2026-11-02", d: 2, est: 6, to: 3 }), mk({ id: 2, start: "2026-11-02", d: 1, est: 1, to: 5 })];
  const people = [
    { uid: 3, name: "Sari", res: LD.resourceDecode({ v: 1, capacity: 2, leave: [] }) },
    { uid: 3, name: "Sari", res: LD.resourceDecode({ v: 1, capacity: 5, leave: [] }) },
    { uid: "3", name: "Sari B", res: null },
    { uid: 3, name: "", res: null }, // nama kosong → "Anggota #3" (terkecil menurut unit kode)
    { uid: 5, name: "Budi", res: null },
    { uid: 5, name: "Budi", res: LD.resourceDecode({ v: 1, capacity: 0, leave: [{ from: "2026-11-02", to: "2026-11-02" }] }) },
  ];
  const s = (ld) => JSON.stringify(Object.assign({}, ld, { rows: ld.rows.map((r) => Object.assign({}, r, { days: [...r.days] })) }));
  const go = (ps) => s(load(tasks, { people: ps }));
  const ref = go(people);
  const base = load(tasks, { people });
  assert.equal(rowOf(base, 3).name, "Anggota #3");
  assert.equal(rowOf(base, 5).name, "Budi");
  const rnd = lcg(4321);
  for (let p = 0; p < 50; p++) assert.equal(go(shuffle(people, rnd)), ref, "permutasi " + p);
});

test("kunci task ganda (review T1): yang PERTAMA menang, sama dengan TLCpm.run (simpul mesin = entri pertama)", () => {
  const first = mk({ id: 1, start: "2026-11-02", d: 2, est: 4, to: 3 });
  const second = mk({ id: 1, start: "2026-11-09", d: 1, est: 9, to: 5 });
  const tasks = [first, second, mk({ id: 2, start: "2026-11-03", d: 1, est: 1, to: 3 })];
  const result = M.run({ tasks, cal: std(), units: autoUnits("Alpha"), readExt });
  assert.equal(result.nodes.get("1").task, first, "TLCpm.run: entri pertama");
  const ld = load(tasks, { result });
  assert.deepEqual(sharesOf(ld, 1), { "2026-11-02": 2000, "2026-11-03": 2000 }, "beban mengikuti entri pertama");
  assert.equal(rowOf(ld, 5), undefined, "entri kedua (uid 5) tidak menambah baris");
  assert.equal(ld.counted, 2);
  // urutan dibalik → entri pertama yang baru menang (di kedua mesin)
  const rev = [second, first];
  const r2 = M.run({ tasks: rev, cal: std(), units: autoUnits("Alpha"), readExt });
  assert.equal(r2.nodes.get("1").task, second);
  assert.deepEqual(sharesOf(load(rev, { result: r2 }), 1), { "2026-11-09": 9000 });
  // entri berulang tidak menempati kunci (TLCpm.run membuang berulang sebelum dedup) → entri non-berulang berikutnya dipakai
  const recFirst = [mk({ id: 1, start: "2026-11-02", d: 1, est: 3, to: 3, recurrence_type: "daily" }), first];
  const r3 = M.run({ tasks: recFirst, cal: std(), units: autoUnits("Alpha"), readExt });
  assert.equal(r3.nodes.get("1").task, first);
  assert.deepEqual(sharesOf(load(recFirst, { result: r3 }), 1), { "2026-11-02": 2000, "2026-11-03": 2000 });
});

test("hitungan recurring setelah dedup kunci (review T1): task berulang berkunci ganda dihitung sekali", () => {
  const ld = load([
    mk({ id: 1, start: "2026-11-02", d: 1, est: 2, to: 3, recurrence_type: "daily" }),
    mk({ id: 1, start: "2026-11-02", d: 1, est: 2, to: 3, recurrence_type: "daily" }),
    mk({ id: 2, start: "2026-11-02", d: 1, est: 2, to: 3, recurrence_type: "weekly" }),
    mk({ id: 3, start: "2026-11-02", d: 1, est: 2, to: 3, recurrence_type: "weekly", deleted: true }),
  ]);
  assert.equal(ld.recurring, 2);
  assert.equal(ld.counted, 0);
});

test("capAt/run (review T1): entri cuti yang from/to bukan bilangan bulat (bukan keluaran resourceDecode) dilewati, tidak membuat kapasitas 0", () => {
  const cal = std();
  const dn = D("2026-11-03");
  const bad = {
    capacity: 4,
    leave: [
      { from: "2026-11-02", to: "2026-11-06" }, // ISO mentah: belum terdekode
      { from: dn - 0.5, to: dn + 0.5 },
      { from: null, to: dn },
      { from: dn, to: undefined },
      null,
      "x",
    ],
  };
  assert.equal(LD.capAt(bad, cal, dn), 4);
  const ok = { capacity: 4, leave: [{ from: dn, to: dn, note: "" }] };
  assert.equal(LD.capAt(ok, cal, dn), 0);
  const ld = load([mk({ id: 1, start: "2026-11-03", d: 1, est: 3, to: 3 })], { people: [{ uid: 3, name: "Sari", res: bad }] });
  assert.deepEqual(rowOf(ld, 3).overDays, [], "3 ≤ 4: entri cuti rusak tidak dihitung");
});

test("distribusi rata R8: 10 🍅 / 4 hari kerja = 2500 per hari; 10 🍅 / 3 hari = 3334, 3333, 3333 (Σ tepat, sisa bagi ke hari paling awal)", () => {
  const ld = load([mk({ id: 1, start: "2026-11-02", d: 4, est: 10, to: 3 }), mk({ id: 2, start: "2026-11-02", d: 3, est: 10, to: 3 })]);
  assert.deepEqual(sharesOf(ld, 1), { "2026-11-02": 2500, "2026-11-03": 2500, "2026-11-04": 2500, "2026-11-05": 2500 });
  assert.deepEqual(sharesOf(ld, 2), { "2026-11-02": 3334, "2026-11-03": 3333, "2026-11-04": 3333 });
  const r = rowOf(ld, 3);
  assert.deepEqual(dayLoads(r), { "2026-11-02": 5834, "2026-11-03": 5833, "2026-11-04": 5833, "2026-11-05": 2500 });
  assert.equal(r.total, 20000);
  assert.deepEqual([...r.days.keys()], [...r.days.keys()].slice().sort((a, b) => a - b), "hari urut naik");
  assert.equal(ld.counted, 2);
  assert.equal(I(ld.T), "2026-11-02");
});

test("sisa = target − pomodoros_done; Σ porsi = sisa × 1000 dan selisih porsi ≤ 1 untuk target 1..20 × durasi 1..7", () => {
  for (let est = 1; est <= 20; est++) {
    for (let d = 1; d <= 7; d++) {
      const pomo = (est - 1) % 3; // selalu < target → sisa ≥ 1
      const ld = load([mk({ id: 1, start: "2026-11-02", d, est, pomo, to: 3 })]);
      const sh = Object.values(sharesOf(ld, 1));
      assert.equal(sh.length, d, "est " + est + " d " + d);
      assert.equal(sh.reduce((x, y) => x + y, 0), (est - pomo) * 1000);
      assert.ok(Math.max(...sh) - Math.min(...sh) <= 1);
      for (let i = 1; i < sh.length; i++) assert.ok(sh[i] <= sh[i - 1], "hari awal mendapat +1");
    }
  }
});

test("akhir pekan tidak menerima beban: 4 hari kerja Kam 5 → Sel 10 Nov melompati Sab/Min", () => {
  const ld = load([mk({ id: 1, start: "2026-11-05", d: 4, est: 4, to: 3 })]);
  assert.deepEqual(sharesOf(ld, 1), { "2026-11-05": 1000, "2026-11-06": 1000, "2026-11-09": 1000, "2026-11-10": 1000 });
});

test("libur nasional (Natal 25 Des) dan cuti bersama SKB (24 Des) tidak menerima beban; cuti: beban TETAP jatuh, capAt 0, hari merah", () => {
  const cal = std();
  const res = LD.resourceDecode({ v: 1, capacity: 3, leave: [{ from: "2026-12-22", to: "2026-12-23", note: "Mudik" }] });
  const ld = load([mk({ id: 1, start: "2026-12-21", d: 5, est: 10, to: 3 })], { cal, D: D("2026-12-21"), people: [{ uid: 3, name: "Sari", res }] });
  assert.deepEqual(sharesOf(ld, 1), { "2026-12-21": 2000, "2026-12-22": 2000, "2026-12-23": 2000, "2026-12-28": 2000, "2026-12-29": 2000 });
  const r = rowOf(ld, 3);
  assert.equal(r.capacity, 3);
  assert.deepEqual(r.res, res);
  assert.deepEqual(r.overDays.map(I), ["2026-12-22", "2026-12-23"], "cuti → kapasitas 0 → merah; 2000 ≤ 3000 di hari lain");
  const cap = (s) => LD.capAt(res, cal, D(s));
  assert.equal(cap("2026-12-21"), 3);
  assert.equal(cap("2026-12-22"), 0, "cuti");
  assert.equal(cap("2026-12-23"), 0, "cuti");
  assert.equal(cap("2026-12-24"), 0, "cuti bersama SKB");
  assert.equal(cap("2026-12-25"), 0, "Natal");
  assert.equal(cap("2026-12-26"), 0, "Sabtu");
  assert.equal(cap("2026-12-28"), 3);
  assert.equal(LD.capAt(null, cal, D("2026-12-21")), 8, "tanpa record → 8");
  assert.equal(LD.capAt(null, cal, D("2026-12-24")), 0);
  assert.equal(LD.capAt(null, deadCal(), D("2026-11-02")), 0, "kalender buntu tidak melempar");
});

test("kelebihan beban: load > kapasitas × 1000 (tegas); kapasitas 0 → setiap beban merah", () => {
  const tasks = [mk({ id: 1, start: "2026-11-02", d: 2, est: 4, to: 3 }), mk({ id: 2, start: "2026-11-02", d: 1, est: 1, to: 5 })];
  const people = [
    { uid: 3, name: "Sari", res: LD.resourceDecode({ v: 1, capacity: 2, leave: [] }) },
    { uid: 5, name: "Budi", res: LD.resourceDecode({ v: 1, capacity: 0, leave: [] }) },
  ];
  const ld = load(tasks, { people });
  assert.deepEqual(rowOf(ld, 3).overDays, [], "2000 = 2 × 1000 bukan kelebihan");
  assert.deepEqual(rowOf(ld, 5).overDays.map(I), ["2026-11-02"]);
});

test("terlambat (selesai bar < T): seluruh sisa jatuh di T, part.late, lateCount; D Sabtu → T Senin berikutnya", () => {
  const ld = load(
    [
      mk({ id: 1, start: "2026-10-26", d: 3, est: 6, pomo: 1, to: 3 }),
      mk({ id: 2, start: "2026-11-09", d: 1, est: 2, to: 3 }),
      mk({ id: 3, start: "2026-11-05", d: 2, est: 3, to: 3 }), // selesai Jum 6 < T Sen 9
    ],
    { D: D("2026-11-07") },
  );
  assert.equal(I(ld.T), "2026-11-09");
  assert.deepEqual(sharesOf(ld, 1), { "2026-11-09": 5000 });
  assert.deepEqual(sharesOf(ld, 3), { "2026-11-09": 3000 });
  assert.deepEqual(rowOf(ld, 3).days.get(D("2026-11-09")).parts, [
    { key: "1", share: 5000, late: true },
    { key: "2", share: 2000, late: false },
    { key: "3", share: 3000, late: true },
  ]);
  assert.equal(ld.lateCount, 2);
  assert.equal(ld.counted, 3);
  // selesai tepat T → bukan terlambat
  const on = load([mk({ id: 4, start: "2026-11-04", d: 1, est: 2, to: 3 })], { D: D("2026-11-04") });
  assert.equal(on.lateCount, 0);
  assert.deepEqual(sharesOf(on, 4), { "2026-11-04": 2000 });
});

test("jendela mulai di maks(T, mulai bar); task berjalan ber-actual.start memakai tanggal TERSIMPAN (bar), bukan aktual/ES mesin", () => {
  const tasks = [
    mk({ id: 1, start: "2026-10-29", d: 6, est: 8, to: 3 }), // bar Kam 29 Okt – Kam 5 Nov
    mk({ id: 2, start: "2026-11-04", d: 2, est: 4, to: 3, progress: 10, actual: { start: "2026-10-28" } }),
  ];
  const cal = std();
  const units = autoUnits("Alpha");
  const result = M.run({ tasks, cal, units, readExt });
  assert.equal(I(result.nodes.get("2").es), "2026-10-28", "mesin: jangkar actual.start");
  assert.equal(I(result.nodes.get("2").ef), "2026-10-29");
  const ld = load(tasks, { cal, units, result });
  assert.deepEqual(sharesOf(ld, 1), { "2026-11-02": 2000, "2026-11-03": 2000, "2026-11-04": 2000, "2026-11-05": 2000 });
  assert.deepEqual(sharesOf(ld, 2), { "2026-11-04": 2000, "2026-11-05": 2000 }, "bar tersimpan 4–5 Nov, bukan terlambat");
  assert.equal(ld.lateCount, 0);
});

test("nol beban: milestone (juga tanpa Mulai), selesai (gtd_status / completed_at), sisa 0, pomodoros_done > target → tidak dihitung", () => {
  const ld = load([
    mk({ id: 1, start: "2026-11-03", d: 0, est: 5, to: 3 }),
    mk({ id: 2, d: 0, est: 3, to: 3 }),
    mk({ id: 3, start: "2026-11-02", d: 2, est: 4, to: 3, done: true }),
    mk({ id: 4, start: "2026-11-02", d: 2, est: 4, to: 3, completed_at: "2026-11-02T03:00:00Z" }),
    mk({ id: 5, start: "2026-11-02", d: 2, est: 3, pomo: 3, to: 3 }),
    mk({ id: 6, start: "2026-11-02", d: 2, est: 2, pomo: 5, to: 3 }),
    mk({ id: 7, est: 2, pomo: 2, to: 3 }), // sisa 0 tanpa jadwal → bukan "belum dijadwalkan"
  ]);
  assert.equal(ld.counted, 0);
  assert.equal(ld.unscheduled, 0);
  assert.equal(ld.defaultTarget, 0);
  assert.deepEqual(ld.rows, [], "tanpa people dan tanpa beban → tanpa baris");
});

test("dikecualikan: berulang (hitungan recurring) dan induk ringkasan (tanpa hitungan); diarsip/dihapus tidak hidup", () => {
  const tasks = [
    mk({ id: 1, start: "2026-11-02", d: 2, est: 4, to: 3, recurrence_type: "daily" }),
    mk({ id: 2, start: "2026-11-02", d: 5, est: 10, to: 3 }),
    mk({ id: 3, start: "2026-11-03", d: 1, est: 2, to: 3, parent: 2 }),
    mk({ id: 4, start: "2026-11-02", d: 1, est: 5, to: 3, archived: true }),
    mk({ id: 5, start: "2026-11-02", d: 1, est: 5, to: 3, deleted: true }),
    mk({ id: 6, start: "2026-11-02", d: 1, est: 5, to: 3, gtd_status: "archived" }),
    mk({ id: 7, start: "2026-11-02", d: 1, est: 5, to: 3, recurrence_type: "weekly", archived: true }),
  ];
  const cal = std();
  const units = autoUnits("Alpha");
  const result = M.run({ tasks, cal, units, readExt });
  assert.ok(result.summaries.has("2"));
  const ld = load(tasks, { cal, units, result });
  assert.equal(ld.recurring, 1);
  assert.equal(ld.counted, 1);
  assert.equal(ld.unscheduled, 0);
  assert.deepEqual(sharesOf(ld, 1), {});
  assert.deepEqual(sharesOf(ld, 2), {});
  assert.deepEqual(sharesOf(ld, 3), { "2026-11-03": 2000 });
  assert.equal(rowOf(ld, 3).total, 2000);
});

test("tanpa jadwal (Mulai absen / rusak) → unscheduled; kalender buntu (TL_CAL_LOOP) → tanpa lempar, T null, semua berbeban unscheduled", () => {
  const tasks = [
    mk({ id: 1, est: 3, to: 3 }),
    mk({ id: 2, start: "2026-02-30", d: 2, est: 3, to: 3 }),
    mk({ id: 3, start: "2026-11-02", d: 2, est: 2, to: 3 }),
    mk({ id: 4, start: "2026-11-02", d: 0, est: 2, to: 3 }), // milestone: nol beban, bukan unscheduled
  ];
  const ld = load(tasks);
  assert.equal(ld.unscheduled, 2);
  assert.equal(ld.counted, 1);
  const cal = deadCal();
  let dead;
  assert.doesNotThrow(() => {
    dead = load(tasks, { cal, people: [{ uid: 3, name: "Sari", res: null }] });
  });
  assert.equal(dead.T, null);
  assert.equal(dead.unscheduled, 3);
  assert.equal(dead.counted, 0);
  assert.equal(dead.rows.length, 1);
  assert.equal(dead.rows[0].days.size, 0);
  assert.equal(dead.rows[0].total, 0);
  assert.deepEqual(dead.rows[0].overDays, []);
});

test("target R3: bilangan bulat ≥ 1 (selain itu 1), dijepit 99; pomodoros_done tak sah → 0; defaultTarget = target absen/≤ 1/tak sah", () => {
  const T = (id, est, pomo) => mk({ id, start: "2026-11-02", d: 1, est, pomo, to: 3 });
  const ld = load([
    T(1, undefined),
    T(2, 1),
    T(3, 2),
    T(4, 150),
    T(5, "5"),
    T(6, 0),
    T(7, 2.5),
    T(8, 4, -2),
    T(9, 4, "2"),
    T(10, 4, 1.5),
    T(11, null),
    T(12, -3),
    T(13, 99, 98),
  ]);
  const one = (id) => sharesOf(ld, id)["2026-11-02"];
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13].map(one), [1000, 1000, 2000, 99000, 1000, 1000, 1000, 4000, 4000, 4000, 1000, 1000, 1000]);
  assert.equal(ld.counted, 13);
  assert.equal(ld.defaultTarget, 7, "id 1, 2, 5, 6, 7, 11, 12");
});

test("baris: urut nama cmpKey lalu uid; Belum ditugaskan terakhir tanpa kapasitas/overDays; uid tak dikenal → Anggota #7; orang tanpa task tetap baris", () => {
  const people = [
    { uid: 3, name: "Sari", res: null },
    { uid: 9, name: "Budi", res: null },
    { uid: 5, name: "Budi", res: LD.resourceDecode({ v: 1, capacity: 6, leave: [] }) },
    { uid: 4, name: "andi", res: null }, // huruf kecil setelah huruf besar (unit kode, bukan urutan lokal)
  ];
  const ld = load(
    [
      mk({ id: 1, start: "2026-11-02", d: 1, est: 20, to: 3 }),
      mk({ id: 2, start: "2026-11-02", d: 1, est: 30 }),
      mk({ id: 3, start: "2026-11-02", d: 1, est: 1, to: 7 }),
      mk({ id: 4, start: "2026-11-02", d: 1, est: 2, to: "3" }), // string angka (bentuk lama/JSON host) → uid 3 (review T1)
      mk({ id: 5, start: "2026-11-02", d: 1, est: 2, to: 0 }),
      mk({ id: 6, start: "2026-11-02", d: 1, est: 2, to: "3.0" }), // bukan /^\d+$/ → belum ditugaskan
    ],
    { people },
  );
  assert.deepEqual(
    ld.rows.map((r) => [r.uid, r.name]),
    [
      [7, "Anggota #7"],
      [5, "Budi"],
      [9, "Budi"],
      [3, "Sari"],
      [4, "andi"],
      [null, "Belum ditugaskan"],
    ],
  );
  const un = rowOf(ld, null);
  assert.equal(un.capacity, null);
  assert.equal(un.res, null);
  assert.equal(un.total, 34000, "task 2 (30) + task 5 (2) + task 6 (2)");
  assert.deepEqual(un.overDays, [], "baris Belum ditugaskan tidak pernah merah");
  assert.deepEqual(rowOf(ld, 3).overDays.map(I), ["2026-11-02"]);
  assert.equal(rowOf(ld, 3).total, 22000, "task 1 (20) + task 4 ber-assigned_to \"3\" (2)");
  assert.deepEqual(rowOf(ld, 3).days.get(D("2026-11-02")).parts.map((p) => p.key), ["1", "4"]);
  assert.equal(rowOf(ld, 7).capacity, 8);
  assert.deepEqual(rowOf(ld, 7).res, { capacity: 8, leave: [] });
  assert.equal(rowOf(ld, 5).capacity, 6);
  assert.equal(rowOf(ld, 9).total, 0);
  assert.equal(rowOf(ld, 9).days.size, 0);
  assert.deepEqual(rowOf(ld, 9).overDays, []);
  // tanpa beban tak ditugaskan → tanpa baris null
  const none = load([mk({ id: 1, start: "2026-11-02", d: 1, est: 2, to: 3 })], { people });
  assert.equal(rowOf(none, null), undefined);
});

test("halaman pribadi (byAssignee false): semua beban ke ownerUid, assigned_to diabaikan, satu baris", () => {
  const tasks = [mk({ id: 1, start: "2026-11-02", d: 1, est: 3, to: 9 }), mk({ id: 2, start: "2026-11-02", d: 2, est: 2 })];
  const ld = load(tasks, { byAssignee: false, ownerUid: 3, people: [{ uid: 3, name: "Sari", res: null }] });
  assert.deepEqual(ld.rows.map((r) => r.uid), [3]);
  assert.equal(ld.rows[0].total, 5000);
  assert.deepEqual(dayLoads(ld.rows[0]), { "2026-11-02": 4000, "2026-11-03": 1000 });
  const noPeople = load(tasks, { byAssignee: false, ownerUid: 3 });
  assert.deepEqual(noPeople.rows.map((r) => [r.uid, r.name]), [[3, "Anggota #3"]]);
});

test("halaman pribadi tanpa pemilik (ownerUid null/tak sah, review T2–T3): tanpa baris — beban tidak jatuh ke 'Belum ditugaskan'; hitungan tetap; tanpa lempar", () => {
  const tasks = [
    mk({ id: 1, start: "2026-11-02", d: 1, est: 3, to: 9 }),
    mk({ id: 2, start: "2026-11-02", d: 2, est: 2 }),
    mk({ id: 3, est: 4 }), // tanpa jadwal
    mk({ id: 4, start: "2026-10-20", d: 1, est: 2 }), // terlambat
  ];
  for (const owner of [null, undefined, 0, "x", 1.5]) {
    const ld = LD.run({ tasks, cal: std(), readExt, result: M.run({ tasks, cal: std(), units: new Map(), readExt }), units: new Map(), people: [], byAssignee: false, ownerUid: owner, D: D0 });
    assert.deepEqual(ld.rows, [], String(owner));
    assert.deepEqual([ld.counted, ld.unscheduled, ld.lateCount], [3, 1, 1], "hitungan tetap: " + String(owner));
  }
  // workspace tanpa pengguna aktif: beban tak ditugaskan TETAP baris "Belum ditugaskan" (bukan kasus ini)
  const ws = load([mk({ id: 1, start: "2026-11-02", d: 1, est: 3 })], { ownerUid: null });
  assert.deepEqual(ws.rows.map((r) => [r.uid, r.name]), [[null, "Belum ditugaskan"]]);
});

test("R1: task Otomatis drift (ES mesin ≠ Mulai tersimpan) → beban di tanggal TERSIMPAN = row.span TLLayout.layout; setiap task berjadwal tepat di hari kerja [maks(T, s), f]", () => {
  const tasks = [
    mk({ id: 1, start: "2026-11-02", d: 3, est: 3, to: 3 }),
    mk({ id: 2, start: "2026-11-03", d: 2, est: 4, to: 3, deps: [[1]] }), // mesin: ES Kam 5 Nov (drift); bar 3–4 Nov
    mk({ id: 3, start: "2026-11-02", d: 2, est: 2, to: 5, mode: "manual" }),
    mk({ id: 4, start: "2026-10-20", d: 2, est: 5, to: 5 }), // terlambat
    mk({ id: 5, start: "2026-11-04", d: 2, est: 4, to: 3, progress: 10, actual: { start: "2026-10-28" } }),
    mk({ id: 6, start: "2026-11-06", d: 3, est: 9, to: 3 }), // lintas akhir pekan
    mk({ id: 7, start: "2026-11-07", d: 2, est: 4, to: 3, project: "Beta" }), // Mulai Sabtu, project Manual
  ];
  const cal = std();
  const units = autoUnits("Alpha");
  const result = M.run({ tasks, cal, units, readExt });
  assert.ok(result.drift.has("2"), "task 2 drift");
  assert.equal(I(result.nodes.get("2").es), "2026-11-05");
  const ld = load(tasks, { cal, units, result });
  assert.deepEqual(sharesOf(ld, 2), { "2026-11-03": 2000, "2026-11-04": 2000 });
  const lay = L.layout({ tasks, pageKind: "workspace", sort: "wbs", cal, today: D0, readSchedOf: (t) => S.readSched(readExt(t)), zoom: "week" });
  let checked = 0;
  for (const row of lay.rows) {
    if (row.kind !== "task" || !row.span) continue;
    const sh = sharesOf(ld, row.key);
    const want = row.span.f < ld.T ? [ld.T] : workIn(cal, Math.max(ld.T, row.span.s), row.span.f);
    assert.deepEqual(Object.keys(sh).sort(), want.map(I), "task " + row.key);
    checked++;
  }
  assert.equal(checked, 7);
});

// ---- generator deterministik (LCG berbenih; tanpa sumber acak tak berbenih) ----
function lcg(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
function shuffle(arr, rnd) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
// Generator campuran untuk determinisme: selesai, berulang, berjalan, manual, ringkasan, aktual, tanpa jadwal, milestone.
function genMixed(n, nDeps, seed) {
  const rnd = lcg(seed);
  const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1));
  const base = D("2026-10-19");
  const out = [];
  for (let i = 0; i < n; i++) {
    const o = {
      id: 100 + i,
      start: rnd() < 0.08 ? undefined : I(base + ri(0, 60)),
      d: rnd() < 0.05 ? undefined : ri(0, 8),
      est: rnd() < 0.2 ? undefined : ri(1, 30),
      pomo: ri(0, 6),
      to: [3, 5, 7, null, 11][ri(0, 4)],
      deps: [],
    };
    const x = rnd();
    if (x < 0.05) o.done = true;
    else if (x < 0.08) o.recurrence_type = "daily";
    else if (x < 0.12) o.progress = 20;
    else if (x < 0.15) o.mode = "manual";
    else if (x < 0.2 && i > 0) o.parent = 100 + ri(0, i - 1);
    if (rnd() < 0.1) o.actual = { start: I(base + ri(0, 30)) };
    out.push(o);
  }
  for (let k = 0; k < nDeps; k++) {
    let a = ri(0, n - 1);
    let b = ri(0, n - 1);
    if (a === b) continue;
    if (a > b) [a, b] = [b, a];
    const succ = out[b];
    if (succ.deps.some((x) => x[0] === 100 + a) || succ.deps.length >= 20) continue;
    succ.deps.push([100 + a, S.TYPES[ri(0, 3)], ri(-2, 3)]);
  }
  return out.map(mk);
}
const ser = (ld) => JSON.stringify(Object.assign({}, ld, { rows: ld.rows.map((r) => Object.assign({}, r, { days: [...r.days] })) }));

test("determinisme: 50 permutasi acak (LCG berbenih) dari tasks dan people → JSON hasil identik; Σ porsi tiap task = sisa × 1000", () => {
  const tasks = genMixed(150, 120, 2468);
  const cal = std();
  const units = autoUnits("Alpha");
  const result = M.run({ tasks, cal, units, readExt });
  const people = [
    { uid: 3, name: "Sari", res: LD.resourceDecode({ v: 1, capacity: 5, leave: [{ from: "2026-11-04", to: "2026-11-06" }] }) },
    { uid: 5, name: "Budi", res: null },
    { uid: 11, name: "Sari", res: LD.resourceDecode({ v: 1, capacity: 2, leave: [] }) },
    { uid: 13, name: "Citra", res: null },
  ];
  const go = (ts, ps) => LD.run({ tasks: ts, cal, readExt, result, units, people: ps, byAssignee: true, ownerUid: 3, D: D0 });
  const base = go(tasks, people);
  assert.ok(base.counted > 50, "counted " + base.counted);
  assert.ok(base.recurring >= 1 && base.unscheduled >= 1 && base.lateCount >= 1 && base.defaultTarget >= 1, JSON.stringify(base, (k, v) => (k === "rows" ? undefined : v)));
  assert.ok(rowOf(base, null) && rowOf(base, 7) && rowOf(base, 13), "baris null, tak dikenal, dan tanpa task ada");
  assert.ok(base.rows.some((r) => r.overDays.length > 0), "ada hari merah");
  // Σ porsi per task = sisa × 1000
  const sum = new Map();
  for (const r of base.rows) for (const d of r.days.values()) for (const p of d.parts) sum.set(p.key, (sum.get(p.key) || 0) + p.share);
  assert.equal(sum.size, base.counted);
  const byKey = new Map(tasks.map((t) => [String(t.id), t]));
  for (const [k, v] of sum) {
    const t = byKey.get(k);
    const target = Number.isInteger(t.estimated_pomodoros) && t.estimated_pomodoros >= 1 ? Math.min(99, t.estimated_pomodoros) : 1;
    assert.equal(v, Math.max(0, target - t.pomodoros_done) * 1000, "task " + k);
  }
  for (const r of base.rows) {
    let tot = 0;
    for (const d of r.days.values()) {
      assert.equal(d.load, d.parts.reduce((x, p) => x + p.share, 0));
      tot += d.load;
    }
    assert.equal(r.total, tot);
  }
  const ref = ser(base);
  const rnd = lcg(777);
  for (let p = 0; p < 50; p++) assert.equal(ser(go(shuffle(tasks, rnd), shuffle(people, rnd))), ref, "permutasi " + p);
});

test("murni: run dan suggest tidak mengubah masukan", () => {
  const tasks = genMixed(60, 40, 99);
  const people = [{ uid: 3, name: "Sari", res: LD.resourceDecode({ v: 1, capacity: 1, leave: [] }) }];
  const before = JSON.stringify({ tasks, people });
  const cal = std();
  const units = autoUnits("Alpha");
  const result = M.run({ tasks, cal, units, readExt });
  const ld = LD.run({ tasks, cal, readExt, result, units, people, byAssignee: true, ownerUid: 3, D: D0 });
  for (const r of ld.rows) for (const dn of r.days.keys()) LD.suggest(ld, r.uid, dn, { result, units, readExt, tasks });
  assert.equal(JSON.stringify({ tasks, people }), before);
});

// Salinan generator kinerja timeline_cpm.test.js (gen 500/400, benih 4242) — tidak diekspor dari berkas itu.
function genCpm(nTasks, nDeps, seed, opts = {}) {
  const rnd = lcg(seed);
  const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1));
  const base = D("2026-11-02");
  const out = [];
  for (let i = 0; i < nTasks; i++) {
    const o = { id: 5000 + i, start: rnd() < 0.08 ? undefined : I(base + ri(0, 120)), d: rnd() < 0.05 ? undefined : ri(0, 8), project: opts.oneProject ? "Alpha" : ["Alpha", "Beta", "Gamma"][ri(0, 2)], deps: [] };
    out.push(o);
  }
  for (let k = 0; k < nDeps; k++) {
    let a = ri(0, nTasks - 1);
    let b = ri(0, nTasks - 1);
    if (opts.acyclic) {
      if (a === b) continue;
      if (a > b) [a, b] = [b, a];
    }
    const succ = out[b];
    if (succ.deps.some((x) => x[0] === 5000 + a) || succ.deps.length >= 20) continue;
    succ.deps.push([5000 + a, S.TYPES[ri(0, 3)], ri(-2, 3)]);
  }
  return out.map(mk);
}

test("kinerja: 500 task / 400 dependensi / 10 orang → TLCpm.run lalu TLLoad.run; median 5 putaran TLLoad.run ≤ 150 ms (dicatat)", () => {
  const uids = [3, 5, 7, 9, 11, 13, 15, 17, 19, 21];
  const tasks = genCpm(500, 400, 4242, { acyclic: true, oneProject: true }).map((t, i) => {
    if (!t.ext["timeline.start"]) t.ext["timeline.start"] = "2026-11-02";
    t.estimated_pomodoros = 1 + ((i * 7) % 30);
    t.assigned_to = uids[i % 10];
    return t;
  });
  const people = uids.map((uid, i) => ({ uid, name: "Orang " + i, res: LD.resourceDecode({ v: 1, capacity: 4 + (i % 5), leave: [{ from: "2026-11-16", to: "2026-11-20" }] }) }));
  const cal = std();
  const units = autoUnits("Alpha");
  const t0 = process.hrtime.bigint();
  const result = M.run({ tasks, cal, units, readExt });
  const cpmMs = Number(process.hrtime.bigint() - t0) / 1e6;
  let edges = 0;
  for (const v of result.pred.values()) edges += v.length;
  assert.equal(result.nodes.size, 500);
  assert.ok(edges >= 380 && edges <= 400, "sisi " + edges);
  const input = { tasks, cal, readExt, result, units, people, byAssignee: true, ownerUid: 3, D: D0 };
  const first = LD.run(input);
  assert.equal(first.rows.length, 10);
  assert.ok(first.counted > 400, "counted " + first.counted);
  const times = [];
  for (let i = 0; i < 5; i++) {
    const s = process.hrtime.bigint();
    LD.run(input);
    times.push(Number(process.hrtime.bigint() - s) / 1e6);
  }
  times.sort((a, b) => a - b);
  console.log(`TLCpm.run 500/${edges}: ${cpmMs.toFixed(2)} ms; TLLoad.run 500 task / 10 orang: median ${times[2].toFixed(2)} ms (${times.map((t) => t.toFixed(2)).join(", ")})`);
  assert.ok(times[2] <= 150, "median " + times[2]);
});

test("suggest R6: free (slack menurun) → critical → manual → started → late; simpul tanpa slack = critical", () => {
  // Kelompok Alpha (Otomatis) berakhir Jum 13 Nov (task A, d 10) → slack task lain dihitung terhadap 13 Nov.
  const tasks = [
    mk({ id: 1, start: "2026-11-02", d: 10, est: 10, to: 3 }), // A: slack 0 → critical
    mk({ id: 2, start: "2026-11-02", d: 1, est: 1, to: 3 }), // B: slack 9 → free
    mk({ id: 3, start: "2026-11-02", d: 5, est: 5, to: 3 }), // C: slack 5 → free
    mk({ id: 4, start: "2026-11-02", d: 2, est: 2, to: 3, mode: "manual" }), // manual eksplisit di unit Otomatis
    mk({ id: 5, start: "2026-11-02", d: 3, est: 3, to: 3, progress: 20 }), // sudah mulai
    mk({ id: 6, start: "2026-10-26", d: 2, est: 2, to: 3 }), // terlambat
    mk({ id: 7, start: "2026-11-02", d: 2, est: 2, to: 3, pomo: 0, actual: { start: "2026-11-02" } }), // mulai lewat actual.start
    mk({ id: 8, start: "2026-11-02", d: 3, est: 4, pomo: 1, to: 3 }), // mulai lewat pomodoros_done
  ];
  const cal = std();
  const units = autoUnits("Alpha");
  const result = M.run({ tasks, cal, units, readExt });
  assert.equal(result.nodes.get("1").slack, 0);
  assert.equal(result.nodes.get("2").slack, 9);
  assert.equal(result.nodes.get("3").slack, 5);
  const ld = LD.run({ tasks, cal, readExt, result, units, people: [], byAssignee: true, ownerUid: 3, D: D0 });
  const ctx = { result, units, readExt, tasks };
  const sg = LD.suggest(ld, 3, D0, ctx);
  assert.deepEqual(
    sg.map((x) => [x.key, x.kind]),
    [
      ["2", "free"],
      ["3", "free"],
      ["1", "critical"],
      ["4", "manual"],
      ["5", "started"],
      ["7", "started"],
      ["8", "started"],
      ["6", "late"],
    ],
  );
  const byK = new Map(sg.map((x) => [x.key, x]));
  assert.equal(byK.get("2").slack, 9);
  assert.equal(byK.get("2").share, 1000);
  assert.equal(byK.get("2").task, tasks[1]);
  assert.equal(byK.get("6").share, 2000);
  // simpul hilang dari hasil → critical dengan slack null
  const nodes = new Map(result.nodes);
  nodes.delete("2");
  const sg2 = LD.suggest(ld, 3, D0, { result: Object.assign({}, result, { nodes }), units, readExt, tasks });
  assert.deepEqual(sg2.find((x) => x.key === "2"), { key: "2", task: tasks[1], share: 1000, slack: null, kind: "critical" });
  // baris/hari tanpa beban → []
  assert.deepEqual(LD.suggest(ld, 99, D0, ctx), []);
  assert.deepEqual(LD.suggest(ld, 3, D("2026-11-07"), ctx), []);
});

test("suggest R6: project Manual (unit tidak Otomatis) tetap punya free menurut slack; mode manual eksplisit di unit Manual BUKAN kind manual", () => {
  const tasks = [
    mk({ id: 1, start: "2026-11-02", d: 10, est: 10, to: 3 }), // slack 0 → critical
    mk({ id: 2, start: "2026-11-02", d: 1, est: 1, to: 3 }), // slack 9 → free
    mk({ id: 3, start: "2026-11-02", d: 2, est: 2, to: 3, mode: "manual" }), // slack 8 → free (unit Manual)
  ];
  const cal = std();
  const units = new Map(); // tanpa record project → Manual
  const result = M.run({ tasks, cal, units, readExt });
  const ld = LD.run({ tasks, cal, readExt, result, units, people: [], byAssignee: true, ownerUid: 3, D: D0 });
  const sg = LD.suggest(ld, 3, D0, { result, units, readExt, tasks });
  assert.deepEqual(
    sg.map((x) => [x.key, x.kind, x.slack]),
    [
      ["2", "free", 9],
      ["3", "free", 8],
      ["1", "critical", 0],
    ],
  );
});

test("resourceDecode: bukan objek / v ≠ 1 → bawaan; kapasitas di luar 0–40 / bukan bulat → 8; entri cuti rusak dilewati; maks 50 entri sah pertama", () => {
  const def = { capacity: 8, leave: [] };
  for (const x of [null, undefined, 5, "x", [], { v: 2, capacity: 3 }, { capacity: 3 }]) assert.deepEqual(LD.resourceDecode(x), def, JSON.stringify(x));
  for (const c of [41, -1, 2.5, "5", null, NaN, Infinity]) assert.equal(LD.resourceDecode({ v: 1, capacity: c }).capacity, 8, String(c));
  for (const c of [0, 1, 40]) assert.equal(LD.resourceDecode({ v: 1, capacity: c }).capacity, c);
  const dec = LD.resourceDecode({
    v: 1,
    capacity: 6,
    leave: [
      { from: "2026-12-22", to: "2026-12-23", note: "Mudik" },
      null,
      "2026-12-01",
      { from: "2026-12-32", to: "2026-12-33" },
      { from: "2026-12-10", to: "2026-12-09" }, // from > to
      { from: "2026-12-01" },
      { from: 20790, to: 20791 }, // bilangan hari bukan ISO
      { from: "1969-12-31", to: "1970-01-02" }, // di luar 1970–2199
      { from: "2026-11-30", to: "2026-11-30", note: 7 },
    ],
  });
  assert.deepEqual(dec, {
    capacity: 6,
    leave: [
      { from: D("2026-12-22"), to: D("2026-12-23"), note: "Mudik" },
      { from: D("2026-11-30"), to: D("2026-11-30"), note: "" },
    ],
  });
  const many = [];
  for (let i = 0; i < 60; i++) many.push({ from: I(D("2026-01-05") + i * 3), to: I(D("2026-01-05") + i * 3), note: "c" + i });
  const big = LD.resourceDecode({ v: 1, capacity: 8, leave: [{ from: "x", to: "y" }].concat(many) });
  assert.equal(big.leave.length, 50);
  assert.equal(big.leave[0].note, "c0");
  assert.equal(big.leave[49].note, "c49");
});

test("catatan cuti dipotong 60 code point tanpa membelah pasangan surrogate (decode dan encode)", () => {
  const smile = "\u{1F600}";
  const a59 = "a".repeat(59);
  const note1 = a59 + smile + smile; // 61 code point
  const note2 = smile.repeat(70); // 70 code point = 140 unit UTF-16
  const dec = LD.resourceDecode({ v: 1, capacity: 8, leave: [{ from: "2026-12-01", to: "2026-12-01", note: note1 }, { from: "2026-12-03", to: "2026-12-03", note: note2 }] });
  assert.equal(dec.leave[0].note, a59 + smile);
  assert.equal(dec.leave[1].note, smile.repeat(60));
  for (const l of dec.leave) assert.ok(!/[\uD800-\uDBFF]$/.test(l.note), "tanpa surrogate tinggi menggantung");
  const enc = LD.resourceEncode({ capacity: 8, leave: [{ from: "2026-12-01", to: "2026-12-01", note: note1 }] }, { by: 3 });
  assert.equal(enc.leave[0].note, a59 + smile);
  assert.equal(LD.resourceDecode({ v: 1, leave: [{ from: "2026-12-01", to: "2026-12-01", note: "pendek" }] }).leave[0].note, "pendek");
});

test("resourceEncode R9: normalisasi, urut, gabung tumpang tindih DAN bersebelahan (catatan non-kosong pertama), > 50 / from > to / kapasitas tak sah → INVALID", () => {
  const isInvalid = (e) => e instanceof Error && e.code === "INVALID";
  const enc = LD.resourceEncode(
    {
      capacity: 5,
      leave: [
        { from: "2026-12-10", to: "2026-12-12", note: "" },
        { from: "2026-12-01", to: "2026-12-05", note: "" },
        { from: D("2026-12-03"), to: D("2026-12-08"), note: "Sakit" }, // tumpang tindih (bilangan hari diterima)
        { from: "2026-12-09", to: "2026-12-09", note: "Izin" }, // bersebelahan dengan 8 Des dan 10 Des
        { from: "2026-12-20", to: "2026-12-22", note: "Cuti" }, // terpisah (19 Des kosong)
        { from: "2026-12-14", to: "2026-12-18" },
      ],
    },
    { by: 3 },
  );
  assert.deepEqual(enc, {
    v: 1,
    capacity: 5,
    leave: [
      { from: "2026-12-01", to: "2026-12-12", note: "Sakit" },
      { from: "2026-12-14", to: "2026-12-18", note: "" },
      { from: "2026-12-20", to: "2026-12-22", note: "Cuti" },
    ],
    by: 3,
  });
  assert.deepEqual(Object.keys(enc), ["v", "capacity", "leave", "by"], "tanpa updatedAt (disimpan record/server)");
  // urutan masukan tidak berpengaruh (catatan sama untuk rentang sama → urut catatan)
  const L1 = [
    { from: "2026-12-01", to: "2026-12-02", note: "B" },
    { from: "2026-12-01", to: "2026-12-02", note: "A" },
  ];
  assert.deepEqual(LD.resourceEncode({ capacity: 8, leave: L1 }, {}), LD.resourceEncode({ capacity: 8, leave: L1.slice().reverse() }, {}));
  assert.equal(LD.resourceEncode({ capacity: 8, leave: L1 }, {}).leave[0].note, "A");
  // by
  assert.equal(LD.resourceEncode({ capacity: 0, leave: [] }, { by: "3" }).by, null);
  assert.equal(LD.resourceEncode({ capacity: 40 }, undefined).by, null);
  assert.deepEqual(LD.resourceEncode({ capacity: 40 }, { by: 9 }).leave, []);
  // tak sah
  for (const c of [41, -1, 2.5, "8", null, undefined]) assert.throws(() => LD.resourceEncode({ capacity: c, leave: [] }, { by: 3 }), isInvalid, String(c));
  assert.throws(() => LD.resourceEncode(null, { by: 3 }), isInvalid);
  assert.throws(() => LD.resourceEncode({ capacity: 8, leave: "x" }, {}), isInvalid);
  assert.throws(() => LD.resourceEncode({ capacity: 8, leave: [{ from: "2026-12-05", to: "2026-12-04" }] }, {}), isInvalid);
  assert.throws(() => LD.resourceEncode({ capacity: 8, leave: [{ from: "2026-12-32", to: "2026-12-33" }] }, {}), isInvalid);
  assert.throws(() => LD.resourceEncode({ capacity: 8, leave: [{ from: "2200-01-01", to: "2200-01-02" }] }, {}), isInvalid);
  assert.throws(() => LD.resourceEncode({ capacity: 8, leave: [null] }, {}), isInvalid);
  const sep = [];
  for (let i = 0; i < 51; i++) sep.push({ from: I(D("2026-01-05") + i * 3), to: I(D("2026-01-05") + i * 3) });
  assert.throws(() => LD.resourceEncode({ capacity: 8, leave: sep }, {}), isInvalid, "51 rentang terpisah");
  assert.equal(LD.resourceEncode({ capacity: 8, leave: sep.slice(0, 50) }, {}).leave.length, 50);
  const touching = [];
  for (let i = 0; i < 80; i++) touching.push({ from: I(D("2026-01-05") + i), to: I(D("2026-01-05") + i) });
  assert.deepEqual(LD.resourceEncode({ capacity: 8, leave: touching }, {}).leave, [{ from: "2026-01-05", to: I(D("2026-01-05") + 79), note: "" }], "80 hari bersebelahan → 1 rentang");
  // pulang-pergi
  const back = LD.resourceDecode(enc);
  assert.deepEqual(back.leave.map((l) => [I(l.from), I(l.to), l.note]), [
    ["2026-12-01", "2026-12-12", "Sakit"],
    ["2026-12-14", "2026-12-18", ""],
    ["2026-12-20", "2026-12-22", "Cuti"],
  ]);
});

test("resourceByteSize = panjang UTF-8 JSON.stringify (emoji 4 byte); masukan tak terserialisasi → 0", () => {
  const data = LD.resourceEncode({ capacity: 6, leave: [{ from: "2026-12-22", to: "2026-12-31", note: "Libur 😀 akhir tahun é" }] }, { by: 3 });
  assert.equal(LD.resourceByteSize(data), Buffer.byteLength(JSON.stringify(data), "utf8"));
  const huge = { v: 1, capacity: 8, leave: [], by: 3, pad: "ü".repeat(3000) };
  assert.equal(LD.resourceByteSize(huge), Buffer.byteLength(JSON.stringify(huge), "utf8"));
  assert.ok(LD.resourceByteSize(huge) > 4096);
  assert.equal(LD.resourceByteSize(undefined), 0);
});

test("tes silang R3: TLLoad.EST_MAX = pomologic.EST_MAX; hoursLabel(n) = pomologic.estimateHoursLabel(n) untuk 1..99 (+ pecahan)", () => {
  assert.equal(LD.EST_MAX, pomologic.EST_MAX);
  for (let n = 1; n <= 99; n++) assert.equal(LD.hoursLabel(n), pomologic.estimateHoursLabel(n), "n " + n);
  for (const n of [0, 0.5, 2.5, 3.5, 12.5]) assert.equal(LD.hoursLabel(n), pomologic.estimateHoursLabel(n), "n " + n);
  assert.equal(LD.hoursLabel(8), "~3.5 jam");
});

test("fmtPomo: bulat ke 0,5 terdekat dengan titik desimal (2500 → 2.5, 3000 → 3, 3334 → 3.5, 0 → 0)", () => {
  assert.equal(LD.fmtPomo(2500), "2.5");
  assert.equal(LD.fmtPomo(3000), "3");
  assert.equal(LD.fmtPomo(3334), "3.5");
  assert.equal(LD.fmtPomo(0), "0");
  assert.equal(LD.fmtPomo(3249), "3");
  assert.equal(LD.fmtPomo(3250), "3.5");
  assert.equal(LD.fmtPomo(99000), "99");
});

test("fmtPomo (review T1): beban > 0 tidak pernah tampil \"0\" (minimal 0.5); up = true → dibulatkan KE ATAS ke 0,5 (hari merah tidak tampil \"8 dari 8\")", () => {
  assert.equal(LD.fmtPomo(100), "0.5");
  assert.equal(LD.fmtPomo(1), "0.5");
  assert.equal(LD.fmtPomo(249), "0.5");
  assert.equal(LD.fmtPomo(2500), "2.5");
  assert.equal(LD.fmtPomo(0), "0");
  assert.equal(LD.fmtPomo(NaN), "0");
  assert.equal(LD.fmtPomo(8100), "8");
  assert.equal(LD.fmtPomo(8100, true), "8.5");
  assert.equal(LD.fmtPomo(8001, true), "8.5");
  assert.equal(LD.fmtPomo(8000, true), "8");
  assert.equal(LD.fmtPomo(1, true), "0.5");
  assert.equal(LD.fmtPomo(0, true), "0");
  assert.equal(LD.fmtPomo(2500, true), "2.5");
  assert.equal(LD.fmtPomo(8100, 1), "8", "hanya true persis");
  // setiap beban > kapasitas × 1000 (hari merah) tampil > kapasitas bila up = true
  for (let cap = 0; cap <= 40; cap++) for (const extra of [1, 250, 499, 500, 501]) {
    assert.ok(Number(LD.fmtPomo(cap * 1000 + extra, true)) > cap, cap + " + " + extra);
  }
});
