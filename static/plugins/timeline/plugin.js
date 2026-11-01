// generated from plugin.jsx — jangan edit
(function () {
"use strict";
const manifest = Object.freeze({"id":"timeline","name":"Timeline","description":"Gantt untuk project dan workspace: jadwal hari kerja, dependensi, milestone.","version":"1.0.0","minApi":1,"slots":["taskList.views","taskDetail.sections"],"permissions":["storage","task.ext","records"],"defaultEnabled":false,"contributes":{"taskList.views":[{"id":"gantt","label":"Timeline","icon":{"path":"M2 4h7M5 8h8M3 12h5"},"pages":["project","workspace"]}],"taskDetail.sections":[{"id":"schedule","label":"Jadwal","order":10}]},"taskExt":{"keys":["start","duration","deps"]},"records":{"calendar":{"conflict":"lww","maxBytes":16384}},"builtin":true});
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
// Plugin Timeline — TLSched: baca/validasi ext jadwal task, dependensi FS, siklus, pelanggaran, tenggat
// (spec §8.2/§8.7, rencana R2, R3, R7, R8, R15, R16). Murni: tanpa Date lokal, tanpa global, tanpa akses api.
// Semua nilai yang diteruskan ke TLCal dijamin integer / bilangan hari sah (TLCal tidak menjaga NaN).
// Fungsi yang memanggil TLCal.finish/addWork/nextWork/fsEarliest menangkap Error("TL_CAL_LOOP") dan menurun
// (hasil "tidak terhitung": tanpa selesai → tanpa pelanggaran/keterlambatan), tidak melempar.
const TLSched = (function (CAL) {
  const MAX_DEPS = 20;
  const DUR_MAX = 999;
  const LAG_MIN = -99;
  const LAG_MAX = 999;
  const MAX_LATE_SPAN = 3660; // hari kalender maks yang dihitung deadlineLate

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
    if (raw.type !== "FS") return null;
    const lag = raw.lag === undefined ? 0 : raw.lag;
    if (!isInt(lag) || lag < LAG_MIN || lag > LAG_MAX) return null;
    return { key, ref: { $task: raw.t.$task }, type: "FS", lag };
  }

  // Masukan = hasil api.taskExt.read (kunci tanpa prefiks: start, duration, deps).
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
    return { start, duration, deps, invalidDeps };
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
      if (raw.type !== undefined && raw.type !== "FS") return { ok: false, reason: "dep" };
      let lag = raw.lag === undefined ? 0 : raw.lag;
      if (typeof lag !== "number" || !Number.isFinite(lag)) return { ok: false, reason: "dep" };
      lag = clampInt(lag, LAG_MIN, LAG_MAX);
      seen.add(key);
      out.push({ t: { $task: t.$task }, type: "FS", lag });
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
        out.push({ from, to, lag: d.lag, ok: found });
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

  // Set kunci penerus yang mulai sebelum fsEarliest(selesai pendahulu, lag); .detail = [{succ, pred, earliest}].
  // Dependensi tidak memindahkan task (Manual). Tanpa jadwal / tak terpecahkan / kalender buntu → diabaikan.
  function violations(c, spans, edges) {
    const out = new Set();
    const detail = [];
    for (const e of Array.isArray(edges) ? edges : []) {
      if (!e || e.ok === false) continue;
      const p = spanAt(spans, e.from);
      const s = spanAt(spans, e.to);
      if (!p || !s) continue;
      const earliest = safe(() => CAL.fsEarliest(c, p.f, lagOf(e.lag)));
      if (!Number.isInteger(earliest)) continue;
      // mulai efektif = hari kerja pertama ≥ mulai tersimpan (mulai di akhir pekan/libur tidak dihitung terlalu awal)
      const eff = safe(() => CAL.nextWork(c, s.s));
      if (!Number.isInteger(eff)) continue;
      if (eff < earliest) {
        out.add(e.to);
        detail.push({ succ: e.to, pred: e.from, earliest });
      }
    }
    out.detail = detail;
    return out;
  }

  // "Geser ke setelah dependensi": maks fsEarliest atas pendahulu terjadwal, sebagai iso; tak ada → null.
  // preds: [{span: {s, f} | null, lag}] (atau {f, lag}). `succ` dicadangkan (belum dipakai di Manual).
  function shiftAfterDeps(c, succ, preds) {
    let best = null;
    for (const p of Array.isArray(preds) ? preds : []) {
      if (!p || typeof p !== "object") continue;
      const f = p.span && Number.isInteger(p.span.f) ? p.span.f : p.f;
      if (!Number.isInteger(f)) continue;
      const e = safe(() => CAL.fsEarliest(c, f, lagOf(p.lag)));
      if (!Number.isInteger(e)) continue;
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
    shiftAfterDeps,
    deadlineLate,
  });
})(typeof TLCal !== "undefined" ? TLCal : require("./calendar.js"));
if (typeof module !== "undefined" && module.exports) module.exports = TLSched;
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
  const ARROW_OUT = 6; // px keluar ke kanan dari ujung pendahulu
  const ARROW_IN = 6; // px lari horizontal terakhir menuju awal penerus
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

  // Rect = {x, y, w, h}. Keluar 6 px ke kanan dari ujung pendahulu, ortogonal (hanya H/V), masuk ke awal penerus.
  // Penerus ≥ 12 px di kanan ujung pendahulu: M H V H. Selain itu (penerus di kiri/menempel): memutar lewat celah antarbaris
  // (M H V H V H), lari masuk terakhir 6 px ke kanan.
  function arrowPath(fromRect, toRect) {
    const x1 = fromRect.x + fromRect.w;
    const y1 = fromRect.y + fromRect.h / 2;
    const x2 = toRect.x;
    const y2 = toRect.y + toRect.h / 2;
    const xo = x1 + ARROW_OUT;
    if (x2 >= x1 + ARROW_OUT + ARROW_IN) return "M" + fmt(x1) + " " + fmt(y1) + "H" + fmt(xo) + "V" + fmt(y2) + "H" + fmt(x2);
    let yt;
    if (y2 > y1) yt = (fromRect.y + fromRect.h + toRect.y) / 2;
    else if (y2 < y1) yt = (toRect.y + toRect.h + fromRect.y) / 2;
    else yt = fromRect.y + fromRect.h + 2; // baris sama: lewat tepat di bawah bar
    const xi = x2 - ARROW_IN;
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
    const spans = new Map();
    for (const it of all) if (it.span) spans.set(it.key, it.span);
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
    ariaBar,
    initialScrollLeft,
  });
})(
  typeof TLCal !== "undefined" ? TLCal : require("./calendar.js"),
  typeof TLSched !== "undefined" ? TLSched : require("./schedule.js"),
  typeof TLHolidays !== "undefined" ? TLHolidays : require("./holidays-id.js"),
);
if (typeof module !== "undefined" && module.exports) module.exports = TLLayout;
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
      const target = delta === 0 ? s0 : CAL.nextWork(c, s0 + delta); // jepret per hari; hari libur → hari kerja berikutnya
      const fin = CAL.finish(c, target, dur0); // durasi hari kerja tetap
      const shown = CAL.nextWork(c, target);
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

  // ---- keyboard (R23): Alt+←/→ geser 1 hari kerja, Alt+Shift+←/→ durasi ±1 ----
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
      const ns = safe(() => CAL.addWork(c, CAL.nextWork(c, s), dir));
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
// Plugin Timeline (Fase 1, PR 1b; spec docs/superpowers/specs/2026-10-31-plugin-fase1-timeline-design.md §8).
// Gantt Manual untuk project dan workspace: view `gantt` (slot taskList.views) dan seksi `schedule` (slot
// taskDetail.sections). Mesin murni ada di `parts` (holidays-id.js, calendar.js, schedule.js, layout.js, drag.js —
// compile.js menggabungkannya SEBELUM kode ini, jadi TLHolidays/TLCal/TLSched/TLLayout/TLDrag tersedia sebagai
// const di lingkup yang sama; tidak ada global window). `manifest` disuntik compile.js dari manifest.json.
//
// Susunan modul (Task 6 = kerangka; komponen diisi Task 7–10):
//   1. Konstanta + pesan UI persis (kalender, preferensi).
//   2. calendarStore(api)  — SATU-SATUNYA kode yang menyentuh api.records (R5). calTarget (= TLSched.calTarget) memilih id/scope.
//   3. Preferensi per perangkat lewat api.storage: prefKey / cleanPref / PREF_DEFAULTS (R19).
//   4. Komponen: konstanta tampilan, pembantu murni, hooks (useMedia/usePref/useCalendar), fungsi render
//      (toolbar/head/tabel/grafik/panah/legenda), TimelineViewBody (Task 7; interaksi Task 8 lewat `ix`; popover
//      kalender + Daftar HP Task 9), ScheduleSection (Task 10); pembungkus React.memo malas (R24).
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

