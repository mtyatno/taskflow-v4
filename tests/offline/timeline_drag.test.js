// Plugin Timeline (Fase 1, PR 1b) — Task 5: mesin status seret murni (TLDrag)
// (rencana R2, R3, R7, R13, R15, R21, R23). Semua tanggal tetap; tidak ada Date lokal.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const dir = path.join(__dirname, "../../static/plugins/timeline");
const G = require(path.join(dir, "drag.js"));
const C = require(path.join(dir, "calendar.js"));

const D = (s) => C.dn(s);
const std = () => C.compile(C.DEFAULT_CAL);
const PX = 28;

// Baris tata letak palsu (bentuk TLLayout: key, kind, task, span, sched, outOfRange).
function row(start, duration, over) {
  const c = std();
  const s = D(start);
  const f = C.finish(c, s, duration);
  return {
    key: "1",
    kind: "task",
    task: { id: 1 },
    span: { s, f },
    sched: { start, duration, deps: [], invalidDeps: 0 },
    outOfRange: false,
    ...(over || {}),
  };
}
const run = (state, evs) => evs.reduce((s, e) => G.reduce(s, e), state);
const mouse = (r, kind, x = 100) => G.start({ kind: kind || "move", row: r, sched: r.sched, pointer: { x, y: 10 }, touch: false, t: 0, px: PX });
const touch = (r, kind, x = 100) => G.start({ kind: kind || "move", row: r, sched: r.sched, pointer: { x, y: 10 }, touch: true, t: 0, px: PX });

test("konstanta ambang (R13)", () => {
  assert.equal(G.THRESHOLD_PX, 4);
  assert.equal(G.LONG_PRESS_MS, 350);
  assert.equal(G.TOUCH_SLOP_PX, 8);
  assert.equal(G.EDGE_PX, 8);
  assert.equal(G.EDGE_TOUCH_PX, 16);
});

test("mouse: gerak 3 px lalu up → klik (bukan seret, commit null + click true); 5 px → seret", () => {
  const r = row("2026-11-02", 4);
  const a = run(mouse(r), [{ type: "move", x: 103, t: 10 }]);
  assert.notEqual(a.phase, "drag", "3 px belum seret");
  const a2 = run(a, [{ type: "up", x: 103, inside: true }]);
  assert.equal(a2.click, true);
  assert.equal(G.commit(a2, std()), null);

  const b = run(mouse(r), [{ type: "move", x: 105, t: 10 }]);
  assert.equal(b.phase, "drag");
  const b2 = run(b, [{ type: "up", x: 105 + PX * 2, inside: true }]);
  assert.equal(b2.click, false, "seret bukan klik");
  const cm = G.commit(b2, std());
  assert.ok(cm && cm.patch, "seret menghasilkan commit");
});

test("sentuh: gerak 10 px sebelum 350 ms → gulir (state idle); hold 350 ms lalu gerak → seret", () => {
  const r = row("2026-11-02", 4);
  const a = run(touch(r), [{ type: "move", x: 110, t: 100 }]);
  assert.equal(a.phase, "scroll", "gerak > 8 px sebelum 350 ms = gulir");
  assert.equal(G.commit(run(a, [{ type: "up", x: 110, inside: true }]), std()), null);
  // gerak 6 px (dalam slop) tetap menunggu
  const w = run(touch(r), [{ type: "move", x: 106, t: 100 }]);
  assert.equal(w.phase, "pending");
  // hold terlalu cepat diabaikan
  const early = run(touch(r), [{ type: "hold", t: 200 }]);
  assert.equal(early.armed, false);
  // hold 350 ms lalu gerak → seret
  const b = run(touch(r), [{ type: "hold", t: 350 }, { type: "move", x: 100 + PX * 3, t: 400 }]);
  assert.equal(b.armed, true);
  assert.equal(b.phase, "drag");
  // ketuk singkat → klik
  const tap = run(touch(r), [{ type: "up", x: 101, inside: true, t: 80 }]);
  assert.equal(tap.click, true);
  // tekan lama lalu angkat tanpa gerak → bukan klik
  const lp = run(touch(r), [{ type: "hold", t: 360 }, { type: "up", x: 100, inside: true, t: 500 }]);
  assert.equal(lp.click, false);
  assert.equal(G.commit(lp, std()), null);
});

