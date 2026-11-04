# PR 1c-2 — Timeline 1.2: Baseline + Catatan Aktual — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Timeline 1.2.0 — simpan/bandingkan baseline per unit jadwal (K41) dan tanggal mulai/selesai aktual (K42, Q5 (a)) yang dipakai mesin sebagai jangkar, tanpa satu pun tulisan latar (K27/R25 tetap dipagari).

**Architecture:** Memperluas mesin murni 1c-1 (`schedule.js`/`cpm.js`/`plan.js`) dengan `actual` di ext dan kodek baseline; UI menumpang pola 1c-1 (projectStore→baselineStore, usePref, writeMany, PreviewDialog tidak berubah). Record `baseline` ditambahkan ke manifest (1.2.0) — K26: deploy statis tanpa restart. Semua tulisan baru tetap lewat fungsi ber-nama yang diizinkan pagar R25 (daftar diperluas, pin diperbarui, tidak dilemahkan).

**Tech Stack:** React UMD plugin (compile.js parts), IndexedDB v7 (tetap), fake-indexeddb + node:test, pytest server (tanpa perubahan server), Playwright E2E.

**Spec:** `docs/superpowers/specs/2026-11-01-plugin-fase1-1c-otomatis-design.md` — K22, K26–K28, K30, K40–K44, §4, §5.1/5.7, §7.1/7.4/7.5/7.6 (string 1c-2), §8–§11. Keputusan pemilik P1–P2 di akhir dokumen ini.

**Keputusan pemilik (2026-11-05 05.30 WIB): P1 (a) — teks whatsnew disetujui apa adanya (verbatim di Task 11); P2 (a) — baseline aktif per perangkat per halaman (pref `bl:<page>`, tanpa tulisan record).**

## Global Constraints

- Semua yang berlaku di 1c-1 tetap berlaku: komentar/nama tes bahasa Indonesia; lint plugin (tanpa fetch/localStorage/innerHTML/hex; CSS `.plg-timeline-*` + token tema); TANPA `Date.parse`/`new Date(string)`/`localeCompare` di kode plugin (pakai `TLCal`, `TLSched.jkt`, `TLCpm.cmpKey`); mesin tidak pernah menulis (K27); pagar R25 (spy runtime + AST bundel) tetap hijau — perluasan daftar nama fungsi penulis dicatat dan di-pin, tidak pernah dilemahkan; TDD per tugas; `node compile.js --plugins-only` setelah ubah sumber, file hasil di-commit, build dua kali tanpa diff, `sw.js` hanya blok hash (bump versi hanya di tugas rilis); `index.html` hanya 2 string versi SW; IndexedDB tetap v7; commit diakhiri trailer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` + `Claude-Session: https://claude.ai/code/session_017DL2c7R2bzyzTD7wppPo72`; tidak ada push oleh implementer/reviewer.
- Kontrak 1c-1 yang WAJIB dipakai (bukan ditulis ulang): `TLSched.unitOf/unitFor/cutName/doneFinish/jkt/isEarly/sanitizePatch/readSched`; `TLCpm.run/explain/cmpKey`; `TLPlan.diff/cascade/undoItems/revalidate/flowItems` + `writeMany`/`issueMany`/`applyPlan`/`usePref`/`useUnits`/`RELOAD_TIMING` (lihat §contract task-1..16-report di `.superpowers/sdd/2026-11-01-plugin-fase1-pr-1c-1/`).
- String UI 1c-2 persis §7.6: "Baseline", "Simpan baseline", "Baseline {n}", "Tidak ada", "Timpa {nama} (disimpan {tanggal})?", "Baseline terlalu besar", "Menunggu data baseline workspace…", "Baseline vs sekarang", "Sekarang", "Selisih", "Mulai aktual", "Selesai aktual", "Catat hari ini", "Belum dicatat", "Aktual".
- Id record baseline: `bl<n>@user:<h>` / `bl<n>@list:<lid>:<h>`, n ∈ 1–3, `<h>` dari `TLSched.unitOf` (satu-satunya pembuat id). Data: `{v: 1, n, name, savedAt, by, t: [[ref, s, f, d, w], …]}`, `ref` = `{$task}` (host menahan/menulis ulang), `s`/`f` ISO, `d` durasi hk, `w` = `estimated_pomodoros`; > 65.536 byte → ditolak "Baseline terlalu besar" (K41).
- `timeline.actual`: `null` atau `{start?: "YYYY-MM-DD", finish?: "YYYY-MM-DD"}`, ISO sah 1970–2199, `finish ≥ start` bila keduanya ada (K28 §4). `actual.finish` TIDAK disimpan otomatis — turunannya = tanggal Asia/Jakarta dari `completed_at` (K42).
- SW berikutnya diperkirakan `taskflow-v499-baseline-aktual` (cek ulang vs `main` saat merge, PROTOCOL §4 butir 4); whatsnew NON-silent (teks = P1); `app.css?v=383` tetap.
- Merge hanya setelah Bapak bilang "merge dan deploy"; PR dibuka sebagai DRAFT.

