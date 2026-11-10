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
