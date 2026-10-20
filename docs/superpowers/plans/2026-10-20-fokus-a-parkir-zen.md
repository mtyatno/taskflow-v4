# Fokus Hari Ini — PR A: Parkir Distraksi + Mode Zen — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Kartu Pomodoro di halaman Fokus Hari Ini mendapat input "Parkir Distraksi" (Enter → task Inbox tanpa modal), dan halaman mendapat toggle Mode Zen yang menyembunyikan task lain selama Work berjalan.

**Architecture:** Logika murni (payload parkir, kapan Zen aktif, preferensi Zen di localStorage) ada di modul UMD baru `static/offline/focuspage.js` yang diuji node. UI tetap di `static/index.html`: komponen baru `PomoParkInput` di dalam `PomodoroTimer`, dan tombol Zen + kelas CSS di `PomodoroTimer` / `TodayFocusView` / `FocusTaskItem`. Data tidak disentuh; Zen murni kelas CSS.

**Tech Stack:** React tanpa JSX (`React.createElement`) di `static/index.html`, CSS `static/app.css`, modul UMD `static/offline/*.js`, `node --test`, Playwright (Python) untuk E2E lokal.

**Spec:** `docs/superpowers/specs/2026-10-20-fokus-hari-ini-enhancement-design.md` (§7.1, §7.3, D1, D13; PR A di §10).

## Global Constraints

- Placeholder input persis: `Ada pikiran lewat? Ketik & tekan Enter untuk simpan ke Inbox...`
- Body task parkir persis: `{title, gtd_status: "inbox", priority: "P2", deadline: null}` lewat `api.post("/api/tasks", …)`, lalu `window.__refreshTasks()`.
- `maxLength` 200; `aria-label` "Parkir distraksi ke Inbox"; `aria-live` "Tersimpan ke Inbox"; centang hijau 1500 ms; gagal → toast "Gagal menyimpan ke Inbox".
- Zen: key `localStorage["tf_focus_zen"]` (`"1"`/`"0"`), default mati; tooltip "Mode Zen: sembunyikan task lain saat Work berjalan"; ikon `fEye`; catatan "Mode Zen · n task lain disembunyikan sampai istirahat"; fade ≈ 250 ms; `prefers-reduced-motion` → tanpa animasi.
- Zen aktif = toggle menyala **dan** `timer.mode === "work"` **dan** `timer.isRunning`.
- Kode ditulis gaya berkas yang ada (React.createElement, tanpa JSX). Setiap akses `localStorage` dibungkus try/catch.
- Rilis: SW + `app.css?v=` naik ke nomor kosong berikutnya di atas `main` saat itu (sekarang `main` = `taskflow-v433-manage-workspace-icons` / `app.css?v=341` → **v434 `taskflow-v434-focus-park-zen`, `?v=342`**). Ubah ketiga tempat: `static/sw.js` `CACHE`, `window.__SW_VERSION` + teks fallback Settings di `static/index.html`, dan `<link … app.css?v=>`.

## Review Focus

1. **Enter saat komposisi IME** (keyboard Android/IME) tidak boleh mengirim — test sumber di Task 2.
2. **Enter beruntun cepat / tombol ditahan** → tepat satu task dibuat — test sumber (guard `busy`) di Task 2 + skenario E2E di Task 4.
3. **Teks hanya spasi atau > 200 karakter** → tidak ada request / judul dipotong 200 — unit test `parkPayload` di Task 1.
4. **localStorage melempar (mode privat, kuota)** → Zen dianggap mati, menulis tidak melempar — unit test di Task 1.
5. **Mengetik di input memicu shortcut keyboard global** → `onKeyDown` menghentikan propagasi — test sumber di Task 2.

---

### Task 1: Modul murni `focuspage.js`

**Files:**
- Create: `static/offline/focuspage.js`
- Modify: `static/index.html` (tag `<script src="/static/offline/focuspage.js"></script>` setelah baris `introgate.js`, ~300)
- Modify: `static/sw.js` (tambah `"/static/offline/focuspage.js"` ke `STATIC`)
- Test: `tests/offline/focuspage.test.js`

