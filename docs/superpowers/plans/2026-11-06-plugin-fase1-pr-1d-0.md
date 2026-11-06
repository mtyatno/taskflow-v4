# PR 1d-0 — Host: Target 🍅 sampai 99 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** batas target 🍅 (`tasks.estimated_pomodoros`) naik dari 1–20 ke **1–99**, dan target besar bisa diisi **tanpa klik berulang** — prasyarat agar Beban Tim (1d-1) dan earned value (1d-2) mencerminkan kerja sungguhan (spec 1d Q2 (a), §3, §10, R1–R2).

**Architecture:** perubahan host murni (bukan plugin): satu konstanta batas di server (`webapp.py`) dan satu di klien (`TF.pomologic.EST_MAX`), dijaga tes silang agar tidak menyimpang; pemilih tomat di Fokus Hari Ini mendapat kolom angka; (bila P2 (a)) detail task mendapat baris properti **"Target 🍅"** lewat jalur Live Edit yang sudah ada (`TF.liveedit` + `useTaskAutosave`). Tanpa endpoint, kolom, migrasi, atau versi IndexedDB baru.

**Tech Stack:** FastAPI + pydantic (validasi), React terkompilasi di `static/index.html`, modul UMD `static/offline/*`, node:test + fake-indexeddb, pytest, Playwright E2E.

**Spec:** `docs/superpowers/specs/2026-11-06-plugin-fase1-1d-beban-tim-design.md` — §1 (kriteria 8: 1d-0 = perubahan host terkecil), §3 baris 1d-0, §8 (target bawaan 1), §9 butir Server, §10 (rilis/rollback 1d-0), §11 R1–R2, §13 Q2 (a). Disetujui pemilik 2026-11-06 08.51 WIB (Q1–Q7 semuanya (a)). Keputusan pemilik P1–P2 di akhir dokumen ini.

**Basis kode:** `main` @ `80f047bd` (SW `taskflow-v499-baseline-aktual`, `app.css?v=383`, IndexedDB `taskflow-offline` v7, `index.html` 46.074 baris, ADR terakhir ADR-046).

## Fakta hasil eksplorasi (titik sentuh)

