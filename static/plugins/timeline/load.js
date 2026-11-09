// Plugin Timeline — TLLoad: mesin Beban Tim murni (spec 1d §5.1–§5.2, K45–K50; rencana 1d-1 R1–R3, R6, R8, R9).
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
  });
})(
  typeof TLCal !== "undefined" ? TLCal : require("./calendar.js"),
  typeof TLSched !== "undefined" ? TLSched : require("./schedule.js"),
  typeof TLCpm !== "undefined" ? TLCpm : require("./cpm.js"),
);
if (typeof module !== "undefined" && module.exports) module.exports = TLLoad;
