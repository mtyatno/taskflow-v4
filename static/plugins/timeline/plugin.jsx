// Plugin Timeline (Fase 1, PR 1b; spec docs/superpowers/specs/2026-10-31-plugin-fase1-timeline-design.md §8;
// 1.1.0 = PR 1c-1 jadwal otomatis, spec docs/superpowers/specs/2026-11-01-plugin-fase1-1c-otomatis-design.md).
// Gantt untuk project dan workspace: view `gantt` (slot taskList.views) dan seksi `schedule` (slot
// taskDetail.sections). Mesin murni ada di `parts` (holidays-id.js, calendar.js, schedule.js, cpm.js, plan.js,
// layout.js, drag.js — compile.js menggabungkannya SEBELUM kode ini, jadi TLHolidays/TLCal/TLSched/TLCpm/TLPlan/
// TLLayout/TLDrag tersedia sebagai const di lingkup yang sama; tidak ada global window). `manifest` disuntik
// compile.js dari manifest.json.
//
// Susunan modul (Task 6 = kerangka; komponen diisi Task 7–10):
//   1. Konstanta + pesan UI persis (kalender, preferensi).
//   2. calendarStore(api) dan projectStore(api) (1c-1 R6) — SATU-SATUNYA kode yang menyentuh api.records (R5), masing-
//      masing hanya entitasnya sendiri. calTarget (= TLSched.calTarget) / TLSched.unitOf memilih id/scope.
//      Tulisan hanya di calendarStore.save dan projectStore.setAuto (R25: mesin dan pemuat tidak pernah menulis).
//   3. Preferensi per perangkat lewat api.storage: prefKey / cleanPref / PREF_DEFAULTS (R19).
//   4. Komponen: konstanta tampilan, pembantu murni, hooks (useMedia/usePref/useCalendar/useUnits/useEngine), fungsi render
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

// Peristiwa api.records.onChange → bentuk adaptor untuk satu entitas, atau null bila bukan untuknya. Peristiwa tarik
// sukses host {entity: null, pulled: true} (README §5) diteruskan ke semua adaptor sebagai {ids: [], source: "sync",
// lost: [], pulled: true}. Murni (tanpa akses api) — dipakai bersama calendarStore dan projectStore.
function recordEvent(ev, entity) {
  if (!ev) return null;
  if (ev.pulled === true) return { ids: [], source: "sync", lost: [], pulled: true };
  if (ev.entity !== entity) return null;
  return { ids: Array.isArray(ev.ids) ? ev.ids.slice() : [], source: ev.source, lost: Array.isArray(ev.lost) ? ev.lost.slice() : [] };
}

// Adaptor tunggal api.records untuk entitas `calendar`. Tidak ada record → DEFAULT_CAL (pending false, exists false).
// Data dari anggota lain selalu lewat TLCal.normalize. save menolak > 16384 byte di klien sebelum put.
// `exists` = record ada di perangkat ini (final review #2: kalender workspace tanpa record lokal bisa saja belum ditarik).
function calendarStore(api) {
  return {
    load(calId) {
      return Promise.resolve().then(() => api.records.get(CAL_ENTITY, calId)).then((r) => {
        if (!r) return { data: TLCal.normalize(TLCal.DEFAULT_CAL), pending: false, exists: false };
        return { data: TLCal.normalize(r.data), pending: !!r.pending, exists: true };
      });
    },
    save(calId, scope, data) {
      return Promise.resolve().then(() => {
        const clean = TLCal.normalize(data);
        if (TLCal.byteSize(clean) > CAL_MAX_BYTES) throw calTooLarge();
        return api.records.put(CAL_ENTITY, calId, clean, { scope }).then((r) => ({
          data: TLCal.normalize(r && r.data ? r.data : clean),
          pending: !!(r && r.pending),
          exists: true,
        }), (e) => { throw e && e.code === "TOO_LARGE" ? calTooLarge() : e; });
      });
    },
    // fn({ids, source: "local"|"sync", lost: string[]}) hanya untuk entitas calendar, ditambah peristiwa tarik sukses
    // host {ids: [], source: "sync", lost: [], pulled: true} (entity null; README §5); mengembalikan off().
    subscribe(fn) {
      return api.records.onChange((ev) => {
        const e = recordEvent(ev, CAL_ENTITY);
        if (e) fn(e);
      });
    },
  };
}

// ── 2b. Unit jadwal otomatis: record `project` (1c-1 R5, R6) ─────────────────
// Satu record per unit jadwal (project dalam workspace, atau project pribadi): id dari TLSched.unitOf (satu-satunya
// pembuat id), data {v: 1, auto, name, by}. Tidak ada record / data tidak sah → unit dianggap tidak ada (Manual).
const PRJ_ENTITY = "project";
const PRJ_PAGE = 1000; // batas atas limit api.records.list
const NO_UNIT = Object.freeze({ auto: false, by: null, updatedAt: null, pending: false, exists: false, fold: null });
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
  } else if (d.name.length < TLSched.NAME_MAX - 1 && TLSched.unitOf({ pageKind: "workspace", listId: lid, projectName: d.name }).recId !== r.id) {
    return NO_UNIT; // nama utuh yang tidak menghasilkan id ini = data rusak (nama ≥ 119 bisa hasil potong cutName)
  }
  return {
    auto: d.auto, by: d.by,
    updatedAt: typeof r.updated_at === "string" ? r.updated_at : null,
    pending: !!r.pending, exists: true, fold,
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
        const unit = TLSched.unitOf({ pageKind: p.pageKind, listId: p.pageKind === "workspace" ? p.listId : null, projectName: p.projectName });
        const out = new Map();
        if (p.pageKind === "workspace" && unit.scope !== "user") {
          const scope = unit.scope;
          const lid = scope.slice(5);
          const page1 = (after) => {
            const q = after === null ? { scope, limit: PRJ_PAGE } : { scope, limit: PRJ_PAGE, after };
            return Promise.resolve(api.records.list(PRJ_ENTITY, q)).then((res) => {
              const items = res && Array.isArray(res.items) ? res.items : [];
              for (const r of items) if (r && typeof r.id === "string") out.set(r.id, prjUnitOf(r, null, lid));
              const next = res && typeof res.next === "string" && res.next ? res.next : null;
              return next !== null && next !== after ? page1(next) : out;
            });
          };
          return page1(null);
        }
        return Promise.resolve(api.records.get(PRJ_ENTITY, unit.recId)).then((r) => {
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
          name: TLSched.cutName(unit.name), // potong simetris dengan baca/lookup (sadar surrogate)
          by: Number.isInteger(userId) ? userId : null,
        };
        return api.records.put(PRJ_ENTITY, unit.recId, data, { scope: unit.scope });
      });
    },
    subscribe(fn) {
      return api.records.onChange((ev) => {
        const e = recordEvent(ev, PRJ_ENTITY);
        if (e) fn(e);
      });
    },
  };
}

// ── 3. Preferensi per perangkat (R19) ───────────────────────────────────────
const PREF_DEFAULTS = Object.freeze({ zoom: "week", sort: "wbs", cols: false, mode: "gantt", section: false, crit: false });
const PREF_CHOICES = Object.freeze({ zoom: ["day", "week", "month"], sort: ["wbs", "start"], mode: ["gantt", "list"] });

// "zoom:<page>", "sort:<page>", "cols:<page>", "mode:<page>", "crit:<page>" (1c-1 R18); seksi Jadwal global: "section:open".
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
  today: "Hari ini", calendar: "Kalender kerja", sort: "Urutkan menurut Mulai", cols: "Kolom",
  gantt: "Gantt", list: "Daftar", zoom: "Skala waktu", mode: "Tampilan", crit: "Jalur kritis",
  auto: "Jadwal otomatis", reschedule: "Jadwalkan ulang", more: "Lainnya", // 1c-1 R23
};
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
const EMPTY_PV_MODEL = Object.freeze({ rows: [], moved: 0, endBefore: null, endAfter: null, endDelta: null, late: 0, notMoved: [], brokenDeps: 0 });
const PV_ROWS_MAX = 50; // R14: ≤ 50 baris sebelum "Tampilkan semua"
const appliedText = (n) => "Jadwal diterapkan · " + n + " task";
// 1c-1 R12, R13 (K32, K33): aliran gestur di Gantt (teks persis).
const flowText = (n) => "Jadwal diubah · " + n + " task ikut bergeser";
const MSG_EARLY = "Tidak bisa lebih awal dari dependensinya";
const PV_FLOW = "Tinjau jadwal otomatis"; // judul pratinjau aliran gestur > 20 turunan (teks §7.6 yang ada)
const partialText = (k, n) => "Sebagian jadwal gagal disimpan (" + k + " dari " + n + ")"; // k = item yang gagal
// 1c-1 R16, R17 (K35, K36): banner drift/lingkaran, Tinjau, Jadwalkan ulang (teks persis).
const driftText = (n) => "Jadwal otomatis belum mutakhir: " + n + " task berbeda dari hasil hitung.";
const BANNER_REVIEW = "Tinjau";
const BANNER_OPEN = "Buka";
const BANNER_NAMES_MAX = 3; // R16: ≤ 3 judul + "dan {n} lainnya"
const PV_RESCHED = "Jadwalkan ulang yang belum selesai";
const brokenText = (n) => n + " dependensi akan dilanggar";
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
const LINK_MSG = { cycle: MSG_CYCLE, max: MSG_MAX_DEPS, summary: MSG_SUMMARY_DEP, dup: MSG_DUP_DEP };
const DOUBLE_TAP_MS = 400; // R21 sentuh: ketuk ganda
const DOUBLE_TAP_PX = 24;
const LEGEND = [
  ["task", "Task"], ["done", "Selesai"], ["late", "Lewat tenggat"], ["summary", "Ringkasan"],
  ["milestone", "Milestone"], ["flag", "Tenggat"], ["holiday", "Libur"], ["dep", "Dependensi"],
];
// Kolom tabel (spec §8.5 butir 5). Sempit (≤ 640 px) / Live Edit: hanya WBS + Nama (160 px) kecuali "Kolom" ON (R20).
const COLS_FULL = [
  { id: "wbs", label: "WBS", w: 56 }, { id: "name", label: "Nama", w: 220 }, { id: "start", label: "Mulai", w: 92 },
  { id: "dur", label: "Dur", w: 56 }, { id: "pomo", label: "🍅", w: 52 }, { id: "pct", label: "%", w: 56 },
  { id: "slack", label: "Slack", w: 56 }, // 1c-1 R18: hanya di COLS_FULL (ringkas: lewat "Kolom")
];
const COLS_COMPACT = [{ id: "wbs", label: "WBS", w: 48 }, { id: "name", label: "Nama", w: 160 }];

function missingYearsNote(years) {
  return "Libur nasional " + years.join(", ") + " belum ada di Alurik versi ini.";
}

// Tata letak lewat objek yang bisa diganti tes (TLLayout beku; tes R24 memata-matai jumlah panggilan).
// Satu pintu ke mesin murni (spy di tes): tata letak (R24) dan CPM (1c-1 R7; dipanggil hanya dari useEngine).
// explain (1c-1 R21, Task 12): hanya saat "Kenapa dijadwalkan di sini?" dibuka — kalender + readExt = masukan run.
const engine = {
  layout: (args) => TLLayout.layout(args),
  run: (ctx) => TLCpm.run(ctx),
  explain: (result, key, cal, readExt) => TLCpm.explain(result, key, cal, readExt),
};

const DEFAULT_CAL_DATA = TLCal.normalize(TLCal.DEFAULT_CAL);

// 4b. Pembantu murni.
function cx() {
  let out = "";
  for (let i = 0; i < arguments.length; i++) if (arguments[i]) out += (out ? " " : "") + arguments[i];
  return out;
}

function logWarn(api, msg, err) {
  try { api.log.warn(msg, err); } catch (e) { /* log tidak tersedia */ }
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
  return { end, late };
}

// Unit jadwal halaman (R15): halaman project = satu unit (nama project halaman); workspace = satu per kelompok project
// di layout (urutan kelompok; "(Tanpa project)" = unit "-"). rep = task wakil untuk TLSched.unitFor (pagar fold).
function pageUnits(lay, pageKind, projectName, groupNames) {
  if (pageKind !== "workspace") {
    const rep = { list_id: null, project: projectName === undefined || projectName === null ? "" : String(projectName) };
    return [{ unit: TLSched.unitOf(rep), rep, label: rep.project.trim() || MSG_NO_PROJECT }];
  }
  const out = [];
  const seen = new Set();
  for (const r of lay.rows) {
    if (!r.task) continue;
    const unit = TLSched.unitOf(r.task);
    if (seen.has(unit.recId)) continue;
    seen.add(unit.recId);
    out.push({ unit, rep: r.task, label: groupNames.get(r.group) || unit.name.trim() || MSG_NO_PROJECT });
  }
  return out;
}

// "Dinyalakan oleh {nama} · {tgl Jakarta}" (R15): by = pengguna aktif → currentUser; selain itu collaborators;
// tidak ditemukan → "Dinyalakan oleh anggota lain". Tanggal = updated_at record di zona Asia/Jakarta (TLCpm.jkt).
function unitCaption(u, context, userId) {
  if (!u || u.auto !== true) return null;
  const nameOf = (x) => (x && typeof x === "object" ? String(x.display_name || x.username || "").trim() : "");
  let name = "";
  if (u.by !== null && u.by !== undefined) {
    const id = String(u.by);
    const users = [];
    if (userId !== undefined && userId !== null && String(userId) === id) users.push(context.currentUser);
    for (const c of Array.isArray(context.collaborators) ? context.collaborators : []) users.push(c);
    const hit = users.find((x) => x && typeof x === "object" && x.id !== undefined && x.id !== null && String(x.id) === id);
    name = nameOf(hit);
  }
  const head = name ? MSG_BY + name : MSG_BY_OTHER;
  const d = typeof u.updatedAt === "string" ? TLCpm.jkt(u.updatedAt) : null;
  return Number.isInteger(d) ? head + " · " + TLCal.fmtShort(d) : head;
}

// Model dialog = TLPlan.preview + WBS/judul untuk tampilan (rows: wbs; notMoved: task + wbs). Murni.
function dialogModel(pm, result, wbsOf) {
  const nodes = result && result.nodes instanceof Map ? result.nodes : new Map();
  return Object.assign({}, pm, {
    rows: pm.rows.map((r) => Object.assign({}, r, { wbs: wbsOf(r.key) })),
    notMoved: pm.notMoved.map((x) => {
      const n = nodes.get(x.key);
      return Object.assign({}, x, { task: n ? n.task : null, wbs: wbsOf(x.key) });
    }),
  });
}

// "Kenapa dijadwalkan di sini?" per baris PreviewDialog (R14 + R21; Task 12 fix): whyOf(key) atas hasil mesin yang SAMA
// dengan baris dialog (hasil sesudah rencana) dan kalender ctx yang dipakai run-nya. readExt = ext ctx + patch item rencana
// (acuan root/SNET explain = nilai sesudah Terapkan). explain hanya dipanggil saat baris dibuka (pemanggil: PreviewDialog).
function planWhy(result, ctx, items, wbsOf) {
  const patches = new Map((Array.isArray(items) ? items : []).map((it) => [it.key, it.patch]));
  const readExt = (t) => {
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
  return (key) => {
    const k = String(key);
    const n = result && result.nodes instanceof Map ? result.nodes.get(k) : null;
    const titleOf = (x) => {
      const m = result && result.nodes instanceof Map ? result.nodes.get(String(x)) : null;
      return taskTitle(m ? m.task : null);
    };
    const label = (x) => {
      const w = wbsOf(String(x));
      return (w ? w + " " : "") + titleOf(x);
    };
    const ex = engine.explain(result, k, ctx.cal, readExt);
    return whyText(ex, { label, title: titleOf, d: n ? n.d : undefined });
  };
}

// Banner R16 (murni): drift = kunci result.drift yang ada di scopeTasks halaman (task tersaring panel tidak dihitung
// walau ikut scope mesin); first = anggota lingkaran pertama di halaman (cadangan cycle[0]); cycle = anggota lingkaran yang menyentuh halaman (seluruh anggota lingkaran itu, urutan
// result.cycles). Teks lingkaran: ≤ 3 judul + " dan {n} lainnya".
function bannerInfo(result, scopeTasks) {
  if (!result || !(result.nodes instanceof Map)) return { drift: [], cycle: [], first: null, cycleText: "" };
  const page = new Set();
  for (const t of Array.isArray(scopeTasks) ? scopeTasks : []) if (t && t.id !== undefined && t.id !== null) page.add(String(t.id));
  const drift = result.drift instanceof Set ? [...result.drift].filter((k) => page.has(k)) : [];
  const cycle = [];
  let first = null; // "Buka" (R16): anggota pertama yang ADA di halaman; tidak ada → anggota pertama
  for (const c of Array.isArray(result.cycles) ? result.cycles : []) {
    if (!c.some((k) => page.has(k))) continue;
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
  return { drift, cycle, first: first || cycle[0] || null, cycleText };
}

// Tutup banner per sesi (R16): Set tingkat modul berkunci page + jenis + n — bertahan saat view dipasang ulang, tampil
// lagi bila jumlahnya berubah. Hanya memori tampilan (tidak pernah disimpan / ditulis).
const BANNER_CLOSED = new Set();
const bannerKey = (page, kind, n) => page + "\u0000" + kind + "\u0000" + n;

// Daftar lengkap → task di scope dependensi halaman (saringan sama dengan useEngine).
function scopeFilter(list, scopeTasks) {
  const keys = new Set((Array.isArray(scopeTasks) ? scopeTasks : []).map(TLSched.scopeKeyOf));
  return (Array.isArray(list) ? list : []).filter((t) => !!t && typeof t === "object" && keys.has(TLSched.scopeKeyOf(t)));
}

// Potret CAS unit (R14): updatedAt/by record dari useUnits().units (BUKAN eng.ctx.units — memo mesin hanya berkunci auto+fold).
function unitSnap(u) {
  return { updatedAt: u && typeof u.updatedAt === "string" ? u.updatedAt : null, by: u && u.by !== undefined ? u.by : null };
}
function sameSnap(a, b) {
  return a.updatedAt === b.updatedAt && a.by === b.by;
}
// CAS unit pv (R14; T8 satu unit, T10 daftar): pv.unit = entri `{rep, snap}` atau daftar entri `{rep, snap, auto?}`.
// Setiap entri cocok bila potret updatedAt/by record terbaru sama dan — bila `auto` (boolean) dicatat — mode otomatis
// unit terbaru sama dengan mode yang dipakai rencana. Tanpa entri → selalu cocok.
const pvUnitList = (u) => (!u ? [] : Array.isArray(u) ? u : [u]);
const unitAuto = (u) => !!(u && u.auto === true);
function unitsStillOk(unitField, units) {
  return pvUnitList(unitField).every((x) => {
    const u = TLSched.unitFor(units, x.rep);
    return sameSnap(x.snap, unitSnap(u)) && (typeof x.auto !== "boolean" || x.auto === unitAuto(u));
  });
}

// JSON kanonik (urutan kunci objek tidak relevan; undefined = null) — pembanding nilai ext.
function canonJson(v) {
  if (v === undefined || v === null) return "null";
  if (Array.isArray(v)) return "[" + v.map(canonJson).join(",") + "]";
  if (typeof v === "object") return "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + canonJson(v[k])).join(",") + "}";
  return JSON.stringify(v);
}

// Item aliran yang benar-benar mengubah ext (T4: gestur {start: null} pada task otomatis berpendahulu menjadi item
// deltaHk 0 yang menulis nilai tersimpan). Item tanpa kunci berbeda dari `before` (nilai mentah) dibuang: gestur yang
// seluruhnya tanpa efek = diam (tanpa tulis, tanpa toast "Jadwal diubah"; R13 hanya mengenal toast untuk perubahan).
function flowItems(items) {
  return (Array.isArray(items) ? items : []).filter((it) => {
    const b = it && it.before && typeof it.before === "object" ? it.before : {};
    return !!it && !!it.patch && Object.keys(it.patch).some((k) => canonJson(it.patch[k]) !== canonJson(b[k]));
  });
}

function rowCells(row, groupName, slack) {
  if (row.kind === "group") return { wbs: row.wbs, name: groupName || "", start: "", dur: "", pomo: "", pct: "", slack: "" };
  const t = row.task;
  const title = t.title !== undefined && t.title !== null && String(t.title).trim() ? String(t.title).trim() : "Tanpa judul";
  return {
    wbs: row.wbs,
    name: title,
    start: row.span ? TLCal.fmtShort(row.span.s) : "—",
    dur: row.duration === null || row.duration === undefined ? "—" : row.duration + " hk",
    pomo: pomoText(t),
    pct: Math.round(row.progress) + "%",
    slack: slackText(slack),
  };
}

// Overlay mesin di atas tata letak (1c-1 R18, R19) — murni, TIDAK mengubah `lay`. Dihitung dalam memo terpisah
// [lay, result] sehingga mesin selesai / sakelar Jalur kritis tidak menghitung ulang tata letak (R24).
//   slack: Map<rowKey, number|null> — task = node.slack; ringkasan = min slack anak (baris halaman, rekursif); lainnya null
//   crit: Set<rowKey> — node.critical (slack ≤ 0 ∧ bukan selesai); critEdge: Set<"from>to"> — kedua ujung kritis
//   conflictEdge: Set<"from>to"> — sisi terpakai ke jangkar ber-`conflict` yang depReq-nya dilanggar (merah putus-putus)
//   manual: Set<rowKey> — fixed "manual" di unit otomatis (pin "Manual")
// result null (mesin belum siap / gagal) → NO_OVERLAY: semua "—", tanpa kritis/pin/konflik (tampilan 1b).
const NO_OVERLAY = Object.freeze({ ready: false, slack: new Map(), crit: new Set(), critEdge: new Set(), conflictEdge: new Set(), manual: new Set() });

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
    if (r.kind === "summary") v = minOf.has(r.key) ? minOf.get(r.key) : null;
    else {
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
    if (crit.has(e.from) && crit.has(e.to)) critEdge.add(id);
    const sn = nodes.get(e.to);
    const pn = nodes.get(e.from);
    if (!cal || !preds || !sn || !sn.conflict || !pn || pn.es === null || sn.es === null) continue;
    const used = (preds.get(e.to) || []).find((p) => p.key === e.from); // hanya sisi yang dipakai mesin
    if (!used) continue;
    const req = TLSched.depReq(cal, used.type, pn.es, pn.ef, used.lag, sn.d);
    if (TLSched.isEarly(cal, sn.es, req)) conflictEdge.add(id);
  }
  return { ready: true, slack, crit, critEdge, conflictEdge, manual };
}