| Lapisan | Lokasi | Keadaan sekarang |
|---|---|---|
| Server — buat task | `webapp.py:1238` `TaskCreate.estimated_pomodoros: int = Field(default=1, ge=1, le=20)` | 21 → 422 |
| Server — ubah task | `webapp.py:1268` `TaskUpdate.estimated_pomodoros: Optional[int] = Field(default=None, ge=1, le=20)` | 21 → 422; satu-satunya jalur tulis lain = `INSERT` di `:2495` dan `updates[...]` di `:2657` (keduanya memakai nilai tervalidasi) |
| Server — bot/repository | `bot.py` tidak menyentuh target; `repository.py:461` hanya kolom `INTEGER NOT NULL DEFAULT 1` (tanpa CHECK) | skema tidak perlu diubah |
| Klien — batas | `static/offline/pomologic.js:13` `EST_MAX = 20`; `clampEstimate` `:16`, `nextEstimate` `:23` | penjepit dipakai tampilan dan penyimpanan |
| Klien — simpan lokal | `static/offline/taskrepo.js:163` (buat) dan `:237` (ubah) memanggil `clampEstimate` lewat `TFpomo` lazy (`:20`) | ikut `EST_MAX` |
| Klien — push/tarik | `syncpush.js:116–118` `withEstimate` mengirim nilai record apa adanya; `hydrate.js:28/59` menyalin nilai server tanpa jepit (bawaan 1) | tidak perlu diubah |
| UI — Fokus Hari Ini | `index.html` `FocusTaskItem` (`:11009`): `pomoEst = clampEstimate(...)` `:11029`, chip `realisasi/estimasi` `:11121–11127`, radiogroup tomat 1–5 + badge `×n` `:11187–11206`; `TodayFocusView.handleEstimate` `:13429` (`api.put` → router lokal → `taskrepo.updateTask`) | target > 5 hanya lewat klik "5+" berulang (+1 per klik) |
| UI — cakupan Fokus | `TodayFocusView` `:13285` memfilter `TF.focusfilter.inTodayScope` (Q1, terlambat, tenggat hari ini, ⭐, task Pomodoro aktif) | **task minggu depan / milik anggota lain tidak punya tempat mengisi target** — alasan P2 |
| UI — detail task | `TaskDetailBody` (`:9673`): `optionalProps` `:10135–10150` ("+ Assign", "+ Menunggu", "+ Tag"), `PropertyRow` `:9173`, `TextPicker` `:9367`; autosave `useTaskAutosave` `:8711` → `TF.liveedit.createAutosaver` | tidak ada baris target |
| Live Edit | `static/offline/liveedit.js:21` `EDITABLE_FIELDS` (10 field), `formFromTask`, `fieldChanged`, `buildPatch`, `saveTrigger` `:177`, `mergeExternal` | `estimated_pomodoros` belum terdaftar |
| Plugin Timeline | `plan.js:463` `weightOf` (bilangan bulat ≥ 0, tanpa batas atas); `plugin.jsx:496` `Number(...)` | tidak perlu diubah |
| Tes yang mengunci 20 | `tests/test_pomodoro_log.py:83` (`for bad in (0, 21)`), `tests/offline/pomologic.test.js:13/27–28/31`, `tests/offline/taskrepo.test.js:359–366`; E2E `temporary_files/e2e_focus_target.py:255` (badge `×n`) | diperbarui di tugas masing-masing |
| Sinkron gagal permanen | `syncpush.js:274` 422 → op dibuang, record tetap `dirty` + `sync_error`; bilah konflik `index.html:1431–1434` "'{judul}' gagal disinkronkan" + "Coba lagi" / "Buang perubahan lokal"; sukses berikutnya menghapus `sync_error` (`syncpush.js:400`) | dasar mitigasi R2 di bawah |
| Versi | `/api/version` (`webapp.py:5023`) membaca `static/sw.js` dari disk saat diminta | klien bisa memperbarui SW **sebelum** `taskflow-web` di-restart — jendela R2 nyata |

## Keputusan rencana (controller)

