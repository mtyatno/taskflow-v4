// Plugin Timeline (Fase 1, PR 1b) — Task 3: baca/validasi ext jadwal, dependensi, siklus, pelanggaran, tenggat (TLSched)
// (rencana R2, R3, R7, R8, R15, R16). Semua tanggal tetap; tidak ada tes yang bergantung pada "hari ini".
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const dir = path.join(__dirname, "../../static/plugins/timeline");
const S = require(path.join(dir, "schedule.js"));
const C = require(path.join(dir, "calendar.js"));

const D = (s) => C.dn(s);
const I = (n) => C.iso(n);
const std = () => C.compile(C.DEFAULT_CAL);

// Palsu `api.taskExt` dengan bentuk runtime: read(task) → kunci milik sendiri tanpa prefiks; ref(task) → {$task: id}.
const fakeExt = {
  read(task) {
    const out = {};
    const ext = task && task.ext;
    if (!ext || typeof ext !== "object") return out;
    for (const k of Object.keys(ext)) if (k.indexOf("timeline.") === 0) out[k.slice(9)] = JSON.parse(JSON.stringify(ext[k]));
    return out;
  },
  ref(task) {
    return { $task: task.id };
  },
};
const sched = (ext) => S.readSched(fakeExt.read({ ext }));

test("konstanta: MAX_DEPS 20, DUR_MAX 999, LAG_MIN −99, LAG_MAX 999; modul beku", () => {
  assert.equal(S.MAX_DEPS, 20);
  assert.equal(S.DUR_MAX, 999);
  assert.equal(S.LAG_MIN, -99);
  assert.equal(S.LAG_MAX, 999);
  assert.ok(Object.isFrozen(S));
});

test("readSched: start rusak → null; start ada + duration hilang → 1; duration 1000 / −1 / 1.5 → 1; deps tipe SS / ref null / lag 1000 → dibuang, invalidDeps dihitung; > 20 dipotong", () => {
  assert.deepEqual(S.readSched(null), { start: null, duration: null, deps: [], invalidDeps: 0 });
  assert.deepEqual(S.readSched({}), { start: null, duration: null, deps: [], invalidDeps: 0 });
  for (const bad of ["2026-02-30", "2026-11-1", 20261101, "2026-11-01T10:00", "", {}, []]) {
    const r = sched({ "timeline.start": bad, "timeline.duration": 3 });
    assert.equal(r.start, null, JSON.stringify(bad));
    assert.equal(r.duration, null, "tanpa start tidak ada durasi");
  }
  assert.deepEqual(sched({ "timeline.start": "2026-11-02" }), { start: "2026-11-02", duration: 1, deps: [], invalidDeps: 0 });
  for (const bad of [1000, -1, 1.5, "3", null, NaN, true]) {
    assert.equal(sched({ "timeline.start": "2026-11-02", "timeline.duration": bad }).duration, 1, String(bad));
  }
  assert.equal(sched({ "timeline.start": "2026-11-02", "timeline.duration": 0 }).duration, 0, "milestone");
  assert.equal(sched({ "timeline.start": "2026-11-02", "timeline.duration": 999 }).duration, 999);

  const r = sched({
    "timeline.start": "2026-11-02",
    "timeline.deps": [
      { t: { $task: 7 }, type: "FS", lag: 2 },
      { t: { $task: 8 }, type: "SS", lag: 0 },
      { t: null, type: "FS", lag: 0 },
      { t: { $task: 9 }, type: "FS", lag: 1000 },
      { t: { $task: 10 }, type: "FS", lag: -100 },
      { t: { $task: 11 }, type: "FS", lag: 1.5 },
      { t: { $task: "c-12" }, type: "FS", lag: -3 },
      { t: { $task: 7 }, type: "FS", lag: 5 },
      "x",
      null,
    ],
  });
  assert.deepEqual(
    r.deps.map((d) => [d.key, d.type, d.lag, d.ref]),
    [["7", "FS", 2, { $task: 7 }], ["c-12", "FS", -3, { $task: "c-12" }]],
  );
  assert.equal(r.invalidDeps, 8, "SS, null, 1000, −100, 1.5, duplikat, 'x', null");
  assert.equal(sched({ "timeline.deps": "bukan array" }).invalidDeps, 1);
  assert.deepEqual(sched({ "timeline.deps": "bukan array" }).deps, []);

  // deps ada walau start rusak/hilang (deps dipertahankan)
  assert.equal(sched({ "timeline.deps": [{ t: { $task: 1 }, type: "FS", lag: 0 }] }).deps.length, 1);
  // lag hilang = 0
  assert.equal(sched({ "timeline.deps": [{ t: { $task: 1 }, type: "FS" }] }).deps[0].lag, 0);

  const many = [];
  for (let i = 1; i <= 25; i++) many.push({ t: { $task: i }, type: "FS", lag: 0 });
  const m = sched({ "timeline.deps": many });
  assert.equal(m.deps.length, 20);
  assert.equal(m.deps[19].key, "20");
  assert.equal(m.invalidDeps, 0);
});

