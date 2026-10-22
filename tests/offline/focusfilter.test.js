"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ff = require("../../static/offline/focusfilter.js");
const indexHtml = fs.readFileSync(path.resolve(__dirname, "../../static/index.html"), "utf8").replace(/\r\n/g, "\n");
const swJs = fs.readFileSync(path.resolve(__dirname, "../../static/sw.js"), "utf8").replace(/\r\n/g, "\n");

const TODAY = "2026-10-22";

function fakeStorage(seed) {
  const m = new Map(Object.entries(seed || {}));
  return { m, getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); } };
}
const throwing = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } };

// ---- konstanta ----
test("konstanta: kunci, batas, urutan kanonis, chip cepat", () => {
  assert.equal(ff.FILTER_KEY, "tf_focus_filter");
  assert.equal(ff.COLLAPSED_KEY, "tf_focus_collapsed");
  assert.equal(ff.MAX_COLLAPSED, 200);
  assert.deepEqual([...ff.STATUSES], ["next", "inbox", "waiting", "someday"]);
  assert.deepEqual([...ff.PRIORITIES], ["P1", "P2", "P3", "P4"]);
  assert.deepEqual([...ff.QUADRANTS], ["Q1", "Q2", "Q3", "Q4"]);
  assert.deepEqual([...ff.QUICK_PRI], ["P1", "P2", "P3"]);
  assert.deepEqual([...ff.QUICK_QUAD], ["Q1", "Q3"]);
});
test("DEFAULT_FILTER: nilai default dan beku sampai ke array di dalamnya", () => {
  assert.deepEqual(ff.DEFAULT_FILTER, { time: "all", status: ["next"], pri: [], quad: [], proj: null });
  assert.ok(Object.isFrozen(ff.DEFAULT_FILTER));
  assert.ok(Object.isFrozen(ff.DEFAULT_FILTER.status));
  assert.ok(Object.isFrozen(ff.DEFAULT_FILTER.pri));
  assert.ok(Object.isFrozen(ff.DEFAULT_FILTER.quad));
});

// ---- timeBucket ----
test("timeBucket: kemarin late, hari ini today (juga dengan jam), besok none", () => {
  assert.equal(ff.timeBucket({ deadline: "2026-10-21" }, TODAY), "late");
  assert.equal(ff.timeBucket({ deadline: "2026-10-22" }, TODAY), "today");
  assert.equal(ff.timeBucket({ deadline: "2026-10-22T10:00" }, TODAY), "today");
  assert.equal(ff.timeBucket({ deadline: "2026-10-23" }, TODAY), "none");
});
test("timeBucket: deadline kosong / tak berbentuk / bukan string → none", () => {
  assert.equal(ff.timeBucket({ deadline: null }, TODAY), "none");
  assert.equal(ff.timeBucket({ deadline: "" }, TODAY), "none");
  assert.equal(ff.timeBucket({ deadline: "22-10-2026" }, TODAY), "none");
  assert.equal(ff.timeBucket({ deadline: 123 }, TODAY), "none");
  assert.equal(ff.timeBucket({}, TODAY), "none");
  assert.equal(ff.timeBucket(null, TODAY), "none");
  assert.equal(ff.timeBucket({ deadline: "2026-10-21" }, undefined), "none");
});
test("timeBucket: done/archived tidak pernah late", () => {
  assert.equal(ff.timeBucket({ deadline: "2026-10-01", gtd_status: "done" }, TODAY), "none");
  assert.equal(ff.timeBucket({ deadline: "2026-10-01", gtd_status: "archived" }, TODAY), "none");
});
test("timeBucket: is_overdue server basi diabaikan (Review Focus 2)", () => {
  assert.equal(ff.timeBucket({ deadline: "2026-10-22", is_overdue: true }, TODAY), "today");
  assert.equal(ff.timeBucket({ deadline: "2026-10-21", is_overdue: false }, TODAY), "late");
});
test("timeBucket: pergantian todayISO menggeser 2026-10-22 menjadi late", () => {
  assert.equal(ff.timeBucket({ deadline: "2026-10-22" }, "2026-10-22"), "today");
  assert.equal(ff.timeBucket({ deadline: "2026-10-22" }, "2026-10-23"), "late");
});

// ---- inTodayScope ----
const base = { id: 1, quadrant: "Q2", deadline: "2026-11-01", gtd_status: "next" };
test("inTodayScope: tiap pemicu benar sendiri-sendiri", () => {
  assert.equal(ff.inTodayScope({ ...base, quadrant: "Q1" }, { todayISO: TODAY }), true);
  assert.equal(ff.inTodayScope({ ...base, deadline: "2026-10-20" }, { todayISO: TODAY }), true);
  assert.equal(ff.inTodayScope({ ...base, deadline: "2026-10-22" }, { todayISO: TODAY }), true);
  assert.equal(ff.inTodayScope({ ...base, is_focused: true }, { todayISO: TODAY }), true);
  assert.equal(ff.inTodayScope({ ...base, id: "7" }, { todayISO: TODAY, focusTaskId: 7 }), true);
  assert.equal(ff.inTodayScope({ ...base, id: 7 }, { todayISO: TODAY, focusTaskId: "7" }), true);
});
test("inTodayScope: tanpa pemicu → false", () => {
  assert.equal(ff.inTodayScope(base, { todayISO: TODAY }), false);
  assert.equal(ff.inTodayScope(base, { todayISO: TODAY, focusTaskId: 2 }), false);
  assert.equal(ff.inTodayScope(base, { todayISO: TODAY, focusTaskId: null }), false);
  assert.equal(ff.inTodayScope(null, { todayISO: TODAY }), false);
});
test("inTodayScope: done keluar kecuali includeDone; archived selalu keluar", () => {
  const done = { ...base, quadrant: "Q1", gtd_status: "done" };
  assert.equal(ff.inTodayScope(done, { todayISO: TODAY }), false);
  assert.equal(ff.inTodayScope(done, { todayISO: TODAY, includeDone: true }), true);
  const arch = { ...base, quadrant: "Q1", is_focused: true, gtd_status: "archived" };
  assert.equal(ff.inTodayScope(arch, { todayISO: TODAY }), false);
  assert.equal(ff.inTodayScope(arch, { todayISO: TODAY, includeDone: true }), false);
});
test("inTodayScope: done ber-deadline hari ini tetap masuk dengan includeDone (Dashboard)", () => {
  const t = { ...base, deadline: "2026-10-22", gtd_status: "done" };
  assert.equal(ff.inTodayScope(t, { todayISO: TODAY }), false);
  assert.equal(ff.inTodayScope(t, { todayISO: TODAY, includeDone: true }), true);
});

