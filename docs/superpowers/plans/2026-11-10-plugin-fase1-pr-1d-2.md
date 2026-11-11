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

**Keputusan pemilik (2026-11-10 13.58 WIB): P1 (a) — teks whatsnew (dipesan sebagai v502, dirilis **v503**) disetujui apa adanya; P2 (a) — host memberi nama workspace (`listName`) ke konteks Timeline untuk nama berkas/judul ekspor.**

**Basis kode:** `main` @ `6182810` (setelah #130 1d-1).
- SW `taskflow-v501-beban-tim`, `app.css?v=384`, IndexedDB v7.
- `index.html` 46.236 baris, `plugin-runtime.js` 1.704 baris, ADR terakhir ADR-049.
- **Setelah digabung dengan `main` @ `155ee07` (2026-11-11; #132 checklist bertingkat PR B di-merge lebih dulu):** SW dasar `taskflow-v502-checklist-bertingkat`, `app.css?v=385`, `index.html` 47.122 baris. Rilis PR ini menjadi **`taskflow-v503-ev-ekspor`** (v502 dipakai #132 checklist bertingkat; dinomori ulang 2026-11-11), `index.html` 47.123 baris; ADR-050 tetap.
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
- **R7 — Pemetaan MSPDI** (spec K53, §5.4). Namespace `http://schemas.microsoft.com/project`, `SaveVersion` 14. Urutan elemen **mengikuti XSD MSPDI** (implementer memverifikasi dengan MPXJ, T7): propOrder JAXB skema MSPDI MPXJ 16.10 — `Manual` setelah `Name` sebelum `Type`; `ActualStart`/`ActualFinish` setelah `PercentComplete` sebelum `ConstraintType`; `HonorConstraints` setelah `WorkFormat` (dikoreksi review F2). Task: `… PercentComplete, PercentWorkComplete, ActualStart, ActualFinish, ActualDuration, ActualWork, RemainingDuration, RemainingWork, ConstraintType …`; Assignment: `UID, TaskUID, ResourceUID, PercentWorkComplete, ActualFinish, ActualStart, ActualWork, Finish, RemainingWork, Start, Units, Work` (dikoreksi uji pemilik #2 F6).
  - **Project:** `HonorConstraints 1` — MSO/MFO menang atas tautan, sama dengan task tetap di mesin (dikoreksi review F2). `SplitsInProgressTasks 0` (setelah `NewTasksEffortDriven`, sebelum `WeekStartDay`; dikoreksi review F7): sejak F6 % selesai terbaca, dan dengan opsi bawaan "Split in-progress tasks" MS Project memecah sisa kerja task berjalan ke setelah pendahulu yang belum selesai — mesin Timeline tidak pernah memecah (task yang sudah mulai tetap di tempat). Bendera kepala bawaan `MSPDIWriter` MPXJ (uji pemilik #3 F8): `SpreadActualCost 0`, `SpreadPercentComplete 0`, `TaskUpdatesResource 1` setelah `SplitsInProgressTasks`; `MoveCompletedEndsBack 0`, `MoveRemainingStartsBack 0`, `MoveRemainingStartsForward 0`, `MoveCompletedEndsForward 0` setelah `WeekStartDay`; `ProjectExternallyEdited 0` dan `ActualsInSync 0` tepat sebelum `Calendars`. Yang menentukan `ProjectExternallyEdited 0` — `yeroo/docxy` issue #111 / PR #222, diuji dengan Project 2021 lewat COM: tanpa `<ProjectExternallyEdited>0</ProjectExternallyEdited>` MS Project memperlakukan berkas sebagai disunting dari luar, mengabaikan `Duration`, dan menghitung ulang (task tanpa Work jadi durasi 0); dengan elemen itu bernilai 0 durasi dihormati. `MSPDIWriter` MPXJ selalu menulis sembilan bendera ini dengan nilai yang sama. Uji pemilik #3: tanggal/durasi/dialog sudah benar, tetapi garis progres hanya tampak pada task Manual 100 %; dugaan (belum terbukti) mode "disunting dari luar" menghitung ulang task Otomatis. Efeknya baru diketahui di uji pemilik #4.
  - **Kalender:** satu kalender dasar UID 1 bernama **"Standard"** — nama kalender dasar bawaan MS Project dan MPXJ; nama lain ("Standar") diduga membuat MS Project memakai kalender proyek sementara tanpa libur saat impor (dikoreksi uji pemilik #2 F6). Pengecualian ditulis **dua kali** (dikoreksi review F2):
    - `WeekDays` gaya Project 2003: `DayType` 1–7 (1 = Minggu) dengan `DayWorking` dari pola mingguan kalender halaman. Hari kerja `WorkingTimes` 08:00–12:00 dan 13:00–17:00 (480 menit).
    - Pengecualian = `WeekDay` `DayType 0` dengan `TimePeriod` (dibaca ProjectLibre). Libur di hari kerja → `DayWorking 0`; hari kerja pengganti di akhir pekan → `DayWorking 1` + `WorkingTimes`. Hari berurutan sejenis digabung.
    - Blok `<Exceptions>` gaya 2007 setelah `</WeekDays>` dengan rentang yang sama, bentuk keluaran `MSPDIWriter` MPXJ (`EnteredByOccurrences 0`, `TimePeriod`, `Occurrences 1`, `Name` = nama SKB bila ada, `Type 1`, `DayWorking`, `WorkingTimes`). Spec K53 meminta libur sebagai `Exceptions`; MS Project 2010+ mengabaikan gaya lama saat impor (MPXJ #335). MPXJ membaca `<Exceptions>` lebih dulu dan memakai `DayType 0` hanya bila blok itu kosong, jadi tidak ganda.
    - Rentang: [mulai paling awal − 7, selesai paling akhir + 31] hari, maksimal 3.660 hari.
  - **Task:**
    - UID 0 = ringkasan project (`OutlineLevel 0`).
    - UID 1…n mengikuti urutan baris `TLLayout.layout({…, sort: "wbs"})`. Halaman workspace: baris kelompok = task ringkasan tingkat 1 (nama kelompok atau "(Tanpa project)"), task di bawahnya +1 tingkat. Halaman project: task tingkat 1 dan seterusnya. `OutlineNumber`/`WBS` = nomor WBS Timeline.
    - Nama task/resource/judul/kelompok: `\t \r \n` → spasi, dipotong 255 code point (dikoreksi review F2).
    - `Type 1` (durasi tetap) hanya untuk task ber-assignment **nyata**; task tanpa assignment atau hanya ber-assignment semu, placeholder, milestone, dan ringkasan/kelompok/UID 0 → `Type 0` (unit tetap, bawaan MPXJ dan MS Project): task durasi tetap tanpa resource tampil terpecah/rusak di MS Project 2007–2013 (MPXJ bug #240) (dikoreksi review F7). `EffortDriven 0`.
    - `Start` = es 08:00, `Finish` = ef 17:00 dari hasil mesin `TLCpm.run` (`YYYY-MM-DDTHH:MM:SS`, lokal-naif Jakarta); task yang sedang drift diekspor di tanggal hasil mesin. Bukan simpul mesin → rentang tersimpan (dikoreksi review F2).
    - `Duration` `PT{d×8}H0M0S`, `DurationFormat 7`.
    - `Milestone 1` bila d = 0 (Start = Finish = es 08:00, atau 17:00 bila tautan FF menuntutnya — dikoreksi uji pemilik F4).
    - `Summary 1` untuk induk dan kelompok.
    - `PercentComplete` (selesai 100, selain itu `progress`).
    - **Kemajuan** (dikoreksi uji pemilik #2 F6): MS Project membaca kemajuan dari pasangan aktual/sisa, bukan dari `PercentComplete` saja. Setiap `<Task>` menulis `Work`, `PercentWorkComplete`, `ActualDuration`, `ActualWork`, `RemainingDuration`, `RemainingWork`:
      - `ActualDuration` = durasi × %, `RemainingDuration` = durasi − `ActualDuration` (100 % → `PT0H0M0S`; placeholder 0 % → `PT8H0M0S`). Nilai ditulis dalam **detik bulat** (`PT2H38M24S` untuk 33 % dari 1 hari): durasi × % dan Work × % selalu detik bulat (288 × d × % dan 15 × target × %), sehingga aktual ÷ total = % persis — bentuk yang sama ditulis `MSPDIWriter` MPXJ; pembulatan ke menit memberi 13 dari 25 menit (52 %) untuk 1 🍅 ber-50 %.
      - `ActualStart` bila % > 0 (= `Start`; task selesai/berjalan es ≤ D sudah memakai aktual mesin — yang baru: task Manual, berjalan es > D, dan tanpa jadwal yang ber-% > 0), `ActualFinish` bila 100 % (= `Finish`). MS Project menyetel keduanya sendiri saat % diisi; simulator: 0 konflik, selisih paritas tetap dua kelas R11.
      - `Work`/`ActualWork`/`RemainingWork`/`PercentWorkComplete` task = milik assignment-nya (nyata atau semu); tanpa assignment → `PT0H0M0S` / 0.
      - Ringkasan, kelompok, dan UID 0 mengikuti keluaran MPXJ: `PercentComplete 0`, `RemainingDuration` = `Duration`, nilai kerja nol (MS Project menghitung sendiri gulungan ringkasan).
    - Task tetap mesin (dikoreksi review F2, uji pemilik F4):
      - selesai → `Start`/`ActualStart` = es, `Finish`/`ActualFinish` = ef (`doneFinish`), durasi = hari kerja rentang itu;
      - berjalan Otomatis dengan es ≤ D → `ActualStart` = es, `Finish` = ef; es > D → SNET di es (+ `ActualStart` = es bila % > 0, dikoreksi uji pemilik #2 F6);
      - anggota lingkaran → SNET di es (= tanggal tersimpan);
      - berjalan es > D / lingkaran / MFO yang pendahulunya menuntut lebih lambat (konflik yang juga ditandai mesin) → `Manual 1` + SNET di es (MFO tetap). **Tanpa MSO** (uji pemilik F4: MSO di tanggal yang dilanggar tautan memunculkan ikon konflik kendala di MS Project).
    - Kendala (uji pemilik F4 B): ASAP 0; SNET 4 / MFO 3 + `ConstraintDate` 08:00 / 17:00; **tidak ada MSO**. Kendala dipilih per simpul dalam urutan topologis mesin (`result.order`) dengan aritmetika waktu kerja MS Project pada titik setengah hari (08:00/17:00): syarat tautan menurut MS Project lebih awal dari es mesin → SNET di es (akar Otomatis termasuk SNET eksplisit lebih awal dari mulai tersimpan / pendahulu tanpa jadwal, penerus milestone 08:00, penerus pendahulu yang selesai di hari non-kerja); sama → ASAP (SNET eksplisit tetap); lebih lambat (hanya di sekitar milestone) → ASAP tanpa kendala, tanggal mesin ditulis dan MS Project menghitung ulang (residu R11, dikoreksi review F5). Tujuan: tanggal tampil MS Project = es/ef mesin **tanpa konflik kendala** (setiap MFO/SNET ≥ syarat tautan).
    - Milestone (dikoreksi review F2, uji pemilik F4 B): mesin menghitung milestone per hari (penerus FS/FF mulai hari kerja berikutnya, SS/SF di harinya), MS Project per jam. Maka:
      - milestone ditulis di jam yang dihitung MS Project: FS/SS masuk → SNET di es 08:00; FF masuk → 17:00 hari itu tanpa kendala; MFO milestone → 08:00, atau 17:00 bila tautan FF menuntutnya;
      - **lag asli** (dikoreksi review F5; menggantikan "koreksi lag" F4): lag ditulis apa adanya. Syarat tautan yang menurut MS Project lebih lambat dari mesin (SS/SF dari milestone 17:00; SF / FF lag < 0 ke milestone, yang di MS Project jatuh di 08:00 hari kerja berikut) → task ditulis di tanggal mesin tanpa kendala (milestone di 17:00 tanggal mesin) dan MS Project menggesernya — selisih kelas "label"/"geser" di R11, tanpa konflik kendala. `planNode` hanya menulis keluaran entri, tidak mengubah tautan, simpul mesin, atau masukan lain (review F5 M5).
    - `PredecessorLink`: `Type` FF 0 / FS 1 / SF 2 / SS 3, `LinkLag` = lag × 4.800, `LagFormat 7`.
    - `Baseline` `Number 0` (`Start`, `Finish`, `Duration`, `Work` = w × 25 menit) dari baseline aktif bila ada.
  - **Tautan** (dikoreksi review F2, uji pemilik F4): hanya sisi yang dipakai mesin (`result.pred`) yang **kedua ujungnya simpul terhitung** (es/ef ada). Dependensi lain dihitung `skippedLinks`: ke task di luar berkas / tidak diekspor, ke task tanpa jadwal yang bukan simpul (`notNode`), ke/dari simpul tak terhitung (tidak memengaruhi tanggal mesin, tetapi akan menggeser placeholder/tanggal tersimpannya di MS Project), lintas scope, menyentuh ringkasan, antaranggota lingkaran, ke diri sendiri. Tanpa hasil mesin (`result` null) → cadangan: semua pendahulu yang diekspor kecuali diri sendiri, ringkasan, dan antaranggota `result.cycles`.
  - **Task tanpa jadwal** (dikoreksi review F2, uji pemilik F4 C): placeholder **Otomatis** (`Manual 0`) di hari kerja pertama ≥ D (cadangan D bila kalender buntu) — kecuali yang ber-% > 0 (dikoreksi review F7): tanggal aktual tidak boleh di masa depan, jadi placeholder-nya hari kerja **terakhir ≤ D**, dan untuk task selesai hari selesainya (`actual.finish` / `completed_at` Jakarta) bila ≤ D, dibulatkan ke hari kerja ≤ itu; durasi tetap 1 hari, SNET mengikuti hari itu — 08:00–17:00, `Duration PT8H0M0S`, `Estimated 1`, `DurationFormat 39` (kode "hari?" yang ditulis MS Project/`MSPDIWriter` MPXJ untuk durasi perkiraan), SNET di tanggal itu, tanpa tautan; kendala eksplisit task tanpa jadwal tidak diekspor (mesin juga tidak menjadwalkannya). Uji pemilik: `Manual 1` + `Estimated 1` tampil "0 days?" berlian di MS Project. Penerus Otomatis tanpa Mulai yang dihitung mesin (simpul BFS) diekspor Otomatis di es/ef mesin dengan `Estimated 1`, `DurationFormat 39`.
  - **Resource:** setiap penanggung jawab task di berkas (workspace) atau pemilik (pribadi), dengan `Type 1`, `MaxUnits 1`. Nama dari currentUser/collaborators, selain itu "Anggota #id".
  - **Kalender resource** (uji pemilik F4 A): tiap resource `CalendarUID` = UID resource + 1 → `<Calendar>` turunan (`IsBaseCalendar 0`, `IsBaselineCalendar 0`, `BaseCalendarUID 1`, Name = nama resource, tanpa `WeekDays`; bentuk keluaran `MSPDIWriter` MPXJ), sehingga libur kalender UID 1 berlaku untuk resource. Tanpa itu MS Project memberi resource kalender "Standard" bawaannya (tanpa libur): dialog "The resource is assigned outside the original dates…" dan Units diturunkan (Materi Natal Sari 5 % → 3 %). `IsBaselineCalendar 0` juga di kalender dasar.
  - **Assignment:** hanya untuk task non-ringkasan dengan d > 0. `Work` = target × 25 menit (`PT{h}H{m}M0S`), `Units` = Work ÷ (d × 480), **6 desimal dibulatkan ke atas** dengan aritmetika bilangan bulat, tanpa notasi ilmiah, nol di belakang dibuang (dikoreksi review F5: 4 desimal membuat Units × menit kerja < Work hingga beberapa menit di task panjang). Tiap assignment juga menulis `PercentWorkComplete` = % task, `ActualWork` = Work × % (detik bulat), `RemainingWork` = Work − `ActualWork`, `ActualStart` bila % > 0, `ActualFinish` bila 100 % (dikoreksi uji pemilik #2 F6).
  - **Assignment semu** (dikoreksi uji pemilik #2 F6): task non-ringkasan ber-% > 0 **tanpa** assignment nyata (tanpa penanggung jawab, milestone, tanpa jadwal) mendapat satu assignment `ResourceUID -65535` bentuk `MSPDIWriter` MPXJ — `PercentWorkComplete`, `ActualFinish` (100 %), `ActualWork` = durasi × %, `Finish`, `RemainingWork`, `Start`, `Units 1`, `Work` = durasi (milestone: nol) — karena tanpa assignment MS Project mengabaikan % selesai task. UID sesudah assignment nyata (urutan task); `stats.assignments` hanya menghitung yang nyata; tidak ada `<Resource>` semu.
  - **Escape** `& < > " '`; karakter kontrol C0 selain `\t \n \r` dibuang.
  - **Determinisme:** tanpa `Date`; `CreationDate` = D 00:00:00.
  - **Paritas (review F2, uji pemilik F4):** simulator "MS Project sederhana" di `timeline_mspdi.test.js` menjadwalkan ulang XML (ASAP, aturan di atas) dan menghitung **konflik kendala** (MSO/MFO lebih awal dari syarat tautan). Tanggalnya = es/ef mesin (jam milestone boleh 08:00/17:00 di hari yang sama) dengan 0 konflik untuk E1–E5, milestone di tengah rantai, pendahulu selesai di akhir pekan, kasus pemilik, dan fixture campuran; sweep 400 fixture / 57.190 baris: konflik 4.588 → 0 (F4). Sejak review F5 (lag asli) selisih tanggal hanya diizinkan untuk kelas yang dikenali ("label" milestone di instan kerja setara, "geser" penerus SS/SF milestone 17:00 + rambatan) — setiap selisih dibuktikan masuk salah satu kelas, konflik tetap 0: sweep 750 baris (label 470, geser 280), kelas lain 0. Tautan yang diekspor punya tipe dan lag identik dengan `result.pred`. Simulator adalah pendekatan, bukan MS Project.
- **R8 — Task Manual tetap di tanggalnya.** Task dengan mode efektif `manual` (G9) diekspor `Manual 1` (penjadwalan manual Project 2010+), dengan `ManualStart`/`ManualFinish`/`ManualDuration`. Bila task itu tanpa kendala eksplisit, ditambah `ConstraintType 4` (SNET) di tanggal mulai tersimpan, supaya pembaca tanpa penjadwalan manual (mis. ProjectLibre) juga tidak memajukannya ke awal project.
  - Task Otomatis diekspor terjadwal otomatis. Tanggal, tautan, dan kendala dipilih supaya MS Project menghitungnya sama dengan mesin Timeline tanpa konflik kendala (R7, dikoreksi review F2 dan uji pemilik F4): sisi `result.pred` antar simpul terhitung, akar SNET di es, task tetap mesin dijangkar lewat aktual/SNET/MFO (berkonflik mesin → Manual), milestone di jam MS Project dengan lag asli (dikoreksi review F5: tanpa koreksi lag; residu milestone di R11), `HonorConstraints 1`. Task yang sedang drift tampil di tanggal hasil mesin.
  - Dicatat di ADR-050 dan diverifikasi pemilik.
- **R9 — Nama berkas** `{judul}-{YYYY-MM-DD}.xml`; karakter tak aman (R4) dan spasi berlebih diganti "-", dipotong 80 karakter.
  - Judul halaman project = `projectName`.
  - Judul workspace sesuai P2.
  - `<Title>` = judul; `<Name>` = nama berkas.
- **R10 — Anggaran.**
  - EV O(baris baseline × hari kerja), ≤ 5 ms untuk 500 baris (Node).
  - `TLMspdi.build` 1.000 task ≤ 300 ms (Node) dan menghasilkan string, bukan DOM. Hanya dijalankan saat diklik.
  - Render awal tidak berubah (EV dihitung setelah mesin siap, 1 elemen DOM).
- **R11 — ADR-050** (cek nomor terhadap `main` saat rilis): R1–R10, residual (dikoreksi review F2):
  - resource tanpa kapasitas/kalender orang;
  - ProjectLibre mungkin mengabaikan `Manual`;
  - (dikoreksi uji pemilik #2 F6; menggantikan "tanpa `ActualDuration`/`RemainingDuration`") `ActualStart` untuk task yang dijangkar mesin (selesai; berjalan dengan es ≤ D) dan setiap task ber-% > 0, `ActualFinish` untuk 100 %; `ActualDuration`/`RemainingDuration`/`ActualWork`/`RemainingWork` ditulis eksplisit. **Belum ada `TimephasedData`** (distribusi kerja per hari dihitung MS Project: rata sepanjang assignment);
  - (uji pemilik #2 F6, dikoreksi review F7) **Task tanpa penanggung jawab yang ber-% > 0 tampil dengan Work = durasi dalam jam, bukan menit 🍅** (assignment semu MPXJ, `Units 1`): 4 hari 50 % → Work 32 jam, 16 jam aktual; yang 0 % tetap Work 0. Akibatnya total Work ringkasan di MS Project membengkak dan ada selisih terhadap `Baseline` Work (tetap w × 25 menit). Ini bentuk `MSPDIWriter` MPXJ — satu-satunya bentuk yang punya bukti membuat MS Project menampilkan % selesai task tanpa resource; varian ber-Work target 🍅 belum teruji;
  - (dikoreksi review F7) **Verifikasi butir F7 di MS Project:** contoh memuat "Unggah materi" (40 %, 3 hari, mulai awal pekan ≤ D, FS dari "Desain spanduk" yang belum mulai dan selesai lebih lambat). Diekspor dengan tautan FS 0, SNET di es, `ActualStart`, Otomatis; tanggal harapan di MS Project = mesin (tetap di tempat, tidak dipecah). Bila MS Project tetap memecah/menggesernya, `SplitsInProgressTasks 0` tidak dihormati saat impor;
  - (uji pemilik #2 F6) **Hipotesis yang belum terbukti tanpa MS Project:** H1 tanpa `RemainingDuration` task tanpa assignment diimpor "0 days?"; H2 tanpa `RemainingWork`/`ActualWork` di assignment muncul dialog "resource is assigned outside the original dates" dan % selesai hilang; H3 nama kalender ≠ "Standard" membuat kalender proyek sementara. Ketiganya ditutup dengan meniru bentuk `MSPDIWriter` MPXJ; contoh memuat tiga task tanpa penanggung jawab (0 %, 50 %, selesai) untuk uji pemilik berikutnya;
  - task tetap dan milestone di rantai memakai SNET di tanggal mesin; bila jadwal diubah di MS Project, kendala itu ikut menahan task (dikoreksi uji pemilik F4: tanpa MSO);
  - task tetap tanpa aktual (lingkaran, berjalan es > D) yang tersimpan di hari libur dimulai MS Project di hari kerja berikutnya (selesai sama);
  - urutan kelompok workspace mengikuti `layout.js` (`localeCompare` "id"), yang bisa berbeda antar mesin JS.
  - (dikoreksi uji pemilik F4; menggantikan butir "MSO dan jalur kritis" F2b) **Tanpa MSO, tanpa konflik kendala:** task tetap Otomatis yang pendahulunya menuntut lebih lambat (konflik yang juga ditandai mesin: lingkaran, berjalan es > D, MFO) diekspor `Manual 1` + SNET — MS Project tidak menggesernya dan tidak memberi ikon konflik kendala, tetapi dapat menandainya sebagai potensi masalah penjadwalan task Manual. MFO yang dihormati (`HonorConstraints 1`) tetap memberi slack total 0 di task itu; rantai pendahulunya bisa tampil kritis.
  - (dikoreksi review F5; menggantikan butir "Lag yang dikoreksi" F4) **Selisih tanggal di sekitar milestone:** lag selalu ditulis apa adanya (`LinkLag` = lag Timeline × 4.800, tanpa koreksi). Mesin menghitung milestone per hari, MS Project per jam, sehingga tersisa dua kelas selisih: (a) **label** — pada tautan SF / FF lag < 0 ke milestone, MS Project dapat menampilkan milestone di tanggal x sedangkan Timeline x−1 (instan kerja sama: 17:00 x−1 = 08:00 x); (b) **geser** — penerus SS/SF dari milestone yang jatuh 17:00 bisa 1 hari kerja lebih lambat di MS Project, dan selisih itu merambat ke penerusnya. Sweep 400 fixture acak kaya milestone + FF/SF (`timeline_mspdi.test.js`, simulator): 750 dari 57.190 baris (1,3 %) berselisih — label 470, geser 280 (140 langsung dari SS/SF milestone 17:00, 140 rambatan; 270 baris +1 hari kerja, 10 baris +2) — semuanya terbukti masuk salah satu kelas, **konflik kendala 0**, lag 60.806 tautan identik dengan Timeline. Tautan FS dari milestone (termasuk FS −2) tidak menghasilkan selisih di sweep. Tes paritas menolak selisih di luar dua kelas itu.
  - (dikoreksi review F5) **Units 6 desimal dibulatkan ke atas:** Units × d × 480 − Work ∈ [0, 1) menit (galat < d × 480 ÷ 10⁶: terukur maks 0,477 menit di 999 hari; properti target 1–99 × d 1–999), sehingga Units × waktu kerja kalender resource ≥ Work dan MS Project tidak memperpanjang penugasan. MS Project bisa menampilkan Units sedikit di atas Work ÷ durasi (mis. 4,17 %).
  - (dikoreksi review F2b, uji pemilik F4) **Kolom "Batasan" bukan cermin Timeline:** akar Otomatis mendapat SNET di tanggal mesin (tanggal mulai tersimpan Timeline memang berlaku sebagai "mulai tidak lebih awal"); task tetap dan milestone di rantai mendapat SNET buatan ekspor; kendala eksplisit pada task tetap diganti dengan jangkar; kendala eksplisit task tanpa jadwal tidak diekspor.
  - (dikoreksi review F2b) **Milestone yang jangkarnya jatuh di hari libur atau akhir pekan:** simulator membiarkannya di tempat, sedangkan MS Project kemungkinan memindahkannya ke saat kerja berikutnya. Yang terdampak hanya tanggal tampil milestone itu; penerusnya sudah dijangkar.
  - (dikoreksi review F2b) **ProjectLibre:** dukungan `HonorConstraints`, kalender resource turunan, dan `DurationFormat 39` belum terverifikasi — masuk uji pemilik (MSO tidak lagi dipakai sejak F4).
  - (uji pemilik F4) **Verifikasi nyata MS Project (desktop 2016+):** pemilik membuka `contoh-ekspor-workspace.xml` — semua tanggal task sama dengan XML, `<Exceptions>` terbaca (Materi Natal 22–29 Des = 4 hari). Tiga temuan (dialog resource di luar tanggal task, ikon konflik kendala milestone FF, placeholder "0 days?") diperbaiki di F4; berkas baru menunggu buka ulang pemilik.
  - (uji pemilik #2 F6) **Verifikasi nyata #2 (berkas F5):** tanggal task, Units Materi Natal (Sari 5 %), dan indikator kendala sudah benar. Tiga temuan: dialog "The resource is assigned outside the original dates for task 10 Materi Natal…" masih muncul; placeholder "Uji tampilan" masih "0 days?" berlian; % selesai tidak terbaca (task 100 % tanpa centang). Perbaikan F6 meniru bentuk `MSPDIWriter` MPXJ (R7 "Kemajuan", "Assignment semu", kalender "Standard"). `mspdi_check.py` mendapat asersi "tanpa turunan MPXJ" (tulis-ulang `MSPDIWriter`: `RemainingDuration` task dan `RemainingWork`/`ActualWork`/`ActualFinish` assignment = milik kita) — gagal pada XML F5 (42 beda), lulus pada XML F6. Contoh E2E ditambah tiga task tanpa penanggung jawab (Rapat evaluasi 0 %, Kumpulkan testimoni 50 %, Cadangkan situs lama selesai) di dalam baseline; E2E 39/39. Paritas simulator: sweep 400 fixture 748 selisih kelas dikenali (label 468, geser 280), 0 konflik.
  - (dikoreksi review F2b) **Berkas berbeda dari bar Gantt** untuk dua kelompok task: task yang drift (ikut mesin) dan task selesai (tanggal aktual).
  - (dikoreksi review F2b) **Milestone yang selesai setelah harinya** diekspor dengan rentang es..ef mesin (durasi = hari kerja rentang itu) dan tetap bertanda `Milestone 1`.

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
- **Tidak berubah:** `webapp.py`, `plugin_records.py`, `static/offline/**`, `app.css` (`?v=384` saat rencana ditulis; `?v=385` milik `main` sejak #132), IndexedDB v7.
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
- **Rilis:** SW **`taskflow-v503-ev-ekspor`** (v502 dipakai #132 checklist bertingkat; dinomori ulang 2026-11-11); whatsnew **non-silent** dengan teks dari P1.
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
- Modify: `manifest.json` (version `1.4.0`, parts `[…, "load.js", "layout.js", "mspdi.js", "drag.js"]` — `mspdi.js` setelah `layout.js` karena memakai `TLLayout`; di depan `layout.js` bundel melempar zona mati temporal (dikoreksi review F2)), `plugin.jsx`, `style.css`, `tests/offline/timeline_ui.test.js`, `tests/build-plugins.test.js`, `tests/offline/timeline_runtime.test.js`.
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

### Task 6: Rilis — SW v503 (dinomori ulang dari v502), whatsnew (P1), README, ADR-050

**Files:** `static/sw.js`, `static/index.html` (2 string versi), ganti massal versi lama (**kecuali** `static/whatsnew.json`), `static/whatsnew.json`, `docs/plugins/README.md` (judul "(Fase 0a–1d-2)", §5 `saveFile`, §6.2 EV + ekspor, §8), `.agents/DECISIONS.md`

- [ ] **Step 1:** versi berikutnya setelah v501 (cek `main`), PROTOCOL §4 lengkap; `app.css` tidak diubah (`?v=385` milik `main` sejak #132).
- [ ] **Step 2:** whatsnew teratas non-silent, teks = P1.
- [ ] **Step 3:** ADR-050 (nomor dicek ulang) = R1–R11 + residual.
- [ ] **Step 4:** PROTOCOL §4 butir 5 + `npm test` + pytest penuh + `compile.js` idempoten + jumlah baris `index.html`.
- [ ] **Step 5: Commit** `chore(release): SW v502 Timeline 1.4 earned value + ekspor MSPDI, README, ADR-050` (`18b6c96`); setelah gabung `main`: `chore(release): SW v503 Timeline 1.4 (dinomori ulang setelah #132), dokumen`

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
| **P1** | **Teks "Apa yang baru"** v503 (dipesan sebagai v502) | (a) setujui usulan apa adanya; (b) ubah | **(a)** — judul **"Timeline: kinerja jadwal dan ekspor"**; poin `new`: "Bandingkan kemajuan dengan baseline: toolbar Gantt kini menampilkan “Jadwal 92% · Efisiensi 🍅 108%”.", "Ekspor Timeline ke Microsoft Project (.xml) dari menu Lainnya.", "Di aplikasi desktop dan Android, ekspor dilakukan lewat browser di alurik.com." |
| **P2** | **Nama berkas ekspor halaman workspace.** Timeline tahu nama project pribadi, tetapi **tidak** tahu nama workspace (host hanya memberi nomornya). | (a) **perubahan kecil di aplikasi inti:** host ikut memberikan nama workspace ke Timeline (satu field, ± 1 baris), sehingga berkas bernama mis. "Tim Pemasaran-2026-11-10.xml" dan judul project di MS Project sama dengan nama workspace; (b) tanpa perubahan inti: "Workspace 12-2026-11-10.xml" | **(a)** — nama berkas dan judul di MS Project adalah hal pertama yang dilihat penerima. Perubahannya satu field di objek yang sudah ada, tanpa restart. |

**Disahkan rencana ini tanpa pertanyaan (dicatat di ADR-050):**
- Angka earned value tidak terpengaruh filter panel (R2).
- Ekspor ada di menu "Lainnya" yang kini juga tampil di desktop (R6).
- Task Manual diekspor sebagai penjadwalan manual + "mulai tidak lebih awal dari" tanggal tersimpannya, supaya tanggalnya tidak bergeser saat dibuka (R8).
- Sebelum merge, Bapak perlu membuka satu berkas ekspor di Microsoft Project atau ProjectLibre (kriteria spec yang sudah disetujui).
