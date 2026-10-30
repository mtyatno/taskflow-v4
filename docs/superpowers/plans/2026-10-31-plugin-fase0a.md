# Sistem Plugin Fase 0a — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fondasi plugin klien (registry, loader lazy, slot `dashboard.widgets`, event bus, fasad `TF.api` v1, status ON/OFF per perangkat, kartu Pengaturan › Plugin) dibuktikan dengan plugin #0 **Heatmap Habit**, tanpa perubahan server/SQLite/versi IndexedDB.

**Architecture:** Satu file baru `static/plugin-runtime.js` (UMD seperti `static/offline/*`, tanpa JSX) memuat seluruh runtime dan diekspos di `window.TF.plugins`, `window.TF.events`, `window.TF.api`, `window.TF.Slot`. Kode plugin di `static/plugins/<id>/plugin.jsx`, dikompilasi `compile.js` ke `plugin.js` + `static/plugins/index.json`; semua file plugin di-precache `sw.js` dan dieksekusi lazy saat slot pertama kali dirender. `index.html` hanya menambah `<script>`, satu `<TF.Slot>`, titik emit event, dan `PluginSettingsCard`.

**Tech Stack:** JS UMD + React 18 global (tanpa bundler); Babel `preset-react` classic di `compile.js`; `node --test` + `fake-indexeddb` (`tests/offline/setup.js`); pembungkus pytest untuk CI (`tests/test_*_node.py`).

**Spec:** `docs/superpowers/specs/2026-10-29-plugin-fase0a-design.md` (salinan Project `claude/spec-plugin-fase0a-2026-10-29.md`, disetujui 2026-10-31: A1 per perangkat, A3 toggle offline, A4 Heatmap Habit, istilah "Plugin"). Lampiran A (guard rails) dan B (keputusan sulit dibalik) berlaku.

**Branch:** `claude/plugin-fase0a` dari `main` ≥ `6bb0c7e`. Baseline: `npm test` 3497/3498 (1 gagal pra-ada `draw_local_reactive.test.js`), `pytest tests/ -q` 1247 passed, 1 skipped.

## Keputusan rencana (controller)

- **R1 — event habit:** check-in habit terjadi di beberapa tempat (Dashboard ±23024, halaman Habit ±41086, dll.) dan semuanya sudah memancarkan `window` event `habitSaved` tanpa detail. Runtime menjembatani `habitSaved` → `habit.changed` (`{}`) alih-alih menambah emit `habit.checked`/`habit.unchecked` di tiap titik. Spec §4.6 diperbarui (Task 9). Heatmap cukup membaca ulang data.
- **R2 — event task:** `task.completed` diemit di `App.handleDone` (±44544) setelah sukses lokal (jalur utama); titik lain (centang dari child task, Kanban) tidak diubah di Fase 0a. Plugin yang butuh kelengkapan memakai `sync.done` + `task.completed` + pembacaan ulang.
- **R3 — `index.html` disunting dalam bentuk terkompilasi** (`React.createElement`), mengikuti PR-PR sebelumnya; `compile.js` tetap no-op untuk `index.html` yang sudah terkompilasi.
- **R4 — `plugin.js` di-commit** (hasil `compile.js`), sama seperti `index.html`; `deploy.yml` dan workflow Tauri sudah menjalankan `node compile.js`, jadi hasilnya identik.
- **R5 — loader di test Node:** `load(id)` menerima `inject(url) → Promise` yang bisa disuntik (default: elemen `<script>`), sehingga tes tidak butuh DOM.

## Global Constraints

- Tidak ada perubahan `webapp.py`, `repository.py`, `bot.py`, skema SQLite, `DB_VERSION` (tetap 6), `app.css` (`?v=382` tetap), `themes.css`.
- `index.html` bertambah ≤ 60 baris bersih (hitung dengan `git diff --stat`).
- Semua akses `_meta` lewat `TF.meta.metaGet/metaSet`; tidak ada `localStorage` di runtime maupun plugin.
- Teks UI persis (spec §4.8): `"Plugin"`, `"Fitur opsional. Status disimpan di perangkat ini."`, `"Plugin {nama} diaktifkan"`, `"Plugin {nama} dinonaktifkan"`, `"Plugin {nama} dimatikan karena error"`, `"Aktifkan lagi"`, `"Belum ada plugin"`, `"Bawaan"`, `"Tidak butuh izin"`, `"Menyimpan pengaturan di perangkat ini"`, `"Salin detail"`.
- Kunci `_meta`: `plugins:state:v1`, `plugins:index:v1`; ruang plugin `plugin:<id>:<key>`.
- Tanggal = Asia/Jakarta (UTC+7), format `YYYY-MM-DD`.
- Warna heatmap hanya dari token (`var(--accent)`, `var(--bg-card)`, `color-mix`); tanpa hex tetap (dijaga tes).
- Modul baru: tambahkan ke `STATIC` `sw.js` dengan URL persis (dijaga `sw_precache_shell.test.js`).
- Rilis: SW `taskflow-v488-plugin-fase0a` (nomor final mengikuti `main` saat merge, PROTOCOL §4), entri whatsnew baru paling atas.

