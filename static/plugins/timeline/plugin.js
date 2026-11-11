// generated from plugin.jsx — jangan edit
(function () {
"use strict";
const manifest = Object.freeze({"id":"timeline","name":"Timeline","description":"Gantt untuk project dan workspace: jadwal hari kerja, dependensi, milestone.","version":"1.4.0","minApi":1,"slots":["taskList.views","taskDetail.sections"],"permissions":["storage","task.ext","records"],"defaultEnabled":false,"contributes":{"taskList.views":[{"id":"gantt","label":"Timeline","icon":{"path":"M2 4h7M5 8h8M3 12h5"},"pages":["project","workspace"]}],"taskDetail.sections":[{"id":"schedule","label":"Jadwal","order":10}]},"taskExt":{"keys":["start","duration","deps","mode","constraint","actual"]},"records":{"calendar":{"conflict":"lww","maxBytes":16384},"project":{"conflict":"lww","maxBytes":1024},"baseline":{"conflict":"lww","maxBytes":65536},"resource":{"conflict":"lww","maxBytes":4096}},"builtin":true});
// part: holidays-id.js
// Plugin Timeline — TLHolidays: libur nasional + cuti bersama Indonesia 2025–2027 (spec §8.4, rencana R2/R25).
// Murni data + pembantu kecil; tanpa Date lokal, tanpa global. Ditranskripsi dari SKB 3 Menteri (Menag, Menaker,
// MenPANRB), bukan dari ringkasan berita, kecuali nomor SKB revisi 2025 (lihat catatan). Halaman yang dipakai (dibaca 2026-11-01):
//   2026: https://setneg.go.id/baca/index/inilah_skb_3_menteri_libur_nasional_dan_cuti_bersama_2026
//   2027: https://setneg.go.id/baca/index/inilah_skb_3_menteri_libur_nasional_dan_cuti_bersama_2027
//   2025 (SKB awal, 14 Okt 2024): https://kemenkopmk.go.id/node/5308 dan https://setkab.go.id/x7r8
//   2025 (revisi, 7 Agu 2025):    https://kemenkopmk.go.id/node/5781 (halaman resmi; nomor SKB hanya ada di lampiran PDF)
//                                 nomor revisi 933/1/3 Tahun 2025 dari hukumonline.com (kutipan SKB): berita, bukan sumber resmi
// Tahun yang tidak ada di tabel = hanya akhir pekan (UI memberi catatan "Libur nasional {tahun} belum ada").
// Perubahan isi = naik `version` plugin (hash baru → precache baru → entri whatsnew). Tambah tahun berikutnya
// begitu SKB terbit (checklist rilis frontend, .agents/PROTOCOL.md).
// Aturan R25: satu tanggal tidak boleh dua kali dalam satu daftar, dan tidak boleh muncul sebagai libur sekaligus cuti.
const TLHolidays = (function () {
  function deepFreeze(o) {
    if (o && typeof o === "object") {
      for (const k of Object.keys(o)) deepFreeze(o[k]);
      Object.freeze(o);
    }
    return o;
  }

  const DATA = deepFreeze({
    2025: {
      // 17 libur + 11 cuti: SKB awal 17 libur + 10 cuti, lalu 18 Agustus 2025 ditambahkan sebagai cuti bersama.
      src:
        "SKB 3 Menteri 14 Okt 2024 (Menag 1017/2024, Menaker 2/2024, MenPANRB 2/2024; semula 17 libur dan 10 cuti) " +
        "diubah SKB 7 Agu 2025 (Menag 933/2025, Menaker 1/2025, MenPANRB 3/2025; tambah cuti bersama 18 Agu 2025) = 17 libur + 11 cuti",
      libur: [
        ["2025-01-01", "Tahun Baru 2025 Masehi"],
        ["2025-01-27", "Isra Mikraj Nabi Muhammad SAW"],
        ["2025-01-29", "Tahun Baru Imlek 2576 Kongzili"],
        ["2025-03-29", "Hari Suci Nyepi (Tahun Baru Saka 1947)"],
        ["2025-03-31", "Idul Fitri 1446 Hijriah"],
        ["2025-04-01", "Idul Fitri 1446 Hijriah"],
        ["2025-04-18", "Wafat Yesus Kristus"],
        ["2025-04-20", "Kebangkitan Yesus Kristus (Paskah)"],
        ["2025-05-01", "Hari Buruh Internasional"],
        ["2025-05-12", "Hari Raya Waisak 2569 BE"],
        ["2025-05-29", "Kenaikan Yesus Kristus"],
        ["2025-06-01", "Hari Lahir Pancasila"],
        ["2025-06-06", "Idul Adha 1446 Hijriah"],
        ["2025-06-27", "1 Muharam Tahun Baru Islam 1447 Hijriah"],
        ["2025-08-17", "Proklamasi Kemerdekaan"],
        ["2025-09-05", "Maulid Nabi Muhammad SAW"],
        ["2025-12-25", "Kelahiran Yesus Kristus"],
      ],
      cuti: [
        ["2025-01-28", "Tahun Baru Imlek 2576 Kongzili"],
        ["2025-03-28", "Hari Suci Nyepi (Tahun Baru Saka 1947)"],
        ["2025-04-02", "Idul Fitri 1446 Hijriah"],
        ["2025-04-03", "Idul Fitri 1446 Hijriah"],
        ["2025-04-04", "Idul Fitri 1446 Hijriah"],
        ["2025-04-07", "Idul Fitri 1446 Hijriah"],
        ["2025-05-13", "Hari Raya Waisak 2569 BE"],
        ["2025-05-30", "Kenaikan Yesus Kristus"],
        ["2025-06-09", "Idul Adha 1446 Hijriah"],
        ["2025-08-18", "Peringatan HUT ke-80 Kemerdekaan RI"],
        ["2025-12-26", "Kelahiran Yesus Kristus"],
      ],
    },
    2026: {
      // 17 libur + 8 cuti.
      src:
        "SKB 3 Menteri 19 Sep 2025 (Menag 1497/2025, Menaker 2/2025, MenPANRB 5/2025) = 17 libur + 8 cuti",
      libur: [
        ["2026-01-01", "Tahun Baru 2026 Masehi"],
        ["2026-01-16", "Isra Mikraj Nabi Muhammad saw."],
        ["2026-02-17", "Tahun Baru Imlek 2577 Kongzili"],
        ["2026-03-19", "Hari Suci Nyepi (Tahun Baru Saka 1948)"],
        ["2026-03-21", "Idulfitri 1447 H"],
        ["2026-03-22", "Idulfitri 1447 H"],
        ["2026-04-03", "Wafat Yesus Kristus"],
        ["2026-04-05", "Kebangkitan Yesus Kristus (Paskah)"],
        ["2026-05-01", "Hari Buruh Internasional"],
        ["2026-05-14", "Kenaikan Yesus Kristus"],
        ["2026-05-27", "Iduladha 1447 H"],
        ["2026-05-31", "Hari Raya Waisak 2570 BE"],
        ["2026-06-01", "Hari Lahir Pancasila"],
        ["2026-06-16", "1 Muharam Tahun Baru Islam 1448 H"],
        ["2026-08-17", "Proklamasi Kemerdekaan"],
        ["2026-08-25", "Maulid Nabi Muhammad saw."],
        ["2026-12-25", "Kelahiran Yesus Kristus"],
      ],
      cuti: [
        ["2026-02-16", "Tahun Baru Imlek 2577 Kongzili"],
        ["2026-03-18", "Hari Suci Nyepi (Tahun Baru Saka 1948)"],
        ["2026-03-20", "Idulfitri 1447 H"],
        ["2026-03-23", "Idulfitri 1447 H"],
        ["2026-03-24", "Idulfitri 1447 H"],
        ["2026-05-15", "Kenaikan Yesus Kristus"],
        ["2026-05-28", "Iduladha 1447 H"],
        ["2026-12-24", "Kelahiran Yesus Kristus"],
      ],
    },
    2027: {
      // 18 libur + 8 cuti. Isra Mikraj dua kali (5 Jan dan 26 Des): dua kali jatuh dalam tahun Masehi 2027.
      src:
        "SKB 3 Menteri 15 Sep 2026 (Menag 1205/2026, Menaker 3/2026, MenPANRB 2/2026; urutan nomor per kementerian tidak dinyatakan halaman setneg) = 18 libur + 8 cuti",
      libur: [
        ["2027-01-01", "Tahun Baru 2027 Masehi"],
        ["2027-01-05", "Isra Mikraj Nabi Muhammad saw."],
        ["2027-02-06", "Tahun Baru Imlek 2578 Kongzili"],
        ["2027-03-08", "Hari Suci Nyepi (Tahun Baru Saka 1949)"],
        ["2027-03-10", "Idulfitri 1448 Hijriah"],
        ["2027-03-11", "Idulfitri 1448 Hijriah"],
        ["2027-03-26", "Wafat Yesus Kristus"],
        ["2027-03-28", "Hari Kebangkitan Yesus Kristus (Paskah)"],
        ["2027-05-01", "Hari Buruh Internasional"],
        ["2027-05-06", "Kenaikan Yesus Kristus"],
        ["2027-05-17", "Iduladha 1448 Hijriah"],
        ["2027-05-20", "Hari Raya Waisak 2571 BE"],
        ["2027-06-01", "Hari Lahir Pancasila"],
        ["2027-06-06", "1 Muharam Tahun Baru Islam 1449 Hijriah"],
        ["2027-08-15", "Maulid Nabi Muhammad SAW"],
        ["2027-08-17", "Proklamasi Kemerdekaan"],
        ["2027-12-25", "Kelahiran Yesus Kristus (Natal)"],
        ["2027-12-26", "Isra Mikraj Nabi Muhammad saw."],
      ],
      cuti: [
        ["2027-02-05", "Tahun Baru Imlek 2578 Kongzili"],
        ["2027-03-09", "Hari Raya Idulfitri 1448 Hijriah"],
        ["2027-03-12", "Hari Raya Idulfitri 1448 Hijriah"],
        ["2027-03-15", "Hari Raya Idulfitri 1448 Hijriah"],
        ["2027-03-25", "Wafat Yesus Kristus"],
        ["2027-05-18", "Iduladha 1448 H"],
        ["2027-05-19", "Waisak 2571 BE"],
        ["2027-12-24", "Kelahiran Yesus Kristus (Natal)"],
      ],
    },
  });

  const YEARS = Object.freeze([2025, 2026, 2027]);

  // Indeks tanggal → {nama, kind}; dibangun sekali. Tanggal ganda antar-daftar dilarang (R25), jadi tidak ada tabrakan.
  const INDEX = new Map();
  for (const y of YEARS) {
    for (const [iso, nama] of DATA[y].libur) INDEX.set(iso, Object.freeze({ nama, kind: "libur" }));
    for (const [iso, nama] of DATA[y].cuti) INDEX.set(iso, Object.freeze({ nama, kind: "cuti" }));
  }

  function has(year) {
    return typeof year === "number" && YEARS.indexOf(year) !== -1;
  }

  // Daftar [iso, nama, "libur"|"cuti"] urut tanggal; sakelar bawaan true; tahun tanpa data → [].
  function forYear(year, opts) {
    if (!has(year)) return [];
    const o = opts || {};
    const national = o.national !== false;
    const cutiBersama = o.cutiBersama !== false;
    const out = [];
    if (national) for (const [iso, nama] of DATA[year].libur) out.push([iso, nama, "libur"]);
    if (cutiBersama) for (const [iso, nama] of DATA[year].cuti) out.push([iso, nama, "cuti"]);
    out.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    return out;
  }

  function lookup(iso) {
    if (typeof iso !== "string") return null;
    const hit = INDEX.get(iso);
    return hit ? { nama: hit.nama, kind: hit.kind } : null;
  }

  return Object.freeze({ DATA, YEARS, has, forYear, lookup });
})();
if (typeof module !== "undefined" && module.exports) module.exports = TLHolidays;
// part: calendar.js
// Plugin Timeline — TLCal: aritmetika hari kerja murni di atas bilangan hari (spec §8.3, rencana R2/R3/R4/R6).
// Tanggal internal = bilangan hari integer dn = Date.UTC(y, m−1, d) / 864e5; tanpa Date lokal dan tanpa global.
// "Hari ini" tidak dibaca di sini (dimasukkan pemanggil sebagai argumen).
const TLCal = (function (H) {
  const MS_DAY = 864e5;
  const MAX_ITER = 10000; // (satu hari kerja per minggu × durasi/lag 999 ≈ 7000 langkah) batas langkah harian pada nextWork/prevWork/addWork → Error("TL_CAL_LOOP"), bukan hang
  const MAX_NAME = 60;
  const MAX_ENTRIES = 366;
  const CACHE_MAX = 8;
  const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

  const DEFAULT_CAL = Object.freeze({
    v: 1,
    weekdays: Object.freeze([1, 2, 3, 4, 5]),
    national: true,
    cutiBersama: true,
    off: Object.freeze([]),
    work: Object.freeze([]),
  });

  const HARI_SHORT = ["Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Min"];
  const HARI_LONG = ["Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu", "Minggu"];
  const BULAN_SHORT = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
  const BULAN_LONG = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];

  // ---- bilangan hari ----
  function dn(s) {
    if (typeof s !== "string") return NaN;
    const m = ISO_RE.exec(s);
    if (!m) return NaN;
    const y = +m[1];
    const mo = +m[2];
    const d = +m[3];
    const t = Date.UTC(y, mo - 1, d);
    if (!Number.isFinite(t)) return NaN;
    const back = new Date(t).toISOString().slice(0, 10); // pulang-pergi menolak 30 Feb dsb.
    return back === s ? t / MS_DAY : NaN;
  }

  function iso(n) {
    if (typeof n !== "number" || !Number.isFinite(n)) return "";
    return new Date(Math.floor(n) * MS_DAY).toISOString().slice(0, 10);
  }

  function isIso(s) {
    return !Number.isNaN(dn(s));
  }

  // 1 = Senin … 7 = Minggu; aman untuk dn negatif (1970-01-01 dn 0 = Kamis).
  function isoWeekday(n) {
    return ((((Math.floor(n) + 3) % 7) + 7) % 7) + 1;
  }

  // ---- normalisasi kalender (R4) ----
  function cleanDays(list) {
    const seen = new Set();
    const out = [];
    if (!Array.isArray(list)) return out;
    for (const e of list) {
      if (!e || typeof e !== "object") continue;
      if (!isIso(e.d)) continue;
      const n = e.n === undefined || e.n === null ? "" : e.n;
      if (typeof n !== "string" || n.length > MAX_NAME) continue;
      if (seen.has(e.d)) continue; // duplikat: yang pertama menang
      seen.add(e.d);
      out.push({ d: e.d, n });
    }
    out.sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0));
    return out.slice(0, MAX_ENTRIES);
  }

  function normalize(data) {
    const src = data && typeof data === "object" && !Array.isArray(data) ? data : {};
    let weekdays = [];
    if (Array.isArray(src.weekdays)) {
      const set = new Set();
      for (const w of src.weekdays) if (Number.isInteger(w) && w >= 1 && w <= 7) set.add(w);
      weekdays = [...set].sort((a, b) => a - b);
    }
    if (!weekdays.length) weekdays = DEFAULT_CAL.weekdays.slice();
    return {
      v: 1,
      weekdays,
      national: typeof src.national === "boolean" ? src.national : DEFAULT_CAL.national,
      cutiBersama: typeof src.cutiBersama === "boolean" ? src.cutiBersama : DEFAULT_CAL.cutiBersama,
      off: cleanDays(src.off),
      work: cleanDays(src.work),
    };
  }

  // ---- kompilasi + cache (R6) ----
  const cache = new Map(); // key → {h, c}

  function compile(calendar, holidays) {
    const hol = holidays || H;
    const cal = normalize(calendar);
    const key = JSON.stringify(cal);
    const hit = cache.get(key);
    if (hit && hit.h === hol) return hit.c;
    const off = new Set();
    if ((cal.national || cal.cutiBersama) && hol && Array.isArray(hol.YEARS)) {
      for (const y of hol.YEARS) {
        for (const row of hol.forYear(y, { national: cal.national, cutiBersama: cal.cutiBersama })) {
          const n = dn(row[0]);
          if (!Number.isNaN(n)) off.add(n);
        }
      }
    }
    for (const e of cal.off) off.add(dn(e.d));
    const work = new Set();
    for (const e of cal.work) work.add(dn(e.d));
    const c = Object.freeze({ mask: new Set(cal.weekdays), off, work, key, national: cal.national, cutiBersama: cal.cutiBersama });
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
    cache.set(key, { h: hol, c });
    return c;
  }

  // ---- hari kerja ----
  function isWork(c, n) {
    return c.work.has(n) || (c.mask.has(isoWeekday(n)) && !c.off.has(n));
  }

  function loopError() {
    return new Error("TL_CAL_LOOP");
  }

  // Hari kerja pertama ≥ n.
  function nextWork(c, n) {
    for (let i = 0, d = n; i <= MAX_ITER; i++, d++) if (isWork(c, d)) return d;
    throw loopError();
  }

  // Hari kerja terakhir ≤ n.
  function prevWork(c, n) {
    for (let i = 0, d = n; i <= MAX_ITER; i++, d--) if (isWork(c, d)) return d;
    throw loopError();
  }

  // Maju/mundur k hari kerja dari n (n sendiri tidak dihitung; k = 0 → n). Batas MAX_ITER langkah harian.
  function addWork(c, n, k) {
    if (!k) return n;
    const step = k > 0 ? 1 : -1;
    let left = Math.abs(k);
    let d = n;
    for (let i = 0; i < MAX_ITER; i++) {
      d += step;
      if (isWork(c, d) && --left === 0) return d;
    }
    throw loopError();
  }

  // Hari selesai (inklusif). dur 0 = milestone = start (walau hari libur).
  function finish(c, startDn, dur) {
    if (!(dur >= 1)) return startDn;
    return addWork(c, nextWork(c, startDn), dur - 1);
  }

  // Jumlah hari kerja di [a, b] inklusif; a > b → 0.
  function workdays(c, a, b) {
    if (!Number.isFinite(a) || !Number.isFinite(b) || a > b) return 0;
    let n = 0;
    for (let d = a; d <= b; d++) if (isWork(c, d)) n++;
    return n;
  }

  // Awal paling cepat penerus FS: hari kerja setelah selesai pendahulu, digeser lag hari kerja (negatif = lead).
  function fsEarliest(c, predFinishDn, lag) {
    return addWork(c, nextWork(c, predFinishDn + 1), lag || 0);
  }

  // Tahun di [fromDn, toDn] yang tidak punya data libur, hanya bila kalender mengikuti libur nasional/cuti bersama.
  // `c` boleh hasil compile() atau kalender mentah/ternormalisasi (kedua sakelar dibaca dengan bawaan true).
  function missingYears(c, fromDn, toDn, holidays) {
    const hol = holidays || H;
    if (!c || (c.national === false && c.cutiBersama === false)) return [];
    if (!Number.isFinite(fromDn) || !Number.isFinite(toDn) || fromDn > toDn) return [];
    const y0 = +iso(fromDn).slice(0, 4);
    const y1 = +iso(toDn).slice(0, 4);
    const out = [];
    for (let y = y0; y <= y1; y++) if (!hol.has(y)) out.push(y);
    return out;
  }

  // Byte UTF-8 dari JSON.stringify(cal) (batas record 16384 byte).
  function byteSize(cal) {
    const s = JSON.stringify(cal);
    let n = 0;
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      if (c < 0x80) n += 1;
      else if (c < 0x800) n += 2;
      else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
        const c2 = s.charCodeAt(i + 1);
        if (c2 >= 0xdc00 && c2 <= 0xdfff) {
          n += 4;
          i++;
        } else n += 3;
      } else n += 3;
    }
    return n;
  }

  // ---- format (tanggal dibaca dari string ISO; tanpa getter Date lokal) ----
  function parts(n) {
    const s = iso(n);
    return { y: +s.slice(0, 4), m: +s.slice(5, 7), d: +s.slice(8, 10) };
  }

  function fmtShort(n) {
    const p = parts(n);
    return HARI_SHORT[isoWeekday(n) - 1] + " " + p.d + " " + BULAN_SHORT[p.m - 1];
  }

  function fmtLong(n) {
    const p = parts(n);
    return HARI_LONG[isoWeekday(n) - 1] + ", " + p.d + " " + BULAN_LONG[p.m - 1] + " " + p.y;
  }

  // Minggu ISO 8601: minggu milik tahun tempat Kamisnya jatuh.
  function isoWeek(n) {
    const thursday = Math.floor(n) - (isoWeekday(n) - 1) + 3;
    const year = parts(thursday).y;
    const jan1 = dn(String(year).padStart(4, "0") + "-01-01");
    return { year, week: Math.floor((thursday - jan1) / 7) + 1 };
  }

  return Object.freeze({
    DEFAULT_CAL,
    MAX_ITER,
    dn,
    iso,
    isoWeekday,
    isIso,
    normalize,
    compile,
    isWork,
    nextWork,
    prevWork,
    addWork,
    finish,
    workdays,
    fsEarliest,
    missingYears,
    byteSize,
    fmtShort,
    fmtLong,
    isoWeek,
  });
})(typeof TLHolidays !== "undefined" ? TLHolidays : require("./holidays-id.js"));
if (typeof module !== "undefined" && module.exports) module.exports = TLCal;
// part: schedule.js
// Plugin Timeline — TLSched: baca/validasi ext jadwal task, dependensi FS/SS/FF/SF, mode, batasan, unit jadwal,
// siklus, pelanggaran, tenggat (spec 1b §8.2/§8.7, rencana 1b R2, R3, R7, R8, R15, R16; spec 1c §4–§5, rencana 1c-1 R3–R5).
// Murni: tanpa Date lokal, tanpa global, tanpa akses api.
// Semua nilai yang diteruskan ke TLCal dijamin integer / bilangan hari sah (TLCal tidak menjaga NaN).
// Fungsi yang memanggil TLCal.finish/addWork/nextWork/fsEarliest menangkap Error("TL_CAL_LOOP") dan menurun
// (hasil "tidak terhitung": tanpa selesai → tanpa pelanggaran/keterlambatan), tidak melempar.
const TLSched = (function (CAL) {
  const MAX_DEPS = 20;
  const DUR_MAX = 999;
  const LAG_MIN = -99;
  const LAG_MAX = 999;
  const MAX_LATE_SPAN = 3660; // hari kalender maks yang dihitung deadlineLate
  const TYPES = Object.freeze(["FS", "SS", "FF", "SF"]);
  const CONSTRAINT_TYPES = Object.freeze(["SNET", "MFO"]);
  const MODES = ["auto", "manual"];
  const YEAR_MIN = 1970;
  const YEAR_MAX = 2199;

  const isInt = (n) => typeof n === "number" && Number.isInteger(n);
  const isObj = (o) => o !== null && typeof o === "object" && !Array.isArray(o);

  // Jalankan fn; TL_CAL_LOOP → undefined (turun), kesalahan lain dilempar ulang.
  function safe(fn) {
    try {
      return fn();
    } catch (e) {
      if (e instanceof Error && e.message === "TL_CAL_LOOP") return undefined;
      throw e;
    }
  }

  // ---- referensi $task (R8) ----
  function refKey(ref) {
    if (!isObj(ref)) return null;
    const t = ref.$task;
    if (isInt(t)) return String(t);
    if (typeof t === "string" && t.length > 0) return t;
    return null;
  }

  // ---- baca ext (R7) ----
  function readDep(raw) {
    if (!isObj(raw)) return null;
    const key = refKey(raw.t);
    if (key === null) return null;
    // type tidak ada = FS (bentuk 1b); tipe di luar TYPES → tidak sah (dihitung invalidDeps oleh pemanggil)
    const type = raw.type === undefined ? "FS" : raw.type;
    if (TYPES.indexOf(type) < 0) return null;
    const lag = raw.lag === undefined ? 0 : raw.lag;
    if (!isInt(lag) || lag < LAG_MIN || lag > LAG_MAX) return null;
    return { key, ref: { $task: raw.t.$task }, type, lag };
  }

  // Tanggal batasan: ISO sah dengan tahun 1970–2199 (R3).
  function isConstraintDate(s) {
    if (typeof s !== "string" || !CAL.isIso(s)) return false;
    const y = +s.slice(0, 4);
    return y >= YEAR_MIN && y <= YEAR_MAX;
  }

  // {type: SNET|MFO, date} bersih, atau null (rusak → ASAP).
  function readConstraint(v) {
    if (!isObj(v) || CONSTRAINT_TYPES.indexOf(v.type) < 0 || !isConstraintDate(v.date)) return null;
    return { type: v.type, date: v.date };
  }

  // {start?, finish?} aktual bersih (1c-2), atau null (rusak → tak ada aktual). Pola sama dengan readConstraint:
  // objek tanpa kunci lain, minimal satu tanggal, ISO sah 1970–2199, finish ≥ start bila keduanya ada.
  function readActual(v) {
    if (!isObj(v)) return null;
    const ks = Object.keys(v);
    if (!ks.length || ks.some((k) => k !== "start" && k !== "finish")) return null;
    const out = {};
    for (const k of ks) {
      if (!isConstraintDate(v[k])) return null;
      out[k] = v[k];
    }
    if (out.start !== undefined && out.finish !== undefined && CAL.dn(out.finish) < CAL.dn(out.start)) return null;
    return out;
  }

  // Masukan = hasil api.taskExt.read (kunci tanpa prefiks: start, duration, deps, mode, constraint, actual).
  function readSched(extObj) {
    const src = isObj(extObj) ? extObj : {};
    const start = typeof src.start === "string" && CAL.isIso(src.start) ? src.start : null;
    let duration = null;
    if (start !== null) duration = isInt(src.duration) && src.duration >= 0 && src.duration <= DUR_MAX ? src.duration : 1;
    const deps = [];
    let invalidDeps = 0;
    if (src.deps !== undefined && src.deps !== null) {
      if (!Array.isArray(src.deps)) invalidDeps = 1;
      else {
        const seen = new Set();
        for (const raw of src.deps) {
          const d = readDep(raw);
          if (!d || seen.has(d.key)) {
            invalidDeps++;
            continue;
          }
          if (deps.length >= MAX_DEPS) break;
          seen.add(d.key);
          deps.push(d);
        }
      }
    }
    const mode = MODES.indexOf(src.mode) >= 0 ? src.mode : null;
    const constraint = readConstraint(src.constraint);
    const actual = readActual(src.actual);
    return { start, duration, deps, invalidDeps, mode, constraint, actual };
  }

  // ---- tulis ext: validasi + jepit (R7) ----
  function clampInt(n, lo, hi) {
    return Math.min(hi, Math.max(lo, Math.round(n)));
  }

  function sanitizeDeps(list) {
    if (!Array.isArray(list)) return { ok: false, reason: "deps" };
    if (list.length > MAX_DEPS) return { ok: false, reason: "max" };
    const out = [];
    const seen = new Set();
    for (const raw of list) {
      if (!isObj(raw)) return { ok: false, reason: "dep" };
      const t = raw.t !== undefined ? raw.t : raw.ref; // bentuk ext atau bentuk hasil readSched
      const key = refKey(t);
      if (key === null || seen.has(key)) return { ok: false, reason: "dep" };
      const type = raw.type === undefined ? "FS" : raw.type;
      if (TYPES.indexOf(type) < 0) return { ok: false, reason: "dep" };
      let lag = raw.lag === undefined ? 0 : raw.lag;
      if (typeof lag !== "number" || !Number.isFinite(lag)) return { ok: false, reason: "dep" };
      lag = clampInt(lag, LAG_MIN, LAG_MAX);
      seen.add(key);
      out.push({ t: { $task: t.$task }, type, lag });
    }
    return { ok: true, deps: out };
  }

  function sanitizePatch(p) {
    if (!isObj(p)) return { ok: false, reason: "patch" };
    const keys = Object.keys(p);
    if (!keys.length) return { ok: false, reason: "empty" };
    const patch = {};
    for (const k of keys) {
      const v = p[k];
      if (k === "start") {
        if (v !== null && !(typeof v === "string" && CAL.isIso(v))) return { ok: false, reason: "start" };
        patch.start = v;
      } else if (k === "duration") {
        if (v === null) patch.duration = null;
        else if (typeof v === "number" && Number.isFinite(v)) patch.duration = clampInt(v, 0, DUR_MAX);
        else return { ok: false, reason: "duration" };
      } else if (k === "deps") {
        if (v === null) {
          patch.deps = null; // hapus kunci (Urungkan menulis null untuk kunci yang dulu tidak ada)
          continue;
        }
        const r = sanitizeDeps(v);
        if (!r.ok) return r;
        patch.deps = r.deps;
      } else if (k === "mode") {
        // null = hapus kunci (ikut unit); pemanggil menulis null bila pilihan sama dengan unit (TLPlan.modePatch)
        if (v !== null && MODES.indexOf(v) < 0) return { ok: false, reason: "mode" };
        patch.mode = v;
      } else if (k === "constraint") {
        if (v === null) patch.constraint = null;
        else {
          const cst = readConstraint(v);
          if (!cst) return { ok: false, reason: "constraint" };
          patch.constraint = cst;
        }
      } else if (k === "actual") {
        if (v === null) patch.actual = null;
        else {
          const act = readActual(v);
          if (!act) return { ok: false, reason: "actual" };
          patch.actual = act;
        }
      } else return { ok: false, reason: "key" };
    }
    return { ok: true, patch };
  }

  // ---- indeks task (R8) ----
  // String(id) menang; cid dan server_id hanya mengisi kunci yang belum dipakai id task mana pun.
  function buildIndex(tasks) {
    const idx = new Map();
    const list = Array.isArray(tasks) ? tasks.filter((t) => t && typeof t === "object") : [];
    for (const t of list) if (t.id !== undefined && t.id !== null && !idx.has(String(t.id))) idx.set(String(t.id), t);
    for (const t of list) {
      for (const alt of [t.cid, t.server_id]) {
        if (alt === undefined || alt === null || alt === "") continue;
        if (!idx.has(String(alt))) idx.set(String(alt), t);
      }
    }
    return idx;
  }

  // Kalender yang dipakai (R4) — SATU pembantu id kalender untuk view, seksi, dan scope dependensi.
  // list_id sah → kalender workspace `cal@list:<id>` (scope "list:<id>", dibagi semua anggota); kosong/0/id tak sah
  // (bukan [A-Za-z0-9_-]{1,40}, mis. data rusak) → kalender pribadi `cal@user` (scope "user").
  const LIST_ID_RE = /^[A-Za-z0-9_-]{1,40}$/;
  function calTarget(listId) {
    const s = listId === undefined || listId === null ? "" : String(listId).trim();
    if (!s || s === "0" || !LIST_ID_RE.test(s)) return { id: "cal@user", scope: "user" };
    return { id: "cal@list:" + s, scope: "list:" + s };
  }

  function calKeyOf(task) {
    return calTarget(task && typeof task === "object" ? task.list_id : null);
  }

  // Lipatan nama project = host `projectNameFold` (index.html): hanya A–Z ASCII ke huruf kecil, tanpa trim — sama dengan
  // SQLite NOCASE. "Proyek " ≠ "Proyek", "É" ≠ "é", "A" = "a".
  function projectFold(s) {
    return String(s === undefined || s === null ? "" : s).replace(/[A-Z]/g, (c) => c.toLowerCase());
  }

  // Kunci scope dependensi (R15): workspace sama (`l:<id>`), atau pribadi dengan nama project sama menurut projectFold
  // (`p:<lipatan>`; keduanya tanpa project juga sama).
  function scopeKeyOf(t) {
    const cal = calKeyOf(t);
    if (cal.scope !== "user") return "l:" + cal.scope.slice(5);
    return "p:" + projectFold(t && typeof t === "object" ? t.project : null);
  }

  // ---- unit jadwal (R5) ----
  // FNV-1a 32 bit atas unit kode UTF-16 → 8 hex huruf kecil.
  function fnv1a32(str) {
    const s = String(str === undefined || str === null ? "" : str);
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(16).padStart(8, "0");
  }

  // x = task ({list_id, project}) atau halaman ({pageKind, listId, projectName}). SATU-SATUNYA pembuat id record
  // `project`: workspace → "prj@list:<lid>:<h|->" (scope "list:<lid>"); pribadi → "prj@user:<h|->" (scope "user").
  // <h> = fnv1a32(projectFold(nama)); nama kosong → "-". lid divalidasi calTarget → id selalu cocok pola README.
  function unitOf(x) {
    const o = isObj(x) ? x : {};
    const page = o.pageKind !== undefined || o.listId !== undefined || o.projectName !== undefined;
    const lid = page ? o.listId : o.list_id;
    const raw = page ? o.projectName : o.project;
    const name = raw === undefined || raw === null ? "" : String(raw);
    const fold = projectFold(name);
    const tail = fold ? fnv1a32(fold) : "-";
    const cal = calTarget(lid);
    if (cal.scope === "user") {
      const recId = "prj@user:" + tail;
      return { key: recId, recId, scope: "user", name, fold };
    }
    const recId = "prj@" + cal.scope + ":" + tail;
    return { key: recId, recId, scope: cal.scope, name, fold };
  }

  // Nama project di record `project` (1c-1 R6, amandemen review T6): KEDUA sisi (tulis setAuto dan setiap baca/lookup)
  // memotong nama ke NAME_MAX unit UTF-16 sebelum dilipat/dibandingkan. Bila unit ke-120 (indeks 119) adalah surrogate
  // tinggi, potong di 119 — pasangan tidak pernah terbelah (surrogate tunggal bisa kembali sebagai U+FFFD dan lipatannya
  // tidak akan pernah cocok lagi).
  const NAME_MAX = 120;
  function cutName(s) {
    const str = s === undefined || s === null ? "" : String(s);
    if (str.length <= NAME_MAX) return str;
    const hi = str.charCodeAt(NAME_MAX - 1);
    return str.slice(0, hi >= 0xd800 && hi <= 0xdbff ? NAME_MAX - 1 : NAME_MAX);
  }

  // Unit milik task dari Map<recId, Unit> (projectStore.loadUnits) atau null. Penjaga tabrakan hash (R6): entri yang
  // membawa `fold` (lipatan nama terpotong record) hanya berlaku bila sama dengan projectFold(cutName(nama project
  // task)) — dua project dengan fnv1a32 sama di satu workspace tidak saling memakai unit. Entri tanpa `fold` (Map
  // buatan tes/pemanggil lama) diterima apa adanya.
  function unitFor(units, task) {
    if (!(units instanceof Map)) return null;
    const unit = unitOf(task);
    const u = units.get(unit.recId);
    if (!u || typeof u !== "object") return null;
    if (typeof u.fold === "string" && u.fold !== projectFold(cutName(unit.name))) return null;
    return u;
  }

  // Mode efektif: ext.mode (raw ext atau hasil readSched) menang; selain itu unit (unitFor) → auto/manual.
  function modeOf(raw, units, task) {
    const m = isObj(raw) ? raw.mode : undefined;
    if (MODES.indexOf(m) >= 0) return m;
    const u = unitFor(units, task);
    return u && u.auto === true ? "auto" : "manual";
  }

  // ---- rentang hari ----
  function spanOf(c, sched) {
    if (!sched || typeof sched !== "object" || typeof sched.start !== "string") return null;
    const s = CAL.dn(sched.start);
    if (!Number.isInteger(s)) return null;
    const dur = sched.duration === null || sched.duration === undefined ? 1 : sched.duration;
    if (!isInt(dur) || dur < 0 || dur > DUR_MAX) return null;
    const f = safe(() => CAL.finish(c, s, dur));
    if (!Number.isInteger(f)) return null;
    return { s, f };
  }

  // ---- dependensi ----
  const rowKey = (row) => {
    if (row && row.key !== undefined && row.key !== null) return String(row.key);
    if (row && row.task && row.task.id !== undefined && row.task.id !== null) return String(row.task.id);
    return null;
  };

  // rows: [{key | task, sched}] (sched = hasil readSched). from = pendahulu, to = penerus (kunci = String(id)).
  // Ref yang tidak ada di indeks → ok false dengan from = kunci mentah ref.
  function resolveDeps(rows, index) {
    const out = [];
    const seen = new Set(); // satu edge per (pendahulu kanonik, penerus): cid dan id angka task yang sama tidak ganda
    if (!Array.isArray(rows)) return out;
    for (const row of rows) {
      const to = rowKey(row);
      if (to === null || !row.sched || !Array.isArray(row.sched.deps)) continue;
      for (const d of row.sched.deps) {
        const pred = index && typeof index.get === "function" ? index.get(d.key) : undefined;
        const found = !!(pred && pred.id !== undefined && pred.id !== null);
        const from = found ? String(pred.id) : d.key;
        const pair = from + "\u0000" + to;
        if (seen.has(pair)) continue;
        seen.add(pair);
        out.push({ from, to, type: TYPES.indexOf(d.type) >= 0 ? d.type : "FS", lag: d.lag, ok: found });
      }
    }
    return out;
  }

  // Apakah menambah edge from→to membuat lingkaran? (DFS dari `to` mencari `from`.)
  function wouldCycle(edges, from, to) {
    if (from === to) return true;
    const adj = new Map();
    for (const e of Array.isArray(edges) ? edges : []) {
      if (!e || e.ok === false) continue;
      let a = adj.get(e.from);
      if (!a) adj.set(e.from, (a = []));
      a.push(e.to);
    }
    const seen = new Set([to]);
    const stack = [to];
    while (stack.length) {
      const n = stack.pop();
      const next = adj.get(n);
      if (!next) continue;
      for (const m of next) {
        if (m === from) return true;
        if (!seen.has(m)) {
          seen.add(m);
          stack.push(m);
        }
      }
    }
    return false;
  }

  const idOf = (t) => (t && typeof t === "object" && t.id !== undefined && t.id !== null ? String(t.id) : null);

  // Kunci task yang punya anak di scopeTasks (parent_id server atau parent_cid offline).
  function summaryKeys(scopeTasks) {
    const idx = buildIndex(scopeTasks);
    const out = new Set();
    for (const t of scopeTasks) {
      if (!t || typeof t !== "object") continue;
      const p = t.parent_id !== undefined && t.parent_id !== null ? t.parent_id : t.parent_cid;
      if (p === undefined || p === null || p === "") continue;
      const parent = idx.get(String(p));
      if (parent && idOf(parent) !== null) out.add(idOf(parent));
    }
    return out;
  }

  // R15. edges = hasil resolveDeps; scopeTasks opsional (tanpa itu: tanpa pemeriksaan ringkasan/keanggotaan halaman);
  // depCount opsional = jumlah dependensi penerus yang sudah tersimpan (termasuk yang tak terpecahkan).
  function canLink(args) {
    const a = args || {};
    let pk = idOf(a.pred);
    let sk = idOf(a.succ);
    if (pk === null || sk === null) return { ok: false, reason: "scope" };
    // Kanonikkan lewat indeks halaman: salinan basi (id masih cid) → String(id) terkini, agar dup/siklus/self cocok dengan edge.
    const idx = Array.isArray(a.scopeTasks) ? buildIndex(a.scopeTasks) : null;
    let inScope = true;
    if (idx) {
      const fp = idx.get(pk);
      const fs = idx.get(sk);
      inScope = !!(fp && fs);
      if (fp) pk = idOf(fp);
      if (fs) sk = idOf(fs);
    }
    if (pk === sk) return { ok: false, reason: "self" };
    // scope: workspace sama, atau pribadi dengan project sama (projectFold; keduanya tanpa project juga sama)
    if (scopeKeyOf(a.pred) !== scopeKeyOf(a.succ)) return { ok: false, reason: "scope" };
    if (idx) {
      if (!inScope) return { ok: false, reason: "scope" };
      const sums = summaryKeys(a.scopeTasks);
      if (sums.has(pk) || sums.has(sk)) return { ok: false, reason: "summary" };
    }
    const edges = Array.isArray(a.edges) ? a.edges : [];
    if (edges.some((e) => e && e.from === pk && e.to === sk)) return { ok: false, reason: "dup" };
    const count = Math.max(edges.filter((e) => e && e.to === sk).length, isInt(a.depCount) ? a.depCount : 0);
    if (count >= MAX_DEPS) return { ok: false, reason: "max" };
    if (wouldCycle(edges, pk, sk)) return { ok: false, reason: "cycle" };
    return { ok: true };
  }

  // ---- pelanggaran dan tenggat (R16) ----
  const lagOf = (l) => (isInt(l) && l >= LAG_MIN && l <= LAG_MAX ? l : 0);
  const spanAt = (spans, key) => {
    const sp = spans instanceof Map ? spans.get(key) : spans && typeof spans === "object" ? spans[key] : null;
    return sp && Number.isInteger(sp.s) && Number.isInteger(sp.f) ? sp : null;
  };

  // ---- rumus dependensi bersama (R4, spec 1c §5.3/§5.4) — satu sumber untuk mesin, penanda Manual, dan
  // "Geser ke setelah dependensi". Semua kalender lewat safe(): TL_CAL_LOOP / masukan tak sah → undefined.
  const isDn = (n) => Number.isInteger(n);
  const isDur = (d) => isInt(d) && d >= 0 && d <= DUR_MAX;
  const typeOf = (t) => (t === undefined || t === null ? "FS" : TYPES.indexOf(t) >= 0 ? t : null);

  // Selesai dari mulai: d = 0 → s; selain itu add(nw(s), d − 1).
  function fin(c, s, d) {
    if (!isDn(s) || !isDur(d)) return undefined;
    return safe(() => (d === 0 ? s : CAL.addWork(c, CAL.nextWork(c, s), d - 1)));
  }

  const MS_DAY = 864e5;
  const JKT_OFFSET = 7 * 3600e3; // Asia/Jakarta, tanpa DST
  // completed_at → bilangan hari Jakarta (Asia/Jakarta, UTC+7 tanpa DST). Hanya bentuk ISO bertanggal-jam; tanpa zona = UTC
  // (termasuk "YYYY-MM-DD HH:MM:SS[.ffffff]" SQLite/server); tanggal saja → hari itu; selain itu → null. Epoch dirakit dari
  // bilangan hari TLCal.dn (= Date.UTC) + grup regex (tanpa Date.parse → bebas mesin JS). Pecahan detik dipotong ke milidetik: hasil dibulatkan ke
  // hari, jadi presisi mikrodetik hanya berpengaruh di batas 23:59:59.999xxx Jakarta (dipotong = masih hari itu, benar).
  const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
  const ISO_TS = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(?:(Z)|([+-])(\d{2}):?(\d{2}))?$/;
  function jkt(v) {
    if (typeof v !== "string") return null;
    const s = v.trim();
    if (ISO_DATE.test(s)) {
      const n = CAL.dn(s);
      return isDn(n) ? n : null;
    }
    const m = ISO_TS.exec(s);
    if (!m) return null;
    const day = CAL.dn(m[1]);
    const h = +m[2];
    const mi = +m[3];
    const sec = m[4] === undefined ? 0 : +m[4];
    if (!isDn(day) || h > 23 || mi > 59 || sec > 59) return null;
    const ms = m[5] === undefined ? 0 : +(m[5] + "00").slice(0, 3);
    let off = 0; // menit, positif = di depan UTC
    if (m[7]) {
      const oh = +m[8];
      const om = +m[9];
      if (oh > 23 || om > 59) return null;
      off = (m[7] === "-" ? -1 : 1) * (oh * 60 + om);
    }
    const t = day * MS_DAY + ((h * 60 + mi - off) * 60 + sec) * 1000 + ms;
    return Math.floor((t + JKT_OFFSET) / MS_DAY);
  }

  // Aktual task (1c-2): ext = hasil readSched atau objek ext mentah (kunci `actual`); bentuk rusak diabaikan.
  // start = actual.start; finish = actual.finish ?? jkt(completed_at) (K42: turunan tidak pernah disimpan);
  // finishDerived true hanya bila finish berasal dari completed_at. Murni, tanpa kalender.
  function actualOf(task, ext) {
    const act = readActual(isObj(ext) ? ext.actual : null);
    const start = act && act.start !== undefined ? CAL.dn(act.start) : null;
    if (act && act.finish !== undefined) return { start, finish: CAL.dn(act.finish), finishDerived: false };
    const f = jkt(task && typeof task === "object" ? task.completed_at : null);
    return { start, finish: f, finishDerived: f !== null };
  }

  // Selesai pendahulu DONE — SATU aturan untuk jangkar "done" mesin (TLCpm) dan violations (layout langkah 7):
  // maks(mulai, actualOf(task, ext).finish ?? fin(mulai, d)). Mulai tak sah / kalender buntu → undefined.
  function doneFinish(c, task, ext, s, d) {
    if (!isDn(s)) return undefined;
    let f = actualOf(task, ext).finish;
    if (f === null) f = fin(c, s, d);
    if (isDn(f) && f < s) f = s;
    return f;
  }

  // Mulai dari selesai: d = 0 → f; selain itu add(pw(f), −(d − 1)).
  function sff(c, f, d) {
    if (!isDn(f) || !isDur(d)) return undefined;
    return safe(() => (d === 0 ? f : CAL.addWork(c, CAL.prevWork(c, f), -(d - 1))));
  }

  // ES terkecil penerus berdurasi d dari pendahulu (pES, pEF) lewat dependensi `type` dengan lag (§5.3).
  // Hasil belum dijepret nw untuk d ≥ 1 kecuali yang rumusnya sudah hari kerja (pemanggil: ES = nw(ES) bila d ≥ 1).
  function depReq(c, type, pES, pEF, lag, d) {
    const t = typeOf(type);
    if (t === null || !isDur(d)) return undefined;
    const L = lagOf(lag);
    if (t === "FS") return isDn(pEF) ? safe(() => CAL.addWork(c, CAL.nextWork(c, pEF + 1), L)) : undefined;
    if (t === "SS") return isDn(pES) ? safe(() => CAL.addWork(c, CAL.nextWork(c, pES), L)) : undefined;
    let e;
    if (t === "FF") {
      if (!isDn(pEF)) return undefined;
      e = safe(() => CAL.addWork(c, pEF, L));
    } else {
      if (!isDn(pES)) return undefined;
      e = safe(() => CAL.addWork(c, CAL.prevWork(c, pES - 1), L));
    }
    if (!isDn(e)) return undefined;
    if (d >= 1) e = safe(() => CAL.nextWork(c, e));
    return isDn(e) ? sff(c, e, d) : undefined;
  }

  // Batas LF pendahulu berdurasi dP dari penerus (sLS, sLF) lewat dependensi `type` dengan lag (§5.4).
  function depLimit(c, type, sLS, sLF, lag, dP) {
    const t = typeOf(type);
    if (t === null || !isDur(dP)) return undefined;
    const L = lagOf(lag);
    if (t === "FS" || t === "SS") {
      if (!isDn(sLS)) return undefined;
      const y = safe(() => CAL.addWork(c, sLS, -L));
      if (!isDn(y)) return undefined;
      if (t === "FS") return safe(() => CAL.prevWork(c, y - 1));
      const ls = safe(() => CAL.prevWork(c, y));
      return isDn(ls) ? fin(c, ls, dP) : undefined;
    }
    if (!isDn(sLF)) return undefined;
    const y = safe(() => CAL.addWork(c, sLF, -L));
    if (!isDn(y)) return undefined;
    if (t === "FF") return dP === 0 ? y : safe(() => CAL.prevWork(c, y)); // milestone pendahulu: tanpa pw
    const ls = safe(() => CAL.nextWork(c, y + 1));
    return isDn(ls) ? fin(c, ls, dP) : undefined;
  }

  // Durasi penerus dari rentang: sp.d bila ada; selain itu hari kerja [nw(s), f] (s = f di hari non-kerja → 0).
  function spanDur(c, sp) {
    if (isDur(sp.d)) return sp.d;
    const s0 = safe(() => CAL.nextWork(c, sp.s));
    if (!isDn(s0)) return undefined;
    if (s0 > sp.f) return 0;
    return Math.min(DUR_MAX, CAL.workdays(c, s0, sp.f));
  }

  // "Terlalu awal" — SATU aturan untuk violations (Manual) dan conflict jangkar di mesin (TLCpm): hari kerja pertama
  // ≥ mulai < req, untuk semua durasi termasuk milestone (mulai di akhir pekan/libur tidak dihitung terlalu awal).
  // Masukan tak sah / kalender buntu → false.
  function isEarly(c, startDn, req) {
    if (!isDn(startDn) || !isDn(req)) return false;
    const eff = safe(() => CAL.nextWork(c, startDn));
    return isDn(eff) && eff < req;
  }

  // Set kunci penerus yang mulai sebelum depReq (per tipe, edge tanpa type = FS); .detail = [{succ, pred, earliest, type}].
  // Dilanggar bila isEarly (nw(mulai) < depReq) — juga untuk milestone (perilaku 1b "milestone Sabtu setelah selesai Jumat
  // aman" dipertahankan; lihat laporan Task 1). Dependensi tidak memindahkan task (Manual).
  // Tanpa jadwal / tak terpecahkan / tipe tak dikenal / kalender buntu → diabaikan.
  function violations(c, spans, edges) {
    const out = new Set();
    const detail = [];
    for (const e of Array.isArray(edges) ? edges : []) {
      if (!e || e.ok === false) continue;
      const type = typeOf(e.type);
      if (type === null) continue;
      const p = spanAt(spans, e.from);
      const s = spanAt(spans, e.to);
      if (!p || !s) continue;
      const d = spanDur(c, s);
      if (d === undefined) continue;
      const earliest = depReq(c, type, p.s, p.f, e.lag, d);
      if (!isDn(earliest)) continue;
      if (isEarly(c, s.s, earliest)) {
        out.add(e.to);
        detail.push({ succ: e.to, pred: e.from, earliest, type });
      }
    }
    out.detail = detail;
    return out;
  }

  // "Geser ke setelah dependensi": maks depReq atas pendahulu terjadwal, sebagai iso; tak ada → null.
  // preds: [{span: {s, f} | null, lag, type?}] (atau {f, lag} untuk FS). succ: {d} | {duration} | rentang {s, f} | null
  // (durasi penerus untuk FF/SF; tidak ada → 1).
  function shiftAfterDeps(c, succ, preds) {
    let d = 1;
    if (isObj(succ)) {
      if (isDur(succ.d)) d = succ.d;
      else if (isDur(succ.duration)) d = succ.duration;
      else if (isDn(succ.s) && isDn(succ.f)) {
        const sd = spanDur(c, succ);
        if (sd !== undefined) d = sd;
      }
    }
    let best = null;
    for (const p of Array.isArray(preds) ? preds : []) {
      if (!p || typeof p !== "object") continue;
      const type = typeOf(p.type);
      if (type === null) continue;
      const f = p.span && isDn(p.span.f) ? p.span.f : p.f;
      const s = p.span && isDn(p.span.s) ? p.span.s : p.s;
      const e = depReq(c, type, s, f, p.lag, d);
      if (!isDn(e)) continue;
      if (best === null || e > best) best = e;
    }
    return best === null ? null : CAL.iso(best);
  }

  // Hari kerja selesai setelah tenggat; 0 bila tepat/sebelum; null bila tenggat tak sah atau selesai tak ada.
  // Tenggat dibaca 10 karakter pertama (R3). Selesai di hari non-kerja setelah tenggat tetap ≥ 1.
  function deadlineLate(c, finishDn, deadline) {
    if (!Number.isInteger(finishDn) || deadline === null || deadline === undefined) return null;
    const dl = CAL.dn(String(deadline).slice(0, 10));
    if (!Number.isInteger(dl)) return null;
    if (finishDn <= dl) return 0;
    // rentang hitung dibatasi (tenggat sampah di masa lalu jauh tidak boleh memakan ratusan ribu iterasi)
    return Math.max(1, CAL.workdays(c, dl + 1, Math.min(finishDn, dl + MAX_LATE_SPAN)));
  }

  return Object.freeze({
    TYPES,
    CONSTRAINT_TYPES,
    MAX_DEPS,
    DUR_MAX,
    LAG_MIN,
    LAG_MAX,
    readSched,
    sanitizePatch,
    refKey,
    buildIndex,
    calTarget,
    calKeyOf,
    projectFold,
    scopeKeyOf,
    spanOf,
    resolveDeps,
    wouldCycle,
    canLink,
    violations,
    isEarly,
    shiftAfterDeps,
    deadlineLate,
    fin,
    sff,
    jkt,
    doneFinish,
    actualOf,
    depReq,
    depLimit,
    fnv1a32,
    unitOf,
    NAME_MAX,
    cutName,
    unitFor,
    modeOf,
  });
})(typeof TLCal !== "undefined" ? TLCal : require("./calendar.js"));
if (typeof module !== "undefined" && module.exports) module.exports = TLSched;
// part: cpm.js
// Plugin Timeline — TLCpm: mesin jadwal otomatis (Critical Path Method) — graf dependensi FS/SS/FF/SF dengan lag,
// Tarjan SCC (iteratif) + Kahn terurut, forward/backward pass, slack, jalur kritis, drift, jangkar
// (spec 1c §5.1–§5.5, rencana 1c-1 R8–R10). Murni: tanpa Date lokal, tanpa global, tanpa akses api, TIDAK PERNAH menulis
// (K27) — hanya menghitung. Semua rumus dependensi lewat TLSched.depReq/depLimit/fin/sff (satu sumber, R4) dan aturan
// "terlalu awal" jangkar lewat TLSched.isEarly (sama dengan violations). Kalender buntu (TL_CAL_LOOP) → simpul
// "tak terhitung" (uncomputable), run tidak melempar.
const TLCpm = (function (CAL, SCHED, HOL) {
  const SPAN_MAX = 3660; // rentang hari kalender maks untuk hitung slack (pola MAX_LATE_SPAN)
  const DUR_MAX = SCHED.DUR_MAX;

  const isInt = (n) => typeof n === "number" && Number.isInteger(n);
  const isDn = (n) => Number.isInteger(n);
  const isObj = (o) => o !== null && typeof o === "object" && !Array.isArray(o);
  // Pembanding kunci = unit kode UTF-16 (bukan localeCompare: urutan lokal berbeda antar perangkat, mis. "aa" di Denmark).
  // Dipakai untuk semua urutan keluaran (order, ignored, cycles, summaries, succ) → deterministik lintas perangkat.
  const cmpKey = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  const cmp = cmpKey;

  function safe(fn) {
    try {
      return fn();
    } catch (e) {
      if (e instanceof Error && e.message === "TL_CAL_LOOP") return undefined;
      throw e;
    }
  }

  // completed_at → bilangan hari Jakarta: satu sumber di TLSched.jkt (dipakai juga violations lewat TLSched.doneFinish);
  // TLCpm.jkt tetap diekspor sebagai alias (kompatibilitas tes/konsumen).
  const jkt = SCHED.jkt;

  // Tenggat task → bilangan hari (10 karakter pertama, R3); tak ada/tak sah → NaN. Satu sumber untuk run() dan explain().
  const deadlineDn = (t) => (t.deadline === null || t.deadline === undefined ? NaN : CAL.dn(String(t.deadline).slice(0, 10)));
  const isDone = (t) => t.gtd_status === "done" || !!t.completed_at;
  // Penanda kolom task SAJA (progress/pomodoro) — SENGAJA tanpa aktual: "sudah mulai karena actual.start" (K30) diperiksa
  // di situs jangkar forward pass (TLSched.actualOf atas it.sched), satu-satunya pemanggil predikat ini.
  const isStarted = (t) => Number(t.progress) > 0 || Number(t.pomodoros_done) > 0;
  const parentOf = (t) => (t.parent_id !== undefined && t.parent_id !== null ? t.parent_id : t.parent_cid);

  // Antrean prioritas min atas bilangan peringkat (Kahn terurut kunci).
  function heapPush(h, v) {
    h.push(v);
    let i = h.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (h[p] <= v) break;
      h[i] = h[p];
      i = p;
    }
    h[i] = v;
  }
  function heapPop(h) {
    const top = h[0];
    const last = h.pop();
    if (h.length) {
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        if (l >= h.length) break;
        const r = l + 1;
        const m = r < h.length && h[r] < h[l] ? r : l;
        if (h[m] >= last) break;
        h[i] = h[m];
        i = m;
      }
      h[i] = last;
    }
    return top;
  }

  // Tarjan iteratif (tanpa rekursi). keys terurut, adj: Map<key, key[] terurut>. → komponen (urutan selesai Tarjan).
  function tarjan(keys, adj) {
    const index = new Map();
    const low = new Map();
    const onStack = new Set();
    const stack = [];
    const comps = [];
    let counter = 0;
    for (const v of keys) {
      if (index.has(v)) continue;
      index.set(v, counter);
      low.set(v, counter);
      counter++;
      stack.push(v);
      onStack.add(v);
      const work = [{ u: v, i: 0 }];
      while (work.length) {
        const top = work[work.length - 1];
        const nb = adj.get(top.u) || [];
        if (top.i < nb.length) {
          const w = nb[top.i++];
          if (!index.has(w)) {
            index.set(w, counter);
            low.set(w, counter);
            counter++;
            stack.push(w);
            onStack.add(w);
            work.push({ u: w, i: 0 });
          } else if (onStack.has(w) && index.get(w) < low.get(top.u)) low.set(top.u, index.get(w));
        } else {
          work.pop();
          const u = top.u;
          if (work.length) {
            const p = work[work.length - 1].u;
            if (low.get(u) < low.get(p)) low.set(p, low.get(u));
          }
          if (low.get(u) === index.get(u)) {
            const comp = [];
            let w;
            do {
              w = stack.pop();
              onStack.delete(w);
              comp.push(w);
            } while (w !== u);
            comps.push(comp);
          }
        }
      }
    }
    return comps;
  }

  // run({tasks, cal, units, readExt}) → Result (lihat laporan Task 2 / spec §5.5). tasks = daftar lengkap scope;
  // cal = TLCal.compile(...); units = Map<recId, {auto}>; readExt(task) → ext mentah tanpa prefiks.
  function run(input) {
    const a = isObj(input) ? input : {};
    const c = a.cal;
    const units = a.units instanceof Map ? a.units : new Map();
    const readExt = typeof a.readExt === "function" ? a.readExt : (t) => (t && isObj(t.ext) ? t.ext : {});

    // 1. task hidup: buang berulang / archived / deleted / tanpa id; duplikat kunci → yang pertama. Urut kunci.
    const items = [];
    const byKey = new Map();
    for (const t of Array.isArray(a.tasks) ? a.tasks : []) {
      if (!isObj(t) || t.id === undefined || t.id === null) continue;
      if (t.recurrence_type || t.gtd_status === "archived" || t.archived || t.deleted) continue;
      const key = String(t.id);
      if (byKey.has(key)) continue;
      let raw;
      try {
        raw = readExt(t);
      } catch (e) {
        raw = {};
      }
      if (!isObj(raw)) raw = {};
      const sched = SCHED.readSched(raw);
      const s = sched.start === null ? null : CAL.dn(sched.start);
      const durOk = isInt(raw.duration) && raw.duration >= 0 && raw.duration <= DUR_MAX;
      const it = {
        key,
        task: t,
        sched,
        s,
        d: durOk ? raw.duration : 1,
        durGuess: !durOk,
        mode: SCHED.modeOf(sched, units, t),
        scope: SCHED.scopeKeyOf(t),
        g: SCHED.unitOf(t).recId,
      };
      byKey.set(key, it);
      items.push(it);
    }
    items.sort((x, y) => cmp(x.key, y.key));
    const index = SCHED.buildIndex(items.map((it) => it.task));

    // 2. ringkasan: punya anak hidup (parent_id / parent_cid terpecahkan ke task lain)
    const summaries = new Map();
    for (const it of items) {
      const p = parentOf(it.task);
      if (p === undefined || p === null || p === "") continue;
      const parent = index.get(String(p));
      if (!parent) continue;
      const pk = String(parent.id);
      if (pk === it.key) continue;
      if (!summaries.has(pk)) summaries.set(pk, []);
      summaries.get(pk).push(it.key);
    }
    for (const list of summaries.values()) list.sort(cmp);

    // 3. sisi kandidat dari deps penerus (urutan deps tersimpan); alasan diabaikan: unresolved → scope → summary.
    const ignored = [];
    const cand = []; // {from, to, type, lag}
    const seenPair = new Set();
    for (const it of items) {
      for (const dep of it.sched.deps) {
        const pt = index.get(dep.key);
        const from = pt ? String(pt.id) : dep.key;
        const pair = from + "\u0000" + it.key;
        if (seenPair.has(pair)) continue;
        seenPair.add(pair);
        if (!pt) ignored.push({ from, to: it.key, reason: "unresolved" });
        else if (byKey.get(from).scope !== it.scope) ignored.push({ from, to: it.key, reason: "scope" });
        else if (summaries.has(from) || summaries.has(it.key)) ignored.push({ from, to: it.key, reason: "summary" });
        else cand.push({ from, to: it.key, type: dep.type, lag: dep.lag });
      }
    }

    // 4. simpul: non-ringkasan dengan Mulai; lalu (BFS) tanpa Mulai, otomatis, belum selesai, dengan pendahulu simpul.
    const isNode = new Set();
    for (const it of items) if (it.s !== null && !summaries.has(it.key)) isNode.add(it.key);
    const candFrom = new Map();
    for (const e of cand) {
      if (!candFrom.has(e.from)) candFrom.set(e.from, []);
      candFrom.get(e.from).push(e.to);
    }
    const queue = [...isNode];
    while (queue.length) {
      const k = queue.pop();
      for (const to of candFrom.get(k) || []) {
        if (isNode.has(to)) continue;
        const it = byKey.get(to);
        if (it.s !== null || it.mode !== "auto" || isDone(it.task)) continue;
        isNode.add(to);
        queue.push(to);
      }
    }
    const nodeKeys = items.filter((it) => isNode.has(it.key)).map((it) => it.key); // terurut

    // 5. graf: sisi dengan kedua ujung simpul; selain itu notNode.
    const edges = [];
    for (const e of cand) {
      if (isNode.has(e.from) && isNode.has(e.to)) edges.push(e);
      else ignored.push({ from: e.from, to: e.to, reason: "notNode" });
    }
    const adj = new Map(nodeKeys.map((k) => [k, []]));
    for (const e of edges) adj.get(e.from).push(e.to);
    for (const l of adj.values()) l.sort(cmp);

    // 6. Tarjan: komponen > 1 atau sisi diri = lingkaran; sisi di dalamnya diabaikan ("cycle").
    const comps = tarjan(nodeKeys, adj);
    const compOf = new Map();
    comps.forEach((comp, i) => comp.forEach((k) => compOf.set(k, i)));
    const selfLoop = new Set(edges.filter((e) => e.from === e.to).map((e) => e.from));
    const inCycle = new Set();
    const cycles = [];
    for (const comp of comps) {
      if (comp.length > 1 || selfLoop.has(comp[0])) {
        const sorted = comp.slice().sort(cmp);
        sorted.forEach((k) => inCycle.add(k));
        cycles.push(sorted);
      }
    }
    cycles.sort((x, y) => cmp(x[0], y[0]));

    const succ = new Map(nodeKeys.map((k) => [k, []]));
    const succE = new Map(nodeKeys.map((k) => [k, []]));
    const pred = new Map(nodeKeys.map((k) => [k, []]));
    for (const e of edges) {
      if (compOf.get(e.from) === compOf.get(e.to)) {
        ignored.push({ from: e.from, to: e.to, reason: "cycle" });
        continue;
      }
      pred.get(e.to).push({ key: e.from, type: e.type, lag: e.lag });
      succE.get(e.from).push({ key: e.to, type: e.type, lag: e.lag });
    }
    for (const [k, l] of succE) {
      l.sort((x, y) => cmp(x.key, y.key));
      succ.set(k, l.map((x) => x.key));
    }
    ignored.sort((x, y) => cmp(x.to, y.to) || cmp(x.from, y.from));

    // 7. Kahn terurut kunci (antrean min atas peringkat).
    const rank = new Map(nodeKeys.map((k, i) => [k, i]));
    const indeg = new Map(nodeKeys.map((k) => [k, pred.get(k).length]));
    const heap = [];
    for (const k of nodeKeys) if (indeg.get(k) === 0) heapPush(heap, rank.get(k));
    const order = [];
    while (heap.length) {
      const k = nodeKeys[heapPop(heap)];
      order.push(k);
      for (const s of succ.get(k)) {
        const n = indeg.get(s) - 1;
        indeg.set(s, n);
        if (n === 0) heapPush(heap, rank.get(s));
      }
    }

    // 8. forward pass
    const nodes = new Map();
    const uncomputable = new Set();
    const drift = new Set();
    for (const k of order) {
      const it = byKey.get(k);
      const t = it.task;
      const d = it.d;
      const cst = it.sched.constraint;
      // Aktual (1c-2, K30) dari bacaan ext yang SAMA (it.sched = readSched(readExt(t))) — tidak ada sumber kedua.
      const act = SCHED.actualOf(t, it.sched);
      const s0 = act.start !== null ? act.start : it.s; // mulai jangkar selesai/berjalan = actual.start ?? Mulai
      let fixed = null;
      if (isDone(t)) fixed = "done";
      else if (inCycle.has(k)) fixed = "cycle";
      else if (it.mode === "manual") fixed = "manual";
      else if ((isStarted(t) || act.start !== null) && s0 !== null) fixed = "started";
      else if (cst && cst.type === "MFO") fixed = "mfo";

      const n = { key: k, task: t, es: null, ef: null, ls: null, lf: null, slack: null, critical: false, mode: it.mode };
      if (fixed) n.fixed = fixed;
      if (it.durGuess) n.durGuess = true;
      n.d = d;
      n.g = it.g;
      n.late = null;
      nodes.set(k, n);

      const preds = pred.get(k);
      let es;
      let ef;
      if (fixed) {
        n.driver = { kind: "fixed" };
        if (fixed === "mfo") {
          const md = CAL.dn(cst.date);
          ef = d >= 1 ? safe(() => CAL.prevWork(c, md)) : md;
          es = isDn(ef) ? SCHED.sff(c, ef, d) : undefined;
        } else if (fixed === "done" || fixed === "started") {
          // selesai: ef = maks(es, actual.finish ?? jkt(completed_at) ?? fin(es, d)); berjalan: ef = fin(es, d)
          if (s0 !== null) {
            es = s0;
            ef = fixed === "done" ? SCHED.doneFinish(c, t, it.sched, es, d) : SCHED.fin(c, es, d);
          }
        } else if (it.s !== null) {
          es = it.s; // manual / lingkaran: tanggal tersimpan
          ef = SCHED.fin(c, es, d);
        }
        if (isDn(es) && isDn(ef)) {
          for (const p of preds) {
            const pn = nodes.get(p.key);
            if (pn.es === null) continue;
            const r = SCHED.depReq(c, p.type, pn.es, pn.ef, p.lag, d);
            if (isDn(r) && SCHED.isEarly(c, es, r)) {
              n.conflict = true;
              break;
            }
          }
        }
      } else {
        let best = null;
        let driver = null;
        let bad = false;
        for (const p of preds) {
          const pn = nodes.get(p.key);
          const r = pn.es === null ? undefined : SCHED.depReq(c, p.type, pn.es, pn.ef, p.lag, d);
          if (!isDn(r)) {
            bad = true; // pendahulu tak terhitung → penerus tak terhitung (tidak menebak ES lebih awal)
            break;
          }
          if (best === null || r > best) {
            best = r;
            driver = { kind: "pred", from: p.key, type: p.type, lag: p.lag };
          }
        }
        if (!bad) {
          if (cst && cst.type === "SNET") {
            const sd = CAL.dn(cst.date);
            if (best === null || sd > best) {
              best = sd;
              driver = { kind: "snet" };
            }
          }
          if (!preds.length && it.s !== null && (best === null || it.s > best)) {
            best = it.s;
            driver = { kind: "root" };
          }
        }
        n.driver = driver || { kind: "root" };
        if (!bad && best !== null) {
          es = d >= 1 ? safe(() => CAL.nextWork(c, best)) : best;
          ef = isDn(es) ? SCHED.fin(c, es, d) : undefined;
        }
      }
      if (isDn(es) && isDn(ef)) {
        n.es = es;
        n.ef = ef;
        n.late = SCHED.deadlineLate(c, ef, t.deadline);
        if (!fixed && CAL.iso(es) !== it.sched.start) drift.add(k);
      } else {
        delete n.conflict;
        uncomputable.add(k);
      }
    }

    // 9. akhir kelompok project: P_g = maks EF simpul kelompok
    const groupEnd = new Map();
    for (const n of nodes.values()) {
      if (n.ef === null) continue;
      const cur = groupEnd.get(n.g);
      if (cur === undefined || n.ef > cur) groupEnd.set(n.g, n.ef);
    }

    // 10. backward pass (topologis terbalik), slack, kritis
    for (let i = order.length - 1; i >= 0; i--) {
      const k = order[i];
      const n = nodes.get(k);
      if (n.es === null) continue;
      const d = n.d;
      let lf = groupEnd.get(n.g);
      const dl = deadlineDn(n.task);
      if (isDn(dl)) {
        const cap = d >= 1 ? safe(() => CAL.prevWork(c, dl)) : dl;
        if (isDn(cap) && cap < lf) lf = cap;
      }
      if (n.fixed === "mfo" && n.ef < lf) lf = n.ef;
      for (const e of succE.get(k)) {
        const sn = nodes.get(e.key);
        if (sn.ls === null) continue;
        const lim = SCHED.depLimit(c, e.type, sn.ls, sn.lf, e.lag, d);
        if (isDn(lim) && lim < lf) lf = lim;
      }
      const ls = SCHED.sff(c, lf, d);
      if (!isDn(ls)) continue;
      n.lf = lf;
      n.ls = ls;
      if (n.fixed === "done") continue; // slack null, tidak kritis
      let slack;
      if (lf >= n.ef) slack = CAL.workdays(c, n.ef + 1, Math.min(lf, n.ef + SPAN_MAX));
      else slack = -CAL.workdays(c, lf + 1, Math.min(n.ef, lf + SPAN_MAX));
      slack = slack === 0 ? 0 : slack; // tanpa −0
      n.slack = slack;
      n.critical = slack <= 0;
    }

    return {
      nodes,
      order,
      succ,
      pred,
      cycles,
      ignored,
      groupEnd,
      drift,
      summaries,
      uncomputable,
    };
  }

  // ---- explain: "Kenapa dijadwalkan di sini?" (spec 1c §5.6) ----
  // Dipanggil untuk SATU task sesuai permintaan (popover), tidak di jalur render. TIDAK menghitung jadwal sendiri: tanggal
  // (start/finish/late) dibaca dari hasil run(); rumus dependensi hanya dipakai ulang (TLSched.depReq) untuk memisahkan
  // "hari lag" dari "hari yang dilewati", jadi tidak mungkin berbeda dari mesin.

  // Hari non-kerja → {dn, why, name?}. Akhir pekan didahulukan atas libur bernama (Sabtu/Minggu yang kebetulan libur nasional
  // tetap "Sabtu"/"Minggu"); hari kerja biasa yang dikecualikan kalender (mis. Jumat dinonaktifkan, atau libur tambahan
  // buatan pengguna) = "tambahan" tanpa nama (nama libur tambahan tidak disimpan di kalender terkompilasi).
  function nonWorkInfo(c, n) {
    const wd = CAL.isoWeekday(n);
    if (!c.mask.has(wd)) return wd === 6 ? { dn: n, why: "Sabtu" } : wd === 7 ? { dn: n, why: "Minggu" } : { dn: n, why: "tambahan" };
    const h = HOL && typeof HOL.lookup === "function" ? HOL.lookup(CAL.iso(n)) : null;
    if (h && ((h.kind === "libur" && c.national) || (h.kind === "cuti" && c.cutiBersama))) return { dn: n, why: h.kind, name: h.nama };
    return { dn: n, why: "tambahan" };
  }

  // Hari non-kerja di [from, to] inklusif, berurut (rentang dibatasi SPAN_MAX).
  function nonWorkIn(c, from, to) {
    const out = [];
    if (!isDn(from) || !isDn(to)) return out;
    for (let d = from, hi = Math.min(to, from + SPAN_MAX); d <= hi; d++) if (!CAL.isWork(c, d)) out.push(nonWorkInfo(c, d));
    return out;
  }

  // Hari kerja di [from, to) (setengah terbuka), berurut.
  function workIn(c, from, to) {
    const out = [];
    for (let d = from, hi = Math.min(to - 1, from + SPAN_MAX); d <= hi; d++) if (CAL.isWork(c, d)) out.push(d);
    return out;
  }

  // PENTING: `cal` HARUS kalender terkompilasi yang sama dengan yang diberikan ke run(); kalender lain membuat atribusi
  // hari yang dilewati (skipped/lagDays/durSkipped) bisa berbeda dari mesin. Tanpa `readExt`, `base` untuk root/snet = null
  // (Task 4+ wajib meneruskannya).
  // explain(result, key, cal, readExt?) → {kind, base, lagDays, start, skipped, finish, durSkipped, late, deadline, pred?, type?, lag?, cycleWith?}
  //   kind: pred | root | snet | mfo | manual | done | started | cycle | unscheduled
  //   base = titik acuan: FS/FF → selesai pendahulu, SS/SF → mulai pendahulu; snet → tanggal batasan; root → tanggal mulai
  //   tersimpan (dua yang terakhir butuh readExt, tanpanya null); lainnya null.
  //   lagDays = hari kerja yang dipakai lag (selisih syarat lag 0 dan syarat ber-lag: [min, max) hari kerja); lag 0 → [].
  //   skipped = hari non-kerja strictly di antara base dan start (hanya bila start > base; root/snet: dari base inklusif);
  //   durSkipped = hari non-kerja di dalam [start, finish] (milestone d = 0 → []); keduanya tidak pernah tumpang tindih.
  //   late = hari kerja lewat tenggat (0 bila tepat/tanpa tenggat); deadline = hari tenggat atau null.
  //   cycle → cycleWith = anggota lingkaran lain (terurut cmpKey; anggota yang selesai → kind done, tanpa cycleWith); unscheduled → semua tanggal null.
  function explain(result, key, cal, readExt) {
    const k = String(key);
    const out = (kind, extra) =>
      Object.assign({ kind, base: null, lagDays: [], start: null, skipped: [], finish: null, durSkipped: [], late: 0, deadline: null }, extra);
    const nodes = isObj(result) && result.nodes instanceof Map ? result.nodes : null;
    const n = nodes ? nodes.get(k) : undefined;
    const ring = isObj(result) && Array.isArray(result.cycles) ? result.cycles.find((cy) => cy.indexOf(k) >= 0) : undefined;
    // Prioritas jangkar mesin: done > cycle → anggota lingkaran yang selesai dijelaskan sebagai "done" (tanggal dari completed_at).
    const cycleWith = ring && !(n && n.fixed === "done") ? ring.filter((x) => x !== k).sort(cmpKey) : null;
    if (!n || n.es === null || n.ef === null || !isObj(cal)) return cycleWith ? out("cycle", { cycleWith }) : out("unscheduled");

    const c = cal;
    const dl = deadlineDn(n.task);
    const e = out(cycleWith ? "cycle" : n.fixed || n.driver.kind, {
      start: n.es,
      finish: n.ef,
      late: n.late || 0,
      deadline: isDn(dl) ? dl : null,
      durSkipped: n.d >= 1 ? nonWorkIn(c, n.es, n.ef) : [],
    });
    if (cycleWith) e.cycleWith = cycleWith;
    if (e.kind === "pred") {
      const dr = n.driver;
      const pn = nodes.get(dr.from);
      e.pred = dr.from;
      e.type = dr.type;
      e.lag = dr.lag;
      e.base = dr.type === "SS" || dr.type === "SF" ? pn.es : pn.ef;
      // hari lag: syarat ber-lag vs syarat lag 0 (rumus yang sama dengan mesin → tidak bisa berbeda)
      const r = SCHED.depReq(c, dr.type, pn.es, pn.ef, dr.lag, n.d);
      const r0 = SCHED.depReq(c, dr.type, pn.es, pn.ef, 0, n.d);
      if (isDn(r) && isDn(r0) && r !== r0) e.lagDays = workIn(c, Math.min(r, r0), Math.max(r, r0));
      if (e.start > e.base) e.skipped = nonWorkIn(c, e.base + 1, e.start - 1);
    } else if ((e.kind === "snet" || e.kind === "root") && typeof readExt === "function") {
      // acuan tersimpan: tanggal batasan SNET, atau tanggal Mulai akar (bisa jatuh di akhir pekan → digeser)
      let sched = null;
      try {
        sched = SCHED.readSched(readExt(n.task));
      } catch (err) {
        sched = null;
      }
      const ref = sched ? (e.kind === "snet" ? (sched.constraint ? sched.constraint.date : null) : sched.start) : null;
      const b = ref === null ? NaN : CAL.dn(ref);
      if (isDn(b)) {
        e.base = b;
        if (e.start > b) e.skipped = nonWorkIn(c, b, e.start - 1);
      }
    }
    return e;
  }

  return Object.freeze({ run, jkt, cmpKey, explain });
})(
  typeof TLCal !== "undefined" ? TLCal : require("./calendar.js"),
  typeof TLSched !== "undefined" ? TLSched : require("./schedule.js"),
  typeof TLHolidays !== "undefined" ? TLHolidays : require("./holidays-id.js"),
);
if (typeof module !== "undefined" && module.exports) module.exports = TLCpm;
// part: plan.js
// Plugin Timeline — TLPlan: rencana tulis murni (spec 1c §5.7, rencana 1c-1 R11, R12, R14, R17; K32–K36).
// Mengubah hasil mesin (TLCpm.run) menjadi daftar item {task, key, before, patch, deltaHk, kind} yang diterapkan UI lewat
// satu api.taskExt.setMany. Murni: tanpa Date, tanpa global, tanpa akses api/store, TIDAK menulis (K27) dan tidak mengubah
// masukan (ctx, tasks, units, patch). Tanggal dijadwalkan HANYA oleh TLCpm.run atas data + patch (aliran = mesin dijalankan
// ulang, bukan dihitung di sini); rumus dependensi lewat TLSched (satu sumber, R4); urutan = result.order (topologis) lalu
// TLCpm.cmpKey. ctx = {tasks, cal, units, readExt} = masukan run().
// 1c-2 (K41): kodek baseline (encode/decode/ukuran) + pembanding rencana-vs-baseline — murni, tanpa tulisan.
const TLPlan = (function (CAL, SCHED, CPM) {
  const CASCADE_MAX = 20; // K32: turunan berubah > 20 → pratinjau dulu
  const SPAN_MAX = 3660; // rentang hari kalender maks untuk hitung Δ hk (pola MAX_LATE_SPAN)
  const DUR_MAX = SCHED.DUR_MAX;
  const KEYS = ["start", "duration", "constraint", "mode"]; // kunci `before` (R11)
  const cmpKey = CPM.cmpKey;

  const isObj = (o) => o !== null && typeof o === "object" && !Array.isArray(o);
  const isDn = (n) => Number.isInteger(n);
  const isDur = (d) => Number.isInteger(d) && d >= 0 && d <= DUR_MAX;
  const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const keyOf = (t) => (isObj(t) && t.id !== undefined && t.id !== null ? String(t.id) : null);
  const clone = (v) => (v === undefined ? null : JSON.parse(JSON.stringify(v)));
  const startDn = (s) => (typeof s === "string" ? CAL.dn(s) : NaN); // Mulai tersimpan sah → bilangan hari, selain itu NaN
  // Penanda "sudah mulai" K30 (1c-2): progress/pomodoro ATAU actual.start tercatat (TLSched.actualOf atas ext mentah —
  // satu-satunya pembaca aktual). Dipakai reschedule untuk task Manual (task otomatis: n.fixed === "started" dari mesin).
  const hasActualStart = (ctx, t) => SCHED.actualOf(t, rawOf(ctx, t)).start !== null;
  const isStarted = (ctx, t) => Number(t.progress) > 0 || Number(t.pomodoros_done) > 0 || hasActualStart(ctx, t);

  function safe(fn) {
    try {
      return fn();
    } catch (e) {
      if (e instanceof Error && e.message === "TL_CAL_LOOP") return undefined;
      throw e;
    }
  }

  // Ext mentah task (tanpa prefiks) — fallback dan penanganan lempar sama dengan run().
  function rawOf(ctx, task) {
    let raw;
    try {
      raw = typeof ctx.readExt === "function" ? ctx.readExt(task) : task && isObj(task.ext) ? task.ext : {};
    } catch (e) {
      raw = {};
    }
    return isObj(raw) ? raw : {};
  }

  // Bentuk kanonik untuk CAS: urutan kunci objek tidak relevan; undefined = null.
  function canon(v) {
    if (v === undefined || v === null) return "null";
    if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
    if (typeof v === "object") return "{" + Object.keys(v).sort(cmpKey).map((k) => JSON.stringify(k) + ":" + canon(v[k])).join(",") + "}";
    return JSON.stringify(v);
  }

  // Selisih hari kerja bertanda a → b: maju = hari kerja [a, b), mundur = −hari kerja [b, a); rentang dibatasi.
  function wdDelta(c, a, b) {
    if (!isDn(a) || !isDn(b)) return null;
    if (a <= b) return a === b ? 0 : CAL.workdays(c, a, Math.min(b - 1, a + SPAN_MAX));
    const n = CAL.workdays(c, b, Math.min(a - 1, b + SPAN_MAX));
    return n === 0 ? 0 : -n;
  }

  // Patch gestur → bentuk bersih sanitizePatch bila sah (deps bentuk readSched → bentuk ext); tak sah → salinan apa adanya.
  function cleanPatch(p) {
    const s = SCHED.sanitizePatch(p);
    return s.ok ? s.patch : clone(p);
  }

  // Ext mentah + patch (null = hapus kunci) → ext baru; masukan tidak diubah.
  function mergeRaw(raw, patch) {
    const out = clone(raw);
    for (const k of Object.keys(patch)) {
      if (patch[k] === null) delete out[k];
      else out[k] = clone(patch[k]);
    }
    return out;
  }

  // Patch hasil mesin untuk simpul otomatis non-jangkar: start = iso(es) bila beda dari tersimpan; tanpa Mulai tersimpan
  // (baru dijadwalkan) + durasi hilang → duration 1. Jangkar / tak terhitung / bukan simpul → {}.
  function enginePatch(n, raw) {
    const out = {};
    if (!n || n.fixed || n.es === null) return out;
    const s = CAL.iso(n.es);
    if (s !== raw.start) out.start = s;
    if (!isDn(startDn(raw.start)) && n.durGuess) out.duration = 1;
    return out;
  }

  // Item rencana (R11). before = nilai MENTAH ext (kunci tak ada → null) agar Urungkan persis; patch membawa `deps`
  // (gestur tautkan) → before juga memuat deps lama.
  function mkItem(c, task, raw, patch) {
    const before = {};
    for (const k of KEYS) before[k] = clone(raw[k]);
    if (has(patch, "deps")) before.deps = clone(raw.deps);
    const old = startDn(raw.start);
    const next = has(patch, "start") ? patch.start : raw.start;
    let kind = "move";
    if (has(patch, "start") && patch.start !== null && !isDn(old)) kind = "new";
    else if (has(patch, "start") && patch.start !== raw.start) kind = "move";
    else if (has(patch, "duration")) kind = "duration";
    else if (has(patch, "constraint")) kind = "constraint";
    else if (has(patch, "mode")) kind = "mode";
    const deltaHk = isDn(old) && isDn(startDn(next)) ? wdDelta(c, old, startDn(next)) : null;
    return { task, key: keyOf(task), before, patch, deltaHk, kind };
  }

  // Urut item topologis menurut result.order; kunci di luar order (bukan simpul) di akhir, cmpKey.
  function sortTopo(items, result) {
    const pos = new Map(result.order.map((k, i) => [k, i]));
    const at = (k) => (pos.has(k) ? pos.get(k) : Infinity);
    return items.sort((a, b) => at(a.key) - at(b.key) || cmpKey(a.key, b.key));
  }

  // Kunci yang terjangkau dari seeds lewat result.succ (semua tipe), termasuk seeds; opsional + anggota lingkaran penuh.
  function reach(result, seeds, withCycles) {
    const seen = new Set();
    const stack = [];
    for (const k of seeds) {
      if (!result.nodes.has(k) || seen.has(k)) continue;
      seen.add(k);
      stack.push(k);
    }
    while (stack.length) {
      for (const s of result.succ.get(stack.pop()) || []) {
        if (!seen.has(s)) {
          seen.add(s);
          stack.push(s);
        }
      }
    }
    if (withCycles) for (const cy of result.cycles) if (cy.some((k) => seen.has(k))) cy.forEach((k) => seen.add(k));
    return seen;
  }

  const isResult = (r) => isObj(r) && r.nodes instanceof Map && Array.isArray(r.order);

  // Apakah operasi menggeser simpul ini (es/ef/d sesudah ≠ sebelum; bukan simpul sebelumnya = berubah).
  const shifted = (bn, an) => !bn || bn.es !== an.es || bn.ef !== an.ef || bn.d !== an.d;

  // Inti aliran (K32): mesin atas data + patch → item = patch (+ start hasil mesin bila task otomatis non-jangkar) ∪
  // turunan otomatis non-jangkar (BFS result.succ dari seeds) yang DIGESER operasi ini (hasil sesudah ≠ hasil sebelum)
  // DAN berbeda dari nilai tersimpan (patch relatif ke tersimpan). Drift yang tidak digeser operasi — di luar turunan,
  // di belakang jangkar yang tidak bergeser, atau turunan yang ES-nya tetap — tidak pernah ikut. patches: Map<key,
  // {task, patch}>; seedsOf(after) → kunci awal BFS; before = hasil mesin atas ctx tanpa patch (tidak ada → dihitung).
  function flow(ctx, patches, units, seedsOf, before) {
    const c = ctx.cal;
    const prior = isResult(before) ? before : CPM.run({ tasks: ctx.tasks, cal: c, units: ctx.units, readExt: (t) => rawOf(ctx, t) });
    const merged = new Map();
    for (const [k, g] of patches) merged.set(k, mergeRaw(rawOf(ctx, g.task), g.patch));
    const read = (t) => {
      const k = keyOf(t);
      return k !== null && merged.has(k) ? clone(merged.get(k)) : rawOf(ctx, t);
    };
    const after = CPM.run({ tasks: ctx.tasks, cal: c, units, readExt: read });
    const items = [];
    for (const [k, g] of patches) {
      const extra = enginePatch(after.nodes.get(k), merged.get(k));
      items.push(mkItem(c, g.task, rawOf(ctx, g.task), Object.assign({}, g.patch, extra)));
    }
    for (const k of reach(after, seedsOf(after), false)) {
      if (patches.has(k)) continue;
      const n = after.nodes.get(k);
      if (!shifted(prior.nodes.get(k), n)) continue;
      const raw = rawOf(ctx, n.task);
      const p = enginePatch(n, raw);
      if (Object.keys(p).length) items.push(mkItem(c, n.task, raw, p));
    }
    return { items: sortTopo(items, after), result: after };
  }

  // Pasangan pendahulu→penerus yang dilanggar (TLSched.violations atas rentang hasil mesin); keep(kunci penerus) menyaring.
  function violated(c, res, keep) {
    const out = new Set();
    if (!isObj(res) || !(res.nodes instanceof Map) || !(res.pred instanceof Map)) return out;
    const spans = new Map();
    for (const [k, n] of res.nodes) if (n.es !== null) spans.set(k, { s: n.es, f: n.ef, d: n.d });
    const edges = [];
    for (const [to, list] of res.pred) {
      if (keep(to)) for (const p of list) edges.push({ from: p.key, to, type: p.type, lag: p.lag, ok: true });
    }
    for (const d of SCHED.violations(c, spans, edges).detail) out.add(d.pred + "\u0000" + d.succ);
    return out;
  }

  // Jumlah pelanggaran BARU (ada di after, tidak di before).
  function newBroken(c, before, after, keep) {
    const old = violated(c, before, keep);
    let n = 0;
    for (const p of violated(c, after, keep)) if (!old.has(p)) n++;
    return n;
  }

  // ---- API ----

  // diff (R11): simpul otomatis non-jangkar yang iso(es) ≠ Mulai tersimpan atau tanpa Mulai ("new", duration 1 bila hilang).
  // result = run(ctx); onlyKeys (Set) membatasi (mis. drift halaman). Urutan = result.order.
  function diff(result, ctx, onlyKeys) {
    const items = [];
    for (const k of result.order) {
      if (onlyKeys instanceof Set && !onlyKeys.has(k)) continue;
      const n = result.nodes.get(k);
      const raw = rawOf(ctx, n.task);
      const p = enginePatch(n, raw);
      if (Object.keys(p).length) items.push(mkItem(ctx.cal, n.task, raw, p));
    }
    return items;
  }

  // cascade (K32, R13): gestures [{task, patch}] (patch sudah lewat gesture()); patch ganda untuk task sama digabung.
  // before (opsional) = run(ctx) yang sudah dimiliki pemanggil (mis. useEngine) agar mesin tidak dijalankan dua kali.
  // → {items, gestureCount, over, result: hasil mesin sesudah}. over = turunan yang digeser > CASCADE_MAX.
  function cascade(ctx, gestures, before) {
    const patches = new Map();
    for (const g of Array.isArray(gestures) ? gestures : []) {
      const k = g ? keyOf(g.task) : null;
      if (k === null || !isObj(g.patch)) continue;
      const prev = patches.get(k);
      patches.set(k, { task: g.task, patch: Object.assign(prev ? prev.patch : {}, cleanPatch(g.patch)) });
    }
    const r = flow(ctx, patches, ctx.units, () => [...patches.keys()], before);
    const gestureCount = patches.size;
    return { items: r.items, gestureCount, over: r.items.length - gestureCount > CASCADE_MAX, result: r.result };
  }

  // toggleUnit (K40, R15): units baru (salinan, auto = on). ON → item = simpul unit yang mode efektifnya berubah ke
  // otomatis + turunannya, yang hasilnya berbeda dari tersimpan (akar tetap tidak berubah). OFF → tanpa item task.
  function toggleUnit(ctx, recId, on) {
    const units = new Map(ctx.units instanceof Map ? ctx.units : []);
    const prev = units.get(recId);
    units.set(recId, Object.assign({}, isObj(prev) ? prev : {}, { auto: !!on }));
    if (!on) return { items: [], units, result: null };
    const seedsOf = (after) =>
      after.order.filter((k) => {
        const n = after.nodes.get(k);
        return n.g === recId && n.mode === "auto" && SCHED.modeOf(rawOf(ctx, n.task), ctx.units, n.task) !== "auto";
      });
    const r = flow(ctx, new Map(), units, seedsOf);
    return { items: r.items, units, result: r.result };
  }

  // reschedule (K36, R17): T = bilangan hari (atau ISO) hari kerja pertama ≥ hari ini; unitKeys = Set recId unit halaman.
  // Per simpul unit halaman (tak selesai, terhitung), urut topologis:
  //  - sudah mulai (jangkar "started", atau Manual dengan progress/pomodoro/actual.start — K30), durasi ≥ 1, EF < T → Mulai tetap,
  //    duration = hari kerja Mulai..add(T, r − 1), r = max(1, ⌈d × (1 − progress/100)⌉), dijepit ≤ 999;
  //  - milestone (d = 0) yang sudah mulai ikut cabang belum-mulai (amandemen K36): durasi TIDAK pernah ditulis
  //    (berlian tidak boleh diam-diam menjadi bar). Otomatis → constraint SNET T + start T (start ditulis eksplisit karena
  //    jangkar "started" mesin berdiri di Mulai tersimpan; tanpa itu SNET tidak berpengaruh); Manual → start T;
  //    1c-2: milestone OTOMATIS ber-actual.start DILEWATI seluruhnya — jangkar mesin = actual.start, jadi start/SNET
  //    inert; Manual ber-actual.start tetap start T (jangkar Manual = tanggal tersimpan, tulisan efektif);
  //  - belum mulai dan Mulai (ES) < T → Manual: start T (milestone ikut); otomatis non-jangkar: constraint SNET T
  //    (+ start hasil mesin); lingkaran/MFO otomatis tidak disentuh.
  // Lalu aliran tanpa ambang (penerus otomatis ikut; penerus Manual tidak dipindah). broken = pelanggaran BARU dengan
  // penerus Manual. → {items, broken, result: hasil mesin sesudah}.
  function reschedule(ctx, result, T, unitKeys) {
    const c = ctx.cal;
    const t = typeof T === "string" ? CAL.dn(T) : T;
    if (!isDn(t) || !isObj(result) || !(result.nodes instanceof Map) || !(unitKeys instanceof Set)) return { items: [], broken: 0, result: null };
    const tIso = CAL.iso(t);
    const patches = new Map();
    for (const k of result.order) {
      const n = result.nodes.get(k);
      if (!unitKeys.has(n.g) || n.es === null || n.fixed === "done") continue;
      const task = n.task;
      const started = n.fixed === "started" || (n.mode === "manual" && isStarted(ctx, task));
      if (started && n.d >= 1) {
        if (n.ef >= t) continue;
        const p = Math.min(100, Math.max(0, Number(task.progress) || 0));
        const r = Math.max(1, Math.ceil(n.d * (1 - p / 100)));
        const end = safe(() => CAL.addWork(c, t, r - 1));
        if (!isDn(end)) continue;
        const dur = Math.min(DUR_MAX, CAL.workdays(c, n.es, Math.min(end, n.es + SPAN_MAX)));
        if (dur !== rawOf(ctx, task).duration) patches.set(k, { task, patch: { duration: dur } });
        continue;
      }
      if (n.es >= t) continue;
      if (n.mode === "manual") patches.set(k, { task, patch: { start: tIso } });
      else if (started) {
        if (hasActualStart(ctx, task)) continue; // jangkar aktual menang: tulisan inert (K30/K36)
        patches.set(k, { task, patch: { constraint: { type: "SNET", date: tIso }, start: tIso } });
      }
      else if (!n.fixed) patches.set(k, { task, patch: { constraint: { type: "SNET", date: tIso } } });
    }
    const r = flow(ctx, patches, ctx.units, () => [...patches.keys()], result);
    const manual = (k) => {
      const n = r.result.nodes.get(k);
      return !!n && n.mode === "manual";
    };
    return { items: r.items, broken: newBroken(c, result, r.result, manual), result: r.result };
  }

  // gesture (K33, R12): task otomatis non-jangkar dengan patch.start → syarat req = maks depReq atas pendahulu terpakai
  // (result.pred; durasi = patch.duration bila sah, selain itu durasi simpul). start < req → {ok:false, reason:"early",
  // es: req}. Berpendahulu atau ber-SNET → + constraint SNET tanggal jatuh; akar tanpa SNET → patch apa adanya.
  // Selain itu (Manual, jangkar, bukan simpul, tanpa start) → {ok:true, patch} apa adanya (perilaku 1b / aliran K32).
  // Pilihan (bawaan Task 1): pembanding HARFIAH start < req, bukan TLSched.isEarly — jatuh di Sabtu sebelum syarat Senin
  // DITOLAK walau nw(Sabtu) = Senin, agar tanggal tersimpan tidak pernah lebih awal dari syarat dependensinya.
  function gesture(result, task, raw, patch, cal) {
    const p = Object.assign({}, patch);
    const k = keyOf(task);
    const n = k !== null && isObj(result) && result.nodes instanceof Map ? result.nodes.get(k) : undefined;
    if (!n || n.fixed || n.mode !== "auto" || typeof p.start !== "string") return { ok: true, patch: p };
    const sd = CAL.dn(p.start);
    if (!isDn(sd)) return { ok: true, patch: p };
    const d = isDur(p.duration) ? p.duration : n.d;
    const preds = (result.pred instanceof Map && result.pred.get(k)) || [];
    let req = null;
    for (const e of preds) {
      const pn = result.nodes.get(e.key);
      if (!pn || pn.es === null) continue;
      const r = SCHED.depReq(cal, e.type, pn.es, pn.ef, e.lag, d);
      if (isDn(r) && (req === null || r > req)) req = r;
    }
    if (req !== null && sd < req) return { ok: false, reason: "early", es: req };
    const cst = SCHED.readSched(raw).constraint;
    if (preds.length || (cst && cst.type === "SNET")) p.constraint = { type: "SNET", date: p.start };
    return { ok: true, patch: p };
  }

  // modePatch (R3): pilihan sama dengan mode unit → {mode: null} (hapus kunci, ikut project); selain itu {mode: want}.
  function modePatch(task, units, want) {
    const u = SCHED.unitFor(units, task); // penjaga fold unit sama dengan modeOf
    const unitMode = u && u.auto === true ? "auto" : "manual";
    return { mode: want === unitMode || (want !== "auto" && want !== "manual") ? null : want };
  }

  // preview (K34, R14): model murni pratinjau. result = hasil mesin SESUDAH (mis. cascade().result), before = hasil
  // SEBELUM; tanpa before → null (pelanggaran yang sudah ada tidak boleh dianggap baru). seedKeys (Set, opsional) ikut
  // jangkauan notMoved/brokenDeps — pratinjau sakelar memberi kunci simpul unit agar lingkaran/jangkar bertabrakan unit
  // yang tidak di hilir item tetap tercantum. rows per item (urutan item): {key, task, kind, from, to, deltaHk, durFrom, durTo, isNew,
  // durChanged, durGuess, late}. Selesai project = maks groupEnd kelompok item. notMoved = jangkar bertabrakan
  // ("anchor"/"mfo") dan anggota lingkaran ("cycle") yang terjangkau dari item (turunan + lingkarannya), bukan item.
  // brokenDeps = pelanggaran baru dengan penerus di jangkauan itu. Tanpa teks: "Kenapa" disusun UI dari TLCpm.explain.
  function preview(items, result, ctx, before, seedKeys) {
    if (!isResult(before)) return null;
    const c = ctx.cal;
    const list = Array.isArray(items) ? items : [];
    const nodes = result.nodes;
    const groups = new Set();
    const rows = list.map((it) => {
      const n = nodes.get(it.key);
      if (n) groups.add(n.g);
      const from = isDn(startDn(it.before.start)) ? it.before.start : null;
      const to = has(it.patch, "start") ? it.patch.start : from;
      const durFrom = isDur(it.before.duration) ? it.before.duration : null;
      const durTo = has(it.patch, "duration") ? it.patch.duration : durFrom;
      return {
        key: it.key,
        task: it.task,
        kind: it.kind,
        from,
        to,
        deltaHk: it.deltaHk,
        durFrom,
        durTo,
        isNew: it.kind === "new",
        // task baru dijadwalkan yang durasinya diisi 1 bukan "durasi berubah" (UI: "baru dijadwalkan" + catatan durGuess)
        durChanged: it.kind !== "new" && has(it.patch, "duration") && durTo !== durFrom,
        durGuess: !!(n && n.durGuess),
        late: n && n.late > 0 ? n.late : 0,
      };
    });
    const endOf = (res) => {
      let best = null;
      if (!isObj(res) || !(res.groupEnd instanceof Map)) return best;
      for (const g of groups) {
        const e = res.groupEnd.get(g);
        if (isDn(e) && (best === null || e > best)) best = e;
      }
      return best;
    };
    const endBefore = endOf(before);
    const endAfter = endOf(result);
    const itemKeys = new Set(list.map((it) => it.key));
    const seeds = new Set(itemKeys);
    if (seedKeys instanceof Set) for (const k of seedKeys) seeds.add(k);
    const near = reach(result, seeds, true);
    const notMoved = [];
    for (const k of result.order) {
      const n = nodes.get(k);
      if (!near.has(k) || itemKeys.has(k) || !n.fixed) continue;
      if (n.fixed === "cycle") notMoved.push({ key: k, why: "cycle" });
      else if (n.conflict) notMoved.push({ key: k, why: n.fixed === "mfo" ? "mfo" : "anchor" });
    }
    return {
      rows,
      moved: rows.filter((r) => r.to !== r.from).length,
      endBefore,
      endAfter,
      endDelta: endBefore !== null && endAfter !== null ? wdDelta(c, endBefore, endAfter) : null,
      late: rows.filter((r) => r.late > 0).length,
      notMoved,
      brokenDeps: newBroken(c, before, result, (k) => near.has(k)),
    };
  }

  // revalidate (CAS, K34): rawNow = Map<key, ext mentah terkini>. Setiap item: semua kunci `before` (start, duration,
  // constraint, mode; + deps bila ada) dibandingkan MENTAH (bentuk kanonik) dengan nilai terkini; task hilang = berubah.
  function revalidate(items, rawNow) {
    const keys = [];
    for (const it of Array.isArray(items) ? items : []) {
      const raw = rawNow instanceof Map ? rawNow.get(it.key) : undefined;
      if (!isObj(raw) || Object.keys(it.before).some((f) => canon(raw[f]) !== canon(it.before[f]))) keys.push(it.key);
    }
    return keys.length ? { ok: false, keys } : { ok: true };
  }

  // undoItems (R13): patch = `before` (kunci yang dulu tidak ada → null = hapus); urutan item sama. Nilai mentah yang
  // gagal sanitizePatch untuk kuncinya (data korup) → null: mesin memperlakukannya sebagai tidak ada, dan satu nilai
  // korup tidak boleh membuat seluruh batch Urungkan ditolak (R22). Nilai sah ditulis dalam bentuk bersih sanitizePatch.
  // Pengecualian `deps`: nilai MENTAH ditulis apa adanya (salinan) — satu entri format asing/masa depan tidak boleh
  // membuat Urungkan menghapus SEMUA dependensi; store menerima kembali yang dulu ia simpan, dan mesin/readSched
  // mengabaikan entri yang tidak terbaca (invalidDeps).
  function undoItems(items) {
    return (Array.isArray(items) ? items : []).map((it) => {
      const patch = {};
      for (const k of Object.keys(it.before)) {
        const v = it.before[k];
        if (k === "deps") {
          patch[k] = v === null || v === undefined ? null : clone(v);
          continue;
        }
        const s = v === null ? null : SCHED.sanitizePatch({ [k]: v });
        patch[k] = s && s.ok ? clone(s.patch[k]) : null;
      }
      return { taskId: it.task.id, patch };
    });
  }

  // ---- Baseline (1c-2, K41) ----
  // Record `baseline`: {v: 1, n, name, savedAt, by, t: [[ref, s, f, d, w], …]} — larik ringkas ±48 B/task.
  // ref = {$task: id task MENTAH} (sama dengan api.taskExt.ref: id server bilangan bulat, atau cid string untuk task yang
  // dibuat offline — host menahan record lalu menulis ulang ref ke id server; server menolak $task string angka).
  // Kunci baris = TLSched.refKey(ref) = String(id) = kunci simpul mesin.

  // Ukuran byte UTF-8 dari string JSON (sama dengan TextEncoder host untuk string yang well-formed; JSON.stringify
  // meng-escape surrogate tunggal, jadi yang tersisa hanya pasangan sah = 4 byte).
  function utf8Len(str) {
    let n = 0;
    for (let i = 0; i < str.length; i++) {
      const u = str.charCodeAt(i);
      if (u < 0x80) n += 1;
      else if (u < 0x800) n += 2;
      else if (u >= 0xd800 && u <= 0xdbff && i + 1 < str.length) {
        const lo = str.charCodeAt(i + 1);
        if (lo >= 0xdc00 && lo <= 0xdfff) {
          n += 4;
          i++;
        } else n += 3;
      } else n += 3;
    }
    return n;
  }

  // baselineByteSize: ukuran JSON ringkas UTF-8 (yang dibandingkan dengan BL_MAX / maxBytes record).
  function baselineByteSize(data) {
    const s = JSON.stringify(data);
    return typeof s === "string" ? utf8Len(s) : 0;
  }

  // Bobot w = estimated_pomodoros (earned value 1d): bilangan bulat ≥ 0; tak ada/tak sah → 0 (satu byte, setara
  // "tanpa bobot" untuk earned value).
  const weightOf = (t) => (Number.isInteger(t.estimated_pomodoros) && t.estimated_pomodoros >= 0 ? t.estimated_pomodoros : 0);

  // baselineEncode (K41): isi = simpul mesin TERJADWAL (es/ef terhitung) non-ringkasan, termasuk selesai (jangkar
  // aktual); g (opsional) = recId unit jadwal (n.g) — tanpa g → semua simpul hasil. Urut cmpKey kunci simpul
  // (deterministik lintas perangkat). meta {n, name, savedAt, by} disalin apa adanya (validasi slot/nama di pemanggil).
  // → {data, bytes, count}; bytes > BL_MAX ditolak pemanggil ("Baseline terlalu besar").
  function baselineEncode(result, ctx, meta, g) {
    const m = isObj(meta) ? meta : {};
    const picked = [];
    if (isResult(result)) {
      const sums = result.summaries instanceof Map ? result.summaries : new Map();
      for (const [k, n] of result.nodes) {
        if (!isDn(n.es) || !isDn(n.ef) || sums.has(k)) continue;
        if (g !== undefined && g !== null && n.g !== g) continue;
        picked.push(n);
      }
    }
    picked.sort((a, b) => cmpKey(a.key, b.key));
    const t = picked.map((n) => {
      const id = n.task.id;
      return [{ $task: Number.isInteger(id) ? id : n.key }, CAL.iso(n.es), CAL.iso(n.ef), n.d, weightOf(n.task)];
    });
    const data = { v: 1, n: m.n, name: m.name, savedAt: m.savedAt, by: m.by === undefined ? null : clone(m.by), t };
    return { data, bytes: baselineByteSize(data), count: t.length };
  }

  const isoDn = (s) => (typeof s === "string" && CAL.isIso(s) ? CAL.dn(s) : NaN);

  // Batas atas w sah saat decode (review F1 M2) = target 🍅 maks host: TF.pomologic.EST_MAX = webapp.TASK_EST_MAX = 99
  // (server menolak > 99, taskrepo menjepit ke 99; = TLLoad.EST_MAX, tetapi load.js dimuat SETELAH plan.js). weightOf
  // menyalin estimated_pomodoros tanpa jepit atas, jadi w > 99 hanya dari data di luar kontrak host atau record baseline
  // rusak/dimanipulasi (mis. 1e300 → BAC tak hingga). Naik bersama EST_MAX (dikunci tes silang timeline_plan.test.js).
  const W_MAX = 99;

  // baselineDecode (Review Focus 3): v ≠ 1, bukan objek, t bukan larik, n bukan 1–3 → null. Entri rusak (bukan larik,
  // < 4 elemen, ref tak terpecahkan — null dari host / bukan {$task} sah —, tanggal tak sah, f < s, durasi tak sah)
  // DILEWATI; ref ganda → yang pertama menang. w dibaca sejak 1d-2 (R3, earned value): e[4] bila bilangan bulat
  // 0..W_MAX, selain itu 0 — entri 4 elemen dari baseline 1c-2 lama tetap sah dengan w 0; w rusak tidak membuang baris.
  // → {n, name, savedAt, by, rows: Map<key, {s, f, d, w}>}.
  function baselineDecode(data) {
    if (!isObj(data) || data.v !== 1 || !Array.isArray(data.t) || [1, 2, 3].indexOf(data.n) < 0) return null;
    const rows = new Map();
    for (const e of data.t) {
      if (!Array.isArray(e) || e.length < 4) continue;
      const key = SCHED.refKey(e[0]);
      if (key === null || rows.has(key)) continue;
      const s = isoDn(e[1]);
      const f = isoDn(e[2]);
      if (!isDn(s) || !isDn(f) || f < s || !isDur(e[3])) continue;
      rows.set(key, { s, f, d: e[3], w: Number.isInteger(e[4]) && e[4] >= 0 && e[4] <= W_MAX ? e[4] : 0 });
    }
    return {
      n: data.n,
      name: typeof data.name === "string" ? data.name : "",
      savedAt: typeof data.savedAt === "string" ? data.savedAt : null,
      by: data.by === undefined ? null : clone(data.by),
      rows,
    };
  }

  // compareBaseline: per baris baseline (urut cmpKey) → kunci kanonik lewat TLSched.buildIndex(ctx.tasks) (cid/id server
  // → String(task.id)) → simpul terjadwal di result. Tak terpecahkan / bukan simpul terjadwal (dihapus, diarsip, di luar
  // scope, tanpa Mulai) → dilewati. ds/df = selisih hari kerja bertanda baseline → sekarang dengan kalender ctx.cal
  // (positif = mundur; aturan wdDelta sama dengan deltaHk), dd = d sekarang − d baseline. group per n.g simpul yang
  // cocok: blEnd = maks f baseline yang cocok, nowEnd = result.groupEnd (selesai project sekarang, sama dengan preview).
  function compareBaseline(result, dec, ctx) {
    const perTask = new Map();
    const group = new Map();
    if (!isResult(result) || !isObj(dec) || !(dec.rows instanceof Map) || !isObj(ctx)) return { perTask, group };
    const c = ctx.cal;
    const idx = SCHED.buildIndex(Array.isArray(ctx.tasks) ? ctx.tasks : []);
    const ends = result.groupEnd instanceof Map ? result.groupEnd : new Map();
    for (const rk of [...dec.rows.keys()].sort(cmpKey)) {
      const b = dec.rows.get(rk);
      const t = idx.get(rk);
      const key = t ? String(t.id) : rk;
      const n = result.nodes.get(key);
      if (!n || !isDn(n.es) || !isDn(n.ef) || perTask.has(key) || !isObj(b)) continue;
      const ds = wdDelta(c, b.s, n.es);
      const df = wdDelta(c, b.f, n.ef);
      if (ds === null || df === null || !isDur(b.d)) continue;
      perTask.set(key, { ds, df, dd: n.d - b.d });
      const cur = group.get(n.g);
      if (!cur) group.set(n.g, { blEnd: b.f, nowEnd: isDn(ends.get(n.g)) ? ends.get(n.g) : null });
      else if (b.f > cur.blEnd) cur.blEnd = b.f;
    }
    return { perTask, group };
  }

  const BL_MAX = 65536; // K41: maxBytes record baseline

  return Object.freeze({
    CASCADE_MAX,
    BL_MAX,
    diff,
    cascade,
    toggleUnit,
    reschedule,
    gesture,
    modePatch,
    preview,
    revalidate,
    undoItems,
    baselineEncode,
    baselineByteSize,
    baselineDecode,
    compareBaseline,
  });
})(
  typeof TLCal !== "undefined" ? TLCal : require("./calendar.js"),
  typeof TLSched !== "undefined" ? TLSched : require("./schedule.js"),
  typeof TLCpm !== "undefined" ? TLCpm : require("./cpm.js"),
);
if (typeof module !== "undefined" && module.exports) module.exports = TLPlan;
// part: load.js
// Plugin Timeline — TLLoad: mesin Beban Tim murni (spec 1d §5.1–§5.2, K45–K50; rencana 1d-1 R1–R3, R6, R8, R9) +
// earned value 🍅 dari baseline aktif (spec 1d §5.3, K51; rencana 1d-2 R1).
// Membagi sisa 🍅 tiap task rata ke hari kerja jendela bar Gantt (tanggal TERSIMPAN lewat TLSched.spanOf, R1 — bukan
// ES/EF mesin), menjumlahkannya per penanggung jawab per hari dalam milipomodoro (×1000, bilangan bulat, R8), lalu
// membandingkannya dengan kapasitas/cuti record `resource` (K47–K48). Saran leveling (R6) memakai slack hasil TLCpm.run.
// Murni: tanpa jam lokal, tanpa global, tanpa akses api/store, TIDAK menulis (K27) dan tidak mengubah masukan. Urutan
// keluaran memakai TLCpm.cmpKey (unit kode UTF-16, bukan urutan lokal) → identik untuk urutan masukan apa pun.
const TLLoad = (function (CAL, SCHED, CPM) {
  const EST_MAX = 99; // R3: batas target 🍅 host (pomologic.EST_MAX, dikunci tes silang)
  const DEFAULT_CAP = 8; // K47: kapasitas bawaan 🍅/hari
  const CAP_MAX = 40; // K47: kapasitas bilangan bulat 0–40
  const MILLI = 1000; // R8: satuan internal milipomodoro
  const LEAVE_MAX = 50; // K55/R9: maks rentang cuti
  const NOTE_MAX = 60; // K55/R9: maks code point catatan cuti
  const YEAR_MIN = 1970; // R9: tanggal cuti ISO sah 1970–2199 (pola TLSched isConstraintDate)
  const YEAR_MAX = 2199;
  const UNASSIGNED = "Belum ditugaskan"; // K49
  const KIND_ORDER = ["critical", "manual", "started", "late"]; // R6: urutan non-free
  const cmpKey = CPM.cmpKey;

  const isObj = (o) => o !== null && typeof o === "object" && !Array.isArray(o);
  const isDn = (n) => Number.isInteger(n);
  const isCap = (c) => Number.isInteger(c) && c >= 0 && c <= CAP_MAX;
  // uidOf (review T1): id pengguna = bilangan bulat aman > 0, ATAU string digit saja (/^\d+$/; mis. assigned_to dari
  // JSON host lama) yang menjadi bilangan bulat aman > 0 → bilangan; selain itu null. Satu pintu untuk assigned_to,
  // people[].uid, dan ownerUid — baris yang sama tidak pernah terbelah antara 5 dan "5".
  function uidOf(v) {
    const n = typeof v === "string" && /^\d+$/.test(v) ? Number(v) : v;
    return typeof n === "number" && Number.isSafeInteger(n) && n > 0 ? n : null;
  }
  const keyOf = (t) => String(t.id); // kunci kanonik sama dengan cpm.js/plan.js (String(task.id))
  // Predikat mesin (cpm.js:34–37, :136; layout.js:344, :471): hidup / selesai / sudah mulai (K30 + actual.start).
  const isLive = (t) => !(t.gtd_status === "archived" || t.archived || t.deleted);
  const isDone = (t) => t.gtd_status === "done" || !!t.completed_at;
  const isStarted = (t, raw) => Number(t.progress) > 0 || Number(t.pomodoros_done) > 0 || SCHED.actualOf(t, raw).start !== null;

  function safe(fn) {
    try {
      return fn();
    } catch (e) {
      if (e instanceof Error && e.message === "TL_CAL_LOOP") return undefined;
      throw e;
    }
  }

  // Ext mentah task (tanpa prefiks) — fallback dan penanganan lempar sama dengan TLPlan rawOf / TLCpm.run.
  function rawOf(readExt, task) {
    let raw;
    try {
      raw = typeof readExt === "function" ? readExt(task) : task && isObj(task.ext) ? task.ext : {};
    } catch (e) {
      raw = {};
    }
    return isObj(raw) ? raw : {};
  }

  // Kalender terkompilasi dikenali dari bentuknya (pola TLLayout); mentah/kosong → dikompilasi (cache TLCal).
  function calOf(c) {
    const ok = !!c && typeof c.key === "string" && !!c.mask && typeof c.mask.has === "function" && !!c.off && typeof c.off.has === "function" && !!c.work && typeof c.work.has === "function";
    return ok ? c : CAL.compile(c || CAL.DEFAULT_CAL);
  }

  // ---- record `resource` (K48, R9) ----
  // Tanggal cuti: string ISO sah tahun 1970–2199 → bilangan hari; selain itu NaN.
  function leaveDn(s) {
    if (typeof s !== "string") return NaN;
    const n = CAL.dn(s);
    if (!isDn(n)) return NaN;
    const y = +s.slice(0, 4);
    return y >= YEAR_MIN && y <= YEAR_MAX ? n : NaN;
  }

  // Catatan: string → maks NOTE_MAX code point (iterasi per code point: pasangan surrogate tidak pernah terbelah);
  // bukan string → "".
  function cutNote(s) {
    if (typeof s !== "string") return "";
    let out = "";
    let n = 0;
    for (const ch of s) {
      if (n++ >= NOTE_MAX) break;
      out += ch;
    }
    return out;
  }

  const defaultRes = () => ({ capacity: DEFAULT_CAP, leave: [] });

  // resourceDecode (K48, spec §4): bukan objek / v ≠ 1 → bawaan; capacity tak sah → 8; entri cuti rusak (bukan objek,
  // from/to bukan ISO sah 1970–2199, from > to) dilewati; maks LEAVE_MAX entri sah pertama (urutan data dipertahankan).
  function resourceDecode(data) {
    const out = defaultRes();
    if (!isObj(data) || data.v !== 1) return out;
    if (isCap(data.capacity)) out.capacity = data.capacity;
    if (!Array.isArray(data.leave)) return out;
    for (const e of data.leave) {
      if (out.leave.length >= LEAVE_MAX) break;
      if (!isObj(e)) continue;
      const from = leaveDn(e.from);
      const to = leaveDn(e.to);
      if (!isDn(from) || !isDn(to) || from > to) continue;
      out.leave.push({ from, to, note: cutNote(e.note) });
    }
    return out;
  }

  function invalid(msg) {
    const e = new Error(msg);
    e.code = "INVALID";
    return e;
  }

  // Tanggal masukan editor: string ISO atau bilangan hari, keduanya dalam 1970–2199.
  function inDn(v) {
    if (typeof v === "string") return leaveDn(v);
    if (!isDn(v)) return NaN;
    return isDn(leaveDn(CAL.iso(v))) ? v : NaN;
  }

  // resourceEncode (R9): value = {capacity, leave: [{from, to, note}]} (from/to ISO atau bilangan hari), meta = {by}.
  // Normalisasi: capacity bulat 0–40; cuti diurut (from, to, catatan cmpKey); rentang tumpang tindih ATAU bersebelahan
  // (to + 1 ≥ from berikutnya) digabung — catatan gabungan = catatan non-kosong PERTAMA menurut urutan itu (deterministik);
  // catatan dipotong 60 code point. Tak sah (capacity, leave bukan larik, entri rusak, from > to, > 50 rentang setelah
  // digabung) → lempar Error code "INVALID". Keluaran TANPA updatedAt: waktu simpan dicatat record (updated_at).
  function resourceEncode(value, meta) {
    if (!isObj(value)) throw invalid("resource: nilai bukan objek");
    if (!isCap(value.capacity)) throw invalid("resource: kapasitas harus bilangan bulat 0–" + CAP_MAX);
    const src = value.leave === undefined || value.leave === null ? [] : value.leave;
    if (!Array.isArray(src)) throw invalid("resource: cuti harus larik");
    const list = [];
    for (const e of src) {
      if (!isObj(e)) throw invalid("resource: entri cuti rusak");
      const from = inDn(e.from);
      const to = inDn(e.to);
      if (!isDn(from) || !isDn(to)) throw invalid("resource: tanggal cuti tidak sah");
      if (from > to) throw invalid("resource: tanggal mulai cuti setelah tanggal selesai");
      list.push({ from, to, note: cutNote(e.note) });
    }
    list.sort((a, b) => a.from - b.from || a.to - b.to || cmpKey(a.note, b.note));
    const merged = [];
    for (const l of list) {
      const cur = merged[merged.length - 1];
      if (cur && l.from <= cur.to + 1) {
        if (l.to > cur.to) cur.to = l.to;
        if (cur.note === "") cur.note = l.note;
      } else merged.push({ from: l.from, to: l.to, note: l.note });
    }
    if (merged.length > LEAVE_MAX) throw invalid("resource: maksimal " + LEAVE_MAX + " rentang cuti");
    const m = isObj(meta) ? meta : {};
    return {
      v: 1,
      capacity: value.capacity,
      leave: merged.map((l) => ({ from: CAL.iso(l.from), to: CAL.iso(l.to), note: l.note })),
      by: Number.isInteger(m.by) ? m.by : null,
    };
  }

  function utf8Len(str) {
    let n = 0;
    for (let i = 0; i < str.length; i++) {
      const u = str.charCodeAt(i);
      if (u < 0x80) n += 1;
      else if (u < 0x800) n += 2;
      else if (u >= 0xd800 && u <= 0xdbff && i + 1 < str.length) {
        const lo = str.charCodeAt(i + 1);
        if (lo >= 0xdc00 && lo <= 0xdfff) {
          n += 4;
          i++;
        } else n += 3;
      } else n += 3;
    }
    return n;
  }

  // resourceByteSize: ukuran JSON ringkas UTF-8 (dibandingkan dengan maxBytes record 4096; pola TLPlan.baselineByteSize).
  function resourceByteSize(data) {
    const s = JSON.stringify(data);
    return typeof s === "string" ? utf8Len(s) : 0;
  }

  // Kontrak res (people[].res, argumen capAt) = keluaran resourceDecode: {capacity: bulat 0–40, leave: [{from, to: bilangan
  // hari bulat, note}]}. Bentuk lain → bawaan (8 tanpa cuti); entri cuti yang from/to bukan bilangan bulat (mis. ISO
  // mentah belum didekode) dilewati di onLeave — tidak pernah membuat kapasitas 0 karena perbandingan string/NaN.
  const resOf = (r) => (isObj(r) && isCap(r.capacity) && Array.isArray(r.leave) ? r : defaultRes());

  function onLeave(res, dn) {
    for (const l of res.leave) if (isObj(l) && isDn(l.from) && isDn(l.to) && dn >= l.from && dn <= l.to) return true;
    return false;
  }

  // capAt (K47): 🍅 kapasitas hari dn — 0 bila bukan hari kerja kalender halaman atau cuti; selain itu capacity.
  function capAt(res, cal, dn) {
    const r = res === null || res === undefined ? defaultRes() : resOf(res);
    const work = safe(() => CAL.isWork(calOf(cal), dn));
    if (work !== true || onLeave(r, dn)) return 0;
    return r.capacity;
  }

  // ---- distribusi beban (K46, R1–R3, R8) ----
  // Target (R3): bilangan bulat ≥ 1, selain itu 1, dijepit EST_MAX; selesai: bilangan bulat ≥ 0, selain itu 0.
  const targetOf = (t) => (Number.isInteger(t.estimated_pomodoros) && t.estimated_pomodoros >= 1 ? Math.min(EST_MAX, t.estimated_pomodoros) : 1);
  const doneOf = (t) => (Number.isInteger(t.pomodoros_done) && t.pomodoros_done >= 0 ? t.pomodoros_done : 0);

  // Satu entri people per uid (uidOf); uid ganda → pilihan deterministik (nama cmpKey terkecil, lalu isi res) agar hasil
  // tidak bergantung pada urutan masukan.
  function peopleMap(people) {
    const out = new Map();
    for (const p of Array.isArray(people) ? people : []) {
      const uid = isObj(p) ? uidOf(p.uid) : null;
      if (uid === null) continue;
      const name = typeof p.name === "string" && p.name !== "" ? p.name : "Anggota #" + uid;
      const res = resOf(p.res);
      const cand = { name, res, sig: JSON.stringify(res) };
      const cur = out.get(uid);
      if (!cur || cmpKey(name, cur.name) < 0 || (name === cur.name && cmpKey(cand.sig, cur.sig) < 0)) out.set(uid, cand);
    }
    return out;
  }

  // run(input) → {T, rows, unscheduled, recurring, defaultTarget, counted, lateCount}.
  // input = {tasks, cal, readExt, result, units, people, byAssignee, ownerUid, D}: tasks = eng.ctx.tasks (daftar lengkap
  // halaman, R2), cal = kalender halaman, result = TLCpm.run (ringkasan dilewati), people = [{uid, name, res}],
  // byAssignee true → uidOf(assigned_to) (workspace), false → uidOf(ownerUid) (pribadi; pemilik tak sah → beban tidak
  // dibarisi, tanpa baris "Belum ditugaskan"), D = bilangan hari hari ini. units tidak
  // dipakai di sini (R1: tanggal = bar) — hanya oleh suggest.
  // Baris: {uid|null, name, capacity|null, res|null, days: Map<dn naik, {load, parts: [{key, share, late}]}>, overDays, total}.
  function run(input) {
    const a = isObj(input) ? input : {};
    const c = calOf(a.cal);
    const sums = isObj(a.result) && a.result.summaries instanceof Map ? a.result.summaries : new Map();
    const owner = uidOf(a.ownerUid);
    const T0 = isDn(a.D) ? safe(() => CAL.nextWork(c, a.D)) : undefined;
    const T = isDn(T0) ? T0 : null; // kalender buntu / D tak sah → tanpa distribusi (semua berbeban = unscheduled)
    let unscheduled = 0;
    let recurring = 0;
    let defaultTarget = 0;
    let counted = 0;
    let lateCount = 0;

    const acc = new Map(); // uid|null → Map<dn, {load, parts}>
    const seen = new Set();
    const seenRec = new Set();
    for (const t of Array.isArray(a.tasks) ? a.tasks : []) {
      if (!isObj(t) || t.id === undefined || t.id === null || !isLive(t)) continue;
      const key = keyOf(t);
      if (t.recurrence_type) {
        // R8 / K46: berulang dikecualikan (predikat cpm.js:136, dibuang SEBELUM dedup seperti TLCpm.run → tidak menempati
        // kunci) dan dihitung terpisah — sekali per kunci (review T1: kunci ganda tidak menggandakan hitungan).
        if (!seenRec.has(key)) {
          seenRec.add(key);
          recurring++;
        }
        continue;
      }
      if (seen.has(key)) continue; // kunci ganda → yang pertama (pola TLCpm.run / TLLayout.layout)
      seen.add(key);
      if (sums.has(key) || isDone(t)) continue; // R2: induk ringkasan; K46: selesai = nol beban
      const sisa = Math.max(0, targetOf(t) - doneOf(t));
      if (sisa === 0) continue;
      const raw = rawOf(a.readExt, t);
      if (raw.duration === 0) continue; // milestone (durasi 0 = it.d mesin): nol beban, juga tanpa Mulai
      const span = SCHED.spanOf(c, SCHED.readSched(raw)); // R1: rentang bar = tanggal tersimpan
      if (!span || T === null) {
        unscheduled++;
        continue;
      }
      const late = span.f < T;
      const days = [];
      if (late) days.push(T);
      else for (let d = Math.max(T, span.s); d <= span.f; d++) if (CAL.isWork(c, d)) days.push(d);
      if (!days.length) {
        unscheduled++;
        continue;
      }
      counted++;
      if (!(Number.isInteger(t.estimated_pomodoros) && t.estimated_pomodoros >= 2)) defaultTarget++;
      if (late) lateCount++;
      const uid = a.byAssignee === true ? uidOf(t.assigned_to) : owner;
      // Halaman pribadi tanpa pemilik sah (review T2–T3): tidak ada baris yang memikulnya — bukan "Belum ditugaskan"
      // (baris itu hanya untuk task workspace tanpa penanggung jawab). Hitungan di atas tetap.
      if (uid === null && a.byAssignee !== true) continue;
      let m = acc.get(uid);
      if (!m) acc.set(uid, (m = new Map()));
      // R8: porsi bilangan bulat; sisa bagi +1 ke hari-hari paling awal → Σ = sisa × 1000 tepat.
      const R = sisa * MILLI;
      const n = days.length;
      const base = Math.floor(R / n);
      const rem = R - base * n;
      for (let i = 0; i < n; i++) {
        const share = base + (i < rem ? 1 : 0);
        if (share <= 0) continue;
        let day = m.get(days[i]);
        if (!day) m.set(days[i], (day = { load: 0, parts: [] }));
        day.load += share;
        day.parts.push({ key, share, late });
      }
    }

    const ppl = peopleMap(a.people);
    const rows = [];
    const uids = new Set(ppl.keys());
    for (const u of acc.keys()) if (u !== null) uids.add(u);
    const build = (uid, name, res) => {
      const src = acc.get(uid) || new Map();
      const days = new Map();
      const overDays = [];
      let total = 0;
      for (const dn of [...src.keys()].sort((x, y) => x - y)) {
        const d = src.get(dn);
        d.parts.sort((x, y) => cmpKey(x.key, y.key));
        days.set(dn, d);
        total += d.load;
        if (uid !== null && d.load > capAt(res, c, dn) * MILLI) overDays.push(dn); // K47: merah = beban > kapasitas
      }
      return { uid, name, capacity: uid === null ? null : res.capacity, res: uid === null ? null : res, days, overDays, total };
    };
    for (const uid of uids) {
      const p = ppl.get(uid);
      rows.push(build(uid, p ? p.name : "Anggota #" + uid, p ? p.res : defaultRes()));
    }
    rows.sort((x, y) => cmpKey(x.name, y.name) || x.uid - y.uid);
    if (acc.has(null)) rows.push(build(null, UNASSIGNED, null)); // K49: baris tanpa kapasitas, selalu terakhir
    return { T, rows, unscheduled, recurring, defaultTarget, counted, lateCount };
  }

  // ---- saran leveling (K50, R6) ----
  // suggest(load, uid, dn, ctx = {result, units, readExt, tasks}) → [{key, task, share, slack, kind}] untuk kontributor
  // (uid, dn). kind diperiksa berurutan: late → started (F4: progress/pomodoro/actual.start) → manual (mode "manual"
  // EKSPLISIT di unit Otomatis) → critical (simpul tidak ada / slack bukan bilangan / ≤ 0) → free. Di unit Manual semua
  // task diklasifikasi menurut slack (R6). Urut: free slack menurun lalu cmpKey; sisanya critical, manual, started, late
  // masing-masing cmpKey. Murni, tanpa tulisan.
  function suggest(load, uid, dn, ctx) {
    const rows = isObj(load) && Array.isArray(load.rows) ? load.rows : [];
    const row = rows.find((r) => r && r.uid === uid);
    const day = row && row.days instanceof Map ? row.days.get(dn) : undefined;
    if (!day || !Array.isArray(day.parts)) return [];
    const x = isObj(ctx) ? ctx : {};
    const nodes = isObj(x.result) && x.result.nodes instanceof Map ? x.result.nodes : new Map();
    const idx = new Map();
    for (const t of Array.isArray(x.tasks) ? x.tasks : []) {
      if (isObj(t) && t.id !== undefined && t.id !== null && !idx.has(keyOf(t))) idx.set(keyOf(t), t);
    }
    const out = [];
    for (const p of day.parts) {
      const t = idx.get(p.key) || null;
      const raw = t ? rawOf(x.readExt, t) : {};
      const n = nodes.get(p.key);
      const slack = n && typeof n.slack === "number" && Number.isFinite(n.slack) ? n.slack : null;
      let kind;
      if (p.late) kind = "late";
      else if (t && isStarted(t, raw)) kind = "started";
      else if (t && raw.mode === "manual" && isAutoUnit(x.units, t)) kind = "manual";
      else if (slack === null || slack <= 0) kind = "critical";
      else kind = "free";
      out.push({ key: p.key, task: t, share: p.share, slack, kind });
    }
    out.sort((a, b) => {
      if (a.kind === "free" || b.kind === "free") {
        if (a.kind !== b.kind) return a.kind === "free" ? -1 : 1;
        return b.slack - a.slack || cmpKey(a.key, b.key);
      }
      return KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || cmpKey(a.key, b.key);
    });
    return out;
  }

  // Unit task Otomatis (record `project` auto: true lewat TLSched.unitFor — pola modeOf).
  function isAutoUnit(units, task) {
    const u = SCHED.unitFor(units, task);
    return !!u && u.auto === true;
  }

  // ---- format ----
  // fmtPomo(milli, up) (R8): milli → 🍅 kelipatan 0,5 dengan titik desimal seperti host ("2.5", "3").
  //   up === true → dibulatkan KE ATAS (dipakai hari merah: beban > kapasitas × 1000 selalu tampil > kapasitas, tidak
  //   pernah "8 dari 8"); selain itu ke 0,5 terdekat, tetapi beban > 0 minimal "0.5" (tidak pernah tampil "0").
  function fmtPomo(milli, up) {
    const v = Number(milli);
    if (!Number.isFinite(v)) return "0";
    let h = up === true ? Math.ceil(v / 500) / 2 : Math.round(v / 500) / 2;
    if (v > 0 && h < 0.5) h = 0.5;
    return String(h === 0 ? 0 : h);
  }

  // hoursLabel (R3, K45): rumus IDENTIK dengan pomologic.estimateHoursLabel host (25 menit per 🍅, bulat 0,5, "~x jam");
  // disalin, bukan dipanggil (plugin tidak memakai modul host). Dikunci tes silang 1..99.
  function hoursLabel(pomo) {
    const h = Math.round(((Number(pomo) * 25) / 60) * 2) / 2;
    return "~" + String(h) + " jam";
  }

  // ---- earned value 🍅 (spec 1d §5.3, K51; rencana 1d-2 R1) ----
  const SPAN_MAX = 3660; // rentang hari kalender maks untuk hitung hari kerja (pola SPAN_MAX TLPlan/TLCpm)

  // Hari kerja kalender halaman. Kalender rusak (.has melempar — TL_CAL_LOOP atau galat lain — / gagal dikompilasi)
  // → bukan hari kerja: ev tidak pernah melempar karena kalender.
  function workAt(c, dn) {
    if (c === null) return false;
    try {
      return CAL.isWork(c, dn) === true;
    } catch (e) {
      return false;
    }
  }

  // PV satu baris (milipomodoro, wm = w × 1000): D < s → 0; milestone (d 0) → wm; selain itu
  // round(wm × hk(s..min(f, D)) ÷ hk(s..f)). Penyebut 0 (rentang tanpa hari kerja) = satu hari di s → wm (D ≥ s).
  // Satu putaran menghitung pembilang dan penyebut; rentang dibatasi s + SPAN_MAX hari kalender (data rusak tidak
  // menggantung — durasi sah ≤ 999 hk jauh di bawahnya).
  function pvOf(c, b, D, wm) {
    if (D < b.s) return 0;
    if (b.d === 0) return wm;
    let den = 0;
    let num = 0;
    for (let d = b.s, hi = Math.min(b.f, b.s + SPAN_MAX); d <= hi; d++) {
      if (!workAt(c, d)) continue;
      den++;
      if (d <= D) num++;
    }
    return den === 0 ? wm : Math.round((wm * num) / den);
  }

  // % selesai (R1, dikoreksi review F1): task selesai = 100; selain itu Number(progress) dijepit 0–100, tak hingga/NaN
  // → 0. Number() sama dengan pembaca progress lain (cpm.js isStarted, plan.js isStarted/reschedule, layout.js bar, load.js
  // isStarted): string angka "50" = 50 %; null/"" → 0.
  function pctOf(t) {
    if (isDone(t)) return 100;
    const p = Number(t.progress);
    return Number.isFinite(p) ? Math.min(100, Math.max(0, p)) : 0;
  }

  // ev(bl, ctx, D) → {bac, pv, ev, ac, spi, cpi, rows, outside, missing} | null.
  //   bl = {n, name, rows: Map<refKey, {s, f, d, w}>} (baseline aktif, TLPlan.baselineDecode); ctx = {tasks, cal, result}
  //   (daftar lengkap halaman, kalender halaman, hasil TLCpm.run — hanya summaries yang dibaca); D = bilangan hari hari ini.
  //   Baris → task lewat TLSched.buildIndex(ctx.tasks) dengan kunci kanonik String(task.id) (pola compareBaseline): urut
  //   cmpKey, dua baris ke task sama → yang pertama. Task tidak ditemukan / tidak hidup → missing, dibuang dari SEMUA
  //   angka. Per baris dalam milipomodoro, dibulatkan per baris lalu dijumlah (determinis): BAC += w; PV (pvOf);
  //   EV += w × % selesai (pctOf); AC += pomodoros_done bulat ≥ 0. spi = ev ÷ pv, cpi = ev ÷ ac (penyebut 0 → null).
  //   outside = task hidup, bukan berulang, bukan induk ringkasan, yang tidak dipetakan baris mana pun (sekali per kunci).
  //   bl / bl.rows / D tidak sah atau BAC 0 → null (ringkasan tidak tampil, K51). Murni: tidak menulis, tidak mengubah masukan.
  function ev(bl, ctx, D) {
    if (!isObj(bl) || !(bl.rows instanceof Map) || !isDn(D)) return null;
    const x = isObj(ctx) ? ctx : {};
    const tasks = Array.isArray(x.tasks) ? x.tasks : [];
    let c;
    try {
      c = calOf(x.cal);
    } catch (e) {
      c = null;
    }
    const idx = SCHED.buildIndex(tasks);
    const sums = isObj(x.result) && x.result.summaries instanceof Map ? x.result.summaries : new Map();
    const mapped = new Set();
    let bac = 0;
    let pv = 0;
    let earned = 0;
    let ac = 0;
    let rows = 0;
    let missing = 0;
    for (const rk of [...bl.rows.keys()].sort(cmpKey)) {
      const t = idx.get(rk);
      if (!t) {
        missing++;
        continue;
      }
      const key = keyOf(t);
      if (mapped.has(key)) continue;
      mapped.add(key);
      if (!isLive(t)) {
        missing++;
        continue;
      }
      const b = bl.rows.get(rk);
      if (!isObj(b) || !isDn(b.s) || !isDn(b.f) || b.f < b.s) continue; // nilai baris rusak (bukan keluaran decode)
      const wm = (Number.isInteger(b.w) && b.w >= 0 ? b.w : 0) * MILLI;
      bac += wm;
      pv += pvOf(c, b, D, wm);
      earned += Math.round((wm * pctOf(t)) / 100);
      ac += doneOf(t) * MILLI;
      rows++;
    }
    if (bac === 0) return null;
    let outside = 0;
    const seen = new Set();
    for (const t of tasks) {
      if (!isObj(t) || t.id === undefined || t.id === null || !isLive(t) || t.recurrence_type) continue;
      const key = keyOf(t);
      if (seen.has(key)) continue;
      seen.add(key);
      if (!sums.has(key) && !mapped.has(key)) outside++;
    }
    return { bac, pv, ev: earned, ac, spi: pv > 0 ? earned / pv : null, cpi: ac > 0 ? earned / ac : null, rows, outside, missing };
  }

  // fmtPomo1(milli) (R1): milipomodoro → 🍅 satu desimal dengan titik desimal seperti host ("12.5"); bilangan bulat
  // tanpa ".0" ("12"); bukan bilangan hingga → "0".
  function fmtPomo1(milli) {
    const v = Number(milli);
    if (!Number.isFinite(v)) return "0";
    const h = Math.round(v / 100) / 10;
    return String(h === 0 ? 0 : h);
  }

  const pctText = (q) => (typeof q === "number" && Number.isFinite(q) ? Math.round(q * 100) + "%" : "—");

  // evText (Q6 (a)): "Jadwal {p}% · Efisiensi 🍅 {q}%" — persen bulat; spi/cpi null → "—".
  function evText(r) {
    const x = isObj(r) ? r : {};
    return "Jadwal " + pctText(x.spi) + " · Efisiensi 🍅 " + pctText(x.cpi);
  }

  // evTip: "Baseline: {nama} · PV {x} · EV {y} · AC {z} · BAC {w} 🍅" (🍅 satu desimal, fmtPomo1), ditambah
  // " · {n} task di luar baseline" bila n > 0.
  function evTip(r, name) {
    const x = isObj(r) ? r : {};
    const nm = typeof name === "string" ? name : "";
    let s = "Baseline: " + nm + " · PV " + fmtPomo1(x.pv) + " · EV " + fmtPomo1(x.ev) + " · AC " + fmtPomo1(x.ac) + " · BAC " + fmtPomo1(x.bac) + " 🍅";
    if (Number.isInteger(x.outside) && x.outside > 0) s += " · " + x.outside + " task di luar baseline";
    return s;
  }

  return Object.freeze({
    EST_MAX,
    DEFAULT_CAP,
    CAP_MAX,
    MILLI,
    LEAVE_MAX,
    NOTE_MAX,
    resourceDecode,
    resourceEncode,
    resourceByteSize,
    capAt,
    run,
    suggest,
    fmtPomo,
    hoursLabel,
    uidOf,
    isLive,
    isDone,
    ev,
    evText,
    evTip,
    fmtPomo1,
  });
})(
  typeof TLCal !== "undefined" ? TLCal : require("./calendar.js"),
  typeof TLSched !== "undefined" ? TLSched : require("./schedule.js"),
  typeof TLCpm !== "undefined" ? TLCpm : require("./cpm.js"),
);
if (typeof module !== "undefined" && module.exports) module.exports = TLLoad;
// part: layout.js
// Plugin Timeline — TLLayout: tata letak Gantt murni — kelompok, WBS, ringkasan, skala & rentang, header, jendela virtual,
// arsir akhir pekan, panah dependensi, label aksesibilitas (spec §8.5/§8.6, rencana R2, R9, R10, R11, R16, R21–R24).
// Murni: tanpa Date lokal, tanpa global, tanpa akses api. "Hari ini" dan kalender dimasukkan sebagai argumen.
// Kalender dikompilasi SEKALI per layout() (TLCal.compile menormalkan + men-stringify sebelum cache); semua panggilan
// TLCal yang bisa melempar TL_CAL_LOOP lewat TLSched (spanOf/violations/deadlineLate menurun: task tanpa bar, bukan crash).
const TLLayout = (function (CAL, SCHED, HOL) {
  const PX = Object.freeze({ day: 28, week: 12, month: 4 });
  const ROW_H = 32;
  const ROW_H_TOUCH = 36;
  const DEFAULT_ZOOM = "week";
  const PAD_BEFORE = 14; // hari sebelum mulai paling awal
  const PAD_AFTER = 30; // hari setelah selesai/tenggat paling akhir
  const TODAY_PAD = 60; // hari ± hari ini yang selalu masuk rentang
  const RANGE_SPAN = 1830; // tanggal yang ikut menentukan rentang dijepit ke hari ini ± 1830 hari (±5 tahun; deviasi R22)
  const MAX_WD_SPAN = 3660; // hari kalender maks yang dihitung untuk durasi hari kerja ringkasan (pola MAX_LATE_SPAN)
  const ARROW_OUT = 6; // px keluar dari sisi pendahulu (R19: ujung → kanan, awal → kiri)
  const ARROW_IN = 6; // px lari horizontal terakhir menuju sisi penerus
  const NO_PROJECT = "(Tanpa project)";

  const BULAN_SHORT = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
  const HARI_SHORT = ["Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Min"];

  const isInt = (n) => typeof n === "number" && Number.isInteger(n);
  const isFin = (n) => typeof n === "number" && Number.isFinite(n);

  // ---------------------------------------------------------------- geometri skala
  // Posisi x (px) awal hari `dn`; hari `range.from` = x 0.
  function xOf(dn, range, px) {
    return (dn - range.from) * px;
  }

  // Hari yang memuat posisi x (kebalikan xOf); tidak dijepit.
  function dnAt(x, range, px) {
    return range.from + Math.floor(x / px);
  }

  // Lebar total area grafik (px) untuk rentang inklusif.
  function widthOf(range, px) {
    return (range.to - range.from + 1) * px;
  }

  // Kotak bar {x, w, milestone}, dipangkas ke rentang; seluruhnya di luar rentang → null. Milestone (durasi 0 pada task biasa)
  // = titik pusat hari (lebar 0). `kind === "summary"` menang atas durasi 0: ringkasan selalu bar selebar rentangnya.
  function barBox(span, sched, range, px, kind) {
    if (!span) return null;
    const s = Math.max(span.s, range.from);
    const f = Math.min(span.f, range.to);
    if (f < s) return null;
    const x = xOf(s, range, px);
    if (kind !== "summary" && sched && sched.duration === 0) return { x: x + px / 2, w: 0, milestone: true };
    return { x, w: (f - s + 1) * px, milestone: false };
  }

  // ---------------------------------------------------------------- jendela virtual (R11)
  // Baris yang dirender = tampak ± buffer, dijepit ke [0, n − 1]. rows: array atau jumlah baris.
  function windowRows(rows, scrollTop, viewH, rowH, buffer) {
    const n = Array.isArray(rows) ? rows.length : isFin(rows) ? Math.max(0, Math.floor(rows)) : 0;
    const buf = buffer === undefined ? 10 : buffer;
    if (n === 0) return { first: 0, last: -1 };
    const h = rowH > 0 ? rowH : ROW_H;
    const top = isFin(scrollTop) ? Math.max(0, scrollTop) : 0;
    const vh = isFin(viewH) ? Math.max(0, viewH) : 0;
    const visFirst = Math.floor(top / h);
    const visLast = Math.ceil((top + vh) / h) - 1;
    const first = Math.min(n - 1, Math.max(0, visFirst - buf));
    const last = Math.min(n - 1, Math.max(first, visLast + buf));
    return { first, last };
  }

  // Kolom hari yang dirender: [scrollLeft − 1 layar, scrollLeft + 2 layar] (R11), dijepit ke rentang.
  function windowDays(range, px, scrollLeft, viewW) {
    const sl = isFin(scrollLeft) ? scrollLeft : 0;
    const vw = isFin(viewW) && viewW > 0 ? viewW : 0;
    const left = sl - vw;
    const right = sl + 2 * vw;
    return {
      fromDn: Math.max(range.from, Math.min(range.to, dnAt(left, range, px))),
      toDn: Math.max(range.from, Math.min(range.to, dnAt(right, range, px))),
    };
  }

  // scrollLeft awal: hari ini di 1/3 lebar grafik, dijepit ke [0, lebar − viewW].
  function initialScrollLeft(range, px, today, viewW) {
    const t = typeof today === "string" ? CAL.dn(today) : today;
    const maxScroll = Math.max(0, widthOf(range, px) - viewW);
    if (!isFin(t)) return 0;
    const want = xOf(t, range, px) - viewW / 3;
    return Math.round(Math.min(maxScroll, Math.max(0, want)));
  }

  // ---------------------------------------------------------------- header (R22)
  const pad2 = (n) => String(n).padStart(2, "0");
  const ymd = (n) => {
    const s = CAL.iso(n);
    return { y: +s.slice(0, 4), m: +s.slice(5, 7), d: +s.slice(8, 10) };
  };
  const monthStart = (y, m) => CAL.dn(String(y).padStart(4, "0") + "-" + pad2(m) + "-01");
  const nextMonth = (y, m) => (m === 12 ? [y + 1, 1] : [y, m + 1]);

  // Sel dijepit ke [fromDn, toDn]: dn = awal terlihat, days = lebar terlihat; key memakai awal sel sebenarnya.
  function clip(key, start, endExcl, fromDn, toDn, label, sub) {
    const dn = Math.max(start, fromDn);
    const last = Math.min(endExcl - 1, toDn);
    return { key, dn, days: last - dn + 1, label, sub: sub === undefined ? null : sub };
  }

  function monthCells(fromDn, toDn, labelOf) {
    const out = [];
    let { y, m } = ymd(fromDn);
    for (let guard = 0; guard < 5000; guard++) {
      const s = monthStart(y, m);
      if (s > toDn) break;
      const [ny, nm] = nextMonth(y, m);
      const e = monthStart(ny, nm);
      const l = labelOf(y, m);
      out.push(clip("m" + y + "-" + pad2(m), s, e, fromDn, toDn, l.label, l.sub));
      y = ny;
      m = nm;
    }
    return out;
  }

  // zoom "day"   : atas = bulan "Nov 2026", bawah = tanggal {label "5", sub "Kam"}
  // zoom "week"  : atas = bulan "Nov 2026", bawah = minggu ISO "Mg 45" (awal Senin)
  // zoom "month" : atas = kuartal {label "K4", sub "2026"}, bawah = bulan "Nov"
  // Setiap sel {key, dn, days, label, sub}. Rentang masukan inklusif; kosong bila fromDn > toDn atau tak sah.
  function headerTicks(zoom, fromDn, toDn) {
    const top = [];
    const bottom = [];
    if (!isInt(fromDn) || !isInt(toDn) || fromDn > toDn) return { top, bottom };
    if (zoom === "month") {
      let { y, m } = ymd(fromDn);
      let q = Math.floor((m - 1) / 3);
      for (let guard = 0; guard < 2000; guard++) {
        const s = monthStart(y, q * 3 + 1);
        if (s > toDn) break;
        const ny = q === 3 ? y + 1 : y;
        const nq = q === 3 ? 0 : q + 1;
        top.push(clip("q" + y + "-" + (q + 1), s, monthStart(ny, nq * 3 + 1), fromDn, toDn, "K" + (q + 1), String(y)));
        y = ny;
        q = nq;
      }
      bottom.push(...monthCells(fromDn, toDn, (yy, mm) => ({ label: BULAN_SHORT[mm - 1], sub: null })));
      return { top, bottom };
    }
    top.push(...monthCells(fromDn, toDn, (yy, mm) => ({ label: BULAN_SHORT[mm - 1] + " " + yy, sub: null })));
    if (zoom === "day") {
      for (let d = fromDn; d <= toDn; d++) bottom.push({ key: "d" + d, dn: d, days: 1, label: String(ymd(d).d), sub: HARI_SHORT[CAL.isoWeekday(d) - 1] });
    } else {
      for (let s = fromDn - (CAL.isoWeekday(fromDn) - 1); s <= toDn; s += 7) {
        bottom.push(clip("w" + s, s, s + 7, fromDn, toDn, "Mg " + CAL.isoWeek(s).week, null));
      }
    }
    return { top, bottom };
  }

  // ---------------------------------------------------------------- arsir (R11)
  // repeating-linear-gradient periode 7 × px dari mask hari kerja + weekday hari pertama rentang; hanya token tema.
  function weekendGradient(c, range, px) {
    const p = px > 0 ? px : PX[DEFAULT_ZOOM];
    const w0 = CAL.isoWeekday(range.from);
    const colors = [];
    for (let i = 0; i < 7; i++) colors.push(c.mask.has(((w0 - 1 + i) % 7) + 1) ? "transparent" : "var(--bg-subtle)");
    const stops = [];
    let start = 0;
    for (let i = 1; i <= 7; i++) {
      if (i === 7 || colors[i] !== colors[start]) {
        stops.push(colors[start] + " " + start * p + "px", colors[start] + " " + i * p + "px");
        start = i;
      }
    }
    return "repeating-linear-gradient(to right, " + stops.join(", ") + ")";
  }

  // Nama libur kustom dari kunci kalender terkompilasi (JSON ternormalisasi), di-cache per kunci terakhir.
  let namesKey = null;
  let namesMap = null;
  function customNames(c) {
    if (namesKey === c.key && namesMap) return namesMap;
    const map = new Map();
    try {
      const cal = JSON.parse(c.key);
      for (const e of cal && Array.isArray(cal.off) ? cal.off : []) map.set(CAL.dn(e.d), e.n || "Libur");
    } catch (e) {
      /* kunci tak terbaca: tanpa nama kustom */
    }
    namesKey = c.key;
    namesMap = map;
    return map;
  }

  // Hari libur (off, bukan diganti hari kerja pengganti) di [fromDn, toDn]: [{dn, name, weekend}];
  // weekend = hari itu memang bukan hari kerja menurut pola minggu (tetap dilaporkan).
  function holidaySpans(c, fromDn, toDn, holidays) {
    const out = [];
    if (!c || !isInt(fromDn) || !isInt(toDn) || fromDn > toDn) return out;
    const names = customNames(c);
    const H = holidays || HOL;
    for (let d = fromDn; d <= toDn; d++) {
      if (!c.off.has(d) || c.work.has(d)) continue;
      let name = names.get(d);
      if (name === undefined && H && typeof H.lookup === "function") {
        const hit = H.lookup(CAL.iso(d));
        if (hit && ((hit.kind === "libur" && c.national) || (hit.kind === "cuti" && c.cutiBersama))) name = hit.nama;
      }
      out.push({ dn: d, name: name || "Libur", weekend: !c.mask.has(CAL.isoWeekday(d)) });
    }
    return out;
  }

  // ---------------------------------------------------------------- panah (R11, R16)
  const fmt = (n) => String(Math.round(n * 100) / 100);

  // Sisi panah per tipe dependensi (R19): [keluar dari AWAL pendahulu?, masuk ke UJUNG penerus?].
  // FS ujung→awal (1b), SS awal→awal, FF ujung→ujung, SF awal→ujung. Tipe tak dikenal = FS.
  const ARROW_SIDES = Object.freeze({ FS: [false, false], SS: [true, false], FF: [false, true], SF: [true, true] });

  // Rect = {x, y, w, h}. Hanya H/V. Keluar 6 px dari sisi pendahulu (ujung → ke kanan, awal → ke kiri); lari masuk
  // terakhir ≥ 6 px menuju sisi penerus (awal: dari kiri, bergerak ke kanan; ujung: dari kanan, bergerak ke kiri).
  // Arah keluar ≠ arah masuk (SS, FF): satu garis tegak di x terjauh yang memenuhi keduanya (M H V H) — selalu bisa.
  // Arah sama (FS, SF): M H V H bila penerus cukup jauh ke arah itu (FS: ≥ 12 px di kanan ujung pendahulu); selain itu
  // memutar lewat celah antarbaris (M H V H V H). Baris sama: lewat tepat di bawah bar. FS = path 1b persis.
  function arrowPath(fromRect, toRect, type) {
    const sides = ARROW_SIDES[type] || ARROW_SIDES.FS;
    const dOut = sides[0] ? -1 : 1; // arah lari keluar
    const dIn = sides[1] ? -1 : 1; // arah lari masuk terakhir
    const x1 = sides[0] ? fromRect.x : fromRect.x + fromRect.w;
    const y1 = fromRect.y + fromRect.h / 2;
    const x2 = sides[1] ? toRect.x + toRect.w : toRect.x;
    const y2 = toRect.y + toRect.h / 2;
    const xo = x1 + dOut * ARROW_OUT;
    const xi = x2 - dIn * ARROW_IN;
    if (dOut !== dIn && y1 !== y2) {
      const xv = dOut > 0 ? Math.max(xo, xi) : Math.min(xo, xi);
      return "M" + fmt(x1) + " " + fmt(y1) + "H" + fmt(xv) + "V" + fmt(y2) + "H" + fmt(x2);
    }
    if (dOut === dIn && (xi - xo) * dOut >= 0) return "M" + fmt(x1) + " " + fmt(y1) + "H" + fmt(xo) + "V" + fmt(y2) + "H" + fmt(x2);
    let yt;
    if (y2 > y1) yt = (fromRect.y + fromRect.h + toRect.y) / 2;
    else if (y2 < y1) yt = (toRect.y + toRect.h + fromRect.y) / 2;
    else yt = fromRect.y + fromRect.h + 2; // baris sama: lewat tepat di bawah bar
    return "M" + fmt(x1) + " " + fmt(y1) + "H" + fmt(xo) + "V" + fmt(yt) + "H" + fmt(xi) + "V" + fmt(y2) + "H" + fmt(x2);
  }

  // ---------------------------------------------------------------- aksesibilitas (R23)
  // progress: 0–100 atau null/undefined (dihilangkan). sched.duration = durasi hari kerja (untuk ringkasan: row.duration).
  function ariaBar(task, sched, span, progress, kind) {
    const raw = task && task.title !== undefined && task.title !== null ? String(task.title).trim() : "";
    const title = raw || "Tanpa judul";
    if (!span) return title + ", belum dijadwalkan";
    if (kind !== "summary" && sched && sched.duration === 0) return title + ", milestone " + CAL.fmtShort(span.s);
    let out = title + ", " + CAL.fmtShort(span.s) + " sampai " + CAL.fmtShort(span.f);
    if (sched && isInt(sched.duration)) out += ", " + sched.duration + " hari kerja";
    if (isFin(progress)) out += ", " + Math.round(Math.min(100, Math.max(0, progress))) + "%";
    return out;
  }

  // ---------------------------------------------------------------- baris (R9, R10, R16, R21)
  function defaultRead(task) {
    const out = {};
    const ext = task && task.ext;
    if (ext && typeof ext === "object") for (const k of Object.keys(ext)) if (k.indexOf("timeline.") === 0) out[k.slice(9)] = ext[k];
    return SCHED.readSched(out);
  }

  const keyOfTask = (t) => (t.id !== undefined && t.id !== null && t.id !== "" ? String(t.id) : t.cid !== undefined && t.cid !== null && t.cid !== "" ? String(t.cid) : null);

  function cmpId(a, b) {
    const na = typeof a === "number";
    const nb = typeof b === "number";
    if (na && nb) return a - b;
    if (na !== nb) return na ? -1 : 1;
    const sa = String(a);
    const sb = String(b);
    return sa < sb ? -1 : sa > sb ? 1 : 0;
  }

  // Urut bawaan saudara: created_at lalu id (stabil).
  function cmpDefault(a, b) {
    const ca = String(a.task.created_at || "");
    const cb = String(b.task.created_at || "");
    if (ca !== cb) return ca < cb ? -1 : 1;
    return cmpId(a.task.id !== undefined ? a.task.id : a.task.cid, b.task.id !== undefined ? b.task.id : b.task.cid);
  }

  const cmpStart = (a, b) => {
    const as = a.span ? a.span.s : null;
    const bs = b.span ? b.span.s : null;
    if (as !== bs) {
      if (as === null) return 1;
      if (bs === null) return -1;
      return as - bs;
    }
    return a.ord - b.ord;
  };

  function toDn(v) {
    if (typeof v === "string") return CAL.dn(v.slice(0, 10));
    return isInt(v) ? v : NaN;
  }

  const trimName = (t) => (typeof t.project === "string" ? t.project.trim() : ""); // hanya untuk nama tampilan
  // Kunci nama = SCHED.projectFold (lipatan host projectNameFold, tanpa trim); nama kosong/hanya spasi = tanpa project.
  const nameKey = (t) => (trimName(t) ? SCHED.projectFold(t.project) : "");

  // Kelompok workspace: project_id, fallback nama project (lipatan host); nama yang cocok dengan kelompok ber-id ikut kelompok itu.
  function groupKeyer(items) {
    const nameToId = new Map(); // lipatan nama → project_id
    for (const it of items) {
      const nm = nameKey(it.task);
      if (it.task.project_id != null && nm && !nameToId.has(nm)) nameToId.set(nm, it.task.project_id);
    }
    return (t) => {
      const nm = nameKey(t);
      if (t.project_id != null) return "p:" + t.project_id;
      if (nm) return nameToId.has(nm) ? "p:" + nameToId.get(nm) : "n:" + nm;
      return "none";
    };
  }

  // Kalender terkompilasi dikenali lewat bentuknya (bukan instanceof Set).
  function isCompiled(c) {
    return !!c && typeof c.key === "string" && !!c.mask && typeof c.mask.has === "function" && !!c.off && typeof c.off.has === "function" && !!c.work && typeof c.work.has === "function";
  }

  function layout(args) {
    const a = args || {};
    const c = isCompiled(a.cal) ? a.cal : CAL.compile(a.cal || CAL.DEFAULT_CAL); // sekali per layout
    const todayDn = toDn(a.today);
    const zoom = PX[a.zoom] ? a.zoom : DEFAULT_ZOOM;
    const px = PX[zoom];
    const workspace = a.pageKind === "workspace";
    const sortStart = a.sort === "start";
    const w0 = isInt(todayDn) ? todayDn - RANGE_SPAN : -Infinity; // jendela rentang
    const w1 = isInt(todayDn) ? todayDn + RANGE_SPAN : Infinity;
    const clampW = (d) => Math.min(w1, Math.max(w0, d));
    const readOf = typeof a.readSchedOf === "function" ? a.readSchedOf : defaultRead;

    // 1. dibuang: berulang, archived, deleted; duplikat kunci → yang pertama.
    const items = [];
    const byKey = new Set();
    for (const t of Array.isArray(a.tasks) ? a.tasks : []) {
      if (!t || typeof t !== "object") continue;
      if (t.recurrence_type || t.gtd_status === "archived" || t.deleted) continue;
      const key = keyOfTask(t);
      if (key === null || byKey.has(key)) continue;
      byKey.add(key);
      items.push({ key, task: t, sched: readOf(t), children: [], parent: null, group: null, depth: 0, wbs: "", ord: 0, span: null });
    }
    items.sort(cmpDefault);
    const tasksOnly = items.map((it) => it.task);
    const index = SCHED.buildIndex(tasksOnly);
    const itemOf = new Map(items.map((it) => [it.task, it]));

    // 2. hierarki (R9): induk di scope → anak mengikuti; selain itu akar. Lingkaran induk diputus deterministik.
    for (const it of items) {
      const p = it.task.parent_id !== undefined && it.task.parent_id !== null ? it.task.parent_id : it.task.parent_cid;
      if (p === undefined || p === null || p === "") continue;
      const found = index.get(String(p));
      const pi = found ? itemOf.get(found) : null;
      if (pi && pi !== it) it.parent = pi;
    }
    const color = new Map();
    for (const it of items) {
      if (color.get(it)) continue;
      const path = [];
      let cur = it;
      while (cur && !color.get(cur)) {
        color.set(cur, 1);
        path.push(cur);
        if (cur.parent && color.get(cur.parent) === 1) {
          cur.parent = null; // lingkaran: putus di sini
          break;
        }
        cur = cur.parent;
      }
      for (const n of path) color.set(n, 2);
    }
    for (const it of items) if (it.parent) it.parent.children.push(it); // items sudah urut bawaan → anak urut bawaan

    // 3. kelompok + WBS + kedalaman (urut bawaan), pra-urut iteratif.
    const keyer = workspace ? groupKeyer(items) : () => "all";
    const groupMap = new Map(); // key → {key, name, n, roots, ...}
    for (const it of items) {
      if (it.parent) continue;
      const gk = keyer(it.task);
      let g = groupMap.get(gk);
      if (!g) {
        g = { key: gk, name: null, n: 0, roots: [], taskCount: 0, rowCount: 0 };
        groupMap.set(gk, g);
      }
      g.roots.push(it);
    }
    let groups = [...groupMap.values()];
    if (workspace) {
      for (const g of groups) {
        if (g.key === "none") g.name = NO_PROJECT;
        else {
          const first = g.roots.find((r) => trimName(r.task)) || g.roots[0];
          const nm = trimName(first.task);
          g.name = nm || (g.key.indexOf("p:") === 0 ? "Project " + g.key.slice(2) : NO_PROJECT);
        }
      }
      groups.sort((x, y) => {
        if (x.key === "none" || y.key === "none") return x.key === "none" ? (y.key === "none" ? 0 : 1) : -1;
        return x.name.localeCompare(y.name, "id") || (x.key < y.key ? -1 : x.key > y.key ? 1 : 0);
      });
    }
    groups.forEach((g, i) => (g.n = i + 1));

    let ord = 0;
    const all = []; // pra-urut bawaan: induk sebelum anak
    for (const g of groups) {
      const stack = [];
      for (let i = g.roots.length - 1; i >= 0; i--) {
        const r = g.roots[i];
        r.wbs = workspace ? g.n + "." + (i + 1) : String(i + 1);
        r.depth = 0;
        r.group = g.key;
        stack.push(r);
      }
      while (stack.length) {
        const it = stack.pop();
        it.ord = ord++;
        all.push(it);
        g.taskCount++;
        for (let i = it.children.length - 1; i >= 0; i--) {
          const ch = it.children[i];
          ch.wbs = it.wbs + "." + (i + 1);
          ch.depth = it.depth + 1;
          ch.group = it.group;
          stack.push(ch);
        }
      }
    }

    // 4. rentang hari: daun lewat spanOf; ringkasan = min–maks anak terjadwal (rekursif, dari belakang pra-urut).
    for (let i = all.length - 1; i >= 0; i--) {
      const it = all[i];
      if (it.children.length) {
        let s = Infinity;
        let f = -Infinity;
        for (const ch of it.children) {
          if (!ch.span) continue;
          if (ch.span.s < s) s = ch.span.s;
          if (ch.span.f > f) f = ch.span.f;
        }
        it.span = s === Infinity ? null : { s, f };
      } else it.span = SCHED.spanOf(c, it.sched);
    }

    // 5. urut tampilan "Mulai": saudara diurut mulai naik (tanpa jadwal terakhir); WBS tidak berubah.
    if (sortStart) {
      for (const g of groups) g.roots.sort(cmpStart);
      for (const it of all) if (it.children.length > 1) it.children.sort(cmpStart);
    }

    // 6. baris tampilan
    const rows = [];
    const rowOf = new Map();
    for (const g of groups) {
      if (workspace) {
        rows.push({ key: "g:" + g.key, task: null, group: g.key, depth: 0, wbs: String(g.n), kind: "group", span: null, sched: null, late: 0, violation: false, duration: null, progress: null, done: false, deadlineDn: null, childCount: 0, parentKey: null, outOfRange: false, index: rows.length });
      }
      const stack = [];
      for (let i = g.roots.length - 1; i >= 0; i--) stack.push(g.roots[i]);
      while (stack.length) {
        const it = stack.pop();
        const t = it.task;
        const summary = it.children.length > 0;
        const done = t.gtd_status === "done" || !!t.completed_at;
        const pr = Number(t.progress);
        const deadlineDn = t.deadline === undefined || t.deadline === null ? NaN : CAL.dn(String(t.deadline).slice(0, 10));
        const lateN = it.span ? SCHED.deadlineLate(c, it.span.f, t.deadline) : null;
        const row = {
          key: it.key,
          task: t,
          group: g.key,
          depth: it.depth,
          wbs: it.wbs,
          kind: summary ? "summary" : "task",
          span: it.span,
          sched: it.sched,
          late: lateN > 0 ? lateN : 0,
          violation: false,
          duration: summary ? (it.span ? CAL.workdays(c, it.span.s, Math.min(it.span.f, it.span.s + MAX_WD_SPAN)) : null) : it.sched.duration,
          progress: done ? 100 : Number.isFinite(pr) ? Math.min(100, Math.max(0, pr)) : 0,
          done,
          deadlineDn: Number.isInteger(deadlineDn) ? deadlineDn : null,
          childCount: it.children.length,
          parentKey: it.parent ? it.parent.key : null,
          outOfRange: !!it.span && (it.span.f < w0 || it.span.s > w1),
          index: rows.length,
        };
        rows.push(row);
        rowOf.set(it.key, row);
        g.rowCount++;
        for (let i = it.children.length - 1; i >= 0; i--) stack.push(it.children[i]);
      }
    }

    // 7. dependensi (R8, R16): kunci kanonik String(id); spans memuat rentang ringkasan.
    // Rentang pelanggaran daun = jangkar mesin (aturan α1 1c-1, diperluas aktual 1c-2) — SATU aturan "terlalu awal":
    //  - DONE: mulai = actual.start ?? Mulai, selesai = TLSched.doneFinish (prioritas done tertinggi → tanpa resolver);
    //  - BERJALAN via actual.start: hanya bila resolver `a.anchorInfo` ada DAN modeOf(task) = "auto" DAN bukan anggota
    //    lingkaran (manual/cycle > started di mesin → tetap rentang tersimpan); mulai = actual.start, selesai = fin(mulai, d).
    //  Tanpa Mulai (rentang null): dibangun dari actual.start HANYA bila resolver ada dan anchorInfo.inEngine(key) (task itu
    //  simpul mesin — selain itu mesin melewatinya, layout juga); durasi = anchorInfo.durOf(key) (durasi simpul mesin)
    //  ?? durasi readSched ?? 1. Resolver absen / tanpa inEngine → dilewati (perilaku 1c-1).
    // Aktual dari it.sched (bacaan ext yang sama dengan bar). d dibawa agar penerus tetap memakai durasi tersimpannya.
    // Rentang bar (row.span) tidak berubah. Tanpa resolver → perilaku 1c-1 untuk task yang belum selesai.
    const ai = a.anchorInfo && typeof a.anchorInfo.modeOf === "function" && typeof a.anchorInfo.inCycle === "function" ? a.anchorInfo : null;
    const inEngine = (k) => !!ai && typeof ai.inEngine === "function" && ai.inEngine(k) === true;
    const durOf = (it) => {
      const v = ai && typeof ai.durOf === "function" ? ai.durOf(it.key) : undefined;
      if (isInt(v) && v >= 0) return v;
      return it.sched.duration === null || it.sched.duration === undefined ? 1 : it.sched.duration;
    };
    const spans = new Map();
    for (const it of all) {
      const t = it.task;
      const leaf = it.children.length === 0;
      const a0 = leaf ? SCHED.actualOf(t, it.sched).start : null;
      const built = !it.span && a0 !== null && inEngine(it.key); // rentang null → hanya simpul mesin
      const d = built ? durOf(it) : it.sched.duration === null || it.sched.duration === undefined ? 1 : it.sched.duration;
      let sp = it.span;
      if (leaf && (t.gtd_status === "done" || !!t.completed_at)) {
        const s = it.span ? (a0 !== null ? a0 : it.span.s) : built ? a0 : null;
        const f = s === null ? undefined : SCHED.doneFinish(c, t, it.sched, s, d);
        if (isInt(f)) sp = { s, f, d };
      } else if (a0 !== null && (it.span || built) && ai && ai.modeOf(t) === "auto" && !ai.inCycle(it.key)) {
        const f = SCHED.fin(c, a0, d);
        if (isInt(f)) sp = { s: a0, f, d };
      }
      if (sp) spans.set(it.key, sp);
    }
    const edges = SCHED.resolveDeps(items.map((it) => ({ key: it.key, sched: it.sched })), index);
    const viol = SCHED.violations(c, spans, edges);
    const violPair = new Set(viol.detail.map((d) => d.pred + "\u0000" + d.succ));
    for (const e of edges) {
      const fr = rowOf.get(e.from);
      const tr = rowOf.get(e.to);
      e.fromRow = fr ? fr.index : null;
      e.toRow = tr ? tr.index : null;
      e.violation = violPair.has(e.from + "\u0000" + e.to);
      e.drawn = e.ok && !!(fr && tr && fr.span && tr.span && !fr.outOfRange && !tr.outOfRange);
    }
    for (const k of viol) {
      const r = rowOf.get(k);
      if (r) r.violation = true;
    }

    // 8. rentang tampak (R22): [min(mulai) − 14, maks(selesai, tenggat) + 30] ∪ [hari ini ± 60]
    let lo = Infinity;
    let hi = -Infinity;
    for (const r of rows) {
      if (r.span) {
        const cs = clampW(r.span.s);
        const cf = clampW(r.span.f);
        if (cs < lo) lo = cs;
        if (cf > hi) hi = cf;
      }
      if (r.deadlineDn !== null) {
        const cd = clampW(r.deadlineDn);
        if (cd > hi) hi = cd;
      }
    }
    let from = lo === Infinity ? Infinity : lo - PAD_BEFORE;
    let to = hi === -Infinity ? -Infinity : hi + PAD_AFTER;
    if (isInt(todayDn)) {
      from = Math.min(from, todayDn - TODAY_PAD);
      to = Math.max(to, todayDn + TODAY_PAD);
    }
    if (from === Infinity || to === -Infinity) {
      from = 0;
      to = 2 * TODAY_PAD;
    } else if (to < from) to = from;
    const range = { from, to };

    // 9. statistik
    let summaries = 0;
    let scheduled = 0;
    let unscheduled = 0;
    let nViol = 0;
    let nLate = 0;
    let nOut = 0;
    for (const r of rows) {
      if (r.kind === "group") continue;
      if (r.outOfRange) nOut++;
      if (r.kind === "summary") summaries++;
      if (r.span) scheduled++;
      else unscheduled++;
      if (r.violation) nViol++;
      if (r.late > 0) nLate++;
    }

    return {
      cal: c,
      groups: groups.map((g) => ({ key: g.key, name: g.name, n: g.n, taskCount: g.taskCount, rowCount: g.rowCount })),
      rows,
      edges,
      range,
      px,
      zoom,
      missingYears: CAL.missingYears(c, range.from, range.to),
      stats: { rows: rows.length, tasks: items.length, summaries, scheduled, unscheduled, violations: nViol, late: nLate, outOfRange: nOut, groups: groups.length, edges: edges.length },
    };
  }

  // Nomor WBS per kunci task (1c-1 R20): sama dengan tata letak (urut bawaan; urut tampilan tidak mengubah WBS),
  // tanpa baris kelompok. Kalender bawaan: WBS tidak bergantung pada kalender.
  function wbsMap(tasks, pageKind, readSchedOf) {
    const res = layout({ tasks, pageKind, readSchedOf, sort: "wbs" });
    const out = new Map();
    for (const r of res.rows) if (r.kind !== "group") out.set(r.key, r.wbs);
    return out;
  }

  return Object.freeze({
    PX,
    ROW_H,
    ROW_H_TOUCH,
    layout,
    windowRows,
    windowDays,
    xOf,
    dnAt,
    widthOf,
    barBox,
    headerTicks,
    weekendGradient,
    holidaySpans,
    arrowPath,
    wbsMap,
    ariaBar,
    initialScrollLeft,
  });
})(
  typeof TLCal !== "undefined" ? TLCal : require("./calendar.js"),
  typeof TLSched !== "undefined" ? TLSched : require("./schedule.js"),
  typeof TLHolidays !== "undefined" ? TLHolidays : require("./holidays-id.js"),
);
if (typeof module !== "undefined" && module.exports) module.exports = TLLayout;
// part: mspdi.js
// Plugin Timeline — TLMspdi: pembangun XML MSPDI (Microsoft Project XML Data Interchange) murni untuk "Ekspor ke
// Microsoft Project (.xml)" (spec 1d K53, §5.4, §8; rencana 1d-2 R5, R7–R10, dikoreksi review F2).
// Masukan = data yang sudah dibaca mesin (eng.ctx.tasks daftar lengkap halaman, kalender halaman, hasil TLCpm.run,
// baseline aktif terdekode, nama orang); keluaran = string XML + statistik untuk toast. Murni: tanpa jam lokal, tanpa
// global, tanpa DOM, TIDAK menulis (K27/R25) dan tidak mengubah masukan. Urutan baris = TLLayout.layout sort "wbs"
// (sama dengan Gantt); urutan lain lewat TLCpm.cmpKey → string identik untuk urutan masukan apa pun.
// Paritas mesin (review F2, uji pemilik F4): tanggal task = hasil TLCpm.run (es/ef), tautan = sisi yang dipakai mesin
// (result.pred), dan kendala/aktual dipilih dengan aritmetika waktu kerja MS Project (planNode) supaya penjadwalan
// MS Project (HonorConstraints 1) menghasilkan tanggal tampil yang sama TANPA konflik kendala (tanpa MSO).
// Resource memakai kalender resource turunan kalender UID 1 (libur ikut) agar Work/Units muat di tanggal task.
// Urutan elemen = XSD MSPDI: propOrder JAXB skema MSPDI MPXJ 16.10 (org.mpxj.mspdi.schema.Project, dibangkitkan dari
// XSD Microsoft Project 2010+; `Manual` SETELAH `Name`, SEBELUM `Type`); urutan Project dicocokkan dengan dokumentasi
// Microsoft "Project elements and XML structure".
// Bundel: bergantung pada TLLayout dan TLLoad → di manifest `parts` WAJIB setelah layout.js (dan load.js); di depan
// layout.js, `typeof TLLayout` jatuh di zona mati temporal `const` bundel dan melempar saat plugin dimuat.
const TLMspdi = (function (CAL, SCHED, CPM, LAYOUT, LOAD, HOL) {
  const NS = "http://schemas.microsoft.com/project";
  const PROLOG = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
  const SAVE_VERSION = 14;
  const MIN_DAY = 480; // menit kerja per hari (08:00–12:00 + 13:00–17:00)
  const SEC_DAY = MIN_DAY * 60; // detik kerja per hari (kemajuan ditulis eksak dalam detik, F6)
  const POMO_MIN = 25; // menit per 🍅 (rumus hoursLabel TLLoad)
  const LAG_UNIT = 4800; // LinkLag = persepuluh menit; 1 hari kerja = 480 × 10
  const LAG_FORMAT = 7; // hari
  const DUR_FORMAT = 7; // hari
  const DUR_FORMAT_EST = 39; // hari perkiraan ("d?"), kode yang ditulis MS Project/MSPDIWriter MPXJ untuk durasi Estimated
  const WORK_FORMAT = 2; // jam
  const EST_MAX = LOAD.EST_MAX; // R3 1d-1: target 🍅 dijepit batas host
  const NAME_CUT = 80; // R9: maks code point judul di nama berkas
  const NAME_MAX = 255; // M2 F2: maks code point nama task/resource/judul/kelompok/pengecualian
  const PAD_BEFORE = 7; // R7: pengecualian kalender mulai paling awal − 7 hari
  const PAD_AFTER = 31; // R7: … sampai selesai paling akhir + 31 hari
  const SPAN_MAX = 3660; // R7: maks hari kalender rentang pengecualian / hitung hari kerja ringkasan
  const HALF_SPAN = 1830; // rentang terlalu lebar → digeser mendekati hari ini ± 1830 (pola RANGE_SPAN TLLayout)
  const DEFAULT_TITLE = "Timeline";
  // Nama kalender dasar = "Standard", nama kalender dasar bawaan MS Project dan MPXJ (uji pemilik #2 F6: nama lain diduga
  // membuat MS Project memakai kalender proyek sementara tanpa libur saat impor).
  const CAL_NAME = "Standard";
  const NO_RES = "Anggota #";
  const NULL_RES = -65535; // ResourceUID "tanpa resource" MS Project (assignment semu, F6)
  const LINK_TYPE = Object.freeze({ FF: 0, FS: 1, SF: 2, SS: 3 });
  // ConstraintType MSPDI: 0 ASAP, 3 MFO (harus selesai pada), 4 SNET (mulai tidak lebih awal). 2 MSO (harus mulai pada)
  // sengaja tidak dipakai (uji pemilik F4: MSO di tanggal yang dilanggar tautan = ikon konflik kendala di MS Project).
  const C_ASAP = 0;
  const C_MFO = 3;
  const C_SNET = 4;
  const T_START = "T08:00:00";
  const T_FINISH = "T17:00:00";
  const T_DAY0 = "T00:00:00";
  const T_DAY_END = "T23:59:00";
  const cmpKey = CPM.cmpKey;

  const isObj = (o) => o !== null && typeof o === "object" && !Array.isArray(o);
  const isDn = (n) => Number.isInteger(n);

  // ---- escape (R7) ----
  // esc(s): & < > " ' → entitas; karakter yang tidak sah di XML 1.0 DIBUANG: C0 selain \t \n \r, U+007F, U+FFFE/U+FFFF,
  // dan surrogate tunggal (tak berpasangan). Pasangan surrogate (emoji) utuh. Bukan string → "".
  function esc(s) {
    if (typeof s !== "string") return "";
    let out = "";
    let from = 0;
    for (let i = 0; i < s.length; i++) {
      const u = s.charCodeAt(i);
      let rep;
      if (u >= 0xd800 && u <= 0xdbff) {
        const lo = i + 1 < s.length ? s.charCodeAt(i + 1) : 0;
        if (lo >= 0xdc00 && lo <= 0xdfff) {
          i++;
          continue;
        }
        rep = "";
      } else if (u >= 0xdc00 && u <= 0xdfff) rep = "";
      else if (u === 38) rep = "&amp;";
      else if (u === 60) rep = "&lt;";
      else if (u === 62) rep = "&gt;";
      else if (u === 34) rep = "&quot;";
      else if (u === 39) rep = "&apos;";
      else if ((u < 32 && u !== 9 && u !== 10 && u !== 13) || u === 127 || u === 0xfffe || u === 0xffff) rep = "";
      else continue;
      out += s.slice(from, i) + rep;
      from = i + 1;
    }
    return from === 0 ? s : out + s.slice(from);
  }

  // Nama tampilan (M2 F2): \t \r \n → spasi (MS Project menampilkan nama satu baris), lalu dipotong NAME_MAX code point
  // (pasangan surrogate tidak terbelah). Bukan string → "". Karakter tak sah XML dibuang kemudian oleh esc.
  function clip(s) {
    const src = typeof s === "string" ? s.replace(/[\t\r\n]/g, " ") : "";
    if (src.length <= NAME_MAX) return src;
    let out = "";
    let n = 0;
    for (const ch of src) {
      if (n++ >= NAME_MAX) break;
      out += ch;
    }
    return out;
  }

  // ---- nama berkas (R9) ----
  // Karakter yang diganti "-": terlarang saveFile (/ \ : * ? " < > |), kontrol C0/DEL/C1, spasi (\s, termasuk NBSP,
  // U+2028/9, BOM U+FEFF), dan kontrol arah/format teks (U+061C, U+200B–U+200F, U+202A–U+202E, U+2066–U+2069) yang bisa
  // menyamarkan ekstensi. Ditulis sebagai escape \u (sumber tidak memuat karakter bidi mentah, review F2 I5).
  // Surrogate tunggal juga diganti "-".
  const FILE_BAD_RE = /[\/\\:*?"<>|\s\u0000-\u001f\u007f-\u009f\u061c\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/;
  const isLone = (ch) => ch.length === 1 && ch.charCodeAt(0) >= 0xd800 && ch.charCodeAt(0) <= 0xdfff;

  // fileNameOf(title, D) → "{judul}-{YYYY-MM-DD}.xml": rangkaian karakter tak aman/spasi → satu "-", titik/"-" di awal-
  // akhir dibuang, dipotong NAME_CUT code point (pasangan surrogate tidak terbelah), kosong → "Timeline"; D bukan
  // bilangan hari → tanpa tanggal. Hasil selalu lolos validasi api.ui.saveFile (1–120 code point, tanpa karakter
  // terlarang/kontrol, tidak diawali titik).
  function fileNameOf(title, D) {
    const src = typeof title === "string" ? title : "";
    let s = "";
    for (const ch of src) s += isLone(ch) || FILE_BAD_RE.test(ch) ? "-" : ch;
    s = s.replace(/-{2,}/g, "-").replace(/^[.-]+/, "");
    let cut = "";
    let n = 0;
    for (const ch of s) {
      if (n++ >= NAME_CUT) break;
      cut += ch;
    }
    cut = cut.replace(/[.-]+$/, "");
    if (!cut) cut = DEFAULT_TITLE;
    return cut + (isDn(D) ? "-" + CAL.iso(D) : "") + ".xml";
  }

  // ---- pembantu data ----
  // Target 🍅 = salinan targetOf load.js (R3 1d-1): bilangan bulat ≥ 1 dijepit EST_MAX, selain itu 1 (dikunci tes silang
  // lewat TLLoad.run; disalin agar modul ini tidak bergantung pada fungsi internal TLLoad).
  const targetOf = (t) => (isObj(t) && Number.isInteger(t.estimated_pomodoros) && t.estimated_pomodoros >= 1 ? Math.min(EST_MAX, t.estimated_pomodoros) : 1);

  // Ext mentah task (pola rawOf TLLoad/TLPlan): readExt melempar / bukan objek → {}.
  function rawOf(readExt, task) {
    let raw;
    try {
      raw = typeof readExt === "function" ? readExt(task) : task && isObj(task.ext) ? task.ext : {};
    } catch (e) {
      raw = {};
    }
    return isObj(raw) ? raw : {};
  }

  // Kalender terkompilasi dikenali dari bentuknya (pola TLLayout/TLLoad); mentah/kosong → dikompilasi.
  function calOf(c) {
    const ok = !!c && typeof c.key === "string" && !!c.mask && typeof c.mask.has === "function" && !!c.off && typeof c.off.has === "function" && !!c.work && typeof c.work.has === "function";
    return ok ? c : CAL.compile(c || CAL.DEFAULT_CAL);
  }

  function workAt(c, dn) {
    try {
      return CAL.isWork(c, dn) === true;
    } catch (e) {
      return false;
    }
  }

  // Hari kerja pertama ≥ dn; kalender buntu (TL_CAL_LOOP) / galat → dn apa adanya.
  function nextWorkOr(c, dn) {
    try {
      const n = CAL.nextWork(c, dn);
      return isDn(n) ? n : dn;
    } catch (e) {
      return dn;
    }
  }

  // Hari kerja di [a, b] inklusif, dibatasi SPAN_MAX hari kalender (data rusak tidak menggantung).
  function workdays(c, a, b) {
    let n = 0;
    for (let d = a, hi = Math.min(b, a + SPAN_MAX - 1); d <= hi; d++) if (workAt(c, d)) n++;
    return n;
  }

  // % selesai (R7): selesai (TLLoad.isDone) → 100; selain itu Number(progress) dijepit 0–100, dibulatkan; NaN → 0.
  function pctOf(t) {
    if (LOAD.isDone(t)) return 100;
    const p = Number(t.progress);
    return Number.isFinite(p) ? Math.round(Math.min(100, Math.max(0, p))) : 0;
  }

  // people: Map<uid, nama> atau objek {uid: nama}; uid lewat TLLoad.uidOf; nama kosong diabaikan; uid ganda → nama
  // cmpKey terkecil (deterministik).
  function namesOf(people) {
    const out = new Map();
    const put = (k, v) => {
      const u = LOAD.uidOf(k);
      if (u === null || typeof v !== "string" || v.trim() === "") return;
      const cur = out.get(u);
      if (cur === undefined || cmpKey(v, cur) < 0) out.set(u, v);
    };
    if (people instanceof Map) for (const [k, v] of people) put(k, v);
    else if (isObj(people)) for (const k of Object.keys(people)) put(k, people[k]);
    return out;
  }

  // ---- format nilai ----
  // Titik waktu = bilangan hari × 2 (+1 = 17:00, +0 = 08:00): urut sederhana untuk min/maks ringkasan.
  const startPt = (dn) => dn * 2;
  const finishPt = (dn) => dn * 2 + 1;
  const ptDn = (p) => Math.floor(p / 2);
  const fmtPt = (p) => CAL.iso(ptDn(p)) + (p - ptDn(p) * 2 === 1 ? T_FINISH : T_START);
  const fmtDur = (days) => "PT" + days * 8 + "H0M0S";
  const fmtWork = (min) => "PT" + Math.floor(min / 60) + "H" + (min % 60) + "M0S";
  // Durasi/kerja dalam detik bulat → "PT{j}H{m}M{d}S" (kemajuan F6: durasi × % dan Work × % selalu detik bulat — 288 × d ×
  // % dan 15 × target × % — jadi aktual ÷ total = % persis, tanpa pembulatan; bentuk yang sama ditulis MPXJ/MS Project).
  const fmtSec = (sec) => "PT" + Math.floor(sec / 3600) + "H" + Math.floor((sec % 3600) / 60) + "M" + (sec % 60) + "S";
  // Units = menit kerja ÷ (d × 480), 6 desimal DIBULATKAN KE ATAS dengan aritmetika bilangan bulat (review F5: 4 desimal
  // setengah ke atas bisa membuat Units × menit kerja < Work, hingga ±24 menit di 999 hari — penugasan tidak muat di
  // rentang task). Ke atas → Units × d × 480 − Work ∈ [0, d × 480 ÷ 10⁶) menit (< 0,48 menit di 999 hari). Tanpa notasi
  // ilmiah, nol di belakang dibuang ("0.041667", "0.625", "5").
  function fmtUnits(workMin, d) {
    const num = workMin * 1000000;
    const den = d * MIN_DAY;
    const n = Math.floor((num + den - 1) / den);
    const ip = Math.floor(n / 1000000);
    const fp = String(n - ip * 1000000).padStart(6, "0").replace(/0+$/, "");
    return fp ? ip + "." + fp : String(ip);
  }

  // Durasi (hari kerja) dari titik mulai s ke titik selesai f: hari kerja [ptDn(s), ptDn(f)], dikurangi hari terakhir
  // bila selesai pukul 08:00 (milestone) dan hari itu hari kerja.
  function spanDays(c, s, f) {
    if (f < s) return 0;
    const a = ptDn(s);
    const b = ptDn(f);
    let n = workdays(c, a, b);
    if (f - b * 2 === 0 && workAt(c, b) && b - a < SPAN_MAX) n--;
    return Math.max(0, n);
  }

  // ---- XML ----
  function Buf() {
    const out = [];
    return {
      line(depth, s) {
        out.push("  ".repeat(depth) + s);
      },
      el(depth, name, v) {
        out.push("  ".repeat(depth) + "<" + name + ">" + v + "</" + name + ">");
      },
      text() {
        return out.join("\n") + "\n";
      },
    };
  }

  // Tanggal task (review F2 I1/I2, M1). Simpul mesin terhitung → es/ef mesin (Otomatis yang drift tampil di tanggal
  // hasil mesin, sama dengan hitungan MS Project): selesai → mulai/selesai aktual mesin (doneFinish) + ActualStart/
  // ActualFinish, durasi = hari kerja rentang itu (milestone selesai di harinya tetap milestone); berjalan Otomatis
  // dengan es ≤ D → ActualStart. Simpul tanpa Mulai (penerus Otomatis yang dihitung mesin) tetap Estimated.
  // Bukan simpul / mesin tidak ada: rentang tersimpan (bar Gantt); tanpa jadwal → placeholder 1 hari: 0 % → hari kerja
  // pertama ≥ D; ber-% > 0 (review F7 M2) → tanggal aktual tidak boleh di masa depan: hari kerja terakhir ≤ D, dan untuk
  // task selesai hari selesainya (actual.finish / completed_at Jakarta) bila ≤ D, dibulatkan ke hari kerja ≤ itu.
  // e.pct = % selesai; e.actualS / e.actualF = satu pasang bendera ActualStart / ActualFinish yang ditulis (review F7 M3):
  // % > 0 / 100 % (uji pemilik #2 F6: MS Project menyetelnya sendiri saat % diisi) atau jangkar aktual mesin (F2:
  // selesai; berjalan dengan es ≤ D walau 0 %).
  function taskDates(e, c, nodes, D) {
    const sp = e.row.span;
    const n = nodes ? nodes.get(e.key) : undefined;
    const pct = pctOf(e.task);
    e.pct = pct;
    e.actualS = pct > 0;
    e.actualF = pct === 100;
    e.unscheduled = !sp;
    if (n && isDn(n.es) && isDn(n.ef) && Number.isInteger(n.d)) {
      e.node = n;
      let d = n.d;
      e.ms = d === 0;
      if (n.fixed === "done") {
        e.actualS = true;
        e.actualF = true;
        if (!(d === 0 && n.ef === n.es)) {
          // Milestone yang selesai setelah harinya: dijadwalkan sebagai rentang es..ef (e.ms false), tetapi tetap
          // ditandai <Milestone>1</Milestone> agar MS Project menampilkannya sebagai milestone (review F2b).
          e.msMark = d === 0;
          e.ms = false;
          d = spanDays(c, startPt(n.es), finishPt(n.ef));
        }
      } else if (n.fixed === "started" && n.es <= D) e.actualS = true;
      e.d = d;
      e.s = startPt(n.es);
      e.f = e.ms ? startPt(n.es) : finishPt(n.ef);
    } else if (sp) {
      e.d = e.row.sched.duration === null || e.row.sched.duration === undefined ? 1 : e.row.sched.duration;
      e.ms = e.d === 0;
      e.s = startPt(sp.s);
      e.f = e.ms ? startPt(sp.s) : finishPt(sp.f);
    } else {
      let day = D;
      if (pct > 0 && LOAD.isDone(e.task)) {
        const fin = SCHED.actualOf(e.task, e.row.sched).finish;
        if (isDn(fin) && fin <= D) day = fin;
      }
      e.ph = pct > 0 ? prevWorkOr(c, day) : nextWorkOr(c, D);
      e.d = 1;
      e.ms = false;
      e.s = startPt(e.ph);
      e.f = finishPt(e.ph);
    }
  }

  // ---- waktu kerja MS Project pada titik setengah hari (uji pemilik F4) ----
  // Titik = startPt/finishPt (S(x) = x 08:00, E(x) = x 17:00). Untuk durasi/lag kelipatan 480 menit (selalu di berkas
  // ini) penjumlahan waktu kerja MS Project = S(x) + L hari → E(addWork(nw(x), L − 1)); E(x) + L → E(addWork(pw(x), L));
  // S(x) − k → S(addWork(nw(x), −k)); E(x) − k → S(addWork(pw(x), 1 − k)); L = 0 → titik apa adanya (S di hari libur
  // = S hari kerja berikut, E di hari libur = E hari kerja sebelumnya). Kalender buntu → hari apa adanya.
  function prevWorkOr(c, dn) {
    try {
      const n = CAL.prevWork(c, dn);
      return isDn(n) ? n : dn;
    } catch (e) {
      return dn;
    }
  }
  function addWorkOr(c, dn, k) {
    try {
      const n = CAL.addWork(c, dn, k);
      return isDn(n) ? n : dn + k;
    } catch (e) {
      return dn + k;
    }
  }
  const isS = (p) => p - ptDn(p) * 2 === 0;
  function addP(c, p, L) {
    if (L === 0) return p;
    const x = ptDn(p);
    if (isS(p)) {
      const x1 = nextWorkOr(c, x);
      return L > 0 ? finishPt(addWorkOr(c, x1, L - 1)) : startPt(addWorkOr(c, x1, L));
    }
    const x1 = prevWorkOr(c, x);
    return L > 0 ? finishPt(addWorkOr(c, x1, L)) : startPt(addWorkOr(c, x1, L + 1));
  }
  // Saat kerja pertama ≥ p (mulai task berdurasi) dan akhir kerja terakhir ≤ p (selesai task berdurasi).
  const nsP = (c, p) => startPt(nextWorkOr(c, isS(p) ? ptDn(p) : ptDn(p) + 1));
  const peP = (c, p) => finishPt(prevWorkOr(c, isS(p) ? ptDn(p) - 1 : ptDn(p)));

  // Kendala + mode simpul mesin (R7, R8; review F2 I1–I3; uji pemilik F4 B). Dipanggil dalam urutan topologis mesin
  // (result.order) sehingga titik MS Project pendahulu (mS/mF) sudah final. Syarat tiap tautan dihitung seperti MS Project
  // (FS: selesai P + lag; SS: mulai P + lag; FF/SF: (selesai/mulai P + lag) − durasi) lalu kendala dipilih supaya
  // tanggal tampil MS Project = es/ef mesin TANPA konflik kendala (tidak ada MSO; MFO hanya bila tautan tidak menuntut
  // lebih lambat):
  //  - mode efektif Manual → Manual 1; kendala eksplisit, selain itu SNET di es (= mulai tersimpan) (R8);
  //  - selesai / berjalan ber-ActualStart → SNET di es (sabuk pengaman: pembaca yang tidak menjangkar dari ActualStart,
  //    mis. ProjectLibre, tetap tidak memajukannya);
  //  - berjalan dengan es > D / anggota lingkaran → SNET di es bila tautan tidak menuntut lebih lambat; bila menuntut
  //    (konflik yang juga ditandai mesin) → Manual 1 + SNET di es (MS Project tidak menggeser task Manual dan tidak
  //    menandai konflik kendala);
  //  - MFO → MFO (milestone 08:00, atau 17:00 bila tautan FF/SF menuntut selesai di 17:00 hari itu); tautan menuntut lebih
  //    lambat (konflik mesin) → Manual 1 + MFO;
  //  - Otomatis lain: syarat tautan (+ SNET eksplisit) lebih awal dari es → SNET di es (akar E1/E2, penerus milestone,
  //    pendahulu selesai di hari libur); sama → ASAP (SNET eksplisit tetap); lebih lambat → residu tanpa kendala (review
  //    F5: lag asli, tanpa koreksi). Mesin menghitung milestone per hari (penerus FS/FF mulai hari kerja berikutnya, SS/SF
  //    di harinya), MS Project per jam, sehingga residu hanya muncul di sekitar milestone: milestone dengan tautan masuk SF
  //    / FF lag < 0 yang menurut MS Project jatuh di 08:00 hari kerja berikut (instan kerja sama dengan 17:00 tanggal
  //    mesin → residu label tanggal; ditulis di tanggal mesin), dan penerus SS/SF dari milestone yang jatuh 17:00 (MS
  //    Project 1 hari kerja lebih lambat, ikut ke penerusnya). Milestone ditulis di jam yang dihitung MS Project (FF → 17:00).
  //    Task tetap mesin yang terdorong residu ini mengikuti aturan task tetap di atas (Manual bila tautan menuntut lebih
  //    lambat), jadi tetap tanpa konflik kendala.
  function planNode(e, c, mode, D) {
    const n = e.node;
    const cst = e.row.sched.constraint;
    const d = e.d;
    const ms = e.ms;
    const S0 = startPt(n.es);
    const at = (type, p) => {
      e.ctype = type;
      e.cdate = fmtPt(p);
    };
    const keep = () => {
      e.mS = e.s;
      e.mF = e.f;
    };
    const startOf = (p) => (ms ? p : nsP(c, p));
    // Syarat mulai satu tautan menurut MS Project dari titik MS Project pendahulu (mS/mF), dengan lag asli Timeline
    // (review F5: lag tidak pernah dikoreksi). Hanya membaca tautan dan pendahulu; yang ditulis hanya keluaran di `e`.
    const reqOf = (l) => {
      const pS = l.pe.mS === undefined ? l.pe.s : l.pe.mS;
      const pF = l.pe.mF === undefined ? l.pe.f : l.pe.mF;
      if (l.tt === "FS") return addP(c, pF, l.L);
      if (l.tt === "SS") return addP(c, pS, l.L);
      return addP(c, addP(c, l.tt === "FF" ? pF : pS, l.L), -d);
    };
    e.manual = mode === "manual";
    const fx = n.fixed;
    // Jangkar aktual MESIN (selesai; berjalan es ≤ D) — bukan bendera tulis e.actualS, yang juga hidup untuk % > 0 (F6):
    // task berjalan es > D / lingkaran ber-% > 0 tetap lewat cabang task tetap di bawah (Manual bila tautan menuntut lebih lambat).
    const actual = fx === "done" || (fx === "started" && n.es <= D);
    let req = null;
    for (const l of e.links) {
      const r = reqOf(l);
      if (req === null || r > req) req = r;
    }
    if (e.manual) {
      if (cst && cst.type === "SNET") at(C_SNET, startPt(CAL.dn(cst.date)));
      else if (cst) at(C_MFO, (ms ? startPt : finishPt)(CAL.dn(cst.date)));
      else at(C_SNET, S0);
      return keep();
    }
    if (actual) {
      at(C_SNET, S0);
      e.mS = e.s;
      e.mF = fx === "done" || ms ? e.f : addP(c, e.s, d);
      return;
    }
    if (fx === "started" || fx === "cycle") {
      at(C_SNET, S0);
      const got = startOf(req === null || req < S0 ? S0 : req);
      if (ms ? ptDn(got) === n.es : got === startOf(S0)) {
        e.mS = got;
        e.mF = ms ? got : addP(c, got, d);
      } else {
        e.manual = true;
        keep();
      }
      return;
    }
    if (fx === "mfo" && cst) {
      const md = CAL.dn(cst.date);
      if (ms) {
        const P = req === null || req <= startPt(md) ? startPt(md) : req <= finishPt(md) ? finishPt(md) : null;
        at(C_MFO, P === null ? finishPt(md) : P);
        if (P === null) {
          e.manual = true;
          return keep();
        }
        e.s = e.f = e.mS = e.mF = P;
        return;
      }
      at(C_MFO, finishPt(md));
      const F = peP(c, finishPt(md));
      const S = addP(c, F, -d);
      if (req !== null && nsP(c, req) > S) {
        e.manual = true;
        return keep();
      }
      e.mS = S;
      e.mF = F;
      return;
    }
    const snetP = cst && cst.type === "SNET" ? startPt(CAL.dn(cst.date)) : null;
    const b = snetP !== null && (req === null || snetP > req) ? snetP : req;
    const st = b === null ? null : startOf(b);
    if (st === null || (ms ? ptDn(st) < n.es : st < S0)) {
      at(C_SNET, S0);
      e.mS = S0;
    } else {
      if (snetP !== null) at(C_SNET, snetP);
      e.mS = st;
      if (ms ? ptDn(st) > n.es : st > S0) e.residual = true;
      else if (ms) e.s = e.f = st; // milestone di jam MS Project (mis. FF → 17:00); tanggal = es
    }
    e.mF = ms ? e.mS : addP(c, e.mS, d);
    if (e.residual && ms) e.s = e.f = finishPt(n.es); // residu: tulis tanggal mesin (instan kerja sama dengan MS Project)
  }

  // Kendala + mode task yang bukan simpul mesin terhitung (tanpa mesin, diarsip-bendera, tanpa jadwal).
  //  - Tanpa jadwal → placeholder Otomatis (Manual 0) + Estimated 1 + DurationFormat 39 ("1 hari?") + SNET di hari kerja
  //    pertama ≥ D (uji pemilik F4 C: Manual 1 + Estimated 1 tampil "0 days?" berlian di MS Project). Tanpa tautan
  //    (bukan simpul → sisinya notNode) sehingga tanggalnya tetap; kendala eksplisit task tanpa jadwal tidak diekspor
  //    (mesin juga tidak menjadwalkannya).
  //  - Terjadwal → Manual (mode efektif) atau Otomatis; kendala eksplisit, selain itu SNET di mulai tersimpan bila Manual
  //    atau tanpa tautan masuk (cadangan tanpa mesin).
  function planOther(e, mode) {
    const cst = e.row.sched.constraint;
    const at = (type, p) => {
      e.ctype = type;
      e.cdate = fmtPt(p);
    };
    e.mS = e.s;
    e.mF = e.f;
    if (e.unscheduled) {
      at(C_SNET, e.s);
      return;
    }
    e.manual = mode === "manual";
    if (cst && cst.type === "SNET") at(C_SNET, startPt(CAL.dn(cst.date)));
    else if (cst) at(C_MFO, (e.ms ? startPt : finishPt)(CAL.dn(cst.date)));
    else if (e.manual || !e.links.length) at(C_SNET, e.s);
  }

  // build(input) → {xml, stats: {tasks, links, skippedLinks, unscheduled, resources, assignments}}.
  //   input = {tasks, cal, readExt, result, units, pageKind, title, fileName, people, baseline, ownerUid, D}:
  //   tasks = eng.ctx.tasks (daftar lengkap halaman, R5); cal = kalender halaman; result = TLCpm.run (nodes, pred, cycles;
  //   null → aturan cadangan tanpa mesin); units = Map record `project` (TLSched.modeOf); pageKind "workspace" |
  //   "project"; title/fileName (R9; fileName absen → fileNameOf(title, D)); people = Map<uid, nama>; baseline =
  //   {rows: Map<refKey, {s, f, d, w}>} | null; ownerUid = pemilik halaman pribadi (resource tunggal); D = bilangan hari
  //   hari ini (wajib; selain itu TypeError). stats.tasks = jumlah <Task> UID ≥ 1 (kelompok + task; tanpa UID 0).
  function build(input) {
    const a = isObj(input) ? input : {};
    if (!isDn(a.D)) throw new TypeError("TLMspdi.build: D harus bilangan hari");
    const D = a.D;
    const c = calOf(a.cal);
    const tasks = Array.isArray(a.tasks) ? a.tasks : [];
    const workspace = a.pageKind === "workspace";
    const units = a.units instanceof Map ? a.units : new Map();
    const title = typeof a.title === "string" && a.title.trim() !== "" ? a.title : DEFAULT_TITLE;
    const fileName = typeof a.fileName === "string" && a.fileName !== "" ? a.fileName : fileNameOf(title, D);
    const R = isObj(a.result) ? a.result : null;
    const nodes = R && R.nodes instanceof Map ? R.nodes : null;
    const predMap = R && R.pred instanceof Map ? R.pred : null;
    const eng = nodes !== null && predMap !== null;

    // 1. baris = tata letak Gantt (sort "wbs"): berulang/diarsip/dihapus tidak ikut (aturan TLLayout).
    const raws = new Map();
    const rawFor = (t) => {
      let r = raws.get(t);
      if (!r) raws.set(t, (r = rawOf(a.readExt, t)));
      return r;
    };
    const lay = LAYOUT.layout({ tasks, pageKind: workspace ? "workspace" : "project", cal: c, sort: "wbs", readSchedOf: (t) => SCHED.readSched(rawFor(t)) });
    const groupName = new Map(lay.groups.map((g) => [g.key, g.name]));
    const ents = [];
    const byKey = new Map();
    const groupEnt = new Map();
    for (const r of lay.rows) {
      const e = { uid: ents.length + 1, row: r, kind: r.kind, key: r.key, task: r.task, level: r.kind === "group" ? 1 : r.depth + (workspace ? 2 : 1) };
      ents.push(e);
      if (r.kind === "group") groupEnt.set(r.group, e);
      else byKey.set(r.key, e);
    }

    // 2. tanggal daun (taskDates); ringkasan dihitung setelah kendala (langkah 4 bisa memindah jam milestone).
    let unscheduled = 0;
    for (const e of ents) {
      if (e.kind !== "task") continue;
      taskDates(e, c, eng ? nodes : null, D);
      if (e.unscheduled) unscheduled++;
    }
    // 3. tautan. Mesin ada → hanya sisi yang dipakai mesin (result.pred: kedua ujung simpul, scope sama, bukan ringkasan,
    // bukan di dalam lingkaran — review F2 I1). Tanpa mesin → cadangan: pendahulu kanonik lewat TLSched.buildIndex,
    // kecuali diri sendiri / ringkasan / antaranggota result.cycles. Satu tautan per pendahulu kanonik (cid/id task yang
    // sama, pola resolveDeps); dependensi lain (pendahulu tak ada / tidak diekspor / tanpa jadwal / lintas scope /
    // ringkasan / lingkaran) dihitung skippedLinks.
    const idx = SCHED.buildIndex(tasks);
    const cyc = new Map();
    const cycles = R && Array.isArray(R.cycles) ? R.cycles : [];
    cycles.forEach((cy, i) => {
      if (Array.isArray(cy)) for (const k of cy) cyc.set(String(k), i);
    });
    let skipped = 0;
    let nLinks = 0;
    for (const e of ents) {
      e.links = [];
      if (e.kind === "group") continue;
      const deps = e.row.sched && Array.isArray(e.row.sched.deps) ? e.row.sched.deps : [];
      const used = eng ? predMap.get(e.key) : undefined;
      const seen = new Set();
      for (const dep of deps) {
        const pt = idx.get(dep.key);
        const pk = pt && pt.id !== undefined && pt.id !== null ? String(pt.id) : null;
        if (pk !== null) {
          if (seen.has(pk)) continue;
          seen.add(pk);
        }
        const pe = pk === null ? undefined : byKey.get(pk);
        let type = dep.type;
        let lag = dep.lag;
        let ok = !!pe && pe !== e && pe.kind === "task" && e.kind === "task";
        if (ok && eng) {
          // Sisi mesin yang kedua ujungnya terhitung (es/ef): sisi ke/dari simpul tak terhitung tidak memengaruhi tanggal
          // mesin mana pun (penerus Otomatis ikut tak terhitung, task tetap mengabaikannya), tetapi di MS Project akan
          // menggeser placeholder / tanggal tersimpannya (uji pemilik F4).
          const hit = e.node && pe.node && Array.isArray(used) ? used.find((x) => x && x.key === pk) : undefined;
          ok = !!hit;
          if (hit) {
            type = hit.type;
            lag = hit.lag;
          }
        } else if (ok) {
          const ring = cyc.get(pe.key);
          ok = !(ring !== undefined && ring === cyc.get(e.key));
        }
        if (!ok) {
          skipped++;
          continue;
        }
        const tt = LINK_TYPE[type] === undefined ? "FS" : type;
        const L = Number.isInteger(lag) ? lag : 0;
        e.links.push({ uid: pe.uid, pe, tt, type: LINK_TYPE[tt], L, lag: L * LAG_UNIT });
      }
      e.links.sort((x, y) => x.uid - y.uid);
      nLinks += e.links.length;
    }

    // 4. mode + kendala. Bukan simpul mesin → planOther; simpul mesin → planNode dalam urutan topologis mesin
    // (result.order; sisa yang tak ada di sana menyusul). Kelompok/ringkasan selalu Otomatis tanpa kendala.
    const modeOf = (e) => SCHED.modeOf(rawFor(e.task), units, e.task);
    for (const e of ents) {
      e.manual = false;
      e.ctype = C_ASAP;
      e.cdate = null;
      if (e.kind === "task" && !e.node) planOther(e, modeOf(e));
    }
    if (eng) {
      const done = new Set();
      const plan = (e) => {
        if (!e || e.kind !== "task" || !e.node || done.has(e)) return;
        done.add(e);
        planNode(e, c, modeOf(e), D);
      };
      for (const k of Array.isArray(R.order) ? R.order : []) plan(byKey.get(String(k)));
      for (const e of ents) plan(e);
    }

    // Ringkasan/kelompok = min/maks titik anak (dari belakang pra-urut: anak sebelum induk).
    const top = { s: Infinity, f: -Infinity };
    const parentOf = (e) => {
      if (e.kind === "group") return top;
      const pk = e.row.parentKey;
      if (pk !== null && byKey.has(pk)) return byKey.get(pk);
      return workspace && groupEnt.has(e.row.group) ? groupEnt.get(e.row.group) : top;
    };
    for (let i = ents.length - 1; i >= 0; i--) {
      const e = ents[i];
      if (e.kind !== "task") {
        if (e.s === undefined) {
          e.s = startPt(D);
          e.f = finishPt(D);
        }
        e.d = spanDays(c, e.s, e.f);
      }
      const p = parentOf(e);
      if (p.s === undefined || e.s < p.s) p.s = e.s;
      if (p.f === undefined || e.f > p.f) p.f = e.f;
    }
    if (top.s === Infinity) {
      top.s = startPt(D);
      top.f = finishPt(D);
    }
    top.d = spanDays(c, top.s, top.f);


    // 5. baseline aktif (pola compareBaseline): kunci baris urut cmpKey → task lewat buildIndex → kunci kanonik; baris
    // sah pertama per task menang; hanya task non-ringkasan yang diekspor.
    const blRows = isObj(a.baseline) && a.baseline.rows instanceof Map ? a.baseline.rows : null;
    if (blRows) {
      for (const rk of [...blRows.keys()].sort(cmpKey)) {
        const t = idx.get(rk);
        const e = t && t.id !== undefined && t.id !== null ? byKey.get(String(t.id)) : undefined;
        const b = blRows.get(rk);
        if (!e || e.kind !== "task" || e.bl || !isObj(b)) continue;
        if (!isDn(b.s) || !isDn(b.f) || b.f < b.s || !Number.isInteger(b.d) || b.d < 0 || b.d > SCHED.DUR_MAX) continue;
        e.bl = { s: startPt(b.s), f: b.d === 0 ? startPt(b.s) : finishPt(b.f), d: b.d, w: Number.isInteger(b.w) && b.w >= 0 ? b.w : 0 };
      }
    }

    // 6. resource (R7): workspace → penanggung jawab task yang diekspor; pribadi → pemilik (ownerUid). Urut nama cmpKey
    // lalu uid; nama dari people, selain itu "Anggota #uid".
    const names = namesOf(a.people);
    const resUids = new Set();
    const owner = workspace ? null : LOAD.uidOf(a.ownerUid);
    if (workspace) {
      for (const e of ents) {
        if (e.kind === "group") continue;
        const u = LOAD.uidOf(e.task.assigned_to);
        if (u !== null) resUids.add(u);
      }
    } else if (owner !== null) resUids.add(owner);
    const res = [...resUids].map((uid) => ({ uid, name: names.has(uid) ? names.get(uid) : NO_RES + uid }));
    res.sort((x, y) => cmpKey(x.name, y.name) || x.uid - y.uid);
    const resId = new Map(res.map((r, i) => [r.uid, i + 1]));

    // 7. assignment (R7): task non-ringkasan terjadwal, d > 0, berpenanggung jawab → Work = target × 25 menit.
    const asg = [];
    for (const e of ents) {
      if (e.kind !== "task" || e.unscheduled || e.d <= 0) continue;
      const rid = resId.get(workspace ? LOAD.uidOf(e.task.assigned_to) : owner);
      if (rid === undefined) continue;
      e.work = targetOf(e.task) * POMO_MIN;
      asg.push({ uid: asg.length + 1, task: e, rid, units: fmtUnits(e.work, e.d) });
    }

    // 7b. kemajuan (uji pemilik #2 F6). MS Project membaca kemajuan dari pasangan aktual/sisa, bukan dari PercentComplete
    // saja: tanpa RemainingDuration task tanpa assignment diimpor "0 days?", tanpa ActualWork/RemainingWork di assignment
    // % selesai hilang dan muncul dialog "resource is assigned outside the original dates" (bentuk rujukan: MSPDIWriter
    // MPXJ selalu menulis RemainingDuration/RemainingWork). Per task non-ringkasan, dalam detik bulat (eksak):
    //  - ActualDuration = durasi × %, RemainingDuration = durasi − ActualDuration (placeholder 0 % → PT8H0M0S);
    //  - ActualStart bila % > 0 (= Start; task selesai/berjalan sudah memakai aktual mesin), ActualFinish bila 100 %
    //    (= Finish) — sama dengan yang disetel MS Project sendiri saat % diisi (bendera e.actualS/e.actualF, taskDates);
    //  - assignment nyata: ActualWork = Work × %, RemainingWork = Work − ActualWork;
    //  - tanpa assignment nyata dan % > 0 (tanpa penanggung jawab, milestone, tanpa jadwal) → assignment semu
    //    ResourceUID −65535 bentuk MPXJ (Units 1, Work = durasi, ActualWork = durasi × %): tanpa assignment MS Project
    //    mengabaikan % selesai task; UID sesudah assignment nyata (urutan task), tidak dihitung stats.assignments;
    //  - Work/ActualWork/RemainingWork/PercentWorkComplete task = milik assignment-nya (nyata atau semu); tanpa
    //    assignment → nol.
    // Ringkasan/kelompok/UID 0 mengikuti keluaran MPXJ: % 0, RemainingDuration = Duration, nilai kerja nol (MS Project
    // menghitung sendiri gulungan ringkasan).
    const pseudo = [];
    for (const e of ents) {
      if (e.kind !== "task") continue;
      const pct = e.pct;
      e.actDur = e.d * (SEC_DAY / 100) * pct;
      if (e.work !== undefined) {
        e.wSec = e.work * 60;
        e.awSec = Math.round((e.wSec * pct) / 100);
        e.pwc = pct;
      } else if (pct > 0) {
        e.wSec = e.d * SEC_DAY;
        e.awSec = e.actDur;
        e.pwc = pct;
        pseudo.push({ uid: asg.length + pseudo.length + 1, task: e });
      }
    }

    // 8. XML.
    const out = Buf();
    out.line(0, PROLOG);
    out.line(0, '<Project xmlns="' + NS + '">');
    out.el(1, "SaveVersion", SAVE_VERSION);
    out.el(1, "Name", esc(fileName));
    out.el(1, "Title", esc(clip(title)));
    out.el(1, "CreationDate", CAL.iso(D) + T_DAY0);
    out.el(1, "ScheduleFromStart", 1);
    out.el(1, "StartDate", fmtPt(top.s));
    out.el(1, "FinishDate", fmtPt(top.f));
    out.el(1, "CalendarUID", 1);
    out.el(1, "DefaultStartTime", "08:00:00");
    out.el(1, "DefaultFinishTime", "17:00:00");
    out.el(1, "MinutesPerDay", MIN_DAY);
    out.el(1, "MinutesPerWeek", MIN_DAY * c.mask.size);
    out.el(1, "DaysPerMonth", 20);
    out.el(1, "DefaultTaskType", 1);
    out.el(1, "DurationFormat", DUR_FORMAT);
    out.el(1, "WorkFormat", WORK_FORMAT);
    out.el(1, "HonorConstraints", 1); // I4 F2: MFO menang atas tautan (sama dengan task tetap di mesin)
    out.el(1, "NewTasksEffortDriven", 0);
    // Review F7: sejak F6 % selesai terbaca; dengan opsi bawaan "Split in-progress tasks" MS Project memecah sisa kerja
    // task berjalan ke setelah pendahulu yang belum selesai. Mesin Timeline tidak pernah memecah (task yang sudah mulai
    // tetap di tempat) → 0.
    out.el(1, "SplitsInProgressTasks", 0);
    out.el(1, "WeekStartDay", 1);
    writeCalendar(out, c, ents, D, res, resId);
    out.line(1, "<Tasks>");
    writeTask(out, { uid: 0, kind: "project", name: title, level: 0, wbs: "0", s: top.s, f: top.f, d: top.d, links: [], manual: false, ctype: C_ASAP, cdate: null }, D);
    for (const e of ents) {
      const name = e.kind === "group" ? groupName.get(e.row.group) : e.task.title;
      writeTask(out, Object.assign(e, { name, wbs: e.row.wbs }), D);
    }
    out.line(1, "</Tasks>");
    out.line(1, "<Resources>");
    for (const r of res) {
      const id = resId.get(r.uid);
      out.line(2, "<Resource>");
      out.el(3, "UID", id);
      out.el(3, "ID", id);
      out.el(3, "Name", esc(clip(r.name)));
      out.el(3, "Type", 1);
      out.el(3, "IsNull", 0);
      out.el(3, "MaxUnits", 1);
      out.el(3, "CalendarUID", resId.get(r.uid) + 1); // kalender resource (writeCalendar), F4 A
      out.line(2, "</Resource>");
    }
    out.line(1, "</Resources>");
    out.line(1, "<Assignments>");
    // Urutan anak XSD (subset): UID, TaskUID, ResourceUID, PercentWorkComplete, ActualFinish?, ActualStart?, ActualWork,
    // Finish, RemainingWork, Start, Units, Work. Assignment semu (rid absen) = bentuk MPXJ: tanpa ActualStart, Units 1.
    for (const x of asg.concat(pseudo)) {
      const t = x.task;
      const real = x.rid !== undefined;
      out.line(2, "<Assignment>");
      out.el(3, "UID", x.uid);
      out.el(3, "TaskUID", t.uid);
      out.el(3, "ResourceUID", real ? x.rid : NULL_RES);
      out.el(3, "PercentWorkComplete", t.pct);
      if (t.pct === 100) out.el(3, "ActualFinish", fmtPt(t.f));
      if (real && t.pct > 0) out.el(3, "ActualStart", fmtPt(t.s));
      out.el(3, "ActualWork", fmtSec(t.awSec));
      out.el(3, "Finish", fmtPt(t.f));
      out.el(3, "RemainingWork", fmtSec(t.wSec - t.awSec));
      out.el(3, "Start", fmtPt(t.s));
      out.el(3, "Units", real ? x.units : 1);
      out.el(3, "Work", fmtSec(t.wSec));
      out.line(2, "</Assignment>");
    }
    out.line(1, "</Assignments>");
    out.line(0, "</Project>");
    return {
      xml: out.text(),
      stats: { tasks: ents.length, links: nLinks, skippedLinks: skipped, unscheduled, resources: res.length, assignments: asg.length },
    };
  }

  const WORK_TIMES = [
    ["08:00:00", "12:00:00"],
    ["13:00:00", "17:00:00"],
  ];
  function writeTimes(out, depth) {
    out.line(depth, "<WorkingTimes>");
    for (const [from, to] of WORK_TIMES) {
      out.line(depth + 1, "<WorkingTime>");
      out.el(depth + 2, "FromTime", from);
      out.el(depth + 2, "ToTime", to);
      out.line(depth + 1, "</WorkingTime>");
    }
    out.line(depth, "</WorkingTimes>");
  }

  // Nama pengecualian libur: nama SKB (TLHolidays.lookup) untuk hari libur rentang yang memang mengikuti sakelar
  // libur nasional / cuti bersama kalender; nama unik digabung " / " (urut tanggal); hari kerja pengganti / libur
  // tambahan tanpa nama (kalender terkompilasi tidak menyimpan nama) → "".
  function excName(c, x) {
    if (x.work || !HOL || typeof HOL.lookup !== "function") return "";
    const seen = [];
    for (let d = x.from; d <= x.to; d++) {
      if (!c.off.has(d)) continue;
      const h = HOL.lookup(CAL.iso(d));
      if (!h || !((h.kind === "libur" && c.national) || (h.kind === "cuti" && c.cutiBersama))) continue;
      if (seen.indexOf(h.nama) < 0) seen.push(h.nama);
    }
    return clip(seen.join(" / "));
  }

  // Kalender dasar UID 1 (R7, review F2 C1): WeekDay DayType 1–7 (1 = Minggu = ISO 7) dari pola mingguan (c.mask, ISO
  // 1 = Senin … 7 = Minggu); pengecualian = hari yang isWork-nya berbeda dari pola (libur di hari kerja → DayWorking 0;
  // hari kerja pengganti → DayWorking 1 + jam), hari berurutan sejenis digabung. Ditulis DUA kali: WeekDay DayType 0 +
  // TimePeriod (gaya Project 2003, dibaca ProjectLibre) dan blok <Exceptions> gaya 2007 (menurut pelapor MPXJ bug
  // #335, MS Project 2010+ mengabaikan gaya lama saat impor — belum kami verifikasi sendiri; MPXJ membaca <Exceptions>
  // lebih dulu dan memakai DayType 0 hanya bila blok itu kosong, jadi tidak ganda). Rentang [mulai − 7, selesai + 31] atas semua task; > SPAN_MAX hari → SPAN_MAX hari yang digeser
  // mendekati D − HALF_SPAN (tidak keluar dari rentang task).
  function writeCalendar(out, c, ents, D, res, resId) {
    let lo = Infinity;
    let hi = -Infinity;
    for (const e of ents) {
      if (e.kind === "group") continue;
      if (ptDn(e.s) < lo) lo = ptDn(e.s);
      if (ptDn(e.f) > hi) hi = ptDn(e.f);
    }
    if (lo === Infinity) {
      lo = D;
      hi = D;
    }
    lo -= PAD_BEFORE;
    hi += PAD_AFTER;
    if (hi - lo + 1 > SPAN_MAX) {
      lo = Math.min(Math.max(lo, D - HALF_SPAN), hi - SPAN_MAX + 1);
      hi = lo + SPAN_MAX - 1;
    }
    const exc = [];
    let cur = null;
    for (let d = lo; d <= hi; d++) {
      const w = workAt(c, d);
      if (w === c.mask.has(CAL.isoWeekday(d))) {
        cur = null;
        continue;
      }
      if (cur && cur.work === w) cur.to = d;
      else exc.push((cur = { from: d, to: d, work: w }));
    }
    const period = (depth, x) => {
      out.line(depth, "<TimePeriod>");
      out.el(depth + 1, "FromDate", CAL.iso(x.from) + T_DAY0);
      out.el(depth + 1, "ToDate", CAL.iso(x.to) + T_DAY_END);
      out.line(depth, "</TimePeriod>");
    };
    out.line(1, "<Calendars>");
    out.line(2, "<Calendar>");
    out.el(3, "UID", 1);
    out.el(3, "Name", CAL_NAME);
    out.el(3, "IsBaseCalendar", 1);
    out.el(3, "IsBaselineCalendar", 0);
    out.el(3, "BaseCalendarUID", -1);
    out.line(3, "<WeekDays>");
    for (let dt = 1; dt <= 7; dt++) {
      const working = c.mask.has(dt === 1 ? 7 : dt - 1);
      out.line(4, "<WeekDay>");
      out.el(5, "DayType", dt);
      out.el(5, "DayWorking", working ? 1 : 0);
      if (working) writeTimes(out, 5);
      out.line(4, "</WeekDay>");
    }
    for (const x of exc) {
      out.line(4, "<WeekDay>");
      out.el(5, "DayType", 0);
      out.el(5, "DayWorking", x.work ? 1 : 0);
      period(5, x);
      if (x.work) writeTimes(out, 5);
      out.line(4, "</WeekDay>");
    }
    out.line(3, "</WeekDays>");
    if (exc.length) {
      // Bentuk = keluaran MSPDIWriter MPXJ (EnteredByOccurrences 0, Occurrences 1, Type 1 = harian) + Name opsional.
      out.line(3, "<Exceptions>");
      for (const x of exc) {
        const nm = excName(c, x);
        out.line(4, "<Exception>");
        out.el(5, "EnteredByOccurrences", 0);
        period(5, x);
        out.el(5, "Occurrences", 1);
        if (nm) out.el(5, "Name", esc(nm));
        out.el(5, "Type", 1);
        out.el(5, "DayWorking", x.work ? 1 : 0);
        if (x.work) writeTimes(out, 5);
        out.line(4, "</Exception>");
      }
      out.line(3, "</Exceptions>");
    }
    out.line(2, "</Calendar>");
    // Kalender resource (uji pemilik F4 A): tanpa CalendarUID MS Project memberi resource kalender turunan "Standard"
    // bawaannya (tanpa libur kita) → Work/Units tidak muat di tanggal task (dialog "resource is assigned outside the
    // original dates", Units diturunkan). Bentuk = keluaran MSPDIWriter MPXJ untuk kalender resource turunan: UID resource
    // + 1 (unik, sesudah UID 1, deterministik), Name = nama resource, IsBaseCalendar 0, BaseCalendarUID 1, tanpa WeekDays
    // (semua hari ikut kalender dasar, termasuk pengecualian libur).
    for (const r of res) {
      out.line(2, "<Calendar>");
      out.el(3, "UID", resId.get(r.uid) + 1);
      out.el(3, "Name", esc(clip(r.name)));
      out.el(3, "IsBaseCalendar", 0);
      out.el(3, "IsBaselineCalendar", 0);
      out.el(3, "BaseCalendarUID", 1);
      out.line(2, "</Calendar>");
    }
    out.line(1, "</Calendars>");
  }

  // Satu <Task> dengan urutan anak XSD (subset): UID, ID, Name, Manual, Type, IsNull, CreateDate, WBS, OutlineNumber,
  // OutlineLevel, Start, Finish, Duration, DurationFormat, Work, EffortDriven, Estimated, Milestone, Summary,
  // PercentComplete, PercentWorkComplete, ActualStart?, ActualFinish?, ActualDuration, ActualWork, RemainingDuration,
  // RemainingWork, ConstraintType, CalendarUID, ConstraintDate?, PredecessorLink*, Baseline?,
  // ManualStart/ManualFinish/ManualDuration (task Manual: tanggal yang dijaga MS Project 2010+). Nilai kemajuan = langkah
  // 7b build (F6); ringkasan/kelompok/UID 0: % 0, sisa = durasi, kerja nol.
  function writeTask(out, e, D) {
    const summary = e.kind !== "task";
    const dur = fmtDur(e.d);
    const wSec = summary || e.wSec === undefined ? 0 : e.wSec;
    const awSec = summary || e.awSec === undefined ? 0 : e.awSec;
    const actDur = summary ? 0 : e.actDur;
    out.line(2, "<Task>");
    out.el(3, "UID", e.uid);
    out.el(3, "ID", e.uid);
    out.el(3, "Name", esc(clip(e.name)));
    out.el(3, "Manual", e.manual ? 1 : 0);
    // Type 1 (durasi tetap) hanya untuk task ber-assignment NYATA; tanpa assignment / hanya assignment semu / placeholder
    // / milestone / ringkasan → Type 0 (unit tetap, bawaan MPXJ dan MS Project): task durasi tetap tanpa resource tampil
    // terpecah/rusak di MS Project 2007–2013 (MPXJ bug #240) — review F7.
    out.el(3, "Type", !summary && e.work !== undefined ? 1 : 0);
    out.el(3, "IsNull", 0);
    out.el(3, "CreateDate", CAL.iso(D) + T_DAY0);
    out.el(3, "WBS", esc(e.wbs));
    out.el(3, "OutlineNumber", esc(e.wbs));
    out.el(3, "OutlineLevel", e.level);
    out.el(3, "Start", fmtPt(e.s));
    out.el(3, "Finish", fmtPt(e.f));
    out.el(3, "Duration", dur);
    out.el(3, "DurationFormat", e.unscheduled ? DUR_FORMAT_EST : DUR_FORMAT);
    out.el(3, "Work", fmtSec(wSec));
    out.el(3, "EffortDriven", 0);
    out.el(3, "Estimated", e.unscheduled ? 1 : 0);
    out.el(3, "Milestone", !summary && (e.ms || e.msMark) ? 1 : 0);
    out.el(3, "Summary", summary ? 1 : 0);
    out.el(3, "PercentComplete", summary ? 0 : e.pct);
    out.el(3, "PercentWorkComplete", summary || e.pwc === undefined ? 0 : e.pwc);
    if (!summary && e.actualS) out.el(3, "ActualStart", fmtPt(e.s));
    if (!summary && e.actualF) out.el(3, "ActualFinish", fmtPt(e.f));
    out.el(3, "ActualDuration", fmtSec(actDur));
    out.el(3, "ActualWork", fmtSec(awSec));
    out.el(3, "RemainingDuration", fmtSec(e.d * SEC_DAY - actDur));
    out.el(3, "RemainingWork", fmtSec(wSec - awSec));
    out.el(3, "ConstraintType", e.ctype);
    out.el(3, "CalendarUID", -1);
    if (e.cdate !== null) out.el(3, "ConstraintDate", e.cdate);
    for (const l of e.links) {
      out.line(3, "<PredecessorLink>");
      out.el(4, "PredecessorUID", l.uid);
      out.el(4, "Type", l.type);
      out.el(4, "CrossProject", 0);
      out.el(4, "LinkLag", l.lag);
      out.el(4, "LagFormat", LAG_FORMAT);
      out.line(3, "</PredecessorLink>");
    }
    if (e.bl) {
      out.line(3, "<Baseline>");
      out.el(4, "Number", 0);
      out.el(4, "Start", fmtPt(e.bl.s));
      out.el(4, "Finish", fmtPt(e.bl.f));
      out.el(4, "Duration", fmtDur(e.bl.d));
      out.el(4, "Work", fmtWork(e.bl.w * POMO_MIN));
      out.line(3, "</Baseline>");
    }
    if (e.manual) {
      out.el(3, "ManualStart", fmtPt(e.s));
      out.el(3, "ManualFinish", fmtPt(e.f));
      out.el(3, "ManualDuration", dur);
    }
    out.line(2, "</Task>");
  }

  return Object.freeze({
    NS,
    SAVE_VERSION,
    LAG_UNIT,
    NAME_CUT,
    NAME_MAX,
    build,
    fileNameOf,
    esc,
    targetOf,
    fmtUnits,
  });
})(
  typeof TLCal !== "undefined" ? TLCal : require("./calendar.js"),
  typeof TLSched !== "undefined" ? TLSched : require("./schedule.js"),
  typeof TLCpm !== "undefined" ? TLCpm : require("./cpm.js"),
  typeof TLLayout !== "undefined" ? TLLayout : require("./layout.js"),
  typeof TLLoad !== "undefined" ? TLLoad : require("./load.js"),
  typeof TLHolidays !== "undefined" ? TLHolidays : require("./holidays-id.js"),
);
if (typeof module !== "undefined" && module.exports) module.exports = TLMspdi;
// part: drag.js
// Plugin Timeline — TLDrag: mesin status seret murni (rencana R2, R13, R15, R21, R23).
// reducer (state, event) → state + commit(state, c) → {taskId, patch, prev} | {link: {pred, succ}} | null.
// Murni: tanpa DOM, tanpa Date lokal, tanpa global, tanpa akses api. Komponen (Task 8) hanya menerjemahkan pointer → event
// dan menulis transform dari preview(); tulis ke ext tepat SEKALI saat `up` (commit), tidak pernah saat seret/batal.
// Semua panggilan TLCal yang bisa melempar TL_CAL_LOOP ditangkap: preview/commit/keyStep/scheduleAt turun ke null.
//
// Kosakata peristiwa (ev.type): "move" {x, y?, t} · "hold" {t, kind?} (tekan lama sentuh; kind "resize" mengganti jenis)
//   · "over" {rowKey} (baris di bawah pointer; hanya jenis link) · "cancel" (Esc) · "up" {x, inside, t?}.
// Fase state: "pending" (setelah start, belum diputuskan) → "drag" → "released"; terminal: "scroll" (sentuh bergerak > 8 px
// sebelum 350 ms: serahkan ke gulir peramban), "cancelled" (Esc / ambang terlewati pada baris terkunci), "released".
const TLDrag = (function (CAL, SCHED) {
  const THRESHOLD_PX = 4; // mouse: ambang seret (gerak horizontal; link memakai jarak 2D)
  const LONG_PRESS_MS = 350; // sentuh: tekan lama sebelum seret
  const TOUCH_SLOP_PX = 8; // sentuh: gerak lebih jauh sebelum 350 ms = gulir
  const EDGE_PX = 8; // mouse: pegangan ubah durasi di ujung kanan bar
  const EDGE_TOUCH_PX = 16; // sentuh: pegangan setelah tekan lama
  const DOT_PX = 10; // mouse: lebar zona titik dependensi tepat di kanan ujung bar
  const MILESTONE_HALF = 6; // setengah lebar belah ketupat 12 px
  const MAX_DELTA = 36500; // jepit selisih hari (seret ekstrem tidak boleh menghasilkan tanggal di luar rentang Date)
  const TERMINAL = new Set(["scroll", "cancelled", "released"]);
  const KINDS = new Set(["move", "resize", "link"]);

  const isNum = (v) => typeof v === "number" && Number.isFinite(v);
  const isInt = (v) => Number.isInteger(v);

  // Hanya TL_CAL_LOOP yang ditelan (kalender tanpa hari kerja terjangkau); galat lain adalah bug dan dilempar.
  function safe(fn) {
    try {
      return fn();
    } catch (e) {
      if (e instanceof Error && e.message === "TL_CAL_LOOP") return null;
      throw e;
    }
  }

  // ---- zona sentuh pada bar ----
  // x dan barLeft dalam kerangka yang sama (px). Milestone = barWidth <= 0 (belah ketupat di tengah hari): tidak punya tepi.
  function hitZone(a) {
    const o = a || {};
    const x = o.x;
    const left = o.barLeft;
    const width = o.barWidth;
    if (!isNum(x) || !isNum(left) || !isNum(width)) return null;
    const touch = !!o.touch;
    if (width <= 0) {
      if (Math.abs(x - left) <= MILESTONE_HALF) return "body";
      if (!touch && x > left + MILESTONE_HALF && x <= left + MILESTONE_HALF + DOT_PX) return "dot";
      return null;
    }
    const right = left + width;
    if (x < left) return null;
    if (x <= right) {
      const handle = touch ? (o.armed ? EDGE_TOUCH_PX : 0) : EDGE_PX;
      const w = Math.min(handle, width / 2); // bar pendek: tepi tidak memakan lebih dari separuh bar
      return handle > 0 && x >= right - w ? "edge" : "body";
    }
    if (!touch && x <= right + DOT_PX) return "dot";
    return null;
  }

  // ---- state awal ----
  function lockReason(kind, row, sched, px) {
    if (!KINDS.has(kind)) return "kind";
    if (!row || typeof row !== "object") return "row";
    if (row.kind === "group") return "group";
    if (row.kind === "summary") return "summary"; // R10: tak bisa diseret, tak bisa jadi ujung dependensi
    if (row.outOfRange) return "range";
    if (!sched || !CAL.isIso(sched.start)) return "unscheduled";
    if (kind === "resize" && sched.duration === 0) return "milestone";
    if (kind !== "link" && !(isNum(px) && px > 0)) return "px";
    return null;
  }

  function start(a) {
    const o = a || {};
    const row = o.row;
    const src = o.sched || (row && row.sched) || null;
    const p = o.pointer || {};
    const sched = src
      ? { start: src.start, duration: isInt(src.duration) && src.duration >= 0 ? src.duration : 1, raw: src.raw && typeof src.raw === "object" ? src.raw : null }
      : null;
    const reason = lockReason(o.kind, row, sched, o.px);
    const x0 = isNum(p.x) ? p.x : 0;
    const y0 = isNum(p.y) ? p.y : 0;
    return {
      phase: "pending",
      kind: o.kind,
      touch: !!o.touch,
      armed: false,
      locked: reason !== null,
      reason,
      click: false,
      dragged: false,
      inside: false,
      taskId: row && row.task && row.task.id !== undefined ? row.task.id : row ? row.key : null,
      fromKey: row && row.key !== undefined && row.key !== null ? String(row.key) : null,
      overKey: null,
      x0,
      y0,
      x: x0,
      y: y0,
      t0: isNum(o.t) ? o.t : 0,
      px: isNum(o.px) ? o.px : 0,
      sched,
    };
  }

  // ---- reducer ----
  function reduce(state, ev) {
    if (!state || typeof state !== "object" || !ev || typeof ev !== "object") return state;
    if (TERMINAL.has(state.phase)) return state;
    switch (ev.type) {
      case "move":
        return onMove(state, ev);
      case "hold":
        return onHold(state, ev);
      case "over":
        return onOver(state, ev);
      case "cancel":
        return Object.assign({}, state, { phase: "cancelled", click: false });
      case "up":
        return onUp(state, ev);
      default:
        return state;
    }
  }

  function onMove(state, ev) {
    if (!isNum(ev.x)) return state;
    const x = ev.x;
    const y = isNum(ev.y) ? ev.y : state.y;
    const t = isNum(ev.t) ? ev.t : state.t0;
    let next = Object.assign({}, state, { x, y });
    if (state.phase === "drag") return next;
    // pending
    if (next.touch && !next.armed) {
      if (!next.locked && t - next.t0 >= LONG_PRESS_MS) next.armed = true; // tekan lama tercapai walau peristiwa hold terlewat
      else if (Math.hypot(x - next.x0, y - next.y0) > TOUCH_SLOP_PX) return Object.assign(next, { phase: "scroll", click: false });
      else return next;
    }
    const dist = next.kind === "link" ? Math.hypot(x - next.x0, y - next.y0) : Math.abs(x - next.x0);
    if (dist < THRESHOLD_PX) return next;
    if (next.locked) return Object.assign(next, { phase: "cancelled", click: false });
    return Object.assign(next, { phase: "drag", dragged: true });
  }

  function onHold(state, ev) {
    if (state.phase !== "pending" || !state.touch || state.armed || state.locked) return state;
    if (!isNum(ev.t) || ev.t - state.t0 < LONG_PRESS_MS) return state;
    const next = Object.assign({}, state, { armed: true });
    if (ev.kind === "resize" && state.kind === "move" && state.sched && state.sched.duration !== 0) next.kind = "resize";
    return next;
  }

  function onOver(state, ev) {
    if (state.kind !== "link") return state;
    let k = ev.rowKey;
    if (k === undefined || k === null || k === "") k = null;
    else {
      k = String(k);
      if (k.indexOf("g:") === 0) k = null; // baris judul kelompok bukan ujung dependensi
    }
    return k === state.overKey ? state : Object.assign({}, state, { overKey: k });
  }

  function onUp(state, ev) {
    const x = isNum(ev.x) ? ev.x : state.x;
    const inside = !!ev.inside;
    const next = Object.assign({}, state, { phase: "released", x, inside });
    if (state.phase === "drag") return Object.assign(next, { click: false });
    // pending: klik/ketuk bila tidak ada seret dan bukan tekan lama; link tidak punya klik
    const held = state.armed || (state.touch && isNum(ev.t) && ev.t - state.t0 >= LONG_PRESS_MS);
    return Object.assign(next, { click: inside && state.kind !== "link" && !held });
  }

  // ---- hitung geser / durasi dari state seret ----
  function prevValue(sched, key) {
    if (sched && sched.raw && typeof sched.raw === "object") {
      const v = sched.raw[key];
      return v === undefined ? null : v;
    }
    const v = sched ? sched[key] : null;
    return v === undefined ? null : v;
  }

  const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

  // → {kind, start, finish, duration, dx, width, changed, patch?, prev?} | null
  function calc(state, c, px) {
    const s0 = CAL.dn(state.sched.start);
    if (!Number.isInteger(s0)) return null;
    const dur0 = state.sched.duration;
    const delta = clamp(Math.round((state.x - state.x0) / px) || 0, -MAX_DELTA, MAX_DELTA);
    if (state.kind === "move") {
      // Task: jepret per hari, hari libur → hari kerja berikutnya. Milestone (durasi 0) TIDAK dijepret: bergeser per hari
      // kalender dan boleh jatuh di hari libur (R6) — sama dengan seksi Jadwal yang menyimpan tanggal milestone apa adanya.
      const ms = dur0 === 0;
      const target = delta === 0 || ms ? s0 + delta : CAL.nextWork(c, s0 + delta);
      const fin = ms ? target : CAL.finish(c, target, dur0); // durasi hari kerja tetap
      const shown = ms ? target : CAL.nextWork(c, target);
      const out = {
        kind: "move",
        start: shown,
        finish: dur0 === 0 ? shown : fin,
        duration: dur0,
        dx: (target - s0) * px,
        width: dur0 === 0 ? 0 : (fin - target + 1) * px,
        changed: delta !== 0 && target !== s0, // jatuh kembali di hari semula (mis. Min → Sen asal) = tanpa tulis
      };
      if (out.changed) {
        out.patch = { start: CAL.iso(target) };
        out.prev = { start: prevValue(state.sched, "start") };
      }
      return out;
    }
    if (state.kind === "resize") {
      if (dur0 === 0) return null; // milestone
      const eff = CAL.nextWork(c, s0);
      const fin0 = CAL.finish(c, s0, dur0);
      const tf = Math.min(fin0 + delta, eff + CAL.MAX_ITER);
      const n = clamp(CAL.workdays(c, eff, tf), 1, SCHED.DUR_MAX); // durasi ≥ 1
      const fin = CAL.finish(c, s0, n);
      const out = { kind: "resize", start: eff, finish: fin, duration: n, dx: 0, width: (fin - s0 + 1) * px, changed: n !== dur0 };
      if (out.changed) {
        out.patch = { duration: n };
        out.prev = { duration: prevValue(state.sched, "duration") };
      }
      return out;
    }
    return null;
  }

  function usable(state) {
    return !!state && typeof state === "object" && !state.locked && !!state.sched && (state.kind === "move" || state.kind === "resize");
  }

  // Pratinjau selama seret: dx (px, relatif posisi bar tersimpan), lebar baru, tooltip. null bila bukan seret geser/durasi.
  // `range` dicadangkan (jepit ke rentang dilakukan komponen); px = lebar hari saat ini (bawaan state.px).
  function preview(state, c, range, px) {
    if (!usable(state) || state.phase !== "drag") return null;
    const w = isNum(px) && px > 0 ? px : state.px;
    if (!(w > 0)) return null;
    const r = safe(() => calc(state, c, w));
    if (!r) return null;
    const tooltip = r.duration === 0 && r.kind === "move" ? `${CAL.fmtShort(r.start)} · milestone` : `${CAL.fmtShort(r.start)} → ${CAL.fmtShort(r.finish)} · ${r.duration} hk`;
    return { dx: r.dx, width: r.width, tooltip, start: r.start, finish: r.finish, duration: r.duration, changed: r.changed };
  }

  // Satu-satunya jalan menulis: hanya setelah `up` di dalam grafik setelah seret sungguhan.
  function commit(state, c) {
    if (!state || typeof state !== "object" || state.phase !== "released" || !state.dragged || !state.inside || state.locked) return null;
    if (state.kind === "link") {
      const to = state.overKey;
      if (!state.fromKey || to === null || to === undefined || to === state.fromKey) return null;
      return { link: { pred: state.fromKey, succ: to } };
    }
    if (!usable(state) || !(state.px > 0)) return null;
    const r = safe(() => calc(state, c, state.px));
    if (!r || !r.changed) return null;
    const san = SCHED.sanitizePatch(r.patch);
    if (!san.ok) return null;
    return { taskId: state.taskId, patch: san.patch, prev: r.prev };
  }

  // ---- keyboard (R23): Alt+←/→ geser 1 hari kerja (milestone: 1 hari kalender), Alt+Shift+←/→ durasi ±1 ----
  function keyStep(ev, sched, c) {
    const e = ev || {};
    if (!e.alt || (e.key !== "ArrowLeft" && e.key !== "ArrowRight")) return null;
    if (!sched || typeof sched !== "object" || !CAL.isIso(sched.start)) return null;
    const dir = e.key === "ArrowRight" ? 1 : -1;
    const dur = isInt(sched.duration) && sched.duration >= 0 ? sched.duration : 1;
    let patch;
    let prev;
    if (e.shift) {
      if (dur === 0) return null; // milestone tidak punya durasi
      const n = dur + dir;
      if (n < 1 || n > SCHED.DUR_MAX) return null;
      patch = { duration: n };
      prev = { duration: prevValue(sched, "duration") };
    } else {
      const s = CAL.dn(sched.start);
      // milestone: ±1 hari kalender tanpa jepret (R6); task: ±1 hari kerja
      const ns = dur === 0 ? s + dir : safe(() => CAL.addWork(c, CAL.nextWork(c, s), dir));
      if (!Number.isInteger(ns)) return null;
      patch = { start: CAL.iso(ns) };
      prev = { start: prevValue(sched, "start") };
    }
    const san = SCHED.sanitizePatch(patch);
    return san.ok ? { patch: san.patch, prev } : null;
  }

  // ---- klik-jadwalkan (R21): task tanpa jadwal, klik di tanggal X → {start: nextWork(X), duration: 1} ----
  function scheduleAt(c, dayNumber, sched) {
    if (!isInt(dayNumber)) return null;
    if (sched && CAL.isIso(sched.start)) return null;
    const s = safe(() => CAL.nextWork(c, dayNumber));
    if (!Number.isInteger(s)) return null;
    const san = SCHED.sanitizePatch({ start: CAL.iso(s), duration: 1 });
    if (!san.ok) return null;
    return { patch: san.patch, prev: { start: prevValue(sched, "start"), duration: prevValue(sched, "duration") } };
  }

  return Object.freeze({
    THRESHOLD_PX,
    LONG_PRESS_MS,
    TOUCH_SLOP_PX,
    EDGE_PX,
    EDGE_TOUCH_PX,
    DOT_PX,
    hitZone,
    start,
    reduce,
    preview,
    commit,
    keyStep,
    scheduleAt,
  });
})(
  typeof TLCal !== "undefined" ? TLCal : require("./calendar.js"),
  typeof TLSched !== "undefined" ? TLSched : require("./schedule.js"),
);
if (typeof module !== "undefined" && module.exports) module.exports = TLDrag;
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
// Plugin Timeline (Fase 1, PR 1b; spec docs/superpowers/specs/2026-10-31-plugin-fase1-timeline-design.md §8;
// 1.1.0 = PR 1c-1 jadwal otomatis, spec docs/superpowers/specs/2026-11-01-plugin-fase1-1c-otomatis-design.md).
// Gantt untuk project dan workspace: view `gantt` (slot taskList.views) dan seksi `schedule` (slot
// taskDetail.sections). Mesin murni ada di `parts` (holidays-id.js, calendar.js, schedule.js, cpm.js, plan.js,
// load.js, layout.js, mspdi.js, drag.js — compile.js menggabungkannya SEBELUM kode ini, jadi TLHolidays/TLCal/TLSched/
// TLCpm/TLPlan/TLLoad/TLLayout/TLMspdi/TLDrag tersedia sebagai const di lingkup yang sama; tidak ada global window).
// `manifest` disuntik compile.js dari manifest.json. 1.3.0 = PR 1d-1 Beban Tim (TLLoad + record `resource`); 1.4.0 =
// PR 1d-2 earned value 🍅 (TLLoad.ev, ringkasan toolbar) + ekspor Microsoft Project (TLMspdi, api.ui.saveFile).
//
// Susunan modul (Task 6 = kerangka; komponen diisi Task 7–10):
//   1. Konstanta + pesan UI persis (kalender, preferensi).
//   2. calendarStore(api), projectStore(api) (1c-1 R6), baselineStore(api) (1c-2 K41), dan resourceStore(api) (1d-1 K48)
//      — SATU-SATUNYA kode yang menyentuh api.records (R5), masing-masing hanya entitasnya sendiri. calTarget
//      (= TLSched.calTarget) / TLSched.unitOf / resRecId memilih id/scope. Tulisan hanya di calendarStore.save,
//      projectStore.setAuto, baselineStore → saveBaseline (put + remove), dan resourceStore → saveResource (put)
//      (R25: mesin dan pemuat tidak pernah menulis).
//   3. Preferensi per perangkat lewat api.storage: prefKey / cleanPref / PREF_DEFAULTS (R19); 1c-2: bl:<page> = baseline
//      aktif yang ditampilkan (P2 a, tanpa record).
//   4. Komponen: konstanta tampilan, pembantu murni, hooks (useMedia/usePref/useCalendar/useUnits/useBaselines/useEngine), fungsi render
//      (toolbar/head/tabel/grafik/panah/legenda), TimelineViewBody (Task 7; interaksi Task 8 lewat `ix`; popover
//      kalender + Daftar HP Task 9; 1c-2 T5: BaselinePicker + SaveBaselineDialog), ScheduleSection (Task 10);
//      pembungkus React.memo malas (R24).
//   5. `pure` + module.exports untuk tes Node; registrasi hanya bila host plugin (TF.plugins) ada.

// ── 1. Konstanta ────────────────────────────────────────────────────────────
const CAL_ENTITY = "calendar";
const CAL_MAX_BYTES = 16384;
const MSG_CAL_TOO_LARGE = "Kalender terlalu besar — hapus sebagian libur tambahan";
const MSG_CAL_LOST = "Perubahan kalender di perangkat ini kalah oleh perubahan yang lebih baru";

// ── 2. Kalender (R4, R5) ────────────────────────────────────────────────────
// Task dengan list_id memakai kalender workspace `cal@list:<id>` (scope "list:<id>", dibagi semua anggota);
// tanpa list_id kalender pribadi `cal@user` (scope "user"). Satu pembantu untuk semua: TLSched.calTarget.
const calTarget = TLSched.calTarget;
function calTooLarge() {
  const e = new Error(MSG_CAL_TOO_LARGE);
  e.code = "TOO_LARGE";
  return e;
}

// Peristiwa api.records.onChange → bentuk adaptor untuk satu entitas, atau null bila bukan untuknya. Peristiwa tarik
// sukses host {entity: null, pulled: true} (README §5) diteruskan ke semua adaptor sebagai {ids: [], source: "sync",
// lost: [], pulled: true}. Murni (tanpa akses api) — dipakai bersama calendarStore dan projectStore.
function recordEvent(ev, entity) {
  if (!ev) return null;
  if (ev.pulled === true) return {
    ids: [],
    source: "sync",
    lost: [],
    pulled: true
  };
  if (ev.entity !== entity) return null;
  return {
    ids: Array.isArray(ev.ids) ? ev.ids.slice() : [],
    source: ev.source,
    lost: Array.isArray(ev.lost) ? ev.lost.slice() : []
  };
}

// Adaptor tunggal api.records untuk entitas `calendar`. Tidak ada record → DEFAULT_CAL (pending false, exists false).
// Data dari anggota lain selalu lewat TLCal.normalize. save menolak > 16384 byte di klien sebelum put.
// `exists` = record ada di perangkat ini (final review #2: kalender workspace tanpa record lokal bisa saja belum ditarik).
function calendarStore(api) {
  return {
    load(calId) {
      return Promise.resolve().then(() => api.records.get(CAL_ENTITY, calId)).then(r => {
        if (!r) return {
          data: TLCal.normalize(TLCal.DEFAULT_CAL),
          pending: false,
          exists: false
        };
        return {
          data: TLCal.normalize(r.data),
          pending: !!r.pending,
          exists: true
        };
      });
    },
    save(calId, scope, data) {
      return Promise.resolve().then(() => {
        const clean = TLCal.normalize(data);
        if (TLCal.byteSize(clean) > CAL_MAX_BYTES) throw calTooLarge();
        return api.records.put(CAL_ENTITY, calId, clean, {
          scope
        }).then(r => ({
          data: TLCal.normalize(r && r.data ? r.data : clean),
          pending: !!(r && r.pending),
          exists: true
        }), e => {
          throw e && e.code === "TOO_LARGE" ? calTooLarge() : e;
        });
      });
    },
    // fn({ids, source: "local"|"sync", lost: string[]}) hanya untuk entitas calendar, ditambah peristiwa tarik sukses
    // host {ids: [], source: "sync", lost: [], pulled: true} (entity null; README §5); mengembalikan off().
    subscribe(fn) {
      return api.records.onChange(ev => {
        const e = recordEvent(ev, CAL_ENTITY);
        if (e) fn(e);
      });
    }
  };
}

// ── 2b. Unit jadwal otomatis: record `project` (1c-1 R5, R6) ─────────────────
// Satu record per unit jadwal (project dalam workspace, atau project pribadi): id dari TLSched.unitOf (satu-satunya
// pembuat id), data {v: 1, auto, name, by}. Tidak ada record / data tidak sah → unit dianggap tidak ada (Manual).
const PRJ_ENTITY = "project";
const PRJ_PAGE = 1000; // batas atas limit api.records.list
const NO_UNIT = Object.freeze({
  auto: false,
  by: null,
  updatedAt: null,
  pending: false,
  exists: false,
  fold: null
});
const EMPTY_UNITS = new Map();

// Record → Unit {auto, by, updatedAt, pending, exists, fold}. `fold` = projectFold(nama record) — nama record sudah
// dipotong TLSched.cutName saat ditulis, jadi sama dengan projectFold(cutName(nama project task)) untuk project yang
// sama. PENJAGA TABRAKAN HASH ada di lookup (TLSched.unitFor / modeOf membandingkan fold dengan project task), bukan
// di sini: daftar workspace tidak tahu project mana yang akan mencari id ini.
//   expect = lipatan unit halaman project (jalur get: harus sama, selain itu tidak ada); null = jalur daftar workspace,
//   yang hanya memeriksa konsistensi diri (nama menghasilkan id record ini) bila nama pasti tidak terpotong.
function prjUnitOf(r, expect, lid) {
  const d = r && typeof r === "object" ? r.data : null;
  if (!d || typeof d !== "object" || Array.isArray(d)) return NO_UNIT;
  if (d.v !== 1 || typeof d.auto !== "boolean" || typeof d.name !== "string" || d.name !== TLSched.cutName(d.name)) return NO_UNIT;
  if (!(d.by === null || Number.isInteger(d.by))) return NO_UNIT;
  const fold = TLSched.projectFold(d.name);
  if (expect !== null) {
    if (fold !== expect) return NO_UNIT;
  } else if (d.name.length < TLSched.NAME_MAX - 1 && TLSched.unitOf({
    pageKind: "workspace",
    listId: lid,
    projectName: d.name
  }).recId !== r.id) {
    return NO_UNIT; // nama utuh yang tidak menghasilkan id ini = data rusak (nama ≥ 119 bisa hasil potong cutName)
  }
  return {
    auto: d.auto,
    by: d.by,
    updatedAt: typeof r.updated_at === "string" ? r.updated_at : null,
    pending: !!r.pending,
    exists: true,
    fold
  };
}

// Adaptor tunggal api.records untuk entitas `project` (pola calendarStore). page = {pageKind, listId, projectName}.
//   loadUnits(page) → Promise<Map<recId, Unit>>: workspace → semua record scope "list:<lid>" (ikuti `next`); halaman
//     project → satu record unitOf(page) (tanpa record → NO_UNIT). Unit = {auto, by, updatedAt, pending, exists}.
//     Tidak pernah menulis (record rusak tidak dinormalisasi ulang).
//   setAuto(unit, on, userId) → Promise<record>: SATU-SATUNYA tulisan record project (aksi eksplisit sakelar, R15).
//   subscribe(fn) → off: perubahan entitas project + peristiwa tarik sukses (recordEvent).
function projectStore(api) {
  return {
    loadUnits(page) {
      return Promise.resolve().then(() => {
        const p = page && typeof page === "object" ? page : {};
        const unit = TLSched.unitOf({
          pageKind: p.pageKind,
          listId: p.pageKind === "workspace" ? p.listId : null,
          projectName: p.projectName
        });
        const out = new Map();
        if (p.pageKind === "workspace" && unit.scope !== "user") {
          const scope = unit.scope;
          const lid = scope.slice(5);
          const page1 = after => {
            const q = after === null ? {
              scope,
              limit: PRJ_PAGE
            } : {
              scope,
              limit: PRJ_PAGE,
              after
            };
            return Promise.resolve(api.records.list(PRJ_ENTITY, q)).then(res => {
              const items = res && Array.isArray(res.items) ? res.items : [];
              for (const r of items) if (r && typeof r.id === "string") out.set(r.id, prjUnitOf(r, null, lid));
              const next = res && typeof res.next === "string" && res.next ? res.next : null;
              return next !== null && next !== after ? page1(next) : out;
            });
          };
          return page1(null);
        }
        return Promise.resolve(api.records.get(PRJ_ENTITY, unit.recId)).then(r => {
          out.set(unit.recId, r ? prjUnitOf(r, TLSched.projectFold(TLSched.cutName(unit.name)), null) : NO_UNIT);
          return out;
        });
      });
    },
    setAuto(unit, on, userId) {
      return Promise.resolve().then(() => {
        if (!unit || typeof unit.recId !== "string" || typeof unit.scope !== "string") throw new Error("unit jadwal tidak sah");
        const data = {
          v: 1,
          auto: on === true,
          name: TLSched.cutName(unit.name),
          // potong simetris dengan baca/lookup (sadar surrogate)
          by: Number.isInteger(userId) ? userId : null
        };
        return api.records.put(PRJ_ENTITY, unit.recId, data, {
          scope: unit.scope
        });
      });
    },
    subscribe(fn) {
      return api.records.onChange(ev => {
        const e = recordEvent(ev, PRJ_ENTITY);
        if (e) fn(e);
      });
    }
  };
}

// ── 2c. Baseline per unit jadwal: record `baseline` (1c-2 K41) ──────────────
// Tiga slot per unit: id `bl<n>@user:<h>` / `bl<n>@list:<lid>:<h>` = "bl" + n + ekor recId TLSched.unitOf (satu-satunya
// pembuat id; tanpa hash tulisan tangan). Data {v: 1, n, name, savedAt, by, t} (kodek TLPlan.baselineEncode/Decode).
// Penjaga fold TIDAK perlu: slot dipilih eksplisit di unit halaman, tidak pernah dicari dari task.
const BL_ENTITY = "baseline";
const BL_SLOTS = Object.freeze([1, 2, 3]);
const BL_PAGE = 1000; // batas atas limit api.records.list
const MSG_BL_TOO_LARGE = "Baseline terlalu besar";
const MSG_BL_WAIT = "Menunggu data baseline workspace…";
const MSG_ACTUAL = "Aktual"; // 1c-2 §7.6: legenda garis aktual (Task 6)
// Potret CAS slot (Review Focus 4): {exists, updatedAt, by} record slot; slot kosong / record asing = BL_NO_SNAP.
const BL_NO_SNAP = Object.freeze({
  exists: false,
  updatedAt: null,
  by: null
});
const EMPTY_BASES = new Map();
const EMPTY_BY_UNIT = new Map();
function blError(code, msg) {
  const e = new Error(msg);
  e.code = code;
  return e;
}

// Id record slot n unit. unit = keluaran TLSched.unitOf: recId harus "prj@" + scope + ":" (scope tersandi di id, README
// §5) — selain itu INVALID (unit palsu / scope tidak cocok tidak pernah menjadi id record).
function blRecId(unit, n) {
  const u = unit && typeof unit === "object" ? unit : null;
  if (!u || typeof u.recId !== "string" || typeof u.scope !== "string" || u.recId.indexOf("prj@" + u.scope + ":") !== 0) {
    throw blError("INVALID", "unit jadwal tidak sah");
  }
  if (BL_SLOTS.indexOf(n) < 0) throw blError("INVALID", "slot baseline tidak sah");
  return "bl" + n + u.recId.slice(3);
}

// Record hidup → entri slot n {n, foreign, name, savedAt, by, rows, snap, pending}; tidak ada record → null.
// Record ASING (v ≠ 1, bentuk rusak, n data ≠ n id — mis. baseline klien versi lebih baru) tetap MENGISI slot (fix review
// T4): entri {foreign: true, name/savedAt/by null, rows kosong}, snap {exists: true, updatedAt, by: null} — dipakai sama
// oleh loadAll dan CAS, jadi menimpanya butuh potret record itu (konfirmasi Timpa T5), tidak pernah diam-diam.
function blEntry(r, n) {
  if (!r || typeof r !== "object") return null;
  const updatedAt = typeof r.updated_at === "string" ? r.updated_at : null;
  const dec = TLPlan.baselineDecode(r.data);
  if (!dec || dec.n !== n) {
    return {
      n,
      foreign: true,
      name: null,
      savedAt: null,
      by: null,
      rows: new Map(),
      snap: {
        exists: true,
        updatedAt,
        by: null
      },
      pending: !!r.pending
    };
  }
  const snap = {
    exists: true,
    updatedAt,
    by: Number.isInteger(dec.by) ? dec.by : null
  };
  return Object.assign({}, dec, {
    foreign: false,
    snap,
    pending: !!r.pending
  });
}
function blSameSnap(a, b) {
  return a.exists === b.exists && a.updatedAt === b.updatedAt && a.by === b.by;
}

// Adaptor tunggal api.records untuk entitas `baseline` (pola projectStore).
//   loadAll(unit) → Promise<Map<n, entri>>: list scope unit (ikuti `next`), hanya id slot unit ini. Record yang lolos
//     baselineDecode dengan n sama → entri biasa (foreign false); record asing → entri terisi foreign true (blEntry).
//     Tidak pernah menulis. Catatan T5: satu unit per halaman → boleh diganti 3 get; beberapa unit di halaman
//     workspace → SATU pemuat se-scope dibagi semua unit (jangan list scope per unit — unit × ukuran scope, R24).
//   loadScope(units) → Promise<Map<recId, Map<n, entri>>>: pemuat se-scope itu (1c-2 T5) — satu list untuk semua unit
//     (satu scope; beda scope / kosong → INVALID). loadAll(unit) = loadScope([unit]).
//   save(unit, n, name, data, snap) → Promise<record>: tulis {v: 1, n, name, savedAt, by, t} (n/nama dari argumen,
//     savedAt/by/t dari data encode). Galat ber-`code`: INVALID (unit/slot/data/nama/snap), TOO_LARGE (> BL_MAX byte,
//     pesan "Baseline terlalu besar", diperiksa SEBELUM baca/tulis; = BL_MAX boleh, sama dengan host), STALE (potret
//     record slot sekarang ≠ snap saat dialog dibuka). Konfirmasi timpa = urusan UI; store hanya menegakkan snap.
//   remove(unit, n, snap?) → Promise: hapus slot (tombstone host); snap ada → CAS seperti save (STALE / INVALID).
//   subscribe(fn) → off: perubahan entitas baseline + peristiwa tarik sukses (recordEvent).
// SATU-SATUNYA tulisan record baseline: saveBaseline (pagar R25 + pin AST).
function baselineStore(api) {
  const snapOk = s => !!s && typeof s === "object";
  const normSnap = s => ({
    exists: s.exists === true,
    updatedAt: typeof s.updatedAt === "string" ? s.updatedAt : null,
    by: Number.isInteger(s.by) ? s.by : null
  });
  // CAS: potret record slot sekarang (get) harus sama dengan potret saat dialog dibuka.
  const casSlot = (id, n, want) => Promise.resolve(api.records.get(BL_ENTITY, id)).then(cur => {
    const e = blEntry(cur, n);
    if (!blSameSnap(want, e ? e.snap : BL_NO_SNAP)) throw blError("STALE", "baseline berubah sejak dialog dibuka");
  });
  function saveBaseline(op, unit, n, name, data, snap) {
    return Promise.resolve().then(() => {
      const id = blRecId(unit, n);
      if (op === "remove") {
        // snap opsional (ruling review T4): ada → CAS sama dengan simpan; tidak ada → hapus langsung.
        if (snap !== undefined && !snapOk(snap)) throw blError("INVALID", "potret baseline tidak sah");
        const gate = snap === undefined ? Promise.resolve() : casSlot(id, n, normSnap(snap));
        return gate.then(() => api.records.remove(BL_ENTITY, id));
      }
      const d = data && typeof data === "object" && !Array.isArray(data) ? data : null;
      if (!d || !Array.isArray(d.t)) throw blError("INVALID", "data baseline tidak sah");
      if (typeof name !== "string") throw blError("INVALID", "nama baseline tidak sah");
      if (!snapOk(snap)) throw blError("INVALID", "potret baseline tidak ada");
      const want = normSnap(snap);
      const out = {
        v: 1,
        n,
        name,
        savedAt: typeof d.savedAt === "string" ? d.savedAt : null,
        by: Number.isInteger(d.by) ? d.by : null,
        t: d.t
      };
      if (TLPlan.baselineByteSize(out) > TLPlan.BL_MAX) throw blError("TOO_LARGE", MSG_BL_TOO_LARGE);
      return casSlot(id, n, want).then(() => {
        return api.records.put(BL_ENTITY, id, out, {
          scope: unit.scope
        }).then(r => r, err => {
          throw err && err.code === "TOO_LARGE" ? blError("TOO_LARGE", MSG_BL_TOO_LARGE) : err;
        });
      });
    });
  }
  // Pemuat se-scope (catatan T4 → T5): SATU list scope (ikuti `next`) dibagi semua unit; unit harus satu scope.
  function loadScope(units) {
    return Promise.resolve().then(() => {
      const us = Array.isArray(units) ? units : [];
      if (!us.length) throw blError("INVALID", "unit jadwal tidak sah");
      const scope = us[0] && typeof us[0] === "object" ? us[0].scope : null;
      const ids = new Map(); // id slot → [recId, n]
      const out = new Map();
      for (const u of us) {
        if (!u || u.scope !== scope) throw blError("INVALID", "unit jadwal beda scope");
        for (const n of BL_SLOTS) ids.set(blRecId(u, n), [u.recId, n]);
        out.set(u.recId, new Map());
      }
      const page1 = after => {
        const q = after === null ? {
          scope,
          limit: BL_PAGE
        } : {
          scope,
          limit: BL_PAGE,
          after
        };
        return Promise.resolve(api.records.list(BL_ENTITY, q)).then(res => {
          const items = res && Array.isArray(res.items) ? res.items : [];
          for (const r of items) {
            const hit = r && typeof r.id === "string" ? ids.get(r.id) : undefined;
            const e = hit === undefined ? null : blEntry(r, hit[1]);
            if (e) out.get(hit[0]).set(hit[1], e);
          }
          const next = res && typeof res.next === "string" && res.next ? res.next : null;
          return next !== null && next !== after ? page1(next) : out;
        });
      };
      return page1(null);
    });
  }
  return {
    loadAll(unit) {
      return loadScope([unit]).then(m => m.get(unit.recId));
    },
    loadScope,
    save(unit, n, name, data, snap) {
      return saveBaseline("put", unit, n, name, data, snap);
    },
    remove(unit, n, snap) {
      return saveBaseline("remove", unit, n, null, null, snap);
    },
    subscribe(fn) {
      return api.records.onChange(ev => {
        const e = recordEvent(ev, BL_ENTITY);
        if (e) fn(e);
      });
    }
  };
}

// ── 2d. Kapasitas/cuti anggota: record `resource` (1d-1 K48, R9) ─────────────
// Satu record per orang per lingkup: workspace `res@list:<lid>:<uid>` (scope "list:<lid>", dibagi semua anggota — semua
// anggota boleh mengedit baris siapa pun, Q4 (a)); halaman project pribadi `res@user:<uid>` (scope "user"). Data = kodek
// TLLoad.resourceEncode/Decode {v: 1, capacity, leave: [{from, to, note}], by}. Tidak ada record → kapasitas bawaan
// (TLLoad: 8 🍅/hari tanpa cuti); record yang belum ada TIDAK PERNAH dibuat otomatis (R25).
const RES_ENTITY = "resource";
const RES_PAGE = 1000; // batas atas limit api.records.list
const RES_MAX_BYTES = 4096; // = manifest.records.resource.maxBytes
const MSG_RES_STALE = "Data berubah sejak dialog dibuka — muat ulang";
const MSG_RES_WAIT = "Menunggu data workspace…";
const MSG_RES_TOO_LARGE = "Data kapasitas terlalu besar — kurangi cuti atau catatannya";
const EMPTY_RES = new Map();
const RES_SCOPE_RE = /^list:([1-9]\d*)$/;

// Id + scope record resource satu orang (satu-satunya pembuat id). pageKind "workspace" + listId bilangan bulat AMAN > 0 →
// {id: "res@list:<lid>:<uid>", scope: "list:<lid>"}; "project" (pribadi) → {id: "res@user:<uid>", scope: "user"}; uid
// bukan bilangan (bukan string) bulat aman > 0 (TLLoad.uidOf, review T2–T3: 1e21 bukan uid) / halaman lain → Error code
// INVALID (pola blError).
function resRecId(pageKind, listId, uid) {
  if (uid === null || TLLoad.uidOf(uid) !== uid) throw blError("INVALID", "anggota tidak sah");
  if (pageKind === "workspace" && Number.isSafeInteger(listId) && listId > 0) return {
    id: "res@list:" + listId + ":" + uid,
    scope: "list:" + listId
  };
  if (pageKind === "project") return {
    id: "res@user:" + uid,
    scope: "user"
  };
  throw blError("INVALID", "halaman tidak sah");
}

// Pola id record milik scope (uid tanpa nol di depan → satu id per orang); scope tak sah → null.
function resIdRe(scope) {
  if (scope === "user") return /^res@user:([1-9]\d*)$/;
  const m = typeof scope === "string" ? RES_SCOPE_RE.exec(scope) : null;
  return m ? new RegExp("^res@list:" + m[1] + ":([1-9]\\d*)$") : null;
}

// Record → entri {res, snap: {exists: true, updatedAt, by}, pending}. res = TLLoad.resourceDecode (data asing/rusak →
// bawaan); by hanya dari data v 1 yang sah (pola blEntry: data asing tidak dipercaya).
function resEntry(r) {
  const d = r.data && typeof r.data === "object" && !Array.isArray(r.data) ? r.data : null;
  const by = d && d.v === 1 && Number.isInteger(d.by) && d.by > 0 ? d.by : null;
  return {
    res: TLLoad.resourceDecode(r.data),
    snap: {
      exists: true,
      updatedAt: typeof r.updated_at === "string" ? r.updated_at : null,
      by
    },
    pending: !!r.pending
  };
}

// Adaptor tunggal api.records untuk entitas `resource` (pola baselineStore).
//   loadScope(scope) → Promise<Map<uid, entri>>: list scope (ikuti `next`, berhenti bila next = after), hanya id yang
//     cocok pola scope itu (resIdRe). Tidak pernah menulis. Scope tak sah → INVALID tanpa list.
//   save(target, value, snap) → Promise<record>: lewat saveResource. target = keluaran resRecId; value = {capacity,
//     leave} editor; snap = potret CAS saat dialog dibuka ({exists, updatedAt}; record absen = {exists: false,
//     updatedAt: null}). Galat ber-`code`: INVALID (target/snap/nilai — dari TLLoad.resourceEncode), TOO_LARGE (> 4096
//     byte, diperiksa SEBELUM baca/tulis seperti saveBaseline), STALE (potret sekarang ≠ snap; pesan MSG_RES_STALE).
//   get(target) → Promise<entri|null>: SATU record terkini di perangkat ini (records.get; T7 "Muat ulang" setelah STALE —
//     peta useResources bisa tertinggal debounce). Hanya baca. Target tak sah → INVALID.
//   subscribe(fn) → off: perubahan entitas resource + peristiwa tarik sukses (recordEvent).
// SATU-SATUNYA tulisan record resource: saveResource (pagar R25 + pin AST "saveResource:records.put": 1).
function resourceStore(api) {
  const snapOk = s => !!s && typeof s === "object" && !Array.isArray(s);
  const sameSnap = (a, b) => a.exists === b.exists && a.updatedAt === b.updatedAt;
  const targetOf = target => {
    const t = target && typeof target === "object" ? target : null;
    const re = t && typeof t.id === "string" ? resIdRe(t.scope) : null;
    if (!re || !re.test(t.id)) throw blError("INVALID", "record kapasitas tidak sah");
    return t;
  };
  function saveResource(target, value, snap) {
    return Promise.resolve().then(() => {
      const t = targetOf(target);
      if (!snapOk(snap)) throw blError("INVALID", "potret kapasitas tidak ada");
      const want = {
        exists: snap.exists === true,
        updatedAt: typeof snap.updatedAt === "string" ? snap.updatedAt : null
      };
      const data = TLLoad.resourceEncode(value, {
        by: TLLoad.uidOf(api.env ? api.env.userId : null)
      }); // INVALID diteruskan
      if (TLLoad.resourceByteSize(data) > RES_MAX_BYTES) throw blError("TOO_LARGE", MSG_RES_TOO_LARGE);
      return Promise.resolve(api.records.get(RES_ENTITY, t.id)).then(cur => {
        const now = cur && typeof cur === "object" ? {
          exists: true,
          updatedAt: typeof cur.updated_at === "string" ? cur.updated_at : null
        } : {
          exists: false,
          updatedAt: null
        };
        if (!sameSnap(want, now)) throw blError("STALE", MSG_RES_STALE);
        return api.records.put(RES_ENTITY, t.id, data, {
          scope: t.scope
        }).then(r => r, err => {
          throw err && err.code === "TOO_LARGE" ? blError("TOO_LARGE", MSG_RES_TOO_LARGE) : err;
        });
      });
    });
  }
  function loadScope(scope) {
    return Promise.resolve().then(() => {
      const re = resIdRe(scope);
      if (!re) throw blError("INVALID", "scope kapasitas tidak sah");
      const out = new Map();
      const page1 = after => {
        const q = after === null ? {
          scope,
          limit: RES_PAGE
        } : {
          scope,
          limit: RES_PAGE,
          after
        };
        return Promise.resolve(api.records.list(RES_ENTITY, q)).then(res => {
          const items = res && Array.isArray(res.items) ? res.items : [];
          for (const r of items) {
            const m = r && typeof r.id === "string" ? re.exec(r.id) : null;
            const uid = m ? Number(m[1]) : NaN;
            if (Number.isSafeInteger(uid)) out.set(uid, resEntry(r));
          }
          const next = res && typeof res.next === "string" && res.next ? res.next : null;
          return next !== null && next !== after ? page1(next) : out;
        });
      };
      return page1(null);
    });
  }
  return {
    loadScope,
    get(target) {
      return Promise.resolve().then(() => api.records.get(RES_ENTITY, targetOf(target).id)).then(r => r && typeof r === "object" ? resEntry(r) : null);
    },
    save(target, value, snap) {
      return saveResource(target, value, snap);
    },
    subscribe(fn) {
      return api.records.onChange(ev => {
        const e = recordEvent(ev, RES_ENTITY);
        if (e) fn(e);
      });
    }
  };
}

// ── 3. Preferensi per perangkat (R19) ───────────────────────────────────────
const PREF_DEFAULTS = Object.freeze({
  zoom: "week",
  sort: "wbs",
  cols: false,
  mode: "gantt",
  section: false,
  crit: false,
  bl: 0,
  load: false
});
const PREF_CHOICES = Object.freeze({
  zoom: ["day", "week", "month"],
  sort: ["wbs", "start"],
  mode: ["gantt", "list"],
  bl: [0, 1, 2, 3]
});

// "zoom:<page>", "sort:<page>", "cols:<page>", "mode:<page>", "crit:<page>" (1c-1 R18); seksi Jadwal global: "section:open".
// 1d-1 (K56, R10): "load:<page>" = panel Beban Tim terbuka (boolean, bawaan false — disimpan/divalidasi seperti crit).
// 1c-2 P2 (a): "bl:<page>" = baseline aktif yang DITAMPILKAN (0 = "Tidak ada", 1–3 = slot) per perangkat per halaman —
// pilihan tampilan, tidak pernah ditulis ke record.
// bl:<page> dilipat A–Z → a–z (ASCII saja, sama dengan NOCASE SQLite host: halaman proj_<nama kanonik> dan
// task.project yang beda kapital = satu kunci) — satu tempat untuk view DAN seksi (fix T7 1c-2). Jenis lain apa adanya.
function prefKey(kind, page) {
  if (kind === "section") return "section:open";
  if (kind === "bl") return "bl:" + String(page).replace(/[A-Z]/g, c => c.toLowerCase());
  return kind + ":" + page;
}

// Nilai dari api.storage → nilai sah, atau bawaan bila rusak/tidak ada.
function cleanPref(kind, value) {
  const choices = PREF_CHOICES[kind];
  if (choices) return choices.indexOf(value) >= 0 ? value : PREF_DEFAULTS[kind];
  return value === true;
}

// ── 4. Komponen ─────────────────────────────────────────────────────────────
// 4a. Konstanta tampilan + teks UI persis (Global Constraints).
const HEAD_H = 48; // dua baris header skala waktu (24 + 24)
const VIEW_W0 = 1000; // lebar grafik tampak sebelum diukur
const VIEW_H0 = 600; // tinggi area baris tampak sebelum diukur
const MIN_BOX_H = 360; // R11: tinggi wadah minimal
const BOX_GAP = 16; // R11: jarak bawah wadah ke tepi jendela
const BAR_H = 16;
const SUM_H = 8;
const MS_SIZE = 12; // milestone belah ketupat 12 px
const MQ_NARROW = "(max-width: 640px)";
const MQ_COARSE = "(pointer: coarse)";
const ZOOMS = [["day", "Hari"], ["week", "Minggu"], ["month", "Bulan"]];
const LBL = {
  today: "Hari ini",
  calendar: "Kalender kerja",
  sort: "Urutkan menurut Mulai",
  cols: "Kolom",
  gantt: "Gantt",
  list: "Daftar",
  zoom: "Skala waktu",
  mode: "Tampilan",
  crit: "Jalur kritis",
  auto: "Jadwal otomatis",
  reschedule: "Jadwalkan ulang",
  more: "Lainnya",
  // 1c-1 R23
  bl: "Baseline",
  blSave: "Simpan baseline",
  // 1c-2 §7.1
  load: "Beban Tim",
  // 1d-1 §7.1 (R10)
  export: "Ekspor ke Microsoft Project (.xml)" // 1d-2 §7.1, §7.7 (R6): item menu "Lainnya"
};
// 1d-2 Task 5 (R5, Q7 (a); spec §7.5, §7.7): ekspor MSPDI (teks persis).
const MSG_EXPORT_FAIL = "Ekspor gagal";
const MSG_EXPORT_NATIVE = "Ekspor tersedia di alurik.com lewat browser";
const EXPORT_MIME = "application/xml";
const EXPORT_TITLE = "Timeline"; // R9: judul cadangan (halaman tanpa nama / host lama tanpa context.listName)
// "Berkas {nama} diunduh" + " · {n} task tanpa jadwal ditandai perkiraan" (stats.unscheduled > 0) + " · {k} tautan
// dilewati" (stats.skippedLinks > 0) — stats = keluaran TLMspdi.build.
function exportDoneText(name, stats) {
  const s = stats && typeof stats === "object" ? stats : {};
  let out = "Berkas " + name + " diunduh";
  if (Number.isInteger(s.unscheduled) && s.unscheduled > 0) out += " · " + s.unscheduled + " task tanpa jadwal ditandai perkiraan";
  if (Number.isInteger(s.skippedLinks) && s.skippedLinks > 0) out += " · " + s.skippedLinks + " tautan dilewati";
  return out;
}
// 1c-1 R14, R15, R28: sakelar Jadwal otomatis dan dialog pratinjau (teks persis).
const MSG_AUTO_ON0 = "Jadwal otomatis menyala — tidak ada task yang bergeser";
const MSG_AUTO_OFF = "Jadwal otomatis dimatikan — tanggal tetap seperti sekarang";
const MSG_PV_ON = "Nyalakan jadwal otomatis — "; // + nama project
const MSG_STALE = "Data berubah sejak pratinjau dibuka — hitung ulang";
const MSG_UNITS_WAIT = "Menunggu data jadwal workspace…";
const MSG_OFFLINE = "Kamu sedang offline — jadwal dihitung dari data di perangkat ini";
const MSG_BY = "Dinyalakan oleh ";
const MSG_BY_OTHER = "Dinyalakan oleh anggota lain";
const MSG_NO_PROJECT = "(Tanpa project)";
const PV_APPLY = "Terapkan";
const PV_CANCEL = "Batal";
const PV_SHOW_ALL = "Tampilkan semua";
const PV_NOT_MOVED = "Tidak dipindah";
const PV_NEW = "baru dijadwalkan";
const PV_DUR = "durasi berubah";
const PV_DUR_GUESS = "durasi belum diisi, dianggap 1 hari kerja";
const PV_WHY = "Kenapa dijadwalkan di sini?";
// Model kosong (hitung ulang tanpa item): tanpa Selesai project / lewat tenggat lama di ringkasan.
const EMPTY_PV_MODEL = Object.freeze({
  rows: [],
  moved: 0,
  endBefore: null,
  endAfter: null,
  endDelta: null,
  late: 0,
  notMoved: [],
  brokenDeps: 0
});
const PV_ROWS_MAX = 50; // R14: ≤ 50 baris sebelum "Tampilkan semua"
const appliedText = n => "Jadwal diterapkan · " + n + " task";
// 1c-1 R12, R13 (K32, K33): aliran gestur di Gantt (teks persis).
const flowText = n => "Jadwal diubah · " + n + " task ikut bergeser";
const MSG_EARLY = "Tidak bisa lebih awal dari dependensinya";
const PV_FLOW = "Tinjau jadwal otomatis"; // judul pratinjau aliran gestur > 20 turunan (teks §7.6 yang ada)
const partialText = (k, n) => "Sebagian jadwal gagal disimpan (" + k + " dari " + n + ")"; // k = item yang gagal
// 1c-1 R16, R17 (K35, K36): banner drift/lingkaran, Tinjau, Jadwalkan ulang (teks persis).
const driftText = n => "Jadwal otomatis belum mutakhir: " + n + " task berbeda dari hasil hitung.";
const BANNER_REVIEW = "Tinjau";
const BANNER_OPEN = "Buka";
const BANNER_NAMES_MAX = 3; // R16: ≤ 3 judul + "dan {n} lainnya"
const PV_RESCHED = "Jadwalkan ulang yang belum selesai";
const brokenText = n => n + " dependensi akan dilanggar";
const MSG_EMPTY = "Belum ada task di halaman ini";
// Kalender kerja (R18) dan Daftar HP (R20): teks persis.
const MSG_CAL_NOTE = "Dipakai semua anggota workspace";
const MSG_PENDING = "Menunggu sinkron";
const MSG_CAL_WAIT = "Menunggu data kalender workspace…";
const MSG_CAL_SAVE_FAIL = "Kalender gagal disimpan";
const MSG_CAL_LOAD_FAIL = "Kalender gagal dimuat";
const MSG_DATE_NEED = "Pilih tanggal dulu";
const MSG_DATE_DUP = "Tanggal ini sudah ada";
const MSG_LIST_FULL = "Daftar sudah penuh (366 tanggal)";
const MSG_NO_NAME = "(tanpa nama)";
const MSG_UNSCHEDULED = "Belum dijadwalkan";
const MSG_LATE = "Lewat tenggat";
const MSG_MANUAL = "Manual"; // 1c-1 R19: pin task Manual di unit otomatis
// 1c-2 Task 5 (§7.6): pemilih Baseline + dialog Simpan baseline. "Project"/"Nama"/"Timpa"/"{nama} disimpan" bukan string
// §7.6 (dicatat). Fix review T5 (ruling koordinator): teks STALE + gagal-simpan baseline sendiri, dan hapus baseline
// ("Hapus", "Hapus {nama} (disimpan {tanggal})?", "{nama} dihapus") — dicatat untuk ADR T11/R28.
const MSG_BL_STALE = "Data berubah sejak dialog dibuka — muat ulang";
const MSG_BL_SAVE_FAIL = "Baseline gagal disimpan";
const MSG_BL_DEL_FAIL = "Baseline gagal dihapus";
const BL_DELETE = "Hapus";
const blDeleteText = (name, date) => "Hapus " + name + (date ? " (disimpan " + date + ")" : "") + "?";
const blRemovedText = name => name + " dihapus";
const BL_NONE = "Tidak ada";
const BL_NAME_MAX = 40; // spec §4: name ≤ 40
const MSG_BL_FOREIGN = "(versi lebih baru)"; // slot berisi record asing (klien lebih baru) — ruling T4
const BL_OVERWRITE = "Timpa";
const BL_UNIT_LABEL = "Project";
const BL_NAME_LABEL = "Nama";
const blSlotName = n => "Baseline " + n;
const blConfirmText = (name, date) => "Timpa " + name + (date ? " (disimpan " + date + ")" : "") + "?";
const blSavedText = name => name + " disimpan";
const CAL_MAX_NAME = 60; // sama dengan TLCal.normalize
const CAL_MAX_ENTRIES = 366;
const DAYS = [["Sen", "Senin"], ["Sel", "Selasa"], ["Rab", "Rabu"], ["Kam", "Kamis"], ["Jum", "Jumat"], ["Sab", "Sabtu"], ["Min", "Minggu"]];
const MSG_VIOLATION = "Mulai sebelum dependensi selesai";
const MSG_SCHEDULE_HINT = "Klik untuk menjadwalkan";
// Interaksi (R13–R15, R21): teks persis.
const MSG_CHANGED = "Jadwal diubah";
const MSG_UNDO = "Urungkan";
const MSG_SAVE_FAIL = "Jadwal gagal disimpan";
const MSG_CYCLE = "Dependensi ini membuat lingkaran";
const MSG_MAX_DEPS = "Maksimal 20 dependensi per task";
const MSG_SUMMARY_DEP = "Ringkasan tidak bisa diberi dependensi di versi ini";
const MSG_DUP_DEP = "Dependensi ini sudah ada";
// Seret/Alt+panah/klik-jadwalkan pada task yang ternyata induk (anaknya tersembunyi filter panel) → teks seksi yang sama.
const MSG_SUMMARY_SCHED = "Jadwal task ini mengikuti subtask-nya";
// Alasan penolakan TLSched.canLink → toast. self/scope tidak bertoast: diri sendiri tidak ada yang perlu ditulis,
// scope tidak bisa terjadi di view (kedua ujung adalah baris halaman ini).
const LINK_MSG = {
  cycle: MSG_CYCLE,
  max: MSG_MAX_DEPS,
  summary: MSG_SUMMARY_DEP,
  dup: MSG_DUP_DEP
};
const DOUBLE_TAP_MS = 400; // R21 sentuh: ketuk ganda
const DOUBLE_TAP_PX = 24;
const LEGEND = [["task", "Task"], ["done", "Selesai"], ["late", "Lewat tenggat"], ["summary", "Ringkasan"], ["milestone", "Milestone"], ["flag", "Tenggat"], ["holiday", "Libur"], ["dep", "Dependensi"]];
// Kolom tabel (spec §8.5 butir 5). Sempit (≤ 640 px) / Live Edit: hanya WBS + Nama (160 px) kecuali "Kolom" ON (R20).
const COLS_FULL = [{
  id: "wbs",
  label: "WBS",
  w: 56
}, {
  id: "name",
  label: "Nama",
  w: 220
}, {
  id: "start",
  label: "Mulai",
  w: 92
}, {
  id: "dur",
  label: "Dur",
  w: 56
}, {
  id: "pomo",
  label: "🍅",
  w: 52
}, {
  id: "pct",
  label: "%",
  w: 56
}, {
  id: "slack",
  label: "Slack",
  w: 56
} // 1c-1 R18: hanya di COLS_FULL (ringkas: lewat "Kolom")
];
const COLS_COMPACT = [{
  id: "wbs",
  label: "WBS",
  w: 48
}, {
  id: "name",
  label: "Nama",
  w: 160
}];
function missingYearsNote(years) {
  return "Libur nasional " + years.join(", ") + " belum ada di Alurik versi ini.";
}

// Tata letak lewat objek yang bisa diganti tes (TLLayout beku; tes R24 memata-matai jumlah panggilan).
// Satu pintu ke mesin murni (spy di tes): tata letak (R24) dan CPM (1c-1 R7; dipanggil hanya dari useEngine).
// explain (1c-1 R21, Task 12): hanya saat "Kenapa dijadwalkan di sini?" dibuka — kalender + readExt = masukan run.
// load (1d-1 R10): TLLoad.run, dipanggil hanya dari useLoad (panel Beban Tim terbuka + mesin siap).
// ev (1d-2 R1, R2, R10): TLLoad.ev, dipanggil hanya dari memo ringkasan EV view (baseline aktif + mesin siap).
// mspdi (1d-2 R5, R10): TLMspdi.build, dipanggil hanya dari handler item menu "Ekspor ke Microsoft Project (.xml)".
const engine = {
  layout: args => TLLayout.layout(args),
  run: ctx => TLCpm.run(ctx),
  explain: (result, key, cal, readExt) => TLCpm.explain(result, key, cal, readExt),
  load: input => TLLoad.run(input),
  ev: (bl, ctx, D) => TLLoad.ev(bl, ctx, D),
  mspdi: input => TLMspdi.build(input)
};
const DEFAULT_CAL_DATA = TLCal.normalize(TLCal.DEFAULT_CAL);

// 4b. Pembantu murni.
function cx() {
  let out = "";
  for (let i = 0; i < arguments.length; i++) if (arguments[i]) out += (out ? " " : "") + arguments[i];
  return out;
}
function logWarn(api, msg, err) {
  try {
    api.log.warn(msg, err);
  } catch (e) {/* log tidak tersedia */}
}
function safeToday(api) {
  try {
    const t = api.env.today();
    return typeof t === "string" && TLCal.isIso(t) ? t : null;
  } catch (e) {
    return null;
  }
}
function pomoText(t) {
  const done = Number(t.pomodoros_done) || 0;
  const est = Number(t.estimated_pomodoros) || 0;
  return done || est ? done + "/" + est : "—";
}

// Teks Slack (1c-1 R18): 0 → "0" (juga −0), n > 0 → "{n} hk", n < 0 → "−{|n|} hk" (minus U+2212); selesai / tak terhitung /
// bukan simpul / mesin belum siap (null, undefined, bukan angka hingga) → "—".
function slackText(n) {
  if (typeof n !== "number" || !Number.isFinite(n)) return "—";
  if (n === 0) return "0";
  return n > 0 ? n + " hk" : "\u2212" + -n + " hk";
}

// Isi sel tabel satu baris: {wbs, name, start, dur, pomo, pct, slack}. slack = nilai overlay mesin (undefined = "—").
// Selisih hari kerja bertanda: "+2 hk", "−1 hk" (minus U+2212), "0 hk".
function signedHk(n) {
  if (!Number.isFinite(n) || n === 0) return "0 hk";
  return (n > 0 ? "+" : "−") + Math.abs(n) + " hk";
}

// ISO "YYYY-MM-DD" (atau bilangan hari) → "Kam 5 Nov"; tidak sah → "—".
function dayText(v) {
  const d = typeof v === "number" ? v : typeof v === "string" ? TLCal.dn(v) : NaN;
  return Number.isInteger(d) ? TLCal.fmtShort(d) : "—";
}

// Ringkasan kanan toolbar (R23): Selesai = maks groupEnd unit halaman; lewat tenggat = simpul halaman yang belum
// selesai dengan late > 0. Murni; null bila mesin belum siap.
function toolbarSummary(lay, result) {
  if (!result || !(result.nodes instanceof Map) || !(result.groupEnd instanceof Map)) return null;
  const gs = new Set();
  let late = 0;
  for (const r of lay.rows) {
    if (!r.task) continue;
    const n = result.nodes.get(r.key);
    gs.add(n ? n.g : TLSched.unitOf(r.task).recId);
    if (n && n.late > 0 && n.fixed !== "done") late++;
  }
  let end = null;
  for (const g of gs) {
    const e = result.groupEnd.get(g);
    if (Number.isInteger(e) && (end === null || e > end)) end = e;
  }
  return {
    end,
    late
  };
}

// Unit jadwal halaman (R15): halaman project = satu unit (nama project halaman); workspace = satu per kelompok project
// di layout (urutan kelompok; "(Tanpa project)" = unit "-"). rep = task wakil untuk TLSched.unitFor (pagar fold).
function pageUnits(lay, pageKind, projectName, groupNames) {
  if (pageKind !== "workspace") {
    const rep = {
      list_id: null,
      project: projectName === undefined || projectName === null ? "" : String(projectName)
    };
    return [{
      unit: TLSched.unitOf(rep),
      rep,
      label: rep.project.trim() || MSG_NO_PROJECT
    }];
  }
  const out = [];
  const seen = new Set();
  for (const r of lay.rows) {
    if (!r.task) continue;
    const unit = TLSched.unitOf(r.task);
    if (seen.has(unit.recId)) continue;
    seen.add(unit.recId);
    out.push({
      unit,
      rep: r.task,
      label: groupNames.get(r.group) || unit.name.trim() || MSG_NO_PROJECT
    });
  }
  return out;
}

// "Dinyalakan oleh {nama} · {tgl Jakarta}" (R15): by = pengguna aktif → currentUser; selain itu collaborators;
// tidak ditemukan → "Dinyalakan oleh anggota lain". Tanggal = updated_at record di zona Asia/Jakarta (TLCpm.jkt).
function unitCaption(u, context, userId) {
  if (!u || u.auto !== true) return null;
  const name = actorName(u.by, context, userId);
  const head = name ? MSG_BY + name : MSG_BY_OTHER;
  return head + jktDateSuffix(u.updatedAt);
}

// Nama pelaku `by` (pola unitCaption, dipakai juga keterangan editor kapasitas T7): by = pengguna aktif → currentUser;
// selain itu collaborators (id dibandingkan sebagai string); display_name || username, dipangkas; tidak ditemukan → "".
function actorName(by, context, userId) {
  if (by === null || by === undefined) return "";
  const c = context && typeof context === "object" ? context : {};
  const id = String(by);
  const users = [];
  if (userId !== undefined && userId !== null && String(userId) === id) users.push(c.currentUser);
  for (const x of Array.isArray(c.collaborators) ? c.collaborators : []) users.push(x);
  const hit = users.find(x => x && typeof x === "object" && x.id !== undefined && x.id !== null && String(x.id) === id);
  return hit ? String(hit.display_name || hit.username || "").trim() : "";
}

// " · {tgl}" dari stempel waktu record (tanggal Asia/Jakarta lewat TLCpm.jkt + TLCal.fmtShort); tak terbaca → "".
function jktDateSuffix(updatedAt) {
  const d = typeof updatedAt === "string" ? TLCpm.jkt(updatedAt) : null;
  return Number.isInteger(d) ? " · " + TLCal.fmtShort(d) : "";
}
const NO_PEOPLE = Object.freeze([]);
const memberName = uid => "Anggota #" + uid;

// Nama orang (pola unitCaption; dipakai peopleOf 1d-1 dan ekspor 1d-2 R5): peopleNames({currentUser, collaborators,
// userId}) → Map<uid, nama>: collaborators (uid pertama menang), lalu pengguna aktif → currentUser bila id-nya = userId;
// display_name || username dipangkas ("" bila kosong — pemakai menggantinya dengan "Anggota #{uid}"). Murni.
function peopleNames(o) {
  const x = o && typeof o === "object" ? o : {};
  const me = TLLoad.uidOf(x.userId);
  const nameOf = v => v && typeof v === "object" ? String(v.display_name || v.username || "").trim() : "";
  const names = new Map();
  for (const c of Array.isArray(x.collaborators) ? x.collaborators : []) {
    const u = c && typeof c === "object" ? TLLoad.uidOf(c.id) : null;
    if (u !== null && !names.has(u)) names.set(u, nameOf(c));
  }
  const cu = x.currentUser && typeof x.currentUser === "object" ? x.currentUser : null;
  if (me !== null && cu && TLLoad.uidOf(cu.id) === me) names.set(me, nameOf(cu));
  return names;
}

// Judul ekspor (1d-2 R9, P2 (a)): halaman project = context.projectName; halaman workspace = context.listName (nama
// workspace dari host, P2 (a)); kosong / absen (host lama) → "Timeline". Dipangkas. Murni.
function exportTitle(pageKind, context) {
  const c = context && typeof context === "object" ? context : {};
  const raw = pageKind === "workspace" ? c.listName : c.projectName;
  const s = typeof raw === "string" ? raw.trim() : "";
  return s || EXPORT_TITLE;
}

// Baris orang panel Beban Tim (1d-1 R4, P2 (a); tanpa perubahan host — plugin tidak bisa membaca anggota workspace, F5):
// peopleOf({byAssignee, ctxTasks, resources, currentUser, collaborators, userId}) → [{uid, name, res}], urut uid naik
// (deterministik; TLLoad.run sendiri mengurutkan baris menurut nama). uid lewat TLLoad.uidOf (userId host bisa string
// JWT `sub`).
//   byAssignee (halaman workspace): pengguna aktif ∪ penanggung jawab task di ctxTasks (= eng.ctx.tasks, daftar lengkap
//   halaman) yang hidup, belum selesai, dan tidak berulang (predikat TLLoad.isLive/isDone = cpm.js) ∪ uid pemilik record
//   `resource` halaman (kunci `resources` = useResources().map). Pribadi: satu baris pengguna aktif.
//   Nama (pola unitCaption): pengguna aktif → currentUser (id cocok), lainnya → collaborators; display_name || username;
//   tidak ditemukan / kosong → "Anggota #{uid}". res = resources.get(uid).res (terdekode), selain itu null (bawaan).
function peopleOf(o) {
  const x = o && typeof o === "object" ? o : {};
  const me = TLLoad.uidOf(x.userId);
  const resources = x.resources instanceof Map ? x.resources : EMPTY_RES;
  const uids = new Set();
  if (me !== null) uids.add(me);
  if (x.byAssignee === true) {
    for (const t of Array.isArray(x.ctxTasks) ? x.ctxTasks : []) {
      if (!t || typeof t !== "object" || !TLLoad.isLive(t) || TLLoad.isDone(t) || t.recurrence_type) continue;
      const u = TLLoad.uidOf(t.assigned_to);
      if (u !== null) uids.add(u);
    }
    for (const k of resources.keys()) {
      const u = TLLoad.uidOf(k);
      if (u !== null) uids.add(u);
    }
  }
  const names = peopleNames(x);
  const out = [];
  for (const uid of [...uids].sort((a, b) => a - b)) {
    const ent = resources.get(uid);
    out.push({
      uid,
      name: names.get(uid) || memberName(uid),
      res: ent && ent.res ? ent.res : null
    });
  }
  return out;
}

// Model dialog = TLPlan.preview + WBS/judul untuk tampilan (rows: wbs; notMoved: task + wbs). Murni.
function dialogModel(pm, result, wbsOf) {
  const nodes = result && result.nodes instanceof Map ? result.nodes : new Map();
  return Object.assign({}, pm, {
    rows: pm.rows.map(r => Object.assign({}, r, {
      wbs: wbsOf(r.key)
    })),
    notMoved: pm.notMoved.map(x => {
      const n = nodes.get(x.key);
      return Object.assign({}, x, {
        task: n ? n.task : null,
        wbs: wbsOf(x.key)
      });
    })
  });
}

// "Kenapa dijadwalkan di sini?" per baris PreviewDialog (R14 + R21; Task 12 fix): whyOf(key) atas hasil mesin yang SAMA
// dengan baris dialog (hasil sesudah rencana) dan kalender ctx yang dipakai run-nya. readExt = ext ctx + patch item rencana
// (acuan root/SNET explain = nilai sesudah Terapkan). explain hanya dipanggil saat baris dibuka (pemanggil: PreviewDialog).
function planWhy(result, ctx, items, wbsOf) {
  const patches = new Map((Array.isArray(items) ? items : []).map(it => [it.key, it.patch]));
  const readExt = t => {
    let raw = {};
    try {
      raw = typeof ctx.readExt === "function" ? ctx.readExt(t) : {};
    } catch (e) {
      raw = {};
    }
    const r = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
    const p = t && t.id !== undefined && t.id !== null ? patches.get(String(t.id)) : undefined;
    return p ? applyRaw(r, p) : r;
  };
  return key => {
    const k = String(key);
    const n = result && result.nodes instanceof Map ? result.nodes.get(k) : null;
    const titleOf = x => {
      const m = result && result.nodes instanceof Map ? result.nodes.get(String(x)) : null;
      return taskTitle(m ? m.task : null);
    };
    const label = x => {
      const w = wbsOf(String(x));
      return (w ? w + " " : "") + titleOf(x);
    };
    const ex = engine.explain(result, k, ctx.cal, readExt);
    return whyText(ex, {
      label,
      title: titleOf,
      d: n ? n.d : undefined
    });
  };
}

// Banner R16 (murni): drift = kunci result.drift yang ada di scopeTasks halaman (task tersaring panel tidak dihitung
// walau ikut scope mesin); first = anggota lingkaran pertama di halaman (cadangan cycle[0]); cycle = anggota lingkaran yang menyentuh halaman (seluruh anggota lingkaran itu, urutan
// result.cycles). Teks lingkaran: ≤ 3 judul + " dan {n} lainnya".
function bannerInfo(result, scopeTasks) {
  if (!result || !(result.nodes instanceof Map)) return {
    drift: [],
    cycle: [],
    first: null,
    cycleText: ""
  };
  const page = new Set();
  for (const t of Array.isArray(scopeTasks) ? scopeTasks : []) if (t && t.id !== undefined && t.id !== null) page.add(String(t.id));
  const drift = result.drift instanceof Set ? [...result.drift].filter(k => page.has(k)) : [];
  const cycle = [];
  let first = null; // "Buka" (R16): anggota pertama yang ADA di halaman; tidak ada → anggota pertama
  for (const c of Array.isArray(result.cycles) ? result.cycles : []) {
    if (!c.some(k => page.has(k))) continue;
    for (const k of c) {
      const n = result.nodes.get(k);
      if (!n || !n.task) continue;
      cycle.push(n.task);
      if (first === null && page.has(k)) first = n.task;
    }
  }
  const names = cycle.slice(0, BANNER_NAMES_MAX).map(taskTitle).join(", ");
  const rest = cycle.length - BANNER_NAMES_MAX;
  const cycleText = cycle.length ? "Dependensi melingkar: " + names + (rest > 0 ? " dan " + rest + " lainnya" : "") + " — tidak dihitung" : "";
  return {
    drift,
    cycle,
    first: first || cycle[0] || null,
    cycleText
  };
}

// Tutup banner per sesi (R16): Set tingkat modul berkunci page + jenis + n — bertahan saat view dipasang ulang, tampil
// lagi bila jumlahnya berubah. Hanya memori tampilan (tidak pernah disimpan / ditulis).
const BANNER_CLOSED = new Set();
const bannerKey = (page, kind, n) => page + "\u0000" + kind + "\u0000" + n;

// Daftar lengkap → task di scope dependensi halaman (saringan sama dengan useEngine).
function scopeFilter(list, scopeTasks) {
  const keys = new Set((Array.isArray(scopeTasks) ? scopeTasks : []).map(TLSched.scopeKeyOf));
  return (Array.isArray(list) ? list : []).filter(t => !!t && typeof t === "object" && keys.has(TLSched.scopeKeyOf(t)));
}

// Potret CAS unit (R14): updatedAt/by record dari useUnits().units (BUKAN eng.ctx.units — memo mesin hanya berkunci auto+fold).
function unitSnap(u) {
  return {
    updatedAt: u && typeof u.updatedAt === "string" ? u.updatedAt : null,
    by: u && u.by !== undefined ? u.by : null
  };
}
function sameSnap(a, b) {
  return a.updatedAt === b.updatedAt && a.by === b.by;
}
// CAS unit pv (R14; T8 satu unit, T10 daftar): pv.unit = entri `{rep, snap}` atau daftar entri `{rep, snap, auto?}`.
// Setiap entri cocok bila potret updatedAt/by record terbaru sama dan — bila `auto` (boolean) dicatat — mode otomatis
// unit terbaru sama dengan mode yang dipakai rencana. Tanpa entri → selalu cocok.
const pvUnitList = u => !u ? [] : Array.isArray(u) ? u : [u];
const unitAuto = u => !!(u && u.auto === true);
function unitsStillOk(unitField, units) {
  return pvUnitList(unitField).every(x => {
    const u = TLSched.unitFor(units, x.rep);
    return sameSnap(x.snap, unitSnap(u)) && (typeof x.auto !== "boolean" || x.auto === unitAuto(u));
  });
}

// JSON kanonik (urutan kunci objek tidak relevan; undefined = null) — pembanding nilai ext.
function canonJson(v) {
  if (v === undefined || v === null) return "null";
  if (Array.isArray(v)) return "[" + v.map(canonJson).join(",") + "]";
  if (typeof v === "object") return "{" + Object.keys(v).sort().map(k => JSON.stringify(k) + ":" + canonJson(v[k])).join(",") + "}";
  return JSON.stringify(v);
}

// Item aliran yang benar-benar mengubah ext (T4: gestur {start: null} pada task otomatis berpendahulu menjadi item
// deltaHk 0 yang menulis nilai tersimpan). Item tanpa kunci berbeda dari `before` (nilai mentah) dibuang: gestur yang
// seluruhnya tanpa efek = diam (tanpa tulis, tanpa toast "Jadwal diubah"; R13 hanya mengenal toast untuk perubahan).
function flowItems(items) {
  return (Array.isArray(items) ? items : []).filter(it => {
    const b = it && it.before && typeof it.before === "object" ? it.before : {};
    return !!it && !!it.patch && Object.keys(it.patch).some(k => canonJson(it.patch[k]) !== canonJson(b[k]));
  });
}
function rowCells(row, groupName, slack) {
  if (row.kind === "group") return {
    wbs: row.wbs,
    name: groupName || "",
    start: "",
    dur: "",
    pomo: "",
    pct: "",
    slack: ""
  };
  const t = row.task;
  const title = t.title !== undefined && t.title !== null && String(t.title).trim() ? String(t.title).trim() : "Tanpa judul";
  return {
    wbs: row.wbs,
    name: title,
    start: row.span ? TLCal.fmtShort(row.span.s) : "—",
    dur: row.duration === null || row.duration === undefined ? "—" : row.duration + " hk",
    pomo: pomoText(t),
    pct: Math.round(row.progress) + "%",
    slack: slackText(slack)
  };
}

// Overlay mesin di atas tata letak (1c-1 R18, R19) — murni, TIDAK mengubah `lay`. Dihitung dalam memo terpisah
// [lay, result] sehingga mesin selesai / sakelar Jalur kritis tidak menghitung ulang tata letak (R24).
//   slack: Map<rowKey, number|null> — task = node.slack; ringkasan = min slack anak (baris halaman, rekursif); lainnya null
//   crit: Set<rowKey> — node.critical (slack ≤ 0 ∧ bukan selesai); critEdge: Set<"from>to"> — kedua ujung kritis DAN from = driver.from simpul tujuan (sisi pengarah)
//   conflictEdge: Set<"from>to"> — sisi terpakai ke jangkar ber-`conflict` yang depReq-nya dilanggar (merah putus-putus)
//   manual: Set<rowKey> — fixed "manual" di unit otomatis (pin "Manual")
// result null (mesin belum siap / gagal) → NO_OVERLAY: semua "—", tanpa kritis/pin/konflik (tampilan 1b).
const NO_OVERLAY = Object.freeze({
  ready: false,
  slack: new Map(),
  crit: new Set(),
  critEdge: new Set(),
  conflictEdge: new Set(),
  manual: new Set()
});
function engineOverlay(lay, result, ctx) {
  if (!lay || !result || !(result.nodes instanceof Map)) return NO_OVERLAY;
  const nodes = result.nodes;
  const slack = new Map();
  const crit = new Set();
  const manual = new Set();
  const minOf = new Map(); // kunci ringkasan → min slack anak
  const units = ctx && ctx.units instanceof Map ? ctx.units : null;
  // pra-urut (induk sebelum turunan) dibalik → anak selalu selesai sebelum induknya
  for (let i = lay.rows.length - 1; i >= 0; i--) {
    const r = lay.rows[i];
    if (r.kind === "group") continue;
    let v = null;
    if (r.kind === "summary") v = minOf.has(r.key) ? minOf.get(r.key) : null;else {
      const n = nodes.get(r.key);
      if (n) {
        v = typeof n.slack === "number" && Number.isFinite(n.slack) ? n.slack : null;
        if (n.critical === true) crit.add(r.key);
        if (n.fixed === "manual" && units) {
          const u = TLSched.unitFor(units, r.task);
          if (u && u.auto === true) manual.add(r.key);
        }
      }
    }
    slack.set(r.key, v);
    if (v !== null && r.parentKey !== null) {
      const cur = minOf.get(r.parentKey);
      if (cur === undefined || v < cur) minOf.set(r.parentKey, v);
    }
  }
  const critEdge = new Set();
  const conflictEdge = new Set();
  const cal = ctx ? ctx.cal : null;
  const preds = result.pred instanceof Map ? result.pred : null;
  for (const e of lay.edges) {
    const id = e.from + ">" + e.to;
    const sn = nodes.get(e.to);
    // 1c-2 T9 (penajaman R18): hanya sisi PENGARAH (driver.from simpul tujuan) antara dua simpul kritis.
    if (crit.has(e.from) && crit.has(e.to) && sn && sn.driver && sn.driver.kind === "pred" && sn.driver.from === e.from) critEdge.add(id);
    const pn = nodes.get(e.from);
    if (!cal || !preds || !sn || !sn.conflict || !pn || pn.es === null || sn.es === null) continue;
    const used = (preds.get(e.to) || []).find(p => p.key === e.from); // hanya sisi yang dipakai mesin
    if (!used) continue;
    const req = TLSched.depReq(cal, used.type, pn.es, pn.ef, used.lag, sn.d);
    if (TLSched.isEarly(cal, sn.es, req)) conflictEdge.add(id);
  }
  return {
    ready: true,
    slack,
    crit,
    critEdge,
    conflictEdge,
    manual
  };
}

// 1c-2 Task 6 (§7.4, K41): overlay baseline — murni, TIDAK mengubah `lay`; memo terpisah [blDec, engResult] sehingga
// memilih baseline (pref) tidak menghitung ulang tata letak. Keluaran: null (Tidak ada / mesin belum siap) atau
// Map<rowKey, {s, f, d, ds, df, dd}>: s/f = dn baseline, d = durasi baseline (hk); ds/df/dd = compareBaseline.perTask
// (df = selisih SELESAI sekarang vs baseline, hk, positif = tergelincir — bar/tooltip T6; tabel seksi T7 memakai ketiganya). Baris baseline yang tidak terpecahkan ke simpul mesin (terhapus, di luar scope, tanpa Mulai)
// dilewati; dua ref ke task yang sama → yang pertama dalam urutan cmpKey (aturan compareBaseline). rows.size 0 → Map kosong.
function baselineOverlay(dec, result, ctx) {
  if (!dec || !(dec.rows instanceof Map) || !result || !(result.nodes instanceof Map) || !ctx) return null;
  const out = new Map();
  if (dec.rows.size === 0) return out;
  const cmp = TLPlan.compareBaseline(result, dec, ctx);
  const idx = TLSched.buildIndex(Array.isArray(ctx.tasks) ? ctx.tasks : []);
  for (const rk of [...dec.rows.keys()].sort(TLCpm.cmpKey)) {
    const t = idx.get(rk);
    const key = t ? String(t.id) : rk;
    const d = cmp.perTask.get(key);
    if (!d || out.has(key)) continue;
    const b = dec.rows.get(rk);
    out.set(key, {
      s: b.s,
      f: b.f,
      d: b.d,
      ds: d.ds,
      df: d.df,
      dd: d.dd
    });
  }
  return out;
}

// 1c-2 Task 6 (§7.4, K42, Review Focus 5): garis aktual per baris task — Map<rowKey, {s, f}> (dn). Aktual dibaca HANYA
// lewat TLSched.actualOf. s = mulai aktual; f = selesai aktual (tersimpan, atau turunan jkt(completed_at)); tanpa itu:
// belum selesai → HARI INI (todayDn; ikut env.today tanpa tulisan), selesai tanpa completed_at → akhir rentang baris.
// Tanpa actual.start → tanpa garis. Ringkasan tidak mendapat garis.
function actualOverlay(lay, readExt, todayDn) {
  const out = new Map();
  if (!lay) return out;
  for (const r of lay.rows) {
    if (r.kind !== "task" || !r.task) continue;
    const a = TLSched.actualOf(r.task, readExt(r.task));
    if (a.start === null) continue;
    let f = a.finish;
    if (f === null) {
      if (r.done) f = r.span ? r.span.f : a.start;else if (todayDn !== null) f = todayDn;else continue;
    }
    out.set(r.key, {
      s: a.start,
      f: Math.max(a.start, f)
    });
  }
  return out;
}

// Teks bar baseline (§7.4): "Baseline: {fmtShort(s)} → {fmtShort(f)} ({±df} hk)".
function baselineTip(b) {
  return "Baseline: " + TLCal.fmtShort(b.s) + " → " + TLCal.fmtShort(b.f) + " (" + signedHk(b.df) + ")";
}

// Rentang hari inklusif [s, f] → {x, w} px, dipangkas ke rentang tata letak; seluruhnya di luar → null. Memakai
// TLLayout.barBox (sched null + kind "task" → selalu bar, bukan milestone) agar geometri sama persis dengan bar.
function spanGeom(s, f, range, px) {
  const box = TLLayout.barBox({
    s,
    f
  }, null, range, px, "task");
  return box ? {
    x: box.x,
    w: box.w
  } : null;
}

// Kotak bar baris (px, relatif awal rentang) atau null: baris outOfRange tidak pernah mendapat bar (Task 4).
function boxOf(row, lay) {
  if (!row.span || row.outOfRange || row.kind === "group") return null;
  const sched = row.kind === "summary" ? {
    duration: row.duration
  } : row.sched;
  return TLLayout.barBox(row.span, sched, lay.range, lay.px, row.kind);
}

// Geometri bar dalam koordinat grafik (sama dengan renderBar): x/top kiri-atas elemen, w/h ukuran.
function barGeom(row, box, rowH) {
  if (box.milestone) return {
    x: box.x - MS_SIZE / 2,
    top: row.index * rowH + (rowH - MS_SIZE) / 2,
    w: MS_SIZE,
    h: MS_SIZE,
    ms: true
  };
  const h = row.kind === "summary" ? SUM_H : BAR_H;
  return {
    x: box.x,
    top: row.index * rowH + (rowH - h) / 2,
    w: box.w,
    h,
    ms: false
  };
}
function translate(x, y) {
  return "translate(" + x + "px," + y + "px)";
}
function nowMs() {
  return typeof performance !== "undefined" && performance && typeof performance.now === "function" ? performance.now() : Date.now();
}
function toastSafe(api, msg, type, action) {
  try {
    if (action) api.ui.toast(msg, type, action);else api.ui.toast(msg, type);
  } catch (e) {
    logWarn(api, "toast gagal:", e);
  }
}

// Jendela baris diperbarui per kuantum ROW_STEP baris (Task 13, perf), bukan tiap baris: tiap pergeseran jendela
// melepas/menyisipkan anak di awal daftar saudara, dan aturan posisi host (mis. `:nth-child` universal di app.css)
// membuat Chromium menghitung ulang gaya semua saudara. Kuantum 8 → ~8× lebih sedikit rekalkulasi saat gulir vertikal;
// jendela diperlebar ROW_STEP baris ke bawah agar tetap menutup layar.
const ROW_STEP = 8;
function quantTop(top, rowH) {
  const q = Math.max(1, rowH * ROW_STEP);
  return Math.floor(Math.max(0, top) / q) * q;
}
function quantLeft(left, w) {
  const q = Math.max(1, Math.round(w / 2));
  return Math.floor(Math.max(0, left) / q) * q;
}
function raf(fn) {
  if (typeof requestAnimationFrame === "function") return requestAnimationFrame(fn);
  fn();
  return 0;
}
function caf(id) {
  if (id && typeof cancelAnimationFrame === "function") cancelAnimationFrame(id);
}
function hasWindow() {
  return typeof window !== "undefined" && !!window;
}
function mq(q) {
  try {
    return hasWindow() && typeof window.matchMedia === "function" && !!window.matchMedia(q).matches;
  } catch (e) {
    return false;
  }
}

// 4c. Hooks.
function useMedia(q) {
  const [on, setOn] = React.useState(() => mq(q));
  React.useEffect(() => {
    if (!hasWindow() || typeof window.matchMedia !== "function") return undefined;
    let m = null;
    try {
      m = window.matchMedia(q);
    } catch (e) {
      return undefined;
    }
    const fn = () => setOn(!!m.matches);
    fn();
    if (typeof m.addEventListener === "function") {
      m.addEventListener("change", fn);
      return () => m.removeEventListener("change", fn);
    }
    if (typeof m.addListener === "function") {
      m.addListener(fn);
      return () => m.removeListener(fn);
    }
    return undefined;
  }, [q]);
  return on;
}
function readPref(api, kind, page) {
  return Promise.resolve().then(() => api.storage.get(prefKey(kind, page))).then(v => cleanPref(kind, v), e => {
    logWarn(api, "preferensi " + kind + " gagal dibaca:", e);
    return PREF_DEFAULTS[kind];
  });
}
function writePref(api, kind, page, value) {
  Promise.resolve().then(() => api.storage.set(prefKey(kind, page), value)).catch(e => logWarn(api, "preferensi " + kind + " gagal disimpan:", e));
}

// Preferensi per perangkat (R19): bawaan dulu, lalu nilai api.storage — kecuali pengguna sudah memilih lebih dulu.
function usePref(api, kind, page) {
  const [val, setVal] = React.useState(PREF_DEFAULTS[kind]);
  const picked = React.useRef(false);
  React.useEffect(() => {
    let alive = true;
    picked.current = false;
    readPref(api, kind, page).then(v => {
      if (alive && !picked.current) setVal(v);
    });
    return () => {
      alive = false;
    };
  }, [api, kind, page]);
  const set = React.useCallback(v => {
    picked.current = true;
    setVal(v);
    writePref(api, kind, page, v);
  }, [api, kind, page]);
  return [val, set];
}

// Toast "kalah LWW" (spec §8.9) dari view DAN seksi Jadwal (final review #7: seksi saja juga memberi tahu bila tidak ada
// view Gantt terpasang). Keduanya menerima peristiwa yang sama dalam satu dispatch sinkron → dedupe tingkat modul per id
// kalender selama LOST_TIMING.dedupeMs (view + panel Live Edit bersamaan = satu toast).
const LOST_TIMING = {
  dedupeMs: 1500
};
const lostShown = new Map(); // id kalender → batas akhir dedupe (Infinity = sampai timer melepasnya)
function toastLost(api, calId) {
  const until = lostShown.get(calId);
  if (until !== undefined && nowMs() < until) return;
  if (typeof setTimeout === "function") {
    // timer: dispatch sinkron yang sama selalu terdedupe, juga dengan dedupeMs 0
    lostShown.set(calId, Infinity);
    setTimeout(() => lostShown.delete(calId), Math.max(0, LOST_TIMING.dedupeMs));
  } else lostShown.set(calId, nowMs() + Math.max(1, LOST_TIMING.dedupeMs));
  toastSafe(api, MSG_CAL_LOST, "error");
}

// Kalender aktif halaman (R4/R5): muat lewat calendarStore, muat ulang saat sinkron/perubahan id ini;
// edit lokal yang kalah LWW → toast persis lewat toastLost (dedupe view + seksi).
// `pulled` (final review #2): latch "tarik record plugin dari server SUKSES setidaknya sekali sejak pemasangan ini",
// dinyalakan SETELAH muat ulang sesudah peristiwa `pulled` host selesai. Bukan sync.done (juga menyala saat sinkron gagal)
// dan bukan onChange source "sync" biasa (juga dari ack kirim / tulis ulang ref) — keduanya hanya memuat ulang data.
// Sebelum itu kalender workspace tanpa record lokal mungkin hanya belum ditarik (D5): popover tidak boleh menimpanya.
function useCalendar(api, target) {
  const store = React.useMemo(() => calendarStore(api), [api]);
  const [st, setSt] = React.useState(() => ({
    id: target.id,
    data: DEFAULT_CAL_DATA,
    pending: false
  }));
  const [pulled, setPulled] = React.useState(false);
  React.useEffect(() => {
    let alive = true;
    const id = target.id;
    const load = () => store.load(id).then(r => {
      if (alive) setSt({
        id,
        data: r.data,
        pending: r.pending
      });
      return true;
    }, e => {
      logWarn(api, "kalender gagal dimuat:", e);
      return false;
    });
    load();
    let off = null;
    try {
      off = store.subscribe(ev => {
        if (ev.pulled) {
          load().then(ok => {
            if (ok && alive) setPulled(true);
          });
          return;
        }
        const lost = ev.lost.indexOf(id) >= 0;
        if (lost) toastLost(api, id);
        if (lost || ev.source === "sync" || ev.ids.indexOf(id) >= 0) load();
      });
    } catch (e) {
      logWarn(api, "pendengar kalender gagal:", e);
    }
    return () => {
      alive = false;
      if (typeof off === "function") off();
    };
  }, [store, target.id]);
  const mine = st.id === target.id;
  return {
    data: mine ? st.data : DEFAULT_CAL_DATA,
    pending: mine && st.pending,
    store,
    pulled
  };
}

// Jeda muat ulang bersama useUnits (peristiwa record project) dan useEngine (scopeTasks / sync.done).
const RELOAD_TIMING = {
  debounceMs: 300
};

// Unit jadwal halaman (1c-1 R6; pola useCalendar): muat lewat projectStore (pertama segera saat pasang), muat ulang pada
// perubahan entitas project (debounce RELOAD_TIMING) dan segera pada peristiwa tarik sukses. `pulled` = latch "tarik
// record plugin SUKSES sejak pemasangan ini", dinyalakan SETELAH muat ulang sesudah peristiwa `pulled` selesai (bukan sync.done, yang juga menyala saat sinkron gagal).
// P3 (a): sakelar "Jadwal otomatis" workspace dikunci "Menunggu data jadwal workspace…" selama unitnya tidak `exists`
// dan `pulled` belum menyala (Task 8). `loaded` = muat pertama halaman ini selesai. Hook ini tidak pernah menulis.
// page = {pageKind, listId, projectName}; workspace dimuat per scope list, halaman project per recId unitOf(page).
function unitsPageKey(pageKind, listId, projectName) {
  if (pageKind === "workspace") return "w|" + calTarget(listId).scope;
  return "p|" + TLSched.unitOf({
    pageKind: "project",
    listId: null,
    projectName
  }).recId;
}
function useUnits(api, page) {
  const p = page && typeof page === "object" ? page : {};
  const pageKind = p.pageKind === "workspace" ? "workspace" : "project";
  const key = unitsPageKey(pageKind, p.listId, p.projectName);
  const store = React.useMemo(() => projectStore(api), [api]);
  const [st, setSt] = React.useState(() => ({
    key,
    units: EMPTY_UNITS,
    loaded: false,
    failed: false
  }));
  const [pulled, setPulled] = React.useState(false);
  const argRef = React.useRef(null);
  argRef.current = {
    pageKind,
    listId: pageKind === "workspace" ? p.listId : null,
    projectName: pageKind === "workspace" ? null : p.projectName
  };
  React.useEffect(() => {
    let alive = true;
    let seq = 0;
    let timer = null;
    const arg = argRef.current;
    const load = () => {
      const my = ++seq;
      return store.loadUnits(arg).then(units => {
        if (alive && my === seq) setSt({
          key,
          units,
          loaded: true,
          failed: false
        });
        return true;
      }, e => {
        logWarn(api, "unit jadwal gagal dimuat:", e);
        // `failed` (seksi Jadwal): muat gagal tidak boleh mengunci input selamanya; `loaded`/units tidak berubah.
        if (alive && my === seq) setSt(p => p.key === key ? Object.assign({}, p, {
          failed: true
        }) : {
          key,
          units: EMPTY_UNITS,
          loaded: false,
          failed: true
        });
        return false;
      });
    };
    load();
    let off = null;
    try {
      off = store.subscribe(ev => {
        if (ev.pulled) {
          load().then(ok => {
            if (ok && alive) setPulled(true);
          });
          return;
        }
        // perubahan record project (sinkron bisa memancarkan beruntun) → satu muat ulang setelah jeda
        if (timer !== null) clearTimeout(timer);
        timer = setTimeout(() => {
          timer = null;
          if (alive) load();
        }, RELOAD_TIMING.debounceMs);
      });
    } catch (e) {
      logWarn(api, "pendengar unit jadwal gagal:", e);
    }
    return () => {
      alive = false;
      if (timer !== null) clearTimeout(timer);
      if (typeof off === "function") off();
    };
  }, [store, key]);
  const mine = st.key === key;
  return {
    units: mine ? st.units : EMPTY_UNITS,
    loaded: mine && st.loaded,
    failed: mine && st.failed,
    pulled,
    store
  };
}

// Baseline unit (1c-2 K41; pola useUnits): muat lewat baselineStore.loadAll (pertama segera saat pasang), muat ulang pada
// perubahan entitas baseline (debounce RELOAD_TIMING) dan segera pada peristiwa tarik sukses; `pulled` = latch yang
// sama dengan useUnits (dinyalakan SETELAH muat ulang sesudah peristiwa `pulled` selesai). Hook ini tidak pernah menulis.
// unit = keluaran TLSched.unitOf, atau null (unit belum diketahui → semua slot terkunci).
// Kunci simpan K41 (pola P3 (a)), per slot:
//   waitingOf(n) = unit workspace (scope ≠ "user"), `pulled` belum menyala, dan (sudah termuat dan slot tanpa record
//     lokal — record asing terhitung ADA — ATAU muat gagal sebelum pernah termuat) → UI menampilkan MSG_BL_WAIT
//     ("Menunggu data baseline workspace…"); `waiting` = ada slot yang menunggu.
//   lockedOf(n) = unit null, ATAU sedang memuat (belum loaded dan belum failed; tanpa teks), ATAU waitingOf(n).
//   Project pribadi tidak pernah menunggu (muat gagal → terbuka); workspace gagal-muat terbuka setelah `pulled`
//   (latch menyala walau muat ulangnya gagal) — tidak terkunci selamanya, CAS saveBaseline tetap menjaga.
// snapOf(n) = potret CAS slot untuk dialog simpan (BL_NO_SNAP bila kosong).
// 1c-2 T5 — banyak unit: unit boleh berupa LARIK unit satu scope (unit halaman workspace) → SATU pemuat se-scope
// (baselineStore.loadScope) dibagi semua unit, tidak pernah list per unit. byUnit = Map<recId, Map<n, entri>>;
// bases/waitingOf/lockedOf/snapOf tanpa argumen kedua = unit PERTAMA (bentuk satu unit T4); argumen kedua recId memilih
// unit lain. `waiting` = ada slot unit mana pun yang menunggu. Kunci muat = recId terurut (urutan unit tidak memuat ulang).
const blUnitOk = u => !!u && typeof u === "object" && typeof u.recId === "string" && typeof u.scope === "string";
function useBaselines(api, unit) {
  const list0 = (Array.isArray(unit) ? unit : [unit]).filter(blUnitOk);
  const us = list0.length && list0.every(x => x.scope === list0[0].scope) ? list0 : [];
  const u = us.length ? us[0] : null;
  const key = us.map(x => x.recId).sort().join("\u0000");
  const store = React.useMemo(() => baselineStore(api), [api]);
  const [st, setSt] = React.useState(() => ({
    key,
    byUnit: EMPTY_BY_UNIT,
    loaded: false,
    failed: false
  }));
  const [pulled, setPulled] = React.useState(false);
  const argRef = React.useRef(null);
  argRef.current = us;
  React.useEffect(() => {
    let alive = true;
    let seq = 0;
    let timer = null;
    const arg = argRef.current;
    const load = () => {
      if (!arg.length) return Promise.resolve(true);
      const my = ++seq;
      return store.loadScope(arg).then(byUnit => {
        if (alive && my === seq) setSt({
          key,
          byUnit,
          loaded: true,
          failed: false
        });
        return true;
      }, e => {
        logWarn(api, "baseline gagal dimuat:", e);
        if (alive && my === seq) setSt(p => p.key === key ? Object.assign({}, p, {
          failed: true
        }) : {
          key,
          byUnit: EMPTY_BY_UNIT,
          loaded: false,
          failed: true
        });
        return false;
      });
    };
    load();
    let off = null;
    try {
      off = store.subscribe(ev => {
        if (ev.pulled) {
          // latch menyala SETELAH muat ulang selesai — juga bila muat itu gagal (ruling review T4: tarik sukses tetap
          // terjadi; kunci gagal-muat workspace dibuka hanya oleh latch ini).
          load().then(() => {
            if (alive) setPulled(true);
          });
          return;
        }
        if (timer !== null) clearTimeout(timer);
        timer = setTimeout(() => {
          timer = null;
          if (alive) load();
        }, RELOAD_TIMING.debounceMs);
      });
    } catch (e) {
      logWarn(api, "pendengar baseline gagal:", e);
    }
    return () => {
      alive = false;
      if (timer !== null) clearTimeout(timer);
      if (typeof off === "function") off();
    };
  }, [store, key]);
  const mine = u !== null && st.key === key;
  const byUnit = mine ? st.byUnit : EMPTY_BY_UNIT;
  const loaded = mine && st.loaded;
  const failed = mine && st.failed;
  const shared = u !== null && u.scope !== "user";
  const basesOf = recId => byUnit.get(recId === undefined ? u ? u.recId : "" : recId) || EMPTY_BASES;
  const known = recId => recId === undefined || us.some(x => x.recId === recId);
  // Muat gagal sebelum pernah termuat: pribadi terbuka; workspace tetap menunggu sampai `pulled` (ruling review T4).
  const waitingOf = (n, recId) => shared && known(recId) && !pulled && (loaded ? !basesOf(recId).has(n) : failed);
  const lockedOf = (n, recId) => u === null || !known(recId) || !loaded && !failed || waitingOf(n, recId);
  const snapOf = (n, recId) => basesOf(recId).has(n) ? basesOf(recId).get(n).snap : BL_NO_SNAP;
  const waiting = us.some(x => BL_SLOTS.some(n => waitingOf(n, x.recId)));
  return {
    bases: basesOf(),
    byUnit,
    loaded,
    failed,
    pulled,
    store,
    waitingOf,
    lockedOf,
    snapOf,
    waiting
  };
}

// Kapasitas/cuti halaman (1d-1 K48, R9, R10; pola useBaselines): useResources(api, pageKind, listId, open) →
// {map: Map<uid, {res, snap, pending}>, pulled, loaded, failed, store}. Scope = "list:<lid>" (workspace) / "user"
// (project pribadi); workspace dengan listId tak sah → tidak memuat.
//   - Memuat HANYA saat `open` (panel Beban Tim terbuka; K56/R10): tertutup → 0 records.list. Buka → muat pertama segera;
//     selama terbuka muat ulang pada perubahan entitas resource (debounce RELOAD_TIMING) dan SEGERA pada peristiwa tarik
//     sukses. Ditutup → data dilepas (dibuka lagi = muat baru, bukan data lama).
//   - `pulled` = latch "tarik record plugin SUKSES sejak pemasangan ini", dideteksi PERSIS seperti useCalendar/useUnits/
//     useBaselines: peristiwa recordEvent `pulled` dari store.subscribe (bukan sync.done, bukan onChange "sync" biasa).
//     Terbuka → dinyalakan SETELAH muat ulang sesudah peristiwa itu selesai — juga bila muat gagal (ruling review T4
//     baseline: kunci tidak boleh selamanya; CAS saveResource tetap menjaga). Tertutup → langsung dinyalakan tanpa muat
//     (tidak ada data yang ditampilkan; pembukaan berikutnya memuat sesudah tarik itu). Pendengar dipasang selama hook
//     terpasang agar tarik saat panel tertutup tidak terlewat.
//   - Project pribadi tidak butuh latch (record scope user hanya milik pengguna ini; pola baseline) → pulled true.
// Kunci simpan R9 (T7): workspace terkunci MSG_RES_WAIT sampai record lokal orang itu ada (map) ATAU pulled. Hook ini
// tidak pernah menulis.
function resScopeOf(pageKind, listId) {
  if (pageKind === "workspace") return Number.isSafeInteger(listId) && listId > 0 ? "list:" + listId : null;
  return "user";
}
function useResources(api, pageKind, listId, open) {
  const kind = pageKind === "workspace" ? "workspace" : "project";
  const scope = resScopeOf(kind, listId);
  const on = open === true && scope !== null;
  const store = React.useMemo(() => resourceStore(api), [api]);
  const [st, setSt] = React.useState(() => ({
    scope,
    map: EMPTY_RES,
    loaded: false,
    failed: false
  }));
  const [pulled, setPulled] = React.useState(false);
  React.useEffect(() => {
    let alive = true;
    let seq = 0;
    let timer = null;
    if (!on) {
      // tertutup: lepas data (bail-out bila sudah kosong) — pembukaan berikutnya mulai dari "memuat"
      setSt(p => p.scope === scope && !p.loaded && !p.failed && p.map === EMPTY_RES ? p : {
        scope,
        map: EMPTY_RES,
        loaded: false,
        failed: false
      });
    }
    const load = () => {
      const my = ++seq;
      return store.loadScope(scope).then(map => {
        if (alive && my === seq) setSt({
          scope,
          map,
          loaded: true,
          failed: false
        });
        return true;
      }, e => {
        logWarn(api, "kapasitas gagal dimuat:", e);
        if (alive && my === seq) setSt(p => p.scope === scope ? Object.assign({}, p, {
          failed: true
        }) : {
          scope,
          map: EMPTY_RES,
          loaded: false,
          failed: true
        });
        return false;
      });
    };
    if (on) load();
    let off = null;
    try {
      off = store.subscribe(ev => {
        if (ev.pulled) {
          if (!on) {
            if (alive) setPulled(true);
            return;
          }
          load().then(() => {
            if (alive) setPulled(true);
          });
          return;
        }
        if (!on) return;
        if (timer !== null) clearTimeout(timer);
        timer = setTimeout(() => {
          timer = null;
          if (alive) load();
        }, RELOAD_TIMING.debounceMs);
      });
    } catch (e) {
      logWarn(api, "pendengar kapasitas gagal:", e);
    }
    return () => {
      alive = false;
      if (timer !== null) clearTimeout(timer);
      if (typeof off === "function") off();
    };
  }, [store, scope, on]);
  const mine = on && st.scope === scope;
  return {
    map: mine ? st.map : EMPTY_RES,
    loaded: mine && st.loaded,
    failed: mine && st.failed,
    pulled: kind === "project" ? true : pulled,
    store
  };
}

// Baseline aktif yang DITAMPILKAN (1c-2 T5, P2 a): pref `bl:<page>` = n (0 = "Tidak ada" → null). Halaman workspace
// menggabungkan slot n SEMUA unit halaman (recIds, urutan kelompok; kunci task ganda → unit pertama menang) menjadi satu
// dec {n, rows} untuk TLPlan.compareBaseline (T6 bar, T7 tabel). Slot kosong / asing (rows kosong) → rows kosong
// (pembanding kosong, bukan galat). Murni.
function activeBaseline(byUnit, recIds, n) {
  if (BL_SLOTS.indexOf(n) < 0) return null;
  const rows = new Map();
  for (const id of Array.isArray(recIds) ? recIds : []) {
    const e = byUnit instanceof Map && byUnit.get(id) instanceof Map ? byUnit.get(id).get(n) : null;
    if (!e || !(e.rows instanceof Map)) continue;
    for (const [k, r] of e.rows) if (!rows.has(k)) rows.set(k, r);
  }
  return {
    n,
    rows
  };
}

// Unit jadwal DAFTAR LENGKAP (1d-2 R2): taskUnits(tasks) = keluaran TLSched.unitOf unik per recId, urut TLCpm.cmpKey;
// unitIdsOf = recId-nya (fasad tes; komponen memakai taskUnits langsung). Dipakai earned value dan ekspor dengan
// tasks = eng.ctx.tasks (daftar lengkap halaman), BUKAN
// baris tata letak (pageUnits/lay sudah tersaring panel) — angka EV tidak bergantung filter. Bukan objek dilewati. Murni.
function taskUnits(tasks) {
  const by = new Map();
  for (const t of Array.isArray(tasks) ? tasks : []) {
    if (!t || typeof t !== "object") continue;
    const u = TLSched.unitOf(t);
    if (!by.has(u.recId)) by.set(u.recId, u);
  }
  return [...by.keys()].sort(TLCpm.cmpKey).map(k => by.get(k));
}
const unitIdsOf = tasks => taskUnits(tasks).map(u => u.recId);

// Nama baseline aktif tergabung (1d-2 R2): semua unit (recIds) yang PUNYA slot n bernama sama → nama itu; nama beda,
// slot asing (versi lebih baru), atau tanpa nama → "Baseline {n}"; unit tanpa slot n tidak ikut menentukan. Murni.
function blNameFor(byUnit, recIds, n) {
  let name = null;
  for (const id of Array.isArray(recIds) ? recIds : []) {
    const e = byUnit instanceof Map && byUnit.get(id) instanceof Map ? byUnit.get(id).get(n) : null;
    if (!e) continue;
    const nm = !e.foreign && typeof e.name === "string" && e.name !== "" ? e.name : null;
    if (nm === null || name !== null && nm !== name) return blSlotName(n);
    name = nm;
  }
  return name === null ? blSlotName(n) : name;
}

// Mesin jadwal di view (1c-1 R7, K31, K43): useEngine(api, {scopeTasks, calData, units}). Memuat daftar task LENGKAP (api.data.tasks.list({includeDone: true});
// scopeTasks host sudah difilter panel) saat pasang, lalu — debounce RELOAD_TIMING.debounceMs, hanya jawaban terbaru —
// saat identitas scopeTasks berubah dan saat sync.done. Saringan scope = TLSched.scopeKeyOf halaman. TLCpm.run
// dijalankan SESUDAH gambar pertama (raf → setTimeout 0) dan hanya bila engineKey (data task + ext jadwal, kalender,
// unit) berubah. Keluaran {status: "loading"|"ready"|"error", result, tasks, ctx, rawOf, rerun}: ctx = {tasks, cal,
// units, readExt} = masukan run yang sama untuk TLCpm.explain / TLPlan; hasil lama tetap "ready" sampai hasil baru siap.
// R25: hook ini TIDAK PERNAH menulis (drift hanya ditampilkan; tulisan berasal dari aksi pengguna).
const ENGINE_IDLE = Object.freeze({
  key: null,
  status: "loading",
  result: null,
  ctx: null
});
const NO_TASKS = Object.freeze([]);
const ENGINE_TASK_FIELDS = ["id", "cid", "server_id", "parent_id", "parent_cid", "list_id", "project", "gtd_status", "progress", "pomodoros_done", "completed_at", "deadline", "recurrence_type", "archived", "deleted"];
const ENGINE_EXT_KEYS = ["start", "duration", "deps", "mode", "constraint", "actual"]; // actual: jangkar K30 (1c-2)

// Kunci memo mesin: JSON ringkas per task (kolom yang dibaca mesin + ext jadwal), urutan daftar dipertahankan.
function engineKeyOf(tasks, readExt) {
  const rows = [];
  for (const t of tasks) {
    const raw = readExt(t);
    rows.push([ENGINE_TASK_FIELDS.map(f => t[f] === undefined ? null : t[f]), ENGINE_EXT_KEYS.map(k => raw[k] === undefined ? null : raw[k])]);
  }
  return JSON.stringify(rows);
}
function unitsKeyOf(units) {
  const out = [];
  // auto + fold: keduanya menentukan mode efektif (TLSched.unitFor); updatedAt/by tidak memengaruhi mesin — sakelar
  // (Task 8) membaca keduanya dari useUnits().units, BUKAN eng.ctx.units (hasil memo bisa membawa Map lama).
  for (const [k, u] of units) out.push(k + "=" + (u && u.auto === true ? 1 : 0) + ":" + (u && typeof u.fold === "string" ? u.fold : ""));
  return out.sort().join(",");
}

// Satu commit React untuk beberapa setState (host: ReactDOM.render lama). Tanpa ReactDOM (Node/tes) → langsung berurutan.
function commitOnce(f) {
  const rd = typeof ReactDOM !== "undefined" ? ReactDOM : null;
  if (rd && typeof rd.unstable_batchedUpdates === "function") rd.unstable_batchedUpdates(f);else f();
}
function useEngine(api, opts) {
  const o = opts && typeof opts === "object" ? opts : {};
  const scopeTasks = Array.isArray(o.scopeTasks) ? o.scopeTasks : NO_TASKS;
  const calData = o.calData || DEFAULT_CAL_DATA;
  const units = o.units instanceof Map ? o.units : EMPTY_UNITS;
  const [list, setList] = React.useState(null); // daftar lengkap terakhir (null = belum ada)
  const [failed, setFailed] = React.useState(false);
  const [out, setOut] = React.useState(ENGINE_IDLE);
  const L = React.useRef(null);
  if (!L.current) L.current = {
    alive: true,
    seq: 0,
    timer: null,
    scope: null,
    api
  };
  L.current.api = api;
  const load = () => {
    const R = L.current;
    const seq = ++R.seq;
    const a = R.api;
    let p;
    try {
      p = Promise.resolve(a.data.tasks.list({
        includeDone: true
      })); // panggil sinkron: permintaan berurutan = urutan kejadian
    } catch (e) {
      p = Promise.reject(e);
    }
    return p.then(l => {
      // 1c-2 T9: ReactDOM.render lama tanpa batching otomatis → setList + setFailed digabung jadi SATU commit.
      if (R.alive && seq === R.seq) commitOnce(() => {
        setList(Array.isArray(l) ? l : []);
        setFailed(false);
      });
    }, e => {
      logWarn(a, "daftar task gagal dimuat (mesin jadwal):", e);
      if (R.alive && seq === R.seq) commitOnce(() => setFailed(true));
    });
  };
  const loadSoon = () => {
    const R = L.current;
    if (!R.alive) return;
    if (R.timer !== null) clearTimeout(R.timer);
    R.timer = setTimeout(() => {
      R.timer = null;
      if (R.alive) load();
    }, RELOAD_TIMING.debounceMs);
  };
  React.useEffect(() => {
    const R = L.current;
    R.alive = true;
    load();
    let off = null;
    try {
      off = api.events.on("sync.done", loadSoon);
    } catch (e) {
      logWarn(api, "pendengar sync.done gagal:", e);
    }
    return () => {
      R.alive = false;
      if (R.timer !== null) clearTimeout(R.timer);
      R.timer = null;
      if (typeof off === "function") off();
    };
  }, [api]);
  React.useEffect(() => {
    const R = L.current;
    if (R.scope === null) {
      R.scope = scopeTasks; // pasang: sudah dimuat efek di atas
      return;
    }
    if (R.scope === scopeTasks) return;
    R.scope = scopeTasks;
    loadSoon();
  }, [scopeTasks]);
  const readExt = React.useMemo(() => t => readExtSafe(api, t), [api]);
  const tasks = React.useMemo(() => {
    if (list === null) return null;
    const keys = new Set(scopeTasks.map(TLSched.scopeKeyOf));
    return list.filter(t => !!t && typeof t === "object" && keys.has(TLSched.scopeKeyOf(t)));
  }, [list, scopeTasks]);
  const tasksKey = React.useMemo(() => tasks === null ? null : engineKeyOf(tasks, readExt), [tasks, readExt]);
  const calKey = React.useMemo(() => JSON.stringify(calData), [calData]);
  const unitsKey = React.useMemo(() => unitsKeyOf(units), [units]);
  const key = tasksKey === null ? null : tasksKey + "\n" + calKey + "\n" + unitsKey;
  React.useEffect(() => {
    if (key === null || key === out.key) return undefined;
    let alive = true;
    let tid = null;
    const id = raf(() => {
      if (!alive) return;
      tid = setTimeout(() => {
        tid = null;
        if (!alive) return;
        let next;
        try {
          const ctx = {
            tasks,
            cal: TLCal.compile(calData),
            units,
            readExt
          };
          next = {
            key,
            status: "ready",
            result: engine.run(ctx),
            ctx
          };
        } catch (e) {
          logWarn(api, "mesin jadwal gagal:", e);
          next = {
            key,
            status: "error",
            result: null,
            ctx: null
          };
        }
        setOut(next);
      }, 0);
    });
    return () => {
      alive = false;
      caf(id);
      if (tid !== null) clearTimeout(tid);
    };
  }, [key]);
  return React.useMemo(() => {
    const status = out.status !== "loading" ? out.status : list === null && failed ? "error" : "loading";
    const ctx = out.ctx;
    // Hitung ulang atas data + patch ([{task, patch}], null = kunci dihapus) tanpa menulis; null bila belum siap.
    const rerun = patches => {
      if (!ctx) return null;
      const pm = new Map();
      for (const it of Array.isArray(patches) ? patches : []) {
        if (!it || !it.task || !it.patch) continue;
        const k = String(it.task.id);
        pm.set(k, Object.assign({}, pm.get(k) || {}, it.patch));
      }
      const rx = t => {
        const raw = ctx.readExt(t);
        const p = t && t.id !== undefined && t.id !== null ? pm.get(String(t.id)) : undefined;
        return p ? applyRaw(raw, p) : raw;
      };
      return engine.run({
        tasks: ctx.tasks,
        cal: ctx.cal,
        units: ctx.units,
        readExt: rx
      });
    };
    return {
      status,
      result: out.result,
      tasks: ctx ? ctx.tasks : NO_TASKS,
      ctx,
      rawOf: ctx ? ctx.readExt : readExt,
      rerun
    };
  }, [out, list === null, failed, readExt]);
}

// Beban Tim (1d-1 R1, R2, R10, K56): useLoad({open, ready, eng, people, todayDn, byAssignee, ownerUid, api}) → keluaran
// TLLoad.run atau null. Dihitung (engine.load = satu pintu TLLoad.run, di-spy tes) HANYA bila panel terbuka DAN data
// kapasitas/cuti sudah termuat atau gagal dimuat (ready === true; review akhir: tanpa ini panel sempat tampil dengan
// kapasitas bawaan 8 🍅/hari lalu dihitung ulang — kilatan + satu run terbuang) DAN mesin siap (eng.status "ready" +
// result + ctx) DAN todayDn bilangan hari — panel tertutup = 0 run. Masukan = eng.ctx (daftar lengkap halaman, kalender
// halaman, unit, readExt) + eng.result: sumber yang sama dengan Gantt/mesin (R1, R2).
// Memo [open, ready, eng.result, eng.ctx, peopleKey, todayDn, byAssignee, ownerUid]; peopleKey = JSON uid + nama + res,
// jadi render ulang tanpa perubahan data (larik people baru berisi sama) tidak menghitung ulang. Lempar tak terduga → null
// + satu peringatan (logWarn ke api.log.warn; pola useEngine). Hook ini tidak pernah menulis (K27/R25).
function useLoad(opts) {
  const o = opts && typeof opts === "object" ? opts : {};
  const eng = o.eng && typeof o.eng === "object" ? o.eng : ENGINE_IDLE;
  const open = o.open === true;
  const ready = o.ready === true;
  const people = Array.isArray(o.people) ? o.people : NO_PEOPLE;
  const byAssignee = o.byAssignee === true;
  // kunci isi (bukan identitas): dihitung ulang hanya bila larik people berganti (view memo-kan larik itu)
  const peopleKey = React.useMemo(() => open ? JSON.stringify(people.map(p => p && typeof p === "object" ? [p.uid, p.name, p.res === undefined ? null : p.res] : null)) : "", [open, people]);
  const warned = React.useRef(false);
  const apiRef = React.useRef(o.api);
  apiRef.current = o.api;
  return React.useMemo(() => {
    if (!open || !ready || eng.status !== "ready" || !eng.result || !eng.ctx || !Number.isInteger(o.todayDn)) return null;
    try {
      const ctx = eng.ctx;
      return engine.load({
        tasks: ctx.tasks,
        cal: ctx.cal,
        readExt: ctx.readExt,
        result: eng.result,
        units: ctx.units,
        people,
        byAssignee,
        ownerUid: o.ownerUid,
        D: o.todayDn
      });
    } catch (e) {
      if (!warned.current) {
        warned.current = true;
        logWarn(apiRef.current, "beban tim gagal dihitung:", e);
      }
      return null;
    }
  }, [open, ready, eng.result, eng.ctx, peopleKey, o.todayDn, byAssignee, o.ownerUid]);
}

// 4d. Render (fungsi biasa dipanggil langsung → pohon utuh untuk tes anggaran DOM; tanpa hooks di dalamnya).
function renderToolbar(v) {
  const seg = (items, cur, pick, label) => /*#__PURE__*/React.createElement("div", {
    className: "plg-timeline-seg",
    role: "radiogroup",
    "aria-label": label
  }, items.map(([id, text]) => /*#__PURE__*/React.createElement("button", {
    key: id,
    type: "button",
    role: "radio",
    "aria-checked": cur === id,
    className: cx("plg-timeline-seg-btn", cur === id && "is-active"),
    onClick: () => pick(id)
  }, text)));
  // Daftar (HP): zoom, "Hari ini", urut, dan kolom hanya berarti untuk Gantt → disembunyikan.
  const gantt = !v.listMode;
  // 1c-1 R23 + 1c-2 §7.1: Jadwal otomatis · Jalur kritis · Baseline · Simpan baseline · Jadwalkan ulang — hanya saat mesin
  // siap; ≤ 640 px / Live Edit → "Lainnya".
  // Jalur kritis tidak di Daftar. "Jadwalkan ulang" → v.onReschedule (Task 10; nonaktif bila tidak diberikan).
  const ac = v.engReady ? v.auto : null;
  const extras = [];
  if (ac) {
    extras.push(ac.kind === "switch" ? {
      id: "auto",
      text: LBL.auto,
      role: "menuitemcheckbox",
      checked: ac.on,
      disabled: ac.disabled,
      onSelect: ac.onClick
    } : {
      id: "auto",
      text: LBL.auto,
      role: "menuitem",
      haspopup: "dialog",
      onSelect: ac.onClick
    });
  }
  if (gantt && v.engReady) extras.push({
    id: "crit",
    text: LBL.crit,
    role: "menuitemcheckbox",
    checked: v.crit,
    onSelect: () => v.setCrit(!v.crit)
  });
  // 1d-1 R10 (§7.1): Beban Tim setelah Jalur kritis — cukup mesin siap: Gantt menampilkan histogram di bawah grafik, mode
  // Daftar (hanya ada ≤ 640 px) menampilkan daftar "Hari kelebihan beban". Pref load:<page>.
  if (v.engReady) extras.push({
    id: "load",
    text: LBL.load,
    role: "menuitemcheckbox",
    checked: v.loadOn,
    onSelect: () => v.setLoadOn(!v.loadOn)
  });
  // 1c-2 §7.1: Baseline (pemilih; hanya Gantt, seperti Jalur kritis) · Simpan baseline (aksi data; juga di Daftar).
  const bl = v.engReady ? v.bl : null;
  if (gantt && bl) extras.push({
    id: "bl",
    text: LBL.bl,
    role: "menuitem",
    haspopup: "menu",
    onSelect: bl.onPick
  });
  if (bl) extras.push({
    id: "blsave",
    text: LBL.blSave,
    role: "menuitem",
    haspopup: "dialog",
    onSelect: bl.onSave
  });
  if (v.engReady) extras.push({
    id: "resched",
    text: LBL.reschedule,
    role: "menuitem",
    disabled: typeof v.onReschedule !== "function",
    onSelect: v.onReschedule
  });
  const extraBtn = it => {
    if (it.id === "auto" && ac.kind === "switch") {
      return /*#__PURE__*/React.createElement("button", {
        key: "auto",
        type: "button",
        role: "switch",
        "aria-checked": ac.on,
        disabled: ac.disabled,
        className: cx("plg-timeline-btn", "plg-timeline-switch", ac.on && "is-on"),
        onClick: ac.onClick
      }, LBL.auto);
    }
    if (it.id === "auto") {
      return /*#__PURE__*/React.createElement("button", {
        key: "auto",
        type: "button",
        ref: v.autoBtnRef,
        "aria-haspopup": "dialog",
        "aria-expanded": ac.expanded,
        className: cx("plg-timeline-btn", "plg-timeline-autobtn", ac.expanded && "is-active"),
        onClick: ac.onClick
      }, LBL.auto);
    }
    if (it.id === "crit") return /*#__PURE__*/React.createElement("button", {
      key: "crit",
      type: "button",
      className: cx("plg-timeline-btn", v.crit && "is-active"),
      "aria-pressed": v.crit,
      onClick: it.onSelect
    }, LBL.crit);
    if (it.id === "load") {
      return /*#__PURE__*/React.createElement("button", {
        key: "load",
        type: "button",
        className: cx("plg-timeline-btn", "plg-timeline-loadbtn", v.loadOn && "is-active"),
        "aria-pressed": v.loadOn,
        onClick: it.onSelect
      }, renderLoadIcon(), LBL.load);
    }
    if (it.id === "bl") {
      return /*#__PURE__*/React.createElement("button", {
        key: "bl",
        type: "button",
        ref: bl.btnRef,
        "aria-haspopup": "menu",
        "aria-expanded": bl.open,
        className: cx("plg-timeline-btn", "plg-timeline-blbtn", (bl.open || bl.value > 0) && "is-active"),
        onClick: it.onSelect
      }, LBL.bl);
    }
    if (it.id === "blsave") return /*#__PURE__*/React.createElement("button", {
      key: "blsave",
      type: "button",
      className: "plg-timeline-btn",
      "aria-haspopup": "dialog",
      onClick: it.onSelect
    }, LBL.blSave);
    return /*#__PURE__*/React.createElement("button", {
      key: it.id,
      type: "button",
      className: "plg-timeline-btn",
      disabled: it.disabled,
      onClick: it.onSelect
    }, it.text);
  };
  // 1d-2 R6 (§7.1): aksi yang hanya hidup di menu (Ekspor; v.exportItem, nonaktif sampai mesin siap). Layar lebar → tombol
  // "Lainnya" tetap SETELAH extras berisi aksi menu saja; collapse → ditambahkan di AKHIR daftar Lainnya (satu tombol).
  const menuOnly = v.exportItem ? [v.exportItem] : [];
  const moreItems = extras.concat(menuOnly);
  const sum = v.summary;
  const showEnd = !!sum && sum.end !== null;
  // 1d-2 Task 4 (K57, §7.1): ringkasan earned value SEBELUM "Selesai {tgl}" — v.ev = {text, tip} (TLLoad.evText/evTip)
  // atau null (tanpa baseline aktif / BAC 0 / mesin belum siap). Tooltip = pola plugin untuk elemen bertip (bar baseline,
  // tenggat, ⚠): role img + aria-label + title; label memuat teks tampak + tooltip agar pembaca layar mendengar keduanya.
  const ev = v.ev || null;
  return /*#__PURE__*/React.createElement("div", {
    className: "plg-timeline-toolbar"
  }, gantt ? seg(ZOOMS, v.zoom, v.pickZoom, LBL.zoom) : null, gantt ? /*#__PURE__*/React.createElement("button", {
    type: "button",
    className: "plg-timeline-btn",
    onClick: v.goToday
  }, LBL.today) : null, v.collapse ? moreItems.length ? /*#__PURE__*/React.createElement(MoreMenu, {
    items: moreItems
  }) : null : extras.map(extraBtn), !v.collapse && menuOnly.length ? /*#__PURE__*/React.createElement(MoreMenu, {
    items: menuOnly
  }) : null, /*#__PURE__*/React.createElement("button", {
    type: "button",
    ref: v.calBtnRef,
    className: cx("plg-timeline-btn", "plg-timeline-calbtn", v.calOpen && "is-active"),
    "aria-expanded": v.calOpen,
    "aria-haspopup": "dialog",
    onClick: v.toggleCal
  }, LBL.calendar), gantt ? /*#__PURE__*/React.createElement("button", {
    type: "button",
    className: cx("plg-timeline-btn", v.sort === "start" && "is-active"),
    "aria-pressed": v.sort === "start",
    onClick: () => v.setSort(v.sort === "start" ? "wbs" : "start")
  }, LBL.sort) : null, gantt && v.compact ? /*#__PURE__*/React.createElement("button", {
    type: "button",
    className: cx("plg-timeline-btn", v.cols && "is-active"),
    "aria-pressed": v.cols,
    onClick: () => v.setCols(!v.cols)
  }, LBL.cols) : null, v.narrow ? seg([["gantt", LBL.gantt], ["list", LBL.list]], v.mode, v.setMode, LBL.mode) : null, showEnd || ev ? /*#__PURE__*/React.createElement("div", {
    className: "plg-timeline-toolbar-end"
  }, ev ? /*#__PURE__*/React.createElement("span", {
    className: "plg-timeline-ev",
    role: "img",
    "aria-label": ev.text + " · " + ev.tip,
    title: ev.tip
  }, ev.text) : null, showEnd ? /*#__PURE__*/React.createElement("span", {
    className: "plg-timeline-finish"
  }, "Selesai " + TLCal.fmtShort(sum.end)) : null, showEnd && sum.late > 0 ? /*#__PURE__*/React.createElement("span", {
    className: "plg-timeline-latechip"
  }, sum.late + " lewat tenggat") : null) : null);
}

// Ikon histogram 12 px tombol "Beban Tim" (1d-1 §7.1): tiga batang dalam satu path; warna = currentColor dari CSS (tanpa
// warna inline), dekoratif (aria-hidden) — teks tombol tetap nama aksesibelnya.
function renderLoadIcon() {
  return /*#__PURE__*/React.createElement("svg", {
    className: "plg-timeline-btn-icon",
    "aria-hidden": "true",
    viewBox: "0 0 12 12",
    width: "12",
    height: "12"
  }, /*#__PURE__*/React.createElement("path", {
    d: "M1 7H3.5V11H1ZM4.75 2H7.25V11H4.75ZM8.5 5H11V11H8.5Z"
  }));
}

// Banner R16 (K35, §7.3): satu baris `.plg-timeline-banner` per jenis di atas grafik (di luar header sticky):
// teks + tombol aksi ("Tinjau" / "Buka") + Tutup (aria-label "Tutup"). items = [{k, text, action, onAction}].
function renderBanners(items, onClose) {
  return /*#__PURE__*/React.createElement("div", {
    className: "plg-timeline-banners"
  }, items.map(b => /*#__PURE__*/React.createElement("div", {
    key: b.k,
    className: "plg-timeline-banner",
    role: "status"
  }, /*#__PURE__*/React.createElement("span", {
    className: "plg-timeline-banner-text"
  }, b.text), /*#__PURE__*/React.createElement("button", {
    type: "button",
    className: "plg-timeline-btn plg-timeline-banner-act",
    onClick: b.onAction
  }, b.action), /*#__PURE__*/React.createElement("button", {
    type: "button",
    className: "plg-timeline-pop-close plg-timeline-banner-close",
    "aria-label": "Tutup",
    onClick: () => onClose(b.k)
  }, "\xD7"))));
}
function renderHead(v) {
  const {
    lay,
    colDefs,
    tableW,
    dw,
    chartW
  } = v;
  const ticks = TLLayout.headerTicks(lay.zoom, dw.fromDn, dw.toDn);
  const tick = (c, top) => /*#__PURE__*/React.createElement("div", {
    key: (top ? "t" : "b") + c.key,
    className: cx("plg-timeline-tick", top && "is-top"),
    "data-sub": c.sub === null ? undefined : c.sub,
    style: {
      left: TLLayout.xOf(c.dn, lay.range, lay.px),
      width: c.days * lay.px
    }
  }, c.label);
  return /*#__PURE__*/React.createElement("div", {
    className: "plg-timeline-head",
    style: {
      height: HEAD_H
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "plg-timeline-corner",
    role: "row",
    "aria-rowindex": 1,
    style: {
      width: tableW
    }
  }, colDefs.map(c => /*#__PURE__*/React.createElement("div", {
    key: c.id,
    role: "columnheader",
    className: cx("plg-timeline-cell", "plg-timeline-col-" + c.id),
    style: {
      width: c.w
    }
  }, c.label))), /*#__PURE__*/React.createElement("div", {
    className: "plg-timeline-scale",
    "aria-hidden": "true",
    style: {
      width: chartW
    }
  }, ticks.top.map(c => tick(c, true)), ticks.bottom.map(c => tick(c, false))));
}
function renderTableRows(v) {
  const {
    lay,
    rw,
    rowH,
    colDefs,
    groupNames,
    ix,
    isSel,
    ov
  } = v;
  const out = [];
  for (let i = rw.first; i <= rw.last; i++) {
    const r = lay.rows[i];
    const c = rowCells(r, groupNames.get(r.group), ov.slack.get(r.key));
    const sel = !!r.task && isSel(r.task);
    out.push(/*#__PURE__*/React.createElement("div", {
      key: r.key,
      role: "row",
      "aria-rowindex": r.index + 2,
      "aria-selected": r.task ? sel : undefined,
      "data-key": r.key,
      tabIndex: r.task ? -1 : undefined,
      className: cx("plg-timeline-row", r.kind === "group" && "is-group", r.kind === "summary" && "is-summary", sel && "is-selected", v.flash === r.key && "is-flash"),
      style: {
        top: r.index * rowH,
        height: rowH
      },
      onClick: r.task ? e => ix.open(r, e) : undefined,
      onKeyDown: r.task ? e => ix.key(r, e) : undefined
    }, colDefs.map(col => {
      if (col.id === "name") {
        return /*#__PURE__*/React.createElement("div", {
          key: "name",
          role: "gridcell",
          className: "plg-timeline-cell plg-timeline-col-name",
          style: {
            width: col.w,
            paddingLeft: 8 + r.depth * 14
          }
        }, /*#__PURE__*/React.createElement("span", {
          className: "plg-timeline-name"
        }, c.name), ov.manual.has(r.key) ? renderPin() : null, r.violation ? /*#__PURE__*/React.createElement("span", {
          className: "plg-timeline-warn",
          role: "img",
          "aria-label": MSG_VIOLATION,
          title: MSG_VIOLATION
        }, "\u26A0") : null);
      }
      return /*#__PURE__*/React.createElement("div", {
        key: col.id,
        role: "gridcell",
        className: cx("plg-timeline-cell", "plg-timeline-col-" + col.id),
        style: {
          width: col.w
        }
      }, c[col.id]);
    })));
  }
  return out;
}

// Ikon pin 10 px (1c-1 R19): task Manual di unit otomatis; dua lapis (duotone) dengan warna dari CSS.
function renderPin() {
  return /*#__PURE__*/React.createElement("svg", {
    className: "plg-timeline-pin",
    role: "img",
    "aria-label": MSG_MANUAL,
    viewBox: "0 0 10 10",
    width: "10",
    height: "10"
  }, /*#__PURE__*/React.createElement("path", {
    className: "plg-timeline-pin-head",
    d: "M3 0.5H7V1.7L6.2 2.5V4.5L8 5.8V6.8H2V5.8L3.8 4.5V2.5L3 1.7Z"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M4.6 6.8H5.4V9.8H4.6Z"
  }));
}

// Bar / ringkasan / milestone satu baris (R11, R12, R23). Label nama di kanan bar (anak, aria-hidden).
// Task 8: bar task/milestone menerima pointerdown (ix.barDown: zona badan/tepi/titik dari TLDrag.hitZone) + pegangan tepi
// kanan (bukan milestone) dan titik dependensi di kanan ujung (desktop; CSS menyembunyikannya di layar sentuh).
// Ringkasan tidak bisa diseret dan tidak bisa jadi ujung dependensi (R10) → tanpa pointerdown.
function renderBar(r, box, y, v) {
  const {
    rowH,
    isSel
  } = v;
  const t = r.task;
  const sel = isSel(t);
  const crit = v.crit && v.ov.crit.has(r.key); // 1c-1 R18: garis tepi merah, bukan isi
  const flash = v.flash === r.key; // 1d-1 R7: kedip setelah "Bisa digeser"
  const title = rowCells(r).name;
  const aria = TLLayout.ariaBar(t, r.kind === "summary" ? {
    duration: r.duration
  } : r.sched, r.span, r.progress, r.kind);
  const g = barGeom(r, box, rowH);
  const common = {
    key: "b" + r.key,
    "data-key": r.key,
    role: "button",
    tabIndex: 0,
    "aria-label": aria,
    onClick: e => v.ix.open(r, e),
    onKeyDown: e => v.ix.key(r, e),
    onPointerDown: r.kind === "summary" || !v.ix.barDown ? undefined : e => v.ix.barDown(r, e)
  };
  const label = /*#__PURE__*/React.createElement("span", {
    className: "plg-timeline-label",
    "aria-hidden": "true"
  }, title);
  const dot = /*#__PURE__*/React.createElement("span", {
    className: "plg-timeline-dot",
    "aria-hidden": "true"
  });
  if (box.milestone) {
    return /*#__PURE__*/React.createElement("div", _extends({}, common, {
      className: cx("plg-timeline-milestone", r.done && "is-done", r.late > 0 && "is-late", sel && "is-selected", crit && "is-critical", flash && "is-flash"),
      style: {
        transform: translate(g.x, g.top),
        width: g.w,
        height: g.h
      }
    }), label, dot);
  }
  if (r.kind === "summary") {
    return /*#__PURE__*/React.createElement("div", _extends({}, common, {
      className: cx("plg-timeline-summary", r.late > 0 && "is-late", sel && "is-selected", flash && "is-flash"),
      style: {
        transform: translate(g.x, g.top),
        width: g.w,
        height: g.h
      }
    }), label);
  }
  const pct = r.done ? 100 : Math.round(r.progress);
  return /*#__PURE__*/React.createElement("div", _extends({}, common, {
    className: cx("plg-timeline-bar", r.done && "is-done", r.late > 0 && "is-late", sel && "is-selected", crit && "is-critical", flash && "is-flash"),
    style: {
      transform: translate(g.x, g.top),
      width: g.w,
      height: g.h
    }
  }), /*#__PURE__*/React.createElement("div", {
    className: "plg-timeline-fill",
    style: {
      width: pct + "%"
    }
  }), label, /*#__PURE__*/React.createElement("span", {
    className: "plg-timeline-edge",
    "aria-hidden": "true"
  }), dot);
}
function renderChart(v) {
  const {
    lay,
    rw,
    dw,
    rowH,
    chartW,
    bodyH,
    todayDn,
    tableW,
    ix
  } = v;
  const R = lay.range;
  const px = lay.px;
  const c = lay.cal;
  const winX = TLLayout.xOf(dw.fromDn, R, px);
  const winW = (dw.toDn - dw.fromDn + 1) * px;
  const out = [];
  // libur (bukan akhir pekan; akhir pekan sudah diarsir gradien) dan hari kerja pengganti, hanya di kolom tampak
  for (const h of TLLayout.holidaySpans(c, dw.fromDn, dw.toDn)) {
    if (h.weekend) continue;
    out.push(/*#__PURE__*/React.createElement("div", {
      key: "h" + h.dn,
      className: "plg-timeline-holiday",
      "data-dn": h.dn,
      title: h.name,
      style: {
        left: TLLayout.xOf(h.dn, R, px),
        width: px
      }
    }));
  }
  for (const d of c.work) {
    if (d < dw.fromDn || d > dw.toDn || c.mask.has(TLCal.isoWeekday(d))) continue;
    out.push(/*#__PURE__*/React.createElement("div", {
      key: "w" + d,
      className: "plg-timeline-workday",
      "data-dn": d,
      style: {
        left: TLLayout.xOf(d, R, px),
        width: px
      }
    }));
  }
  if (todayDn !== null && todayDn >= R.from && todayDn <= R.to) {
    out.push(/*#__PURE__*/React.createElement("div", {
      key: "today",
      className: "plg-timeline-today",
      style: {
        left: TLLayout.xOf(todayDn, R, px) + px / 2 - 1
      }
    }));
  }
  for (let i = rw.first; i <= rw.last; i++) {
    const r = lay.rows[i];
    const y = r.index * rowH;
    if (r.kind === "group") {
      out.push(/*#__PURE__*/React.createElement("div", {
        key: "g" + r.key,
        className: "plg-timeline-band",
        style: {
          top: y,
          height: rowH,
          left: winX,
          width: winW
        }
      }));
      continue;
    }
    const box = boxOf(r, lay);
    if (!r.span && r.kind === "task") {
      // R21: tanpa jadwal → tanpa bar; petunjuk tipis saat hover (klik untuk menjadwalkan = Task 8, ix.slotDown)
      out.push(/*#__PURE__*/React.createElement("div", {
        key: "s" + r.key,
        className: "plg-timeline-slot",
        "data-key": r.key,
        style: {
          top: y,
          height: rowH,
          left: winX,
          width: winW
        },
        onPointerDown: ix.slotDown ? e => ix.slotDown(r, e) : undefined
      }, /*#__PURE__*/React.createElement("span", {
        className: "plg-timeline-hint",
        style: {
          left: tableW + 8,
          lineHeight: rowH + "px"
        }
      }, MSG_SCHEDULE_HINT)));
    }
    if (box) out.push(renderBar(r, box, y, v));
    if (r.kind === "task") {
      // 1c-2 Task 6: bar baseline 4 px tepat di bawah bar (16 px, tengah baris) + garis aktual 2 px di atas bar;
      // satu div per baris TAMPAK (loop jendela rw yang sama dengan bar).
      const b = v.blOv ? v.blOv.get(r.key) : undefined;
      const bg = b ? spanGeom(b.s, b.f, R, px) : null;
      if (bg) {
        const tip = baselineTip(b);
        out.push(/*#__PURE__*/React.createElement("div", {
          key: "bl:" + r.key,
          className: "plg-timeline-blbar",
          "data-key": r.key,
          role: "img",
          "aria-label": tip,
          title: tip,
          style: {
            left: bg.x,
            width: bg.w,
            top: y + (rowH + BAR_H) / 2 + 1
          }
        }));
      }
      const a = v.actOv ? v.actOv.get(r.key) : undefined;
      const ag = a ? spanGeom(a.s, a.f, R, px) : null;
      if (ag) {
        out.push(/*#__PURE__*/React.createElement("div", {
          key: "ac:" + r.key,
          className: "plg-timeline-actual",
          "data-key": r.key,
          "aria-hidden": "true",
          style: {
            left: ag.x,
            width: ag.w,
            top: y + (rowH - BAR_H) / 2 - 4
          }
        }));
      }
    }
    if (r.deadlineDn !== null && r.deadlineDn >= R.from && r.deadlineDn <= R.to) {
      const tip = "Tenggat " + TLCal.fmtShort(r.deadlineDn);
      out.push(/*#__PURE__*/React.createElement("div", {
        key: "f" + r.key,
        className: cx("plg-timeline-flag", r.late > 0 && "is-late"),
        "data-key": r.key,
        role: "img",
        "aria-label": tip,
        title: tip,
        style: {
          left: TLLayout.xOf(r.deadlineDn + 1, R, px) - 1,
          top: y,
          height: rowH
        }
      }));
    }
  }
  out.push(renderArrows(v, winX, winW));
  // Task 8: garis karet dependensi + tooltip seret; selalu ada, disembunyikan, diubah lewat ref (tanpa setState).
  out.push(/*#__PURE__*/React.createElement("svg", {
    key: "rubber",
    ref: ix.rubberRef,
    className: "plg-timeline-rubber",
    "aria-hidden": "true",
    width: chartW,
    height: bodyH,
    style: {
      display: "none"
    }
  }, /*#__PURE__*/React.createElement("line", {
    ref: ix.lineRef,
    className: "plg-timeline-rubber-line"
  })));
  out.push(/*#__PURE__*/React.createElement("div", {
    key: "tip",
    ref: ix.tipRef,
    className: "plg-timeline-tip",
    "aria-hidden": "true",
    style: {
      display: "none"
    }
  }));
  return /*#__PURE__*/React.createElement("div", {
    className: "plg-timeline-chart",
    ref: ix.chartRef,
    style: {
      width: chartW,
      height: bodyH,
      backgroundImage: TLLayout.weekendGradient(c, R, px)
    }
  }, out);
}

// Satu <svg> seukuran jendela tampak; panah digambar bila salah satu ujungnya di baris tampak (spec §8.6).
// Path memakai koordinat grafik absolut di dalam <g transform> (Task 13): saat jendela bergeser hanya transform <g> dan
// posisi svg berubah, `d` panah yang tetap tampak tidak ditulis ulang (tiap `d` baru = rekalkulasi gaya per path).
function renderArrows(v, winX, winW) {
  const {
    lay,
    rw,
    rowH,
    ov
  } = v;
  const oy = rw.first * rowH;
  const rect = idx => {
    const r = lay.rows[idx];
    const box = r ? boxOf(r, lay) : null;
    if (!box) return null;
    const h = r.kind === "summary" ? SUM_H : box.milestone ? MS_SIZE : BAR_H;
    const x = box.milestone ? box.x - MS_SIZE / 2 : box.x;
    const w = box.milestone ? MS_SIZE : box.w;
    return {
      x,
      y: idx * rowH + (rowH - h) / 2,
      w,
      h
    };
  };
  const inWin = i => i !== null && i >= rw.first && i <= rw.last;
  const paths = [];
  for (const e of lay.edges) {
    if (!e.drawn || !(inWin(e.fromRow) || inWin(e.toRow))) continue;
    const a = rect(e.fromRow);
    const b = rect(e.toRow);
    if (!a || !b) continue;
    // 1c-1: panah per tipe (R19); konflik jangkar mesin = pelanggaran 1b (merah putus-putus); antar kritis (R18) tebal.
    const id = e.from + ">" + e.to;
    const bad = e.violation || ov.conflictEdge.has(id);
    const crit = v.crit && ov.critEdge.has(id);
    paths.push(/*#__PURE__*/React.createElement("path", {
      key: id,
      className: cx("plg-timeline-arrow", bad && "is-violation", crit && "is-critical"),
      d: TLLayout.arrowPath(a, b, e.type),
      markerEnd: bad || crit ? "url(#plg-timeline-ah-v)" : "url(#plg-timeline-ah)"
    }));
  }
  return /*#__PURE__*/React.createElement("svg", {
    key: "arrows",
    className: "plg-timeline-arrows",
    "aria-hidden": "true",
    width: winW,
    height: Math.max(0, (rw.last - rw.first + 1) * rowH),
    style: {
      left: winX,
      top: oy
    }
  }, /*#__PURE__*/React.createElement("defs", null, /*#__PURE__*/React.createElement("marker", {
    id: "plg-timeline-ah",
    viewBox: "0 0 6 6",
    refX: "5",
    refY: "3",
    markerWidth: "6",
    markerHeight: "6",
    orient: "auto"
  }, /*#__PURE__*/React.createElement("path", {
    className: "plg-timeline-head-path",
    d: "M0 0L6 3L0 6z"
  })), /*#__PURE__*/React.createElement("marker", {
    id: "plg-timeline-ah-v",
    viewBox: "0 0 6 6",
    refX: "5",
    refY: "3",
    markerWidth: "6",
    markerHeight: "6",
    orient: "auto"
  }, /*#__PURE__*/React.createElement("path", {
    className: "plg-timeline-head-path is-violation",
    d: "M0 0L6 3L0 6z"
  }))), /*#__PURE__*/React.createElement("g", {
    transform: "translate(" + -winX + " " + -oy + ")"
  }, paths));
}

// extra (1c-2 Task 6): {bl: baseline aktif dengan baris, act: ada garis aktual di halaman}.
function renderLegend(lay, ref, crit, extra) {
  const x = extra || {};
  let items = crit ? LEGEND.concat([["critical", LBL.crit]]) : LEGEND; // 1c-1 R18
  if (x.bl) items = items.concat([["baseline", LBL.bl]]);
  if (x.act) items = items.concat([["actual", MSG_ACTUAL]]);
  return /*#__PURE__*/React.createElement("div", {
    className: "plg-timeline-foot",
    ref: ref
  }, /*#__PURE__*/React.createElement("div", {
    className: "plg-timeline-legend"
  }, items.map(([id, text]) => /*#__PURE__*/React.createElement("span", {
    key: id,
    className: "plg-timeline-legend-item"
  }, /*#__PURE__*/React.createElement("span", {
    className: cx("plg-timeline-swatch", "is-" + id),
    "aria-hidden": "true"
  }), text))), lay.missingYears.length ? /*#__PURE__*/React.createElement("div", {
    className: "plg-timeline-note"
  }, missingYearsNote(lay.missingYears)) : null);
}

// 4e. Panel Beban Tim desktop (1d-1 Task 5; spec §7.2, §1 butir 6; rencana R5, P3 (a)). Menumpang viewport Gantt: jendela
// hari dw, kolom tabel tableW, sumbu x xOf(dn) — tanpa sel per hari. Per baris orang SATU <svg> selebar jendela berisi
// paling banyak lima path (satu per kelas): hari non-kerja, area kapasitas, batang beban, kelebihan di atas kapasitas pada
// hari merah, arsir cuti. Tombol fokus hanya untuk hari merah di jendela (aria-label = teks tooltip); satu readout hover per
// panel. Isi grafik digeser translateX(−scrollLeft) yang disetel LANGSUNG oleh handler gulir view lewat ref (tanpa render
// ulang per piksel); panel dirender ulang hanya bila data / jendela dw / zoom berubah (React.memo + props primitif). Hanya
// baca: tidak ada tulisan (R25).
const LOAD_ROW_H = 28; // tinggi baris panel (R5)
const LOAD_ROWS_MAX = 10; // baris terlihat; sisanya gulir vertikal (kolom kiri + grafik bersama)
const LOAD_PAD = 3; // px kosong di atas batang tertinggi baris
const LOAD_HATCH = 6; // jarak garis arsir cuti (px, diagonal 45°)
// Tombol hari merah per panel. Anggaran DOM panel ≤ 300 (§1 butir 6): akar + baris judul (wadah + judul + tombol "Hari
// kelebihan beban") + catatan + body + kolom nama + wadah grafik + isi = 9, per baris 1 nama + 1 svg + ≤ 5 path (11 baris =
// 77), + 1 readout = 87; + 150 tombol = 237 (daftar hari merah desktop hanya dirender saat dibuka). Kasus terburuk
// (hampir semua hari kerja 10 orang merah di zoom Bulan, jendela ±750 hari) memotong ke hari merah TERDEKAT tengah jendela
// (= tengah layar saat jendela dihitung); sisanya tetap tampak merah dan muncul sebagai tombol saat digulir mendekat.
// Review T4–T6 I1: hari merah tanpa tombol tetap terjangkau — klik/ketuk di grafik (mouse/sentuh) dan daftar "Hari
// kelebihan beban" dari tombol di judul panel (keyboard/pembaca layar; dirender hanya saat dibuka).
const LOAD_HIT_MAX = 150;
const MSG_LOAD_PARTIAL = "Hanya beban dari project ini"; // P3 (a): halaman project pribadi
const LOAD_POP_W = 340; // = width .plg-timeline-pop (perataan popover saran)
// Review T4–T6 M1: tinggi maks popover saran = min(50vh, LOAD_POP_MAX_H) (= max-height .plg-timeline-load-pop, gulir di
// dalam) + jarak LOAD_POP_GAP; ruang di atas panel kurang dari itu → membuka ke bawah (is-down).
const LOAD_POP_MAX_H = 320;
const LOAD_POP_GAP = 4;
// Popover saran grafik: penekanan di grafik (tombol hari merah ATAU klik hari merah tanpa tombol, I1a) ditangani grafik
// (hari sama = tutup, hari merah lain = ganti, hari biasa = tutup) — bukan "klik di luar".
const LOAD_SUG_SKIP = ".plg-timeline-load-hit, .plg-timeline-load-view";
let loadDaysSeq = 0; // id daftar "Hari kelebihan beban" desktop (aria-controls), unik per panel
const LOAD_FLASH_MS = 1500; // R7: kedip baris/bar hasil "Bisa digeser"
// Popover saran (§7.4, K50, R6): label jenis selain free; teks kosong bila tidak ada task free.
const MSG_SUG_EMPTY = "Tidak ada task yang bisa digeser tanpa menggeser jalur kritis";
const SUG_KIND = Object.freeze({
  critical: "Kritis",
  manual: "Manual",
  started: "Sudah mulai",
  late: "terlambat"
});
const sugTitle = (name, dn) => "Bisa digeser — " + name + ", " + TLCal.fmtShort(dn);
// "{judul} · {n} 🍅 hari ini" (+ " · slack {s} hk" untuk free). Judul = taskTitle (sama dengan baris Gantt: dipangkas,
// kosong → "Tanpa judul"; CSS memotong dengan elipsis); n = TLLoad.fmtPomo(porsi hari itu).
function sugText(it) {
  const head = taskTitle(it.task) + " · " + TLLoad.fmtPomo(it.share) + " 🍅 hari ini";
  return it.kind === "free" ? head + " · slack " + Math.round(it.slack) + " hk" : head;
}

// Σ pasangan orang×hari merah (semua baris, seluruh rentang; baris tanpa penanggung jawab tidak pernah merah). Murni.
function loadOverCount(load) {
  let n = 0;
  for (const r of load && Array.isArray(load.rows) ? load.rows : []) n += r && Array.isArray(r.overDays) ? r.overDays.length : 0;
  return n;
}

// Review akhir: kapasitas/cuti gagal dimuat dan belum pernah termuat → panel tetap tampil dengan kapasitas bawaan, ditandai
// di akhir judul agar angka bawaan tidak tampak sebagai data tersimpan.
const MSG_LOAD_CAP_MISSING = "kapasitas belum termuat";
// Judul panel (§7.2, §8): n = loadOverCount; "· {m} task belum dijadwalkan" bila ada; "· {k} task bertarget bawaan 1 🍅"
// bila k > 25 % task berbeban (counted); "· kapasitas belum termuat" bila capMissing === true. Murni.
function loadHeadText(load, capMissing) {
  const L = load && typeof load === "object" ? load : {};
  let s = LBL.load + " · " + loadOverCount(L) + " hari kelebihan beban";
  if (L.unscheduled > 0) s += " · " + L.unscheduled + " task belum dijadwalkan";
  if (L.counted > 0 && L.defaultTarget * 4 > L.counted) s += " · " + L.defaultTarget + " task bertarget bawaan 1 🍅";
  if (capMissing === true) s += " · " + MSG_LOAD_CAP_MISSING;
  return s;
}
const loadNameText = row => row.name + " · " + row.capacity + " 🍅/hari";

// Teks tooltip / aria-label hari (§7.2): "{nama} · {tgl}: {beban} dari {kapasitas} 🍅 ({jam})"; baris tanpa penanggung jawab
// "Belum ditugaskan · {tgl}: {beban} 🍅 ({jam})". beban = TLLoad.fmtPomo (hari merah dibulatkan ke atas: tidak pernah
// "8 dari 8"); kapasitas = TLLoad.capAt hari itu; jam = TLLoad.hoursLabel atas angka 🍅 yang DITAMPILKAN → "~1.5 jam"
// (sudah memuat "~" dan "jam": hasil akhir "(~1.5 jam)"). over = hari merah (bila tidak diberikan dihitung dari overDays).
function loadTipText(row, dn, cal, over) {
  const d = row.days instanceof Map ? row.days.get(dn) : undefined;
  const milli = d ? d.load : 0;
  const tgl = TLCal.fmtShort(dn);
  if (row.uid === null) {
    const b = TLLoad.fmtPomo(milli);
    return row.name + " · " + tgl + ": " + b + " 🍅 (" + TLLoad.hoursLabel(Number(b)) + ")";
  }
  const red = over === undefined ? row.overDays.indexOf(dn) >= 0 : over === true;
  const b = TLLoad.fmtPomo(milli, red);
  return row.name + " · " + tgl + ": " + b + " dari " + TLLoad.capAt(row.res, cal, dn) + " 🍅 (" + TLLoad.hoursLabel(Number(b)) + ")";
}

// Cuti pada hari dn (kontrak res = keluaran TLLoad.resourceDecode; entri rusak dilewati seperti TLLoad.capAt).
function loadOnLeave(res, dn) {
  const list = res && Array.isArray(res.leave) ? res.leave : [];
  for (const l of list) if (l && Number.isInteger(l.from) && Number.isInteger(l.to) && dn >= l.from && dn <= l.to) return true;
  return false;
}
const r1 = v => Math.round(v * 10) / 10;
function loadRect(x, y, w, h) {
  return "M" + r1(x) + " " + r1(y) + "h" + r1(w) + "v" + r1(h) + "h" + r1(-w) + "Z";
}
// Garis diagonal 45° (kiri bawah → kanan atas) berjarak LOAD_HATCH, dipotong ke [x1, x2] × [0, H]; kisi global (garis
// bersambung antar rentang).
function loadHatch(x1, x2, H) {
  let d = "";
  for (let a = Math.floor((x1 - H) / LOAD_HATCH) * LOAD_HATCH; a < x2; a += LOAD_HATCH) {
    const t0 = Math.max(0, x1 - a);
    const t1 = Math.min(H, x2 - a);
    if (t1 <= t0) continue;
    d += "M" + r1(a + t0) + " " + r1(H - t0) + "L" + r1(a + t1) + " " + r1(H - t1);
  }
  return d;
}
// Rentang maksimal indeks [k0, k1) bernilai sama (bukan null) dari vals.
function loadRuns(vals) {
  const out = [];
  let k0 = 0;
  for (let k = 1; k <= vals.length; k++) {
    if (k < vals.length && vals[k] === vals[k0]) continue;
    if (vals[k0] !== null) out.push([k0, k, vals[k0]]);
    k0 = k;
  }
  return out;
}

// Skala vertikal satu baris (review T4–T6 I4): maks(kapasitas maks, beban maks) atas SELURUH row.days — bukan per jendela
// dw, sehingga tinggi batang tidak melompat saat jendela berganti (gulir/zoom). Kapasitas maks = row.capacity (capAt tidak
// pernah melebihinya); baris tanpa penanggung jawab (capacity null): beban maks saja. Minimal 1 🍅. Milipomodoro. Murni.
function loadScaleOf(row) {
  const M = TLLoad.MILLI;
  let top = M;
  if (!row) return top;
  if (row.uid !== null && Number.isFinite(row.capacity)) top = Math.max(top, row.capacity * M);
  if (row.days instanceof Map) for (const d of row.days.values()) if (d && d.load > top) top = d.load;
  return top;
}

// Geometri satu baris dalam koordinat lokal svg (x = (dn − fromDn) × px). Skala vertikal = scale (loadScaleOf, dihitung
// sekali per hasil beban; tanpa scale → dihitung di sini), setinggi LOAD_ROW_H − LOAD_PAD. Kapasitas per hari =
// TLLoad.capAt(res, cal, dn) (0 di hari non-kerja / cuti); baris uid null tanpa kapasitas, merah, maupun cuti. Hari merah:
// batang = bagian ≤ kapasitas, kelebihan = sisanya (di atas). Path kosong → "" (tidak dirender). Murni.
function loadRowModel(row, cal, fromDn, toDn, px, scale) {
  const H = LOAD_ROW_H;
  const M = TLLoad.MILLI;
  const person = row.uid !== null;
  const n = Math.max(0, toDn - fromDn + 1);
  const over = new Set(row.overDays);
  const work = new Array(n);
  const caps = new Array(n);
  const leave = new Array(n);
  const top = scale > 0 ? scale : loadScaleOf(row);
  for (let k = 0; k < n; k++) {
    const dn = fromDn + k;
    work[k] = TLCal.isWork(cal, dn);
    caps[k] = person ? TLLoad.capAt(row.res, cal, dn) : 0;
    leave[k] = person && work[k] && loadOnLeave(row.res, dn) ? 1 : null;
  }
  const hOf = milli => milli / top * (H - LOAD_PAD);
  const d = {
    off: "",
    cap: "",
    bar: "",
    over: "",
    leave: ""
  };
  for (const [a, b] of loadRuns(work.map(w => w ? null : 1))) d.off += loadRect(a * px, 0, (b - a) * px, H);
  for (const [a, b, c] of loadRuns(caps.map(c => c > 0 ? c : null))) d.cap += loadRect(a * px, H - hOf(c * M), (b - a) * px, hOf(c * M));
  for (const [a, b] of loadRuns(leave)) d.leave += loadHatch(a * px, b * px, H);
  const inset = px >= 20 ? 3 : px >= 10 ? 1 : 0;
  for (let k = 0; k < n; k++) {
    const day = row.days.get(fromDn + k);
    if (!day || !(day.load > 0)) continue;
    const x = k * px + inset;
    const w = px - 2 * inset;
    const hl = hOf(day.load);
    if (person && over.has(fromDn + k)) {
      const hb = hOf(Math.min(day.load, caps[k] * M));
      if (hb > 0) d.bar += loadRect(x, H - hb, w, hb);
      d.over += loadRect(x, H - hl, w, hl - hb);
    } else d.bar += loadRect(x, H - hl, w, hl);
  }
  return {
    w: n * px,
    d
  };
}

// Model panel: baris (geometri; scales[i] = loadScaleOf baris i) + tombol hari merah di jendela [fromDn, toDn]
// (≤ LOAD_HIT_MAX, terdekat tengah jendela, urut baris lalu hari = urutan Tab). x tombol dalam koordinat grafik Gantt
// (xOf). Murni.
function loadModel(load, cal, fromDn, toDn, rangeFrom, px, scales) {
  const rows = load.rows.map((row, i) => Object.assign({
    row,
    i,
    key: row.uid === null ? "u-" : "u" + row.uid
  }, loadRowModel(row, cal, fromDn, toDn, px, scales ? scales[i] : 0)));
  let hits = [];
  for (const r of rows) {
    for (const dn of r.row.overDays) {
      if (dn >= fromDn && dn <= toDn) hits.push({
        i: r.i,
        uid: r.row.uid,
        dn,
        x: (dn - rangeFrom) * px,
        label: loadTipText(r.row, dn, cal, true)
      });
    }
  }
  if (hits.length > LOAD_HIT_MAX) {
    const mid = (fromDn + toDn) / 2;
    hits = hits.sort((a, b) => Math.abs(a.dn - mid) - Math.abs(b.dn - mid) || a.i - b.i || a.dn - b.dn).slice(0, LOAD_HIT_MAX);
    hits.sort((a, b) => a.i - b.i || a.dn - b.dn);
  }
  return {
    rows,
    hits,
    x: (fromDn - rangeFrom) * px,
    px
  };
}
const loadShift = left => "translateX(" + -(Number(left) || 0) + "px)";

// Isi popover saran untuk hari merah terpilih pop = {uid, dn} (Task 6; dipakai panel desktop dan daftar HP Task 8):
// {name, items: TLLoad.suggest(...)} atau null bila tidak ada pilihan / orang hilang / hari tidak lagi merah. Murni.
function loadSug(load, pop, result, ctx) {
  if (!pop || !load || !Array.isArray(load.rows)) return null;
  const row = load.rows.find(r => r.uid === pop.uid);
  if (!row || row.overDays.indexOf(pop.dn) < 0) return null;
  const c = ctx || {};
  return {
    name: row.name,
    items: TLLoad.suggest(load, pop.uid, pop.dn, {
      result,
      units: c.units,
      readExt: c.readExt,
      tasks: c.tasks
    })
  };
}

// React.memo dibuat malas (pola memoView): panel tidak dirender ulang selama props (data, jendela, ref, callback stabil)
// sama — gulir di dalam kuantum yang sama dan render ulang view karena hal lain tidak menyentuhnya.
let MemoLoad = null;
function loadPanelMemo() {
  if (!MemoLoad) MemoLoad = React.memo ? React.memo(LoadPanel) : LoadPanel;
  return MemoLoad;
}

// Fokus hilang (review T4–T6 M3): tanpa document (Node), elemen aktif kosong / body / terlepas. Popover yang dilepas saat
// fokus di dalamnya menjatuhkan fokus ke body — hanya saat itu fokus dipindah; fokus di elemen lain tidak dicuri.
function loadFocusLost() {
  const doc = typeof document !== "undefined" ? document : null;
  if (!doc) return true;
  const a = doc.activeElement;
  return !a || a === doc.body || a.isConnected === false;
}

// Review akhir I1: gulir akar panel/daftar Beban Tim ke layar (jarak terdekat; tidak bila sudah tampak). Peramban tanpa
// scrollIntoView / yang melempar → tanpa gulir.
function revealLoadBox(el) {
  if (!el || typeof el.scrollIntoView !== "function") return;
  try {
    el.scrollIntoView({
      block: "nearest"
    });
  } catch (e) {
    /* tanpa gulir */
  }
}

// props: {load, cal (eng.ctx.cal), result, ctx (eng.ctx), rangeFrom, px, fromDn, toDn (dw), tableW, viewW, pageKind,
// trackRef (isi grafik, translateX), boxRef (akar, diukur view), getLeft() (scrollLeft wadah Gantt), onEditPerson(uid|null),
// onReveal(key, task) (Task 6: revealRow view), editUid (Task 7: orang yang editornya terbuka), res (Task 7: bundel
// kapasitas view untuk ResourceEditor; tanpa res → tanpa editor), onShowDay(dn) (review T4–T6 I2: view menggulir wadah
// Gantt ke hari itu), daysOpen + onDaysOpen(bool) (I1b: daftar "Hari kelebihan beban" desktop; statusnya milik view agar
// tinggi wadah Gantt diukur ulang saat dibuka/ditutup), getViewW() (review akhir: lebar area grafik wadah Gantt SAAT INI —
// clientWidth − tableW, dibaca langsung; NaN/≤ 0 → viewW), capMissing (review akhir: kapasitas belum termuat → tanda judul)}.
function LoadPanel(props) {
  const p = props;
  const load = p.load;
  // I4: skala vertikal per baris dihitung sekali per hasil beban — jendela dw berganti tidak mengubahnya
  const scales = React.useMemo(() => load.rows.map(loadScaleOf), [load]);
  const model = React.useMemo(() => loadModel(load, p.cal, p.fromDn, p.toDn, p.rangeFrom, p.px, scales), [load, p.cal, p.fromDn, p.toDn, p.rangeFrom, p.px, scales]);
  const [tip, setTip] = React.useState(null); // readout hover {i, dn, flip}
  const tipRef = React.useRef(null);
  tipRef.current = tip;
  // hari merah terpilih — popover saran (Task 6): {uid, dn, src: "chart" (tombol/klik grafik, popover di tingkat panel:
  // left + down) | "list" (item daftar desktop I1b, popover di dalam item)}
  const [pop, setPop] = React.useState(null);
  const popBtnRef = React.useRef(null); // pemicu (fokus kembali); null = klik grafik tanpa tombol
  const viewRef = React.useRef(null);
  const headRef = React.useRef(null); // judul (tabIndex −1): fokus terakhir bila tombol daftar tidak ada (M3)
  const daysBtnRef = React.useRef(null);
  const daysIdRef = React.useRef(null);
  if (daysIdRef.current === null) daysIdRef.current = "plg-timeline-load-days-" + ++loadDaysSeq;
  const nDays = loadOverCount(load);
  const daysOpen = p.daysOpen === true && nDays > 0;
  const live = React.useRef(null);
  live.current = {
    p,
    model,
    pop,
    nDays
  };
  // Task 6 (§7.4, R6): kontributor hari merah lewat TLLoad.suggest (murni) atas keluaran beban + hasil/ctx mesin yang sama.
  const sug = React.useMemo(() => loadSug(load, pop, p.result, p.ctx), [pop, load, p.result, p.ctx]);
  // M3: fokus "rumah" panel = tombol "Hari kelebihan beban" bila dirender (n > 0), selain itu judul panel.
  const focusHome = () => {
    const b = live.current.nDays > 0 ? daysBtnRef.current : null;
    const t = b || headRef.current;
    if (t && typeof t.focus === "function") t.focus();
  };
  // Orang hilang / hari tidak lagi merah (data berubah saat terbuka) → popover ditutup; fokus yang jatuh bersama popover
  // dipindah ke rumah panel (M3).
  React.useEffect(() => {
    if (!pop || sug) return;
    setPop(null);
    if (loadFocusLost()) focusHome();
  }, [pop, sug]);
  // Daftar desktop ditutup (atau n = 0) → popover item ikut tertutup.
  React.useEffect(() => {
    if (pop && pop.src === "list" && !daysOpen) setPop(null);
  }, [pop, daysOpen]);
  // R5: posisi isi grafik = −scrollLeft wadah Gantt saat panel dirender (jendela/zoom berubah); selebihnya disetel handler
  // gulir view langsung lewat trackRef.
  React.useLayoutEffect(() => {
    const t = p.trackRef ? p.trackRef.current : null;
    if (t && t.style) t.style.transform = loadShift(p.getLeft());
  });
  const act = React.useRef(null);
  act.current = {
    // Buka popover saran hari merah (uid, dn); pemicu yang sama (hari + sumber) → tutup. Grafik: rata kiri di hari itu
    // (dijepit ke lebar panel), ke atas panel — atau ke bawah bila ruang di atas panel < tinggi maks popover (M1).
    openSug(uid, dn, trigger, src) {
      const L = live.current.p;
      const cur = live.current.pop;
      if (cur && cur.uid === uid && cur.dn === dn && cur.src === src) {
        setPop(null);
        return;
      }
      popBtnRef.current = trigger || null;
      // Task 7: satu popover panel pada satu waktu (pemicu keyboard tidak menekan "di luar" editor)
      if (L.editUid !== null && L.editUid !== undefined && typeof L.onEditPerson === "function") L.onEditPerson(null);
      if (src === "list") {
        setPop({
          uid,
          dn,
          src
        });
        return;
      }
      const box = L.boxRef ? L.boxRef.current : null;
      const W = box && box.clientWidth > 0 ? box.clientWidth : L.tableW + L.viewW;
      const x = L.tableW + (dn - L.rangeFrom) * L.px - L.getLeft();
      const top = box && typeof box.getBoundingClientRect === "function" ? Number(box.getBoundingClientRect().top) : NaN;
      const winH = hasWindow() ? Number(window.innerHeight) || 0 : 0;
      const down = winH > 0 && Number.isFinite(top) && top < Math.min(winH / 2, LOAD_POP_MAX_H) + LOAD_POP_GAP;
      setPop({
        uid,
        dn,
        src,
        left: Math.max(8, Math.min(Math.round(x), W - LOAD_POP_W - 8)),
        down
      });
    },
    // I2: fokus keyboard tombol hari merah yang (sebagian) di luar layar [getLeft(), getLeft() + lebar] → view menggulir
    // wadah Gantt ke hari itu (panel ikut lewat onScroll) — wadah grafik panel sendiri tidak pernah digulir. Fokus karena
    // klik mouse/sentuh (bukan :focus-visible) tidak menggulir: tombol tidak boleh bergeser dari bawah pointer di tengah klik.
    // Review akhir: lebar = getViewW() (dibaca langsung dari wadah) — viewW props bisa basi (wadah host beranimasi saat
    // Timeline dipasang) sehingga Tab menggulir Gantt padahal tombolnya terlihat; tanpa nilai sah → viewW props.
    showDay(dn, el) {
      const L = live.current.p;
      if (typeof L.onShowDay !== "function") return;
      if (el && typeof el.matches === "function") {
        try {
          if (!el.matches(":focus-visible")) return;
        } catch (err) {
          /* peramban tanpa :focus-visible → perlakukan sebagai fokus keyboard */
        }
      }
      const left = Number(L.getLeft()) || 0;
      const vw = typeof L.getViewW === "function" ? Number(L.getViewW()) : NaN;
      const w = Number.isFinite(vw) && vw > 0 ? vw : Number(L.viewW) || 0;
      const x = (dn - L.rangeFrom) * L.px;
      if (x >= left && x + L.px <= left + w) return;
      L.onShowDay(dn);
    }
  };
  const onHit = React.useRef((e, uid, dn) => act.current.openSug(uid, dn, e && e.currentTarget ? e.currentTarget : null, "chart")).current;
  const onHitFocus = React.useRef((e, dn) => act.current.showDay(dn, e && e.currentTarget ? e.currentTarget : null)).current;
  // Esc / Tutup → fokus kembali ke pemicu; pemicu tidak ada (klik grafik) atau terlepas (jendela berganti) → rumah panel
  // (M3). Klik luar tidak memindah fokus (sudah pindah ke target klik).
  const closeSug = how => {
    setPop(null);
    if (!how || !how.restoreFocus) return;
    const b = popBtnRef.current;
    if (b && b.isConnected !== false && typeof b.focus === "function") b.focus();else focusHome();
  };
  // Klik baris saran → popover ditutup lalu view memilih + menggulir ke bar (R7). Tanpa tulisan.
  const pickSug = it => {
    setPop(null);
    if (typeof p.onReveal === "function") p.onReveal(it.key, it.task);
  };
  // I1b: item daftar desktop → popover saran di dalam item (pola daftar HP).
  const openDay = (it, e) => act.current.openSug(it.uid, it.dn, e && e.currentTarget ? e.currentTarget : null, "list");
  const toggleDays = () => {
    const next = p.daysOpen !== true;
    if (!next && pop && pop.src === "list") setPop(null);
    if (typeof p.onDaysOpen === "function") p.onDaysOpen(next);
  };
  // Task 7: tombol nama → editor kapasitas/cuti (state editUid milik view). Nama yang sama → tutup; lain → ganti. Tutup
  // lewat Esc/Batal/Tutup/Simpan → fokus kembali ke tombol nama pemicu.
  const edBtnRef = React.useRef(null);
  const openEdit = (uid, e) => {
    if (p.editUid === uid) {
      p.onEditPerson(null);
      return;
    }
    edBtnRef.current = e && e.currentTarget ? e.currentTarget : null;
    setPop(null); // satu popover panel pada satu waktu (pemicu keyboard tidak menekan "di luar" popover saran)
    p.onEditPerson(uid);
  };
  const closeEdit = how => {
    p.onEditPerson(null);
    const b = edBtnRef.current;
    if (how && how.restoreFocus && b && typeof b.focus === "function") b.focus();
  };
  const edRow = p.res && p.editUid !== null && p.editUid !== undefined ? load.rows.find(r => r.uid !== null && r.uid === p.editUid) : undefined;
  // Sel (baris, hari) di bawah pointer: baris dari y lokal (clientY − atas wadah grafik), hari dari TLLayout.dnAt(x lokal +
  // scrollLeft). Dipakai readout hover dan klik grafik (I1a). null = tanpa wadah/event; ok false = di luar baris/jendela.
  const cellAt = e => {
    const v = viewRef.current;
    if (!v || typeof v.getBoundingClientRect !== "function" || !e) return null;
    const r = v.getBoundingClientRect();
    const L = live.current;
    const lx = e.clientX - r.left;
    const i = Math.floor((e.clientY - r.top) / LOAD_ROW_H);
    const dn = TLLayout.dnAt(lx + L.p.getLeft(), {
      from: L.p.rangeFrom
    }, L.p.px);
    const ok = i >= 0 && i < L.model.rows.length && dn >= L.p.fromDn && dn <= L.p.toDn;
    return {
      ok,
      i,
      dn,
      flip: lx > (Number(r.width) || 0) / 2
    };
  };
  // Readout hover: setState HANYA bila (baris, hari) berubah (tipRef diperbarui seketika agar gerak beruntun sebelum render
  // tidak menyetel ulang).
  const onMove = e => {
    const c = cellAt(e);
    if (!c) return;
    const cur = tipRef.current;
    if (!c.ok) {
      if (cur !== null) {
        tipRef.current = null;
        setTip(null);
      }
      return;
    }
    if (cur && cur.i === c.i && cur.dn === c.dn) return;
    const next = {
      i: c.i,
      dn: c.dn,
      flip: c.flip
    };
    tipRef.current = next;
    setTip(next);
  };
  const onLeave = () => {
    if (tipRef.current === null) return;
    tipRef.current = null;
    setTip(null);
  };
  // I1a: klik/ketuk di grafik (hari merah di luar LOAD_HIT_MAX tidak punya tombol) → hari merah → popover saran hari itu
  // (pemicu fokus-kembali: rumah panel); hari biasa → popover grafik yang terbuka ditutup. Klik pada tombol hari merah
  // ditangani tombolnya.
  const onChartClick = e => {
    const t = e && e.target;
    if (t && typeof t.closest === "function" && t.closest(".plg-timeline-load-hit")) return;
    const c = cellAt(e);
    if (!c || !c.ok) return;
    const row = live.current.model.rows[c.i].row;
    if (row.uid !== null && row.overDays.indexOf(c.dn) >= 0) {
      act.current.openSug(row.uid, c.dn, null, "chart");
      return;
    }
    const cur = live.current.pop;
    if (cur && cur.src === "chart") setPop(null);
  };
  // I2 (pengaman): wadah grafik tidak pernah digulir (overflow: clip; peramban lama dengan hidden bisa menggulirnya saat
  // fokus) — gulir tak sengaja dikembalikan ke 0 agar grafik tetap sejajar dengan Gantt.
  const onViewScroll = e => {
    const v = viewRef.current || e && e.currentTarget;
    if (!v) return;
    if (v.scrollLeft) v.scrollLeft = 0;
    if (v.scrollTop) v.scrollTop = 0;
  };
  // Isi grafik dimemo per model: render ulang karena readout/popover tidak membangun svg lagi; tombol hari merah dibangun
  // ulang hanya bila hari terbuka (aria-expanded, M4) berganti.
  const svgs = React.useMemo(() => model.rows.map(r => {
    const paths = [];
    for (const c of ["off", "cap", "bar", "over", "leave"]) if (r.d[c]) paths.push(/*#__PURE__*/React.createElement("path", {
      key: c,
      className: "plg-timeline-load-" + c,
      d: r.d[c]
    }));
    return /*#__PURE__*/React.createElement("svg", {
      key: "s" + r.key,
      className: "plg-timeline-load-svg",
      "aria-hidden": "true",
      width: r.w,
      height: LOAD_ROW_H,
      style: {
        left: model.x,
        top: r.i * LOAD_ROW_H
      }
    }, paths);
  }), [model]);
  const popKey = pop && pop.src === "chart" ? pop.uid + ":" + pop.dn : "";
  const hitEls = React.useMemo(() => model.hits.map(h => /*#__PURE__*/React.createElement("button", {
    key: "h" + h.i + ":" + h.dn,
    type: "button",
    className: "plg-timeline-load-hit",
    "aria-label": h.label,
    "aria-haspopup": "dialog",
    "aria-expanded": popKey === h.uid + ":" + h.dn,
    style: {
      left: h.x,
      top: h.i * LOAD_ROW_H,
      width: model.px
    },
    onClick: e => onHit(e, h.uid, h.dn),
    onFocus: e => onHitFocus(e, h.dn)
  })), [model, popKey]);
  // I1b: daftar dibangun hanya saat terbuka (anggaran DOM panel tertutup tetap).
  const items = React.useMemo(() => daysOpen ? loadDayItems(load, p.cal) : null, [daysOpen, load, p.cal]);
  const listPop = pop && pop.src === "list" ? pop : null;
  const rowsH = model.rows.length * LOAD_ROW_H;
  const tipRow = tip ? model.rows[tip.i] : null;
  const tipX = tip ? (tip.dn - p.rangeFrom) * p.px : 0;
  const tipEl = tipRow ? /*#__PURE__*/React.createElement("div", {
    className: cx("plg-timeline-load-tip", tip.flip && "is-flip"),
    "aria-hidden": "true",
    style: {
      left: tip.flip ? tipX - 4 : tipX + p.px + 4,
      top: tip.i * LOAD_ROW_H + 4
    }
  }, loadTipText(tipRow.row, tip.dn, p.cal)) : null;
  return /*#__PURE__*/React.createElement("section", {
    className: "plg-timeline-load",
    "aria-label": LBL.load,
    ref: p.boxRef
  }, /*#__PURE__*/React.createElement("div", {
    className: "plg-timeline-load-top"
  }, /*#__PURE__*/React.createElement("h3", {
    className: "plg-timeline-load-head",
    tabIndex: -1,
    ref: headRef
  }, loadHeadText(load, p.capMissing === true)), nDays > 0 ? /*#__PURE__*/React.createElement("button", {
    type: "button",
    ref: daysBtnRef,
    className: cx("plg-timeline-btn", "plg-timeline-load-daysbtn", daysOpen && "is-active"),
    "aria-expanded": daysOpen,
    "aria-controls": daysIdRef.current,
    onClick: toggleDays
  }, MSG_LOAD_DAYS) : null), p.pageKind !== "workspace" ? /*#__PURE__*/React.createElement("p", {
    className: "plg-timeline-load-note"
  }, MSG_LOAD_PARTIAL) : null, daysOpen ? /*#__PURE__*/React.createElement("div", {
    className: "plg-timeline-load-days",
    id: daysIdRef.current
  }, renderLoadDays({
    items,
    pop: listPop,
    sug: listPop ? sug : null,
    onOpen: openDay,
    onPick: pickSug,
    onClose: closeSug,
    label: MSG_LOAD_DAYS
  })) : null, /*#__PURE__*/React.createElement("div", {
    className: "plg-timeline-load-body",
    style: {
      maxHeight: LOAD_ROWS_MAX * LOAD_ROW_H
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "plg-timeline-load-names",
    style: {
      width: p.tableW,
      height: rowsH
    }
  }, model.rows.map(r => r.row.uid === null ? /*#__PURE__*/React.createElement("div", {
    key: r.key,
    className: "plg-timeline-load-name is-none"
  }, r.row.name) : /*#__PURE__*/React.createElement("button", {
    key: r.key,
    type: "button",
    className: "plg-timeline-load-name",
    "aria-haspopup": "dialog",
    "aria-expanded": p.editUid === r.row.uid,
    onClick: e => openEdit(r.row.uid, e)
  }, loadNameText(r.row)))), /*#__PURE__*/React.createElement("div", {
    className: "plg-timeline-load-view",
    ref: viewRef,
    style: {
      height: rowsH
    },
    onPointerMove: onMove,
    onPointerLeave: onLeave,
    onClick: onChartClick,
    onScroll: onViewScroll
  }, /*#__PURE__*/React.createElement("div", {
    className: "plg-timeline-load-track",
    ref: p.trackRef
  }, svgs, hitEls, tipEl))), pop && sug && pop.src !== "list" ? /*#__PURE__*/React.createElement(SuggestPopover, {
    key: pop.uid + ":" + pop.dn,
    title: sugTitle(sug.name, pop.dn),
    items: sug.items,
    left: pop.left,
    down: pop.down === true,
    skipSel: LOAD_SUG_SKIP,
    onPick: pickSug,
    onClose: closeSug
  }) : null, edRow ? /*#__PURE__*/React.createElement(ResourceEditor, {
    key: "res" + edRow.uid,
    uid: edRow.uid,
    name: edRow.name,
    res: p.res,
    onClose: closeEdit,
    anchorRef: p.boxRef
  }) : null);
}

// Popover "Bisa digeser" (Task 6; spec §7.4, K50). items = TLLoad.suggest (urutan R6 apa adanya): free → "{judul} · {n} 🍅
// hari ini · slack {s} hk"; lainnya → "{judul} · {n} 🍅 hari ini" + label jenis. Tanpa free → pesan di atas daftar. Pola
// UnitPopover: fokus ke dialog saat dibuka, useDismiss (Esc → fokus kembali; klik luar; tombol hari merah lain ditangani
// tombolnya sendiri). Klik baris → onPick(item). Hanya baca. Tinggi maks min(50vh, 320px) dengan gulir di dalam (M1).
function SuggestPopover(props) {
  const items = Array.isArray(props.items) ? props.items : [];
  const rootRef = React.useRef(null);
  const closeRef = React.useRef(props.onClose);
  closeRef.current = props.onClose;
  const close = restoreFocus => {
    if (typeof closeRef.current === "function") closeRef.current({
      restoreFocus
    });
  };
  React.useEffect(() => {
    const el = rootRef.current;
    if (el && typeof el.focus === "function") el.focus();
  }, []);
  // skipSel (Task 8): pemicu daftar HP = ".plg-timeline-load-m-day"; bawaan tombol hari merah panel desktop.
  useDismiss(true, rootRef, how => close(how === "key"), typeof props.skipSel === "string" ? props.skipSel : ".plg-timeline-load-hit");
  const free = items.some(it => it.kind === "free");
  // down (review T4–T6 M1): ruang di atas panel tidak cukup → membuka ke bawah (is-down)
  return /*#__PURE__*/React.createElement("div", {
    className: cx("plg-timeline-pop", "plg-timeline-load-pop", props.down === true && "is-down"),
    role: "dialog",
    "aria-label": props.title,
    tabIndex: -1,
    ref: rootRef,
    style: {
      left: props.left
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "plg-timeline-pop-head"
  }, /*#__PURE__*/React.createElement("h3", {
    className: "plg-timeline-pop-title"
  }, props.title), /*#__PURE__*/React.createElement("button", {
    type: "button",
    className: "plg-timeline-pop-close",
    "aria-label": "Tutup",
    onClick: () => close(true)
  }, "\xD7")), free ? null : /*#__PURE__*/React.createElement("p", {
    className: "plg-timeline-pop-note"
  }, MSG_SUG_EMPTY), items.length ? /*#__PURE__*/React.createElement("ul", {
    className: "plg-timeline-load-sug"
  }, items.map(it => /*#__PURE__*/React.createElement("li", {
    key: it.key,
    className: "plg-timeline-load-sug-item"
  }, /*#__PURE__*/React.createElement("button", {
    type: "button",
    className: "plg-timeline-load-sug-btn",
    onClick: () => props.onPick(it)
  }, /*#__PURE__*/React.createElement("span", {
    className: "plg-timeline-load-sug-text"
  }, sugText(it)), it.kind === "free" ? null : /*#__PURE__*/React.createElement("span", {
    className: cx("plg-timeline-load-sug-kind", "is-" + it.kind)
  }, SUG_KIND[it.kind]))))) : null);
}

// ── 1d-1 Task 7: editor kapasitas/cuti (spec K55, §7.3, Q4 (a); rencana R9) ─────────────────────────────────────────
// Popover dari tombol nama orang (panel desktop / chip HP). Semua anggota boleh mengedit baris siapa pun (Q4 a); baris
// "Belum ditugaskan" tidak punya editor. Satu-satunya tulisan = tombol Simpan → res.store.save → saveResource (R25).
const RES_CAP = "Kapasitas";
const RES_UNIT = "🍅/hari";
const RES_HINT = "8 🍅 ≈ 3 jam 20 menit fokus";
const RES_LEAVE = "Cuti";
const RES_ADD = "Tambah cuti";
const RES_DEL = "Hapus cuti";
const RES_FROM = "Dari tanggal";
const RES_TO = "Sampai tanggal";
const RES_NOTE = "Catatan cuti";
const RES_NOTE_PH = "Catatan";
const RES_SAVE = "Simpan";
const RES_RELOAD = "Muat ulang";
const MSG_RES_CAP_BAD = "Kapasitas 0–40 🍅/hari";
const MSG_RES_DATE_BAD = "Periksa tanggal cuti";
const MSG_RES_SAVE_FAIL = "Gagal menyimpan kapasitas";
const RES_YEAR_MIN = 1970; // = TLLoad (R9): tanggal cuti ISO sah 1970–2199 — tahun parsial saat mengetik (0002-…) tidak sah
const RES_YEAR_MAX = 2199;
const RES_ERR_STALE = "stale";
const RES_SNAP_ABSENT = Object.freeze({
  exists: false,
  updatedAt: null
});
// Pemicu editor (tombol nama panel desktop, chip HP): penekanan di sana ditangani tombolnya (sama = tutup, lain = ganti).
const RES_SKIP = ".plg-timeline-load-name, .plg-timeline-load-m-person";
const resTitle = name => RES_CAP + " " + name;
const resSavedText = name => "Kapasitas " + name + " disimpan";

// Kapasitas dari isian (string input number) → bilangan bulat 0–40, selain itu null ("", "2.5", "-1", "1e1", "41").
function resCapOf(s) {
  const v = typeof s === "string" ? s.trim() : "";
  return /^\d+$/.test(v) && Number(v) <= TLLoad.CAP_MAX ? Number(v) : null;
}
// Tanggal cuti isian: ISO sah (TLCal.dn bilangan bulat) dalam 1970–2199.
function resDateOk(s) {
  if (typeof s !== "string" || !Number.isInteger(TLCal.dn(s))) return false;
  const y = Number(s.slice(0, 4));
  return y >= RES_YEAR_MIN && y <= RES_YEAR_MAX;
}
// Baris cuti kosong total (review T7–T8): dari, sampai, dan catatan (dipangkas) semuanya kosong → netral: bukan galat,
// tidak menonaktifkan Simpan, dan dibuang saat menyusun value. Baris yang berisi sesuatu tetap divalidasi penuh.
const resStr = v => typeof v === "string" ? v : "";
function resRowBlank(x) {
  return !!x && resStr(x.from) === "" && resStr(x.to) === "" && resStr(x.note).trim() === "";
}
// Validasi inline form {cap, rows: [{k, from, to, note}]} → {cap: bilangan|null, capBad, bad: Set<k baris>, dateBad}.
// Baris kosong total dilewati (bukan galat). Murni.
function resFormCheck(form) {
  const f = form && typeof form === "object" ? form : {};
  const cap = resCapOf(f.cap);
  const bad = new Set();
  for (const x of Array.isArray(f.rows) ? f.rows : []) {
    if (resRowBlank(x)) continue;
    if (!resDateOk(x.from) || !resDateOk(x.to) || TLCal.dn(x.from) > TLCal.dn(x.to)) bad.add(x.k);
  }
  return {
    cap,
    capBad: cap === null,
    bad,
    dateBad: bad.size > 0
  };
}
// Fokus jatuh (review T7–T8): tanpa document (Node) dianggap jatuh; elemen aktif kosong / body / terlepas / nonaktif
// (tombol yang difokus dinonaktifkan selama menyimpan atau hilang setelah "Muat ulang"). Fokus di elemen aktif lain
// tidak dicuri.
function resFocusLost() {
  const doc = typeof document !== "undefined" ? document : null;
  if (!doc) return true;
  const a = doc.activeElement;
  return !a || a === doc.body || a.isConnected === false || a.disabled === true;
}
let resSeq = 0; // id paragraf galat editor (aria-describedby), unik per editor
// res terdekode (TLLoad.resourceDecode) → isian: kapasitas string, cuti ISO urut (dari, sampai). Absen → 8 tanpa cuti.
function resFormOf(res, nextKey) {
  const r = res && typeof res === "object" ? res : null;
  const cap = r && Number.isInteger(r.capacity) ? r.capacity : TLLoad.DEFAULT_CAP;
  const list = (r && Array.isArray(r.leave) ? r.leave : []).filter(l => l && Number.isInteger(l.from) && Number.isInteger(l.to));
  list.sort((a, b) => a.from - b.from || a.to - b.to);
  return {
    cap: String(cap),
    rows: list.map(l => ({
      k: nextKey(),
      from: TLCal.iso(l.from),
      to: TLCal.iso(l.to),
      note: typeof l.note === "string" ? l.note : ""
    }))
  };
}
// "Diubah oleh {nama} · {tgl}" / "Diubah oleh anggota lain · {tgl}" (pola unitCaption: actorName + tanggal Jakarta
// updated_at). Record absen → null.
function resCaption(entry, res) {
  const s = entry && entry.snap ? entry.snap : null;
  if (!s || s.exists !== true) return null;
  const name = actorName(s.by, res, res ? res.userId : null);
  return (name ? "Diubah oleh " + name : "Diubah oleh anggota lain") + jktDateSuffix(s.updatedAt);
}

// props: {uid, name, res, onClose({restoreFocus})}. res = bundel kapasitas view {map (useResources), loaded, pulled, store,
// pageKind, listId, currentUser, collaborators, userId, api}.
//   - Nilai awal + potret CAS dari res.map.get(uid) SAAT DIBUKA (entri → {exists: true, updatedAt}; absen → {exists: false,
//     updatedAt: null}).
//   - Kunci Simpan (R9, review T2–T3): workspace → !loaded || (!map.has(uid) && !pulled) + "Menunggu data workspace…";
//     pribadi → !loaded (tanpa teks). Selama terkunci SEMUA isian nonaktif (pola CalendarPopover), dan potret masih
//     "sementara": ikut data terbaru (efek tata letak) sampai kunci terbuka → potret final. Render pertama sesudah kunci
//     terbuka tetap nonaktif sampai potret final terpasang, jadi Simpan tidak pernah memakai potret dari keadaan belum
//     termuat. Sesudah final, perubahan data dari luar TIDAK mengganti potret (CAS → STALE).
//   - Simpan nonaktif selama menyimpan (ref + state: klik ganda = satu put), saat isian tidak sah, dan setelah STALE
//     (sampai "Muat ulang" mengisi nilai + potret dari res.store.get — peta panel bisa tertinggal debounce). Setelah STALE
//     SEMUA isian beku juga (review T7–T8) sampai "Muat ulang": ketikan tidak bisa ditambah ke data yang sudah basi.
//   - Batal / Tutup / Esc → onClose({restoreFocus: true}); klik luar → {restoreFocus: false}; tanpa tulis. Selama sibuk
//     (put / "Muat ulang" berjalan) Batal dan × nonaktif dan Esc diabaikan (review T7–T8).
//   - Baris cuti kosong total netral dan dibuang dari value (resRowBlank). Input tidak sah → aria-describedby ke paragraf
//     galatnya. Setelah "Muat ulang" atau galat simpan, fokus yang jatuh (resFocusLost) dipindah ke akar dialog.
//   - anchorRef (review akhir; panel desktop = akar panel): logika `down` SuggestPopover — ruang di atas wadah panel
//     (getBoundingClientRect().top) kurang dari tinggi editor + LOAD_POP_GAP → membuka ke bawah panel (is-down). Tinggi
//     editor diukur (offsetHeight; CSS membatasinya min(70vh, 560px)) SEKALI saat dibuka, sebelum dilukis — arah tidak
//     melompat saat baris cuti ditambah. Tanpa anchorRef (daftar HP) CSS HP membuka ke bawah pemicunya.
function ResourceEditor(props) {
  const r = props.res && typeof props.res === "object" ? props.res : {};
  const uid = props.uid;
  const name = typeof props.name === "string" ? props.name : "";
  const ws = r.pageKind === "workspace";
  const map = r.map instanceof Map ? r.map : EMPTY_RES;
  const entry = map.get(uid);
  const locked = ws ? !r.loaded || !map.has(uid) && !r.pulled : !r.loaded;
  const keyRef = React.useRef(0);
  const nextKey = () => ++keyRef.current;
  const seedOf = (e, final) => ({
    entry: e,
    snap: e && e.snap ? {
      exists: true,
      updatedAt: typeof e.snap.updatedAt === "string" ? e.snap.updatedAt : null
    } : RES_SNAP_ABSENT,
    form: resFormOf(e ? e.res : null, nextKey),
    final
  });
  const [st, setSt] = React.useState(() => seedOf(entry, !locked));
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState(null); // null | RES_ERR_STALE | pesan inline
  const busyRef = React.useRef(false);
  const refocusRef = React.useRef(false); // fokus diperiksa sesudah render berikutnya ("Muat ulang" / galat simpan)
  const alive = React.useRef(true);
  const rootRef = React.useRef(null);
  const idRef = React.useRef(null);
  if (idRef.current === null) idRef.current = "plg-timeline-res-" + ++resSeq;
  const capErrId = idRef.current + "-cap";
  const dateErrId = idRef.current + "-date";
  const closeRef = React.useRef(props.onClose);
  closeRef.current = props.onClose;
  const close = restoreFocus => {
    if (typeof closeRef.current === "function") closeRef.current({
      restoreFocus
    });
  };
  // Batal / × / Esc: diabaikan selama sibuk (klik luar tetap menutup; hasil simpan diberitahukan lewat toast).
  const cancel = () => {
    if (!busyRef.current) close(true);
  };
  React.useEffect(() => {
    alive.current = true;
    const el = rootRef.current;
    if (el && typeof el.focus === "function") el.focus();
    return () => {
      alive.current = false;
    };
  }, []);
  useDismiss(true, rootRef, how => how === "key" ? cancel() : close(false), RES_SKIP);
  // Arah buka (review akhir): diukur sekali saat dipasang (tata letak, sebelum lukis).
  const [down, setDown] = React.useState(false);
  const anchorRef = props.anchorRef;
  React.useLayoutEffect(() => {
    const a = anchorRef ? anchorRef.current : null;
    const el = rootRef.current;
    if (!a || !el || typeof a.getBoundingClientRect !== "function") return;
    const top = Number(a.getBoundingClientRect().top);
    const h = Number(el.offsetHeight) || 0;
    if (h > 0 && Number.isFinite(top) && top < h + LOAD_POP_GAP) setDown(true);
  }, []);
  // Potret sementara → ikut data terbaru; kunci terbuka → potret final (sekali).
  React.useLayoutEffect(() => {
    if (st.final || st.entry === entry && locked) return;
    setSt(seedOf(entry, !locked));
  }, [entry, locked, st.final]);
  // Sesudah "Muat ulang" / galat simpan dirender: tombol yang difokus bisa nonaktif (Simpan setelah STALE) atau hilang
  // ("Muat ulang") → fokus ke akar dialog agar Tab/Esc tetap di dalam dialog.
  React.useEffect(() => {
    if (!refocusRef.current || busy) return;
    refocusRef.current = false;
    const el = rootRef.current;
    if (resFocusLost() && el && typeof el.focus === "function") el.focus();
  });
  const chk = resFormCheck(st.form);
  const stale = err === RES_ERR_STALE;
  const wait = locked || !st.final || busy; // memuat / menyimpan (aria-busy)
  const frozen = wait || stale;
  const canSave = !frozen && !chk.capBad && !chk.dateBad;
  const live = React.useRef(null);
  live.current = {
    st,
    canSave,
    map
  };
  const edit = fn => {
    if (frozen) return;
    setSt(s => Object.assign({}, s, {
      form: fn(s.form)
    }));
    setErr(e => e === RES_ERR_STALE ? e : null);
  };
  const setCap = v => edit(f => Object.assign({}, f, {
    cap: v
  }));
  const setRow = (k, field, v) => edit(f => Object.assign({}, f, {
    rows: f.rows.map(x => x.k === k ? Object.assign({}, x, {
      [field]: v
    }) : x)
  }));
  const addRow = () => edit(f => f.rows.length >= TLLoad.LEAVE_MAX ? f : Object.assign({}, f, {
    rows: f.rows.concat([{
      k: nextKey(),
      from: "",
      to: "",
      note: ""
    }])
  }));
  const delRow = k => edit(f => Object.assign({}, f, {
    rows: f.rows.filter(x => x.k !== k)
  }));
  const targetOf = () => resRecId(ws ? "workspace" : "project", r.listId, uid);
  const save = () => {
    const L = live.current;
    if (busyRef.current || !L.canSave) return;
    let target;
    try {
      target = targetOf();
    } catch (e) {
      logWarn(r.api, "kapasitas gagal disimpan:", e);
      toastSafe(r.api, MSG_RES_SAVE_FAIL, "error");
      return;
    }
    const value = {
      capacity: resCapOf(L.st.form.cap),
      leave: L.st.form.rows.filter(x => !resRowBlank(x)).map(x => ({
        from: x.from,
        to: x.to,
        note: x.note
      }))
    };
    busyRef.current = true;
    setBusy(true);
    setErr(null);
    Promise.resolve().then(() => r.store.save(target, value, L.st.snap)).then(() => {
      busyRef.current = false;
      toastSafe(r.api, resSavedText(name), "success");
      if (alive.current) close(true);
    }, e => {
      busyRef.current = false;
      const code = e && e.code;
      const known = code === "STALE" || code === "TOO_LARGE" || code === "INVALID";
      if (!known) logWarn(r.api, "kapasitas gagal disimpan:", e);
      if (!alive.current) {
        // dialog sudah ditutup selama menyimpan: galat tetap diberitahukan
        toastSafe(r.api, code === "STALE" ? MSG_RES_STALE : code === "TOO_LARGE" ? MSG_RES_TOO_LARGE : MSG_RES_SAVE_FAIL, "error");
        return;
      }
      refocusRef.current = true;
      setBusy(false);
      if (code === "STALE") setErr(RES_ERR_STALE);else if (code === "TOO_LARGE") setErr(MSG_RES_TOO_LARGE);else if (code === "INVALID") setErr(MSG_RES_DATE_BAD);else toastSafe(r.api, MSG_RES_SAVE_FAIL, "error");
    });
  };
  // "Muat ulang" (setelah STALE): nilai + potret dari record terkini (store.get; gagal → peta panel), ketikan dibuang.
  const reload = () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    const fromMap = () => live.current.map.get(uid);
    Promise.resolve().then(() => r.store && typeof r.store.get === "function" ? r.store.get(targetOf()) : fromMap()).then(e => e || undefined, e => {
      logWarn(r.api, "kapasitas gagal dimuat ulang:", e);
      return fromMap();
    }).then(e => {
      busyRef.current = false;
      if (!alive.current) return;
      refocusRef.current = true;
      setBusy(false);
      setErr(null);
      setSt(seedOf(e, true));
    });
  };
  const f = st.form;
  const caption = resCaption(st.entry, r);
  return /*#__PURE__*/React.createElement("div", {
    className: cx("plg-timeline-pop", "plg-timeline-res-pop", down && "is-down"),
    role: "dialog",
    "aria-label": resTitle(name),
    "aria-busy": wait,
    tabIndex: -1,
    ref: rootRef
  }, /*#__PURE__*/React.createElement("div", {
    className: "plg-timeline-pop-head"
  }, /*#__PURE__*/React.createElement("h3", {
    className: "plg-timeline-pop-title"
  }, resTitle(name)), /*#__PURE__*/React.createElement("button", {
    type: "button",
    className: "plg-timeline-pop-close",
    "aria-label": "Tutup",
    disabled: busy,
    onClick: cancel
  }, "\xD7")), caption ? /*#__PURE__*/React.createElement("p", {
    className: "plg-timeline-pop-note plg-timeline-res-by"
  }, caption) : null, ws && locked ? /*#__PURE__*/React.createElement("p", {
    className: "plg-timeline-pop-note plg-timeline-pop-wait",
    role: "status"
  }, MSG_RES_WAIT) : null, /*#__PURE__*/React.createElement("label", {
    className: "plg-timeline-res-cap"
  }, /*#__PURE__*/React.createElement("span", {
    className: "plg-timeline-res-cap-label"
  }, RES_CAP), /*#__PURE__*/React.createElement("input", {
    type: "number",
    className: "plg-timeline-pop-input plg-timeline-res-cap-input",
    min: 0,
    max: TLLoad.CAP_MAX,
    step: 1,
    inputMode: "numeric",
    value: f.cap,
    disabled: frozen,
    "aria-invalid": chk.capBad,
    "aria-describedby": chk.capBad ? capErrId : undefined,
    onChange: e => setCap(e.target.value)
  }), /*#__PURE__*/React.createElement("span", {
    className: "plg-timeline-res-unit"
  }, RES_UNIT)), /*#__PURE__*/React.createElement("p", {
    className: "plg-timeline-pop-note"
  }, RES_HINT), /*#__PURE__*/React.createElement("section", {
    className: "plg-timeline-pop-sec",
    "aria-label": RES_LEAVE
  }, /*#__PURE__*/React.createElement("h4", {
    className: "plg-timeline-pop-sub"
  }, RES_LEAVE), f.rows.length ? /*#__PURE__*/React.createElement("ul", {
    className: "plg-timeline-res-leave"
  }, f.rows.map(x => {
    const bad = chk.bad.has(x.k);
    const desc = bad ? dateErrId : undefined;
    return /*#__PURE__*/React.createElement("li", {
      key: x.k,
      className: "plg-timeline-res-row"
    }, /*#__PURE__*/React.createElement("input", {
      type: "date",
      className: "plg-timeline-pop-input plg-timeline-res-from",
      "aria-label": RES_FROM,
      value: x.from,
      disabled: frozen,
      "aria-invalid": bad,
      "aria-describedby": desc,
      onChange: e => setRow(x.k, "from", e.target.value)
    }), /*#__PURE__*/React.createElement("span", {
      className: "plg-timeline-res-dash",
      "aria-hidden": "true"
    }, "\u2013"), /*#__PURE__*/React.createElement("input", {
      type: "date",
      className: "plg-timeline-pop-input plg-timeline-res-to",
      "aria-label": RES_TO,
      value: x.to,
      disabled: frozen,
      "aria-invalid": bad,
      "aria-describedby": desc,
      onChange: e => setRow(x.k, "to", e.target.value)
    }), /*#__PURE__*/React.createElement("input", {
      type: "text",
      className: "plg-timeline-pop-input plg-timeline-res-note",
      "aria-label": RES_NOTE,
      placeholder: RES_NOTE_PH,
      maxLength: TLLoad.NOTE_MAX,
      value: x.note,
      disabled: frozen,
      onChange: e => setRow(x.k, "note", e.target.value)
    }), /*#__PURE__*/React.createElement("button", {
      type: "button",
      className: "plg-timeline-pop-del plg-timeline-res-del",
      "aria-label": RES_DEL,
      disabled: frozen,
      onClick: () => delRow(x.k)
    }, "\xD7"));
  })) : null, /*#__PURE__*/React.createElement("button", {
    type: "button",
    className: "plg-timeline-btn plg-timeline-res-add",
    disabled: frozen || f.rows.length >= TLLoad.LEAVE_MAX,
    onClick: addRow
  }, RES_ADD)), chk.capBad ? /*#__PURE__*/React.createElement("p", {
    className: "plg-timeline-pop-err",
    role: "alert",
    id: capErrId
  }, MSG_RES_CAP_BAD) : null, chk.dateBad ? /*#__PURE__*/React.createElement("p", {
    className: "plg-timeline-pop-err",
    role: "alert",
    id: dateErrId
  }, MSG_RES_DATE_BAD) : null, stale ? /*#__PURE__*/React.createElement("div", {
    className: "plg-timeline-res-stale"
  }, /*#__PURE__*/React.createElement("p", {
    className: "plg-timeline-pop-err",
    role: "alert"
  }, MSG_RES_STALE), /*#__PURE__*/React.createElement("button", {
    type: "button",
    className: "plg-timeline-btn",
    disabled: busy,
    onClick: reload
  }, RES_RELOAD)) : err ? /*#__PURE__*/React.createElement("p", {
    className: "plg-timeline-pop-err",
    role: "alert"
  }, err) : null, /*#__PURE__*/React.createElement("div", {
    className: "plg-timeline-res-actions"
  }, /*#__PURE__*/React.createElement("button", {
    type: "button",
    className: "plg-timeline-btn",
    disabled: busy,
    onClick: cancel
  }, PV_CANCEL), /*#__PURE__*/React.createElement("button", {
    type: "button",
    className: "plg-timeline-btn plg-timeline-res-save",
    disabled: !canSave,
    onClick: save
  }, RES_SAVE)));
}

// ── 1d-1 Task 8: Beban Tim versi HP (≤ 640 px; spec §7.6; rencana R10) ───────────────────────────────────────────────
// Di layar sempit (Gantt maupun Daftar) histogram diganti daftar "Hari kelebihan beban": judul sama dengan desktop, chip
// orang "{nama} · {cap} 🍅/hari" (→ editor T7; agar kapasitas orang tanpa hari merah tetap bisa diatur), lalu satu tombol
// per pasangan orang × hari merah "{nama} · {tgl} · {beban} dari {kapasitas} 🍅" urut tanggal lalu nama (ketuk → popover
// saran T6, di bawah item). Tanpa SVG dan tanpa lebar tetap (muat 375 px). Anggaran DOM: ≤ LOAD_M_MAX item (terdekat —
// daftar urut tanggal naik dari T) + "dan {n} lainnya". Hanya baca: tulisan satu-satunya tetap Simpan di editor.
const LOAD_M_MAX = 100;
const LOAD_M_PEOPLE_MAX = 30; // review T7–T8: chip orang HP dibatasi (urutan baris) + "dan {n} lainnya"
const MSG_LOAD_DAYS = "Hari kelebihan beban";
const loadMoreText = n => "dan " + n + " lainnya"; // pola "dan {n} lainnya" (banner lingkaran, kartu pratinjau)

// Item daftar HP: [{uid, name, dn, text}] dari overDays semua baris berpenanggung jawab; beban = TLLoad.fmtPomo(milli, true)
// (hari merah dibulatkan ke atas, sama dengan tooltip desktop), kapasitas = TLLoad.capAt hari itu. Urut dn naik, nama
// (TLCpm.cmpKey), uid. Murni.
function loadDayItems(load, cal) {
  const out = [];
  for (const row of load && Array.isArray(load.rows) ? load.rows : []) {
    if (!row || row.uid === null || !Array.isArray(row.overDays)) continue;
    for (const dn of row.overDays) {
      const d = row.days instanceof Map ? row.days.get(dn) : undefined;
      const text = row.name + " · " + TLCal.fmtShort(dn) + " · " + TLLoad.fmtPomo(d ? d.load : 0, true) + " dari " + TLLoad.capAt(row.res, cal, dn) + " 🍅";
      out.push({
        uid: row.uid,
        name: row.name,
        dn,
        text
      });
    }
  }
  out.sort((a, b) => a.dn - b.dn || TLCpm.cmpKey(a.name, b.name) || a.uid - b.uid);
  return out;
}

// Daftar "Hari kelebihan beban" (Task 8 HP; dipakai ulang panel desktop — review T4–T6 I1b): ≤ LOAD_M_MAX tombol item
// (teks loadDayItems; ketuk/Enter → popover saran DI DALAM item, skipSel item) + "dan {n} lainnya". o = {items, pop
// ({uid, dn} item terbuka | null), sug (loadSug untuk pop), onOpen(it, e), onPick(it), onClose(how), label (aria-label
// daftar, opsional)}. Fungsi render biasa tanpa hooks → [ul, more].
function renderLoadDays(o) {
  const items = o.items;
  const shown = items.length > LOAD_M_MAX ? items.slice(0, LOAD_M_MAX) : items;
  const list = /*#__PURE__*/React.createElement("ul", {
    key: "days",
    className: "plg-timeline-load-m-list",
    "aria-label": o.label
  }, shown.map(it => {
    const on = !!o.pop && o.pop.uid === it.uid && o.pop.dn === it.dn;
    return /*#__PURE__*/React.createElement("li", {
      key: it.uid + ":" + it.dn,
      className: "plg-timeline-load-m-item"
    }, /*#__PURE__*/React.createElement("button", {
      type: "button",
      className: "plg-timeline-load-m-day",
      "aria-haspopup": "dialog",
      "aria-expanded": on,
      onClick: e => o.onOpen(it, e)
    }, it.text), on && o.sug ? /*#__PURE__*/React.createElement(SuggestPopover, {
      key: it.uid + ":" + it.dn,
      title: sugTitle(o.sug.name, it.dn),
      items: o.sug.items,
      skipSel: ".plg-timeline-load-m-day",
      onPick: o.onPick,
      onClose: o.onClose
    }) : null);
  }));
  const more = items.length > shown.length ? /*#__PURE__*/React.createElement("p", {
    key: "more",
    className: "plg-timeline-load-m-more"
  }, loadMoreText(items.length - shown.length)) : null;
  return [list, more];
}
let MemoLoadList = null;
function loadListMemo() {
  if (!MemoLoadList) MemoLoadList = React.memo ? React.memo(LoadList) : LoadList;
  return MemoLoadList;
}

// props: {load, cal (eng.ctx.cal), result, ctx (eng.ctx), pageKind, boxRef (akar, diukur view seperti panel desktop),
// editUid, onEditPerson(uid|null), res (bundel kapasitas T7), onReveal(key, task), capMissing (review akhir: tanda judul)}.
function LoadList(props) {
  const p = props;
  const load = p.load;
  const items = React.useMemo(() => loadDayItems(load, p.cal), [load, p.cal]);
  const [pop, setPop] = React.useState(null); // hari merah terpilih {uid, dn}
  const popBtnRef = React.useRef(null);
  const edBtnRef = React.useRef(null);
  const headRef = React.useRef(null); // judul (tabIndex −1)
  const subRef = React.useRef(null); // subjudul "Hari kelebihan beban" (tabIndex −1), hanya bila ada item
  const nItems = React.useRef(0);
  nItems.current = items.length;
  // Review akhir (pola focusHome desktop M3): fokus "rumah" daftar = subjudul "Hari kelebihan beban" bila ada item, selain
  // itu judul. Dipakai HANYA bila fokus memang hilang (loadFocusLost: body / elemen terlepas).
  const focusHome = () => {
    const t = (nItems.current > 0 ? subRef.current : null) || headRef.current;
    if (t && typeof t.focus === "function") t.focus();
  };
  const sug = React.useMemo(() => loadSug(load, pop, p.result, p.ctx), [pop, load, p.result, p.ctx]);
  // Orang hilang / hari tidak lagi merah → popover (dan item pemicunya) dilepas; fokus yang jatuh bersamanya → rumah.
  React.useEffect(() => {
    if (!pop || sug) return;
    setPop(null);
    if (loadFocusLost()) focusHome();
  }, [pop, sug]);
  const hasEdit = p.editUid !== null && p.editUid !== undefined;
  // Ketuk item: popover saran (item sama = tutup; lain = ganti); satu popover pada satu waktu (editor ditutup).
  const openSug = (it, e) => {
    if (pop && pop.uid === it.uid && pop.dn === it.dn) {
      setPop(null);
      return;
    }
    popBtnRef.current = e && e.currentTarget ? e.currentTarget : null;
    if (hasEdit && typeof p.onEditPerson === "function") p.onEditPerson(null);
    setPop({
      uid: it.uid,
      dn: it.dn
    });
  };
  // Esc / Tutup → fokus kembali ke pemicu; pemicu sudah terlepas → rumah daftar, hanya bila fokus memang hilang (review
  // akhir). Klik luar tidak memindah fokus (sudah pindah ke target klik).
  const closeSug = how => {
    setPop(null);
    if (!how || !how.restoreFocus) return;
    const b = popBtnRef.current;
    if (b && b.isConnected !== false && typeof b.focus === "function") b.focus();else if (loadFocusLost()) focusHome();
  };
  // Baris saran → view: Gantt HP menggulir + berkedip; Daftar (tanpa Gantt) → detail task (revealRow R7).
  const pickSug = it => {
    setPop(null);
    if (typeof p.onReveal === "function") p.onReveal(it.key, it.task);
  };
  const openEdit = (uid, e) => {
    if (p.editUid === uid) {
      p.onEditPerson(null);
      return;
    }
    edBtnRef.current = e && e.currentTarget ? e.currentTarget : null;
    setPop(null);
    p.onEditPerson(uid);
  };
  const closeEdit = how => {
    p.onEditPerson(null);
    const b = edBtnRef.current;
    if (how && how.restoreFocus && b && typeof b.focus === "function") b.focus();
  };
  const persons = load.rows.filter(r => r.uid !== null);
  // Anggaran DOM (review T7–T8): ≤ LOAD_M_PEOPLE_MAX chip pertama (urutan baris) + "dan {n} lainnya". Editor yang sudah
  // terbuka (mis. dari panel desktop sebelum layar menyempit) tetap dicari di semua baris.
  const chips = persons.length > LOAD_M_PEOPLE_MAX ? persons.slice(0, LOAD_M_PEOPLE_MAX) : persons;
  const edRow = p.res && hasEdit ? persons.find(r => r.uid === p.editUid) : undefined;
  return /*#__PURE__*/React.createElement("section", {
    className: "plg-timeline-load-m",
    "aria-label": LBL.load,
    ref: p.boxRef
  }, /*#__PURE__*/React.createElement("h3", {
    className: "plg-timeline-load-head",
    tabIndex: -1,
    ref: headRef
  }, loadHeadText(load, p.capMissing === true)), p.pageKind !== "workspace" ? /*#__PURE__*/React.createElement("p", {
    className: "plg-timeline-load-note"
  }, MSG_LOAD_PARTIAL) : null, persons.length ? /*#__PURE__*/React.createElement("div", {
    className: "plg-timeline-load-m-people"
  }, chips.map(r => /*#__PURE__*/React.createElement("button", {
    key: "u" + r.uid,
    type: "button",
    className: "plg-timeline-load-m-person",
    "aria-haspopup": "dialog",
    "aria-expanded": p.editUid === r.uid,
    onClick: e => openEdit(r.uid, e)
  }, loadNameText(r))), persons.length > chips.length ? /*#__PURE__*/React.createElement("span", {
    className: "plg-timeline-load-m-pmore"
  }, loadMoreText(persons.length - chips.length)) : null, edRow ? /*#__PURE__*/React.createElement(ResourceEditor, {
    key: "res" + edRow.uid,
    uid: edRow.uid,
    name: edRow.name,
    res: p.res,
    onClose: closeEdit
  }) : null) : null, items.length ? /*#__PURE__*/React.createElement("h4", {
    className: "plg-timeline-load-m-sub",
    tabIndex: -1,
    ref: subRef
  }, MSG_LOAD_DAYS) : null, items.length ? renderLoadDays({
    items,
    pop,
    sug,
    onOpen: openSug,
    onPick: pickSug,
    onClose: closeSug
  }) : null);
}

// 4f. Kalender kerja (Task 9; R18, keputusan pemilik U1) dan Daftar HP (R20, U3).
// Nama libur/hari kerja pengganti: dipangkas, ≤ 60 unit (sama dengan TLCal.normalize, yang membuang entri lebih panjang);
// pasangan surrogat tidak dipotong di tengah.
function clipName(s) {
  let n = s === undefined || s === null ? "" : String(s).trim();
  if (n.length > CAL_MAX_NAME) {
    n = n.slice(0, CAL_MAX_NAME);
    const c = n.charCodeAt(n.length - 1);
    if (c >= 0xd800 && c <= 0xdbff) n = n.slice(0, -1);
  }
  return n;
}
function dateLabel(d) {
  return TLCal.fmtShort(TLCal.dn(d)) + " " + String(d).slice(0, 4);
}
const FORM0 = Object.freeze({
  d: "",
  n: "",
  err: ""
});

// Popover kalender: tujuh sakelar hari, dua sakelar libur, dua daftar (libur tambahan, hari kerja pengganti).
// Tiap perubahan langsung disimpan lewat store.save (R5), berurutan (satu antrean), dan ditampilkan lebih dulu
// (optimis); bila gagal, keadaan dimuat ulang dari simpanan dan pesan galat tampil inline. Komponen berhook:
// dirender sebagai elemen, bukan dipanggil sebagai fungsi.
function CalendarPopover(props) {
  const {
    calId,
    scope,
    pageKind,
    store,
    onClose
  } = props;
  const [st, setSt] = React.useState({
    data: null,
    pending: false,
    exists: false
  });
  const [err, setErr] = React.useState("");
  const [form, setForm] = React.useState({
    off: FORM0,
    work: FORM0
  });
  const rootRef = React.useRef(null);
  const dataRef = React.useRef(null); // kalender terkini (termasuk perubahan yang belum selesai disimpan)
  const inflight = React.useRef(0);
  const chain = React.useRef(Promise.resolve());
  const alive = React.useRef(true);
  const closeRef = React.useRef(onClose);
  closeRef.current = onClose;
  const show = r => {
    dataRef.current = r.data;
    setSt({
      data: r.data,
      pending: r.pending,
      exists: r.exists !== false
    });
  };
  // Jendela sinkron pertama (final review #2, D5): kalender workspace tanpa record di perangkat ini dan belum ada tarik
  // record SUKSES (peristiwa `pulled` host) → bisa jadi kalender bersama hanya belum ditarik. Menulis bawaan + perubahan
  // dengan base_version null akan menang LWW dan menimpanya, jadi semua kontrol ubah dinonaktifkan. Kunci dibuka bila
  // record ada (exists), atau setelah tarik sukses — dan selalu SESUDAH muat ulang selesai (`pulledOk` dinyalakan
  // bersama data terbaru), tidak pernah di atas data bawaan. Tarik sukses tanpa record (workspace belum pernah punya
  // kalender) → boleh diubah. cal@user tidak pernah terkunci.
  const [pulledOk, setPulledOk] = React.useState(false);
  const unlockRef = React.useRef(() => {});
  const waiting = scope !== "user" && st.data !== null && !st.exists && !pulledOk;
  const waitRef = React.useRef(waiting);
  waitRef.current = waiting;
  React.useEffect(() => {
    alive.current = true;
    const load = () => store.load(calId).then(r => {
      if (alive.current && inflight.current === 0) show(r);
    }, () => {
      if (alive.current) setErr(MSG_CAL_LOAD_FAIL);
    });
    load();
    // Tarik sukses (peristiwa `pulled`, atau latch view lewat prop): muat ulang dulu, buka kunci bersama data itu.
    unlockRef.current = () => store.load(calId).then(r => {
      if (!alive.current) return;
      if (inflight.current === 0) show(r);
      setPulledOk(true);
    }, () => {
      if (alive.current) setErr(MSG_CAL_LOAD_FAIL);
    });
    let off = null;
    try {
      // Hanya perubahan dari perangkat lain (sinkron) / kalah LWW; peristiwa lokal berasal dari simpanan kita sendiri.
      off = store.subscribe(ev => {
        if (ev.pulled) {
          unlockRef.current();
          return;
        }
        if (inflight.current > 0) return;
        if (ev.lost.indexOf(calId) >= 0 || ev.source === "sync" && ev.ids.indexOf(calId) >= 0) load();
      });
    } catch (e) {
      off = null;
    }
    return () => {
      alive.current = false;
      if (typeof off === "function") off();
    };
  }, [store, calId]);
  // Latch view (tarik sukses sebelum/selama popover terbuka): sama — muat ulang dulu, baru buka kunci.
  React.useEffect(() => {
    if (props.pulled) unlockRef.current();
  }, [props.pulled, store, calId]);
  const close = restoreFocus => {
    const f = closeRef.current;
    if (typeof f === "function") f({
      restoreFocus
    });
  };

  // Fokus ke dialog saat dibuka; Esc menutup (fase tangkap + stopPropagation agar modal/Live Edit host di belakang tidak
  // ikut tertutup); tekan di luar menutup tanpa mencuri fokus. Tombol "Kalender kerja" menangani kliknya sendiri.
  React.useEffect(() => {
    const el = rootRef.current;
    if (el && typeof el.focus === "function") el.focus();
    if (!hasWindow()) return undefined;
    const onKey = e => {
      if (!e || e.key !== "Escape") return;
      if (typeof e.preventDefault === "function") e.preventDefault();
      if (typeof e.stopPropagation === "function") e.stopPropagation();
      close(true);
    };
    const onDown = e => {
      const root = rootRef.current;
      const t = e && e.target;
      if (!root || !t) return;
      if (typeof root.contains === "function" && root.contains(t)) return;
      if (typeof t.closest === "function" && t.closest(".plg-timeline-calbtn")) return;
      close(false);
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("pointerdown", onDown, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("pointerdown", onDown, true);
    };
  }, []);

  // Terapkan perubahan murni `mut(kalender) → kalender` dan simpan. false = tidak ada yang berubah / terlalu besar.
  const change = mut => {
    const cur = dataRef.current;
    if (!cur || waitRef.current) return false;
    const next = TLCal.normalize(mut(cur));
    if (JSON.stringify(next) === JSON.stringify(cur)) return false;
    if (TLCal.byteSize(next) > CAL_MAX_BYTES) {
      setErr(MSG_CAL_TOO_LARGE);
      return false;
    }
    dataRef.current = next;
    setSt(s => Object.assign({}, s, {
      data: next
    }));
    setErr("");
    inflight.current++;
    chain.current = chain.current.then(() => store.save(calId, scope, next)).then(r => {
      inflight.current--;
      if (!alive.current) return;
      if (inflight.current === 0) show(r);else setSt(s => Object.assign({}, s, {
        pending: r.pending
      }));
    }, e => {
      inflight.current--;
      if (alive.current) setErr(e && e.code === "TOO_LARGE" ? MSG_CAL_TOO_LARGE : MSG_CAL_SAVE_FAIL);
      return store.load(calId).then(r => {
        if (alive.current && inflight.current === 0) show(r);
      }, () => {});
    }).catch(() => {});
    return true;
  };
  const toggleDay = n => change(c => {
    const set = new Set(c.weekdays);
    if (set.has(n)) {
      if (set.size <= 1) return c; // sedikitnya satu hari kerja (normalize akan memulihkan bawaan Sen–Jum, bukan yang dimaksud)
      set.delete(n);
    } else set.add(n);
    return Object.assign({}, c, {
      weekdays: Array.from(set).sort((a, b) => a - b)
    });
  });
  const addEntry = (kind, e) => {
    if (e && typeof e.preventDefault === "function") e.preventDefault();
    const cur = dataRef.current;
    if (!cur || waitRef.current) return;
    const f = form[kind];
    const fail = m => setForm(s => Object.assign({}, s, {
      [kind]: Object.assign({}, s[kind], {
        err: m
      })
    }));
    if (!TLCal.isIso(f.d)) return fail(MSG_DATE_NEED);
    if (cur.off.some(x => x.d === f.d) || cur.work.some(x => x.d === f.d)) return fail(MSG_DATE_DUP);
    if (cur[kind].length >= CAL_MAX_ENTRIES) return fail(MSG_LIST_FULL);
    const entry = {
      d: f.d,
      n: clipName(f.n)
    };
    if (change(c => Object.assign({}, c, {
      [kind]: c[kind].concat([entry])
    }))) setForm(s => Object.assign({}, s, {
      [kind]: FORM0
    }));
  };
  const removeEntry = (kind, d) => change(c => Object.assign({}, c, {
    [kind]: c[kind].filter(x => x.d !== d)
  }));
  const edit = (kind, field, value) => setForm(s => Object.assign({}, s, {
    [kind]: Object.assign({}, s[kind], {
      [field]: value,
      err: ""
    })
  }));
  const cal = st.data;
  const loading = cal === null || waiting; // kontrol ubah nonaktif saat memuat atau menunggu sinkron pertama
  const list = (kind, title, addLabel, delLabel) => /*#__PURE__*/React.createElement("section", {
    className: "plg-timeline-pop-sec",
    "aria-label": title
  }, /*#__PURE__*/React.createElement("h4", {
    className: "plg-timeline-pop-sub"
  }, title), cal && cal[kind].length ? /*#__PURE__*/React.createElement("ul", {
    className: "plg-timeline-pop-list"
  }, cal[kind].map(e => /*#__PURE__*/React.createElement("li", {
    key: e.d,
    className: "plg-timeline-pop-item"
  }, /*#__PURE__*/React.createElement("span", {
    className: "plg-timeline-pop-date"
  }, dateLabel(e.d)), /*#__PURE__*/React.createElement("span", {
    className: cx("plg-timeline-pop-name", !e.n && "is-empty")
  }, e.n || MSG_NO_NAME), /*#__PURE__*/React.createElement("button", {
    type: "button",
    className: "plg-timeline-pop-del",
    "aria-label": "Hapus " + dateLabel(e.d),
    title: delLabel,
    disabled: loading,
    onClick: () => removeEntry(kind, e.d)
  }, "\xD7")))) : null, /*#__PURE__*/React.createElement("form", {
    className: "plg-timeline-pop-form",
    "aria-label": addLabel,
    onSubmit: e => addEntry(kind, e)
  }, /*#__PURE__*/React.createElement("input", {
    type: "date",
    className: "plg-timeline-pop-input",
    "aria-label": "Tanggal " + title.toLowerCase(),
    value: form[kind].d,
    disabled: loading,
    onChange: e => edit(kind, "d", e.target.value)
  }), /*#__PURE__*/React.createElement("input", {
    type: "text",
    className: "plg-timeline-pop-input",
    "aria-label": "Nama " + title.toLowerCase(),
    placeholder: "Nama",
    maxLength: CAL_MAX_NAME,
    value: form[kind].n,
    disabled: loading,
    onChange: e => edit(kind, "n", e.target.value)
  }), /*#__PURE__*/React.createElement("button", {
    type: "submit",
    className: "plg-timeline-btn",
    disabled: loading
  }, "Tambah")), form[kind].err ? /*#__PURE__*/React.createElement("div", {
    className: "plg-timeline-pop-err",
    role: "alert"
  }, form[kind].err) : null);
  return /*#__PURE__*/React.createElement("div", {
    className: "plg-timeline-pop",
    role: "dialog",
    "aria-label": LBL.calendar,
    "aria-busy": loading,
    tabIndex: -1,
    ref: rootRef
  }, /*#__PURE__*/React.createElement("div", {
    className: "plg-timeline-pop-head"
  }, /*#__PURE__*/React.createElement("h3", {
    className: "plg-timeline-pop-title"
  }, LBL.calendar), st.pending ? /*#__PURE__*/React.createElement("span", {
    className: "plg-timeline-pop-pending",
    role: "status"
  }, MSG_PENDING) : null, /*#__PURE__*/React.createElement("button", {
    type: "button",
    className: "plg-timeline-pop-close",
    "aria-label": "Tutup",
    onClick: () => close(true)
  }, "\xD7")), pageKind === "workspace" ? /*#__PURE__*/React.createElement("p", {
    className: "plg-timeline-pop-note"
  }, MSG_CAL_NOTE) : null, waiting ? /*#__PURE__*/React.createElement("p", {
    className: "plg-timeline-pop-note plg-timeline-pop-wait",
    role: "status"
  }, MSG_CAL_WAIT) : null, /*#__PURE__*/React.createElement("div", {
    className: "plg-timeline-pop-days",
    role: "group",
    "aria-label": "Hari kerja"
  }, DAYS.map(([short, long], i) => {
    const on = !!cal && cal.weekdays.indexOf(i + 1) >= 0;
    return /*#__PURE__*/React.createElement("button", {
      key: short,
      type: "button",
      className: cx("plg-timeline-pop-day", on && "is-on"),
      "aria-pressed": on,
      "aria-label": long,
      disabled: loading || on && cal.weekdays.length <= 1,
      onClick: () => toggleDay(i + 1)
    }, short);
  })), /*#__PURE__*/React.createElement("label", {
    className: "plg-timeline-pop-check"
  }, /*#__PURE__*/React.createElement("input", {
    type: "checkbox",
    checked: !!cal && cal.national,
    disabled: loading,
    onChange: e => change(c => Object.assign({}, c, {
      national: !!e.target.checked
    }))
  }), /*#__PURE__*/React.createElement("span", null, "Ikuti libur nasional")), /*#__PURE__*/React.createElement("label", {
    className: "plg-timeline-pop-check"
  }, /*#__PURE__*/React.createElement("input", {
    type: "checkbox",
    checked: !!cal && cal.cutiBersama,
    disabled: loading,
    onChange: e => change(c => Object.assign({}, c, {
      cutiBersama: !!e.target.checked
    }))
  }), /*#__PURE__*/React.createElement("span", null, "Ikuti cuti bersama")), list("off", "Libur tambahan", "Tambah libur tambahan", "Hapus libur tambahan"), list("work", "Hari kerja pengganti", "Tambah hari kerja pengganti", "Hapus hari kerja pengganti"), err ? /*#__PURE__*/React.createElement("div", {
    className: "plg-timeline-pop-err",
    role: "alert"
  }, err) : null);
}

// ── 1c-1 Task 8: menu "Lainnya" (R23), popover unit workspace (R15), dialog pratinjau (R14) ─────────────────────────
// Pendengar Esc (fase tangkap, propagasi dihentikan agar modal/Live Edit host di belakang tidak ikut tertutup) dan
// tekan di luar `root` (kecuali target yang cocok `skipSel`). Dipakai MoreMenu/UnitPopover (PreviewDialog punya pendengar
// window sendiri: Esc + perangkap Tab).
function useDismiss(active, rootRef, onDismiss, skipSel) {
  const fnRef = React.useRef(onDismiss);
  fnRef.current = onDismiss;
  React.useEffect(() => {
    if (!active || !hasWindow() || typeof window.addEventListener !== "function") return undefined;
    const onKey = e => {
      if (!e || e.key !== "Escape") return;
      if (typeof e.preventDefault === "function") e.preventDefault();
      if (typeof e.stopPropagation === "function") e.stopPropagation();
      fnRef.current("key");
    };
    const onDown = e => {
      const root = rootRef.current;
      const t = e && e.target;
      if (!root || !t) return;
      if (typeof root.contains === "function" && root.contains(t)) return;
      if (skipSel && typeof t.closest === "function" && t.closest(skipSel)) return;
      fnRef.current("outside");
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("pointerdown", onDown, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("pointerdown", onDown, true);
    };
  }, [active]);
}

// Perataan menu "Lainnya" terhadap tombolnya (fix E2E 375 px): rata kiri bawaan; bila rata kiri melewati tepi kanan
// viewport (toolbar terbungkus, tombol di separuh kanan) DAN rata kanan muat di tepi kiri → "end" (right: 0). Dengan
// menu 180 px dan viewport ≥ 320 px salah satunya selalu muat (tombol ≥ 60 px lebar). rect = getBoundingClientRect
// pembungkus tombol (konteks posisi menu). Murni.
const MORE_MENU_W = 180; // = min-width .plg-timeline-more-menu
const MORE_GAP = 8;
function menuAlign(rect, viewW, menuW) {
  if (!rect || !Number.isFinite(rect.left) || !Number.isFinite(rect.right) || !Number.isFinite(viewW)) return "start";
  return rect.left + menuW > viewW - MORE_GAP && rect.right - menuW >= MORE_GAP ? "end" : "start";
}

// Menu "Lainnya" (HP ≤ 640 px / Live Edit: semua extras + Ekspor; layar lebar sejak 1d-2 R6: hanya Ekspor): items =
// [{id, text, role: "menuitem"|"menuitemcheckbox", checked, disabled, haspopup, onSelect}]. Memilih item menutup menu
// lalu menjalankan onSelect (item nonaktif: tidak dijalankan). onSelect dipanggil SINKRON di handler klik (gestur
// pengguna — ekspor memanggil api.ui.saveFile di dalamnya).
function MoreMenu(props) {
  const items = Array.isArray(props.items) ? props.items : [];
  const [open, setOpen] = React.useState(false);
  const [align, setAlign] = React.useState("start");
  const rootRef = React.useRef(null);
  useDismiss(open, rootRef, () => setOpen(false), null);
  const toggle = () => {
    if (!open) {
      const el = rootRef.current;
      let rect = null;
      try {
        rect = el && typeof el.getBoundingClientRect === "function" ? el.getBoundingClientRect() : null;
      } catch (e) {
        rect = null;
      }
      setAlign(menuAlign(rect, hasWindow() ? Number(window.innerWidth) : NaN, MORE_MENU_W));
    }
    setOpen(!open);
  };
  const pick = it => {
    setOpen(false);
    if (!it.disabled && typeof it.onSelect === "function") it.onSelect();
  };
  return /*#__PURE__*/React.createElement("div", {
    className: "plg-timeline-more",
    ref: rootRef
  }, /*#__PURE__*/React.createElement("button", {
    type: "button",
    className: cx("plg-timeline-btn", open && "is-active"),
    "aria-haspopup": "menu",
    "aria-expanded": open,
    onClick: toggle
  }, LBL.more), open ? /*#__PURE__*/React.createElement("div", {
    className: cx("plg-timeline-more-menu", align === "end" && "is-end"),
    role: "menu",
    "aria-label": LBL.more
  }, items.map(it => /*#__PURE__*/React.createElement("button", {
    key: it.id,
    type: "button",
    role: it.role,
    className: cx("plg-timeline-more-item", it.checked && "is-on"),
    "aria-checked": it.role === "menuitemcheckbox" ? !!it.checked : undefined,
    "aria-haspopup": it.haspopup,
    disabled: !!it.disabled,
    onClick: () => pick(it)
  }, it.text))) : null);
}

// Popover workspace (R15, Q4 a): satu sakelar per kelompok project halaman. entries = [{key, label, on, locked, caption,
// onToggle}]; waiting (P3 a) → catatan "Menunggu data jadwal workspace…" (sakelar terkunci = disabled).
function UnitPopover(props) {
  const entries = Array.isArray(props.entries) ? props.entries : [];
  const rootRef = React.useRef(null);
  const closeRef = React.useRef(props.onClose);
  closeRef.current = props.onClose;
  const close = restoreFocus => {
    if (typeof closeRef.current === "function") closeRef.current({
      restoreFocus
    });
  };
  React.useEffect(() => {
    const el = rootRef.current;
    if (el && typeof el.focus === "function") el.focus();
  }, []);
  useDismiss(true, rootRef, how => close(how === "key"), ".plg-timeline-autobtn");
  return /*#__PURE__*/React.createElement("div", {
    className: "plg-timeline-pop plg-timeline-units",
    role: "dialog",
    "aria-label": LBL.auto,
    tabIndex: -1,
    ref: rootRef
  }, /*#__PURE__*/React.createElement("div", {
    className: "plg-timeline-pop-head"
  }, /*#__PURE__*/React.createElement("h3", {
    className: "plg-timeline-pop-title"
  }, LBL.auto), /*#__PURE__*/React.createElement("button", {
    type: "button",
    className: "plg-timeline-pop-close",
    "aria-label": "Tutup",
    onClick: () => close(true)
  }, "\xD7")), props.waiting ? /*#__PURE__*/React.createElement("p", {
    className: "plg-timeline-pop-note plg-timeline-pop-wait",
    role: "status"
  }, MSG_UNITS_WAIT) : null, /*#__PURE__*/React.createElement("ul", {
    className: "plg-timeline-units-list"
  }, entries.map(e => /*#__PURE__*/React.createElement("li", {
    key: e.key,
    className: "plg-timeline-units-item"
  }, /*#__PURE__*/React.createElement("div", {
    className: "plg-timeline-units-text"
  }, /*#__PURE__*/React.createElement("span", {
    className: "plg-timeline-units-name"
  }, e.label), e.caption ? /*#__PURE__*/React.createElement("span", {
    className: "plg-timeline-units-by"
  }, e.caption) : null), /*#__PURE__*/React.createElement("button", {
    type: "button",
    role: "switch",
    "aria-checked": e.on,
    "aria-label": e.label,
    disabled: e.locked,
    className: cx("plg-timeline-switch", e.on && "is-on"),
    onClick: e.onToggle
  }, /*#__PURE__*/React.createElement("span", {
    className: "plg-timeline-switch-knob",
    "aria-hidden": "true"
  }))))));
}

// Elemen yang bisa difokus di dalam dialog (fokus terjebak).
const FOCUSABLE = "button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])";
function focusables(root) {
  if (!root || typeof root.querySelectorAll !== "function") return [];
  return Array.from(root.querySelectorAll(FOCUSABLE)).filter(el => el && !el.disabled && typeof el.focus === "function");
}

// Teks bersama PreviewDialog dan PreviewCard (R14): ringkasan "{n} task bergeser · Selesai project … (±k hk) · {m} lewat
// tenggat" dan baris "WBS · Task · Mulai lama → baru · Δ hk".
function pvSummaryText(model) {
  const parts = [model.moved + " task bergeser"];
  if (Number.isInteger(model.endBefore) && Number.isInteger(model.endAfter)) {
    parts.push("Selesai project " + dayText(model.endBefore) + " → " + dayText(model.endAfter) + " (" + signedHk(model.endDelta) + ")");
  }
  if (model.late > 0) parts.push(model.late + " lewat tenggat");
  return parts.join(" · ");
}
const pvLabel = r => [r.wbs, taskTitle(r.task)].filter(x => x !== undefined && x !== null && x !== "").join(" · ");
function pvRowText(r) {
  const main = [pvLabel(r), (r.from ? dayText(r.from) : "—") + " → " + (r.to ? dayText(r.to) : "—")];
  if (r.deltaHk !== null && r.deltaHk !== undefined) main.push(signedHk(r.deltaHk));
  return main.join(" · ");
}

// Perilaku modal bersama PreviewDialog dan SaveBaselineDialog (1c-2 T5: diekstrak tanpa ubah perilaku): fokus ke elemen
// pertama saat dibuka (kembali ke pemicu saat ditutup), Esc = onCancel (propagasi dihentikan), Tab/Shift+Tab berputar di
// dalam dialog dan menarik fokus kembali bila sedang di luar. Klik di luar dialog modal tidak menutupnya.
function useModal(rootRef, onCancel) {
  const cancelRef = React.useRef(onCancel);
  cancelRef.current = onCancel;
  const cancel = () => {
    if (typeof cancelRef.current === "function") cancelRef.current();
  };
  React.useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;
    const doc = root.ownerDocument || null;
    const prev = doc ? doc.activeElement : null;
    const first = focusables(root)[0];
    if (first) first.focus();else if (typeof root.focus === "function") root.focus();
    return () => {
      if (prev && typeof prev.focus === "function") prev.focus(); // kembali ke pemicu
    };
  }, []);
  // Esc dan Tab di window (fase tangkap): klik backdrop/area lain memindah fokus ke luar dialog, jadi perangkap di elemen
  // dialog (onKeyDown) bisa lolos. Esc = Batal (propagasi dihentikan); Tab/Shift+Tab berputar di dalam dialog dan menarik
  // fokus kembali bila sedang di luar. Klik di luar dialog modal tidak menutupnya.
  React.useEffect(() => {
    if (!hasWindow() || typeof window.addEventListener !== "function") return undefined;
    const onKey = e => {
      if (!e) return;
      const stop = () => {
        if (typeof e.preventDefault === "function") e.preventDefault();
      };
      if (e.key === "Escape") {
        stop();
        if (typeof e.stopPropagation === "function") e.stopPropagation();
        cancel();
        return;
      }
      if (e.key !== "Tab") return;
      const root = rootRef.current;
      const list = focusables(root);
      if (!list.length) return stop();
      const doc = root && root.ownerDocument ? root.ownerDocument : null;
      const active = doc ? doc.activeElement : null;
      const first = list[0];
      const last = list[list.length - 1];
      const inside = !!active && typeof root.contains === "function" && root.contains(active);
      if (!inside) {
        stop();
        (e.shiftKey ? last : first).focus();
      } else if (e.shiftKey && active === first) {
        stop();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        stop();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);
  return cancel;
}

// Dialog pratinjau (R14, K34; pola CalendarPopover di dalam wadah view): role dialog + aria-modal, fokus ke elemen
// pertama saat dibuka dan terjebak di dalam (Tab/Shift+Tab berputar), Esc = Batal. model = dialogModel(TLPlan.preview…).
// Baris "WBS · Task · Mulai lama → baru · Δ hk" (+ "baru dijadwalkan", "durasi berubah", catatan durGuess); ringkasan;
// "Tidak dipindah"; ≤ 50 baris + "Tampilkan semua". whyOf(key) → Array<string|{b}> (opsional, Task 12) membuka "Kenapa".
// Terapkan nonaktif bila 0 item atau `busy` (pemeriksaan CAS berjalan). Komponen ini tidak menulis apa pun.
function PreviewDialog(props) {
  const model = props.model || EMPTY_PV_MODEL;
  const [all, setAll] = React.useState(false);
  const [why, setWhy] = React.useState(null);
  const rootRef = React.useRef(null);
  const cancel = useModal(rootRef, props.onCancel);
  const rows = model.rows || [];
  const shown = all ? rows : rows.slice(0, PV_ROWS_MAX);
  const label = pvLabel;
  const whyLines = key => {
    const out = typeof props.whyOf === "function" ? props.whyOf(key) : null;
    const arr = Array.isArray(out) ? out : out ? [out] : [];
    return arr.map((p, i) => p && typeof p === "object" ? /*#__PURE__*/React.createElement("strong", {
      key: i
    }, p.b) : /*#__PURE__*/React.createElement("span", {
      key: i
    }, String(p)));
  };
  const canWhy = typeof props.whyOf === "function";
  // "{n} dependensi akan dilanggar": Jadwalkan ulang memberi `broken` = reschedule().broken (pelanggaran baru, penerus
  // Manual); pratinjau lain memakai model.brokenDeps (terfilter jangkauan) — keputusan T4.
  const broken = Number.isInteger(props.broken) ? props.broken : Number.isInteger(model.brokenDeps) ? model.brokenDeps : 0;
  return /*#__PURE__*/React.createElement("div", {
    className: "plg-timeline-pv-backdrop"
  }, /*#__PURE__*/React.createElement("div", {
    className: "plg-timeline-pv",
    role: "dialog",
    "aria-modal": "true",
    "aria-label": props.title,
    tabIndex: -1,
    ref: rootRef
  }, /*#__PURE__*/React.createElement("div", {
    className: "plg-timeline-pop-head"
  }, /*#__PURE__*/React.createElement("h3", {
    className: "plg-timeline-pop-title"
  }, props.title)), props.todayLabel ? /*#__PURE__*/React.createElement("p", {
    className: "plg-timeline-pop-note plg-timeline-pv-today"
  }, "Hari ini: " + props.todayLabel) : null, props.offline ? /*#__PURE__*/React.createElement("p", {
    className: "plg-timeline-pop-note plg-timeline-pv-offline",
    role: "note"
  }, MSG_OFFLINE) : null, /*#__PURE__*/React.createElement("p", {
    className: "plg-timeline-pv-summary"
  }, pvSummaryText(model)), broken > 0 ? /*#__PURE__*/React.createElement("p", {
    className: "plg-timeline-pop-note plg-timeline-pv-broken",
    role: "note"
  }, brokenText(broken)) : null, /*#__PURE__*/React.createElement("ul", {
    className: "plg-timeline-pv-list"
  }, shown.map(r => {
    return /*#__PURE__*/React.createElement("li", {
      key: r.key,
      className: "plg-timeline-pv-row",
      "data-key": r.key
    }, /*#__PURE__*/React.createElement("span", {
      className: "plg-timeline-pv-main"
    }, pvRowText(r)), r.isNew ? /*#__PURE__*/React.createElement("span", {
      className: "plg-timeline-pv-tag"
    }, PV_NEW) : null, r.durChanged ? /*#__PURE__*/React.createElement("span", {
      className: "plg-timeline-pv-tag"
    }, PV_DUR) : null, r.durGuess ? /*#__PURE__*/React.createElement("span", {
      className: "plg-timeline-pv-note"
    }, PV_DUR_GUESS) : null, canWhy ? /*#__PURE__*/React.createElement("button", {
      type: "button",
      className: "plg-timeline-pv-why",
      "aria-expanded": why === r.key,
      onClick: () => setWhy(why === r.key ? null : r.key)
    }, PV_WHY) : null, canWhy && why === r.key ? /*#__PURE__*/React.createElement("p", {
      className: "plg-timeline-pv-whytext"
    }, whyLines(r.key)) : null);
  })), !all && rows.length > PV_ROWS_MAX ? /*#__PURE__*/React.createElement("button", {
    type: "button",
    className: "plg-timeline-btn plg-timeline-pv-all",
    onClick: () => setAll(true)
  }, PV_SHOW_ALL) : null, model.notMoved && model.notMoved.length ? /*#__PURE__*/React.createElement("section", {
    className: "plg-timeline-pv-notmoved",
    "aria-label": PV_NOT_MOVED
  }, /*#__PURE__*/React.createElement("h4", {
    className: "plg-timeline-pop-sub"
  }, PV_NOT_MOVED), /*#__PURE__*/React.createElement("ul", {
    className: "plg-timeline-pv-list"
  }, model.notMoved.map(x => /*#__PURE__*/React.createElement("li", {
    key: x.key,
    className: "plg-timeline-pv-row plg-timeline-pv-nm",
    "data-key": x.key,
    "data-why": x.why
  }, /*#__PURE__*/React.createElement("span", {
    className: "plg-timeline-pv-nmtext"
  }, label(x)))))) : null, /*#__PURE__*/React.createElement("div", {
    className: "plg-timeline-pv-actions"
  }, /*#__PURE__*/React.createElement("button", {
    type: "button",
    className: "plg-timeline-btn",
    onClick: cancel
  }, PV_CANCEL), /*#__PURE__*/React.createElement("button", {
    type: "button",
    className: "plg-timeline-btn plg-timeline-pv-apply",
    disabled: !rows.length || !!props.busy,
    onClick: props.onApply
  }, PV_APPLY))));
}

// ── 1c-2 Task 5: pemilih Baseline (P2 a) dan dialog Simpan baseline (K41) ──────────────────────────────────────────
// Nama baseline (spec §4): dipangkas, ≤ 40 unit UTF-16 tanpa memisah pasangan surrogate; kosong → "Baseline {n}". Murni.
function blNameOf(raw, n) {
  const s = (raw === undefined || raw === null ? "" : String(raw)).trim();
  let out = s;
  if (out.length > BL_NAME_MAX) {
    const hi = out.charCodeAt(BL_NAME_MAX - 1);
    out = out.slice(0, hi >= 0xd800 && hi <= 0xdbff ? BL_NAME_MAX - 1 : BL_NAME_MAX).trim();
  }
  return out || blSlotName(n);
}

// Tanggal simpan slot (fmtShort, zona Jakarta): savedAt (tanggal ISO atau stempel waktu) → updated_at record; null bila
// keduanya tak terbaca (record asing tidak punya savedAt terbaca → updated_at).
function blDateOf(e) {
  if (!e) return null;
  let d = typeof e.savedAt === "string" ? TLCpm.jkt(e.savedAt) : null;
  if (!Number.isInteger(d) && e.snap && typeof e.snap.updatedAt === "string") d = TLCpm.jkt(e.snap.updatedAt);
  return Number.isInteger(d) ? TLCal.fmtShort(d) : null;
}
// Nama tampil slot terisi: asing → "(versi lebih baru)"; tanpa nama → "Baseline {n}".
const blShownName = (e, n) => e.foreign ? MSG_BL_FOREIGN : e.name || blSlotName(n);

// Pemilih "Baseline" (pola UnitPopover/MoreMenu): role menu, item menuitemradio "Tidak ada" + slot 1–3; fokus ke item
// terpilih saat dibuka; Esc / pilih → tutup + fokus kembali ke tombol "Baseline"; klik luar → tutup. items = [{n, label}],
// value = pref aktif, onPick(n) — pemanggil HANYA menulis pref bl:<page> (tanpa record). Komponen ini tidak menulis.
function BaselinePicker(props) {
  const items = Array.isArray(props.items) ? props.items : [];
  const rootRef = React.useRef(null);
  const closeRef = React.useRef(props.onClose);
  closeRef.current = props.onClose;
  const close = restoreFocus => {
    if (typeof closeRef.current === "function") closeRef.current({
      restoreFocus
    });
  };
  React.useEffect(() => {
    const el = rootRef.current;
    let on = null;
    try {
      on = el && typeof el.querySelector === "function" ? el.querySelector("[aria-checked='true']") : null;
    } catch (e) {
      on = null;
    }
    const f = on || el;
    if (f && typeof f.focus === "function") f.focus();
  }, []);
  useDismiss(true, rootRef, how => close(how === "key"), ".plg-timeline-blbtn");
  const pick = n => {
    if (typeof props.onPick === "function") props.onPick(n);
    close(true);
  };
  return /*#__PURE__*/React.createElement("div", {
    className: "plg-timeline-pop plg-timeline-blpick",
    role: "menu",
    "aria-label": LBL.bl,
    tabIndex: -1,
    ref: rootRef
  }, items.map(it => /*#__PURE__*/React.createElement("button", {
    key: it.n,
    type: "button",
    role: "menuitemradio",
    "aria-checked": props.value === it.n,
    className: cx("plg-timeline-more-item", props.value === it.n && "is-on"),
    onClick: () => pick(it.n)
  }, it.label)));
}

// Dialog "Simpan baseline" (K41; pola PreviewDialog: role dialog + aria-modal, fokus terjebak, Esc = Batal).
// props: units [{key: recId, label}] (> 1 = halaman workspace → pilih project dulu), bases = Map<recId, Map<n, entri>>
// POTRET saat dialog dibuka (label + konfirmasi + snap CAS memakai potret yang sama), lockedOf(n, recId) /
// waitingOf(n, recId) (langsung dari useBaselines), busy, rev (naik saat potret disegarkan — setelah STALE atau saat
// kunci/muat berubah di langkah form — → kembali ke form), onSave(recId, n, nama), onRemove(recId, n), onStep(langkah),
// onCancel. Slot terisi (termasuk asing) → langkah konfirmasi "Timpa {nama} (disimpan {tanggal})?" sebelum onSave.
// Slot terisi yang terbaca (bukan asing) punya tombol "Hapus" (nonaktif bila lockedOf) → "Hapus {nama} (disimpan
// {tanggal})?" → onRemove. Komponen ini tidak menulis apa pun; nama dinormalkan blNameOf.
function SaveBaselineDialog(props) {
  const units = Array.isArray(props.units) ? props.units : [];
  const bases = props.bases instanceof Map ? props.bases : EMPTY_BY_UNIT;
  const lockedOf = typeof props.lockedOf === "function" ? props.lockedOf : () => true;
  const waitingOf = typeof props.waitingOf === "function" ? props.waitingOf : () => false;
  const [unitKey, setUnitKey] = React.useState(() => units.length ? units[0].key : "");
  const [slot, setSlot] = React.useState(() => {
    const free = BL_SLOTS.find(n => !lockedOf(n, units.length ? units[0].key : ""));
    return free === undefined ? BL_SLOTS[0] : free;
  });
  const [name, setName] = React.useState(null); // null = belum diubah → bawaan "Baseline {slot}"
  // Langkah: form | confirm (Timpa slot) | delete (Hapus slot `del`). rev baru (potret disegarkan) → kembali ke form.
  const [st, setSt] = React.useState({
    rev: props.rev,
    step: "form",
    del: null
  });
  const fresh = st.rev === props.rev;
  const step = fresh ? st.step : "form";
  const delN = fresh ? st.del : null;
  const setStep = (v, del) => {
    setSt({
      rev: props.rev,
      step: v,
      del: del === undefined ? null : del
    });
    if (typeof props.onStep === "function") props.onStep(v); // view: segarkan potret hanya di form
  };
  const rootRef = React.useRef(null);
  const cancel = useModal(rootRef, props.onCancel);
  const slotsOf = bases.get(unitKey) instanceof Map ? bases.get(unitKey) : EMPTY_BASES;
  const entry = slotsOf.get(slot) || null;
  const delEntry = delN === null ? null : slotsOf.get(delN) || null;
  const shownName = name === null ? blSlotName(slot) : name;
  const locked = lockedOf(slot, unitKey);
  const waiting = BL_SLOTS.some(n => waitingOf(n, unitKey));
  const save = () => {
    if (props.busy || lockedOf(slot, unitKey) || typeof props.onSave !== "function") return;
    props.onSave(unitKey, slot, blNameOf(shownName, slot));
  };
  const submit = () => {
    if (props.busy || locked) return;
    if (entry) setStep("confirm");else save();
  };
  const remove = () => {
    if (props.busy || delN === null || lockedOf(delN, unitKey) || typeof props.onRemove !== "function") return;
    props.onRemove(unitKey, delN);
  };
  const slotLabel = n => {
    const e = slotsOf.get(n);
    if (!e) return [/*#__PURE__*/React.createElement("span", {
      key: "n",
      className: "plg-timeline-bl-slot-name"
    }, blSlotName(n))];
    const d = blDateOf(e);
    return [/*#__PURE__*/React.createElement("span", {
      key: "n",
      className: "plg-timeline-bl-slot-name"
    }, blShownName(e, n)), d ? /*#__PURE__*/React.createElement("span", {
      key: "d",
      className: "plg-timeline-bl-slot-date"
    }, " · disimpan " + d) : null];
  };
  let body;
  if (step === "delete" && delEntry) {
    body = /*#__PURE__*/React.createElement("div", {
      className: "plg-timeline-bl-confirm",
      role: "alert"
    }, /*#__PURE__*/React.createElement("p", {
      className: "plg-timeline-bl-confirm-text"
    }, blDeleteText(blShownName(delEntry, delN), blDateOf(delEntry))));
  } else if (step === "confirm" && entry) {
    body = /*#__PURE__*/React.createElement("div", {
      className: "plg-timeline-bl-confirm",
      role: "alert"
    }, /*#__PURE__*/React.createElement("p", {
      className: "plg-timeline-bl-confirm-text"
    }, blConfirmText(blShownName(entry, slot), blDateOf(entry))));
  } else {
    body = /*#__PURE__*/React.createElement("div", {
      className: "plg-timeline-bl-form"
    }, units.length > 1 ? /*#__PURE__*/React.createElement("div", {
      className: "plg-timeline-bl-units",
      role: "radiogroup",
      "aria-label": BL_UNIT_LABEL
    }, units.map(u => /*#__PURE__*/React.createElement("button", {
      key: u.key,
      type: "button",
      role: "radio",
      "aria-checked": u.key === unitKey,
      className: cx("plg-timeline-bl-opt", u.key === unitKey && "is-active"),
      onClick: () => setUnitKey(u.key)
    }, u.label))) : null, waiting ? /*#__PURE__*/React.createElement("p", {
      className: "plg-timeline-pop-note plg-timeline-bl-wait",
      role: "status"
    }, MSG_BL_WAIT) : null, /*#__PURE__*/React.createElement("div", {
      className: "plg-timeline-bl-slots",
      role: "radiogroup",
      "aria-label": LBL.bl
    }, BL_SLOTS.map(n => {
      const e = slotsOf.get(n);
      // Hapus: hanya slot terisi yang TERBACA (record asing klien lebih baru tidak dihapus dari sini), kunci = lockedOf.
      const canDel = !!e && !e.foreign;
      return /*#__PURE__*/React.createElement("div", {
        key: n,
        className: "plg-timeline-bl-slot"
      }, /*#__PURE__*/React.createElement("button", {
        type: "button",
        role: "radio",
        "aria-checked": n === slot,
        disabled: lockedOf(n, unitKey),
        className: cx("plg-timeline-bl-opt", n === slot && "is-active"),
        onClick: () => setSlot(n)
      }, slotLabel(n)), canDel ? /*#__PURE__*/React.createElement("button", {
        type: "button",
        className: "plg-timeline-btn plg-timeline-bl-del",
        "aria-label": BL_DELETE + " " + blShownName(e, n),
        disabled: lockedOf(n, unitKey) || !!props.busy,
        onClick: () => setStep("delete", n)
      }, BL_DELETE) : null);
    })), /*#__PURE__*/React.createElement("input", {
      type: "text",
      className: "plg-timeline-pop-input plg-timeline-bl-name",
      "aria-label": BL_NAME_LABEL,
      maxLength: BL_NAME_MAX,
      value: shownName,
      onChange: e => setName(e && e.target ? String(e.target.value) : "")
    }));
  }
  let primary;
  if (step === "delete" && delEntry) {
    primary = /*#__PURE__*/React.createElement("button", {
      type: "button",
      className: "plg-timeline-btn plg-timeline-pv-apply",
      disabled: !!props.busy || lockedOf(delN, unitKey),
      onClick: remove
    }, BL_DELETE);
  } else if (step === "confirm" && entry) {
    primary = /*#__PURE__*/React.createElement("button", {
      type: "button",
      className: "plg-timeline-btn plg-timeline-pv-apply",
      disabled: !!props.busy,
      onClick: save
    }, BL_OVERWRITE);
  } else {
    primary = /*#__PURE__*/React.createElement("button", {
      type: "button",
      className: "plg-timeline-btn plg-timeline-pv-apply",
      disabled: locked || !!props.busy,
      onClick: submit
    }, LBL.blSave);
  }
  return /*#__PURE__*/React.createElement("div", {
    className: "plg-timeline-pv-backdrop"
  }, /*#__PURE__*/React.createElement("div", {
    className: "plg-timeline-pv plg-timeline-bl-dlg",
    role: "dialog",
    "aria-modal": "true",
    "aria-label": LBL.blSave,
    tabIndex: -1,
    ref: rootRef
  }, /*#__PURE__*/React.createElement("div", {
    className: "plg-timeline-pop-head"
  }, /*#__PURE__*/React.createElement("h3", {
    className: "plg-timeline-pop-title"
  }, LBL.blSave)), body, /*#__PURE__*/React.createElement("div", {
    className: "plg-timeline-pv-actions"
  }, /*#__PURE__*/React.createElement("button", {
    type: "button",
    className: "plg-timeline-btn",
    onClick: cancel
  }, PV_CANCEL), primary)));
}

// Kartu pratinjau ringkas di seksi Jadwal (R14, R20 "Aliran dari seksi > 20"): ringkasan + 5 baris pertama + "dan {n}
// lainnya", Batal / Terapkan (nonaktif bila 0 baris atau `busy`). Tanpa hooks dan tanpa tulis — pemanggil yang menulis
// (Terapkan = satu setMany lewat writeMany seksi). Props {model (dialogModel), onApply, onCancel, busy?}.
const PV_CARD_ROWS = 5;
function PreviewCard(props) {
  const model = props.model || EMPTY_PV_MODEL;
  const rows = model.rows || [];
  const rest = rows.length - PV_CARD_ROWS;
  const broken = Number.isInteger(model.brokenDeps) ? model.brokenDeps : 0;
  return /*#__PURE__*/React.createElement("div", {
    className: "plg-timeline-pvcard",
    role: "group",
    "aria-label": PV_FLOW
  }, /*#__PURE__*/React.createElement("p", {
    className: "plg-timeline-pv-summary"
  }, pvSummaryText(model)), broken > 0 ? /*#__PURE__*/React.createElement("p", {
    className: "plg-timeline-pop-note plg-timeline-pv-broken",
    role: "note"
  }, brokenText(broken)) : null, /*#__PURE__*/React.createElement("ul", {
    className: "plg-timeline-pv-list"
  }, rows.slice(0, PV_CARD_ROWS).map(r => /*#__PURE__*/React.createElement("li", {
    key: r.key,
    className: "plg-timeline-pv-row",
    "data-key": r.key
  }, /*#__PURE__*/React.createElement("span", {
    className: "plg-timeline-pv-main"
  }, pvRowText(r)), r.isNew ? /*#__PURE__*/React.createElement("span", {
    className: "plg-timeline-pv-tag"
  }, PV_NEW) : null, r.durChanged ? /*#__PURE__*/React.createElement("span", {
    className: "plg-timeline-pv-tag"
  }, PV_DUR) : null, r.durGuess ? /*#__PURE__*/React.createElement("span", {
    className: "plg-timeline-pv-note"
  }, PV_DUR_GUESS) : null))), rest > 0 ? /*#__PURE__*/React.createElement("p", {
    className: "plg-timeline-pvcard-more"
  }, "dan " + rest + " lainnya") : null, /*#__PURE__*/React.createElement("div", {
    className: "plg-timeline-pv-actions"
  }, /*#__PURE__*/React.createElement("button", {
    type: "button",
    className: "plg-timeline-btn",
    onClick: props.onCancel
  }, PV_CANCEL), /*#__PURE__*/React.createElement("button", {
    type: "button",
    className: "plg-timeline-btn plg-timeline-pv-apply",
    disabled: !rows.length || !!props.busy,
    onClick: props.onApply
  }, PV_APPLY)));
}

// Tampilan Daftar (HP, U3): task terjadwal urut Mulai dikelompokkan per minggu ISO, lalu "Belum dijadwalkan".
// Baris = tombol → onTaskClick(task). `cal` disediakan untuk kelengkapan antarmuka (tanggal sudah dihitung layout).
function weekText(mon, showYear) {
  const sun = mon + 6;
  const wk = TLCal.isoWeek(mon);
  const dm = n => {
    const p = TLCal.fmtShort(n).split(" ");
    return {
      d: p[1],
      m: p[2],
      y: TLCal.iso(n).slice(0, 4)
    };
  };
  const a = dm(mon);
  const b = dm(sun);
  let range;
  if (a.y !== b.y && showYear) range = a.d + " " + a.m + " " + a.y + "–" + b.d + " " + b.m + " " + b.y;else if (a.m !== b.m || a.y !== b.y) range = a.d + " " + a.m + "–" + b.d + " " + b.m + (showYear ? " " + b.y : "");else range = a.d + "–" + b.d + " " + a.m + (showYear ? " " + a.y : "");
  return "Mg " + wk.week + " · " + range;
}
function listMeta(r) {
  const s = TLCal.fmtShort(r.span.s);
  const f = TLCal.fmtShort(r.span.f);
  const hk = r.duration === null || r.duration === undefined ? "" : r.duration + " hk";
  if (r.kind === "task" && r.duration === 0) return {
    text: s + " · Milestone",
    aria: s + ", milestone"
  };
  const text = (r.span.s === r.span.f ? s : s + " → " + f) + (hk ? " · " + hk : "");
  const aria = (r.span.s === r.span.f ? s : s + " sampai " + f) + (hk ? ", " + r.duration + " hari kerja" : "");
  return {
    text,
    aria
  };
}
function ListFallback(props) {
  const rows = Array.isArray(props.rows) ? props.rows : [];
  const open = r => {
    if (typeof props.onTaskClick === "function") props.onTaskClick(r.task);
  };
  const sched = [];
  const unsched = [];
  for (const r of rows) {
    if (!r || r.kind === "group" || !r.task) continue;
    (r.span ? sched : unsched).push(r);
  }
  sched.sort((a, b) => a.span.s - b.span.s || a.index - b.index);
  const weeks = [];
  const byMon = new Map();
  for (const r of sched) {
    const mon = r.span.s - (TLCal.isoWeekday(r.span.s) - 1);
    let g = byMon.get(mon);
    if (!g) {
      g = {
        mon,
        rows: []
      };
      byMon.set(mon, g);
      weeks.push(g);
    }
    g.rows.push(r);
  }
  const years = new Set();
  for (const g of weeks) {
    years.add(TLCal.iso(g.mon).slice(0, 4));
    years.add(TLCal.iso(g.mon + 6).slice(0, 4));
  }
  const showYear = years.size > 1;
  const item = r => {
    const title = rowCells(r, "").name;
    const meta = r.span ? listMeta(r) : null;
    const late = r.span && r.late > 0;
    const aria = title + (meta ? ", " + meta.aria : ", belum dijadwalkan") + (late ? ", lewat tenggat" : "");
    return /*#__PURE__*/React.createElement("li", {
      key: r.key,
      className: "plg-timeline-li-item"
    }, /*#__PURE__*/React.createElement("button", {
      type: "button",
      className: cx("plg-timeline-li", r.kind === "summary" && "is-summary", r.done && "is-done"),
      "aria-label": aria,
      onClick: () => open(r)
    }, /*#__PURE__*/React.createElement("span", {
      className: "plg-timeline-li-title"
    }, title), meta ? /*#__PURE__*/React.createElement("span", {
      className: "plg-timeline-li-meta"
    }, meta.text) : null, late ? /*#__PURE__*/React.createElement("span", {
      className: "plg-timeline-li-late",
      role: "img",
      "aria-label": MSG_LATE
    }, "\uD83C\uDFC1") : null));
  };
  const sec = (key, head, items) => /*#__PURE__*/React.createElement("section", {
    key: key,
    className: "plg-timeline-li-sec",
    "aria-label": head
  }, /*#__PURE__*/React.createElement("h4", {
    className: "plg-timeline-li-head"
  }, head), /*#__PURE__*/React.createElement("ul", {
    className: "plg-timeline-li-list"
  }, items.map(item)));
  if (!weeks.length && !unsched.length) return /*#__PURE__*/React.createElement("div", {
    className: "plg-timeline-empty"
  }, MSG_EMPTY);
  return /*#__PURE__*/React.createElement("div", {
    className: "plg-timeline-list"
  }, weeks.map(g => sec("w" + g.mon, weekText(g.mon, showYear), g.rows)), unsched.length ? sec("u", MSG_UNSCHEDULED, unsched) : null);
}

// 4e'. Interaksi (Task 8; R13–R15, R21, R23). Satu pengendali per instance view (dibuat sekali, disimpan di ref) agar
// pendengar window selama seret selalu membaca nilai terkini lewat `X.cur` (layout, api, context) yang diisi tiap render.
// Aturan: TLDrag menentukan semuanya (zona, ambang, jepret, commit); komponen hanya menerjemahkan pointer → peristiwa,
// menulis transform/lebar bar + tooltip + garis karet lewat ref dalam rAF (tanpa setState selama gerak), dan menulis
// ext tepat SEKALI per lepas. Esc / pointercancel / blur / lepas di luar grafik = batal tanpa tulis.
//
// Nilai ext "efektif": setelah tulis, props bisa tertinggal sebentar (host memperbarui daftar setelah IndexedDB). Agar
// tombol Alt+panah yang ditahan atau seret berikutnya tidak menghitung dari props basi, nilai hasil tulis terakhir
// disimpan per task bersama JSON props saat itu; selama props masih sama dengan JSON itu, nilai hasil tulis yang dipakai.
const BLOCKED = Object.freeze({
  blocked: true
}); // penolakan pemeriksaan sebelum tulis (bukan galat simpan)

function createInteractions() {
  const X = {
    cur: null,
    chartEl: null,
    // elemen grafik terpasang (callback ref; pendengar touchmove tetap)
    tipRef: {
      current: null
    },
    rubberRef: {
      current: null
    },
    lineRef: {
      current: null
    },
    g: null,
    // gestur seret aktif
    slot: null,
    // gestur klik-jadwalkan aktif
    tap: null,
    // ketukan sentuh terakhir pada area kosong (ketuk ganda)
    busy: new Set(),
    // String(task.id) dengan tulis yang sedang berjalan
    inflight: new Map(),
    // String(task.id) → promise tulis berjalan (selalu resolve) untuk antrean Urungkan
    after: new Map(),
    // String(task.id) → {stale: JSON props saat tulis, eff: nilai ext setelah tulis}
    suppress: false // klik native setelah seret/batal tidak membuka task
  };
  const win = () => hasWindow() && typeof window.addEventListener === "function" ? window : null;
  const keyOf = task => String(task.id);
  const samePointer = (g, e) => g.pointerId === undefined || e.pointerId === undefined || e.pointerId === g.pointerId;
  const isPrimary = e => e.button === undefined || e.button === 0;
  const prevent = e => {
    if (e && typeof e.preventDefault === "function") e.preventDefault();
  };

  // Sentuh: peramban memutuskan gulir vs. tidak pada touchmove pertama yang bisa dibatalkan; pendengar yang baru dipasang
  // saat pointerdown sudah terlambat. Jadi SATU pendengar non-pasif tetap di elemen grafik selama elemen itu terpasang,
  // yang hanya memanggil preventDefault saat gestur sentuh sudah dipersenjatai (tekan lama) atau sedang menyeret.
  const onTouchMove = e => {
    const g = X.g;
    if (g && g.touch && (g.st.armed || g.st.phase === "drag") && e.cancelable !== false) prevent(e);
  };
  function setChart(el) {
    const old = X.chartEl;
    if (old === (el || null)) return;
    if (old && typeof old.removeEventListener === "function") old.removeEventListener("touchmove", onTouchMove, false);
    X.chartEl = el || null;
    if (el && typeof el.addEventListener === "function") el.addEventListener("touchmove", onTouchMove, {
      passive: false
    });
  }

  // Titik pointer dalam koordinat grafik (x = 0 di awal rentang; ikut gulir karena rect grafik ikut bergeser).
  function chartPt(e) {
    const el = X.chartEl;
    if (!el || typeof el.getBoundingClientRect !== "function") return null;
    const x = Number(e.clientX);
    const y = Number(e.clientY);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    const r = el.getBoundingClientRect();
    return {
      x: x - (Number(r.left) || 0),
      y: y - (Number(r.top) || 0)
    };
  }

  // Lepas "di dalam grafik" = di area grafik yang tampak (kanan tabel menempel, bawah header, di dalam wadah).
  function insideChart(e) {
    const el = X.cur && X.cur.scrollEl();
    if (!el || typeof el.getBoundingClientRect !== "function") return false;
    const r = el.getBoundingClientRect();
    const x = Number(e.clientX);
    const y = Number(e.clientY);
    return x >= r.left + X.cur.tableW && x <= r.right && y >= r.top + HEAD_H && y <= r.bottom;
  }
  function rowKeyAt(y) {
    const {
      lay,
      rowH
    } = X.cur;
    if (!(y >= 0)) return null;
    const r = lay.rows[Math.floor(y / rowH)];
    return r ? r.key : null;
  }
  function rawOf(task) {
    let props;
    try {
      props = X.cur.api.taskExt.read(task);
    } catch (e) {
      props = null;
    }
    if (!props || typeof props !== "object") props = {};
    const pj = JSON.stringify(props);
    const a = X.after.get(keyOf(task));
    if (a && a.stale === pj) return {
      eff: a.eff,
      pj
    };
    if (a) X.after.delete(keyOf(task));
    return {
      eff: props,
      pj
    };
  }
  const schedOf = raw => Object.assign(TLSched.readSched(raw), {
    raw
  });
  // ext efektif tanpa efek samping (rawOf membuang catatan `after` yang basi; pemeriksaan task lain tidak boleh).
  function peekRaw(task) {
    let props;
    try {
      props = X.cur.api.taskExt.read(task);
    } catch (e) {
      props = null;
    }
    if (!props || typeof props !== "object") props = {};
    const a = X.after.get(keyOf(task));
    return a && a.stale === JSON.stringify(props) ? a.eff : props;
  }

  // Daftar task LENGKAP untuk validasi sebelum tulis: context.scopeTasks host sudah difilter panel (prioritas,
  // penanggung jawab, cari), jadi dependensi ke task tersembunyi dan anak yang tersembunyi tidak terlihat di layout.
  function fullList() {
    const api = X.cur.api;
    return Promise.resolve().then(() => api.data.tasks.list({
      includeDone: true
    })).then(l => Array.isArray(l) ? l : []);
  }

  // Induk di daftar lengkap = ringkasan (R10): jadwalnya mengikuti subtask, tidak boleh digeser/diubah/dijadwalkan di 1b.
  // Resolve true = boleh tulis; false = ditolak (toast sudah tampil); reject = daftar gagal dimuat (tanpa tulis).
  function summaryGate(task) {
    const api = X.cur.api;
    return fullList().then(list => {
      if (!isSummaryIn(list, task)) return true;
      toastSafe(api, MSG_SUMMARY_SCHED, "error");
      return false;
    });
  }

  // Satu tulis (set, atau setMany untuk Urungkan). Penolakan diteruskan ke pemanggil. `gate` (opsional) = promise
  // pemeriksaan sebelum tulis: false → reject BLOCKED tanpa memanggil api. busy/after diisi SEKETIKA (tombol yang
  // ditahan dan seret berikutnya tidak menulis dari props basi selama pemeriksaan berjalan).
  function issue(task, rr, patch, many, gate) {
    const k = keyOf(task);
    const api = X.cur.api;
    X.busy.add(k);
    X.after.set(k, {
      stale: rr.pj,
      eff: Object.assign({}, rr.eff, patch)
    });
    const send = () => {
      try {
        return many ? api.taskExt.setMany([{
          taskId: task.id,
          patch
        }]) : api.taskExt.set(task.id, patch);
      } catch (e) {
        return Promise.reject(e);
      }
    };
    const p = gate ? Promise.resolve(gate).then(ok => {
      if (!ok) throw BLOCKED;
      return send();
    }) : send();
    const done = Promise.resolve(p).then(() => {
      X.busy.delete(k);
    }, err => {
      X.busy.delete(k);
      X.after.delete(k);
      throw err;
    });
    const settled = done.then(() => undefined, () => undefined);
    X.inflight.set(k, settled);
    settled.then(() => {
      if (X.inflight.get(k) === settled) X.inflight.delete(k);
    });
    return done;
  }
  function failed(api, err) {
    logWarn(api, "jadwal gagal disimpan:", err);
    toastSafe(api, MSG_SAVE_FAIL, "error");
  }

  // 1c-1 R13: banyak task dalam SATU api.taskExt.setMany. items = [{task, patch}]; semua kunci masuk busy/after
  // SEKETIKA (seret/tombol berikutnya tidak menulis dari props basi). Penolakan (err.applied) diteruskan ke pemanggil.
  // `gate` (opsional, pola issue) = promise pemeriksaan sebelum tulis: false → reject BLOCKED tanpa memanggil api.
  function issueMany(items, gate) {
    const api = X.cur.api;
    const list = (Array.isArray(items) ? items : []).filter(it => it && it.task && it.patch);
    const keys = [];
    for (const it of list) {
      const k = keyOf(it.task);
      const rr = rawOf(it.task);
      keys.push(k);
      X.busy.add(k);
      X.after.set(k, {
        stale: rr.pj,
        eff: Object.assign({}, rr.eff, it.patch)
      });
    }
    const send = () => {
      try {
        return api.taskExt.setMany(list.map(it => ({
          taskId: it.task.id,
          patch: it.patch
        })));
      } catch (e) {
        return Promise.reject(e);
      }
    };
    const p = gate ? Promise.resolve(gate).then(ok => {
      if (!ok) throw BLOCKED;
      return send();
    }) : send();
    const done = Promise.resolve(p).then(r => {
      for (const k of keys) X.busy.delete(k);
      return r;
    }, err => {
      for (const k of keys) {
        X.busy.delete(k);
        X.after.delete(k);
      }
      throw err;
    });
    const settled = done.then(() => undefined, () => undefined);
    for (const k of keys) X.inflight.set(k, settled);
    settled.then(() => {
      for (const k of keys) if (X.inflight.get(k) === settled) X.inflight.delete(k);
    });
    return done;
  }

  // Urungkan (R13): setMany(TLPlan.undoItems(items)) persis — kunci yang dulu tidak ada ditulis null.
  // Tulis lain pada salah satu task yang sama masih berjalan → Urungkan antre sampai semuanya selesai (pola undo 1b;
  // tulis tidak pernah tumpang tindih, tekan berikutnya tidak bisa mendarat setelah Urungkan dan menimpanya).
  function undoAction(api, items) {
    const run = () => {
      const waits = [];
      for (const it of items) {
        const k = keyOf(it.task);
        const w = X.busy.has(k) ? X.inflight.get(k) : null;
        if (w && waits.indexOf(w) < 0) waits.push(w);
      }
      if (waits.length) {
        Promise.all(waits).then(run);
        return;
      }
      const u = TLPlan.undoItems(items);
      issueMany(u.map((x, i) => ({
        task: items[i].task,
        patch: x.patch
      }))).catch(err => failed(api, err));
    };
    return {
      label: MSG_UNDO,
      onClick: run
    };
  }

  // applyPlan (R14/R15; pintu tunggal Terapkan untuk Task 8–10): satu setMany semua item → onDone (mis. setAuto sakelar,
  // HANYA setelah setMany sukses) → toast "Jadwal diterapkan · {n} task" + Urungkan. setMany ditolak dengan err.applied
  // (sebagian tersimpan) → onDone TIDAK dipanggil, toast "Sebagian jadwal gagal disimpan ({k} dari {n})" (k = gagal)
  // + Urungkan hanya untuk item yang tersimpan; tanpa applied / 0 tersimpan → "Jadwal gagal disimpan".
  // → Promise<boolean> (true = semua tersimpan dan onDone sukses); tidak pernah reject.
  // Task 9 (aliran gestur): opts.gate = pemeriksaan sebelum tulis (ditolak → false tanpa toast; toast sudah tampil),
  // opts.text = teks toast sukses ("Jadwal diubah · {n} task ikut bergeser"); bawaan "Jadwal diterapkan · {n} task".
  function applyPlan(items, opts) {
    const api = X.cur.api;
    const o = opts || {};
    const list = (Array.isArray(items) ? items : []).filter(it => it && it.task && it.patch);
    const n = list.length;
    const after = () => typeof o.onDone === "function" ? Promise.resolve().then(o.onDone) : Promise.resolve();
    if (!n) return after().then(() => true, err => {
      failed(api, err);
      return false;
    });
    return issueMany(list, o.gate).then(() => after().then(() => {
      toastSafe(api, typeof o.text === "string" ? o.text : appliedText(n), "success", undoAction(api, list));
      return true;
    }, err => {
      logWarn(api, "jadwal tersimpan, langkah lanjutan gagal:", err);
      toastSafe(api, MSG_SAVE_FAIL, "error", undoAction(api, list));
      return false;
    }), err => {
      if (err === BLOCKED) return false; // pemeriksaan sebelum tulis menolak (toast sudah tampil), 0 tulis
      const ids = err && Array.isArray(err.applied) ? new Set(err.applied.map(String)) : null;
      const saved = ids ? list.filter(it => ids.has(String(it.task.id))) : [];
      if (!saved.length) {
        failed(api, err);
        return false;
      }
      logWarn(api, "jadwal tersimpan sebagian:", err);
      toastSafe(api, partialText(n - saved.length, n), "error", undoAction(api, saved));
      return false;
    });
  }

  // set → toast "Jadwal diubah" + Urungkan (setMany nilai lama persis). Resolve true/false (tidak pernah reject).
  // Sebelum tulis: induk tersembunyi (ringkasan di daftar lengkap) ditolak, kecuali `checked` (link sudah memeriksa).
  function write(task, rr, patch, prev, checked) {
    const api = X.cur.api;
    return issue(task, rr, patch, false, checked ? null : summaryGate(task)).then(() => {
      toastSafe(api, MSG_CHANGED, "success", {
        label: MSG_UNDO,
        onClick: () => undo(task, prev)
      });
      return true;
    }, err => {
      if (err !== BLOCKED) failed(api, err);
      return false;
    });
  }

  // onClick Urungkan: runtime hanya menangkap lemparan sinkron, jadi penolakan setMany ditangani di sini.
  // Tulis lain pada task yang sama masih berjalan → Urungkan antre sampai selesai (tulis tidak pernah tumpang tindih).
  function undo(task, prev) {
    const api = X.cur.api;
    const wait = X.busy.has(keyOf(task)) ? X.inflight.get(keyOf(task)) : null;
    if (wait) {
      wait.then(() => undo(task, prev));
      return;
    }
    issue(task, rawOf(task), prev, true).catch(err => failed(api, err));
  }

  // ---- 1c-1 R12, R13 (K32, K33): SATU pintu tulis untuk seret, Alt+panah, klik-jadwalkan, dan tautkan ----
  // flow(task, rr, patch, prev, checked) → Promise<boolean> (true = tersimpan; false = tidak ada tulis atau gagal;
  // tidak pernah reject). `rr` = rawOf(task) saat gestur dimulai; `prev` = nilai lama 1b (TLDrag/tautkan);
  // `checked` = pemeriksaan ringkasan sudah dilakukan (tautkan).
  //  - Mesin belum siap/gagal: task otomatis menurut ext.mode + unit lokal (useUnits) → 0 tulis + "Jadwal gagal
  //    disimpan"; selain itu `write` 1b apa adanya.
  //  - Mesin siap: TLPlan.gesture (R12; terlalu awal → 0 tulis + "Tidak bisa lebih awal dari dependensinya") →
  //    TLPlan.cascade (K32: hanya gestur ∪ turunan yang DIGESER gestur; drift lain tidak pernah ikut) → item tanpa
  //    perubahan dibuang (flowItems). 0 item → diam. Item menyentuh task yang sedang ditulis → diabaikan (tanpa antre).
  //    Hanya task gestur → `write` 1b (patch 1b persis bila mesin tidak menambah apa pun, selain itu patch item +
  //    Urungkan = undoItems). Turunan > CASCADE_MAX → PreviewDialog (0 tulis sampai Terapkan). Selain itu applyPlan:
  //    satu setMany + "Jadwal diubah · {n} task ikut bergeser" + Urungkan (undoItems persis).
  function flow(task, rr, patch, prev, checked) {
    const api = X.cur.api;
    const eng = X.cur.eng;
    const k = keyOf(task);
    if (!eng || eng.status !== "ready" || !eng.ctx || !eng.result) {
      const un = X.cur.units;
      if (TLSched.modeOf(rr.eff, un && un.units, task) === "auto") {
        toastSafe(api, MSG_SAVE_FAIL, "error");
        return Promise.resolve(false);
      }
      return write(task, rr, patch, prev, checked);
    }
    // ext efektif (nilai optimistis tulis yang belum diikuti props); ada yang berlaku → hasil useEngine basi, hitung ulang.
    const ctx = Object.assign({}, eng.ctx, {
      readExt: peekRaw
    });
    const before = pendingIn(ctx.tasks) ? engine.run(ctx) : eng.result;
    const g = TLPlan.gesture(before, task, rr.eff, patch, ctx.cal);
    if (!g.ok) {
      toastSafe(api, MSG_EARLY, "error");
      return Promise.resolve(false);
    }
    const gestures = [{
      task,
      patch: g.patch
    }];
    const c = TLPlan.cascade(ctx, gestures, before);
    const items = flowItems(c.items);
    if (!items.length) return Promise.resolve(false);
    if (items.some(it => X.busy.has(it.key))) return Promise.resolve(false);
    const down = items.filter(it => it.key !== k).length;
    if (!down) {
      const it = items[0];
      const san = TLSched.sanitizePatch(patch);
      if (canonJson(it.patch) === canonJson(san.ok ? san.patch : patch)) return write(task, rr, patch, prev, checked);
      return write(task, rr, it.patch, TLPlan.undoItems([it])[0].patch, checked);
    }
    if (down > TLPlan.CASCADE_MAX) {
      if (typeof X.cur.openPreview === "function") X.cur.openPreview({
        items,
        result: c.result,
        before,
        ctx,
        gestures
      });
      return Promise.resolve(false);
    }
    return applyPlan(items, {
      gate: checked ? null : summaryGate(task),
      text: flowText(down)
    });
  }

  // Ada nilai optimistis (X.after) yang masih berlaku untuk task di ctx → hasil mesin useEngine belum memuatnya.
  function pendingIn(tasks) {
    if (!X.after.size) return false;
    for (const t of tasks) {
      const a = X.after.get(keyOf(t));
      if (a && peekRaw(t) === a.eff) return true;
    }
    return false;
  }
  function suppressClick() {
    X.suppress = true;
    setTimeout(() => {
      X.suppress = false;
    }, 0); // klik native menyusul pointerup dalam tugas yang sama
  }
  function openTask(row) {
    const ctx = X.cur && X.cur.context;
    if (row && row.task && ctx && typeof ctx.onTaskClick === "function") ctx.onTaskClick(row.task);
  }

  // ---- seret bar ----
  function barDown(row, e) {
    if (!e || X.g || !row || !row.task || row.kind === "summary" || !isPrimary(e)) return;
    const cur = X.cur;
    const lay = cur.lay;
    const box = boxOf(row, lay);
    const pt = chartPt(e);
    if (!box || !pt || X.busy.has(keyOf(row.task))) return;
    X.suppress = false;
    const touch = e.pointerType === "touch";
    const zone = TLDrag.hitZone({
      x: pt.x,
      barLeft: box.x,
      barWidth: box.milestone ? 0 : box.w,
      touch,
      armed: false
    });
    if (!zone) return;
    const kind = zone === "edge" ? "resize" : zone === "dot" ? "link" : "move";
    const rr = rawOf(row.task);
    const sched = schedOf(rr.eff);
    const st = TLDrag.start({
      kind,
      row,
      sched,
      pointer: pt,
      touch,
      t: nowMs(),
      px: lay.px
    });
    const s0 = TLCal.dn(sched.start);
    const geo = barGeom(row, box, cur.rowH);
    // x tanpa pangkas rentang (bar yang terpotong di awal rentang bergeser dari posisi sebenarnya)
    const xs = Number.isInteger(s0) ? TLLayout.xOf(s0, lay.range, lay.px) + (geo.ms ? lay.px / 2 - MS_SIZE / 2 : 0) : geo.x;
    const el = e.currentTarget && e.currentTarget.style ? e.currentTarget : null;
    X.g = {
      st,
      row,
      rr,
      box,
      geo,
      xs,
      el,
      painted: null,
      raf: 0,
      hold: 0,
      off: null,
      touch,
      pointerId: e.pointerId
    };
    listen(X.g);
    if (touch && !st.locked) X.g.hold = setTimeout(onHold, TLDrag.LONG_PRESS_MS);
  }
  function listen(g) {
    const w = win();
    if (!w) return;
    const move = e => onMove(e);
    const up = e => onUp(e);
    const cancel = () => {
      if (X.g) finish(TLDrag.reduce(X.g.st, {
        type: "cancel"
      }));
    };
    const key = e => {
      if (e.key !== "Escape" && e.key !== "Esc") return;
      prevent(e);
      if (typeof e.stopPropagation === "function") e.stopPropagation(); // Esc tidak menutup modal/Live Edit host
      cancel();
    };
    // sentuh: touchmove dicegah oleh pendengar tetap di elemen grafik (setChart); di sini hanya menu konteks tekan lama.
    const ctxm = e => prevent(e);
    w.addEventListener("pointermove", move);
    w.addEventListener("pointerup", up);
    w.addEventListener("pointercancel", cancel);
    w.addEventListener("keydown", key, true);
    w.addEventListener("blur", cancel);
    if (g.touch) w.addEventListener("contextmenu", ctxm);
    g.off = () => {
      w.removeEventListener("pointermove", move);
      w.removeEventListener("pointerup", up);
      w.removeEventListener("pointercancel", cancel);
      w.removeEventListener("keydown", key, true);
      w.removeEventListener("blur", cancel);
      if (g.touch) w.removeEventListener("contextmenu", ctxm);
    };
  }
  function onHold() {
    const g = X.g;
    if (!g) return;
    g.hold = 0;
    const zone = TLDrag.hitZone({
      x: g.st.x0,
      barLeft: g.box.x,
      barWidth: g.box.milestone ? 0 : g.box.w,
      touch: true,
      armed: true
    });
    g.st = TLDrag.reduce(g.st, {
      type: "hold",
      t: Math.max(nowMs(), g.st.t0 + TLDrag.LONG_PRESS_MS),
      kind: zone === "edge" ? "resize" : undefined
    });
  }
  function onMove(e) {
    const g = X.g;
    if (!g || !samePointer(g, e)) return;
    const pt = chartPt(e);
    if (!pt) return;
    let st = TLDrag.reduce(g.st, {
      type: "move",
      x: pt.x,
      y: pt.y,
      t: nowMs()
    });
    if (st.kind === "link" && st.phase === "drag") st = TLDrag.reduce(st, {
      type: "over",
      rowKey: rowKeyAt(pt.y)
    });
    g.st = st;
    if (st.phase === "scroll" || st.phase === "cancelled") {
      finish(st);
      return;
    }
    if (st.phase !== "drag") return;
    if (e.cancelable !== false) prevent(e);
    if (!g.raf) g.raf = raf(() => {
      g.raf = 0;
      paint(g);
    });
  }
  function onUp(e) {
    const g = X.g;
    if (!g || !samePointer(g, e)) return;
    const pt = chartPt(e);
    let st = g.st;
    if (pt && st.kind === "link" && st.phase === "drag") st = TLDrag.reduce(st, {
      type: "over",
      rowKey: rowKeyAt(pt.y)
    });
    st = TLDrag.reduce(st, {
      type: "up",
      x: pt ? pt.x : undefined,
      inside: insideChart(e),
      t: nowMs()
    });
    finish(st);
  }
  function paint(g) {
    if (X.g !== g) return;
    const st = g.st;
    if (st.kind === "link") {
      const svg = X.rubberRef.current;
      const ln = X.lineRef.current;
      if (svg && svg.style) svg.style.display = "";
      if (ln && typeof ln.setAttribute === "function") {
        ln.setAttribute("x1", st.x0);
        ln.setAttribute("y1", st.y0);
        ln.setAttribute("x2", st.x);
        ln.setAttribute("y2", st.y);
      }
      return;
    }
    const lay = X.cur.lay;
    const pv = TLDrag.preview(st, lay.cal, lay.range, st.px);
    if (!pv) return;
    const geo = g.geo;
    const x = st.kind === "move" ? g.xs + pv.dx : geo.x;
    const w = geo.ms ? geo.w : Math.max(1, st.kind === "move" ? pv.width : pv.width - (geo.x - g.xs));
    if (g.el) {
      g.el.style.transform = translate(x, geo.top);
      g.painted = g.el.style.transform; // dibaca ulang: peramban menormalkan nilai ("translate(1px, 2px)")
      if (!geo.ms) g.el.style.width = w + "px";
      if (g.el.classList) g.el.classList.add("is-dragging");
    }
    const tip = X.tipRef.current;
    if (tip && tip.style) {
      tip.textContent = pv.tooltip;
      tip.style.display = "";
      tip.style.transform = translate(x, geo.top >= 26 ? geo.top - 24 : geo.top + geo.h + 6);
    }
  }

  // Kembalikan bar ke posisi props — hanya bila React belum menimpanya dengan nilai baru.
  function restore(g) {
    const el = g.el;
    if (!el || g.painted === null || el.style.transform !== g.painted) return;
    el.style.transform = translate(g.geo.x, g.geo.top);
    if (!g.geo.ms) el.style.width = g.geo.w + "px";
  }
  function hideOverlay() {
    const tip = X.tipRef.current;
    if (tip && tip.style) tip.style.display = "none";
    const svg = X.rubberRef.current;
    if (svg && svg.style) svg.style.display = "none";
  }
  function finish(st) {
    const g = X.g;
    if (!g) return;
    X.g = null;
    g.st = st;
    if (g.off) g.off();
    if (g.hold) clearTimeout(g.hold);
    caf(g.raf);
    hideOverlay();
    if (g.el && g.el.classList) g.el.classList.remove("is-dragging");
    if (!(st.phase === "released" && st.click)) suppressClick();
    const res = TLDrag.commit(st, X.cur.lay.cal); // satu-satunya sumber patch: tepat satu tulis per lepas
    if (!res || res.link) {
      restore(g);
      if (res) link(res.link);
      return;
    }
    flow(g.row.task, g.rr, res.patch, res.prev).then(ok => {
      if (!ok) restore(g);
    });
  }

  // Dependensi baru (R15): kunci baris → task lewat indeks halaman; ringkasan tampak/di luar rentang ditolak seketika.
  // Lalu checkLink (sama dengan seksi Jadwal) terhadap daftar task LENGKAP — layout dibangun dari scopeTasks yang sudah
  // difilter panel host, jadi edge ke task tersembunyi (siklus) dan anak tersembunyi (ringkasan) hanya terlihat di sana.
  // Selama pemeriksaan penerus ditandai sibuk (satu penautan per penerus). Dependensi lama ditulis ulang apa adanya.
  function link(l) {
    const {
      api,
      lay
    } = X.cur;
    const scope = lay.rows.filter(r => r.task).map(r => r.task);
    const idx = TLSched.buildIndex(scope);
    const pred = idx.get(String(l.pred));
    const succ = idx.get(String(l.succ));
    if (!pred || !succ) return;
    const succRow = lay.rows.find(r => r.task === succ);
    if (!succRow) return;
    if (succRow.kind === "summary") {
      toastSafe(api, MSG_SUMMARY_DEP, "error");
      return;
    }
    const k = keyOf(succ);
    if (succRow.outOfRange || X.busy.has(k)) return;
    X.busy.add(k);
    const run = fullList().then(list => {
      X.busy.delete(k);
      const rr = rawOf(succ);
      const chk = checkLink(api, list, pred, succ, (t, isSucc) => isSucc ? rr.eff : peekRaw(t));
      if (!chk.ok) {
        if (LINK_MSG[chk.reason]) toastSafe(api, LINK_MSG[chk.reason], "error");
        return undefined;
      }
      const prev = {
        deps: rr.eff.deps === undefined ? null : rr.eff.deps
      };
      return flow(succ, rr, {
        deps: chk.deps
      }, prev, true);
    }, err => {
      X.busy.delete(k);
      failed(api, err);
    });
    // Urungkan pada penerus yang sama menunggu pemeriksaan + tulis ini (antrean yang sama dengan issue)
    const settled = run.then(() => undefined, () => undefined);
    X.inflight.set(k, settled);
    settled.then(() => {
      if (X.inflight.get(k) === settled) X.inflight.delete(k);
    });
  }

  // ---- klik-jadwalkan (R21): klik (mouse) / ketuk ganda (sentuh) di area kosong baris tanpa jadwal ----
  function slotDown(row, e) {
    if (!e || X.g || X.slot || !row || !row.task || !isPrimary(e)) return;
    const pt = chartPt(e);
    const w = win();
    if (!pt || !w) return;
    const s = {
      row,
      pt,
      x: Number(e.clientX),
      y: Number(e.clientY),
      touch: e.pointerType === "touch",
      pointerId: e.pointerId,
      off: null
    };
    const up = ev => slotUp(s, ev);
    const cancel = () => slotEnd(s);
    w.addEventListener("pointerup", up);
    w.addEventListener("pointercancel", cancel);
    s.off = () => {
      w.removeEventListener("pointerup", up);
      w.removeEventListener("pointercancel", cancel);
    };
    X.slot = s;
  }
  function slotEnd(s) {
    if (X.slot !== s) return;
    X.slot = null;
    if (s.off) s.off();
  }
  function slotUp(s, ev) {
    if (X.slot !== s || !samePointer(s, ev)) return;
    slotEnd(s);
    const slop = s.touch ? TLDrag.TOUCH_SLOP_PX : TLDrag.THRESHOLD_PX;
    if (Math.hypot(Number(ev.clientX) - s.x, Number(ev.clientY) - s.y) >= slop || !insideChart(ev)) {
      X.tap = null;
      return;
    }
    if (s.touch) {
      const t = nowMs();
      const last = X.tap;
      X.tap = {
        key: s.row.key,
        t,
        x: s.x,
        y: s.y
      };
      if (!last || last.key !== s.row.key || t - last.t > DOUBLE_TAP_MS || Math.hypot(s.x - last.x, s.y - last.y) > DOUBLE_TAP_PX) return;
      X.tap = null;
    }
    const {
      lay
    } = X.cur;
    const dn = TLLayout.dnAt(s.pt.x, lay.range, lay.px);
    if (dn < lay.range.from || dn > lay.range.to || X.busy.has(keyOf(s.row.task))) return;
    const rr = rawOf(s.row.task);
    const r = TLDrag.scheduleAt(lay.cal, dn, schedOf(rr.eff));
    if (r) flow(s.row.task, rr, r.patch, r.prev);
  }

  // ---- keyboard (R23): Enter buka; Alt+←/→ geser 1 hk (milestone 1 hari kalender); Alt+Shift+←/→ durasi ±1; satu set per tekan ----
  function key(row, e) {
    if (!e) return;
    if (e.key === "Enter") {
      prevent(e);
      openTask(row);
      return;
    }
    if (!e.altKey || e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    prevent(e); // Alt+← = "kembali" di peramban
    if (!row || !row.task || row.kind !== "task" || X.g) return;
    if (X.busy.has(keyOf(row.task))) return; // tombol ditahan: abaikan selama tulis sebelumnya belum selesai
    const rr = rawOf(row.task);
    const r = TLDrag.keyStep({
      key: e.key,
      alt: true,
      shift: !!e.shiftKey
    }, schedOf(rr.eff), X.cur.lay.cal);
    if (!r) return;
    const from = e.currentTarget || null;
    flow(row.task, rr, r.patch, r.prev).then(() => raf(() => refocus(row.key, from)));
  }

  // Render ulang setelah tulis bisa memasang ulang bar/baris (virtualisasi): fokus kembali ke elemen dengan data-key dan
  // role yang sama, hanya bila fokus hilang (elemen lama terlepas atau fokus jatuh ke body).
  function refocus(key, from) {
    const doc = typeof document !== "undefined" ? document : null;
    if (!doc) return;
    const active = doc.activeElement;
    const lost = !active || active === doc.body || from && from.isConnected === false && active === from;
    if (!lost) return;
    const root = X.cur && X.cur.scrollEl();
    if (!root || typeof root.querySelectorAll !== "function") return;
    const role = from && typeof from.getAttribute === "function" ? from.getAttribute("role") : null;
    const list = root.querySelectorAll("[data-key]");
    for (let i = 0; i < list.length; i++) {
      const n = list[i];
      if (n.getAttribute("data-key") !== String(key) || role && n.getAttribute("role") !== role) continue;
      try {
        n.focus({
          preventScroll: true
        });
      } catch (err) {
        /* elemen tidak bisa difokus */
      }
      return;
    }
  }
  function open(row) {
    if (X.suppress) {
      X.suppress = false;
      return;
    }
    openTask(row);
  }
  function dispose() {
    if (X.g) finish(TLDrag.reduce(X.g.st, {
      type: "cancel"
    }));
    if (X.slot) slotEnd(X.slot);
    X.tap = null;
    setChart(null);
  }
  X.ix = {
    open,
    key,
    barDown,
    slotDown,
    chartRef: setChart,
    tipRef: X.tipRef,
    rubberRef: X.rubberRef,
    lineRef: X.lineRef
  };
  X.dispose = dispose;
  X.issueMany = issueMany;
  X.applyPlan = applyPlan;
  return X;
}

// 4e. View Gantt (slot taskList.views, id "gantt").
// Interaksi (Task 8) = objek `ix` dari createInteractions (open/key/barDown/slotDown + ref grafik/tooltip/garis karet).
function TimelineViewBody(props) {
  const context = props.context || {};
  const api = props.api;
  const page = context.page || "";
  const narrow = useMedia(MQ_NARROW);
  const touch = useMedia(MQ_COARSE);
  const [zoom, setZoomPref] = usePref(api, "zoom", page);
  const [sort, setSort] = usePref(api, "sort", page);
  const [cols, setCols] = usePref(api, "cols", page);
  const [mode, setMode] = usePref(api, "mode", page);
  const [critPref, setCrit] = usePref(api, "crit", page);
  const [blPref, setBl] = usePref(api, "bl", page); // 1c-2 P2 (a): baseline aktif = pref per perangkat per halaman
  const [loadPref, setLoadOn] = usePref(api, "load", page); // 1d-1 (K56, R10): panel Beban Tim, bawaan OFF
  const [calOpen, setCalOpen] = React.useState(false);
  const calBtnRef = React.useRef(null);
  const pageKind = context.pageKind === "workspace" ? "workspace" : "project";
  const target = React.useMemo(() => calTarget(pageKind === "workspace" ? context.listId : null), [pageKind, context.listId]);
  const cal = useCalendar(api, target);
  const today = safeToday(api);
  const todayDn = today ? TLCal.dn(today) : null;
  const calKey = React.useMemo(() => JSON.stringify(cal.data), [cal.data]);
  // 1c-1 (R6, R7): unit jadwal halaman + mesin CPM sesudah gambar pertama. Hasilnya dipakai Task 7–10 (Slack, kritis,
  // banner, sakelar, aliran gestur lewat X.cur.eng); keduanya hanya membaca — tidak ada tulisan latar (R25).
  const un = useUnits(api, {
    pageKind,
    listId: context.listId,
    projectName: context.projectName
  });
  const eng = useEngine(api, {
    scopeTasks: context.scopeTasks,
    calData: cal.data,
    units: un.units
  });
  // 1d-1 Task 3 (R4, R10, K56): panel Beban Tim — kapasitas/cuti dimuat (useResources) dan beban dihitung (useLoad) HANYA
  // saat pref load:<page> menyala; baris orang dari data yang ada (peopleOf, P2 (a)). Hanya baca (R25). Dipakai toolbar
  // (setLoadOn, T4), panel (load, T5–T6), dan editor kapasitas (resources: map/pulled/store, T7).
  const loadOn = loadPref === true;
  const resources = useResources(api, pageKind, context.listId, loadOn);
  const meUid = TLLoad.uidOf(api.env ? api.env.userId : null);
  const engTasks = eng.ctx ? eng.ctx.tasks : NO_TASKS;
  const people = React.useMemo(() => loadOn ? peopleOf({
    byAssignee: pageKind === "workspace",
    ctxTasks: engTasks,
    resources: resources.map,
    currentUser: context.currentUser,
    collaborators: context.collaborators,
    userId: meUid
  }) : NO_PEOPLE, [loadOn, pageKind, engTasks, resources.map, context.currentUser, context.collaborators, meUid]);
  // Review akhir: beban dihitung setelah kapasitas/cuti termuat atau gagal dimuat (tanpa kilatan kapasitas bawaan).
  // Workspace tanpa listId sah tidak pernah memuat (scope null) → langsung siap dengan kapasitas bawaan, bertanda.
  const resNoScope = resScopeOf(pageKind, context.listId) === null;
  const resReady = resources.loaded || resources.failed || resNoScope;
  const capMissing = loadOn && !resources.loaded && (resources.failed || resNoScope);
  const load = useLoad({
    open: loadOn,
    ready: resReady,
    eng,
    people,
    todayDn,
    byAssignee: pageKind === "workspace",
    ownerUid: meUid,
    api
  });
  // 1d-1 Task 7: bundel kapasitas untuk ResourceEditor (panel desktop / daftar HP) — memo agar prop memo panel stabil.
  const resEd = React.useMemo(() => loadOn ? {
    map: resources.map,
    loaded: resources.loaded,
    pulled: resources.pulled,
    store: resources.store,
    pageKind,
    listId: context.listId,
    currentUser: context.currentUser,
    collaborators: context.collaborators,
    userId: meUid,
    api
  } : null, [loadOn, resources.map, resources.loaded, resources.pulled, resources.store, pageKind, context.listId, context.currentUser, context.collaborators, meUid, api]);
  const engResult = eng.status === "ready" ? eng.result : null;
  // 1c-2 (K30): resolver jangkar untuk rentang pelanggaran task berjalan via actual.start (layout langkah 7) — SUMBER yang
  // sama dengan mesin: modeOf = TLSched.modeOf(readSched(ext), useUnits().units, task); inCycle = engResult.cycles;
  // inEngine/durOf = engResult.nodes (simpul + durasi mesin, untuk task tanpa Mulai). Mesin belum siap → inCycle false dan
  // inEngine false (jendela muat: task tanpa Mulai dilewati, sama seperti 1c-1). Kunci unit (auto+fold), anggota lingkaran
  // dan simpul tanpa-Mulai ikut memicu tata letak ulang HANYA bila scope punya task belum selesai dengan actual.start
  // (satu-satunya pemakai resolver); tanpa itu `lay` tetap tidak bergantung pada mesin/unit (perilaku 1c-1).
  // Satu bacaan ext per task per scopeTasks (investigasi regresi render 1c-2): api.taskExt.read runtime menyalin dalam
  // (JSON) tiap kunci; tata letak, anchorTasks, dan actualOverlay BERBAGI bacaan ini (sebelumnya 3 bacaan/task pada render
  // pertama). Berkunci [scopeTasks, api] — sama dengan masa hidup task objek scope; bacaan gagal → {} + log (readExtSafe).
  // Bacaan bersama hanya dibaca (readSched/actualOf membangun objek baru), tidak pernah diubah.
  const extOf = React.useMemo(() => {
    const memo = new Map();
    return t => {
      let raw = memo.get(t);
      if (raw === undefined) {
        raw = readExtSafe(api, t);
        memo.set(t, raw);
      }
      return raw;
    };
  }, [context.scopeTasks, api]);
  const anchorTasks = React.useMemo(() => {
    const out = []; // [{key, startless}]
    for (const t of Array.isArray(context.scopeTasks) ? context.scopeTasks : []) {
      if (!t || t.gtd_status === "done" || t.completed_at) continue;
      const raw = extOf(t);
      if (TLSched.actualOf(t, raw).start === null) continue;
      out.push({
        key: String(t.id),
        startless: TLSched.readSched(raw).start === null
      });
    }
    return out;
  }, [context.scopeTasks, extOf]);
  const needsAnchor = anchorTasks.length > 0;
  const unitsKey = needsAnchor ? unitsKeyOf(un.units) : "";
  const cycleKey = needsAnchor && engResult && Array.isArray(engResult.cycles) ? [].concat(...engResult.cycles).map(String).sort().join("\u0000") : "";
  const nodeKey = needsAnchor && engResult && engResult.nodes instanceof Map ? anchorTasks.filter(x => x.startless && engResult.nodes.has(x.key)).map(x => x.key + "\u0001" + engResult.nodes.get(x.key).d).join("\u0000") : "";

  // R24: tata letak hanya bila task scope / kalender / zoom / urut / hari / unit / lingkaran berubah (bukan tiap context baru).
  const lay = React.useMemo(() => {
    const readSchedOf = t => TLSched.readSched(extOf(t));
    const units = un.units;
    const ring = new Set(cycleKey ? cycleKey.split("\u0000") : []);
    const nd = new Map(nodeKey ? nodeKey.split("\u0000").map(x => x.split("\u0001")).map(([k, d]) => [k, Number(d)]) : []);
    return engine.layout({
      tasks: Array.isArray(context.scopeTasks) ? context.scopeTasks : [],
      pageKind,
      sort,
      cal: cal.data,
      today,
      zoom,
      readSchedOf,
      anchorInfo: {
        modeOf: t => TLSched.modeOf(readSchedOf(t), units, t),
        inCycle: k => ring.has(String(k)),
        inEngine: k => nd.has(String(k)),
        durOf: k => nd.get(String(k))
      }
    });
  }, [context.scopeTasks, calKey, zoom, sort, today, pageKind, extOf, unitsKey, cycleKey, nodeKey]);
  const groupNames = React.useMemo(() => new Map(lay.groups.map(g => [g.key, g.name])), [lay]);
  // 1c-2 Task 5 (K41): baseline unit halaman — halaman project = satu unit, workspace = unit per kelompok (pageUnits);
  // SATU pemuat se-scope untuk semua unit (useBaselines larik). blDec = baseline aktif tergabung (activeBaseline) — sumber
  // pembanding T6 (bar, lewat v.bl) dan T7; hanya baca (R25).
  const blPage = React.useMemo(() => pageUnits(lay, pageKind, context.projectName, groupNames), [lay, pageKind, context.projectName, groupNames]);
  // 1d-2 Task 4 (R2): unit DAFTAR LENGKAP mesin (eng.ctx.tasks) untuk earned value/ekspor. Pemuat baseline tetap SATU list
  // se-scope: unit halaman (urutan kelompok, unit pertama = bentuk satu unit useBaselines) + unit daftar lengkap yang
  // tersaring panel (scope sama). Tanpa filter keduanya sama → kunci muat tidak berubah saat mesin siap.
  const evUnits = React.useMemo(() => taskUnits(engTasks), [engTasks]);
  const blUnitsAll = blPage.map(x => x.unit);
  for (const u of evUnits) {
    if (blUnitsAll.some(x => x.recId === u.recId)) continue;
    if (!blUnitsAll.length || blUnitsAll[0].scope === u.scope) blUnitsAll.push(u);
  }
  const bls = useBaselines(api, blUnitsAll);
  const blIdsKey = blPage.map(x => x.unit.recId).join("\u0000");
  const blDec = React.useMemo(() => activeBaseline(bls.byUnit, blPage.map(x => x.unit.recId), blPref), [bls.byUnit, blIdsKey, blPref]);
  // Baseline aktif atas unit daftar lengkap (R2): kunci baris memuat s/f/d/w sehingga muat ulang baseline tanpa perubahan
  // isi (identitas byUnit baru) tidak menghitung EV ulang. Nama: blNameFor.
  const evIds = evUnits.map(u => u.recId);
  const evIdsKey = evIds.join("\u0000");
  const evBl = React.useMemo(() => activeBaseline(bls.byUnit, evIds, blPref), [bls.byUnit, evIdsKey, blPref]);
  const evName = React.useMemo(() => evBl ? blNameFor(bls.byUnit, evIds, evBl.n) : "", [bls.byUnit, evIdsKey, evBl]);
  const blRowsKey = React.useMemo(() => {
    if (!evBl) return "";
    const out = [];
    for (const [k, r] of evBl.rows) out.push([k, r.s, r.f, r.d, r.w]);
    return evBl.n + "\u0000" + JSON.stringify(out);
  }, [evBl]);
  // 1c-1 (R18, R19): overlay mesin dalam memo TERPISAH. Belum siap → NO_OVERLAY.
  // eng.ctx berasal dari keluaran run yang sama dengan eng.result, jadi kunci [lay, engResult] cukup.
  const ov = React.useMemo(() => engineOverlay(lay, engResult, eng.ctx), [lay, engResult]);
  const crit = critPref === true && ov.ready;
  // 1c-2 Task 6: overlay baseline + aktual, masing-masing memo TERPISAH dari `lay` (pola R18/R19): pref baseline / data
  // baseline hanya menghitung ulang blOv; actOv mengikuti lay (task scope + ext) dan hari ini (garis berjalan, tanpa tulisan).
  const blOv = React.useMemo(() => baselineOverlay(blDec, engResult, eng.ctx), [blDec, engResult]);
  const actOv = React.useMemo(() => actualOverlay(lay, extOf, todayDn), [lay, extOf, todayDn]);
  const legendX = {
    bl: blOv !== null && blDec !== null && blDec.rows.size > 0,
    act: actOv.size > 0
  };
  // 1d-2 Task 4 (R1, R2, R10; K51, K57): earned value 🍅 dari baseline aktif — dihitung (engine.ev = satu pintu TLLoad.ev)
  // HANYA setelah mesin siap (render awal tidak berubah), atas daftar lengkap + kalender + hasil mesin yang sama, hari ini.
  // Memo [engResult, eng.ctx, blRowsKey, todayDn]: pilihan/isi baseline, data mesin, atau hari berganti → hitung ulang.
  // Tanpa baseline aktif / tanpa baris / BAC 0 (ev → null) → null (ringkasan tidak dirender). Lempar → null + satu
  // peringatan. Hanya baca (R25).
  const evWarned = React.useRef(false);
  const evRes = React.useMemo(() => {
    if (!engResult || !eng.ctx || !Number.isInteger(todayDn) || !evBl || evBl.rows.size === 0) return null;
    try {
      return engine.ev(evBl, {
        tasks: eng.ctx.tasks,
        cal: eng.ctx.cal,
        result: engResult
      }, todayDn);
    } catch (e) {
      if (!evWarned.current) {
        evWarned.current = true;
        logWarn(api, "earned value gagal dihitung:", e);
      }
      return null;
    }
  }, [engResult, eng.ctx, blRowsKey, todayDn]);
  const evView = React.useMemo(() => evRes && evRes.bac > 0 ? {
    text: TLLoad.evText(evRes),
    tip: TLLoad.evTip(evRes, evName)
  } : null, [evRes, evName]);
  const compact = narrow || !!context.liveEdit;
  const colDefs = !compact || cols ? COLS_FULL : COLS_COMPACT;
  let tableW = 0;
  for (const c of colDefs) tableW += c.w;
  const rowH = touch ? TLLayout.ROW_H_TOUCH : TLLayout.ROW_H;
  const hasRows = lay.stats.tasks > 0;
  const listMode = narrow && mode === "list";

  // Jendela tampak (R11): top/left hanya diperbarui saat baris pertama / jangkar kolom (½ layar) berubah.
  const [vp, setVp] = React.useState({
    top: 0,
    left: null,
    w: VIEW_W0,
    h: VIEW_H0,
    boxH: VIEW_H0 + HEAD_H
  });
  const scrollRef = React.useRef(null);
  const footRef = React.useRef(null);
  const rafRef = React.useRef(0);
  const prevLayRef = React.useRef(null);
  const anchorRef = React.useRef(null); // dn yang dipertahankan di tengah setelah zoom
  const userScrolledRef = React.useRef(false);
  const setLeftRef = React.useRef(null);
  const lastElRef = React.useRef(null); // elemen wadah terakhir yang dikenal (deteksi pasang ulang)
  const rowHRef = React.useRef(rowH);
  rowHRef.current = rowH;
  // 1d-1 Task 5 (R5): panel Beban Tim — isi grafiknya (trackRef) digeser translateX(−scrollLeft) LANGSUNG dari handler
  // gulir di bawah (tanpa setState per piksel); akarnya (loadBoxRef) diukur seperti legenda. getLeft stabil (prop memo).
  const loadTrackRef = React.useRef(null);
  const loadBoxRef = React.useRef(null);
  const getLeft = React.useRef(() => scrollRef.current ? Number(scrollRef.current.scrollLeft) || 0 : 0).current;
  // Review akhir: lebar area grafik SAAT INI (clientWidth wadah − tableW), dibaca langsung — vp.w bisa basi bila wadah host
  // beranimasi saat Timeline dipasang (pra-ada 1c). Tanpa wadah → NaN (panel memakai viewW). Stabil (prop memo).
  const tableWRef = React.useRef(tableW);
  tableWRef.current = tableW;
  const getViewW = React.useRef(() => {
    const el = scrollRef.current;
    return el ? (Number(el.clientWidth) || 0) - tableWRef.current : NaN;
  }).current;
  const syncLoadLeft = left => {
    const t = loadTrackRef.current;
    if (t && t.style) t.style.transform = loadShift(left);
  };
  const loadShown = loadOn && load !== null && !narrow; // ≤ 640 px: daftar HP (Task 8) menggantikan histogram
  const loadRowsN = loadShown ? load.rows.length : 0;
  // 1d-1 Task 8: daftar HP (Gantt maupun Daftar) — akarnya memakai loadBoxRef yang sama (diukur seperti panel desktop).
  const loadMShown = loadOn && load !== null && narrow;
  const loadMKey = loadMShown ? load.rows.length + ":" + load.rows.reduce((s, r) => s + r.overDays.length, 0) : "";
  // Review T4–T6 I1b/M2: daftar "Hari kelebihan beban" panel desktop terbuka — statusnya di sini agar tinggi wadah diukur
  // ulang saat dibuka/ditutup; teks judul panel juga memicu ukur ulang (bisa membungkus jadi lebih tinggi/rendah).
  const [loadDaysOpen, setLoadDaysOpen] = React.useState(false);
  const loadHead = loadShown || loadMShown ? loadHeadText(load, capMissing) : "";
  // Review akhir I1: menyalakan Beban Tim lewat GESTUR (tombol toolbar / item "Lainnya" — keduanya lewat toggleLoad)
  // menandai wantRevealRef; setelah panel desktop / daftar HP terpasang (loadBoxRef ada, efek sesudah render) akarnya
  // digulir ke layar SEKALI (scrollIntoView {block: "nearest"}) pada frame berikut — sesudah ukur ulang tinggi wadah Gantt
  // (setState di efek tata letak) agar posisi akhir yang dipakai. Di HP daftar berada di bawah seluruh Gantt/Daftar dan
  // tanpa ini hanya judulnya (atau tidak sama sekali) yang tampak. Pref tersimpan saat dipasang, mematikan, dan render
  // ulang biasa (sinkron) tidak menggulir. Mematikan sebelum terpasang → batal (toggleLoad(false)); hasil ada tetapi
  // halaman tanpa baris (panel tidak dirender) → batal. Penanda TIDAK dilepas karena loadOn false di efek: efek pasif
  // commit sebelum klik bisa baru berjalan sesudah klik (React menjalankannya sebelum render berikut) dengan nilai lama.
  const wantRevealRef = React.useRef(false);
  const revealRafRef = React.useRef(0);
  const toggleLoad = on => {
    wantRevealRef.current = on === true;
    setLoadOn(on);
  };
  React.useEffect(() => {
    if (!wantRevealRef.current) return;
    if (!loadBoxRef.current) {
      if (load !== null && !hasRows) wantRevealRef.current = false;
      return;
    }
    wantRevealRef.current = false;
    caf(revealRafRef.current);
    revealRafRef.current = raf(() => {
      revealRafRef.current = 0;
      revealLoadBox(loadBoxRef.current);
    });
  });
  React.useEffect(() => () => caf(revealRafRef.current), []);
  const sl = vp.left === null ? TLLayout.initialScrollLeft(lay.range, lay.px, today, vp.w) : vp.left;
  const rw = TLLayout.windowRows(lay.rows.length, vp.top, vp.h + ROW_STEP * rowH, rowH);
  const dw = TLLayout.windowDays(lay.range, lay.px, sl, vp.w);
  const chartW = TLLayout.widthOf(lay.range, lay.px);
  const rowsH = lay.rows.length * rowH;
  const bodyH = Math.max(rowsH, vp.h); // latar (akhir pekan, libur, hari ini) mengisi wadah walau baris sedikit

  const applyLeft = (el, x) => {
    el.scrollLeft = Math.max(0, Math.round(x));
    setLeftRef.current = el.scrollLeft;
    syncLoadLeft(el.scrollLeft);
    const left = el.scrollLeft;
    setVp(p => p.left === quantLeft(left, p.w) ? p : Object.assign({}, p, {
      left: quantLeft(left, p.w)
    }));
  };

  // Ukur tinggi wadah (R11: max(360, innerHeight − rect.top − 16), dikurangi tinggi legenda — dan panel Beban Tim bila
  // terbuka (1d-1) — di bawahnya agar keduanya tetap terlihat) dan lebar grafik tampak. Selalu membaca elemen terkini
  // (bukan yang ditangkap saat efek dipasang).
  const measure = () => {
    const el = scrollRef.current;
    if (!el || !hasWindow()) return;
    const rect = el.getBoundingClientRect();
    const footH = footRef.current ? footRef.current.offsetHeight || 0 : 0;
    const loadH = loadBoxRef.current ? loadBoxRef.current.offsetHeight || 0 : 0;
    const boxH = Math.max(MIN_BOX_H, Math.floor((window.innerHeight || 0) - rect.top - BOX_GAP - footH - loadH));
    const w = Math.max(0, el.clientWidth - tableW);
    setVp(p => p.boxH === boxH && p.w === w ? p : Object.assign({}, p, {
      boxH,
      h: Math.max(0, boxH - HEAD_H),
      w
    }));
  };

  // Wadah gulir baru (pertama kali, atau dipasang ulang setelah keadaan kosong / Daftar → Gantt): elemen baru mulai di
  // scrollTop/Left 0 tanpa event scroll, jadi jendela lama (top/left) dibuang dan logika "pertama dibuka" berlaku lagi
  // (hari ini di 1/3). Tanpa deps: berjalan tiap commit, murah (satu perbandingan).
  React.useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el === lastElRef.current) return;
    lastElRef.current = el;
    if (!el) return;
    userScrolledRef.current = false;
    anchorRef.current = null;
    prevLayRef.current = lay;
    measure();
    el.scrollLeft = Math.max(0, Math.round(TLLayout.initialScrollLeft(lay.range, lay.px, today, vp.w)));
    setLeftRef.current = el.scrollLeft;
    syncLoadLeft(el.scrollLeft);
    const top = quantTop(el.scrollTop || 0, rowH);
    const left = el.scrollLeft;
    setVp(p => {
      const ql = quantLeft(left, p.w);
      return p.top === top && p.left === ql ? p : Object.assign({}, p, {
        top,
        left: ql
      });
    });
  });
  React.useLayoutEffect(() => {
    if (!scrollRef.current || !hasWindow()) return undefined;
    measure();
    let id = 0;
    const onResize = () => {
      if (id) return;
      id = raf(() => {
        id = 0;
        measure();
      });
    };
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      caf(id);
    };
  }, [tableW, hasRows, listMode, loadShown, loadRowsN, loadMKey, loadHead, loadDaysOpen]);

  // Posisi gulir horizontal (R22): pertama kali / belum digulir pengguna → hari ini di 1/3; zoom atau rentang bergeser →
  // tanggal di tengah layar dipertahankan.
  React.useLayoutEffect(() => {
    const el = scrollRef.current;
    const prev = prevLayRef.current;
    prevLayRef.current = lay;
    if (!el) return;
    const anchor = anchorRef.current;
    anchorRef.current = null;
    if (anchor !== null) applyLeft(el, TLLayout.xOf(anchor, lay.range, lay.px) + lay.px / 2 - vp.w / 2);else if (!userScrolledRef.current) applyLeft(el, TLLayout.initialScrollLeft(lay.range, lay.px, today, vp.w));else if (prev && (prev.px !== lay.px || prev.range.from !== lay.range.from)) {
      const center = TLLayout.dnAt(el.scrollLeft + vp.w / 2, prev.range, prev.px);
      applyLeft(el, TLLayout.xOf(center, lay.range, lay.px) + lay.px / 2 - vp.w / 2);
    }
  }, [lay, vp.w, hasRows, listMode]);
  React.useEffect(() => () => caf(rafRef.current), []);
  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    syncLoadLeft(el.scrollLeft); // R5: panel Beban Tim mengikuti gulir horizontal di event yang sama (tanpa setState)
    if (setLeftRef.current === null || Math.abs(el.scrollLeft - setLeftRef.current) > 1) userScrolledRef.current = true;
    if (rafRef.current) return;
    rafRef.current = raf(() => {
      rafRef.current = 0;
      const e2 = scrollRef.current;
      if (!e2) return;
      const h = rowHRef.current;
      const top = quantTop(e2.scrollTop, h);
      const left = e2.scrollLeft;
      setVp(p => {
        const ql = quantLeft(left, p.w);
        if (p.top === top && p.left === ql) return p;
        return Object.assign({}, p, {
          top,
          left: ql
        });
      });
    });
  };
  const pickZoom = z => {
    if (z === zoom) return;
    const el = scrollRef.current;
    if (el) anchorRef.current = TLLayout.dnAt(el.scrollLeft + vp.w / 2, lay.range, lay.px);
    setZoomPref(z);
  };
  const goToday = () => {
    const el = scrollRef.current;
    if (!el) return;
    userScrolledRef.current = false;
    applyLeft(el, TLLayout.initialScrollLeft(lay.range, lay.px, today, vp.w));
  };
  const isSel = t => {
    try {
      return typeof context.isSelected === "function" && !!context.isSelected(t);
    } catch (e) {
      return false;
    }
  };
  const ctlRef = React.useRef(null);
  if (!ctlRef.current) ctlRef.current = createInteractions();
  const ctl = ctlRef.current;
  ctl.cur = {
    api,
    context,
    lay,
    rowH,
    tableW,
    scrollEl: () => scrollRef.current,
    eng,
    units: un
  };
  React.useEffect(() => () => ctl.dispose(), [ctl]);
  const ix = ctl.ix;

  // ── 1c-1 Task 8: sakelar Jadwal otomatis (R15), pratinjau + CAS (R14) ──
  const [unitOpen, setUnitOpen] = React.useState(false);
  // 1d-1 Task 5: nama orang di panel Beban Tim → editor kapasitas/cuti (Task 7 membaca editUid). Penyetel state = stabil.
  const [editUid, setEditUid] = React.useState(null);
  // Task 7: panel ditutup / orang tidak lagi menjadi baris → editor tertutup (tidak muncul lagi saat panel dibuka kembali).
  React.useEffect(() => {
    if (editUid !== null && (!loadOn || load && !load.rows.some(r => r.uid === editUid))) setEditUid(null);
  }, [editUid, loadOn, load]);
  // Review T4–T6 I1b: panel ditutup → daftar desktop ikut tertutup (tidak terbuka lagi saat panel dibuka kembali).
  React.useEffect(() => {
    if (!loadOn && loadDaysOpen) setLoadDaysOpen(false);
  }, [loadOn, loadDaysOpen]);
  // 1d-1 Task 6 (R7): "pilih + gulir" dari popover saran, TANPA tulisan. Baris ada di lay.rows (kunci String(task.id)) →
  // scrollTop = indeks × rowH − tinggi viewport/3 (≥ 0), scrollLeft = xOf(awal bar) − lebar viewport/3 (≥ 0; tanpa rentang
  // hanya scrollTop), jendela vp diperbarui seketika (tanpa menunggu event scroll), panel Beban Tim ikut, lalu baris + bar
  // berkelas is-flash LOAD_FLASH_MS (timer dibersihkan saat unmount) dan fokus pindah ke bar (popover sudah tertutup).
  // Tidak ada di lay.rows (disembunyikan filter panel) → context.onTaskClick(task) membuka detail.
  const [flash, setFlash] = React.useState(null);
  const flashTimer = React.useRef(null);
  React.useEffect(() => () => {
    if (flashTimer.current !== null) clearTimeout(flashTimer.current);
    flashTimer.current = null;
  }, []);
  const revealRow = (key, task) => {
    const k = String(key);
    const i = lay.rows.findIndex(r => !!r.task && r.key === k);
    const el = scrollRef.current;
    if (i < 0 || !el) {
      if (task && typeof context.onTaskClick === "function") context.onTaskClick(task);
      return;
    }
    const r = lay.rows[i];
    userScrolledRef.current = true; // tata letak berubah sesudahnya tidak melompat kembali ke "hari ini"
    el.scrollTop = Math.max(0, Math.round(i * rowH - vp.h / 3));
    if (r.span) {
      el.scrollLeft = Math.max(0, Math.round(TLLayout.xOf(r.span.s, lay.range, lay.px) - vp.w / 3));
      setLeftRef.current = el.scrollLeft;
    }
    syncLoadLeft(el.scrollLeft);
    const top = quantTop(el.scrollTop, rowH);
    const left = el.scrollLeft;
    setVp(p => {
      const ql = quantLeft(left, p.w);
      return p.top === top && p.left === ql ? p : Object.assign({}, p, {
        top,
        left: ql
      });
    });
    if (flashTimer.current !== null) clearTimeout(flashTimer.current);
    setFlash(k);
    flashTimer.current = setTimeout(() => {
      flashTimer.current = null;
      setFlash(null);
    }, LOAD_FLASH_MS);
    raf(() => focusBar(k));
  };
  // Fokus ke bar baris yang dipilih (role button, data-key) tanpa menggulir lagi; baris tanpa bar (tanpa rentang / bar di
  // luar DOM) → baris tabel (role row, tabIndex −1; review T4–T6 M5). Hanya bila ada di DOM.
  const focusBar = k => {
    const root = scrollRef.current;
    if (!root || typeof root.querySelectorAll !== "function") return;
    const quiet = node => {
      try {
        node.focus({
          preventScroll: true
        });
      } catch (err) {
        /* elemen tidak bisa difokus */
      }
    };
    const list = root.querySelectorAll("[data-key]");
    let row = null;
    for (let n = 0; n < list.length; n++) {
      const node = list[n];
      if (node.getAttribute("data-key") !== k) continue;
      const role = node.getAttribute("role");
      if (role === "button") {
        quiet(node);
        return;
      }
      if (role === "row" && row === null) row = node;
    }
    if (row !== null) quiet(row);
  };
  const revealRef = React.useRef(null);
  revealRef.current = revealRow;
  const onReveal = React.useRef((k, t) => revealRef.current(k, t)).current; // stabil (prop memo LoadPanel)
  // Review T4–T6 I2: Tab ke tombol hari merah di luar layar → wadah Gantt digulir lewat jalur applyLeft (setLeftRef,
  // translateX panel seketika, jendela vp) sehingga hari itu di sepertiga kiri; panel ikut (wadah grafiknya tidak pernah
  // digulir). Gulir oleh gestur pengguna: tata letak berubah sesudahnya tidak melompat kembali ke "hari ini". Tanpa tulisan.
  const showDay = dn => {
    const el = scrollRef.current;
    if (!el || !Number.isFinite(dn)) return;
    userScrolledRef.current = true;
    applyLeft(el, TLLayout.xOf(dn, lay.range, lay.px) - vp.w / 3);
  };
  const showDayRef = React.useRef(null);
  showDayRef.current = showDay;
  const onShowDay = React.useRef(dn => showDayRef.current(dn)).current; // stabil (prop memo LoadPanel)
  const [blOpen, setBlOpen] = React.useState(false); // pemilih Baseline (1c-2)
  const [blDlg, setBlDlg] = React.useState(null); // dialog Simpan baseline: {id, bases (potret), rev, busy}
  const blDlgRef = React.useRef(null);
  blDlgRef.current = blDlg;
  const blBtnRef = React.useRef(null);
  const blStepRef = React.useRef("form"); // langkah dialog simpan (onStep): potret hanya disegarkan di form
  const [pv, setPv] = React.useState(null); // {id, title, items, model, busy, unit?: {unit, rep, snap} | Array<{rep, snap, auto}>, broken?, todayLabel?, onDone, rebuild}
  const [, setNet] = React.useState(0);
  const autoBtnRef = React.useRef(null);
  const pvRef = React.useRef(null);
  pvRef.current = pv;
  const engRef = React.useRef(eng);
  engRef.current = eng;
  const toggling = React.useRef(false);
  const pvSeq = React.useRef(0);
  const unitPage = {
    pageKind,
    listId: pageKind === "workspace" ? context.listId : null,
    projectName: pageKind === "workspace" ? null : context.projectName
  };
  const summary = React.useMemo(() => toolbarSummary(lay, engResult), [lay, engResult]);
  const offline = !!(api.env && api.env.online === false);
  // Catatan offline di dialog mengikuti event host app.online/app.offline selama dialog terbuka.
  React.useEffect(() => {
    if (!pv) return undefined;
    const offs = [];
    try {
      for (const ev of ["app.online", "app.offline"]) offs.push(api.events.on(ev, () => setNet(x => x + 1)));
    } catch (e) {
      logWarn(api, "pendengar online gagal:", e);
    }
    return () => {
      for (const off of offs) if (typeof off === "function") off();
    };
  }, [!pv]);
  const userId = () => api.env ? api.env.userId : null;
  const wbsOfPage = () => {
    const m = new Map(lay.rows.map(r => [r.key, r.wbs]));
    return key => m.has(key) ? m.get(key) : null;
  };
  // Pratinjau sakelar ON atas ctx: item TLPlan.toggleUnit; "sebelum" = hasil useEngine (tanpa run tambahan);
  // seedKeys = simpul unit agar lingkaran/jangkar bertabrakan unit tercantum di "Tidak dipindah" (K34).
  const buildToggle = (ctx, before, recId) => {
    const t = TLPlan.toggleUnit(ctx, recId, true);
    if (!t.items.length || !t.result) return {
      items: [],
      model: null
    };
    const seed = new Set();
    for (const [k, n] of t.result.nodes) if (n.g === recId) seed.add(k);
    const pm = TLPlan.preview(t.items, t.result, ctx, before, seed);
    const wbs = wbsOfPage();
    return {
      items: t.items,
      model: pm ? dialogModel(pm, t.result, wbs) : null,
      whyOf: planWhy(t.result, ctx, t.items, wbs)
    };
  };
  const setAutoNow = (entry, on) => {
    toggling.current = true;
    return Promise.resolve().then(() => un.store.setAuto(entry.unit, on, userId())).then(() => toastSafe(api, on ? MSG_AUTO_ON0 : MSG_AUTO_OFF, "success"), err => {
      logWarn(api, "unit jadwal gagal disimpan:", err);
      toastSafe(api, MSG_SAVE_FAIL, "error");
    }).then(() => {
      toggling.current = false;
    });
  };
  const toggleEntry = entry => {
    const e = engRef.current;
    if (entry.locked || toggling.current || pvRef.current || blDlgRef.current || e.status !== "ready" || !e.ctx || !e.result) return;
    if (entry.on) {
      setAutoNow(entry, false); // OFF: tanpa tulis task (tanggal tetap)
      return;
    }
    const recId = entry.unit.recId;
    const b = buildToggle(e.ctx, e.result, recId);
    if (!b.items.length) {
      setAutoNow(entry, true);
      return;
    }
    if (!b.model) return; // preview tanpa "sebelum" sah → tidak ada dialog kosong
    const uid = userId();
    setUnitOpen(false);
    setCalOpen(false); // satu Esc = dialog saja (popover lain tidak ikut mendengar)
    setBlOpen(false);
    setPv({
      id: ++pvSeq.current,
      title: MSG_PV_ON + entry.label,
      items: b.items,
      model: b.model,
      busy: false,
      whyOf: b.whyOf,
      unit: {
        unit: entry.unit,
        rep: entry.rep,
        snap: entry.snap
      },
      onDone: () => un.store.setAuto(entry.unit, true, uid),
      // setMany dulu; setAuto hanya setelah sukses
      // "sebelum" = mesin atas ctx2 (data terbaru), bukan hasil lama eng.result (K32: endBefore/brokenDeps dari data segar)
      rebuild: (ctx2, before2, units) => Object.assign(buildToggle(ctx2, engine.run(ctx2), recId), {
        unit: {
          unit: entry.unit,
          rep: entry.rep,
          snap: unitSnap(TLSched.unitFor(units, entry.rep))
        }
      })
    });
  };
  const cancelPv = () => setPv(null);
  // Task 9 (R13): aliran gestur dengan turunan > 20 → pratinjau "Tinjau jadwal otomatis" (0 tulis sampai Terapkan).
  // Hitung ulang setelah CAS = gestur yang sama (patch sudah lewat TLPlan.gesture) atas data terbaru.
  const buildFlow = (ctx, before, gestures, pre) => {
    const c = pre || TLPlan.cascade(ctx, gestures, before);
    const items = pre ? pre.items : flowItems(c.items);
    const pm = items.length ? TLPlan.preview(items, c.result, ctx, before) : null;
    const wbs = wbsOfPage();
    return {
      items,
      model: pm ? dialogModel(pm, c.result, wbs) : null,
      whyOf: planWhy(c.result, ctx, items, wbs)
    };
  };
  const openFlowPv = p => {
    if (pvRef.current || blDlgRef.current) return; // satu dialog pada satu waktu
    const b = buildFlow(p.ctx, p.before, p.gestures, {
      items: p.items,
      result: p.result
    });
    if (!b.model) return;
    setUnitOpen(false);
    setCalOpen(false); // satu Esc = dialog saja
    setBlOpen(false);
    const next = {
      id: ++pvSeq.current,
      title: PV_FLOW,
      items: b.items,
      model: b.model,
      busy: false,
      whyOf: b.whyOf,
      // K32: "sebelum" dihitung dari ctx2 — turunan yang ES-nya berubah karena SINKRON (bukan gestur) tidak dihitung bergeser.
      rebuild: ctx2 => buildFlow(ctx2, engine.run(ctx2), p.gestures)
    };
    pvRef.current = next;
    setPv(next);
  };
  ctl.cur.openPreview = openFlowPv;
  // Buka pratinjau milik view (Task 10) bila belum ada dialog; popover lain ditutup (satu Esc = dialog saja).
  const openPv = spec => {
    if (pvRef.current || blDlgRef.current) return;
    setUnitOpen(false);
    setCalOpen(false);
    setBlOpen(false);
    const next = Object.assign({
      id: ++pvSeq.current,
      busy: false
    }, spec);
    pvRef.current = next;
    setPv(next);
  };
  // Task 10 (R16): "Tinjau" — item = TLPlan.diff dibatasi drift halaman (bannerInfo). Menulis Mulai = ES tidak mengubah
  // hasil mesin (simpul otomatis non-jangkar), jadi "sebelum" = "sesudah" = result: tanpa run tambahan, tanpa pelanggaran
  // baru. Hitung ulang setelah CAS: mesin dijalankan atas data terbaru (drift lama tidak dipakai).
  // Potret unit halaman untuk CAS (ruling 4): updatedAt/by dari useUnits() terbaru (`live`), `auto` = mode yang dipakai
  // rencana (`plan` = ctx.units mesin). Anggota lain mematikan/menyalakan Otomatis saat dialog terbuka → Terapkan ditolak.
  const pageSnaps = (plan, live) => pageUnits(lay, pageKind, context.projectName, groupNames).map(x => ({
    rep: x.rep,
    snap: unitSnap(TLSched.unitFor(live, x.rep)),
    auto: unitAuto(TLSched.unitFor(plan, x.rep))
  }));
  const freshSnaps = (ctx2, units) => pageSnaps(ctx2.units, units instanceof Map ? units : ctx2.units);
  const buildReview = (ctx, result) => {
    const keys = new Set(bannerInfo(result, context.scopeTasks).drift);
    const items = flowItems(TLPlan.diff(result, ctx, keys));
    const pm = TLPlan.preview(items, result, ctx, result);
    const wbs = wbsOfPage();
    return {
      items,
      model: pm ? dialogModel(pm, result, wbs) : EMPTY_PV_MODEL,
      whyOf: planWhy(result, ctx, items, wbs)
    };
  };
  const openReview = () => {
    const e = engRef.current;
    if (e.status !== "ready" || !e.ctx || !e.result) return;
    const b = buildReview(e.ctx, e.result);
    openPv({
      title: PV_FLOW,
      items: b.items,
      model: b.model,
      whyOf: b.whyOf,
      unit: pageSnaps(e.ctx.units, un.units),
      rebuild: (ctx2, before2, units) => Object.assign(buildReview(ctx2, engine.run(ctx2)), {
        unit: freshSnaps(ctx2, units)
      })
    });
  };
  // Task 10 (R17, K36): Jadwalkan ulang — T = nextWork(dn(hari ini)) menurut kalender unit (eng.ctx.cal), unitKeys =
  // unit halaman (pageUnits). Selalu pratinjau, juga 0 item (Terapkan nonaktif). Teks pelanggaran memakai
  // reschedule().broken (bukan preview.brokenDeps). Hitung ulang setelah CAS memakai T yang sama atas data terbaru.
  const buildResched = (ctx, before, T, unitKeys) => {
    const r = TLPlan.reschedule(ctx, before, T, unitKeys);
    const items = flowItems(r.items);
    const pm = r.result ? TLPlan.preview(items, r.result, ctx, before) : null;
    const wbs = wbsOfPage();
    return {
      items,
      broken: r.broken,
      model: pm ? dialogModel(pm, r.result, wbs) : EMPTY_PV_MODEL,
      whyOf: r.result ? planWhy(r.result, ctx, items, wbs) : undefined
    };
  };
  const openResched = () => {
    const e = engRef.current;
    const td = today ? TLCal.dn(today) : null;
    if (e.status !== "ready" || !e.ctx || !e.result || td === null) return;
    let T = null;
    try {
      T = TLCal.nextWork(e.ctx.cal, td);
    } catch (err) {
      logWarn(api, "hari kerja berikutnya tidak ditemukan:", err); // TL_CAL_LOOP: kalender tanpa hari kerja
      return;
    }
    const unitKeys = new Set(pageUnits(lay, pageKind, context.projectName, groupNames).map(x => x.unit.recId));
    const b = buildResched(e.ctx, e.result, T, unitKeys);
    openPv({
      title: PV_RESCHED,
      items: b.items,
      model: b.model,
      broken: b.broken,
      whyOf: b.whyOf,
      todayLabel: TLCal.fmtShort(td),
      unit: pageSnaps(e.ctx.units, un.units),
      rebuild: (ctx2, before2, units) => Object.assign(buildResched(ctx2, engine.run(ctx2), T, unitKeys), {
        unit: freshSnaps(ctx2, units)
      })
    });
  };
  // Banner R16: dihitung sekali per hasil mesin / scopeTasks (bukan tiap render); disembunyikan sebelum mesin siap.
  const banner = React.useMemo(() => bannerInfo(engResult, context.scopeTasks), [engResult, context.scopeTasks]);
  const [, setClosed] = React.useState(0);
  const closeBanner = k => {
    BANNER_CLOSED.add(k);
    setClosed(x => x + 1);
  };
  const banners = [];
  if (engResult && banner.drift.length) {
    const k = bannerKey(page, "drift", banner.drift.length);
    if (!BANNER_CLOSED.has(k)) banners.push({
      k,
      text: driftText(banner.drift.length),
      action: BANNER_REVIEW,
      onAction: openReview
    });
  }
  if (engResult && banner.cycle.length) {
    const k = bannerKey(page, "cycle", banner.cycle.length);
    const first = banner.first;
    const open = () => {
      if (typeof context.onTaskClick === "function") context.onTaskClick(first);
    };
    if (!BANNER_CLOSED.has(k)) banners.push({
      k,
      text: banner.cycleText,
      action: BANNER_OPEN,
      onAction: open
    });
  }
  const bannerEl = banners.length ? renderBanners(banners, closeBanner) : null;
  // Terapkan (R14): muat ulang daftar lengkap (+ unit) → TLPlan.revalidate (nilai mentah) dan, untuk sakelar, potret
  // updatedAt/by unit. Berbeda → toast + hitung ulang dari data terbaru (Terapkan perlu ditekan lagi), 0 tulis.
  const applyPv = () => {
    const cur = pvRef.current;
    if (!cur || cur.busy) return;
    const live = () => pvRef.current && pvRef.current.id === cur.id;
    const busyPv = Object.assign({}, cur, {
      busy: true
    });
    pvRef.current = busyPv; // seketika: klik ganda sebelum render berikutnya tidak memicu setMany kedua
    setPv(busyPv);
    const listP = Promise.resolve().then(() => api.data.tasks.list({
      includeDone: true
    }));
    const unitsP = pvUnitList(cur.unit).length ? Promise.resolve().then(() => un.store.loadUnits(unitPage)) : Promise.resolve(null);
    Promise.all([listP, unitsP]).then(([l, units]) => {
      if (!live()) return;
      const list = Array.isArray(l) ? l : [];
      const rawNow = new Map();
      for (const t of list) if (t && t.id !== undefined && t.id !== null) rawNow.set(String(t.id), readExtSafe(api, t));
      const cas = TLPlan.revalidate(cur.items, rawNow);
      const unitOk = unitsStillOk(cur.unit, units);
      if (!cas.ok || !unitOk) {
        toastSafe(api, MSG_STALE, "error");
        const e = engRef.current;
        const base = e.ctx || {};
        const ctx2 = {
          tasks: scopeFilter(list, context.scopeTasks),
          cal: base.cal,
          units: units instanceof Map ? units : base.units,
          readExt: base.readExt || (t => readExtSafe(api, t))
        };
        const next = cur.rebuild(ctx2, e.result, units);
        setPv(Object.assign({}, cur, next, {
          busy: false,
          model: next.model || EMPTY_PV_MODEL
        }));
        return;
      }
      setPv(null);
      ctl.applyPlan(cur.items, {
        onDone: cur.onDone
      });
    }).catch(err => {
      logWarn(api, "pratinjau gagal diperiksa:", err);
      toastSafe(api, MSG_SAVE_FAIL, "error");
      if (live()) setPv(Object.assign({}, cur, {
        busy: false
      }));
    });
  };

  // Entri unit halaman (urutan kelompok) dengan keadaan sakelar, kunci P3 (a), dan keterangan "Dinyalakan oleh …".
  const unitsEntries = pageUnits(lay, pageKind, context.projectName, groupNames).map(x => {
    const u = TLSched.unitFor(un.units, x.rep);
    // P3 (a), pola ADR-042 #12: catatan tunggu hanya setelah muat pertama selesai (unit tanpa record lokal, belum ada
    // tarik sukses); selama memuat sakelar nonaktif tanpa catatan.
    const waiting = un.loaded && pageKind === "workspace" && !(u && u.exists) && !un.pulled;
    const locked = !un.loaded || waiting;
    const entry = {
      key: x.unit.recId,
      label: x.label,
      unit: x.unit,
      rep: x.rep,
      on: !!(u && u.auto === true),
      locked,
      waiting,
      snap: unitSnap(u),
      caption: unitCaption(u, context, userId())
    };
    entry.onToggle = () => toggleEntry(entry);
    return entry;
  });
  const pageEntry = pageKind === "workspace" ? null : unitsEntries[0];
  const auto = pageEntry ? {
    kind: "switch",
    on: pageEntry.on,
    disabled: pageEntry.locked,
    onClick: pageEntry.onToggle
  } : {
    kind: "popover",
    expanded: unitOpen,
    onClick: () => {
      setCalOpen(false);
      setBlOpen(false);
      setUnitOpen(!unitOpen);
    }
  };

  // ── 1c-2 Task 5: Baseline (pemilih = pref saja) + Simpan baseline (dialog → SATU baselineStore.save) ──
  // Simpan: encode dari hasil useEngine AKTIF (engRef) dengan g = recId unit terpilih (T3); snap = potret dialog (bentuk
  // loadAll; slot asing ikut). Hapus (fix review T5): slot terisi terbaca, snap potret, lockedOf. Galat lewat blFail.
  const openSaveBl = () => {
    const e = engRef.current;
    if (pvRef.current || blDlgRef.current || e.status !== "ready" || !blPage.length) return;
    setUnitOpen(false);
    setCalOpen(false);
    setBlOpen(false);
    const next = {
      id: ++pvSeq.current,
      bases: bls.byUnit,
      rev: 0,
      busy: false
    };
    blStepRef.current = "form";
    blDlgRef.current = next;
    setBlDlg(next);
  };
  const setDlg = next => {
    blDlgRef.current = next;
    setBlDlg(next);
  };
  const cancelBl = () => setDlg(null);
  // Hasil gagal simpan/hapus: TOO_LARGE → "Baseline terlalu besar"; STALE → MSG_BL_STALE + potret dimuat ulang (satu
  // loadScope), dialog kembali ke form; lainnya → "Baseline gagal disimpan" / (hapus) "Baseline gagal dihapus".
  // Dialog tetap terbuka.
  const blFail = (cur, live, err, del) => {
    const code = err && err.code;
    if (code === "TOO_LARGE") toastSafe(api, MSG_BL_TOO_LARGE, "error");else if (code === "STALE") toastSafe(api, MSG_BL_STALE, "error");else {
      logWarn(api, del ? "baseline gagal dihapus:" : "baseline gagal disimpan:", err);
      toastSafe(api, del ? MSG_BL_DEL_FAIL : MSG_BL_SAVE_FAIL, "error");
    }
    if (!live()) return undefined;
    if (code !== "STALE") {
      setDlg(Object.assign({}, cur, {
        busy: false
      }));
      return undefined;
    }
    return bls.store.loadScope(blPage.map(x => x.unit)).then(fresh => {
      blStepRef.current = "form";
      if (live()) setDlg(Object.assign({}, cur, {
        bases: fresh,
        rev: cur.rev + 1,
        busy: false
      }));
    }, err2 => {
      logWarn(api, "baseline gagal dimuat:", err2);
      if (live()) setDlg(Object.assign({}, cur, {
        busy: false
      }));
    });
  };
  // Satu aksi tulis dialog (simpan / hapus) lewat baselineStore; busy seketika (klik ganda = satu tulis).
  const blRun = (cur, act, okText, del) => {
    setDlg(Object.assign({}, cur, {
      busy: true
    }));
    const live = () => blDlgRef.current !== null && blDlgRef.current.id === cur.id;
    Promise.resolve().then(act).then(() => {
      if (live()) setDlg(null);
      toastSafe(api, okText, "success");
    }, err => blFail(cur, live, err, del));
  };
  const saveBl = (recId, n, name) => {
    const cur = blDlgRef.current;
    const e = engRef.current;
    const pu = blPage.find(x => x.unit.recId === recId);
    if (!cur || cur.busy || !pu || e.status !== "ready" || !e.result || !e.ctx) return;
    const slots = cur.bases.get(recId);
    const ent = slots instanceof Map ? slots.get(n) : null;
    const uid = api.env ? api.env.userId : null;
    const enc = TLPlan.baselineEncode(e.result, e.ctx, {
      n,
      name,
      savedAt: today,
      by: Number.isInteger(uid) ? uid : null
    }, recId);
    blRun(cur, () => bls.store.save(pu.unit, n, name, enc.data, ent ? ent.snap : BL_NO_SNAP), blSavedText(name));
  };
  // Hapus (ruling review T5): snap dari potret dialog (CAS remove T4), kunci lockedOf. Pref bl:<page> TIDAK diubah —
  // pilihan yang menunjuk slot terhapus menjadi pembanding kosong (semantik pemilih sama).
  const removeBl = (recId, n) => {
    const cur = blDlgRef.current;
    const pu = blPage.find(x => x.unit.recId === recId);
    const slots = cur ? cur.bases.get(recId) : null;
    const ent = slots instanceof Map ? slots.get(n) : null;
    if (!cur || cur.busy || !pu || !ent || ent.foreign || bls.lockedOf(n, recId)) return;
    blRun(cur, () => bls.store.remove(pu.unit, n, ent.snap), blRemovedText(blShownName(ent, n)), true);
  };
  // Fix review T5 #3: kunci/muat berubah (mis. slot tiba bersama `pulled`) saat dialog di langkah FORM dan tidak sibuk →
  // potret diambil ulang dari useBaselines (rev naik), sehingga slot yang baru tiba meminta konfirmasi Timpa, bukan
  // STALE. Di langkah konfirmasi/hapus potret TIDAK diganti (yang dikonfirmasi = yang dilihat; CAS tetap menjaga).
  React.useEffect(() => {
    const cur = blDlgRef.current;
    if (!cur || cur.busy || blStepRef.current !== "form" || cur.bases === bls.byUnit) return;
    setDlg(Object.assign({}, cur, {
      bases: bls.byUnit,
      rev: cur.rev + 1
    }));
  }, [bls.pulled, bls.loaded]);
  const blPickItems = [{
    n: 0,
    label: BL_NONE
  }].concat(BL_SLOTS.map(n => {
    // halaman project: nama slot (bila ada dan terbaca); workspace (banyak unit) / kosong / asing → "Baseline {n}"
    const e = blPage.length === 1 ? bls.bases.get(n) : null;
    return {
      n,
      label: e && !e.foreign && e.name ? e.name : blSlotName(n)
    };
  }));
  const blTool = blPage.length ? {
    value: blPref,
    open: blOpen,
    btnRef: blBtnRef,
    onPick: () => {
      setCalOpen(false);
      setUnitOpen(false);
      setBlOpen(!blOpen);
    },
    onSave: openSaveBl
  } : null;

  // ── 1d-2 Task 5 (R5, R6, R9; K53, K54; Q7 (a), P2 (a)): Ekspor ke Microsoft Project (.xml) — HANYA BACA (R25) ──
  // Dipanggil dari onSelect item menu (gestur pengguna; api.ui.saveFile dipanggil sinkron di dalamnya, tanpa await
  // sebelumnya). Aplikasi native (api.env.platform "tauri") → petunjuk ke browser TANPA membangun XML. Web: masukan =
  // mesin AKTIF (engRef: daftar lengkap halaman, kalender, readExt, hasil, unit — bukan baris tersaring panel), judul R9,
  // nama orang (peopleNames), pemilik halaman pribadi (resource tunggal), baseline aktif atas unit daftar lengkap (R2),
  // hari ini. build melempar → "Ekspor gagal" tanpa unduhan; saveFile → true: "Berkas {nama} diunduh" (+ catatan stats),
  // false (native): petunjuk browser, reject/lempar: "Ekspor gagal". Galat dicatat api.log.warn.
  const exportXml = () => {
    const e = engRef.current;
    if (!e || e.status !== "ready" || !e.result || !e.ctx) return;
    if (api.env && api.env.platform === "tauri") {
      toastSafe(api, MSG_EXPORT_NATIVE, "info");
      return;
    }
    let fileName;
    let out;
    try {
      const title = exportTitle(pageKind, context);
      fileName = TLMspdi.fileNameOf(title, todayDn);
      out = engine.mspdi({
        tasks: e.ctx.tasks,
        cal: e.ctx.cal,
        readExt: e.ctx.readExt,
        result: e.result,
        units: e.ctx.units,
        pageKind,
        title,
        fileName,
        people: peopleNames({
          currentUser: context.currentUser,
          collaborators: context.collaborators,
          userId: meUid
        }),
        ownerUid: pageKind === "workspace" ? null : meUid,
        baseline: evBl && evBl.rows.size > 0 ? {
          rows: evBl.rows
        } : null,
        D: todayDn
      });
    } catch (err) {
      logWarn(api, "ekspor gagal dibangun:", err);
      toastSafe(api, MSG_EXPORT_FAIL, "error");
      return;
    }
    let saved;
    try {
      saved = Promise.resolve(api.ui.saveFile(fileName, out.xml, EXPORT_MIME));
    } catch (err) {
      saved = Promise.reject(err);
    }
    saved.then(ok => {
      if (ok === true) toastSafe(api, exportDoneText(fileName, out.stats), "success");else toastSafe(api, MSG_EXPORT_NATIVE, "info");
    }, err => {
      logWarn(api, "ekspor gagal diunduh:", err);
      toastSafe(api, MSG_EXPORT_FAIL, "error");
    });
  };
  const exportItem = {
    id: "export",
    text: LBL.export,
    role: "menuitem",
    disabled: !ov.ready,
    onSelect: exportXml
  };
  const toolbar = renderToolbar({
    zoom,
    pickZoom,
    goToday,
    sort,
    setSort,
    compact,
    cols,
    setCols,
    narrow,
    mode,
    setMode,
    listMode,
    engReady: ov.ready,
    crit,
    setCrit,
    calOpen,
    toggleCal: () => {
      setUnitOpen(false);
      setBlOpen(false);
      setCalOpen(!calOpen);
    },
    calBtnRef,
    auto,
    autoBtnRef,
    collapse: compact,
    summary,
    onReschedule: openResched,
    bl: blTool,
    loadOn,
    setLoadOn: toggleLoad,
    // 1d-1 T4 (R10); review akhir I1: gestur → gulir ke panel
    ev: evView,
    // 1d-2 T4 (K57): ringkasan earned value sebelum "Selesai {tgl}"
    exportItem // 1d-2 T5 (R6): item "Ekspor ke Microsoft Project (.xml)" di menu Lainnya
  });
  // Popover berhook → elemen (bukan panggilan fungsi). key = id kalender: pindah halaman memasang ulang. Esc / tombol tutup
  // mengembalikan fokus ke tombol "Kalender kerja"; klik di luar tidak (fokus sudah pindah ke target klik).
  const closeCal = how => {
    setCalOpen(false);
    const b = calBtnRef.current;
    if (how && how.restoreFocus && b && typeof b.focus === "function") b.focus();
  };
  const popover = calOpen ? /*#__PURE__*/React.createElement(CalendarPopover, {
    key: target.id,
    calId: target.id,
    scope: target.scope,
    pageKind: pageKind,
    store: cal.store,
    pulled: cal.pulled,
    onClose: closeCal
  }) : null;
  // Popover unit workspace (R15): Esc / tombol tutup mengembalikan fokus ke "Jadwal otomatis"; klik luar tidak.
  const closeUnits = how => {
    setUnitOpen(false);
    const b = autoBtnRef.current;
    if (how && how.restoreFocus && b && typeof b.focus === "function") b.focus();
  };
  const unitPop = unitOpen && pageKind === "workspace" && ov.ready ? /*#__PURE__*/React.createElement(UnitPopover, {
    entries: unitsEntries,
    waiting: unitsEntries.some(e => e.waiting),
    onClose: closeUnits
  }) : null;
  // Pemilih Baseline: Esc / pilih mengembalikan fokus ke tombol "Baseline"; klik luar tidak. Hanya Gantt, mesin siap.
  const closeBl = how => {
    setBlOpen(false);
    const b = blBtnRef.current;
    if (how && how.restoreFocus && b && typeof b.focus === "function") b.focus();
  };
  const blPop = blOpen && ov.ready && !listMode && blTool ? /*#__PURE__*/React.createElement(BaselinePicker, {
    items: blPickItems,
    value: blPref,
    onPick: setBl,
    onClose: closeBl
  }) : null;
  const top = /*#__PURE__*/React.createElement("div", {
    className: "plg-timeline-top"
  }, toolbar, popover, unitPop, blPop);
  const blDialog = blDlg ? /*#__PURE__*/React.createElement(SaveBaselineDialog, {
    key: "bl" + blDlg.id,
    units: blPage.map(x => ({
      key: x.unit.recId,
      label: x.label
    })),
    bases: blDlg.bases,
    rev: blDlg.rev,
    busy: blDlg.busy,
    lockedOf: bls.lockedOf,
    waitingOf: bls.waitingOf,
    onSave: saveBl,
    onRemove: removeBl,
    onStep: x => {
      blStepRef.current = x;
    },
    onCancel: cancelBl
  }) : null;
  const dialog = pv && pv.model ? /*#__PURE__*/React.createElement(PreviewDialog, {
    key: pv.id,
    title: pv.title,
    model: pv.model,
    offline: offline,
    todayLabel: pv.todayLabel,
    broken: pv.broken,
    busy: pv.busy,
    whyOf: pv.whyOf,
    onApply: applyPv,
    onCancel: cancelPv
  }) : blDialog;
  // 1d-1 Task 8: daftar "Hari kelebihan beban" (≤ 640 px) di bawah isi view (Gantt: sebelum legenda; Daftar: setelahnya).
  const loadList = loadMShown && hasRows ? React.createElement(loadListMemo(), {
    load,
    cal: eng.ctx.cal,
    result: eng.result,
    ctx: eng.ctx,
    pageKind,
    boxRef: loadBoxRef,
    editUid,
    onEditPerson: setEditUid,
    res: resEd,
    onReveal,
    capMissing
  }) : null;
  if (!hasRows) {
    return /*#__PURE__*/React.createElement("div", {
      className: "plg-timeline"
    }, top, /*#__PURE__*/React.createElement("div", {
      className: "plg-timeline-empty"
    }, MSG_EMPTY), dialog);
  }
  if (listMode) {
    return /*#__PURE__*/React.createElement("div", {
      className: "plg-timeline"
    }, top, bannerEl, ListFallback({
      rows: lay.rows,
      cal: lay.cal,
      onTaskClick: context.onTaskClick
    }), loadList, dialog);
  }
  const v = {
    lay,
    rw,
    dw,
    rowH,
    colDefs,
    tableW,
    chartW,
    bodyH,
    todayDn,
    groupNames,
    ix,
    isSel,
    ov,
    crit,
    bl: blDec,
    blOv,
    actOv,
    flash
  };
  // 1d-1 Task 5: panel Beban Tim di bawah grafik, sebelum legenda — props primitif/stabil agar memo menahan render ulang.
  const loadPanel = loadShown ? React.createElement(loadPanelMemo(), {
    load,
    cal: eng.ctx.cal,
    result: eng.result,
    ctx: eng.ctx,
    rangeFrom: lay.range.from,
    px: lay.px,
    fromDn: dw.fromDn,
    toDn: dw.toDn,
    tableW,
    viewW: vp.w,
    pageKind,
    trackRef: loadTrackRef,
    boxRef: loadBoxRef,
    getLeft,
    onEditPerson: setEditUid,
    onReveal,
    editUid,
    res: resEd,
    // Task 7
    onShowDay,
    daysOpen: loadDaysOpen,
    onDaysOpen: setLoadDaysOpen,
    // review T4–T6 I2, I1b
    getViewW,
    capMissing // review akhir: lebar view langsung (showDay), tanda kapasitas belum termuat
  }) : null;
  return /*#__PURE__*/React.createElement("div", {
    className: cx("plg-timeline", compact && "is-compact")
  }, top, bannerEl, /*#__PURE__*/React.createElement("div", {
    className: "plg-timeline-scroll",
    ref: scrollRef,
    onScroll: onScroll,
    role: "grid",
    "aria-label": "Timeline",
    "aria-rowcount": lay.rows.length + 1,
    style: {
      height: vp.boxH
    }
  }, renderHead(v), /*#__PURE__*/React.createElement("div", {
    className: "plg-timeline-body",
    style: {
      height: bodyH
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "plg-timeline-table",
    style: {
      width: tableW,
      height: bodyH
    }
  }, renderTableRows(v)), renderChart(v))), loadPanel, loadList, renderLegend(lay, footRef, crit, legendX), dialog);
}

// 4g. Seksi "Jadwal" di detail task (Task 10; spec §8.8, Q5; R7, R8, R10, R15, R16, R17). Slot taskDetail.sections,
// context {task, variant: "modal"|"panel", collaborators, onOpenTask, showToast}; modal dan panel Live Edit sama.
// Plugin hanya menulis ext miliknya (start/duration/deps) — kolom host (progres, tenggat) dibaca saja (README §8.7).
const SEC_TITLE = "Jadwal";
const SEC_START = "Mulai";
const SEC_DUR = "Durasi";
const SEC_HK = "hari kerja";
const SEC_ADD_DEP = "Tambah dependensi";
const SEC_MORE = "Selengkapnya";
const SEC_LESS = "Sembunyikan";
const SEC_FINISH = "Selesai";
const SEC_MILESTONE = "Milestone";
const SEC_PCT = "% selesai";
const SEC_PCT_HINT = "Ubah lewat progres di atas";
const SEC_SHIFT = "Geser ke setelah dependensi";
const SEC_SUMMARY = "Jadwal task ini mengikuti subtask-nya";
const SEC_SUMMARY_NONE = "Belum ada subtask yang dijadwalkan";
const SEC_OUTSIDE = "(task di luar halaman ini)";
const SEC_DELETED = "(task sudah dihapus)";
const SEC_DEPS = "Dependensi";
const SEC_BAD_BTN = "Hapus dependensi rusak";
const SEC_SEARCH = "Cari task";
const SEC_LOADING = "Memuat…";
const SEC_NO_MATCH = "Tidak ada task yang cocok";
const SEC_IS_DEP = "sudah ada";
const SEC_CLOSE = "Tutup";
const SEC_YEAR_MIN = 1970; // tahun parsial saat mengetik di input tanggal (0002-…, 0020-…) tidak disimpan
const SEC_YEAR_MAX = 2199;
const PICK_MAX = 50; // R17: ≤ 50 hasil pemilih
const SEC_REFRESH_MS = 2000; // muat ulang daftar task saat seksi difokus/disentuh, paling sering tiap 2 s
// Waktu yang bisa diganti tes (pola `engine`): Mulai yang sah disimpan setelah jeda ini bila tidak ada blur/Enter
// (pilihan dari kalender bawaan tidak selalu diikuti blur).
const SEC_TIMING = {
  startDebounceMs: 700
};

// 1c-1 R20 (Task 11): mode per task (tingkat 1 "Selengkapnya") dan kartu otomatis terlipat (tingkat 2).
const SEC_MODE = "Mode";
const SEC_MODE_MANUAL = "Manual";
const SEC_MODE_AUTO = "Otomatis";
const SEC_MODE_UNIT = "sama dengan project";
const SEC_CRIT = "Di jalur kritis";
const SEC_UPDATE = "Perbarui";
const SEC_WAIT = "menunggu ";
const SEC_FOLLOW = "diikuti ";
const SEC_SLACK = "slack ";
const SEC_LINK_MAX = 2; // R20: maks 2 pendahulu/penerus + "…"
const SEC_WBS_TITLE_MAX = 24; // R20: tanpa nomor WBS → judul ≤ 24 karakter
const SEC_MODES = [["manual", SEC_MODE_MANUAL], ["auto", SEC_MODE_AUTO]];
const SEC_ITEM_KEYS = ["start", "duration", "constraint", "mode"]; // kunci `before` item rencana (R11)

function secLateChip(n) {
  return "lewat tenggat " + n + " hk";
}
function secDriftText(es) {
  return "Belum mutakhir — hasil hitung " + TLCal.fmtShort(es) + ".";
}
function secShiftText(n) {
  return "Mengubah task ini menggeser " + n + " task otomatis";
}

// Label task di baris dependensi kartu: nomor WBS daftar lengkap scope; tanpa nomor → judul ≤ 24 karakter (sadar surrogate).
function secWbsLabel(wbs, task) {
  const w = wbs.get(String(task.id));
  if (w) return w;
  let t = taskTitle(task);
  if (t.length <= SEC_WBS_TITLE_MAX) return t;
  t = t.slice(0, SEC_WBS_TITLE_MAX - 1);
  const c = t.charCodeAt(t.length - 1);
  if (c >= 0xd800 && c <= 0xdbff) t = t.slice(0, -1);
  return t + "…";
}

// Lag pendahulu: 0 → tanpa keterangan; selain itu " (+n hk)" / " (−n hk)" (minus U+2212, pola slackText).
function secLagText(lag) {
  if (!Number.isFinite(lag) || lag === 0) return "";
  return " (" + (lag > 0 ? "+" : "−") + Math.abs(lag) + " hk)";
}

// Baris kartu tingkat 2: "menunggu {WBS} (+{lag} hk) · diikuti {WBS} · slack {teks R18}" — sisi pendahulu dari
// result.pred (urutan deps tersimpan), penerus dari result.succ; bagian kosong dihilangkan, slack selalu ada.
function secLinksText(eng) {
  const {
    result,
    node,
    wbs
  } = eng;
  const nameOf = key => {
    const n = result.nodes.get(key);
    return n ? secWbsLabel(wbs, n.task) : key;
  };
  const cap = a => a.length > SEC_LINK_MAX ? a.slice(0, SEC_LINK_MAX).concat(["…"]) : a;
  const preds = (result.pred.get(node.key) || []).map(p => nameOf(p.key) + secLagText(p.lag));
  const succs = (result.succ.get(node.key) || []).map(nameOf);
  const parts = [];
  if (preds.length) parts.push(SEC_WAIT + cap(preds).join(", "));
  if (succs.length) parts.push(SEC_FOLLOW + cap(succs).join(", "));
  parts.push(SEC_SLACK + slackText(node.slack));
  return parts.join(" · ");
}

// Turunan otomatis non-jangkar dari `key` (BFS result.succ, hanya menembus simpul otomatis non-jangkar: jangkar
// menahan aliran) → Set kunci tanpa `key` sendiri. Ukurannya = "Mengubah task ini menggeser {n} task otomatis";
// isinya + `key` = batas diff "Perbarui".
function secAutoReach(result, key) {
  const out = new Set();
  const seen = new Set([key]);
  const stack = [key];
  while (stack.length) {
    for (const s of result.succ.get(stack.pop()) || []) {
      if (seen.has(s)) continue;
      seen.add(s);
      const n = result.nodes.get(s);
      if (!n || n.fixed || n.mode !== "auto") continue;
      out.add(s);
      stack.push(s);
    }
  }
  return out;
}

// 1c-1 R20 tingkat 3 (Task 12): Batasan, Dependensi bertipe, "Kenapa", "Ubah ke Manual" (teks persis §7.6).
const SEC_EDIT = "Ubah";
const SEC_CST = "Batasan";
const SEC_CST_KIND = "Jenis batasan";
const SEC_CST_DATE = "Tanggal batasan";
const SEC_CSTS = [["", "Secepatnya (ASAP)"], ["SNET", "Mulai tidak lebih awal dari"], ["MFO", "Harus selesai pada"]];
const SEC_WAITS = "Menunggu";
const SEC_FOLLOWS = "Diikuti oleh";
const SEC_TYPES = [["FS", "Selesai → Mulai (FS)"], ["SS", "Mulai → Mulai (SS)"], ["FF", "Selesai → Selesai (FF)"], ["SF", "Mulai → Selesai (SF)"]];
const SEC_WHY = "Kenapa dijadwalkan di sini?";
const SEC_TO_MANUAL = "Ubah ke Manual";

// 1c-2 Task 7 tingkat 3 (§7.6 persis): tanggal aktual (K42) dan tabel "Baseline vs sekarang" (K41).
const SEC_ACT_START = "Mulai aktual";
const SEC_ACT_FINISH = "Selesai aktual";
const SEC_ACT_TODAY = "Catat hari ini";
const SEC_ACT_NONE = "Belum dicatat";
const SEC_BL_VS = "Baseline vs sekarang";
const SEC_BL_NOW = "Sekarang";
const SEC_BL_DIFF = "Selisih";

// Kunci halaman pref `bl:<page>` (1c-2 P2 a) untuk seksi: konteks taskDetail.sections tidak membawa page, maka diturunkan
// dari task persis seperti id halaman host (pageScopePred): task workspace → "slist_<list_id>", task pribadi ber-project →
// "proj_<project>"; pribadi tanpa project → null (tidak punya halaman, tidak ada baseline aktif). Beda kapital nama project
// diselesaikan prefKey (bl dilipat A–Z). Pref dibaca saat pasang / ganti halaman saja: api.storage tidak punya peristiwa
// perubahan, jadi pilihan baseline baru di view tampil di seksi setelah seksi dipasang ulang (buka task lagi).
function secPageOf(task, ws) {
  if (ws) return "slist_" + task.list_id;
  const p = typeof task.project === "string" ? task.project : "";
  return p ? "proj_" + p : null;
}

// ── "Kenapa dijadwalkan di sini?" (R21) ──
// whyText(ex, ctx) → Array<string | {b: string}> (murni). ex = hasil explain mesin; ctx = {label(key) → "{WBS} {judul}",
// title(key) → judul, d?: durasi simpul (hari kerja)}. Kalimat Mulai per jenis, lalu (bila ada tanggal dan durasi ≥ 1)
// "Durasi {d} hari kerja[ melompati {daftar}], jadi selesai **{tglF}**" + tenggat ", {k} hari kerja setelah tenggat {tglDl}."
// atau ".". d = ctx.d (milestone 0 tidak bisa dibedakan dari 1 hari tanpa itu), cadangan rentang − durSkipped (= hari
// bukan kerja di [start, finish]); hari bukan kerja di ujung rentang (Manual tersimpan di
// akhir pekan: hari mulai sendiri) tidak disebut "melompati". Daftar hari: akhir pekan berurutan "Sab–Min", libur/cuti =
// nama (berurutan bernama sama = satu sebutan), hari lain = tanggal; maks 6 hari disebut lalu "dan {n} hari lain".
const WHY_TEXT = {
  root: "Mulai di tanggal yang kamu tentukan.",
  manual: "Task ini Manual: tanggal mengikuti yang kamu isi.",
  done: "Task ini sudah selesai: tanggalnya tidak dihitung ulang.",
  started: "Task ini sudah mulai: tanggal mulainya dikunci.",
  unscheduled: "Belum dijadwalkan."
};
const WHY_LIST_MAX = 6;
const WHY_WEEKEND = "Sab–Min";
const WHY_DAY = {
  Sabtu: "Sabtu",
  Minggu: "Minggu"
};

// Hari {dn, why, name?} (urut naik) → kelompok sebutan [{label, n}]: Sabtu+Minggu berurutan = satu kelompok; libur/cuti
// berurutan dengan nama sama = satu kelompok; selain itu per hari. Lebih dari satu kelompok akhir pekan → diberi tanggal.
function whyGroups(days) {
  const list = days.slice().sort((a, b) => a.dn - b.dn);
  const groups = [];
  for (const x of list) {
    const last = groups[groups.length - 1];
    const prev = last ? last.days[last.days.length - 1] : null;
    const next = !!prev && x.dn === prev.dn + 1;
    if (next && last.kind === "wk" && prev.why === "Sabtu" && x.why === "Minggu" && last.days.length === 1) last.days.push(x);else if (next && last.kind === "name" && x.name && x.name === last.name && (x.why === "libur" || x.why === "cuti")) last.days.push(x);else if (x.why === "Sabtu" || x.why === "Minggu") groups.push({
      kind: "wk",
      days: [x]
    });else if ((x.why === "libur" || x.why === "cuti") && x.name) groups.push({
      kind: "name",
      name: x.name,
      days: [x]
    });else groups.push({
      kind: "day",
      days: [x]
    });
  }
  const wkCount = groups.filter(g => g.kind === "wk").length;
  return groups.map(g => {
    const first = g.days[0];
    const lastDay = g.days[g.days.length - 1];
    let label;
    if (g.kind === "name") label = g.name;else if (g.kind === "day") label = TLCal.fmtShort(first.dn);else if (g.days.length === 2) {
      if (wkCount === 1) label = WHY_WEEKEND;else {
        const a = TLCal.fmtShort(first.dn).split(" ");
        const b = TLCal.fmtShort(lastDay.dn).split(" ");
        label = a[0] + " " + a[1] + (a[2] === b[2] ? "" : " " + a[2]) + "–" + b[0] + " " + b[1] + " " + b[2];
      }
    } else label = wkCount === 1 ? WHY_DAY[first.why] : TLCal.fmtShort(first.dn);
    return {
      label,
      n: g.days.length
    };
  });
}
function whyList(days) {
  const groups = whyGroups(days);
  const total = groups.reduce((a, g) => a + g.n, 0);
  const shown = [];
  let used = 0;
  for (const g of groups) {
    if (shown.length && used + g.n > WHY_LIST_MAX) break;
    shown.push(g.label);
    used += g.n;
  }
  return shown.join(", ") + (total > used ? " dan " + (total - used) + " hari lain" : "");
}
function whyText(ex, ctx) {
  const e = ex && typeof ex === "object" ? ex : {
    kind: "unscheduled"
  };
  const cx2 = ctx && typeof ctx === "object" ? ctx : {};
  const label = k => typeof cx2.label === "function" ? String(cx2.label(k)) : String(k);
  const title = k => typeof cx2.title === "function" ? String(cx2.title(k)) : String(k);
  const dated = Number.isInteger(e.start) && Number.isInteger(e.finish);
  const out = [];
  const say = p => {
    if (typeof p === "string" && typeof out[out.length - 1] === "string") out[out.length - 1] += p;else out.push(p);
  };
  const kind = e.kind;
  if (kind === "cycle") {
    const w = Array.isArray(e.cycleWith) ? e.cycleWith.map(title) : [];
    // "dirinya sendiri": cadangan defensif untuk lingkaran diri (cycleWith kosong) — hanya data rusak (canLink menolak
    // dependensi ke diri sendiri); teks di luar R28 (dicatat controller untuk T14).
    say("Dependensinya melingkar dengan " + (w.length ? w.join(", ") : "dirinya sendiri") + "; tidak dihitung.");
    return out;
  }
  if (!dated || kind === "unscheduled") return [WHY_TEXT.unscheduled];
  if (kind === "done") return [WHY_TEXT.done];
  if (kind === "pred") {
    const lag = Number.isFinite(e.lag) ? e.lag : 0;
    const days = (lag > 0 && Array.isArray(e.lagDays) ? e.lagDays.map(dn => ({
      dn,
      why: "lag"
    })) : []).concat(Array.isArray(e.skipped) ? e.skipped : []);
    const side = e.type === "SS" || e.type === "SF" ? " mulai " : " selesai ";
    say("Mulai ");
    say({
      b: TLCal.fmtShort(e.start)
    });
    say(" karena menunggu ");
    say({
      b: label(e.pred)
    });
    say(side + (Number.isInteger(e.base) ? TLCal.fmtShort(e.base) : "—"));
    if (lag !== 0) say(", ditambah lag " + (lag < 0 ? "−" + -lag : lag) + " hari");
    if (days.length) say(" (" + whyList(days) + " dilewati)");
    say(".");
  } else if (kind === "snet") {
    say("Mulai ");
    say({
      b: TLCal.fmtShort(e.start)
    });
    say(" karena batasan: mulai tidak lebih awal dari " + TLCal.fmtShort(Number.isInteger(e.base) ? e.base : e.start) + ".");
  } else if (kind === "mfo") say("Harus selesai pada " + TLCal.fmtShort(e.finish) + " (batasan).");else say(WHY_TEXT[kind] || WHY_TEXT.root);
  // Kalimat durasi + tenggat
  const span = e.finish - e.start + 1;
  const skip = (Array.isArray(e.durSkipped) ? e.durSkipped : []).filter(x => x && Number.isInteger(x.dn) && x.dn >= e.start && x.dn <= e.finish);
  const d = Number.isInteger(cx2.d) ? cx2.d : span - skip.length;
  if (d < 1) return out; // milestone
  const set = new Set(skip.map(x => x.dn));
  let lo = e.start;
  while (set.has(lo)) lo++;
  let hi = e.finish;
  while (set.has(hi)) hi--;
  const inner = skip.filter(x => x.dn > lo && x.dn < hi);
  say(" Durasi " + d + " " + SEC_HK + (inner.length ? " melompati " + whyList(inner) : "") + ", jadi selesai ");
  say({
    b: TLCal.fmtShort(e.finish)
  });
  say(e.late > 0 && Number.isInteger(e.deadline) ? ", " + e.late + " " + SEC_HK + " setelah tenggat " + TLCal.fmtShort(e.deadline) + "." : ".");
  return out;
}
function secBadText(n) {
  return n + " dependensi rusak atau tidak dikenali versi ini";
}
function secLateText(finishDn, late) {
  return "Selesai " + TLCal.fmtShort(finishDn) + ", " + late + " " + SEC_HK + " setelah tenggat";
}
const liveTask = t => !!t && typeof t === "object" && !t.recurrence_type && t.gtd_status !== "archived" && !t.deleted;

// Scope dependensi seksi (R15): workspace sama (`list_id`), atau pribadi dengan project sama (lipatan host
// projectNameFold; keduanya tanpa project juga sama) — kunci yang sama dengan TLSched.canLink.
const secScopeKey = TLSched.scopeKeyOf;
function taskTitle(t) {
  return t && t.title !== undefined && t.title !== null && String(t.title).trim() ? String(t.title).trim() : "Tanpa judul";
}

// Kunci kanonik (urut) agar urutan kunci ext dari host tidak dianggap perubahan.
function stableKey(o) {
  const src = o && typeof o === "object" ? o : {};
  const out = {};
  for (const k of Object.keys(src).sort()) out[k] = src[k];
  return JSON.stringify(out);
}
function readExtSafe(api, task) {
  try {
    const r = api.taskExt.read(task);
    return r && typeof r === "object" && !Array.isArray(r) ? r : {};
  } catch (e) {
    logWarn(api, "ext jadwal gagal dibaca:", e);
    return {};
  }
}

// Patch → ext mentah baru (null = kunci dihapus), tanpa mengubah masukan.
function applyRaw(raw, patch) {
  const out = Object.assign({}, raw);
  for (const k of Object.keys(patch)) {
    if (patch[k] === null) delete out[k];else out[k] = patch[k];
  }
  return out;
}

// Kembalikan kunci patch ke nilai `before` (kunci yang dulu tidak ada → dihapus).
function revertRaw(raw, patch, before) {
  const out = Object.assign({}, raw);
  for (const k of Object.keys(patch)) {
    if (Object.prototype.hasOwnProperty.call(before, k)) out[k] = before[k];else delete out[k];
  }
  return out;
}

// Dependensi tampil dari deps mentah: [{i: indeks mentah, key, lag, type}] (sah, unik, ≤ 20); bad = sisanya (rusak, tipe
// yang belum dikenal versi ini seperti SS, ganda, atau deps bukan array). Item mentah tidak pernah ditulis ulang
// lewat sanitasi (kebijakan Task 8): ubah/hapus menyentuh satu indeks, sisanya apa adanya.
function depRowsOf(raw) {
  const list = Array.isArray(raw.deps) ? raw.deps : [];
  const rows = [];
  const seen = new Set();
  list.forEach((item, i) => {
    const d = TLSched.readSched({
      deps: [item]
    }).deps[0];
    if (!d || seen.has(d.key) || rows.length >= TLSched.MAX_DEPS) return;
    seen.add(d.key);
    rows.push({
      i,
      key: d.key,
      lag: d.lag,
      type: d.type
    });
  });
  const bad = raw.deps === undefined || raw.deps === null ? 0 : Array.isArray(raw.deps) ? list.length - rows.length : 1;
  return {
    rows,
    bad
  };
}

// Anak hidup per induk (kunci String(id) induk kanonik), parent_id server atau parent_cid offline (R9/R10).
function childrenOf(list, idx) {
  const kids = new Map();
  for (const t of list) {
    if (!liveTask(t)) continue;
    const p = t.parent_id !== undefined && t.parent_id !== null ? t.parent_id : t.parent_cid;
    if (p === undefined || p === null || p === "") continue;
    const par = idx.get(String(p));
    if (!par || par === t || par.id === undefined || par.id === null) continue;
    const k = String(par.id);
    let a = kids.get(k);
    if (!a) kids.set(k, a = []);
    a.push(t);
  }
  return kids;
}

// Induk dengan anak hidup di `list` (daftar task lengkap) = ringkasan (R10) — logika yang sama dengan seksi Jadwal.
function isSummaryIn(list, task) {
  const all = Array.isArray(list) ? list : [];
  const idx = TLSched.buildIndex(all);
  const self = task && idx.get(String(task.id)) || task;
  if (!self || self.id === undefined || self.id === null) return false;
  const kids = childrenOf(all, idx).get(String(self.id));
  return !!(kids && kids.length);
}

// SATU pemeriksaan dependensi baru pred → succ (R15) untuk Gantt (link) dan seksi Jadwal (pemilih), terhadap daftar
// task LENGKAP `list` (api.data.tasks.list({includeDone: true}); bukan scopeTasks yang difilter panel host):
// scope = task hidup dengan scopeKeyOf sama dengan penerus; edge dari ext semua task scope; ringkasan = punya anak
// hidup di scope; canLink (diri sendiri, scope, ringkasan, ganda, maks, siklus); dependensi tersimpan jenis apa pun ke
// pendahulu yang sama (cid/server_id lewat indeks) = ganda. readRaw(t, isSucc) → ext mentah task (penerus: nilai
// lokal/efektif pemanggil). → {ok: true, deps: deps lama apa adanya + item baru} | {ok: false, reason}.
function checkLink(api, list, pred, succ, readRaw) {
  const all = Array.isArray(list) ? list : [];
  const idx = TLSched.buildIndex(all);
  const self = succ && idx.get(String(succ.id)) || succ;
  const p = pred && idx.get(String(pred.id)) || pred;
  if (!self || !p) return {
    ok: false,
    reason: "scope"
  };
  const sk = secScopeKey(self);
  const scope = all.filter(t => liveTask(t) && secScopeKey(t) === sk);
  if (scope.indexOf(self) < 0) scope.push(self);
  const rawOf = t => {
    const r = readRaw(t, t === self);
    return r && typeof r === "object" && !Array.isArray(r) ? r : {};
  };
  const raw = rawOf(self);
  const old = Array.isArray(raw.deps) ? raw.deps : [];
  const sidx = TLSched.buildIndex(scope);
  const edges = TLSched.resolveDeps(scope.map(t => ({
    task: t,
    sched: TLSched.readSched(t === self ? raw : rawOf(t))
  })), sidx);
  const chk = TLSched.canLink({
    pred: p,
    succ: self,
    scopeTasks: scope,
    edges,
    depCount: old.length
  });
  if (!chk.ok) return chk;
  if (old.some(d => {
    const k = d && typeof d === "object" ? TLSched.refKey(d.t) : null;
    return k !== null && (k === String(p.id) || idx.get(k) === p);
  })) return {
    ok: false,
    reason: "dup"
  };
  let ref;
  try {
    ref = api.taskExt.ref(p);
  } catch (e) {
    logWarn(api, "ref dependensi gagal:", e);
    return {
      ok: false,
      reason: "ref"
    };
  }
  const san = TLSched.sanitizePatch({
    deps: [{
      t: ref,
      type: "FS",
      lag: 0
    }]
  });
  if (!san.ok) return {
    ok: false,
    reason: "ref"
  };
  return {
    ok: true,
    deps: old.concat(san.patch.deps)
  };
}

// Rentang task: daun = spanOf(ext); induk = min–maks anak terjadwal, rekursif (R10). Lingkaran induk diputus.
function spanTree(c, t, kids, readOf, seen) {
  const k = String(t.id);
  const ch = kids.get(k);
  if (!ch || !ch.length) return TLSched.spanOf(c, readOf(t));
  if (seen.has(k)) return null;
  seen.add(k);
  let s = Infinity;
  let f = -Infinity;
  for (const x of ch) {
    const sp = spanTree(c, x, kids, readOf, seen);
    if (!sp) continue;
    if (sp.s < s) s = sp.s;
    if (sp.f > f) f = sp.f;
  }
  return s === Infinity ? null : {
    s,
    f
  };
}
function calSafe(fn) {
  try {
    const v = fn();
    return Number.isInteger(v) ? v : null;
  } catch (e) {
    return null; // TL_CAL_LOOP: kalender tanpa hari kerja terjangkau → tidak terhitung
  }
}

// Salinan task yang lebih baru (updated_at) — task di modal adalah salinan saat dibuka (R17), daftar api.data.tasks
// membawa progres/tenggat terkini. Seri → props.
function fresherTask(propsTask, listed) {
  if (!listed) return propsTask;
  const a = Date.parse(propsTask.updated_at || "");
  const b = Date.parse(listed.updated_at || "");
  return Number.isFinite(b) && (!Number.isFinite(a) || b > a) ? listed : propsTask;
}
function pctOf(t) {
  if (t.gtd_status === "done" || t.completed_at) return 100;
  const p = Number(t.progress);
  return Number.isFinite(p) ? Math.round(Math.min(100, Math.max(0, p))) : 0;
}
function commitDate(v) {
  if (typeof v !== "string" || !TLCal.isIso(v)) return false;
  const y = Number(v.slice(0, 4));
  return y >= SEC_YEAR_MIN && y <= SEC_YEAR_MAX;
}

// Angka dari input teks: kosong/bukan angka → null; selain itu dibulatkan dan dijepit.
function clampText(v, lo, hi) {
  const s = String(v === undefined || v === null ? "" : v).trim();
  if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return Math.min(hi, Math.max(lo, Math.round(n)));
}

// Penjaga tanpa hooks: task berulang / tanpa id → null (Q5, R17); selain itu badan berhook sebagai elemen.
function ScheduleSection(props) {
  const context = props && props.context;
  const task = context && context.task;
  if (!task || typeof task !== "object" || task.recurrence_type) return null;
  if (task.id === undefined || task.id === null || task.id === "") return null;
  return React.createElement(ScheduleBody, props);
}
function ScheduleBody(props) {
  const {
    context,
    api
  } = props;
  const task = context.task;
  const tid = task.id;
  const propRaw = readExtSafe(api, task);
  const propKey = stableKey(propRaw);

  // Daftar task (judul dependensi, ringkasan, rentang pendahulu, progres terkini, ext terbaru). Dimuat saat task/ext
  // berganti, saat sinkron selesai, dan (dibatasi) saat seksi difokus/disentuh; pemilih memuat sendiri saat dibuka.
  // Berurutan: hanya jawaban permintaan terbaru yang dipakai.
  const [all, setAll] = React.useState(null);
  const loadRef = React.useRef({
    at: 0,
    alive: true,
    seq: 0
  });
  const loadAll = () => {
    const L = loadRef.current;
    L.at = nowMs();
    const seq = ++L.seq;
    return Promise.resolve().then(() => api.data.tasks.list({
      includeDone: true
    })).then(list => {
      const arr = Array.isArray(list) ? list : [];
      if (L.alive && seq === L.seq) setAll(arr);
      return arr;
    }, e => {
      logWarn(api, "daftar task gagal dimuat:", e);
      if (L.alive && seq === L.seq) setAll(p => p || []); // tetap bisa dipakai tanpa daftar
      return null;
    });
  };
  const view = React.useMemo(() => {
    const list = all || [];
    const idx = TLSched.buildIndex(list);
    return {
      list,
      idx,
      kids: childrenOf(list, idx)
    };
  }, [all]);
  const listedSelf = view.idx.get(String(tid)) || null;
  // Salinan terbaru (updated_at): modal membawa salinan saat dibuka; daftar membawa ext/progres/tenggat terkini.
  const info = fresherTask(task, listedSelf);
  const srcRaw = info === task ? propRaw : readExtSafe(api, info);
  const srcKey = info === task ? propKey : stableKey(srcRaw);
  const writeId = listedSelf && listedSelf.id !== undefined && listedSelf.id !== null ? listedSelf.id : tid;
  const actIds = React.useRef(null);
  actIds.current = {
    tid: String(tid),
    wid: String(writeId)
  };

  // R17 state lokal optimistis: di-seed ulang saat task.id berganti, atau saat ext sumber terbaru (props atau daftar)
  // berubah selama tidak ada tulis berjalan dan tidak ada draf input. Sumber yang sudah menyusul (sama dengan lokal)
  // hanya memperbarui kunci.
  const inflight = React.useRef(0);
  // Fix T11: tulis berjalan seksi — set 1b (promise selesai per tulis) dan writeMany (satu sekaligus + kunci task-nya);
  // Urungkan menunggu keduanya, set 1b pada task yang sedang di-setMany diabaikan.
  const singleRef = React.useRef(new Set());
  const manyRef = React.useRef(null);
  const manyKeys = React.useRef(new Set());
  const [loc, setLoc] = React.useState(() => ({
    id: tid,
    key: srcKey,
    raw: srcRaw,
    d: {}
  }));
  let cur = loc;
  if (loc.id !== tid) cur = {
    id: tid,
    key: srcKey,
    raw: srcRaw,
    d: {}
  };else if (loc.key !== srcKey && inflight.current === 0 && !Object.keys(loc.d).length) {
    cur = stableKey(loc.raw) === srcKey ? Object.assign({}, loc, {
      key: srcKey
    }) : {
      id: tid,
      key: srcKey,
      raw: srcRaw,
      d: {}
    };
  }
  if (cur !== loc) setLoc(cur);
  const [, setTick] = React.useState(0);
  const raw = cur.raw;
  const sched = TLSched.readSched(raw);
  const deps = depRowsOf(raw);
  // Durasi bukan-nol terakhir di mount ini (per task) untuk "hapus centang Milestone".
  const lastDur = React.useRef({
    id: tid,
    n: null
  });
  if (lastDur.current.id !== tid) lastDur.current = {
    id: tid,
    n: null
  };
  if (sched.start !== null && sched.duration > 0) lastDur.current.n = sched.duration;
  const [open, setOpenPref] = usePref(api, "section", "");
  const [forceOpen, setForceOpen] = React.useState(false);
  const expanded = open || forceOpen;
  const [picker, setPicker] = React.useState(null); // null | {q, list: null | task[]}

  const target = calTarget(task.list_id);
  const cal = useCalendar(api, target);
  const c = React.useMemo(() => TLCal.compile(cal.data), [cal.data]);
  // 1c-1 R20: unit jadwal task (mode efektif). Workspace → record project scope list (projectStore.loadUnits jalur
  // daftar); pribadi → satu record unitOf(task) (jalur get). Penjaga tabrakan fold di TLSched.unitFor / modeOf.
  const wsTask = target.scope !== "user";
  const pageKind = wsTask ? "workspace" : "project";
  const un = useUnits(api, wsTask ? {
    pageKind,
    listId: task.list_id
  } : {
    pageKind,
    projectName: task.project
  });
  React.useEffect(() => {
    loadRef.current.alive = true;
    loadAll();
    return undefined;
  }, [api, tid, propKey]);
  React.useEffect(() => {
    let off = null;
    let offAct = null;
    try {
      off = api.events.on("sync.done", () => {
        loadAll();
      });
      // 1c-2 Task 8: pelacak aktual menulis task ini → muat ulang daftar (baca saja) agar nilai tersimpan mutakhir.
      offAct = api.events.on(ACT_EVENT, p => {
        const ids = actIds.current;
        if (p && (String(p.taskId) === ids.tid || String(p.taskId) === ids.wid)) loadAll();
      });
    } catch (e) {
      logWarn(api, "pendengar sync.done gagal:", e);
    }
    return () => {
      loadRef.current.alive = false;
      if (typeof off === "function") off();
      if (typeof offAct === "function") offAct();
    };
  }, [api]);
  const refreshSoon = () => {
    if (nowMs() - loadRef.current.at > SEC_REFRESH_MS) loadAll();
  };
  const selfLive = listedSelf || task;
  const readOther = t => TLSched.readSched(t === selfLive ? raw : readExtSafe(api, t));

  // 1c-1 R20 secEngine = {result, node, wbs, ctx}: mesin seksi sendiri atas daftar LENGKAP scope task (`all` 1b; ext
  // task ini = nilai lokal optimistis). Dihitung di useMemo HANYA setelah `all` ada — render pertama tidak menjalankan
  // mesin. Tidak pernah menulis (R25): drift hanya ditampilkan, tulisan berasal dari klik Mode / "Perbarui".
  const rawKey = stableKey(raw);
  const unitsKey = unitsKeyOf(un.units);
  const secEngine = React.useMemo(() => {
    if (all === null) return null;
    const scope = scopeFilter(all, [selfLive]);
    if (scope.indexOf(selfLive) < 0) scope.push(selfLive);
    const readExt = t => t === selfLive ? raw : readExtSafe(api, t);
    try {
      const ctx = {
        tasks: scope,
        cal: c,
        units: un.units,
        readExt
      };
      const result = engine.run(ctx);
      const wbs = TLLayout.wbsMap(scope, pageKind, t => TLSched.readSched(readExt(t)));
      return {
        result,
        node: result.nodes.get(String(selfLive.id)) || null,
        wbs,
        ctx,
        self: selfLive
      };
    } catch (e) {
      logWarn(api, "mesin jadwal seksi gagal:", e);
      return null;
    }
  }, [all, selfLive, rawKey, unitsKey, c, pageKind]);
  const effMode = TLSched.modeOf(raw, un.units, selfLive);
  const unitU = TLSched.unitFor(un.units, selfLive);
  const unitMode = unitU && unitU.auto === true ? "auto" : "manual";
  // Task 12: simpul otomatis terhitung = tingkat 2/3 (Mulai otomatis = teks + "Ubah" → R12).
  const autoNode = effMode === "auto" && secEngine && secEngine.node && secEngine.node.es !== null && secEngine.node.ef !== null ? secEngine.node : null;
  // 1c-2 Task 7: baseline aktif = pref bl:<page> (halaman diturunkan dari task, secPageOf) + useBaselines atas SATU unit
  // task (TLSched.unitOf; satu list se-scope) — dimuat hanya bila slot 1–3 dipilih. Baris task = baselineOverlay (resolusi
  // ref yang sama dengan bar Gantt T6) atas hasil mesin seksi. Hanya baca (R25).
  const blPageKey = secPageOf(selfLive, wsTask);
  const [blPref] = usePref(api, "bl", blPageKey || "");
  const blN = blPageKey !== null ? blPref : 0;
  const blUnit = TLSched.unitOf(selfLive);
  const bls = useBaselines(api, blN > 0 ? [blUnit] : []);
  const blDec = React.useMemo(() => activeBaseline(bls.byUnit, [blUnit.recId], blN), [bls.byUnit, blUnit.recId, blN]);
  const blOv = React.useMemo(() => secEngine ? baselineOverlay(blDec, secEngine.result, secEngine.ctx) : null, [blDec, secEngine]);
  const blRow = autoNode && blOv ? blOv.get(autoNode.key) || null : null;
  // Mesin seksi atas daftar segar (hitung ulang PreviewCard setelah CAS gagal): semua ext dari daftar terbaru.
  const runSec = list => {
    const me = TLSched.buildIndex(list).get(String(selfLive.id)) || selfLive;
    const scope = scopeFilter(list, [me]);
    if (scope.indexOf(me) < 0) scope.push(me);
    const readExt = t => readExtSafe(api, t);
    try {
      const ctx = {
        tasks: scope,
        cal: c,
        units: un.units,
        readExt
      };
      const result = engine.run(ctx);
      const wbs = TLLayout.wbsMap(scope, pageKind, t => TLSched.readSched(readExt(t)));
      return {
        result,
        node: result.nodes.get(String(me.id)) || null,
        wbs,
        ctx,
        self: me
      };
    } catch (e) {
      logWarn(api, "mesin jadwal seksi gagal:", e);
      return null;
    }
  };

  // Task 12 state tingkat 3 (semua per task: nilai = tid saat aktif): "Ubah" Mulai otomatis, "Kenapa" terbuka, kartu
  // pratinjau aliran > CASCADE_MAX ({id, tid, op, items, model, busy}; ref = penjaga sinkron klik ganda Terapkan).
  const [editStart, setEditStart] = React.useState(null);
  const [whyOpen, setWhyOpen] = React.useState(null);
  const [card, setCardS] = React.useState(null);
  const cardRef = React.useRef(null);
  const cardSeq = React.useRef(0);
  const setCard = v => {
    cardRef.current = v;
    setCardS(v);
  };
  // R21: explain HANYA saat "Kenapa" dibuka (terlipat bawaan), atas hasil + kalender + readExt run seksi yang sama.
  const whyParts = React.useMemo(() => {
    if (whyOpen !== tid || !autoNode) return null;
    const eng = secEngine;
    const ex = engine.explain(eng.result, autoNode.key, eng.ctx.cal, eng.ctx.readExt);
    const taskOf = k => {
      const n = eng.result.nodes.get(String(k));
      return n ? n.task : view.idx.get(String(k)) || null;
    };
    const title = k => taskTitle(taskOf(k));
    const label = k => {
      const w = eng.wbs.get(String(k));
      return (w ? w + " " : "") + title(k);
    };
    return whyText(ex, {
      label,
      title,
      d: autoNode.d
    });
  }, [whyOpen, tid, secEngine, autoNode, view.idx]);

  // ---- tulis ----
  const setDraft = (name, value) => setLoc(p => p.id === tid ? Object.assign({}, p, {
    d: Object.assign({}, p.d, {
      [name]: value
    })
  }) : p);
  const clearDraft = name => setLoc(p => {
    if (p.id !== tid || !(name in p.d)) return p;
    const d = Object.assign({}, p.d);
    delete d[name];
    return Object.assign({}, p, {
      d
    });
  });
  const write = (patch, draftName) => {
    if (manyRef.current && manyKeys.current.has(String(writeId))) {
      if (draftName) clearDraft(draftName); // task ini sedang ditulis massal → diabaikan (aturan sibuk)
      return;
    }
    const before = raw;
    setLoc(p => {
      if (p.id !== tid) return p;
      const d = Object.assign({}, p.d);
      if (draftName) delete d[draftName];
      return Object.assign({}, p, {
        raw: applyRaw(p.raw, patch),
        d
      });
    });
    inflight.current += 1;
    let p;
    try {
      // panggil sinkron: urutan tulis = urutan aksi pengguna. Id dari daftar: salinan modal ber-cid basi → id terkini.
      p = Promise.resolve(api.taskExt.set(writeId, patch));
    } catch (e) {
      p = Promise.reject(e);
    }
    p.then(null, e => {
      logWarn(api, "jadwal gagal disimpan:", e);
      toastSafe(api, MSG_SAVE_FAIL, "error");
      setLoc(p => p.id === tid ? Object.assign({}, p, {
        raw: revertRaw(p.raw, patch, before)
      }) : p);
    }).then(() => {
      inflight.current = Math.max(0, inflight.current - 1);
      setTick(n => n + 1); // render ulang: props yang menyusul selama tulis kini boleh men-seed
    });
    const settled = p.then(() => undefined, () => undefined);
    singleRef.current.add(settled);
    settled.then(() => singleRef.current.delete(settled));
  };
  // R20 "Aliran dari seksi" (fix T11 + Task 12; R12: perubahan start/duration/deps/mode/constraint mengalir K32):
  // op(eng) → {items (flowItems), after} atas mesin seksi. 0 item → diam. Turunan > CASCADE_MAX → PreviewCard (0 tulis
  // sampai Terapkan; draf dibuang). 1..20 → writeMany + "Jadwal diubah · {n} task ikut bergeser". 0 turunan: `single`
  // (edit isian/dependensi) → set 1b dengan patch item task ini; selain itu (Mode, Perbarui) → writeMany "Jadwal diubah".
  const runFlow = (op, o) => {
    const r = op(secEngine);
    const items = r.items;
    if (!items.length) {
      if (o.draft) clearDraft(o.draft);
      return;
    }
    const down = items.filter(it => !isSelf(it.task)).length;
    if (down > TLPlan.CASCADE_MAX) {
      if (o.draft) clearDraft(o.draft);
      setCard({
        id: ++cardSeq.current,
        tid,
        op,
        items,
        model: cardModel(secEngine, r),
        busy: false
      });
      return;
    }
    const mine = items.find(it => isSelf(it.task));
    if (!down && o.single && mine) {
      write(mine.patch, o.draft);
      return;
    }
    writeMany(items, {
      text: down ? flowText(down) : MSG_CHANGED,
      draft: o.draft
    });
  };
  // Patch task ini → TLPlan.cascade. Patch `deps` = larik mentah apa adanya (kebijakan Task 8: item lain tidak pernah
  // ditulis ulang lewat sanitasi — cascade memakai bentuk bersih untuk menghitung, item task ini menulis larik mentah).
  const cascadeOp = patch => eng => {
    const r = TLPlan.cascade(eng.ctx, [{
      task: eng.self,
      patch
    }], eng.result);
    let items = flowItems(r.items);
    if ("deps" in patch) items = items.map(it => isSelf(it.task) ? Object.assign({}, it, {
      patch: Object.assign({}, it.patch, {
        deps: patch.deps
      })
    }) : it);
    return {
      items,
      after: r.result
    };
  };
  // Model PreviewCard: TLPlan.preview (sebelum = hasil mesin seksi saat itu) + WBS seksi.
  const cardModel = (eng, r) => {
    const pm = TLPlan.preview(r.items, r.after, eng.ctx, eng.result);
    return pm ? dialogModel(pm, r.after, k => eng.wbs.get(k) || "") : EMPTY_PV_MODEL;
  };
  const writeSched = (p, draftName) => {
    let patch = p;
    if (!("deps" in p)) {
      const san = TLSched.sanitizePatch(p);
      if (!san.ok) {
        if (draftName) clearDraft(draftName);
        return;
      }
      patch = san.patch;
    }
    if (!secEngine) {
      write(patch, draftName);
      return;
    }
    runFlow(cascadeOp(patch), {
      single: true,
      draft: draftName
    });
  };
  // PreviewCard Terapkan (R14): muat ulang daftar lengkap → TLPlan.revalidate (nilai mentah). Berubah → toast "Data
  // berubah sejak pratinjau dibuka — hitung ulang" + kartu dihitung ulang dari daftar terbaru (op yang sama), 0 tulis.
  // Sama → SATU setMany lewat writeMany + "Jadwal diterapkan · {n} task" + Urungkan. Tulis massal berjalan → diabaikan
  // (aturan sibuk T11; kartu tetap). Batal = tutup, 0 tulis.
  const cancelCard = () => setCard(null);
  const applyCard = () => {
    const cd = cardRef.current;
    if (!cd || cd.busy || manyRef.current) return;
    const busy = Object.assign({}, cd, {
      busy: true
    });
    setCard(busy);
    loadAll().then(list => {
      if (cardRef.current !== busy) return;
      if (!list) {
        toastSafe(api, MSG_SAVE_FAIL, "error");
        setCard(cd);
        return;
      }
      const rawNow = new Map();
      for (const t of list) if (t && t.id !== undefined && t.id !== null) rawNow.set(String(t.id), readExtSafe(api, t));
      if (!TLPlan.revalidate(cd.items, rawNow).ok) {
        toastSafe(api, MSG_STALE, "error");
        const eng = runSec(list);
        if (!eng) {
          setCard(null);
          return;
        }
        const r = cd.op(eng);
        setCard(Object.assign({}, cd, {
          items: r.items,
          model: cardModel(eng, r),
          busy: false
        }));
        return;
      }
      setCard(null);
      writeMany(cd.items, {
        text: appliedText(cd.items.length)
      });
    });
  };

  // 1c-1 R20/R25 writeMany(items, {text, undo}) — pintu tulis massal seksi: SATU api.taskExt.setMany untuk semua item
  // ([{task, patch, before}] dari TLPlan); patch task ini langsung ke state lokal optimistis (diselaraskan seed 1b saat
  // host memperbarui props/daftar). Sukses → toast `text` + Urungkan (= writeMany(undoItems), tanpa toast sukses) dan
  // daftar dimuat ulang (turunan terbaru). Gagal → nilai lokal kembali + "Jadwal gagal disimpan"; sebagian (err.applied)
  // → "Sebagian jadwal gagal disimpan ({k} dari {n})" + Urungkan hanya yang tersimpan. Satu tulis massal sekaligus:
  // klik berikutnya selama berjalan diabaikan, Urungkan menunggu. → Promise<boolean>, tidak pernah reject.
  const isSelf = t => !!t && (t === selfLive || String(t.id) === String(selfLive.id));
  const idOf = t => isSelf(t) ? writeId : t.id; // task ini: id terkini dari daftar (penjaga salinan modal basi)
  const writeMany = (items, opts) => {
    const o = opts || {};
    const list = (Array.isArray(items) ? items : []).filter(it => it && it.task && it.patch);
    if (!list.length) return Promise.resolve(false);
    if (manyRef.current) {
      if (o.undo) return manyRef.current.then(() => writeMany(list, o));
      if (o.draft) clearDraft(o.draft);
      return Promise.resolve(false);
    }
    const mine = list.find(it => isSelf(it.task)) || null;
    const before = raw;
    if (mine || o.draft) {
      setLoc(p => {
        if (p.id !== tid) return p;
        const d = Object.assign({}, p.d);
        if (o.draft) delete d[o.draft];
        return Object.assign({}, p, {
          raw: mine ? applyRaw(p.raw, mine.patch) : p.raw,
          d
        });
      });
    }
    inflight.current += 1;
    manyKeys.current = new Set(list.map(it => String(idOf(it.task))));
    let p;
    try {
      p = Promise.resolve(api.taskExt.setMany(list.map(it => ({
        taskId: idOf(it.task),
        patch: it.patch
      }))));
    } catch (e) {
      p = Promise.reject(e);
    }
    // Urungkan: tunggu writeMany yang berjalan dan set 1b task ini yang belum selesai (pola undoAction T9), lalu kirim.
    const undoOf = done => ({
      label: MSG_UNDO,
      onClick: () => {
        const u = TLPlan.undoItems(done);
        const send = () => {
          const waits = manyRef.current ? [manyRef.current] : [];
          if (done.some(it => isSelf(it.task))) for (const w of singleRef.current) waits.push(w);
          if (waits.length) {
            Promise.all(waits).then(send);
            return;
          }
          writeMany(u.map((x, i) => ({
            task: done[i].task,
            patch: x.patch
          })), {
            undo: true
          });
        };
        send();
      }
    });
    const run = p.then(() => {
      if (!o.undo) toastSafe(api, o.text || MSG_CHANGED, "success", undoOf(list));
      loadAll();
      return true;
    }, err => {
      logWarn(api, "jadwal gagal disimpan:", err);
      const ids = err && Array.isArray(err.applied) ? new Set(err.applied.map(String)) : null;
      const saved = ids ? list.filter(it => ids.has(String(idOf(it.task)))) : [];
      if (mine && saved.indexOf(mine) < 0) {
        setLoc(q => q.id === tid ? Object.assign({}, q, {
          raw: revertRaw(q.raw, mine.patch, before)
        }) : q);
      }
      if (!saved.length || o.undo) toastSafe(api, MSG_SAVE_FAIL, "error");else toastSafe(api, partialText(list.length - saved.length, list.length), "error", undoOf(saved));
      if (saved.length) loadAll();
      return false;
    }).then(r => {
      manyRef.current = null;
      manyKeys.current = new Set();
      inflight.current = Math.max(0, inflight.current - 1);
      setTick(n => n + 1);
      return r;
    });
    manyRef.current = run;
    return run;
  };

  // Aliran dari seksi (K32, R13 semantik cascade): patch task ini → TLPlan.cascade atas secEngine → item tanpa perubahan
  // dibuang (flowItems) → writeMany. Toast: hanya task ini → "Jadwal diubah"; ada turunan → "Jadwal diubah · {n} task
  // ikut bergeser". Turunan > CASCADE_MAX → PreviewCard sebelum menulis (Task 12). Mesin gagal → satu item task ini.
  const flowFrom = patch => {
    if (secEngine) {
      runFlow(cascadeOp(patch), {});
      return;
    }
    const before = {};
    for (const k of SEC_ITEM_KEYS) before[k] = raw[k] === undefined ? null : JSON.parse(JSON.stringify(raw[k]));
    writeMany([{
      task: selfLive,
      key: String(writeId),
      before,
      patch
    }], {
      text: MSG_CHANGED
    });
  };
  // Kontrol Mode: pilihan = mode unit → {mode: null}, selain itu {mode: pilihan} (TLPlan.modePatch, penjaga fold unit).
  const pickMode = want => {
    if (want === effMode) return;
    const patch = TLPlan.modePatch(selfLive, un.units, want);
    if ((raw.mode === undefined ? null : raw.mode) === patch.mode) return;
    flowFrom(patch);
  };
  // "Perbarui" (drift task ini): Mulai task ini + turunan otomatis non-jangkar yang drift = TLPlan.diff dibatasi kunci
  // itu (start = iso(es), tanpa SNET) → SATU setMany. Hanya dari klik; pasang ulang / props berubah tidak menulis.
  // TLPlan.diff tidak punya `over`: gerbang PreviewCard dihitung runFlow dari jumlah item turunan (Task 12).
  const updateAuto = () => {
    if (!secEngine || !secEngine.node) return;
    runFlow(eng => {
      if (!eng.node) return {
        items: [],
        after: eng.result
      };
      const keys = secAutoReach(eng.result, eng.node.key);
      keys.add(eng.node.key);
      return {
        items: flowItems(TLPlan.diff(eng.result, eng.ctx, keys)),
        after: eng.result
      };
    }, {});
  };

  // Jepret ke hari kerja seperti seret/klik-jadwalkan (R13, R21): durasi ≥ 1 → nextWork; milestone boleh di hari libur (R6).
  const snapStart = (v, dur) => {
    if (dur === 0) return v;
    const n = calSafe(() => TLCal.nextWork(c, TLCal.dn(v)));
    return n === null ? v : TLCal.iso(n);
  };
  // Task 12 "Ubah" (Mulai otomatis, R12 = aturan jatuh Gantt): sebelum syarat dependensi → toast "Tidak bisa lebih awal
  // dari dependensinya", 0 tulis; selain itu patch TLPlan.gesture (berpendahulu / ber-SNET → + SNET) lalu mengalir.
  const commitAutoStart = v => {
    setEditStart(null);
    if (v === null) {
      clearDraft("start");
      return;
    }
    const x = snapStart(v, sched.start === null ? autoNode.d : sched.duration);
    // Input diisi iso(es): blur/Enter tanpa ubah (juga pada task drift / tanpa Mulai tersimpan) = 0 tulis. Menyelaraskan
    // Mulai tersimpan dengan hasil hitung adalah tugas "Perbarui" (tanpa SNET), bukan "Ubah".
    if (x === TLCal.iso(autoNode.es)) {
      clearDraft("start");
      return;
    }
    const p = {
      start: x
    };
    if (sched.start === null && !Number.isInteger(raw.duration)) p.duration = 1;
    const g = TLPlan.gesture(secEngine.result, selfLive, raw, p, c);
    if (!g.ok) {
      toastSafe(api, MSG_EARLY, "error");
      clearDraft("start");
      return;
    }
    writeSched(g.patch, "start");
  };
  const commitStart = v => {
    if (autoNode) {
      commitAutoStart(v);
      return;
    }
    if (v === null) {
      if (sched.start === null) clearDraft("start");else writeSched({
        start: null,
        duration: null
      }, "start");
      return;
    }
    const x = snapStart(v, sched.start === null ? 1 : sched.duration);
    if (x === sched.start) clearDraft("start");else if (sched.start === null) writeSched({
      start: x,
      duration: 1
    }, "start");else writeSched({
      start: x
    }, "start");
  };
  // Mulai: change hanya menyimpan draf; simpan saat blur / Enter, atau setelah jeda (pilihan kalender bawaan tanpa
  // blur) — satu tulis per edit. Jeda tertunda saat seksi dilepas/task berganti tetap disimpan (penutupan modal cepat).
  const startTimer = React.useRef(null); // {id, run}
  const cancelStartTimer = () => {
    const t = startTimer.current;
    startTimer.current = null;
    if (t) clearTimeout(t.id);
  };
  React.useEffect(() => () => {
    const t = startTimer.current;
    startTimer.current = null;
    if (t) {
      clearTimeout(t.id);
      t.run();
    }
  }, [tid]);
  const onStartChange = e => {
    const v = e && e.target ? String(e.target.value || "") : "";
    cancelStartTimer();
    setDraft("start", v);
    if (!commitDate(v)) return;
    const run = () => commitStart(v);
    const id = setTimeout(() => {
      if (startTimer.current && startTimer.current.id === id) {
        startTimer.current = null;
        run();
      }
    }, SEC_TIMING.startDebounceMs);
    startTimer.current = {
      id,
      run
    };
  };
  const onStartBlur = e => {
    cancelStartTimer();
    const t = e && e.target ? e.target : {};
    const v = String(t.value || "");
    if (commitDate(v)) commitStart(v);else if (v === "" && !(t.validity && t.validity.badInput)) commitStart(null);else clearDraft("start"); // tanggal setengah diketik / tak sah → kembali ke nilai tersimpan
  };
  const onStartKey = e => {
    if (!e || e.key !== "Enter") return;
    if (typeof e.preventDefault === "function") e.preventDefault();
    cancelStartTimer();
    const v = e.target ? String(e.target.value || "") : "";
    if (commitDate(v)) commitStart(v);
  };
  const commitDur = v => {
    const n = clampText(v, 1, TLSched.DUR_MAX);
    if (n === null || n === sched.duration || sched.start === null) clearDraft("dur");else writeSched({
      duration: n
    }, "dur");
  };
  const onEnter = fn => e => {
    if (!e || e.key !== "Enter") return;
    if (typeof e.preventDefault === "function") e.preventDefault();
    fn(e.target ? e.target.value : "");
  };
  const setMilestone = on => {
    if (sched.start === null) return;
    if (on) {
      if (sched.duration !== 0) writeSched({
        duration: 0
      });
      return;
    }
    if (sched.duration !== 0) return;
    const n = lastDur.current.id === tid && lastDur.current.n ? lastDur.current.n : 1;
    const patch = {
      duration: n
    };
    const x = snapStart(sched.start, n); // milestone di hari libur → bar mulai di hari kerja berikutnya
    if (x !== sched.start) patch.start = x;
    writeSched(patch);
  };
  const rawDeps = Array.isArray(raw.deps) ? raw.deps : [];
  const commitLag = (row, v) => {
    const name = "lag:" + row.i;
    const n = clampText(v, TLSched.LAG_MIN, TLSched.LAG_MAX);
    if (n === null || n === row.lag) {
      clearDraft(name);
      return;
    }
    writeSched({
      deps: rawDeps.map((it, j) => j === row.i ? Object.assign({}, it, {
        lag: n
      }) : it)
    }, name);
  };
  const removeDep = row => {
    const next = rawDeps.filter((_, j) => j !== row.i);
    writeSched({
      deps: next.length ? next : null
    }, "lag:" + row.i);
  };
  const cleanBad = () => {
    const keep = deps.rows.map(r => rawDeps[r.i]);
    writeSched({
      deps: keep.length ? keep : null
    });
  };
  // Task 12 (R20 "Menunggu"): ganti tipe satu dependensi → deps ditulis ulang UTUH, item lain apa adanya; mengalir.
  const changeType = (row, type) => {
    if (type === row.type || TLSched.TYPES.indexOf(type) < 0) return;
    writeSched({
      deps: rawDeps.map((it, j) => j === row.i ? Object.assign({}, it, {
        type
      }) : it)
    });
  };
  // Batasan (R20/R12): ASAP → constraint null; SNET/MFO dipilih → tanggal bawaan hasil hitung (Mulai / Selesai) agar
  // memilih jenis tidak menggeser apa pun; tanggal diubah lewat input → {type, date} baru. Semua mengalir.
  const pickCst = v => {
    const cur = sched.constraint;
    if (!autoNode) return;
    if (v === "") {
      if (cur) writeSched({
        constraint: null
      });
      return;
    }
    if (v !== "SNET" && v !== "MFO" || cur && cur.type === v) return;
    writeSched({
      constraint: {
        type: v,
        date: TLCal.iso(v === "SNET" ? autoNode.es : autoNode.ef)
      }
    });
  };
  const commitCst = v => {
    const cur = sched.constraint;
    if (!cur || !commitDate(v) || v === cur.date) clearDraft("cst");else writeSched({
      constraint: {
        type: cur.type,
        date: v
      }
    }, "cst");
  };
  // Tanggal batasan: pola Mulai 1b — change = draf + jeda; blur / Enter = langsung; jeda tertunda saat dilepas disimpan.
  const cstTimer = React.useRef(null);
  const cancelCstTimer = () => {
    const t = cstTimer.current;
    cstTimer.current = null;
    if (t) clearTimeout(t.id);
  };
  React.useEffect(() => () => {
    const t = cstTimer.current;
    cstTimer.current = null;
    if (t) {
      clearTimeout(t.id);
      t.run();
    }
  }, [tid]);
  const onCstChange = e => {
    const v = e && e.target ? String(e.target.value || "") : "";
    cancelCstTimer();
    setDraft("cst", v);
    if (!commitDate(v)) return;
    const run = () => commitCst(v);
    const id = setTimeout(() => {
      if (cstTimer.current && cstTimer.current.id === id) {
        cstTimer.current = null;
        run();
      }
    }, SEC_TIMING.startDebounceMs);
    cstTimer.current = {
      id,
      run
    };
  };
  const onCstBlur = e => {
    cancelCstTimer();
    const v = e && e.target ? String(e.target.value || "") : "";
    if (commitDate(v)) commitCst(v);else clearDraft("cst");
  };
  const onCstKey = e => {
    if (!e || e.key !== "Enter") return;
    if (typeof e.preventDefault === "function") e.preventDefault();
    cancelCstTimer();
    const v = e.target ? String(e.target.value || "") : "";
    if (commitDate(v)) commitCst(v);
  };

  // 1c-2 Task 7 tanggal aktual (K42, Review Focus 2). Dibaca HANYA lewat TLSched.actualOf (ext lokal optimistis):
  // selesai tanpa nilai tersimpan = turunan jkt(completed_at) (finishDerived). Yang TERSIMPAN = actualOf tanpa turunan.
  // Tulis = `write` seksi (SATU set {actual}, aturan sibuk, gagal → ext sebelumnya utuh lewat revertRaw): aktual adalah
  // JANGKAR (K30) — tidak mengalir; penerus yang jadi berbeda tampil sebagai drift (banner), tidak ditulis.
  // Kosongkan tersimpan → kunci itu dihapus (selesai kembali ke turunan); kosongkan turunan / nilai sama → 0 tulis;
  // selesai < mulai → ditolak sanitizePatch, 0 tulis.
  const act = TLSched.actualOf(selfLive, raw);
  const commitAct = (which, v) => {
    const name = "act:" + which;
    const stored = {};
    if (act.start !== null) stored.start = TLCal.iso(act.start);
    if (act.finish !== null && !act.finishDerived) stored.finish = TLCal.iso(act.finish);
    const shown = act[which] === null ? null : TLCal.iso(act[which]);
    const next = Object.assign({}, stored);
    if (v === null) {
      if (!(which in stored)) {
        clearDraft(name);
        return;
      }
      delete next[which];
    } else {
      if (!commitDate(v) || v === shown) {
        clearDraft(name);
        return;
      }
      next[which] = v;
    }
    const san = TLSched.sanitizePatch({
      actual: Object.keys(next).length ? next : null
    });
    if (!san.ok) {
      clearDraft(name);
      return;
    }
    write(san.patch, name);
  };
  // Simpanan tertunda (jeda input) memanggil commitAct TERBARU selama task sama: actual tersimpan dibaca ulang dari raw
  // terkini (bukan `act` saat ketik) — mis. selesai diubah selama jeda mulai tetap bertahan (fix T7). Task berganti →
  // closure task lama (raw miliknya) dipakai.
  const actLatest = React.useRef(null);
  actLatest.current = {
    tid,
    commit: commitAct
  };
  // "Catat hari ini" (jalur cadangan K42, aksi pengguna — juga untuk selesai): tanggal = api.env.today().
  const recordToday = which => {
    const t = safeToday(api);
    if (t !== null) commitAct(which, t);
  };
  // Input tanggal aktual: pola Batasan (change = draf + jeda; blur / Enter = langsung; jeda tertunda saat dilepas disimpan).
  const actTimers = React.useRef({});
  const cancelActTimer = which => {
    const t = actTimers.current[which];
    delete actTimers.current[which];
    if (t) clearTimeout(t.id);
  };
  React.useEffect(() => () => {
    const pend = actTimers.current;
    actTimers.current = {};
    for (const w of Object.keys(pend)) {
      clearTimeout(pend[w].id);
      pend[w].run();
    }
  }, [tid]);
  const onActChange = which => e => {
    const v = e && e.target ? String(e.target.value || "") : "";
    cancelActTimer(which);
    setDraft("act:" + which, v);
    if (!commitDate(v)) return;
    const own = commitAct;
    const run = () => {
      const L = actLatest.current;
      (L && L.tid === tid ? L.commit : own)(which, v);
    };
    const id = setTimeout(() => {
      const t = actTimers.current[which];
      if (t && t.id === id) {
        delete actTimers.current[which];
        run();
      }
    }, SEC_TIMING.startDebounceMs);
    actTimers.current[which] = {
      id,
      run
    };
  };
  const onActBlur = which => e => {
    cancelActTimer(which);
    const t = e && e.target ? e.target : {};
    const v = String(t.value || "");
    if (commitDate(v)) commitAct(which, v);else if (v === "" && !(t.validity && t.validity.badInput)) commitAct(which, null);else clearDraft("act:" + which);
  };
  const onActKey = which => e => {
    if (!e || e.key !== "Enter") return;
    if (typeof e.preventDefault === "function") e.preventDefault();
    cancelActTimer(which);
    const v = e.target ? String(e.target.value || "") : "";
    if (commitDate(v)) commitAct(which, v);
  };

  // ---- pemilih dependensi (R15, R17) ----
  const openPicker = () => {
    setForceOpen(true);
    setPicker({
      q: "",
      list: null
    });
    loadAll().then(list => {
      if (loadRef.current.alive) setPicker(p => p ? Object.assign({}, p, {
        list: list || []
      }) : p);
    });
  };
  const closePicker = () => setPicker(null);
  const pickIndex = React.useMemo(() => {
    const list = picker && picker.list ? picker.list : [];
    const idx = TLSched.buildIndex(list);
    return {
      list,
      idx,
      kids: childrenOf(list, idx)
    };
  }, [picker && picker.list]);

  // Pemeriksaan bersama dengan Gantt (checkLink) atas daftar lengkap pemilih; ext penerus = nilai lokal optimistis.
  const addDep = pred => {
    const chk = checkLink(api, pickIndex.list, pred, task, (t, isSucc) => isSucc ? raw : readExtSafe(api, t));
    if (!chk.ok) {
      if (LINK_MSG[chk.reason]) toastSafe(api, LINK_MSG[chk.reason], "error");
      return;
    }
    writeSched({
      deps: chk.deps
    });
    setPicker(null);
  };

  // ---- turunan tampilan ----
  const selfKids = view.kids.get(String(selfLive.id)) || [];
  const summary = selfKids.length > 0;
  const span = TLSched.spanOf(c, sched);
  const preds = [];
  const depView = deps.rows.map(r => {
    const p = all ? view.idx.get(r.key) : null;
    if (p) {
      const sp = spanTree(c, p, view.kids, readOther, new Set());
      if (sp) preds.push({
        span: sp,
        lag: r.lag
      });
    }
    const name = p ? taskTitle(p) : all ? SEC_DELETED : SEC_LOADING;
    const w = p && secEngine ? secEngine.wbs.get(String(p.id)) : null;
    return {
      row: r,
      name,
      full: w ? w + " " + name : name,
      outside: !!p && secScopeKey(p) !== secScopeKey(selfLive)
    };
  });
  const earliest = span && preds.length ? TLSched.shiftAfterDeps(c, null, preds) : null;
  const eff = span ? calSafe(() => TLCal.nextWork(c, span.s)) : null;
  const violated = earliest !== null && eff !== null && eff < TLCal.dn(earliest);
  const late = span ? TLSched.deadlineLate(c, span.f, info.deadline) : null;
  let pickerEl = null;
  if (picker) {
    const {
      list,
      idx,
      kids
    } = pickIndex;
    const self = idx.get(String(tid)) || null;
    const sk = secScopeKey(self || task);
    const q = picker.q.trim().toLowerCase();
    const depSet = new Set();
    for (const r of rawDeps) {
      const k = r && typeof r === "object" ? TLSched.refKey(r.t) : null;
      const found = k === null ? null : idx.get(k);
      if (found) depSet.add(found);
    }
    let cands = [];
    if (picker.list) {
      for (const t of list) {
        if (!liveTask(t) || t.id === undefined || t.id === null || idx.get(String(t.id)) !== t) continue;
        if (t === self || String(t.id) === String(tid) || secScopeKey(t) !== sk) continue;
        if ((kids.get(String(t.id)) || []).length) continue; // ringkasan tidak bisa jadi pendahulu di 1b (R10)
        if (q && taskTitle(t).toLowerCase().indexOf(q) < 0) continue;
        cands.push(t);
      }
      // urutan tetap: belum selesai dulu, lalu judul (id), lalu id; ≤ 50 (R17)
      const doneOf = t => t.gtd_status === "done" || t.completed_at ? 1 : 0;
      cands.sort((x, y) => doneOf(x) - doneOf(y) || taskTitle(x).localeCompare(taskTitle(y), "id") || (String(x.id) < String(y.id) ? -1 : String(x.id) > String(y.id) ? 1 : 0));
      cands = cands.slice(0, PICK_MAX);
    }
    pickerEl = /*#__PURE__*/React.createElement("div", {
      className: "plg-timeline-picker",
      onKeyDown: e => {
        if (e && e.key === "Escape") {
          if (typeof e.preventDefault === "function") e.preventDefault();
          if (typeof e.stopPropagation === "function") e.stopPropagation();
          closePicker();
        }
      }
    }, /*#__PURE__*/React.createElement("div", {
      className: "plg-timeline-picker-bar"
    }, /*#__PURE__*/React.createElement("input", {
      type: "search",
      className: "plg-timeline-input plg-timeline-picker-q",
      "aria-label": SEC_SEARCH,
      placeholder: SEC_SEARCH + "…",
      value: picker.q,
      autoFocus: true,
      onChange: e => {
        const v = e && e.target ? String(e.target.value) : "";
        setPicker(p => p ? Object.assign({}, p, {
          q: v
        }) : p);
      }
    }), /*#__PURE__*/React.createElement("button", {
      type: "button",
      className: "plg-timeline-btn",
      onClick: closePicker
    }, SEC_CLOSE)), !picker.list ? /*#__PURE__*/React.createElement("div", {
      className: "plg-timeline-sec-muted"
    }, SEC_LOADING) : !cands.length ? /*#__PURE__*/React.createElement("div", {
      className: "plg-timeline-sec-muted"
    }, SEC_NO_MATCH) : /*#__PURE__*/React.createElement("ul", {
      className: "plg-timeline-picks"
    }, cands.map(t => /*#__PURE__*/React.createElement("li", {
      key: String(t.id)
    }, /*#__PURE__*/React.createElement("button", {
      type: "button",
      className: "plg-timeline-pick",
      "data-key": String(t.id),
      onClick: () => addDep(t)
    }, /*#__PURE__*/React.createElement("span", {
      className: "plg-timeline-pick-title"
    }, taskTitle(t)), depSet.has(t) ? /*#__PURE__*/React.createElement("span", {
      className: "plg-timeline-pick-note"
    }, SEC_IS_DEP) : null)))));
  }
  const head = (withToggle, chips) => /*#__PURE__*/React.createElement("div", {
    className: "plg-timeline-sec-head"
  }, /*#__PURE__*/React.createElement("span", {
    className: "plg-timeline-sec-title"
  }, SEC_TITLE), chips || null, withToggle ? /*#__PURE__*/React.createElement("button", {
    type: "button",
    className: cx("plg-timeline-sec-more", expanded && "is-open"),
    "aria-expanded": expanded,
    onClick: () => {
      if (expanded) {
        setForceOpen(false);
        setOpenPref(false);
      } else setOpenPref(true);
    }
  }, expanded ? SEC_LESS : SEC_MORE) : null);

  // Daftar belum dimuat: hanya kepala seksi (ringkasan tidak berkedip menjadi input lalu berganti).
  if (all === null) {
    return /*#__PURE__*/React.createElement("section", {
      className: "plg-timeline-section",
      "aria-label": SEC_TITLE,
      "aria-busy": "true"
    }, head(false));
  }

  // Ringkasan (R10): rentang dari subtask, tanpa input.
  if (summary) {
    const sp = spanTree(c, selfLive, view.kids, readOther, new Set());
    const wd = sp ? calSafe(() => TLCal.workdays(c, sp.s, sp.f)) : null;
    return /*#__PURE__*/React.createElement("section", {
      className: "plg-timeline-section",
      "aria-label": SEC_TITLE,
      onFocus: refreshSoon,
      onPointerEnter: refreshSoon
    }, head(false), /*#__PURE__*/React.createElement("p", {
      className: "plg-timeline-sec-note"
    }, SEC_SUMMARY), /*#__PURE__*/React.createElement("div", {
      className: "plg-timeline-sec-range"
    }, sp ? TLCal.fmtShort(sp.s) + " → " + TLCal.fmtShort(sp.f) + (wd === null ? "" : " · " + wd + " " + SEC_HK) : SEC_SUMMARY_NONE));
  }

  // 1c-1 R20 kontrol Mode (tingkat 1 "Selengkapnya"; tingkat 2 "Selengkapnya" = awal tingkat 3, dilanjutkan Task 12).
  const shiftN = effMode === "manual" && secEngine && secEngine.node ? secAutoReach(secEngine.result, secEngine.node.key).size : 0;
  // part = penanda urutan tingkat 3 (data-part); tingkat 1 tanpa penanda.
  const modeElOf = part => /*#__PURE__*/React.createElement("div", {
    className: "plg-timeline-sec-mode",
    role: "group",
    "aria-label": SEC_MODE,
    "data-part": part
  }, /*#__PURE__*/React.createElement("span", {
    className: "plg-timeline-field-label"
  }, SEC_MODE), /*#__PURE__*/React.createElement("span", {
    className: "plg-timeline-seg"
  }, SEC_MODES.map(([m, label]) => /*#__PURE__*/React.createElement("button", {
    key: m,
    type: "button",
    "data-mode": m,
    className: cx("plg-timeline-seg-btn", effMode === m && "is-active"),
    "aria-pressed": effMode === m,
    onClick: () => pickMode(m)
  }, label, unitMode === m ? /*#__PURE__*/React.createElement("span", {
    className: "plg-timeline-seg-note"
  }, SEC_MODE_UNIT) : null))), shiftN > 0 ? /*#__PURE__*/React.createElement("p", {
    className: "plg-timeline-sec-note plg-timeline-sec-shiftnote"
  }, secShiftText(shiftN)) : null);

  // Kartu pratinjau aliran > CASCADE_MAX (Task 12; R14/R20): tampil di tingkat 1–3, juga saat terlipat ("Perbarui").
  const cardEl = card && card.tid === tid ? PreviewCard({
    model: card.model,
    busy: card.busy,
    onApply: applyCard,
    onCancel: cancelCard
  }) : null;
  const d = cur.d;
  const durVal = "dur" in d ? d.dur : sched.start === null ? "" : String(sched.duration);
  const milestone = sched.start !== null && sched.duration === 0;
  const durInput = /*#__PURE__*/React.createElement("span", {
    className: "plg-timeline-sec-num"
  }, /*#__PURE__*/React.createElement("input", {
    type: "number",
    className: "plg-timeline-input plg-timeline-num",
    "aria-label": SEC_DUR + " (" + SEC_HK + ")",
    min: 1,
    max: TLSched.DUR_MAX,
    step: 1,
    inputMode: "numeric",
    value: durVal,
    disabled: sched.start === null || milestone,
    onChange: e => setDraft("dur", e && e.target ? String(e.target.value) : ""),
    onBlur: e => commitDur(e && e.target ? e.target.value : ""),
    onKeyDown: onEnter(commitDur)
  }), /*#__PURE__*/React.createElement("span", {
    className: "plg-timeline-sec-unit"
  }, SEC_HK));
  const milestoneEl = part => /*#__PURE__*/React.createElement("label", {
    className: cx("plg-timeline-sec-check", sched.start === null && "is-disabled"),
    "data-part": part
  }, /*#__PURE__*/React.createElement("input", {
    type: "checkbox",
    "aria-label": SEC_MILESTONE,
    checked: milestone,
    disabled: sched.start === null,
    onChange: e => setMilestone(!!(e && e.target && e.target.checked))
  }), /*#__PURE__*/React.createElement("span", null, SEC_MILESTONE));
  const pctEl = part => /*#__PURE__*/React.createElement("div", {
    className: "plg-timeline-field",
    "data-part": part
  }, /*#__PURE__*/React.createElement("span", {
    className: "plg-timeline-field-label"
  }, SEC_PCT), /*#__PURE__*/React.createElement("span", {
    className: "plg-timeline-sec-val",
    "data-field": "pct"
  }, pctOf(info) + "%"), /*#__PURE__*/React.createElement("span", {
    className: "plg-timeline-sec-hint"
  }, SEC_PCT_HINT));
  const badEl = deps.bad ? /*#__PURE__*/React.createElement("div", {
    className: "plg-timeline-sec-bad"
  }, /*#__PURE__*/React.createElement("span", null, secBadText(deps.bad)), /*#__PURE__*/React.createElement("button", {
    type: "button",
    className: "plg-timeline-btn",
    onClick: cleanBad
  }, SEC_BAD_BTN)) : null;
  const addEl = part => picker ? /*#__PURE__*/React.createElement("div", {
    className: "plg-timeline-sec-add",
    "data-part": part
  }, pickerEl) : /*#__PURE__*/React.createElement("div", {
    className: "plg-timeline-sec-actions",
    "data-part": part
  }, /*#__PURE__*/React.createElement("button", {
    type: "button",
    className: "plg-timeline-sec-link",
    onClick: openPicker
  }, SEC_ADD_DEP));

  // Tingkat 2 (mode efektif otomatis, simpul terhitung): kartu terlipat dari hasil mesin seksi, tanpa input.
  // "Selengkapnya" → tingkat 3 (R20, urutan tetap): Mode · Mulai (teks + "Ubah") · Durasi · Selesai · Milestone · % selesai
  // · Batasan · Dependensi (Menunggu / Diikuti oleh) · Tambah dependensi · Kenapa dijadwalkan di sini? · Ubah ke Manual.
  const node = autoNode;
  // 1c-2 Task 7 tingkat 3: baris tanggal aktual (nilai fmtShort; selesai turunan diberi penanda "Aktual"; kosong →
  // "Belum dicatat" + "Catat hari ini") — keduanya bisa diubah lewat input tanggal.
  const actRowOf = which => {
    const label = which === "start" ? SEC_ACT_START : SEC_ACT_FINISH;
    const val = act[which];
    const dn = "act:" + which;
    return /*#__PURE__*/React.createElement("div", {
      className: "plg-timeline-field plg-timeline-sec-actual",
      role: "group",
      "aria-label": label,
      "data-part": "actual-" + which
    }, /*#__PURE__*/React.createElement("span", {
      className: "plg-timeline-field-label"
    }, label), /*#__PURE__*/React.createElement("span", {
      className: "plg-timeline-sec-actval"
    }, val !== null ? /*#__PURE__*/React.createElement("span", {
      className: "plg-timeline-sec-val"
    }, TLCal.fmtShort(val)) : /*#__PURE__*/React.createElement("span", {
      className: "plg-timeline-sec-muted"
    }, SEC_ACT_NONE), val !== null && which === "finish" && act.finishDerived ? /*#__PURE__*/React.createElement("span", {
      className: "plg-timeline-act-mark"
    }, MSG_ACTUAL) : null, val === null ? /*#__PURE__*/React.createElement("button", {
      type: "button",
      className: "plg-timeline-btn",
      onClick: () => recordToday(which)
    }, SEC_ACT_TODAY) : null, /*#__PURE__*/React.createElement("input", {
      type: "date",
      className: "plg-timeline-input",
      "aria-label": label,
      value: dn in d ? d[dn] : val === null ? "" : TLCal.iso(val),
      onChange: onActChange(which),
      onBlur: onActBlur(which),
      onKeyDown: onActKey(which)
    })));
  };
  // Tabel "Baseline vs sekarang" (3×3): Mulai/Selesai/Durasi × Baseline/Sekarang/Selisih (ds/df/dd bertanda, hk) dari baris
  // task di baseline aktif; tanpa baseline aktif / task tidak ada di dalamnya → satu baris "Tidak ada".
  const blCells = blRow && node ? [[SEC_START, TLCal.fmtShort(blRow.s), TLCal.fmtShort(node.es), signedHk(blRow.ds)], [SEC_FINISH, TLCal.fmtShort(blRow.f), TLCal.fmtShort(node.ef), signedHk(blRow.df)], [SEC_DUR, blRow.d + " hk", node.d + " hk", signedHk(blRow.dd)]] : null;
  const blElOf = () => /*#__PURE__*/React.createElement("div", {
    className: "plg-timeline-sec-blbox",
    "data-part": "baseline"
  }, /*#__PURE__*/React.createElement("span", {
    className: "plg-timeline-field-label"
  }, SEC_BL_VS), /*#__PURE__*/React.createElement("table", {
    className: "plg-timeline-sec-bltable",
    "aria-label": SEC_BL_VS
  }, /*#__PURE__*/React.createElement("thead", null, /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("th", {
    scope: "col"
  }), /*#__PURE__*/React.createElement("th", {
    scope: "col"
  }, LBL.bl), /*#__PURE__*/React.createElement("th", {
    scope: "col"
  }, SEC_BL_NOW), /*#__PURE__*/React.createElement("th", {
    scope: "col"
  }, SEC_BL_DIFF))), /*#__PURE__*/React.createElement("tbody", null, blCells ? blCells.map(r => /*#__PURE__*/React.createElement("tr", {
    key: r[0]
  }, /*#__PURE__*/React.createElement("th", {
    scope: "row"
  }, r[0]), /*#__PURE__*/React.createElement("td", null, r[1]), /*#__PURE__*/React.createElement("td", null, r[2]), /*#__PURE__*/React.createElement("td", {
    className: "plg-timeline-sec-bldiff"
  }, r[3]))) : /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("td", {
    colSpan: 4,
    className: "plg-timeline-sec-muted"
  }, BL_NONE)))));
  if (node) {
    const drift = secEngine.result.drift.has(node.key);
    let body = null;
    if (expanded) {
      const editing = editStart === tid;
      const cst = sched.constraint;
      // Diikuti oleh: penerus dari daftar LENGKAP scope (bukan hanya simpul mesin), baca saja.
      const succView = [];
      const sk = secScopeKey(selfLive);
      for (const t of view.list) {
        if (!liveTask(t) || isSelf(t) || secScopeKey(t) !== sk || view.idx.get(String(t.id)) !== t) continue;
        const dd = TLSched.readSched(readExtSafe(api, t)).deps.find(x => {
          const h = view.idx.get(x.key);
          return !!h && isSelf(h);
        });
        if (dd) succView.push({
          task: t,
          type: dd.type,
          lag: dd.lag
        });
      }
      const fullOf = t => {
        const w = secEngine.wbs.get(String(t.id));
        return (w ? w + " " : "") + taskTitle(t);
      };
      body = /*#__PURE__*/React.createElement("div", {
        className: "plg-timeline-sec-body"
      }, modeElOf("mode"), /*#__PURE__*/React.createElement("div", {
        className: "plg-timeline-field",
        "data-part": "start"
      }, /*#__PURE__*/React.createElement("span", {
        className: "plg-timeline-field-label"
      }, SEC_START), editing ? /*#__PURE__*/React.createElement("input", {
        type: "date",
        className: "plg-timeline-input",
        "aria-label": SEC_START,
        autoFocus: true,
        value: "start" in d ? d.start : TLCal.iso(node.es),
        onChange: onStartChange,
        onBlur: onStartBlur,
        onKeyDown: onStartKey
      }) : /*#__PURE__*/React.createElement("span", {
        className: "plg-timeline-sec-startval"
      }, /*#__PURE__*/React.createElement("span", {
        className: "plg-timeline-sec-val"
      }, TLCal.fmtShort(node.es)), /*#__PURE__*/React.createElement("button", {
        type: "button",
        className: "plg-timeline-btn",
        "aria-label": SEC_EDIT + " " + SEC_START,
        onClick: () => setEditStart(tid)
      }, SEC_EDIT))), /*#__PURE__*/React.createElement("label", {
        className: "plg-timeline-field",
        "data-part": "dur"
      }, /*#__PURE__*/React.createElement("span", {
        className: "plg-timeline-field-label"
      }, SEC_DUR), durInput), /*#__PURE__*/React.createElement("div", {
        className: "plg-timeline-field",
        "data-part": "finish"
      }, /*#__PURE__*/React.createElement("span", {
        className: "plg-timeline-field-label"
      }, SEC_FINISH), /*#__PURE__*/React.createElement("span", {
        className: "plg-timeline-sec-val",
        "data-field": "finish"
      }, TLCal.fmtLong(node.ef))), milestoneEl("milestone"), pctEl("pct"), /*#__PURE__*/React.createElement("div", {
        className: "plg-timeline-sec-cst",
        role: "group",
        "aria-label": SEC_CST,
        "data-part": "constraint"
      }, /*#__PURE__*/React.createElement("span", {
        className: "plg-timeline-field-label"
      }, SEC_CST), /*#__PURE__*/React.createElement("select", {
        className: "plg-timeline-input",
        "aria-label": SEC_CST_KIND,
        value: cst ? cst.type : "",
        onChange: e => pickCst(e && e.target ? String(e.target.value) : "")
      }, SEC_CSTS.map(([v, l]) => /*#__PURE__*/React.createElement("option", {
        key: v,
        value: v
      }, l))), cst ? /*#__PURE__*/React.createElement("input", {
        type: "date",
        className: "plg-timeline-input",
        "aria-label": SEC_CST_DATE,
        value: "cst" in d ? d.cst : cst.date,
        onChange: onCstChange,
        onBlur: onCstBlur,
        onKeyDown: onCstKey
      }) : null), /*#__PURE__*/React.createElement("div", {
        className: "plg-timeline-sec-deps",
        "data-part": "deps"
      }, /*#__PURE__*/React.createElement("span", {
        className: "plg-timeline-field-label"
      }, SEC_DEPS), depView.length ? /*#__PURE__*/React.createElement("div", {
        className: "plg-timeline-dep-group",
        "data-group": "pred"
      }, /*#__PURE__*/React.createElement("span", {
        className: "plg-timeline-dep-sub"
      }, SEC_WAITS), /*#__PURE__*/React.createElement("ul", {
        className: "plg-timeline-deps"
      }, depView.map(v => {
        const r = v.row;
        const dn = "lag:" + r.i;
        return /*#__PURE__*/React.createElement("li", {
          key: r.i + ":" + r.key,
          className: "plg-timeline-dep",
          "data-key": r.key
        }, /*#__PURE__*/React.createElement("span", {
          className: "plg-timeline-dep-main"
        }, /*#__PURE__*/React.createElement("span", {
          className: "plg-timeline-dep-name",
          title: v.full
        }, v.full), v.outside ? /*#__PURE__*/React.createElement("span", {
          className: "plg-timeline-dep-note"
        }, SEC_OUTSIDE) : null), /*#__PURE__*/React.createElement("select", {
          className: "plg-timeline-input plg-timeline-dep-typesel",
          "aria-label": "Tipe dependensi " + v.name,
          value: r.type,
          onChange: e => changeType(r, e && e.target ? String(e.target.value) : "")
        }, SEC_TYPES.map(([t, l]) => /*#__PURE__*/React.createElement("option", {
          key: t,
          value: t
        }, l))), r.lag !== 0 ? /*#__PURE__*/React.createElement("span", {
          className: "plg-timeline-dep-lag"
        }, signedHk(r.lag)) : null, /*#__PURE__*/React.createElement("span", {
          className: "plg-timeline-sec-num"
        }, /*#__PURE__*/React.createElement("input", {
          type: "number",
          className: "plg-timeline-input plg-timeline-num",
          "aria-label": "Jeda setelah " + v.name + " (" + SEC_HK + ")",
          min: TLSched.LAG_MIN,
          max: TLSched.LAG_MAX,
          step: 1,
          value: dn in d ? d[dn] : String(r.lag),
          onChange: e => setDraft(dn, e && e.target ? String(e.target.value) : ""),
          onBlur: e => commitLag(r, e && e.target ? e.target.value : ""),
          onKeyDown: onEnter(val => commitLag(r, val))
        }), /*#__PURE__*/React.createElement("span", {
          className: "plg-timeline-sec-unit"
        }, SEC_HK)), /*#__PURE__*/React.createElement("button", {
          type: "button",
          className: "plg-timeline-dep-del",
          "aria-label": "Hapus dependensi " + v.name,
          title: "Hapus dependensi",
          onClick: () => removeDep(r)
        }, "\xD7"));
      }))) : null, succView.length ? /*#__PURE__*/React.createElement("div", {
        className: "plg-timeline-dep-group",
        "data-group": "succ"
      }, /*#__PURE__*/React.createElement("span", {
        className: "plg-timeline-dep-sub"
      }, SEC_FOLLOWS), /*#__PURE__*/React.createElement("ul", {
        className: "plg-timeline-deps"
      }, succView.map(x => /*#__PURE__*/React.createElement("li", {
        key: String(x.task.id),
        className: "plg-timeline-dep is-succ",
        "data-key": String(x.task.id)
      }, /*#__PURE__*/React.createElement("span", {
        className: "plg-timeline-dep-main"
      }, /*#__PURE__*/React.createElement("span", {
        className: "plg-timeline-dep-name",
        title: fullOf(x.task)
      }, fullOf(x.task))), /*#__PURE__*/React.createElement("span", {
        className: "plg-timeline-dep-type"
      }, x.type), x.lag !== 0 ? /*#__PURE__*/React.createElement("span", {
        className: "plg-timeline-dep-lag"
      }, signedHk(x.lag)) : null)))) : null, badEl), addEl("add"), actRowOf("start"), actRowOf("finish"), blElOf(), /*#__PURE__*/React.createElement("div", {
        className: "plg-timeline-sec-whybox",
        "data-part": "why"
      }, /*#__PURE__*/React.createElement("button", {
        type: "button",
        className: cx("plg-timeline-sec-more", whyParts && "is-open"),
        "aria-expanded": !!whyParts,
        onClick: () => setWhyOpen(whyOpen === tid ? null : tid)
      }, SEC_WHY), whyParts ? /*#__PURE__*/React.createElement("p", {
        className: "plg-timeline-sec-why"
      }, whyParts.map((x, i) => typeof x === "string" ? x : /*#__PURE__*/React.createElement("strong", {
        key: i
      }, x.b))) : null), /*#__PURE__*/React.createElement("div", {
        className: "plg-timeline-sec-actions",
        "data-part": "manual"
      }, /*#__PURE__*/React.createElement("button", {
        type: "button",
        className: "plg-timeline-btn",
        onClick: () => pickMode("manual")
      }, SEC_TO_MANUAL)));
    }
    return /*#__PURE__*/React.createElement("section", {
      className: "plg-timeline-section",
      "aria-label": SEC_TITLE,
      onFocus: refreshSoon,
      onPointerEnter: refreshSoon
    }, head(true, [/*#__PURE__*/React.createElement("span", {
      key: "auto",
      className: "plg-timeline-chip"
    }, SEC_MODE_AUTO), node.late > 0 ? /*#__PURE__*/React.createElement("span", {
      key: "late",
      className: "plg-timeline-chip is-late"
    }, secLateChip(node.late)) : null]), /*#__PURE__*/React.createElement("div", {
      className: "plg-timeline-sec-range"
    }, TLCal.fmtShort(node.es) + " → " + TLCal.fmtShort(node.ef) + " · " + node.d + " " + SEC_HK + (blRow ? " · baseline " + signedHk(blRow.df) : "")), /*#__PURE__*/React.createElement("div", {
      className: "plg-timeline-sec-links"
    }, secLinksText(secEngine)), node.critical ? /*#__PURE__*/React.createElement("div", {
      className: "plg-timeline-sec-flags"
    }, /*#__PURE__*/React.createElement("span", {
      className: "plg-timeline-chip is-critical"
    }, SEC_CRIT)) : null, drift ? /*#__PURE__*/React.createElement("div", {
      className: "plg-timeline-sec-drift",
      role: "status"
    }, /*#__PURE__*/React.createElement("span", {
      className: "plg-timeline-sec-drift-text"
    }, secDriftText(node.es)), /*#__PURE__*/React.createElement("button", {
      type: "button",
      className: "plg-timeline-btn",
      onClick: updateAuto
    }, SEC_UPDATE)) : null, cardEl, body);
  }

  // Fix T11 (pola R13 "tanpa tulis saat belum siap"): unit belum termuat dan task tidak Manual tersimpan → mode efektif
  // belum pasti, Mulai dikunci (gagal muat tidak mengunci).
  const unitWait = !un.loaded && !un.failed && raw.mode !== "manual";
  const startVal = "start" in d ? d.start : sched.start || "";
  const fields = /*#__PURE__*/React.createElement("div", {
    className: "plg-timeline-sec-row"
  }, /*#__PURE__*/React.createElement("label", {
    className: "plg-timeline-field"
  }, /*#__PURE__*/React.createElement("span", {
    className: "plg-timeline-field-label"
  }, SEC_START), /*#__PURE__*/React.createElement("input", {
    type: "date",
    className: "plg-timeline-input",
    "aria-label": SEC_START,
    value: startVal,
    disabled: unitWait,
    onChange: onStartChange,
    onBlur: onStartBlur,
    onKeyDown: onStartKey
  })), /*#__PURE__*/React.createElement("label", {
    className: "plg-timeline-field"
  }, /*#__PURE__*/React.createElement("span", {
    className: "plg-timeline-field-label"
  }, SEC_DUR), durInput));
  let more = null;
  if (expanded) {
    const warns = [];
    if (late > 0) {
      warns.push(/*#__PURE__*/React.createElement("div", {
        key: "late",
        className: "plg-timeline-sec-warn",
        role: "status"
      }, /*#__PURE__*/React.createElement("span", {
        className: "plg-timeline-sec-warn-icon",
        "aria-hidden": "true"
      }, "\u26A0"), /*#__PURE__*/React.createElement("span", {
        className: "plg-timeline-sec-warn-text"
      }, secLateText(span.f, late))));
    }
    if (violated) {
      warns.push(/*#__PURE__*/React.createElement("div", {
        key: "viol",
        className: "plg-timeline-sec-warn",
        role: "status"
      }, /*#__PURE__*/React.createElement("span", {
        className: "plg-timeline-sec-warn-icon",
        "aria-hidden": "true"
      }, "\u26A0"), /*#__PURE__*/React.createElement("span", {
        className: "plg-timeline-sec-warn-text"
      }, MSG_VIOLATION), /*#__PURE__*/React.createElement("button", {
        type: "button",
        className: "plg-timeline-btn plg-timeline-sec-shift",
        onClick: () => writeSched({
          start: earliest
        })
      }, SEC_SHIFT)));
    }
    more = /*#__PURE__*/React.createElement("div", {
      className: "plg-timeline-sec-body"
    }, modeElOf(), /*#__PURE__*/React.createElement("div", {
      className: "plg-timeline-sec-row"
    }, /*#__PURE__*/React.createElement("div", {
      className: "plg-timeline-field"
    }, /*#__PURE__*/React.createElement("span", {
      className: "plg-timeline-field-label"
    }, SEC_FINISH), /*#__PURE__*/React.createElement("span", {
      className: "plg-timeline-sec-val",
      "data-field": "finish"
    }, span ? TLCal.fmtLong(span.f) : "—")), /*#__PURE__*/React.createElement("div", {
      className: "plg-timeline-field"
    }, /*#__PURE__*/React.createElement("span", {
      className: "plg-timeline-field-label"
    }, SEC_PCT), /*#__PURE__*/React.createElement("span", {
      className: "plg-timeline-sec-val",
      "data-field": "pct"
    }, pctOf(info) + "%"), /*#__PURE__*/React.createElement("span", {
      className: "plg-timeline-sec-hint"
    }, SEC_PCT_HINT))), /*#__PURE__*/React.createElement("label", {
      className: cx("plg-timeline-sec-check", sched.start === null && "is-disabled")
    }, /*#__PURE__*/React.createElement("input", {
      type: "checkbox",
      "aria-label": SEC_MILESTONE,
      checked: milestone,
      disabled: sched.start === null,
      onChange: e => setMilestone(!!(e && e.target && e.target.checked))
    }), /*#__PURE__*/React.createElement("span", null, SEC_MILESTONE)), warns, depView.length || deps.bad ? /*#__PURE__*/React.createElement("div", {
      className: "plg-timeline-sec-deps"
    }, /*#__PURE__*/React.createElement("span", {
      className: "plg-timeline-field-label"
    }, SEC_DEPS), depView.length ? /*#__PURE__*/React.createElement("ul", {
      className: "plg-timeline-deps"
    }, depView.map(v => {
      const r = v.row;
      const dn = "lag:" + r.i;
      return /*#__PURE__*/React.createElement("li", {
        key: r.i + ":" + r.key,
        className: "plg-timeline-dep",
        "data-key": r.key
      }, /*#__PURE__*/React.createElement("span", {
        className: "plg-timeline-dep-main"
      }, /*#__PURE__*/React.createElement("span", {
        className: "plg-timeline-dep-name",
        title: v.name
      }, v.name), v.outside ? /*#__PURE__*/React.createElement("span", {
        className: "plg-timeline-dep-note"
      }, SEC_OUTSIDE) : null), /*#__PURE__*/React.createElement("span", {
        className: "plg-timeline-dep-type"
      }, r.type), /*#__PURE__*/React.createElement("span", {
        className: "plg-timeline-sec-num"
      }, /*#__PURE__*/React.createElement("input", {
        type: "number",
        className: "plg-timeline-input plg-timeline-num",
        "aria-label": "Jeda setelah " + v.name + " (" + SEC_HK + ")",
        min: TLSched.LAG_MIN,
        max: TLSched.LAG_MAX,
        step: 1,
        value: dn in d ? d[dn] : String(r.lag),
        onChange: e => setDraft(dn, e && e.target ? String(e.target.value) : ""),
        onBlur: e => commitLag(r, e && e.target ? e.target.value : ""),
        onKeyDown: onEnter(val => commitLag(r, val))
      }), /*#__PURE__*/React.createElement("span", {
        className: "plg-timeline-sec-unit"
      }, SEC_HK)), /*#__PURE__*/React.createElement("button", {
        type: "button",
        className: "plg-timeline-dep-del",
        "aria-label": "Hapus dependensi " + v.name,
        title: "Hapus dependensi",
        onClick: () => removeDep(r)
      }, "\xD7"));
    })) : null, deps.bad ? /*#__PURE__*/React.createElement("div", {
      className: "plg-timeline-sec-bad"
    }, /*#__PURE__*/React.createElement("span", null, secBadText(deps.bad)), /*#__PURE__*/React.createElement("button", {
      type: "button",
      className: "plg-timeline-btn",
      onClick: cleanBad
    }, SEC_BAD_BTN)) : null) : null);
  }
  return /*#__PURE__*/React.createElement("section", {
    className: "plg-timeline-section",
    "aria-label": SEC_TITLE,
    onFocus: refreshSoon,
    onPointerEnter: refreshSoon
  }, head(true), fields, cardEl, more, picker ? null : /*#__PURE__*/React.createElement("div", {
    className: "plg-timeline-sec-actions"
  }, /*#__PURE__*/React.createElement("button", {
    type: "button",
    className: "plg-timeline-sec-link",
    onClick: openPicker
  }, SEC_ADD_DEP)), pickerEl);
}

// React.memo dibuat malas (React tidak ada saat plugin.js di-require di tes Node). Slot menuntut komponen berupa
// fungsi, jadi pembungkus tipis merender versi memo; context host stabil sehingga memo menahan render ulang Pomodoro.
let MemoView = null;
function memoView() {
  if (!MemoView) MemoView = React.memo ? React.memo(TimelineViewBody) : TimelineViewBody;
  return MemoView;
}
function TimelineView(props) {
  return React.createElement(memoView(), props);
}

// ── 4h. Pencatatan mulai aktual otomatis (1c-2 Task 8; K42 DIAMANDEMEN) ────────────────────────────────────
// Pemicu HANYA dua event host gestur lokal di perangkat ini: `pomodoro.ended` (sesi/overtime tercatat) dan
// `task.completed` (handleDone App). Keduanya dipasang di factory → aktif selama plugin dieksekusi di sesi (lazy-execute,
// README §4); OFF → runtime melepas (offAll). Pemicu "progress naik dari 0" DIBUANG: host tidak memancarkan event progres,
// dan diff data (props/daftar) tidak bisa membedakan ketukan lokal dari sinkron — R25 (tidak ada tulisan dari sinkron)
// menang atas kata-kata K42. Jalur cadangan = tombol "Catat hari ini" (Task 7).
// Tanggal = hari Asia/Jakarta dari endedAt / completedAt (TLSched.jkt) bila sah, selain itu api.env.today(): replay sesi
// basi saat mount (index.html :11459) mencatat hari sesi itu (jujur, idempoten), sesi lintas tengah malam ikut WIB.
const ACT_EVENT = "timeline.actualRecorded"; // seksi terpasang memuat ulang daftar (baca saja)

function eventDay(api, v) {
  const n = TLSched.jkt(v);
  return n === null ? safeToday(api) : TLCal.iso(n);
}
function sameTaskId(t, key) {
  return !!t && (String(t.id) === key || t.cid !== undefined && t.cid !== null && String(t.cid) === key);
}

// SATU-SATUNYA penulis otomatis (pagar R25 `recordActual:taskExt.set`). "Isi bila kosong": ext task dibaca SEGAR lewat
// api.data.tasks.list (bukan cache view/seksi); actual.start sudah ada, atau `actual` tersimpan tapi rusak/asing (mis. klien
// lebih baru) → 0 tulis. Selain itu satu set {actual: {start: day} + finish TERSIMPAN dibawa} (semantik gabung Task 7);
// finish turunan (completed_at) tidak pernah dibekukan, finish tidak pernah ditulis dari sini. start > finish tersimpan →
// sanitizePatch menolak → 0 tulis. Task tak dikenal / berulang → 0 tulis. Resolve true bila menulis; gagal → reject
// (pemanggil mencatat diam-diam — tanpa toast, karena pengguna tidak menekan apa pun).
function recordActual(api, taskId, day) {
  const key = String(taskId);
  return Promise.resolve().then(() => api.data.tasks.list({
    includeDone: true
  })).then(list => {
    const arr = Array.isArray(list) ? list : [];
    const task = arr.find(t => String(t && t.id) === key) || arr.find(t => sameTaskId(t, key));
    if (!task || task.recurrence_type || day === null) return false;
    const raw = readExtSafe(api, task);
    const has = raw.actual !== undefined && raw.actual !== null;
    const act = TLSched.actualOf(task, raw);
    if (act.start !== null) return false;
    const next = {
      start: day
    };
    if (act.finish !== null && !act.finishDerived) next.finish = TLCal.iso(act.finish);else if (has) return false; // actual tersimpan tak terbaca (rusak/asing) = bukan kosong
    const san = TLSched.sanitizePatch({
      actual: next
    });
    if (!san.ok) return false;
    return Promise.resolve(api.taskExt.set(task.id, san.patch)).then(() => {
      try {
        api.events.emit(ACT_EVENT, {
          taskId: task.id
        });
      } catch (e) {
        logWarn(api, "pemberitahuan aktual gagal:", e);
      }
      return true;
    });
  });
}

// Pasang dua pendengar host; kembalikan pelepas. Pemanggilan per task diantrekan (event beruntun task yang sama membaca
// tulisan sebelumnya → 0 tulis kedua). Pendengar tidak pernah melempar ke bus (error dihitung runtime sebagai kegagalan
// plugin): payload rusak diabaikan, kegagalan baca/tulis dicatat api.log.warn tanpa toast.
function installActualTracking(api) {
  const queue = new Map();
  const track = (taskId, when) => {
    if (!(typeof taskId === "number" && Number.isFinite(taskId) || typeof taskId === "string" && taskId !== "")) return;
    const key = String(taskId);
    const day = eventDay(api, when);
    const prev = queue.get(key) || Promise.resolve();
    const run = prev.then(() => recordActual(api, taskId, day)).then(null, e => logWarn(api, "mulai aktual gagal dicatat:", e));
    queue.set(key, run);
    run.then(() => {
      if (queue.get(key) === run) queue.delete(key);
    });
  };
  const handler = field => p => {
    try {
      if (p && typeof p === "object") track(p.taskId, p[field]);
    } catch (e) {
      logWarn(api, "pendengar aktual gagal:", e);
    }
  };
  const offs = [];
  try {
    offs.push(api.events.on("pomodoro.ended", handler("endedAt")));
    offs.push(api.events.on("task.completed", handler("completedAt")));
  } catch (e) {
    logWarn(api, "pendengar aktual gagal dipasang:", e);
  }
  return () => {
    for (const off of offs) if (typeof off === "function") off();
    offs.length = 0;
  };
}

// ── 5. Ekspor Node + registrasi ─────────────────────────────────────────────
const pure = {
  calendarStore,
  calTarget,
  projectStore,
  recordEvent,
  PRJ_ENTITY,
  NO_UNIT,
  useUnits,
  useEngine,
  installActualTracking,
  recordActual,
  ACT_EVENT,
  baselineStore,
  useBaselines,
  blRecId,
  BL_ENTITY,
  BL_NO_SNAP,
  MSG_BL_TOO_LARGE,
  MSG_BL_WAIT,
  RELOAD_TIMING,
  engineKeyOf,
  prefKey,
  cleanPref,
  PREF_DEFAULTS,
  PREF_CHOICES,
  resRecId,
  resourceStore,
  useResources,
  RES_ENTITY,
  MSG_RES_STALE,
  MSG_RES_WAIT,
  MSG_RES_TOO_LARGE,
  // 1d-1 Task 2
  ResourceEditor,
  resFormCheck,
  resCaption,
  MSG_RES_SAVE_FAIL,
  MSG_RES_CAP_BAD,
  MSG_RES_DATE_BAD,
  // 1d-1 Task 7
  usePref,
  peopleOf,
  useLoad,
  // 1d-1 Task 3
  LoadPanel,
  loadHeadText,
  loadTipText,
  LOAD_HIT_MAX,
  loadScaleOf,
  // 1d-1 Task 5 (+ review T4–T6 I4)
  SuggestPopover,
  // 1d-1 Task 6
  LoadList,
  loadDayItems,
  LOAD_M_MAX,
  LOAD_M_PEOPLE_MAX,
  // 1d-1 Task 8 (+ review T7–T8: batas chip orang)
  CAL_ENTITY,
  CAL_MAX_BYTES,
  MSG_CAL_TOO_LARGE,
  MSG_CAL_LOST,
  SEC_TIMING,
  MSG_EMPTY,
  MSG_VIOLATION,
  MSG_SCHEDULE_HINT,
  LEGEND,
  ZOOMS,
  COLS_FULL,
  COLS_COMPACT,
  engine,
  LOST_TIMING,
  rowCells,
  slackText,
  engineOverlay,
  NO_OVERLAY,
  baselineOverlay,
  actualOverlay,
  baselineTip,
  MSG_ACTUAL,
  pomoText,
  missingYearsNote,
  barGeom,
  createInteractions,
  checkLink,
  isSummaryIn,
  MSG_CHANGED,
  MSG_UNDO,
  MSG_SAVE_FAIL,
  MSG_CYCLE,
  MSG_MAX_DEPS,
  MSG_SUMMARY_DEP,
  MSG_DUP_DEP,
  MSG_SUMMARY_SCHED,
  TimelineViewBody,
  ScheduleSection,
  ScheduleBody,
  CalendarPopover,
  ListFallback,
  BaselinePicker,
  SaveBaselineDialog,
  activeBaseline,
  blNameOf,
  unitIdsOf,
  taskUnits,
  blNameFor,
  // 1d-2 Task 4 (R2)
  peopleNames,
  exportTitle,
  exportDoneText,
  MSG_EXPORT_FAIL,
  MSG_EXPORT_NATIVE,
  EXPORT_MIME,
  EXPORT_TITLE,
  // 1d-2 Task 5
  MoreMenu,
  menuAlign,
  UnitPopover,
  PreviewDialog,
  PreviewCard,
  whyText,
  dialogModel,
  toolbarSummary,
  pageUnits,
  unitCaption,
  signedHk,
  scopeFilter,
  flowItems
};
if (typeof module !== "undefined" && module.exports) module.exports = Object.assign({}, {
  TLHolidays,
  TLCal,
  TLSched,
  TLCpm,
  TLPlan,
  TLLoad,
  TLLayout,
  TLMspdi,
  TLDrag
}, pure);
const host = typeof window !== "undefined" ? window : null;
if (host && host.TF && host.TF.plugins) {
  host.TF.plugins.register(manifest, function factory(api) {
    installActualTracking(api); // dilepas runtime saat OFF (events.offAll); factory dipanggil ulang saat ON lagi
    return {
      slots: {
        "taskList.views": [{
          id: "gantt",
          component: TimelineView
        }],
        "taskDetail.sections": [{
          id: "schedule",
          order: 10,
          component: ScheduleSection
        }]
      }
    };
  });
}
})();
