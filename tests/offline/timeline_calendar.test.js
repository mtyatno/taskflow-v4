// Plugin Timeline (Fase 1, PR 1b) — Task 2: aritmetika hari kerja murni (TLCal)
// (spec docs/superpowers/specs/2026-10-31-plugin-fase1-timeline-design.md §8.3; rencana R2, R3, R4, R6).
// Semua tanggal tetap; tidak ada tes yang bergantung pada "hari ini" (tanpa bom waktu CI).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const dir = path.join(__dirname, "../../static/plugins/timeline");
const file = path.join(dir, "calendar.js");
const C = require(file);

const D = (s) => C.dn(s);
const I = (n) => C.iso(n);
const cal = (over) => C.normalize(Object.assign({}, over));
const std = () => C.compile(C.DEFAULT_CAL); // Sen–Jum, libur nasional + cuti bersama ON

test("dn/iso pulang-pergi 1969-12-31, 1970-01-01, 2024-02-29, 2027-12-31; isoWeekday 1970-01-01 = 4, 2026-11-01 = 7, dn negatif aman", () => {
  assert.equal(D("1970-01-01"), 0);
  assert.equal(D("1969-12-31"), -1);
  for (const s of ["1969-12-31", "1970-01-01", "2024-02-29", "2027-12-31", "2026-11-01"]) {
    assert.equal(I(D(s)), s);
    assert.ok(Number.isInteger(D(s)));
  }
  assert.equal(D("2024-03-01") - D("2024-02-29"), 1);
  assert.equal(C.isoWeekday(D("1970-01-01")), 4);
  assert.equal(C.isoWeekday(D("2026-11-01")), 7);
  assert.equal(C.isoWeekday(D("2026-11-02")), 1);
  assert.equal(C.isoWeekday(-1), 3, "1969-12-31 = Rabu");
  assert.equal(C.isoWeekday(-7), 4, "1969-12-25 = Kamis");
  assert.equal(C.isoWeekday(-365 * 5), C.isoWeekday(-365 * 5 + 7));
});

test("dn tanggal tak sah → NaN; isIso menolak format/kalender salah", () => {
  for (const bad of ["2026-02-29", "2026-13-01", "2026-1-1", "20261101", "", null, undefined, 20261101, "2026-11-01T00:00", "abcd-ef-gh"]) {
    assert.ok(Number.isNaN(D(bad)), String(bad));
    assert.equal(C.isIso(bad), false, String(bad));
  }
  assert.equal(C.isIso("2024-02-29"), true);
  assert.equal(C.isIso("2026-11-01"), true);
});