## Review Focus

1. **Plugin OFF = 0 byte dieksekusi:** `plugin.js` tidak diminta sebelum ON + slot dirender (Task 3 tes loader, Task 10 E2E Network).
2. **Gagal aman:** error render/pendengar tidak sampai ke `AppErrorBoundary`; 2 error → OFF (Task 4).
3. **Offline:** precache lengkap + toggle bekerja tanpa jaringan (Task 7, Task 10).

---

### Task 1: Registry, manifest, dan status (`static/plugin-runtime.js` bagian 1)

**Files:**
- Create: `static/plugin-runtime.js`
- Test: `tests/offline/plugin_registry.test.js`

**Interfaces (Produces):**
- `TF.plugins.init({ fetchIndex }) → Promise` — membaca index (default `fetch("/static/plugins/index.json")`, fallback `_meta plugins:index:v1`) dan `_meta plugins:state:v1`.
- `TF.plugins.list() → [{id, name, description, version, permissions, enabled, loaded, failed}]`
- `TF.plugins.isEnabled(id) → bool`, `TF.plugins.setEnabled(id, bool) → Promise`
- `TF.plugins.register(manifest, factory)`; `TF.plugins.validateManifest(m, index) → {ok, reason}`
- `TF.plugins.contributions(slot) → [{pluginId, id, order, component}]`
- `KNOWN_SLOTS = ["dashboard.widgets"]`, `KNOWN_PERMISSIONS = ["storage"]`, `RESERVED_PERMISSIONS` (spec §4.3)
- `TF.plugins._reset()` untuk tes.

- [ ] **Step 1: Tulis tes gagal** `tests/offline/plugin_registry.test.js`:
  - manifest valid → ok; id `"Bad_Id"`, versi `"1"`, `minApi: 2`, slot `"x.y"`, izin `"network"` (dicadangkan) → masing-masing `{ok:false, reason}` berbeda.
  - `register` untuk id yang tidak ada di index → diabaikan (factory tidak dipanggil).
  - `register` untuk id OFF → factory tidak dipanggil; setelah `setEnabled(id, true)` + `load` → dipanggil.
  - `contributions("dashboard.widgets")` urut `order` lalu `pluginId`.
  - `setEnabled` menulis `_meta plugins:state:v1` `{[id]:{enabled, updatedAt}}` dan memancarkan `plugins.changed`; `defaultEnabled` dipakai bila belum ada status.
  - OFF memanggil `onDisable()` dan menghapus kontribusi.
- [ ] **Step 2: Jalankan → FAIL.** `node --test tests/offline/plugin_registry.test.js`
- [ ] **Step 3: Implementasi** (UMD: `module.exports` di Node, `root.TF.plugins` di browser; resolve `TF.meta` malas saat dipanggil).
- [ ] **Step 4: Jalankan → PASS**, lalu `npm test`.
- [ ] **Step 5: Commit** `feat(plugin): registry, manifest, dan status ON/OFF per perangkat`

### Task 2: Event bus (`TF.events`)

**Files:** Modify `static/plugin-runtime.js`; Test `tests/offline/plugin_events.test.js`

**Produces:** `TF.events.on(name, fn) → off`, `once`, `off`, `emit(name, payload)`; `TF.events.scoped(pluginId)` (emit hanya `<id>.*`, `offAll()` dipanggil saat OFF/gagal); jembatan `window`: `habitSaved` → `habit.changed`, `tf:initial-sync` → `sync.done {initial:true}`, `tf:sync-state` (idle) → `sync.done {initial:false}`, `online/offline` → `app.online/app.offline`; `app.dayChanged` dari interval 60 s (tanggal Asia/Jakarta; interval bisa disuntik untuk tes).

- [ ] **Step 1: Tes gagal:** on/off/once; payload `Object.isFrozen`; error satu pendengar tidak menghentikan pendengar lain dan memanggil `onListenerError(pluginId, err)`; `scoped("a").emit("b.x")` melempar; `offAll` melepas semua; `dayChanged` terpicu saat jam disuntik melewati tengah malam WIB.
- [ ] **Step 2: FAIL** → **Step 3: Implementasi** → **Step 4: PASS** + `npm test`.
- [ ] **Step 5: Commit** `feat(plugin): event bus bernamespace + jembatan event host`