test("readSched: hasil selalu integer sah (tanpa NaN/pecahan) dan tidak memodifikasi masukan", () => {
  const input = { start: "2026-11-02", duration: 5, deps: [{ t: { $task: 3 }, type: "FS", lag: 4 }] };
  const snap = JSON.stringify(input);
  const r = S.readSched(input);
  assert.equal(JSON.stringify(input), snap);
  assert.ok(Number.isInteger(r.duration));
  assert.ok(Number.isInteger(r.deps[0].lag));
  assert.ok(Number.isInteger(C.dn(r.start)));
});

test("sanitizePatch: {start: '2026-02-30'} gagal; {duration: 0} ok; {deps: 21 item} gagal; {start: null, duration: null} ok (unschedule)", () => {
  assert.equal(S.sanitizePatch({ start: "2026-02-30" }).ok, false);
  assert.equal(S.sanitizePatch({ start: "2026-11-02T10:00" }).ok, false);
  assert.equal(S.sanitizePatch({ start: 5 }).ok, false);
  assert.deepEqual(S.sanitizePatch({ start: "2026-11-02" }), { ok: true, patch: { start: "2026-11-02" } });
  assert.deepEqual(S.sanitizePatch({ duration: 0 }), { ok: true, patch: { duration: 0 } });
  assert.deepEqual(S.sanitizePatch({ start: null, duration: null }), { ok: true, patch: { start: null, duration: null } });

  const many = [];
  for (let i = 1; i <= 21; i++) many.push({ t: { $task: i }, type: "FS", lag: 0 });
  const r21 = S.sanitizePatch({ deps: many });
  assert.equal(r21.ok, false);
  assert.equal(r21.reason, "max");
  assert.equal(S.sanitizePatch({ deps: many.slice(0, 20) }).ok, true);
  assert.deepEqual(S.sanitizePatch({ deps: [] }), { ok: true, patch: { deps: [] } });
});

test("sanitizePatch: durasi dijepit 0..999 dan dibulatkan; NaN/bukan angka gagal; lag dijepit −99..999; tipe selain FS / ref rusak / duplikat gagal; kunci asing gagal; patch kosong gagal", () => {
  assert.equal(S.sanitizePatch({ duration: 1500 }).patch.duration, 999);
  assert.equal(S.sanitizePatch({ duration: -4 }).patch.duration, 0);
  assert.equal(S.sanitizePatch({ duration: 2.6 }).patch.duration, 3);
  for (const bad of [NaN, Infinity, "3", {}, undefined]) assert.equal(S.sanitizePatch({ duration: bad }).ok, false, String(bad));

  const dep = (o) => Object.assign({ t: { $task: 4 }, type: "FS", lag: 0 }, o);
  assert.equal(S.sanitizePatch({ deps: [dep({ lag: 5000 })] }).patch.deps[0].lag, 999);
  assert.equal(S.sanitizePatch({ deps: [dep({ lag: -500 })] }).patch.deps[0].lag, -99);
  assert.equal(S.sanitizePatch({ deps: [dep({ lag: 1.4 })] }).patch.deps[0].lag, 1);
  assert.equal(S.sanitizePatch({ deps: [dep({ lag: NaN })] }).ok, false);
  assert.equal(S.sanitizePatch({ deps: [dep({ lag: undefined })] }).patch.deps[0].lag, 0);
  assert.equal(S.sanitizePatch({ deps: [dep({ type: "SS" })] }).ok, false);
  assert.equal(S.sanitizePatch({ deps: [dep({ t: null })] }).ok, false);
  assert.equal(S.sanitizePatch({ deps: [dep({ t: { $task: 1.5 } })] }).ok, false);
  assert.equal(S.sanitizePatch({ deps: [dep(), dep({ t: { $task: "4" } })] }).ok, false, "ref sama dua kali");
  assert.equal(S.sanitizePatch({ deps: "x" }).ok, false);
  assert.equal(S.sanitizePatch({ mode: "auto" }).ok, false);
  assert.equal(S.sanitizePatch({}).ok, false);
  assert.equal(S.sanitizePatch(null).ok, false);
  assert.equal(S.sanitizePatch([]).ok, false);
  // bentuk keluaran = bentuk ext (t/type/lag), bersih dari kunci asing
  assert.deepEqual(S.sanitizePatch({ deps: [{ t: { $task: 4, x: 1 }, type: "FS", lag: 2, x: 1 }] }).patch.deps, [{ t: { $task: 4 }, type: "FS", lag: 2 }]);
  // bentuk hasil readSched (ref) ikut diterima
  assert.deepEqual(S.sanitizePatch({ deps: [{ ref: { $task: 4 }, key: "4", type: "FS", lag: 2 }] }).patch.deps, [{ t: { $task: 4 }, type: "FS", lag: 2 }]);
  // hasil sanitasi lolos bacaan ulang tanpa invalidDeps
  const out = S.sanitizePatch({ start: "2026-11-02", duration: 3, deps: [dep({ lag: 2 })] }).patch;
  const back = sched({ "timeline.start": out.start, "timeline.duration": out.duration, "timeline.deps": out.deps });
  assert.equal(back.invalidDeps, 0);
  assert.equal(back.deps.length, 1);
});

