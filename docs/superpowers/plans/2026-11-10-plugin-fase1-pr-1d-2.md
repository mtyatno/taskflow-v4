# PR 1d-2 — Timeline 1.4: earned value 🍅 + ekspor Microsoft Project — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Timeline 1.4.0 menambah dua hal:
- **Earned value 🍅** dari baseline aktif, tampil di toolbar sebagai "Jadwal 92% · Efisiensi 🍅 108%" (Q6 (a)).
- **Ekspor MSPDI XML** (Microsoft Project), dibangun penuh di klien lewat fasad baru `api.ui.saveFile`. Di aplikasi native, tombol ekspor menampilkan petunjuk ke browser (Q7 (a)).

Fitur ini menutup Fase 1. Tidak ada tulisan data baru: EV dan ekspor hanya membaca (K27/R25).

**Architecture:**
- Fungsi murni `TLLoad.ev` (spec §5.3) di `load.js`.
- Modul murni baru `mspdi.js` (`TLMspdi`, spec §5.4).
- `TLPlan.baselineDecode` diperluas agar membaca bobot `w`.
- `api.ui.saveFile` aditif di `plugin-runtime.js` (API v1, `minApi` tetap 1).
- Item "Ekspor ke Microsoft Project (.xml)" di menu "Lainnya".
- Ringkasan EV di sisi kanan toolbar.

**Tech Stack:** React UMD plugin, node:test + jsdom-lite harness `timeline_ui`, pytest, Playwright E2E, MPXJ (Python + Java, hanya untuk verifikasi di `temporary_files`).

**Spec:** `docs/superpowers/specs/2026-11-06-plugin-fase1-1d-beban-tim-design.md`:
- K51–K54, K57, K59;
- §1 kriteria 4, 5, 7, 8;
- §5.3–§5.5, §7.1, §7.5, §7.7, §8 (bagian ekspor), §9, §10, §11 R5–R6.

Jawaban pemilik: Q6 (a), Q7 (a). Catatan implementasi 1d-0/1d-1 dan ADR-049 tetap berlaku. Keputusan pemilik P1–P2 ada di akhir dokumen ini.

**Keputusan pemilik (2026-11-10 13.58 WIB): P1 (a) — teks whatsnew v502 disetujui apa adanya; P2 (a) — host memberi nama workspace (`listName`) ke konteks Timeline untuk nama berkas/judul ekspor.**