- **R1 — Satu konstanta per sisi + tes silang.** Server: `TASK_EST_MAX = 99` (dan `TASK_EST_MIN = 1`) di dekat model task `webapp.py`, dipakai kedua `Field`. Klien: `EST_MAX = 99` di `pomologic.js`. Tes pytest baru membaca `static/offline/pomologic.js` (regex `const EST_MAX = (\d+);`) dan membandingkannya dengan `webapp.TASK_EST_MAX` — penyimpangan berikutnya gagal di CI.
- **R2 — Tanpa gerbang kemampuan server.** Jendela deploy → restart: klien baru + server lama → PUT target > 20 → 422 → op dibuang, perubahan lokal tetap (`dirty` + `sync_error`), bilah konflik menawarkan "Coba lagi". Setelah restart, "Coba lagi" (atau edit berikutnya pada task itu) berhasil; tidak ada data hilang kecuali pengguna memilih "Buang perubahan lokal". Menjepit klien berdasarkan kemampuan server **ditolak**: perangkat yang mulai offline akan menjepit dan **menulis** nilai yang lebih kecil (masalah R2 spec berbalik arah). Mitigasi operasional: restart `taskflow-web` segera setelah deploy (badan PR + CURRENT_STATE); E2E skenario 5 membuktikan pemulihan.
- **R3 — Rollback disempurnakan (menggantikan §10 spec untuk 1d-0).** Rollback utama = revert **bagian klien saja** sebagai rilis baru (SW bump + whatsnew `silent`); server **tetap** menerima ≤ 99 → tanpa restart, tanpa skrip penjepit. Klien yang di-revert menampilkan target > 20 sebagai 20 dan baru menuliskan 20/21→20 bila pengguna mengklik pemilih (residual R2 spec yang sudah diterima). Revert server penuh hanya bila benar-benar perlu, dan **hanya bersama** skrip penjepit spec §10 (`UPDATE tasks SET estimated_pomodoros = 20 WHERE estimated_pomodoros > 20`) + restart; tanpa itu setiap PUT penuh task bertarget > 20 menjadi `sync_error`.
- **R4 — Pemilih Fokus: kolom angka, perilaku lama utuh.** Tombol tomat 1–5 tidak berubah: 1–4 menetapkan nilai, "5+" menetapkan 5 bila < 5, selain itu +1 (kini berhenti di 99). Bila target ≥ 5, badge `×n` di dalam tombol kelima **diganti** kolom angka `.ftask-est-input` (`type="number"`, `inputMode="numeric"`, `min=1`, `max=99`, lebar ±3 karakter) yang menjadi **saudara** radiogroup (bukan di dalamnya). Simpan saat Enter atau blur **bila nilainya berubah** — satu panggilan `onEstimate(task, n)` yang sudah ada; Escape, kosong, `0`, atau bukan angka → kembali ke nilai tersimpan tanpa PUT; > 99 → 99; nilai < 5 → disimpan, kolom hilang, fokus pindah ke tombol tomat yang terpilih. Pengurai murni `TF.pomologic.parseEstimate(text) → number|null` (dites Node).
- **R5 — (bila P2 (a)) Baris "Target 🍅" di detail task.** `liveedit.js`: `estimated_pomodoros` masuk `EDITABLE_FIELDS`; `formFromTask` = `clampEstimate(t.estimated_pomodoros)`; `fieldChanged` membandingkan angka hasil jepit; `buildPatch` mengirim angka hasil jepit; `saveTrigger` = `"blur"` (angka setengah jadi "2" sebelum "24" tidak boleh terkirim); normalisasi memanggil `TF.pomologic` lewat accessor lazy pola `taskrepo.js:20` (liveedit dimuat sebelum pomologic, `index.html:326` vs `:371`). `TaskDetailBody`: entri `optionalProps` baru `{field: "estimated_pomodoros", empty: est === 1, text: "+ Target 🍅", aria: "Target pomodoro: 1 (bawaan)"}` (berlaku untuk task pribadi maupun workspace); baris penuh `PropertyRow` label **"Target 🍅"**, teks `"{n} 🍅 · {estimateHoursLabel(n)}"` (mis. "8 🍅 · ~3.5 jam"), popover `NumberPicker` baru (input angka 1–99 + tombol "Simpan", pola `TextPicker`; Enter/Simpan/tutup popover = commit; Escape = tutup + commit sesuai aturan `closeProp` yang ada). Tanpa perubahan `PropertyRow`/`useTaskAutosave`.
- **R6 — Tidak mengubah tampilan lain.** Chip `realisasi/estimasi`, ringkasan header Fokus, kartu Pomodoro, dan Timeline sudah membaca nilai tanpa batas atas tetap (hanya lewat `clampEstimate`), jadi otomatis mengikuti 99. Teks `×n` dua digit tidak boleh meluberkan baris (dicek E2E 375 px).
- **R7 — Klien lama (residual R2 spec, diterima).** SW v499 menjepit tampilan ke 20 dan, hanya bila pengguna mengklik pemilih tomat, menulis 20 (atau 1–4 sesuai klik). Membuka task, sinkron, dan PUT lain dari klien lama mengirim nilai record apa adanya (`withEstimate`), jadi tidak menurunkan target tanpa klik. Jendela berakhir saat SW diperbarui (banner pembaruan + modal "Apa yang baru").
- **R8 — ADR-047** mencatat batas 1–99, R2 (tanpa gerbang), R3 (rollback klien-saja), dan R7.

## Global Constraints