## Review Focus

1. **Interop klien 1.1:** perangkat 1.1 yang mengedit kunci jadwal (start/duration/deps/mode/constraint) tidak boleh menghapus `actual` atau merusak record `baseline` (push = `ext_patch` per kunci; manifest 1.1 tidak mengenal `actual`). → tes unit di T2 (readSched 1.1-shape mengabaikan `actual` tanpa menghapus) + skenario E2E T12 #7.
2. **Turunan vs tersimpan pada selesai:** hapus `actual.finish` (patch `{actual: {start}}`) → tampilan dan jangkar kembali ke turunan `jkt(completed_at)`, bukan nilai lama; `completed_at` 23:30 UTC → hari Jakarta BESOKNYA konsisten di jangkar, baris seksi, dan garis aktual. → tes T1 (actualOf) + T2 (jangkar) + T7 (seksi).
3. **Baseline menunjuk task yang sudah dihapus/diarsip/di luar scope:** `compareBaseline` dan tabel melewatinya tanpa crash; decode data asing/korup (ref tak terpecahkan, larik pendek, v≠1) → entri dilewati, bukan null total. → tes T3.
4. **Dua anggota menimpa baseline:** perangkat belum tarik (`base_version: null` menang LWW) → kunci simpan K41 (record lokal ada ATAU `pulled` sejak pasang) + konfirmasi "Timpa {nama} (disimpan {tanggal})?" memakai snapshot record saat dialog dibuka (pola CAS unit T10 1c-1). → tes T4.
5. **Garis aktual task berjalan:** `actual.start` ada tanpa finish dan belum selesai → garis berhenti di HARI INI (bukan EF), dan berubah saat `env.today` berubah TANPA tulisan (R25). → tes T6 + spy di T10.

---

### Task 1: `schedule.js` — `actual` di sanitize/read + `actualOf` + perluasan `doneFinish`

**Files:**
- Modify: `static/plugins/timeline/schedule.js`, `tests/offline/timeline_schedule.test.js`

**Interfaces (Produces):**
- `sanitizePatch` menerima kunci `actual` (aturan Global Constraints; kunci tak dikenal tetap ditolak reason "key"); `readSched` mengembalikan `{…, actual}` (bentuk tak sah → `actual: null`, dihitung `invalid` seperti pola `constraint`).
- `TLSched.actualOf(task, ext) → {start: dn|null, finish: dn|null, finishDerived: boolean}` — `start` dari `actual.start`; `finish` = `actual.finish` ?? `jkt(completed_at)`; `finishDerived` = true bila dari `completed_at`. Murni, tanpa kalender.
- `TLSched.doneFinish(c, task, ext, s, d)` (SIGNATURE BERUBAH: + `ext`) = `maks(s, actualOf(task, ext).finish ?? fin(c, s, d))`. Semua pemanggil 1c-1 (cpm.js jangkar done, layout.js langkah 7 violations) diperbarui di T2.