test("geser jatuh di Sabtu → Senin; durasi 4 hk melewati libur tetap 4 hk; patch hanya start", () => {
  const c = std();
  const r = row("2026-11-02", 4); // Sen 2 Nov
  // +5 hari → Sabtu 7 Nov → Senin 9 Nov
  let s = run(mouse(r), [{ type: "move", x: 100 + PX * 5, t: 10 }, { type: "up", x: 100 + PX * 5, inside: true }]);
  let out = G.commit(s, c);
  assert.deepEqual(out.patch, { start: "2026-11-09" });
  assert.deepEqual(Object.keys(out.patch), ["start"]);
  assert.equal(out.taskId, 1);
  // durasi 4 hk melewati libur (24–25 Des 2026): 23 Des + 4 hk = 23, 28, 29, 30
  const r2 = row("2026-12-14", 4);
  s = run(mouse(r2), [{ type: "move", x: 100 + PX * 9, t: 10 }, { type: "up", x: 100 + PX * 9, inside: true }]); // → Rabu 23 Des
  out = G.commit(s, c);
  assert.deepEqual(out.patch, { start: "2026-12-23" });
  const fin = C.finish(c, D(out.patch.start), 4);
  assert.equal(C.workdays(c, D(out.patch.start), fin), 4, "tetap 4 hari kerja");
  assert.equal(C.iso(fin), "2026-12-30");
  // tooltip sinkron dengan commit
  const live = run(mouse(r2), [{ type: "move", x: 100 + PX * 9, t: 10 }]);
  const pv = G.preview(live, c, { from: D("2026-10-01"), to: D("2027-01-31") }, PX);
  assert.equal(pv.dx, (D("2026-12-23") - D("2026-12-14")) * PX);
  assert.equal(pv.width, (fin - D("2026-12-23") + 1) * PX);
  // mundur melewati akhir pekan: Sen 9 Nov −1 hari = Min 8 Nov → Sen 9 Nov (tidak berubah) → commit null
  const r3 = row("2026-11-09", 3);
  s = run(mouse(r3), [{ type: "move", x: 100 - PX, t: 10 }, { type: "up", x: 100 - PX, inside: true }]);
  assert.equal(G.commit(s, c), null, "jatuh kembali di hari yang sama = tanpa tulis");
  // gerak 0 hari setelah melewati ambang → null
  s = run(mouse(r3), [{ type: "move", x: 105, t: 10 }, { type: "up", x: 105, inside: true }]);
  assert.equal(G.commit(s, c), null);
  // milestone TIDAK dijepret (final review, R6: milestone boleh di hari libur): bergeser per hari kalender
  const rm = row("2026-11-05", 0);
  s = run(mouse(rm), [{ type: "move", x: 100 + PX * 3, t: 10 }, { type: "up", x: 100 + PX * 3, inside: true }]); // Kam 5 + 3 = Min 8
  assert.deepEqual(G.commit(s, c).patch, { start: "2026-11-08" });
  const pvm = G.preview(run(mouse(rm), [{ type: "move", x: 100 + PX * 3, t: 10 }]), c, { from: D("2026-10-01"), to: D("2027-01-31") }, PX);
  assert.equal(pvm.tooltip, "Min 8 Nov · milestone");
  assert.equal(pvm.dx, 3 * PX);
  // milestone di hari libur (Kam 24 Des 2026) digeser +1 → Jum 25 Des (libur) tetap persis
  const rh = row("2026-12-24", 0);
  s = run(mouse(rh), [{ type: "move", x: 100 + PX, t: 10 }, { type: "up", x: 100 + PX, inside: true }]);
  assert.deepEqual(G.commit(s, c).patch, { start: "2026-12-25" });
});