test("normalize: weekdays kosong/asing → bawaan; boolean rusak → bawaan; off/work tanggal rusak/nama > 60 dibuang, dedup, urut, ≤ 366; kunci asing diabaikan", () => {
  assert.deepEqual(C.normalize(null), C.DEFAULT_CAL);
  assert.deepEqual(C.normalize("x"), C.DEFAULT_CAL);
  assert.deepEqual(C.normalize({}), C.DEFAULT_CAL);
  assert.deepEqual(C.DEFAULT_CAL, { v: 1, weekdays: [1, 2, 3, 4, 5], national: true, cutiBersama: true, off: [], work: [] });

  assert.deepEqual(C.normalize({ weekdays: [] }).weekdays, [1, 2, 3, 4, 5]);
  assert.deepEqual(C.normalize({ weekdays: "1" }).weekdays, [1, 2, 3, 4, 5]);
  assert.deepEqual(C.normalize({ weekdays: [0, 8, "2", null, 1.5] }).weekdays, [1, 2, 3, 4, 5]);
  assert.deepEqual(C.normalize({ weekdays: [6, 1, 1, 9, 3] }).weekdays, [1, 3, 6]);

  const b = C.normalize({ national: "ya", cutiBersama: 0 });
  assert.equal(b.national, true);
  assert.equal(b.cutiBersama, true);
  const f = C.normalize({ national: false, cutiBersama: false });
  assert.equal(f.national, false);
  assert.equal(f.cutiBersama, false);

  const long = "x".repeat(61);
  const ok60 = "y".repeat(60);
  const n = C.normalize({
    off: [
      { d: "2026-05-03", n: "b" },
      { d: "2026-02-30", n: "tanggal rusak" },
      { d: "2026-05-01", n: "a" },
      { d: "2026-05-03", n: "duplikat" },
      { d: "2026-05-04", n: long },
      { d: "2026-05-05", n: ok60 },
      { d: "2026-05-06", n: 5 },
      null,
      "2026-05-07",
      { n: "tanpa d" },
    ],
    work: [{ d: "2026-06-06", n: "Sabtu masuk" }, { d: "xx", n: "" }],
    asing: { a: 1 },
    v: 99,
  });
  assert.deepEqual(n.off.map((o) => o.d), ["2026-05-01", "2026-05-03", "2026-05-05"]);
  assert.equal(n.off[1].n, "b", "duplikat: yang pertama menang");
  assert.deepEqual(n.work, [{ d: "2026-06-06", n: "Sabtu masuk" }]);
  assert.equal(n.v, 1);
  assert.equal("asing" in n, false);
  assert.deepEqual(Object.keys(n).sort(), ["cutiBersama", "national", "off", "v", "weekdays", "work"]);

  // ≤ 366 setelah urut
  const many = [];
  for (let i = 0; i < 500; i++) many.push({ d: I(D("2026-01-01") + i), n: "h" });
  const capped = C.normalize({ off: many.slice().reverse() });
  assert.equal(capped.off.length, 366);
  assert.equal(capped.off[0].d, "2026-01-01");

  // idempoten dan tidak memutasi masukan / bawaan
  assert.deepEqual(C.normalize(n), n);
  assert.deepEqual(C.normalize({ off: [{ d: "2026-05-08" }] }).off, [{ d: "2026-05-08", n: "" }], "nama tidak ada = kosong, tanggal tetap libur");
  const before = JSON.stringify(C.DEFAULT_CAL);
  const c1 = C.normalize({});
  c1.weekdays.push(7);
  c1.off.push({ d: "2026-01-01", n: "" });
  assert.equal(JSON.stringify(C.DEFAULT_CAL), before);
});

test("Idulfitri 2026, cuti bersama ON: nextWork(2026-03-18) = 2026-03-25; finish(2026-03-17, 2) = 2026-03-25; cuti OFF: nextWork(2026-03-18) = 2026-03-18, nextWork(2026-03-19) = 2026-03-20", () => {
  const on = std();
  assert.equal(I(C.nextWork(on, D("2026-03-18"))), "2026-03-25");
  assert.equal(I(C.finish(on, D("2026-03-17"), 2)), "2026-03-25");
  const off = C.compile(cal({ cutiBersama: false }));
  assert.equal(I(C.nextWork(off, D("2026-03-18"))), "2026-03-18");
  assert.equal(I(C.nextWork(off, D("2026-03-19"))), "2026-03-20", "19 Nyepi tetap libur nasional");
  assert.equal(C.isWork(off, D("2026-03-20")), true);
  assert.equal(C.isWork(on, D("2026-03-20")), false);
});

test("national OFF + cutiBersama OFF: hanya akhir pekan", () => {
  const c = C.compile(cal({ national: false, cutiBersama: false }));
  assert.equal(C.isWork(c, D("2026-01-01")), true, "Tahun Baru jatuh Kamis → hari kerja biasa");
  assert.equal(C.isWork(c, D("2026-08-17")), true);
  assert.equal(C.isWork(c, D("2026-11-07")), false, "Sabtu");
  assert.equal(C.isWork(c, D("2026-11-08")), false, "Minggu");
  assert.equal(I(C.addWork(c, D("2026-12-23"), 1)), "2026-12-24");
  assert.equal(C.workdays(c, D("2026-12-21"), D("2026-12-27")), 5);
});