- [ ] **Step 1: Tulis tes gagal**: `"sanitizePatch actual: null sah; {start} sah; {finish} sah; finish < start ditolak; tanggal tak sah ditolak; kunci lain di dalam actual ditolak"`; `"actualOf: completed_at '2026-11-04 23:30:00' (UTC) → finish = dn(2026-11-05); actual.finish menang atas completed_at; tanpa keduanya → finish null; finishDerived benar"`; `"readSched bentuk 1.1 (tanpa actual) → actual null, kunci lain utuh"`.
- [ ] **Step 2: Jalankan → FAIL**. **Step 3: Implementasi** (jangan menulis parser tanggal baru — pakai `jkt`/`CAL.dn`). **Step 4: PASS**; tes schedule lama tetap hijau tanpa ubah asersi (kecuali pemanggil doneFinish di berkas tes ini bila ada).
- [ ] **Step 5: Commit** `feat(timeline): actual di ext — sanitize, read, actualOf, doneFinish sadar aktual`

### Task 2: `cpm.js` + `layout.js` — jangkar memakai aktual (K30)

**Files:**
- Modify: `static/plugins/timeline/cpm.js`, `static/plugins/timeline/layout.js` (hanya pemanggil `doneFinish`), `tests/offline/timeline_cpm.test.js`, `tests/offline/timeline_layout.test.js`

**Interfaces:** Consumes T1. Produces: perilaku jangkar §5.1 — selesai → `es = actual.start ?? start`, `ef = actualOf.finish ?? fin(es, d)`, `ef < es → ef = es`; sudah mulai (kini TERMASUK `actual.start` ada, K30) → `es = actual.start ?? start`, `ef = fin(es, d)`. Node TIDAK bertambah field baru (aktual dibaca ulang UI lewat `actualOf`).

- [ ] **Step 1: Tulis tes gagal**: matriks jangkar `"done: actual {start,finish} menang; actual start saja → ef dari completed_at; ef<es dijepit"`; `"started karena actual.start saja (progress 0, pomodoro 0) → jangkar, es = actual.start"`; `"violations (layout langkah 7) memakai finish aktual yang sama — selesai lebih awal via actual.finish tidak menandai ⚠ penerus di tanggal mesin"` (perluasan tes α1 1c-1); `"readSched 1.1-shape: actual diabaikan tanpa menghapus kunci lain"` (Review Focus 1).
- [ ] **Step 2: FAIL**. **Step 3: Implementasi** — pemanggilan `doneFinish` di cpm/layout diperbarui ke signature baru; identitas ES=LS dan determinisme 1c-1 tidak berubah. **Step 4: PASS** + seluruh suite cpm/layout lama hijau.
- [ ] **Step 5: Commit** `feat(timeline): jangkar selesai/berjalan memakai tanggal aktual`

### Task 3: `plan.js` — kodek baseline + pembanding

**Files:**
- Modify: `static/plugins/timeline/plan.js`, `tests/offline/timeline_plan.test.js`

**Interfaces (Produces `TLPlan`):**
- `baselineEncode(result, ctx, meta: {n, name, savedAt, by}) → {data, bytes, count}` — isi = simpul terjadwal non-ringkasan di unit TERMASUK selesai (K41), `t` berisi `[[{$task: key}, iso(es), iso(ef), d, w]]` urut `cmpKey`; `bytes` = ukuran JSON UTF-8.
- `baselineByteSize(data) → int`; batas `BL_MAX = 65536`.
- `baselineDecode(data) → {n, name, savedAt, by, rows: Map<key, {s: dn, f: dn, d}>} | null` — v≠1/bentuk rusak → null; entri rusak/ref tak terpecahkan → dilewati (Review Focus 3).
- `compareBaseline(result, dec, ctx) → {perTask: Map<key, {ds, df, dd}>, group: Map<g, {blEnd: dn, nowEnd: dn}>}` — `ds/df` = selisih hari KERJA (positif = mundur), `dd` = selisih durasi; task hilang dari salah satu sisi dilewati.