test("resize: tepi kanan, durasi minimum 1; milestone → hitZone edge null", () => {
  const c = std();
  const r = row("2026-11-02", 4); // Sen 2 → Kam 5
  // +2 hari → Sabtu 7 Nov: hari kerja Sen..Jum = 5
  let s = run(mouse(r, "resize"), [{ type: "move", x: 100 + PX * 2, t: 10 }, { type: "up", x: 100 + PX * 2, inside: true }]);
  let out = G.commit(s, c);
  assert.deepEqual(out.patch, { duration: 5 });
  assert.equal(out.taskId, 1);
  // +8 hari → Jum 13 Nov → 10 hk (menghitung hari kerja, bukan hari kalender)
  s = run(mouse(r, "resize"), [{ type: "move", x: 100 + PX * 8, t: 10 }, { type: "up", x: 100 + PX * 8, inside: true }]);
  assert.deepEqual(G.commit(s, c).patch, { duration: 10 });
  // tarik jauh ke kiri → minimum 1
  s = run(mouse(r, "resize"), [{ type: "move", x: 100 - PX * 20, t: 10 }, { type: "up", x: 100 - PX * 20, inside: true }]);
  assert.deepEqual(G.commit(s, c).patch, { duration: 1 });
  // durasi sama → null
  s = run(mouse(r, "resize"), [{ type: "move", x: 105, t: 10 }, { type: "up", x: 105, inside: true }]);
  assert.equal(G.commit(s, c), null);
  // tidak melebihi 999
  s = run(mouse(r, "resize"), [{ type: "move", x: 100 + PX * 5000, t: 10 }, { type: "up", x: 100 + PX * 5000, inside: true }]);
  assert.ok(G.commit(s, c).patch.duration <= 999);

  // milestone: hitZone tidak pernah "edge"; start resize terkunci
  for (const x of [90, 94, 100, 105, 106, 108, 120]) {
    assert.notEqual(G.hitZone({ x, barLeft: 100, barWidth: 0, touch: false, armed: false }), "edge", "x=" + x);
    assert.notEqual(G.hitZone({ x, barLeft: 100, barWidth: 0, touch: true, armed: true }), "edge", "x=" + x);
  }
  const rm = row("2026-11-05", 0);
  const ms = mouse(rm, "resize");
  assert.ok(ms.locked, "milestone tidak bisa di-resize");
  const mm = run(ms, [{ type: "move", x: 140, t: 10 }, { type: "up", x: 140, inside: true }]);
  assert.equal(G.commit(mm, c), null);
});

test("hitZone: badan, tepi 8 px (16 px setelah tekan lama), titik desktop, di luar → null", () => {
  const z = (x, o) => G.hitZone({ x, barLeft: 100, barWidth: 120, touch: false, armed: false, ...(o || {}) });
  assert.equal(z(150), "body");
  assert.equal(z(100), "body");
  assert.equal(z(211), "body");
  assert.equal(z(212), "edge", "8 px terakhir");
  assert.equal(z(220), "edge", "ujung kanan inklusif");
  assert.equal(z(225), "dot", "titik di luar ujung kanan (desktop)");
  assert.equal(z(260), null);
  assert.equal(z(99), null);
  // sentuh: tanpa tekan lama tidak ada tepi/titik; setelah tekan lama tepi 16 px
  assert.equal(z(215, { touch: true, armed: false }), "body");
  assert.equal(z(225, { touch: true, armed: false }), null);
  assert.equal(z(206, { touch: true, armed: true }), "edge");
  assert.equal(z(203, { touch: true, armed: true }), "body");
  assert.equal(z(225, { touch: true, armed: true }), null, "tanpa titik di sentuh");
  // bar sangat pendek: tepi tidak memakan seluruh bar
  assert.equal(G.hitZone({ x: 100, barLeft: 100, barWidth: 12, touch: false }), "body");
  assert.equal(G.hitZone({ x: 111, barLeft: 100, barWidth: 12, touch: false }), "edge");
});

