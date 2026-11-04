// Plugin Timeline (Fase 1, PR 1b) — Task 4: tata letak Gantt murni (TLLayout)
// (rencana R2, R9, R10, R11, R16, R21, R22, R23, R24). Semua tanggal tetap; "hari ini" dimasukkan sebagai argumen.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const dir = path.join(__dirname, "../../static/plugins/timeline");
const L = require(path.join(dir, "layout.js"));
const S = require(path.join(dir, "schedule.js"));
const C = require(path.join(dir, "calendar.js"));

const D = (s) => C.dn(s);
const I = (n) => C.iso(n);
const std = () => C.compile(C.DEFAULT_CAL);
const TODAY = "2026-11-04"; // Rabu

// Task palsu: ext memakai kunci runtime `timeline.*`; readSchedOf = readSched atas kunci tanpa prefiks.
function mk(id, over, ext) {
  // created_at deterministik menurut id numerik → urut bawaan (created_at lalu id) = urut id
  const t = { id, title: "T" + id, created_at: "2026-10-01T00:00:" + String(Number(id) || 0).padStart(5, "0"), ...(over || {}) };
  if (ext) t.ext = ext;
  return t;
}
const sch = (start, duration, deps) => {
  const e = {};
  if (start !== undefined) e["timeline.start"] = start;
  if (duration !== undefined) e["timeline.duration"] = duration;
  if (deps) e["timeline.deps"] = deps;
  return e;
};
const readSchedOf = (task) => {
  const out = {};
  const ext = task && task.ext;
  if (ext) for (const k of Object.keys(ext)) if (k.indexOf("timeline.") === 0) out[k.slice(9)] = ext[k];
  return S.readSched(out);
};
const lay = (tasks, over) => L.layout({ tasks, pageKind: "project", sort: "wbs", cal: std(), today: TODAY, readSchedOf, zoom: "week", ...(over || {}) });
const keys = (res) => res.rows.map((r) => r.key);
const wbs = (res) => Object.fromEntries(res.rows.map((r) => [r.key, r.wbs]));

test("konstanta: PX day 28 / week 12 / month 4; ROW_H 32, ROW_H_TOUCH 36; modul beku", () => {
  assert.deepEqual({ ...L.PX }, { day: 28, week: 12, month: 4 });
  assert.equal(L.ROW_H, 32);
  assert.equal(L.ROW_H_TOUCH, 36);
  assert.ok(Object.isFrozen(L));
  assert.ok(Object.isFrozen(L.PX));
});

test("kelompok workspace: per project urut nama + (Tanpa project) terakhir; halaman project tanpa baris kelompok", () => {
  const tasks = [
    mk(1, { project_id: 20, project: "beta" }),
    mk(2, { project_id: 10, project: "Zeta" }),
    mk(3, { project: "  " }), // tanpa project
    mk(4, { project_id: 10, project: "Zeta" }),
    mk(5, { project_id: 30, project: "Alpha" }),
    mk(6, { project: "beta" }), // tanpa id, nama cocok NOCASE dengan project ber-id 20 → ikut kelompok itu
    mk(7, { project: "Solo" }), // tanpa id, nama saja → kelompok sendiri
  ];
  const ws = lay(tasks, { pageKind: "workspace" });
  assert.deepEqual(
    ws.groups.map((g) => g.name),
    ["Alpha", "beta", "Solo", "Zeta", "(Tanpa project)"],
  );
  assert.deepEqual(
    ws.groups.map((g) => g.n),
    [1, 2, 3, 4, 5],
  );
  assert.deepEqual(
    ws.groups.map((g) => g.taskCount),
    [1, 2, 1, 2, 1],
  );
  const kinds = ws.rows.map((r) => r.kind + ":" + r.key);
  assert.deepEqual(kinds, ["group:g:p:30", "task:5", "group:g:p:20", "task:1", "task:6", "group:g:n:solo", "task:7", "group:g:p:10", "task:2", "task:4", "group:g:none", "task:3"]);
  const g0 = ws.rows[0];
  assert.equal(g0.task, null);
  assert.equal(g0.span, null);
  assert.equal(g0.wbs, "1");
  assert.equal(ws.rows[1].group, "p:30");
  // halaman project: satu kelompok, tidak ada baris kelompok
  const pj = lay(tasks, { pageKind: "project" });
  assert.equal(pj.groups.length, 1);
  assert.equal(pj.groups[0].name, null);
  assert.ok(pj.rows.every((r) => r.kind !== "group"));
  assert.equal(pj.rows.length, 7);
});

test("dibuang: task berulang, archived, deleted; selesai tetap (bar 100%)", () => {
  const tasks = [
    mk(1, {}, sch("2026-11-02", 2)),
    mk(2, { recurrence_type: "daily" }, sch("2026-11-02", 2)),
    mk(3, { gtd_status: "archived" }),
    mk(4, { deleted: true }),
    mk(5, { gtd_status: "done", completed_at: "2026-11-01T10:00:00", progress: 30 }, sch("2026-11-02", 2)),
    mk(6, { completed_at: "2026-11-01T10:00:00", progress: 0 }),
    null,
    mk(1, { title: "duplikat id" }), // kunci ganda: yang pertama menang
  ];
  const r = lay(tasks);
  assert.deepEqual(keys(r).sort(), ["1", "5", "6"]);
  assert.equal(r.rows.find((x) => x.key === "5").progress, 100);
  assert.equal(r.rows.find((x) => x.key === "5").done, true);
  assert.equal(r.rows.find((x) => x.key === "6").progress, 100);
  assert.equal(r.rows.find((x) => x.key === "1").progress, 0);
  assert.equal(r.rows.find((x) => x.key === "1").task.title, "T1");
  assert.equal(r.stats.tasks, 3);
});

test("hierarki menang: anak di project lain ikut induknya; induk di luar scope → anak jadi akar (R9)", () => {
  const tasks = [
    mk(1, { project_id: 1, project: "A" }),
    mk(2, { project_id: 2, project: "B", parent_id: 1 }), // induk di project A → ikut A
    mk(3, { project_id: 2, project: "B", parent_id: 2 }), // cucu juga ikut A
    mk(4, { project_id: 2, project: "B", parent_id: 999 }), // induk tak ada di scope → akar di B
    mk(5, { project_id: 2, project: "B", parent_id: 6 }), // induk berulang → dibuang → akar
    mk(6, { project_id: 2, project: "B", recurrence_type: "weekly" }),
    mk(7, { project_id: 2, project: "B", parent_cid: "c-9" }), // induk lewat cid
    mk("c-9", { project_id: 1, project: "A" }),
  ];
  const r = lay(tasks, { pageKind: "workspace" });
  const row = (k) => r.rows.find((x) => x.key === k);
  assert.equal(row("2").group, "p:1");
  assert.equal(row("3").group, "p:1");
  assert.equal(row("2").depth, 1);
  assert.equal(row("3").depth, 2);
  assert.equal(row("2").parentKey, "1");
  assert.equal(row("4").group, "p:2");
  assert.equal(row("4").depth, 0);
  assert.equal(row("4").parentKey, null);
  assert.equal(row("5").depth, 0);
  assert.equal(row("7").group, "p:1");
  assert.equal(row("7").parentKey, "c-9");
  // urutan: anak langsung setelah induknya
  const order = keys(r);
  assert.ok(order.indexOf("2") > order.indexOf("1"));
  assert.ok(order.indexOf("3") > order.indexOf("2"));
});

test("hierarki: lingkaran induk dan induk diri sendiri tidak membuat task hilang atau hang", () => {
  const tasks = [mk(1, { parent_id: 2 }), mk(2, { parent_id: 1 }), mk(3, { parent_id: 3 }), mk(4, { parent_id: 1 })];
  const r = lay(tasks);
  assert.deepEqual(keys(r).sort(), ["1", "2", "3", "4"]);
  assert.equal(r.rows.filter((x) => x.depth === 0).length >= 2, true);
});