### Task 3: Loader lazy dan penanganan gagal

**Files:** Modify `static/plugin-runtime.js`; Test `tests/offline/plugin_loader.test.js`, `tests/offline/plugin_failure.test.js`

**Produces:** `TF.plugins.load(id, {inject, timeoutMs=10000}) → Promise<bool>` (idempoten; URL `/static/plugins/<id>/plugin.js?v=<hash>` + `style.css` bila terdaftar); `TF.plugins.markFailed(id, kind, err)`; `TF.plugins.failures(id)`; aturan spec §8 (load → gagal sesi, tetap ON; manifest → otomatis OFF; render/pendengar: ke-1 kosong + toast, ke-2 OFF + toast `"Plugin {nama} dimatikan karena error"`). Toast lewat host binding (Task 5) — tanpa binding hanya `console.warn`.

- [ ] **Step 1: Tes gagal:** inject dipanggil sekali walau `load` dua kali; URL memuat hash dari index; timeout → `failed:"load"`, status tetap ON; manifest invalid → OFF; dua `markFailed(id,"render")` → OFF + toast sekali per kejadian.
- [ ] **Step 2–4:** FAIL → implementasi → PASS + `npm test`.
- [ ] **Step 5: Commit** `feat(plugin): loader lazy + plugin gagal dimatikan otomatis`

### Task 4: Fasad `TF.api` v1, `TF.Slot`, `PluginBoundary`

**Files:** Modify `static/plugin-runtime.js`; Test `tests/offline/plugin_api.test.js`, `tests/offline/plugin_storage.test.js`, `tests/offline/plugin_slot.test.js`

**Produces:**
- `TF.api.apiVersion === 1`; `TF.api.for(id)` → `{events, storage, data, ui, env, log}` (spec §4.7).
- `storage`: `get/set/remove/keys` di `_meta` `plugin:<id>:<key>`, nilai JSON ≤ 64 KB (lebih → `PluginStorageError`).
- `data.habits.list()` (`TF.habitquery.getHabits`), `data.habits.logs({from,to})` (dari `liveLogs`, saring tanggal + `deleted`), `data.tasks.list({includeDone, since})` lewat router lokal `GET /api/tasks` (`TF.taskroutes`).
- `ui.toast/openTask/navigate/sanitize` lewat `TF.plugins.bindHost({toast, openTask, navigate})`; `navigate` hanya `dashboard|focus|inbox|settings`.
- `env.online`, `env.platform` (`window.__TAURI__` → `"tauri"`), `env.theme` (`TF.themes`), `env.today()`, `env.userId`.
- `TF.Slot({name, context})` (React.createElement, tanpa JSX): render kosong sampai `init` selesai; tidak merender wadah bila tak ada kontribusi; setiap kontribusi dibungkus `PluginBoundary` (class component, `componentDidCatch` → `markFailed(id,"render")`); mendengar `plugins.changed`; memicu `load` untuk plugin ON yang menyumbang slot itu.

- [ ] **Step 1: Tes gagal:** storage prefiks + isolasi antar plugin + batas 64 KB; `data.habits.logs` menyaring rentang + log habit terhapus (seed `habits`/`habit_logs` via `fake-indexeddb`); `navigate("admin")` melempar; `Slot` dengan React di Node (`react` dari `static/vendor/react.production.min.js` + `react-dom/server` tidak tersedia → pakai renderer uji ringan: panggil fungsi `Slot` dan periksa pohon elemen) — kontribusi dibungkus `PluginBoundary`, kosong → `null`.
- [ ] **Step 2–4:** FAIL → implementasi → PASS + `npm test`.
- [ ] **Step 5: Commit** `feat(plugin): fasad TF.api v1, Slot, dan error boundary per plugin`

### Task 5: Integrasi host di `index.html`

**Files:** Modify `static/index.html` (terkompilasi, R3); Test `tests/offline/plugin_host_wiring.test.js`