test("off tambahan di hari kerja dilewati; work pengganti di Sabtu dihitung; work menang atas libur", () => {
  const c = C.compile(cal({ off: [{ d: "2026-11-04", n: "Libur kantor" }], work: [{ d: "2026-11-07", n: "Sabtu masuk" }, { d: "2026-12-25", n: "Natal masuk" }] }));
  assert.equal(C.isWork(c, D("2026-11-04")), false);
  assert.equal(I(C.addWork(c, D("2026-11-03"), 1)), "2026-11-05");
  assert.equal(C.isWork(c, D("2026-11-07")), true);
  assert.equal(I(C.addWork(c, D("2026-11-06"), 1)), "2026-11-07");
  assert.equal(I(C.addWork(c, D("2026-11-07"), 1)), "2026-11-09", "Minggu dilewati");
  assert.equal(C.isWork(c, D("2026-12-25")), true, "work mengalahkan libur nasional");
  assert.equal(I(C.finish(c, D("2026-11-06"), 2)), "2026-11-07");
  assert.equal(C.workdays(c, D("2026-11-02"), D("2026-11-08")), 5, "5 hari kerja − 1 off + 1 Sabtu pengganti");
});

test("pola Sen–Sab (weekdays 1–6)", () => {
  const c = C.compile(cal({ weekdays: [1, 2, 3, 4, 5, 6], national: false, cutiBersama: false }));
  assert.equal(C.isWork(c, D("2026-11-07")), true);
  assert.equal(C.isWork(c, D("2026-11-08")), false);
  assert.equal(I(C.addWork(c, D("2026-11-06"), 2)), "2026-11-09", "Jum → Sab → Sen");
  assert.equal(I(C.nextWork(c, D("2026-11-08"))), "2026-11-09");
  assert.equal(I(C.prevWork(c, D("2026-11-08"))), "2026-11-07");
  assert.equal(C.workdays(c, D("2026-11-02"), D("2026-11-08")), 6);
});

test("akhir tahun: addWork(2026-12-23, 1) = 2026-12-28; pergantian tahun: addWork(2026-12-31, 1) = 2027-01-04; lintas 2027→2028 tanpa data 2028 = akhir pekan saja", () => {
  const c = std();
  assert.equal(I(C.addWork(c, D("2026-12-23"), 1)), "2026-12-28", "24 cuti, 25 libur, akhir pekan");
  assert.equal(I(C.addWork(c, D("2026-12-31"), 1)), "2027-01-04", "1 Jan libur, akhir pekan");
  assert.equal(I(C.addWork(c, D("2027-12-23"), 1)), "2027-12-27", "24 cuti 2027, 25-26 libur/Sabtu-Minggu... 27 Sen");
  assert.equal(C.isWork(c, D("2028-01-03")), true);
  assert.equal(C.isWork(c, D("2028-05-01")), true, "Hari Buruh 2028 tidak ada di data → hari kerja biasa");
  assert.equal(C.isWork(c, D("2028-01-01")), false, "Sabtu");
  assert.equal(I(C.addWork(c, D("2027-12-31"), 1)), "2028-01-03");
});

test("mundur: addWork k negatif dan prevWork melewati libur dan akhir pekan", () => {
  const c = std();
  assert.equal(I(C.addWork(c, D("2026-12-28"), -1)), "2026-12-23");
  assert.equal(I(C.addWork(c, D("2027-01-04"), -1)), "2026-12-31");
  assert.equal(I(C.prevWork(c, D("2026-12-27"))), "2026-12-23");
  assert.equal(I(C.prevWork(c, D("2026-11-05"))), "2026-11-05", "hari kerja → dirinya");
  assert.equal(C.addWork(c, D("2026-11-05"), 0), D("2026-11-05"));
  assert.equal(C.addWork(c, D("2026-11-08"), 0), D("2026-11-08"), "k = 0 tidak menggeser walau libur");
});