// Adaptor tunggal api.records untuk entitas `calendar`. Tidak ada record → DEFAULT_CAL (pending false).
// Data dari anggota lain selalu lewat TLCal.normalize. save menolak > 16384 byte di klien sebelum put.
function calendarStore(api) {
  return {
    load(calId) {
      return Promise.resolve().then(() => api.records.get(CAL_ENTITY, calId)).then(r => {
        if (!r) return {
          data: TLCal.normalize(TLCal.DEFAULT_CAL),
          pending: false
        };
        return {
          data: TLCal.normalize(r.data),
          pending: !!r.pending
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
          pending: !!(r && r.pending)
        }), e => {
          throw e && e.code === "TOO_LARGE" ? calTooLarge() : e;
        });
      });
    },
    // fn({ids, source: "local"|"sync", lost: string[]}) hanya untuk entitas calendar; mengembalikan off().
    subscribe(fn) {
      return api.records.onChange(ev => {
        if (!ev || ev.entity !== CAL_ENTITY) return;
        fn({
          ids: Array.isArray(ev.ids) ? ev.ids.slice() : [],
          source: ev.source,
          lost: Array.isArray(ev.lost) ? ev.lost.slice() : []
        });
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
  section: false
});
const PREF_CHOICES = Object.freeze({
  zoom: ["day", "week", "month"],
  sort: ["wbs", "start"],
  mode: ["gantt", "list"]
});

// "zoom:<page>", "sort:<page>", "cols:<page>", "mode:<page>"; seksi Jadwal global: "section:open".
function prefKey(kind, page) {
  return kind === "section" ? "section:open" : kind + ":" + page;
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
  mode: "Tampilan"
};
const MSG_EMPTY = "Belum ada task di halaman ini";
// Kalender kerja (R18) dan Daftar HP (R20): teks persis.
const MSG_CAL_NOTE = "Dipakai semua anggota workspace";
const MSG_PENDING = "Menunggu sinkron";
const MSG_CAL_SAVE_FAIL = "Kalender gagal disimpan";
const MSG_CAL_LOAD_FAIL = "Kalender gagal dimuat";
const MSG_DATE_NEED = "Pilih tanggal dulu";
const MSG_DATE_DUP = "Tanggal ini sudah ada";
const MSG_LIST_FULL = "Daftar sudah penuh (366 tanggal)";
const MSG_NO_NAME = "(tanpa nama)";
const MSG_UNSCHEDULED = "Belum dijadwalkan";
const MSG_LATE = "Lewat tenggat";
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
}];
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
const engine = {
  layout: args => TLLayout.layout(args)
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

// Isi sel tabel satu baris: {wbs, name, start, dur, pomo, pct}.
function rowCells(row, groupName) {
  if (row.kind === "group") return {
    wbs: row.wbs,
    name: groupName || "",
    start: "",
    dur: "",
    pomo: "",
    pct: ""
  };
  const t = row.task;
  const title = t.title !== undefined && t.title !== null && String(t.title).trim() ? String(t.title).trim() : "Tanpa judul";
  return {
    wbs: row.wbs,
    name: title,
    start: row.span ? TLCal.fmtShort(row.span.s) : "—",
    dur: row.duration === null || row.duration === undefined ? "—" : row.duration + " hk",
    pomo: pomoText(t),
    pct: Math.round(row.progress) + "%"
  };
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

// Kalender aktif halaman (R4/R5): muat lewat calendarStore, muat ulang saat sinkron/perubahan id ini;
// edit lokal yang kalah LWW → toast persis (spec §8.9). `quiet` (seksi Jadwal): tanpa toast — view yang memberi tahu,
// agar view + panel Live Edit yang tampil bersamaan tidak menampilkan toast ganda.
function useCalendar(api, target, quiet) {
  const store = React.useMemo(() => calendarStore(api), [api]);
  const [st, setSt] = React.useState(() => ({
    id: target.id,
    data: DEFAULT_CAL_DATA,
    pending: false
  }));
  React.useEffect(() => {
    let alive = true;
    const id = target.id;
    const load = () => store.load(id).then(r => {
      if (alive) setSt({
        id,
        data: r.data,
        pending: r.pending
      });
    }, e => logWarn(api, "kalender gagal dimuat:", e));
    load();
    let off = null;
    try {
      off = store.subscribe(ev => {
        const lost = ev.lost.indexOf(id) >= 0;
        if (lost && !quiet) {
          try {
            api.ui.toast(MSG_CAL_LOST, "error");
          } catch (e) {
            logWarn(api, "toast gagal:", e);
          }
        }
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
    store
  };
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
  return /*#__PURE__*/React.createElement("div", {
    className: "plg-timeline-toolbar"
  }, gantt ? seg(ZOOMS, v.zoom, v.pickZoom, LBL.zoom) : null, gantt ? /*#__PURE__*/React.createElement("button", {
    type: "button",
    className: "plg-timeline-btn",
    onClick: v.goToday
  }, LBL.today) : null, /*#__PURE__*/React.createElement("button", {
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
  }, LBL.cols) : null, v.narrow ? seg([["gantt", LBL.gantt], ["list", LBL.list]], v.mode, v.setMode, LBL.mode) : null);
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
    isSel
  } = v;
  const out = [];
  for (let i = rw.first; i <= rw.last; i++) {
    const r = lay.rows[i];
    const c = rowCells(r, groupNames.get(r.group));
    const sel = !!r.task && isSel(r.task);
    out.push(/*#__PURE__*/React.createElement("div", {
      key: r.key,
      role: "row",
      "aria-rowindex": r.index + 2,
      "aria-selected": r.task ? sel : undefined,
      "data-key": r.key,
      tabIndex: r.task ? -1 : undefined,
      className: cx("plg-timeline-row", r.kind === "group" && "is-group", r.kind === "summary" && "is-summary", sel && "is-selected"),
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
        }, c.name), r.violation ? /*#__PURE__*/React.createElement("span", {
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
      className: cx("plg-timeline-milestone", r.done && "is-done", r.late > 0 && "is-late", sel && "is-selected"),
      style: {
        transform: translate(g.x, g.top),
        width: g.w,
        height: g.h
      }
    }), label, dot);
  }
  if (r.kind === "summary") {
    return /*#__PURE__*/React.createElement("div", _extends({}, common, {
      className: cx("plg-timeline-summary", r.late > 0 && "is-late", sel && "is-selected"),
      style: {
        transform: translate(g.x, g.top),
        width: g.w,
        height: g.h
      }
    }), label);
  }
  const pct = r.done ? 100 : Math.round(r.progress);
  return /*#__PURE__*/React.createElement("div", _extends({}, common, {
    className: cx("plg-timeline-bar", r.done && "is-done", r.late > 0 && "is-late", sel && "is-selected"),
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
    rowH
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
    paths.push(/*#__PURE__*/React.createElement("path", {
      key: e.from + ">" + e.to,
      className: cx("plg-timeline-arrow", e.violation && "is-violation"),
      d: TLLayout.arrowPath(a, b),
      markerEnd: e.violation ? "url(#plg-timeline-ah-v)" : "url(#plg-timeline-ah)"
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
function renderLegend(lay, ref) {
  return /*#__PURE__*/React.createElement("div", {
    className: "plg-timeline-foot",
    ref: ref
  }, /*#__PURE__*/React.createElement("div", {
    className: "plg-timeline-legend"
  }, LEGEND.map(([id, text]) => /*#__PURE__*/React.createElement("span", {
    key: id,
    className: "plg-timeline-legend-item"
  }, /*#__PURE__*/React.createElement("span", {
    className: cx("plg-timeline-swatch", "is-" + id),
    "aria-hidden": "true"
  }), text))), lay.missingYears.length ? /*#__PURE__*/React.createElement("div", {
    className: "plg-timeline-note"
  }, missingYearsNote(lay.missingYears)) : null);
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
    pending: false
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
      pending: r.pending
    });
  };
  React.useEffect(() => {
    alive.current = true;
    const load = () => store.load(calId).then(r => {
      if (alive.current && inflight.current === 0) show(r);
    }, () => {
      if (alive.current) setErr(MSG_CAL_LOAD_FAIL);
    });
    load();
    let off = null;
    try {
      // Hanya perubahan dari perangkat lain (sinkron) / kalah LWW; peristiwa lokal berasal dari simpanan kita sendiri.
      off = store.subscribe(ev => {
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
    if (!cur) return false;
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
    if (!cur) return;
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
  const loading = cal === null;
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
  }, MSG_CAL_NOTE) : null, /*#__PURE__*/React.createElement("div", {
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

  // Satu tulis (set, atau setMany untuk Urungkan). Penolakan diteruskan ke pemanggil.
  function issue(task, rr, patch, many) {
    const k = keyOf(task);
    const api = X.cur.api;
    X.busy.add(k);
    X.after.set(k, {
      stale: rr.pj,
      eff: Object.assign({}, rr.eff, patch)
    });
    let p;
    try {
      p = many ? api.taskExt.setMany([{
        taskId: task.id,
        patch
      }]) : api.taskExt.set(task.id, patch);
    } catch (e) {
      p = Promise.reject(e);
    }
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

  // set → toast "Jadwal diubah" + Urungkan (setMany nilai lama persis). Resolve true/false (tidak pernah reject).
  function write(task, rr, patch, prev) {
    const api = X.cur.api;
    return issue(task, rr, patch, false).then(() => {
      toastSafe(api, MSG_CHANGED, "success", {
        label: MSG_UNDO,
        onClick: () => undo(task, prev)
      });
      return true;
    }, err => {
      failed(api, err);
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
    write(g.row.task, g.rr, res.patch, res.prev).then(ok => {
      if (!ok) restore(g);
    });
  }

  // Dependensi baru (R15): kunci baris → task lewat indeks halaman; ringkasan/di luar rentang ditolak; canLink untuk
  // diri sendiri/sudah ada/maks/siklus. Dependensi lama ditulis ulang apa adanya (termasuk item yang tidak dikenali
  // versi ini), item baru lewat sanitizePatch dengan ref api.taskExt.ref(pred).
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
    if (succRow.outOfRange || X.busy.has(keyOf(succ))) return;
    const rr = rawOf(succ);
    const old = Array.isArray(rr.eff.deps) ? rr.eff.deps : [];
    const chk = TLSched.canLink({
      pred,
      succ,
      scopeTasks: scope,
      edges: lay.edges,
      depCount: old.length
    });
    if (!chk.ok) {
      if (LINK_MSG[chk.reason]) toastSafe(api, LINK_MSG[chk.reason], "error");
      return;
    }
    // dependensi tersimpan jenis apa pun (mis. SS dari versi mendatang) ke pendahulu yang sama = ganda
    if (old.some(d => {
      const k = d && typeof d === "object" ? TLSched.refKey(d.t) : null;
      return k !== null && idx.get(k) === pred;
    })) {
      toastSafe(api, MSG_DUP_DEP, "error");
      return;
    }
    let ref;
    try {
      ref = api.taskExt.ref(pred);
    } catch (e) {
      logWarn(api, "ref dependensi gagal:", e);
      return;
    }
    const san = TLSched.sanitizePatch({
      deps: [{
        t: ref,
        type: "FS",
        lag: 0
      }]
    });
    if (!san.ok) return;
    const prev = {
      deps: rr.eff.deps === undefined ? null : rr.eff.deps
    };
    write(succ, rr, {
      deps: old.concat(san.patch.deps)
    }, prev);
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
    if (r) write(s.row.task, rr, r.patch, r.prev);
  }

  // ---- keyboard (R23): Enter buka; Alt+←/→ geser 1 hk; Alt+Shift+←/→ durasi ±1; satu set per tekan ----
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
    write(row.task, rr, r.patch, r.prev).then(() => raf(() => refocus(row.key, from)));
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
  const [calOpen, setCalOpen] = React.useState(false);
  const calBtnRef = React.useRef(null);
  const pageKind = context.pageKind === "workspace" ? "workspace" : "project";
  const target = React.useMemo(() => calTarget(pageKind === "workspace" ? context.listId : null), [pageKind, context.listId]);
  const cal = useCalendar(api, target);
  const today = safeToday(api);
  const todayDn = today ? TLCal.dn(today) : null;
  const calKey = React.useMemo(() => JSON.stringify(cal.data), [cal.data]);

  // R24: tata letak hanya bila task scope / kalender / zoom / urut / hari berubah (bukan tiap context baru).
  const lay = React.useMemo(() => engine.layout({
    tasks: Array.isArray(context.scopeTasks) ? context.scopeTasks : [],
    pageKind,
    sort,
    cal: cal.data,
    today,
    zoom,
    readSchedOf: t => {
      try {
        return TLSched.readSched(api.taskExt.read(t));
      } catch (e) {
        return TLSched.readSched({});
      }
    }
  }), [context.scopeTasks, calKey, zoom, sort, today, pageKind, api]);
  const groupNames = React.useMemo(() => new Map(lay.groups.map(g => [g.key, g.name])), [lay]);
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
  const sl = vp.left === null ? TLLayout.initialScrollLeft(lay.range, lay.px, today, vp.w) : vp.left;
  const rw = TLLayout.windowRows(lay.rows.length, vp.top, vp.h + ROW_STEP * rowH, rowH);
  const dw = TLLayout.windowDays(lay.range, lay.px, sl, vp.w);
  const chartW = TLLayout.widthOf(lay.range, lay.px);
  const rowsH = lay.rows.length * rowH;
  const bodyH = Math.max(rowsH, vp.h); // latar (akhir pekan, libur, hari ini) mengisi wadah walau baris sedikit

  const applyLeft = (el, x) => {
    el.scrollLeft = Math.max(0, Math.round(x));
    setLeftRef.current = el.scrollLeft;
    const left = el.scrollLeft;
    setVp(p => p.left === quantLeft(left, p.w) ? p : Object.assign({}, p, {
      left: quantLeft(left, p.w)
    }));
  };

  // Ukur tinggi wadah (R11: max(360, innerHeight − rect.top − 16), dikurangi tinggi legenda di bawahnya agar legenda
  // tetap terlihat) dan lebar grafik tampak. Selalu membaca elemen terkini (bukan yang ditangkap saat efek dipasang).
  const measure = () => {
    const el = scrollRef.current;
    if (!el || !hasWindow()) return;
    const rect = el.getBoundingClientRect();
    const footH = footRef.current ? footRef.current.offsetHeight || 0 : 0;
    const boxH = Math.max(MIN_BOX_H, Math.floor((window.innerHeight || 0) - rect.top - BOX_GAP - footH));
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
  }, [tableW, hasRows, listMode]);

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
    scrollEl: () => scrollRef.current
  };
  React.useEffect(() => () => ctl.dispose(), [ctl]);
  const ix = ctl.ix;
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
    calOpen,
    toggleCal: () => setCalOpen(!calOpen),
    calBtnRef
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
    onClose: closeCal
  }) : null;
  const top = /*#__PURE__*/React.createElement("div", {
    className: "plg-timeline-top"
  }, toolbar, popover);
  if (!hasRows) {
    return /*#__PURE__*/React.createElement("div", {
      className: "plg-timeline"
    }, top, /*#__PURE__*/React.createElement("div", {
      className: "plg-timeline-empty"
    }, MSG_EMPTY));
  }
  if (listMode) {
    return /*#__PURE__*/React.createElement("div", {
      className: "plg-timeline"
    }, top, ListFallback({
      rows: lay.rows,
      cal: lay.cal,
      onTaskClick: context.onTaskClick
    }));
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
    isSel
  };
  return /*#__PURE__*/React.createElement("div", {
    className: cx("plg-timeline", compact && "is-compact")
  }, top, /*#__PURE__*/React.createElement("div", {
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
  }, renderTableRows(v)), renderChart(v))), renderLegend(lay, footRef));
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

// Dependensi tampil dari deps mentah: [{i: indeks mentah, key, lag}] (sah, unik, ≤ 20); bad = sisanya (rusak, tipe
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
      lag: d.lag
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

  // R17 state lokal optimistis: di-seed ulang saat task.id berganti, atau saat ext sumber terbaru (props atau daftar)
  // berubah selama tidak ada tulis berjalan dan tidak ada draf input. Sumber yang sudah menyusul (sama dengan lokal)
  // hanya memperbarui kunci.
  const inflight = React.useRef(0);
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
  const cal = useCalendar(api, target, true);
  const c = React.useMemo(() => TLCal.compile(cal.data), [cal.data]);
  React.useEffect(() => {
    loadRef.current.alive = true;
    loadAll();
    return undefined;
  }, [api, tid, propKey]);
  React.useEffect(() => {
    let off = null;
    try {
      off = api.events.on("sync.done", () => {
        loadAll();
      });
    } catch (e) {
      logWarn(api, "pendengar sync.done gagal:", e);
    }
    return () => {
      loadRef.current.alive = false;
      if (typeof off === "function") off();
    };
  }, [api]);
  const refreshSoon = () => {
    if (nowMs() - loadRef.current.at > SEC_REFRESH_MS) loadAll();
  };
  const selfLive = listedSelf || task;
  const readOther = t => TLSched.readSched(t === selfLive ? raw : readExtSafe(api, t));

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
  };
  const writeSched = (p, draftName) => {
    const san = TLSched.sanitizePatch(p);
    if (!san.ok) {
      if (draftName) clearDraft(draftName);
      return;
    }
    write(san.patch, draftName);
  };

  // Jepret ke hari kerja seperti seret/klik-jadwalkan (R13, R21): durasi ≥ 1 → nextWork; milestone boleh di hari libur (R6).
  const snapStart = (v, dur) => {
    if (dur === 0) return v;
    const n = calSafe(() => TLCal.nextWork(c, TLCal.dn(v)));
    return n === null ? v : TLCal.iso(n);
  };
  const commitStart = v => {
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
    write({
      deps: rawDeps.map((it, j) => j === row.i ? Object.assign({}, it, {
        lag: n
      }) : it)
    }, name);
  };
  const removeDep = row => {
    const next = rawDeps.filter((_, j) => j !== row.i);
    write({
      deps: next.length ? next : null
    }, "lag:" + row.i);
  };
  const cleanBad = () => {
    const keep = deps.rows.map(r => rawDeps[r.i]);
    write({
      deps: keep.length ? keep : null
    });
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
  const addDep = pred => {
    const {
      list,
      idx
    } = pickIndex;
    const self = idx.get(String(tid)) || task;
    const sk = secScopeKey(self);
    const scope = list.filter(t => liveTask(t) && secScopeKey(t) === sk);
    if (scope.indexOf(self) < 0) scope.push(self);
    const sidx = TLSched.buildIndex(scope);
    const rd = t => TLSched.readSched(t === self ? raw : readExtSafe(api, t));
    const edges = TLSched.resolveDeps(scope.map(t => ({
      task: t,
      sched: rd(t)
    })), sidx);
    const chk = TLSched.canLink({
      pred,
      succ: self,
      scopeTasks: scope,
      edges,
      depCount: rawDeps.length
    });
    if (!chk.ok) {
      if (LINK_MSG[chk.reason]) toastSafe(api, LINK_MSG[chk.reason], "error");
      return;
    }
    // dependensi tersimpan jenis apa pun ke pendahulu yang sama (cid/server_id lewat indeks) = ganda
    if (rawDeps.some(d => {
      const k = d && typeof d === "object" ? TLSched.refKey(d.t) : null;
      return k !== null && (k === String(pred.id) || idx.get(k) === pred);
    })) {
      toastSafe(api, MSG_DUP_DEP, "error");
      return;
    }
    let ref;
    try {
      ref = api.taskExt.ref(pred);
    } catch (e) {
      logWarn(api, "ref dependensi gagal:", e);
      return;
    }
    const san = TLSched.sanitizePatch({
      deps: [{
        t: ref,
        type: "FS",
        lag: 0
      }]
    });
    if (!san.ok) return;
    write({
      deps: rawDeps.concat(san.patch.deps)
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
    return {
      row: r,
      name: p ? taskTitle(p) : all ? SEC_DELETED : SEC_LOADING,
      outside: !!p && secScopeKey(p) !== secScopeKey(selfLive)
    };
  });
  const earliest = span && preds.length ? TLSched.shiftAfterDeps(c, null, preds) : null;
  const eff = span ? calSafe(() => TLCal.nextWork(c, span.s)) : null;
  const violated = earliest !== null && eff !== null && eff < TLCal.dn(earliest);
  const late = span ? TLSched.deadlineLate(c, span.f, info.deadline) : null;
  const head = withToggle => /*#__PURE__*/React.createElement("div", {
    className: "plg-timeline-sec-head"
  }, /*#__PURE__*/React.createElement("span", {
    className: "plg-timeline-sec-title"
  }, SEC_TITLE), withToggle ? /*#__PURE__*/React.createElement("button", {
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
  const d = cur.d;
  const startVal = "start" in d ? d.start : sched.start || "";
  const durVal = "dur" in d ? d.dur : sched.start === null ? "" : String(sched.duration);
  const milestone = sched.start !== null && sched.duration === 0;
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
    onChange: onStartChange,
    onBlur: onStartBlur,
    onKeyDown: onStartKey
  })), /*#__PURE__*/React.createElement("label", {
    className: "plg-timeline-field"
  }, /*#__PURE__*/React.createElement("span", {
    className: "plg-timeline-field-label"
  }, SEC_DUR), /*#__PURE__*/React.createElement("span", {
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
  }, SEC_HK))));
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
    }, /*#__PURE__*/React.createElement("div", {
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
      }, "FS"), /*#__PURE__*/React.createElement("span", {
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
  return /*#__PURE__*/React.createElement("section", {
    className: "plg-timeline-section",
    "aria-label": SEC_TITLE,
    onFocus: refreshSoon,
    onPointerEnter: refreshSoon
  }, head(true), fields, more, picker ? null : /*#__PURE__*/React.createElement("div", {
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

// ── 5. Ekspor Node + registrasi ─────────────────────────────────────────────
const pure = {
  calendarStore,
  calTarget,
  prefKey,
  cleanPref,
  PREF_DEFAULTS,
  PREF_CHOICES,
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
  rowCells,
  pomoText,
  missingYearsNote,
  barGeom,
  createInteractions,
  MSG_CHANGED,
  MSG_UNDO,
  MSG_SAVE_FAIL,
  MSG_CYCLE,
  MSG_MAX_DEPS,
  MSG_SUMMARY_DEP,
  MSG_DUP_DEP,
  TimelineViewBody,
  ScheduleSection,
  ScheduleBody,
  CalendarPopover,
  ListFallback
};
if (typeof module !== "undefined" && module.exports) module.exports = Object.assign({}, {
  TLHolidays,
  TLCal,
  TLSched,
  TLLayout,
  TLDrag
}, pure);
const host = typeof window !== "undefined" ? window : null;
if (host && host.TF && host.TF.plugins) {
  host.TF.plugins.register(manifest, function factory(api) {
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
