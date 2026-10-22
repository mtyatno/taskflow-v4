"use strict";

// Kartu Pomodoro ringkas di HP (desain pemilik 2026-10-22): tab mode + durasi, Zen + pil suara
// (popover pilihan suara + volume), lingkaran kecil + tombol, baris task aktif + Selesai,
// statistik ringkas + project, kolom parkir dengan ikon ✨ dan tombol kirim. Desktop tidak berubah.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const indexHtml = fs.readFileSync(path.resolve(__dirname, "../../static/index.html"), "utf8").replace(/\r\n/g, "\n");
const appCss = fs.readFileSync(path.resolve(__dirname, "../../static/app.css"), "utf8").replace(/\r\n/g, "\n");

function fnSource(name) {
  const start = indexHtml.indexOf(`\nfunction ${name}(`);
  assert.ok(start >= 0, `${name} must exist`);
  const end = indexHtml.indexOf("\n}\n", start + 1);
  assert.ok(end > start, `${name} end must be found`);
  return indexHtml.slice(start, end);
}
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const rule = (sel, src = appCss) => {
  const m = src.match(new RegExp(`(^|\\n)\\s*${esc(sel)} \\{([^}]*)\\}`));
  assert.ok(m, `CSS rule ${sel} must exist`);
  return m[2];
};
function mobileBlock() {
  const marker = "/* Kartu Pomodoro ringkas di HP */";
  const i = appCss.indexOf(marker);
  assert.ok(i >= 0, "blok CSS kartu Pomodoro ringkas di HP");
  const start = appCss.indexOf("@media (max-width: 768px) {", i);
  assert.ok(start > i && start - i < 400, "blok @media (max-width: 768px) tepat setelah penanda");
  return appCss.slice(start, appCss.indexOf("\n}\n", start));
}

test("VIEW_GLYPHS: ikon sparkles (duotone) dan send untuk kolom parkir", () => {
  const start = indexHtml.indexOf("const VIEW_GLYPHS = {");
  const block = indexHtml.slice(start, indexHtml.indexOf("\n};", start));
  const sparkles = block.match(/\n  sparkles: '([^']*)'/);
  assert.ok(sparkles, "VIEW_GLYPHS.sparkles");
  assert.match(sparkles[1], /fill-opacity="\.22"/);
  assert.ok(/\n  send: '</.test(block), "VIEW_GLYPHS.send");
});

test("PomoModeSwitch: durasi tiap mode (menit) dari POMO_DURATIONS di span pomo-mode-min", () => {
  const src = fnSource("PomoModeSwitch");
  assert.ok(src.includes("pomo-mode-min"));
  assert.ok(src.includes("POMO_DURATIONS[m.key]"));
  assert.match(src, /Math\.round\(POMO_DURATIONS\[m\.key\] \/ 60\)/);
});

test("PomoAmbientPill: pil 🎧 + popover pilihan suara (radio) + volume, Esc & ketuk di luar menutup", () => {
  const src = fnSource("PomoAmbientPill");
  for (const needle of [
    "pomo-amb-mobile", "pomo-amb-pill", "pomo-amb-pop", "pomo-amb-opt", "pomo-amb-volume",
    '"aria-haspopup": "dialog"', '"aria-expanded"', 'role: "dialog"', 'role: "radiogroup"', 'role: "radio"',
    '"aria-checked"', '"Suara latar"', '"Volume suara latar"', "aria-valuetext", "window.TF.ambient.SOUNDS",
    '"Escape"', "pointerdown", "data-state", 'name: "headphones"'
  ]) assert.ok(src.includes(needle), `PomoAmbientPill harus memuat ${needle}`);
  // volume nonaktif saat Off, perubahan lewat handler yang sama dengan kontrol desktop
  assert.ok(src.includes('disabled: sound === "off"'));
  assert.ok(src.includes("a.onSound") && src.includes("a.onVolume"));
});

test("PomodoroTimer: Zen + pil suara di baris atas, Selesai di baris task, statistik ringkas + project", () => {
  const src = fnSource("PomodoroTimer");
  const sig = src.slice(0, src.indexOf(") {"));
  assert.ok(sig.includes("onCompleteTask"), "prop onCompleteTask");
  assert.ok(src.includes("focus-pomo-headline"), "judul + subjudul dibungkus (disembunyikan di HP)");
  const tools = src.slice(src.indexOf("focus-pomo-head-tools"));
  assert.ok(tools.indexOf("focus-zen-btn") < tools.indexOf("PomoAmbientPill") && tools.indexOf("PomoAmbientPill") < tools.indexOf("PomoModeSwitch"),
    "urutan alat: Zen, pil suara, mode");
  for (const needle of ["focus-pomo-task-dot", "focus-pomo-task-done-btn", '"Selesai"', "onCompleteTask(focusTask)",
    "focus-pomo-stats-project", '"Pomo"', '"Fokus"', '"Set"', "is-short", "is-long"]) {
    assert.ok(src.includes(needle), `PomodoroTimer harus memuat ${needle}`);
  }
  assert.ok(src.includes('"aria-label": `Tandai selesai: ${focusTask.title}`'), "label aksesibel tombol Selesai");
});

