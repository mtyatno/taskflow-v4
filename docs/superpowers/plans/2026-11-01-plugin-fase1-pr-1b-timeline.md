# Sistem Plugin Fase 1 — PR 1b: Timeline dasar (Gantt Manual, kalender hari kerja + libur nasional, seksi "Jadwal") — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Plugin bawaan pertama yang terlihat pengguna di Fase 1: `static/plugins/timeline/` 1.0.0 (`defaultEnabled: false`). Setelah dinyalakan di Pengaturan › Plugin, halaman project (`proj_*`) dan workspace (`slist_*`) mendapat view ke-4 **Timeline**: tabel kiri (WBS · Nama · Mulai · Dur · 🍅 · %) + bar per task dikelompokkan per Project/induk, zoom Hari/Minggu/Bulan, garis hari ini, akhir pekan dan libur diarsir, panah dependensi FS + lag, milestone belah ketupat, bendera tenggat + peringatan "selesai setelah tenggat", seret untuk menggeser/mengubah durasi/membuat dependensi (Esc batal, toast "Urungkan"), klik → Live Edit/modal, virtualisasi baris, HP dengan gulir horizontal + kolom nama menempel + tampilan daftar. Detail task mendapat seksi **Jadwal** tingkat 1 (Mulai + Durasi + "Tambah dependensi", dapat dibuka penuh) untuk semua task kecuali task berulang. Hari kerja dihitung dari kalender kerja per workspace (record `calendar`, dibagi semua anggota) atau pribadi, plus libur nasional dan cuti bersama Indonesia 2025–2027 yang dibundel (sumber SKB 3 Menteri) — 100% offline. **Mode Manual saja**: dependensi tidak memindahkan task, pelanggaran hanya ditandai. Jadwal otomatis, CPM/jalur kritis, baseline, batasan = PR 1c (tidak ada di sini).

**Architecture:** Plugin murni klien, tanpa perubahan server, IndexedDB, `index.html`, atau `app.css`. Mesin = lima `parts` JS murni yang digabung `compile.js` ke `plugin.js` dan dites Node terpisah: `holidays-id.js` (tabel libur), `calendar.js` (bilangan hari, hari kerja, `finish`, FS+lag), `schedule.js` (baca/validasi ext, dependensi, siklus, pelanggaran, tenggat), `layout.js` (kelompok, WBS, ringkasan, skala waktu, jendela virtual, geometri panah), `drag.js` (mesin status seret murni). UI = `plugin.jsx` (komponen `TimelineView` untuk slot `taskList.views` id `gantt`, `ScheduleSection` untuk slot `taskDetail.sections` id `schedule`, `CalendarPopover`, `ListFallback`) + `style.css` (`.plg-timeline-*`, token tema saja). Data per task lewat `api.taskExt` (kunci `timeline.start`, `timeline.duration`, `timeline.deps`; 1a-1, sudah di `main`); kalender lewat `api.records` entitas `calendar` (**1a-2, belum di `main`**); preferensi tampilan per perangkat lewat `api.storage`. Satu perubahan kecil runtime: `api.ui.toast(message, type, action?)` (tambahan v1, untuk "Urungkan").

**Tech Stack:** klien UMD tanpa bundler, React UMD global (komponen plugin dengan JSX → Babel classic oleh `compile.js`), `node --test` + React palsu/dispatcher hooks palsu (pola `tests/offline/habit_heatmap_ui.test.js`, `tests/offline/plugin_slot.test.js:25–43`) + `fake-indexeddb` 6 (`tests/offline/setup.js`) untuk tes integrasi `api.records`, `vm` untuk memuat `plugin.js` hasil build (README §9), Playwright (E2E manual, `temporary_files/`, tidak di CI). Tidak ada dependensi baru, tidak ada vendor.

**Spec:** `docs/superpowers/specs/2026-10-31-plugin-fase1-timeline-design.md` (salinan Project `claude/spec-plugin-fase1-timeline-2026-10-31.md`; disetujui pemilik 2026-10-31). PR 1b mencakup: §1 kriteria 6, 7, 8, 9 (bagian 1b: `index.html` +0, `app.css` tetap); §2 K12/K13 (pemakai pertama), K14, K15 (kunci 1b + record `calendar`), K16, K17, K18; §3 baris 1b; §8.1–§8.9 seluruhnya; §10 baris 1–3, 8; §11 tes `timeline_*`; §12 baris 1b; §13 baris "mesin jadwal lambat", "data libur salah"; keputusan pemilik di header Status: **Q3** Timeline per anggota, data jadwal/kalender bersama di workspace; **Q4** cuti bersama = libur secara bawaan + sakelar per kalender; **Q5** seksi Jadwal untuk semua task kecuali task berulang. **Bukan** cakupan: `timeline.mode`/`constraint`/`actual`/`split`, record `project`/`baseline`/`resource`, forward/backward pass, slack, jalur kritis, "Jadwal otomatis untuk project ini", "Kenapa dijadwalkan di sini?", "Jadwalkan ulang yang belum selesai", SS/FF/SF (semua 1c/1d). Juga: rencana 1a-1 (`docs/superpowers/plans/2026-10-31-plugin-fase1-pr-1a-1.md` R1–R21), rencana 1a-2 (ditulis paralel), ADR-037..040, `docs/plugins/README.md`, `.agents/PROTOCOL.md` §4, `CLAUDE.md`.