test("refKey: angka bulat atau string tak kosong → String; selain itu null", () => {
  assert.equal(S.refKey({ $task: 12 }), "12");
  assert.equal(S.refKey({ $task: "c-abc" }), "c-abc");
  for (const bad of [null, undefined, {}, { $task: null }, { $task: "" }, { $task: 1.5 }, { $task: NaN }, { $task: {} }, 5, "5", []]) {
    assert.equal(S.refKey(bad), null, JSON.stringify(bad));
  }
});

test("buildIndex: ref angka cocok id server, ref cid string cocok cid task yang id-nya kini angka (rewrite belum sampai)", () => {
  const a = { id: 42, cid: "c-aaa", title: "A" };
  const b = { id: "c-bbb", cid: "c-bbb", title: "B" };
  const c = { id: "c-ccc", cid: "c-ccc", server_id: 77, title: "C" };
  const idx = S.buildIndex([a, b, c, null, {}]);
  assert.equal(idx.get(S.refKey({ $task: 42 })), a);
  assert.equal(idx.get(S.refKey({ $task: "c-aaa" })), a, "cid lama → task yang kini punya id angka");
  assert.equal(idx.get(S.refKey({ $task: "c-bbb" })), b);
  assert.equal(idx.get(S.refKey({ $task: 77 })), c, "server_id");
  assert.equal(idx.get(S.refKey({ $task: "c-ccc" })), c);
  assert.equal(idx.get("999"), undefined);
  assert.equal(idx.has("undefined"), false);
  assert.equal(idx.has("null"), false);
  // id menang atas cid/server_id milik task lain
  const x = { id: 5, cid: "c-x" };
  const y = { id: 6, cid: "5" };
  const idx2 = S.buildIndex([y, x]);
  assert.equal(idx2.get("5"), x);
});

test("calKeyOf: task workspace → cal@list:<id> scope list:<id>; tanpa list_id → cal@user scope user", () => {
  assert.deepEqual(S.calKeyOf({ list_id: 12 }), { id: "cal@list:12", scope: "list:12" });
  assert.deepEqual(S.calKeyOf({ list_id: "12" }), { id: "cal@list:12", scope: "list:12" });
  for (const t of [{}, { list_id: null }, { list_id: 0 }, { list_id: "" }, null, undefined]) {
    assert.deepEqual(S.calKeyOf(t), { id: "cal@user", scope: "user" }, JSON.stringify(t));
  }
});

test("spanOf: bilangan hari mulai/selesai; milestone s = f; tanpa jadwal → null; TL_CAL_LOOP → null (tidak melempar)", () => {
  const c = std();
  const sp = S.spanOf(c, { start: "2026-11-05", duration: 4 }); // Kam 5 + 4 hk → Selasa 10
  assert.equal(I(sp.s), "2026-11-05");
  assert.equal(I(sp.f), "2026-11-10");
  const one = S.spanOf(c, { start: "2026-11-05", duration: 1 });
  assert.equal(one.s, one.f);
  const ms = S.spanOf(c, { start: "2026-12-25", duration: 0 }); // milestone di hari libur
  assert.equal(I(ms.s), "2026-12-25");
  assert.equal(ms.f, ms.s);
  assert.equal(S.spanOf(c, { start: null, duration: null }), null);
  assert.equal(S.spanOf(c, null), null);
  assert.equal(S.spanOf(c, { start: "2026-13-01", duration: 1 }), null);
  assert.equal(S.spanOf(c, { start: "2026-11-05", duration: 1.5 }), null, "tidak pernah meneruskan non-integer ke TLCal");
  assert.equal(S.spanOf(c, { start: "2026-11-05", duration: NaN }), null);
  // kalender tanpa hari kerja terjangkau
  const off = new Set();
  for (let d = D("2026-01-01"); d <= D("2070-01-01"); d++) off.add(d);
  const dead = { mask: new Set([1]), off, work: new Set(), key: "mati" };
  assert.doesNotThrow(() => S.spanOf(dead, { start: "2026-11-05", duration: 3 }));
  assert.equal(S.spanOf(dead, { start: "2026-11-05", duration: 3 }), null);
});