test("WBS: workspace 1.1, 1.1.1, 2.1; project 1, 1.1; urut created_at lalu id; sort start mengubah urutan, bukan nomor", () => {
  const tasks = [
    mk(10, { project_id: 1, project: "A", created_at: "2026-10-02" }, sch("2026-11-09", 1)), // root kedua di A
    mk(11, { project_id: 1, project: "A", created_at: "2026-10-01" }, sch("2026-11-16", 1)), // root pertama di A (lebih lama)
    mk(12, { project_id: 1, project: "A", created_at: "2026-10-03", parent_id: 11 }, sch("2026-11-12", 1)), // anak 11 #1
    mk(13, { project_id: 1, project: "A", created_at: "2026-10-03", parent_id: 11 }, sch("2026-11-10", 1)), // anak 11 #2 (id lebih besar, created_at sama)
    mk(14, { project_id: 1, project: "A", created_at: "2026-10-04", parent_id: 12 }, sch("2026-11-12", 1)), // cucu
    mk(20, { project_id: 2, project: "B", created_at: "2026-10-01" }),
  ];
  const ws = lay(tasks, { pageKind: "workspace" });
  assert.deepEqual(wbs(ws), { "g:p:1": "1", 11: "1.1", 12: "1.1.1", 14: "1.1.1.1", 13: "1.1.2", 10: "1.2", "g:p:2": "2", 20: "2.1" });
  assert.deepEqual(keys(ws), ["g:p:1", "11", "12", "14", "13", "10", "g:p:2", "20"]);
  const pj = lay(tasks.slice(0, 5), { pageKind: "project" });
  assert.deepEqual(wbs(pj), { 11: "1", 12: "1.1", 14: "1.1.1", 13: "1.2", 10: "2" });
  // sort start: urutan tampilan berubah (mulai naik), nomor WBS tetap melekat pada task
  const byStart = lay(tasks.slice(0, 5), { pageKind: "project", sort: "start" });
  assert.deepEqual(keys(byStart), ["10", "11", "13", "12", "14"]);
  assert.deepEqual(wbs(byStart), { 11: "1", 12: "1.1", 14: "1.1.1", 13: "1.2", 10: "2" });
  // ringkasan 11 mulai dari anak paling awal (13: 10 Nov) → 10 (9 Nov) lebih awal; tanpa jadwal selalu terakhir
  const mixed = lay([mk(1, {}, sch("2026-11-10", 1)), mk(2, {}), mk(3, {}, sch("2026-11-03", 1))], { sort: "start" });
  assert.deepEqual(keys(mixed), ["3", "1", "2"]);
});

test("ringkasan: rentang min–maks anak terjadwal rekursif; tanpa anak terjadwal → tanpa span; kind summary", () => {
  const tasks = [
    mk(1, {}, sch("2026-12-01", 9)), // ext induk disimpan tetapi tidak dipakai selama punya anak
    mk(2, { parent_id: 1 }, sch("2026-11-10", 2)), // Sel 10–Rab 11
    mk(3, { parent_id: 1 }), // anak tanpa jadwal
    mk(4, { parent_id: 1 }), // sub-ringkasan
    mk(5, { parent_id: 4 }, sch("2026-11-03", 1)),
    mk(6, { parent_id: 4 }, sch("2026-11-17", 3)), // Sel 17–Kam 19
    mk(7, {}), // ringkasan tanpa anak terjadwal
    mk(8, { parent_id: 7 }),
    mk(9, { parent_id: 7 }, sch(undefined)), // ext kosong
  ];
  const r = lay(tasks);
  const row = (k) => r.rows.find((x) => x.key === k);
  assert.equal(row("1").kind, "summary");
  assert.equal(row("4").kind, "summary");
  assert.equal(row("2").kind, "task");
  assert.equal(I(row("1").span.s), "2026-11-03");
  assert.equal(I(row("1").span.f), "2026-11-19");
  assert.equal(I(row("4").span.s), "2026-11-03");
  assert.equal(I(row("4").span.f), "2026-11-19");
  assert.equal(row("1").childCount, 3);
  assert.equal(row("1").duration, 13, "hari kerja 3–19 Nov 2026: 4 + 5 + 4");
  assert.equal(row("7").kind, "summary");
  assert.equal(row("7").span, null);
  assert.equal(row("7").duration, null);
  assert.equal(row("3").span, null);
  assert.equal(row("3").kind, "task");
  assert.equal(r.stats.summaries, 3);
  assert.equal(r.stats.scheduled, 5, "1, 4 (ringkasan) + 2, 5, 6");
  assert.equal(r.stats.unscheduled, 4);
  // ext induk tetap tersedia di sched, tetapi span berasal dari anak
  assert.equal(row("1").sched.start, "2026-12-01");
});

test("rentang: min(start) − 14 .. max(finish, deadline) + 30 ∪ today ± 60", () => {
  // jadwal di tengah ± hari ini: rentang = hari ini ± 60
  const near = lay([mk(1, {}, sch("2026-11-05", 2))]);
  assert.equal(near.range.from, D(TODAY) - 60);
  assert.equal(near.range.to, D(TODAY) + 60);
  // jadwal jauh sesudah dan sebelum hari ini
  const far = lay([mk(1, {}, sch("2027-06-02", 1)), mk(2, {}, sch("2025-03-03", 1))]);
  assert.equal(far.range.from, D("2025-03-03") - 14);
  assert.equal(far.range.to, D("2027-06-02") + 30);
  // tenggat melampaui selesai ikut menentukan batas kanan; tenggat berformat datetime dibaca 10 karakter
  const dl = lay([mk(1, { deadline: "2027-09-15T23:59:00" }, sch("2026-11-05", 1))]);
  assert.equal(dl.range.to, D("2027-09-15") + 30);
  // task tanpa jadwal tetap memajukan tenggat; tanpa apa pun → hari ini ± 60
  assert.equal(lay([mk(1, { deadline: "2028-01-01" })]).range.to, D("2028-01-01") + 30);
  const empty = lay([]);
  assert.deepEqual(empty.range, { from: D(TODAY) - 60, to: D(TODAY) + 60 });
  assert.equal(empty.rows.length, 0);
  // px per zoom + tahun tanpa data libur
  assert.equal(lay([], { zoom: "day" }).px, 28);
  assert.equal(lay([], { zoom: "week" }).px, 12);
  assert.equal(lay([], { zoom: "month" }).px, 4);
  assert.equal(lay([], { zoom: "bogus" }).px, 12, "zoom tak dikenal → minggu");
  assert.deepEqual(far.missingYears, [], "2025–2027 semua punya data");
  const nodata = lay([mk(1, {}, sch("2031-03-03", 1))]); // rentang 2026-09-05 .. 2031-04-02
  assert.deepEqual(nodata.missingYears, [2028, 2029, 2030, 2031]);
  // kalender tak mengikuti libur nasional/cuti bersama → tidak ada catatan
  assert.deepEqual(lay([mk(1, {}, sch("2031-03-03", 1))], { cal: C.compile({ national: false, cutiBersama: false }) }).missingYears, []);
});

// Muat salinan baru layout.js dengan TLCal "sama" tetapi compile dibungkus mata-mata (TLCal asli beku, tak bisa ditimpa).
function loadWithCompileSpy() {
  const src = fs.readFileSync(path.join(dir, "layout.js"), "utf8");
  const calls = [];
  const spyCal = { ...C, compile: (...a) => (calls.push(a), C.compile(...a)) };
  const mod = new Function("TLCal", "TLSched", "TLHolidays", src + "\nreturn TLLayout;")(spyCal, S, require(path.join(dir, "holidays-id.js")));
  return { mod, calls };
}