- Komentar dan nama tes berbahasa Indonesia; TDD per tugas (tes gagal dulu); commit kecil per tugas dengan trailer atribusi sesi pelaksana; tidak ada push oleh implementer/reviewer — push hanya di Task 7.
- **Tidak berubah:** skema SQLite, `migrate_db`, IndexedDB (tetap v7), `syncpush.js`/`syncpull.js`/`hydrate.js`, `static/plugins/**`, `plugin-runtime.js`, `bot.py`. Diff `git diff origin/main -- static/offline/` hanya `pomologic.js` (+ `liveedit.js` bila P2 (a)).
- `index.html`: perubahan hanya di `FocusTaskItem`, (bila P2 (a)) `TaskDetailBody` + komponen `NumberPicker` baru tepat sebelum `TextPicker`, dan 2 string versi SW + `app.css?v=` di tugas rilis. Tanpa `innerHTML`, tanpa warna hex baru (token tema).
- `app.css`: kelas baru `.ftask-est-input` (+ aturan di `@media (max-width: 768px)` `app.css:3877` agar ikut `order: 5` seperti `.ftask-estimate` `app.css:3882`) dan (bila P2 (a)) `.td-pop-input.is-number`; token tema saja; jangan pakai `border-left` aksen (aturan repo). `app.css?v=383 → 384` di `index.html` **dan** `STATIC` `sw.js` (PROTOCOL §4 butir 2).
- String UI baru (persis, diperiksa tes): `"Target pomodoro (1–99)"` (aria kolom Fokus), `"Target 🍅"`, `"+ Target 🍅"`, `"Target pomodoro: 1 (bawaan)"`, `"Simpan"` (sudah ada di `TextPicker`).
- SW berikutnya diperkirakan **`taskflow-v500-target-pomodoro`** (cek ulang vs `main` saat merge, PROTOCOL §4 butir 4); whatsnew **non-silent** (teks = P1).
- PR dibuka sebagai **DRAFT**; merge hanya setelah pemilik bilang "merge dan deploy"; deploy **wajib** `sudo systemctl restart taskflow-web` segera sesudahnya (bot `taskflow` tidak perlu).

## Review Focus

1. **Batas konsisten di semua lapisan:** server menolak 0 dan 100 pada POST dan PUT, menerima 99; klien menjepit ke 99 di buat/ubah lokal; tes silang R1 hijau. → T1, T2.
2. **Tidak ada PUT tanpa perubahan:** kolom angka Fokus dan baris detail tidak mengirim apa pun saat fokus/blur tanpa ubah, Escape, input kosong/0/teks; satu PUT per komit yang benar-benar mengubah nilai. → T3, T4.
3. **Live Edit tidak menimpa:** `mergeExternal` tetap memenangkan nilai server untuk `estimated_pomodoros` yang tidak sedang diedit, dan mempertahankan ketikan yang sedang berjalan; target tidak terkirim di tengah ketikan ("2" sebelum "24"). → T4.
4. **Jendela deploy (R2):** klien baru + server lama → `sync_error` yang bisa dipulihkan dengan "Coba lagi" setelah server diperbarui, tanpa kehilangan field lain yang ikut dalam PUT yang sama. → E2E T6 skenario 5.
5. **Klien lama (R7):** v499 membuka/menyinkronkan task bertarget 50 tanpa menulis apa pun. → E2E T6 skenario 6.

---

### Task 1: Server — batas 1–99 + tes silang

**Files:**
- Modify: `webapp.py` (`:1238`, `:1268`, konstanta baru di dekat `class TaskCreate`), `tests/test_pomodoro_log.py`
- Create: `tests/test_est_max_sync.py` (atau tes di `test_pomodoro_log.py` bila lebih rapi — sebutkan di laporan)

**Interfaces (Produces):** `webapp.TASK_EST_MIN = 1`, `webapp.TASK_EST_MAX = 99`; `TaskCreate`/`TaskUpdate` memakai keduanya.