test("PomoParkInput: ikon ✨ dan tombol kirim (sama dengan Enter)", () => {
  const src = fnSource("PomoParkInput");
  assert.ok(src.includes("pomo-park-icon"));
  assert.ok(src.includes('name: "sparkles"'));
  assert.ok(src.includes("pomo-park-send"));
  assert.ok(src.includes('"aria-label": "Simpan ke Inbox"'));
  assert.match(src, /className: "pomo-park-send"[\s\S]{0,200}onClick: park/);
  // HP: placeholder pendek (desktop tetap kalimat panjang)
  assert.ok(src.includes('window.matchMedia("(max-width: 768px)")'));
  assert.ok(src.includes('"Ada pikiran lewat? Ketik & Enter ke Inbox..."'));
  assert.ok(src.includes('"Ada pikiran lewat? Ketik & tekan Enter untuk simpan ke Inbox..."'));
});

test("TodayFocusView: Selesai di kartu Pomodoro memakai handleTaskDone", () => {
  const src = fnSource("TodayFocusView");
  assert.match(src, /onCompleteTask: t => handleTaskDone\(t\.id\)/);
});

test("app.css: elemen khusus HP tersembunyi di desktop", () => {
  const hidden = rule(".pomo-mode-min, .pomo-amb-mobile, .focus-pomo-task-dot, .focus-pomo-task-done-btn, .focus-pomo-stats-project, .focus-pomo-stat-label .is-short, .pomo-park-icon, .pomo-park-send");
  assert.match(hidden, /display: none/);
});

test("app.css: kartu ringkas di HP — grid 4 kolom, area, lingkaran kecil, tanpa judul", () => {
  const m = mobileBlock();
  const card = rule(".focus-pomo", m);
  assert.match(card, /grid-template-areas: "modes modes zen amb" "ring ctrl ctrl ctrl" "ring task task task" "stats stats stats stats" "park park park park"/);
  assert.match(card, /overflow: visible/, "popover suara tidak terpotong kartu");
  assert.match(rule(".focus-pomo::before", m), /display: none/);
  assert.match(rule(".focus-pomo .focus-pomo-body, .focus-pomo .focus-pomo-head, .focus-pomo .focus-pomo-head-tools", m), /display: contents/);
  assert.match(rule(".focus-pomo-headline", m), /display: none/);
  const ring = rule(".focus-pomo-ring", m);
  assert.match(ring, /grid-area: ring/);
  assert.match(ring, /width: 72px/);
  assert.match(rule(".focus-pomo-ring .pomo-ring-svg", m), /width: 72px/);
  for (const [sel, area] of [[".focus-pomo-head-tools .pomo-modes", "modes"], [".focus-pomo .focus-zen-btn", "zen"], [".pomo-amb-mobile", "amb"],
    [".focus-pomo .pomo-controls", "ctrl"], [".focus-pomo-task, .focus-pomo-hint", "task"], [".focus-pomo-stats", "stats"], [".focus-pomo .pomo-park", "park"]]) {
    assert.match(rule(sel, m), new RegExp(`grid-area: ${area}`), sel);
  }
  // disembunyikan di HP
  assert.match(rule(".focus-pomo-stats .pomo-ambient, .focus-pomo-task-icon, .focus-pomo-task-kicker, .focus-pomo-task-count, .focus-pomo-stat-label .is-long", m), /display: none/);
  // ditampilkan di HP
  assert.match(rule(".focus-pomo .pomo-mode-min, .focus-pomo-task-dot, .pomo-park-icon, .pomo-park-send", m), /display: (block|inline-flex)/);
  assert.match(rule(".pomo-amb-pop", m), /position: absolute/);
  assert.match(rule(".focus-pomo-task-done-btn", m), /#4ade80/);
});

test("app.css: kartu ringkas tetap menghormati reduced-motion dan bar ringkas tidak menampilkan durasi", () => {
  assert.ok(!/\.focus-mini [^{]*\.pomo-mode-min \{[^}]*display: (block|inline)/.test(appCss), "durasi tidak tampil di bar ringkas");
  const blocks = [...appCss.matchAll(/\n@media \(prefers-reduced-motion: reduce\) \{\n((?:  .*\n)+)\}/g)].map(m => m[1]);
  assert.ok(blocks.some(b => b.includes(".pomo-amb-pop { animation: none; }")), "animasi popover suara mati saat reduced-motion");
});
