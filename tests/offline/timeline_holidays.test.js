// Plugin Timeline (Fase 1, PR 1b) — Task 1: tabel libur nasional + cuti bersama 2025–2027
// (spec docs/superpowers/specs/2026-10-31-plugin-fase1-timeline-design.md §8.4; rencana R25).
// Tes tidak bergantung pada tanggal hari ini (tanpa bom waktu CI).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const file = path.join(__dirname, "../../static/plugins/timeline/holidays-id.js");
const H = require(file);

const ISO = /^\d{4}-\d{2}-\d{2}$/;
function validIso(s) {
  if (!ISO.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10) === s;
}
// Hari dalam minggu ISO (1 = Senin … 7 = Minggu) murni dari Date.UTC.
function isoWeekday(s) {
  const [y, m, d] = s.split("-").map(Number);
  const w = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return w === 0 ? 7 : w;
}
const HARI = { Sen: 1, Sel: 2, Rab: 3, Kam: 4, Jum: 5, Sab: 6, Min: 7 };

test("YEARS = [2025, 2026, 2027]; has(): true untuk tahun yang ada, false untuk selainnya", () => {
  assert.deepEqual([...H.YEARS], [2025, 2026, 2027]);
  for (const y of H.YEARS) assert.equal(H.has(y), true);
  assert.equal(H.has(2024), false);
  assert.equal(H.has(2028), false);
  assert.equal(H.has("2026"), false);
  assert.equal(H.has(undefined), false);
});

test("bentuk: tiap tahun punya src tak kosong, libur/cuti array [iso, nama] dengan iso sah di tahun kuncinya, urut, tanpa duplikat, nama tak kosong", () => {
  assert.deepEqual(Object.keys(H.DATA).map(Number).sort(), [2025, 2026, 2027]);
  for (const y of H.YEARS) {
    const e = H.DATA[y];
    assert.equal(typeof e.src, "string");
    assert.ok(e.src.trim().length > 0, y + " src tak kosong");
    for (const key of ["libur", "cuti"]) {
      assert.ok(Array.isArray(e[key]) && e[key].length > 0, y + " " + key + " array");
      let prev = "";
      const seen = new Set();
      for (const row of e[key]) {
        assert.ok(Array.isArray(row) && row.length === 2, y + " " + key + " baris [iso, nama]");
        const [iso, nama] = row;
        assert.ok(validIso(iso), y + " " + key + " iso sah: " + iso);
        assert.ok(iso.startsWith(y + "-"), y + " " + key + " di tahun kuncinya: " + iso);
        assert.ok(typeof nama === "string" && nama.trim().length > 0, y + " " + key + " nama tak kosong: " + iso);
        assert.ok(iso > prev, y + " " + key + " urut menaik tanpa duplikat: " + iso);
        prev = iso;
        assert.ok(!seen.has(iso));
        seen.add(iso);
      }
    }
  }
});

test("data beku dalam (DATA tidak bisa diubah)", () => {
  assert.ok(Object.isFrozen(H.DATA));
  assert.ok(Object.isFrozen(H.DATA[2026]));
  assert.ok(Object.isFrozen(H.DATA[2026].libur));
  assert.ok(Object.isFrozen(H.DATA[2026].libur[0]));
  assert.ok(Object.isFrozen(H.DATA[2026].cuti));
  assert.ok(Object.isFrozen(H.YEARS));
});

test("jumlah: 2026 = 17 libur + 8 cuti; 2027 = 18 libur + 8 cuti; 2025 = angka yang tercatat di komentar src", () => {
  assert.equal(H.DATA[2026].libur.length, 17);
  assert.equal(H.DATA[2026].cuti.length, 8);
  assert.equal(H.DATA[2027].libur.length, 18);
  assert.equal(H.DATA[2027].cuti.length, 8);
  for (const y of H.YEARS) {
    const m = /(\d+) libur \+ (\d+) cuti/.exec(H.DATA[y].src);
    assert.ok(m, y + " src mencatat 'N libur + M cuti'");
    assert.equal(H.DATA[y].libur.length, Number(m[1]), y + " libur sama dengan catatan src");
    assert.equal(H.DATA[y].cuti.length, Number(m[2]), y + " cuti sama dengan catatan src");
  }
  // 2025: SKB awal 17 libur + 10 cuti, direvisi Agustus 2025 (+18 Agustus) menjadi 11 cuti.
  assert.equal(H.DATA[2025].libur.length, 17);
  assert.equal(H.DATA[2025].cuti.length, 11);
});

