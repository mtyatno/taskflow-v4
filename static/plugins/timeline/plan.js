// Plugin Timeline — TLPlan: rencana tulis murni (spec 1c §5.7, rencana 1c-1 R11, R12, R14, R17; K32–K36).
// Mengubah hasil mesin (TLCpm.run) menjadi daftar item {task, key, before, patch, deltaHk, kind} yang diterapkan UI lewat
// satu api.taskExt.setMany. Murni: tanpa Date, tanpa global, tanpa akses api/store, TIDAK menulis (K27) dan tidak mengubah
// masukan (ctx, tasks, units, patch). Tanggal dijadwalkan HANYA oleh TLCpm.run atas data + patch (aliran = mesin dijalankan
// ulang, bukan dihitung di sini); rumus dependensi lewat TLSched (satu sumber, R4); urutan = result.order (topologis) lalu
// TLCpm.cmpKey. ctx = {tasks, cal, units, readExt} = masukan run().
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
  // Sama dengan isStarted di cpm.js (penanda "sudah mulai" K30).
  const isStarted = (t) => Number(t.progress) > 0 || Number(t.pomodoros_done) > 0;

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

  // Inti aliran (K32): mesin atas data + patch → item = patch (+ start hasil mesin bila task otomatis non-jangkar) ∪
  // turunan otomatis non-jangkar (BFS result.succ dari seeds) yang berubah terhadap nilai tersimpan. Drift di luar
  // turunan tidak ikut. patches: Map<key, {task, patch}>; seedsOf(after) → kunci awal BFS.
  function flow(ctx, patches, units, seedsOf) {
    const c = ctx.cal;
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
  // → {items, gestureCount, over, result: hasil mesin sesudah}. over = turunan berubah > CASCADE_MAX.
  function cascade(ctx, gestures) {
    const patches = new Map();
    for (const g of Array.isArray(gestures) ? gestures : []) {
      const k = g ? keyOf(g.task) : null;
      if (k === null || !isObj(g.patch)) continue;
      const prev = patches.get(k);
      patches.set(k, { task: g.task, patch: Object.assign(prev ? prev.patch : {}, cleanPatch(g.patch)) });
    }
    const r = flow(ctx, patches, ctx.units, () => [...patches.keys()]);
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
  //  - sudah mulai (jangkar "started", atau Manual dengan progress/pomodoro) dan EF < T → Mulai tetap, duration =
  //    hari kerja Mulai..add(T, r − 1), r = max(1, ⌈d × (1 − progress/100)⌉), dijepit ≤ 999;
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
      if (n.fixed === "started" || (n.mode === "manual" && isStarted(task))) {
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
      else if (!n.fixed) patches.set(k, { task, patch: { constraint: { type: "SNET", date: tIso } } });
    }
    const r = flow(ctx, patches, ctx.units, () => [...patches.keys()]);
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
    const u = units instanceof Map ? units.get(SCHED.unitOf(task).recId) : null;
    const unitMode = u && u.auto === true ? "auto" : "manual";
    return { mode: want === unitMode || (want !== "auto" && want !== "manual") ? null : want };
  }

  // preview (K34, R14): model murni pratinjau. result = hasil mesin SESUDAH (mis. cascade().result), before = hasil
  // SEBELUM (null boleh). rows per item (urutan item): {key, task, kind, from, to, deltaHk, durFrom, durTo, isNew,
  // durChanged, durGuess, late}. Selesai project = maks groupEnd kelompok item. notMoved = jangkar bertabrakan
  // ("anchor"/"mfo") dan anggota lingkaran ("cycle") yang terjangkau dari item (turunan + lingkarannya), bukan item.
  // brokenDeps = pelanggaran baru dengan penerus di jangkauan itu. Tanpa teks: "Kenapa" disusun UI dari TLCpm.explain.
  function preview(items, result, ctx, before) {
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
    const near = reach(result, itemKeys, true);
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

  // undoItems (R13): patch = `before` persis (kunci yang dulu tidak ada → null = hapus); urutan item sama.
  function undoItems(items) {
    return (Array.isArray(items) ? items : []).map((it) => ({ taskId: it.task.id, patch: clone(it.before) }));
  }

  return Object.freeze({ CASCADE_MAX, diff, cascade, toggleUnit, reschedule, gesture, modePatch, preview, revalidate, undoItems });
})(
  typeof TLCal !== "undefined" ? TLCal : require("./calendar.js"),
  typeof TLSched !== "undefined" ? TLSched : require("./schedule.js"),
  typeof TLCpm !== "undefined" ? TLCpm : require("./cpm.js"),
);
if (typeof module !== "undefined" && module.exports) module.exports = TLPlan;