// ---- normalizeFilter ----
test("normalizeFilter: bukan objek → salinan default (bukan referensi beku)", () => {
  for (const raw of [null, undefined, "x", 5, true, []]) {
    const f = ff.normalizeFilter(raw);
    assert.deepEqual(f, ff.DEFAULT_FILTER);
    assert.notEqual(f, ff.DEFAULT_FILTER);
    assert.ok(!Object.isFrozen(f));
    assert.ok(!Object.isFrozen(f.status));
    assert.notEqual(f.status, ff.DEFAULT_FILTER.status);
  }
});
test("normalizeFilter: time tak dikenal → all; tiga nilai sah dipertahankan", () => {
  assert.equal(ff.normalizeFilter({ time: "week" }).time, "all");
  assert.equal(ff.normalizeFilter({ time: 1 }).time, "all");
  for (const t of ["all", "today", "late"]) assert.equal(ff.normalizeFilter({ time: t }).time, t);
});
test("normalizeFilter: status — urutan kanonis, tanpa duplikat/tak dikenal", () => {
  assert.deepEqual(ff.normalizeFilter({ status: ["someday", "next", "next", "x"] }).status, ["next", "someday"]);
  assert.deepEqual(ff.normalizeFilter({ status: "next" }).status, ["next"]);
  assert.deepEqual(ff.normalizeFilter({ status: "waiting" }).status, ["next"]);
  assert.deepEqual(ff.normalizeFilter({}).status, ["next"]);
  assert.deepEqual(ff.normalizeFilter({ status: [] }).status, []);
  assert.deepEqual(ff.normalizeFilter({ status: ["x"] }).status, []);
});
test("normalizeFilter: pri dan quad", () => {
  assert.deepEqual(ff.normalizeFilter({ pri: ["P4", "P1", "P9"] }).pri, ["P1", "P4"]);
  assert.deepEqual(ff.normalizeFilter({ pri: ["P2", "P2"] }).pri, ["P2"]);
  assert.deepEqual(ff.normalizeFilter({ quad: "Q1" }).quad, []);
  assert.deepEqual(ff.normalizeFilter({ pri: "P1" }).pri, []);
  assert.deepEqual(ff.normalizeFilter({ quad: ["Q4", "Q1", "Q4", "Q7"] }).quad, ["Q1", "Q4"]);
});
test("normalizeFilter: proj — dipertahankan, label dipotong, bentuk lain → null", () => {
  assert.deepEqual(ff.normalizeFilter({ proj: { key: "p:a", label: "Pribadi · A" } }).proj,
    { key: "p:a", label: "Pribadi · A" });
  assert.equal(ff.normalizeFilter({ proj: { key: "" } }).proj, null);
  assert.equal(ff.normalizeFilter({ proj: { key: "k".repeat(301) } }).proj, null);
  assert.equal(ff.normalizeFilter({ proj: { key: 5 } }).proj, null);
  assert.equal(ff.normalizeFilter({ proj: "p:a" }).proj, null);
  assert.equal(ff.normalizeFilter({ proj: ["p:a"] }).proj, null);
  assert.equal(ff.normalizeFilter({ proj: null }).proj, null);
  assert.equal(ff.normalizeFilter({ proj: { key: "k".repeat(300), label: "x" } }).proj.key.length, 300);
  assert.equal(ff.normalizeFilter({ proj: { key: "p:a", label: "L".repeat(200) } }).proj.label.length, 120);
  assert.equal(ff.normalizeFilter({ proj: { key: "p:a" } }).proj.label, "");
  assert.equal(ff.normalizeFilter({ proj: { key: "p:a", label: 9 } }).proj.label, "");
});
test("normalizeFilter: idempoten dan tidak mengubah masukan", () => {
  const raw = { time: "late", status: ["waiting", "next"], pri: ["P4"], quad: ["Q2"], proj: { key: "p:a", label: "A" } };
  const snap = JSON.stringify(raw);
  const once = ff.normalizeFilter(raw);
  assert.equal(JSON.stringify(raw), snap);
  assert.deepEqual(ff.normalizeFilter(once), once);
});