**Basis kode:** `main` @ `6182810` (setelah #130 1d-1).
- SW `taskflow-v501-beban-tim`, `app.css?v=384`, IndexedDB v7.
- `index.html` 46.236 baris, `plugin-runtime.js` 1.704 baris, ADR terakhir ADR-049.
- Timeline 1.3.0: `plugin.jsx` 7.229, `load.js` 414, `plan.js` 568, `layout.js` 643, `schedule.js` 651, `cpm.js` 535, `calendar.js` 250 baris.

## Fakta hasil eksplorasi

| # | Fakta | Lokasi | Akibat |
|---|---|---|---|
| G1 | Baseline 1c-2 menyimpan `[ref, s, f, d, w]` dengan `w` = target 🍅 saat disimpan (`weightOf`). `baselineDecode` **tidak membaca** `w` ("w tidak dibaca (1d)"). | `plan.js:463`, `:469–489`, `:494–513` | Decode harus diperluas: `w` bulat ≥ 0, absen/rusak → 0 (T1) |
| G2 | Baseline aktif = pref `bl:<page>` (slot 1–3) per perangkat. `activeBaseline(bls.byUnit, recIds, n)` menggabung baris per unit; `recIds` berasal dari `pageUnits(lay, …)`, yaitu baris yang **sudah difilter panel**. | `plugin.jsx:1428`, `:4493`, `:4589–4594` | Agar angka EV tidak bergantung filter, unit untuk EV diambil dari `eng.ctx.tasks` (R2) |
| G3 | Toolbar kanan: `.plg-timeline-toolbar-end` berisi "Selesai {tgl}" + chip terlambat. Extras jadi tombol di layar lebar dan masuk `MoreMenu` hanya saat `collapse` (≤ 640 px / Live Edit). Desktop lebar **tidak punya** menu "Lainnya". | `plugin.jsx:1640–1710`, `:3267` | Ekspor ditaruh di menu "Lainnya" yang juga tampil di desktop (R6) |
| G4 | `api.ui` = `toast/openTask/navigate/sanitize` (beku). `api.env.platform` = `"tauri"` bila `__TAURI__`, selain itu `"web"`. Host native memakai `API_BASE` lintas-origin sehingga `<a download>` tidak berlaku (`mediaNativeShell`). | `plugin-runtime.js:1124–1162`; `index.html:697–701` | `saveFile` di native → `false` + petunjuk browser (Q7 (a)) tanpa API env baru |
| G5 | Pola unduh web: Blob → `URL.createObjectURL` → `<a download>` → click → revoke. | `index.html:785–800` (`downloadBackup`) | Ditiru di runtime (K54), bukan di `index.html` |
| G6 | `context` slot memuat `page, pageKind, listId, projectName, tasks, scopeTasks, collaborators, currentUser, onTaskClick, isSelected, liveEdit, showToast`, **tanpa nama workspace**. | `index.html:19655` (`extCtx`), README §6.2 | Nama berkas/judul ekspor halaman workspace → **P2** |
| G7 | `TLLayout.wbsMap(tasks, pageKind, readSchedOf)` = nomor WBS urut bawaan, tanpa baris kelompok. `layout({…, sort: "wbs"})` memberi baris kelompok (`kind: "group"`, `wbs: String(g.n)`). | `layout.js:463`, `:612` | Struktur outline ekspor (R7) |
| G8 | Kendala hanya `SNET`/`MFO` (+ ASAP bila kosong). Dependensi `FS/SS/FF/SF`, `lag` bulat −99…999 hari kerja. `result.cycles` = larik kunci per lingkaran. | `schedule.js:10–14`, `:47–51`, `:61`; `cpm.js:235–243`, `:426` | Pemetaan MSPDI (R7) |
| G9 | Mode efektif `TLSched.modeOf(raw, units, task)`: project Manual (bawaan) → semua task `manual`, tanggal tersimpan tidak dihitung ulang. | `schedule.js:284` | MS Project harus menjaga tanggal task Manual (R8) |
| G10 | Domain produksi `https://alurik.com` (`WEBAPP_URL`), sesuai teks Q7 (a). Java tersedia di sandbox; MPXJ bisa dipasang lewat pip. | `config.py:52` | Verifikasi baca XML otomatis (T7) |

## Keputusan rencana (controller)

- **R1 — EV di `load.js`** (`TLLoad.ev(bl, ctx, D)`, spec §5.3).
  - Masukan `bl = {n, name, rows: Map<refKey, {s, f, d, w}>}` dan `ctx = {tasks, cal, result}`.
  - Baris baseline dipetakan ke task lewat `TLSched.buildIndex(ctx.tasks)`, sama dengan `compareBaseline`. Task yang tidak ditemukan (dihapus, diarsip, di luar halaman) dibuang dari **semua** angka dan dihitung `missing`.
  - Rumus per baris:
    - BAC += w.
    - PV += w × hk(s..min(f, D)) ÷ hk(s..f), dengan hk = hari kerja kalender halaman saat ini dan pembilang 0 bila D < s. Milestone (d = 0): PV += w bila D ≥ s.
    - EV += w × % selesai: task selesai = 100; selain itu `Number(progress)` dijepit 0–100, tak hingga/NaN → 0 (string angka `"50"` = 50 %, sama dengan `cpm.js`/`plan.js`/`layout.js`) (dikoreksi review F1).
    - AC += `pomodoros_done` (bulat ≥ 0).
  - Semua angka dalam milipomodoro, dibulatkan per baris lalu dijumlah agar determinis.
  - SPI = EV ÷ PV dan CPI = EV ÷ AC; penyebut 0 → `null`.
  - `outside` = task hidup, bukan berulang, bukan ringkasan, yang tidak ada di baseline.
  - BAC = 0 → `ev` mengembalikan `null` (ringkasan tidak tampil, K51).
  - Format (Q6 (a)):
    - teks = `"Jadwal {p}% · Efisiensi 🍅 {q}%"` (persen bulat; `null` → "—");
    - tooltip = `"Baseline: {nama} · PV {x} · EV {y} · AC {z} · BAC {w} 🍅"` (🍅 satu desimal, titik desimal seperti host), ditambah `" · {n} task di luar baseline"` bila n > 0.
- **R2 — Unit untuk EV dari daftar lengkap.**
  - `activeBaseline(bls.byUnit, unitIdsOf(eng.ctx.tasks), blPref)`; `unitIdsOf` = `TLSched.unitOf(task).recId` unik, urut `cmpKey`.
  - Nama baseline: semua unit yang punya slot n bernama sama → nama itu; selain itu "Baseline {n}".
  - Tanpa baseline aktif atau BAC = 0 → ringkasan tidak dirender.
  - EV dihitung di `useMemo` atas `[eng.result, eng.ctx, blRowsKey, todayDn]`, setelah mesin siap. Tidak pernah menulis.
- **R3 — `baselineDecode` membaca `w`.** Baris berisi `{s, f, d, w}`, dengan `w` = `e[4]` bila bilangan bulat 0–99 (batas = `EST_MAX` host, dikoreksi review F1), selain itu 0 (baseline lama tetap sah). `compareBaseline` tidak berubah.
- **R4 — `api.ui.saveFile(name, text, mime) → Promise<boolean>`** (K54, aditif, `minApi` tetap 1).
  - Validasi, sebelum cabang native (gagal → `Promise.reject(new TypeError("saveFile: <alasan>"))` tanpa `markFailed` dan tanpa efek, pola validasi `storage`/`fetch`; `saveFile` tidak berizin sehingga tidak ada izin yang dilanggar, tidak dihitung error plugin, dan tidak mematikan plugin; `saveFile` tidak pernah melempar sinkron; `name` bukan string atau > 240 unit UTF-16 ditolak sebelum `Array.from`) (dikoreksi review F1):
    - `name` string 1–120 karakter, tanpa `/ \ : * ? " < > |`, karakter kontrol, atau awalan titik;
    - `text` string ≤ 20 MiB (UTF-16 `length`);
    - `mime` ∈ `{"application/xml", "text/xml", "text/csv", "text/plain", "application/json"}`.
  - `api.env.platform === "tauri"` → resolve `false` tanpa aksi.
  - Web: Blob `mime + ";charset=utf-8"` → `URL.createObjectURL` → `<a download=name>` ditempel ke `document.body` → `click()` → dilepas → `revokeObjectURL` lewat `setTimeout(…, 1000)` → resolve `true`. Pengecualian → reject.
  - Tanpa izin manifest baru; dipicu gestur pengguna (dokumentasi README §5).
- **R5 — Ekspor = baca saja.** `buildExport` memakai `eng.ctx.tasks` (daftar lengkap halaman, tanpa filter panel), `eng.ctx.cal`, `eng.result`, baseline aktif (R2), nama orang dari `currentUser` + `collaborators` (pola `peopleOf`), dan `todayDn`. Item menu nonaktif sampai mesin siap.
  - Toast sukses: `"Berkas {nama} diunduh"`, ditambah `" · {n} task tanpa jadwal ditandai perkiraan"` dan/atau `" · {k} tautan dilewati"` bila > 0.
  - Galat: `"Ekspor gagal"`.
  - Native: `"Ekspor tersedia di alurik.com lewat browser"` (Q7 (a)), tanpa membangun XML.
  - Pagar R25 tidak berubah.
- **R6 — Letak menu.** Item `"Ekspor ke Microsoft Project (.xml)"` (`role="menuitem"`):
  - Desktop lebar: toolbar mendapat tombol menu **"Lainnya"** tetap (komponen `MoreMenu` yang sama) setelah extras; isinya hanya item ekspor.
  - Saat `collapse`: item ditambahkan di akhir daftar "Lainnya" yang sudah ada.
  - Tes urutan toolbar/Lainnya 1c/1d diperbarui (alasan: spec §7.1).
- **R7 — Pemetaan MSPDI** (spec K53, §5.4). Namespace `http://schemas.microsoft.com/project`, `SaveVersion` 14. Urutan elemen **mengikuti XSD MSPDI** (implementer memverifikasi dengan MPXJ, T7).
  - **Kalender:** satu kalender dasar UID 1. `WeekDays` gaya Project 2003:
    - `DayType` 1–7 (1 = Minggu) dengan `DayWorking` dari pola mingguan kalender halaman. Hari kerja `WorkingTimes` 08:00–12:00 dan 13:00–17:00 (480 menit).
    - Pengecualian = `WeekDay` `DayType 0` dengan `TimePeriod`. Libur di hari kerja → `DayWorking 0`; hari kerja pengganti di akhir pekan → `DayWorking 1` + `WorkingTimes`. Hari berurutan sejenis digabung.
    - Rentang: [mulai paling awal − 7, selesai paling akhir + 31] hari, maksimal 3.660 hari.
  - **Task:**
    - UID 0 = ringkasan project (`OutlineLevel 0`).
    - UID 1…n mengikuti urutan baris `TLLayout.layout({…, sort: "wbs"})`. Halaman workspace: baris kelompok = task ringkasan tingkat 1 (nama kelompok atau "(Tanpa project)"), task di bawahnya +1 tingkat. Halaman project: task tingkat 1 dan seterusnya. `OutlineNumber`/`WBS` = nomor WBS Timeline.
    - `Type 1` (durasi tetap), `EffortDriven 0`.
    - `Start` = s 08:00, `Finish` = f 17:00 (`YYYY-MM-DDTHH:MM:SS`, lokal-naif Jakarta).
    - `Duration` `PT{d×8}H0M0S`, `DurationFormat 7`.
    - `Milestone 1` bila d = 0 (Start = Finish = s 08:00).
    - `Summary 1` untuk induk dan kelompok.
    - `PercentComplete` (selesai 100, selain itu `progress`).
    - Kendala: ASAP 0; SNET 4 / MFO 3 + `ConstraintDate` 08:00 / 17:00.
    - `PredecessorLink`: `Type` FF 0 / FS 1 / SF 2 / SS 3, `LinkLag` = lag × 4.800, `LagFormat 7`.
    - `Baseline` `Number 0` (`Start`, `Finish`, `Duration`, `Work` = w × 25 menit) dari baseline aktif bila ada.
  - **Tautan dilewati** (dihitung `skippedLinks`): ke task di luar berkas, dan antaranggota `result.cycles`.
  - **Task tanpa jadwal:** `Start` = D 08:00, `Duration PT8H0M0S`, `Estimated 1`, `Manual 1`.
  - **Resource:** setiap penanggung jawab task di berkas (workspace) atau pemilik (pribadi), dengan `Type 1`, `MaxUnits 1`. Nama dari currentUser/collaborators, selain itu "Anggota #id".
  - **Assignment:** hanya untuk task non-ringkasan dengan d > 0. `Work` = target × 25 menit (`PT{h}H{m}M0S`), `Units` = Work ÷ (d × 480) dibulatkan 4 desimal.
  - **Escape** `& < > " '`; karakter kontrol C0 selain `\t \n \r` dibuang.
  - **Determinisme:** tanpa `Date`; `CreationDate` = D 00:00:00.
- **R8 — Task Manual tetap di tanggalnya.** Task dengan mode efektif `manual` (G9) diekspor `Manual 1` (penjadwalan manual Project 2010+). Bila task itu tanpa kendala eksplisit, ditambah `ConstraintType 4` (SNET) di tanggal mulai tersimpan, supaya pembaca tanpa penjadwalan manual (mis. ProjectLibre) juga tidak memajukannya ke awal project.
  - Task Otomatis diekspor terjadwal otomatis dengan kendala/dependensi apa adanya. MS Project lalu menghitungnya sama dengan mesin Timeline; task yang sedang drift tampil di tanggal hasil mesin.
  - Dicatat di ADR-050 dan diverifikasi pemilik.
- **R9 — Nama berkas** `{judul}-{YYYY-MM-DD}.xml`; karakter tak aman (R4) dan spasi berlebih diganti "-", dipotong 80 karakter.
  - Judul halaman project = `projectName`.
  - Judul workspace sesuai P2.
  - `<Title>` = judul; `<Name>` = nama berkas.
- **R10 — Anggaran.**
  - EV O(baris baseline × hari kerja), ≤ 5 ms untuk 500 baris (Node).
  - `TLMspdi.build` 1.000 task ≤ 300 ms (Node) dan menghasilkan string, bukan DOM. Hanya dijalankan saat diklik.
  - Render awal tidak berubah (EV dihitung setelah mesin siap, 1 elemen DOM).
- **R11 — ADR-050** (cek nomor terhadap `main` saat rilis): R1–R10, residual (resource tanpa kapasitas/kalender orang; ProjectLibre mungkin mengabaikan `Manual`; tanpa `ActualStart`/`ActualFinish`).

## Global Constraints

- **Aturan 1c/1d-1 tetap berlaku:**
  - komentar dan nama tes berbahasa Indonesia;
  - lint plugin: tanpa fetch, localStorage, innerHTML, hex, `Date`, `localeCompare`;
  - CSS `.plg-timeline-*` dengan token saja, tanpa `border-left` aksen;
  - mesin dan ekspor tidak pernah menulis; pagar R25 tidak berubah.
- **Proses:**
  - TDD per tugas;
  - `node compile.js --plugins-only` setelah mengubah sumber plugin; berkas hasil di-commit; build dua kali tanpa diff;
  - commit diakhiri trailer atribusi sesi;
  - implementer/reviewer tidak push.
- **Tidak berubah:** `webapp.py`, `plugin_records.py`, `static/offline/**`, `app.css` (`?v=384`), IndexedDB v7.
  - `index.html` hanya 2 string versi SW, **kecuali** P2 (a): +1 field `listName` di objek `extCtx`, dengan baris sesedikit mungkin.
  - `plugin-runtime.js` hanya menambah `saveFile`.
- **String UI baru (persis, diperiksa tes):**
  - "Ekspor ke Microsoft Project (.xml)"
  - "Lainnya" (sudah ada)
  - "Berkas {nama} diunduh"
  - " · {n} task tanpa jadwal ditandai perkiraan"
  - " · {k} tautan dilewati"
  - "Ekspor gagal"
  - "Ekspor tersedia di alurik.com lewat browser"
  - "Jadwal {p}% · Efisiensi 🍅 {q}%"
  - "Baseline: {nama} · PV {x} · EV {y} · AC {z} · BAC {w} 🍅"
  - " · {n} task di luar baseline"
  - "Baseline {n}"
  - "(Tanpa project)" (sudah ada)
- **Rilis:** SW berikutnya diperkirakan **`taskflow-v502-ev-ekspor`** (cek terhadap `main` saat merge); whatsnew **non-silent** dengan teks dari P1.
- PR dibuka sebagai **DRAFT**. Merge hanya atas "merge dan deploy", dan **setelah pemilik membuka satu berkas ekspor di Microsoft Project atau ProjectLibre** (spec §1 kriteria 5). Deploy statis, tanpa restart.

## Review Focus

1. **Nol tulisan:** EV, ekspor, `saveFile`, dan menu tidak memanggil `taskExt.set/setMany` maupun `records.put/remove`; pagar dan pin R25 tidak berubah.
2. **EV benar dan stabil:** fixture PV/EV/AC/SPI/CPI (penyebut 0, milestone, task di luar baseline, task baseline yang dihapus, baseline lama tanpa `w`); angka sama untuk filter panel apa pun dan identik lintas perangkat dengan baseline yang sama.
3. **XML terbaca:**
   - urutan elemen sesuai XSD;
   - MPXJ membaca jumlah task/tautan/resource/assignment, tanggal, durasi, milestone, % selesai, kendala, empat tipe dependensi + lag, kalender + libur, dan baseline sesuai masukan;
   - escape dan karakter kontrol;
   - determinis (dua build identik).
4. **`saveFile` aman:** validasi nama/mime/ukuran → reject `TypeError` tanpa efek, bukan error plugin, tidak pernah melempar sinkron (dikoreksi review F1); native → `false` tanpa efek; web → satu unduhan, URL dicabut; tidak ada jalur tanpa gestur dari kode plugin (hanya dari handler menu).
5. **Anggaran dan regresi:** render awal sama; DOM +1 elemen; toolbar/Lainnya di HP 375 px tanpa gulir horizontal.

---

### Task 1: `baselineDecode` membaca `w` + `TLLoad.ev`

**Files:** Modify `static/plugins/timeline/plan.js`, `static/plugins/timeline/load.js`, `tests/offline/timeline_plan.test.js` (atau berkas tes baseline 1c-2 yang memuat `baselineDecode`), `tests/offline/timeline_load.test.js`

**Interfaces (Produces):**
- `baselineDecode(data).rows: Map<key, {s, f, d, w}>`.
- `TLLoad.ev(bl, ctx, D) → {bac, pv, ev, ac, spi, cpi, rows, outside, missing} | null` (R1).
- `TLLoad.evText(r) → string`.
- `TLLoad.evTip(r, name) → string` (format persis R1).
- `TLLoad.fmtPomo1(milli) → string` (satu desimal, titik).

- [ ] **Step 1: Tes gagal** (Indonesia):
  - `w` dibaca; `w` absen/negatif/pecahan → 0; baseline 1c-2 lama tetap terdekode;
  - fixture tangan: 3 task × hari kerja dengan libur → PV/EV/AC/BAC/SPI/CPI persis;
  - D sebelum mulai → PV 0 dan SPI null;
  - milestone sebelum/sesudah D;
  - task selesai = 100 %;
  - `progress` di luar batas dijepit;
  - AC 0 → CPI null;
  - task baseline dihapus → `missing` dan tidak dihitung;
  - task baru di luar baseline → `outside`;
  - BAC 0 → null;
  - determinisme 50 permutasi;
  - 500 baris ≤ 5 ms;
  - teks dan tooltip persis (termasuk "—" dan " · {n} task di luar baseline");
  - tanpa `Date`.
- [ ] **Step 2–4:** FAIL → implementasi → PASS; `npm test` penuh.
- [ ] **Step 5: Commit** `feat(timeline): earned value 🍅 dari baseline aktif (murni)`

### Task 2: `api.ui.saveFile` di runtime

**Files:** Modify `static/plugin-runtime.js`, `tests/offline/plugin_api.test.js` (mengunci permukaan `api.ui`), `docs/plugins/README.md` §5 (`api.ui`)

- [ ] **Step 1: Tes gagal:**
  - kunci `api.ui` + `saveFile`;
  - validasi (nama kosong/terlalu panjang/berkarakter terlarang/berawalan titik, mime di luar daftar, teks bukan string, > 20 MiB) → reject `TypeError` tanpa efek; `failures` tetap 0 setelah ≥ 3 penolakan dan plugin tidak diredam; panggilan tidak melempar sinkron (termasuk getter global yang melempar) (dikoreksi review F1);
  - `platform` tauri → resolve `false`, 0 elemen `<a>`, 0 `createObjectURL`;
  - web (document dan URL palsu): satu `<a>` dengan `download` = nama dan `href` = URL objek, `click` sekali, elemen dilepas, `revokeObjectURL` setelah timer, resolve `true`;
  - `click` melempar → reject.
- [ ] **Step 2–4.** **Step 5: Commit** `feat(plugin-runtime): api.ui.saveFile untuk unduhan berkas dari plugin`

### Task 3: `mspdi.js` — pembangun XML (murni)

**Files:** Create `static/plugins/timeline/mspdi.js` (UMD `TLMspdi`, pola `load.js`), `tests/offline/timeline_mspdi.test.js`; Modify `tests/test_plugins_node.py` (REQUIRED + `timeline_mspdi`)

**Interfaces:**
- `TLMspdi.build({tasks, cal, readExt, result, units, pageKind, title, fileName, people, baseline, D}) → {xml, stats: {tasks, links, skippedLinks, unscheduled, resources, assignments}}` (R7–R9).
- `TLMspdi.fileNameOf(title, D)`.
- `TLMspdi.esc(s)`.

- [ ] **Step 1: Tes gagal** (parse dengan parser XML sederhana atau regex terarah; tanpa dependensi baru):
  - prolog + namespace;
  - urutan elemen Project → Calendars → Tasks → Resources → Assignments;
  - urutan anak `Task` sesuai daftar XSD (tes memuat daftar urutan yang dipakai);
  - kalender (pola mingguan, libur, hari kerja pengganti, penggabungan rentang);
  - outline workspace (kelompok tingkat 1) dan project;
  - Start/Finish/Duration/milestone/summary/% selesai;
  - kendala SNET/MFO/ASAP;
  - empat tipe tautan + lag (termasuk negatif);
  - tautan ke luar berkas dan lingkaran dilewati;
  - Manual (R8): `Manual 1` + SNET bila tanpa kendala;
  - tanpa jadwal → Estimated/Manual;
  - baseline Number 0;
  - resource/assignment Work/Units;
  - escape `& < > " '`, emoji, karakter kontrol dibuang;
  - `fileNameOf` (karakter tak aman, potong 80);
  - determinisme (dua build identik, 50 permutasi masukan);
  - 1.000 task ≤ 300 ms;
  - tanpa `Date`/`localeCompare` di sumber.
- [ ] **Step 2–4.** **Step 5: Commit** `feat(timeline): pembangun MSPDI XML untuk ekspor Microsoft Project (murni)`

### Task 4: Manifest 1.4.0 + ringkasan EV di toolbar

**Files:**
- Modify: `manifest.json` (version `1.4.0`, parts + `mspdi.js` setelah `load.js`), `plugin.jsx`, `style.css`, `tests/offline/timeline_ui.test.js`, `tests/build-plugins.test.js`, `tests/offline/timeline_runtime.test.js`.
- Generated: `plugin.js`, `index.json`, blok hash `sw.js`.

- [ ] **Step 1: Tes gagal:**
  - build 1.4.0 + parts berurutan;
  - `unitIdsOf` dari `eng.ctx.tasks` (filter panel tidak mengubah EV);
  - ringkasan `.plg-timeline-ev` dengan teks persis sebelum "Selesai {tgl}" saat baseline aktif ber-BAC > 0;
  - tooltip persis (`title` + teks tersembunyi untuk pembaca layar, pola yang sudah ada);
  - tanpa baseline aktif / BAC 0 / mesin belum siap → tidak dirender;
  - nama baseline seragam vs campur ("Baseline {n}");
  - render awal: EV tidak dihitung sebelum mesin siap (spy);
  - 0 tulis;
  - DOM +1;
  - CSS token.
- [ ] **Step 2–4.** **Step 5: Commit** `feat(timeline): ringkasan earned value di toolbar`

### Task 5: Menu ekspor + alur unduh (+ P2 (a): nama workspace dari host)

**Files:** Modify `plugin.jsx`, `style.css`, `tests/offline/timeline_ui.test.js`; bila P2 (a): `static/index.html` (`extCtx` + `listName`), `docs/plugins/README.md` §6.2, `tests/offline/plugin_host_wiring.test.js` (anggaran baris + asersi field)

- [ ] **Step 1: Tes gagal:**
  - desktop lebar: tombol "Lainnya" tetap setelah extras, berisi tepat "Ekspor ke Microsoft Project (.xml)";
  - `collapse`: item di akhir daftar Lainnya;
  - item nonaktif sebelum mesin siap;
  - klik di web → `TLMspdi.build` sekali dengan masukan R5 (daftar lengkap, baseline aktif, nama orang) → `api.ui.saveFile(nama, xml, "application/xml")` → toast persis (varian tanpa jadwal/tautan dilewati);
  - `saveFile` reject atau `build` lempar → "Ekspor gagal";
  - `platform` tauri → toast "Ekspor tersedia di alurik.com lewat browser" dan `build` tidak dipanggil;
  - nama berkas: project = `projectName`, workspace = P2;
  - 0 tulis;
  - urutan toolbar/Lainnya 1c–1d diperbarui;
  - HP 375 px tanpa luber (struktur CSS).
- [ ] **Step 2–4.** **Step 5: Commit** `feat(timeline): ekspor ke Microsoft Project (.xml) dari menu Lainnya`

### Task 6: Rilis — SW v502, whatsnew (P1), README, ADR-050

**Files:** `static/sw.js`, `static/index.html` (2 string versi), ganti massal versi lama (**kecuali** `static/whatsnew.json`), `static/whatsnew.json`, `docs/plugins/README.md` (judul "(Fase 0a–1d-2)", §5 `saveFile`, §6.2 EV + ekspor, §8), `.agents/DECISIONS.md`

- [ ] **Step 1:** versi berikutnya setelah v501 (cek `main`), PROTOCOL §4 lengkap; `app.css?v=384` tetap.
- [ ] **Step 2:** whatsnew teratas non-silent, teks = P1.
- [ ] **Step 3:** ADR-050 (nomor dicek ulang) = R1–R11 + residual.
- [ ] **Step 4:** PROTOCOL §4 butir 5 + `npm test` + pytest penuh + `compile.js` idempoten + jumlah baris `index.html`.
- [ ] **Step 5: Commit** `chore(release): SW v502 Timeline 1.4 earned value + ekspor MSPDI, README, ADR-050`

### Task 7: E2E + verifikasi MPXJ + review akhir + PR draft

**Files:** Create `temporary_files/e2e_plugin_fase1_1d2.py`, `temporary_files/mspdi_check.py` (baca XML lewat MPXJ: `pip install --break-system-packages mpxj` + Java sistem; bila gagal dipasang, catat dan lanjutkan dengan `xml.etree`); Modify spec (catatan implementasi 1d-2), `.agents/CURRENT_STATE.md`, `.agents/SESSION_LOG.md`

**Skenario minimum:**
1. **EV:** simpan baseline → majukan progres/🍅 dan jam palsu → teks ringkasan sama dengan hitungan manual. Filter panel tidak mengubah angka. Perangkat kedua dengan baseline aktif sama → angka sama. Tanpa baseline → tidak tampil.
2. **Ekspor web:** unduh XML (`page.expect_download`) di halaman project dan workspace multi-project. `xml.etree`: struktur, jumlah task/tautan, kelompok tingkat 1. `mspdi_check.py` (MPXJ): jumlah task/tautan/resource/assignment, tanggal Start/Finish, durasi, milestone, % selesai, kendala, tipe + lag tautan, hari libur kalender, dan baseline cocok dengan Timeline. Dua ekspor berturut identik.
3. **Native:** `window.__TAURI__` disuntik → klik ekspor → toast petunjuk dan tidak ada unduhan.
4. **Nol tulisan** selama EV/ekspor; render awal sama dengan 1.3.
5. **Klien 1.3 (dipatok `847067e`):** tetap berjalan dengan data dari 1.4 (tidak ada record baru).
6. **Tampilan:** 375 px + Sakura gelap (toolbar + ringkasan EV tanpa gulir horizontal), 1280 px terang.
7. **Regresi:** `1d1`, `1d0`, `1c2` (Senin digeser bila perlu), `1c1`, `1c0b`, `1c0`, `1b`, `1a2`, `1a1`.

- [ ] **Step 1:** skrip + jalankan semua cek, lalu regresi. Bug produk → BLOCKED.
- [ ] **Step 2:** verifikasi akhir penuh (pola 1d-1). Diff terhadap `main`: `static/offline`, server, `app.css` kosong; `index.html` hanya string versi (+ P2 (a)).
- [ ] **Step 3:** catatan implementasi spec + handover; commit `docs(agents): handover PR 1d-2 Timeline EV + ekspor`.
- [ ] **Step 4:** review akhir seluruh branch oleh reviewer terpisah. Perbaiki temuan wajib, lalu ulangi Step 2.
- [ ] **Step 5:** push + PR DRAFT `Plugin Fase 1 — PR 1d-2: Timeline 1.4 (earned value + ekspor Microsoft Project)`, dengan **berkas contoh XML terlampir** untuk dibuka pemilik. Merge hanya setelah pemilik membuka berkas itu di MS Project/ProjectLibre dan bilang "merge dan deploy".

---

## Keputusan untuk pemilik (sebelum Task 4)

| # | Pertanyaan | Pilihan | Rekomendasi |
|---|---|---|---|
| **P1** | **Teks "Apa yang baru"** v502 | (a) setujui usulan apa adanya; (b) ubah | **(a)** — judul **"Timeline: kinerja jadwal dan ekspor"**; poin `new`: "Bandingkan kemajuan dengan baseline: toolbar Gantt kini menampilkan “Jadwal 92% · Efisiensi 🍅 108%”.", "Ekspor Timeline ke Microsoft Project (.xml) dari menu Lainnya.", "Di aplikasi desktop dan Android, ekspor dilakukan lewat browser di alurik.com." |
| **P2** | **Nama berkas ekspor halaman workspace.** Timeline tahu nama project pribadi, tetapi **tidak** tahu nama workspace (host hanya memberi nomornya). | (a) **perubahan kecil di aplikasi inti:** host ikut memberikan nama workspace ke Timeline (satu field, ± 1 baris), sehingga berkas bernama mis. "Tim Pemasaran-2026-11-10.xml" dan judul project di MS Project sama dengan nama workspace; (b) tanpa perubahan inti: "Workspace 12-2026-11-10.xml" | **(a)** — nama berkas dan judul di MS Project adalah hal pertama yang dilihat penerima. Perubahannya satu field di objek yang sudah ada, tanpa restart. |

**Disahkan rencana ini tanpa pertanyaan (dicatat di ADR-050):**
- Angka earned value tidak terpengaruh filter panel (R2).
- Ekspor ada di menu "Lainnya" yang kini juga tampil di desktop (R6).
- Task Manual diekspor sebagai penjadwalan manual + "mulai tidak lebih awal dari" tanggal tersimpannya, supaya tanggalnya tidak bergeser saat dibuka (R8).
- Sebelum merge, Bapak perlu membuka satu berkas ekspor di Microsoft Project atau ProjectLibre (kriteria spec yang sudah disetujui).
