# Spec turunan: Sistem Plugin Alurik — Fase 1, PR 1c (Timeline: jadwal otomatis, CPM, baseline, tracking)

- **Status:** disetujui pemilik 2026-11-01 16.21 WIB — §13: Q1 (a) tiga PR 1c-0 / 1c-1 / 1c-2; Q2 (a) penerus langsung ikut bergeser + Urungkan, pratinjau bila > 20 task; Q3 (a) semua anggota yang Timeline-nya ON boleh menyalakan Otomatis, dengan keterangan "Dinyalakan oleh {nama}"; Q4 (a) sakelar per project di dalam workspace; Q5 (a) tanggal aktual tercatat otomatis dari aksi nyata, bisa diubah, tombol "Catat". PR 1c-0 diimplementasi di branch `claude/plugin-sync-ext` (lihat "Catatan implementasi PR 1c-0" setelah §6.3); 1c-1 dan 1c-2 belum.
- **Tanggal:** 2026-11-01
- **Agent:** Claude (Opus 5.5)
- **Spec induk:** `docs/superpowers/specs/2026-10-31-plugin-fase1-timeline-design.md` (salinan Project `claude/spec-plugin-fase1-timeline-2026-10-31.md`; disetujui pemilik 2026-10-31) — terutama §2 K4–K7, K14, K15, K21; §8 (1b); **§9 "Garis besar 1c dan 1d"**; §10; §12; §13; §15. Spec ini melanjutkan penomoran keputusan induk (**K22–K44**); K1–K21 tetap berlaku kecuali disebut lain.
- **Basis kode:** `main` @ `c7ee5100` (setelah #120 1a-2 dan #122 1b; SW `taskflow-v495-timeline`, `app.css?v=383`, IndexedDB `taskflow-offline` **v7**, 84 modul `static/offline/`, `index.html` 46.074 baris, `plugin-runtime.js` 1.635, `syncpush.js` 2.461, `syncpull.js` 2.020, `taskrepo.js` 343, `plugin_sync.js` 735, `plugin_records.py` 489, `webapp.py` 10.888). Plugin `timeline` 1.0.0: `plugin.jsx` 2.479, `schedule.js` 364, `calendar.js` 250, `layout.js` 588, `drag.js` 322, `holidays-id.js` 166.
- **Sumber lain:** rencana 1b `docs/superpowers/plans/2026-11-01-plugin-fase1-pr-1b-timeline.md` (R1–R26); ADR-040/041/042 `.agents/DECISIONS.md`; `docs/plugins/README.md` §5–§8; mockup claude.ai "Mockup Timeline Alurik" (`Main.dc.html` Gantt, `DetailRingkas.dc.html` tingkat 2, `Detail.dc.html` tingkat 3).
- **Istilah** (tambahan atas induk):
  - *mode efektif* task = `timeline.mode` task bila ada, selain itu sakelar "Jadwal otomatis" project-nya; nilainya **otomatis** atau **manual**;
  - *jangkar* = task yang posisinya tidak dihitung mesin (manual, selesai, sudah mulai, anggota lingkaran, MFO);
  - *akar* = task otomatis tanpa pendahulu yang terpecahkan;
  - *ES/EF* = mulai/selesai paling cepat, *LS/LF* = mulai/selesai paling lambat (bilangan hari, K16), *slack* = selisih hari kerja EF→LF (bertanda);
  - *drift* = task otomatis yang tanggal tersimpannya berbeda dari hasil hitung mesin;
  - *gestur* = aksi pengguna di perangkat ini di dalam Timeline (seret, ubah durasi, tautkan, edit seksi Jadwal, sakelar, Terapkan);
  - *unit jadwal* = project tempat sakelar "Jadwal otomatis" dan baseline disimpan (§13 Q4);
  - *T* = `nextWork(api.env.today())`, hari kerja pertama ≥ hari ini (Asia/Jakarta).

---

## 1. Ringkasan

1c mengubah Timeline dari Gantt Manual menjadi penjadwal ringan ala Microsoft Project tanpa server Timeline: dependensi bisa **menggerakkan** task, Gantt menunjukkan **jalur kritis** dan **slack**, pengguna bisa menyimpan **baseline** dan mencatat **tanggal aktual**. Seluruh perhitungan tetap di klien dan offline. Prinsip pengaman utama: **mesin hanya menghitung, tidak pernah menulis sendiri.** Tulisan terjadi hanya karena gestur pengguna di perangkat itu (Terapkan di pratinjau, atau seret/edit yang mengalir ke penerusnya). Sinkron, hari berganti, atau data anggota lain tidak pernah memicu tulisan, sehingga dua perangkat yang datanya belum sama tidak bisa saling menimpa di latar.

Diusulkan **tiga PR** (§3, Q1): **1c-0** perbaikan host kecil yang dibutuhkan penulisan massal (restart `taskflow-web` sekali), **1c-1** Timeline 1.1 (mode Otomatis + CPM + batasan + "Kenapa" + jadwalkan ulang + SS/FF/SF + kolom Slack + seksi tingkat 2–3), **1c-2** Timeline 1.2 (baseline + tracking aktual).

**Kriteria berhasil**

1. **Tanpa tulisan latar.** Memasang view/seksi, `sync.done`, `pulled`, `app.dayChanged`, `taskUpdated` dari perangkat lain, dan perubahan kalender **tidak** memanggil `api.taskExt.set/setMany` maupun `api.records.put` (tes spy = 0 panggilan). Drift ditampilkan sebagai banner "Tinjau".
2. **Mode Otomatis per unit jadwal** dengan **pratinjau** (daftar "Task · Mulai lama → baru · Δ hk", Terapkan/Batal) sebelum menyala; mematikannya tidak mengubah tanggal apa pun.
3. **CPM benar dan deterministik.** Forward/backward pass atas empat tipe dependensi (FS/SS/FF/SF) + lag hari kerja, kalender + libur, batasan ASAP/SNET/MFO; hasil identik untuk 50 urutan masukan acak; lingkaran tidak menggantung (SCC); slack bertanda, tenggat menghasilkan slack negatif; jalur kritis = slack ≤ 0.
4. **Aliran gestur hanya ke hilir.** Seret/edit task di jadwal otomatis menulis task itu + penerus otomatis yang berubah — tidak pernah drift lain yang tidak terkait; satu `setMany`; Urungkan mengembalikan semua nilai persis.
5. **"Kenapa dijadwalkan di sini?"** menjelaskan penentu (pendahulu + tipe + lag, batasan, jangkar), hari libur/akhir pekan yang dilewati, dan keterlambatan terhadap tenggat — dengan teks seperti mockup tingkat 3.
6. **"Jadwalkan ulang yang belum selesai ke setelah hari ini"** selalu lewat pratinjau, untuk project Manual maupun Otomatis.
7. **Penulisan massal aman.** Terapkan 200 task: selesai lokal ≤ 2 s pada CPU 4× dengan **satu** render React untuk pembaruan optimistis; tanpa notifikasi ke anggota (K6); push tidak membawa field inti basi (K25); tanpa endpoint server baru (K23).
8. **Baseline 1–3 per unit jadwal** (1c-2): bar tipis di bawah bar, tabel "Baseline vs sekarang" di seksi, ringkasan selesai project; ≤ 1.000 task per baseline.
9. **Tracking aktual** (1c-2): mulai/selesai aktual tercatat tanpa tulisan latar (Q5), dipakai mesin sebagai jangkar.
10. **Kinerja:** 500 task + 400 dependensi — mesin lengkap ≤ 10 ms median Node lokal (asersi CI ≤ 150 ms), ≤ 40 ms pada CPU 4×, dijalankan **setelah** gambar pertama; render awal Timeline tetap ≤ 150 ms (CPU 4×, definisi R24 1b); DOM ≤ 1.500 elemen.
11. **Kompatibel ke belakang.** Data 1b tidak berubah sampai pengguna bertindak; klien 1.0 yang masih beredar tidak rusak (mengabaikan kunci baru); rollback tanpa kehilangan data.
12. **Batas ukuran:** `index.html` **+0 baris** (hanya string versi SW); `app.css` tidak berubah; IndexedDB tetap v7; tidak ada modul server Timeline (K21).

## 2. Keputusan

| # | Keputusan | Alasan (kode nyata) |
|---|---|---|
| K22 | **Tiga PR**: **1c-0** host (K24–K26, tanpa fitur baru, whatsnew `silent`, restart `taskflow-web`); **1c-1** Timeline 1.1.0 (K27–K39); **1c-2** Timeline 1.2.0 (K40–K42). 1c-0 di-merge dan di-deploy lebih dulu. (Q1) | 1c-0 menyentuh inti sinkron task (`taskrepo`, `syncpush`, `syncpull`) dan server record — harus bisa di-revert sendiri (pola K1 induk). 1c-1 sudah besar (mesin + tiga permukaan UI); baseline/tracking tidak dibutuhkan mesin otomatis selain sebagai jangkar tambahan, jadi bisa menyusul. |
| K23 | **Tidak ada endpoint batch** (`PATCH /api/tasks/ext` dari §9 induk **ditolak**) dan tidak ada modul server Timeline. Penulisan massal = **satu** `api.taskExt.setMany` berisi **hanya task yang nilainya berubah**, diurutkan topologis; drain outbox biasa (satu PUT per task, op di-coalesce per task). | **Penilaian** (§6.2): 200 PUT × (RTT 60–250 ms + ~5–10 ms server) ≈ 14–52 s drain **di latar**, sedangkan UI selesai secara lokal ≤ 2 s (local-first). Batch butuh op outbox baru atau pengelompokan op task di `pushOutbox` (`syncpush.js:2412–2448`), padahal op task membawa **payload penuh** (`taskToUpdatePayload` `:135–156`) sehingga op "ext saja" tidak bisa dibedakan tanpa K25; endpoint baru menggandakan semantik PUT (`webapp.py:2564–2730`: tag, berulang, notifikasi, backfill project) + restart + rollback lebih sulit. Aliran gestur biasanya < 20 task; 200 task hanya pada Terapkan besar/Jadwalkan ulang. Batch dinilai ulang sebagai PR **host generik** bila E2E 1c-1 mengukur drain > 60 s untuk 50 task pada RTT 150 ms. |
| K24 | **1c-0 runtime `setMany`:** semua pembaruan optimistis (`hostBinding.patchTaskExt`) dijalankan **sekaligus di awal** dalam satu `ReactDOM.unstable_batchedUpdates` (fallback: berurutan), lalu tulis lokal berurutan **tanpa** patch per item; penolakan membawa `err.applied = [taskId…]` (aditif, `apiVersion` tetap 1). | Host memakai `ReactDOM.render` legacy (`index.html:45996`, React 18.2) → **tidak ada batching otomatis** di luar handler event: `setMany` hari ini (`plugin-runtime.js:1292–1312`) memanggil `patchTaskExt` → `setTasks` per item (`index.html:43547`) = 200 render `App` + 200 tata letak Gantt (identitas `context.tasks` berganti). `err.applied` dibutuhkan untuk toast "sebagian tersimpan" + Urungkan yang tepat. |
| K25 | **1c-0 push "ext saja":** `taskrepo.updateTask` menandai `rec.ext_only = true` bila patch hanya `ext_patch` **dan** record bersih atau sudah `ext_only`; patch lain/penulis lain → `false`. Push op `update` dengan `ext_only === true`, `ext_dirty` tak kosong, dan tanpa `entity_tags` kotor untuk task itu mengirim **`{ext_patch}` saja** (tanpa field inti). Pull: record kotor `ext_only` → **field inti server selalu menang** (jalur R11 1a-1: tempel ulang `ext_dirty` + antre ulang) tanpa membandingkan waktu. `ext_only` tidak ada (record lama) = perilaku lama. | Hari ini setiap edit ext menaikkan `updated_at` lokal (`taskrepo.js:307`) dan push mengirim **seluruh** field inti dari salinan lokal (`syncpush.js:135–156`); server tidak memeriksa LWW task. Akibatnya Terapkan 200 task di perangkat yang belum menarik perubahan anggota lain (judul, status selesai, penanggung jawab) **mengembalikan** perubahan itu — lewat `__pushNow` (`index.html:1003`, push tanpa pull) atau karena LWW pull memenangkan lokal yang "lebih baru" (`syncpull.js:318–336`). Bahaya ini sudah ada di seret 1b (satu task); 1c melipatgandakannya. Server sudah menerima PUT `{ext_patch}` saja (`webapp.py:2679–2682`, `ext_only` → tanpa notifikasi). |
| K26 | **1c-0 server `plugin_records`:** entitas yang tidak ada di `records_decl` → `plugin_loader.refresh_known()` **sekali** (dibatasi 1×/10 s per proses, pola `task_ext.REFRESH_TTL_S`) sebelum menjawab `INVALID detail: entity`; berlaku untuk POST per item dan GET `?entity=`. | Pembacaan ulang indeks hanya terjadi untuk plugin tak dikenal (`plugin_records.py:405–426`, D6 1b). Entitas baru (`project` di 1c-1, `baseline` di 1c-2, `resource` di 1d) pada plugin yang sudah dikenal → proses lama menjawab `INVALID entity` (`:100–108`) → klien `markError` (`plugin_sync.js:370–380`): op dibuang, record `sync_error` dan **tidak dicoba ulang** sampai `put` berikutnya. Dengan K26 hanya 1c-0 yang butuh restart; 1c-1, 1c-2, 1d deploy statis. |
| K27 | **Tulis hanya atas gestur.** Mesin (`cpm.js`, murni) dihitung ulang setiap kali data berubah (memo), hasilnya hanya untuk **tampilan** (slack, kritis, drift, pratinjau). Tulisan hanya dari: (a) Terapkan di pratinjau; (b) aliran gestur (K32); (c) aksi eksplisit (sakelar mode/project, simpan baseline, catat aktual). Tidak pernah dari efek render, `sync.done`, `pulled`, `onChange`, timer, atau `app.dayChanged`. Drift → banner (K35). | Hasil hitung bergantung pada data lokal (task belum sinkron, kalender belum ditarik, versi data libur berbeda). Penulisan latar dari dua perangkat dengan data berbeda = tulis bergantian tanpa akhir (LWW per kunci, K4). Dengan aturan ini setiap tulisan punya pelaku manusia, dan nilai yang sama dari dua perangkat bersifat idempoten. |
| K28 | **Ext baru** (`manifest.taskExt.keys` + `mode`, `constraint` di 1c-1, `actual` di 1c-2): `timeline.mode` `"auto"∣"manual"` (tidak ada = ikut project; memilih nilai yang sama dengan project menulis `null`); `timeline.constraint` `{type: "SNET"∣"MFO", date}` (tidak ada = ASAP); `timeline.actual` `{start?, finish?}`. `timeline.deps[].type` kini `"FS"∣"SS"∣"FF"∣"SF"`. | K15 induk sudah memesan nama ini. Server memvalidasi namespace, bukan nama field (`task_ext.py:140`), jadi tanpa perubahan server. Ukuran terburuk ±1,1 KB per task (20 dependensi ±45 B) ≪ 4 KB. |
| K29 | **Record `project`** (`{conflict: "lww", maxBytes: 1024}`) per unit jadwal (Q4 rekomendasi: per project): id `prj@user:<h>` (scope `user`, project pribadi) atau `prj@list:<lid>:<h>` (scope `list:<lid>`; `-` = "(Tanpa project)"), `<h>` = FNV-1a 32 bit hex dari `TLSched.projectFold(nama)`. Data `{v: 1, auto: boolean, name: string, by: userId}`. Data dengan `projectFold(name)` ≠ nama halaman = dianggap tidak ada (penjaga tabrakan hash). **Tanpa `start`** (deviasi §9 induk). | Nama project bisa memuat karakter di luar pola id record (`[A-Za-z0-9:@._-]{1,80}`, README §5) dan id wajib menyandikan scope. `project_id` tidak tersedia di context view dan kosong untuk project yang dibuat offline; kelompok 1b sudah memakai lipatan nama (`schedule.js:156`). `start` project tidak diperlukan karena akar berjangkar di tanggal mulainya sendiri (K30); menyimpannya membuat semua task tanpa pendahulu runtuh ke satu tanggal saat Otomatis dinyalakan. |
| K30 | **Semantik jadwal otomatis.** Task ikut mesin bila punya Mulai **atau** punya pendahulu terjadwal yang terpecahkan. Jangkar (nilai tetap): mode manual; selesai (`gtd_status = "done"`); sudah mulai (`progress > 0` ∨ `pomodoros_done > 0` ∨ `actual.start`) → mulai = `actual.start` ?? Mulai tersimpan; anggota lingkaran; MFO. Task otomatis: **akar** → ES = Mulai tersimpannya sendiri (atau SNET bila ada); **berpendahulu** → ES = maks(syarat pendahulu, SNET). Durasi tidak pernah diubah mesin (kecuali Jadwalkan ulang, K36). Task tanpa Mulai dan tanpa pendahulu = "Belum dijadwalkan", tidak disentuh. | Menyalakan Otomatis tidak boleh memindahkan task yang tidak punya alasan untuk pindah (tanpa ini, model ASAP MS Project menarik semua akar ke mulai project). Akar tetap bisa digeser pengguna; penerus mengikuti — sesuai model mental "dependensi menggerakkan penerus" pengguna Alurik. Task yang sudah dikerjakan tidak dipindah mundur/maju oleh mesin. |
| K31 | **Mesin CPM** (`cpm.js`): graf per **scope dependensi** (`TLSched.scopeKeyOf`: workspace utuh atau project pribadi) dari **daftar task lengkap** `api.data.tasks.list({includeDone: true})`, bukan `context.scopeTasks` (yang tersaring panel). Tarjan SCC → Kahn atas DAG kondensasi (O(V+E)) → forward pass → backward pass (§5.3–5.4). LF akar hilir = maks EF **kelompok project**-nya; tenggat membatasi LF (slack negatif). Dependensi ke/dari ringkasan, ke task di luar scope, atau ref tak terpecahkan **diabaikan** dengan alasan. ES dihitung sebagai maksimum sehingga hasil tidak bergantung urutan. | Pola `checkLink` 1b (ADR-042 #6): daftar tersaring membuat siklus/ringkasan lolos. LF per kelompok project mencegah project kecil di workspace mendapat slack raksasa dari project lain. Mockup Gantt (`Main.dc.html`) memperlihatkan slack negatif "−1 hr" pada milestone lewat tenggat. Ringkasan sebagai ujung dependensi sudah ditolak sejak 1b (R10); data lama yang memuatnya tidak boleh menggerakkan semua anak. |
| K32 | **Aliran gestur ke hilir.** Mesin dijalankan atas data + patch gestur; yang ditulis = patch gestur ∪ task otomatis **turunan** (tertaut lewat dependensi tipe apa pun) yang hasilnya berubah. Drift di luar turunan tidak ikut. Bila turunan yang berubah > **20** → pratinjau dulu; selain itu langsung + toast "Jadwal diubah · {n} task ikut bergeser · Urungkan". (Q2) | Gestur tidak boleh "menyelundupkan" perbaikan drift yang tidak dilihat pengguna. Ambang 20 = batas yang masih muat dibaca di toast/pratinjau ringkas seksi; di atasnya pengguna perlu melihat daftar. |
| K33 | **Gestur pada task otomatis.** Seret/Alt+←/→/edit Mulai di seksi: task **berpendahulu atau ber-SNET** → tulis `constraint {SNET, tanggal jatuh}` + `start`; **akar** → tulis `start` saja. Jatuh lebih awal dari syarat pendahulu → bar kembali ke ES + toast "Tidak bisa lebih awal dari dependensinya". Ubah durasi / milestone / dependensi / tipe / lag / batasan / mode → aliran K32. Klik-untuk-menjadwalkan (U2 1b) → akar baru. | Pola MS Project (seret task otomatis = batasan SNET) tanpa membuat task menjadi Manual diam-diam. Untuk akar, SNET identik dengan Mulai tersimpan, jadi tidak perlu kunci tambahan. |
| K34 | **Pratinjau** (dialog di view, ringkas di seksi): potret data saat dibuka; baris "WBS · Task · Mulai lama → baru · Δ hk" (+ "baru dijadwalkan", "durasi berubah"); ringkasan "{n} task bergeser · selesai project {lama} → {baru} ({±k} hk) · {m} lewat tenggat"; bagian "Tidak dipindah" (jangkar yang bertabrakan, lingkaran). **Terapkan** memeriksa ulang (CAS) kunci `start/duration/constraint/mode` setiap item terhadap potret; berbeda → tolak "Data berubah sejak pratinjau dibuka — hitung ulang". Offline → catatan "Kamu sedang offline — jadwal dihitung dari data di perangkat ini". | Pratinjau wajib menurut §9 induk dan keputusan pemilik ("toggle per project dengan pratinjau"). CAS mencegah menerapkan rencana yang dihitung dari data yang sudah ditimpa sinkron selama dialog terbuka. |
| K35 | **Drift = banner, bukan tulisan.** View: "Jadwal otomatis belum mutakhir: {n} task berbeda dari hasil hitung. **Tinjau**" → pratinjau semua drift di halaman. Seksi: "Belum mutakhir — hasil hitung {tanggal}. **Perbarui**" → aliran K32 dari task itu. Banner tidak muncul sebelum daftar task lengkap termuat. | Drift muncul dari perubahan perangkat/anggota lain, task diselesaikan di host, kalender diubah, atau klien 1.0 yang menyeret tanpa SNET. Menampilkannya + satu klik = otomatis secara praktis tanpa tulisan latar (K27). |
| K36 | **Jadwalkan ulang** (toolbar; selalu pratinjau; per halaman): task tidak selesai, terjadwal, di unit jadwal halaman: **belum mulai** dan Mulai < T → otomatis: `constraint {SNET, T}`; manual: `start = T` (milestone ikut). **Sudah mulai** dan EF < T → Mulai tetap, `duration` = hari kerja Mulai…`add(T, r − 1)` dengan sisa `r = max(1, ⌈d × (1 − progress/100)⌉)` (≤ 999). Selesai/EF ≥ T → tetap. Project Otomatis: penerus mengalir (K32 tanpa ambang). Project Manual: penerus tidak dipindah; pratinjau menyebut "{n} dependensi akan dilanggar". | SNET menyimpan alasan pemindahan sehingga hitung ulang berikutnya tidak menarik task kembali ke masa lalu (mesin tetap deterministik, tanpa "hari ini" di dalamnya). Split pekerjaan sisa = 1d (`timeline.split`); memperpanjang durasi adalah pendekatan tanpa split. |
| K37 | **Tipe dependensi FS/SS/FF/SF.** Dibuat lewat seret = FS (seperti 1b); tipe dan lag diubah di seksi (pilihan "Selesai → Mulai (FS)", "Mulai → Mulai (SS)", "Selesai → Selesai (FF)", "Mulai → Selesai (SF)"). Panah: titik keluar/masuk sesuai tipe. Pelanggaran Manual (`violations`) dan `shiftAfterDeps` memakai rumus §5.3. Satu pasangan pendahulu–penerus = satu dependensi (tipe apa pun, kebijakan "ganda" 1b). | Rumus SF sama murahnya dengan tiga lainnya setelah `sff` (§5.3); bentuk data sudah disiapkan 1b. Klien 1.0 menampilkan tipe baru sebagai "dependensi rusak atau tidak dikenali versi ini" (`plugin.jsx:1709`, `:1723`) dan hanya menghapusnya bila tombol "Hapus dependensi rusak" ditekan (§11 R4). |
| K38 | **Kolom Slack + Jalur kritis.** Kolom "Slack" setelah "%" (`0`, `6 hk`, `−1 hk`, `—` untuk selesai/tak terhitung); sakelar toolbar "Jalur kritis" (per perangkat `crit:<page>`) → bar slack ≤ 0 bergaris tepi `--plg-timeline-danger` + panah antar-task kritis tegas; legenda "Jalur kritis". CPM juga dihitung untuk project Manual (jangkar semua). | Mockup `Main.dc.html` (kolom Slack, tombol "Jalur kritis"). Slack berguna di Manual juga (seberapa jauh task boleh mundur). Gaya garis tepi membedakan dari isi merah "lewat tenggat" 1b. |
| K39 | **Seksi Jadwal tingkat 2–3** (mockup): mode efektif manual → tingkat 1 1b tidak berubah + kontrol mode di "Selengkapnya"; mode otomatis → **tingkat 2** kartu terlipat (chip "Otomatis", chip "lewat tenggat {n} hk", "Kam 5 Nov → Sel 10 Nov · 4 hari kerja", "menunggu 1.2 (+1 hk) · diikuti 3.1 · slack 0 · baseline +1 hk", chip "Di jalur kritis") dan **tingkat 3** dibuka penuh (§7.5). Chip "Di jalur kritis" berada **di dalam seksi**, bukan di header detail. | Slot `taskDetail.sections` berada di antara Deskripsi dan tab (K13); plugin tidak bisa menulis ke header host. Tombol mockup "Lihat di Timeline" ditunda: `api.ui.navigate` hanya menerima `dashboard/focus/inbox/settings` (`plugin-runtime.js:1137–1140`). |
| K40 | **Izin di workspace (Q3 rekomendasi):** semua anggota yang Timeline-nya ON boleh menyalakan/mematikan Jadwal otomatis, menerapkan pratinjau, Jadwalkan ulang, dan menyimpan baseline workspace. Sakelar menampilkan "Dinyalakan oleh {nama} · {tanggal}" dari `data.by` + `updated_at`. | Konsisten dengan K14/Q3 induk; record `list:<id>` bisa ditulis semua anggota di server dan tidak ada peran di `list_members`. Pembatasan "hanya pemilik" hanya bisa ditegakkan di tampilan. |
| K41 | **Record `baseline`** (1c-2; `{conflict: "lww", maxBytes: 65536}`): id `bl<n>@user:<h>` / `bl<n>@list:<lid>:<h>` (n 1–3, unit jadwal sama dengan K29); data `{v: 1, n, name, savedAt, by, t: [[ref, s, f, d, w], …]}` (`ref` = `{$task}`, `s/f` ISO, `d` durasi hk, `w` = `estimated_pomodoros` untuk earned value 1d). Isi = task terjadwal non-ringkasan di unit (termasuk selesai); > 65.536 byte (±1.000 task) → ditolak "Baseline terlalu besar". Simpan baseline workspace **dikunci** sampai record lokal ada atau peristiwa `pulled` sejak view dipasang (pola kalender D5 1b); menimpa baseline yang ada butuh konfirmasi. | Bentuk larik ringkas ±55 B/task. `$task` ditahan/ditulis ulang host (README §5). Tanpa kunci, perangkat baru menimpa baseline bersama tanpa tahu sudah ada (`base_version: null` menang LWW). |
| K42 | **Tracking aktual** (1c-2, Q5 rekomendasi): `actual.start` ditulis "isi bila kosong" dengan hari ini **hanya dari gestur di perangkat itu**: `pomodoro.ended` untuk task itu (bila plugin sudah aktif di sesi), atau seksi Jadwal yang terpasang melihat `progress` task itu naik dari 0 / status menjadi selesai; bisa diubah manual. `actual.finish` **tidak disimpan otomatis**: = tanggal Asia/Jakarta dari `completed_at`; disimpan hanya bila pengguna mengubahnya. | `pomodoro.ended`/`task.completed` sudah dipancarkan host (`index.html:11459`, `:44601`) tetapi hanya sampai ke plugin yang sudah dieksekusi (lazy-execute, README §4) — maka butuh jalur cadangan "Belum dicatat · Catat". Turunan `completed_at` tidak perlu tulisan dan tidak bisa bertabrakan. |
| K43 | **Kinerja.** Mesin dijalankan **sesudah** gambar pertama (satu `requestAnimationFrame` + `setTimeout 0`), memo atas (kunci ext task scope, kalender, record project); kolom Slack/kritis/banner menunggu hasil. Daftar task lengkap dimuat saat view dipasang dan setelah `taskUpdated`/`sync.done` (debounce 300 ms). Pratinjau merender ≤ 50 baris + "Tampilkan semua". Bar baseline = 1 `div` per baris tampak. | Render 1b sudah 112–141 ms dari anggaran 150 ms (CURRENT_STATE 1b); mesin di jalur render awal akan melampaui. Jalur `addWork` harian cukup (±15 rb langkah per hitung); indeks prefiks hari kerja hanya bila anggaran meleset. |
| K44 | **Manifest dan rilis.** 1c-1: `version` 1.1.0, `parts` + `cpm.js`, `plan.js` (setelah `schedule.js`, sebelum `layout.js`), `records.project`, `taskExt.keys` + `mode`, `constraint`. 1c-2: 1.2.0, `records.baseline`, `taskExt.keys` + `actual`. `defaultEnabled` tetap false; izin tidak berubah. | `parts` tanpa global (R2 1b). Hash plugin berubah → precache baru → klien mendapat versi baru bersama SW. |

**Keputusan pemilik yang dibawa:** default **Manual**; "Jadwal otomatis" per project **selalu lewat pratinjau**; Timeline per anggota dengan data bersama (Q3 induk); cuti bersama = libur bawaan (Q4 induk); seksi Jadwal untuk semua task kecuali berulang (Q5 induk); desain bertingkat (tingkat 1 dua field → tingkat 2 terlipat → tingkat 3 penuh) agar pengguna tidak kewalahan; leveling manual saja (1d).

## 3. Ruang lingkup dan pembagian PR

| PR | Isi | Server | Restart | Terlihat pengguna |
|---|---|---|---|---|
| **1c-0** | K24 `setMany` satu render + `err.applied`; K25 push ext saja (`taskrepo`, `syncpush`, `syncpull`, audit penulis store `tasks`); K26 baca ulang indeks untuk entitas baru; README §5 | `plugin_records.py` | **`taskflow-web`** | tidak (`silent`) |
| **1c-1** | Timeline 1.1.0: `timeline.mode`/`constraint`, SS/FF/SF, `cpm.js` + `plan.js`, record `project`, sakelar + pratinjau, aliran gestur, banner drift, "Kenapa", Jadwalkan ulang, kolom Slack, Jalur kritis, seksi tingkat 2–3 | tidak | tidak (K26) | ya |
| **1c-2** | Timeline 1.2.0: record `baseline` (simpan/hapus/pilih, bar, tabel, ringkasan), `timeline.actual` + tracking K42, garis aktual | tidak | tidak | ya |

Urutan wajib: 1c-0 ter-deploy + restart **sebelum** 1c-1 di-merge (1c-1 bergantung pada K24–K26). 1c-2 boleh langsung setelah 1c-1. Rencana 1c-1 dan 1c-2 ditulis setelah §13 dijawab; rencana 1c-0 boleh dimulai lebih dulu (tidak bergantung pada Q2–Q5).

## 4. Bentuk data

```ts
// tasks.ext — kunci baru (1b: start, duration, deps tetap sama)
"timeline.mode":       "auto" | "manual"                 // tidak ada = ikut project (1c-1)
"timeline.constraint": { type: "SNET" | "MFO", date: "YYYY-MM-DD" }  // tidak ada = ASAP (1c-1)
"timeline.actual":     { start?: "YYYY-MM-DD", finish?: "YYYY-MM-DD" } // 1c-2; finish hanya bila diubah pengguna
"timeline.deps":       Array<{ t: {$task}, type: "FS" | "SS" | "FF" | "SF", lag: number }> // ≤ 20, lag −99..999 hk

// record project — 1c-1
// id "prj@user:<h>" (scope "user") | "prj@list:<lid>:<h>" | "prj@list:<lid>:-" (scope "list:<lid>")
type ProjectSched = { v: 1, auto: boolean, name: string /* nama asli, ≤ 120 */, by: number | null };

// record baseline — 1c-2
// id "bl<n>@user:<h>" | "bl<n>@list:<lid>:<h>" | "bl<n>@list:<lid>:-", n ∈ {1,2,3}
type Baseline = { v: 1, n: 1|2|3, name: string /* ≤ 40, bawaan "Baseline n" */, savedAt: string /* ISO */,
                  by: number | null, t: Array<[{$task: number|string}, string, string, number, number|null]> };
```

- `<h>` = 8 hex FNV-1a 32 bit atas unit kode UTF-16 dari `projectFold(nama)` (`schedule.js:156`; tanpa trim, sama dengan host). Fungsi `TLSched.unitOf(task | {pageKind, listId, projectName}) → {key, recId, scope, name}` adalah **satu-satunya** pembuat id record project/baseline (pola `calTarget`).
- `sanitizePatch` diperluas: `mode` (`"auto"∣"manual"∣null`), `constraint` (`null` atau `{type ∈ {SNET, MFO}, date: ISO sah 1970–2199}`), `actual` (`null` atau objek dengan `start`/`finish` ISO sah, `finish ≥ start`), tipe dependensi empat nilai. Kunci tak dikenal tetap ditolak.
- `readSched` mengembalikan `{start, duration, deps, invalidDeps, mode, constraint, actual}`; dependensi bertipe tak dikenal tetap dihitung `invalidDeps`.
- Tidak ada perubahan bentuk record `calendar`.

## 5. Mesin (`cpm.js` = `TLCpm`, `plan.js` = `TLPlan`; murni, tanpa Date lokal, tanpa global, dites Node)

### 5.1 Masukan dan simpul

`TLCpm.run({tasks, cal, units, today?})`: `tasks` = daftar lengkap scope dependensi; `cal` = hasil `TLCal.compile`; `units` = `Map<unitKey, {auto}>` dari record project; `today` hanya untuk penanda tampilan (tidak memengaruhi ES/EF). Dibuang: berulang, `archived`, `deleted`. Ringkasan (punya anak hidup) tidak menjadi simpul; rentangnya dihitung dari anak seperti 1b (R10). Simpul = task non-ringkasan yang punya Mulai, atau (mode efektif otomatis ∧ punya pendahulu terjadwal terpecahkan). Durasi hilang = 1 (R7 1b; ditandai "durasi belum diisi").

Mode efektif = `ext.mode ?? (units.get(unitOf(task)).auto ? "auto" : "manual")`. Jangkar (K30) diberi `fixed = {es, ef, why}`: manual → tersimpan; selesai → `es = actual.start ?? start`, `ef = actual.finish ?? jkt(completed_at) ?? fin(es, d)` (bila `ef < es` → `ef = es`); sudah mulai → `es = actual.start ?? start`, `ef = fin(es, d)`; MFO → `ef = d ≥ 1 ? pw(date) : date`, `es = sff(ef, d)`. `jkt(iso)` = `Date.parse(iso)` + 7 jam → bilangan hari (Asia/Jakarta tanpa DST).

### 5.2 Graf

Sisi dari `deps` task penerus (`resolveDeps` 1b, kini dengan tipe). Diabaikan dengan alasan (untuk "Kenapa" dan pratinjau): ref tak terpecahkan, di luar scope (`scopeKeyOf` beda), ujung ringkasan, ujung bukan simpul. **Tarjan SCC** → komponen berukuran > 1 atau dengan sisi ke diri sendiri = **lingkaran**: anggotanya menjadi jangkar (nilai tersimpan, `why: "cycle"`), sisi di dalam komponen diabaikan, sisi keluar tetap dipakai. Urutan topologis = Kahn atas graf tersisa (sudah asiklik). Kompleksitas O(V+E).

### 5.3 Forward pass

Notasi: `nw/pw/add` = `nextWork/prevWork/addWork` 1b; `fin(s, d) = d = 0 ? s : add(nw(s), d − 1)`; `sff(f, d) = d = 0 ? f : add(pw(f), −(d − 1))` (mulai dari selesai). Pendahulu `p` (ES/EF sudah final), penerus `s` berdurasi `d`, lag `L`:

| Tipe | Arti | Syarat pada `s` |
|---|---|---|
| FS | `s` mulai setelah `p` selesai | `ES ≥ add(nw(EF_p + 1), L)` (= `fsEarliest` 1b) |
| SS | `s` mulai saat/setelah `p` mulai | `ES ≥ add(nw(ES_p), L)` |
| FF | `s` selesai saat/setelah `p` selesai | `EF ≥ e`, `e = add(EF_p, L)` (dinaikkan `nw` bila `d ≥ 1`) → `ES ≥ sff(e, d)` |
| SF | `s` selesai saat/setelah `p` mulai | `EF ≥ e`, `e = add(pw(ES_p − 1), L)` (dinaikkan `nw` bila `d ≥ 1`) → `ES ≥ sff(e, d)` |

Task otomatis: `ES = maks(syarat semua pendahulu, SNET.date, jangkar akar)` dengan jangkar akar = Mulai tersimpan bila tanpa pendahulu terpecahkan; `ES = nw(ES)` bila `d ≥ 1` (milestone tidak dijepret, R6 1b); `EF = fin(ES, d)`. Penentu (`driver`) = syarat yang mencapai maksimum; seri → urutan `deps` tersimpan, lalu SNET, lalu jangkar. Jangkar: ES/EF tetap; bila syarat pendahulu > ES jangkar → `conflict` (ditandai seperti pelanggaran 1b).

### 5.4 Backward pass, slack, jalur kritis

Urutan topologis terbalik. Batas awal setiap simpul: `LF = P_g` (maks EF simpul di kelompok project `g`, R9 1b), lalu dibatasi tenggat `deadline` (`d ≥ 1` → `pw(dl)`, milestone → `dl`) dan MFO (`≤ ef` MFO). Untuk setiap penerus `s`:

| Tipe | Batas pada `p` (`y` = titik bantu) |
|---|---|
| FS | `y = add(LS_s, −L)`; `LF_p ≤ pw(y − 1)` |
| SS | `y = add(LS_s, −L)`; `LS_p ≤ pw(y)` → `LF_p ≤ fin(pw(y), d_p)` |
| FF | `LF_p ≤ pw(add(LF_s, −L))` (milestone: tanpa `pw`) |
| SF | `y = add(LF_s, −L)`; `LS_p ≤ nw(y + 1)` → `LF_p ≤ fin(nw(y + 1), d_p)` |

`LS = sff(LF, d)`. `slack = LF ≥ EF ? workdays(EF + 1, LF) : −workdays(LF + 1, EF)` (rentang dibatasi 3.660 hari, pola `MAX_LATE_SPAN`). **Kritis** = slack ≤ 0 ∧ tidak selesai. Ringkasan: slack = min slack anak. Identitas yang dites: rantai tanpa cabang dan tanpa tenggat → `ES = LS` di semua simpul untuk keempat tipe dan lag −2..3. Semua panggilan kalender lewat `safe()` (`TL_CAL_LOOP` → simpul "tak terhitung", bukan crash).

### 5.5 Keluaran

`{nodes: Map<key, {es, ef, ls, lf, slack, critical, mode, fixed?: "manual"∣"done"∣"started"∣"cycle"∣"mfo", driver, conflict?, durGuess?}>, cycles: string[][], ignored: [{from, to, reason}], groupEnd: Map<g, dn>, drift: Set<key>}`. `drift` = simpul otomatis non-jangkar dengan `iso(es) ≠ start` tersimpan (atau tanpa Mulai).

### 5.6 "Kenapa dijadwalkan di sini?" (`TLCpm.explain(result, key, cal, readTitle)`)

Struktur `{kind: "pred"∣"root"∣"snet"∣"mfo"∣"manual"∣"done"∣"started"∣"cycle"∣"unscheduled", pred?, type?, lag?, base, skipped: [{dn, why: "Sabtu"∣"Minggu"∣"libur"∣"cuti"∣"tambahan", name?}], finish, durSkipped, late}` — dihitung hanya saat diminta (satu task). Teks (plugin.jsx), contoh mockup: "Mulai **Kam 5 Nov** karena menunggu **1.2 Palet Sakura + Lavender** selesai Sel 3 Nov, ditambah lag 1 hari (Rab 4 Nov dilewati). Durasi 4 hari kerja melompati Sab–Min, jadi selesai **Sel 10 Nov**, 1 hari kerja setelah tenggat Sen 9 Nov." Varian: akar ("Mulai di tanggal yang kamu tentukan"), SNET ("…karena batasan: mulai tidak lebih awal dari …"), MFO, Manual ("Task ini Manual: tanggal mengikuti yang kamu isi"), selesai/sudah mulai, lingkaran ("Dependensinya melingkar dengan …; tidak dihitung"). Paling banyak 6 hari dilewati disebut, sisanya "dan {n} hari lain".

### 5.7 Rencana tulis (`TLPlan`)

- `diff(result, rawOf)` → `[{task, before: {start, duration, constraint, mode}, patch, deltaHk, kind: "move"∣"new"∣"duration"}]` hanya untuk simpul yang nilainya berubah; urut topologis.
- `cascade(tasks, gesturePatches)` → jalankan mesin atas data + patch gestur, ambil turunan (BFS sisi hasil, semua tipe) yang berubah; hasil `{items, over: items.length − gesture > 20}`.
- `toggleUnit(unitKey, on)` → diff simpul yang mode efektifnya berubah + turunannya (pratinjau); `off` → tanpa item task.
- `reschedule(result, T)` → K36.
- `revalidate(items, rawNow)` → CAS potret (K34).
- `undoItems(items)` → `setMany` nilai `before` persis (kunci yang dulu tidak ada → `null`).
- 1c-2: `baselineEncode/Decode/byteSize`, `compareBaseline(result, baseline)` → per task `{ds, df, dd}` hk dan ringkasan selesai project; `actualOf(task, ext)`.

### 5.8 Kinerja

`run` 500 simpul/400 sisi: Tarjan + Kahn + dua pass ≈ 15 rb langkah harian kalender → ≤ 10 ms median Node (asersi CI longgar ≤ 150 ms), ≤ 40 ms CPU 4× (E2E). Bila meleset: indeks prefiks hari kerja untuk rentang tampak (`add`/`workdays` O(1)) — optimasi internal tanpa perubahan API.

## 6. Penulisan, sinkron, dan konflik

### 6.1 Siapa menulis apa

| Pemicu | Tulisan | Lewat |
|---|---|---|
| Terapkan (sakelar Otomatis, Tinjau, Jadwalkan ulang) | item pratinjau | satu `setMany` |
| Gestur di task otomatis/berpenerus otomatis | patch gestur + turunan (K32) | satu `setMany` (gestur tunggal tanpa turunan: `set`, seperti 1b) |
| Gestur di project Manual tanpa penerus otomatis | patch gestur | `set` (perilaku 1b) |
| Sakelar project | record `project` | `api.records.put` |
| Simpan/hapus baseline | record `baseline` | `put`/`remove` |
| Catat aktual (K42) | `timeline.actual` | `set` |
| Render, sinkron, `pulled`, `onChange`, hari berganti, kalender berubah | **tidak ada** | — |

### 6.2 Penilaian batch server (§9 dan §13 induk)

Jalur hari ini per item: `setMany` → `updateTaskExt` → `api.put` lokal (`taskroutes`) → `taskrepo.updateTask` (`TFdb.mutate`, satu transaksi + op outbox ter-coalesce per task) → drain `pushOutbox` berurutan, satu `PUT /api/tasks/{id}` per op. Biaya: lokal ±3–10 ms per task (200 task ≈ 0,6–2 s, satu `refreshTasks`); jaringan 200 × (RTT 60–250 ms + server ±5–10 ms: `BEGIN IMMEDIATE`, dua `UPDATE`, `SELECT`) ≈ **14–52 s**, di latar, dapat dilanjutkan setelah aplikasi ditutup (op tetap di outbox). Notifikasi: PUT ext saja dilewati K6 (`webapp.py:2682`, `:2713`). Selama drain anggota lain bisa melihat jadwal setengah terkirim (pelanggaran sesaat, drift banner) — tidak merusak karena tidak ada tulisan latar.

**Keputusan K23: tanpa batch di 1c.** Yang dikerjakan sebagai gantinya: diff saja (task yang tidak berubah tidak ditulis), aliran hanya ke hilir, satu render (K24), push ext saja (K25). Ukuran yang dicatat E2E 1c-1: (a) waktu Terapkan → semua tersimpan lokal; (b) waktu drain 50 dan 200 task pada RTT 150 ms. Pemicu PR host "batch push task" (bukan khusus Timeline): (b)50 > 60 s, atau keluhan nyata.

### 6.3 Perubahan host 1c-0

- **H1 `setMany` (K24)** — `plugin-runtime.js:1292–1312`: `batch(() => prepared.forEach(it => patchTaskExt(it.taskId, it.patch)))` dengan `batch = root.ReactDOM && root.ReactDOM.unstable_batchedUpdates || (f => f())`; `write()` tanpa patch untuk item setMany; reject → `err.applied`. `set` tunggal tidak berubah.
- **H2 push ext saja (K25)** — `taskrepo.updateTask`: `next.ext_only = extOnlyPatch && (!cur.dirty || cur.ext_only === true)`; penulis lain store `tasks` yang menyetel `dirty` (create, delete, rute status/fokus, `pomolog` bila menyentuh record task, `syncconflict` "Coba lagi/Buang", `requeue*` syncpull, hidrasi) **wajib** menyetel `ext_only = false` — diaudit di rencana dengan **tes pagar** yang memindai `static/offline/*.js` untuk penulisan store `tasks`/`ensureEntityOp("task")` tanpa penanganan `ext_only`. `syncpush` (`processOp` cabang task update): payload `{ext_patch}` saja bila `rec.ext_only === true ∧ ext_dirty.length ∧ tidak ada baris entity_tags kotor untuk cid itu`; `markPushed` membersihkan `ext_only` bersama `dirty` (CAS rev yang sama). `syncpull` (`:318–336`): `localRec.ext_only === true` → jalur R11 (field inti server + tempel `ext_dirty` + antre ulang) tanpa membandingkan waktu.
- **H3 entitas baru (K26)** — `plugin_records.py` `_guard`/`post_records`/`get_records`.
- README §5 (`setMany`, push ext saja), ADR-043.

### Catatan implementasi PR 1c-0 (2026-11-01)

PR 1c-0 (host saja; branch `claude/plugin-sync-ext`, rencana `docs/superpowers/plans/2026-11-01-plugin-fase1-pr-1c-0.md` R1-R20, ADR-043) sudah diimplementasi di branch ini; `static/plugins/` tidak berubah. Ringkasan: edit yang hanya mengubah `tasks.ext` kini dikirim sebagai PUT `{ext_patch}` tanpa field inti (K25); `taskExt.setMany` menerapkan semua item optimistis dalam satu render (K24); entitas record baru di `manifest.records` diterima server tanpa restart (K26). SW `taskflow-v496-sinkron-ext`, whatsnew `silent`; `index.html` hanya dua baris versi (46.074 baris, sama dengan `main`); IndexedDB tetap v7.

Penyimpangan dari teks spec atau ledger awal (semuanya dengan bukti di rencana):

- **Penanda `ext_only_rev` terikat `rev` (R1-R2), bukan boolean `ext_only` (H2).** Tab lama berbagi IndexedDB dan menyalin record, jadi boolean ikut tersalin ke edit judul lama dan judul itu hilang. `TF.taskext.extOnlyNow(rec)` (kotor, tidak dihapus, `ext_only_rev === rev`) adalah satu-satunya pembaca; setiap penulis field inti menaikkan `rev` sehingga penanda batal sendiri. Audit penulis store `tasks` (R9) dikunci tes pagar `taskext_writers_fence`.
- **Tanpa jenis op baru (R3).** Bentuk payload diputuskan saat kirim di `opUpdate`. Op `update` basi (record sudah bersih, `dirty` 0) dibuang tanpa request; hanya bila `dirty` 0.
- **Adopsi inti dari respons (R5).** Setelah PUT ext saja, `markPushed` mengadopsi field inti server dari respons di dalam transaksi yang sama dan hanya bila `extOnlyNow(cur)`. Tambahan review akhir: adopsi dilewati bila `cur.base_rev` lebih baru dari `updated_at` respons (respons basi tidak mengembalikan edit anggota lain yang sudah ditarik pull).
- **Jaga daftar pull basi.** Di `syncpull`, record ext saja tidak ditimpa daftar yang lebih tua dari `base_rev` (`serverWins = extOnly ? !(base_rev > s.updated_at) : <aturan lama>`). Cabang record BERSIH yang juga menerima daftar lebih tua adalah utang pra-ada di luar cakupan (tindak lanjut umum).
- **Tag (R8): syarat "tanpa baris `entity_tags` kotor" diganti.** `entity_tags.dirty` tidak pernah dibersihkan, sehingga syarat harfiah mematikan K25 selamanya untuk task yang pernah bertag. Tambah tag lewat `title` (bukan ext saja, penanda batal); hapus tag pada task ext saja segera menaikkan `rev` sehingga PUT penuh dikirim. Tertunda sampai PUT penuh berikutnya hanya untuk task bersih, PUT penuh yang sedang terbang, dan jalur pull R11.
- **`setMany` (K24, R11).** Semua patch diterapkan lebih dulu dalam satu `unstable_batchedUpdates`, lalu tulis berurutan, berhenti pada gagal pertama dengan `err.applied`. Bila gagal di tengah, item yang belum tertulis menampilkan nilai belum tersimpan sampai `refreshTasks` selesai. `set` tunggal tidak berubah.
- **K26 (R13).** `_decl_for` membaca ulang indeks paling sering sekali per 10 dtk (TTL global proses), di luar `write_tx`; cabang throttle memakai deklarasi proses saat ini tanpa baca berkas. Setiap baca ulang yang lolos throttle dicatat sebagai `WARNING` (level INFO tidak tampil di proses web karena `webapp.py` tidak memanggil `basicConfig`).
- **Server minimum >= 1a-1 (#119).** PUT ext saja dengan body `{ext_patch}` butuh server yang menerapkan `ext_patch`; server pra-1a-1 menjawab 400 "No fields to update" dan op gugur. Skenario 3 E2E 1a-1 diubah meneruskan `ext_patch` apa adanya (server pra-1a-1 sudah tidak ada di produksi).
- **Restart hanya `taskflow-web`.** `plugin_records.py` dimuat web saja; bot tidak perlu restart.
- **`setMany` 200 item lambat bukan karena render.** Satu render sudah dicapai (1 commit oleh resolve, 6 oleh `refreshTasks` host); 4,2-4,8 dtk pada CPU 4x berasal dari tulis lokal berurutan dan PUT. Dicatat untuk 1c-1 (target <= 2 dtk di spec belum tercapai).

Risiko residual: **R2** (PUT ext saja menaikkan `updated_at` server sehingga edit inti offline yang lebih tua dari perangkat lain kalah saat pull; dicatat, tidak diselesaikan, tanya pemilik lagi sebelum 1c-1 di-merge; **diselesaikan di PR 1c-0b**, lihat catatan berikutnya) dan **R8** (hapus tag pada task bersih/PUT penuh terbang tertunda; pull task tetap tidak menarik tag).

### Catatan implementasi PR 1c-0b (2026-11-04)

PR 1c-0b (branch `claude/plugin-core-time`, rencana `docs/superpowers/plans/2026-11-01-plugin-fase1-pr-1c-0b.md`, ADR-044) menutup R2. Ringkasan K45-K50: (K45) waktu inti server terikat `updated_at` lewat dua kolom mentah `tasks.ext_core_at`/`ext_only_at` (nullable, tanpa backfill, `migrate_db`); (K46) pembekuan hanya pada PUT ext murni, dihitung di SQL atas baris terkini; (K47) respons memuat `core_updated_at`, kolom mentah dibuang dari respons; (K48) aturan tarik: (1) inti server tidak berubah sejak `base_rev` (bandingkan cap waktu server saja) maka inti lokal menang, lalu (2) LWW memakai waktu inti; (K49) tanpa penyimpanan klien baru (IndexedDB v7, hanya `syncpull.js` berubah); (K50) SW `taskflow-v497-waktu-inti`, whatsnew `silent`, restart `taskflow-web` saja.

- **Q1 (a):** penghapusan offline tetap terhapus (diuji di tingkat pull).
- **S9 laten:** VPS memakai Etc/UTC (dikonfirmasi pemilik 2026-11-04), jadi cap naif server tidak bergeser di produksi; hanya muncul bila zona waktu berubah atau di lingkungan dev (E2E dijalankan dengan `TZ=Asia/Jakarta`).
- **Penyimpangan:** `core_updated_at` tak terbaca/tak terurai membuat klien kembali ke aturan lama (bukan menebak).
- **Residual:** (a) quadrant pada PUT ext murni dihitung ulang dari `existing` basi (pra-1c-0, field turunan, cron memperbaiki); (b) edit inti yang dibuat saat PUT ext-only 1c-0 sedang berjalan memajukan `base_rev` tanpa mengadopsi inti server, sehingga seret oleh perangkat ketiga kemudian mencapai aturan (1) dan PUT penuh A diterapkan sebagai LWW satu record menurut urutan waktu nyata (dapat diterima); aturan (1) mengasumsikan jam server tidak mundur; ekspor `tasks.json` memuat kolom mentah (tanpa pembaca).
- **Bug terpisah, pra-ada:** `PUT` dengan `recurrence_type` valid menghasilkan 500 (`sqlite3.Row.get`); di `main` hari ini setiap PUT penuh task berulang gagal 500. Bukan bagian PR ini; **perbaikan terpisah disarankan sebelum 1c-1**.

### 6.4 Skenario

| Skenario | Hasil |
|---|---|
| A menerapkan Otomatis (30 task), B (sudah 1c, Timeline ON) belum sinkron | B tidak menulis apa pun; setelah tarik, Gantt B menampilkan nilai A; bila data B berbeda (mis. kalender B belum tertarik) → banner drift di B, tanpa tulisan |
| A dan B menekan Terapkan pada data sama | nilai identik → idempoten; LWW per kunci tidak mengubah apa pun |
| A dan B menekan Terapkan pada data berbeda | kunci yang sama: terakhir sampai menang (K4); yang kalah melihat banner drift dan memutuskan sendiri; tidak ada pingpong |
| B mengubah judul task X, A (belum menarik) menerapkan 200 task termasuk X | push A = `{ext_patch}` saja (K25) → judul B bertahan; tarik A: field inti server menang, `ext_dirty` ditempel |
| A offline menerapkan 50 task, lalu online | op tersimpan; drain saat online; pratinjau A sudah memberi catatan "offline" |
| C (Timeline OFF) menyelesaikan task Y di host | tidak ada aliran (C tidak menjalankan plugin); A/B melihat drift penerus Y → "Tinjau" |
| D masih klien 1.0 menyeret task otomatis berpendahulu | D menulis `start` saja (tanpa SNET); klien 1.1 melihat drift; Tinjau/gestur berikutnya mengembalikannya ke ES (pratinjau menampilkannya) |
| Kalender workspace diubah | semua anggota 1.1 melihat drift; tidak ada yang bergeser sampai seseorang menekan Tinjau |
| Dua perangkat membuat A→B dan B→A saat offline | keduanya lolos `checkLink` lokal; setelah sinkron SCC menandai lingkaran, A dan B jadi jangkar, banner "Dependensi melingkar: A, B" dengan tautan ke seksi untuk menghapus salah satu |
| Jendela deploy 1c-1 (indeks baru, proses 1c-0) | POST record `project` → `refresh_known` (K26) → diterima; tanpa restart |
| Jendela deploy 1c-0 (berkas baru, proses lama) | klien baru mengirim `{ext_patch}` saja → server lama menerimanya (sudah sejak 1a-1); record entitas tetap `calendar` → tidak terdampak |

## 7. UI

### 7.1 Toolbar Gantt (mockup `Main.dc.html`)

Urutan: zoom (1b) · **Jadwal otomatis** · **Jalur kritis** · **Baseline** (1c-2) · **Simpan baseline** (1c-2) · **Jadwalkan ulang** · Kalender kerja (1b) · Urutkan · Kolom. Halaman project pribadi: "Jadwal otomatis" = sakelar langsung (menyala → pratinjau). Halaman workspace (Q4 a): tombol membuka popover daftar kelompok project dengan sakelar masing-masing + "Dinyalakan oleh {nama} · {tanggal}". Ringkasan di kanan toolbar: "Selesai {fmtShort(P)}" + chip "{n} lewat tenggat" bila ada. HP ≤ 640 px: Jadwal otomatis, Jalur kritis, Baseline, Jadwalkan ulang masuk menu "Lainnya".

### 7.2 Pratinjau

Dialog `role="dialog"` di dalam wadah view (pola `CalendarPopover`), fokus terjebak, Esc = Batal. Judul sesuai pemicu ("Nyalakan jadwal otomatis — {project}", "Tinjau jadwal otomatis", "Jadwalkan ulang yang belum selesai"). Isi K34; tiap baris bisa dibuka → teks "Kenapa". Tombol **Terapkan** (nonaktif bila 0 item; untuk sakelar dengan 0 item → langsung menyala tanpa dialog, toast "Jadwal otomatis menyala — tidak ada task yang bergeser"). Setelah Terapkan: toast "Jadwal diterapkan · {n} task · Urungkan"; gagal sebagian → "Sebagian jadwal gagal disimpan ({k} dari {n}) · Urungkan" (Urungkan hanya `err.applied`).

### 7.3 Banner drift dan lingkaran

Satu baris di atas grafik (tanpa menggeser header sticky): K35, dan "Dependensi melingkar: {judul}, {judul} — tidak dihitung" dengan tombol yang membuka task pertama. Banner bisa ditutup per sesi.

### 7.4 Kolom, bar, panah

- Kolom Slack (K38); di HP/Live Edit masuk tombol "Kolom".
- Jangkar Manual di project otomatis: ikon pin kecil di sel Nama (`aria-label` "Manual").
- Panah SS (awal→awal), FF (akhir→akhir), SF (awal→akhir): `TLLayout.arrowPath(from, to, type)`; pelanggaran/konflik merah putus-putus (1b).
- Jalur kritis: garis tepi bar + panah kritis tegas.
- 1c-2: bar baseline (tinggi 4 px di bawah bar, `color-mix(in srgb, var(--text-secondary) 45%, transparent)`), tooltip/aria "Baseline: Rab 4 Nov → Sen 9 Nov (+1 hk)"; garis aktual (2 px `--text-primary`) dari mulai aktual sampai selesai aktual/hari ini.
- Legenda + "Jalur kritis", "Baseline", "Aktual" sesuai sakelar.

### 7.5 Seksi Jadwal

- **Tingkat 1** (mode efektif manual): 1b apa adanya. "Selengkapnya" menambah kontrol **Mode** (Manual | Otomatis; keterangan "sama dengan project" pada nilai bawaan) dan, bila task punya penerus otomatis, catatan "Mengubah task ini menggeser {n} task otomatis".
- **Tingkat 2** (otomatis, terlipat; mockup `DetailRingkas.dc.html`): kepala "Jadwal" + chip "Otomatis" + chip "lewat tenggat {n} hk"; baris rentang; baris "menunggu {WBS} (+lag) · diikuti {WBS} · slack {n} · baseline ±{n} hk" (baseline 1c-2); chip "Di jalur kritis"; drift → "Belum mutakhir — hasil hitung {tanggal}. Perbarui".
- **Tingkat 3** (dibuka; mockup `Detail.dc.html`): Mode · Mulai (otomatis: teks + "Ubah" → K33) · Durasi · Selesai · Milestone · % selesai (baca saja) · **Batasan** (Secepatnya (ASAP) / Mulai tidak lebih awal dari (SNET) + tanggal / Harus selesai pada (MFO) + tanggal) · **Dependensi** (bagian "Menunggu" = pendahulu dengan tipe + lag yang bisa diubah, "Diikuti oleh" = penerus dari daftar lengkap, baca saja) · Tambah dependensi · 1c-2: **Mulai aktual / Selesai aktual** (+ "Catat hari ini"), **Baseline vs sekarang** (tabel Mulai/Selesai/Durasi × Baseline/Sekarang/Selisih untuk baseline aktif) · **Kenapa dijadwalkan di sini?** (terlipat) · "Ubah ke Manual". "Beban" = 1d.
- Aliran dari seksi: ≤ 20 turunan → langsung + toast; > 20 → kartu pratinjau ringkas di seksi (5 baris pertama + "dan {n} lainnya", Terapkan/Batal).

### 7.6 Teks UI baru (persis, diperiksa tes)

"Jadwal otomatis", "Otomatis", "Manual", "sama dengan project", "Nyalakan jadwal otomatis — {project}", "Tinjau jadwal otomatis", "Terapkan", "Batal", "{n} task bergeser", "baru dijadwalkan", "durasi berubah", "Tidak dipindah", "Selesai project {lama} → {baru}", "{n} lewat tenggat", "Jadwal diterapkan", "Jadwal diubah · {n} task ikut bergeser", "Sebagian jadwal gagal disimpan ({k} dari {n})", "Data berubah sejak pratinjau dibuka — hitung ulang", "Kamu sedang offline — jadwal dihitung dari data di perangkat ini", "Jadwal otomatis menyala — tidak ada task yang bergeser", "Jadwal otomatis dimatikan — tanggal tetap seperti sekarang", "Jadwal otomatis belum mutakhir: {n} task berbeda dari hasil hitung.", "Tinjau", "Belum mutakhir — hasil hitung {tanggal}.", "Perbarui", "Dependensi melingkar", "Tidak bisa lebih awal dari dependensinya", "Dinyalakan oleh {nama}", "Jalur kritis", "Di jalur kritis", "Slack", "Batasan", "Secepatnya (ASAP)", "Mulai tidak lebih awal dari", "Harus selesai pada", "Menunggu", "Diikuti oleh", "Selesai → Mulai (FS)", "Mulai → Mulai (SS)", "Selesai → Selesai (FF)", "Mulai → Selesai (SF)", "Kenapa dijadwalkan di sini?", "Ubah ke Manual", "Jadwalkan ulang", "Jadwalkan ulang yang belum selesai", "{n} dependensi akan dilanggar", "durasi belum diisi, dianggap 1 hari kerja"; 1c-2: "Baseline", "Simpan baseline", "Baseline {n}", "Tidak ada", "Timpa {nama} (disimpan {tanggal})?", "Baseline terlalu besar", "Menunggu data baseline workspace…", "Baseline vs sekarang", "Sekarang", "Selisih", "Mulai aktual", "Selesai aktual", "Catat hari ini", "Belum dicatat", "Aktual".

## 8. Kasus tepi

| Kasus | Perilaku |
|---|---|
| Task dikunci Manual di project otomatis | jangkar; penerusnya mengikuti nilai tersimpannya; pelanggaran ke pendahulunya ditandai (bukan dipindah) |
| Task tanpa Mulai, punya pendahulu, project otomatis | dijadwalkan di pratinjau ("baru dijadwalkan"), durasi 1 bila tidak ada |
| Task tanpa Mulai, tanpa pendahulu | "Belum dijadwalkan", tidak disentuh |
| Task tanpa durasi (kunci hilang) | dianggap 1 (R7 1b) + catatan di pratinjau |
| Lingkaran lama / dari dua perangkat | SCC → jangkar + banner; tidak menggantung |
| Task selesai | jangkar, ES/EF dari aktual/`completed_at`; tidak pernah ditulis mesin; slack "—" |
| Task sudah mulai | Mulai dikunci; durasi hanya berubah lewat Jadwalkan ulang |
| Tenggat sebelum selesai hasil hitung | tidak memindah; slack negatif, bendera merah (1b), "lewat tenggat" di pratinjau/seksi |
| MFO bertabrakan dengan pendahulu | MFO menang; konflik ditandai; "Tidak dipindah: batasan bertabrakan" |
| SNET di hari libur | `nw(date)` untuk durasi ≥ 1 |
| Dependensi ke ringkasan / di luar scope / task terhapus | diabaikan mesin, alasan di "Kenapa" dan seksi (1b: "(task di luar halaman ini)", "(task sudah dihapus)") |
| Task pindah project/workspace | mode efektif ikut unit baru; dependensi lintas scope jadi diabaikan |
| Project diganti nama | id record berubah → unit kembali Manual (tanggal tetap); baseline lama tidak terlihat (tetap tersimpan) — dicatat di "Di luar cakupan" |
| Task berulang/arsip | dikecualikan (1b) |
| Filter panel aktif | mesin memakai daftar lengkap; baris tersembunyi tetap dihitung |
| Daftar lengkap belum/ gagal dimuat | Slack/kritis/banner/sakelar disembunyikan; gestur berperilaku Manual (tanpa aliran) + toast "Jadwal gagal disimpan" bila gestur butuh aliran |
| Data libur berbeda versi antar perangkat | hasil berbeda → drift di perangkat yang berbeda; tidak ada tulisan otomatis |
| Jam perangkat salah | hanya memengaruhi T (Jadwalkan ulang) dan tanggal "Catat hari ini"; pratinjau menampilkan "Hari ini: {tanggal}" |
| Offline | semua jalan; pratinjau memberi catatan offline |
| Timeline OFF di perangkat/anggota lain | tidak menulis; edit host mereka hanya menimbulkan drift |
| Kalender buntu (`TL_CAL_LOOP`) | simpul "tak terhitung", tanpa bar (1b) |
| 1.000+ task di satu unit | mesin tetap jalan (O(V+E)); baseline ditolak > 64 KB |
| Rentang ±1830 hari (deviasi R22 1b) | mesin tidak dijepit; hanya tampilan |

## 9. Pengujian

**`node --test` (baru/ubah):**
- `timeline_cpm.test.js` — vektor tetap (tanpa "hari ini") untuk FS/SS/FF/SF × lag −2..3 × milestone, libur nasional/cuti/tambahan/pengganti; identitas `ES = LS` rantai; slack negatif dari tenggat; LF per kelompok project; jangkar manual/selesai/sudah mulai/MFO/SNET; konflik; SCC (2-lingkaran, sisi diri, lingkaran dengan hilir); ringkasan/luar-scope/ref hilang diabaikan; **determinisme** 50 permutasi acak (benih tetap) → hasil identik; kinerja 500/400 median ≤ 10 ms dicatat, asersi ≤ 150 ms.
- `timeline_plan.test.js` — diff hanya yang berubah; aliran hanya hilir (drift lain tidak ikut); ambang 20; sakelar ON/OFF; Jadwalkan ulang (belum mulai → SNET T / start T; sudah mulai → durasi sisa; selesai tetap; Manual tanpa aliran + hitung pelanggaran); CAS revalidate; Urungkan persis; `explain` (struktur + teks contoh mockup); 1c-2: encode/decode/ukuran baseline, compare, `actualOf` (`completed_at` 23:30 UTC → tanggal Jakarta besoknya).
- `timeline_schedule.test.js` (tambah) — `readSched`/`sanitizePatch` tipe dependensi, `mode`, `constraint`, `actual`; `unitOf` (hash, `-`, pola id, penjaga nama).
- `timeline_ui.test.js` / `timeline_section.test.js` (tambah) — **0 tulisan** pada mount, `sync.done`, `pulled`, `onChange`, `app.dayChanged`, perubahan kalender; sakelar → pratinjau → Terapkan = satu `setMany`; gestur → `set`/`setMany` + toast; > 20 → pratinjau; seksi tingkat 1/2/3; teks §7.6; DOM 500/400 ≤ 1.500 dengan Jalur kritis + baseline.
- 1c-0: `plugin_taskext_api.test.js` (`setMany` memanggil `patchTaskExt` semua item di dalam satu `unstable_batchedUpdates`, `err.applied`); `taskrepo_ext.test.js`, `syncpush_ext.test.js`, `syncpull_ext.test.js` (`ext_only` diset/dibersihkan; payload ext saja hanya bila syarat K25; tag kotor → payload penuh; pull `ext_only` → server inti menang); **tes pagar** penulis store `tasks`.

**pytest:** `tests/test_plugin_records.py` + entitas baru di indeks setelah proses mulai → POST diterima tanpa restart; tetap tak dideklarasikan → `INVALID entity`; pembacaan ulang dibatasi 10 s. Semua tes lama `syncpush`/`syncpull` lulus tanpa ubah asersi.

**E2E (Playwright, `temporary_files/`):** dua konteks satu workspace (A menyalakan Otomatis + Terapkan; B: 0 PUT task dari B selama 2 siklus sinkron, Gantt B sama setelah tarik); A menerapkan saat B baru mengubah judul (judul B bertahan); konteks klien 1.0 + 1.1 (1.0 menyeret → drift di 1.1); 200 task Terapkan pada CPU 4× (lokal ≤ 2 s, satu render — hitung commit React lewat profiler) dan drain pada RTT 150 ms (dicatat, K23); 500/400 render awal ≤ 150 ms + mesin ≤ 40 ms; 375 px (menu Lainnya, seksi tingkat 2); Sakura gelap; offline Terapkan lalu online.

## 10. Rilis dan rollback

| PR | SW / whatsnew | Restart | `index.html` |
|---|---|---|---|
| 1c-0 | bump; `{"silent": true}` | **`taskflow-web`** (`plugin_records.py`); bot tidak | +0 |
| 1c-1 | bump; non-silent, draf: judul "Timeline: jadwal otomatis dan jalur kritis"; poin "Nyalakan Jadwal otomatis per project: task mengikuti dependensinya, selalu lewat pratinjau.", "Lihat jalur kritis dan slack untuk tahu task mana yang tidak boleh terlambat.", "Dependensi kini bisa Mulai–Mulai, Selesai–Selesai, dan Mulai–Selesai.", "Jadwalkan ulang task yang terlambat ke setelah hari ini dalam satu langkah." (teks final disetujui pemilik di rencana) | tidak | +0 |
| 1c-2 | bump; non-silent, draf: "Timeline: baseline dan progres aktual" | tidak | +0 |

Semua PR: checklist PROTOCOL §4 (CACHE + `__SW_VERSION` + fallback, entri `whatsnew.json` teratas), `app.css?v=383` tetap, IndexedDB v7 tetap, `node compile.js --plugins-only` idempoten.

**Rollback.** 1c-0 = revert sebagai rilis baru + restart `taskflow-web`; kunci `ext_only` di record lokal diabaikan kode lama (payload penuh lagi); tidak ada data hilang. 1c-1 = matikan plugin (tanpa deploy) atau revert ke 1.0.0 sebagai rilis baru: kunci `mode`/`constraint` dan record `project` dibiarkan (1.0 mengabaikannya); tanggal yang sudah diterapkan tetap; dependensi SS/FF/SF tampil "rusak atau tidak dikenali versi ini" di 1.0 dan **tidak** dihapus kecuali pengguna menekan "Hapus dependensi rusak" — catatan rilis rollback harus menyebutnya. 1c-2 = revert ke 1.1.0: record `baseline` dan `timeline.actual` dibiarkan.

## 11. Risiko dan mitigasi

| # | Risiko | Mitigasi |
|---|---|---|
| R1 | **Penulisan massal mengembalikan perubahan field inti anggota lain** (payload penuh dari salinan basi) | K25 (push ext saja + pull inti server menang) di 1c-0, sebelum fitur massal mana pun; tes pagar penulis; E2E judul bertahan |
| R2 | **Sisa arah sebaliknya:** PUT ext saja tetap menaikkan `tasks.updated_at` server, sehingga edit inti **offline** perangkat lain yang lebih tua dari Terapkan kalah LWW saat tarik (`syncpull.js:321`) | **Diselesaikan di PR 1c-0b (ADR-044):** server menyimpan waktu inti terikat `updated_at` (`core_updated_at`), PUT ext murni tidak menaikkannya, tarik memakai waktu inti. Residual: lihat "Catatan implementasi PR 1c-0b" |
| R3 | Audit `ext_only` terlewat satu penulis → perubahan inti tidak terkirim | default aman (`ext_only` tidak ada = payload penuh); syarat tambahan tag kotor; tes pagar memindai semua penulis store `tasks`; review fokus |
| R4 | Anggota dengan klien 1.0 menghapus dependensi SS/FF/SF lewat "Hapus dependensi rusak" | jendela singkat (SW memperbarui klien; plugin ikut hash); teks 1.0 sudah "tidak dikenali versi ini"; catatan rilis |
| R5 | Drift banner sering muncul di workspace aktif → pengguna jenuh | banner bisa ditutup per sesi; jumlah task disebut; tidak ada tulisan otomatis sebagai gantinya |
| R6 | Kinerja render melampaui 150 ms karena mesin | K43 mesin setelah gambar pertama + memo; prefiks hari kerja bila perlu |
| R7 | Drain 200 PUT lama di jaringan lemah | K23 diukur; op dapat dilanjutkan; pemicu PR batch generik |
| R8 | Ganti nama project memutus record project/baseline | aman (kembali Manual, data tetap); tercatat; pemetaan ke `project_id` bila host mengekspos project ke plugin |
| R9 | Rumus SF/FF salah di tepi milestone/hari libur | tabel vektor + identitas ES = LS + review fokus mesin |
| R10 | 1c-0 lupa di-restart | K26 tidak aktif → record `project` 1c-1 mendapat `INVALID entity` di proses lama; checklist deploy 1c-0 + verifikasi `POST` entitas baru sebelum merge 1c-1 |

## 12. Di luar cakupan 1c

Endpoint batch dan modul server Timeline; "Lihat di Timeline" dari seksi (butuh `api.ui.navigate` ke `proj_*`/`slist_*` + pilihan view); chip di header detail host; batasan ALAP/MSO/FNLT/SNLT/FNET; tanggal mulai project dan "geser seluruh project"; split pekerjaan sisa (`timeline.split`, 1d); beban/kapasitas/leveling dan earned value (1d); dependensi ke ringkasan dan lintas workspace; notifikasi perubahan jadwal; LWW per kelompok field task (R2); pemetaan unit jadwal ke `project_id`; status plugin per workspace; perhitungan jadwal di server.

## 13. Keputusan untuk pemilik

1. **Q1 — Pembagian PR 1c.** (a) Tiga PR: 1c-0 perbaikan dasar (tidak terlihat, butuh restart `taskflow-web` sekali), 1c-1 jadwal otomatis + jalur kritis, 1c-2 baseline + catatan aktual; (b) dua PR (perbaikan dasar digabung ke 1c-1); (c) satu PR besar. **Rekomendasi: (a).** Perbaikan dasar menyentuh pengiriman data task untuk semua pengguna, jadi harus bisa dibatalkan tanpa ikut membatalkan Timeline; setelah itu 1c-1/1c-2 tidak butuh restart lagi.
2. **Q2 — Saat kamu menggeser task di project otomatis, task-task sesudahnya…** (a) langsung ikut bergeser, dengan tombol Urungkan di notifikasi; pratinjau hanya bila lebih dari 20 task ikut bergeser; (b) selalu tampilkan pratinjau dulu; (c) tidak ikut bergeser — jadwal hanya diperbarui lewat tombol "Tinjau". **Rekomendasi: (a).** Begitulah "otomatis" terasa (seperti Microsoft Project), tetap aman karena hanya task yang tersambung ke task yang kamu geser yang berubah dan semuanya bisa diurungkan sekali klik.
3. **Q3 — Di workspace bersama, siapa yang boleh menyalakan Jadwal otomatis, menerapkan pratinjau, dan menyimpan baseline?** (a) Semua anggota yang menyalakan Timeline (seperti kalender kerja sekarang), dengan keterangan "Dinyalakan oleh {nama}"; (b) hanya pemilik workspace — tetapi pembatasan ini hanya di tampilan, anggota lain tetap bisa menggeser task satu per satu. **Rekomendasi: (a).** Sejalan dengan keputusan Timeline sebelumnya; (b) memberi rasa aman semu dan butuh aturan peran yang belum ada di Alurik.
4. **Q4 — Di halaman workspace, sakelar "Jadwal otomatis" berlaku untuk…** (a) tiap project di dalam workspace sendiri-sendiri (seperti mockup: sakelar di samping nama project); dependensi antar-project tetap dihormati; (b) seluruh workspace sekaligus, satu sakelar. **Rekomendasi: (a).** Tim sering punya satu project yang sudah pasti dan satu yang masih cair; (a) membiarkan keduanya hidup berdampingan tanpa biaya teknis tambahan.
5. **Q5 — Mencatat tanggal mulai dan selesai sungguhan (bukan rencana).** (a) Otomatis dari aksi nyata: tanggal mulai tercatat saat pomodoro pertama selesai untuk task itu atau saat progres pertama diisi di detail task; tanggal selesai = hari task ditandai selesai; keduanya bisa diubah, dan bila terlewat muncul tombol "Catat"; (b) hanya manual lewat tombol "Catat hari ini"; (c) tidak dicatat terpisah — hanya tanggal selesai dari centang. **Rekomendasi: (a).** Hampir tanpa usaha bagi pengguna, tidak pernah menimpa tanggal yang sudah ada, dan tidak ditulis diam-diam oleh perangkat lain; tanggal sungguhan inilah yang membuat jadwal otomatis berhenti memindahkan task yang sudah berjalan.