// ---- isDefaultStatus / nonDefaultCount / isFilterDefault ----
test("isDefaultStatus: hanya [next]", () => {
  assert.equal(ff.isDefaultStatus(["next"]), true);
  assert.equal(ff.isDefaultStatus([]), false);
  assert.equal(ff.isDefaultStatus(["next", "inbox"]), false);
  assert.equal(ff.isDefaultStatus(["inbox"]), false);
  assert.equal(ff.isDefaultStatus("next"), false);
  assert.equal(ff.isDefaultStatus(null), false);
});
test("nonDefaultCount: default 0", () => {
  assert.equal(ff.nonDefaultCount(ff.DEFAULT_FILTER), 0);
  assert.equal(ff.nonDefaultCount(null), 0);
});
test("nonDefaultCount: status ≠ [next] dihitung 1 berapa pun isinya", () => {
  assert.equal(ff.nonDefaultCount({ ...ff.DEFAULT_FILTER, status: ["next", "waiting"] }), 1);
  assert.equal(ff.nonDefaultCount({ ...ff.DEFAULT_FILTER, status: [] }), 1);
  assert.equal(ff.nonDefaultCount({ ...ff.DEFAULT_FILTER, status: ["inbox", "waiting", "someday"] }), 1);
});
test("nonDefaultCount: proj, P4, Q2/Q4 dihitung; chip cepat dan time tidak", () => {
  assert.equal(ff.nonDefaultCount({ ...ff.DEFAULT_FILTER, proj: { key: "p:a", label: "A" } }), 1);
  assert.equal(ff.nonDefaultCount({ ...ff.DEFAULT_FILTER, pri: ["P1", "P4"] }), 1);
  assert.equal(ff.nonDefaultCount({ ...ff.DEFAULT_FILTER, pri: ["P1", "P2", "P3"] }), 0);
  assert.equal(ff.nonDefaultCount({ ...ff.DEFAULT_FILTER, quad: ["Q2", "Q4", "Q1"] }), 2);
  assert.equal(ff.nonDefaultCount({ ...ff.DEFAULT_FILTER, quad: ["Q1", "Q3"] }), 0);
  assert.equal(ff.nonDefaultCount({ ...ff.DEFAULT_FILTER, time: "late" }), 0);
  assert.equal(ff.nonDefaultCount({ time: "today", status: [], pri: ["P4"], quad: ["Q2", "Q4"], proj: { key: "p:a" } }), 5);
});
test("isFilterDefault: default true; satu field berbeda → false", () => {
  assert.equal(ff.isFilterDefault(ff.DEFAULT_FILTER), true);
  assert.equal(ff.isFilterDefault(ff.normalizeFilter(null)), true);
  assert.equal(ff.isFilterDefault({ ...ff.DEFAULT_FILTER, time: "late" }), false);
  assert.equal(ff.isFilterDefault({ ...ff.DEFAULT_FILTER, status: [] }), false);
  assert.equal(ff.isFilterDefault({ ...ff.DEFAULT_FILTER, pri: ["P1"] }), false);
  assert.equal(ff.isFilterDefault({ ...ff.DEFAULT_FILTER, quad: ["Q1"] }), false);
  assert.equal(ff.isFilterDefault({ ...ff.DEFAULT_FILTER, proj: { key: "p:a", label: "" } }), false);
});

// ---- penyimpanan filter ----
test("readFilter: storage kosong → default (objek baru)", () => {
  const f = ff.readFilter(fakeStorage());
  assert.deepEqual(f, ff.DEFAULT_FILTER);
  assert.ok(!Object.isFrozen(f));
});
test("writeFilter lalu readFilter → sama; yang tersimpan sudah ternormalisasi", () => {
  const st = fakeStorage();
  const f = { time: "late", status: ["waiting", "next"], pri: ["P1", "P4"], quad: ["Q2"], proj: { key: "p:a", label: "Pribadi · A" } };
  ff.writeFilter(st, f);
  assert.deepEqual(JSON.parse(st.m.get("tf_focus_filter")), ff.normalizeFilter(f));
  assert.deepEqual(ff.readFilter(st), ff.normalizeFilter(f));
});
test("readFilter: JSON rusak / bentuk salah → default", () => {
  assert.deepEqual(ff.readFilter(fakeStorage({ tf_focus_filter: "{rusak" })), ff.DEFAULT_FILTER);
  assert.deepEqual(ff.readFilter(fakeStorage({ tf_focus_filter: "null" })), ff.DEFAULT_FILTER);
  assert.deepEqual(ff.readFilter(fakeStorage({ tf_focus_filter: "[1,2]" })), ff.DEFAULT_FILTER);
  assert.deepEqual(ff.readFilter(fakeStorage({ tf_focus_filter: "" })), ff.DEFAULT_FILTER);
});
test("readFilter: nilai tersimpan yang sebagian rusak dinormalisasi", () => {
  const st = fakeStorage({ tf_focus_filter: JSON.stringify({ time: "week", status: ["someday", "x"], pri: ["P9"] }) });
  assert.deepEqual(ff.readFilter(st), { time: "all", status: ["someday"], pri: [], quad: [], proj: null });
});
test("filter: getItem/setItem melempar atau storage null/undefined → tidak melempar", () => {
  assert.deepEqual(ff.readFilter(throwing), ff.DEFAULT_FILTER);
  assert.doesNotThrow(() => ff.writeFilter(throwing, ff.DEFAULT_FILTER));
  assert.deepEqual(ff.readFilter(null), ff.DEFAULT_FILTER);
  assert.deepEqual(ff.readFilter(undefined), ff.DEFAULT_FILTER);
  assert.doesNotThrow(() => ff.writeFilter(null, ff.DEFAULT_FILTER));
  assert.doesNotThrow(() => ff.writeFilter(undefined, ff.DEFAULT_FILTER));
});

// ---- penyimpanan kelompok terlipat ----
test("readCollapsed: kosong → []; bukan array → []; JSON rusak → []", () => {
  assert.deepEqual(ff.readCollapsed(fakeStorage()), []);
  assert.deepEqual(ff.readCollapsed(fakeStorage({ tf_focus_collapsed: "{\"a\":1}" })), []);
  assert.deepEqual(ff.readCollapsed(fakeStorage({ tf_focus_collapsed: "[rusak" })), []);
});
test("readCollapsed: hanya string, tanpa duplikat", () => {
  assert.deepEqual(ff.readCollapsed(fakeStorage({ tf_focus_collapsed: "[1,{},\"p:a\",\"p:a\"]" })), ["p:a"]);
  assert.deepEqual(ff.readCollapsed(fakeStorage({ tf_focus_collapsed: "[1,{}]" })), []);
});
test("writeCollapsed lalu readCollapsed → sama (urutan terjaga)", () => {
  const st = fakeStorage();
  ff.writeCollapsed(st, ["p:a", "12:b", "p:a", 3, null]);
  assert.deepEqual(JSON.parse(st.m.get("tf_focus_collapsed")), ["p:a", "12:b"]);
  assert.deepEqual(ff.readCollapsed(st), ["p:a", "12:b"]);
});
test("writeCollapsed: 250 kunci → tersimpan 200 terakhir", () => {
  const st = fakeStorage();
  const keys = Array.from({ length: 250 }, (_, i) => "k" + i);
  ff.writeCollapsed(st, keys);
  const saved = JSON.parse(st.m.get("tf_focus_collapsed"));
  assert.equal(saved.length, 200);
  assert.equal(saved[0], "k50");
  assert.equal(saved[199], "k249");
});
test("readCollapsed: nilai tersimpan >200 dipangkas ke 200 terakhir", () => {
  const keys = Array.from({ length: 230 }, (_, i) => "k" + i);
  const r = ff.readCollapsed(fakeStorage({ tf_focus_collapsed: JSON.stringify(keys) }));
  assert.equal(r.length, 200);
  assert.equal(r[0], "k30");
});
test("collapsed: storage melempar / null / masukan bukan array → tidak melempar", () => {
  assert.deepEqual(ff.readCollapsed(throwing), []);
  assert.doesNotThrow(() => ff.writeCollapsed(throwing, ["p:a"]));
  assert.deepEqual(ff.readCollapsed(null), []);
  assert.doesNotThrow(() => ff.writeCollapsed(null, ["p:a"]));
  const st = fakeStorage();
  assert.doesNotThrow(() => ff.writeCollapsed(st, "p:a"));
  assert.deepEqual(ff.readCollapsed(st), []);
});