test("link: up di baris lain → {link}; up di baris sendiri / di luar → null", () => {
  const c = std();
  const r = row("2026-11-02", 4, { key: "7", task: { id: 7 } });
  const mk = () => G.start({ kind: "link", row: r, sched: r.sched, pointer: { x: 100, y: 10 }, touch: false, t: 0, px: PX });
  let s = run(mk(), [{ type: "move", x: 140, t: 10 }, { type: "over", rowKey: "9" }, { type: "up", x: 140, inside: true }]);
  assert.deepEqual(G.commit(s, c), { link: { pred: "7", succ: "9" } });
  // baris sendiri
  s = run(mk(), [{ type: "move", x: 140, t: 10 }, { type: "over", rowKey: "7" }, { type: "up", x: 140, inside: true }]);
  assert.equal(G.commit(s, c), null);
  // over terakhir menang: baris lain lalu kembali ke luar baris mana pun
  s = run(mk(), [{ type: "move", x: 140, t: 10 }, { type: "over", rowKey: "9" }, { type: "over", rowKey: null }, { type: "up", x: 140, inside: true }]);
  assert.equal(G.commit(s, c), null);
  // di luar grafik
  s = run(mk(), [{ type: "move", x: 140, t: 10 }, { type: "over", rowKey: "9" }, { type: "up", x: 140, inside: false }]);
  assert.equal(G.commit(s, c), null);
  // baris judul kelompok bukan ujung dependensi
  s = run(mk(), [{ type: "move", x: 140, t: 10 }, { type: "over", rowKey: "g:p:3" }, { type: "up", x: 140, inside: true }]);
  assert.equal(G.commit(s, c), null);
  // tanpa gerak melewati ambang → bukan seret, bukan klik
  s = run(mk(), [{ type: "over", rowKey: "9" }, { type: "up", x: 101, inside: true }]);
  assert.equal(G.commit(s, c), null);
  assert.equal(s.click, false);
  // pratinjau tidak ada untuk link (komponen menggambar garis dari state.x/y)
  assert.equal(G.preview(run(mk(), [{ type: "move", x: 140, y: 40, t: 10 }]), c, { from: 0, to: 9 }, PX), null);
  assert.equal(run(mk(), [{ type: "move", x: 140, y: 40, t: 10 }]).y, 40);
});

test("cancel (Esc) dan up di luar grafik → commit null", () => {
  const c = std();
  const r = row("2026-11-02", 4);
  let s = run(mouse(r), [{ type: "move", x: 100 + PX * 3, t: 10 }, { type: "cancel" }]);
  assert.equal(s.phase, "cancelled");
  assert.equal(G.commit(s, c), null);
  assert.equal(G.preview(s, c, { from: 0, to: 9 }, PX), null);
  // peristiwa setelah batal diabaikan (lepas tidak menghidupkan lagi)
  s = run(s, [{ type: "move", x: 300, t: 20 }, { type: "up", x: 300, inside: true }]);
  assert.equal(s.phase, "cancelled");
  assert.equal(G.commit(s, c), null);
  // lepas di luar grafik
  s = run(mouse(r), [{ type: "move", x: 100 + PX * 3, t: 10 }, { type: "up", x: 100 + PX * 3, inside: false }]);
  assert.equal(G.commit(s, c), null);
  assert.equal(s.click, false);
  s = run(mouse(r, "resize"), [{ type: "move", x: 100 + PX * 3, t: 10 }, { type: "up", x: 100 + PX * 3, inside: false }]);
  assert.equal(G.commit(s, c), null);
  // sebelum dilepas (masih seret) commit juga null: hanya `up` yang menulis
  s = run(mouse(r), [{ type: "move", x: 100 + PX * 3, t: 10 }]);
  assert.equal(G.commit(s, c), null);
  // satu kali: commit dari state yang sama selalu hasil sama (murni)
  const u = run(s, [{ type: "up", x: 100 + PX * 3, inside: true }]);
  assert.deepEqual(G.commit(u, c), G.commit(u, c));
});