- [ ] **Step 1: Tulis tes gagal**: round-trip encode→decode; `"±55 B/task: 1000 task ≈ >65536 → ditolak di T5 (di sini: byteSize akurat)"`; `"decode: v 2 → null; baris ['x'] pendek → dilewati; ref tak dikenal → dilewati"`; `"compare: mundur 2 hk → ds 2; durasi beda → dd; task terhapus dari result → dilewati; blEnd/nowEnd per kelompok"`; determinisme urutan (`cmpKey`).
- [ ] **Step 2: FAIL**. **Step 3: Implementasi** (murni; tanpa Date). **Step 4: PASS**. **Step 5: Commit** `feat(timeline): kodek baseline dan pembanding rencana-vs-baseline`

### Task 4: Manifest 1.2.0 + `baselineStore` + pagar

**Files:**
- Modify: `static/plugins/timeline/manifest.json` (version `1.2.0`, `records.baseline` `{conflict: "lww", maxBytes: 65536}`, `taskExt.keys` + `actual`), `plugin.jsx`, `tests/offline/timeline_ui.test.js`, `tests/build-plugins.test.js`, `tests/offline/timeline_runtime.test.js` (konsekuensi decl), `tests/test_plugin_timeline_records.py` (decl + baseline)
- Generated: `plugin.js`, `static/plugins/index.json`, blok hash `static/sw.js`

**Interfaces (Produces):** `baselineStore(api)` mengikuti pola `projectStore`/`useUnits` (RELOAD_TIMING, `pulled`, fold-guard TIDAK perlu — id slot eksplisit): `loadAll(unit) → Map<n, dec>`; `save(unit, n, name, data, snap)` — SATU-SATUNYA `records.put` baseline, di dalam fungsi `saveBaseline` (daftar pagar + pin diperluas `"saveBaseline:records.put": 1`); `remove(unit, n)` (fungsi `saveBaseline` juga, op remove); kunci K41: simpan workspace terkunci sampai record lokal ada ATAU `pulled` ("Menunggu data baseline workspace…", pola P3 (a) 1c-1); `snap` = snapshot record slot saat dialog dibuka → beda saat simpan → tolak + muat ulang (Review Focus 4).

- [ ] **Step 1: Tulis tes gagal**: build (1.2.0, decl baseline, enam kunci taskExt, hash berubah, dua build stabil); `"loadAll dua halaman next; v2 diabaikan"`; `"save menulis {v:1,n,name,savedAt,by,t}; remove"`; `"kunci workspace: belum loaded/pulled → terkunci + teks; project pribadi tidak"`; `"snap beda → tolak"`; pagar R25: spy (mount/sync/pulled/onChange/dayChanged/kalender/scopeTasks) tetap 0 tulis; fence AST pin + `saveBaseline`.
- [ ] **Step 2: FAIL**. **Step 3: Implementasi**; `node compile.js --plugins-only`. **Step 4: PASS**; `python3 -m pytest tests/test_plugins_node.py tests/test_sw_precache_node.py tests/test_plugin_timeline_records.py -q`. **Step 5: Commit** `feat(timeline): manifest 1.2.0, record baseline, baselineStore terkunci`

### Task 5: Toolbar — pilih Baseline + Simpan baseline

**Files:**
- Modify: `plugin.jsx`, `style.css`, `tests/offline/timeline_ui.test.js`

**Interfaces:** Consumes T3/T4, `usePref`. Produces: pilihan baseline aktif per halaman = pref `bl:<page>` bernilai `0..3` (0 = "Tidak ada") — P2 (a) FINAL: pref per perangkat per halaman, tanpa tulisan record. `openSaveBaseline()` → dialog slot 1–3 (menampilkan nama + "disimpan {tanggal}" slot terisi) + nama (bawaan "Baseline {n}"), timpa → konfirmasi "Timpa {nama} (disimpan {tanggal})?", > BL_MAX → toast "Baseline terlalu besar", sukses → toast; encode dari hasil mesin AKTIF (useEngine result) — engine belum siap → kedua tombol tidak tampil.