- `<script src="/static/plugin-runtime.js"></script>` tepat sebelum `<script src="/static/ui-components.js">` (±388).
- `App`: `useEffect` sekali → `TF.plugins.init()` + `TF.plugins.bindHost({toast: showToast, openTask: id => openTaskById(id), navigate: setPage-yang-ada})`.
- `handleDone` (±44544): setelah sukses lokal → `window.TF?.events?.emit("task.completed", {taskId, completedAt: new Date().toISOString()})` (R2).
- Tiga titik pomodoro (±11448, 11543, 11592): `emit("pomodoro.ended", {taskId, kind, pomodoros, focusSeconds, endedAt})` setelah `api.post` dipanggil (tidak menunggu hasilnya).
- `Dashboard`: `React.createElement(TF.Slot, {name: "dashboard.widgets", context: {...}})` tepat setelah blok `gtd-grid dash-grid-2` (±23858), dibungkus guard `window.TF && window.TF.Slot`.

- [ ] **Step 1: Tes gagal** (pola tes sumber yang ada, mis. `dashboard_hero.test.js`): urutan `<script>`; `TF.plugins.init(` di `App`; `emit("task.completed"` di `handleDone`; tiga `emit("pomodoro.ended"`; `name: "dashboard.widgets"` di `Dashboard`; `git diff` index.html ≤ 60 baris (hitung di tes dengan membandingkan jumlah baris terhadap angka baseline yang dicatat di tes).
- [ ] **Step 2–4:** FAIL → implementasi → PASS + `npm test` + `node temporary_files/check_inline_scripts.js static/index.html`.
- [ ] **Step 5: Commit** `feat(plugin): pasang runtime, slot Dashboard, dan event host`

### Task 6: Kartu Pengaturan › Plugin

**Files:** Modify `static/index.html` (komponen `PluginSettingsCard` di dekat `ThemeSettingsCard` ±27183, dirender setelahnya ±27613); Test `tests/offline/plugin_settings_ui.test.js`

- Daftar dari `TF.plugins.list()`; baris: nama, deskripsi, badge `"Bawaan"`, versi, izin (teks Global Constraints), toggle `role="switch"` + `aria-checked`, status `"Dimuat"`/`"Belum dimuat"`/`"Error — Aktifkan lagi"`, tombol `"Salin detail"` saat ada error; kosong → `"Belum ada plugin"`; toast ON/OFF persis; bekerja offline (A3: hanya `_meta`).
- Gaya: kelas kartu Pengaturan yang ada; tanpa ubah `app.css`.

- [ ] **Step 1: Tes gagal** (sumber + teks persis + `role: "switch"`).
- [ ] **Step 2–4:** FAIL → implementasi → PASS + `npm test` + `check_inline_scripts`.
- [ ] **Step 5: Commit** `feat(plugin): kartu Pengaturan › Plugin`

### Task 7: Build plugin (`compile.js`) + precache

**Files:** Modify `compile.js`, `package.json` (script `compile:plugins`), `static/sw.js`; Create `static/plugins/_template/plugin.jsx`, `static/plugins/_template/manifest.json`, `static/plugins/_template/README.md`; Test `tests/build-plugins.test.js`, tambah asersi di `tests/offline/sw_precache_shell.test.js`; pembungkus CI `tests/test_plugins_node.py` (menjalankan semua `tests/offline/plugin_*.test.js`, `habit_heatmap_logic.test.js`, `tests/build-plugins.test.js`)

- `compile.js`: perilaku `index.html` tetap; untuk tiap `static/plugins/<id>/plugin.jsx` (lewati `_` di depan) → `plugin.js` dengan header `// generated from plugin.jsx — jangan edit`; manifest dibaca dari `manifest.json` di folder plugin (wajib); tulis `static/plugins/index.json` (`v:1`, plugins: id, name, description, version, permissions, defaultEnabled, files, hash = sha1 8 hex gabungan isi files); gagal kompilasi → exit 1; lint: `plugin.js` mengandung `tokenStore|API_BASE|fetch\(|localStorage` → exit 1.
- `sw.js` `STATIC` += `/static/plugin-runtime.js`, `/static/plugins/index.json`, dan setiap file plugin `?v=<hash>`.

- [ ] **Step 1: Tes gagal:** index.json konsisten dengan folder; `_template` dilewati; hash berubah bila isi berubah (tulis ke folder sementara); lint menolak `localStorage`; setiap file di index.json ada di `STATIC` dengan `?v=` sama.
- [ ] **Step 2–4:** FAIL → implementasi → PASS; `node compile.js` dua kali → idempoten (git diff kosong pada run kedua); `npm test`; `python3 -m pytest tests/test_plugins_node.py tests/test_sw_precache_node.py -q`.
- [ ] **Step 5: Commit** `build(plugin): kompilasi plugin, index.json, precache`

### Task 8: Plugin #0 Heatmap Habit