test("prev memuat nilai lama persis (kunci yang tidak ada → null) untuk Urungkan", () => {
  const c = std();
  const r = row("2026-11-02", 4);
  let s = run(mouse(r), [{ type: "move", x: 100 + PX * 7, t: 10 }, { type: "up", x: 100 + PX * 7, inside: true }]);
  let out = G.commit(s, c);
  assert.deepEqual(out.patch, { start: "2026-11-09" });
  assert.deepEqual(out.prev, { start: "2026-11-02" });
  // resize: durasi ada → nilai lama
  s = run(mouse(r, "resize"), [{ type: "move", x: 100 + PX * 3, t: 10 }, { type: "up", x: 100 + PX * 3, inside: true }]);
  out = G.commit(s, c);
  assert.deepEqual(out.patch, { duration: 5 });
  assert.deepEqual(out.prev, { duration: 4 });
  // resize: kunci durasi tidak ada di ext (sched.raw dari api.taskExt.read) → prev null, bukan bawaan 1
  const r2 = row("2026-11-02", 1);
  const rawSched = { ...r2.sched, raw: { start: "2026-11-02" } };
  s = G.start({ kind: "resize", row: r2, sched: rawSched, pointer: { x: 100, y: 10 }, touch: false, t: 0, px: PX });
  s = run(s, [{ type: "move", x: 100 + PX * 3, t: 10 }, { type: "up", x: 100 + PX * 3, inside: true }]);
  out = G.commit(s, c);
  assert.deepEqual(out.patch, { duration: 4 });
  assert.deepEqual(out.prev, { duration: null });
  // prev tidak memuat kunci lain (tidak menimpa deps)
  assert.deepEqual(Object.keys(out.prev), ["duration"]);
  // klik-jadwalkan: tidak ada kunci sebelumnya → semuanya null
  const x = G.scheduleAt(c, D("2026-11-07"), { start: null, duration: null, deps: [] });
  assert.deepEqual(x.patch, { start: "2026-11-09", duration: 1 });
  assert.deepEqual(x.prev, { start: null, duration: null });
  assert.equal(G.scheduleAt(c, D("2026-11-07"), r.sched), null, "sudah terjadwal: bukan klik-jadwalkan");
  assert.equal(G.scheduleAt(c, NaN, { start: null, duration: null }), null);
});

test("tooltip 'Sen 9 Nov → Kam 12 Nov · 4 hk'", () => {
  const c = std();
  const rng = { from: D("2026-10-01"), to: D("2026-12-31") };
  const r = row("2026-11-02", 4);
  const s = run(mouse(r), [{ type: "move", x: 100 + PX * 7, t: 10 }]);
  const pv = G.preview(s, c, rng, PX);
  assert.equal(pv.tooltip, "Sen 9 Nov → Kam 12 Nov · 4 hk");
  assert.equal(pv.dx, 7 * PX);
  assert.equal(pv.width, 4 * PX);
  // resize: hari kerja
  const s2 = run(mouse(r, "resize"), [{ type: "move", x: 100 + PX * 8, t: 10 }]);
  const pv2 = G.preview(s2, c, rng, PX);
  assert.equal(pv2.tooltip, "Sen 2 Nov → Jum 13 Nov · 10 hk");
  assert.equal(pv2.dx, 0);
  assert.equal(pv2.width, 12 * PX, "bar membentang dari Sen 2 s.d. Jum 13 Nov (12 hari kalender)");
  // milestone
  const pv3 = G.preview(run(mouse(row("2026-11-05", 0)), [{ type: "move", x: 100 + PX * 2, t: 10 }]), c, rng, PX);
  assert.equal(pv3.tooltip, "Sab 7 Nov · milestone", "milestone tidak dijepret ke hari kerja");
  assert.equal(pv3.width, 0);
  // belum seret → null
  assert.equal(G.preview(mouse(r), c, rng, PX), null);
});