**Interfaces:**
- Produces (`root.TF.focuspage`, juga `module.exports`):
  - `parkPayload(text: string) -> {title: string, gtd_status: "inbox", priority: "P2", deadline: null} | null` — trim; kosong → `null`; judul dipotong 200 karakter.
  - `zenActive({enabled: boolean, mode: string, isRunning: boolean}) -> boolean`
  - `readZenPref(storage) -> boolean` — `storage.getItem("tf_focus_zen") === "1"`; apa pun yang melempar → `false`.
  - `writeZenPref(storage, on: boolean) -> void` — menulis `"1"`/`"0"`; tidak pernah melempar.
  - `ZEN_KEY = "tf_focus_zen"`, `PARK_MAX = 200`.

- [ ] **Step 1: Tulis test yang gagal**

```js
const fp = require("../../static/offline/focuspage.js");
test("parkPayload: trim + inbox P2 tanpa deadline", () => {
  assert.deepEqual(fp.parkPayload("  telepon Budi  "),
    { title: "telepon Budi", gtd_status: "inbox", priority: "P2", deadline: null });
});
test("parkPayload: kosong/spasi → null", () => {
  assert.equal(fp.parkPayload(""), null); assert.equal(fp.parkPayload("   \n "), null);
  assert.equal(fp.parkPayload(null), null);
});
test("parkPayload: dipotong 200", () => { assert.equal(fp.parkPayload("x".repeat(250)).title.length, 200); });
test("zenActive hanya saat enabled + work + running", () => {
  assert.equal(fp.zenActive({ enabled: true, mode: "work", isRunning: true }), true);
  assert.equal(fp.zenActive({ enabled: false, mode: "work", isRunning: true }), false);
  assert.equal(fp.zenActive({ enabled: true, mode: "shortBreak", isRunning: true }), false);
  assert.equal(fp.zenActive({ enabled: true, mode: "longBreak", isRunning: true }), false);
  assert.equal(fp.zenActive({ enabled: true, mode: "work", isRunning: false }), false);
});
test("pref Zen: default mati, baca/tulis, storage melempar", () => {
  const m = new Map(); const st = { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v) };
  assert.equal(fp.readZenPref(st), false);
  fp.writeZenPref(st, true); assert.equal(m.get("tf_focus_zen"), "1"); assert.equal(fp.readZenPref(st), true);
  fp.writeZenPref(st, false); assert.equal(fp.readZenPref(st), false);
  const bad = { getItem() { throw new Error("x"); }, setItem() { throw new Error("x"); } };
  assert.equal(fp.readZenPref(bad), false); assert.doesNotThrow(() => fp.writeZenPref(bad, true));
  assert.equal(fp.readZenPref(undefined), false);
});
```

- [ ] **Step 2: Jalankan, pastikan gagal** — `node --test tests/offline/focuspage.test.js` → FAIL (modul tidak ada).
- [ ] **Step 3: Buat `static/offline/focuspage.js`** dengan pembungkus UMD yang sama seperti `outbox.js` (`root.TF.focuspage = exported`).
- [ ] **Step 4: Jalankan, pastikan lulus** — perintah sama → PASS.
- [ ] **Step 5: Tambah tag script + entri SW `STATIC`; test sumber** di file yang sama: `indexHtml` memuat `src="/static/offline/focuspage.js"` dan `sw.js` memuat `"/static/offline/focuspage.js"`. Jalankan → PASS.
- [ ] **Step 6: Commit** — `git commit -m "feat(focus): modul focuspage (payload parkir, status Zen, preferensi)"`

---

### Task 2: Parkir Distraksi di kartu Pomodoro