// Kotak bar baris (px, relatif awal rentang) atau null: baris outOfRange tidak pernah mendapat bar (Task 4).
function boxOf(row, lay) {
  if (!row.span || row.outOfRange || row.kind === "group") return null;
  const sched = row.kind === "summary" ? { duration: row.duration } : row.sched;
  return TLLayout.barBox(row.span, sched, lay.range, lay.px, row.kind);
}

// Geometri bar dalam koordinat grafik (sama dengan renderBar): x/top kiri-atas elemen, w/h ukuran.
function barGeom(row, box, rowH) {
  if (box.milestone) return { x: box.x - MS_SIZE / 2, top: row.index * rowH + (rowH - MS_SIZE) / 2, w: MS_SIZE, h: MS_SIZE, ms: true };
  const h = row.kind === "summary" ? SUM_H : BAR_H;
  return { x: box.x, top: row.index * rowH + (rowH - h) / 2, w: box.w, h, ms: false };
}

function translate(x, y) {
  return "translate(" + x + "px," + y + "px)";
}

function nowMs() {
  return typeof performance !== "undefined" && performance && typeof performance.now === "function" ? performance.now() : Date.now();
}

function toastSafe(api, msg, type, action) {
  try {
    if (action) api.ui.toast(msg, type, action);
    else api.ui.toast(msg, type);
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
    try { m = window.matchMedia(q); } catch (e) { return undefined; }
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
  return Promise.resolve()
    .then(() => api.storage.get(prefKey(kind, page)))
    .then((v) => cleanPref(kind, v), (e) => {
      logWarn(api, "preferensi " + kind + " gagal dibaca:", e);
      return PREF_DEFAULTS[kind];
    });
}

function writePref(api, kind, page, value) {
  Promise.resolve()
    .then(() => api.storage.set(prefKey(kind, page), value))
    .catch((e) => logWarn(api, "preferensi " + kind + " gagal disimpan:", e));
}

// Preferensi per perangkat (R19): bawaan dulu, lalu nilai api.storage — kecuali pengguna sudah memilih lebih dulu.
function usePref(api, kind, page) {
  const [val, setVal] = React.useState(PREF_DEFAULTS[kind]);
  const picked = React.useRef(false);
  React.useEffect(() => {
    let alive = true;
    picked.current = false;
    readPref(api, kind, page).then((v) => {
      if (alive && !picked.current) setVal(v);
    });
    return () => { alive = false; };
  }, [api, kind, page]);
  const set = React.useCallback((v) => {
    picked.current = true;
    setVal(v);
    writePref(api, kind, page, v);
  }, [api, kind, page]);
  return [val, set];
}

// Toast "kalah LWW" (spec §8.9) dari view DAN seksi Jadwal (final review #7: seksi saja juga memberi tahu bila tidak ada
// view Gantt terpasang). Keduanya menerima peristiwa yang sama dalam satu dispatch sinkron → dedupe tingkat modul per id
// kalender selama LOST_TIMING.dedupeMs (view + panel Live Edit bersamaan = satu toast).
const LOST_TIMING = { dedupeMs: 1500 };
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
  const [st, setSt] = React.useState(() => ({ id: target.id, data: DEFAULT_CAL_DATA, pending: false }));
  const [pulled, setPulled] = React.useState(false);
  React.useEffect(() => {
    let alive = true;
    const id = target.id;
    const load = () => store.load(id).then((r) => {
      if (alive) setSt({ id, data: r.data, pending: r.pending });
      return true;
    }, (e) => {
      logWarn(api, "kalender gagal dimuat:", e);
      return false;
    });
    load();
    let off = null;
    try {
      off = store.subscribe((ev) => {
        if (ev.pulled) {
          load().then((ok) => { if (ok && alive) setPulled(true); });
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
  return { data: mine ? st.data : DEFAULT_CAL_DATA, pending: mine && st.pending, store, pulled };
}

// Jeda muat ulang bersama useUnits (peristiwa record project) dan useEngine (scopeTasks / sync.done).
const RELOAD_TIMING = { debounceMs: 300 };

// Unit jadwal halaman (1c-1 R6; pola useCalendar): muat lewat projectStore (pertama segera saat pasang), muat ulang pada
// perubahan entitas project (debounce RELOAD_TIMING) dan segera pada peristiwa tarik sukses. `pulled` = latch "tarik
// record plugin SUKSES sejak pemasangan ini", dinyalakan SETELAH muat ulang sesudah peristiwa `pulled` selesai (bukan sync.done, yang juga menyala saat sinkron gagal).
// P3 (a): sakelar "Jadwal otomatis" workspace dikunci "Menunggu data jadwal workspace…" selama unitnya tidak `exists`
// dan `pulled` belum menyala (Task 8). `loaded` = muat pertama halaman ini selesai. Hook ini tidak pernah menulis.
// page = {pageKind, listId, projectName}; workspace dimuat per scope list, halaman project per recId unitOf(page).
function unitsPageKey(pageKind, listId, projectName) {
  if (pageKind === "workspace") return "w|" + calTarget(listId).scope;
  return "p|" + TLSched.unitOf({ pageKind: "project", listId: null, projectName }).recId;
}

function useUnits(api, page) {
  const p = page && typeof page === "object" ? page : {};
  const pageKind = p.pageKind === "workspace" ? "workspace" : "project";
  const key = unitsPageKey(pageKind, p.listId, p.projectName);
  const store = React.useMemo(() => projectStore(api), [api]);
  const [st, setSt] = React.useState(() => ({ key, units: EMPTY_UNITS, loaded: false, failed: false }));
  const [pulled, setPulled] = React.useState(false);
  const argRef = React.useRef(null);
  argRef.current = { pageKind, listId: pageKind === "workspace" ? p.listId : null, projectName: pageKind === "workspace" ? null : p.projectName };
  React.useEffect(() => {
    let alive = true;
    let seq = 0;
    let timer = null;
    const arg = argRef.current;
    const load = () => {
      const my = ++seq;
      return store.loadUnits(arg).then((units) => {
        if (alive && my === seq) setSt({ key, units, loaded: true, failed: false });
        return true;
      }, (e) => {
        logWarn(api, "unit jadwal gagal dimuat:", e);
        // `failed` (seksi Jadwal): muat gagal tidak boleh mengunci input selamanya; `loaded`/units tidak berubah.
        if (alive && my === seq) setSt((p) => (p.key === key ? Object.assign({}, p, { failed: true }) : { key, units: EMPTY_UNITS, loaded: false, failed: true }));
        return false;
      });
    };
    load();
    let off = null;
    try {
      off = store.subscribe((ev) => {
        if (ev.pulled) {
          load().then((ok) => { if (ok && alive) setPulled(true); });
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
  return { units: mine ? st.units : EMPTY_UNITS, loaded: mine && st.loaded, failed: mine && st.failed, pulled, store };
}

// Mesin jadwal di view (1c-1 R7, K31, K43): useEngine(api, {scopeTasks, calData, units}). Memuat daftar task LENGKAP (api.data.tasks.list({includeDone: true});
// scopeTasks host sudah difilter panel) saat pasang, lalu — debounce RELOAD_TIMING.debounceMs, hanya jawaban terbaru —
// saat identitas scopeTasks berubah dan saat sync.done. Saringan scope = TLSched.scopeKeyOf halaman. TLCpm.run
// dijalankan SESUDAH gambar pertama (raf → setTimeout 0) dan hanya bila engineKey (data task + ext jadwal, kalender,
// unit) berubah. Keluaran {status: "loading"|"ready"|"error", result, tasks, ctx, rawOf, rerun}: ctx = {tasks, cal,
// units, readExt} = masukan run yang sama untuk TLCpm.explain / TLPlan; hasil lama tetap "ready" sampai hasil baru siap.
// R25: hook ini TIDAK PERNAH menulis (drift hanya ditampilkan; tulisan berasal dari aksi pengguna).
const ENGINE_IDLE = Object.freeze({ key: null, status: "loading", result: null, ctx: null });
const NO_TASKS = Object.freeze([]);
const ENGINE_TASK_FIELDS = ["id", "cid", "server_id", "parent_id", "parent_cid", "list_id", "project", "gtd_status", "progress",
  "pomodoros_done", "completed_at", "deadline", "recurrence_type", "archived", "deleted"];
const ENGINE_EXT_KEYS = ["start", "duration", "deps", "mode", "constraint"];

// Kunci memo mesin: JSON ringkas per task (kolom yang dibaca mesin + ext jadwal), urutan daftar dipertahankan.
function engineKeyOf(tasks, readExt) {
  const rows = [];
  for (const t of tasks) {
    const raw = readExt(t);
    rows.push([ENGINE_TASK_FIELDS.map((f) => (t[f] === undefined ? null : t[f])), ENGINE_EXT_KEYS.map((k) => (raw[k] === undefined ? null : raw[k]))]);
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

function useEngine(api, opts) {
  const o = opts && typeof opts === "object" ? opts : {};
  const scopeTasks = Array.isArray(o.scopeTasks) ? o.scopeTasks : NO_TASKS;
  const calData = o.calData || DEFAULT_CAL_DATA;
  const units = o.units instanceof Map ? o.units : EMPTY_UNITS;
  const [list, setList] = React.useState(null); // daftar lengkap terakhir (null = belum ada)
  const [failed, setFailed] = React.useState(false);
  const [out, setOut] = React.useState(ENGINE_IDLE);
  const L = React.useRef(null);
  if (!L.current) L.current = { alive: true, seq: 0, timer: null, scope: null, api };
  L.current.api = api;

  const load = () => {
    const R = L.current;
    const seq = ++R.seq;
    const a = R.api;
    let p;
    try {
      p = Promise.resolve(a.data.tasks.list({ includeDone: true })); // panggil sinkron: permintaan berurutan = urutan kejadian
    } catch (e) {
      p = Promise.reject(e);
    }
    return p
      .then((l) => {
        if (R.alive && seq === R.seq) {
          setList(Array.isArray(l) ? l : []);
          setFailed(false);
        }
      }, (e) => {
        logWarn(a, "daftar task gagal dimuat (mesin jadwal):", e);
        if (R.alive && seq === R.seq) setFailed(true);
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

  const readExt = React.useMemo(() => (t) => readExtSafe(api, t), [api]);
  const tasks = React.useMemo(() => {
    if (list === null) return null;
    const keys = new Set(scopeTasks.map(TLSched.scopeKeyOf));
    return list.filter((t) => !!t && typeof t === "object" && keys.has(TLSched.scopeKeyOf(t)));
  }, [list, scopeTasks]);
  const tasksKey = React.useMemo(() => (tasks === null ? null : engineKeyOf(tasks, readExt)), [tasks, readExt]);
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
          const ctx = { tasks, cal: TLCal.compile(calData), units, readExt };
          next = { key, status: "ready", result: engine.run(ctx), ctx };
        } catch (e) {
          logWarn(api, "mesin jadwal gagal:", e);
          next = { key, status: "error", result: null, ctx: null };
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
    const rerun = (patches) => {
      if (!ctx) return null;
      const pm = new Map();
      for (const it of Array.isArray(patches) ? patches : []) {
        if (!it || !it.task || !it.patch) continue;
        const k = String(it.task.id);
        pm.set(k, Object.assign({}, pm.get(k) || {}, it.patch));
      }
      const rx = (t) => {
        const raw = ctx.readExt(t);
        const p = t && t.id !== undefined && t.id !== null ? pm.get(String(t.id)) : undefined;
        return p ? applyRaw(raw, p) : raw;
      };
      return engine.run({ tasks: ctx.tasks, cal: ctx.cal, units: ctx.units, readExt: rx });
    };
    return { status, result: out.result, tasks: ctx ? ctx.tasks : NO_TASKS, ctx, rawOf: ctx ? ctx.readExt : readExt, rerun };
  }, [out, list === null, failed, readExt]);
}

// 4d. Render (fungsi biasa dipanggil langsung → pohon utuh untuk tes anggaran DOM; tanpa hooks di dalamnya).
function renderToolbar(v) {
  const seg = (items, cur, pick, label) => (
    <div className="plg-timeline-seg" role="radiogroup" aria-label={label}>
      {items.map(([id, text]) => (
        <button key={id} type="button" role="radio" aria-checked={cur === id} className={cx("plg-timeline-seg-btn", cur === id && "is-active")} onClick={() => pick(id)}>{text}</button>
      ))}
    </div>
  );
  // Daftar (HP): zoom, "Hari ini", urut, dan kolom hanya berarti untuk Gantt → disembunyikan.
  const gantt = !v.listMode;
  // 1c-1 R23: Jadwal otomatis · Jalur kritis · Jadwalkan ulang — hanya saat mesin siap; ≤ 640 px / Live Edit → "Lainnya".
  // Jalur kritis tidak di Daftar. "Jadwalkan ulang" → v.onReschedule (Task 10; nonaktif bila tidak diberikan).
  const ac = v.engReady ? v.auto : null;
  const extras = [];
  if (ac) {
    extras.push(ac.kind === "switch"
      ? { id: "auto", text: LBL.auto, role: "menuitemcheckbox", checked: ac.on, disabled: ac.disabled, onSelect: ac.onClick }
      : { id: "auto", text: LBL.auto, role: "menuitem", haspopup: "dialog", onSelect: ac.onClick });
  }
  if (gantt && v.engReady) extras.push({ id: "crit", text: LBL.crit, role: "menuitemcheckbox", checked: v.crit, onSelect: () => v.setCrit(!v.crit) });
  if (v.engReady) extras.push({ id: "resched", text: LBL.reschedule, role: "menuitem", disabled: typeof v.onReschedule !== "function", onSelect: v.onReschedule });
  const extraBtn = (it) => {
    if (it.id === "auto" && ac.kind === "switch") {
      return <button key="auto" type="button" role="switch" aria-checked={ac.on} disabled={ac.disabled} className={cx("plg-timeline-btn", "plg-timeline-switch", ac.on && "is-on")} onClick={ac.onClick}>{LBL.auto}</button>;
    }
    if (it.id === "auto") {
      return <button key="auto" type="button" ref={v.autoBtnRef} aria-haspopup="dialog" aria-expanded={ac.expanded} className={cx("plg-timeline-btn", "plg-timeline-autobtn", ac.expanded && "is-active")} onClick={ac.onClick}>{LBL.auto}</button>;
    }
    if (it.id === "crit") return <button key="crit" type="button" className={cx("plg-timeline-btn", v.crit && "is-active")} aria-pressed={v.crit} onClick={it.onSelect}>{LBL.crit}</button>;
    return <button key={it.id} type="button" className="plg-timeline-btn" disabled={it.disabled} onClick={it.onSelect}>{it.text}</button>;
  };
  const sum = v.summary;
  return (
    <div className="plg-timeline-toolbar">
      {gantt ? seg(ZOOMS, v.zoom, v.pickZoom, LBL.zoom) : null}
      {gantt ? <button type="button" className="plg-timeline-btn" onClick={v.goToday}>{LBL.today}</button> : null}
      {extras.length && v.collapse ? <MoreMenu items={extras} /> : extras.map(extraBtn)}
      <button type="button" ref={v.calBtnRef} className={cx("plg-timeline-btn", "plg-timeline-calbtn", v.calOpen && "is-active")} aria-expanded={v.calOpen} aria-haspopup="dialog" onClick={v.toggleCal}>{LBL.calendar}</button>
      {gantt ? <button type="button" className={cx("plg-timeline-btn", v.sort === "start" && "is-active")} aria-pressed={v.sort === "start"} onClick={() => v.setSort(v.sort === "start" ? "wbs" : "start")}>{LBL.sort}</button> : null}
      {gantt && v.compact ? <button type="button" className={cx("plg-timeline-btn", v.cols && "is-active")} aria-pressed={v.cols} onClick={() => v.setCols(!v.cols)}>{LBL.cols}</button> : null}
      {v.narrow ? seg([["gantt", LBL.gantt], ["list", LBL.list]], v.mode, v.setMode, LBL.mode) : null}
      {sum && sum.end !== null ? (
        <div className="plg-timeline-toolbar-end">
          <span className="plg-timeline-finish">{"Selesai " + TLCal.fmtShort(sum.end)}</span>
          {sum.late > 0 ? <span className="plg-timeline-latechip">{sum.late + " lewat tenggat"}</span> : null}
        </div>
      ) : null}
    </div>
  );
}

// Banner R16 (K35, §7.3): satu baris `.plg-timeline-banner` per jenis di atas grafik (di luar header sticky):
// teks + tombol aksi ("Tinjau" / "Buka") + Tutup (aria-label "Tutup"). items = [{k, text, action, onAction}].
function renderBanners(items, onClose) {
  return (
    <div className="plg-timeline-banners">
      {items.map((b) => (
        <div key={b.k} className="plg-timeline-banner" role="status">
          <span className="plg-timeline-banner-text">{b.text}</span>
          <button type="button" className="plg-timeline-btn plg-timeline-banner-act" onClick={b.onAction}>{b.action}</button>
          <button type="button" className="plg-timeline-pop-close plg-timeline-banner-close" aria-label="Tutup" onClick={() => onClose(b.k)}>×</button>
        </div>
      ))}
    </div>
  );
}

function renderHead(v) {
  const { lay, colDefs, tableW, dw, chartW } = v;
  const ticks = TLLayout.headerTicks(lay.zoom, dw.fromDn, dw.toDn);
  const tick = (c, top) => (
    <div key={(top ? "t" : "b") + c.key} className={cx("plg-timeline-tick", top && "is-top")} data-sub={c.sub === null ? undefined : c.sub} style={{ left: TLLayout.xOf(c.dn, lay.range, lay.px), width: c.days * lay.px }}>{c.label}</div>
  );
  return (
    <div className="plg-timeline-head" style={{ height: HEAD_H }}>
      <div className="plg-timeline-corner" role="row" aria-rowindex={1} style={{ width: tableW }}>
        {colDefs.map((c) => (
          <div key={c.id} role="columnheader" className={cx("plg-timeline-cell", "plg-timeline-col-" + c.id)} style={{ width: c.w }}>{c.label}</div>
        ))}
      </div>
      <div className="plg-timeline-scale" aria-hidden="true" style={{ width: chartW }}>
        {ticks.top.map((c) => tick(c, true))}
        {ticks.bottom.map((c) => tick(c, false))}
      </div>
    </div>
  );
}

function renderTableRows(v) {
  const { lay, rw, rowH, colDefs, groupNames, ix, isSel, ov } = v;
  const out = [];
  for (let i = rw.first; i <= rw.last; i++) {
    const r = lay.rows[i];
    const c = rowCells(r, groupNames.get(r.group), ov.slack.get(r.key));
    const sel = !!r.task && isSel(r.task);
    out.push(
      <div key={r.key} role="row" aria-rowindex={r.index + 2} aria-selected={r.task ? sel : undefined} data-key={r.key} tabIndex={r.task ? -1 : undefined}
        className={cx("plg-timeline-row", r.kind === "group" && "is-group", r.kind === "summary" && "is-summary", sel && "is-selected")}
        style={{ top: r.index * rowH, height: rowH }}
        onClick={r.task ? (e) => ix.open(r, e) : undefined} onKeyDown={r.task ? (e) => ix.key(r, e) : undefined}>
        {colDefs.map((col) => {
          if (col.id === "name") {
            return (
              <div key="name" role="gridcell" className="plg-timeline-cell plg-timeline-col-name" style={{ width: col.w, paddingLeft: 8 + r.depth * 14 }}>
                <span className="plg-timeline-name">{c.name}</span>
                {ov.manual.has(r.key) ? renderPin() : null}
                {r.violation ? <span className="plg-timeline-warn" role="img" aria-label={MSG_VIOLATION} title={MSG_VIOLATION}>⚠</span> : null}
              </div>
            );
          }
          return <div key={col.id} role="gridcell" className={cx("plg-timeline-cell", "plg-timeline-col-" + col.id)} style={{ width: col.w }}>{c[col.id]}</div>;
        })}
      </div>
    );
  }
  return out;
}

// Ikon pin 10 px (1c-1 R19): task Manual di unit otomatis; dua lapis (duotone) dengan warna dari CSS.
function renderPin() {
  return (
    <svg className="plg-timeline-pin" role="img" aria-label={MSG_MANUAL} viewBox="0 0 10 10" width="10" height="10">
      <path className="plg-timeline-pin-head" d="M3 0.5H7V1.7L6.2 2.5V4.5L8 5.8V6.8H2V5.8L3.8 4.5V2.5L3 1.7Z" />
      <path d="M4.6 6.8H5.4V9.8H4.6Z" />
    </svg>
  );
}

// Bar / ringkasan / milestone satu baris (R11, R12, R23). Label nama di kanan bar (anak, aria-hidden).
// Task 8: bar task/milestone menerima pointerdown (ix.barDown: zona badan/tepi/titik dari TLDrag.hitZone) + pegangan tepi
// kanan (bukan milestone) dan titik dependensi di kanan ujung (desktop; CSS menyembunyikannya di layar sentuh).
// Ringkasan tidak bisa diseret dan tidak bisa jadi ujung dependensi (R10) → tanpa pointerdown.
function renderBar(r, box, y, v) {
  const { rowH, isSel } = v;
  const t = r.task;
  const sel = isSel(t);
  const crit = v.crit && v.ov.crit.has(r.key); // 1c-1 R18: garis tepi merah, bukan isi
  const title = rowCells(r).name;
  const aria = TLLayout.ariaBar(t, r.kind === "summary" ? { duration: r.duration } : r.sched, r.span, r.progress, r.kind);
  const g = barGeom(r, box, rowH);
  const common = {
    key: "b" + r.key, "data-key": r.key, role: "button", tabIndex: 0, "aria-label": aria,
    onClick: (e) => v.ix.open(r, e), onKeyDown: (e) => v.ix.key(r, e),
    onPointerDown: r.kind === "summary" || !v.ix.barDown ? undefined : (e) => v.ix.barDown(r, e),
  };
  const label = <span className="plg-timeline-label" aria-hidden="true">{title}</span>;
  const dot = <span className="plg-timeline-dot" aria-hidden="true" />;
  if (box.milestone) {
    return (
      <div {...common} className={cx("plg-timeline-milestone", r.done && "is-done", r.late > 0 && "is-late", sel && "is-selected", crit && "is-critical")}
        style={{ transform: translate(g.x, g.top), width: g.w, height: g.h }}>{label}{dot}</div>
    );
  }
  if (r.kind === "summary") {
    return (
      <div {...common} className={cx("plg-timeline-summary", r.late > 0 && "is-late", sel && "is-selected")}
        style={{ transform: translate(g.x, g.top), width: g.w, height: g.h }}>{label}</div>
    );
  }
  const pct = r.done ? 100 : Math.round(r.progress);
  return (
    <div {...common} className={cx("plg-timeline-bar", r.done && "is-done", r.late > 0 && "is-late", sel && "is-selected", crit && "is-critical")}
      style={{ transform: translate(g.x, g.top), width: g.w, height: g.h }}>
      <div className="plg-timeline-fill" style={{ width: pct + "%" }} />
      {label}
      <span className="plg-timeline-edge" aria-hidden="true" />
      {dot}
    </div>
  );
}

function renderChart(v) {
  const { lay, rw, dw, rowH, chartW, bodyH, todayDn, tableW, ix } = v;
  const R = lay.range;
  const px = lay.px;
  const c = lay.cal;
  const winX = TLLayout.xOf(dw.fromDn, R, px);
  const winW = (dw.toDn - dw.fromDn + 1) * px;
  const out = [];
  // libur (bukan akhir pekan; akhir pekan sudah diarsir gradien) dan hari kerja pengganti, hanya di kolom tampak
  for (const h of TLLayout.holidaySpans(c, dw.fromDn, dw.toDn)) {
    if (h.weekend) continue;
    out.push(<div key={"h" + h.dn} className="plg-timeline-holiday" data-dn={h.dn} title={h.name} style={{ left: TLLayout.xOf(h.dn, R, px), width: px }} />);
  }
  for (const d of c.work) {
    if (d < dw.fromDn || d > dw.toDn || c.mask.has(TLCal.isoWeekday(d))) continue;
    out.push(<div key={"w" + d} className="plg-timeline-workday" data-dn={d} style={{ left: TLLayout.xOf(d, R, px), width: px }} />);
  }
  if (todayDn !== null && todayDn >= R.from && todayDn <= R.to) {
    out.push(<div key="today" className="plg-timeline-today" style={{ left: TLLayout.xOf(todayDn, R, px) + px / 2 - 1 }} />);
  }
  for (let i = rw.first; i <= rw.last; i++) {
    const r = lay.rows[i];
    const y = r.index * rowH;
    if (r.kind === "group") {
      out.push(<div key={"g" + r.key} className="plg-timeline-band" style={{ top: y, height: rowH, left: winX, width: winW }} />);
      continue;
    }
    const box = boxOf(r, lay);
    if (!r.span && r.kind === "task") {
      // R21: tanpa jadwal → tanpa bar; petunjuk tipis saat hover (klik untuk menjadwalkan = Task 8, ix.slotDown)
      out.push(
        <div key={"s" + r.key} className="plg-timeline-slot" data-key={r.key} style={{ top: y, height: rowH, left: winX, width: winW }}
          onPointerDown={ix.slotDown ? (e) => ix.slotDown(r, e) : undefined}>
          <span className="plg-timeline-hint" style={{ left: tableW + 8, lineHeight: rowH + "px" }}>{MSG_SCHEDULE_HINT}</span>
        </div>
      );
    }
    if (box) out.push(renderBar(r, box, y, v));
    if (r.deadlineDn !== null && r.deadlineDn >= R.from && r.deadlineDn <= R.to) {
      const tip = "Tenggat " + TLCal.fmtShort(r.deadlineDn);
      out.push(<div key={"f" + r.key} className={cx("plg-timeline-flag", r.late > 0 && "is-late")} data-key={r.key} role="img" aria-label={tip} title={tip}
        style={{ left: TLLayout.xOf(r.deadlineDn + 1, R, px) - 1, top: y, height: rowH }} />);
    }
  }
  out.push(renderArrows(v, winX, winW));
  // Task 8: garis karet dependensi + tooltip seret; selalu ada, disembunyikan, diubah lewat ref (tanpa setState).
  out.push(
    <svg key="rubber" ref={ix.rubberRef} className="plg-timeline-rubber" aria-hidden="true" width={chartW} height={bodyH} style={{ display: "none" }}>
      <line ref={ix.lineRef} className="plg-timeline-rubber-line" />
    </svg>
  );
  out.push(<div key="tip" ref={ix.tipRef} className="plg-timeline-tip" aria-hidden="true" style={{ display: "none" }} />);
  return (
    <div className="plg-timeline-chart" ref={ix.chartRef} style={{ width: chartW, height: bodyH, backgroundImage: TLLayout.weekendGradient(c, R, px) }}>
      {out}
    </div>
  );
}

// Satu <svg> seukuran jendela tampak; panah digambar bila salah satu ujungnya di baris tampak (spec §8.6).
// Path memakai koordinat grafik absolut di dalam <g transform> (Task 13): saat jendela bergeser hanya transform <g> dan
// posisi svg berubah, `d` panah yang tetap tampak tidak ditulis ulang (tiap `d` baru = rekalkulasi gaya per path).
function renderArrows(v, winX, winW) {
  const { lay, rw, rowH, ov } = v;
  const oy = rw.first * rowH;
  const rect = (idx) => {
    const r = lay.rows[idx];
    const box = r ? boxOf(r, lay) : null;
    if (!box) return null;
    const h = r.kind === "summary" ? SUM_H : box.milestone ? MS_SIZE : BAR_H;
    const x = box.milestone ? box.x - MS_SIZE / 2 : box.x;
    const w = box.milestone ? MS_SIZE : box.w;
    return { x, y: idx * rowH + (rowH - h) / 2, w, h };
  };
  const inWin = (i) => i !== null && i >= rw.first && i <= rw.last;
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
    paths.push(
      <path key={id} className={cx("plg-timeline-arrow", bad && "is-violation", crit && "is-critical")} d={TLLayout.arrowPath(a, b, e.type)}
        markerEnd={bad || crit ? "url(#plg-timeline-ah-v)" : "url(#plg-timeline-ah)"} />
    );
  }
  return (
    <svg key="arrows" className="plg-timeline-arrows" aria-hidden="true" width={winW} height={Math.max(0, (rw.last - rw.first + 1) * rowH)}
      style={{ left: winX, top: oy }}>
      <defs>
        <marker id="plg-timeline-ah" viewBox="0 0 6 6" refX="5" refY="3" markerWidth="6" markerHeight="6" orient="auto">
          <path className="plg-timeline-head-path" d="M0 0L6 3L0 6z" />
        </marker>
        <marker id="plg-timeline-ah-v" viewBox="0 0 6 6" refX="5" refY="3" markerWidth="6" markerHeight="6" orient="auto">
          <path className="plg-timeline-head-path is-violation" d="M0 0L6 3L0 6z" />
        </marker>
      </defs>
      <g transform={"translate(" + -winX + " " + -oy + ")"}>{paths}</g>
    </svg>
  );
}

function renderLegend(lay, ref, crit) {
  const items = crit ? LEGEND.concat([["critical", LBL.crit]]) : LEGEND; // 1c-1 R18
  return (
    <div className="plg-timeline-foot" ref={ref}>
      <div className="plg-timeline-legend">
        {items.map(([id, text]) => (
          <span key={id} className="plg-timeline-legend-item">
            <span className={cx("plg-timeline-swatch", "is-" + id)} aria-hidden="true" />{text}
          </span>
        ))}
      </div>
      {lay.missingYears.length ? <div className="plg-timeline-note">{missingYearsNote(lay.missingYears)}</div> : null}
    </div>
  );
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

const FORM0 = Object.freeze({ d: "", n: "", err: "" });

// Popover kalender: tujuh sakelar hari, dua sakelar libur, dua daftar (libur tambahan, hari kerja pengganti).
// Tiap perubahan langsung disimpan lewat store.save (R5), berurutan (satu antrean), dan ditampilkan lebih dulu
// (optimis); bila gagal, keadaan dimuat ulang dari simpanan dan pesan galat tampil inline. Komponen berhook:
// dirender sebagai elemen, bukan dipanggil sebagai fungsi.
function CalendarPopover(props) {
  const { calId, scope, pageKind, store, onClose } = props;
  const [st, setSt] = React.useState({ data: null, pending: false, exists: false });
  const [err, setErr] = React.useState("");
  const [form, setForm] = React.useState({ off: FORM0, work: FORM0 });
  const rootRef = React.useRef(null);
  const dataRef = React.useRef(null); // kalender terkini (termasuk perubahan yang belum selesai disimpan)
  const inflight = React.useRef(0);
  const chain = React.useRef(Promise.resolve());
  const alive = React.useRef(true);
  const closeRef = React.useRef(onClose);
  closeRef.current = onClose;

  const show = (r) => {
    dataRef.current = r.data;
    setSt({ data: r.data, pending: r.pending, exists: r.exists !== false });
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
    const load = () => store.load(calId).then((r) => {
      if (alive.current && inflight.current === 0) show(r);
    }, () => {
      if (alive.current) setErr(MSG_CAL_LOAD_FAIL);
    });
    load();
    // Tarik sukses (peristiwa `pulled`, atau latch view lewat prop): muat ulang dulu, buka kunci bersama data itu.
    unlockRef.current = () => store.load(calId).then((r) => {
      if (!alive.current) return;
      if (inflight.current === 0) show(r);
      setPulledOk(true);
    }, () => {
      if (alive.current) setErr(MSG_CAL_LOAD_FAIL);
    });
    let off = null;
    try {
      // Hanya perubahan dari perangkat lain (sinkron) / kalah LWW; peristiwa lokal berasal dari simpanan kita sendiri.
      off = store.subscribe((ev) => {
        if (ev.pulled) {
          unlockRef.current();
          return;
        }
        if (inflight.current > 0) return;
        if (ev.lost.indexOf(calId) >= 0 || (ev.source === "sync" && ev.ids.indexOf(calId) >= 0)) load();
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

  const close = (restoreFocus) => {
    const f = closeRef.current;
    if (typeof f === "function") f({ restoreFocus });
  };

  // Fokus ke dialog saat dibuka; Esc menutup (fase tangkap + stopPropagation agar modal/Live Edit host di belakang tidak
  // ikut tertutup); tekan di luar menutup tanpa mencuri fokus. Tombol "Kalender kerja" menangani kliknya sendiri.
  React.useEffect(() => {
    const el = rootRef.current;
    if (el && typeof el.focus === "function") el.focus();
    if (!hasWindow()) return undefined;
    const onKey = (e) => {
      if (!e || e.key !== "Escape") return;
      if (typeof e.preventDefault === "function") e.preventDefault();
      if (typeof e.stopPropagation === "function") e.stopPropagation();
      close(true);
    };
    const onDown = (e) => {
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
  const change = (mut) => {
    const cur = dataRef.current;
    if (!cur || waitRef.current) return false;
    const next = TLCal.normalize(mut(cur));
    if (JSON.stringify(next) === JSON.stringify(cur)) return false;
    if (TLCal.byteSize(next) > CAL_MAX_BYTES) {
      setErr(MSG_CAL_TOO_LARGE);
      return false;
    }
    dataRef.current = next;
    setSt((s) => Object.assign({}, s, { data: next }));
    setErr("");
    inflight.current++;
    chain.current = chain.current
      .then(() => store.save(calId, scope, next))
      .then((r) => {
        inflight.current--;
        if (!alive.current) return;
        if (inflight.current === 0) show(r);
        else setSt((s) => Object.assign({}, s, { pending: r.pending }));
      }, (e) => {
        inflight.current--;
        if (alive.current) setErr(e && e.code === "TOO_LARGE" ? MSG_CAL_TOO_LARGE : MSG_CAL_SAVE_FAIL);
        return store.load(calId).then((r) => {
          if (alive.current && inflight.current === 0) show(r);
        }, () => {});
      })
      .catch(() => {});
    return true;
  };

  const toggleDay = (n) => change((c) => {
    const set = new Set(c.weekdays);
    if (set.has(n)) {
      if (set.size <= 1) return c; // sedikitnya satu hari kerja (normalize akan memulihkan bawaan Sen–Jum, bukan yang dimaksud)
      set.delete(n);
    } else set.add(n);
    return Object.assign({}, c, { weekdays: Array.from(set).sort((a, b) => a - b) });
  });
  const addEntry = (kind, e) => {
    if (e && typeof e.preventDefault === "function") e.preventDefault();
    const cur = dataRef.current;
    if (!cur || waitRef.current) return;
    const f = form[kind];
    const fail = (m) => setForm((s) => Object.assign({}, s, { [kind]: Object.assign({}, s[kind], { err: m }) }));
    if (!TLCal.isIso(f.d)) return fail(MSG_DATE_NEED);
    if (cur.off.some((x) => x.d === f.d) || cur.work.some((x) => x.d === f.d)) return fail(MSG_DATE_DUP);
    if (cur[kind].length >= CAL_MAX_ENTRIES) return fail(MSG_LIST_FULL);
    const entry = { d: f.d, n: clipName(f.n) };
    if (change((c) => Object.assign({}, c, { [kind]: c[kind].concat([entry]) }))) setForm((s) => Object.assign({}, s, { [kind]: FORM0 }));
  };
  const removeEntry = (kind, d) => change((c) => Object.assign({}, c, { [kind]: c[kind].filter((x) => x.d !== d) }));
  const edit = (kind, field, value) => setForm((s) => Object.assign({}, s, { [kind]: Object.assign({}, s[kind], { [field]: value, err: "" }) }));

  const cal = st.data;
  const loading = cal === null || waiting; // kontrol ubah nonaktif saat memuat atau menunggu sinkron pertama
  const list = (kind, title, addLabel, delLabel) => (
    <section className="plg-timeline-pop-sec" aria-label={title}>
      <h4 className="plg-timeline-pop-sub">{title}</h4>
      {cal && cal[kind].length ? (
        <ul className="plg-timeline-pop-list">
          {cal[kind].map((e) => (
            <li key={e.d} className="plg-timeline-pop-item">
              <span className="plg-timeline-pop-date">{dateLabel(e.d)}</span>
              <span className={cx("plg-timeline-pop-name", !e.n && "is-empty")}>{e.n || MSG_NO_NAME}</span>
              <button type="button" className="plg-timeline-pop-del" aria-label={"Hapus " + dateLabel(e.d)} title={delLabel} disabled={loading} onClick={() => removeEntry(kind, e.d)}>×</button>
            </li>
          ))}
        </ul>
      ) : null}
      <form className="plg-timeline-pop-form" aria-label={addLabel} onSubmit={(e) => addEntry(kind, e)}>
        <input type="date" className="plg-timeline-pop-input" aria-label={"Tanggal " + title.toLowerCase()} value={form[kind].d} disabled={loading}
          onChange={(e) => edit(kind, "d", e.target.value)} />
        <input type="text" className="plg-timeline-pop-input" aria-label={"Nama " + title.toLowerCase()} placeholder="Nama" maxLength={CAL_MAX_NAME} value={form[kind].n} disabled={loading}
          onChange={(e) => edit(kind, "n", e.target.value)} />
        <button type="submit" className="plg-timeline-btn" disabled={loading}>Tambah</button>
      </form>
      {form[kind].err ? <div className="plg-timeline-pop-err" role="alert">{form[kind].err}</div> : null}
    </section>
  );

  return (
    <div className="plg-timeline-pop" role="dialog" aria-label={LBL.calendar} aria-busy={loading} tabIndex={-1} ref={rootRef}>
      <div className="plg-timeline-pop-head">
        <h3 className="plg-timeline-pop-title">{LBL.calendar}</h3>
        {st.pending ? <span className="plg-timeline-pop-pending" role="status">{MSG_PENDING}</span> : null}
        <button type="button" className="plg-timeline-pop-close" aria-label="Tutup" onClick={() => close(true)}>×</button>
      </div>
      {pageKind === "workspace" ? <p className="plg-timeline-pop-note">{MSG_CAL_NOTE}</p> : null}
      {waiting ? <p className="plg-timeline-pop-note plg-timeline-pop-wait" role="status">{MSG_CAL_WAIT}</p> : null}
      <div className="plg-timeline-pop-days" role="group" aria-label="Hari kerja">
        {DAYS.map(([short, long], i) => {
          const on = !!cal && cal.weekdays.indexOf(i + 1) >= 0;
          return (
            <button key={short} type="button" className={cx("plg-timeline-pop-day", on && "is-on")} aria-pressed={on} aria-label={long}
              disabled={loading || (on && cal.weekdays.length <= 1)} onClick={() => toggleDay(i + 1)}>{short}</button>
          );
        })}
      </div>
      <label className="plg-timeline-pop-check">
        <input type="checkbox" checked={!!cal && cal.national} disabled={loading} onChange={(e) => change((c) => Object.assign({}, c, { national: !!e.target.checked }))} />
        <span>Ikuti libur nasional</span>
      </label>
      <label className="plg-timeline-pop-check">
        <input type="checkbox" checked={!!cal && cal.cutiBersama} disabled={loading} onChange={(e) => change((c) => Object.assign({}, c, { cutiBersama: !!e.target.checked }))} />
        <span>Ikuti cuti bersama</span>
      </label>
      {list("off", "Libur tambahan", "Tambah libur tambahan", "Hapus libur tambahan")}
      {list("work", "Hari kerja pengganti", "Tambah hari kerja pengganti", "Hapus hari kerja pengganti")}
      {err ? <div className="plg-timeline-pop-err" role="alert">{err}</div> : null}
    </div>
  );
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
    const onKey = (e) => {
      if (!e || e.key !== "Escape") return;
      if (typeof e.preventDefault === "function") e.preventDefault();
      if (typeof e.stopPropagation === "function") e.stopPropagation();
      fnRef.current("key");
    };
    const onDown = (e) => {
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

// Menu "Lainnya" (HP ≤ 640 px / Live Edit): items = [{id, text, role: "menuitem"|"menuitemcheckbox", checked, disabled,
// haspopup, onSelect}]. Memilih item menutup menu lalu menjalankan onSelect.
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
  const pick = (it) => {
    setOpen(false);
    if (!it.disabled && typeof it.onSelect === "function") it.onSelect();
  };
  return (
    <div className="plg-timeline-more" ref={rootRef}>
      <button type="button" className={cx("plg-timeline-btn", open && "is-active")} aria-haspopup="menu" aria-expanded={open} onClick={toggle}>{LBL.more}</button>
      {open ? (
        <div className={cx("plg-timeline-more-menu", align === "end" && "is-end")} role="menu" aria-label={LBL.more}>
          {items.map((it) => (
            <button key={it.id} type="button" role={it.role} className={cx("plg-timeline-more-item", it.checked && "is-on")}
              aria-checked={it.role === "menuitemcheckbox" ? !!it.checked : undefined} aria-haspopup={it.haspopup}
              disabled={!!it.disabled} onClick={() => pick(it)}>{it.text}</button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

// Popover workspace (R15, Q4 a): satu sakelar per kelompok project halaman. entries = [{key, label, on, locked, caption,
// onToggle}]; waiting (P3 a) → catatan "Menunggu data jadwal workspace…" (sakelar terkunci = disabled).
function UnitPopover(props) {
  const entries = Array.isArray(props.entries) ? props.entries : [];
  const rootRef = React.useRef(null);
  const closeRef = React.useRef(props.onClose);
  closeRef.current = props.onClose;
  const close = (restoreFocus) => {
    if (typeof closeRef.current === "function") closeRef.current({ restoreFocus });
  };
  React.useEffect(() => {
    const el = rootRef.current;
    if (el && typeof el.focus === "function") el.focus();
  }, []);
  useDismiss(true, rootRef, (how) => close(how === "key"), ".plg-timeline-autobtn");
  return (
    <div className="plg-timeline-pop plg-timeline-units" role="dialog" aria-label={LBL.auto} tabIndex={-1} ref={rootRef}>
      <div className="plg-timeline-pop-head">
        <h3 className="plg-timeline-pop-title">{LBL.auto}</h3>
        <button type="button" className="plg-timeline-pop-close" aria-label="Tutup" onClick={() => close(true)}>×</button>
      </div>
      {props.waiting ? <p className="plg-timeline-pop-note plg-timeline-pop-wait" role="status">{MSG_UNITS_WAIT}</p> : null}
      <ul className="plg-timeline-units-list">
        {entries.map((e) => (
          <li key={e.key} className="plg-timeline-units-item">
            <div className="plg-timeline-units-text">
              <span className="plg-timeline-units-name">{e.label}</span>
              {e.caption ? <span className="plg-timeline-units-by">{e.caption}</span> : null}
            </div>
            <button type="button" role="switch" aria-checked={e.on} aria-label={e.label} disabled={e.locked}
              className={cx("plg-timeline-switch", e.on && "is-on")} onClick={e.onToggle}>
              <span className="plg-timeline-switch-knob" aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

// Elemen yang bisa difokus di dalam dialog (fokus terjebak).
const FOCUSABLE = "button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])";
function focusables(root) {
  if (!root || typeof root.querySelectorAll !== "function") return [];
  return Array.from(root.querySelectorAll(FOCUSABLE)).filter((el) => el && !el.disabled && typeof el.focus === "function");
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
const pvLabel = (r) => [r.wbs, taskTitle(r.task)].filter((x) => x !== undefined && x !== null && x !== "").join(" · ");
function pvRowText(r) {
  const main = [pvLabel(r), (r.from ? dayText(r.from) : "—") + " → " + (r.to ? dayText(r.to) : "—")];
  if (r.deltaHk !== null && r.deltaHk !== undefined) main.push(signedHk(r.deltaHk));
  return main.join(" · ");
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
  const cancelRef = React.useRef(props.onCancel);
  cancelRef.current = props.onCancel;
  const cancel = () => {
    if (typeof cancelRef.current === "function") cancelRef.current();
  };
  React.useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;
    const doc = root.ownerDocument || null;
    const prev = doc ? doc.activeElement : null;
    const first = focusables(root)[0];
    if (first) first.focus();
    else if (typeof root.focus === "function") root.focus();
    return () => {
      if (prev && typeof prev.focus === "function") prev.focus(); // kembali ke pemicu
    };
  }, []);
  // Esc dan Tab di window (fase tangkap): klik backdrop/area lain memindah fokus ke luar dialog, jadi perangkap di elemen
  // dialog (onKeyDown) bisa lolos. Esc = Batal (propagasi dihentikan); Tab/Shift+Tab berputar di dalam dialog dan menarik
  // fokus kembali bila sedang di luar. Klik di luar dialog modal tidak menutupnya.
  React.useEffect(() => {
    if (!hasWindow() || typeof window.addEventListener !== "function") return undefined;
    const onKey = (e) => {
      if (!e) return;
      const stop = () => { if (typeof e.preventDefault === "function") e.preventDefault(); };
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

  const rows = model.rows || [];
  const shown = all ? rows : rows.slice(0, PV_ROWS_MAX);
  const label = pvLabel;
  const whyLines = (key) => {
    const out = typeof props.whyOf === "function" ? props.whyOf(key) : null;
    const arr = Array.isArray(out) ? out : out ? [out] : [];
    return arr.map((p, i) => (p && typeof p === "object" ? <strong key={i}>{p.b}</strong> : <span key={i}>{String(p)}</span>));
  };
  const canWhy = typeof props.whyOf === "function";
  // "{n} dependensi akan dilanggar": Jadwalkan ulang memberi `broken` = reschedule().broken (pelanggaran baru, penerus
  // Manual); pratinjau lain memakai model.brokenDeps (terfilter jangkauan) — keputusan T4.
  const broken = Number.isInteger(props.broken) ? props.broken : Number.isInteger(model.brokenDeps) ? model.brokenDeps : 0;
  return (
    <div className="plg-timeline-pv-backdrop">
      <div className="plg-timeline-pv" role="dialog" aria-modal="true" aria-label={props.title} tabIndex={-1} ref={rootRef}>
        <div className="plg-timeline-pop-head">
          <h3 className="plg-timeline-pop-title">{props.title}</h3>
        </div>
        {props.todayLabel ? <p className="plg-timeline-pop-note plg-timeline-pv-today">{"Hari ini: " + props.todayLabel}</p> : null}
        {props.offline ? <p className="plg-timeline-pop-note plg-timeline-pv-offline" role="note">{MSG_OFFLINE}</p> : null}
        <p className="plg-timeline-pv-summary">{pvSummaryText(model)}</p>
        {broken > 0 ? <p className="plg-timeline-pop-note plg-timeline-pv-broken" role="note">{brokenText(broken)}</p> : null}
        <ul className="plg-timeline-pv-list">
          {shown.map((r) => {
            return (
              <li key={r.key} className="plg-timeline-pv-row" data-key={r.key}>
                <span className="plg-timeline-pv-main">{pvRowText(r)}</span>
                {r.isNew ? <span className="plg-timeline-pv-tag">{PV_NEW}</span> : null}
                {r.durChanged ? <span className="plg-timeline-pv-tag">{PV_DUR}</span> : null}
                {r.durGuess ? <span className="plg-timeline-pv-note">{PV_DUR_GUESS}</span> : null}
                {canWhy ? (
                  <button type="button" className="plg-timeline-pv-why" aria-expanded={why === r.key} onClick={() => setWhy(why === r.key ? null : r.key)}>{PV_WHY}</button>
                ) : null}
                {canWhy && why === r.key ? <p className="plg-timeline-pv-whytext">{whyLines(r.key)}</p> : null}
              </li>
            );
          })}
        </ul>
        {!all && rows.length > PV_ROWS_MAX ? <button type="button" className="plg-timeline-btn plg-timeline-pv-all" onClick={() => setAll(true)}>{PV_SHOW_ALL}</button> : null}
        {model.notMoved && model.notMoved.length ? (
          <section className="plg-timeline-pv-notmoved" aria-label={PV_NOT_MOVED}>
            <h4 className="plg-timeline-pop-sub">{PV_NOT_MOVED}</h4>
            <ul className="plg-timeline-pv-list">
              {model.notMoved.map((x) => (
                <li key={x.key} className="plg-timeline-pv-row plg-timeline-pv-nm" data-key={x.key} data-why={x.why}>
                  <span className="plg-timeline-pv-nmtext">{label(x)}</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        <div className="plg-timeline-pv-actions">
          <button type="button" className="plg-timeline-btn" onClick={cancel}>{PV_CANCEL}</button>
          <button type="button" className="plg-timeline-btn plg-timeline-pv-apply" disabled={!rows.length || !!props.busy} onClick={props.onApply}>{PV_APPLY}</button>
        </div>
      </div>
    </div>
  );
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
  return (
    <div className="plg-timeline-pvcard" role="group" aria-label={PV_FLOW}>
      <p className="plg-timeline-pv-summary">{pvSummaryText(model)}</p>
      {broken > 0 ? <p className="plg-timeline-pop-note plg-timeline-pv-broken" role="note">{brokenText(broken)}</p> : null}
      <ul className="plg-timeline-pv-list">
        {rows.slice(0, PV_CARD_ROWS).map((r) => (
          <li key={r.key} className="plg-timeline-pv-row" data-key={r.key}>
            <span className="plg-timeline-pv-main">{pvRowText(r)}</span>
            {r.isNew ? <span className="plg-timeline-pv-tag">{PV_NEW}</span> : null}
            {r.durChanged ? <span className="plg-timeline-pv-tag">{PV_DUR}</span> : null}
            {r.durGuess ? <span className="plg-timeline-pv-note">{PV_DUR_GUESS}</span> : null}
          </li>
        ))}
      </ul>
      {rest > 0 ? <p className="plg-timeline-pvcard-more">{"dan " + rest + " lainnya"}</p> : null}
      <div className="plg-timeline-pv-actions">
        <button type="button" className="plg-timeline-btn" onClick={props.onCancel}>{PV_CANCEL}</button>
        <button type="button" className="plg-timeline-btn plg-timeline-pv-apply" disabled={!rows.length || !!props.busy} onClick={props.onApply}>{PV_APPLY}</button>
      </div>
    </div>
  );
}

// Tampilan Daftar (HP, U3): task terjadwal urut Mulai dikelompokkan per minggu ISO, lalu "Belum dijadwalkan".
// Baris = tombol → onTaskClick(task). `cal` disediakan untuk kelengkapan antarmuka (tanggal sudah dihitung layout).
function weekText(mon, showYear) {
  const sun = mon + 6;
  const wk = TLCal.isoWeek(mon);
  const dm = (n) => {
    const p = TLCal.fmtShort(n).split(" ");
    return { d: p[1], m: p[2], y: TLCal.iso(n).slice(0, 4) };
  };
  const a = dm(mon);
  const b = dm(sun);
  let range;
  if (a.y !== b.y && showYear) range = a.d + " " + a.m + " " + a.y + "–" + b.d + " " + b.m + " " + b.y;
  else if (a.m !== b.m || a.y !== b.y) range = a.d + " " + a.m + "–" + b.d + " " + b.m + (showYear ? " " + b.y : "");
  else range = a.d + "–" + b.d + " " + a.m + (showYear ? " " + a.y : "");
  return "Mg " + wk.week + " · " + range;
}

function listMeta(r) {
  const s = TLCal.fmtShort(r.span.s);
  const f = TLCal.fmtShort(r.span.f);
  const hk = r.duration === null || r.duration === undefined ? "" : r.duration + " hk";
  if (r.kind === "task" && r.duration === 0) return { text: s + " · Milestone", aria: s + ", milestone" };
  const text = (r.span.s === r.span.f ? s : s + " → " + f) + (hk ? " · " + hk : "");
  const aria = (r.span.s === r.span.f ? s : s + " sampai " + f) + (hk ? ", " + r.duration + " hari kerja" : "");
  return { text, aria };
}

function ListFallback(props) {
  const rows = Array.isArray(props.rows) ? props.rows : [];
  const open = (r) => {
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
      g = { mon, rows: [] };
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
  const item = (r) => {
    const title = rowCells(r, "").name;
    const meta = r.span ? listMeta(r) : null;
    const late = r.span && r.late > 0;
    const aria = title + (meta ? ", " + meta.aria : ", belum dijadwalkan") + (late ? ", lewat tenggat" : "");
    return (
      <li key={r.key} className="plg-timeline-li-item">
        <button type="button" className={cx("plg-timeline-li", r.kind === "summary" && "is-summary", r.done && "is-done")} aria-label={aria} onClick={() => open(r)}>
          <span className="plg-timeline-li-title">{title}</span>
          {meta ? <span className="plg-timeline-li-meta">{meta.text}</span> : null}
          {late ? <span className="plg-timeline-li-late" role="img" aria-label={MSG_LATE}>🏁</span> : null}
        </button>
      </li>
    );
  };
  const sec = (key, head, items) => (
    <section key={key} className="plg-timeline-li-sec" aria-label={head}>
      <h4 className="plg-timeline-li-head">{head}</h4>
      <ul className="plg-timeline-li-list">{items.map(item)}</ul>
    </section>
  );
  if (!weeks.length && !unsched.length) return <div className="plg-timeline-empty">{MSG_EMPTY}</div>;
  return (
    <div className="plg-timeline-list">
      {weeks.map((g) => sec("w" + g.mon, weekText(g.mon, showYear), g.rows))}
      {unsched.length ? sec("u", MSG_UNSCHEDULED, unsched) : null}
    </div>
  );
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
const BLOCKED = Object.freeze({ blocked: true }); // penolakan pemeriksaan sebelum tulis (bukan galat simpan)

function createInteractions() {
  const X = {
    cur: null,
    chartEl: null, // elemen grafik terpasang (callback ref; pendengar touchmove tetap)
    tipRef: { current: null },
    rubberRef: { current: null },
    lineRef: { current: null },
    g: null, // gestur seret aktif
    slot: null, // gestur klik-jadwalkan aktif
    tap: null, // ketukan sentuh terakhir pada area kosong (ketuk ganda)
    busy: new Set(), // String(task.id) dengan tulis yang sedang berjalan
    inflight: new Map(), // String(task.id) → promise tulis berjalan (selalu resolve) untuk antrean Urungkan
    after: new Map(), // String(task.id) → {stale: JSON props saat tulis, eff: nilai ext setelah tulis}
    suppress: false, // klik native setelah seret/batal tidak membuka task
  };
  const win = () => (hasWindow() && typeof window.addEventListener === "function" ? window : null);
  const keyOf = (task) => String(task.id);
  const samePointer = (g, e) => g.pointerId === undefined || e.pointerId === undefined || e.pointerId === g.pointerId;
  const isPrimary = (e) => e.button === undefined || e.button === 0;
  const prevent = (e) => { if (e && typeof e.preventDefault === "function") e.preventDefault(); };

  // Sentuh: peramban memutuskan gulir vs. tidak pada touchmove pertama yang bisa dibatalkan; pendengar yang baru dipasang
  // saat pointerdown sudah terlambat. Jadi SATU pendengar non-pasif tetap di elemen grafik selama elemen itu terpasang,
  // yang hanya memanggil preventDefault saat gestur sentuh sudah dipersenjatai (tekan lama) atau sedang menyeret.
  const onTouchMove = (e) => {
    const g = X.g;
    if (g && g.touch && (g.st.armed || g.st.phase === "drag") && e.cancelable !== false) prevent(e);
  };
  function setChart(el) {
    const old = X.chartEl;
    if (old === (el || null)) return;
    if (old && typeof old.removeEventListener === "function") old.removeEventListener("touchmove", onTouchMove, false);
    X.chartEl = el || null;
    if (el && typeof el.addEventListener === "function") el.addEventListener("touchmove", onTouchMove, { passive: false });
  }

  // Titik pointer dalam koordinat grafik (x = 0 di awal rentang; ikut gulir karena rect grafik ikut bergeser).
  function chartPt(e) {
    const el = X.chartEl;
    if (!el || typeof el.getBoundingClientRect !== "function") return null;
    const x = Number(e.clientX);
    const y = Number(e.clientY);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    const r = el.getBoundingClientRect();
    return { x: x - (Number(r.left) || 0), y: y - (Number(r.top) || 0) };
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
    const { lay, rowH } = X.cur;
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
    if (a && a.stale === pj) return { eff: a.eff, pj };
    if (a) X.after.delete(keyOf(task));
    return { eff: props, pj };
  }
  const schedOf = (raw) => Object.assign(TLSched.readSched(raw), { raw });
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
    return Promise.resolve()
      .then(() => api.data.tasks.list({ includeDone: true }))
      .then((l) => (Array.isArray(l) ? l : []));
  }

  // Induk di daftar lengkap = ringkasan (R10): jadwalnya mengikuti subtask, tidak boleh digeser/diubah/dijadwalkan di 1b.
  // Resolve true = boleh tulis; false = ditolak (toast sudah tampil); reject = daftar gagal dimuat (tanpa tulis).
  function summaryGate(task) {
    const api = X.cur.api;
    return fullList().then((list) => {
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
    X.after.set(k, { stale: rr.pj, eff: Object.assign({}, rr.eff, patch) });
    const send = () => {
      try {
        return many ? api.taskExt.setMany([{ taskId: task.id, patch }]) : api.taskExt.set(task.id, patch);
      } catch (e) {
        return Promise.reject(e);
      }
    };
    const p = gate ? Promise.resolve(gate).then((ok) => {
      if (!ok) throw BLOCKED;
      return send();
    }) : send();
    const done = Promise.resolve(p).then(() => {
      X.busy.delete(k);
    }, (err) => {
      X.busy.delete(k);
      X.after.delete(k);
      throw err;
    });
    const settled = done.then(() => undefined, () => undefined);
    X.inflight.set(k, settled);
    settled.then(() => { if (X.inflight.get(k) === settled) X.inflight.delete(k); });
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
    const list = (Array.isArray(items) ? items : []).filter((it) => it && it.task && it.patch);
    const keys = [];
    for (const it of list) {
      const k = keyOf(it.task);
      const rr = rawOf(it.task);
      keys.push(k);
      X.busy.add(k);
      X.after.set(k, { stale: rr.pj, eff: Object.assign({}, rr.eff, it.patch) });
    }
    const send = () => {
      try {
        return api.taskExt.setMany(list.map((it) => ({ taskId: it.task.id, patch: it.patch })));
      } catch (e) {
        return Promise.reject(e);
      }
    };
    const p = gate ? Promise.resolve(gate).then((ok) => {
      if (!ok) throw BLOCKED;
      return send();
    }) : send();
    const done = Promise.resolve(p).then((r) => {
      for (const k of keys) X.busy.delete(k);
      return r;
    }, (err) => {
      for (const k of keys) {
        X.busy.delete(k);
        X.after.delete(k);
      }
      throw err;
    });
    const settled = done.then(() => undefined, () => undefined);
    for (const k of keys) X.inflight.set(k, settled);
    settled.then(() => { for (const k of keys) if (X.inflight.get(k) === settled) X.inflight.delete(k); });
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
      issueMany(u.map((x, i) => ({ task: items[i].task, patch: x.patch }))).catch((err) => failed(api, err));
    };
    return { label: MSG_UNDO, onClick: run };
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
    const list = (Array.isArray(items) ? items : []).filter((it) => it && it.task && it.patch);
    const n = list.length;
    const after = () => (typeof o.onDone === "function" ? Promise.resolve().then(o.onDone) : Promise.resolve());
    if (!n) return after().then(() => true, (err) => { failed(api, err); return false; });
    return issueMany(list, o.gate).then(() => after().then(() => {
      toastSafe(api, typeof o.text === "string" ? o.text : appliedText(n), "success", undoAction(api, list));
      return true;
    }, (err) => {
      logWarn(api, "jadwal tersimpan, langkah lanjutan gagal:", err);
      toastSafe(api, MSG_SAVE_FAIL, "error", undoAction(api, list));
      return false;
    }), (err) => {
      if (err === BLOCKED) return false; // pemeriksaan sebelum tulis menolak (toast sudah tampil), 0 tulis
      const ids = err && Array.isArray(err.applied) ? new Set(err.applied.map(String)) : null;
      const saved = ids ? list.filter((it) => ids.has(String(it.task.id))) : [];
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
      toastSafe(api, MSG_CHANGED, "success", { label: MSG_UNDO, onClick: () => undo(task, prev) });
      return true;
    }, (err) => {
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
    issue(task, rawOf(task), prev, true).catch((err) => failed(api, err));
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
    const ctx = Object.assign({}, eng.ctx, { readExt: peekRaw });
    const before = pendingIn(ctx.tasks) ? engine.run(ctx) : eng.result;
    const g = TLPlan.gesture(before, task, rr.eff, patch, ctx.cal);
    if (!g.ok) {
      toastSafe(api, MSG_EARLY, "error");
      return Promise.resolve(false);
    }
    const gestures = [{ task, patch: g.patch }];
    const c = TLPlan.cascade(ctx, gestures, before);
    const items = flowItems(c.items);
    if (!items.length) return Promise.resolve(false);
    if (items.some((it) => X.busy.has(it.key))) return Promise.resolve(false);
    const down = items.filter((it) => it.key !== k).length;
    if (!down) {
      const it = items[0];
      const san = TLSched.sanitizePatch(patch);
      if (canonJson(it.patch) === canonJson(san.ok ? san.patch : patch)) return write(task, rr, patch, prev, checked);
      return write(task, rr, it.patch, TLPlan.undoItems([it])[0].patch, checked);
    }
    if (down > TLPlan.CASCADE_MAX) {
      if (typeof X.cur.openPreview === "function") X.cur.openPreview({ items, result: c.result, before, ctx, gestures });
      return Promise.resolve(false);
    }
    return applyPlan(items, { gate: checked ? null : summaryGate(task), text: flowText(down) });
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
    setTimeout(() => { X.suppress = false; }, 0); // klik native menyusul pointerup dalam tugas yang sama
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
    const zone = TLDrag.hitZone({ x: pt.x, barLeft: box.x, barWidth: box.milestone ? 0 : box.w, touch, armed: false });
    if (!zone) return;
    const kind = zone === "edge" ? "resize" : zone === "dot" ? "link" : "move";
    const rr = rawOf(row.task);
    const sched = schedOf(rr.eff);
    const st = TLDrag.start({ kind, row, sched, pointer: pt, touch, t: nowMs(), px: lay.px });
    const s0 = TLCal.dn(sched.start);
    const geo = barGeom(row, box, cur.rowH);
    // x tanpa pangkas rentang (bar yang terpotong di awal rentang bergeser dari posisi sebenarnya)
    const xs = Number.isInteger(s0) ? TLLayout.xOf(s0, lay.range, lay.px) + (geo.ms ? lay.px / 2 - MS_SIZE / 2 : 0) : geo.x;
    const el = e.currentTarget && e.currentTarget.style ? e.currentTarget : null;
    X.g = { st, row, rr, box, geo, xs, el, painted: null, raf: 0, hold: 0, off: null, touch, pointerId: e.pointerId };
    listen(X.g);
    if (touch && !st.locked) X.g.hold = setTimeout(onHold, TLDrag.LONG_PRESS_MS);
  }

  function listen(g) {
    const w = win();
    if (!w) return;
    const move = (e) => onMove(e);
    const up = (e) => onUp(e);
    const cancel = () => { if (X.g) finish(TLDrag.reduce(X.g.st, { type: "cancel" })); };
    const key = (e) => {
      if (e.key !== "Escape" && e.key !== "Esc") return;
      prevent(e);
      if (typeof e.stopPropagation === "function") e.stopPropagation(); // Esc tidak menutup modal/Live Edit host
      cancel();
    };
    // sentuh: touchmove dicegah oleh pendengar tetap di elemen grafik (setChart); di sini hanya menu konteks tekan lama.
    const ctxm = (e) => prevent(e);
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
    const zone = TLDrag.hitZone({ x: g.st.x0, barLeft: g.box.x, barWidth: g.box.milestone ? 0 : g.box.w, touch: true, armed: true });
    g.st = TLDrag.reduce(g.st, { type: "hold", t: Math.max(nowMs(), g.st.t0 + TLDrag.LONG_PRESS_MS), kind: zone === "edge" ? "resize" : undefined });
  }

  function onMove(e) {
    const g = X.g;
    if (!g || !samePointer(g, e)) return;
    const pt = chartPt(e);
    if (!pt) return;
    let st = TLDrag.reduce(g.st, { type: "move", x: pt.x, y: pt.y, t: nowMs() });
    if (st.kind === "link" && st.phase === "drag") st = TLDrag.reduce(st, { type: "over", rowKey: rowKeyAt(pt.y) });
    g.st = st;
    if (st.phase === "scroll" || st.phase === "cancelled") {
      finish(st);
      return;
    }
    if (st.phase !== "drag") return;
    if (e.cancelable !== false) prevent(e);
    if (!g.raf) g.raf = raf(() => { g.raf = 0; paint(g); });
  }

  function onUp(e) {
    const g = X.g;
    if (!g || !samePointer(g, e)) return;
    const pt = chartPt(e);
    let st = g.st;
    if (pt && st.kind === "link" && st.phase === "drag") st = TLDrag.reduce(st, { type: "over", rowKey: rowKeyAt(pt.y) });
    st = TLDrag.reduce(st, { type: "up", x: pt ? pt.x : undefined, inside: insideChart(e), t: nowMs() });
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
    flow(g.row.task, g.rr, res.patch, res.prev).then((ok) => { if (!ok) restore(g); });
  }

  // Dependensi baru (R15): kunci baris → task lewat indeks halaman; ringkasan tampak/di luar rentang ditolak seketika.
  // Lalu checkLink (sama dengan seksi Jadwal) terhadap daftar task LENGKAP — layout dibangun dari scopeTasks yang sudah
  // difilter panel host, jadi edge ke task tersembunyi (siklus) dan anak tersembunyi (ringkasan) hanya terlihat di sana.
  // Selama pemeriksaan penerus ditandai sibuk (satu penautan per penerus). Dependensi lama ditulis ulang apa adanya.
  function link(l) {
    const { api, lay } = X.cur;
    const scope = lay.rows.filter((r) => r.task).map((r) => r.task);
    const idx = TLSched.buildIndex(scope);
    const pred = idx.get(String(l.pred));
    const succ = idx.get(String(l.succ));
    if (!pred || !succ) return;
    const succRow = lay.rows.find((r) => r.task === succ);
    if (!succRow) return;
    if (succRow.kind === "summary") {
      toastSafe(api, MSG_SUMMARY_DEP, "error");
      return;
    }
    const k = keyOf(succ);
    if (succRow.outOfRange || X.busy.has(k)) return;
    X.busy.add(k);
    const run = fullList().then((list) => {
      X.busy.delete(k);
      const rr = rawOf(succ);
      const chk = checkLink(api, list, pred, succ, (t, isSucc) => (isSucc ? rr.eff : peekRaw(t)));
      if (!chk.ok) {
        if (LINK_MSG[chk.reason]) toastSafe(api, LINK_MSG[chk.reason], "error");
        return undefined;
      }
      const prev = { deps: rr.eff.deps === undefined ? null : rr.eff.deps };
      return flow(succ, rr, { deps: chk.deps }, prev, true);
    }, (err) => {
      X.busy.delete(k);
      failed(api, err);
    });
    // Urungkan pada penerus yang sama menunggu pemeriksaan + tulis ini (antrean yang sama dengan issue)
    const settled = run.then(() => undefined, () => undefined);
    X.inflight.set(k, settled);
    settled.then(() => { if (X.inflight.get(k) === settled) X.inflight.delete(k); });
  }

  // ---- klik-jadwalkan (R21): klik (mouse) / ketuk ganda (sentuh) di area kosong baris tanpa jadwal ----
  function slotDown(row, e) {
    if (!e || X.g || X.slot || !row || !row.task || !isPrimary(e)) return;
    const pt = chartPt(e);
    const w = win();
    if (!pt || !w) return;
    const s = { row, pt, x: Number(e.clientX), y: Number(e.clientY), touch: e.pointerType === "touch", pointerId: e.pointerId, off: null };
    const up = (ev) => slotUp(s, ev);
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
      X.tap = { key: s.row.key, t, x: s.x, y: s.y };
      if (!last || last.key !== s.row.key || t - last.t > DOUBLE_TAP_MS || Math.hypot(s.x - last.x, s.y - last.y) > DOUBLE_TAP_PX) return;
      X.tap = null;
    }
    const { lay } = X.cur;
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
    if (!e.altKey || (e.key !== "ArrowLeft" && e.key !== "ArrowRight")) return;
    prevent(e); // Alt+← = "kembali" di peramban
    if (!row || !row.task || row.kind !== "task" || X.g) return;
    if (X.busy.has(keyOf(row.task))) return; // tombol ditahan: abaikan selama tulis sebelumnya belum selesai
    const rr = rawOf(row.task);
    const r = TLDrag.keyStep({ key: e.key, alt: true, shift: !!e.shiftKey }, schedOf(rr.eff), X.cur.lay.cal);
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
    const lost = !active || active === doc.body || (from && from.isConnected === false && active === from);
    if (!lost) return;
    const root = X.cur && X.cur.scrollEl();
    if (!root || typeof root.querySelectorAll !== "function") return;
    const role = from && typeof from.getAttribute === "function" ? from.getAttribute("role") : null;
    const list = root.querySelectorAll("[data-key]");
    for (let i = 0; i < list.length; i++) {
      const n = list[i];
      if (n.getAttribute("data-key") !== String(key) || (role && n.getAttribute("role") !== role)) continue;
      try {
        n.focus({ preventScroll: true });
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
    if (X.g) finish(TLDrag.reduce(X.g.st, { type: "cancel" }));
    if (X.slot) slotEnd(X.slot);
    X.tap = null;
    setChart(null);
  }

  X.ix = {
    open, key, barDown, slotDown,
    chartRef: setChart, tipRef: X.tipRef, rubberRef: X.rubberRef, lineRef: X.lineRef,
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
  const un = useUnits(api, { pageKind, listId: context.listId, projectName: context.projectName });
  const eng = useEngine(api, { scopeTasks: context.scopeTasks, calData: cal.data, units: un.units });

  // R24: tata letak hanya bila task scope / kalender / zoom / urut / hari berubah (bukan tiap context baru).
  const lay = React.useMemo(() => engine.layout({
    tasks: Array.isArray(context.scopeTasks) ? context.scopeTasks : [],
    pageKind, sort, cal: cal.data, today, zoom,
    readSchedOf: (t) => {
      try {
        return TLSched.readSched(api.taskExt.read(t));
      } catch (e) {
        return TLSched.readSched({});
      }
    },
  }), [context.scopeTasks, calKey, zoom, sort, today, pageKind, api]);
  const groupNames = React.useMemo(() => new Map(lay.groups.map((g) => [g.key, g.name])), [lay]);
  // 1c-1 (R18, R19): overlay mesin dalam memo TERPISAH — `lay` tidak bergantung pada mesin. Belum siap → NO_OVERLAY.
  // eng.ctx berasal dari keluaran run yang sama dengan eng.result, jadi kunci [lay, engResult] cukup.
  const engResult = eng.status === "ready" ? eng.result : null;
  const ov = React.useMemo(() => engineOverlay(lay, engResult, eng.ctx), [lay, engResult]);
  const crit = critPref === true && ov.ready;

  const compact = narrow || !!context.liveEdit;
  const colDefs = !compact || cols ? COLS_FULL : COLS_COMPACT;
  let tableW = 0;
  for (const c of colDefs) tableW += c.w;
  const rowH = touch ? TLLayout.ROW_H_TOUCH : TLLayout.ROW_H;
  const hasRows = lay.stats.tasks > 0;
  const listMode = narrow && mode === "list";

  // Jendela tampak (R11): top/left hanya diperbarui saat baris pertama / jangkar kolom (½ layar) berubah.
  const [vp, setVp] = React.useState({ top: 0, left: null, w: VIEW_W0, h: VIEW_H0, boxH: VIEW_H0 + HEAD_H });
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
    setVp((p) => (p.left === quantLeft(left, p.w) ? p : Object.assign({}, p, { left: quantLeft(left, p.w) })));
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
    setVp((p) => (p.boxH === boxH && p.w === w ? p : Object.assign({}, p, { boxH, h: Math.max(0, boxH - HEAD_H), w })));
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
    setVp((p) => {
      const ql = quantLeft(left, p.w);
      return p.top === top && p.left === ql ? p : Object.assign({}, p, { top, left: ql });
    });
  });

  React.useLayoutEffect(() => {
    if (!scrollRef.current || !hasWindow()) return undefined;
    measure();
    let id = 0;
    const onResize = () => {
      if (id) return;
      id = raf(() => { id = 0; measure(); });
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
    if (anchor !== null) applyLeft(el, TLLayout.xOf(anchor, lay.range, lay.px) + lay.px / 2 - vp.w / 2);
    else if (!userScrolledRef.current) applyLeft(el, TLLayout.initialScrollLeft(lay.range, lay.px, today, vp.w));
    else if (prev && (prev.px !== lay.px || prev.range.from !== lay.range.from)) {
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
      setVp((p) => {
        const ql = quantLeft(left, p.w);
        if (p.top === top && p.left === ql) return p;
        return Object.assign({}, p, { top, left: ql });
      });
    });
  };

  const pickZoom = (z) => {
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
  const isSel = (t) => {
    try {
      return typeof context.isSelected === "function" && !!context.isSelected(t);
    } catch (e) {
      return false;
    }
  };
  const ctlRef = React.useRef(null);
  if (!ctlRef.current) ctlRef.current = createInteractions();
  const ctl = ctlRef.current;
  ctl.cur = { api, context, lay, rowH, tableW, scrollEl: () => scrollRef.current, eng, units: un };
  React.useEffect(() => () => ctl.dispose(), [ctl]);
  const ix = ctl.ix;

  // ── 1c-1 Task 8: sakelar Jadwal otomatis (R15), pratinjau + CAS (R14) ──
  const [unitOpen, setUnitOpen] = React.useState(false);
  const [pv, setPv] = React.useState(null); // {id, title, items, model, busy, unit?: {unit, rep, snap} | Array<{rep, snap, auto}>, broken?, todayLabel?, onDone, rebuild}
  const [, setNet] = React.useState(0);
  const autoBtnRef = React.useRef(null);
  const pvRef = React.useRef(null);
  pvRef.current = pv;
  const engRef = React.useRef(eng);
  engRef.current = eng;
  const toggling = React.useRef(false);
  const pvSeq = React.useRef(0);
  const unitPage = { pageKind, listId: pageKind === "workspace" ? context.listId : null, projectName: pageKind === "workspace" ? null : context.projectName };
  const summary = React.useMemo(() => toolbarSummary(lay, engResult), [lay, engResult]);
  const offline = !!(api.env && api.env.online === false);
  // Catatan offline di dialog mengikuti event host app.online/app.offline selama dialog terbuka.
  React.useEffect(() => {
    if (!pv) return undefined;
    const offs = [];
    try {
      for (const ev of ["app.online", "app.offline"]) offs.push(api.events.on(ev, () => setNet((x) => x + 1)));
    } catch (e) {
      logWarn(api, "pendengar online gagal:", e);
    }
    return () => { for (const off of offs) if (typeof off === "function") off(); };
  }, [!pv]);

  const userId = () => (api.env ? api.env.userId : null);
  const wbsOfPage = () => {
    const m = new Map(lay.rows.map((r) => [r.key, r.wbs]));
    return (key) => (m.has(key) ? m.get(key) : null);
  };
  // Pratinjau sakelar ON atas ctx: item TLPlan.toggleUnit; "sebelum" = hasil useEngine (tanpa run tambahan);
  // seedKeys = simpul unit agar lingkaran/jangkar bertabrakan unit tercantum di "Tidak dipindah" (K34).
  const buildToggle = (ctx, before, recId) => {
    const t = TLPlan.toggleUnit(ctx, recId, true);
    if (!t.items.length || !t.result) return { items: [], model: null };
    const seed = new Set();
    for (const [k, n] of t.result.nodes) if (n.g === recId) seed.add(k);
    const pm = TLPlan.preview(t.items, t.result, ctx, before, seed);
    const wbs = wbsOfPage();
    return { items: t.items, model: pm ? dialogModel(pm, t.result, wbs) : null, whyOf: planWhy(t.result, ctx, t.items, wbs) };
  };
  const setAutoNow = (entry, on) => {
    toggling.current = true;
    return Promise.resolve()
      .then(() => un.store.setAuto(entry.unit, on, userId()))
      .then(() => toastSafe(api, on ? MSG_AUTO_ON0 : MSG_AUTO_OFF, "success"), (err) => {
        logWarn(api, "unit jadwal gagal disimpan:", err);
        toastSafe(api, MSG_SAVE_FAIL, "error");
      })
      .then(() => { toggling.current = false; });
  };
  const toggleEntry = (entry) => {
    const e = engRef.current;
    if (entry.locked || toggling.current || pvRef.current || e.status !== "ready" || !e.ctx || !e.result) return;
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
    setPv({
      id: ++pvSeq.current,
      title: MSG_PV_ON + entry.label,
      items: b.items, model: b.model, busy: false, whyOf: b.whyOf,
      unit: { unit: entry.unit, rep: entry.rep, snap: entry.snap },
      onDone: () => un.store.setAuto(entry.unit, true, uid), // setMany dulu; setAuto hanya setelah sukses
      rebuild: (ctx2, before, units) => Object.assign(buildToggle(ctx2, before, recId), { unit: { unit: entry.unit, rep: entry.rep, snap: unitSnap(TLSched.unitFor(units, entry.rep)) } }),
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
    return { items, model: pm ? dialogModel(pm, c.result, wbs) : null, whyOf: planWhy(c.result, ctx, items, wbs) };
  };
  const openFlowPv = (p) => {
    if (pvRef.current) return; // satu dialog pada satu waktu
    const b = buildFlow(p.ctx, p.before, p.gestures, { items: p.items, result: p.result });
    if (!b.model) return;
    setUnitOpen(false);
    setCalOpen(false); // satu Esc = dialog saja
    const next = {
      id: ++pvSeq.current, title: PV_FLOW, items: b.items, model: b.model, busy: false, whyOf: b.whyOf,
      rebuild: (ctx2, before2) => buildFlow(ctx2, before2, p.gestures),
    };
    pvRef.current = next;
    setPv(next);
  };
  ctl.cur.openPreview = openFlowPv;
  // Buka pratinjau milik view (Task 10) bila belum ada dialog; popover lain ditutup (satu Esc = dialog saja).
  const openPv = (spec) => {
    if (pvRef.current) return;
    setUnitOpen(false);
    setCalOpen(false);
    const next = Object.assign({ id: ++pvSeq.current, busy: false }, spec);
    pvRef.current = next;
    setPv(next);
  };
  // Task 10 (R16): "Tinjau" — item = TLPlan.diff dibatasi drift halaman (bannerInfo). Menulis Mulai = ES tidak mengubah
  // hasil mesin (simpul otomatis non-jangkar), jadi "sebelum" = "sesudah" = result: tanpa run tambahan, tanpa pelanggaran
  // baru. Hitung ulang setelah CAS: mesin dijalankan atas data terbaru (drift lama tidak dipakai).
  // Potret unit halaman untuk CAS (ruling 4): updatedAt/by dari useUnits() terbaru (`live`), `auto` = mode yang dipakai
  // rencana (`plan` = ctx.units mesin). Anggota lain mematikan/menyalakan Otomatis saat dialog terbuka → Terapkan ditolak.
  const pageSnaps = (plan, live) => pageUnits(lay, pageKind, context.projectName, groupNames).map((x) => ({
    rep: x.rep, snap: unitSnap(TLSched.unitFor(live, x.rep)), auto: unitAuto(TLSched.unitFor(plan, x.rep)),
  }));
  const freshSnaps = (ctx2, units) => pageSnaps(ctx2.units, units instanceof Map ? units : ctx2.units);
  const buildReview = (ctx, result) => {
    const keys = new Set(bannerInfo(result, context.scopeTasks).drift);
    const items = flowItems(TLPlan.diff(result, ctx, keys));
    const pm = TLPlan.preview(items, result, ctx, result);
    const wbs = wbsOfPage();
    return { items, model: pm ? dialogModel(pm, result, wbs) : EMPTY_PV_MODEL, whyOf: planWhy(result, ctx, items, wbs) };
  };
  const openReview = () => {
    const e = engRef.current;
    if (e.status !== "ready" || !e.ctx || !e.result) return;
    const b = buildReview(e.ctx, e.result);
    openPv({
      title: PV_FLOW, items: b.items, model: b.model, whyOf: b.whyOf, unit: pageSnaps(e.ctx.units, un.units),
      rebuild: (ctx2, before2, units) => Object.assign(buildReview(ctx2, engine.run(ctx2)), { unit: freshSnaps(ctx2, units) }),
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
    return { items, broken: r.broken, model: pm ? dialogModel(pm, r.result, wbs) : EMPTY_PV_MODEL, whyOf: r.result ? planWhy(r.result, ctx, items, wbs) : undefined };
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
    const unitKeys = new Set(pageUnits(lay, pageKind, context.projectName, groupNames).map((x) => x.unit.recId));
    const b = buildResched(e.ctx, e.result, T, unitKeys);
    openPv({
      title: PV_RESCHED, items: b.items, model: b.model, broken: b.broken, whyOf: b.whyOf, todayLabel: TLCal.fmtShort(td),
      unit: pageSnaps(e.ctx.units, un.units),
      rebuild: (ctx2, before2, units) => Object.assign(buildResched(ctx2, engine.run(ctx2), T, unitKeys), { unit: freshSnaps(ctx2, units) }),
    });
  };
  // Banner R16: dihitung sekali per hasil mesin / scopeTasks (bukan tiap render); disembunyikan sebelum mesin siap.
  const banner = React.useMemo(() => bannerInfo(engResult, context.scopeTasks), [engResult, context.scopeTasks]);
  const [, setClosed] = React.useState(0);
  const closeBanner = (k) => {
    BANNER_CLOSED.add(k);
    setClosed((x) => x + 1);
  };
  const banners = [];
  if (engResult && banner.drift.length) {
    const k = bannerKey(page, "drift", banner.drift.length);
    if (!BANNER_CLOSED.has(k)) banners.push({ k, text: driftText(banner.drift.length), action: BANNER_REVIEW, onAction: openReview });
  }
  if (engResult && banner.cycle.length) {
    const k = bannerKey(page, "cycle", banner.cycle.length);
    const first = banner.first;
    const open = () => {
      if (typeof context.onTaskClick === "function") context.onTaskClick(first);
    };
    if (!BANNER_CLOSED.has(k)) banners.push({ k, text: banner.cycleText, action: BANNER_OPEN, onAction: open });
  }
  const bannerEl = banners.length ? renderBanners(banners, closeBanner) : null;
  // Terapkan (R14): muat ulang daftar lengkap (+ unit) → TLPlan.revalidate (nilai mentah) dan, untuk sakelar, potret
  // updatedAt/by unit. Berbeda → toast + hitung ulang dari data terbaru (Terapkan perlu ditekan lagi), 0 tulis.
  const applyPv = () => {
    const cur = pvRef.current;
    if (!cur || cur.busy) return;
    const live = () => pvRef.current && pvRef.current.id === cur.id;
    const busyPv = Object.assign({}, cur, { busy: true });
    pvRef.current = busyPv; // seketika: klik ganda sebelum render berikutnya tidak memicu setMany kedua
    setPv(busyPv);
    const listP = Promise.resolve().then(() => api.data.tasks.list({ includeDone: true }));
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
        const ctx2 = { tasks: scopeFilter(list, context.scopeTasks), cal: base.cal, units: units instanceof Map ? units : base.units, readExt: base.readExt || ((t) => readExtSafe(api, t)) };
        const next = cur.rebuild(ctx2, e.result, units);
        setPv(Object.assign({}, cur, next, { busy: false, model: next.model || EMPTY_PV_MODEL }));
        return;
      }
      setPv(null);
      ctl.applyPlan(cur.items, { onDone: cur.onDone });
    }).catch((err) => {
      logWarn(api, "pratinjau gagal diperiksa:", err);
      toastSafe(api, MSG_SAVE_FAIL, "error");
      if (live()) setPv(Object.assign({}, cur, { busy: false }));
    });
  };

  // Entri unit halaman (urutan kelompok) dengan keadaan sakelar, kunci P3 (a), dan keterangan "Dinyalakan oleh …".
  const unitsEntries = pageUnits(lay, pageKind, context.projectName, groupNames).map((x) => {
    const u = TLSched.unitFor(un.units, x.rep);
    // P3 (a), pola ADR-042 #12: catatan tunggu hanya setelah muat pertama selesai (unit tanpa record lokal, belum ada
    // tarik sukses); selama memuat sakelar nonaktif tanpa catatan.
    const waiting = un.loaded && pageKind === "workspace" && !(u && u.exists) && !un.pulled;
    const locked = !un.loaded || waiting;
    const entry = { key: x.unit.recId, label: x.label, unit: x.unit, rep: x.rep, on: !!(u && u.auto === true), locked, waiting, snap: unitSnap(u), caption: unitCaption(u, context, userId()) };
    entry.onToggle = () => toggleEntry(entry);
    return entry;
  });
  const pageEntry = pageKind === "workspace" ? null : unitsEntries[0];
  const auto = pageEntry
    ? { kind: "switch", on: pageEntry.on, disabled: pageEntry.locked, onClick: pageEntry.onToggle }
    : { kind: "popover", expanded: unitOpen, onClick: () => { setCalOpen(false); setUnitOpen(!unitOpen); } };

  const toolbar = renderToolbar({
    zoom, pickZoom, goToday, sort, setSort, compact, cols, setCols, narrow, mode, setMode, listMode,
    engReady: ov.ready, crit, setCrit, calOpen, toggleCal: () => { setUnitOpen(false); setCalOpen(!calOpen); }, calBtnRef,
    auto, autoBtnRef, collapse: compact, summary, onReschedule: openResched,
  });
  // Popover berhook → elemen (bukan panggilan fungsi). key = id kalender: pindah halaman memasang ulang. Esc / tombol tutup
  // mengembalikan fokus ke tombol "Kalender kerja"; klik di luar tidak (fokus sudah pindah ke target klik).
  const closeCal = (how) => {
    setCalOpen(false);
    const b = calBtnRef.current;
    if (how && how.restoreFocus && b && typeof b.focus === "function") b.focus();
  };
  const popover = calOpen
    ? <CalendarPopover key={target.id} calId={target.id} scope={target.scope} pageKind={pageKind} store={cal.store} pulled={cal.pulled} onClose={closeCal} />
    : null;
  // Popover unit workspace (R15): Esc / tombol tutup mengembalikan fokus ke "Jadwal otomatis"; klik luar tidak.
  const closeUnits = (how) => {
    setUnitOpen(false);
    const b = autoBtnRef.current;
    if (how && how.restoreFocus && b && typeof b.focus === "function") b.focus();
  };
  const unitPop = unitOpen && pageKind === "workspace" && ov.ready
    ? <UnitPopover entries={unitsEntries} waiting={unitsEntries.some((e) => e.waiting)} onClose={closeUnits} />
    : null;
  const top = <div className="plg-timeline-top">{toolbar}{popover}{unitPop}</div>;
  const dialog = pv && pv.model
    ? <PreviewDialog key={pv.id} title={pv.title} model={pv.model} offline={offline} todayLabel={pv.todayLabel} broken={pv.broken} busy={pv.busy} whyOf={pv.whyOf} onApply={applyPv} onCancel={cancelPv} />
    : null;

  if (!hasRows) {
    return (
      <div className="plg-timeline">
        {top}
        <div className="plg-timeline-empty">{MSG_EMPTY}</div>
        {dialog}
      </div>
    );
  }
  if (listMode) {
    return (
      <div className="plg-timeline">
        {top}
        {bannerEl}
        {ListFallback({ rows: lay.rows, cal: lay.cal, onTaskClick: context.onTaskClick })}
        {dialog}
      </div>
    );
  }
  const v = { lay, rw, dw, rowH, colDefs, tableW, chartW, bodyH, todayDn, groupNames, ix, isSel, ov, crit };
  return (
    <div className={cx("plg-timeline", compact && "is-compact")}>
      {top}
      {bannerEl}
      <div className="plg-timeline-scroll" ref={scrollRef} onScroll={onScroll} role="grid" aria-label="Timeline" aria-rowcount={lay.rows.length + 1}
        style={{ height: vp.boxH }}>
        {renderHead(v)}
        <div className="plg-timeline-body" style={{ height: bodyH }}>
          <div className="plg-timeline-table" style={{ width: tableW, height: bodyH }}>
            {renderTableRows(v)}
          </div>
          {renderChart(v)}
        </div>
      </div>
      {renderLegend(lay, footRef, crit)}
      {dialog}
    </div>
  );
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
const SEC_TIMING = { startDebounceMs: 700 };

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
  const { result, node, wbs } = eng;
  const nameOf = (key) => {
    const n = result.nodes.get(key);
    return n ? secWbsLabel(wbs, n.task) : key;
  };
  const cap = (a) => (a.length > SEC_LINK_MAX ? a.slice(0, SEC_LINK_MAX).concat(["…"]) : a);
  const preds = (result.pred.get(node.key) || []).map((p) => nameOf(p.key) + secLagText(p.lag));
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
  unscheduled: "Belum dijadwalkan.",
};
const WHY_LIST_MAX = 6;
const WHY_WEEKEND = "Sab–Min";
const WHY_DAY = { Sabtu: "Sabtu", Minggu: "Minggu" };

// Hari {dn, why, name?} (urut naik) → kelompok sebutan [{label, n}]: Sabtu+Minggu berurutan = satu kelompok; libur/cuti
// berurutan dengan nama sama = satu kelompok; selain itu per hari. Lebih dari satu kelompok akhir pekan → diberi tanggal.
function whyGroups(days) {
  const list = days.slice().sort((a, b) => a.dn - b.dn);
  const groups = [];
  for (const x of list) {
    const last = groups[groups.length - 1];
    const prev = last ? last.days[last.days.length - 1] : null;
    const next = !!prev && x.dn === prev.dn + 1;
    if (next && last.kind === "wk" && prev.why === "Sabtu" && x.why === "Minggu" && last.days.length === 1) last.days.push(x);
    else if (next && last.kind === "name" && x.name && x.name === last.name && (x.why === "libur" || x.why === "cuti")) last.days.push(x);
    else if (x.why === "Sabtu" || x.why === "Minggu") groups.push({ kind: "wk", days: [x] });
    else if ((x.why === "libur" || x.why === "cuti") && x.name) groups.push({ kind: "name", name: x.name, days: [x] });
    else groups.push({ kind: "day", days: [x] });
  }
  const wkCount = groups.filter((g) => g.kind === "wk").length;
  return groups.map((g) => {
    const first = g.days[0];
    const lastDay = g.days[g.days.length - 1];
    let label;
    if (g.kind === "name") label = g.name;
    else if (g.kind === "day") label = TLCal.fmtShort(first.dn);
    else if (g.days.length === 2) {
      if (wkCount === 1) label = WHY_WEEKEND;
      else {
        const a = TLCal.fmtShort(first.dn).split(" ");
        const b = TLCal.fmtShort(lastDay.dn).split(" ");
        label = a[0] + " " + a[1] + (a[2] === b[2] ? "" : " " + a[2]) + "–" + b[0] + " " + b[1] + " " + b[2];
      }
    } else label = wkCount === 1 ? WHY_DAY[first.why] : TLCal.fmtShort(first.dn);
    return { label, n: g.days.length };
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
  const e = ex && typeof ex === "object" ? ex : { kind: "unscheduled" };
  const cx2 = ctx && typeof ctx === "object" ? ctx : {};
  const label = (k) => (typeof cx2.label === "function" ? String(cx2.label(k)) : String(k));
  const title = (k) => (typeof cx2.title === "function" ? String(cx2.title(k)) : String(k));
  const dated = Number.isInteger(e.start) && Number.isInteger(e.finish);
  const out = [];
  const say = (p) => {
    if (typeof p === "string" && typeof out[out.length - 1] === "string") out[out.length - 1] += p;
    else out.push(p);
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
    const days = (lag > 0 && Array.isArray(e.lagDays) ? e.lagDays.map((dn) => ({ dn, why: "lag" })) : []).concat(Array.isArray(e.skipped) ? e.skipped : []);
    const side = e.type === "SS" || e.type === "SF" ? " mulai " : " selesai ";
    say("Mulai ");
    say({ b: TLCal.fmtShort(e.start) });
    say(" karena menunggu ");
    say({ b: label(e.pred) });
    say(side + (Number.isInteger(e.base) ? TLCal.fmtShort(e.base) : "—"));
    if (lag !== 0) say(", ditambah lag " + (lag < 0 ? "−" + -lag : lag) + " hari");
    if (days.length) say(" (" + whyList(days) + " dilewati)");
    say(".");
  } else if (kind === "snet") {
    say("Mulai ");
    say({ b: TLCal.fmtShort(e.start) });
    say(" karena batasan: mulai tidak lebih awal dari " + TLCal.fmtShort(Number.isInteger(e.base) ? e.base : e.start) + ".");
  } else if (kind === "mfo") say("Harus selesai pada " + TLCal.fmtShort(e.finish) + " (batasan).");
  else say(WHY_TEXT[kind] || WHY_TEXT.root);
  // Kalimat durasi + tenggat
  const span = e.finish - e.start + 1;
  const skip = (Array.isArray(e.durSkipped) ? e.durSkipped : []).filter((x) => x && Number.isInteger(x.dn) && x.dn >= e.start && x.dn <= e.finish);
  const d = Number.isInteger(cx2.d) ? cx2.d : span - skip.length;
  if (d < 1) return out; // milestone
  const set = new Set(skip.map((x) => x.dn));
  let lo = e.start;
  while (set.has(lo)) lo++;
  let hi = e.finish;
  while (set.has(hi)) hi--;
  const inner = skip.filter((x) => x.dn > lo && x.dn < hi);
  say(" Durasi " + d + " " + SEC_HK + (inner.length ? " melompati " + whyList(inner) : "") + ", jadi selesai ");
  say({ b: TLCal.fmtShort(e.finish) });
  say(e.late > 0 && Number.isInteger(e.deadline) ? ", " + e.late + " " + SEC_HK + " setelah tenggat " + TLCal.fmtShort(e.deadline) + "." : ".");
  return out;
}

function secBadText(n) {
  return n + " dependensi rusak atau tidak dikenali versi ini";
}

function secLateText(finishDn, late) {
  return "Selesai " + TLCal.fmtShort(finishDn) + ", " + late + " " + SEC_HK + " setelah tenggat";
}

const liveTask = (t) => !!t && typeof t === "object" && !t.recurrence_type && t.gtd_status !== "archived" && !t.deleted;

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
    if (patch[k] === null) delete out[k];
    else out[k] = patch[k];
  }
  return out;
}

// Kembalikan kunci patch ke nilai `before` (kunci yang dulu tidak ada → dihapus).
function revertRaw(raw, patch, before) {
  const out = Object.assign({}, raw);
  for (const k of Object.keys(patch)) {
    if (Object.prototype.hasOwnProperty.call(before, k)) out[k] = before[k];
    else delete out[k];
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
    const d = TLSched.readSched({ deps: [item] }).deps[0];
    if (!d || seen.has(d.key) || rows.length >= TLSched.MAX_DEPS) return;
    seen.add(d.key);
    rows.push({ i, key: d.key, lag: d.lag, type: d.type });
  });
  const bad = raw.deps === undefined || raw.deps === null ? 0 : Array.isArray(raw.deps) ? list.length - rows.length : 1;
  return { rows, bad };
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
    if (!a) kids.set(k, (a = []));
    a.push(t);
  }
  return kids;
}

// Induk dengan anak hidup di `list` (daftar task lengkap) = ringkasan (R10) — logika yang sama dengan seksi Jadwal.
function isSummaryIn(list, task) {
  const all = Array.isArray(list) ? list : [];
  const idx = TLSched.buildIndex(all);
  const self = (task && idx.get(String(task.id))) || task;
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
  const self = (succ && idx.get(String(succ.id))) || succ;
  const p = (pred && idx.get(String(pred.id))) || pred;
  if (!self || !p) return { ok: false, reason: "scope" };
  const sk = secScopeKey(self);
  const scope = all.filter((t) => liveTask(t) && secScopeKey(t) === sk);
  if (scope.indexOf(self) < 0) scope.push(self);
  const rawOf = (t) => {
    const r = readRaw(t, t === self);
    return r && typeof r === "object" && !Array.isArray(r) ? r : {};
  };
  const raw = rawOf(self);
  const old = Array.isArray(raw.deps) ? raw.deps : [];
  const sidx = TLSched.buildIndex(scope);
  const edges = TLSched.resolveDeps(scope.map((t) => ({ task: t, sched: TLSched.readSched(t === self ? raw : rawOf(t)) })), sidx);
  const chk = TLSched.canLink({ pred: p, succ: self, scopeTasks: scope, edges, depCount: old.length });
  if (!chk.ok) return chk;
  if (old.some((d) => {
    const k = d && typeof d === "object" ? TLSched.refKey(d.t) : null;
    return k !== null && (k === String(p.id) || idx.get(k) === p);
  })) return { ok: false, reason: "dup" };
  let ref;
  try {
    ref = api.taskExt.ref(p);
  } catch (e) {
    logWarn(api, "ref dependensi gagal:", e);
    return { ok: false, reason: "ref" };
  }
  const san = TLSched.sanitizePatch({ deps: [{ t: ref, type: "FS", lag: 0 }] });
  if (!san.ok) return { ok: false, reason: "ref" };
  return { ok: true, deps: old.concat(san.patch.deps) };
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
  return s === Infinity ? null : { s, f };
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
  const { context, api } = props;
  const task = context.task;
  const tid = task.id;
  const propRaw = readExtSafe(api, task);
  const propKey = stableKey(propRaw);

  // Daftar task (judul dependensi, ringkasan, rentang pendahulu, progres terkini, ext terbaru). Dimuat saat task/ext
  // berganti, saat sinkron selesai, dan (dibatasi) saat seksi difokus/disentuh; pemilih memuat sendiri saat dibuka.
  // Berurutan: hanya jawaban permintaan terbaru yang dipakai.
  const [all, setAll] = React.useState(null);
  const loadRef = React.useRef({ at: 0, alive: true, seq: 0 });
  const loadAll = () => {
    const L = loadRef.current;
    L.at = nowMs();
    const seq = ++L.seq;
    return Promise.resolve()
      .then(() => api.data.tasks.list({ includeDone: true }))
      .then((list) => {
        const arr = Array.isArray(list) ? list : [];
        if (L.alive && seq === L.seq) setAll(arr);
        return arr;
      }, (e) => {
        logWarn(api, "daftar task gagal dimuat:", e);
        if (L.alive && seq === L.seq) setAll((p) => p || []); // tetap bisa dipakai tanpa daftar
        return null;
      });
  };
  const view = React.useMemo(() => {
    const list = all || [];
    const idx = TLSched.buildIndex(list);
    return { list, idx, kids: childrenOf(list, idx) };
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
  // Fix T11: tulis berjalan seksi — set 1b (promise selesai per tulis) dan writeMany (satu sekaligus + kunci task-nya);
  // Urungkan menunggu keduanya, set 1b pada task yang sedang di-setMany diabaikan.
  const singleRef = React.useRef(new Set());
  const manyRef = React.useRef(null);
  const manyKeys = React.useRef(new Set());
  const [loc, setLoc] = React.useState(() => ({ id: tid, key: srcKey, raw: srcRaw, d: {} }));
  let cur = loc;
  if (loc.id !== tid) cur = { id: tid, key: srcKey, raw: srcRaw, d: {} };
  else if (loc.key !== srcKey && inflight.current === 0 && !Object.keys(loc.d).length) {
    cur = stableKey(loc.raw) === srcKey ? Object.assign({}, loc, { key: srcKey }) : { id: tid, key: srcKey, raw: srcRaw, d: {} };
  }
  if (cur !== loc) setLoc(cur);
  const [, setTick] = React.useState(0);
  const raw = cur.raw;
  const sched = TLSched.readSched(raw);
  const deps = depRowsOf(raw);
  // Durasi bukan-nol terakhir di mount ini (per task) untuk "hapus centang Milestone".
  const lastDur = React.useRef({ id: tid, n: null });
  if (lastDur.current.id !== tid) lastDur.current = { id: tid, n: null };
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
  const un = useUnits(api, wsTask ? { pageKind, listId: task.list_id } : { pageKind, projectName: task.project });

  React.useEffect(() => {
    loadRef.current.alive = true;
    loadAll();
    return undefined;
  }, [api, tid, propKey]);
  React.useEffect(() => {
    let off = null;
    try {
      off = api.events.on("sync.done", () => { loadAll(); });
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
  const readOther = (t) => TLSched.readSched(t === selfLive ? raw : readExtSafe(api, t));

  // 1c-1 R20 secEngine = {result, node, wbs, ctx}: mesin seksi sendiri atas daftar LENGKAP scope task (`all` 1b; ext
  // task ini = nilai lokal optimistis). Dihitung di useMemo HANYA setelah `all` ada — render pertama tidak menjalankan
  // mesin. Tidak pernah menulis (R25): drift hanya ditampilkan, tulisan berasal dari klik Mode / "Perbarui".
  const rawKey = stableKey(raw);
  const unitsKey = unitsKeyOf(un.units);
  const secEngine = React.useMemo(() => {
    if (all === null) return null;
    const scope = scopeFilter(all, [selfLive]);
    if (scope.indexOf(selfLive) < 0) scope.push(selfLive);
    const readExt = (t) => (t === selfLive ? raw : readExtSafe(api, t));
    try {
      const ctx = { tasks: scope, cal: c, units: un.units, readExt };
      const result = engine.run(ctx);
      const wbs = TLLayout.wbsMap(scope, pageKind, (t) => TLSched.readSched(readExt(t)));
      return { result, node: result.nodes.get(String(selfLive.id)) || null, wbs, ctx, self: selfLive };
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
  // Mesin seksi atas daftar segar (hitung ulang PreviewCard setelah CAS gagal): semua ext dari daftar terbaru.
  const runSec = (list) => {
    const me = TLSched.buildIndex(list).get(String(selfLive.id)) || selfLive;
    const scope = scopeFilter(list, [me]);
    if (scope.indexOf(me) < 0) scope.push(me);
    const readExt = (t) => readExtSafe(api, t);
    try {
      const ctx = { tasks: scope, cal: c, units: un.units, readExt };
      const result = engine.run(ctx);
      const wbs = TLLayout.wbsMap(scope, pageKind, (t) => TLSched.readSched(readExt(t)));
      return { result, node: result.nodes.get(String(me.id)) || null, wbs, ctx, self: me };
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
  const setCard = (v) => {
    cardRef.current = v;
    setCardS(v);
  };
  // R21: explain HANYA saat "Kenapa" dibuka (terlipat bawaan), atas hasil + kalender + readExt run seksi yang sama.
  const whyParts = React.useMemo(() => {
    if (whyOpen !== tid || !autoNode) return null;
    const eng = secEngine;
    const ex = engine.explain(eng.result, autoNode.key, eng.ctx.cal, eng.ctx.readExt);
    const taskOf = (k) => {
      const n = eng.result.nodes.get(String(k));
      return n ? n.task : view.idx.get(String(k)) || null;
    };
    const title = (k) => taskTitle(taskOf(k));
    const label = (k) => {
      const w = eng.wbs.get(String(k));
      return (w ? w + " " : "") + title(k);
    };
    return whyText(ex, { label, title, d: autoNode.d });
  }, [whyOpen, tid, secEngine, autoNode, view.idx]);

  // ---- tulis ----
  const setDraft = (name, value) => setLoc((p) => (p.id === tid ? Object.assign({}, p, { d: Object.assign({}, p.d, { [name]: value }) }) : p));
  const clearDraft = (name) => setLoc((p) => {
    if (p.id !== tid || !(name in p.d)) return p;
    const d = Object.assign({}, p.d);
    delete d[name];
    return Object.assign({}, p, { d });
  });
  const write = (patch, draftName) => {
    if (manyRef.current && manyKeys.current.has(String(writeId))) {
      if (draftName) clearDraft(draftName); // task ini sedang ditulis massal → diabaikan (aturan sibuk)
      return;
    }
    const before = raw;
    setLoc((p) => {
      if (p.id !== tid) return p;
      const d = Object.assign({}, p.d);
      if (draftName) delete d[draftName];
      return Object.assign({}, p, { raw: applyRaw(p.raw, patch), d });
    });
    inflight.current += 1;
    let p;
    try {
      // panggil sinkron: urutan tulis = urutan aksi pengguna. Id dari daftar: salinan modal ber-cid basi → id terkini.
      p = Promise.resolve(api.taskExt.set(writeId, patch));
    } catch (e) {
      p = Promise.reject(e);
    }
    p
      .then(null, (e) => {
        logWarn(api, "jadwal gagal disimpan:", e);
        toastSafe(api, MSG_SAVE_FAIL, "error");
        setLoc((p) => (p.id === tid ? Object.assign({}, p, { raw: revertRaw(p.raw, patch, before) }) : p));
      })
      .then(() => {
        inflight.current = Math.max(0, inflight.current - 1);
        setTick((n) => n + 1); // render ulang: props yang menyusul selama tulis kini boleh men-seed
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
    const down = items.filter((it) => !isSelf(it.task)).length;
    if (down > TLPlan.CASCADE_MAX) {
      if (o.draft) clearDraft(o.draft);
      setCard({ id: ++cardSeq.current, tid, op, items, model: cardModel(secEngine, r), busy: false });
      return;
    }
    const mine = items.find((it) => isSelf(it.task));
    if (!down && o.single && mine) {
      write(mine.patch, o.draft);
      return;
    }
    writeMany(items, { text: down ? flowText(down) : MSG_CHANGED, draft: o.draft });
  };
  // Patch task ini → TLPlan.cascade. Patch `deps` = larik mentah apa adanya (kebijakan Task 8: item lain tidak pernah
  // ditulis ulang lewat sanitasi — cascade memakai bentuk bersih untuk menghitung, item task ini menulis larik mentah).
  const cascadeOp = (patch) => (eng) => {
    const r = TLPlan.cascade(eng.ctx, [{ task: eng.self, patch }], eng.result);
    let items = flowItems(r.items);
    if ("deps" in patch) items = items.map((it) => (isSelf(it.task) ? Object.assign({}, it, { patch: Object.assign({}, it.patch, { deps: patch.deps }) }) : it));
    return { items, after: r.result };
  };
  // Model PreviewCard: TLPlan.preview (sebelum = hasil mesin seksi saat itu) + WBS seksi.
  const cardModel = (eng, r) => {
    const pm = TLPlan.preview(r.items, r.after, eng.ctx, eng.result);
    return pm ? dialogModel(pm, r.after, (k) => eng.wbs.get(k) || "") : EMPTY_PV_MODEL;
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
    runFlow(cascadeOp(patch), { single: true, draft: draftName });
  };
  // PreviewCard Terapkan (R14): muat ulang daftar lengkap → TLPlan.revalidate (nilai mentah). Berubah → toast "Data
  // berubah sejak pratinjau dibuka — hitung ulang" + kartu dihitung ulang dari daftar terbaru (op yang sama), 0 tulis.
  // Sama → SATU setMany lewat writeMany + "Jadwal diterapkan · {n} task" + Urungkan. Tulis massal berjalan → diabaikan
  // (aturan sibuk T11; kartu tetap). Batal = tutup, 0 tulis.
  const cancelCard = () => setCard(null);
  const applyCard = () => {
    const cd = cardRef.current;
    if (!cd || cd.busy || manyRef.current) return;
    const busy = Object.assign({}, cd, { busy: true });
    setCard(busy);
    loadAll().then((list) => {
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
        setCard(Object.assign({}, cd, { items: r.items, model: cardModel(eng, r), busy: false }));
        return;
      }
      setCard(null);
      writeMany(cd.items, { text: appliedText(cd.items.length) });
    });
  };

  // 1c-1 R20/R25 writeMany(items, {text, undo}) — pintu tulis massal seksi: SATU api.taskExt.setMany untuk semua item
  // ([{task, patch, before}] dari TLPlan); patch task ini langsung ke state lokal optimistis (diselaraskan seed 1b saat
  // host memperbarui props/daftar). Sukses → toast `text` + Urungkan (= writeMany(undoItems), tanpa toast sukses) dan
  // daftar dimuat ulang (turunan terbaru). Gagal → nilai lokal kembali + "Jadwal gagal disimpan"; sebagian (err.applied)
  // → "Sebagian jadwal gagal disimpan ({k} dari {n})" + Urungkan hanya yang tersimpan. Satu tulis massal sekaligus:
  // klik berikutnya selama berjalan diabaikan, Urungkan menunggu. → Promise<boolean>, tidak pernah reject.
  const isSelf = (t) => !!t && (t === selfLive || String(t.id) === String(selfLive.id));
  const idOf = (t) => (isSelf(t) ? writeId : t.id); // task ini: id terkini dari daftar (penjaga salinan modal basi)
  const writeMany = (items, opts) => {
    const o = opts || {};
    const list = (Array.isArray(items) ? items : []).filter((it) => it && it.task && it.patch);
    if (!list.length) return Promise.resolve(false);
    if (manyRef.current) {
      if (o.undo) return manyRef.current.then(() => writeMany(list, o));
      if (o.draft) clearDraft(o.draft);
      return Promise.resolve(false);
    }
    const mine = list.find((it) => isSelf(it.task)) || null;
    const before = raw;
    if (mine || o.draft) {
      setLoc((p) => {
        if (p.id !== tid) return p;
        const d = Object.assign({}, p.d);
        if (o.draft) delete d[o.draft];
        return Object.assign({}, p, { raw: mine ? applyRaw(p.raw, mine.patch) : p.raw, d });
      });
    }
    inflight.current += 1;
    manyKeys.current = new Set(list.map((it) => String(idOf(it.task))));
    let p;
    try {
      p = Promise.resolve(api.taskExt.setMany(list.map((it) => ({ taskId: idOf(it.task), patch: it.patch }))));
    } catch (e) {
      p = Promise.reject(e);
    }
    // Urungkan: tunggu writeMany yang berjalan dan set 1b task ini yang belum selesai (pola undoAction T9), lalu kirim.
    const undoOf = (done) => ({
      label: MSG_UNDO,
      onClick: () => {
        const u = TLPlan.undoItems(done);
        const send = () => {
          const waits = manyRef.current ? [manyRef.current] : [];
          if (done.some((it) => isSelf(it.task))) for (const w of singleRef.current) waits.push(w);
          if (waits.length) {
            Promise.all(waits).then(send);
            return;
          }
          writeMany(u.map((x, i) => ({ task: done[i].task, patch: x.patch })), { undo: true });
        };
        send();
      },
    });
    const run = p.then(() => {
      if (!o.undo) toastSafe(api, o.text || MSG_CHANGED, "success", undoOf(list));
      loadAll();
      return true;
    }, (err) => {
      logWarn(api, "jadwal gagal disimpan:", err);
      const ids = err && Array.isArray(err.applied) ? new Set(err.applied.map(String)) : null;
      const saved = ids ? list.filter((it) => ids.has(String(idOf(it.task)))) : [];
      if (mine && saved.indexOf(mine) < 0) {
        setLoc((q) => (q.id === tid ? Object.assign({}, q, { raw: revertRaw(q.raw, mine.patch, before) }) : q));
      }
      if (!saved.length || o.undo) toastSafe(api, MSG_SAVE_FAIL, "error");
      else toastSafe(api, partialText(list.length - saved.length, list.length), "error", undoOf(saved));
      if (saved.length) loadAll();
      return false;
    }).then((r) => {
      manyRef.current = null;
      manyKeys.current = new Set();
      inflight.current = Math.max(0, inflight.current - 1);
      setTick((n) => n + 1);
      return r;
    });
    manyRef.current = run;
    return run;
  };

  // Aliran dari seksi (K32, R13 semantik cascade): patch task ini → TLPlan.cascade atas secEngine → item tanpa perubahan
  // dibuang (flowItems) → writeMany. Toast: hanya task ini → "Jadwal diubah"; ada turunan → "Jadwal diubah · {n} task
  // ikut bergeser". Turunan > CASCADE_MAX → PreviewCard sebelum menulis (Task 12). Mesin gagal → satu item task ini.
  const flowFrom = (patch) => {
    if (secEngine) {
      runFlow(cascadeOp(patch), {});
      return;
    }
    const before = {};
    for (const k of SEC_ITEM_KEYS) before[k] = raw[k] === undefined ? null : JSON.parse(JSON.stringify(raw[k]));
    writeMany([{ task: selfLive, key: String(writeId), before, patch }], { text: MSG_CHANGED });
  };
  // Kontrol Mode: pilihan = mode unit → {mode: null}, selain itu {mode: pilihan} (TLPlan.modePatch, penjaga fold unit).
  const pickMode = (want) => {
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
    runFlow((eng) => {
      if (!eng.node) return { items: [], after: eng.result };
      const keys = secAutoReach(eng.result, eng.node.key);
      keys.add(eng.node.key);
      return { items: flowItems(TLPlan.diff(eng.result, eng.ctx, keys)), after: eng.result };
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
  const commitAutoStart = (v) => {
    setEditStart(null);
    if (v === null) {
      clearDraft("start");
      return;
    }
    const x = snapStart(v, sched.start === null ? autoNode.d : sched.duration);
    if (x === sched.start && x === TLCal.iso(autoNode.es)) {
      clearDraft("start");
      return;
    }
    const p = { start: x };
    if (sched.start === null && !Number.isInteger(raw.duration)) p.duration = 1;
    const g = TLPlan.gesture(secEngine.result, selfLive, raw, p, c);
    if (!g.ok) {
      toastSafe(api, MSG_EARLY, "error");
      clearDraft("start");
      return;
    }
    writeSched(g.patch, "start");
  };
  const commitStart = (v) => {
    if (autoNode) {
      commitAutoStart(v);
      return;
    }
    if (v === null) {
      if (sched.start === null) clearDraft("start");
      else writeSched({ start: null, duration: null }, "start");
      return;
    }
    const x = snapStart(v, sched.start === null ? 1 : sched.duration);
    if (x === sched.start) clearDraft("start");
    else if (sched.start === null) writeSched({ start: x, duration: 1 }, "start");
    else writeSched({ start: x }, "start");
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
  const onStartChange = (e) => {
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
    startTimer.current = { id, run };
  };
  const onStartBlur = (e) => {
    cancelStartTimer();
    const t = e && e.target ? e.target : {};
    const v = String(t.value || "");
    if (commitDate(v)) commitStart(v);
    else if (v === "" && !(t.validity && t.validity.badInput)) commitStart(null);
    else clearDraft("start"); // tanggal setengah diketik / tak sah → kembali ke nilai tersimpan
  };
  const onStartKey = (e) => {
    if (!e || e.key !== "Enter") return;
    if (typeof e.preventDefault === "function") e.preventDefault();
    cancelStartTimer();
    const v = e.target ? String(e.target.value || "") : "";
    if (commitDate(v)) commitStart(v);
  };

  const commitDur = (v) => {
    const n = clampText(v, 1, TLSched.DUR_MAX);
    if (n === null || n === sched.duration || sched.start === null) clearDraft("dur");
    else writeSched({ duration: n }, "dur");
  };
  const onEnter = (fn) => (e) => {
    if (!e || e.key !== "Enter") return;
    if (typeof e.preventDefault === "function") e.preventDefault();
    fn(e.target ? e.target.value : "");
  };

  const setMilestone = (on) => {
    if (sched.start === null) return;
    if (on) {
      if (sched.duration !== 0) writeSched({ duration: 0 });
      return;
    }
    if (sched.duration !== 0) return;
    const n = lastDur.current.id === tid && lastDur.current.n ? lastDur.current.n : 1;
    const patch = { duration: n };
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
    writeSched({ deps: rawDeps.map((it, j) => (j === row.i ? Object.assign({}, it, { lag: n }) : it)) }, name);
  };
  const removeDep = (row) => {
    const next = rawDeps.filter((_, j) => j !== row.i);
    writeSched({ deps: next.length ? next : null }, "lag:" + row.i);
  };
  const cleanBad = () => {
    const keep = deps.rows.map((r) => rawDeps[r.i]);
    writeSched({ deps: keep.length ? keep : null });
  };
  // Task 12 (R20 "Menunggu"): ganti tipe satu dependensi → deps ditulis ulang UTUH, item lain apa adanya; mengalir.
  const changeType = (row, type) => {
    if (type === row.type || TLSched.TYPES.indexOf(type) < 0) return;
    writeSched({ deps: rawDeps.map((it, j) => (j === row.i ? Object.assign({}, it, { type }) : it)) });
  };
  // Batasan (R20/R12): ASAP → constraint null; SNET/MFO dipilih → tanggal bawaan hasil hitung (Mulai / Selesai) agar
  // memilih jenis tidak menggeser apa pun; tanggal diubah lewat input → {type, date} baru. Semua mengalir.
  const pickCst = (v) => {
    const cur = sched.constraint;
    if (!autoNode) return;
    if (v === "") {
      if (cur) writeSched({ constraint: null });
      return;
    }
    if ((v !== "SNET" && v !== "MFO") || (cur && cur.type === v)) return;
    writeSched({ constraint: { type: v, date: TLCal.iso(v === "SNET" ? autoNode.es : autoNode.ef) } });
  };
  const commitCst = (v) => {
    const cur = sched.constraint;
    if (!cur || !commitDate(v) || v === cur.date) clearDraft("cst");
    else writeSched({ constraint: { type: cur.type, date: v } }, "cst");
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
  const onCstChange = (e) => {
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
    cstTimer.current = { id, run };
  };
  const onCstBlur = (e) => {
    cancelCstTimer();
    const v = e && e.target ? String(e.target.value || "") : "";
    if (commitDate(v)) commitCst(v);
    else clearDraft("cst");
  };
  const onCstKey = (e) => {
    if (!e || e.key !== "Enter") return;
    if (typeof e.preventDefault === "function") e.preventDefault();
    cancelCstTimer();
    const v = e.target ? String(e.target.value || "") : "";
    if (commitDate(v)) commitCst(v);
  };

  // ---- pemilih dependensi (R15, R17) ----
  const openPicker = () => {
    setForceOpen(true);
    setPicker({ q: "", list: null });
    loadAll().then((list) => {
      if (loadRef.current.alive) setPicker((p) => (p ? Object.assign({}, p, { list: list || [] }) : p));
    });
  };
  const closePicker = () => setPicker(null);
  const pickIndex = React.useMemo(() => {
    const list = picker && picker.list ? picker.list : [];
    const idx = TLSched.buildIndex(list);
    return { list, idx, kids: childrenOf(list, idx) };
  }, [picker && picker.list]);

  // Pemeriksaan bersama dengan Gantt (checkLink) atas daftar lengkap pemilih; ext penerus = nilai lokal optimistis.
  const addDep = (pred) => {
    const chk = checkLink(api, pickIndex.list, pred, task, (t, isSucc) => (isSucc ? raw : readExtSafe(api, t)));
    if (!chk.ok) {
      if (LINK_MSG[chk.reason]) toastSafe(api, LINK_MSG[chk.reason], "error");
      return;
    }
    writeSched({ deps: chk.deps });
    setPicker(null);
  };

  // ---- turunan tampilan ----
  const selfKids = view.kids.get(String(selfLive.id)) || [];
  const summary = selfKids.length > 0;
  const span = TLSched.spanOf(c, sched);
  const preds = [];
  const depView = deps.rows.map((r) => {
    const p = all ? view.idx.get(r.key) : null;
    if (p) {
      const sp = spanTree(c, p, view.kids, readOther, new Set());
      if (sp) preds.push({ span: sp, lag: r.lag });
    }
    const name = p ? taskTitle(p) : all ? SEC_DELETED : SEC_LOADING;
    const w = p && secEngine ? secEngine.wbs.get(String(p.id)) : null;
    return { row: r, name, full: w ? w + " " + name : name, outside: !!p && secScopeKey(p) !== secScopeKey(selfLive) };
  });
  const earliest = span && preds.length ? TLSched.shiftAfterDeps(c, null, preds) : null;
  const eff = span ? calSafe(() => TLCal.nextWork(c, span.s)) : null;
  const violated = earliest !== null && eff !== null && eff < TLCal.dn(earliest);
  const late = span ? TLSched.deadlineLate(c, span.f, info.deadline) : null;

  let pickerEl = null;
  if (picker) {
    const { list, idx, kids } = pickIndex;
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
      const doneOf = (t) => (t.gtd_status === "done" || t.completed_at ? 1 : 0);
      cands.sort((x, y) => doneOf(x) - doneOf(y) || taskTitle(x).localeCompare(taskTitle(y), "id") || (String(x.id) < String(y.id) ? -1 : String(x.id) > String(y.id) ? 1 : 0));
      cands = cands.slice(0, PICK_MAX);
    }
    pickerEl = (
      <div className="plg-timeline-picker" onKeyDown={(e) => {
        if (e && e.key === "Escape") {
          if (typeof e.preventDefault === "function") e.preventDefault();
          if (typeof e.stopPropagation === "function") e.stopPropagation();
          closePicker();
        }
      }}>
        <div className="plg-timeline-picker-bar">
          <input type="search" className="plg-timeline-input plg-timeline-picker-q" aria-label={SEC_SEARCH} placeholder={SEC_SEARCH + "…"}
            value={picker.q} autoFocus
            onChange={(e) => {
              const v = e && e.target ? String(e.target.value) : "";
              setPicker((p) => (p ? Object.assign({}, p, { q: v }) : p));
            }} />
          <button type="button" className="plg-timeline-btn" onClick={closePicker}>{SEC_CLOSE}</button>
        </div>
        {!picker.list ? <div className="plg-timeline-sec-muted">{SEC_LOADING}</div>
          : !cands.length ? <div className="plg-timeline-sec-muted">{SEC_NO_MATCH}</div>
          : (
            <ul className="plg-timeline-picks">
              {cands.map((t) => (
                <li key={String(t.id)}>
                  <button type="button" className="plg-timeline-pick" data-key={String(t.id)} onClick={() => addDep(t)}>
                    <span className="plg-timeline-pick-title">{taskTitle(t)}</span>
                    {depSet.has(t) ? <span className="plg-timeline-pick-note">{SEC_IS_DEP}</span> : null}
                  </button>
                </li>
              ))}
            </ul>
          )}
      </div>
    );
  }

  const head = (withToggle, chips) => (
    <div className="plg-timeline-sec-head">
      <span className="plg-timeline-sec-title">{SEC_TITLE}</span>
      {chips || null}
      {withToggle ? (
        <button type="button" className={cx("plg-timeline-sec-more", expanded && "is-open")} aria-expanded={expanded}
          onClick={() => {
            if (expanded) {
              setForceOpen(false);
              setOpenPref(false);
            } else setOpenPref(true);
          }}>
          {expanded ? SEC_LESS : SEC_MORE}
        </button>
      ) : null}
    </div>
  );

  // Daftar belum dimuat: hanya kepala seksi (ringkasan tidak berkedip menjadi input lalu berganti).
  if (all === null) {
    return (
      <section className="plg-timeline-section" aria-label={SEC_TITLE} aria-busy="true">
        {head(false)}
      </section>
    );
  }

  // Ringkasan (R10): rentang dari subtask, tanpa input.
  if (summary) {
    const sp = spanTree(c, selfLive, view.kids, readOther, new Set());
    const wd = sp ? calSafe(() => TLCal.workdays(c, sp.s, sp.f)) : null;
    return (
      <section className="plg-timeline-section" aria-label={SEC_TITLE} onFocus={refreshSoon} onPointerEnter={refreshSoon}>
        {head(false)}
        <p className="plg-timeline-sec-note">{SEC_SUMMARY}</p>
        <div className="plg-timeline-sec-range">
          {sp ? TLCal.fmtShort(sp.s) + " → " + TLCal.fmtShort(sp.f) + (wd === null ? "" : " · " + wd + " " + SEC_HK) : SEC_SUMMARY_NONE}
        </div>
      </section>
    );
  }

  // 1c-1 R20 kontrol Mode (tingkat 1 "Selengkapnya"; tingkat 2 "Selengkapnya" = awal tingkat 3, dilanjutkan Task 12).
  const shiftN = effMode === "manual" && secEngine && secEngine.node ? secAutoReach(secEngine.result, secEngine.node.key).size : 0;
  // part = penanda urutan tingkat 3 (data-part); tingkat 1 tanpa penanda.
  const modeElOf = (part) => (
    <div className="plg-timeline-sec-mode" role="group" aria-label={SEC_MODE} data-part={part}>
      <span className="plg-timeline-field-label">{SEC_MODE}</span>
      <span className="plg-timeline-seg">
        {SEC_MODES.map(([m, label]) => (
          <button key={m} type="button" data-mode={m} className={cx("plg-timeline-seg-btn", effMode === m && "is-active")}
            aria-pressed={effMode === m} onClick={() => pickMode(m)}>
            {label}
            {unitMode === m ? <span className="plg-timeline-seg-note">{SEC_MODE_UNIT}</span> : null}
          </button>
        ))}
      </span>
      {shiftN > 0 ? <p className="plg-timeline-sec-note plg-timeline-sec-shiftnote">{secShiftText(shiftN)}</p> : null}
    </div>
  );

  // Kartu pratinjau aliran > CASCADE_MAX (Task 12; R14/R20): tampil di tingkat 1–3, juga saat terlipat ("Perbarui").
  const cardEl = card && card.tid === tid ? PreviewCard({ model: card.model, busy: card.busy, onApply: applyCard, onCancel: cancelCard }) : null;
  const d = cur.d;
  const durVal = "dur" in d ? d.dur : sched.start === null ? "" : String(sched.duration);
  const milestone = sched.start !== null && sched.duration === 0;
  const durInput = (
    <span className="plg-timeline-sec-num">
      <input type="number" className="plg-timeline-input plg-timeline-num" aria-label={SEC_DUR + " (" + SEC_HK + ")"}
        min={1} max={TLSched.DUR_MAX} step={1} inputMode="numeric" value={durVal} disabled={sched.start === null || milestone}
        onChange={(e) => setDraft("dur", e && e.target ? String(e.target.value) : "")}
        onBlur={(e) => commitDur(e && e.target ? e.target.value : "")} onKeyDown={onEnter(commitDur)} />
      <span className="plg-timeline-sec-unit">{SEC_HK}</span>
    </span>
  );
  const milestoneEl = (part) => (
    <label className={cx("plg-timeline-sec-check", sched.start === null && "is-disabled")} data-part={part}>
      <input type="checkbox" aria-label={SEC_MILESTONE} checked={milestone} disabled={sched.start === null}
        onChange={(e) => setMilestone(!!(e && e.target && e.target.checked))} />
      <span>{SEC_MILESTONE}</span>
    </label>
  );
  const pctEl = (part) => (
    <div className="plg-timeline-field" data-part={part}>
      <span className="plg-timeline-field-label">{SEC_PCT}</span>
      <span className="plg-timeline-sec-val" data-field="pct">{pctOf(info) + "%"}</span>
      <span className="plg-timeline-sec-hint">{SEC_PCT_HINT}</span>
    </div>
  );
  const badEl = deps.bad ? (
    <div className="plg-timeline-sec-bad">
      <span>{secBadText(deps.bad)}</span>
      <button type="button" className="plg-timeline-btn" onClick={cleanBad}>{SEC_BAD_BTN}</button>
    </div>
  ) : null;
  const addEl = (part) => (picker ? <div className="plg-timeline-sec-add" data-part={part}>{pickerEl}</div> : (
    <div className="plg-timeline-sec-actions" data-part={part}>
      <button type="button" className="plg-timeline-sec-link" onClick={openPicker}>{SEC_ADD_DEP}</button>
    </div>
  ));

  // Tingkat 2 (mode efektif otomatis, simpul terhitung): kartu terlipat dari hasil mesin seksi, tanpa input.
  // "Selengkapnya" → tingkat 3 (R20, urutan tetap): Mode · Mulai (teks + "Ubah") · Durasi · Selesai · Milestone · % selesai
  // · Batasan · Dependensi (Menunggu / Diikuti oleh) · Tambah dependensi · Kenapa dijadwalkan di sini? · Ubah ke Manual.
  const node = autoNode;
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
        const dd = TLSched.readSched(readExtSafe(api, t)).deps.find((x) => {
          const h = view.idx.get(x.key);
          return !!h && isSelf(h);
        });
        if (dd) succView.push({ task: t, type: dd.type, lag: dd.lag });
      }
      const fullOf = (t) => {
        const w = secEngine.wbs.get(String(t.id));
        return (w ? w + " " : "") + taskTitle(t);
      };
      body = (
        <div className="plg-timeline-sec-body">
          {modeElOf("mode")}
          <div className="plg-timeline-field" data-part="start">
            <span className="plg-timeline-field-label">{SEC_START}</span>
            {editing ? (
              <input type="date" className="plg-timeline-input" aria-label={SEC_START} autoFocus
                value={"start" in d ? d.start : TLCal.iso(node.es)}
                onChange={onStartChange} onBlur={onStartBlur} onKeyDown={onStartKey} />
            ) : (
              <span className="plg-timeline-sec-startval">
                <span className="plg-timeline-sec-val">{TLCal.fmtShort(node.es)}</span>
                <button type="button" className="plg-timeline-btn" aria-label={SEC_EDIT + " " + SEC_START} onClick={() => setEditStart(tid)}>{SEC_EDIT}</button>
              </span>
            )}
          </div>
          <label className="plg-timeline-field" data-part="dur">
            <span className="plg-timeline-field-label">{SEC_DUR}</span>
            {durInput}
          </label>
          <div className="plg-timeline-field" data-part="finish">
            <span className="plg-timeline-field-label">{SEC_FINISH}</span>
            <span className="plg-timeline-sec-val" data-field="finish">{TLCal.fmtLong(node.ef)}</span>
          </div>
          {milestoneEl("milestone")}
          {pctEl("pct")}
          <div className="plg-timeline-sec-cst" role="group" aria-label={SEC_CST} data-part="constraint">
            <span className="plg-timeline-field-label">{SEC_CST}</span>
            <select className="plg-timeline-input" aria-label={SEC_CST_KIND} value={cst ? cst.type : ""}
              onChange={(e) => pickCst(e && e.target ? String(e.target.value) : "")}>
              {SEC_CSTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            {cst ? (
              <input type="date" className="plg-timeline-input" aria-label={SEC_CST_DATE} value={"cst" in d ? d.cst : cst.date}
                onChange={onCstChange} onBlur={onCstBlur} onKeyDown={onCstKey} />
            ) : null}
          </div>
          <div className="plg-timeline-sec-deps" data-part="deps">
            <span className="plg-timeline-field-label">{SEC_DEPS}</span>
            {depView.length ? (
              <div className="plg-timeline-dep-group" data-group="pred">
                <span className="plg-timeline-dep-sub">{SEC_WAITS}</span>
                <ul className="plg-timeline-deps">
                  {depView.map((v) => {
                    const r = v.row;
                    const dn = "lag:" + r.i;
                    return (
                      <li key={r.i + ":" + r.key} className="plg-timeline-dep" data-key={r.key}>
                        <span className="plg-timeline-dep-main">
                          <span className="plg-timeline-dep-name" title={v.full}>{v.full}</span>
                          {v.outside ? <span className="plg-timeline-dep-note">{SEC_OUTSIDE}</span> : null}
                        </span>
                        <select className="plg-timeline-input plg-timeline-dep-typesel" aria-label={"Tipe dependensi " + v.name} value={r.type}
                          onChange={(e) => changeType(r, e && e.target ? String(e.target.value) : "")}>
                          {SEC_TYPES.map(([t, l]) => <option key={t} value={t}>{l}</option>)}
                        </select>
                        {r.lag !== 0 ? <span className="plg-timeline-dep-lag">{signedHk(r.lag)}</span> : null}
                        <span className="plg-timeline-sec-num">
                          <input type="number" className="plg-timeline-input plg-timeline-num" aria-label={"Jeda setelah " + v.name + " (" + SEC_HK + ")"}
                            min={TLSched.LAG_MIN} max={TLSched.LAG_MAX} step={1} value={dn in d ? d[dn] : String(r.lag)}
                            onChange={(e) => setDraft(dn, e && e.target ? String(e.target.value) : "")}
                            onBlur={(e) => commitLag(r, e && e.target ? e.target.value : "")} onKeyDown={onEnter((val) => commitLag(r, val))} />
                          <span className="plg-timeline-sec-unit">{SEC_HK}</span>
                        </span>
                        <button type="button" className="plg-timeline-dep-del" aria-label={"Hapus dependensi " + v.name} title="Hapus dependensi"
                          onClick={() => removeDep(r)}>×</button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ) : null}
            {succView.length ? (
              <div className="plg-timeline-dep-group" data-group="succ">
                <span className="plg-timeline-dep-sub">{SEC_FOLLOWS}</span>
                <ul className="plg-timeline-deps">
                  {succView.map((x) => (
                    <li key={String(x.task.id)} className="plg-timeline-dep is-succ" data-key={String(x.task.id)}>
                      <span className="plg-timeline-dep-main">
                        <span className="plg-timeline-dep-name" title={fullOf(x.task)}>{fullOf(x.task)}</span>
                      </span>
                      <span className="plg-timeline-dep-type">{x.type}</span>
                      {x.lag !== 0 ? <span className="plg-timeline-dep-lag">{signedHk(x.lag)}</span> : null}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {badEl}
          </div>
          {addEl("add")}
          <div className="plg-timeline-sec-whybox" data-part="why">
            <button type="button" className={cx("plg-timeline-sec-more", whyParts && "is-open")} aria-expanded={!!whyParts}
              onClick={() => setWhyOpen(whyOpen === tid ? null : tid)}>
              {SEC_WHY}
            </button>
            {whyParts ? (
              <p className="plg-timeline-sec-why">
                {whyParts.map((x, i) => (typeof x === "string" ? x : <strong key={i}>{x.b}</strong>))}
              </p>
            ) : null}
          </div>
          <div className="plg-timeline-sec-actions" data-part="manual">
            <button type="button" className="plg-timeline-btn" onClick={() => pickMode("manual")}>{SEC_TO_MANUAL}</button>
          </div>
        </div>
      );
    }
    return (
      <section className="plg-timeline-section" aria-label={SEC_TITLE} onFocus={refreshSoon} onPointerEnter={refreshSoon}>
        {head(true, [
          <span key="auto" className="plg-timeline-chip">{SEC_MODE_AUTO}</span>,
          node.late > 0 ? <span key="late" className="plg-timeline-chip is-late">{secLateChip(node.late)}</span> : null,
        ])}
        <div className="plg-timeline-sec-range">{TLCal.fmtShort(node.es) + " → " + TLCal.fmtShort(node.ef) + " · " + node.d + " " + SEC_HK}</div>
        <div className="plg-timeline-sec-links">{secLinksText(secEngine)}</div>
        {node.critical ? (
          <div className="plg-timeline-sec-flags">
            <span className="plg-timeline-chip is-critical">{SEC_CRIT}</span>
          </div>
        ) : null}
        {drift ? (
          <div className="plg-timeline-sec-drift" role="status">
            <span className="plg-timeline-sec-drift-text">{secDriftText(node.es)}</span>
            <button type="button" className="plg-timeline-btn" onClick={updateAuto}>{SEC_UPDATE}</button>
          </div>
        ) : null}
        {cardEl}
        {body}
      </section>
    );
  }

  // Fix T11 (pola R13 "tanpa tulis saat belum siap"): unit belum termuat dan task tidak Manual tersimpan → mode efektif
  // belum pasti, Mulai dikunci (gagal muat tidak mengunci).
  const unitWait = !un.loaded && !un.failed && raw.mode !== "manual";
  const startVal = "start" in d ? d.start : sched.start || "";

  const fields = (
    <div className="plg-timeline-sec-row">
      <label className="plg-timeline-field">
        <span className="plg-timeline-field-label">{SEC_START}</span>
        <input type="date" className="plg-timeline-input" aria-label={SEC_START} value={startVal} disabled={unitWait}
          onChange={onStartChange} onBlur={onStartBlur} onKeyDown={onStartKey} />
      </label>
      <label className="plg-timeline-field">
        <span className="plg-timeline-field-label">{SEC_DUR}</span>
        {durInput}
      </label>
    </div>
  );

  let more = null;
  if (expanded) {
    const warns = [];
    if (late > 0) {
      warns.push(
        <div key="late" className="plg-timeline-sec-warn" role="status">
          <span className="plg-timeline-sec-warn-icon" aria-hidden="true">⚠</span>
          <span className="plg-timeline-sec-warn-text">{secLateText(span.f, late)}</span>
        </div>
      );
    }
    if (violated) {
      warns.push(
        <div key="viol" className="plg-timeline-sec-warn" role="status">
          <span className="plg-timeline-sec-warn-icon" aria-hidden="true">⚠</span>
          <span className="plg-timeline-sec-warn-text">{MSG_VIOLATION}</span>
          <button type="button" className="plg-timeline-btn plg-timeline-sec-shift" onClick={() => writeSched({ start: earliest })}>
            {SEC_SHIFT}
          </button>
        </div>
      );
    }
    more = (
      <div className="plg-timeline-sec-body">
        {modeElOf()}
        <div className="plg-timeline-sec-row">
          <div className="plg-timeline-field">
            <span className="plg-timeline-field-label">{SEC_FINISH}</span>
            <span className="plg-timeline-sec-val" data-field="finish">{span ? TLCal.fmtLong(span.f) : "—"}</span>
          </div>
          <div className="plg-timeline-field">
            <span className="plg-timeline-field-label">{SEC_PCT}</span>
            <span className="plg-timeline-sec-val" data-field="pct">{pctOf(info) + "%"}</span>
            <span className="plg-timeline-sec-hint">{SEC_PCT_HINT}</span>
          </div>
        </div>
        <label className={cx("plg-timeline-sec-check", sched.start === null && "is-disabled")}>
          <input type="checkbox" aria-label={SEC_MILESTONE} checked={milestone} disabled={sched.start === null}
            onChange={(e) => setMilestone(!!(e && e.target && e.target.checked))} />
          <span>{SEC_MILESTONE}</span>
        </label>
        {warns}
        {depView.length || deps.bad ? (
          <div className="plg-timeline-sec-deps">
            <span className="plg-timeline-field-label">{SEC_DEPS}</span>
            {depView.length ? (
              <ul className="plg-timeline-deps">
                {depView.map((v) => {
                  const r = v.row;
                  const dn = "lag:" + r.i;
                  return (
                    <li key={r.i + ":" + r.key} className="plg-timeline-dep" data-key={r.key}>
                      <span className="plg-timeline-dep-main">
                        <span className="plg-timeline-dep-name" title={v.name}>{v.name}</span>
                        {v.outside ? <span className="plg-timeline-dep-note">{SEC_OUTSIDE}</span> : null}
                      </span>
                      <span className="plg-timeline-dep-type">{r.type}</span>
                      <span className="plg-timeline-sec-num">
                        <input type="number" className="plg-timeline-input plg-timeline-num" aria-label={"Jeda setelah " + v.name + " (" + SEC_HK + ")"}
                          min={TLSched.LAG_MIN} max={TLSched.LAG_MAX} step={1} value={dn in d ? d[dn] : String(r.lag)}
                          onChange={(e) => setDraft(dn, e && e.target ? String(e.target.value) : "")}
                          onBlur={(e) => commitLag(r, e && e.target ? e.target.value : "")} onKeyDown={onEnter((val) => commitLag(r, val))} />
                        <span className="plg-timeline-sec-unit">{SEC_HK}</span>
                      </span>
                      <button type="button" className="plg-timeline-dep-del" aria-label={"Hapus dependensi " + v.name} title="Hapus dependensi"
                        onClick={() => removeDep(r)}>×</button>
                    </li>
                  );
                })}
              </ul>
            ) : null}
            {deps.bad ? (
              <div className="plg-timeline-sec-bad">
                <span>{secBadText(deps.bad)}</span>
                <button type="button" className="plg-timeline-btn" onClick={cleanBad}>{SEC_BAD_BTN}</button>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <section className="plg-timeline-section" aria-label={SEC_TITLE} onFocus={refreshSoon} onPointerEnter={refreshSoon}>
      {head(true)}
      {fields}
      {cardEl}
      {more}
      {picker ? null : (
        <div className="plg-timeline-sec-actions">
          <button type="button" className="plg-timeline-sec-link" onClick={openPicker}>{SEC_ADD_DEP}</button>
        </div>
      )}
      {pickerEl}
    </section>
  );
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
  calendarStore, calTarget, projectStore, recordEvent, PRJ_ENTITY, NO_UNIT, useUnits, useEngine, RELOAD_TIMING, engineKeyOf, prefKey, cleanPref, PREF_DEFAULTS, PREF_CHOICES,
  CAL_ENTITY, CAL_MAX_BYTES, MSG_CAL_TOO_LARGE, MSG_CAL_LOST, SEC_TIMING,
  MSG_EMPTY, MSG_VIOLATION, MSG_SCHEDULE_HINT, LEGEND, ZOOMS, COLS_FULL, COLS_COMPACT,
  engine, LOST_TIMING, rowCells, slackText, engineOverlay, NO_OVERLAY, pomoText, missingYearsNote, barGeom, createInteractions, checkLink, isSummaryIn,
  MSG_CHANGED, MSG_UNDO, MSG_SAVE_FAIL, MSG_CYCLE, MSG_MAX_DEPS, MSG_SUMMARY_DEP, MSG_DUP_DEP, MSG_SUMMARY_SCHED,
  TimelineViewBody, ScheduleSection, ScheduleBody, CalendarPopover, ListFallback,
  MoreMenu, menuAlign, UnitPopover, PreviewDialog, PreviewCard, whyText, dialogModel, toolbarSummary, pageUnits, unitCaption, signedHk, scopeFilter, flowItems,
};
if (typeof module !== "undefined" && module.exports) module.exports = Object.assign({}, { TLHolidays, TLCal, TLSched, TLCpm, TLPlan, TLLayout, TLDrag }, pure);

const host = typeof window !== "undefined" ? window : null;
if (host && host.TF && host.TF.plugins) {
  host.TF.plugins.register(manifest, function factory(api) {
    return {
      slots: {
        "taskList.views": [{ id: "gantt", component: TimelineView }],
        "taskDetail.sections": [{ id: "schedule", order: 10, component: ScheduleSection }],
      },
    };
  });
}