- [ ] **Step 1: Tulis tes gagal:** `"buat task target 99 → 200 dan tersimpan 99; 100 → 422"`; `"PUT target 21 dan 99 → 200; 0 dan 100 → 422"` (perbarui `for bad in (0, 21)` → `(0, 100)`); `"TASK_EST_MAX server sama dengan EST_MAX pomologic.js"` (regex atas berkas, gagal jelas bila pola tidak ditemukan).
- [ ] **Step 2: Jalankan → FAIL** (`python -m pytest tests/test_pomodoro_log.py tests/test_est_max_sync.py -q`).
- [ ] **Step 3: Implementasi** (konstanta + dua `Field`; jangan sentuh jalur lain).
- [ ] **Step 4: PASS** + `python -m pytest tests/ -q` penuh (perhatikan tes lain yang mengirim target > 20 — seharusnya tidak ada).
- [ ] **Step 5: Commit** `feat(task): target pomodoro 1–99 di server`

> Catatan: tes silang akan **gagal** sampai Task 2 menaikkan `EST_MAX` klien. Implementer menandainya `xfail(strict=True)` di Task 1 dengan alasan "menunggu Task 2", lalu Task 2 mencabut penanda itu — atau Task 1 dan 2 digabung dalam satu commit bila controller memutuskan demikian (catat di ledger).

### Task 2: `pomologic.js` — `EST_MAX = 99` + `parseEstimate`

**Files:**
- Modify: `static/offline/pomologic.js`, `tests/offline/pomologic.test.js`, `tests/offline/taskrepo.test.js`, `tests/test_est_max_sync.py` (cabut `xfail`)

**Interfaces (Produces `TF.pomologic`):**
- `EST_MAX = 99`; komentar `clampEstimate` "dijepit 1–99".
- `nextEstimate(current, clicked)` — tidak berubah; kini berhenti di 99.
- `parseEstimate(text) → number|null` — hanya digit setelah trim (`/^\d{1,3}$/`); `""`, `"0"`, `"-3"`, `"2.5"`, `"abc"` → `null`; `"7"` → 7; `"150"` → 99 (jepit); diekspor di objek kembalian.

- [ ] **Step 1: Tulis tes gagal:** `EST_MAX === 99`; `nextEstimate(98, 5) === 99`, `nextEstimate(99, 5) === 99`, `nextEstimate(19, 5) === 20`, `nextEstimate(20, 5) === 21`; `clampEstimate(25) === 25`, `clampEstimate(150) === 99`; tabel `parseEstimate`; `taskrepo`: `createTask({estimated_pomodoros: 30})` → 30, `150` → 99 (perbarui tes `:359–366` dan judulnya), `updateTask` 64 → 64.
- [ ] **Step 2: FAIL** (`npm test -- tests/offline/pomologic.test.js tests/offline/taskrepo.test.js` atau `node --test …`).
- [ ] **Step 3: Implementasi.** **Step 4: PASS** + tes silang T1 hijau tanpa `xfail` + `npm test` penuh (catat kegagalan pra-ada `draw_local_reactive` bila masih ada).
- [ ] **Step 5: Commit** `feat(pomodoro): batas target klien 99 dan pengurai angka target`

### Task 3: Fokus Hari Ini — kolom angka target (R4)

**Files:**
- Modify: `static/index.html` (`FocusTaskItem` saja), `static/app.css` (`.ftask-est-input` + `@media (max-width: 768px)`), `tests/offline/focus_target_ui.test.js`, `temporary_files/e2e_focus_target.py` (asersi badge `×n` → kolom angka)

**Interfaces:** Consumes `parseEstimate`, `clampEstimate`, `onEstimate` yang ada. Produces: kolom angka sesuai R4; aria-label `"Target pomodoro (1–99)"`; `title` yang sama; badge `.ftask-est-badge` tidak dirender lagi saat kolom tampil (kelas CSS-nya boleh dibiarkan atau dihapus — sebutkan).