test("tanggal kunci 2026: 2026-03-19 Nyepi libur; 2026-03-18, -20, -23, -24 cuti; 2026-12-24 cuti; 2026-12-25 libur", () => {
  assert.deepEqual(H.lookup("2026-03-19"), { nama: "Hari Suci Nyepi (Tahun Baru Saka 1948)", kind: "libur" });
  for (const d of ["2026-03-18", "2026-03-20", "2026-03-23", "2026-03-24", "2026-12-24"]) {
    assert.equal(H.lookup(d).kind, "cuti", d);
  }
  assert.equal(H.lookup("2026-12-25").kind, "libur");
  assert.equal(H.lookup("2026-03-21").kind, "libur");
  assert.equal(H.lookup("2026-03-22").kind, "libur");
  assert.equal(H.lookup("2026-02-16").kind, "cuti");
  assert.equal(H.lookup("2026-02-17").kind, "libur");
});

test("2027: 2027-01-05 dan 2027-12-26 Isra Mikraj (dua kali); 2027-03-10/11 Idulfitri libur; 2027-03-09/12/15 cuti", () => {
  for (const d of ["2027-01-05", "2027-12-26"]) {
    const r = H.lookup(d);
    assert.equal(r.kind, "libur", d);
    assert.match(r.nama, /^Isra Mikraj/, d);
  }
  for (const d of ["2027-03-10", "2027-03-11"]) {
    const r = H.lookup(d);
    assert.equal(r.kind, "libur", d);
    assert.match(r.nama, /Idulfitri/, d);
  }
  for (const d of ["2027-03-09", "2027-03-12", "2027-03-15"]) {
    assert.equal(H.lookup(d).kind, "cuti", d);
  }
});

test("2025: 2025-08-18 cuti bersama (revisi)", () => {
  assert.equal(H.lookup("2025-08-18").kind, "cuti");
  assert.equal(H.lookup("2025-08-17").kind, "libur");
  assert.match(H.DATA[2025].src, /933/, "src menyebut keputusan revisi");
  assert.match(H.DATA[2025].src, /1017/, "src menyebut keputusan awal");
  // Idulfitri 2025: libur 31 Mar–1 Apr, cuti 2, 3, 4, 7 Apr.
  assert.equal(H.lookup("2025-03-31").kind, "libur");
  assert.equal(H.lookup("2025-04-01").kind, "libur");
  for (const d of ["2025-04-02", "2025-04-03", "2025-04-04", "2025-04-07"]) assert.equal(H.lookup(d).kind, "cuti", d);
});

test("hari dalam minggu sesuai SKB (menangkap salah ketik tanggal)", () => {
  const w = (iso, hari) => assert.equal(isoWeekday(iso), HARI[hari], iso + " seharusnya " + hari);
  // 2026 — hari tertulis di halaman setneg.go.id
  w("2026-01-01", "Kam"); w("2026-01-16", "Jum"); w("2026-02-17", "Sel"); w("2026-03-19", "Kam");
  w("2026-03-21", "Sab"); w("2026-03-22", "Min"); w("2026-04-03", "Jum"); w("2026-04-05", "Min");
  w("2026-05-01", "Jum"); w("2026-05-14", "Kam"); w("2026-05-27", "Rab"); w("2026-05-31", "Min");
  w("2026-06-01", "Sen"); w("2026-06-16", "Sel"); w("2026-08-17", "Sen"); w("2026-08-25", "Sel");
  w("2026-12-25", "Jum");
  w("2026-02-16", "Sen"); w("2026-03-18", "Rab"); w("2026-03-20", "Jum"); w("2026-03-23", "Sen");
  w("2026-03-24", "Sel"); w("2026-05-15", "Jum"); w("2026-05-28", "Kam"); w("2026-12-24", "Kam");
  // 2027
  w("2027-01-01", "Jum"); w("2027-01-05", "Sel"); w("2027-02-06", "Sab"); w("2027-03-08", "Sen");
  w("2027-03-10", "Rab"); w("2027-03-11", "Kam"); w("2027-03-26", "Jum"); w("2027-03-28", "Min");
  w("2027-05-01", "Sab"); w("2027-05-06", "Kam"); w("2027-05-17", "Sen"); w("2027-05-20", "Kam");
  w("2027-06-01", "Sel"); w("2027-06-06", "Min"); w("2027-08-15", "Min"); w("2027-08-17", "Sel");
  w("2027-12-25", "Sab"); w("2027-12-26", "Min");
  w("2027-02-05", "Jum"); w("2027-03-09", "Sel"); w("2027-03-12", "Jum"); w("2027-03-15", "Sen");
  w("2027-03-25", "Kam"); w("2027-05-18", "Sel"); w("2027-05-19", "Rab"); w("2027-12-24", "Jum");
  // 2025 — hari tertulis di setkab.go.id / kemenkopmk.go.id
  w("2025-01-01", "Rab"); w("2025-01-27", "Sen"); w("2025-01-29", "Rab"); w("2025-03-29", "Sab");
  w("2025-03-31", "Sen"); w("2025-04-01", "Sel"); w("2025-04-18", "Jum"); w("2025-04-20", "Min");
  w("2025-05-01", "Kam"); w("2025-05-12", "Sen"); w("2025-05-29", "Kam"); w("2025-06-01", "Min");
  w("2025-06-06", "Jum"); w("2025-06-27", "Jum"); w("2025-08-17", "Min"); w("2025-09-05", "Jum");
  w("2025-12-25", "Kam");
  w("2025-01-28", "Sel"); w("2025-03-28", "Jum"); w("2025-04-02", "Rab"); w("2025-04-03", "Kam");
  w("2025-04-04", "Jum"); w("2025-04-07", "Sen"); w("2025-05-13", "Sel"); w("2025-05-30", "Jum");
  w("2025-06-09", "Sen"); w("2025-08-18", "Sen"); w("2025-12-26", "Jum");
});