**Files:**
- Modify: `static/index.html` — komponen baru `function PomoParkInput()` tepat sebelum `function PomodoroTimer(`; `PomodoroTimer` merender `React.createElement(PomoParkInput, null)` **tepat sebelum** cabang `focusTask ? … "focus-pomo-task" … : … "focus-pomo-hint"`.
- Modify: `static/app.css` — gaya `.pomo-park*` dekat `.focus-pomo-task` (~3488) + `order` di blok ≤ 768 px (~3630: input `order: 4`, task/hint naik ke `order: 5`, stats `order: 6`).
- Test: `tests/offline/focus_park_input.test.js` (gaya `fnSource` seperti `tasklist_focus_btn.test.js`)

**Interfaces:**
- Consumes: `TF.focuspage.parkPayload` (Task 1); `api.post`, `window.__refreshTasks`, `window.__showToast`.
- Produces: kelas DOM `.pomo-park`, `.pomo-park-input`, `.pomo-park-ok` (dipakai E2E Task 4).

Perilaku `PomoParkInput` (state lokal `text`, `status: "idle"|"ok"|"error"`, ref `busy`):
- `onKeyDown`: selalu `e.stopPropagation()`. Enter dengan `e.nativeEvent.isComposing` atau `e.keyCode === 229` → abaikan. Enter lain: `preventDefault`; bila `busy` → abaikan; `parkPayload(text)` null → abaikan; else `busy=true`, `await api.post("/api/tasks", body)`, sukses → `setText("")`, `status "ok"`, `window.__refreshTasks?.()`, kembali `"idle"` setelah 1500 ms (timer dibersihkan saat unmount); gagal → `status "error"`, teks tetap, `window.__showToast?.("Gagal menyimpan ke Inbox", "error")`; `finally busy=false`.
- Esc → `setText("")` lalu `e.target.blur()`.
- Ketik saat `status === "error"` → kembali `"idle"`.
- Render: `div.pomo-park` (+ ` is-ok`/` is-error`) berisi `input.pomo-park-input` (type text, placeholder, `maxLength: 200`, `aria-label`, `enterKeyHint: "done"`), `span.pomo-park-ok` (`aria-hidden`, glyph centang, tampil hanya `is-ok`), dan `span.sr-only` `aria-live="polite"` berisi "Tersimpan ke Inbox" saat `ok` (cek apakah kelas `sr-only`/`visually-hidden` sudah ada di app.css; bila tidak, tambahkan).
- CSS: latar transparan, `border: 0; border-bottom: 1px solid rgba(255,255,255,.18)`, teks `#fff`, placeholder `rgba(255,255,255,.5)`, fokus → garis bawah `rgba(255,255,255,.45)`; `is-error` → garis bawah `#f87171`; `.pomo-park-ok` hijau `#4ade80` dengan animasi pop-in singkat (tanpa animasi di `prefers-reduced-motion`).

- [ ] **Step 1: Tulis test sumber yang gagal** — `fnSource("PomoParkInput")` memuat: placeholder persis; `maxLength: 200`; `"aria-label": "Parkir distraksi ke Inbox"`; `e.stopPropagation()`; `isComposing` dan `229`; `parkPayload(`; `api.post("/api/tasks"`; `__refreshTasks`; `1500`; `"Gagal menyimpan ke Inbox"`; `"Tersimpan ke Inbox"`; guard `busy` dicek sebelum `api.post`. `fnSource("PomodoroTimer")`: `React.createElement(PomoParkInput` muncul sebelum `"focus-pomo-task"` dan sebelum `"focus-pomo-hint"`. `appCss` memuat `.pomo-park-input` dan, di blok `max-width: 768px`, `.pomo-park` dengan `order: 4`.
- [ ] **Step 2: Jalankan → FAIL** — `node --test tests/offline/focus_park_input.test.js`
- [ ] **Step 3: Implementasi komponen + CSS** sesuai perilaku di atas.
- [ ] **Step 4: Jalankan → PASS**, lalu `node temporary_files/check_inline_scripts.js` (sintaks script inline) → tanpa error.
- [ ] **Step 5: Commit** — `git commit -m "feat(focus): Parkir Distraksi di kartu Pomodoro"`