- [ ] **Step 1: Tulis tes gagal** (tes host `index.html` di repo memeriksa **sumber** lewat `fnSource("FocusTaskItem")`, bukan render DOM; perilaku angka diuji lewat `parseEstimate` di T2 dan E2E T6): kolom ada hanya bila `pomoEst >= 5`; berada **setelah** penutup radiogroup (bukan di dalam `role: "radiogroup"`); memakai `parseEstimate` dan `onEstimate`; tidak memanggil `onEstimate` bila nilai sama/Escape/null; aria-label persis; urutan DOM lama (tab → picker → Detail) tetap; CSS `.ftask-est-input` ada dan ikut aturan `@media (max-width: 768px)`.
- [ ] **Step 2: FAIL.** **Step 3: Implementasi** (state ketikan lokal per baris; sinkron ulang dari `pomoEst` saat nilai luar berubah dan kolom tidak sedang difokus; jangan menambah handler di `TodayFocusView`).
- [ ] **Step 4: PASS**; `npm test` penuh; `node temporary_files/check_inline_scripts.js static/index.html` (pola PR sebelumnya: "OK (6)").
- [ ] **Step 5: Commit** `feat(fokus): ketik target pomodoro langsung (sampai 99)`

### Task 4: (bila P2 (a)) Detail task — baris "Target 🍅" (R5)

**Files:**
- Modify: `static/offline/liveedit.js`, `static/index.html` (`TaskDetailBody` + `NumberPicker` baru sebelum `TextPicker`), `static/app.css` (bila perlu `.td-pop-input.is-number`), `tests/offline/liveedit.test.js` (`:23` mengunci daftar `EDITABLE_FIELDS` — perbarui), `tests/offline/task_detail_redesign.test.js` (memuat tes `optionalProps`)

**Interfaces (Produces):** `TF.liveedit.EDITABLE_FIELDS` + `"estimated_pomodoros"`; `saveTrigger("estimated_pomodoros") === "blur"`; `buildPatch` mengirim angka hasil `clampEstimate`; `changedFields({estimated_pomodoros: 3}, {estimated_pomodoros: "3"})` → kosong. UI sesuai R5.

- [ ] **Step 1: Tulis tes gagal:** liveedit — `formFromTask({})` → target 1, `formFromTask({estimated_pomodoros: 40})` → 40; `changedFields` membandingkan angka; `buildPatch` → `{estimated_pomodoros: 24}`; `mergeExternal` mempertahankan ketikan dan mengadopsi nilai server bila tidak diedit; `saveTrigger` "blur"; autosaver: `change("estimated_pomodoros", 2)` lalu `change(…, 24)` + `commit` → **satu** `put` `{estimated_pomodoros: 24}`. Sumber `TaskDetailBody`: entri `optionalProps` baru dengan teks/aria persis; `PropertyRow` label `"Target 🍅"`; `NumberPicker` dipakai dengan `onChange` → `sf("estimated_pomodoros", …)` dan `onDone` → `closeProp("estimated_pomodoros")`; urutan baris properti: setelah "Deadline", sebelum "Assign ke".
- [ ] **Step 2: FAIL.** **Step 3: Implementasi.** **Step 4: PASS**; `npm test` penuh; pytest `tests/test_liveedit_node.py tests/test_taskdetail_node.py -q`; pemeriksa skrip inline.
- [ ] **Step 5: Commit** `feat(detail): baris Target 🍅 di detail task`

> Bila P2 (b): lewati tugas ini; Task 5/6 menghapus butir detail dari whatsnew dan E2E.

### Task 5: Rilis — SW v500, `app.css?v=384`, whatsnew (P1), ADR-047

**Files:**
- Modify: `static/sw.js`, `static/index.html` (2 string versi + `app.css?v=`), berkas bervers lama (penggantian massal **kecuali** `static/whatsnew.json`), `static/whatsnew.json`, `.agents/DECISIONS.md`