test("finish: dur 0 = start walau hari libur; dur 1 di hari libur = nextWork(start); dur ≥ 1 inklusif", () => {
  const c = std();
  assert.equal(I(C.finish(c, D("2026-12-25"), 0)), "2026-12-25");
  assert.equal(I(C.finish(c, D("2026-11-01"), 0)), "2026-11-01");
  assert.equal(I(C.finish(c, D("2026-12-25"), 1)), "2026-12-28");
  assert.equal(I(C.finish(c, D("2026-11-02"), 1)), "2026-11-02");
  assert.equal(I(C.finish(c, D("2026-11-02"), 5)), "2026-11-06");
  assert.equal(I(C.finish(c, D("2026-11-02"), 6)), "2026-11-09");
  assert.equal(I(C.finish(c, D("2026-11-06"), 2)), "2026-11-09");
  assert.equal(I(C.finish(c, D("2026-11-07"), 2)), "2026-11-10", "start Sabtu → mulai Senin");
  assert.equal(I(C.addWork(c, D("2026-11-02"), 1000)), I(C.finish(c, D("2026-11-02"), 1001)));
});

test("workdays inklusif, a > b → 0", () => {
  const c = std();
  assert.equal(C.workdays(c, D("2026-11-02"), D("2026-11-08")), 5);
  assert.equal(C.workdays(c, D("2026-11-02"), D("2026-11-02")), 1);
  assert.equal(C.workdays(c, D("2026-11-08"), D("2026-11-08")), 0);
  assert.equal(C.workdays(c, D("2026-11-09"), D("2026-11-02")), 0);
  assert.equal(C.workdays(c, D("2026-03-16"), D("2026-03-27")), 5, "16, 17, 25, 26, 27");
  assert.equal(C.workdays(c, NaN, 5), 0);
});

test("fsEarliest: lag 0 = hari kerja setelah selesai; lag 2; lag −1 (lead) melewati libur ke belakang; pendahulu milestone di Jumat → Senin", () => {
  const c = std();
  const thu = D("2026-11-05");
  assert.equal(I(C.fsEarliest(c, thu, 0)), "2026-11-06");
  assert.equal(I(C.fsEarliest(c, thu, 2)), "2026-11-10");
  assert.equal(I(C.fsEarliest(c, thu, -1)), "2026-11-05");
  assert.equal(I(C.fsEarliest(c, D("2026-11-06"), 0)), "2026-11-09", "selesai Jumat → Senin");
  // lead melewati cuti bersama + Nyepi + Idulfitri ke belakang
  assert.equal(I(C.fsEarliest(c, D("2026-03-25"), -2)), "2026-03-17");
  const off = C.compile(cal({ cutiBersama: false }));
  assert.equal(I(C.fsEarliest(off, D("2026-03-25"), -2)), "2026-03-24");
  // milestone (dur 0) di Jumat
  const mFri = C.finish(c, D("2026-11-06"), 0);
  assert.equal(I(C.fsEarliest(c, mFri, 0)), "2026-11-09");
  // milestone di hari libur: penerus = hari kerja pertama sesudahnya
  const mHol = C.finish(c, D("2026-12-25"), 0);
  assert.equal(I(C.fsEarliest(c, mHol, 0)), "2026-12-28");
  // lag tidak diberikan = 0
  assert.equal(I(C.fsEarliest(c, thu)), "2026-11-06");
});

test("batas iterasi 10000: kalender sintetis weekdays [1] + off = setiap Senin 2026–2070 → nextWork melempar Error TL_CAL_LOOP, bukan hang", () => {
  const off = new Set();
  for (let d = D("2026-01-05"); d <= D("2070-12-31"); d += 7) off.add(d);
  assert.equal(C.isoWeekday(D("2026-01-05")), 1);
  const synth = { mask: new Set([1]), off, work: new Set(), key: "sintetis" };
  assert.equal(C.MAX_ITER, 10000);
  assert.throws(() => C.nextWork(synth, D("2026-01-01")), (e) => e instanceof Error && e.message === "TL_CAL_LOOP");
  assert.throws(() => C.prevWork(synth, D("2070-12-31")), (e) => e.message === "TL_CAL_LOOP");
  assert.throws(() => C.addWork(synth, D("2026-01-01"), 1), (e) => e.message === "TL_CAL_LOOP");
  assert.throws(() => C.addWork(synth, D("2070-12-31"), -1), (e) => e.message === "TL_CAL_LOOP");
  // kalender normal: 1000 hari kerja masih di bawah batas
  assert.doesNotThrow(() => C.addWork(std(), D("2026-01-01"), 1000));
});