test("kalender mentah diterima; compile tepat satu kali per layout (mata-mata), nol kali bila sudah terkompilasi", () => {
  const raw = { v: 1, weekdays: [1, 2, 3, 4, 5, 6], national: false, cutiBersama: false, off: [], work: [] };
  const r = lay([mk(1, {}, sch("2026-11-06", 2))], { cal: raw }); // Jum 6 + Sab 7 (hari kerja)
  assert.equal(I(r.rows[0].span.f), "2026-11-07");
  const tasks = Array.from({ length: 50 }, (_, i) => mk(i + 1, i ? { parent_id: 1 } : {}, sch("2026-11-02", 3, i ? [{ t: { $task: i }, type: "FS", lag: 0 }] : undefined)));
  const { mod, calls } = loadWithCompileSpy();
  const args = { tasks, pageKind: "project", sort: "wbs", today: TODAY, readSchedOf, zoom: "week" };
  mod.layout({ ...args, cal: raw });
  assert.equal(calls.length, 1, "satu compile untuk 50 task dan 49 dependensi");
  mod.layout({ ...args, cal: undefined });
  assert.equal(calls.length, 2, "tanpa kalender → bawaan, satu compile");
  mod.layout({ ...args, cal: std() });
  assert.equal(calls.length, 2, "kalender terkompilasi dipakai apa adanya");
});

test("layout mengembalikan kalender terkompilasi (cal) dan mengenali kalender terkompilasi lewat duck typing", () => {
  const c = std();
  assert.equal(lay([], { cal: c }).cal, c, "objek yang sama dikembalikan");
  const fromRaw = lay([], { cal: { weekdays: [1, 2, 3] } }).cal;
  assert.ok(typeof fromRaw.key === "string" && typeof fromRaw.mask.has === "function");
  assert.equal([1, 2, 3, 4, 5].filter((w) => fromRaw.mask.has(w)).length, 3);
  // objek mirip-terkompilasi tanpa Set sungguhan (mask/off/work hanya punya has)
  const duck = { key: "bebek", national: false, cutiBersama: false, mask: { has: (w) => w === 1 || w === 2 }, off: { has: () => false }, work: { has: () => false } };
  const { mod, calls } = loadWithCompileSpy();
  const r = mod.layout({ tasks: [mk(1, {}, sch("2026-11-02", 2)), mk(2, {}, sch("2026-11-02", 3))], pageKind: "project", sort: "wbs", cal: duck, today: TODAY, readSchedOf, zoom: "week" });
  assert.equal(calls.length, 0, "tidak dikompilasi ulang");
  assert.equal(r.cal, duck);
  assert.equal(I(r.rows[0].span.f), "2026-11-03", "Sen + Sel saja hari kerja");
  assert.equal(I(r.rows[1].span.f), "2026-11-09", "Sen 2, Sel 3, Sen 9");
});

test("rentang dibatasi hari ini ± 1830 hari: tanggal tenggat/mulai tahun 9999 dan 2062 tidak melebarkan grafik (deviasi R22)", () => {
  const t0 = D(TODAY);
  const tasks = [mk(1, {}, sch("2026-11-05", 2)), mk(2, { deadline: "9999-12-31" }, sch("2026-11-09", 1)), mk(3, {}, sch("9999-01-04", 3)), mk(4, {}, sch("2062-03-02", 2)), mk(5, { deadline: "1900-01-01" }, sch("1900-01-01", 1)), mk(6, {}, sch("2027-02-01", 1, [{ t: { $task: 3 }, type: "FS", lag: 0 }]))];
  const r = lay(tasks, { pageKind: "workspace" });
  assert.ok(r.range.from >= t0 - 1830 - 14, "kiri ≤ jendela + 14");
  assert.ok(r.range.to <= t0 + 1830 + 30, "kanan ≤ jendela + 30");
  assert.ok(r.range.to - r.range.from + 1 <= 3661 + 44, "lebar ≤ 3661 + margin");
  assert.deepEqual(r.missingYears, [2021, 2022, 2023, 2024, 2028, 2029, 2030, 2031], "dihitung dari rentang terjepit; 2025–2027 punya data");
  assert.ok(r.missingYears.length <= 8);
  const row = (k) => r.rows.find((x) => x.key === k);
  // di luar rentang: baris tetap ada, span tetap di data, outOfRange true; tidak digambar sebagai ujung panah
  for (const k of ["3", "4", "5"]) {
    assert.ok(row(k), "baris " + k);
    assert.notEqual(row(k).span, null, "span tetap di data " + k);
    assert.equal(row(k).outOfRange, true, k);
  }
  assert.equal(I(row("3").span.s), "9999-01-04");
  for (const k of ["1", "2", "6"]) assert.equal(row(k).outOfRange, false, k);
  assert.equal(r.rows.find((x) => x.kind === "group").outOfRange, false);
  assert.equal(r.edges.find((e) => e.to === "6").drawn, false, "pendahulu di luar rentang → tidak digambar");
  assert.equal(r.stats.outOfRange, 3);
  assert.equal(row("2").deadlineDn, D("9999-12-31"), "tenggat apa adanya di data (dijepit hanya untuk rentang)");
  // rentang normal tidak berubah: dalam jendela → persis aturan R22
  const normal = lay([mk(1, {}, sch("2027-06-02", 1)), mk(2, {}, sch("2025-03-03", 1))]);
  assert.equal(normal.range.from, D("2025-03-03") - 14);
  assert.equal(normal.range.to, D("2027-06-02") + 30);
  assert.equal(normal.rows.every((x) => x.outOfRange === false), true);
  // bar yang melintasi tepi jendela tidak dianggap di luar rentang
  const edge = lay([mk(1, {}, sch(I(t0 + 1829), 5))]);
  assert.equal(edge.rows[0].outOfRange, false);
  assert.equal(lay([mk(1, {}, sch(I(t0 + 1840), 1))]).rows[0].outOfRange, true);
});

test("ringkasan dengan anak sangat jauh: durasi hari kerja dibatasi 3660 hari kalender; layout 500 task + tanggal 9999 ≤ 150 ms", () => {
  const sum = lay([mk(1, {}), mk(2, { parent_id: 1 }, sch("2026-11-02", 1)), mk(3, { parent_id: 1 }, sch("9999-01-04", 1))]);
  const s1 = sum.rows.find((x) => x.key === "1");
  assert.equal(s1.kind, "summary");
  assert.equal(I(s1.span.f), "9999-01-04", "span ringkasan apa adanya");
  assert.ok(s1.duration > 0 && s1.duration <= 3660 * (5 / 7) + 40, "terbatas ±3660 hari: " + s1.duration);
  assert.equal(s1.outOfRange, false);
  const tasks = [];
  for (let i = 1; i <= 500; i++) {
    const far = i % 50 === 0;
    tasks.push(mk(i, { project_id: 1 + (i % 12), project: "P" + (i % 12), deadline: i % 7 === 0 ? "9999-12-31" : null, parent_id: i % 10 === 0 && i > 10 ? i - 10 : undefined }, sch(far ? "9999-01-04" : I(D("2026-01-01") + ((i * 7) % 360)), 1 + (i % 9), i > 1 && i <= 401 ? [{ t: { $task: i - 1 }, type: "FS", lag: 1 }] : undefined)));
  }
  const times = [];
  let res;
  for (let k = 0; k < 5; k++) {
    const t0 = process.hrtime.bigint();
    res = lay(tasks, { pageKind: "workspace", zoom: "day" });
    times.push(Number(process.hrtime.bigint() - t0) / 1e6);
  }
  times.sort((a, b) => a - b);
  console.log("timeline layout dengan tanggal 9999 median: " + times[2].toFixed(1) + " ms");
  assert.ok(res.range.to - res.range.from <= 3661 + 44);
  assert.ok(res.missingYears.length <= 8);
  assert.ok(times[2] <= 150, "median " + times[2]);
});

test("windowDays: viewW/scrollLeft tidak sah tidak menghasilkan NaN", () => {
  const range = { from: 1000, to: 1400 };
  for (const [sl, vw] of [[600, undefined], [undefined, undefined], [NaN, NaN], [undefined, 600], [600, -5]]) {
    const w = L.windowDays(range, 12, sl, vw);
    assert.ok(Number.isInteger(w.fromDn) && Number.isInteger(w.toDn), JSON.stringify([sl, vw]));
    assert.ok(w.fromDn >= 1000 && w.toDn <= 1400 && w.fromDn <= w.toDn);
  }
  assert.deepEqual(L.windowDays(range, 12, 600, undefined), { fromDn: 1050, toDn: 1050 }, "layar 0 → satu kolom di scrollLeft");
});