- [ ] **Step 1:** versi berikutnya setelah v499 (perkiraan `taskflow-v500-target-pomodoro`); PROTOCOL §4 butir 1–2 lengkap (`app.css?v=384` di `<link>` dan `STATIC`).
- [ ] **Step 2:** entri teratas `whatsnew.json`, **non-silent**, tanggal rilis WIB, teks = keputusan **P1**.
- [ ] **Step 3:** ADR-047 "Target pomodoro 1–99 (host), tanpa gerbang kemampuan server" — Context (spec 1d Q2/K45, batas 20 ≈ 8 jam fokus total; target hanya bisa diisi di Fokus); Decision (R1, R4, R5); Consequences (R2 jendela deploy + mitigasi, R3 rollback klien-saja, R7 klien lama).
- [ ] **Step 4:** `python -m pytest tests/test_whatsnew.py tests/test_sw_precache_node.py tests/test_app_update_node.py -q` (PROTOCOL §4 butir 5) + `npm test` + pytest penuh + `node compile.js` dua kali tanpa diff.
- [ ] **Step 5: Commit** `chore(release): SW v500 target pomodoro sampai 99, ADR-047`

### Task 6: E2E Playwright

**Files:**
- Create: `temporary_files/e2e_plugin_fase1_1d0.py` (pola `e2e_focus_target.py` + dua server untuk skenario 5; kontrol lama dipatok `80f047bd`)

**Skenario minimum:**
1. **Fokus:** klik "5+" → 5 → kolom angka muncul → ketik 37 + Enter → satu PUT → server 37 setelah sinkron → muat ulang tetap 37; Escape → 0 PUT; kosong/`0` → kembali ke nilai tersimpan, 0 PUT; ketik 150 → 99; ketik 3 → tombol 1–3 terisi, kolom hilang, fokus di tombol tomat ke-3; klik "5+" pada 98 → 99, klik lagi → tetap 99.
2. **Detail (P2 (a)):** task workspace milik anggota B dengan tenggat minggu depan (tidak tampil di Fokus) → "+ Target 🍅" → 24 → Simpan → server 24; B menarik → chip/detail B menampilkan 24; ketik "2" lalu "24" tanpa jeda → hanya satu PUT bernilai 24.
3. **Offline:** ubah target ke 40 saat offline → online → server 40.
4. **Server langsung:** POST/PUT 99 → 200; 100 dan 0 → 422.
5. **Jendela deploy (R2, Review Focus 4):** klien baru + server lama (`80f047bd`) → ubah judul **dan** target 30 pada task yang sama → bilah "gagal disinkronkan" → ganti ke server baru → "Coba lagi" → server berisi judul baru **dan** 30, `sync_error` hilang.
6. **Klien lama (R7, Review Focus 5):** klien v499 (`80f047bd`) + server baru, task bertarget 50 dari perangkat lain → buka Fokus/detail + dua siklus sinkron → 0 PUT; pemilih menampilkan "×20" (residual terdokumentasi).
7. **Tampilan:** 375 px + Sakura gelap: pemilih + kolom angka + chip "37/37" tidak luber; desktop 1280 px.
8. **Regresi:** `e2e_focus_target.py` (diperbarui T3), `e2e_focus_header_strip.py`, `e2e_live_edit.py`, `e2e_detail_redesign.py`, `e2e_task_detail_body.py`, `e2e_plugin_fase1_1c2.py` (bobot baseline `w` = target besar tersimpan apa adanya).

- [ ] **Step 1:** tulis skrip + jalankan semua cek (catat N/N dan angka).
- [ ] **Step 2:** jalankan regresi; kegagalan pra-ada dicatat dengan bukti di `main` bersih.
- [ ] **Step 3: Commit** `test(e2e): target pomodoro sampai 99 (Fokus, detail, offline, jendela deploy, klien lama)`