- [ ] **Step 1: Tulis tes gagal**: urutan toolbar §7.1 (… Jalur kritis · **Baseline** · **Simpan baseline** · Jadwalkan ulang …) + keduanya masuk "Lainnya" ≤ 640 px/liveEdit; picker "Baseline {n}"/"Tidak ada" + pref round-trip; alur simpan (slot kosong tanpa konfirmasi; terisi → konfirmasi; 0 tulis saat Batal; satu `records.put` saat simpan); "Baseline terlalu besar" (fixture > 65536); mesin belum siap → tombol tersembunyi; teks kunci workspace.
- [ ] **Step 2: FAIL**. **Step 3: Implementasi** (R23-pola T8 1c-1; dialog pola PreviewDialog fokus/Esc). **Step 4: PASS**; build. **Step 5: Commit** `feat(timeline): simpan dan pilih baseline di toolbar`

### Task 6: Grafik — bar baseline + garis aktual + legenda

**Files:**
- Modify: `plugin.jsx` (overlay memo terpisah, pola T7 1c-1 — `lay` TIDAK berubah), `style.css`, `tests/offline/timeline_ui.test.js`

**Interfaces:** Consumes `compareBaseline` (T3), `actualOf` (T1), baseline aktif (T5). Produces: bar baseline 4 px di bawah bar (`color-mix(in srgb, var(--text-secondary) 45%, transparent)`, 1 `div` per baris TAMPAK, aria/tooltip `"Baseline: {fmtShort(s)} → {fmtShort(f)} ({±n} hk)"`); garis aktual 2 px `var(--text-primary)` dari `actualOf.start` sampai `actualOf.finish ?? HARI INI` (tanpa sakelar — tampil bila `actual.start` ada); legenda + "Baseline" (bila aktif ≠ Tidak ada) + "Aktual" (bila ada garis di halaman).

- [ ] **Step 1: Tulis tes gagal**: bar baseline hanya saat pref aktif + rentang/aria benar; task tanpa entri baseline → tanpa bar; garis aktual berjalan berhenti di hari ini dan ikut `env.today` TANPA tulisan (Review Focus 5); selesai → berhenti di finish turunan; legenda sesuai; DOM 500/400 + crit ON + baseline ON ≤ 1.500 (perluasan tes T13 1c-1); `lay` tidak dihitung ulang saat baseline/pref berubah (spy pola T7).
- [ ] **Step 2: FAIL**. **Step 3: Implementasi**. **Step 4: PASS**; build. **Step 5: Commit** `feat(timeline): bar baseline dan garis aktual di Gantt`

### Task 7: Seksi Jadwal — aktual + tabel Baseline vs sekarang

**Files:**
- Modify: `plugin.jsx` (ScheduleBody), `style.css`, `tests/offline/timeline_section.test.js`

**Interfaces:** Consumes T1/T3/T5, `writeMany`/`write` + aturan busy/undo T11 1c-1. Produces: tingkat 2 baris ringkas + `" · baseline {±n} hk"` (hanya bila baseline aktif memuat task); tingkat 3 — setelah "Tambah dependensi": **Mulai aktual** / **Selesai aktual** (nilai, atau "Belum dicatat" + tombol "Catat hari ini"; nilai turunan `completed_at` ditandai "Aktual" tanpa tombol ubah? TIDAK — tetap bisa diubah; menghapus nilai selesai yang DIUBAH mengembalikan turunan, Review Focus 2) lalu **Baseline vs sekarang** (tabel 3×3: baris Mulai/Selesai/Durasi × kolom Baseline/"Sekarang"/"Selisih"; tanpa baseline aktif atau task tak ada di dalamnya → baris "Tidak ada"); patch `{actual: {...}}` lewat `write` (jangkar — TIDAK mengalir; mengubah aktual mengubah jangkar → drift penerus tampil lewat banner, bukan tulisan).