test("ringkasan 0 hari kerja bukan milestone: barBox/ariaBar memutuskan lewat kind lebih dulu; bar dipangkas ke rentang", () => {
  // anak milestone di Sabtu → ringkasan s = f = Sab 7 Nov, 0 hari kerja; ext milik ringkasan juga durasi 0
  const r = lay([mk(1, {}, sch("2026-11-02", 0)), mk(2, { parent_id: 1 }, sch("2026-11-07", 0))]);
  const row = r.rows[0];
  assert.equal(row.kind, "summary");
  assert.equal(row.duration, 0);
  assert.equal(row.sched.duration, 0, "ext induk durasi 0 tetap tersimpan");
  const range = { from: row.span.s - 10, to: row.span.s + 10 };
  assert.deepEqual(L.barBox(row.span, row.sched, range, 12, "summary"), { x: 120, w: 12, milestone: false });
  assert.deepEqual(L.barBox(row.span, row.sched, range, 12), { x: 126, w: 0, milestone: true }, "tanpa kind: perilaku lama");
  assert.deepEqual(L.barBox(row.span, row.sched, range, 12, "task"), { x: 126, w: 0, milestone: true });
  assert.equal(L.ariaBar(row.task, { duration: row.duration }, row.span, 0, "summary"), "T1, Sab 7 Nov sampai Sab 7 Nov, 0 hari kerja, 0%");
  assert.equal(L.ariaBar(row.task, { duration: 0 }, row.span, 0), "T1, milestone Sab 7 Nov");
  // pemangkasan ke rentang: bar melewati tepi kiri/kanan; seluruhnya di luar → null
  const rg = { from: 100, to: 130 };
  assert.deepEqual(L.barBox({ s: 90, f: 105 }, { duration: 5 }, rg, 12), { x: 0, w: 72, milestone: false });
  assert.deepEqual(L.barBox({ s: 125, f: 9999 }, { duration: 5 }, rg, 12), { x: 300, w: 72, milestone: false });
  assert.equal(L.barBox({ s: 131, f: 140 }, { duration: 5 }, rg, 12), null);
  assert.equal(L.barBox({ s: 50, f: 60 }, { duration: 0 }, rg, 12), null);
});

test("baris: span/sched/late/violation, bendera tenggat, task tanpa jadwal tetap berbaris (R16, R21)", () => {
  const tasks = [
    mk(1, { deadline: "2026-11-06" }, sch("2026-11-05", 4)), // selesai Sel 10 → 2 hk setelah tenggat Jum 6 (Sen 9, Sel 10)
    mk(2, { deadline: "2026-11-10" }, sch("2026-11-05", 4)), // tepat tenggat → tidak telat
    mk(3, { deadline: "2026-11-20" }), // tanpa jadwal, tenggat tetap tersedia
    mk(4, {}),
  ];
  const r = lay(tasks);
  const row = (k) => r.rows.find((x) => x.key === k);
  assert.equal(row("1").late, 2);
  assert.equal(row("2").late, 0);
  assert.equal(row("3").late, 0);
  assert.equal(row("3").span, null);
  assert.equal(I(row("3").deadlineDn), "2026-11-20");
  assert.equal(row("4").deadlineDn, null);
  assert.equal(row("4").sched.start, null);
  assert.equal(r.stats.late, 1);
  assert.equal(r.stats.unscheduled, 2);
  assert.equal(row("1").duration, 4);
  assert.equal(row("1").index, 0);
  assert.deepEqual(
    r.rows.map((x) => x.index),
    [0, 1, 2, 3],
  );
});

test("dependensi: edge kanonik String(id) dengan fromRow/toRow, drawn, pelanggaran merah; ref cid; ref hilang tidak digambar", () => {
  const tasks = [
    mk(1, {}, sch("2026-11-02", 2)), // Sen 2–Sel 3 → paling cepat penerus: Rab 4
    mk(2, {}, sch("2026-11-03", 1, [{ t: { $task: 1 }, type: "FS", lag: 0 }])), // mulai Sel 3 < Rab 4 → melanggar
    mk(3, {}, sch("2026-11-05", 1, [{ t: { $task: 1 }, type: "FS", lag: 0 }])), // Kam 5 ≥ Rab 4 → ok
    mk(4, {}, sch(undefined, undefined, [{ t: { $task: 1 }, type: "FS", lag: 0 }])), // penerus tanpa jadwal
    mk(5, {}, sch("2026-11-09", 1, [{ t: { $task: "c-7" }, type: "FS", lag: 1 }])), // ref cid → task 7
    mk(6, {}, sch("2026-11-09", 1, [{ t: { $task: 999 }, type: "FS", lag: 0 }])), // ref hilang
    mk(7, { cid: "c-7" }, sch("2026-11-02", 1)),
  ];
  const r = lay(tasks);
  const e = (from, to) => r.edges.find((x) => x.from === from && x.to === to);
  assert.equal(e("1", "2").violation, true);
  assert.equal(e("1", "2").drawn, true);
  assert.equal(e("1", "3").violation, false);
  assert.equal(e("1", "3").drawn, true);
  assert.equal(e("1", "4").drawn, false, "penerus tanpa jadwal: tersimpan, tidak digambar");
  assert.equal(e("1", "4").violation, false);
  assert.equal(e("7", "5").ok, true, "ref cid → String(id) kanonik");
  assert.equal(e("7", "5").drawn, true);
  assert.equal(e("999", "6").ok, false);
  assert.equal(e("999", "6").drawn, false);
  assert.equal(e("999", "6").fromRow, null);
  assert.equal(e("1", "2").fromRow, r.rows.find((x) => x.key === "1").index);
  assert.equal(e("1", "2").toRow, r.rows.find((x) => x.key === "2").index);
  assert.equal(r.rows.find((x) => x.key === "2").violation, true);
  assert.equal(r.rows.find((x) => x.key === "3").violation, false);
  assert.equal(r.stats.violations, 1);
  assert.equal(r.stats.edges, 5);
});

test("dependensi ke/dari ringkasan dihitung memakai rentang ringkasan", () => {
  const tasks = [
    mk(1, {}), // ringkasan: anak 2 (Sen 2) dan 3 (Kam 5–Jum 6) → rentang Sen 2–Jum 6
    mk(2, { parent_id: 1 }, sch("2026-11-02", 1)),
    mk(3, { parent_id: 1 }, sch("2026-11-05", 2)),
    mk(4, {}, sch("2026-11-05", 1, [{ t: { $task: 1 }, type: "FS", lag: 0 }])), // paling cepat Sen 9 → melanggar
    mk(5, {}, sch("2026-11-09", 1, [{ t: { $task: 1 }, type: "FS", lag: 0 }])), // Sen 9 → ok
  ];
  const r = lay(tasks);
  assert.equal(r.edges.find((x) => x.to === "4").violation, true);
  assert.equal(r.edges.find((x) => x.to === "5").violation, false);
  assert.equal(r.edges.find((x) => x.to === "4").drawn, true);
});

test("TL_CAL_LOOP: kalender buntu tidak membuat layout melempar; task tanpa bar", () => {
  const off = new Set();
  for (let d = D("2026-01-01"); d <= D("2070-01-01"); d++) off.add(d);
  const dead = { mask: new Set([1]), off, work: new Set(), key: "mati", national: true, cutiBersama: true };
  let r;
  assert.doesNotThrow(() => {
    r = lay([mk(1, { deadline: "2026-11-10" }, sch("2026-11-02", 3)), mk(2, {}, sch("2026-11-02", 1, [{ t: { $task: 1 }, type: "FS", lag: 0 }]))], { cal: dead });
  });
  assert.equal(r.rows.length, 2);
  assert.equal(r.rows[0].span, null);
  assert.equal(r.rows[0].late, 0);
  assert.equal(r.edges[0].drawn, false);
  assert.equal(r.stats.violations, 0);
  assert.doesNotThrow(() => L.weekendGradient(dead, r.range, 12));
  assert.doesNotThrow(() => L.holidaySpans(dead, r.range.from, r.range.from + 30));
});