test("resolveDeps: kunci penerus = baris, pendahulu = id task di indeks; ref tak ditemukan → ok false; cid lama cocok", () => {
  const t1 = { id: 1, cid: "c-1" };
  const t2 = { id: 2 };
  const idx = S.buildIndex([t1, t2]);
  const rows = [
    { key: "2", sched: { deps: [{ key: "c-1", ref: { $task: "c-1" }, type: "FS", lag: 3 }, { key: "99", ref: { $task: 99 }, type: "FS", lag: 0 }] } },
    { key: "1", sched: { deps: [] } },
    { task: { id: 3 }, sched: { deps: [{ key: "2", ref: { $task: 2 }, type: "FS", lag: -1 }] } },
  ];
  assert.deepEqual(S.resolveDeps(rows, idx), [
    { from: "1", to: "2", lag: 3, ok: true },
    { from: "99", to: "2", lag: 0, ok: false },
    { from: "2", to: "3", lag: -1, ok: true },
  ]);
  assert.deepEqual(S.resolveDeps([], idx), []);
  assert.deepEqual(S.resolveDeps([{ key: "1" }], idx), [], "baris tanpa sched diabaikan");
});

test("wouldCycle: A→B→C + C→A = true; edge paralel aman; diri sendiri = true; graf 500 simpul 400 edge < 5 ms", () => {
  const e = (from, to) => ({ from, to, lag: 0, ok: true });
  const edges = [e("A", "B"), e("B", "C")];
  assert.equal(S.wouldCycle(edges, "C", "A"), true);
  assert.equal(S.wouldCycle(edges, "A", "C"), false, "jalan pintas searah aman");
  assert.equal(S.wouldCycle(edges, "A", "B"), false, "paralel aman");
  assert.equal(S.wouldCycle(edges, "B", "A"), true);
  assert.equal(S.wouldCycle(edges, "D", "A"), false);
  assert.equal(S.wouldCycle(edges, "A", "A"), true);
  assert.equal(S.wouldCycle([], "A", "B"), false);
  assert.equal(S.wouldCycle([e("A", "B"), { from: "B", to: "A", ok: false }], "C", "D"), false);
  assert.equal(S.wouldCycle([{ from: "A", to: "B", ok: false }], "B", "A"), false, "edge tak terpecahkan diabaikan");

  const big = [];
  for (let i = 0; i < 400; i++) big.push(e("n" + i, "n" + (i + 1))); // rantai 400 edge pada 401 simpul
  assert.equal(S.wouldCycle(big, "n400", "n0"), true);
  assert.equal(S.wouldCycle(big, "n0", "n400"), false);
  let best = Infinity;
  for (let k = 0; k < 5; k++) {
    const t0 = process.hrtime.bigint();
    S.wouldCycle(big, "n400", "n0");
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    if (ms < best) best = ms;
  }
  assert.ok(best < 5, "terbaik " + best + " ms");
});

test("canLink: self, dup, cycle, max, summary, scope (workspace beda, pribadi project beda NOCASE, pribadi tanpa project)", () => {
  const e = (from, to) => ({ from, to, lag: 0, ok: true });
  const mk = (id, over) => Object.assign({ id, list_id: 5, project: "Web" }, over);
  const a = mk(1);
  const b = mk(2);
  const c = mk(3);
  const scope = [a, b, c];
  const link = (pred, succ, edges, extra) => S.canLink(Object.assign({ pred, succ, scopeTasks: scope, edges: edges || [] }, extra));

  assert.deepEqual(link(a, b), { ok: true });
  assert.deepEqual(link(a, a), { ok: false, reason: "self" });
  assert.deepEqual(link(a, b, [e("1", "2")]), { ok: false, reason: "dup" });
  assert.deepEqual(link(c, a, [e("1", "2"), e("2", "3")]), { ok: false, reason: "cycle" });

  const full = [];
  for (let i = 10; i < 30; i++) full.push(e(String(i), "2"));
  assert.deepEqual(link(a, b, full), { ok: false, reason: "max" });
  assert.deepEqual(link(a, b, full.slice(0, 19)), { ok: true });
  assert.deepEqual(link(a, b, [], { depCount: 20 }), { ok: false, reason: "max" }, "dependensi tak terpecahkan ikut dihitung");

  // ringkasan = punya anak di scope (parent_id server atau parent_cid offline)
  const sum = mk(4);
  const kid = mk(5, { parent_id: 4 });
  const sum2 = mk(6, { cid: "c-6" });
  const kid2 = mk(7, { parent_cid: "c-6" });
  const sc2 = [a, b, sum, kid, sum2, kid2];
  assert.deepEqual(S.canLink({ pred: sum, succ: a, scopeTasks: sc2, edges: [] }), { ok: false, reason: "summary" });
  assert.deepEqual(S.canLink({ pred: a, succ: sum, scopeTasks: sc2, edges: [] }), { ok: false, reason: "summary" });
  assert.deepEqual(S.canLink({ pred: a, succ: sum2, scopeTasks: sc2, edges: [] }), { ok: false, reason: "summary" });
  assert.deepEqual(S.canLink({ pred: a, succ: kid, scopeTasks: sc2, edges: [] }), { ok: true }, "anak biasa boleh");

  // scope
  assert.deepEqual(link(a, mk(9, { list_id: 6 })), { ok: false, reason: "scope" }, "workspace beda");
  assert.deepEqual(link(a, mk(9, { list_id: null })), { ok: false, reason: "scope" }, "workspace vs pribadi");
  const p1 = { id: 21, project: "Rumah" };
  const p2 = { id: 22, project: "rumah" };
  const p3 = { id: 23, project: "Kantor" };
  const p4 = { id: 24 };
  const p5 = { id: 25, project: "" };
  const pr = (x, y) => S.canLink({ pred: x, succ: y, scopeTasks: [p1, p2, p3, p4, p5], edges: [] });
  assert.deepEqual(pr(p1, p2), { ok: true }, "NOCASE");
  assert.deepEqual(pr(p1, p3), { ok: false, reason: "scope" }, "project beda");
  assert.deepEqual(pr(p1, p4), { ok: false, reason: "scope" }, "satu tanpa project");
  assert.deepEqual(pr(p4, p5), { ok: true }, "keduanya tanpa project");
  // di luar scope halaman bila scopeTasks diberikan
  assert.deepEqual(S.canLink({ pred: a, succ: mk(99), scopeTasks: scope, edges: [] }), { ok: false, reason: "scope" });
  // tanpa scopeTasks hanya aturan workspace/project yang dipakai
  assert.deepEqual(S.canLink({ pred: a, succ: b, edges: [] }), { ok: true });
  // task null/tanpa id ditolak, bukan melempar
  assert.equal(S.canLink({ pred: null, succ: b, scopeTasks: scope, edges: [] }).ok, false);
});

