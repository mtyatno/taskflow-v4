# PR 1d-1 — Timeline 1.3: Beban Tim — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Timeline 1.3.0 menambah panel **Beban Tim**. Panel ini menampilkan histogram 🍅 terjadwal per orang per hari, dibandingkan dengan kapasitasnya; hari yang kelebihan beban tampil merah. Ada saran leveling manual (task mana yang aman digeser) dan editor kapasitas/cuti (record `resource`). Satu-satunya tulisan baru adalah `saveResource` atas tombol Simpan. Tidak ada tulisan latar (K27/R25).

**Architecture:**
- Mesin murni baru `load.js` (`TLLoad`). Ia memakai daftar lengkap halaman, kalender halaman, dan slack yang sudah dihitung mesin 1c (`useEngine`), serta tanggal **tersimpan** yang sama dengan bar Gantt (`TLSched.spanOf`).
- Record `resource` dideklarasikan di manifest 1.3.0 (K26: tanpa restart).
- Panel menumpang viewport Gantt (`windowDays`, lebar kolom tabel, gulir horizontal) dan menggambar satu `<svg>` per baris orang.
- `resourceStore` mengikuti pola `baselineStore` (CAS + kunci perangkat baru).
- Tanpa perubahan host, server, atau IndexedDB.

**Tech Stack:** React UMD plugin (parts `compile.js`), node:test + fake-indexeddb, pytest (deklarasi record), Playwright E2E.

**Spec:** `docs/superpowers/specs/2026-11-06-plugin-fase1-1d-beban-tim-design.md` — K45–K50, K55–K56, K58–K59, §4, §5.1–§5.2, §5.5, §6, §7.1–§7.4, §7.6–§7.7, §8, §9, §10, §11 R3–R4. Jawaban pemilik: Q3 (a), Q4 (a), Q5 (a). Koreksi spec dicatat di "Keputusan rencana" R1–R4. Keputusan pemilik P1–P3 ada di akhir dokumen ini.

**Keputusan pemilik (2026-11-09 07.42 WIB): P1 (a) — teks whatsnew v501 disetujui apa adanya; P2 (a) — baris = pengguna aktif + penanggung jawab task + pemilik record kapasitas, tanpa perubahan host, "(bukan anggota)" dihapus; P3 (a) — halaman project pribadi "Hanya beban dari project ini", workspace tanpa catatan.**