- [ ] **Step 1: Tulis tes gagal**: urutan tingkat 3 baru; "Catat hari ini" → satu `set {actual:{start: today}}`; selesai aktual turunan dari `completed_at` 23:30 UTC → tanggal besok Jakarta (Review Focus 2); ubah → simpan; hapus → kembali turunan; tabel nilai + selisih ± hk; "Tidak ada"; tingkat 2 `baseline ±{n} hk`; 0 tulis dari pasang/berubah props (R25).
- [ ] **Step 2: FAIL**. **Step 3: Implementasi** (tanggal via TLCal; input date pola Batasan T12 1c-1). **Step 4: PASS**; build. **Step 5: Commit** `feat(timeline): seksi Jadwal — tanggal aktual dan tabel Baseline vs sekarang`

### Task 8: K42 — pencatatan aktual otomatis dari gestur perangkat

**Files:**
- Modify: `plugin.jsx`, `static/plugins/timeline/manifest.json` HANYA bila event perlu dideklarasikan (cek pola event 1b), `tests/offline/timeline_ui.test.js`, `tests/offline/timeline_runtime.test.js`

**Interfaces:** Consumes T1. Produces: fungsi `recordActual(taskKey)` — SATU-SATUNYA penulis `{actual:{start: today}}` otomatis, "isi bila kosong" (sudah ada → 0 tulis), dipicu HANYA oleh: (a) `pomodoro.ended` untuk task itu (listener terpasang saat plugin aktif di sesi), (b) seksi Jadwal terpasang melihat `progress` task itu naik dari 0 atau status menjadi selesai. `actual.finish` TIDAK PERNAH ditulis otomatis (K42). Pagar: daftar nama fungsi AST + pin diperluas (`recordActual:taskExt.set`); spy R25 diperluas: `pomodoro.ended` task BER-actual.start → 0 tulis; `sync.done`/`pulled`/`onChange` → tetap 0 (perubahan progress yang DATANG DARI SYNC tidak memicu — hanya perubahan yang disaksikan seksi dari interaksi lokal; pembeda: tandai dari event host gestur, bukan dari diff data sync).

- [ ] **Step 1: Tulis tes gagal**: `"pomodoro.ended task tanpa actual.start → satu set {actual:{start: today}}; dengan → 0"`; `"seksi terpasang, progress 0→20 via interaksi → tercatat; perubahan yang sama tiba lewat sync/refresh → 0 tulis"`; `"selesai via centang di seksi → start terisi bila kosong, finish TIDAK ditulis"`; fence + spy baru.
- [ ] **Step 2: FAIL**. **Step 3: Implementasi** (cari nama event host persis di plugin-runtime/README §4; jalur cadangan tetap tombol "Catat hari ini" T7). **Step 4: PASS**; build. **Step 5: Commit** `feat(timeline): catat mulai aktual dari pomodoro dan progres (isi bila kosong)`

### Task 9: Polesan terdokumentasi 1c-1 → 1c-2

**Files:**
- Modify: `plugin.jsx`, `tests/offline/timeline_ui.test.js`, `temporary_files/e2e_plugin_fase1_1c0.py` (HANYA komentar angka bila berubah)

**Interfaces:** (a) panah `is-critical` hanya untuk sisi PENGARAH (`driver.from`) antara dua simpul kritis (penajaman R18 1c-1, rekomendasi review akhir — perubahan perilaku tampilan, dicatat di ADR); (b) `useEngine` menggabungkan `setList`/`setFailed` menjadi satu commit React (menghilangkan kerapuhan batas 8c; JANGAN mengubah kontrak useEngine).

- [ ] **Step 1: Tulis tes gagal**: `"panah antara dua kritis non-pengarah → tanpa is-critical; pengarah → is-critical"` (perbarui asersi T7 1c-1 yang terdampak — perubahan satu-satunya yang disahkan); `"muat list: satu commit (spy pola 8c)"`.
- [ ] **Step 2: FAIL**. **Step 3: Implementasi**. **Step 4: PASS**; build; jalankan skenario 8 `e2e_plugin_fase1_1c0.py` → angka commit turun/tetap ≤ 4 (catat). **Step 5: Commit** `fix(timeline): panah kritis hanya sisi pengarah; useEngine satu commit muat`