test("violations Manual: penerus mulai sebelum fsEarliest → ditandai; tepat fsEarliest → tidak; pendahulu/penerus tanpa jadwal → diabaikan", () => {
  const c = std();
  // pendahulu A: Sen 2 Nov, 4 hk → selesai Kam 5 Nov. FS lag 0 → paling cepat Jum 6 Nov.
  const spanA = S.spanOf(c, { start: "2026-11-02", duration: 4 });
  const sp = (s, d) => S.spanOf(c, { start: s, duration: d });
  const edges = [{ from: "A", to: "B", lag: 0, ok: true }];
  const spans = (b) => new Map([["A", spanA], ["B", b]]);

  let v = S.violations(c, spans(sp("2026-11-05", 2)), edges);
  assert.deepEqual([...v], ["B"]);
  assert.equal(v.detail.length, 1);
  assert.equal(v.detail[0].succ, "B");
  assert.equal(v.detail[0].pred, "A");
  assert.equal(I(v.detail[0].earliest), "2026-11-06");

  v = S.violations(c, spans(sp("2026-11-06", 2)), edges);
  assert.equal(v.size, 0, "tepat fsEarliest");
  v = S.violations(c, spans(sp("2026-11-09", 2)), edges);
  assert.equal(v.size, 0, "setelahnya");

  // lag 2 → Rabu 11 Nov
  v = S.violations(c, spans(sp("2026-11-09", 1)), [{ from: "A", to: "B", lag: 2, ok: true }]);
  assert.deepEqual([...v], ["B"]);
  assert.equal(I(v.detail[0].earliest), "2026-11-10", "Jum 6 + 2 hk = Selasa 10");
  assert.equal(S.violations(c, spans(sp("2026-11-10", 1)), [{ from: "A", to: "B", lag: 2, ok: true }]).size, 0);
  // lag negatif (lead) membolehkan mulai lebih awal
  v = S.violations(c, spans(sp("2026-11-05", 1)), [{ from: "A", to: "B", lag: -1, ok: true }]);
  assert.equal(v.size, 0);

  // tanpa jadwal → diabaikan
  assert.equal(S.violations(c, new Map([["A", spanA], ["B", null]]), edges).size, 0);
  assert.equal(S.violations(c, new Map([["A", null], ["B", sp("2026-11-02", 1)]]), edges).size, 0);
  assert.equal(S.violations(c, new Map([["A", spanA]]), edges).size, 0, "penerus tak ada di peta");
  // edge tak terpecahkan (ok false) diabaikan
  assert.equal(S.violations(c, spans(sp("2026-11-02", 1)), [{ from: "A", to: "B", lag: 0, ok: false }]).size, 0);
  // peta berupa objek biasa pun diterima
  assert.deepEqual([...S.violations(c, { A: spanA, B: sp("2026-11-02", 1) }, edges)], ["B"]);
  // beberapa pendahulu: satu pelanggaran cukup, detail memuat keduanya
  const two = S.violations(
    c,
    new Map([["A", spanA], ["X", sp("2026-11-02", 1)], ["B", sp("2026-11-03", 1)]]),
    [{ from: "A", to: "B", lag: 0, ok: true }, { from: "X", to: "B", lag: 0, ok: true }],
  );
  assert.equal(two.size, 1);
  assert.equal(two.detail.length, 1, "Sel 3 Nov ≥ Sel 3 Nov (X selesai Sen 2) → hanya A melanggar");
  assert.equal(two.detail[0].pred, "A");
});