// ---- fixture PROTO: 16 task prototipe v2 (hari ini = 2026-10-22) ----
const SHARED = [{ id: 9, name: "Tim Marketing" }];
const LATE = {
  "12 Okt": "2026-10-12", "18 Okt": "2026-10-18", "18 Apr": "2026-04-18", "2 Jun": "2026-06-02",
  "15 Okt": "2026-10-15", "3 Okt": "2026-10-03", "30 Sep": "2026-09-30", "10 Okt": "2026-10-10",
  "19 Okt": "2026-10-19",
};
// time: "today" | "none" | label tanggal terlambat; ws: "P" = Pribadi, "TM" = Tim Marketing (list_id 9)
function mk(id, title, ws, project, priority, quadrant, time, status, star) {
  return {
    id, title, list_id: ws === "TM" ? 9 : null, project: project || "", priority, quadrant,
    gtd_status: status, is_focused: !!star,
    deadline: time === "today" ? TODAY : time === "none" ? null : LATE[time],
  };
}
const PROTO = [
  mk(1, "Revisi landing page Alurik", "P", "Alurik", "P1", "Q1", "today", "next", true),
  mk(2, "Balas email klien PT Sinar Jaya", "P", "Alurik", "P2", "Q1", "today", "next", true),
  mk(3, "Tulis changelog rilis v450", "P", "Alurik", "P2", "Q2", "today", "next"),
  mk(4, "Perbaiki ikon menu samping", "P", "Alurik", "P3", "Q1", "12 Okt", "next"),
  mk(5, "Uji suara latar di iPhone", "P", "Alurik", "P2", "Q1", "18 Okt", "waiting"),
  mk(6, "Siapkan demo fitur komentar", "P", "Alurik", "P1", "Q1", "none", "next"),
  mk(7, "Bayar tagihan listrik", "P", "Rumah", "P1", "Q1", "today", "next"),
  mk(8, "Servis AC kamar", "P", "Rumah", "P4", "Q3", "18 Apr", "someday"),
  mk(9, "Perpanjang STNK", "P", "Rumah", "P2", "Q1", "2 Jun", "next"),
  mk(10, "Telepon dokter gigi", "P", null, "P3", "Q3", "15 Okt", "inbox"),
  mk(11, "Brief desain banner akhir tahun", "TM", "Kampanye Q4", "P1", "Q1", "3 Okt", "next"),
  mk(12, "Jadwal posting minggu depan", "TM", "Kampanye Q4", "P2", "Q3", "today", "next"),
  mk(13, "Rekap performa iklan September", "TM", "Kampanye Q4", "P3", "Q3", "30 Sep", "next"),
  mk(14, "Konfirmasi vendor merchandise", "TM", "Kampanye Q4", "P2", "Q3", "10 Okt", "waiting"),
  mk(15, "Review naskah video produk", "TM", "Konten Video", "P2", "Q1", "today", "next"),
  mk(16, "Kumpulkan referensi thumbnail", "TM", "Konten Video", "P3", "Q1", "19 Okt", "next"),
];
const OPTS = { todayISO: TODAY };
const ids = list => list.map(t => t.id);
// Semua status, supaya satu filter diuji terpisah dari default status ["next"].
const anyStatus = over => ({ ...ff.DEFAULT_FILTER, status: [], ...over });
// Pool prototipe = semua task kecuali target (id 1 aktif, id 2 ⭐); dicocokkan dengan splitTarget di bawah.
const POOL = PROTO.filter(t => t.id !== 1 && t.id !== 2);