---

### Task 3: Mode Zen

**Files:**
- Modify: `static/index.html`:
  - `PomodoroTimer` — props baru `zenEnabled`, `onToggleZen`; di `.focus-pomo-head`, bungkus `PomoModeSwitch` dalam `div.focus-pomo-head-tools` yang diawali tombol Zen (hanya bila `onToggleZen` ada).
  - `TodayFocusView` — state `zenEnabled` (init `TF.focuspage.readZenPref(window.localStorage)`), `toggleZen` (balik + `writeZenPref`), `zenOn = TF.focuspage.zenActive({enabled: zenEnabled, mode: timer.mode, isRunning: timer.isRunning})`.
  - `FocusTaskItem` — prop baru `zenHidden`, `zenShown`.
- Modify: `static/app.css` — gaya tombol Zen + aturan sembunyi/tampil.
- Test: `tests/offline/focus_zen.test.js`

**Interfaces:**
- Consumes: `TF.focuspage.zenActive/readZenPref/writeZenPref` (Task 1); `VIEW_GLYPHS.fEye` via `ViewGlyph`.
- Produces: kelas `.focus-zen-btn` (`aria-pressed`), `.is-zen-hidden`, `.is-zen-shown`, `.focus-zen-note`, root `.focus-page.is-zen` (dipakai E2E dan oleh PR C).

Rincian:
- Tombol: `button.focus-zen-btn` (`type: "button"`, `aria-pressed: zenEnabled`, `title`/`aria-label` = tooltip Global Constraints, isi `ViewGlyph name: "fEye", size: 16`, kelas ` is-on` saat aktif).
- Kelas sembunyi: saat `zenOn`, seksi "Berulang hari ini" dan `p.focus-tip` mendapat ` is-zen-hidden` + `aria-hidden: true`; setiap `FocusTaskItem` dengan `task.id !== focusTask?.id` mendapat `zenHidden: true` → kelas ` is-zen-hidden` + `aria-hidden`. Saat `zenEnabled && !zenOn`, elemen yang sama mendapat ` is-zen-shown` (fade-in sekali saat kelas dipasang).
- Task Aktif dipaksa terbuka: `open: openId === task.id || zenOn && focusTask?.id === task.id`.
- Catatan: saat `zenOn`, render `div.focus-zen-note` tepat setelah `FocusSectionHead` "Task hari ini": `Mode Zen · ${n} task lain disembunyikan sampai istirahat`, `n = sortedTasks.filter(t => t.id !== focusTask?.id).length + recurringToday.length`.
- CSS: `.is-zen-hidden { animation: zen-fade-out 250ms ease forwards; pointer-events: none; }` dengan `@keyframes zen-fade-out` berakhir `opacity:0; visibility:hidden; height:0; margin:0; padding:0; border-width:0; overflow:hidden`; `.is-zen-shown { animation: zen-fade-in 250ms ease; }`; `@media (prefers-reduced-motion: reduce) { .is-zen-hidden { animation: none; display: none; } .is-zen-shown { animation: none; } }`. Tombol: 32×32, latar `rgba(255,255,255,.08)`, `is-on` → latar `var(--pomo-ink-soft)` + warna `var(--pomo-ink-text)`.

- [ ] **Step 1: Tulis test yang gagal** —
  - `PomodoroTimer` signature memuat `zenEnabled` dan `onToggleZen`; `focus-zen-btn` muncul sebelum `React.createElement(PomoModeSwitch` di sumbernya; memuat `"aria-pressed": zenEnabled`, `name: "fEye"`, dan tooltip persis.
  - `TodayFocusView` memuat `readZenPref(`, `writeZenPref(`, `zenActive({`, `focus-zen-note`, teks `task lain disembunyikan sampai istirahat`, `zenOn && focusTask?.id === task.id`, dan meneruskan `zenEnabled`/`onToggleZen` ke `PomodoroTimer`.
  - `FocusTaskItem` signature memuat `zenHidden`; sumbernya memuat `is-zen-hidden` dan `"aria-hidden"`.
  - `appCss` memuat `@keyframes zen-fade-out`, `.is-zen-hidden`, `.is-zen-shown`, dan di blok `prefers-reduced-motion` aturan `.is-zen-hidden` dengan `display: none`.