test("violations/shiftAfterDeps: TL_CAL_LOOP → tidak melempar, task dilewati / null", () => {
  const off = new Set();
  for (let d = D("2026-01-01"); d <= D("2070-01-01"); d++) off.add(d);
  const dead = { mask: new Set([1]), off, work: new Set(), key: "mati" };
  const spans = new Map([["A", { s: D("2026-11-02"), f: D("2026-11-03") }], ["B", { s: D("2026-11-02"), f: D("2026-11-02") }]]);
  assert.doesNotThrow(() => S.violations(dead, spans, [{ from: "A", to: "B", lag: 0, ok: true }]));
  assert.equal(S.violations(dead, spans, [{ from: "A", to: "B", lag: 0, ok: true }]).size, 0);
  assert.equal(S.shiftAfterDeps(dead, {}, [{ span: spans.get("A"), lag: 0 }]), null);
});

test("shiftAfterDeps: maks atas dua pendahulu + lag; tanpa pendahulu terjadwal → null", () => {
  const c = std();
  const spA = S.spanOf(c, { start: "2026-11-02", duration: 2 }); // selesai Sel 3 → paling cepat Rab 4
  const spB = S.spanOf(c, { start: "2026-11-02", duration: 4 }); // selesai Kam 5 → paling cepat Jum 6
  assert.equal(S.shiftAfterDeps(c, {}, [{ span: spA, lag: 0 }, { span: spB, lag: 0 }]), "2026-11-06");
  // lag mengubah pemenang: A selesai Sel 3 → Rab 4, + 3 hk = Sen 9
  assert.equal(S.shiftAfterDeps(c, {}, [{ span: spA, lag: 3 }, { span: spB, lag: 0 }]), "2026-11-09");
  assert.equal(S.shiftAfterDeps(c, {}, [{ span: spB, lag: 0 }]), "2026-11-06");
  // yang tanpa jadwal dilewati
  assert.equal(S.shiftAfterDeps(c, {}, [{ span: null, lag: 0 }, { span: spA, lag: 0 }]), "2026-11-04");
  assert.equal(S.shiftAfterDeps(c, {}, [{ span: null, lag: 0 }, null, {}]), null);
  assert.equal(S.shiftAfterDeps(c, {}, []), null);
  assert.equal(S.shiftAfterDeps(c, {}, null), null);
  // lag negatif
  assert.equal(S.shiftAfterDeps(c, {}, [{ span: spB, lag: -1 }]), "2026-11-05");
  // bentuk `f` langsung
  assert.equal(S.shiftAfterDeps(c, {}, [{ f: spB.f, lag: 0 }]), "2026-11-06");
  // lag non-integer tidak diteruskan ke TLCal
  assert.equal(S.shiftAfterDeps(c, {}, [{ span: spB, lag: 1.5 }]), "2026-11-06", "lag tak sah dianggap 0");
});

test("deadlineLate: selesai Sel 10 Nov 2026, tenggat Jum 6 Nov 2026 → 2; tenggat '2026-11-06T17:00' dibaca 10 karakter; tenggat rusak → null", () => {
  const c = std();
  const fin = D("2026-11-10");
  assert.equal(S.deadlineLate(c, fin, "2026-11-06"), 2);
  assert.equal(S.deadlineLate(c, fin, "2026-11-06T17:00"), 2);
  assert.equal(S.deadlineLate(c, fin, "2026-11-06 17:00:00"), 2);
  assert.equal(S.deadlineLate(c, fin, "2026-11-10"), 0, "tepat");
  assert.equal(S.deadlineLate(c, fin, "2026-11-20"), 0, "sebelum");
  assert.equal(S.deadlineLate(c, fin, "2026-11-09"), 1);
  for (const bad of [null, undefined, "", "bukan", "2026-02-30", "2026-11", 20261106, {}]) {
    assert.equal(S.deadlineLate(c, fin, bad), null, String(bad));
  }
  assert.equal(S.deadlineLate(c, null, "2026-11-06"), null, "tanpa selesai");
  assert.equal(S.deadlineLate(c, NaN, "2026-11-06"), null);
  // akhir pekan tidak dihitung: tenggat Jum 6, selesai Sen 16 → Sen 9..Jum 13 + Sen 16 = 6
  assert.equal(S.deadlineLate(c, D("2026-11-16"), "2026-11-06"), 6);
  // milestone di akhir pekan setelah tenggat tetap terlambat (≥ 1)
  assert.equal(S.deadlineLate(c, D("2026-11-07"), "2026-11-06"), 1);
});