// ---- splitTarget ----
test("splitTarget: task aktif + ⭐ jadi target, sisanya 14 task di pool", () => {
  const { target, pool } = ff.splitTarget(PROTO, 1);
  assert.deepEqual(ids(target), [1, 2]);
  assert.equal(pool.length, 14);
  assert.deepEqual(ids(pool), [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
  assert.deepEqual(pool, POOL);
});
test("splitTarget: task aktif di luar cakupan filter/non-Next tetap di target pertama, bukan di pool (Review Focus 1)", () => {
  const active = { id: 50, title: "Aktif", quadrant: "Q2", priority: "P3", gtd_status: "waiting", deadline: null };
  const { target, pool } = ff.splitTarget([...PROTO, active], 50);
  assert.deepEqual(ids(target), [50, 1, 2]);
  assert.equal(pool.length, 14);
  assert.ok(!ids(pool).includes(50));
});
test("splitTarget: focusTaskId null/undefined → hanya task ⭐", () => {
  assert.deepEqual(ids(ff.splitTarget(PROTO, null).target), [1, 2]);
  assert.deepEqual(ids(ff.splitTarget(PROTO, undefined).target), [1, 2]);
  assert.equal(ff.splitTarget(PROTO, null).pool.length, 14);
});
test("splitTarget: id dibandingkan sebagai string; aktif yang juga ⭐ tidak ganda", () => {
  assert.deepEqual(ids(ff.splitTarget(PROTO, "1").target), [1, 2]);
  assert.deepEqual(ids(ff.splitTarget(PROTO, 2).target), [2, 1]);
  assert.equal(ff.splitTarget(PROTO, 2).pool.length, 14);
});
test("splitTarget: ⭐ lain diurutkan comparePriority; pool menjaga urutan masuk; masukan tidak diubah", () => {
  const scope = [
    { id: 30, title: "C", priority: "P3", is_focused: true },
    { id: 21, title: "B", priority: "P1", is_focused: true },
    { id: 22, title: "A", priority: "P2", is_focused: true },
    { id: 40, title: "Z" }, { id: 41, title: "Y" },
  ];
  const snap = ids(scope);
  const { target, pool } = ff.splitTarget(scope, null);
  assert.deepEqual(ids(target), [21, 22, 30]);
  assert.deepEqual(ids(pool), [40, 41]);
  assert.deepEqual(ids(scope), snap);
});
test("splitTarget: scope kosong / bukan array → target dan pool kosong", () => {
  assert.deepEqual(ff.splitTarget([], 1), { target: [], pool: [] });
  assert.deepEqual(ff.splitTarget(null, 1), { target: [], pool: [] });
});

// ---- groupKey ----
test("groupKey: Pribadi → p:, nama dilipat A–Z saja, kosong → akhiran kosong", () => {
  assert.equal(ff.groupKey({ list_id: null, project: "TaskFlow" }), "p:taskflow");
  assert.equal(ff.groupKey({ list_id: 7, project: "ÄBC" }), "7:Äbc");
  assert.equal(ff.groupKey({ list_id: "", project: "" }), "p:");
  assert.equal(ff.groupKey({ list_id: undefined, project: undefined }), "p:");
  assert.equal(ff.groupKey({ list_id: 9, project: null }), "9:");
  assert.equal(ff.groupKey({ list_id: "9", project: "Kampanye Q4" }), "9:kampanye q4");
});

// ---- comparePriority ----
test("comparePriority: P2 sebelum P3, tak dikenal/null setelah P4", () => {
  assert.ok(ff.comparePriority({ priority: "P2", title: "z", id: 2 }, { priority: "P3", title: "a", id: 1 }) < 0);
  assert.ok(ff.comparePriority({ priority: "P3" }, { priority: "P2" }) > 0);
  assert.ok(ff.comparePriority({ priority: "P4", title: "z" }, { priority: "P9", title: "a" }) < 0);
  assert.ok(ff.comparePriority({ priority: "P4", title: "z" }, { priority: null, title: "a" }) < 0);
  assert.ok(ff.comparePriority({ priority: "P9" }, { priority: "P4" }) > 0);
  assert.equal(ff.comparePriority({ priority: "P1", title: "a", id: 1 }, { priority: "P1", title: "a", id: 1 }), 0);
});
test("comparePriority: deadline terawal dulu, tanpa deadline paling akhir", () => {
  const a = { priority: "P2", deadline: "2026-10-01", title: "z", id: 3 };
  const b = { priority: "P2", deadline: "2026-10-20", title: "a", id: 2 };
  const c = { priority: "P2", deadline: null, title: "a", id: 1 };
  assert.deepEqual([c, b, a].sort(ff.comparePriority).map(t => t.id), [3, 2, 1]);
  assert.ok(ff.comparePriority({ priority: "P2", deadline: "abc", title: "a" }, b) > 0, "deadline tak berbentuk dianggap kosong");
  assert.ok(ff.comparePriority({ priority: "P2", deadline: "2026-10-01T09:00", id: 1 }, b) < 0, "jam diabaikan, hanya tanggal");
});
test("comparePriority: judul (locale id) lalu id; id dibandingkan secara numerik", () => {
  assert.ok(ff.comparePriority({ priority: "P1", title: "Apel", id: 9 }, { priority: "P1", title: "Bola", id: 1 }) < 0);
  assert.ok(ff.comparePriority({ priority: "P1", title: "apel", id: 9 }, { priority: "P1", title: "Bola", id: 1 }) < 0);
  assert.ok(ff.comparePriority({ priority: "P1", title: "Sama", id: 3 }, { priority: "P1", title: "Sama", id: 12 }) < 0);
  assert.ok(ff.comparePriority({ priority: "P1", title: "Sama", id: 12 }, { priority: "P1", title: "Sama", id: 3 }) > 0);
  assert.doesNotThrow(() => ff.comparePriority({}, {}));
});

// ---- matches ----
test("matches: pri satu nilai → hanya P1", () => {
  const got = PROTO.filter(t => ff.matches(t, anyStatus({ pri: ["P1"] }), OPTS));
  assert.deepEqual(ids(got), [1, 6, 7, 11]);
});
test("matches: (P1 atau P2) dan Q1 — atau di dalam jenis, dan antarjenis", () => {
  const got = PROTO.filter(t => ff.matches(t, anyStatus({ pri: ["P1", "P2"], quad: ["Q1"] }), OPTS));
  assert.deepEqual(ids(got), [1, 2, 5, 6, 7, 9, 11, 15]);
});
test("matches: status [] → semua status; default hanya next", () => {
  assert.equal(PROTO.filter(t => ff.matches(t, anyStatus(), OPTS)).length, 16);
  assert.deepEqual(ids(PROTO.filter(t => ff.matches(t, ff.DEFAULT_FILTER, OPTS))), [1, 2, 3, 4, 6, 7, 9, 11, 12, 13, 15, 16]);
  assert.deepEqual(ids(PROTO.filter(t => ff.matches(t, anyStatus({ status: ["inbox", "someday"] }), OPTS))), [8, 10]);
});
test("matches: time late/today memakai tanggal lokal; all tidak menyaring", () => {
  assert.deepEqual(ids(PROTO.filter(t => ff.matches(t, anyStatus({ time: "today" }), OPTS))), [1, 2, 3, 7, 12, 15]);
  assert.equal(PROTO.filter(t => ff.matches(t, anyStatus({ time: "late" }), OPTS)).length, 9);
  assert.equal(PROTO.filter(t => ff.matches(t, anyStatus({ time: "all" }), OPTS)).length, 16);
  assert.equal(ff.matches(PROTO[2], anyStatus({ time: "late" }), { todayISO: "2026-10-23" }), true);
});
test("matches: query dilipat besar-kecil, di-trim dan spasi berulang dirapatkan", () => {
  const rekap = PROTO.filter(t => ff.matches(t, anyStatus(), { todayISO: TODAY, query: "  REKAP  " }));
  assert.deepEqual(rekap.map(t => t.title), ["Rekap performa iklan September"]);
  const ikon = PROTO.filter(t => ff.matches(t, anyStatus(), { todayISO: TODAY, query: "perbaiki   ikon" }));
  assert.deepEqual(ikon.map(t => t.title), ["Perbaiki ikon menu samping"]);
  assert.equal(ff.matches({ title: "Perbaiki   ikon" }, anyStatus(), { todayISO: TODAY, query: "perbaiki ikon" }), true);
  assert.equal(ff.matches({ title: "Ünggul" }, anyStatus(), { todayISO: TODAY, query: "ÜNGGUL" }), true);
  assert.equal(ff.matches(PROTO[0], anyStatus(), { todayISO: TODAY, query: "   " }), true);
  assert.equal(ff.matches(PROTO[0], anyStatus(), { todayISO: TODAY, query: "tidak ada" }), false);
});
test("matches: proj mengunci satu kelompok (workspace + project)", () => {
  const got = PROTO.filter(t => ff.matches(t, anyStatus({ proj: { key: "9:kampanye q4", label: "" } }), OPTS));
  assert.deepEqual(ids(got), [11, 12, 13, 14]);
  const tanpa = PROTO.filter(t => ff.matches(t, anyStatus({ proj: { key: "p:", label: "" } }), OPTS));
  assert.deepEqual(ids(tanpa), [10]);
});
test("matches: except time mengabaikan time saja; except status mengabaikan status saja", () => {
  const today = PROTO[2];   // id 3: next, hari ini
  const waiting = PROTO[4]; // id 5: waiting, terlambat
  const late = { ...ff.DEFAULT_FILTER, time: "late" };
  assert.equal(ff.matches(today, late, OPTS), false);
  assert.equal(ff.matches(today, late, { ...OPTS, except: "time" }), true);
  assert.equal(ff.matches(waiting, { ...late, time: "all" }, OPTS), false);
  assert.equal(ff.matches(waiting, { ...late, time: "all" }, { ...OPTS, except: "status" }), true);
  assert.equal(ff.matches(waiting, ff.DEFAULT_FILTER, { ...OPTS, except: "time" }), false, "status tetap berlaku");
  assert.equal(ff.matches(today, late, { ...OPTS, except: "status" }), false, "time tetap berlaku");
  assert.equal(ff.matches(PROTO[0], { ...anyStatus(), pri: ["P4"] }, { ...OPTS, except: "time" }), false, "pri tidak pernah diabaikan");
});
test("matches: priority null gagal bila pri terisi, lolos bila kosong", () => {
  const t = { id: 99, title: "Tanpa prioritas", priority: null, quadrant: "Q1", gtd_status: "next" };
  assert.equal(ff.matches(t, { ...ff.DEFAULT_FILTER, pri: ["P1"] }, OPTS), false);
  assert.equal(ff.matches(t, ff.DEFAULT_FILTER, OPTS), true);
  assert.equal(ff.matches({ ...t, priority: undefined, quadrant: null }, { ...ff.DEFAULT_FILTER, quad: ["Q1"] }, OPTS), false);
});
test("matches: task tanpa field / opts tidak melempar", () => {
  assert.doesNotThrow(() => ff.matches({}, ff.DEFAULT_FILTER, OPTS));
  assert.equal(ff.matches({}, ff.DEFAULT_FILTER, OPTS), false);
  assert.equal(ff.matches({}, anyStatus(), OPTS), true);
  assert.equal(ff.matches({}, anyStatus(), { todayISO: TODAY, query: "x" }), false, "title kosong tidak memuat query");
  assert.equal(ff.matches({ title: "x" }, anyStatus()), true, "opts boleh dihilangkan");
  assert.equal(ff.matches({ title: "x" }, null), false, "filter null = default (status next)");
  assert.equal(ff.matches(null, ff.DEFAULT_FILTER, OPTS), false);
});

// ---- hitungan ----
test("timeCounts: pool × default → semua 10, hari ini 4, terlambat 5", () => {
  assert.deepEqual(ff.timeCounts(POOL, ff.DEFAULT_FILTER, OPTS), { all: 10, today: 4, late: 5 });
});
test("timeCounts: mengabaikan filter.time, tetap menghormati filter lain dan query", () => {
  assert.deepEqual(ff.timeCounts(POOL, { ...ff.DEFAULT_FILTER, time: "late" }, OPTS), { all: 10, today: 4, late: 5 });
  assert.deepEqual(ff.timeCounts(POOL, { ...ff.DEFAULT_FILTER, pri: ["P2"] }, OPTS), { all: 4, today: 3, late: 1 });
  assert.deepEqual(ff.timeCounts(POOL, ff.DEFAULT_FILTER, { ...OPTS, query: "rekap" }), { all: 1, today: 0, late: 1 });
  assert.deepEqual(ff.timeCounts([], ff.DEFAULT_FILTER, OPTS), { all: 0, today: 0, late: 0 });
});
test("timeCounts: all mencakup task tanpa deadline", () => {
  const pool = [{ id: 1, gtd_status: "next", deadline: null }, { id: 2, gtd_status: "next", deadline: TODAY }];
  assert.deepEqual(ff.timeCounts(pool, ff.DEFAULT_FILTER, OPTS), { all: 2, today: 1, late: 0 });
});
test("statusCounts: pool × default → next 10, inbox 1, waiting 2, someday 1", () => {
  assert.deepEqual(ff.statusCounts(POOL, ff.DEFAULT_FILTER, OPTS), { next: 10, inbox: 1, waiting: 2, someday: 1 });
});
test("statusCounts: mengabaikan filter.status, menghormati time dan query", () => {
  assert.deepEqual(ff.statusCounts(POOL, { ...ff.DEFAULT_FILTER, status: ["inbox"] }, OPTS), { next: 10, inbox: 1, waiting: 2, someday: 1 });
  assert.deepEqual(ff.statusCounts(POOL, { ...ff.DEFAULT_FILTER, status: [] }, OPTS), { next: 10, inbox: 1, waiting: 2, someday: 1 });
  assert.deepEqual(ff.statusCounts(POOL, { ...ff.DEFAULT_FILTER, time: "late" }, OPTS), { next: 5, inbox: 1, waiting: 2, someday: 1 });
  assert.deepEqual(ff.statusCounts(POOL, ff.DEFAULT_FILTER, { ...OPTS, query: "suara" }), { next: 0, inbox: 0, waiting: 1, someday: 0 });
  assert.deepEqual(ff.statusCounts([], ff.DEFAULT_FILTER, OPTS), { next: 0, inbox: 0, waiting: 0, someday: 0 });
});
test("hiddenByStatus: default → 4 task berstatus lain disembunyikan", () => {
  assert.equal(ff.hiddenByStatus(POOL, ff.DEFAULT_FILTER, OPTS), 4);
});
test("hiddenByStatus: status [] → 0; hanya yang lolos filter lain dihitung", () => {
  assert.equal(ff.hiddenByStatus(POOL, { ...ff.DEFAULT_FILTER, status: [] }, OPTS), 0);
  assert.equal(ff.hiddenByStatus(POOL, { ...ff.DEFAULT_FILTER, status: ["next", "inbox", "waiting", "someday"] }, OPTS), 0);
  assert.equal(ff.hiddenByStatus(POOL, ff.DEFAULT_FILTER, { ...OPTS, query: "suara" }), 1);
  assert.equal(ff.hiddenByStatus(POOL, { ...ff.DEFAULT_FILTER, pri: ["P1"] }, OPTS), 0);
  assert.equal(ff.hiddenByStatus(POOL, { ...ff.DEFAULT_FILTER, status: ["inbox"] }, OPTS), 13, "14 task di pool, hanya satu berstatus inbox");
  assert.equal(ff.hiddenByStatus([], ff.DEFAULT_FILTER, OPTS), 0);
});

// ---- groupTasks ----
const labelOf = g => g.workspaceLabel + " · " + g.projectLabel;
test("groupTasks: urutan Pribadi dulu, Tanpa project paling akhir di scope-nya", () => {
  const groups = ff.groupTasks(POOL, SHARED);
  assert.deepEqual(groups.map(labelOf), [
    "Pribadi · Alurik", "Pribadi · Rumah", "Pribadi · Tanpa project",
    "Tim Marketing · Kampanye Q4", "Tim Marketing · Konten Video",
  ]);
  assert.deepEqual(groups.map(g => g.key), ["p:alurik", "p:rumah", "p:", "9:kampanye q4", "9:konten video"]);
  assert.deepEqual(groups.map(g => g.listId), [null, null, null, 9, 9]);
  assert.deepEqual(groups.map(g => g.tasks.length), [4, 3, 1, 4, 2]);
});
test("groupTasks: task dalam kelompok terurut comparePriority, apa pun urutan masuk", () => {
  const a = ff.groupTasks(POOL, SHARED);
  const b = ff.groupTasks([...POOL].reverse(), SHARED);
  assert.deepEqual(ids(a[0].tasks), [6, 5, 3, 4]);
  assert.deepEqual(ids(a[3].tasks), [11, 14, 12, 13]);
  assert.deepEqual(b.map(g => ids(g.tasks)), a.map(g => ids(g.tasks)));
  assert.deepEqual(b.map(g => g.key), a.map(g => g.key));
});
test("groupTasks: tidak mengubah urutan masukan", () => {
  const input = [{ id: 2, title: "b", priority: "P2" }, { id: 1, title: "a", priority: "P1" }];
  ff.groupTasks(input, []);
  assert.deepEqual(ids(input), [2, 1]);
});
test("groupTasks: 'Alurik' pribadi dan 'Alurik' di workspace → dua kelompok", () => {
  const tasks = [
    { id: 1, title: "a", list_id: null, project: "Alurik" },
    { id: 2, title: "b", list_id: 9, project: "Alurik" },
  ];
  const groups = ff.groupTasks(tasks, SHARED);
  assert.deepEqual(groups.map(g => g.key), ["p:alurik", "9:alurik"]);
  assert.deepEqual(groups.map(labelOf), ["Pribadi · Alurik", "Tim Marketing · Alurik"]);
});
test("groupTasks: beda kapitalisasi di scope sama → satu kelompok berlabel task pertama (urutan masuk)", () => {
  const t1 = { id: 1, title: "a", list_id: null, project: "alurik" };
  const t2 = { id: 2, title: "b", list_id: null, project: "Alurik" };
  const ab = ff.groupTasks([t1, t2], []);
  assert.equal(ab.length, 1);
  assert.equal(ab[0].projectLabel, "alurik");
  assert.deepEqual(ids(ab[0].tasks), [1, 2]);
  const ba = ff.groupTasks([t2, t1], []);
  assert.equal(ba.length, 1);
  assert.equal(ba[0].projectLabel, "Alurik");
});
test("groupTasks: workspace tanpa entri sharedLists / tanpa nama → 'Workspace'", () => {
  const g = ff.groupTasks([{ id: 1, title: "a", list_id: 77, project: "X" }], SHARED);
  assert.equal(g[0].workspaceLabel, "Workspace");
  assert.equal(g[0].key, "77:x");
  assert.equal(ff.groupTasks([{ id: 1, title: "a", list_id: 77, project: "X" }], undefined)[0].workspaceLabel, "Workspace");
  assert.equal(ff.groupTasks([{ id: 1, title: "a", list_id: 9, project: "X" }], [{ id: 9 }])[0].workspaceLabel, "Workspace");
  assert.equal(ff.groupTasks([{ id: 1, title: "a", list_id: "9", project: "X" }], SHARED)[0].workspaceLabel, "Tim Marketing");
});
test("groupTasks: workspace diurut menurut label tanpa beda huruf besar; seri → list_id numerik", () => {
  const mkTask = (id, listId) => ({ id, title: "t", list_id: listId, project: "P" });
  const beta = ff.groupTasks([mkTask(1, 1), mkTask(2, 2)], [{ id: 1, name: "Gamma" }, { id: 2, name: "beta" }]);
  assert.deepEqual(beta.map(g => g.workspaceLabel), ["beta", "Gamma"]);
  const same = ff.groupTasks([mkTask(1, 10), mkTask(2, 9), mkTask(3, 3)],
    [{ id: 10, name: "Tim" }, { id: 9, name: "Tim" }, { id: 3, name: "Zzz" }]);
  assert.deepEqual(same.map(g => g.listId), [9, 10, 3]);
});
test("groupTasks: Pribadi selalu sebelum workspace; project menurut nama ter-fold; Tanpa project terakhir", () => {
  const tasks = [
    { id: 1, title: "t", list_id: 1, project: "A" },
    { id: 2, title: "t", list_id: null, project: "" },
    { id: 3, title: "t", list_id: null, project: "Zebra" },
    { id: 4, title: "t", list_id: null, project: "apple" },
  ];
  const groups = ff.groupTasks(tasks, [{ id: 1, name: "Aaa" }]);
  assert.deepEqual(groups.map(labelOf), ["Pribadi · apple", "Pribadi · Zebra", "Pribadi · Tanpa project", "Aaa · A"]);
});
test("groupTasks: tanpa task → []", () => {
  assert.deepEqual(ff.groupTasks([], SHARED), []);
  assert.deepEqual(ff.groupTasks(null, SHARED), []);
});

// ---- projectOptions ----
test("projectOptions: 5 opsi dari seluruh pool dengan angka 4/3/1/4/2", () => {
  const opts = ff.projectOptions(POOL, SHARED, ff.DEFAULT_FILTER);
  assert.deepEqual(opts.map(o => o.label), [
    "Pribadi · Alurik", "Pribadi · Rumah", "Pribadi · Tanpa project",
    "Tim Marketing · Kampanye Q4", "Tim Marketing · Konten Video",
  ]);
  assert.deepEqual(opts.map(o => o.count), [4, 3, 1, 4, 2]);
  assert.deepEqual(opts.map(o => o.key), ["p:alurik", "p:rumah", "p:", "9:kampanye q4", "9:konten video"]);
  assert.deepEqual(ff.projectOptions(POOL, SHARED), opts, "filter boleh dihilangkan");
  assert.deepEqual(ff.projectOptions(POOL, SHARED, null), opts);
});
test("projectOptions: angka tidak terpengaruh filter lain (status/pri) — dari seluruh pool", () => {
  const opts = ff.projectOptions(POOL, SHARED, { ...ff.DEFAULT_FILTER, pri: ["P1"], time: "late" });
  assert.deepEqual(opts.map(o => o.count), [4, 3, 1, 4, 2]);
});
test("projectOptions: project terpilih yang sudah tak punya task ditambahkan di akhir dengan count 0 (Review Focus 3)", () => {
  const proj = { key: "p:hilang", label: "Pribadi · Hilang" };
  const opts = ff.projectOptions(POOL, SHARED, { ...ff.DEFAULT_FILTER, proj });
  assert.equal(opts.length, 6);
  assert.deepEqual(opts[5], { key: "p:hilang", label: "Pribadi · Hilang", count: 0 });
  assert.deepEqual(opts.slice(0, 5).map(o => o.count), [4, 3, 1, 4, 2]);
});
test("projectOptions: project terpilih yang masih ada tidak digandakan", () => {
  const proj = { key: "9:konten video", label: "label lama" };
  const opts = ff.projectOptions(POOL, SHARED, { ...ff.DEFAULT_FILTER, proj });
  assert.equal(opts.length, 5);
  assert.equal(opts[4].label, "Tim Marketing · Konten Video");
  assert.equal(opts[4].count, 2);
});
test("projectOptions: pool kosong dengan proj basi → hanya opsi basi", () => {
  const proj = { key: "p:hilang", label: "Pribadi · Hilang" };
  assert.deepEqual(ff.projectOptions([], SHARED, { ...ff.DEFAULT_FILTER, proj }), [{ key: "p:hilang", label: "Pribadi · Hilang", count: 0 }]);
  assert.deepEqual(ff.projectOptions([], SHARED, ff.DEFAULT_FILTER), []);
});

// ---- sumber ----
test("index.html memuat focusfilter.js tepat setelah tasklogic.js", () => {
  const a = indexHtml.indexOf('<script src="/static/offline/tasklogic.js"></script>');
  const b = indexHtml.indexOf('<script src="/static/offline/focusfilter.js"></script>');
  assert.ok(a >= 0 && b > a);
  assert.equal(indexHtml.slice(a, b).split("\n").length, 2, "tidak ada tag lain di antara keduanya");
});
test("sw.js memuat focusfilter.js di STATIC setelah tasklogic.js", () => {
  const a = swJs.indexOf('"/static/offline/tasklogic.js"');
  const b = swJs.indexOf('"/static/offline/focusfilter.js"');
  assert.ok(a >= 0 && b > a);
  const block = /const STATIC = \[([\s\S]*?)\n\];/.exec(swJs)[1];
  assert.ok(block.includes('"/static/offline/focusfilter.js"'));
});