- [ ] **Step 2: Jalankan → FAIL** — `node --test tests/offline/focus_zen.test.js`
- [ ] **Step 3: Implementasi** sesuai rincian.
- [ ] **Step 4: Jalankan → PASS**; `node temporary_files/check_inline_scripts.js` bersih; `npm test` penuh (satu-satunya kegagalan yang boleh: pra-ada `draw_local_reactive`).
- [ ] **Step 5: Commit** — `git commit -m "feat(focus): Mode Zen menyembunyikan task lain saat Work berjalan"`

---

### Task 4: Versi, E2E, handover

**Files:**
- Modify: `static/sw.js`, `static/index.html` (versi, lihat Global Constraints)
- Create: `temporary_files/e2e_focus_page.py` (harness disalin dari `temporary_files/e2e_tasklist_focus.py`: `start_server`, `check`, akun via API); screenshot ke `temporary_files/e2e_focus_page/` dan tambahkan folder itu ke `.gitignore`.
- Modify: `.agents/CURRENT_STATE.md`, `.agents/SESSION_LOG.md`

- [ ] **Step 1: Naikkan versi** ke nomor kosong berikutnya (cek `git fetch origin main` dulu; default v434 / 342). Test sumber yang sudah ada untuk versi (bila ada) harus tetap lulus.
- [ ] **Step 2: Tulis E2E** — skenario, masing-masing `check(...)`:
  - a. Akun dengan 3 task Q1 (P1 + deadline hari ini) → halaman Fokus; catat teks "N tugas". Ketik "ide baru" + Enter → `.pomo-park.is-ok` tampil, input kosong, ≤ 2 dtk kemudian `.pomo-park-ok` hilang; teks "N tugas" sama; `GET /api/tasks` (server, setelah sync) memuat "ide baru" dengan `gtd_status == "inbox"`.
  - b. Enter dua kali cepat ("dobel") → tepat satu task "dobel" di server.
  - c. Spasi saja + Enter → tidak ada request POST `/api/tasks` (hitung lewat `page.on("request")` atau penghitung di route lokal).
  - d. Offline (`context.set_offline(True)`) → parkir "offline-1" → sukses; kembali online → task sampai ke server sebagai inbox.
  - e. Zen: toggle Zen, klik Fokus pada task pertama (Pomodoro jalan) → task lain dan "Berulang hari ini" tidak terlihat; `.focus-zen-note` tampil; panel task aktif terbuka dan centang subtask berfungsi. Jeda → semua task terlihat lagi. Mulai lagi → tersembunyi. Pindah ke mode Short → terlihat.
  - f. Reload → tombol Zen masih `aria-pressed="true"`.
  - g. Ketik huruf di input parkir tidak memicu shortcut global (mis. halaman tidak berpindah / modal tidak terbuka).
  - Screenshot terang + gelap, desktop + 375 px (kartu dengan input; Zen aktif).
- [ ] **Step 3: Jalankan** — `python3 temporary_files/e2e_focus_page.py` → semua `check` lulus (exit 0). `python -m pytest -q` → hijau. `npm test` → hanya `draw_local_reactive` gagal (pra-ada).
- [ ] **Step 4: Handover** — entri `.agents/CURRENT_STATE.md` (versi SW, isi, verifikasi, sisa) + `.agents/SESSION_LOG.md`.
- [ ] **Step 5: Commit** — `git commit -m "chore(focus): SW v434 + E2E Parkir Distraksi & Zen"`