**Basis kode:** `main` @ `a04f0e6` (setelah #128 1d-0).
- SW `taskflow-v500-target-pomodoro`, `app.css?v=384`, IndexedDB v7, `index.html` 46.236 baris, ADR terakhir ADR-047.
- Timeline 1.2.0: `plugin.jsx` 5.717, `schedule.js` 651, `cpm.js` 535, `plan.js` 568, `layout.js` 643, `calendar.js` 250, `style.css` 1.935 baris.

## Fakta hasil eksplorasi

| # | Fakta | Lokasi | Akibat untuk 1d-1 |
|---|---|---|---|
| F1 | Bar Gantt = tanggal **tersimpan** (`row.span` dari `start` + `duration`; "Rentang bar (row.span) tidak berubah"). ES/EF mesin hanya dipakai untuk slack, kritis, dan drift (banner K35). | `layout.js:503–537`, spec 1c K27/K35 | K46 ("ES/EF mesin untuk task otomatis") bertentangan dengan yang digambar → R1 |
| F2 | `useEngine` memuat `api.data.tasks.list({includeDone: true})` lalu menyaringnya ke `TLSched.scopeKeyOf` halaman (**tanpa** filter panel). Kalendernya satu per halaman (`calData`). Keluaran: `out.ctx = {tasks, cal, units, readExt}`, `out.result` = `{nodes: Map<key, {es, ef, ls, lf, slack, critical, mode, fixed?, d}>, summaries: Map<induk, anak[]>, …}`. | `plugin.jsx:1217–1330`, `cpm.js:297`, `:421` | Lingkup beban = `eng.ctx.tasks`; satu kalender → kasus multi-kalender §5.1/§8 tidak pernah terjadi (R2) |
| F3 | `TLCal.nextWork(c, n)` = hari kerja pertama ≥ n. `isWork`, `workdays` O(n). `TLSched.spanOf(c, sched)` → `{s, f}` atau `null` (durasi 0 = milestone, `f = s`). | `calendar.js:119`, `:128`, `:159`; `schedule.js:292` | T = `nextWork(cal, D)`; tanpa prefiks baru |
| F4 | "Sudah mulai" = `progress > 0 ∨ pomodoros_done > 0` (`cpm.js:37`) ∨ `actual.start` (K30). `modeOf`: `raw.mode` eksplisit menang; tanpa itu mengikuti unit. | `cpm.js:37`, `:294`; `schedule.js:284` | Klasifikasi saran (R6) |
| F5 | `context.collaborators` berasal dari `/api/collaborators`: **semua** rekan dari semua workspace pengguna, tanpa diri sendiri — bukan anggota workspace halaman ini (README §6.2 keliru). `api.fetch` hanya boleh ke `/api/plugins/timeline/…` dengan izin `network`. Daftar anggota per workspace tidak tersimpan lokal. | `webapp.py:3670`, `plugin-runtime.js:1027–1031`, `index.html:44267` | Plugin tidak bisa tahu siapa anggota workspace → **P2** |
| F6 | Halaman `proj_*` = project **pribadi** saja (`pageScopePred` → `isPersonalProjectTask`). Project workspace hanya muncul sebagai kelompok di halaman `slist_*`. | `index.html:17733` | Kasus K49 "halaman project di dalam workspace" tidak ada → **P3** |
| F7 | Viewport: `dw = TLLayout.windowDays(range, px, sl, vp.w)` = 3× lebar layar, terkuantisasi. Di zoom minggu (12 px/hari) jendelanya ±250 hari. | `plugin.jsx:3280–3297`, `layout.js:71` | Satu sel per hari × 10 orang melampaui DOM 1.500 → R5 (SVG per baris) |
| F8 | Toolbar extras: Jadwal otomatis · Jalur kritis · Baseline · Simpan baseline · Jadwalkan ulang. Masuk `MoreMenu` saat `collapse` (≤ 640 px / Live Edit). Preferensi: `usePref`/`PREF_DEFAULTS`/`prefKey`. | `plugin.jsx:319–331`, `:933`, `:1358–1397`, `:1954` | Tombol "Beban Tim" + pref `load:<page>` |
| F9 | Pagar R25: `FENCE_ALLOW` + pin `per`. Spy perilaku (mount/sync/pulled/onChange/dayChanged) = 0 tulis. | `tests/offline/timeline_ui.test.js:3382`, `:3462–3468` | + `saveResource` |
| F10 | `baselineStore`: CAS potret `{exists, updatedAt, by}` lewat `records.get` sebelum `put`; `loadScope` memakai `records.list(entity, {scope, limit, after})` berhalaman; `recordEvent`; latch `pulled` (`useCalendar`); nama pelaku lewat `unitCaption` (currentUser + collaborators, selain itu "anggota lain"). | `plugin.jsx:43`, `:234–317`, `:562`, `:974` | Pola `resourceStore` / `useResources` |
| F11 | Server: `ID_RE ^[A-Za-z0-9:@._-]{1,80}$`, `SCOPE_RE ^(user\|list:\d+)$`. | `plugin_records.py:37–38` | `res@list:<lid>:<uid>` dan `res@user:<uid>` sah tanpa ubah server |
| F12 | Suite Node baru wajib didaftarkan di daftar REQUIRED. | `tests/test_plugins_node.py:40` | + `timeline_load` |
| F13 | View belum punya "gulir ke baris/bar". | `plugin.jsx` | R7 |
| F14 | Token warna plugin: `--plg-timeline-danger` (terlambat/pelanggaran), `--text-secondary`, `--border`, `--accent`, `--bg-subtle`, `--pomodoro`. | `style.css` | Tanpa warna baru |

## Keputusan rencana (controller)

- **R1 — Tanggal beban = tanggal yang digambar (koreksi K46).**
  - Jendela task = `TLSched.spanOf(cal, readSched(readExt(t)))`, berlaku untuk task Otomatis maupun Manual. Nilainya identik dengan `row.span` bar (F1).
  - ES/EF mesin tidak dipakai untuk distribusi beban. Task otomatis yang drift dihitung di tanggal bar-nya; banner drift tetap menjadi jalan memperbaruinya.
  - Saran (slack, kritis) memakai `result.nodes`.
  - Tes: untuk setiap task berjadwal, beban jatuh tepat di dalam `[maks(T, row.span.s), row.span.f]` milik `TLLayout.layout` atas data yang sama.
- **R2 — Lingkup dan kalender.**
  - Lingkup = `eng.ctx.tasks`: daftar lengkap halaman, termasuk task yang disembunyikan filter panel. Beban sebenarnya tidak boleh hilang karena filter.
  - Induk ringkasan (`result.summaries.keys()`) dilewati, sama seperti baseline (hanya non-ringkasan).
  - Kalender = `eng.ctx.cal`, satu untuk satu halaman. Kalimat multi-kalender di §5.1/§8 spec tidak berlaku.
  - Panel tidak dihitung sebelum `eng.status === "ready"`.
- **R3 — Target dibaca plugin sendiri.**
  - `TLLoad.EST_MAX = 99`; target = bilangan bulat ≥ 1, selain itu 1, dijepit ke 99.
  - `pomodoros_done` bukan bilangan bulat ≥ 0 → 0.
  - Tes silang (Node) membandingkan dengan `EST_MAX` di `static/offline/pomologic.js`.
  - Jam ditampilkan dengan format yang sama seperti host `estimateHoursLabel` (dites untuk 1..99 terhadap `pomologic`).
- **R4 — Baris orang (bergantung P2 dan P3).** Usulan P2 (a), tanpa perubahan host:
  - Baris halaman workspace = pengguna aktif ∪ penanggung jawab (`assigned_to`) setiap task hidup di lingkup ∪ setiap `uid` yang punya record `resource` di workspace ini.
  - Nama diambil dari `currentUser` + `collaborators`; tidak ditemukan → "Anggota #{id}".
  - Label "(bukan anggota)" (K49) **dihapus**, karena plugin tidak bisa membedakannya (F5).
  - Baris "Belum ditugaskan" selalu terakhir dan hanya tampil bila ada bebannya.
  - Halaman pribadi: satu baris pengguna aktif, dengan catatan sesuai P3.
- **R5 — Render tanpa sel per hari.** Tiap baris orang berisi satu `<svg>` selebar jendela `dw` (diposisikan di `xOf(dw.fromDn)`) yang memuat:
  - path area kapasitas per hari (`--bg-subtle`);
  - path beban (`--accent`);
  - path kelebihan (bagian beban di atas kapasitas pada hari merah, `--plg-timeline-danger`);
  - path arsir cuti (kelas `is-leave`);
  - path hari non-kerja (`--bg-subtle`, pola libur Gantt).

  Tombol fokus hanya dibuat untuk hari merah di dalam jendela. `aria-label`-nya sama dengan teks tooltip. Satu elemen readout hover per panel (`onPointerMove` → `TLLayout.dnAt` → baris + hari), sehingga tidak ada `title` per hari.

  Gulir horizontal: wadah grafik panel `overflow: hidden`, isinya digeser `transform: translateX(-scrollLeft px)` yang disetel langsung dari `onScroll` utama lewat ref (tanpa render ulang per piksel). Render ulang hanya bila `dw` berubah, sama seperti Gantt.

  Kolom kiri selebar `tableW` (sticky). Tinggi baris 28 px, maksimal 10 baris terlihat, sisanya gulir vertikal. Anggaran: DOM panel ≤ 300 elemen untuk 10 orang di zoom apa pun; DOM total ≤ 1.500 (§1 butir 6).
- **R6 — Klasifikasi saran (penajaman K50).** Untuk tiap kontributor hari itu, urutan pemeriksaan:
  1. `late` (jendela berakhir sebelum T) → "terlambat".
  2. `started` (F4) → "Sudah mulai".
  3. `manual`, yaitu `raw.mode === "manual"` eksplisit di unit Otomatis → "Manual".
  4. `critical` (simpul tidak ada, `slack` null, atau ≤ 0) → "Kritis".
  5. Selain itu `free`.

  Di project Manual (bawaan) semua task diklasifikasi menurut slack, karena menggeser dengan tangan memang cara kerjanya. Tanpa aturan ini project Manual tidak akan pernah punya saran.

  Urutan tampil: `free` slack menurun lalu `cmpKey`; sisanya berurutan `critical` → `manual` → `started` → `late`, masing-masing `cmpKey`.
- **R7 — "Pilih + gulir" tanpa tulisan.** `revealRow(key)`:
  - Bila baris ada di `lay.rows`: setel `scrollTop` agar baris di sepertiga atas, `scrollLeft` agar awal bar di sepertiga kiri, lalu beri kelas `is-flash` 1,5 detik.
  - Bila tidak ada (tersaring panel, HP mode Daftar): `context.onTaskClick(task)` (membuka detail).
- **R8 — Satuan internal milipomodoro (×1000, bilangan bulat).**
  - Porsi = `floor(sisa×1000 ÷ n)`; sisa bagi +1 ke hari-hari paling awal. Jumlahnya tepat dan determinis untuk urutan masukan apa pun.
  - Kelebihan beban: `load > cap × 1000`.
  - Tampilan dibulatkan ke 0,5 dengan titik desimal seperti host (`"2.5"`, `"3"`).
- **R9 — Simpan kapasitas/cuti.**
  - `saveResource` adalah satu-satunya `records.put` baru, dengan CAS potret `{exists, updatedAt}` saat popover dibuka.
  - Workspace: terkunci "Menunggu data workspace…" sampai record lokal ada ATAU latch `pulled` menyala (pola P3 (a)/ADR-042). Pribadi tidak terkunci (pola baseline).
  - Normalisasi saat simpan:
    - `capacity` bilangan bulat 0–40;
    - `leave` ≤ 50 rentang, `from ≤ to` ISO sah 1970–2199, tumpang tindih/bersebelahan digabung;
    - `note` ≤ 60 code point, potong sadar surrogate;
    - `by` = `api.env.userId`, `updatedAt` = jam server/host (lihat `records.put`).
  - Batas 4.096 byte (manifest).
- **R10 — Ketersediaan.**
  - Tombol "Beban Tim" (`aria-pressed`) tampil saat mesin siap, ditempatkan setelah "Jalur kritis" (Gantt) dan juga di mode Daftar (HP). Di ≤ 640 px / Live Edit tombol masuk "Lainnya".
  - Pref `load:<page>` default `false` (K56). Panel tertutup = `TLLoad.run` tidak dipanggil (spy).
  - ≤ 640 px (Gantt maupun Daftar) → daftar "Hari kelebihan beban" (§7.6) menggantikan histogram.
- **R11 — Interop dan rollback.**
  - Klien 1.2 (v500) tidak mengenal `resource`. E2E membuktikan klien itu tidak menghapus maupun menulis ulang record `resource` dan tetap berjalan.
  - Rollback = revert ke 1.2.0 sebagai rilis baru (SW bump + whatsnew `silent`); record dibiarkan.
- **R12 — ADR-048** mencatat R1 (koreksi K46), R4/P2 (sumber baris), R5 (render SVG), R6 (klasifikasi), R9 (kunci + CAS), R11, dan koreksi README §6.2 (`collaborators` = semua rekan, bukan anggota workspace).

## Global Constraints

- **Aturan 1c tetap berlaku:**
  - komentar dan nama tes berbahasa Indonesia;
  - lint plugin: tanpa fetch, localStorage, innerHTML, hex; CSS `.plg-timeline-*` + token tema;
  - **tanpa** `Date.parse`, `new Date(string)`, `localeCompare` di kode plugin (pakai `TLCal`, `TLSched.jkt`, `TLCpm.cmpKey`);
  - mesin tidak pernah menulis;
  - pagar R25 hanya diperluas dengan `saveResource`, tidak pernah dilemahkan.
- **Proses:**
  - TDD per tugas;
  - `node compile.js --plugins-only` setelah mengubah sumber; berkas hasil di-commit; build dua kali tanpa diff;
  - `sw.js` hanya berubah di blok hash, kecuali di tugas rilis;
  - commit diakhiri trailer atribusi sesi pelaksana;
  - tidak ada push oleh implementer/reviewer.
- **Tidak berubah:** `webapp.py`, `plugin_records.py`, `static/offline/**`, `plugin-runtime.js`, `app.css` (`?v=384`), IndexedDB v7. `index.html` hanya 2 string versi SW (**+0 baris**; `HOST_1D0_EXTRA` tetap 162).
- **Kontrak 1c yang wajib dipakai, tidak ditulis ulang:**
  - `TLSched.readSched/spanOf/modeOf/unitFor/unitOf/actualOf/cutName`;
  - `TLCal.nextWork/isWork/dn/iso/fmtShort`;
  - `TLCpm.cmpKey`;
  - `TLLayout.windowDays/xOf/dnAt/widthOf`;
  - `usePref`, `useEngine`, `recordEvent`, `unitCaption` (pola nama), `MoreMenu`, `toastSafe`.
- **String UI (persis, diperiksa tes):**
  - "Beban Tim"
  - "Beban Tim · {n} hari kelebihan beban"
  - "{n} task belum dijadwalkan"
  - "{n} task bertarget bawaan 1 🍅"
  - "Belum ditugaskan"
  - "Anggota #{id}"
  - "Kapasitas"
  - "🍅/hari"
  - "8 🍅 ≈ 3 jam 20 menit fokus"
  - "Cuti"
  - "Tambah cuti"
  - "Kapasitas {nama} disimpan"
  - "Diubah oleh {nama} · {tgl}"
  - "Diubah oleh anggota lain · {tgl}"
  - "Menunggu data workspace…"
  - "Data berubah sejak dialog dibuka — muat ulang"
  - "Bisa digeser — {nama}, {tgl}"
  - "Tidak ada task yang bisa digeser tanpa menggeser jalur kritis"
  - "Hari kelebihan beban"
  - "terlambat"
  - "Kritis"
  - "Manual"
  - "Sudah mulai"
  - "{judul} · {n} 🍅 hari ini · slack {s} hk"
  - tooltip "{nama} · {tgl}: {beban} dari {kapasitas} 🍅 (~{jam} jam)"
  - catatan P3
- **Rilis:** SW berikutnya diperkirakan **`taskflow-v501-beban-tim`** (cek ulang terhadap `main` saat merge); whatsnew **non-silent** dengan teks dari P1.
- PR dibuka sebagai **DRAFT**. Merge hanya atas "merge dan deploy". Deploy statis, **tanpa restart**.

## Review Focus

1. **Nol tulisan latar:** buka/tutup panel, hitung beban, saran, `sync.done`, `pulled`, `onChange` record `resource` dari perangkat lain, `app.dayChanged` → 0 `taskExt.set/setMany` dan 0 `records.put`. Record `resource` yang belum ada tidak pernah dibuat otomatis. → T2 (spy + pagar), T9.
2. **Beban = bar:** distribusi memakai tanggal tersimpan yang sama dengan `row.span` (R1), termasuk task drift, task Manual, task berjalan dengan `actual.start`, dan task terlambat (semua sisa jatuh di T). → T1.
3. **Determinisme dan jumlah tepat:** Σ beban per task = sisa × 1000 persis; hasil identik untuk 50 urutan acak; tanpa `Date`/`localeCompare`. → T1.
4. **CAS dan kunci perangkat baru:** dua anggota mengedit orang yang sama → yang kedua ditolak "Data berubah…" (0 tulis); perangkat baru sebelum tarik pertama → Simpan terkunci. → T2, T7, E2E.
5. **Anggaran:** panel tertutup = 0 run `TLLoad`; 500 task / 400 dependensi / 10 orang ≤ 150 ms Node (target ≤ 20 ms CPU 4× di E2E); DOM ≤ 1.500 dengan panel terbuka di tiga zoom. → T1, T5, T9, E2E.

---

### Task 1: `load.js` — mesin beban + saran (murni)

**Files:**
- Create: `static/plugins/timeline/load.js` (UMD `TLLoad`, pola `plan.js`), `tests/offline/timeline_load.test.js`
- Modify: `tests/test_plugins_node.py` (REQUIRED + `timeline_load`)

**Interfaces (Produces `TLLoad`):**
- `EST_MAX = 99`, `DEFAULT_CAP = 8`, `CAP_MAX = 40`, `MILLI = 1000`.
- `resourceDecode(data) → {capacity, leave: [{from: dn, to: dn, note}]}`:
  - `v ≠ 1` atau bukan objek → `{capacity: 8, leave: []}`;
  - `capacity` bukan bilangan bulat 0–40 → 8;
  - entri `leave` rusak dilewati;
  - `note` dipotong 60 code point (sadar surrogate).
- `resourceEncode({capacity, leave}, meta: {by}) → data` dengan aturan normalisasi R9. Juga `resourceByteSize`.
- `run({tasks, cal, readExt, result, units, people, pageKind, ownerUid, D}) → Load`:
  - `people` = `[{uid, name, res}]` (res terdekode atau `null`).
  - Keluaran:
    - `rows: [{uid|null, name, capacity|null, days: Map<dn, {load, cap, leave, parts: [{key, share, late}]}>, overDays: dn[], total}]`
    - `unscheduled`, `recurring`, `defaultTarget`, `counted`, `lateCount`, `T`
  - Aturan per task (R1–R3, R8, K46–K49):
    - hidup + bukan berulang (berulang → `recurring++`) + bukan ringkasan;
    - selesai / milestone / sisa 0 → nol beban;
    - `spanOf` null atau jendela tanpa hari kerja → `unscheduled++`;
    - `f < T` → seluruh sisa di T, `late`.
  - Penanggung jawab:
    - workspace: `assigned_to` sah → uid, selain itu baris `null` "Belum ditugaskan";
    - pribadi: `ownerUid`.
  - `cap(dn)` = 0 bila `!isWork` atau cuti; selain itu `capacity`. Baris `null` tanpa kapasitas, tidak pernah merah.
  - Urutan baris: nama (`cmpKey`) lalu uid, "Belum ditugaskan" terakhir.
  - Orang tanpa task tetap jadi baris bila ada di `people`.
- `suggest(load, uid, dn, ctx: {result, units, readExt, tasks}) → [{key, task, share, slack, kind}]` (R6).
- `fmtPomo(milli) → string` (bulat 0,5, titik desimal); `hoursLabel(pomo) → string` (format host).

- [ ] **Step 1: Tulis tes gagal** (nama Indonesia), mencakup:
  - distribusi rata 10 🍅 / 4 hk = 2500 milli per hari, dan 10 / 3 → 3334, 3333, 3333 (jumlah 10000);
  - libur nasional dan SKB, akhir pekan, serta cuti: beban tetap jatuh di hari cuti, kapasitas 0, merah;
  - terlambat → T, `late`, dan `lateCount`;
  - jendela dimulai di `maks(T, s)`, termasuk task berjalan dengan `actual.start`;
  - nol beban untuk milestone, selesai, sisa 0, dan `pomodoros_done` > target;
  - berulang dan ringkasan dikecualikan dengan hitungannya;
  - tanpa jadwal → `unscheduled`;
  - `TL_CAL_LOOP` → `unscheduled` tanpa lempar;
  - "Belum ditugaskan", nama tak dikenal "Anggota #7", halaman pribadi satu baris;
  - **R1:** task otomatis drift → beban di tanggal tersimpan (bandingkan dengan `TLLayout.layout(...).rows[i].span`);
  - determinisme 50 acakan;
  - kinerja 500/400/10 ≤ 150 ms;
  - urutan `suggest` (R6), termasuk project Manual yang tetap punya `free`;
  - `resourceDecode`/`Encode` (gabung tumpang tindih, ≤ 50, potong catatan bersurrogate, kapasitas di luar batas);
  - tes silang `EST_MAX` = `pomologic.js`; `hoursLabel` = `pomologic.estimateHoursLabel` untuk 1..99;
  - tanpa `Date(` / `Date.parse` / `localeCompare` di sumber.
- [ ] **Step 2: FAIL. Step 3: Implementasi** (murni, tanpa global selain TLCal/TLSched/TLCpm). **Step 4: PASS**, lalu `npm test` penuh.
- [ ] **Step 5: Commit** `feat(timeline): mesin Beban Tim — distribusi 🍅, kapasitas/cuti, saran leveling`

### Task 2: Manifest 1.3.0 + `resourceStore` + `useResources` + pagar

**Files:**
- Modify:
  - `static/plugins/timeline/manifest.json`: version `1.3.0`; `records.resource` `{conflict: "lww", maxBytes: 4096}`; parts + `load.js` setelah `plan.js`; `taskExt.keys` tidak berubah.
  - `plugin.jsx`, `tests/offline/timeline_ui.test.js`, `tests/build-plugins.test.js`, `tests/offline/timeline_runtime.test.js`, `tests/test_plugin_timeline_records.py`.
- Generated: `plugin.js`, `static/plugins/index.json`, blok hash `static/sw.js`.

**Interfaces (Produces):**
- `resRecId(pageKind, listId, uid)`:
  - workspace → `res@list:<lid>:<uid>`, scope `list:<lid>`;
  - pribadi → `res@user:<uid>`, scope `user`;
  - lainnya → lempar `INVALID`.
- `resourceStore(api)`:
  - `loadScope(scope) → Map<uid, {res, snap: {exists, updatedAt, by}, pending}>` — paged `records.list("resource", {scope, limit: 1000, after})`; id asing/rusak dilewati;
  - `save(target, value, snap)` → di dalam fungsi **`saveResource`** (satu-satunya `records.put`): CAS `records.get` → potret beda → lempar `STALE` (pesan "Data berubah sejak dialog dibuka — muat ulang"); encode R9; > 4.096 → lempar `TOO_LARGE`;
  - `subscribe(fn)` lewat `recordEvent(ev, "resource")`.
- `useResources(api, pageKind, listId, open)`: memuat hanya saat `open`; muat ulang pada `onChange` resource dan `pulled`; latch `pulled` (pola `useCalendar`); mengembalikan `{map, pulled, loaded}`.
- Pagar: `FENCE_ALLOW` + `saveResource`; pin + `"saveResource:records.put": 1`; uji-diri pagar + satu pelanggaran sintetis (`function useResources(api){ React.useEffect(() => api.records.put('resource', …)) }`).

- [ ] **Step 1: Tulis tes gagal:**
  - build: 1.3.0, deklarasi resource, parts berurutan, hash berubah, dua build stabil;
  - pytest: deklarasi `resource` diterima, PUT `res@list:<lid>:<uid>` oleh anggota → 200, ukuran > 4.096 → ditolak;
  - `loadScope` dua halaman `next`;
  - CAS: potret beda → `STALE`, 0 `put`;
  - encode di jalur simpan;
  - `resRecId` tiga kasus;
  - spy R25: mount/sync.done/pulled/onChange resource/app.dayChanged dengan panel terbuka → 0 tulis;
  - pagar AST + pin.
- [ ] **Step 2: FAIL. Step 3: Implementasi**, lalu `node compile.js --plugins-only`. **Step 4: PASS**; `python3 -m pytest tests/test_plugins_node.py tests/test_sw_precache_node.py tests/test_plugin_timeline_records.py -q`.
- [ ] **Step 5: Commit** `feat(timeline): manifest 1.3.0, record resource, resourceStore ber-CAS`

### Task 3: `useLoad` + daftar orang (R4) + pref panel

**Files:** Modify `plugin.jsx`, `tests/offline/timeline_ui.test.js`

**Interfaces:**
- `PREF_DEFAULTS.load = false` (pref `load:<page>`).
- `peopleOf({pageKind, ctxTasks, resources, currentUser, collaborators, userId}) → [{uid, name, res}]` (R4 / P2 (a)).
- `useLoad({open, eng, people, todayDn, pageKind, ownerUid}) → Load|null`: `useMemo` dengan kunci `[open, eng.result, eng.ctx, peopleKey, todayDn]`; `null` bila `!open` atau mesin belum siap.

- [ ] **Step 1: Tulis tes gagal:**
  - panel tertutup → 0 panggilan `TLLoad.run` (spy) meski mesin siap;
  - buka → tepat 1 run setelah hasil mesin; rerender tanpa perubahan data → 0 run tambahan; ganti hari (`todayDn`) → 1 run;
  - `peopleOf`: pengguna aktif + penanggung jawab + pemilik record, nama dari collaborators, tak dikenal → "Anggota #id", pribadi = satu baris;
  - pref round-trip `load:<page>`.
- [ ] **Step 2–4:** FAIL → implementasi → PASS; build. **Step 5: Commit** `feat(timeline): beban dihitung hanya saat panel terbuka`

### Task 4: Toolbar — tombol "Beban Tim"

**Files:** Modify `plugin.jsx`, `style.css`, `tests/offline/timeline_ui.test.js`

- [ ] **Step 1: Tulis tes gagal:**
  - urutan extras: … Jalur kritis · **Beban Tim** · Baseline · Simpan baseline · Jadwalkan ulang;
  - `aria-pressed` mengikuti pref;
  - tidak tampil sebelum mesin siap;
  - di ≤ 640 px / Live Edit masuk "Lainnya" sebagai `menuitemcheckbox`;
  - tampil juga di mode Daftar HP.
- [ ] **Step 2–4.** **Step 5: Commit** `feat(timeline): tombol Beban Tim di toolbar`

### Task 5: Panel histogram (desktop)

**Files:** Modify `plugin.jsx` (komponen `LoadPanel` di bawah `.plg-timeline-scroll`, sebelum legenda), `style.css`, `tests/offline/timeline_ui.test.js`

**Interfaces:** Consumes T1–T4, `dw`, `tableW`, `lay.range`, `lay.px`, `scrollRef`. Produces render sesuai R5:
- judul "Beban Tim · {n} hari kelebihan beban" (+ "· {m} task belum dijadwalkan", + "· {k} task bertarget bawaan 1 🍅" bila k > 25 % dari `counted`, + catatan P3 untuk halaman pribadi);
- kolom kiri "{nama} · {cap} 🍅/hari" sebagai tombol yang membuka editor (T7). Baris "Belum ditugaskan" tanpa kapasitas, bukan tombol;
- `<svg>` per baris; tombol hari merah (`aria-label` = tooltip); readout hover;
- `translateX` sinkron dengan gulir utama; ≤ 10 baris terlihat.

- [ ] **Step 1: Tulis tes gagal:**
  - path dan tombol hanya untuk hari merah di jendela;
  - teks judul dan tooltip persis;
  - translateX berubah saat `onScroll` tanpa render ulang `LoadPanel` (spy render);
  - DOM panel ≤ 300 elemen untuk 10 orang × zoom hari/minggu/bulan;
  - DOM total 500/400 + crit + baseline + panel ≤ 1.500;
  - catatan bertarget bawaan;
  - lint plugin (tanpa hex; kelas `.plg-timeline-load-*`).
- [ ] **Step 2–4.** **Step 5: Commit** `feat(timeline): panel Beban Tim — histogram per orang di bawah Gantt`

### Task 6: Popover saran + `revealRow`

**Files:** Modify `plugin.jsx`, `style.css`, `tests/offline/timeline_ui.test.js`

- [ ] **Step 1: Tulis tes gagal:**
  - klik tombol hari merah → popover "Bisa digeser — {nama}, {tgl}" berisi baris persis "{judul} · {n} 🍅 hari ini · slack {s} hk" untuk `free`, dan label "Kritis"/"Manual"/"Sudah mulai"/"terlambat" untuk lainnya, dengan urutan R6;
  - tanpa `free` → "Tidak ada task yang bisa digeser tanpa menggeser jalur kritis";
  - klik baris → `revealRow`: scrollTop/scrollLeft disetel + `is-flash` 1,5 detik;
  - task tersaring panel → `context.onTaskClick`;
  - 0 tulis;
  - Esc/fokus kembali ke tombol hari (pola popover 1c).
- [ ] **Step 2–4.** **Step 5: Commit** `feat(timeline): saran leveling manual dari hari kelebihan beban`

### Task 7: Editor kapasitas/cuti

**Files:** Modify `plugin.jsx`, `style.css`, `tests/offline/timeline_ui.test.js`

**Interfaces:** popover dari nama baris berisi:
- "Kapasitas" (input angka 0–40, "🍅/hari", petunjuk "8 🍅 ≈ 3 jam 20 menit fokus");
- daftar "Cuti" (dari–sampai `input type=date`, catatan, hapus) dan "Tambah cuti";
- Simpan/Batal;
- keterangan "Diubah oleh {nama} · {tgl}" (record ada) atau "Diubah oleh anggota lain · {tgl}";
- kunci "Menunggu data workspace…" (R9);
- sukses → toast "Kapasitas {nama} disimpan";
- `STALE` → toast/teks "Data berubah sejak dialog dibuka — muat ulang" lalu muat ulang potret;
- potret CAS diambil saat popover dibuka.

- [ ] **Step 1: Tulis tes gagal:**
  - Batal / Esc / tutup → 0 tulis; Simpan → tepat 1 `records.put` dengan data ter-normalisasi;
  - validasi `from > to` → Simpan nonaktif dan pesan inline;
  - perangkat baru workspace → Simpan nonaktif + teks kunci; setelah `pulled` aktif; pribadi tidak terkunci;
  - CAS beda → 0 `put` + pesan;
  - "Diubah oleh" dari currentUser/collaborators;
  - beban dan merah ikut berubah setelah simpan (onChange lokal);
  - semua anggota boleh mengedit baris siapa pun (Q4 (a)).
- [ ] **Step 2–4.** **Step 5: Commit** `feat(timeline): atur kapasitas dan cuti anggota`

### Task 8: HP — daftar "Hari kelebihan beban"

**Files:** Modify `plugin.jsx`, `style.css`, `tests/offline/timeline_ui.test.js`

- [ ] **Step 1: Tulis tes gagal:**
  - ≤ 640 px (Gantt maupun Daftar) dengan panel ON → daftar "Hari kelebihan beban" (anggota · tanggal · beban/kapasitas), urut tanggal lalu nama, tanpa SVG;
  - ketuk → popover saran (T6);
  - nama → editor (T7);
  - kosong → "Beban Tim · 0 hari kelebihan beban" tanpa daftar;
  - 375 px tanpa gulir horizontal (pola tes HP 1c).
- [ ] **Step 2–4.** **Step 5: Commit** `feat(timeline): Beban Tim versi HP — daftar hari kelebihan beban`

### Task 9: Integrasi runtime + anggaran (tes saja)

**Files:** Modify `tests/offline/timeline_runtime.test.js`, `tests/offline/timeline_ui.test.js`

- [ ] **Step 1: Tulis tes** (catat merah/hijau-langsung per tes):
  - `index.json` 1.3.0, `records.resource` tersalin, parts memuat `load.js`;
  - `api.records` nyata: `put res@list:12:7` → pending + op outbox; > 4.096 ditolak sisi klien;
  - `onChange` resource dari sync → panel memuat ulang, 0 tulis;
  - render awal (panel pref ON) tetap tanpa `TLCpm.run`/`TLLoad.run` sebelum frame pertama (pola R24);
  - DOM 500/400/10 orang ≤ 1.500.
- [ ] **Step 2–4:** jalankan; bug produk → BLOCKED. `npm test` penuh + `python3 -m pytest tests/ -q` penuh.
- [ ] **Step 5: Commit** `test(timeline): integrasi runtime 1.3 — record resource, anggaran Beban Tim`

### Task 10: Rilis — SW v501, whatsnew (P1), README, ADR-048

**Files:** Modify `static/sw.js`, `static/index.html` (2 string versi), berkas bervers lama (ganti massal **kecuali** `static/whatsnew.json`), `static/whatsnew.json`, `docs/plugins/README.md`, `.agents/DECISIONS.md`

- [ ] **Step 1:** versi berikutnya setelah v500 (perkiraan `taskflow-v501-beban-tim`), PROTOCOL §4 lengkap. `app.css?v=384` tetap.
- [ ] **Step 2:** entri whatsnew teratas, non-silent, tanggal rilis WIB, teks = **P1**.
- [ ] **Step 3:** README:
  - judul "(Fase 0a–1d-1)";
  - §5 contoh record `resource` (id, scope, kunci simpan, CAS);
  - §6.2 koreksi `collaborators` (semua rekan dari semua workspace, tanpa diri sendiri) + paragraf "Timeline 1.3 (Beban Tim)";
  - §8: Beban Tim hanya menghitung, satu-satunya tulisan `saveResource` atas Simpan.
- [ ] **Step 4:** ADR-048 "Timeline 1.3: Beban Tim dari tanggal yang digambar, tanpa tulisan latar" (isi R12).
- [ ] **Step 5:** verifikasi PROTOCOL §4 butir 5 + `npm test` + pytest penuh + `node compile.js` idempoten + `index.html` 46.236 baris.
- [ ] **Step 6: Commit** `chore(release): SW v501 Timeline 1.3 Beban Tim, README, ADR-048`

### Task 11: E2E + verifikasi akhir + handover + review akhir + PR draft

**Files:**
- Create: `temporary_files/e2e_plugin_fase1_1d1.py` (pola `e2e_plugin_fase1_1c2.py` dan `e2e_plugin_fase1_1d0.py`; klien lama dipatok SHA merge 1d-0 `ebf829c`)
- Modify: spec (catatan implementasi 1d-1), `.agents/CURRENT_STATE.md`, `.agents/SESSION_LOG.md`

**Skenario E2E minimum:**
1. Nol tulisan latar: buka/tutup panel, dua siklus sinkron, ganti hari, perubahan record dari perangkat lain.
2. Dua anggota: A mengubah kapasitas B jadi 4 → B tarik → panel B sama; CAS: A dan B membuka editor yang sama, A simpan, B simpan → B ditolak, 0 tulis.
3. Perangkat baru (konteks bersih, belum tarik) → Simpan terkunci "Menunggu data workspace…" lalu terbuka setelah tarik.
4. Cuti → hari merah → popover saran → klik → bar tergulir dan berkedip → seret bar keluar dari cuti → merah hilang.
5. Beban mengikuti bar: task otomatis drift + task Manual + task terlambat + task berjalan (nilai sel = perhitungan manual).
6. Filter panel menyembunyikan task → beban tetap terhitung; klik saran task tersaring → detail terbuka.
7. Halaman project pribadi (satu baris + catatan P3) dan workspace multi-project.
8. Klien 1.2 (dipatok `ebf829c`) + record `resource` di server → tidak crash, 0 tulis, record utuh.
9. 375 px + Sakura gelap (daftar HP), 1280 px terang (histogram, tiga zoom).
10. Kinerja: `TLLoad.run` 500/400/10 ≤ 20 ms CPU 4×, DOM ≤ 1.500.
11. Regresi: `1d0.py`, `1c2.py`, `1c1.py`, `1c0b.py`, `1c0.py`, `1b.py`, `1a2.py`, `1a1.py`, `0b.py` (0a = flake pra-ada terdokumentasi).

- [ ] **Step 1:** skrip + jalankan semua cek (catat N/N dan angka), lalu regresi.
- [ ] **Step 2:** verifikasi akhir penuh (pola 1c-2 Task 12). Diff terhadap `main`: `static/offline`, `webapp.py`, `plugin_records.py`, `plugin-runtime.js`, `app.css` **tidak berubah**; `index.html` hanya string versi.
- [ ] **Step 3:** catatan implementasi di spec; handover CURRENT_STATE/SESSION_LOG; commit `docs(agents): handover PR 1d-1 Timeline Beban Tim`.
- [ ] **Step 4:** review akhir seluruh branch oleh reviewer terpisah (Review Focus 1–5 + ledger). Perbaiki temuan wajib, lalu ulangi Step 2.
- [ ] **Step 5:** push + PR DRAFT `Plugin Fase 1 — PR 1d-1: Timeline 1.3 (Beban Tim)`. Badan PR: ringkasan, tangkapan, tabel berkas, deploy statis tanpa restart, rollback R11, angka tes/E2E. Merge hanya atas "merge dan deploy".

---

## Keputusan untuk pemilik (sebelum Task 3)

| # | Pertanyaan | Pilihan | Rekomendasi |
|---|---|---|---|
| **P1** | **Teks "Apa yang baru"** v501 | (a) setujui usulan apa adanya; (b) ubah | **(a)** — judul **"Timeline: Beban Tim"**; poin `new`: "Lihat beban 🍅 tiap orang per hari di bawah Gantt — hari yang melebihi kapasitas tampil merah.", "Klik hari merah untuk melihat task mana yang paling aman digeser.", "Atur kapasitas harian dan cuti tiap anggota langsung dari panel Beban Tim." |
| **P2** | **Siapa saja yang tampil sebagai baris?** Timeline tidak bisa membaca daftar anggota workspace: data "rekan" yang tersedia berisi orang dari semua workspace-mu, dan daftar anggota per workspace tidak tersimpan untuk offline. | (a) **dari data yang sudah ada:** kamu + setiap orang yang punya task di workspace ini + siapa pun yang kapasitas/cutinya pernah diatur di sini. Anggota yang belum punya task baru muncul setelah diberi task. Penanda "(bukan anggota)" dihapus karena tidak bisa dipastikan. Tanpa perubahan aplikasi inti; (b) **perubahan aplikasi inti dulu:** host menyimpan daftar anggota tiap workspace (juga untuk offline) dan memberikannya ke Timeline. Semua anggota tampil sejak awal dan "(bukan anggota)" akurat, tetapi butuh PR host terpisah sebelum 1d-1. | **(a)** — yang perlu diatur di Beban Tim adalah orang yang memang punya pekerjaan. Cuti seseorang yang belum punya task tidak memengaruhi apa pun sampai ia diberi task. (b) menunda 1d-1 untuk manfaat kecil. |
| **P3** | **Catatan beban parsial.** Spec menyebut "halaman project di dalam workspace", padahal halaman project di Alurik selalu project **pribadi** (project workspace hanya tampil sebagai kelompok di halaman workspace). | (a) halaman project pribadi menampilkan **"Hanya beban dari project ini"** (tanpa "buka halaman workspace…", karena tidak ada halaman berisi beban lengkapmu); halaman workspace tanpa catatan; (b) tanpa catatan sama sekali | **(a)** — tetap jujur bahwa task pribadi di project lain dan task workspace tidak dihitung, tanpa menyuruh membuka halaman yang tidak menjawabnya. |

**Koreksi spec yang disahkan rencana ini (tanpa pertanyaan, dicatat di ADR-048):**
- Beban mengikuti tanggal yang digambar bar Gantt (tanggal tersimpan), bukan hasil hitung mesin. Spec menulis "ES/EF mesin untuk task otomatis", padahal Gantt tidak menggambar itu (R1).
- Satu halaman memakai satu kalender, sehingga aturan "beberapa kalender unit" tidak berlaku (R2).
- Di project Manual saran leveling tetap diurutkan menurut slack (R6).