### Task 10: Integrasi runtime + anggaran (tes saja)

**Files:**
- Modify: `tests/offline/timeline_runtime.test.js`, `tests/offline/timeline_ui.test.js`

- [ ] **Step 1: Tulis tes** (catat merah/hijau-langsung per tes, pola T13 1c-1): `"index.json: 1.2.0, records.baseline tersalin, enam kunci"`; `"api.records nyata: put bl1@list:12:<h> → pending + op outbox; ukuran 65 KB ditolak sisi klien sebelum put"`; `"api.taskExt.set {actual} nyata lolos validasi host"`; `"DOM 500/400 + crit + baseline + garis aktual ≤ 1.500"`; `"render awal tetap tanpa TLCpm.run"`.
- [ ] **Step 2–4:** jalankan; nama boleh disesuaikan, kontrak tidak; bug produk → BLOCKED. `npm test` penuh + `python3 -m pytest tests/ -q` penuh (pelajaran 1c-1: full pytest wajib di sini juga).
- [ ] **Step 5: Commit** `test(timeline): integrasi runtime 1.2 — record baseline, actual, anggaran DOM`

### Task 11: Rilis — SW, whatsnew (P1), README, ADR-046

**Files:**
- Modify: `static/sw.js`, `static/index.html` (2 string versi), berkas bervers lama (sed KECUALI `static/whatsnew.json`), `static/whatsnew.json`, `docs/plugins/README.md`, `.agents/DECISIONS.md`, `tests/test_plugins_node.py` (REQUIRED bila ada suite baru)

- [ ] **Step 1:** versi berikutnya setelah v498 (perkiraan `taskflow-v499-baseline-aktual`); PROTOCOL §4 lengkap.
- [ ] **Step 2:** whatsnew teratas, non-silent, tanggal rilis WIB — **teks = keputusan P1** (usulan di bawah).
- [ ] **Step 3:** README: judul "(Fase 0a–1c-2)"; §5 contoh record `baseline` (id slot, kunci simpan, $task); §8 butir "Aktual dicatat dari gestur perangkat itu, isi bila kosong — tidak pernah dari sync" (K42).
- [ ] **Step 4:** ADR-046 "Timeline 1.2: baseline per unit + catatan aktual tanpa tulisan latar" (Context K40–K42/Q5; Decision kodek larik + kunci simpan + isi-bila-kosong + jangkar aktual; Consequences: ganti nama project menyembunyikan baseline (tetap tersimpan, §8 spec); 1.1 melihat SS/FF/SF rusak — tidak berubah; actual ikut LWW per kunci; residual carry-over 1c-1 yang masih berlaku).
- [ ] **Step 5:** Verifikasi PROTOCOL §4 butir 5 + `npm test` + pytest penuh + `node compile.js` idempoten + `index.html` 46.074 baris. **Step 6: Commit** `chore(release): SW v499 Timeline 1.2 baseline + aktual, README, ADR-046`

### Task 12: E2E + verifikasi akhir + handover + review akhir + PR draft

**Files:**
- Create: `temporary_files/e2e_plugin_fase1_1c2.py` (pola 1c1; kontrol lama dipatok SHA merge 1c-1 `cb76fba5`)
- Modify: spec (catatan implementasi 1c-2), `.agents/CURRENT_STATE.md`, `.agents/SESSION_LOG.md`; salinan Project via `project_write`