### Task 7: Verifikasi akhir, handover, review akhir, PR draft

- [ ] **Step 1: Verifikasi akhir:** pytest penuh; `npm test` penuh; PROTOCOL §4 butir 5; `node temporary_files/check_inline_scripts.js static/index.html`; `node compile.js` dua kali tanpa diff; simulasi CI tanpa `node_modules`; asap `python -c "import webapp, bot"` + `migrate_db` dua kali; `git diff origin/main --stat` sesuai Global Constraints (`static/offline` hanya `pomologic.js`/`liveedit.js`, `static/plugins` kosong, `syncpush/syncpull/hydrate` kosong); jumlah baris `index.html` dicatat.
- [ ] **Step 2: Dokumen:** catatan implementasi 1d-0 di akhir spec 1d (+ salinan Project `claude/spec-plugin-fase1-1d-beban-tim-2026-11-06.md` via `project_write`); handover `.agents/CURRENT_STATE.md` + `.agents/SESSION_LOG.md`; commit `docs(agents): handover PR 1d-0 target pomodoro sampai 99`.
- [ ] **Step 3: Review akhir** seluruh branch oleh reviewer terpisah (Review Focus 1–5 + ledger). Perbaiki temuan wajib, ulangi Step 1.
- [ ] **Step 4:** push branch `claude/target-pomodoro-99` + PR **DRAFT** `Host — PR 1d-0: target pomodoro sampai 99` — badan: ringkasan, tangkapan (Fokus + detail, 375 px), tabel file, **deploy = workflow lalu `sudo systemctl restart taskflow-web` SEGERA** (alasan R2), verifikasi pasca-deploy (`curl` PUT target 50 dengan token → 200; Pengaturan menampilkan SW v500; modal "Apa yang baru" tampil sekali), rollback R3, angka tes/E2E. Merge hanya atas "merge dan deploy".

---

## Keputusan untuk pemilik (sebelum Task 3)

| # | Pertanyaan | Pilihan | Rekomendasi |
|---|---|---|---|
| **P1** | **Teks "Apa yang baru"** v500 | (a) setujui usulan apa adanya; (b) ubah | **(a)** — judul **"Target 🍅 kini sampai 99"**; poin `new`: "Ketik target pomodoro langsung di Fokus Hari Ini, sampai 99 🍅 — tidak perlu lagi klik berkali-kali." dan (bila P2 (a)) "Atur Target 🍅 dari detail task mana pun, termasuk task minggu depan atau milik anggota tim." |
| **P2** | **Di mana target bisa diisi?** Saat ini hanya di Fokus Hari Ini, yang hanya memuat task "hari ini" (Q1, terlambat, tenggat hari ini, ⭐). Task minggu depan atau milik anggota lain tidak punya tempat mengisi target — padahal itulah yang dihitung Beban Tim. | (a) **Fokus + detail task:** kolom angka di pemilih Fokus **dan** baris baru "Target 🍅" di detail task (semua task, pribadi maupun workspace; tampil ringkas "+ Target 🍅" selama target masih 1); (b) Fokus saja — task di luar "hari ini" harus ditandai ⭐ dulu untuk diberi target | **(a)** — tanpa baris di detail task, ketua tim tidak bisa mengestimasi task anggota untuk minggu depan, sehingga Beban Tim hanya menghitung target bawaan 1 🍅. Biaya: satu baris properti di detail task memakai jalur simpan otomatis yang sudah ada. |

**Catatan yang disahkan rencana ini (tanpa pertanyaan):** rollback 1d-0 cukup membatalkan bagian tampilan; server tetap menerima sampai 99, jadi tidak perlu skrip penjepit atau restart saat rollback (R3, menyempurnakan §10 spec). Target yang diubah dalam beberapa menit antara deploy dan restart server menampilkan "gagal disinkronkan" dan pulih dengan "Coba lagi" setelah restart (R2).