test("sched kustom: readSchedOf tidak diberikan → baca ext task 'timeline.*' bawaan", () => {
  const r = L.layout({ tasks: [mk(1, {}, sch("2026-11-05", 4))], pageKind: "project", sort: "wbs", cal: std(), today: TODAY, zoom: "week" });
  assert.equal(I(r.rows[0].span.f), "2026-11-10");
  const iso = L.layout({ tasks: [], pageKind: "project", cal: std(), today: D(TODAY), zoom: "week" });
  assert.equal(iso.range.from, D(TODAY) - 60, "today sebagai dn atau ISO sama-sama diterima");
});

test("xOf/dnAt/widthOf/barBox: from = x 0; milestone titik di tengah hari", () => {
  const range = { from: 100, to: 130 };
  assert.equal(L.xOf(100, range, 12), 0);
  assert.equal(L.xOf(103, range, 12), 36);
  assert.equal(L.dnAt(0, range, 12), 100);
  assert.equal(L.dnAt(35, range, 12), 102);
  assert.equal(L.dnAt(36, range, 12), 103);
  assert.equal(L.dnAt(-1, range, 12), 99);
  assert.equal(L.widthOf(range, 12), 31 * 12);
  assert.deepEqual(L.barBox({ s: 103, f: 105 }, { duration: 3 }, range, 12), { x: 36, w: 36, milestone: false });
  assert.deepEqual(L.barBox({ s: 103, f: 103 }, { duration: 0 }, range, 12), { x: 42, w: 0, milestone: true });
  assert.equal(L.barBox(null, null, range, 12), null);
});

test("windowRows: buffer 10 di kedua sisi, dijepit ke [0, n − 1]", () => {
  const rows = new Array(200).fill(0);
  // tampak baris 50–59 (scrollTop 1600, tinggi 320, baris 32)
  assert.deepEqual(L.windowRows(rows, 1600, 320, 32), { first: 40, last: 69 });
  assert.deepEqual(L.windowRows(rows, 1600, 320, 32, 0), { first: 50, last: 59 });
  assert.deepEqual(L.windowRows(rows, 0, 320, 32), { first: 0, last: 19 }, "dijepit di atas");
  assert.deepEqual(L.windowRows(rows, 200 * 32, 320, 32), { first: 190, last: 199 }, "dijepit di bawah");
  assert.deepEqual(L.windowRows(new Array(5).fill(0), 0, 320, 32), { first: 0, last: 4 });
  assert.deepEqual(L.windowRows([], 0, 320, 32), { first: 0, last: -1 });
  assert.deepEqual(L.windowRows(200, 1600, 320, 32), { first: 40, last: 69 }, "jumlah baris sebagai angka");
  assert.deepEqual(L.windowRows(rows, 1616, 320, 32, 2), { first: 48, last: 62 }, "baris sebagian tampak ikut dihitung");
});

test("windowDays: 1 layar kiri, 2 layar kanan (dari scrollLeft), dijepit ke rentang", () => {
  const range = { from: 1000, to: 1400 };
  const px = 12;
  // scrollLeft 1200 px, layar 600 px → x [600, 2400] → hari 1050 .. 1200
  assert.deepEqual(L.windowDays(range, px, 1200, 600), { fromDn: 1050, toDn: 1200 });
  assert.deepEqual(L.windowDays(range, px, 0, 600), { fromDn: 1000, toDn: 1100 }, "kiri dijepit ke awal rentang");
  assert.deepEqual(L.windowDays(range, px, 100000, 600), { fromDn: 1400, toDn: 1400 }, "jauh di kanan dijepit ke akhir");
  const w = L.windowDays(range, px, 4800, 600);
  assert.equal(w.toDn, 1400, "kanan dijepit");
  assert.equal(w.fromDn, 1000 + Math.floor(4200 / 12));
});

test("initialScrollLeft: hari ini di 1/3 lebar layar, dijepit", () => {
  const range = { from: D(TODAY) - 60, to: D(TODAY) + 60 };
  const px = 12;
  assert.equal(L.initialScrollLeft(range, px, TODAY, 600), 60 * 12 - 200);
  assert.equal(L.initialScrollLeft(range, px, D(TODAY), 600), 60 * 12 - 200);
  assert.equal(L.initialScrollLeft(range, px, D(TODAY), 100000), 0, "layar lebih lebar dari grafik");
  assert.equal(L.initialScrollLeft({ from: D(TODAY) - 2, to: D(TODAY) + 200 }, px, D(TODAY), 600), 0, "hari ini dekat awal → 0");
  assert.equal(L.initialScrollLeft({ from: D(TODAY) - 300, to: D(TODAY) }, px, D(TODAY), 600), 301 * 12 - 600, "dijepit ke gulir maksimum");
  assert.equal(L.initialScrollLeft(range, px, null, 600), 0);
});

test("headerTicks: day/week/month bentuk dan label ('Mg 45', 'Nov 2026', 'K4')", () => {
  const from = D("2026-10-28"); // Rabu
  const to = D("2026-11-10"); // Selasa
  const day = L.headerTicks("day", from, to);
  assert.equal(day.bottom.length, 14);
  assert.deepEqual(
    day.bottom.slice(0, 3).map((c) => [c.label, c.sub, c.days]),
    [
      ["28", "Rab", 1],
      ["29", "Kam", 1],
      ["30", "Jum", 1],
    ],
  );
  assert.equal(day.bottom[0].dn, from);
  assert.deepEqual(
    day.top.map((c) => [c.label, c.dn, c.days]),
    [
      ["Okt 2026", from, 4],
      ["Nov 2026", D("2026-11-01"), 10],
    ],
  );

  const week = L.headerTicks("week", from, to);
  assert.deepEqual(
    week.bottom.map((c) => [c.label, c.dn, c.days]),
    [
      ["Mg 44", from, 5], // Senin 26 Okt dijepit ke awal jendela: Rab 28–Min 1 Nov
      ["Mg 45", D("2026-11-02"), 7],
      ["Mg 46", D("2026-11-09"), 2],
    ],
  );
  assert.deepEqual(
    week.top.map((c) => c.label),
    ["Okt 2026", "Nov 2026"],
  );
  assert.equal(L.headerTicks("week", D("2026-11-02"), D("2026-11-02")).bottom[0].label, "Mg 45");
  // minggu ISO tahun baru: 2027-01-01 = 2026 W53
  assert.equal(L.headerTicks("week", D("2027-01-01"), D("2027-01-03")).bottom[0].label, "Mg 53");

  const month = L.headerTicks("month", D("2026-09-15"), D("2027-02-10"));
  assert.deepEqual(
    month.bottom.map((c) => c.label),
    ["Sep", "Okt", "Nov", "Des", "Jan", "Feb"],
  );
  assert.deepEqual(
    month.top.map((c) => [c.label, c.sub]),
    [
      ["K3", "2026"],
      ["K4", "2026"],
      ["K1", "2027"],
    ],
  );
  assert.equal(month.top[1].dn, D("2026-10-01"));
  assert.equal(month.top[1].days, 92);
  assert.equal(month.bottom[0].dn, D("2026-09-15"), "dijepit ke awal jendela");
  assert.equal(month.bottom[0].days, 16);
  // sel utuh tidak melebihi jendela dan menutupinya tanpa celah
  for (const z of ["day", "week", "month"]) {
    const h = L.headerTicks(z, from, to);
    for (const row of [h.top, h.bottom]) {
      assert.equal(row[0].dn, from);
      assert.equal(row[row.length - 1].dn + row[row.length - 1].days - 1, to);
      for (let i = 1; i < row.length; i++) assert.equal(row[i].dn, row[i - 1].dn + row[i - 1].days, z);
    }
  }
  // masukan tak sah → kosong
  assert.deepEqual(L.headerTicks("day", to, from), { top: [], bottom: [] });
  assert.deepEqual(L.headerTicks("day", NaN, to), { top: [], bottom: [] });
});