test("batas iterasi 10000 cukup untuk satu hari kerja per minggu: durasi 999 dan lag ±999 tidak melempar", () => {
  const one = C.compile(cal({ weekdays: [1] }));
  const start = D("2026-11-02"); // Senin
  const fin = C.finish(one, start, 999);
  assert.equal(C.isoWeekday(fin), 1);
  assert.ok(fin - start >= 998 * 7, "≈ 6986 hari kalender");
  assert.ok(fin - start < 10000);
  assert.doesNotThrow(() => C.fsEarliest(one, fin, 999));
  assert.doesNotThrow(() => C.addWork(one, fin, -999));
  assert.equal(C.addWork(one, fin, -998), start);
});

test("missingYears: rentang 2027-12-01..2028-02-01 → [2028]; national dan cutiBersama OFF → []", () => {
  const c = std();
  assert.deepEqual(C.missingYears(c, D("2027-12-01"), D("2028-02-01")), [2028]);
  assert.deepEqual(C.missingYears(c, D("2024-12-30"), D("2028-01-02")), [2024, 2028]);
  assert.deepEqual(C.missingYears(c, D("2026-01-01"), D("2026-12-31")), []);
  assert.deepEqual(C.missingYears(c, D("2028-02-01"), D("2027-12-01")), []);
  const none = C.compile(cal({ national: false, cutiBersama: false }));
  assert.deepEqual(C.missingYears(none, D("2027-12-01"), D("2028-02-01")), []);
  const onlyCuti = C.compile(cal({ national: false }));
  assert.deepEqual(C.missingYears(onlyCuti, D("2027-12-01"), D("2028-02-01")), [2028]);
  // data libur khusus (argumen keempat)
  const fake = { YEARS: [2028], has: (y) => y === 2028, forYear: () => [] };
  assert.deepEqual(C.missingYears(c, D("2027-12-01"), D("2028-02-01"), fake), [2027]);
});

test("compile: cache per isi kalender (objek sama), kunci stabil, ≤ 8 entri, holidays kustom", () => {
  const a = C.compile(C.DEFAULT_CAL);
  const b = C.compile(C.normalize({}));
  assert.equal(a, b);
  assert.equal(typeof a.key, "string");
  assert.deepEqual([...a.mask].sort(), [1, 2, 3, 4, 5]);
  assert.ok(a.off instanceof Set && a.work instanceof Set);
  assert.ok(a.off.has(D("2026-01-01")));
  assert.ok(a.off.has(D("2026-12-24")), "cuti bersama ikut");
  assert.notEqual(C.compile(cal({ cutiBersama: false })), a);
  assert.equal(C.compile(cal({ cutiBersama: false })).off.has(D("2026-12-24")), false);
  // > 8 kalender berbeda tidak merusak hasil
  for (let i = 0; i < 12; i++) C.compile(cal({ off: [{ d: I(D("2030-01-01") + i), n: "x" }] }));
  assert.equal(C.isWork(C.compile(C.DEFAULT_CAL), D("2026-11-02")), true);
  // holidays kustom tidak memakai cache kalender bawaan
  const custom = { YEARS: [2026], has: (y) => y === 2026, forYear: () => [["2026-11-03", "Uji", "libur"]] };
  const cc = C.compile(C.DEFAULT_CAL, custom);
  assert.equal(C.isWork(cc, D("2026-11-03")), false);
  assert.equal(C.isWork(cc, D("2026-01-01")), true);
  assert.equal(C.isWork(C.compile(C.DEFAULT_CAL), D("2026-11-03")), true);
  assert.equal(C.isWork(C.compile(C.DEFAULT_CAL), D("2026-01-01")), false);
});