test("keyStep Alt+→ geser 1 hk (lewati libur), Alt+Shift+← durasi − 1 berhenti di 1; tanpa jadwal → null", () => {
  const c = std();
  const sc = (start, duration) => ({ start, duration, deps: [], invalidDeps: 0 });
  // Jum 6 Nov → Sen 9 Nov
  let k = G.keyStep({ key: "ArrowRight", alt: true, shift: false }, sc("2026-11-06", 3), c);
  assert.deepEqual(k.patch, { start: "2026-11-09" });
  assert.deepEqual(k.prev, { start: "2026-11-06" });
  // lewati libur: Rab 23 Des 2026 → 24 & 25 libur → Senin 28 Des
  k = G.keyStep({ key: "ArrowRight", alt: true }, sc("2026-12-23", 2), c);
  assert.deepEqual(k.patch, { start: "2026-12-28" });
  // Alt+← : Sen 9 Nov → Jum 6 Nov
  k = G.keyStep({ key: "ArrowLeft", alt: true, shift: false }, sc("2026-11-09", 3), c);
  assert.deepEqual(k.patch, { start: "2026-11-06" });
  // durasi
  k = G.keyStep({ key: "ArrowRight", alt: true, shift: true }, sc("2026-11-09", 3), c);
  assert.deepEqual(k.patch, { duration: 4 });
  assert.deepEqual(k.prev, { duration: 3 });
  k = G.keyStep({ key: "ArrowLeft", alt: true, shift: true }, sc("2026-11-09", 2), c);
  assert.deepEqual(k.patch, { duration: 1 });
  assert.equal(G.keyStep({ key: "ArrowLeft", alt: true, shift: true }, sc("2026-11-09", 1), c), null, "berhenti di 1");
  assert.equal(G.keyStep({ key: "ArrowRight", alt: true, shift: true }, sc("2026-11-09", 999), c), null, "maks 999");
  // milestone: geser boleh (per hari kalender, tanpa jepret — final review), durasi tidak
  assert.deepEqual(G.keyStep({ key: "ArrowRight", alt: true }, sc("2026-11-05", 0), c).patch, { start: "2026-11-06" });
  assert.deepEqual(G.keyStep({ key: "ArrowRight", alt: true }, sc("2026-11-06", 0), c).patch, { start: "2026-11-07" }, "Jum → Sab");
  assert.deepEqual(G.keyStep({ key: "ArrowLeft", alt: true }, sc("2026-11-09", 0), c).patch, { start: "2026-11-08" }, "Sen → Min");
  assert.deepEqual(G.keyStep({ key: "ArrowRight", alt: true }, sc("2026-12-24", 0), c).patch, { start: "2026-12-25" }, "libur → libur");
  assert.equal(G.keyStep({ key: "ArrowRight", alt: true, shift: true }, sc("2026-11-05", 0), c), null);
  // prev: kunci durasi tidak ada di ext (raw) → null
  k = G.keyStep({ key: "ArrowRight", alt: true, shift: true }, { ...sc("2026-11-09", 1), raw: { start: "2026-11-09" } }, c);
  assert.deepEqual(k.patch, { duration: 2 });
  assert.deepEqual(k.prev, { duration: null });
  // tanpa jadwal / tanpa Alt / tombol lain → null
  assert.equal(G.keyStep({ key: "ArrowRight", alt: true }, sc(null, null), c), null);
  assert.equal(G.keyStep({ key: "ArrowRight", alt: true }, null, c), null);
  assert.equal(G.keyStep({ key: "ArrowRight", alt: false }, sc("2026-11-09", 3), c), null);
  assert.equal(G.keyStep({ key: "ArrowUp", alt: true }, sc("2026-11-09", 3), c), null);
  assert.equal(G.keyStep({ key: "Enter", alt: true }, sc("2026-11-09", 3), c), null);
});

test("baris terkunci: ringkasan, di luar rentang, tanpa jadwal, judul kelompok → klik saja, tidak seret", () => {
  const c = std();
  const cases = [
    row("2026-11-02", 4, { kind: "summary" }),
    row("2026-11-02", 4, { outOfRange: true }),
    row("2026-11-02", 4, { kind: "group", key: "g:none", task: null }),
    { ...row("2026-11-02", 4), span: null, sched: { start: null, duration: null, deps: [] } },
  ];
  for (const r of cases) {
    for (const kind of ["move", "resize", "link"]) {
      const s = G.start({ kind, row: r, sched: r.sched, pointer: { x: 100, y: 10 }, touch: false, t: 0, px: PX });
      assert.ok(s.locked, `${r.kind}/${kind} terkunci`);
      const d = run(s, [{ type: "move", x: 100 + PX * 3, t: 10 }, { type: "up", x: 100 + PX * 3, inside: true }]);
      assert.notEqual(d.phase, "drag");
      assert.equal(G.commit(d, c), null);
    }
  }
  // ketuk pada ringkasan tetap klik (membuka task)
  const s = G.start({ kind: "move", row: cases[0], sched: cases[0].sched, pointer: { x: 100, y: 10 }, touch: false, t: 0, px: PX });
  assert.equal(run(s, [{ type: "up", x: 101, inside: true }]).click, true);
});