test("weekendGradient: periode 7 × px; pola Sen–Jum vs Sen–Sab berbeda; tanpa hex", () => {
  const range = { from: D("2026-11-02"), to: D("2026-12-31") }; // dimulai Senin
  const five = L.weekendGradient(C.compile({ weekdays: [1, 2, 3, 4, 5] }), range, 12);
  const six = L.weekendGradient(C.compile({ weekdays: [1, 2, 3, 4, 5, 6] }), range, 12);
  assert.notEqual(five, six);
  assert.equal(
    five,
    "repeating-linear-gradient(to right, transparent 0px, transparent 60px, var(--bg-subtle) 60px, var(--bg-subtle) 84px)",
    "Sen–Jum kerja (5 × 12 = 60 px), Sab–Min arsir; periode 84 px = 7 × 12",
  );
  assert.equal(six, "repeating-linear-gradient(to right, transparent 0px, transparent 72px, var(--bg-subtle) 72px, var(--bg-subtle) 84px)");
  for (const px of [4, 12, 28]) {
    const g = L.weekendGradient(std(), range, px);
    assert.ok(g.includes(7 * px + "px"), "periode " + 7 * px);
    assert.ok(g.startsWith("repeating-linear-gradient("));
    assert.doesNotMatch(g, /#|rgb|hsl/i);
    assert.deepEqual([...new Set(g.match(/var\([^)]*\)|transparent/g))].sort(), ["transparent", "var(--bg-subtle)"]);
  }
  // offset weekday hari pertama rentang: mulai Sabtu 7 Nov → arsir di awal periode
  const sat = L.weekendGradient(std(), { from: D("2026-11-07"), to: D("2026-12-31") }, 12);
  assert.equal(sat, "repeating-linear-gradient(to right, var(--bg-subtle) 0px, var(--bg-subtle) 24px, transparent 24px, transparent 84px)");
  // semua hari kerja → satu transparan; tanpa hari kerja sama sekali tidak mungkin (normalize memaksa bawaan)
  assert.equal(L.weekendGradient(C.compile({ weekdays: [1, 2, 3, 4, 5, 6, 7] }), range, 12), "repeating-linear-gradient(to right, transparent 0px, transparent 84px)");
  // Sen, Rab, Jum kerja: arsir tersebar dan tetap periodik
  const odd = L.weekendGradient(C.compile({ weekdays: [1, 3, 5] }), range, 10);
  assert.equal(odd.match(/var\(--bg-subtle\) \d+px/g).length, 6, "tiga pita arsir (Sel, Kam, Sab–Min) × 2 stop");
  assert.ok(odd.endsWith("70px)"));
});

test("holidaySpans: libur nasional, cuti bersama, libur kustom bernama; hari kerja pengganti menang; sakelar dihormati", () => {
  const c = C.compile({ off: [{ d: "2026-11-11", n: "Hari Kantor" }], work: [{ d: "2026-12-25", n: "Masuk" }] });
  const from = D("2026-11-01");
  const to = D("2026-12-31");
  const hs = L.holidaySpans(c, from, to);
  const byDate = Object.fromEntries(hs.map((h) => [I(h.dn), h]));
  assert.equal(byDate["2026-11-11"].name, "Hari Kantor");
  assert.equal(byDate["2026-11-11"].weekend, false);
  assert.ok(byDate["2026-12-24"], "cuti bersama 24 Des 2026");
  assert.equal(byDate["2026-12-25"], undefined, "diganti hari kerja pengganti");
  assert.ok(hs.every((h) => typeof h.name === "string" && h.name.length > 0));
  assert.deepEqual(
    hs.map((h) => h.dn),
    [...hs.map((h) => h.dn)].sort((a, b) => a - b),
  );
  const noCuti = L.holidaySpans(C.compile({ cutiBersama: false }), from, to);
  assert.equal(noCuti.find((h) => I(h.dn) === "2026-12-24"), undefined);
  assert.ok(noCuti.length > 0, "libur nasional tetap");
  assert.deepEqual(L.holidaySpans(C.compile({ national: false, cutiBersama: false }), from, to), []);
  assert.deepEqual(L.holidaySpans(c, to, from), []);
  // libur di akhir pekan ditandai weekend: 2026-08-17 Senin → bukan; 2026-03-21 Sabtu (Idul Fitri) → weekend true
  const w = L.holidaySpans(std(), D("2026-03-01"), D("2026-03-31")).filter((h) => h.weekend);
  assert.ok(w.every((h) => [6, 7].includes(C.isoWeekday(h.dn))));
});

test("arrowPath: penerus di kanan dan di kiri pendahulu → path valid berawal M dan hanya H/V", () => {
  const valid = /^M-?\d+(\.\d+)? -?\d+(\.\d+)?([HV]-?\d+(\.\d+)?)+$/;
  // penerus di kanan, baris di bawah
  const right = L.arrowPath({ x: 100, y: 10, w: 48, h: 12 }, { x: 200, y: 42, w: 36, h: 12 });
  assert.equal(right, "M148 16H154V48H200");
  // penerus di kiri pendahulu, baris di bawah: keluar 6 px, turun ke celah antarbaris, mundur, masuk dari kiri
  const left = L.arrowPath({ x: 100, y: 10, w: 48, h: 12 }, { x: 40, y: 42, w: 36, h: 12 });
  assert.equal(left, "M148 16H154V32H34V48H40");
  // penerus di kiri dan baris di atas
  const up = L.arrowPath({ x: 100, y: 42, w: 48, h: 12 }, { x: 40, y: 10, w: 36, h: 12 });
  assert.equal(up, "M148 48H154V32H34V16H40");
  // menempel/tumpang tindih (jarak < 12 px) → memutar; baris sama → lewat di bawah bar
  const tight = L.arrowPath({ x: 100, y: 10, w: 48, h: 12 }, { x: 152, y: 42, w: 36, h: 12 });
  assert.equal(tight, "M148 16H154V32H146V48H152");
  const same = L.arrowPath({ x: 100, y: 10, w: 48, h: 12 }, { x: 60, y: 10, w: 20, h: 12 });
  assert.equal(same, "M148 16H154V24H54V16H60");
  // milestone (lebar 0) sebagai ujung
  const ms = L.arrowPath({ x: 100, y: 10, w: 0, h: 12 }, { x: 140, y: 42, w: 0, h: 12 });
  assert.equal(ms, "M100 16H106V48H140");
  for (const p of [right, left, up, tight, same, ms]) {
    assert.match(p, valid, p);
    assert.ok(p.startsWith("M"));
    assert.doesNotMatch(p, /[^MHV\d.\- ]/, "hanya M, H, V");
  }
  // titik keluar selalu 6 px di kanan ujung pendahulu
  for (const p of [right, left, up, same]) assert.equal(+/H(\d+)/.exec(p)[1], 154);
});

// ── 1c-1 Task 7 (R19): panah per tipe dependensi ──────────────────────────────────────────────────────────
// Urai path "M x y H.. V.." → titik-titik sudut (hanya H/V; huruf lain = gagal urai).
function arrowPts(p) {
  const m = /^M(-?[\d.]+) (-?[\d.]+)((?:[HV]-?[\d.]+)+)$/.exec(p);
  assert.ok(m, "path tak terurai: " + p);
  const pts = [{ x: +m[1], y: +m[2] }];
  for (const s of m[3].match(/[HV]-?[\d.]+/g)) {
    const last = pts[pts.length - 1];
    pts.push(s[0] === "H" ? { x: +s.slice(1), y: last.y } : { x: last.x, y: +s.slice(1) });
  }
  return pts;
}