test("compile menerima kalender mentah (dinormalisasi dulu)", () => {
  const c = C.compile({ weekdays: [], national: "x", off: [{ d: "bukan", n: "" }] });
  assert.deepEqual([...c.mask].sort(), [1, 2, 3, 4, 5]);
  assert.equal(c.off.has(D("2026-01-01")), true);
});

test("byteSize = byte UTF-8 JSON.stringify", () => {
  const samples = [C.DEFAULT_CAL, { a: "é😀 libur — Natal" }, cal({ off: [{ d: "2026-05-01", n: "Hari Buruh — 労働" }] })];
  for (const s of samples) assert.equal(C.byteSize(s), Buffer.byteLength(JSON.stringify(s), "utf8"));
  assert.ok(C.byteSize({ a: "é" }) > JSON.stringify({ a: "é" }).length);
});

test("fmtShort 2026-11-05 = 'Kam 5 Nov'; fmtLong; isoWeek 2026-11-02 = {2026, 45}", () => {
  assert.equal(C.fmtShort(D("2026-11-05")), "Kam 5 Nov");
  assert.equal(C.fmtShort(D("2026-03-01")), "Min 1 Mar");
  assert.equal(C.fmtShort(D("2026-08-17")), "Sen 17 Agu");
  assert.equal(C.fmtLong(D("2026-11-05")), "Kamis, 5 November 2026");
  assert.equal(C.fmtLong(D("2026-05-31")), "Minggu, 31 Mei 2026");
  assert.deepEqual({ ...C.isoWeek(D("2026-11-02")) }, { year: 2026, week: 45 });
  assert.deepEqual({ ...C.isoWeek(D("2026-11-08")) }, { year: 2026, week: 45 });
  assert.deepEqual({ ...C.isoWeek(D("2026-01-01")) }, { year: 2026, week: 1 });
  assert.deepEqual({ ...C.isoWeek(D("2027-01-01")) }, { year: 2026, week: 53 });
  assert.deepEqual({ ...C.isoWeek(D("2024-12-30")) }, { year: 2025, week: 1 });
  assert.deepEqual({ ...C.isoWeek(D("2021-01-03")) }, { year: 2020, week: 53 });
  const months = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
  months.forEach((m, i) => assert.ok(C.fmtShort(D(`2026-${String(i + 1).padStart(2, "0")}-10`)).endsWith(` 10 ${m}`)));
});

test("berkas: pola R2 (const TLCal IIFE, TLHolidays via typeof/require, tanpa global window/self, export Node, beku)", () => {
  const src = fs.readFileSync(file, "utf8");
  assert.match(src, /const TLCal = \(function/);
  assert.match(src, /typeof TLHolidays !== "undefined" \? TLHolidays : require\("\.\/holidays-id\.js"\)/);
  assert.match(src, /module\.exports = TLCal/);
  assert.doesNotMatch(src, /\bwindow\b|\bself\b|\bglobalThis\b/);
  assert.ok(Object.isFrozen(C));
});

test("sumber parts tanpa Date lokal (calendar/schedule/layout/drag.js hanya getUTC* dan Date.UTC)", () => {
  // Pola dirakit dari potongan agar sumber tes ini sendiri tidak cocok.
  const bad = new RegExp(
    ["Date" + "\\.now\\s*\\(", "new\\s+Date\\s*\\(\\s*\\)", "\\.get" + "Date\\s*\\(", "\\.get" + "Day\\s*\\(", "\\.get" + "Month\\s*\\(", "\\.get" + "FullYear\\s*\\(", "\\.get" + "Hours\\s*\\(", "\\.get" + "TimezoneOffset\\s*\\("].join("|"),
  );
  for (const f of ["calendar.js", "schedule.js", "layout.js", "drag.js"]) {
    const p = path.join(dir, f);
    if (!fs.existsSync(p)) continue; // schedule/layout/drag dibuat di Task 3–5; tes ini mengunci setiap berkas begitu ada
    assert.doesNotMatch(fs.readFileSync(p, "utf8"), bad, f);
  }
  assert.ok(fs.existsSync(file));
  assert.doesNotMatch(fs.readFileSync(__filename, "utf8"), bad, "timeline_calendar.test.js");
});
