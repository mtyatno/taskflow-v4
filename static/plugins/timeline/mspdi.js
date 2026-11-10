// Plugin Timeline — TLMspdi: pembangun XML MSPDI (Microsoft Project XML Data Interchange) murni untuk "Ekspor ke
// Microsoft Project (.xml)" (spec 1d K53, §5.4, §8; rencana 1d-2 R5, R7–R10, dikoreksi review F2).
// Masukan = data yang sudah dibaca mesin (eng.ctx.tasks daftar lengkap halaman, kalender halaman, hasil TLCpm.run,
// baseline aktif terdekode, nama orang); keluaran = string XML + statistik untuk toast. Murni: tanpa jam lokal, tanpa
// global, tanpa DOM, TIDAK menulis (K27/R25) dan tidak mengubah masukan. Urutan baris = TLLayout.layout sort "wbs"
// (sama dengan Gantt); urutan lain lewat TLCpm.cmpKey → string identik untuk urutan masukan apa pun.
// Paritas mesin (review F2): tanggal task = hasil TLCpm.run (es/ef), tautan = sisi yang dipakai mesin (result.pred),
// dan kendala/aktual dipilih supaya penjadwalan MS Project (HonorConstraints 1) menghasilkan tanggal yang sama —
// akar Otomatis SNET di es, task tetap mesin (selesai/berjalan/lingkaran/MFO/Manual) dijangkar lewat Actual*/MSO/MFO/
// Manual, dan milestone yang menurut mesin "memakan" harinya dijangkar SNET/MSO (lihat buildConstraint).
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
  const POMO_MIN = 25; // menit per 🍅 (rumus hoursLabel TLLoad)
  const LAG_UNIT = 4800; // LinkLag = persepuluh menit; 1 hari kerja = 480 × 10
  const LAG_FORMAT = 7; // hari
  const DUR_FORMAT = 7; // hari
  const WORK_FORMAT = 2; // jam
  const EST_MAX = LOAD.EST_MAX; // R3 1d-1: target 🍅 dijepit batas host
  const NAME_CUT = 80; // R9: maks code point judul di nama berkas
  const NAME_MAX = 255; // M2 F2: maks code point nama task/resource/judul/kelompok/pengecualian
  const PAD_BEFORE = 7; // R7: pengecualian kalender mulai paling awal − 7 hari
  const PAD_AFTER = 31; // R7: … sampai selesai paling akhir + 31 hari
  const SPAN_MAX = 3660; // R7: maks hari kalender rentang pengecualian / hitung hari kerja ringkasan
  const HALF_SPAN = 1830; // rentang terlalu lebar → digeser mendekati hari ini ± 1830 (pola RANGE_SPAN TLLayout)
  const DEFAULT_TITLE = "Timeline";
  const CAL_NAME = "Standar";
  const NO_RES = "Anggota #";
  const LINK_TYPE = Object.freeze({ FF: 0, FS: 1, SF: 2, SS: 3 });
  // ConstraintType MSPDI: 0 ASAP, 2 MSO (harus mulai pada), 3 MFO (harus selesai pada), 4 SNET (mulai tidak lebih awal).
  const C_ASAP = 0;
  const C_MSO = 2;
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
  // lewat TLLoad.run; load.js tidak diubah agar bundel 1.3 tetap sama).
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
  // Units = menit kerja ÷ (d × 480), dibulatkan setengah ke atas pada 4 desimal dengan aritmetika bilangan bulat
  // (tanpa galat pecahan biner), tanpa notasi ilmiah, nol di belakang dibuang ("0.0417", "0.625", "5").
  function fmtUnits(workMin, d) {
    const num = workMin * 10000;
    const den = d * MIN_DAY;
    const n = Math.floor((2 * num + den) / (2 * den));
    const ip = Math.floor(n / 10000);
    const fp = String(n - ip * 10000).padStart(4, "0").replace(/0+$/, "");
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
  // Bukan simpul / mesin tidak ada: rentang tersimpan (bar Gantt); tanpa jadwal → placeholder hari kerja pertama ≥ D.
  function taskDates(e, c, nodes, D) {
    const sp = e.row.span;
    const n = nodes ? nodes.get(e.key) : undefined;
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
      e.ph = nextWorkOr(c, D);
      e.d = 1;
      e.ms = false;
      e.s = startPt(e.ph);
      e.f = finishPt(e.ph);
    }
  }

  // Kendala + mode (R7, R8; review F2 I1–I3, M1). e.links sudah terisi (hanya sisi result.pred bila mesin ada).
  //  Simpul mesin:
  //   - mode efektif Manual → Manual 1; kendala eksplisit, selain itu SNET di es (= mulai tersimpan) (R8);
  //   - selesai / berjalan ber-ActualStart → SNET di es (aktual sudah menjangkar; SNET hanya untuk pembaca lain);
  //   - berjalan dengan es > D (tanpa aktual) / anggota lingkaran → tetap di es: SNET, atau MSO bila punya tautan masuk
  //     (mesin tidak menggeser task tetap walau pendahulu terlambat; MSO + HonorConstraints 1 juga tidak);
  //   - MFO → MFO (dihormati MS Project, HonorConstraints 1);
  //   - akar Otomatis (tanpa tautan masuk) → SNET di es (mesin: es = maks(SNET, mulai tersimpan); E1, E2);
  //   - milestone Otomatis bertautan masuk FF/SF → MSO di es; milestone lain bertautan masuk / penerus langsung
  //     milestone → SNET di es (mesin menaruh milestone di awal harinya tetapi penerus FS/FF-nya mulai hari kerja
  //     berikutnya; MS Project menaruh milestone di jam selesai pendahulu — I3). Penerus langsung pendahulu yang
  //     selesai di hari non-kerja (task selesai/aktual akhir pekan) juga SNET di es: TLCal.addWork menghitung dari hari
  //     itu sendiri (FF lag ≤ 0 → mesin 1 hari lebih lambat dari MS Project). Di semua kasus ini mesin ≥ hitungan MS
  //     Project dari tautan, jadi SNET di es mengembalikan tanggal mesin tanpa membekukan task;
  //   - selain itu SNET eksplisit atau ASAP.
  //  Bukan simpul: tanpa jadwal → Manual 1 + kendala eksplisit / SNET di placeholder (M1); terjadwal → aturan cadangan
  //  (Manual / tanpa tautan masuk → SNET di mulai tersimpan).
  function buildConstraint(e, mode) {
    const cst = e.row.sched.constraint;
    const inLinks = e.links.length > 0;
    const at = (type, dn, finish) => {
      e.ctype = type;
      e.cdate = CAL.iso(dn) + (finish ? T_FINISH : T_START);
    };
    const explicit = () => {
      if (cst.type === "SNET") at(C_SNET, CAL.dn(cst.date), false);
      else at(C_MFO, CAL.dn(cst.date), !e.ms); // milestone MFO di 08:00 = jam milestone di berkas
    };
    const n = e.node;
    if (n) {
      e.manual = mode === "manual";
      const fx = n.fixed;
      if (e.manual) {
        if (cst) explicit();
        else at(C_SNET, n.es, false);
      } else if (fx === "done" || (fx === "started" && e.actualS)) at(C_SNET, n.es, false); // sabuk pengaman: pembaca yang tidak menjangkar dari ActualStart (mis. ProjectLibre) tetap tidak memajukannya
      else if (fx === "started" || fx === "cycle") at(inLinks ? C_MSO : C_SNET, n.es, false);
      else if (fx === "mfo" && cst) explicit();
      else if (!inLinks) at(C_SNET, n.es, false);
      else if (e.ms && e.links.some((l) => l.tt === "FF" || l.tt === "SF")) at(C_MSO, n.es, false);
      else if (e.ms || e.links.some((l) => l.anchor)) at(C_SNET, n.es, false);
      else if (cst && cst.type === "SNET") explicit();
      return;
    }
    if (e.unscheduled) {
      e.manual = true;
      if (cst) explicit();
      else at(C_SNET, e.ph, false);
      return;
    }
    e.manual = mode === "manual";
    if (cst) explicit();
    else if (e.manual || !inLinks) at(C_SNET, e.row.span.s, false);
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

    // 2. tanggal daun (taskDates); ringkasan/kelompok = min/maks titik anak (dari belakang pra-urut: anak sebelum induk).
    let unscheduled = 0;
    for (const e of ents) {
      if (e.kind !== "task") continue;
      taskDates(e, c, eng ? nodes : null, D);
      if (e.unscheduled) unscheduled++;
    }
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
          const hit = Array.isArray(used) ? used.find((x) => x && x.key === pk) : undefined;
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
        // anchor: pendahulu milestone, atau selesai di hari non-kerja (task selesai/aktual di akhir pekan) — di sana
        // aritmetika hari kerja mesin (TLCal.addWork dari hari itu) lebih lambat 1 hari dari waktu kerja MS Project.
        // Hanya dipakai buildConstraint untuk simpul mesin; jalur cadangan (tanpa mesin) tidak menghitungnya.
        const anchor = eng && (pe.ms === true || !workAt(c, ptDn(pe.f)));
        e.links.push({ uid: pe.uid, tt, type: LINK_TYPE[tt], lag: (Number.isInteger(lag) ? lag : 0) * LAG_UNIT, anchor });
      }
      e.links.sort((x, y) => x.uid - y.uid);
      nLinks += e.links.length;
    }

    // 4. mode + kendala (buildConstraint). Kelompok/ringkasan selalu Otomatis tanpa kendala (dihitung dari anak).
    for (const e of ents) {
      e.manual = false;
      e.ctype = C_ASAP;
      e.cdate = null;
      if (e.kind !== "task") continue;
      buildConstraint(e, SCHED.modeOf(rawFor(e.task), units, e.task));
    }

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
    out.el(1, "HonorConstraints", 1); // I4 F2: MSO/MFO menang atas tautan (sama dengan task tetap di mesin)
    out.el(1, "NewTasksEffortDriven", 0);
    out.el(1, "WeekStartDay", 1);
    writeCalendar(out, c, ents, D);
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
      out.line(2, "</Resource>");
    }
    out.line(1, "</Resources>");
    out.line(1, "<Assignments>");
    for (const x of asg) {
      out.line(2, "<Assignment>");
      out.el(3, "UID", x.uid);
      out.el(3, "TaskUID", x.task.uid);
      out.el(3, "ResourceUID", x.rid);
      out.el(3, "Finish", fmtPt(x.task.f));
      out.el(3, "Start", fmtPt(x.task.s));
      out.el(3, "Units", x.units);
      out.el(3, "Work", fmtWork(x.task.work));
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
  function writeCalendar(out, c, ents, D) {
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
    out.line(1, "</Calendars>");
  }

  // Satu <Task> dengan urutan anak XSD (subset): UID, ID, Name, Manual, Type, IsNull, CreateDate, WBS, OutlineNumber,
  // OutlineLevel, Start, Finish, Duration, DurationFormat, Work?, EffortDriven, Estimated, Milestone, Summary,
  // PercentComplete, ActualStart?, ActualFinish?, ConstraintType, CalendarUID, ConstraintDate?, PredecessorLink*,
  // Baseline?, ManualStart/ManualFinish/ManualDuration (task Manual: tanggal yang dijaga MS Project 2010+).
  function writeTask(out, e, D) {
    const summary = e.kind !== "task";
    const dur = fmtDur(e.d);
    out.line(2, "<Task>");
    out.el(3, "UID", e.uid);
    out.el(3, "ID", e.uid);
    out.el(3, "Name", esc(clip(e.name)));
    out.el(3, "Manual", e.manual ? 1 : 0);
    out.el(3, "Type", 1);
    out.el(3, "IsNull", 0);
    out.el(3, "CreateDate", CAL.iso(D) + T_DAY0);
    out.el(3, "WBS", esc(e.wbs));
    out.el(3, "OutlineNumber", esc(e.wbs));
    out.el(3, "OutlineLevel", e.level);
    out.el(3, "Start", fmtPt(e.s));
    out.el(3, "Finish", fmtPt(e.f));
    out.el(3, "Duration", dur);
    out.el(3, "DurationFormat", DUR_FORMAT);
    if (e.work !== undefined) out.el(3, "Work", fmtWork(e.work));
    out.el(3, "EffortDriven", 0);
    out.el(3, "Estimated", e.unscheduled ? 1 : 0);
    out.el(3, "Milestone", !summary && (e.ms || e.msMark) ? 1 : 0);
    out.el(3, "Summary", summary ? 1 : 0);
    out.el(3, "PercentComplete", summary ? 0 : pctOf(e.task));
    if (e.actualS) out.el(3, "ActualStart", fmtPt(e.s));
    if (e.actualF) out.el(3, "ActualFinish", fmtPt(e.f));
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