// ---- ronde perbaikan 1 ----
test("violations: mulai efektif = nextWork(start) — mulai di Min/libur tidak salah ditandai; Kam sebelum paling cepat tetap ditandai; milestone Sabtu setelah selesai Jumat aman", () => {
  const c = std();
  const pred = S.spanOf(c, { start: "2026-11-02", duration: 5 }); // selesai Jum 6 Nov → paling cepat Sen 9
  assert.equal(I(pred.f), "2026-11-06");
  const edges = [{ from: "A", to: "B", lag: 0, ok: true }];
  const run = (start, dur) => S.violations(c, new Map([["A", pred], ["B", S.spanOf(c, { start, duration: dur })]]), edges);
  assert.equal(run("2026-11-08", 2).size, 0, "Minggu → efektif Senin 9");
  assert.equal(run("2026-11-07", 1).size, 0, "Sabtu");
  assert.equal(run("2026-11-05", 1).size, 1, "Kamis → ditandai");
  assert.equal(run("2026-11-07", 0).size, 0, "milestone Sabtu setelah selesai Jumat");
  // libur nasional: pendahulu selesai Rab 23 Des 2026, 24 = cuti bersama, 25 = libur → paling cepat Sen 28
  const p2 = S.spanOf(c, { start: "2026-12-23", duration: 1 });
  const at = (start) => S.violations(c, new Map([["A", p2], ["B", S.spanOf(c, { start, duration: 1 })]]), edges).size;
  assert.equal(at("2026-12-25"), 0, "mulai di hari libur → efektif Sen 28");
  assert.equal(at("2026-12-22"), 1);
  // kalender buntu → tetap tidak melempar
  const off = new Set();
  for (let d = D("2026-01-01"); d <= D("2070-01-01"); d++) off.add(d);
  const dead = { mask: new Set([1]), off, work: new Set(), key: "mati2" };
  const sp = new Map([["A", { s: D("2026-11-02"), f: D("2026-11-03") }], ["B", { s: D("2026-11-02"), f: D("2026-11-02") }]]);
  assert.equal(S.violations(dead, sp, edges).size, 0);
});

test("canLink kanonik: salinan basi (id masih cid) dipetakan ke id angka lewat scopeTasks — dup, cycle, self", () => {
  const e = (from, to) => ({ from, to, lag: 0, ok: true });
  const a = { id: 1, cid: "c-a", list_id: 5 };
  const b = { id: 2, cid: "c-b", list_id: 5 };
  const c = { id: 3, list_id: 5 };
  const scope = [a, b, c];
  const staleA = { id: "c-a", cid: "c-a", list_id: 5 }; // salinan modal sebelum rewrite
  const staleB = { id: "c-b", cid: "c-b", list_id: 5 };
  assert.deepEqual(S.canLink({ pred: staleA, succ: b, scopeTasks: scope, edges: [e("1", "2")] }), { ok: false, reason: "dup" });
  assert.deepEqual(S.canLink({ pred: a, succ: staleB, scopeTasks: scope, edges: [e("1", "2")] }), { ok: false, reason: "dup" });
  assert.deepEqual(S.canLink({ pred: c, succ: staleA, scopeTasks: scope, edges: [e("1", "2"), e("2", "3")] }), { ok: false, reason: "cycle" });
  assert.deepEqual(S.canLink({ pred: staleA, succ: a, scopeTasks: scope, edges: [] }), { ok: false, reason: "self" });
  assert.deepEqual(S.canLink({ pred: staleA, succ: staleB, scopeTasks: scope, edges: [] }), { ok: true });
  // max: penerus basi, edge berkunci id angka
  const full = [];
  for (let i = 10; i < 30; i++) full.push(e(String(i), "2"));
  assert.deepEqual(S.canLink({ pred: a, succ: staleB, scopeTasks: scope, edges: full }), { ok: false, reason: "max" });
});

test("sanitizePatch: deps null diterima (hapus kunci, untuk Urungkan); start/duration/deps null bersama", () => {
  assert.deepEqual(S.sanitizePatch({ deps: null }), { ok: true, patch: { deps: null } });
  assert.deepEqual(S.sanitizePatch({ start: null, duration: null, deps: null }), { ok: true, patch: { start: null, duration: null, deps: null } });
  assert.equal(S.sanitizePatch({ deps: undefined }).ok, false);
});