test("tidak ada tanggal yang sekaligus libur dan cuti", () => {
  for (const y of H.YEARS) {
    const libur = new Set(H.DATA[y].libur.map((r) => r[0]));
    for (const [iso] of H.DATA[y].cuti) assert.ok(!libur.has(iso), "libur dan cuti sekaligus: " + iso);
  }
});

test("forYear menyaring sesuai sakelar, urut tanggal, bentuk [iso, nama, kind]", () => {
  const all = H.forYear(2026, { national: true, cutiBersama: true });
  assert.equal(all.length, 25);
  assert.deepEqual(all.map((r) => r[0]), all.map((r) => r[0]).slice().sort());
  assert.ok(all.every((r) => r.length === 3 && (r[2] === "libur" || r[2] === "cuti")));
  assert.deepEqual(H.forYear(2026), all, "tanpa opsi = semua");
  const nat = H.forYear(2026, { national: true, cutiBersama: false });
  assert.equal(nat.length, 17);
  assert.ok(nat.every((r) => r[2] === "libur"));
  const cuti = H.forYear(2026, { national: false, cutiBersama: true });
  assert.equal(cuti.length, 8);
  assert.ok(cuti.every((r) => r[2] === "cuti"));
  assert.deepEqual(H.forYear(2026, { national: false, cutiBersama: false }), []);
  assert.equal(H.forYear(2027, {}).length, 26);
  assert.deepEqual(H.forYear(2028, { national: true, cutiBersama: true }), []);
  // hasil adalah salinan: mengubahnya tidak merusak DATA
  all.length = 0;
  assert.equal(H.forYear(2026).length, 25);
});

test("lookup: tanggal bukan libur / tak sah / tahun tanpa data → null", () => {
  assert.equal(H.lookup("2026-01-02"), null);
  assert.equal(H.lookup("2028-01-01"), null);
  assert.equal(H.lookup("bukan-tanggal"), null);
  assert.equal(H.lookup(null), null);
  assert.equal(H.lookup(undefined), null);
  assert.deepEqual(H.lookup("2026-01-01"), { nama: "Tahun Baru 2026 Masehi", kind: "libur" });
});

test("has(2028) false", () => {
  assert.equal(H.has(2028), false);
});

test("tes tidak memakai Date.now/new Date() tanpa argumen (regex sumber tes dan berkas — tanpa bom waktu CI)", () => {
  // Pola dirakit dari potongan agar sumber tes ini sendiri tidak cocok.
  const bad = new RegExp("Date" + "\\.now\\s*\\(|new\\s+Date\\s*\\(\\s*\\)");
  assert.doesNotMatch(fs.readFileSync(file, "utf8"), bad, "holidays-id.js");
  // Judul tes ini (satu baris) menyebut pola itu secara harfiah; baris itu dikecualikan.
  const own = fs.readFileSync(__filename, "utf8").split("\n").filter((l) => !l.startsWith('test("tes tidak memakai')).join("\n");
  assert.doesNotMatch(own, bad, "timeline_holidays.test.js");
});

test("berkas: pola R2 (const TLHolidays IIFE, tanpa global window/self, export Node)", () => {
  const src = fs.readFileSync(file, "utf8");
  assert.match(src, /const TLHolidays = \(function/);
  assert.match(src, /module\.exports = TLHolidays/);
  assert.doesNotMatch(src, /\bwindow\b|\bself\b|\bglobalThis\b/);
});