**Branch:** `claude/plugin-timeline` dari `main` ≥ `e6d9256` (setelah #119 PR 1a-1; SW `taskflow-v491-plugin-ext`, `app.css?v=382`, IndexedDB `taskflow-offline` v6, 83 modul `static/offline/`, `index.html` 46.114 baris, `plugin-runtime.js` 1.470, `webapp.py` 10.876). Angka tes terakhir tercatat di `CURRENT_STATE.md` (PR 1a-1): pytest **1367 passed, 1 skipped**; `npm test` **3744/3745** (gagal pra-ada `draw_local_reactive`). Task 1 Step 0 menjalankan ulang dan mencatat baseline nyata. **Rebase ke `main` setelah PR 1a-2 di-merge** (lihat "Urutan terhadap 1a-2").

**Keputusan pemilik (2026-11-01 05.11 WIB): U1 (a), U2 (a), U3 (a), U4 (a)** — kalender kerja lewat popover toolbar Timeline dengan keterangan "Dipakai semua anggota workspace"; task tanpa jadwal tetap di posisi WBS tanpa bar, klik grafik menjadwalkan (durasi 1); di HP sakelar "Gantt / Daftar" bawaan Gantt, diingat per halaman; plugin `defaultEnabled: false` dan teks whatsnew Task 12 Step 2 **disetujui apa adanya**.

**Branch (diperbarui controller 2026-11-01):** `claude/plugin-timeline` ditumpuk di atas `claude/plugin-records` (PR #120, 1a-2, belum di-merge) sehingga T11 memakai `api.records` nyata tanpa menunggu rebase. PR 1b dibuka ke `main` sebagai draft dan **baru boleh di-merge setelah #120 di-merge** (diff memuat commit 1a-2 sampai #120 masuk). D1–D8 diperiksa terhadap implementasi 1a-2 di Task 11 Step 1.

## Urutan terhadap PR 1a-2 (ketergantungan)

PR 1a-2 (IndexedDB v7 `plugin_records`/`plugin_kv`, server `plugin_records` kursor `seq`, `static/offline/plugin_sync.js`, `api.records`, izin `records`) **belum** ada di `main`. Rencana ini menganggap API 1a-2 persis seperti spec §6.2, §7.3, K8–K11. Setiap butir yang bergantung padanya ditandai **[1a-2]**.

| Fase kerja | Task | Butuh 1a-2? | Catatan |
|---|---|---|---|
| A — bisa dikerjakan **sebelum** 1a-2 di-merge (di branch dari `main` 1a-1) | T1–T10 | tidak (memakai `api.records` palsu di tes) | mesin murni, UI, interaksi, seksi Jadwal, `api.ui.toast` action. Plugin sudah ada di `static/plugins/timeline/` di branch, tetapi PR **tidak boleh di-merge**: runtime `main` menolak izin `records` ("izin dicadangkan") → plugin langsung diredam saat dinyalakan |
| B — **setelah** 1a-2 di-merge (rebase) | T11–T14 | **ya** | integrasi runtime nyata + `plugin_sync`, E2E, rilis, review, PR |

**Ketergantungan ke 1a-2 (D1–D8)** — bila rencana/implementasi 1a-2 berbeda, perbaiki di 1a-2 (spec §15 Q2), bukan ditambal di 1b:

- **D1** Izin `records` pindah dari `RESERVED_PERMISSIONS` ke `KNOWN_PERMISSIONS` (`plugin-runtime.js:20–21`); `validateManifest` menerima `manifest.records = {calendar: {conflict: "lww", maxBytes: 16384}}`; izin `records` ⇔ `records` tak kosong (pola `taskExtError`).
- **D2** `compile.js` menyalin `records` ke `index.json` dan konstanta `manifest` (`OPTIONAL_FIELDS :90` + `"records"`), validasi entitas `^[a-z][a-z0-9_]{0,31}$`, `conflict` hanya `"lww"`, `maxBytes` ≤ 65536.
- **D3** `api.records.get(entity, id)` → record `{entity, id, scope, data, updated_at, version, pending}` atau `null` (tombstone → `null`); `put(entity, id, data, {scope})` dengan id deterministik pilihan plugin (pola `[A-Za-z0-9:@._-]{1,80}`, mis. `cal@list:12`), scope `"user"`∣`"list:<id>"`; `put` record yang sudah ada dengan scope sama → update (bukan `SCOPE_IMMUTABLE`); `onChange(fn) → off` dengan `{entity, ids, source, lost?}`. 1b **tidak** memakai `list`/`remove`/`newId`.
- **D4** Server: `records` per plugin dibaca dari `index.json` (`plugin_loader._read_index`), entitas `calendar` dengan `maxBytes` 16384 divalidasi; scope `list:<id>` boleh ditulis **setiap anggota** workspace (K14, `owner_id = uid` ∪ `list_members`).
- **D5** Klien menarik record plugin hanya bila ON; **saat plugin baru dinyalakan** (event `plugins.changed {enabled: true}`) runtime/`plugin_sync` memicu tarik penuh plugin itu pada sinkron berikutnya **dan** `api.records` bisa dipakai sebelum tarik pertama selesai (mengembalikan `null` → kalender bawaan). Sesudah tarik selesai `onChange({source: "sync"})` dipancarkan sehingga view memuat ulang kalender.
- **D6** **Jendela deploy 1b tanpa restart:** `GET/POST /api/plugins/timeline/records` saat proses lama belum mengenal `timeline` (indeks baru sudah ditulis deploy, proses belum restart) wajib **membaca ulang `index.json` sekali sebelum menjawab 404 `PLUGIN_UNKNOWN`** (pola `PUT /api/plugins/state/{id}`, ADR-039) — atau klien tidak membuang op record pada 404 untuk plugin yang ada di indeks kliennya. Tanpa salah satu, edit kalender di jendela deploy hilang dan 1b butuh restart `taskflow-web` (spec §12 menyatakan 1b "tidak restart"). **Usulan untuk rencana 1a-2.**
- **D7** Ukuran: `put` menolak data > `maxBytes` dengan `PluginStorageError` (code `RECORD_TOO_LARGE` atau setara) **sebelum** menulis IndexedDB.
- **D8** `lost` (edit lokal kalah LWW) dipancarkan lewat `onChange` untuk entitas `calendar` (toast spec §8.9).

Bila 1a-2 di-merge dengan nama/bentuk berbeda, Task 11 Step 1 menyesuaikan adaptor tunggal `calendarStore(api)` (R5) — satu-satunya tempat plugin menyentuh `api.records`.

## Peta perubahan

| File | Status | Isi (Task) |
|---|---|---|
| `static/plugins/timeline/holidays-id.js` | baru (~120 baris) | `TLHolidays`: tabel libur nasional + cuti bersama 2025–2027, `src` per tahun (T1) |
| `static/plugins/timeline/calendar.js` | baru (~220) | `TLCal`: bilangan hari, `normalize`, `compile`, `isWork`, `nextWork`, `addWork`, `finish`, `workdays`, `fsEarliest`, `missingYears`, format tanggal Indonesia (T2) |
| `static/plugins/timeline/schedule.js` | baru (~200) | `TLSched`: `readSched`, `sanitizePatch`, `refKey`, `buildIndex`, `resolveDeps`, `wouldCycle`, `violations`, `shiftAfterDeps`, `deadlineLate` (T3) |
| `static/plugins/timeline/layout.js` | baru (~320) | `TLLayout`: kelompok/WBS/ringkasan, skala & rentang, header, jendela virtual, arsir, panah, label aria (T4) |
| `static/plugins/timeline/drag.js` | baru (~160) | `TLDrag`: mesin status seret murni (geser/durasi/dependensi/batal/keyboard) (T5) |
| `static/plugins/timeline/manifest.json`, `plugin.jsx`, `style.css`, `plugin.js` (build) | baru | manifest §8.1 + `drag.js`; kerangka, adaptor `calendarStore` (T6); view (T7–T9); seksi (T10) |
| `static/plugins/index.json`, `static/sw.js` (blok `plugins:begin…end`) | ditulis `compile.js` | entri `timeline` (T6) |
| `static/plugin-runtime.js` | ubah kecil | `api.ui.toast(message, type, action?)` (T6) |
| `tests/offline/timeline_holidays.test.js`, `timeline_calendar.test.js`, `timeline_schedule.test.js`, `timeline_layout.test.js`, `timeline_drag.test.js`, `timeline_ui.test.js`, `timeline_section.test.js`, `timeline_runtime.test.js` | baru | T1–T5, T7–T11 |
| `tests/offline/plugin_api.test.js` | ubah (tambah kasus) | toast action (T6) |
| `tests/build-plugins.test.js` | ubah (tambah kasus) | build `timeline` (T6) |
| `tests/test_plugins_node.py` | ubah | `PATTERNS` + `timeline_*.test.js`, `REQUIRED` (T12) |
| `static/sw.js` (`CACHE`), `static/index.html` (`__SW_VERSION` + fallback — **ganti string saja, 0 baris**), `static/whatsnew.json` | ubah | rilis tidak silent (T12) |
| `docs/plugins/README.md`, `.agents/DECISIONS.md`, `.agents/PROTOCOL.md` | ubah | contoh Timeline, `parts` tanpa global, toast action; ADR-042; butir checklist SKB (T12) |
| `temporary_files/e2e_plugin_fase1_1b.py` | baru | E2E (T13) |
| `docs/superpowers/specs/2026-10-31-plugin-fase1-timeline-design.md`, `docs/superpowers/plans/2026-11-01-plugin-fase1-pr-1b-timeline.md`, `.agents/CURRENT_STATE.md`, `.agents/SESSION_LOG.md` | ubah/baru | catatan implementasi 1b, salinan rencana, handover (T14) |

**Tidak berubah:** `static/index.html` (selain string versi SW), `static/app.css` + `?v=382`, `static/offline/*`, `db.js` (`DB_VERSION` dari 1a-2), `webapp.py`, `plugin_loader.py`, `task_ext.py`, server lain.

## Keputusan rencana (controller)

- **R1 — Urutan dan branch.** Fase A (T1–T10) di `claude/plugin-timeline` dari `main` 1a-1 sambil 1a-2 direview; Fase B (T11–T14) setelah `git fetch origin main && git rebase origin/main` pasca-merge 1a-2. Konflik rebase yang diharapkan hanya berkas hasil `compile.js` (`static/plugins/index.json`, blok `plugins:begin…end` `sw.js`) → selesaikan dengan menjalankan ulang `node compile.js --plugins-only`, bukan edit tangan. PR **tidak** dibuka sebagai siap-merge sebelum Fase B (boleh draft untuk review rencana/kode Fase A).
- **R2 — `parts` tanpa global.** Setiap part = `const TLxxx = (function (deps) { …; return Object.freeze(api); })(<deps>); if (typeof module !== "undefined" && module.exports) module.exports = TLxxx;`. Ketergantungan antar part: `typeof TLCal !== "undefined" ? TLCal : require("./calendar.js")` (di `plugin.js` gabungan semua `const` part berada di lingkup IIFE yang sama sehingga cabang `require` tidak pernah jalan di browser; di Node tiap part bisa di-`require` sendiri). Tidak ada `window.__tl`/`self.__…` (beda dengan `demo-ext/util.js`). `plugin.jsx` mengakhiri dengan `if (typeof module !== "undefined" && module.exports) module.exports = Object.assign({}, {TLHolidays, TLCal, TLSched, TLLayout, TLDrag}, pure)` (urutan penimpaan `module.exports` di `plugin.js` gabungan: yang terakhir menang) dan mendaftar hanya bila `window.TF.plugins` ada (pola `habit-heatmap/plugin.jsx:349–356`). Urutan `parts`: `["holidays-id.js", "calendar.js", "schedule.js", "layout.js", "drag.js"]` (spec §8.1 + `drag.js`).
- **R3 — Bilangan hari (K16).** Semua tanggal internal = bilangan hari `dn = Date.UTC(y, m−1, d) / 864e5` (integer); tidak ada `new Date()` lokal di mesin. "Hari ini" = `api.env.today()` (Asia/Jakarta), dimasukkan sebagai argumen (tidak dibaca di part). `isoWeekday(dn) = ((dn + 3) mod 7 + 7) mod 7 + 1` (aman untuk dn negatif). `deadline` task dibaca `String(deadline).slice(0, 10)` dan divalidasi pola `^\d{4}-\d{2}-\d{2}$` + tanggal sah.
- **R4 — Kalender yang dipakai.** Task dengan `list_id` → `cal@list:<list_id>` scope `list:<list_id>`; tanpa `list_id` → `cal@user` scope `user`. Halaman workspace = satu kalender; halaman project pribadi = `cal@user`. Tidak ada record → `DEFAULT_CAL = {v: 1, weekdays: [1,2,3,4,5], national: true, cutiBersama: true, off: [], work: []}` (Q4). `TLCal.normalize(data)` menerima data dari anggota lain apa adanya: `weekdays` disaring 1–7 unik (kosong → bawaan, agar `nextWork` tidak pernah buntu), boolean bukan boolean → bawaan, `off`/`work` disaring `{d: tanggal sah, n: string ≤ 60}`, dedup per `d`, urut, ≤ 366; kunci asing diabaikan (bukan dihapus saat menulis ulang: `put` menulis hasil normalisasi + `v: 1`).
- **R5 — Satu adaptor `calendarStore(api)` [1a-2].** `{load(calId) → Promise<{data, pending}>`, `save(calId, scope, data) → Promise`, `subscribe(fn) → off}` di `plugin.jsx`; hanya ini yang memanggil `api.records.get/put/onChange` (D3, D5, D8). Tes Fase A memakai `fakeRecords()` (Map + pendengar) dengan bentuk D3 persis. Simpan: ukuran JSON UTF-8 > 16384 → tolak di klien dengan "Kalender terlalu besar — hapus sebagian libur tambahan" sebelum `put` (D7 tetap pengaman kedua). `onChange` dengan `lost` berisi id kalender aktif → toast "Perubahan kalender di perangkat ini kalah oleh perubahan yang lebih baru" (spec §8.9).
- **R6 — Hari kerja (spec §8.3).** `compile(cal, holidays)` di-cache per `JSON.stringify(cal)` (Map ≤ 8 entri); `off` = libur nasional (bila `national`) ∪ cuti bersama (bila `cutiBersama`) ∪ `cal.off`; `work` = `cal.work` (menang atas semua). `nextWork`/`addWork` loop harian dengan batas 3.650 iterasi → `Error("TL_CAL_LOOP")` (bukan hang). `finish(start, 0) = start` (milestone, walau jatuh di hari libur); `dur ≥ 1` → `addWork(nextWork(start), dur − 1)`. FS: `fsEarliest(predFinish, lag) = addWork(nextWork(predFinish + 1), lag)` (lag negatif = lead, mundur lewat hari kerja). Tahun di rentang tampak tanpa data libur dan (`national` ∨ `cutiBersama`) → `missingYears` → catatan "Libur nasional {tahun} belum ada di Alurik versi ini." di bawah legenda.
- **R7 — Baca/tulis ext (K15).** `TLSched.readSched(task, api)` dari `api.taskExt.read(task)`: `start` sah atau `null` (tidak dijadwalkan); `duration` integer 0..999, tidak ada/rusak dengan `start` ada → **1**; `deps` array ≤ 20 item `{t: {$task}, type: "FS", lag: integer −99..999}` (tipe lain/ref `null`/rusak → dibuang dari tampilan, dihitung `invalidDeps` untuk seksi "hapus dependensi rusak"). Tulis selalu lewat `sanitizePatch` (clamp + validasi; gagal → tidak menulis + toast). Mengosongkan Mulai = `{start: null, duration: null}`; `deps` dipertahankan. Jadwal baru dari tabel/grafik/seksi: `duration` bawaan **1**. Milestone hanya lewat seksi (`duration: 0`).
- **R8 — Pencocokan referensi `$task`.** Ref bisa angka (id server) atau cid string (task belum terkirim; ditulis ulang host setelah POST, ADR-040). `buildIndex(tasks)` memetakan `String(t.id)`, `String(t.cid)`, dan `String(t.server_id)` → task; `refKey(ref)` = `String(ref.$task)`. Ref yang tidak ditemukan di scope halaman: panah tidak digambar, seksi menampilkan "(task di luar halaman ini)" bila ditemukan di `api.data.tasks` atau "(task sudah dihapus)" bila tidak, dengan tombol hapus. Tidak pernah menyimpan id polos (selalu `api.taskExt.ref(task)`).
- **R9 — Susunan baris (spec §8.5).** Sumber = `context.scopeTasks` (termasuk selesai), dibuang: `recurrence_type` truthy, `gtd_status === "archived"`, `deleted`. Kelompok: halaman project = satu kelompok tanpa baris judul; workspace = per project (`project_id`, fallback nama `project` NOCASE) urut nama `localeCompare("id")` + "(Tanpa project)" terakhir. **Hierarki menang atas kelompok:** anak mengikuti induknya (kelompok induk) bila induk ada di scope; induk tidak di scope → anak jadi akar di kelompoknya sendiri. Urut saudara `created_at` lalu `id` (stabil). WBS: workspace `g.n.m` (g = nomor kelompok), project `n.m`; "Urutkan menurut Mulai" hanya mengubah urutan tampilan (saudara diurut `start` naik, tanpa jadwal terakhir), nomor WBS tetap.
- **R10 — Ringkasan (induk yang punya anak di scope).** Rentang = min(mulai)–maks(selesai) anak terjadwal (rekursif); tanpa anak terjadwal → tanpa bar. Tidak bisa diseret, tidak bisa jadi ujung dependensi baru di 1b (seret titik ke ringkasan → toast "Ringkasan tidak bisa diberi dependensi di versi ini"); dependensi lama yang menyentuh ringkasan tetap digambar dan dihitung memakai rentang ringkasan. Ext miliknya disimpan tetapi tidak dipakai selama punya anak. Seksi Jadwal di task ringkasan: "Jadwal task ini mengikuti subtask-nya" + rentang terhitung, tanpa input.
- **R11 — Render (K18, spec §8.6).** Satu wadah gulir `.plg-timeline-scroll` (tabel `position: sticky; left: 0`, header `position: sticky; top: 0`). Tinggi wadah = `max(360, window.innerHeight − rect.top − 16)` diukur di `useLayoutEffect` + `resize` (bukan konstanta offset header host). Baris 32 px, 36 px bila `matchMedia("(pointer: coarse)")`. **Virtualisasi dua arah:** baris `[first − 10, last + 10]`; header, garis libur, dan sel latar hanya untuk kolom hari di `[scrollLeft − 1 layar, scrollLeft + 2 layar]`; status jendela diperbarui di `requestAnimationFrame` hanya bila indeks baris/kolom pertama berubah (tanpa setState per piksel). Akhir pekan = `repeating-linear-gradient` periode `7 × pxPerDay` dibangun dari `mask` + offset weekday awal rentang (`TLLayout.weekendGradient`), hari kerja pengganti (`work`) di-overlay putih-transparan `div` di rentang tampak. Bar `div` absolut `transform: translateX()` + `width`. Satu `<svg>` overlay seukuran jendela tampak untuk panah. Anggaran: ≤ 1.500 elemen DOM (diperiksa tes T7 dengan 500 task/400 dep dan E2E), tata letak 500 task ≤ 30 ms lokal.
- **R12 — Warna (token saja, aturan README §8.6).** Bar biasa `var(--accent)` dengan lapisan `%` `color-mix(in srgb, var(--accent) 55%, var(--bg-card))` untuk sisa; selesai `var(--success)`; selesai setelah tenggat `var(--danger)` (mockup "rose"); ringkasan `var(--text-secondary)` tipis berujung kurung; milestone belah ketupat 12 px `var(--text-primary)`; garis hari ini `var(--accent)`; libur `color-mix(in srgb, var(--danger) 8%, transparent)`; akhir pekan `var(--bg-subtle)`; panah `var(--text-secondary)`, pelanggaran `var(--danger)` putus-putus. Tanpa hex/rgb (tes sumber seperti `habit_heatmap_ui.test.js`). Mockup "lime" = aksen palet Default; di Sakura/Lavender bar ikut aksen palet.
- **R13 — Interaksi murni (spec §8.7).** `TLDrag` = reducer `(state, event) → state` + `commit(state) → {taskId, patch} | {dep: {from, to}} | null`; komponen hanya menerjemahkan pointer → event dan menulis `transform` lewat ref + rAF. Ambang seret 4 px (mouse) / tekan lama 350 ms (sentuh, gerak > 8 px sebelum 350 ms = gulir, bukan seret); jepret per hari; jatuh di hari libur → `nextWork`; geser mempertahankan durasi **hari kerja**; tepi kanan 8 px (16 px pegangan setelah tekan lama) = ubah durasi (≥ 1; milestone tidak bisa diubah durasinya dari grafik); titik ujung kanan bar (desktop) → seret ke bar lain = dependensi FS lag 0 di task penerus. Esc / lepas di luar grafik = batal tanpa tulis. Tooltip "Sen 9 Nov → Kam 12 Nov · 4 hk". Satu `api.taskExt.set` saat dilepas; gagal → toast "Jadwal gagal disimpan" (host memuat ulang daftar).
- **R14 — Urungkan lewat `api.ui.toast` action.** `api.ui.toast(message, type, action)` — `action` opsional `{label: string 1–20, onClick: function}`; runtime membungkus `onClick` dengan try/catch (error dicatat `api.log`, tidak dihitung error plugin) dan meneruskan ke `hostBinding.toast(message, type, action)`; App `showToast` sudah menerima argumen ketiga (`index.html:43579`) dan `bindHost({toast: showToast})` (`:43587`) → **0 baris `index.html`**. Toast "Jadwal diubah" + "Urungkan" (host menampilkan 6 s bila ada action) → `setMany` nilai lama (kunci yang sebelumnya tidak ada → `null`). Ini penambahan fungsi v1 (aturan Lampiran B: hanya menambah), `apiVersion` tetap 1.
- **R15 — Dependensi baru.** Ditolak dengan toast: diri sendiri; sudah ada; siklus (`wouldCycle` DFS atas graf scope + edge baru) → "Dependensi ini membuat lingkaran"; > 20 → "Maksimal 20 dependensi per task"; target/penerus ringkasan (R10); task di luar scope halaman (view) atau di luar scope task (seksi: workspace sama `list_id`; pribadi = tanpa `list_id` dan project sama NOCASE, atau keduanya tanpa project). Penerus tanpa jadwal → dependensi tetap disimpan (panah tidak digambar sampai keduanya terjadwal).
- **R16 — Pelanggaran dan tenggat (Manual).** `violations(rows, cal)` = dependensi dengan `start(succ) < fsEarliest(finish(pred), lag)` → panah merah putus-putus + ikon ⚠ di baris (`aria-label` "Mulai sebelum dependensi selesai"). Dependensi **tidak** memindahkan task. "Geser ke setelah dependensi" (seksi) = `start = max(fsEarliest(...))` atas semua pendahulu terjadwal, satu `set`. Tenggat: `deadlineLate(finish, deadline, cal)` = jumlah hk setelah tenggat (> 0 → bendera `--danger` + peringatan seksi "Selesai Sel 10 Nov, 2 hari kerja setelah tenggat"); bendera tetap tampil di task tanpa jadwal.
- **R17 — Seksi "Jadwal" (spec §8.8, Q5).** `ScheduleSection` mengembalikan `null` untuk task berulang (`recurrence_type`) dan task tanpa `id`. Tingkat 1 (bawaan, terlipat): **Mulai** (`input type="date"`, kosong = belum dijadwalkan) + **Durasi** (angka hari kerja, min 1) + tautan "Tambah dependensi". Tombol "Selengkapnya" (status buka disimpan `api.storage` `section:open`) menampilkan: Selesai (terhitung), Milestone (kotak centang → `duration 0`, durasi dinonaktifkan), % selesai **baca saja** dari `progress` dengan petunjuk "Ubah lewat progres di atas" (plugin tidak menulis kolom host, README §8.7), daftar dependensi (judul task, "FS", lag angka hk, hapus), peringatan tenggat, peringatan pelanggaran + tombol "Geser ke setelah dependensi". Teks "hari kerja" ditulis penuh di seksi. Simpan saat `change`/`blur` (bukan per ketikan). **State lokal optimistis:** task di modal adalah salinan (`selectedTask`, `index.html:43447`, tidak mengikuti `tasks`), jadi seksi menyimpan nilai lokal yang di-seed ulang hanya saat `task.id` berganti atau nilai ext di props berubah (bandingkan `JSON.stringify(readSched)`). Pemilih dependensi memuat kandidat `api.data.tasks.list({includeDone: true})` saat dibuka (pencarian judul, ≤ 50 hasil, scope R15).
- **R18 — Kalender kerja di view.** Tombol toolbar "Kalender kerja" membuka `CalendarPopover` (keputusan pemilik U1): tujuh sakelar hari (Sen–Min), "Ikuti libur nasional", "Ikuti cuti bersama", daftar "Libur tambahan" dan "Hari kerja pengganti" (tanggal + nama ≤ 60, tambah/hapus), keterangan "Dipakai semua anggota workspace" di halaman workspace. Simpan langsung tiap perubahan (`calendarStore.save`), label "Menunggu sinkron" bila `pending`. Semua anggota yang Timeline-nya ON boleh mengubah (K14, Q3).
- **R19 — Preferensi per perangkat (`api.storage`).** `zoom:<page>` (`"day"∣"week"∣"month"`, bawaan `"week"`), `sort:<page>` (`"wbs"∣"start"`), `cols:<page>` (`true` = semua kolom di HP/Live Edit), `mode:<page>` (`"gantt"∣"list"`, hanya dipakai ≤ 640 px; U3), `section:open`. Gagal baca → bawaan; gagal tulis → `api.log.warn` saja.
- **R20 — HP dan Live Edit (spec §8.5 butir 5, §8.6).** ≤ 640 px atau `context.liveEdit`: tabel hanya WBS + Nama (lebar 160 px, menempel) + tombol "Kolom". Gulir horizontal di dalam wadah (halaman tidak boleh melebar; diuji E2E 375 px). Sakelar "Gantt | Daftar" di toolbar hanya ≤ 640 px (U3); Daftar = `ListFallback`: task terjadwal urut Mulai, dikelompokkan per minggu ("Mg 45 · 2–8 Nov"), baris "Judul · Sen 9 Nov → Kam 12 Nov · 4 hk · 🏁 bila lewat tenggat", lalu "Belum dijadwalkan"; ketuk → `context.onTaskClick`.
- **R21 — Task tanpa jadwal di Gantt (U2).** Tetap di posisi WBS-nya; kolom Mulai "—", tanpa bar; area baris di grafik menampilkan petunjuk tipis saat hover "Klik untuk menjadwalkan"; klik (desktop) / ketuk ganda (sentuh) di tanggal X → `{start: nextWork(X), duration: 1}` + toast Urungkan. Bendera tenggat tetap tampil.
- **R22 — Gulir awal dan rentang (spec §8.6).** Rentang = `[min(start) − 14, max(finish, deadline) + 30]` ∪ `[today − 60, today + 60]`; dibuka pertama kali → `scrollLeft` menaruh hari ini di 1/3 lebar grafik. Px/hari: Hari 28, Minggu 12, Bulan 4. Header: Hari = tanggal + nama hari (baris atas bulan); Minggu = "Mg 45" + bulan (ISO week); Bulan = bulan + "K1–K4". Zoom mempertahankan tanggal di tengah layar.
- **R23 — Aksesibilitas.** Wadah `role="grid"` `aria-rowcount`; baris `role="row"` `aria-rowindex`; bar `role="button"` `tabIndex=0` `aria-label` dari `TLLayout.ariaBar` ("Desain UI, Kam 5 Nov sampai Sel 10 Nov, 4 hari kerja, 60%"; milestone "…, milestone Kam 5 Nov"; tanpa jadwal "…, belum dijadwalkan"); Enter = buka task; Alt+←/→ geser 1 hk, Alt+Shift+←/→ durasi ±1 (lewat `TLDrag` event `key`), satu `set` per tekan (bukan setMany).
- **R24 — Kinerja.** Tata letak `useMemo([scopeTasks, calKey, zoom, sort])`; `TimelineView` dibungkus `React.memo` (dibuat malas, pola `habit-heatmap/plugin.jsx:236–239`); `context` host sudah stabil (1a-1 R16). Tes Node: `layout(500 task, 400 dep)` median 5 putaran ≤ 30 ms dicatat; asersi CI longgar ≤ 150 ms (mesin CI lebih lambat); anggaran nyata 150 ms render awal di E2E dengan CPU throttle 4×.
- **R25 — Data libur (spec §8.4, K17).** `TLHolidays.DATA = {2025: {src, libur: [[iso, nama], …], cuti: [[iso, nama], …]}, 2026: …, 2027: …}`; tanggal ganda dalam satu daftar dilarang; satu tanggal boleh muncul sebagai `libur` saja **atau** `cuti` saja. Sumber ditranskripsi dari SKB resmi (bukan berita): 2026 = SKB Menag 1497/2025, Menaker 2/2025, MenPANRB 5/2025 (19 Sep 2025) — **17 libur + 8 cuti**; 2027 = SKB Menag 1205/2026, Menaker 3/2026, MenPANRB 2/2026 (15 Sep 2026) — **18 libur + 8 cuti** (Isra Mikraj muncul dua kali: 5 Jan dan 26 Des 2027 — benar, dua tahun Hijriah); 2025 = SKB Menag 1017/2024, Menaker 2/2024, MenPANRB 2/2024 **beserta revisi Agustus 2025** (18 Agustus 2025 cuti bersama) — jumlah dicatat saat transkripsi, `src` menyebut kedua keputusan. Halaman setneg.go.id yang dipakai dicatat di komentar berkas. Perubahan isi = naik `version` plugin.
- **R26 — Rilis.** SW = nomor berikutnya setelah 1a-2 (perkiraan `taskflow-v493-timeline`; PROTOCOL §4 butir 4 bila bentrok), whatsnew **tidak silent** (U4), `app.css?v=382` tetap, ADR-042 (nomor berikutnya setelah ADR 1a-2), PROTOCOL §4 butir 6 baru "Sejak Oktober: SKB libur nasional/cuti bersama tahun berikutnya sudah masuk `static/plugins/timeline/holidays-id.js`?". Tanpa restart layanan **bila D6 terpenuhi**; selain itu catat restart `taskflow-web` di handover.

## Global Constraints

- `static/index.html` **+0 baris** (hanya string `__SW_VERSION` + fallback berganti); `app.css`/`?v=382` tetap; tidak ada berkas `static/offline/` baru/berubah; tidak ada perubahan server/skema; `DB_VERSION` = nilai 1a-2 (7), tidak disentuh.
- Plugin: id `timeline`, `version` `1.0.0`, `defaultEnabled: false`, `minApi: 1`, `slots: ["taskList.views", "taskDetail.sections"]`, `permissions: ["storage", "task.ext", "records"]`, `contributes` dan `records` persis spec §8.1, `taskExt.keys: ["start", "duration", "deps"]`, `parts` R2. Lint `compile.js` lulus (tanpa `fetch(`, `localStorage`, `innerHTML`, `indexedDB`, `window.TF.<host>`); satu-satunya `window.TF` = `window.TF.plugins.register`.
- Kunci ext persis `timeline.start` (`"YYYY-MM-DD"`), `timeline.duration` (integer 0..999 hk), `timeline.deps` (≤ 20 `{t: {$task}, type: "FS", lag}` lag −99..999). Ukuran per task ≤ ~1 KB (jauh di bawah 4096).
- Record `calendar` id persis `cal@user` / `cal@list:<id>`, data `{v: 1, weekdays, national, cutiBersama, off, work}` ≤ 16384 byte.
- CSS hanya `.plg-timeline-*`, token tema (`--accent`, `--success`, `--danger`, `--bg-card`, `--bg-subtle`, `--border`, `--text-primary`, `--text-secondary`), tanpa hex/rgb/hsl tetap.
- Teks UI persis (diperiksa tes): "Timeline", "Hari", "Minggu", "Bulan", "Hari ini", "Kalender kerja", "Urutkan menurut Mulai", "Kolom", "Gantt", "Daftar", "Belum dijadwalkan", "Klik untuk menjadwalkan", "Jadwal diubah", "Urungkan", "Jadwal gagal disimpan", "Dependensi ini membuat lingkaran", "Maksimal 20 dependensi per task", "Ringkasan tidak bisa diberi dependensi di versi ini", "Mulai sebelum dependensi selesai", "Libur nasional {tahun} belum ada di Alurik versi ini.", "Perubahan kalender di perangkat ini kalah oleh perubahan yang lebih baru", "Kalender terlalu besar — hapus sebagian libur tambahan", "Dipakai semua anggota workspace", "Menunggu sinkron"; seksi: "Jadwal", "Mulai", "Durasi", "hari kerja", "Tambah dependensi", "Selengkapnya", "Selesai", "Milestone", "% selesai", "Ubah lewat progres di atas", "Geser ke setelah dependensi", "Jadwal task ini mengikuti subtask-nya", "(task di luar halaman ini)", "(task sudah dihapus)"; legenda: "Task", "Selesai", "Lewat tenggat", "Ringkasan", "Milestone", "Tenggat", "Libur", "Dependensi".
- Setelah setiap task: `npm test` (hanya gagal pra-ada `draw_local_reactive`) dan `node compile.js --plugins-only` dua kali tanpa diff; mulai T6 juga `python3 -m pytest tests/test_plugins_node.py tests/test_sw_precache_node.py -q`.
- Commit `feat(timeline)`, `feat(plugin)` (runtime), `test(timeline)`, `docs(plugin)`, `chore(release)`; atribusi sesi. Rilis mengikuti PROTOCOL §4.

## Review Focus

1. **Aritmetika hari kerja** — pergantian tahun, libur di akhir pekan, cuti bersama ON/OFF, hari kerja pengganti di Sabtu, lag negatif melewati libur, milestone di hari libur, pola minggu non-standar (Sen–Sab), batas iterasi; tidak ada `Date` lokal (R3, R6; tes T2).
2. **Seret tidak pernah menulis lebih dari sekali** dan tidak menimpa kunci lain: satu `set` per lepas, Esc/batal tanpa tulis, Urungkan = `setMany` nilai lama persis (kunci yang dulu tidak ada → `null`) (R13, R14; tes T5/T7).
3. **Kinerja dan DOM** — 500 task + 400 dep: ≤ 1.500 elemen, tidak ada setState per piksel gulir/seret, `context` Pomodoro tidak memicu tata letak ulang (R11, R24; tes T7 + E2E).
4. **Data bersama workspace** — kalender `cal@list:<id>` dipakai semua anggota, edit kalah LWW memberi toast, anggota OFF tidak terpengaruh, ref `$task` cid/server id cocok (R4, R5, R8; tes T11 + E2E dua konteks).
5. **Batas plugin** — tidak ada tulisan kolom host (`progress`, `deadline`), tidak ada `localStorage`/`window.TF.<host>`, `index.html` +0, `app.css` tetap, ketergantungan 1a-2 hanya lewat `calendarStore` (R5, README §8).

---

### Task 1: `holidays-id.js` — libur nasional + cuti bersama 2025–2027

**Files:**
- Create: `static/plugins/timeline/holidays-id.js`, `tests/offline/timeline_holidays.test.js`

**Interfaces (Produces `TLHolidays`):** `DATA` (R25, beku dalam); `YEARS = [2025, 2026, 2027]`; `has(year) → boolean`; `forYear(year, {national, cutiBersama}) → Array<[iso, nama, "libur"∣"cuti"]>` (urut tanggal); `lookup(iso) → {nama, kind} | null`.

- [ ] **Step 0: Baseline.** `git fetch origin main && git checkout -b claude/plugin-timeline origin/main`; catat `python3 -m pytest tests/ -q`, `npm test`, `node --test tests/build-plugins.test.js` (angka + versi Python/Node) untuk handover.
- [ ] **Step 1: Tulis tes gagal** `timeline_holidays.test.js`:
  - `"bentuk: tiap tahun punya src tak kosong, libur/cuti array [iso, nama] dengan iso sah di tahun kuncinya, urut, tanpa duplikat, nama tak kosong"`.
  - `"jumlah: 2026 = 17 libur + 8 cuti; 2027 = 18 libur + 8 cuti; 2025 = angka yang tercatat di komentar src"`.
  - `"tanggal kunci 2026: 2026-03-19 Nyepi libur; 2026-03-18, -20, -23, -24 cuti; 2026-12-24 cuti; 2026-12-25 libur"`; `"2027: 2027-01-05 dan 2027-12-26 Isra Mikraj (dua kali); 2027-03-10/11 Idulfitri libur; 2027-03-09/12/15 cuti"`; `"2025: 2025-08-18 cuti bersama (revisi)"`.
  - `"tidak ada tanggal yang sekaligus libur dan cuti"`; `"forYear menyaring sesuai sakelar"`; `"has(2028) false"`.
  - `"tes tidak memakai Date.now/new Date() tanpa argumen"` (regex sumber tes dan berkas — tanpa bom waktu CI).
- [ ] **Step 2: Jalankan → FAIL** `node --test tests/offline/timeline_holidays.test.js`.
- [ ] **Step 3: Implementasi** — transkripsi dari SKB resmi (R25), komentar sumber per tahun (nomor + tanggal SKB + URL setneg), pola R2.
- [ ] **Step 4: Jalankan → PASS**.
- [ ] **Step 5: Commit** `feat(timeline): tabel libur nasional dan cuti bersama 2025–2027 (SKB 3 Menteri)`

### Task 2: `calendar.js` — aritmetika hari kerja murni

**Files:**
- Create: `static/plugins/timeline/calendar.js`, `tests/offline/timeline_calendar.test.js`

**Interfaces (Produces `TLCal`):** `DEFAULT_CAL`; `MAX_ITER = 3650`; `dn(iso) → int | NaN`; `iso(dn) → string`; `isoWeekday(dn) → 1..7`; `isIso(s) → boolean`; `normalize(data) → cal` (R4); `compile(cal, holidays = TLHolidays) → {mask, off, work, key}` (R6, cache); `isWork(c, dn)`; `nextWork(c, dn)`; `prevWork(c, dn)`; `addWork(c, dn, k)`; `finish(c, startDn, dur)`; `workdays(c, a, b)` (inklusif; `a > b` → 0); `fsEarliest(c, predFinishDn, lag)`; `missingYears(c, fromDn, toDn, holidays) → number[]`; `byteSize(cal) → int`; format: `fmtShort(dn) → "Kam 5 Nov"`, `fmtLong(dn) → "Kamis, 5 November 2026"`, `isoWeek(dn) → {year, week}`.

- [ ] **Step 1: Tulis tes gagal** `timeline_calendar.test.js` (semua tanggal tetap, tanpa "hari ini"):
  - `"dn/iso pulang-pergi 1969-12-31, 1970-01-01, 2024-02-29, 2027-12-31; isoWeekday 1970-01-01 = 4 (Kamis), 2026-11-01 = 7 (Minggu), dn negatif aman"`.
  - `"normalize: weekdays kosong/asing → bawaan; boolean rusak → bawaan; off/work tanggal rusak/nama > 60 dibuang, dedup, urut, ≤ 366; kunci asing diabaikan"`.
  - `"Idulfitri 2026, cuti bersama ON: nextWork(2026-03-18) = 2026-03-25; finish(2026-03-17, 2) = 2026-03-25; cuti OFF: nextWork(2026-03-18) = 2026-03-18, nextWork(2026-03-19) = 2026-03-20"` (19 Nyepi tetap libur nasional).
  - `"national OFF + cutiBersama OFF: hanya akhir pekan"`; `"off tambahan di hari kerja dilewati; work pengganti di Sabtu dihitung"`; `"pola Sen–Sab (weekdays 1–6)"`.
  - `"akhir tahun: addWork(2026-12-23, 1) = 2026-12-28 (24 cuti, 25 libur, akhir pekan); pergantian tahun: addWork(2026-12-31, 1) = 2027-01-04 (1 Jan libur, akhir pekan); lintas 2027→2028 tanpa data 2028 = akhir pekan saja"`.
  - `"finish: dur 0 = start walau hari libur; dur 1 di hari libur = nextWork(start); dur ≥ 1 inklusif"`; `"workdays inklusif, a > b → 0"`.
  - `"fsEarliest: lag 0 = hari kerja setelah selesai; lag 2; lag −1 (lead) melewati libur ke belakang; pendahulu milestone di Jumat → Senin"`.
  - `"batas iterasi: kalender sintetis weekdays [1] + off = setiap Senin 2026–2040 (dibangun langsung sebagai Set di hasil compile) → nextWork(2026-01-01) melempar Error TL_CAL_LOOP, bukan hang"`.
  - `"missingYears: rentang 2027-12-01..2028-02-01 → [2028]; national dan cutiBersama OFF → []"`.
  - `"byteSize = byte UTF-8 JSON.stringify"`; `"fmtShort 2026-11-05 = 'Kam 5 Nov'; isoWeek 2026-11-02 = {2026, 45}"`.
  - `"sumber parts tanpa Date lokal"`: regex atas `calendar.js`/`schedule.js`/`layout.js`/`drag.js` — tidak ada `Date.now`, `new Date()` tanpa argumen, `getDate(`/`getDay(`/`getMonth(`/`getFullYear(` (hanya varian `getUTC*` dan `Date.UTC`).
- [ ] **Step 2: Jalankan → FAIL**.
- [ ] **Step 3: Implementasi** (R2, R3, R6).
- [ ] **Step 4: Jalankan → PASS**.
- [ ] **Step 5: Commit** `feat(timeline): mesin hari kerja — kalender, libur, FS + lag`

### Task 3: `schedule.js` — ext, dependensi, siklus, pelanggaran, tenggat

**Files:**
- Create: `static/plugins/timeline/schedule.js`, `tests/offline/timeline_schedule.test.js`

**Interfaces (Produces `TLSched`):** `MAX_DEPS = 20`, `DUR_MAX = 999`, `LAG_MIN = −99`, `LAG_MAX = 999`; `readSched(extObj) → {start: iso|null, duration: int|null, deps: [{key, ref, type, lag}], invalidDeps: int}` (masukan = hasil `api.taskExt.read`, R7); `sanitizePatch(p) → {ok: true, patch} | {ok: false, reason}`; `refKey(ref) → string | null`; `buildIndex(tasks) → Map<string, task>` (R8); `calKeyOf(task) → {id, scope}` (R4); `spanOf(c, sched) → {s, f} | null` (dn); `resolveDeps(rows, index) → [{from, to, lag, ok}]`; `wouldCycle(edges, from, to) → boolean`; `canLink({pred, succ, scopeTasks, edges}) → {ok} | {ok: false, reason: "self"∣"dup"∣"cycle"∣"max"∣"summary"∣"scope"}` (R15); `violations(c, spans, edges) → Set<succKey>` + detail `{succ, pred, earliest}`; `shiftAfterDeps(c, succ, preds) → iso | null` (R16); `deadlineLate(c, finishDn, deadline) → int` (hk setelah tenggat, 0 bila tepat/sebelum, `null` tanpa tenggat sah).

- [ ] **Step 1: Tulis tes gagal**:
  - `"readSched: start rusak → null; start ada + duration hilang → 1; duration 1000 / −1 / 1.5 → 1; deps tipe SS / ref null / lag 1000 → dibuang, invalidDeps dihitung; > 20 dipotong"`.
  - `"sanitizePatch: {start: '2026-02-30'} gagal; {duration: 0} ok; {deps: 21 item} gagal; {start: null, duration: null} ok (unschedule)"`.
  - `"buildIndex: ref angka cocok id server, ref cid string cocok cid task yang id-nya kini angka (rewrite belum sampai)"` (R8).
  - `"wouldCycle: A→B→C + C→A = true; edge paralel aman; graf 500 simpul 400 edge < 5 ms"`.
  - `"canLink: self, dup, cycle, max, summary, scope (workspace beda, pribadi project beda NOCASE, pribadi tanpa project)"`.
  - `"violations Manual: penerus mulai sebelum fsEarliest → ditandai; tepat fsEarliest → tidak; pendahulu/penerus tanpa jadwal → diabaikan"`.
  - `"shiftAfterDeps: maks atas dua pendahulu + lag; tanpa pendahulu terjadwal → null"`.
  - `"deadlineLate: selesai Sel 10 Nov 2026, tenggat Jum 6 Nov 2026 → 2; tenggat '2026-11-06T17:00' dibaca 10 karakter; tenggat rusak → null"`.
- [ ] **Step 2: Jalankan → FAIL**.
- [ ] **Step 3: Implementasi** (R7, R8, R15, R16).
- [ ] **Step 4: Jalankan → PASS**.
- [ ] **Step 5: Commit** `feat(timeline): jadwal manual — baca ext, dependensi FS, siklus, pelanggaran, tenggat`

### Task 4: `layout.js` — baris, WBS, ringkasan, skala, jendela virtual, panah

**Files:**
- Create: `static/plugins/timeline/layout.js`, `tests/offline/timeline_layout.test.js`

**Interfaces (Produces `TLLayout`):** `PX = {day: 28, week: 12, month: 4}`; `ROW_H = 32`, `ROW_H_TOUCH = 36`; `layout({tasks, pageKind, sort, cal, today, readSchedOf, zoom}) → {groups, rows: [{key, task|null, group, depth, wbs, kind: "group"∣"task"∣"summary", span, sched, late, violation}], edges, range: {from, to}, px, missingYears, stats}` (R9, R10, R16, R22); `windowRows(rows, scrollTop, viewH, rowH, buffer = 10) → {first, last}`; `windowDays(range, px, scrollLeft, viewW) → {fromDn, toDn}`; `xOf(dn, range, px)`, `dnAt(x, range, px)`; `headerTicks(zoom, fromDn, toDn) → {top: [...], bottom: [...]}` (R22); `weekendGradient(c, range, px) → string` (`repeating-linear-gradient(...)` hanya token `var(--bg-subtle)`/`transparent`); `holidaySpans(c, fromDn, toDn) → [{dn, name}]`; `arrowPath(fromRect, toRect) → "M…"` (keluar 6 px ke kanan, ortogonal, masuk ke awal penerus; kasus penerus di kiri pendahulu); `ariaBar(task, sched, span, progress) → string` (R23); `initialScrollLeft(range, px, today, viewW)`.

- [ ] **Step 1: Tulis tes gagal**:
  - `"kelompok workspace: per project urut nama + (Tanpa project) terakhir; halaman project tanpa baris kelompok"`.
  - `"dibuang: task berulang, archived, deleted; selesai tetap (bar 100%)"`.
  - `"hierarki menang: anak di project lain ikut induknya; induk di luar scope → anak jadi akar"` (R9).
  - `"WBS: workspace 1.1, 1.1.1, 2.1; project 1, 1.1; urut created_at lalu id; sort start mengubah urutan, bukan nomor"`.
  - `"ringkasan: rentang min–maks anak terjadwal rekursif; tanpa anak terjadwal → tanpa span; kind summary"`.
  - `"rentang: min(start) − 14 .. max(finish, deadline) + 30 ∪ today ± 60"`.
  - `"windowRows: buffer 10 di kedua sisi, dijepit ke [0, n − 1]"`; `"windowDays: 1 layar kiri, 2 layar kanan"`.
  - `"headerTicks: day/week/month bentuk dan label ('Mg 45', 'Nov 2026', 'K4')"`.
  - `"weekendGradient: periode 7 × px; pola Sen–Jum vs Sen–Sab berbeda; tanpa hex"`.
  - `"arrowPath: penerus di kanan dan di kiri pendahulu → path valid berawal M dan hanya H/V"`.
  - `"ariaBar: 'Desain UI, Kam 5 Nov sampai Sel 10 Nov, 4 hari kerja, 60%'; milestone; belum dijadwalkan"`.
  - `"kinerja: 500 task + 400 dep → median 5 putaran dicatat (console.log), asersi ≤ 150 ms"` (R24).
- [ ] **Step 2: Jalankan → FAIL**.
- [ ] **Step 3: Implementasi** (R9–R11, R16, R22, R23).
- [ ] **Step 4: Jalankan → PASS**.
- [ ] **Step 5: Commit** `feat(timeline): tata letak Gantt — kelompok, WBS, ringkasan, skala, virtualisasi, panah`

### Task 5: `drag.js` — mesin status seret dan keyboard

**Files:**
- Create: `static/plugins/timeline/drag.js`, `tests/offline/timeline_drag.test.js`

**Interfaces (Produces `TLDrag`):** `THRESHOLD_PX = 4`, `LONG_PRESS_MS = 350`, `TOUCH_SLOP_PX = 8`, `EDGE_PX = 8`, `EDGE_TOUCH_PX = 16`; `hitZone({x, barLeft, barWidth, touch, armed}) → "body"∣"edge"∣"dot"∣null`; `start({kind: "move"∣"resize"∣"link", row, sched, pointer, touch, t}) → state`; `reduce(state, ev) → state` dengan `ev` = `{type: "move", x, t}`∣`{type: "hold", t}`∣`{type: "over", rowKey}`∣`{type: "cancel"}`∣`{type: "up", x, inside}`; `preview(state, c, range, px) → {dx, width, tooltip} | null`; `commit(state, c) → {taskId, patch, prev} | {link: {pred, succ}} | null` (R13: jepret per hari, `nextWork` di hari libur, durasi hk tetap saat geser, durasi ≥ 1, milestone tidak bisa di-resize); `keyStep({key, alt, shift}, sched, c) → {patch, prev} | null` (R23).

- [ ] **Step 1: Tulis tes gagal**:
  - `"mouse: gerak 3 px lalu up → klik (bukan seret, commit null + click true); 5 px → seret"`.
  - `"sentuh: gerak 10 px sebelum 350 ms → gulir (state idle); hold 350 ms lalu gerak → seret"`.
  - `"geser jatuh di Sabtu → Senin; durasi 4 hk melewati libur tetap 4 hk; patch hanya start"`.
  - `"resize: tepi kanan, durasi minimum 1; milestone → hitZone edge null"`.
  - `"link: up di baris lain → {link}; up di baris sendiri / di luar → null"`.
  - `"cancel (Esc) dan up di luar grafik → commit null"`.
  - `"prev memuat nilai lama persis (kunci yang tidak ada → null) untuk Urungkan"`.
  - `"tooltip 'Sen 9 Nov → Kam 12 Nov · 4 hk'"`; `"keyStep Alt+→ geser 1 hk (lewati libur), Alt+Shift+← durasi − 1 berhenti di 1; tanpa jadwal → null"`.
- [ ] **Step 2: Jalankan → FAIL**.
- [ ] **Step 3: Implementasi** (R13, R23).
- [ ] **Step 4: Jalankan → PASS**.
- [ ] **Step 5: Commit** `feat(timeline): mesin seret murni — geser, durasi, dependensi, batal, keyboard`

### Task 6: Manifest, kerangka plugin, `calendarStore`, build, `api.ui.toast` action

**Files:**
- Create: `static/plugins/timeline/manifest.json`, `plugin.jsx` (kerangka), `style.css` (kerangka)
- Modify: `static/plugin-runtime.js` (`makeUi :1068–1089`), `tests/offline/plugin_api.test.js`, `tests/build-plugins.test.js`
- Generated: `static/plugins/timeline/plugin.js`, `static/plugins/index.json`, `static/sw.js` (blok plugins)

**Interfaces:**
- Consumes: T1–T5; `compile.js` `parts` (1a-1 R13); **[1a-2] D2** untuk `records` di `index.json` (sebelum 1a-2: `compile.js` mengabaikan `records` — entri indeks tanpa `records`; tes build Fase A memeriksa `parts`/`contributes`/`taskExt` saja, kasus `records` ditandai `todo` sampai T11).
- Produces: manifest persis spec §8.1 dengan `"parts": ["holidays-id.js", "calendar.js", "schedule.js", "layout.js", "drag.js"]`; `plugin.jsx`: `calendarStore(api)` (R5), `fakeRecords()` **tidak** di plugin (di tes); registrasi `{slots: {"taskList.views": [{id: "gantt", component: TimelineView}], "taskDetail.sections": [{id: "schedule", order: 10, component: ScheduleSection}]}}` (komponen sementara `null`-render sampai T7/T10); ekspor Node R2. Runtime: `api.ui.toast(message, type, action?)` R14.

- [ ] **Step 1: Tulis tes gagal**:
  - `plugin_api.test.js`: `"toast action: {label, onClick} diteruskan sebagai argumen ketiga; onClick yang melempar ditangkap, tidak menghitung failures; label > 20 / bukan fungsi → action diabaikan (toast tetap)"`; `"toast tanpa action → dua argumen seperti dulu"`.
  - `build-plugins.test.js`: `"timeline: parts digabung berurutan sebelum plugin.jsx, contributes + taskExt di index.json, lint lulus, hash stabil dua kali build"`; `"plugin.js timeline bisa di-require Node dan mengekspor TLCal/TLSched/TLLayout/TLDrag/TLHolidays"`; `"setiap part bisa di-require sendiri"` (R2); `"tanpa window.__ / self.__ global di parts"` (regex).
  - `timeline_ui.test.js` (awal): `"manifest persis"`; `"calendarStore: load tanpa record → DEFAULT_CAL pending false; save > 16 KB → reject pesan persis tanpa memanggil put; subscribe meneruskan lost"` (dengan `fakeRecords`).
- [ ] **Step 2: Jalankan → FAIL**.
- [ ] **Step 3: Implementasi**; `node compile.js --plugins-only`.
- [ ] **Step 4: Jalankan → PASS**; `npm test`; `python3 -m pytest tests/test_plugins_node.py tests/test_sw_precache_node.py -q`; build kedua tanpa diff.
- [ ] **Step 5: Commit** `feat(timeline): manifest dan kerangka plugin; feat(plugin): api.ui.toast dengan aksi` (dua commit: runtime terpisah).

### Task 7: `TimelineView` — tabel + grafik (render)

**Files:**
- Modify: `static/plugins/timeline/plugin.jsx`, `style.css`
- Test: `tests/offline/timeline_ui.test.js` (React palsu + dispatcher hooks palsu; pohon elemen)

**Interfaces:**
- Consumes: `context` slot `taskList.views` (`page`, `pageKind`, `listId`, `scopeTasks`, `liveEdit`, `onTaskClick`, `isSelected`, `showToast`), `api.taskExt.read`, `api.env.today()`, `api.storage` (R19), `calendarStore` (R5), `TLLayout`.
- Produces: `TimelineView({context, api})` (memo malas R24): toolbar (zoom segmented "Hari/Minggu/Bulan", "Hari ini", "Kalender kerja", "Urutkan menurut Mulai", "Kolom" bila sempit, "Gantt | Daftar" ≤ 640 px), wadah gulir R11 (tabel sticky WBS/Nama/Mulai/Dur/🍅/%, header sticky, latar akhir pekan/libur, garis hari ini, bar/milestone/ringkasan/bendera, svg panah, ⚠ baris), legenda + catatan tahun tanpa data, keadaan kosong "Belum ada task di halaman ini". Kolom 🍅 = `pomodoros_done/estimated_pomodoros`, % = `progress`. Klik baris/bar → `context.onTaskClick(task)`; baris terpilih `isSelected` → kelas `is-selected`.

- [ ] **Step 1: Tulis tes gagal**:
  - `"render 3 task (satu milestone, satu ringkasan + anak, satu tanpa jadwal): baris, WBS, Mulai '—' untuk tanpa jadwal, bar/milestone/ringkasan sesuai kind"`.
  - `"bendera tenggat: merah (kelas is-late) bila finish > deadline; tetap tampil tanpa jadwal"`; `"panah: pelanggaran → kelas is-violation + ⚠ baris dengan aria-label persis"`.
  - `"500 task + 400 dep, viewH 600, viewW 1000: jumlah elemen pohon ≤ 1.500"` (hitung node pohon React palsu, R11).
  - `"context baru dengan scopeTasks identik → layout tidak dihitung ulang"` (spy `TLLayout.layout`, R24).
  - `"≤ 640 px / liveEdit: hanya WBS + Nama + tombol Kolom"`; `"zoom dibaca/ditulis api.storage zoom:<page>; gagal baca → week"`.
  - `"catatan tahun tanpa data persis"`; `"legenda memuat delapan label persis"`.
  - Sumber: `"tanpa hex/rgb/hsl di plugin.jsx dan style.css; kelas hanya .plg-timeline-*; tanpa localStorage/innerHTML/fetch(/window.TF. selain plugins.register"`.
- [ ] **Step 2: Jalankan → FAIL**.
- [ ] **Step 3: Implementasi** (R11, R12, R19–R24).
- [ ] **Step 4: Jalankan → PASS**; build dua kali tanpa diff; `npm test`.
- [ ] **Step 5: Commit** `feat(timeline): view Gantt — tabel, skala, bar, milestone, tenggat, panah, virtualisasi`

### Task 8: `TimelineView` — interaksi (seret, buat dependensi, jadwalkan, keyboard, Urungkan)

**Files:**
- Modify: `static/plugins/timeline/plugin.jsx`
- Test: `tests/offline/timeline_ui.test.js` (handler dipanggil langsung dengan event palsu; `api.taskExt` palsu mencatat panggilan)

**Interfaces:**
- Consumes: `TLDrag`, `TLSched.canLink`, `api.taskExt.set/setMany/ref`, `api.ui.toast` (R14).
- Produces: pointer handler pada bar/tepi/titik dan area baris kosong (R21); `keydown` baris (R23); Esc global selama seret (dilepas saat selesai); rAF transform (tanpa setState per gerak).

- [ ] **Step 1: Tulis tes gagal**:
  - `"seret selesai → tepat satu api.taskExt.set {start}; toast 'Jadwal diubah' dengan action 'Urungkan' → setMany [{taskId, patch: prev}]"` (Review Focus 2).
  - `"Esc saat seret → tanpa set; listener keydown dilepas"`.
  - `"selama gerak tidak ada setState"` (hitung pemanggilan setter hook palsu = 0 antara down dan up).
  - `"link ke bar lain → set penerus {deps: [...lama, {t: ref(pred), type: 'FS', lag: 0}]}; siklus → toast persis, tanpa set; ke ringkasan → toast persis"`.
  - `"klik area kosong baris tanpa jadwal di tanggal Sabtu → set {start: Senin, duration: 1}"` (R21).
  - `"Alt+→ pada baris fokus → set {start: hari kerja berikutnya}"`.
  - `"set reject → toast 'Jadwal gagal disimpan' (type error)"`.
- [ ] **Step 2: Jalankan → FAIL**.
- [ ] **Step 3: Implementasi** (R13–R15, R21, R23).
- [ ] **Step 4: Jalankan → PASS**; `npm test`.
- [ ] **Step 5: Commit** `feat(timeline): seret untuk menggeser, ubah durasi, dan membuat dependensi; Urungkan`

### Task 9: Kalender kerja, Daftar (HP), urut, kolom

**Files:**
- Modify: `static/plugins/timeline/plugin.jsx`, `style.css`
- Test: `tests/offline/timeline_ui.test.js`

**Interfaces:**
- Consumes: `calendarStore` (R5) dengan `fakeRecords`, `TLCal.normalize/byteSize`, `TLHolidays`.
- Produces: `CalendarPopover({calId, scope, pageKind, store, onClose})` (R18); `ListFallback({rows, cal, onTaskClick})` (R20); sakelar urut/kolom/mode (R19).

- [ ] **Step 1: Tulis tes gagal**:
  - `"CalendarPopover workspace: judul + 'Dipakai semua anggota workspace'; nyalakan Sabtu (sakelar hari) → save cal@list:<id> scope list:<id> dengan data ternormalisasi"`; `"cuti bersama OFF → save {cutiBersama: false}; view memuat ulang (onChange local) dan arsir 18 Mar 2026 hilang"`.
  - `"tambah libur tambahan dengan nama > 60 → dipotong 60; tanggal ganda → ditolak"`; `"save > 16 KB → pesan persis, tanpa put"`; `"pending → 'Menunggu sinkron'"`.
  - `"onChange {lost: ['cal@list:12']} → toast persis"`.
  - `"halaman project → cal@user scope user; tanpa teks 'Dipakai semua anggota workspace'"`.
  - `"ListFallback: urut Mulai, kelompok minggu 'Mg 45 · 2–8 Nov', baris 'Sen 9 Nov → Kam 12 Nov · 4 hk', bagian 'Belum dijadwalkan', ketuk → onTaskClick"`.
  - `"Urutkan menurut Mulai mengubah urutan, WBS tetap; tersimpan sort:<page>"`.
- [ ] **Step 2: Jalankan → FAIL**.
- [ ] **Step 3: Implementasi** (R18–R20).
- [ ] **Step 4: Jalankan → PASS**; `npm test`.
- [ ] **Step 5: Commit** `feat(timeline): kalender kerja per workspace, tampilan daftar di HP, urut dan kolom`

### Task 10: Seksi "Jadwal" di detail task

**Files:**
- Modify: `static/plugins/timeline/plugin.jsx`, `style.css`
- Create: `tests/offline/timeline_section.test.js`

**Interfaces:**
- Consumes: `context` slot `taskDetail.sections` (`task`, `variant`, `onOpenTask`, `showToast`), `api.taskExt`, `api.data.tasks.list`, `api.storage` `section:open`, `calendarStore` (kalender task: R4).
- Produces: `ScheduleSection({context, api})` (R17).

- [ ] **Step 1: Tulis tes gagal**:
  - `"task berulang → null"`; `"task tanpa id → null"`.
  - `"tingkat 1: Mulai kosong, Durasi nonaktif sampai Mulai diisi, tautan 'Tambah dependensi'; isi Mulai → set {start, duration: 1}"`.
  - `"Durasi blur 5 → set {duration: 5}; 0 / 1000 / 'abc' → dijepit 1..999 tanpa set bila sama"`; `"kosongkan Mulai → set {start: null, duration: null}"`.
  - `"Selengkapnya: Selesai terhitung (fmtLong), Milestone mencentang → set {duration: 0} dan Durasi nonaktif; % baca saja + petunjuk persis; status buka disimpan section:open"`.
  - `"dependensi: daftar judul + FS + lag; ubah lag blur → set deps; hapus → set deps tanpa item; ref tak ditemukan → '(task sudah dihapus)'"`.
  - `"pemilih: memuat api.data.tasks.list({includeDone: true}) sekali saat dibuka; hanya scope sama (R15); siklus → toast persis"`.
  - `"peringatan tenggat persis 'Selesai Sel 10 Nov, 2 hari kerja setelah tenggat'"`; `"pelanggaran → tombol 'Geser ke setelah dependensi' → set {start: shiftAfterDeps}"`.
  - `"task ringkasan (punya anak di api.data.tasks) → 'Jadwal task ini mengikuti subtask-nya' + rentang, tanpa input"`.
  - `"props task sama id dengan ext berubah (sinkron) → nilai lokal di-seed ulang; props sama → nilai lokal yang baru disimpan tetap (modal snapshot)"` (R17).
  - `"variant panel dan modal merender sama"`.
- [ ] **Step 2: Jalankan → FAIL**.
- [ ] **Step 3: Implementasi** (R7, R10, R15–R17).
- [ ] **Step 4: Jalankan → PASS**; build; `npm test`.
- [ ] **Step 5: Commit** `feat(timeline): seksi Jadwal di detail task — Mulai, Durasi, dependensi, tenggat`

---

> **Fase B dimulai di sini.** Prasyarat: PR 1a-2 sudah di-merge ke `main`. `git fetch origin main && git rebase origin/main`; selesaikan konflik berkas hasil build dengan `node compile.js --plugins-only` (R1); jalankan ulang `npm test` + pytest dan catat. Periksa D1–D8 terhadap kode 1a-2 yang nyata; ketidakcocokan → laporkan ke pemilik, perbaiki di 1a-2 (PR susulan) bila itu kontrak, atau sesuaikan **hanya** `calendarStore` bila sekadar nama.

### Task 11: Integrasi runtime nyata + `api.records` [1a-2]

**Files:**
- Create: `tests/offline/timeline_runtime.test.js`
- Modify (bila perlu): `static/plugins/timeline/plugin.jsx` (`calendarStore` saja), `tests/build-plugins.test.js` (aktifkan kasus `records` dari T6)

**Interfaces:**
- Consumes: `static/plugin-runtime.js` (`P._reset`, `P.init({fetchIndex})`, `P.load(id, {inject})` lewat `vm`, README §9), `TF.pluginsync` (`static/offline/plugin_sync.js`) + `fake-indexeddb`, `taskroutes` lokal (untuk `api.taskExt` tanpa binding host, 1a-1 R14).

- [ ] **Step 1: Tulis tes gagal** `timeline_runtime.test.js`:
  - `"index.json repo: timeline valid (izin records dikenal, records.calendar tersalin), defaultEnabled false"` (D1, D2).
  - `"OFF → plugin.js tidak di-inject; ON + SlotView gantt → register, kontribusi gantt dan schedule ada"`.
  - `"api.records nyata: get cal@list:12 sebelum ada → null; put → record pending true + satu op outbox plugin; put kedua → tetap satu op (coalescing)"` (D3).
  - `"api.taskExt nyata (rute lokal): set {start} lalu baca task lewat api.data.tasks.list → ext timeline.start; ext_dirty berisi kunci"`.
  - `"onChange source sync dengan lost → calendarStore.subscribe menerima lost"` (D5, D8).
  - `"data > 16 KB → reject sebelum IndexedDB"` (D7).
  - `"bentuk record nyata cocok dengan fakeRecords tes T6–T10"` (bandingkan kunci objek — mencegah tes palsu menyimpang dari 1a-2).
- [ ] **Step 2: Jalankan → FAIL** (atau PASS langsung bila 1a-2 sesuai — catat).
- [ ] **Step 3: Sesuaikan** `calendarStore`/tes bila ada perbedaan nama (bukan kontrak).
- [ ] **Step 4: Jalankan → PASS**; `npm test`; `python3 -m pytest tests/ -q`.
- [ ] **Step 5: Commit** `test(timeline): integrasi runtime, api.records, dan api.taskExt nyata`

### Task 12: Rilis — SW, whatsnew (tidak silent), README, ADR-042, PROTOCOL, pola tes CI

**Files:**
- Modify: `static/sw.js` (`CACHE`), `static/index.html` (`__SW_VERSION` + fallback; string saja), berkas `static/`+`tests/` bervers lama (sed **kecuali** `static/whatsnew.json`), `static/whatsnew.json`, `tests/test_plugins_node.py`, `docs/plugins/README.md`, `.agents/DECISIONS.md`, `.agents/PROTOCOL.md`

- [ ] **Step 1: Versi** `<versi main>` → nomor berikutnya (perkiraan `taskflow-v493-timeline`, R26); `app.css?v=382` tetap.
- [ ] **Step 2: whatsnew** entri teratas (teks final menunggu U4; usulan, semua ≤ 60/140 karakter, tanpa istilah teknis):
  ```json
  {"version": "taskflow-v493-timeline", "date": "<tanggal rilis WIB>", "title": "Timeline: lihat jadwal project sebagai Gantt",
   "new": ["Nyalakan Timeline di Pengaturan › Plugin, lalu pilih tampilan Timeline di halaman project atau workspace.",
           "Seret bar untuk menggeser jadwal atau mengubah durasi; panah menandai task yang harus selesai lebih dulu.",
           "Hari kerja otomatis melewati akhir pekan, libur nasional, dan cuti bersama 2025–2027.",
           "Atur Mulai, Durasi, dan dependensi dari seksi Jadwal di detail task. Jadwal workspace terlihat semua anggota."]}
  ```
- [ ] **Step 3: `tests/test_plugins_node.py`**: `PATTERNS` += `tests/offline/timeline_*.test.js`; `REQUIRED` += `"timeline_holidays", "timeline_calendar", "timeline_schedule", "timeline_layout", "timeline_drag", "timeline_ui", "timeline_section", "timeline_runtime"`.
- [ ] **Step 4: README**: judul "(Fase 0a–1b)"; §1 contoh nyata kedua `static/plugins/timeline/` (`parts` + `records` + `task.ext` + dua slot); §2 pola `parts` tanpa global (R2) menggantikan rujukan `demo-ext/util.js` sebagai pola yang dianjurkan; §5 `api.ui.toast(message, type, action?)` (R14); §6.2/§6.3 contoh pemakai pertama; catatan "task di modal adalah salinan — seksi menyimpan state lokal" (R17).
- [ ] **Step 5: ADR-042** "Timeline 1b: Gantt Manual sebagai plugin, hari kerja Indonesia dibundel, kalender kerja sebagai record bersama" (Date / Agent / Context / Decision / Consequences): Context (spec §8, Q3–Q5, K15–K18, ketergantungan D1–D8); Decision (R2, R3–R8, R11, R13, R14, R17, R18, R25); Consequences (data libur wajib diperbarui tiap tahun — butir PROTOCOL; mode Manual tidak memindahkan task; seret = satu PUT per task, notifikasi workspace tidak terkirim (K6); kalender bersama diubah semua anggota; `index.html` +0; rollback = matikan plugin atau revert sebagai rilis baru dengan whatsnew `silent`, data `timeline.*` dan record dibiarkan).
- [ ] **Step 6: PROTOCOL §4** butir 6 (R26).
- [ ] **Step 7: Verifikasi** `python3 -m pytest tests/test_whatsnew.py tests/test_sw_precache_node.py tests/test_app_update_node.py -q` (PROTOCOL §4 butir 5), `npm test`, `python3 -m pytest tests/ -q`, `node compile.js` idempoten.
- [ ] **Step 8: Commit** `chore(release): SW v493 Timeline, README, ADR-042, checklist SKB`

### Task 13: E2E Playwright

**Files:**
- Create: `temporary_files/e2e_plugin_fase1_1b.py` (pola `temporary_files/e2e_plugin_fase1_1a1.py`: `hd.seed`, `hd.check`, tangkapan `temporary_files/e2e_plugin_fase1_1b/`; tidak di CI)

**Skenario** (U1 konteks A dan B; U2 anggota workspace W; Timeline ON untuk U1 lewat `PUT /api/plugins/state/timeline`, OFF untuk U2; sinkron `window.__syncNow()` lalu tunggu `__syncState.running === false`):
1. A: `slist_W` → tombol "Timeline" tampil **tanpa** request `plugin.js` sampai diklik; view tampil dengan kelompok per project, WBS, hari ini di 1/3 lebar; Inbox tanpa tombol.
2. A: seksi Jadwal di modal dan panel Live Edit (antara Deskripsi dan tab); isi Mulai 2026-03-17, Durasi 2 → Selesai "Rabu, 25 Maret 2026" (cuti bersama ON); task berulang tanpa seksi.
3. A: seret bar 3 hari → satu PUT `ext_patch` saja (pantau jaringan), toast "Urungkan" mengembalikan; Esc membatalkan tanpa PUT; buat dependensi lewat titik → panah; buat siklus → toast.
4. A: Kalender kerja → matikan "Ikuti cuti bersama" → Selesai berubah; B (U1 konteks lain) sinkron → kalender sama; U2 (OFF) mengganti judul task berjadwal lewat API → `timeline.*` utuh; notifikasi U2 tidak bertambah oleh seret.
5. B offline: geser bar; A mengganti prioritas task yang sama; B online + sinkron → server punya prioritas A + jadwal B.
6. Kinerja: seed 500 task + 400 dependensi di workspace; CDP `Emulation.setCPUThrottlingRate(4)`; waktu dari klik tombol sampai baris pertama tampil ≤ 150 ms (setelah `plugin.js` ter-cache, ukur klik kedua), `document.querySelectorAll('.plg-timeline-root *').length` ≤ 1.500 saat diam dan saat gulir; gulir 3 s → tidak ada long task > 50 ms berturut (PerformanceObserver) — catat angka.
7. 375 px: kolom WBS+Nama menempel, gulir horizontal di dalam wadah, `document.documentElement.scrollWidth === 375`; tekan lama 350 ms lalu seret menggeser; sakelar "Daftar" menampilkan kelompok minggu.
8. Sakura gelap: bar, arsir, bendera, panah terbaca (tangkapan); konsol tanpa error.
9. Plugin OFF dari Pengaturan saat view Timeline aktif → kembali ke mode inti tanpa reload; seksi Jadwal hilang dari detail.
10. Tauri Desktop bila build tersedia (lewati dengan catatan bila tidak).

- [ ] **Step 1:** tulis skrip; **Step 2:** `python3 temporary_files/e2e_plugin_fase1_1b.py` → semua cek lolos (catat N/N + angka kinerja); regresi `e2e_plugin_fase1_1a1.py`, E2E 1a-2, `e2e_plugin_fase0a.py`, `e2e_plugin_fase0b.py` lulus.
- [ ] **Step 3: Commit** `test(timeline): E2E Timeline 1b (seret, dependensi, kalender bersama, 500 task, HP)`

### Task 14: Verifikasi akhir, dokumen, handover, review, PR draft

**Files:** `docs/superpowers/specs/2026-10-31-plugin-fase1-timeline-design.md` (+ "### Catatan implementasi PR 1b (<tanggal>)" di §2), `docs/superpowers/plans/2026-11-01-plugin-fase1-pr-1b-timeline.md` (salinan rencana ini), `.agents/CURRENT_STATE.md`, `.agents/SESSION_LOG.md`

- [ ] **Step 1: Verifikasi** dan catat angka: `python3 -m pytest tests/ -q`; `npm test` (hanya `draw_local_reactive`); `node --test tests/build-plugins.test.js`; PROTOCOL §4 butir 5; `node temporary_files/check_inline_scripts.js static/index.html`; `node compile.js` dua kali tanpa diff; `git diff --stat origin/main -- static/app.css static/offline webapp.py plugin_loader.py task_ext.py` kosong; `git diff origin/main -- static/index.html` hanya string versi SW; `git diff origin/main -- 'tests/*.py' 'tests/offline/*.js'` hanya berkas baru + `test_plugins_node.py` + penambahan `plugin_api.test.js`/`build-plugins.test.js` + tes versi SW.
- [ ] **Step 2: Dokumen:** catatan implementasi di spec repo (R1, R2, R4, R5, R7–R10, R13, R14, R17, R21, R25 ringkas; D1–D8 sebagaimana terpenuhi di 1a-2) dan salinan Project `claude/spec-plugin-fase1-timeline-2026-10-31.md` lewat `project_write` (isi sama); salin rencana ke `docs/superpowers/plans/`.
- [ ] **Step 3: Handover** `CURRENT_STATE.md`: `## 🟡 Plugin Fase 1 — PR 1b: Timeline dasar — claude/plugin-timeline — <tanggal> (Claude) — PR DRAFT, menunggu "merge dan deploy"`: spec/plan/ADR-042; isi; rilis SW `<versi>` dengan whatsnew; deploy = file statis (**tanpa restart** bila D6 terpenuhi; bila tidak, `sudo systemctl restart taskflow-web`); verifikasi pasca-deploy (Pengaturan › Plugin menampilkan Timeline OFF; nyalakan → tombol Timeline di project/workspace; `GET /api/plugins/timeline/records` 200); rollback; tindak lanjut (SKB 2028 begitu terbit ±Sep 2027; 1c). `SESSION_LOG.md` entri baru (format PROTOCOL §3.2).
- [ ] **Step 4: Commit** `docs(agents): handover PR 1b Timeline`
- [ ] **Step 5: Review akhir oleh subagen reviewer terpisah** (Review Focus 1–5 + R1–R26; khusus: tidak ada `Date` lokal di parts; tidak ada setState per piksel; tepat satu tulis per lepas; Urungkan memulihkan kunci yang dulu tidak ada; `canLink` mencegah siklus di view **dan** seksi; ref cid/server id; kalender bersama memakai id deterministik; data libur cocok dengan SKB (cek silang acak 5 tanggal per tahun); `index.html` +0; tanpa `localStorage`/`innerHTML`/hex). Perbaiki temuan wajib, ulangi Step 1.
- [ ] **Step 6: Push + PR draft** judul `Plugin Fase 1 — PR 1b: Timeline dasar (Gantt Manual, hari kerja + libur nasional, seksi Jadwal)`; body: ringkasan, tangkapan layar (desktop terang, Sakura gelap, 375 px), tabel file, R penting, D1–D8 (terpenuhi oleh 1a-2 #…), catatan deploy (file statis; restart hanya bila D6 tidak terpenuhi), rollback (matikan plugin tanpa deploy, atau revert sebagai rilis baru + whatsnew `silent`), angka tes + kinerja E2E; akhiri dengan atribusi sesi. Merge hanya setelah Bapak bilang "merge dan deploy".

---

## Keputusan UI untuk pemilik (sebelum Task 7)

| # | Pertanyaan | Pilihan | Rekomendasi |
|---|---|---|---|
| **U1** | Di mana mengatur **kalender kerja** (hari kerja, ikuti libur nasional/cuti bersama, libur tambahan)? | (a) tombol "Kalender kerja" di toolbar Timeline (popover); (b) halaman Kelola Workspace; (c) seksi Jadwal | **(a)** — tanpa menyentuh host (`index.html` +0, aturan "shell dibekukan"); di workspace diberi keterangan "Dipakai semua anggota workspace". (b) butuh slot host baru. |
| **U2** | **Task tanpa jadwal** di Gantt | (a) tetap di posisi WBS tanpa bar, klik baris di grafik untuk menjadwalkan (durasi 1); (b) dikumpulkan di bagian "Belum dijadwalkan" di bawah; (c) disembunyikan | **(a)** — hierarki/WBS tetap utuh dan menjadwalkan cukup satu klik; (b) memecah induk dari anaknya. |
| **U3** | **Fallback daftar di HP** | (a) sakelar "Gantt / Daftar" di toolbar ≤ 640 px, bawaan Gantt, pilihan diingat per halaman; (b) otomatis Daftar di HP; (c) tanpa Daftar | **(a)** — Gantt tetap bisa dipakai (gulir horizontal + tekan lama), Daftar per minggu untuk membaca cepat. |
| **U4** | **Pengumuman dan status awal** | (a) `defaultEnabled: false` + whatsnew yang mengarahkan ke Pengaturan › Plugin (teks Task 12 Step 2); (b) `defaultEnabled: true` | **(a)** — sesuai spec §8.1 dan Fase 0; tidak ada tombol baru yang muncul tiba-tiba di semua akun. Mohon setujui/ubah teks whatsnew. |