**Skenario E2E minimum:** (1) nol tulisan latar termasuk setelah `pomodoro.ended` task ber-aktual + sync 2 siklus; (2) simpan baseline A → B tarik → bar baseline sama + kunci simpan di perangkat baru sebelum pull; (3) timpa slot → konfirmasi; CAS dua anggota; (4) catat aktual via pomodoro nyata → jangkar bergeser → drift penerus → Tinjau; (5) selesai 23:30 UTC → tanggal Jakarta besok di seksi dan garis; (6) tabel Baseline vs sekarang + chip tier-2; (7) klien 1.1 (dipatok `cb76fba5`) mengedit start task ber-aktual → aktual selamat (Review Focus 1); (8) 375 px + Sakura gelap (bar baseline + garis terbaca); (9) kinerja: mesin ≤ 40 ms CPU 4×, DOM ≤ 1.500; (10) regresi: `1c1.py`, `1c0b.py`, `1c0.py`, `1b.py`, `1a2.py`, `1a1.py`, `0b.py` (0a = flake pra-ada terdokumentasi).

- [ ] **Step 1:** skrip + jalankan semua cek (catat N/N + angka); regresi.
- [ ] **Step 2:** verifikasi akhir penuh (pola task-16 1c-1, 11 butir, diff vs main: `static/offline` TIDAK berubah, `webapp.py` dkk TIDAK berubah — 1c-2 murni plugin + statis).
- [ ] **Step 3:** catatan implementasi di spec + salinan Project; handover CURRENT_STATE/SESSION_LOG; commit `docs(agents): handover PR 1c-2 Timeline baseline + aktual`.
- [ ] **Step 4:** review akhir seluruh branch oleh reviewer terpisah (Review Focus 1–5 + ledger; khusus: nol tulisan dari sync/pulled/progress-via-sync; kodek determinis; kunci simpan; jangkar aktual konsisten mesin↔violations↔tampilan; pagar diperluas tanpa dilemahkan). Perbaiki temuan wajib, ulangi Step 2.
- [ ] **Step 5:** push + PR DRAFT `Plugin Fase 1 — PR 1c-2: Timeline 1.2 (baseline, catatan aktual)` — body: ringkasan, tangkapan, tabel file, prasyarat (1c-1 live — sudah), deploy statis tanpa restart, rollback R27 (revert ke 1.1.0; record baseline + kunci actual dibiarkan, 1.1 mengabaikannya), angka tes/E2E; akhiri atribusi sesi. Merge hanya atas "merge dan deploy".

---

## Keputusan untuk pemilik (sebelum Task 11 / sebelum implementasi UI T5)

| # | Pertanyaan | Pilihan | Rekomendasi |
|---|---|---|---|
| **P1** | **Teks "Apa yang baru"** v499 | (a) setujui usulan ini apa adanya; (b) ubah | **(a)** — usulan (≤ 60/140 karakter, tanpa istilah teknis): judul **"Timeline: baseline dan tanggal aktual"**; poin: "Simpan baseline project (sampai 3) dan lihat bedanya dengan jadwal sekarang — bar tipis di bawah setiap task.", "Tanggal mulai dan selesai sungguhan tercatat otomatis saat kamu mulai fokus atau menyelesaikan task — bisa diubah kapan saja.", "Garis aktual di Gantt menunjukkan sejauh mana pekerjaan berjalan dibanding rencana.", "Detail task kini punya tabel Baseline vs sekarang dan tanggal aktual dengan tombol Catat hari ini." |
| **P2** | **Baseline aktif (yang ditampilkan)** disimpan di mana? | (a) pilihan per perangkat per halaman (seperti sakelar "Jalur kritis" — tiap anggota bebas memilih tampilannya sendiri); (b) bersama satu unit (semua anggota melihat baseline yang sama, pindah pilihan menulis record) | **(a)** — baseline mana yang dibandingkan adalah urusan tampilan, bukan data tim; (b) menambah tulisan record setiap ganti pilihan dan bisa saling timpa antar anggota tanpa manfaat jelas. |

**Catatan perubahan perilaku yang disahkan rencana ini (tanpa pertanyaan):** panah jalur kritis kini hanya menyala pada sisi yang benar-benar menentukan jadwal (Task 9a, rekomendasi review akhir 1c-1) — sebelumnya semua panah antara dua task kritis ikut menyala.