test("deadlineLate: tenggat sampah di masa lalu jauh tetap cepat dan > 0 (rentang hitung dibatasi)", () => {
  const c = std();
  let best = Infinity;
  let r;
  for (let k = 0; k < 3; k++) {
    const t0 = process.hrtime.bigint();
    r = S.deadlineLate(c, D("2026-11-10"), "1000-01-01");
    best = Math.min(best, Number(process.hrtime.bigint() - t0) / 1e6);
  }
  assert.ok(r > 0);
  assert.ok(Number.isInteger(r));
  assert.ok(best < 20, best + " ms");
  assert.equal(S.deadlineLate(c, D("2026-11-10"), "2026-11-06"), 2, "kasus normal tak berubah");
});

test("resolveDeps: dependensi ke task yang sama lewat cid dan id angka menghasilkan satu edge per (pendahulu, penerus)", () => {
  const t1 = { id: 1, cid: "c-1" };
  const idx = S.buildIndex([t1, { id: 2 }]);
  const rows = [{
    key: "2",
    sched: { deps: [
      { key: "1", ref: { $task: 1 }, type: "FS", lag: 0 },
      { key: "c-1", ref: { $task: "c-1" }, type: "FS", lag: 5 },
      { key: "77", ref: { $task: 77 }, type: "FS", lag: 0 },
      { key: "77", ref: { $task: 77 }, type: "FS", lag: 1 },
    ] },
  }];
  assert.deepEqual(S.resolveDeps(rows, idx), [
    { from: "1", to: "2", lag: 0, ok: true },
    { from: "77", to: "2", lag: 0, ok: false },
  ]);
});

// ── Final review: satu lipatan nama project (sama dengan host projectNameFold) dan satu pembantu id kalender ──
test("final: projectFold = host projectNameFold (huruf A–Z ASCII saja, tanpa trim, seperti SQLite NOCASE)", () => {
  assert.equal(S.projectFold("Proyek"), "proyek");
  assert.equal(S.projectFold(null), "");
  assert.equal(S.projectFold(undefined), "");
  assert.notEqual(S.projectFold("Proyek "), S.projectFold("Proyek"), "spasi di ujung tidak dipangkas");
  assert.notEqual(S.projectFold("É"), S.projectFold("é"), "non-ASCII tidak dilipat");
  assert.equal(S.projectFold("A"), S.projectFold("a"));
  // sama persis dengan host (index.html projectNameFold)
  const host = fs.readFileSync(path.join(__dirname, "../../static/index.html"), "utf8");
  const m = host.match(/function projectNameFold\(s\) \{\n\s*return ([^\n]+);\n\}/);
  assert.ok(m, "projectNameFold host ditemukan");
  const hostFold = new Function("s", "return " + m[1] + ";");
  for (const s of ["Proyek ", "Proyek", "É", "é", "A", "a", "  ", "ÀbC İ ß", null, undefined, 12]) assert.equal(S.projectFold(s), hostFold(s), String(s));
});

test("final: scope canLink memakai lipatan host — 'Proyek ' ≠ 'Proyek', 'É' ≠ 'é', 'A' = 'a'", () => {
  const pr = (x, y) => S.canLink({ pred: { id: 1, project: x }, succ: { id: 2, project: y }, edges: [] });
  assert.deepEqual(pr("Proyek ", "Proyek"), { ok: false, reason: "scope" });
  assert.deepEqual(pr("É", "é"), { ok: false, reason: "scope" });
  assert.deepEqual(pr("A", "a"), { ok: true });
  assert.equal(S.scopeKeyOf({ project: "Proyek " }) === S.scopeKeyOf({ project: "Proyek" }), false);
  assert.equal(S.scopeKeyOf({ project: "A" }), S.scopeKeyOf({ project: "a" }));
  assert.equal(S.scopeKeyOf({ list_id: 7, project: "X" }), S.scopeKeyOf({ list_id: "7", project: "Y" }), "workspace: project tidak berpengaruh");
  assert.notEqual(S.scopeKeyOf({ list_id: 7 }), S.scopeKeyOf({ list_id: 8 }));
  assert.notEqual(S.scopeKeyOf({ list_id: 7 }), S.scopeKeyOf({}), "workspace vs pribadi");
  assert.equal(S.scopeKeyOf({}), S.scopeKeyOf({ project: "" }), "keduanya tanpa project");
});

test("final: satu pembantu id kalender — calTarget(listId) dan calKeyOf(task) = calTarget(task.list_id) (validasi id sama)", () => {
  assert.deepEqual(S.calTarget(12), { id: "cal@list:12", scope: "list:12" });
  assert.deepEqual(S.calTarget(" 12 "), { id: "cal@list:12", scope: "list:12" });
  for (const v of [null, undefined, "", 0, "0", "a b", "x".repeat(41), "a/b"]) {
    assert.deepEqual(S.calTarget(v), { id: "cal@user", scope: "user" }, JSON.stringify(v));
    assert.deepEqual(S.calKeyOf({ list_id: v }), S.calTarget(v), "calKeyOf = calTarget untuk " + JSON.stringify(v));
  }
  assert.deepEqual(S.calKeyOf({ list_id: 12 }), S.calTarget(12));
});