**Files:** Create `static/plugins/habit-heatmap/{plugin.jsx, manifest.json, style.css}`, hasil `plugin.js`; Test `tests/offline/habit_heatmap_logic.test.js`, `tests/offline/habit_heatmap_ui.test.js`

- Manifest: `id "habit-heatmap"`, `name "Heatmap Habit"`, `description "Grid habit tercentang dan task selesai setahun terakhir di Dashboard."`, `version "1.0.0"`, `minApi 1`, `slots ["dashboard.widgets"]`, `permissions ["storage"]`, `defaultEnabled false`.
- Logika murni (diekspor lewat `module.exports` bila Node): `bucketByDate(logs, tasks, from, to, metric)`, `levels(counts)` (5 tingkat kuantil, nol tetap 0), `streak(counts, today)` (hari ini tanpa log tidak memutus streak — aturan hero), `range(today, days)`.
- UI: kartu `dash-card` judul `"Heatmap"`, segmen `Habit | Task selesai | Keduanya` (tersimpan `api.storage` kunci `metric`, default `habit`), satu `<svg>` `<rect>` 11 px jarak 2, 53 kolom (≥ 768 px) / 26 kolom (HP), label bulan + Sen/Rab/Jum, `<title>` per kotak `"Sel 14 Okt · 3 habit · 2 task"`, ringkasan `"Streak {n} hari · {m} hari aktif dari {d}"`, warna `color-mix(in srgb, var(--accent) X%, var(--bg-card))` X = 0/25/50/75/100, outline hari ini `var(--accent)`.
- Pembaruan: mount + `habit.changed`, `task.completed`, `sync.done`, `app.dayChanged` (debounce 300 ms).

- [ ] **Step 1: Tes gagal:** logika (zona WIB, batas tengah malam, log `deleted`, metric `both`, kuantil, streak); UI (tanpa `#[0-9a-f]{3,6}` di `plugin.jsx`/`style.css`; teks persis; 53/26 kolom).
- [ ] **Step 2–4:** FAIL → implementasi → `node compile.js` → PASS + `npm test`.
- [ ] **Step 5: Commit** `feat(plugin): Heatmap Habit (plugin #0)`

### Task 9: Dokumen, rilis, handover

**Files:** Create `docs/plugins/README.md`, `docs/superpowers/specs/2026-10-29-plugin-fase0a-design.md` (salinan spec, §4.6 diperbarui sesuai R1/R2), `docs/superpowers/plans/2026-10-31-plugin-fase0a.md` (rencana ini); Modify `static/sw.js` + `static/index.html` + tes versi (PROTOCOL §4), `static/whatsnew.json`, `.agents/DECISIONS.md` (ADR-037 sistem plugin Fase 0a: runtime klien, precache + lazy-execute, status `_meta`, fasad ber-versi), `.agents/CURRENT_STATE.md`, `.agents/SESSION_LOG.md`

- README plugin: struktur folder, manifest, siklus hidup, `TF.api` v1, slot `dashboard.widgets` + kontrak `context`, event, aturan (Lampiran A ringkas), cara uji, cara rilis.
- whatsnew: `{"version": "taskflow-v488-plugin-fase0a", "date": "<hari merge>", "title": "Plugin: fitur opsional", "new": ["Pengaturan › Plugin: nyalakan fitur tambahan sesuai kebutuhanmu, juga saat offline.", "Plugin pertama: Heatmap Habit, grid kebiasaanmu setahun terakhir di Dashboard."]}`.

- [ ] **Step 1:** bump versi + whatsnew; `python3 -m pytest tests/test_whatsnew.py tests/test_sw_precache_node.py tests/test_app_update_node.py -q` → PASS.
- [ ] **Step 2:** `npm test`, `python3 -m pytest tests/ -q`, `check_inline_scripts` → PASS (kecuali pra-ada `draw_local_reactive`).
- [ ] **Step 3: Commit** `docs(plugin): README, spec, plan, ADR-037; rilis v488`

### Task 10: E2E manual + review akhir

- [ ] E2E spec §11.3 langkah 1–7 di Chrome desktop (Playwright Python di `temporary_files/e2e_plugin_fase0a.py`, server lokal `python webapp.py` + seed habit): plugin OFF tidak meminta `plugin.js`; ON tanpa reload; check-in habit memperbarui grid; mode offline (`context.set_offline(True)`) + reload → kartu tetap, toggle bekerja; Sakura gelap → warna ikut; `TF.plugins._debugThrow` dua kali → OFF + toast.
- [ ] Review akhir oleh subagen reviewer terpisah (Review Focus 1–3 + Lampiran A).
- [ ] Push branch + PR draft; merge hanya setelah "merge dan deploy".