test("arrowPath FS identik dengan 1b untuk semua kasus lama; SS/FF/SF: titik awal dan akhir di sisi benar, hanya H/V, penerus di kiri/kanan", () => {
  const A = { x: 100, y: 10, w: 48, h: 12 };
  const A2 = { x: 100, y: 42, w: 48, h: 12 };
  const B = { x: 200, y: 42, w: 36, h: 12 }; // kanan, bawah
  const Bl = { x: 40, y: 42, w: 36, h: 12 }; // kiri, bawah
  const Bu = { x: 40, y: 10, w: 36, h: 12 }; // kiri, atas
  const Bt = { x: 152, y: 42, w: 36, h: 12 }; // menempel
  const Bs = { x: 60, y: 10, w: 20, h: 12 }; // baris sama
  const M1 = { x: 100, y: 10, w: 0, h: 12 };
  const M2 = { x: 140, y: 42, w: 0, h: 12 };
  // FS: string persis 1b — tanpa tipe, "FS", dan tipe tak dikenal semuanya sama
  const old = [
    [A, B, "M148 16H154V48H200"], [A, Bl, "M148 16H154V32H34V48H40"], [A2, Bu, "M148 48H154V32H34V16H40"],
    [A, Bt, "M148 16H154V32H146V48H152"], [A, Bs, "M148 16H154V24H54V16H60"], [M1, M2, "M100 16H106V48H140"],
  ];
  for (const [f, t, want] of old) {
    assert.equal(L.arrowPath(f, t), want);
    assert.equal(L.arrowPath(f, t, "FS"), want);
    assert.equal(L.arrowPath(f, t, "XX"), want, "tipe tak dikenal = FS");
  }
  // SS/FF/SF: beberapa string persis (mengunci geometri)
  assert.equal(L.arrowPath(A, B, "SS"), "M100 16H94V48H200");
  assert.equal(L.arrowPath(A, Bl, "SS"), "M100 16H34V48H40");
  assert.equal(L.arrowPath(A, B, "FF"), "M148 16H242V48H236");
  assert.equal(L.arrowPath(A, Bl, "FF"), "M148 16H154V48H76");
  assert.equal(L.arrowPath(A, Bl, "SF"), "M100 16H94V48H76");
  assert.equal(L.arrowPath(A, B, "SF"), "M100 16H94V32H242V48H236");
  // sisi: [awal pendahulu?, ujung penerus?]
  const SIDE = { FS: [false, false], SS: [true, false], FF: [false, true], SF: [true, true] };
  const cases = [[A, B], [A, Bl], [A2, Bu], [A, Bt], [A, Bs], [M1, M2], [A2, { x: 260, y: 10, w: 20, h: 12 }], [A, { x: 90, y: 74, w: 80, h: 12 }]];
  for (const type of ["FS", "SS", "FF", "SF"]) {
    const [fromStart, toEnd] = SIDE[type];
    for (const [f, t] of cases) {
      const p = L.arrowPath(f, t, type);
      const pts = arrowPts(p);
      const a = pts[0];
      const z = pts[pts.length - 1];
      const what = type + " " + p;
      // titik awal: sisi pendahulu (awal = x, ujung = x + w), tengah tinggi
      assert.equal(a.x, fromStart ? f.x : f.x + f.w, what);
      assert.equal(a.y, f.y + f.h / 2, what);
      // titik akhir: sisi penerus, tengah tinggi
      assert.equal(z.x, toEnd ? t.x + t.w : t.x, what);
      assert.equal(z.y, t.y + t.h / 2, what);
      // segmen bergantian H/V, tidak ada segmen nol kecuali V pada baris sama
      for (let i = 1; i < pts.length; i++) {
        const h = pts[i].y === pts[i - 1].y;
        const v = pts[i].x === pts[i - 1].x;
        assert.ok(h || v, "hanya H/V: " + what);
      }
      // keluar: kiri dari awal (SS/SF), kanan dari ujung (FS/FF), ≥ 6 px
      const out = pts[1].x - a.x;
      assert.ok(fromStart ? out <= -6 : out >= 6, "keluar " + what);
      // masuk: ke awal dari kiri (bergerak ke kanan), ke ujung dari kanan (bergerak ke kiri), ≥ 6 px
      const inn = z.x - pts[pts.length - 2].x;
      assert.ok(toEnd ? inn <= -6 : inn >= 6, "masuk " + what);
    }
  }
});

test("edges membawa type", () => {
  const tasks = [
    mk(1, {}, sch("2026-11-02", 2)),
    mk(2, {}, sch("2026-11-04", 2, [{ t: { $task: 1 }, type: "SS", lag: 0 }])),
    mk(3, {}, sch("2026-11-04", 2, [{ t: { $task: 1 }, type: "FF", lag: 1 }, { t: { $task: 2 }, type: "SF", lag: 0 }])),
    mk(4, {}, sch("2026-11-09", 1, [{ t: { $task: 3 }, lag: 0 }])),
  ];
  const res = lay(tasks);
  const got = res.edges.map((e) => e.from + ">" + e.to + ":" + e.type).sort();
  assert.deepEqual(got, ["1>2:SS", "1>3:FF", "2>3:SF", "3>4:FS"]);
});

test("wbsMap = nomor WBS layout", () => {
  const tasks = [
    mk(1, { project: "Beta", project_id: 2 }, sch("2026-11-02", 2)),
    mk(2, { project: "Alpha", project_id: 1 }),
    mk(3, { project: "Alpha", project_id: 1, parent_id: 2 }, sch("2026-11-05", 1)),
    mk(4, { project: "Alpha", project_id: 1, parent_id: 2 }, sch("2026-11-03", 1)),
    mk(5, { gtd_status: "archived" }),
  ];
  for (const pageKind of ["workspace", "project"]) {
    const res = lay(tasks, { pageKind });
    const want = new Map(res.rows.filter((r) => r.kind !== "group").map((r) => [r.key, r.wbs]));
    const got = L.wbsMap(tasks, pageKind, readSchedOf);
    assert.ok(got instanceof Map);
    assert.deepEqual([...got.entries()].sort(), [...want.entries()].sort(), pageKind);
    // urut tampilan "Mulai" tidak mengubah WBS
    const byStart = lay(tasks, { pageKind, sort: "start" });
    for (const r of byStart.rows) if (r.kind !== "group") assert.equal(got.get(r.key), r.wbs);
  }
  assert.equal(L.wbsMap(tasks, "workspace", readSchedOf).get("4"), "1.1.2");
  assert.equal(L.wbsMap(tasks, "project", readSchedOf).get("1"), "1");
  assert.equal(L.wbsMap(tasks, "project", readSchedOf).has("5"), false, "arsip dibuang");
  // tanpa readSchedOf: pembaca bawaan (ext timeline.*)
  assert.equal(L.wbsMap(tasks, "project").get("3"), "2.1");
});

test("ariaBar: 'Desain UI, Kam 5 Nov sampai Sel 10 Nov, 4 hari kerja, 60%'; milestone; belum dijadwalkan", () => {
  const c = std();
  const sched = S.readSched({ start: "2026-11-05", duration: 4 });
  const span = S.spanOf(c, sched);
  assert.equal(L.ariaBar({ title: "Desain UI" }, sched, span, 60), "Desain UI, Kam 5 Nov sampai Sel 10 Nov, 4 hari kerja, 60%");
  assert.equal(L.ariaBar({ title: "Desain UI" }, sched, span, 33.6), "Desain UI, Kam 5 Nov sampai Sel 10 Nov, 4 hari kerja, 34%");
  assert.equal(L.ariaBar({ title: "Desain UI" }, sched, span, 0), "Desain UI, Kam 5 Nov sampai Sel 10 Nov, 4 hari kerja, 0%");
  assert.equal(L.ariaBar({ title: "Desain UI" }, sched, span, 250), "Desain UI, Kam 5 Nov sampai Sel 10 Nov, 4 hari kerja, 100%");
  assert.equal(L.ariaBar({ title: "Desain UI" }, sched, span, null), "Desain UI, Kam 5 Nov sampai Sel 10 Nov, 4 hari kerja");
  const ms = S.readSched({ start: "2026-11-05", duration: 0 });
  assert.equal(L.ariaBar({ title: "Rilis" }, ms, S.spanOf(c, ms), 0), "Rilis, milestone Kam 5 Nov");
  assert.equal(L.ariaBar({ title: "Rencana" }, S.readSched({}), null, 20), "Rencana, belum dijadwalkan");
  assert.equal(L.ariaBar({ title: "  " }, S.readSched({}), null, 0), "Tanpa judul, belum dijadwalkan");
  assert.equal(L.ariaBar(null, null, null), "Tanpa judul, belum dijadwalkan");
  // ringkasan: durasi dari row.duration
  assert.equal(L.ariaBar({ title: "Fase 1" }, { duration: 9 }, { s: D("2026-11-03"), f: D("2026-11-13") }, 10), "Fase 1, Sel 3 Nov sampai Jum 13 Nov, 9 hari kerja, 10%");
});

