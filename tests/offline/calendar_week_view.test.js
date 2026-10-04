"use strict";

// Kalender: tampilan Minggu (week view). Desktop = 7 kolom hari berjejer mendatar dengan task
// di bawah tiap hari; mobile = hari-hari berurutan ke bawah. Logika tanggal ada di helper murni
// level modul (blok "calWeek helpers") supaya bisa dites tanpa React.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const indexHtml = fs.readFileSync(path.resolve(__dirname, "../../static/index.html"), "utf8").replace(/\r\n/g, "\n");

function between(startMarker, endMarker) {
  const s = indexHtml.indexOf(startMarker);
  assert.ok(s >= 0, `${startMarker} must exist`);
  const e = indexHtml.indexOf(endMarker, s);
  assert.ok(e > s, `${endMarker} must exist`);
  return indexHtml.slice(s, e);
}

function loadHelpers() {
  const occ = between("function computeOccurrences(", "\n}\n") + "\n}\n";
  const helpers = between("// ── calWeek helpers", "// ── calWeek helpers end");
  // eslint-disable-next-line no-new-func
  return new Function(`${occ}\n${helpers}\nreturn { calDateKey, calAddDays, calWeekStart, calWeekKeys, calTasksByDate, calWeekLabel };`)();
}

const H = loadHelpers();
const cal = (() => {
  const s = indexHtml.indexOf("function CalendarView({");
  return indexHtml.slice(s, indexHtml.indexOf("\n}\n", s));
})();

test("calWeekStart: minggu dimulai Senin", () => {
  // 4 Okt 2026 = Minggu → Senin 28 Sep 2026
  assert.equal(H.calDateKey(H.calWeekStart(new Date(2026, 9, 4))), "2026-09-28");
  // Senin tetap Senin
  assert.equal(H.calDateKey(H.calWeekStart(new Date(2026, 9, 5))), "2026-10-05");
  // Rabu 7 Okt → 5 Okt
  assert.equal(H.calDateKey(H.calWeekStart(new Date(2026, 9, 7, 23, 30))), "2026-10-05");
});

test("calWeekKeys: 7 tanggal berurutan, melewati batas bulan & tahun", () => {
  assert.deepEqual(H.calWeekKeys(new Date(2026, 8, 28)), [
    "2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04",
  ]);
  const ny = H.calWeekKeys(H.calWeekStart(new Date(2027, 0, 1)));
  assert.equal(ny[0], "2026-12-28");
  assert.equal(ny[6], "2027-01-03");
});

test("calAddDays tidak mengubah tanggal asal", () => {
  const d = new Date(2026, 9, 5);
  const n = H.calAddDays(d, 7);
  assert.equal(H.calDateKey(n), "2026-10-12");
  assert.equal(H.calDateKey(d), "2026-10-05");
});

test("calTasksByDate: deadline dalam rentang + kejadian task berulang dengan status exception", () => {
  const tasks = [
    { id: 1, title: "A", deadline: "2026-09-30" },
    { id: 2, title: "B", deadline: "2026-10-04" },
    { id: 3, title: "di luar", deadline: "2026-10-05" },
    { id: 4, title: "tanpa deadline" },
    { id: 5, title: "harian", recurrence_type: "daily", recurrence_end_date: "2026-10-02", created_at: "2026-09-01T08:00:00" },
  ];
  const map = H.calTasksByDate(tasks, "2026-09-28", "2026-10-04", { "5": [{ occurrence_date: "2026-09-29", status: "done" }] });
  assert.deepEqual(Object.keys(map).sort(), ["2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02", "2026-10-04"]);
  assert.deepEqual(map["2026-09-30"].map(t => t.id), [1, 5]);
  assert.equal(map["2026-10-04"][0].title, "B");
  const occ = map["2026-09-29"][0];
  assert.equal(occ._isRecurring, true);
  assert.equal(occ._occurrenceDate, "2026-09-29");
  assert.equal(occ._occurrenceStatus, "done");
  assert.equal(map["2026-09-28"][0]._occurrenceStatus, null);
  assert.equal(map["2026-10-05"], undefined);
});

test("calWeekLabel: rentang tanggal Indonesia", () => {
  assert.equal(H.calWeekLabel(new Date(2026, 9, 5)), "5 – 11 Okt 2026");
  assert.equal(H.calWeekLabel(new Date(2026, 8, 28)), "28 Sep – 4 Okt 2026");
  assert.equal(H.calWeekLabel(new Date(2026, 11, 28)), "28 Des 2026 – 3 Jan 2027");
});

test("CalendarView: toggle Bulan/Minggu disimpan, navigasi & Today mengikuti mode", () => {
  assert.match(cal, /useState\(\(\) => \{[\s\S]{0,200}tf_cal_view/);
  assert.match(cal, /"Bulan"/);
  assert.match(cal, /"Minggu"/);
  assert.match(cal, /const prevMonth = \(\) => \{\s*if \(view === "week"\) return shiftWeek\(-7\);/);
  assert.match(cal, /const nextMonth = \(\) => \{\s*if \(view === "week"\) return shiftWeek\(7\);/);
  assert.match(cal, /const goToday = \(\) => \{[\s\S]{0,300}setWeekStart\(calWeekStart\(now\)\)/);
});

test("CalendarView: week view desktop 7 kolom, mobile berurutan ke bawah, + Task per hari", () => {
  assert.match(cal, /className: "cal-week cal-week--desktop"/);
  assert.match(cal, /gridTemplateColumns: "repeat\(7, minmax\(128px, 1fr\)\)"/);
  assert.match(cal, /className: "cal-week cal-week--mobile"/);
  assert.match(cal, /flexDirection: "column"/);
  assert.match(cal, /onClick: \(\) => onCreateOnDate\(key\)/);
});

test("Kalender: kartu task tanpa garis warna di tepi (preferensi desain user)", () => {
  assert.doesNotMatch(cal, /borderLeft: `3px solid/);
  assert.doesNotMatch(cal, /borderLeft:\s*`\d+px solid \$\{/);
});
