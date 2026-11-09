# Spec turunan: Sistem Plugin Alurik — Fase 1, PR 1d (Timeline: Beban Tim, earned value 🍅, ekspor MSPDI)

- **Status:** disetujui pemilik 2026-11-06 08.51 WIB — Q1–Q7 semuanya (a) (lihat §13). Rencana per PR: 1d-0 `docs/superpowers/plans/2026-11-06-plugin-fase1-pr-1d-0.md`; 1d-1 dan 1d-2 ditulis setelah PR sebelumnya di-merge.
- **Tanggal:** 2026-11-06
- **Agent:** Claude (Opus 5.5)
- **Spec induk:** `docs/superpowers/specs/2026-10-31-plugin-fase1-timeline-design.md` (salinan Project `claude/spec-plugin-fase1-timeline-2026-10-31.md`; disetujui pemilik 2026-10-31) — terutama §2 K15 (record `resource`, kunci `split`), **§9 "Garis besar 1c dan 1d"**, §13 (anggaran baris). Spec saudara: `docs/superpowers/specs/2026-11-01-plugin-fase1-1c-otomatis-design.md` (K22–K44 + catatan implementasi 1c-0…1c-2). Spec ini melanjutkan penomoran keputusan (**K45–K59**); K1–K44 tetap berlaku kecuali disebut lain.
- **Basis kode:** `main` @ `09518260` (setelah #127 1c-2; SW `taskflow-v499-baseline-aktual`, IndexedDB `taskflow-offline` v7, `index.html` 46.074 baris, `plugin-runtime.js` 1.704). Plugin `timeline` 1.2.0: `plugin.jsx` 5.717, `schedule.js` 651, `cpm.js` 535, `plan.js` 568, `layout.js` 643, `calendar.js` 250, `style.css` 1.935; record `calendar`/`project`/`baseline`; kunci ext `start, duration, deps, mode, constraint, actual`.
- **Sumber lain:** ADR-040…ADR-046 `.agents/DECISIONS.md`; `docs/plugins/README.md` §5–§8; rencana 1c-1/1c-2 (`docs/superpowers/plans/2026-11-0{1,5}-plugin-fase1-pr-1c-{1,2}.md`).
- **Istilah** (tambahan atas induk dan 1c):
  - *anggota* = pengguna di `list_members` workspace; di halaman project pribadi hanya pemilik;
  - *penanggung jawab* = `assigned_to` task (workspace) atau pemilik (pribadi);
  - *target* = `estimated_pomodoros` host; *sisa* = maks(0, target − `pomodoros_done`);
  - *beban harian* = 🍅 terjadwal untuk satu anggota pada satu hari kerja; *kapasitas* = 🍅/hari yang sanggup dikerjakan anggota; *kelebihan beban* = beban > kapasitas;
  - *PV / EV / AC* = nilai terencana / nilai yang diperoleh / biaya aktual, semuanya dalam 🍅; *SPI* = EV ÷ PV (kinerja jadwal), *CPI* = EV ÷ AC (efisiensi 🍅);
  - *D* = `api.env.today()` (hari ini Asia/Jakarta, bilangan hari K16); *T* = `nextWork(D)` seperti 1c.

---

## 1. Ringkasan

1d menutup Fase 1. Timeline kini bisa menjawab tiga pertanyaan yang belum terjawab:

1. **"Siapa yang kebanyakan kerja minggu depan?"** — panel **Beban Tim**: histogram 🍅 terjadwal per anggota per hari dibanding kapasitasnya; hari yang melebihi kapasitas merah; cuti mengosongkan kapasitas. Penyelesaiannya **manual**: daftar saran task mana yang bisa digeser (slack terbesar dulu), pengguna yang menggeser.
2. **"Project ini lebih cepat atau lebih lambat, lebih hemat atau lebih boros dari rencana?"** — **earned value 🍅** dari baseline aktif (1c-2): ringkasan kinerja jadwal (SPI) dan efisiensi 🍅 (CPI).
3. **"Bisa dibuka di Microsoft Project?"** — **ekspor MSPDI XML** dibangun sepenuhnya di klien (bisa offline).

Seperti 1c, semuanya dihitung di klien; prinsip pengaman tetap: **mesin hanya menghitung, tidak pernah menulis sendiri** (K27, R25). Satu-satunya tulisan baru adalah kapasitas/cuti yang disimpan pengguna sendiri.

Diusulkan **tiga PR** (§3, Q1): **1d-0** perubahan host kecil — batas target 🍅 dinaikkan (hanya bila Q2 (a)); **1d-1** Timeline 1.3 — Beban Tim; **1d-2** Timeline 1.4 — earned value + ekspor. Split task (`timeline.split`, spec induk §9) diusulkan **ditunda** (Q5).

**Kriteria berhasil**

1. **Tanpa tulisan latar.** Membuka/menutup panel, menghitung beban/EV, mengekspor, `sync.done`, `pulled`, `app.dayChanged`, dan perubahan record `resource` dari perangkat lain **tidak** memanggil `api.taskExt.set/setMany` maupun `api.records.put` (tes spy = 0). Record `resource` yang belum ada **tidak** dibuat otomatis.
2. **Beban benar dan deterministik.** Sisa target dibagi rata ke hari kerja tersisa jendela task (§5.1) memakai tanggal yang sama dengan yang digambar Gantt (hasil mesin + jangkar aktual); kalender unit, libur, cuti, task terlambat, milestone, task selesai, task berulang, dan task tanpa penanggung jawab ditangani sesuai §5.1/§8; hasil identik untuk 50 urutan masukan acak (tes Node).
3. **Leveling manual tanpa tulisan.** Sel merah membuka daftar kontributor diurut slack; klik memilih dan menggulir ke bar; tidak ada tombol "geser otomatis".
4. **Earned value** tampil hanya bila baseline aktif ada dan bermuatan; angka sama di semua perangkat yang memilih baseline yang sama (tes fixture PV/EV/AC/SPI/CPI).
5. **Ekspor MSPDI** menghasilkan XML yang terbuka di Microsoft Project / ProjectLibre dengan struktur WBS, tanggal, durasi, milestone, % selesai, batasan, empat tipe dependensi + lag, kalender + libur, baseline, anggota dan penugasan (tes struktur otomatis + **satu kali dibuka pemilik** di aplikasi sungguhan sebelum merge 1d-2).
6. **Kinerja:** 500 task + 400 dependensi + 10 anggota — hitung beban + EV ≤ 20 ms pada CPU 4×, dijalankan **setelah** gambar pertama dan **hanya** saat panel terbuka; panel tertutup = nol biaya render awal; DOM ≤ 1.500 elemen dengan panel terbuka (10 anggota × 90 hari terlihat).
7. **Kompatibel ke belakang.** Klien 1.2 mengabaikan record `resource` tanpa menghapusnya; rollback tanpa kehilangan data.
8. **Batas ukuran:** 1d-1 dan 1d-2: `index.html` **+0 baris** (hanya string versi SW), `app.css` tidak berubah, IndexedDB tetap v7, server tidak berubah. 1d-0 (bila ada): perubahan host terkecil yang menaikkan batas (§3).

## 2. Keputusan

| # | Keputusan | Alasan |
|---|---|---|
| K45 | **Satuan beban = 🍅** dari target host (`estimated_pomodoros`) dan `pomodoros_done` (K15). Jam hanya label tooltip: 1 🍅 = 25 menit fokus (`pomologic.POMO_SECONDS`). | Menggandakan "kerja" di ext membuat dua sumber kebenaran (alasan K15). 🍅 adalah bahasa Alurik sehari-hari (Target 🍅, Fokus). |
| K46 | **Distribusi beban:** sisa task dibagi **rata** ke hari kerja dalam jendela `[maks(T, mulai), selesai]` menurut kalender unit task. *Mulai/selesai* = tanggal yang digambar Gantt (ES/EF mesin untuk task otomatis, tersimpan untuk Manual, jangkar aktual 1c-2). Task **terlambat** (selesai < T, belum selesai) → seluruh sisa jatuh di T dan ditandai "terlambat". **Nol beban**: milestone, task selesai, sisa 0. **Dikecualikan dan dihitung terpisah**: task tanpa jadwal ("{n} task belum dijadwalkan"), task berulang (R8). Beban pecahan disimpan presisi penuh, ditampilkan dibulatkan ke 0,5. | Pembagian rata adalah kurva bawaan Microsoft Project ("flat contour") dan cukup untuk tujuan leveling; kurva lain menambah kontrol tanpa manfaat jelas. Menumpuk sisa task terlambat di hari ini membuat kelebihan beban "sekarang" terlihat — memang itu yang harus diselesaikan. |
| K47 | **Kapasitas bawaan 8 🍅/hari** per anggota (bilangan bulat 0–40). Akhir pekan/libur kalender unit = kapasitas 0 dan beban tidak pernah jatuh di sana (jendela K46 hanya hari kerja). **Cuti** = kapasitas 0, tetapi beban **tetap** jatuh di hari cuti (mesin jadwal tidak mengenal cuti) sehingga tampil merah. | Cuti yang tampil sebagai merah adalah sinyal leveling yang jujur: task harus digeser atau dialihkan. Membuat mesin CPM sadar kalender per orang (resource calendar) mengubah K16–K44 dan seluruh aliran 1c — di luar cakupan. |
| K48 | **Record `resource`** per anggota per workspace: id `res@list:<listId>:<userId>`, scope `list:<listId>`; halaman pribadi: `res@user:<userId>`, scope `user`. Data `{v: 1, capacity, leave: [{from, to, note}], by, updatedAt}`, ≤ 4 KB, `conflict: "lww"`. Record **absen** = kapasitas 8 tanpa cuti — tidak pernah dibuat otomatis. | Satu record per orang: dua anggota yang mengedit orang berbeda tidak saling timpa; pola id/scope sama dengan `project`/`baseline` (`ID_RE`/`SCOPE_RE` `plugin_records.py:37–38`). |
| K49 | **Baris penanggung jawab:** workspace → `assigned_to`; kosong → baris **"Belum ditugaskan"** (tanpa kapasitas, tidak pernah merah, jumlah 🍅-nya tetap tampil); ditugaskan ke pengguna yang **bukan anggota lagi** → baris namanya + "(bukan anggota)", kapasitas bawaan. Halaman pribadi → satu baris pemilik. Halaman **project** di dalam workspace → beban dari project itu saja + catatan "Hanya beban dari project ini — buka halaman workspace untuk beban lengkap". | Beban sebenarnya seseorang adalah gabungan semua project workspace; halaman project memperlihatkan sebagian dan harus jujur soal itu. |
| K50 | **Leveling manual:** sel merah (anggota, hari) → popover "Bisa digeser": kontributor hari itu diurut **slack terbesar dulu** (slack > 0), lalu task kritis/jangkar dengan label ("Kritis", "Manual", "Sudah mulai"); tiap baris "{judul} · {n} 🍅 hari ini · slack {s} hk"; klik = pilih + gulir ke bar di Gantt. **Tanpa** tulisan, tanpa tombol geser otomatis. | Spec induk §9. Geser otomatis = tulisan yang tidak diminta per baris (R25); pengguna sudah punya gestur seret + aliran hilir 1c. |
| K51 | **Earned value 🍅** dari **baseline aktif** perangkat ini (1c-2 P2 (a)), hanya bila ada ≥ 1 baris baseline dengan target `w` > 0. Per baris baseline (s, f, d, w): **BAC** = Σ w; **PV(D)** = Σ w × (hari kerja baseline `s..min(f, D)` ÷ hari kerja `s..f`), milestone: w bila D ≥ s; **EV** = Σ w × % selesai sekarang (task selesai = 100 %); **AC** = Σ `pomodoros_done` task yang sama; **SPI** = EV ÷ PV, **CPI** = EV ÷ AC (penyebut 0 → "—"). Task di luar baseline tidak dihitung, jumlahnya tampil ("{n} task di luar baseline"). Kalender = kalender unit saat ini. | Rumus EVM baku dengan 🍅 sebagai satuan biaya. Baseline 1c-2 sudah menyimpan `w` = target saat baseline disimpan (`plan.js:483`), jadi tidak perlu data baru. |
| K52 | **Hidrasi `pomodoro_log` ke IndexedDB tidak dikerjakan.** AC memakai total `pomodoros_done`; kurva S harian (PV/EV/AC per hari) di luar cakupan. | Spec induk §9 menyebut hidrasi sebagai prasyarat *split dari log 🍅*; dengan split ditunda (Q5) dan AC berupa total, hidrasi tidak diperlukan. Menghindari bump IndexedDB dan PR host besar. |
| K53 | **Ekspor MSPDI** (XML Microsoft Project 2003+), dibangun murni di klien oleh `mspdi.js` dari hasil mesin: kalender unit (hari kerja + libur sebagai `Exceptions`), task urut WBS (`OutlineLevel`/`OutlineNumber` dari `wbsMap`; induk = task ringkasan), `Start`/`Finish` 08:00–17:00 (480 menit/hari), `Duration` `PT{d×8}H0M0S`, milestone, `PercentComplete`, batasan (ASAP 0 / SNET 4 / MFO 3 + `ConstraintDate`), dependensi `PredecessorLink` (`Type` FF 0 / FS 1 / SF 2 / SS 3; `LinkLag` = lag × 4.800 [persepuluh menit]; `LagFormat` 7), `Baseline` nomor 0 dari baseline aktif, `Resource` per anggota, `Assignment` dengan `Work` = target × 25 menit. Halaman workspace dengan beberapa project → satu berkas, tiap project = task ringkasan tingkat 1. Deterministik (urutan stabil, tanpa `Date` lokal; `CreationDate` = D 00:00). Nama berkas `{nama project/workspace}-{YYYY-MM-DD}.xml` (karakter tak aman → "-"). | MSPDI adalah format pertukaran yang dibaca MS Project, ProjectLibre, dan GanttProject; XML teks murni cukup dibangun dengan string + escape tanpa pustaka. |
| K54 | **`api.ui.saveFile(name, text, mime)`** — fasad baru API v1, aditif (`minApi` tetap 1). Web: Blob + `<a download>` (pola `downloadBackup`, `index.html:785`), diimplementasi di `plugin-runtime.js` (bukan `index.html`). Aplikasi native: Q7. Mengembalikan `Promise<boolean>`. | Plugin tidak boleh menyentuh DOM global sendiri (lint); fasad menjaga satu jalur unduh untuk plugin lain kelak. |
| K55 | **Editor kapasitas/cuti:** popover dari nama anggota di panel; simpan = satu `records.put` di fungsi daftar-izin `saveResource` (pagar R25 diperluas: `saveResource:records.put`); CAS `updatedAt` seperti sakelar 1c (data berubah sejak dibuka → "Data berubah sejak dialog dibuka — muat ulang", 0 tulis); perangkat baru sebelum tarik pertama → tombol Simpan terkunci "Menunggu data workspace…" (pola P3 (a) / ADR-042 #12). Keterangan "Diubah oleh {nama} · {tgl}". Cuti: ≤ 50 rentang, `from` ≤ `to`, catatan ≤ 60 karakter, rentang tumpang tindih digabung saat simpan. | Pola tulis yang sudah teruji di 1c (sakelar Otomatis, baseline). |
| K56 | **Panel tertutup secara bawaan** (pref per perangkat per halaman `load:<page>`, pola `crit:<page>` 1c-1). Mesin beban berjalan hanya saat panel terbuka, setelah hasil CPM tersedia, dalam memo `[eng.result, units, resources, D]`. | Pengguna yang tidak memakai Beban Tim tidak membayar apa pun (render awal R24 tetap). |
| K57 | **Ringkasan EV** di sisi kanan toolbar, di sebelah "Selesai {tgl}" (teks Q6); tooltip memuat PV/EV/AC/BAC dalam 🍅 dan nama baseline. Tidak ada baseline aktif → ringkasan tidak tampil. | Satu baris, tidak mengganggu yang tidak memakai baseline. |
| K58 | **Split task ditunda** (bila Q5 (a)); kunci `timeline.split` tetap dicadangkan (K15) tetapi tidak dibuat. | Split menyentuh mesin, bar, seret, violations, baseline, explain, ekspor; cuti sudah terwakili lewat K47. |
| K59 | **Tidak ada endpoint, tabel, atau modul server baru** di 1d-1/1d-2 (K21). `resource` cukup dideklarasikan di manifest (K26: indeks deklarasi dibaca ulang ≤ 10 dtk, tanpa restart). | Pola 1c-1/1c-2. |

## 3. Ruang lingkup dan pembagian PR

| PR | Isi | Server | Restart | SW / whatsnew |
|---|---|---|---|---|
| **1d-0** (hanya bila Q2 (a)) | Batas `estimated_pomodoros` 20 → 99: validasi server (`webapp.py:1238`, `:1268`), `pomologic.EST_MAX`, pemilih Target 🍅 menerima angka > 5 tanpa klik berulang (lokasi tepat di rencana); tes server + Node. | ya (validasi) | `taskflow-web` | bump; whatsnew pendek ("Target 🍅 kini sampai 99") |
| **1d-1** — Timeline 1.3 | Record `resource`; `load.js` (beban + saran); panel Beban Tim + editor kapasitas/cuti + popover saran; tampilan HP; pagar R25 diperluas. | tidak | tidak | bump; whatsnew |
| **1d-2** — Timeline 1.4 | EV di `load.js`; ringkasan EV toolbar; `mspdi.js`; `api.ui.saveFile`; tombol "Ekspor ke Microsoft Project (.xml)". | tidak | tidak | bump; whatsnew |

Urutan: 1d-0 → 1d-1 → 1d-2; 1d-1 tidak bergantung pada 1d-0 secara teknis (Beban Tim berjalan dengan batas berapa pun), sehingga bisa dikerjakan paralel tetapi di-merge setelahnya.

## 4. Bentuk data

```json
// record resource — id "res@list:12:7", scope "list:12" (pribadi: "res@user:7", scope "user")
{
  "v": 1,
  "capacity": 6,
  "leave": [{"from": "2026-12-22", "to": "2026-12-31", "note": "Libur akhir tahun"}],
  "by": 3,
  "updatedAt": "2026-11-06T02:10:00Z"
}
```

- Validasi baca (`resourceDecode`): `v` ≠ 1 / bukan objek → diabaikan (kapasitas bawaan); `capacity` bukan bilangan bulat 0–40 → 8; entri `leave` rusak (bukan ISO, `from` > `to`) dilewati; `note` dipotong 60 (sadar surrogate, pola `cutName`).
- Manifest: `records.resource = {conflict: "lww", maxBytes: 4096}`; `taskExt.keys` **tidak** bertambah (split ditunda).
- Tidak ada perubahan pada kunci ext, record `calendar`/`project`/`baseline`, maupun data host.

## 5. Mesin (`load.js` = `TLLoad`, `mspdi.js` = `TLMspdi`; murni, tanpa `Date` lokal, tanpa global, dites Node)

### 5.1 Beban — `TLLoad.run(result, ctx, people, opts)`

- **Masukan:** hasil `TLCpm.run` (ES/EF, jangkar), `ctx` (tugas, kalender unit, `readExt`), `people` = daftar anggota `{uid, name, resource}` (resource terdekode), `opts = {D, T, scopeKeys}`.
- Untuk tiap task dalam lingkup halaman yang tidak berulang dan tidak dikecualikan R8: tentukan penanggung jawab (K49), jendela `[maks(T, mulai), selesai]` (K46), hari kerja jendela per kalender unit task (prefiks hari kerja `TLCal`), dan **porsi harian** = sisa ÷ jumlah hari kerja jendela.
- **Keluaran:** `{rows: [{uid, name, label, capacity, days: Map<dn, {load, cap, onLeave, parts: [{key, share, late}]}>, overDays: [dn…], total}], unscheduled: n, recurring: n, lateCount: n}`; baris urut: anggota (nama, `cmpKey`), lalu "(bukan anggota)", lalu "Belum ditugaskan".
- `cap(dn)` = 0 bila bukan hari kerja kalender **unit task** (bila anggota punya task di beberapa unit dengan kalender berbeda, hari kerja = gabungan; dicatat di §8) atau cuti; selain itu `capacity`.
- Penjumlahan pecahan memakai bilangan bulat "milipomodoro" (×1000) agar deterministik lintas urutan.

### 5.2 Saran leveling — `TLLoad.suggest(load, uid, dn, result)`

Kontributor `parts` hari itu → `[{key, share, slack, kind: "free"|"critical"|"manual"|"started"|"late"}]`, urut: `free` (slack > 0) slack menurun, lalu sisanya (kritis, Manual, sudah mulai, terlambat) dengan `cmpKey`. Murni, tanpa tulisan.

### 5.3 Earned value — `TLLoad.ev(baselineDec, ctx, D)`

Rumus K51. Keluaran `{bac, pv, ev, ac, spi, cpi, rows, outside}`; `spi`/`cpi` = `null` bila penyebut 0. Pecahan dihitung per baris lalu dijumlah dalam milipomodoro; ditampilkan dibulatkan (persen bulat, 🍅 satu desimal).

### 5.4 Ekspor — `TLMspdi.build(result, ctx, opts)`

Membangun string XML sesuai K53 dari hasil mesin + `wbsMap` + baseline aktif (opsional) + anggota. Escape `& < > " '`; karakter kontrol dibuang. Urutan elemen mengikuti skema MSPDI (Project → Calendars → Tasks → Resources → Assignments). `UID` task = urutan WBS (1…n, 0 = ringkasan project); peta `key → UID` deterministik. Dependensi ke task di luar berkas (lintas halaman) dilewati dan dihitung (`skippedLinks`).

### 5.5 Kinerja

Beban: O(Σ hari kerja jendela) ≤ ±15.000 sel untuk 500 task × 30 hari; EV: O(baris baseline × hari) dengan prefiks hari kerja. Asersi CI: 500/400/10 ≤ 150 ms Node; target ≤ 20 ms CPU 4× (E2E).

## 6. Penulisan, sinkron, dan konflik

- **Satu-satunya penulis baru:** `saveResource` (K55). Tidak ada tulisan dari mesin, panel, saran, EV, atau ekspor.
- **Konflik:** LWW per record. Dua anggota menyimpan kapasitas orang yang sama → yang terakhir menang; CAS `updatedAt` mencegah menimpa tanpa sadar bila record berubah saat popover terbuka.
- **Offline:** simpan lokal + antrean `plugin_records` (1a-2); panel memakai record lokal.
- **Pengguna keluar workspace:** record `resource`-nya dibiarkan; barisnya hilang bila tidak lagi punya task (K49).

## 7. UI

### 7.1 Toolbar

Tombol baru **"Beban Tim"** (ikon histogram, `aria-pressed`) setelah "Jalur kritis"; di ≤ 640 px / Live Edit masuk menu "Lainnya" (R23). Menu "Lainnya" mendapat **"Ekspor ke Microsoft Project (.xml)"** (1d-2). Sisi kanan: ringkasan EV (K57) sebelum "Selesai {tgl}".

### 7.2 Panel Beban Tim (Q3)

Di bawah Gantt, berbagi sumbu waktu dan gulir horizontal; tinggi tetap (maks. 10 baris terlihat, sisanya gulir vertikal). Kolom kiri: "Sari · 6 🍅/hari" (klik → editor). Tiap hari: batang tinggi = beban ÷ maks(kapasitas, beban), garis kapasitas, **merah** bila beban > kapasitas, arsir untuk cuti, abu-abu untuk hari libur. Judul panel: "Beban Tim · {n} hari kelebihan beban" (+ "· {m} task belum dijadwalkan" bila ada). Sel merah: klik → popover saran (§7.4). Tooltip sel: "{nama} · {tgl}: {beban} dari {kapasitas} 🍅 (~{jam} jam)".

### 7.3 Editor kapasitas/cuti

Popover: "Kapasitas" (angka 0–40, "🍅/hari", petunjuk "8 🍅 ≈ 3 jam 20 menit fokus"), daftar "Cuti" (dari–sampai, catatan, hapus), "Tambah cuti", Simpan/Batal, keterangan "Diubah oleh {nama} · {tgl}". Toast "Kapasitas {nama} disimpan".

### 7.4 Popover saran

Judul "Bisa digeser — {nama}, {tgl}" + daftar K50; kosong → "Tidak ada task yang bisa digeser tanpa menggeser jalur kritis".

### 7.5 Ringkasan EV (Q6) dan ekspor

Ringkasan sesuai Q6; tooltip "Baseline: {nama} · PV {x} · EV {y} · AC {z} · BAC {w} 🍅". Ekspor: toast "Berkas {nama} diunduh" / "Ekspor gagal".

### 7.6 HP (≤ 640 px)

Panel menjadi daftar **"Hari kelebihan beban"** (anggota · tanggal · beban/kapasitas), urut tanggal; ketuk → popover saran.

### 7.7 Teks UI baru (persis, diperiksa tes)

"Beban Tim", "Beban Tim · {n} hari kelebihan beban", "{n} task belum dijadwalkan", "Belum ditugaskan", "(bukan anggota)", "Hanya beban dari project ini — buka halaman workspace untuk beban lengkap", "Kapasitas", "🍅/hari", "8 🍅 ≈ 3 jam 20 menit fokus", "Cuti", "Tambah cuti", "Kapasitas {nama} disimpan", "Diubah oleh {nama} · {tgl}", "Menunggu data workspace…", "Data berubah sejak dialog dibuka — muat ulang", "Bisa digeser — {nama}, {tgl}", "Tidak ada task yang bisa digeser tanpa menggeser jalur kritis", "Hari kelebihan beban", "terlambat", "Ekspor ke Microsoft Project (.xml)", "Berkas {nama} diunduh", "Ekspor gagal", teks ringkasan EV (Q6), teks aplikasi native (Q7).

## 8. Kasus tepi

- Anggota tanpa task → baris tetap tampil (beban 0) agar kapasitas/cuti bisa diisi lebih dulu.
- Target < `pomodoros_done` (lembur) → sisa 0, tidak negatif.
- Target bawaan host = 1 → task yang tidak pernah diestimasi menyumbang 1 🍅 total; panel menampilkan "{n} task bertarget bawaan 1 🍅" bila > 25 % task berbeban.
- Task ber-`actual.start` tetapi belum selesai → jendela dari `maks(T, mulai)` tetap K46 (jangkar 1c-2).
- Jendela tanpa hari kerja (kalender rusak, `TL_CAL_LOOP`) → task masuk "belum dijadwalkan", tanpa lempar.
- Anggota punya task di beberapa unit dengan kalender berbeda → kapasitas berlaku pada hari yang merupakan hari kerja di **salah satu** kalender unitnya; beban tetap mengikuti kalender task.
- Cuti melewati akhir pekan/libur → tidak berpengaruh di hari itu (kapasitas memang 0).
- Kapasitas 0 (anggota tidak aktif) → setiap beban > 0 merah.
- Baseline aktif terhapus/rusak → ringkasan EV hilang tanpa galat; baseline tanpa `w` > 0 → hilang.
- Ekspor dengan judul berisi `&`, `<`, emoji, karakter kontrol (di-escape / dibuang); > 1.000 task; task tanpa jadwal → diekspor dengan `Start` = D, durasi 1 hari dan `Estimated` = 1 (tanda "?" di MS Project), jumlahnya disebut di toast ekspor; lingkaran dependensi → tautan antar anggota lingkaran dilewati dan dihitung (`skippedLinks`).
- Zona waktu: semua tanggal hari Asia/Jakarta → jam kerja tetap 08:00–17:00 tanpa offset (MSPDI lokal-naif).

## 9. Pengujian

- **Node (murni):** `timeline_load.test.js` — distribusi K46 (kalender, libur SKB, cuti, terlambat, milestone, selesai, berulang, tanpa jadwal, belum ditugaskan, bukan anggota, multi-kalender), determinisme 50 acakan, milipomodoro, kinerja 500/400/10; `suggest` urutan; `ev` fixture (PV/EV/AC/SPI/CPI, penyebut 0, task di luar baseline, milestone); `resourceDecode` validasi. `timeline_mspdi.test.js` — escape, urutan elemen, tipe/lag dependensi, batasan, baseline, multi-project, determinisme, tanpa `Date`.
- **UI (jsdom, pola `timeline_ui`):** panel tertutup = 0 run `TLLoad`; buka → run setelah hasil CPM; sel merah + popover saran + klik pilih bar; editor simpan/CAS/kunci perangkat baru; HP daftar; ringkasan EV; tombol ekspor memanggil `api.ui.saveFile` dengan nama + mime; **pagar R25** (spy + AST bundel) diperluas `saveResource:records.put` tanpa dilemahkan.
- **Runtime:** `api.ui.saveFile` web (Blob + anchor) dan cabang native (Q7).
- **Server (1d-0):** validasi 1…99, tolak 0/100; tes Node `pomologic` batas baru.
- **E2E (Playwright):** dua anggota (kapasitas diubah A → tampil di B; CAS), cuti → merah → geser → hijau, beban di halaman project vs workspace, ringkasan EV setelah baseline + progres, unduh XML lalu parse dengan `xml.etree` (struktur + jumlah task/tautan), 375 px + Sakura gelap, kinerja CPU 4×, regresi E2E 1c.

## 10. Rilis dan rollback

- **1d-0:** deploy + `sudo systemctl restart taskflow-web`; rollback = revert (nilai target > 20 tetap tersimpan; server lama menolak PUT penuh dari klien yang membawa nilai > 20 → **revert 1d-0 hanya bersama skrip penjepit** `UPDATE tasks SET estimated_pomodoros = 20 WHERE estimated_pomodoros > 20` — disebut di catatan rilis).
- **1d-1 / 1d-2:** statis, tanpa restart; rollback = revert ke versi sebelumnya sebagai rilis baru (SW bump + whatsnew `silent`), record `resource` dibiarkan (versi lama mengabaikannya).
- Teks "Apa yang baru" untuk tiap PR diajukan di rencana masing-masing (pola P1 1c).

## 11. Risiko dan mitigasi

| # | Risiko | Mitigasi |
|---|---|---|
| R1 | Beban terlihat "salah" karena target tidak diisi (bawaan 1) | Catatan "{n} task bertarget bawaan 1 🍅" (§8); Q2 menaikkan batas agar estimasi realistis mungkin. |
| R2 | Klien lama (SW basi) menjepit target > 20 lalu menulisnya kembali (1d-0) | Hanya bila pengguna mengklik titik ke-5 di klien lama; jendela sampai SW diperbarui; dicatat sebagai residual. |
| R3 | Panel memperlambat Gantt | K56 tertutup bawaan; memo; DOM dibatasi baris/hari terlihat; anggaran §1 butir 6. |
| R4 | Dua anggota mengedit kapasitas orang yang sama | LWW + CAS + "Diubah oleh". |
| R5 | XML tidak terbuka di MS Project | Tes struktur + uji manual pemilik sebelum merge 1d-2; elemen minimal yang wajib saja. |
| R6 | Earned value disalahpahami | Q6 bahasa sehari-hari + tooltip; tampil hanya bila baseline ada. |

## 12. Di luar cakupan 1d

Split task (bila Q5 (a)); kalender per orang yang menggeser jadwal (resource-constrained scheduling); leveling otomatis; kurva S harian / hidrasi `pomodoro_log`; impor MSPDI; ekspor ke format lain (CSV/Excel); beban lintas workspace; notifikasi kelebihan beban.

## 13. Keputusan untuk pemilik

**Jawaban pemilik (2026-11-06 08.51 WIB): 1a 2a 3a 4a 5a 6a 7a** — tiga PR (1d-0 / 1d-1 / 1d-2); batas target 🍅 dinaikkan ke 99 di PR host 1d-0; Beban Tim = panel di bawah Gantt; semua anggota boleh mengubah kapasitas/cuti; split task ditunda; earned value berbahasa sehari-hari; ekspor di aplikasi native = petunjuk ke browser.

| # | Pertanyaan | Pilihan | Rekomendasi |
|---|---|---|---|
| **Q1** | Pembagian PR 1d | (a) tiga PR: **1d-0** host batas target (bila Q2 a) / **1d-1** Beban Tim / **1d-2** earned value + ekspor; (b) satu PR 1d | **(a)** — perubahan host (butuh restart) terpisah dan bisa di-revert sendiri; Beban Tim adalah UI terbesar; EV + ekspor sama-sama perhitungan murni yang kecil. |
| **Q2** | Batas **target 🍅 = 20** terlalu kecil untuk task berhari-hari (task 10 hari paling banyak 2 🍅/hari di Beban Tim) | (a) naikkan ke **99** di PR host kecil 1d-0 (validasi server, `EST_MAX`, pemilih Target menerima angka > 5 tanpa klik berulang; restart `taskflow-web`); (b) biarkan 20 — Beban Tim tetap jalan, task panjang tampil lebih ringan dari kenyataan | **(a)** — Beban Tim hanya berguna bila target mencerminkan kerja; 20 🍅 ≈ 8 jam fokus total. |
| **Q3** | Letak Beban Tim | (a) **panel di bawah Gantt** berbagi sumbu waktu (tertutup bawaan, tombol "Beban Tim"; di HP jadi daftar hari kelebihan beban); (b) mode terpisah "Beban" di sakelar Gantt / Daftar | **(a)** — kelebihan beban terlihat sejajar dengan bar penyebabnya; itulah inti leveling manual. |
| **Q4** | Siapa boleh mengubah **kapasitas dan cuti** seorang anggota | (a) **semua anggota** untuk baris siapa pun, dengan keterangan "Diubah oleh {nama} · {tgl}" (sama dengan sakelar Otomatis 1c Q3); (b) hanya baris sendiri (dibatasi di UI; server tidak bisa memaksa karena record plugin per workspace) | **(a)** — biasanya ketua tim yang mengisi cuti dan kapasitas; (b) tidak bisa benar-benar dipaksakan. |
| **Q5** | **Split task** manual (spec induk §9) | (a) **tunda** ke luar Fase 1 — cuti cukup tampil sebagai kapasitas 0 + merah, pengguna menggeser task; (b) masukkan di 1d-1 (menyentuh mesin, bar, seret, violations, baseline, explain, ekspor) | **(a)** — biaya tinggi di seluruh mesin 1c untuk kasus yang bisa ditangani dengan menggeser task. |
| **Q6** | Tampilan **earned value** | (a) bahasa sehari-hari: **"Jadwal 92% · Efisiensi 🍅 108%"** + tooltip berisi PV/EV/AC; (b) istilah PM: **"SPI 0,92 · CPI 1,08"** | **(a)** — sebagian besar pengguna Alurik bukan manajer proyek; istilah PM tetap ada di tooltip. |
| **Q7** | **Ekspor di aplikasi native** (desktop/Android, Tauri) — saat ini aplikasi tidak punya perintah simpan berkas | (a) web dulu: di aplikasi native tombol Ekspor menampilkan "Ekspor tersedia di alurik.com lewat browser"; (b) tambah perintah Tauri `save_file` + dialog simpan — perlu build dan rilis ulang aplikasi desktop/Android di luar alur deploy web | **(a)** — tanpa rilis ulang aplikasi; ekspor jarang dipakai dan biasanya dari laptop. |

Jawaban singkat seperti biasa (mis. "1a 2a 3a 4a 5a 6a 7a"). Setelah disetujui, rencana implementasi ditulis per PR (dimulai 1d-0 bila Q2 (a), atau 1d-1).

---

### Catatan implementasi PR 1d-0 (2026-11-06)

PR 1d-0 (branch `claude/target-pomodoro-99` dari `main` @ `22cd9e5`; rencana `docs/superpowers/plans/2026-11-06-plugin-fase1-pr-1d-0.md`, P1 (a) + P2 (a); ADR-047) menaikkan target 🍅 ke 1–99. Dikerjakan subagent-driven (implementer + reviewer terpisah per tugas, review akhir seluruh branch, re-review); ledger `.superpowers/sdd/2026-11-06-plugin-fase1-pr-1d-0/progress.md`.

- **Server:** `webapp.TASK_EST_MIN = 1` / `TASK_EST_MAX = 99` dipakai `TaskCreate` dan `TaskUpdate`; tanpa migrasi (kolom tanpa `CHECK`), bot tidak berubah. Tes silang `tests/test_est_max_sync.py` mengunci kesamaan dengan `pomologic.js`.
- **Klien:** `TF.pomologic.EST_MAX = 99`; pengurai `parseEstimate` (1–3 digit ASCII, 0/kosong/tak sah → `null`, > 99 dijepit); keputusan komit murni `estimateCommit({raw, saved, lastSent, dirty})` — tidak mengirim bila belum diketik sejak fokus, tak sah, atau sama dengan nilai efektif.
- **Fokus Hari Ini:** `.ftask-estimate` kini pembungkus tanpa role; `.ftask-est-group[role=radiogroup]` memuat 5 tombol lama (klik "5+" tetap +1, berhenti di 99); bila target ≥ 5 badge `×n` diganti kolom `input.ftask-est-input` ("Target pomodoro (1–99)"). Nilai tampil = target tersimpan saat tidak difokus; isi terpilih saat fokus (`select()` + rAF + `mouseup` pertama ditahan untuk Safari/WKWebView); roda mouse = blur; 16 px di ≤ 768 px (cegah zoom iOS).
- **Detail task (P2 (a)):** `TF.liveedit.EDITABLE_FIELDS` + `estimated_pomodoros` (trigger "blur"; simpan "now" tidak membawanya, `flush` mengirim nilai sah terakhir seperti deadline); baris "Target 🍅" setelah Deadline, ringkas "+ Target 🍅" selama target 1; `NumberPicker` baru (isi terpilih saat dibuka; teks kosong/tak sah mengembalikan form ke nilai saat popover dibuka sehingga tidak pernah mengirim angka antara).
- **§10 diganti untuk 1d-0 (R3):** rollback utama = revert bagian klien saja (SW bump + whatsnew `silent`); server tetap menerima ≤ 99 sehingga tidak perlu skrip penjepit maupun restart. Revert server penuh hanya bersama `UPDATE tasks SET estimated_pomodoros = 20 WHERE estimated_pomodoros > 20` + restart.
- **Jendela deploy (R2, dibuktikan E2E):** klien baru + server lama → PUT target > 20 = 422 → bilah "gagal disinkronkan" (pesan mentah server lama) → setelah restart "Coba lagi" memulihkan seluruh PUT (judul + target). Karena itu **`sudo systemctl restart taskflow-web` segera setelah deploy**.
- **Klien lama (R7, dibuktikan E2E):** v499 membuka/menyinkronkan task bertarget 50 tanpa satu PUT; pemilihnya menampilkan ×20 dan hanya menulis bila pengguna mengklik.
- **Anggaran baris:** `index.html` 46.074 → 46.236 (+162, perubahan host); tiga anggaran plugin historis di `tests/offline/plugin_host_wiring.test.js` memakai `HOST_1D0_EXTRA = 162`. 1d-1/1d-2 kembali ke **+0 baris** terhadap `main` pasca-1d-0.
- **Rilis:** SW `taskflow-v500-target-pomodoro`, `app.css?v=384`, whatsnew non-silent (teks P1 (a)).
- **Verifikasi (HEAD `ae93848`):** pytest 1478 passed / 1 skipped; `npm test` 4478 tes, 4477 lulus (1 gagal pra-ada `draw_local_reactive`); PROTOCOL §4 butir 5 33 passed; `check_inline_scripts` OK (6); `compile.js` 2× tanpa diff; simulasi CI tanpa `node_modules` 1476 passed / 3 skipped; `import webapp, bot` + `migrate_db` 2× OK. E2E `temporary_files/e2e_plugin_fase1_1d0.py` 50/50 (server lama/klien lama dipatok `22cd9e5`); regresi `e2e_focus_target` 41/41, `e2e_focus_header_strip` 101/101, `e2e_live_edit` 122/122, `e2e_task_detail_body` 104/104 (satu run sempat 1 gagal tanpa jejak, tiga run ulang bersih — kemungkinan flake), `e2e_detail_redesign` 325/326 (T-8g gagal identik di `22cd9e5`, pra-ada; asersi P-6a diperbarui untuk "+ Target 🍅"), `e2e_plugin_fase1_1c2` 34/34.
- **Residual diterima:** ketikan di kolom Fokus dibuang bila target berubah dari luar saat sedang mengetik (tanpa PUT basi); teks `NumberPicker` tidak disinkron bila nilai berubah dari luar saat popover terbuka, dan bila pengguna lalu mengosongkan isian, form kembali ke nilai saat dibuka (sangat jarang); kedipan singkat nilai lama setelah Enter + blur sampai refresh lokal; strip header Fokus dengan angka tiga digit belum dicek E2E (sudah mungkin sebelum PR ini).

### Catatan implementasi PR 1d-1 (2026-11-09)

PR 1d-1 (branch `claude/timeline-beban-tim` dari `main` @ `e0c2895`; rencana `docs/superpowers/plans/2026-11-09-plugin-fase1-pr-1d-1.md`, P1 (a) + P2 (a) + P3 (a); **ADR-049** — ADR-048 sudah dipakai checklist bertingkat) merilis Timeline 1.3.0 "Beban Tim". Dikerjakan subagent-driven (implementer + reviewer terpisah per tugas, review akhir, gelombang perbaikan); ledger `.superpowers/sdd/2026-11-09-plugin-fase1-pr-1d-1/progress.md`.

- **Koreksi spec yang disahkan rencana:** beban memakai tanggal **tersimpan** yang digambar bar (`TLSched.spanOf`), bukan ES/EF mesin (K46 keliru terhadap 1c; E2E membuktikan hasil berbeda dari distribusi berbasis ES); satu kalender per halaman (kasus multi-kalender §5.1/§8 tidak ada); `context.collaborators` = semua rekan lintas workspace (README §6.2 dikoreksi) sehingga baris = pengguna aktif + penanggung jawab task hidup belum selesai + pemilik record kapasitas (P2 (a), "(bukan anggota)" dihapus, nama tak dikenal "Anggota #id"); halaman `proj_*` selalu pribadi → catatan "Hanya beban dari project ini" (P3 (a)); project Manual tetap mendapat saran menurut slack.
- **Mesin:** `load.js` (`TLLoad`) murni — milipomodoro, porsi rata dengan sisa ke hari awal, terlambat → T, cuti tetap menerima beban (merah), `suggest` (free → kritis → Manual → sudah mulai → terlambat), kodek `resource` (gabung cuti tumpang tindih/bersebelahan, ≤ 50, catatan 60 code point).
- **Data:** record `resource` (`res@list:<lid>:<uid>` / `res@user:<uid>`, lww, 4.096 byte); satu-satunya penulis baru `saveResource` (pagar AST + pin); CAS `{exists, updatedAt}`; kunci "Menunggu data workspace…" = `!loaded || (!has && !pulled)`, potret sementara lalu final; `useLoad` menunggu data kapasitas termuat (tanda " · kapasitas belum termuat" bila gagal); `api.env.userId` bisa string → `uidOf`.
- **UI:** tombol "Beban Tim" (toolbar / Lainnya); panel desktop di bawah Gantt — satu `<svg>` per orang (kapasitas, beban, kelebihan, cuti, non-kerja abu), skala stabil per baris, maks 150 tombol hari merah + klik grafik + tombol judul "Hari kelebihan beban" (daftar yang sama dengan HP), gulir horizontal via `translateX` dari `onScroll` + `overflow: clip`; popover saran + `revealRow` (gulir + kedip, tersaring → detail); editor kapasitas/cuti; HP = daftar + chip; menyalakan lewat gestur menggulir panel ke layar.
- **Rilis:** SW `taskflow-v501-beban-tim`, whatsnew non-silent (teks P1 (a)), `app.css?v=384` tetap, `index.html` +0 baris, statis tanpa restart.
- **Verifikasi (HEAD `2091e35`):** pytest 1636 passed / 1 skipped; `npm test` 4616 tes, 4615 lulus (pra-ada `draw_local_reactive`); PROTOCOL §4 butir 5 33; `check_inline_scripts` OK; `compile.js` 2× tanpa diff; CI sim tanpa `node_modules` 1634 / 3 skipped; `static/offline`, server, `plugin-runtime.js`, `app.css` tidak berubah. E2E `temporary_files/e2e_plugin_fase1_1d1.py` 42/42 (dua anggota + CAS, perangkat baru terkunci, cuti → merah → saran → seret, beban = bar, filter, pribadi/workspace, klien 1.2 dipatok `ebf829c` 0 tulis + record utuh, 375 px Sakura gelap, tiga zoom, kesejajaran panel, kinerja CPU 4× median 8,9–13,4 ms, dingin pertama 21,9–23,4 ms, DOM maks 872). Regresi: 1d0 50/50, 1c2 34/34 (skrip asli gagal di hari Senin — pra-ada, identik di main), 1c1 44/45 (10a anggaran render pra-ada), 1c0b 26/26, 1c0 40/40, 1b 60/61 (6a pra-ada, 6d flaky 1/3), 1a2 49/49, 1a1 45/45; asersi urutan "Lainnya" di 1c1/1c2 diperbarui (+ Beban Tim).
- **Residual diterima (ADR-049):** lebar view basi bila Timeline dipasang saat wadah host beranimasi (pra-ada 1c; usulan PR lanjutan `ResizeObserver`); tombol hari merah 4 px di zoom Bulan (klik grafik/daftar tetap menjangkau); plugin tidak berlangganan `app.dayChanged` (pra-ada 1c); panggilan dingin pertama `TLLoad.run` sedikit di atas 20 ms; `peopleOf` bisa menambah baris berbeban 0 untuk induk ringkasan; tombol "+" HP menutupi bagian bawah daftar setelah digulir; `saveBl`/`setAuto` 1c masih `Number.isInteger(userId)`.