test("kinerja: 500 task + 400 dep → median 5 putaran dicatat (console.log), asersi ≤ 150 ms (R24)", () => {
  const tasks = [];
  for (let i = 1; i <= 500; i++) {
    const day = 1 + ((i * 7) % 360);
    const startDn = D("2026-01-01") + day;
    const deps = [];
    if (i > 1 && i <= 401) deps.push({ t: { $task: i - 1 }, type: "FS", lag: i % 3 });
    tasks.push({
      id: i,
      title: "Task " + i,
      project_id: 1 + (i % 12),
      project: "Project " + (1 + (i % 12)),
      parent_id: i % 10 === 0 && i > 10 ? i - 10 : undefined,
      created_at: "2026-10-" + String(1 + (i % 28)).padStart(2, "0"),
      deadline: i % 4 === 0 ? I(startDn + 20) : null,
      progress: i % 100,
      ext: { "timeline.start": I(startDn), "timeline.duration": 1 + (i % 9), "timeline.deps": deps },
    });
  }
  const c = std();
  const times = [];
  let res;
  for (let k = 0; k < 5; k++) {
    const t0 = process.hrtime.bigint();
    res = L.layout({ tasks, pageKind: "workspace", sort: k % 2 ? "start" : "wbs", cal: c, today: TODAY, readSchedOf, zoom: "day" });
    times.push(Number(process.hrtime.bigint() - t0) / 1e6);
  }
  times.sort((a, b) => a - b);
  const median = times[2];
  console.log("timeline layout(500 task, 400 dep) median 5 putaran: " + median.toFixed(1) + " ms (semua: " + times.map((n) => n.toFixed(1)).join(", ") + ")");
  assert.equal(res.stats.tasks, 500);
  assert.equal(res.edges.length, 400);
  assert.ok(res.rows.length >= 500 + 12);
  assert.ok(median <= 150, "median " + median + " ms");
});

test("sumber layout.js: tanpa window/self/globalThis, pola R2, tanpa Date lokal, satu compile", () => {
  const src = fs.readFileSync(path.join(dir, "layout.js"), "utf8");
  assert.match(src, /const TLLayout = \(function/);
  assert.match(src, /typeof TLCal !== "undefined" \? TLCal : require\("\.\/calendar\.js"\)/);
  assert.match(src, /typeof TLSched !== "undefined" \? TLSched : require\("\.\/schedule\.js"\)/);
  assert.match(src, /module\.exports = TLLayout/);
  assert.doesNotMatch(src, /\bwindow\b|\bself\b|\bglobalThis\b/);
  assert.doesNotMatch(src, /new\s+Date|Date\.now|#[0-9a-fA-F]{3,8}\b|rgb\(|hsl\(/);
});

test("final: kelompok workspace memakai lipatan host — 'Proyek ' dan 'Proyek' terpisah, 'É'/'é' terpisah, 'A'/'a' satu kelompok", () => {
  const tasks = [
    mk(1, { project: "Proyek" }),
    mk(2, { project: "Proyek " }),
    mk(3, { project: "É" }),
    mk(4, { project: "é" }),
    mk(5, { project: "A" }),
    mk(6, { project: "a" }),
  ];
  const ws = lay(tasks, { pageKind: "workspace" });
  const groupOf = (id) => ws.rows.find((r) => r.key === String(id)).group;
  assert.notEqual(groupOf(1), groupOf(2));
  assert.notEqual(groupOf(3), groupOf(4));
  assert.equal(groupOf(5), groupOf(6));
  // nama ber-id: nama yang cocok menurut lipatan host ikut kelompok ber-id itu; yang hanya beda spasi tidak
  const ws2 = lay([mk(7, { project_id: 9, project: "Beta" }), mk(8, { project: "BETA" }), mk(10, { project: "Beta " })], { pageKind: "workspace" });
  const g2 = (id) => ws2.rows.find((r) => r.key === String(id)).group;
  assert.equal(g2(8), "p:9");
  assert.notEqual(g2(10), "p:9");
});

// Fix wave final 1c-1 (α1): violations memakai selesai pendahulu done yang SAMA dengan mesin (jkt(completed_at), ≥ Mulai).
test("α1: pendahulu selesai lebih awal → penerus di tanggal tulisan mesin TIDAK ⚠ (tanpa panah merah); bar tetap rentang tersimpan", () => {
  const M = require(path.join(dir, "cpm.js"));
  const pred = mk(1, { list_id: 7, project: "Alpha", gtd_status: "done", completed_at: "2026-11-03T03:00:00Z" }, sch("2026-11-02", 5)); // Sen 2–Jum 6, selesai Sel 3
  const succ0 = mk(2, { list_id: 7, project: "Alpha", gtd_status: "next" }, sch("2026-11-09", 1, [{ t: { $task: 1 }, type: "FS", lag: 0 }]));
  const units = new Map([[S.unitOf(succ0).recId, { auto: true }]]);
  const readExt = (t) => {
    const o = {};
    for (const k of Object.keys(t.ext || {})) if (k.indexOf("timeline.") === 0) o[k.slice(9)] = t.ext[k];
    return o;
  };
  const r0 = M.run({ tasks: [pred, succ0], cal: std(), units, readExt });
  const es = I(r0.nodes.get("2").es);
  assert.equal(es, "2026-11-04", "mesin: Rab 4 (setelah selesai nyata Sel 3)");
  // Terapkan menulis tanggal mesin → layout atas data tertulis
  const succ = mk(2, { list_id: 7, project: "Alpha", gtd_status: "next" }, sch(es, 1, [{ t: { $task: 1 }, type: "FS", lag: 0 }]));
  const r = lay([pred, succ]);
  const e = r.edges.find((x) => x.from === "1" && x.to === "2");
  assert.equal(e.violation, false, "tanpa panah merah putus-putus");
  assert.equal(r.rows.find((x) => x.key === "2").violation, false, "tanpa ⚠");
  assert.equal(r.stats.violations, 0);
  assert.deepEqual(r.rows.find((x) => x.key === "1").span, { s: D("2026-11-02"), f: D("2026-11-06") }, "bar = rentang tersimpan");
});

test("α1: penerus yang benar-benar lebih awal dari hari completed_at tetap ⚠ (selesai lebih awal maupun terlambat)", () => {
  const dep = [{ t: { $task: 1 }, type: "FS", lag: 0 }];
  const early = lay([
    mk(1, { gtd_status: "done", completed_at: "2026-11-03T03:00:00Z" }, sch("2026-11-02", 5)), // selesai Sel 3
    mk(2, {}, sch("2026-11-03", 1, dep)), // Sel 3 < Rab 4
  ]);
  assert.equal(early.rows.find((x) => x.key === "2").violation, true);
  assert.equal(early.edges.find((x) => x.to === "2").violation, true);
  const late = lay([
    mk(1, { gtd_status: "done", completed_at: "2026-11-05T03:00:00Z" }, sch("2026-11-02", 1)), // rentang Sen 2, selesai nyata Kam 5
    mk(2, {}, sch("2026-11-04", 1, dep)), // Rab 4 ≥ Sel 3 (rentang) tetapi < Jum 6 (selesai nyata)
  ]);
  assert.equal(late.rows.find((x) => x.key === "2").violation, true, "mesin: conflict; violations sama");
  const doneNoTs = lay([mk(1, { gtd_status: "done" }, sch("2026-11-02", 2)), mk(2, {}, sch("2026-11-03", 1, dep))]);
  assert.equal(doneNoTs.rows.find((x) => x.key === "2").violation, true, "done tanpa completed_at → fin (1b)");
});