test("TL_CAL_LOOP tidak pernah dilempar: reducer murni, preview/commit/keyStep turun ke null", () => {
  const off = new Set();
  for (let d = D("2026-01-01"); d <= D("2070-01-01"); d++) off.add(d);
  const dead = { mask: new Set([1]), off, work: new Set(), key: "mati" };
  const r = row("2026-11-02", 4);
  let s;
  assert.doesNotThrow(() => {
    s = run(mouse(r), [{ type: "move", x: 100 + PX * 3, t: 10 }, { type: "up", x: 100 + PX * 3, inside: true }]);
  });
  assert.doesNotThrow(() => G.commit(s, dead));
  assert.equal(G.commit(s, dead), null);
  const d2 = run(mouse(r, "resize"), [{ type: "move", x: 100 + PX * 3, t: 10 }]);
  assert.equal(G.preview(d2, dead, { from: 0, to: 9 }, PX), null);
  assert.equal(G.keyStep({ key: "ArrowRight", alt: true }, r.sched, dead), null);
  assert.equal(G.scheduleAt(dead, D("2026-11-07"), { start: null, duration: null }), null);
});

test("reducer: murni (tidak mengubah state masukan), masukan rusak diabaikan", () => {
  const r = row("2026-11-02", 4);
  const s0 = mouse(r);
  const snap = JSON.stringify(s0);
  const s1 = G.reduce(s0, { type: "move", x: 200, t: 5 });
  assert.equal(JSON.stringify(s0), snap, "state lama tidak berubah");
  assert.notEqual(s1, s0);
  assert.equal(G.reduce(s0, null), s0);
  assert.equal(G.reduce(s0, { type: "zzz" }), s0);
  assert.equal(G.reduce(s0, { type: "move", x: NaN, t: 1 }), s0);
  assert.equal(G.reduce(null, { type: "move", x: 1 }), null);
  // px tidak sah → tidak ada commit
  const bad = G.start({ kind: "move", row: r, sched: r.sched, pointer: { x: 100, y: 10 }, touch: false, t: 0, px: 0 });
  const u = run(bad, [{ type: "move", x: 300, t: 5 }, { type: "up", x: 300, inside: true }]);
  assert.equal(G.commit(u, std()), null);
});

test("hold dapat mengganti jenis ke resize (sentuh: tepi 16 px baru aktif setelah tekan lama)", () => {
  const c = std();
  const r = row("2026-11-02", 4);
  const s = run(touch(r, "move"), [{ type: "hold", t: 360, kind: "resize" }, { type: "move", x: 100 + PX * 3, t: 400 }, { type: "up", x: 100 + PX * 3, inside: true }]);
  assert.equal(s.kind, "resize");
  assert.deepEqual(G.commit(s, c).patch, { duration: 5 });
  // milestone: ganti ke resize ditolak, tetap move
  const m = run(touch(row("2026-11-05", 0), "move"), [{ type: "hold", t: 360, kind: "resize" }]);
  assert.equal(m.kind, "move");
});

test("berkas: pola R2 (const TLDrag IIFE, TLCal/TLSched via typeof/require, tanpa global, export Node, beku)", () => {
  const src = fs.readFileSync(path.join(dir, "drag.js"), "utf8");
  assert.match(src, /const TLDrag = \(function/);
  assert.match(src, /typeof TLCal !== "undefined" \? TLCal : require\("\.\/calendar\.js"\)/);
  assert.match(src, /typeof TLSched !== "undefined" \? TLSched : require\("\.\/schedule\.js"\)/);
  assert.match(src, /module\.exports = TLDrag/);
  assert.doesNotMatch(src, /\bwindow\b|\bself\b|\bglobalThis\b/);
  assert.ok(Object.isFrozen(G));
});
