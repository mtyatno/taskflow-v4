# Spec: Checklist bertingkat Fase 2 — checklist local-first (offline)

- **Tanggal:** 2026-11-11
- **Basis kode:** `main` @ `155ee07` (SW `taskflow-v502-checklist-bertingkat`; ADR terakhir ADR-049; ADR-050 dipesan rencana PR 1d-2).
- **Status:** **DISETUJUI pemilik 2026-11-11** — pertanyaan klarifikasi, pendekatan A, dan ketiga bagian desain disetujui satu per satu dalam sesi brainstorming. **PR A2 (server) diimplementasikan 2026-11-11** di branch `claude/checklist-offline-server` (lihat "Catatan implementasi PR A2"); berikutnya PR B2 (aplikasi).
- **Fase 1:** `docs/superpowers/specs/2026-11-06-checklist-bertingkat-design.md` (K1–K17, D1–D11, catatan implementasi PR A/PR B), ADR-048. Fase 2 = K4 Fase 1 ("checklist local-first lewat outbox dan sinkron, spec terpisah").
- **Istilah:** sama dengan Fase 1 (*butir*, *level atas*, *turunan*, *saudara*, *pre-order*), ditambah:
  - *antrean* = outbox lokal (`_outbox`, `static/offline/outbox.js`);
  - *aksi checklist* = satu entri antrean `entity_type: "subtasks"`;
  - *rev server* = `tasks.checklist_rev`; *rev tersimpan* = versi checklist terakhir yang sudah diambil perangkat untuk task itu.

---

## 1. Tujuan

Checklist (dengan semua kemampuan Fase 1: tambah, Tab/Shift+Tab, seret, Alt+↑/↓, menu ⋯, centang berantai, hapus berantai, lipat, progress otomatis) **bisa dipakai penuh saat offline**, dan perubahannya terkirim otomatis saat tersambung lagi.

**Kriteria berhasil**
1. Saat offline, checklist task mana pun yang punya checklist tampil dan bisa diubah; perubahan tetap ada setelah halaman dimuat ulang.
2. Saat tersambung lagi, server dan perangkat lain sama dengan hasil di perangkat itu (urutan, tingkat, centang, teks), tanpa butir ganda.
3. Progress task (daftar, pill, Timeline) ikut berubah saat offline dan tidak "melompat balik" ke angka lama saat sinkron.
4. Task yang dibuat offline bisa langsung diberi checklist.
5. Perubahan yang tidak bisa diterapkan karena checklist sudah berubah di perangkat lain dibatalkan, dengan **satu** pesan.
6. Aplikasi versi sebelumnya (v502) tetap berjalan dengan server baru.

## 2. Keputusan

**Jawaban pemilik (2026-11-11)**

| # | Keputusan |
|---|---|
| F1 | **Semua** task bercheklist tersedia offline (diunduh sejak awal), bukan hanya yang pernah dibuka. |
| F2 | Task yang dibuat offline **boleh** langsung diberi checklist; terkirim setelah task-nya terkirim. |
| F3 | Perubahan offline yang ditolak server (butir/induk sudah dihapus atau berubah di perangkat lain) **dibatalkan + satu pesan** "N perubahan checklist dibatalkan…". |
| F4 | **Checklist saja**; Catatan task offline = fitur terpisah. |
| F5 | **Pendekatan A**: antrean aksi (tambah, ubah teks, pindah, centang, hapus) dikirim berurutan + versi checklist per task (`checklist_rev`) untuk mengambil ulang hanya yang berubah. Ditolak: B (status per butir — urutan lemah), C (snapshot utuh — bentrok di workspace). |
| F6 | Tanda "belum terkirim" memakai **indikator sinkron global yang sudah ada** (menghitung seluruh antrean); tanpa tanda per butir. |
| F7 | Rilis **dua PR berurutan**: PR A2 server, lalu PR B2 aplikasi. |

**Keputusan desain (disetujui bersama bagiannya)**

| # | Keputusan | Alasan |
|---|---|---|
| E1 | `tasks.checklist_rev` = field turunan server (ditulis bersama operasi checklist, **tanpa** `updated_at`), diambil klien lewat `TASK_DERIVED`. | Sama dengan `progress`/`checklist_total` (ADR-048): centang anggota workspace tidak memicu konflik task. |
| E2 | Setiap transaksi tulis checklist yang **mengubah sesuatu** menaikkan rev **tepat 1**; pemulihan pohon (`_heal_task_tree`) yang mengubah sesuatu menaikkan rev 1 **tersendiri**; operasi tanpa perubahan tidak menaikkan. | Aturan klien: rev tersimpan dimajukan hanya bila `rev_bumped` **dan** `rev` = tersimpan + 1; selain itu dikosongkan (ambil ulang) — kecuali `rev` = tersimpan (tidak ada perubahan di server) → tetap. `rev_bumped` (di `task_progress`) = aksi itu sendiri yang menaikkan rev; `rev` = tersimpan + 1 saja tidak cukup, karena aksi tanpa perubahan bisa membawa kenaikan milik perangkat lain (perbaikan review S1). |
| E3 | Centang offline dikirim sebagai `PATCH {is_done}` (set, bukan toggle). | Toggle tidak aman diulang: pengiriman ulang setelah koneksi putus bisa membalik centang. |
| E4 | Idempotensi tambah: `client_id` dicari **per task**. | Pengiriman ulang tambah tidak menggandakan butir; menutup residual Fase 1 (`client_id` lintas task). |
| E5 | Task yang masih punya aksi checklist di antrean **tidak** diambil ulang checklist-nya dan **tidak** mengadopsi `progress`/`checklist_total` dari server. | Pull berjalan sebelum push dalam satu siklus sinkron; tanpa ini hasil offline tertimpa angka/isi lama lalu "melompat". |
| E6 | Rute lokal melayani **semua** endpoint checklist yang dipakai `ChecklistTree`; respons meniru bentuk server. | Tampilan tidak perlu tahu online/offline; `ChecklistTree` nyaris tidak berubah. |
| E7 | Butir yang belum terkirim memakai `cid` sebagai `id`; rute menerima id server maupun `cid`. | Pola task (`id` = cid sebelum tersinkron). |

## 3. Server (PR A2)

### 3.1 Data
- `tasks.checklist_rev INTEGER DEFAULT 0` (migrasi kolom di `_init_db`, pola `checklist_total`).
- Naik sesuai E2 di setiap operasi repository: `add_subtask`, `rename_subtask`, `move_subtask`, `toggle_subtask`, `update_subtask` (baru; judul dan/atau centang set), `delete_subtask`, dan `heal_checklists` (per task yang dipulihkan). Termasuk aksi dari bot (bot memakai repository yang sama).
- `migrate_db()`: task yang punya butir tetapi `checklist_rev = 0` → `1` (idempoten; tanpa `updated_at`). `recompute_all` tidak menyentuh rev.
- Ikut di semua respons task (`dict(row)`), dan `task_progress` mendapat field `rev` (nilai kolom sesudah operasi) dan `rev_bumped` (bool: operasi itu sendiri menaikkan rev; pemulihan pohon tidak dihitung; `false` untuk tambah dengan `client_id` yang sudah ada, teks sama, posisi sama, centang set tanpa perubahan).

### 3.2 Endpoint
| Endpoint | Perubahan |
|---|---|
| **Baru** `GET /api/checklists?task_ids=1,2,3` | `{"<task_id>": {"rev": n, "items": [...]}}`; `items` = bentuk `GET /api/tasks/{id}/subtasks` (pre-order, `parent_id` efektif, `depth`). Maksimal **200** id (lebih → 400, teks pola `child-counts`); id bukan angka → 400; task tak ada / tanpa akses → dilewati. Baca saja (tanpa pemulihan pohon tulis). |
| `PATCH /api/subtasks/{id}` | Body: `title` dan/atau `is_done` (minimal satu; kosong → 422 "Tidak ada perubahan"). `is_done: true` → butir + semua turunan selesai; `false` → hanya butir itu (sama dengan toggle). Keduanya dalam satu transaksi, rev +1 bila ada yang berubah. Respons = butir + `changed_ids` + `task_progress` (dengan `rev` dan `rev_bumped`). Akses tulis seperti sekarang. |
| `POST /api/tasks/{id}/subtasks` | Idempotensi `client_id` per task (E4). `client_id` yang sudah dipakai task lain disimpan sebagai `"<task_id>:<client_id>"` (indeks unik global tidak diubah); pengiriman ulang tetap idempoten. |
| Lainnya | Respons yang membawa `task_progress` kini memuat `rev` dan `rev_bumped`. Toggle dan perilaku lain tidak berubah. |

### 3.3 Kompatibilitas
- Aplikasi v502 mengabaikan `checklist_rev` dan `rev`; tidak memakai endpoint baru.
- Bot: tidak berubah (rev ikut naik lewat repository).

## 4. Aplikasi (PR B2)

### 4.1 Penyimpanan lokal
- Store `subtasks` (sudah ada di `db.js`, indeks `task_cid`, `server_id`, `dirty`) diisi record `{cid, server_id, task_cid, parent_cid, title, is_done, sort_order, created_at}`. `parent_cid` = `cid` induk (null = level atas).
- Pemetaan `cid ↔ id server` lewat `_idmap` jenis `"subtask"`.
- Rev tersimpan per task di `_meta` (kunci `checklist_revs`: `{task_cid: rev}`), terpisah dari record task (record task bisa ditulis ulang penuh oleh pull).
- `checklist_rev` masuk `TASK_DERIVED`, `ONLY_IF_SENT`, dan `COPY` (`hydrate.js`).

### 4.2 Mengambil dari server (`pullChecklists`, langkah sinkron baru setelah pull task, sebelum push)
1. Task lokal yang punya `server_id`, `checklist_rev` server ≠ rev tersimpan, dan **tanpa** aksi checklist di antrean (E5).
2. Ambil lewat `GET /api/checklists` (200 per permintaan). Unduhan awal = jalur yang sama (rev tersimpan kosong).
   - **Rev server 0 dan belum ada rev tersimpan → simpan 0 tanpa mengunduh** (server menjamin task yang punya butir selalu rev ≥ 1). Task yang baru terkirim dari perangkat ini (dibuat offline) langsung disimpan rev 0 supaya respons aksi pertamanya bisa memajukan rev tanpa ambil ulang.
3. Ganti isi checklist task itu dalam **satu transaksi**: butir yang sudah dikenal (`server_id` di idmap) mempertahankan `cid`; butir baru mendapat `cid` baru; butir lokal yang tidak ada lagi di server dihapus. Lalu rev tersimpan = rev server.
4. Gagal jaringan/5xx → dilewati tanpa menggagalkan siklus sinkron; dicoba lagi siklus berikutnya.
5. Task yang hilang dari server (dihapus/akses dicabut, dideteksi pull task) → butir lokal dan aksi antreannya dibuang.

### 4.3 Rute lokal (modul baru `checklistroutes.js` + `checklistrepo.js`)
| Rute | Perilaku lokal |
|---|---|
| `GET /api/tasks/:id/subtasks` | Dilayani lokal bila task punya rev tersimpan, task belum tersinkron, atau ada butir lokal; selain itu diteruskan ke jaringan (perilaku sekarang). Respons pre-order dengan `id`/`parent_id` = id server bila ada, selain itu `cid`. |
| `POST /api/tasks/:id/subtasks` | Butir baru (`cid` baru) di posisi `parent_id`/`index`; antrean `create`. |
| `PATCH /api/subtasks/:id` | `title` → antrean `rename`; `is_done` → centang berantai lokal + antrean `set_done`. |
| `POST /api/subtasks/:id/toggle` | Centang/buka lokal + antrean `set_done` (bukan toggle). |
| `POST /api/subtasks/:id/move` | `TF.checklist.applyMove` lokal + antrean `move`. |
| `DELETE /api/subtasks/:id` | Hapus berantai lokal + antrean `delete`; bila butir itu belum pernah terkirim, aksi `create`-nya (dan semua aksi turunannya) dibuang dan tidak ada `delete`. |

- Semua aksi memakai `TF.checklist` (Fase 1) sehingga hasil lokal = hasil server. Galat validasi lokal (induk tidak ada, siklus, judul kosong) → 422 berteks sama dengan server.
- Respons meniru server (`items`, `changed_ids`, `deleted_ids`, `task_progress {done, total, progress}` dihitung lokal; tanpa `rev`).
- Setelah setiap aksi, `progress`/`checklist_total` task lokal ditulis (tanpa `dirty`/`rev`/`base_rev`, dengan cap `checklist_adopted_at`) → daftar task dan Timeline ikut saat offline.
- Pembanding urutan `TF.checklist` menerima id campuran: angka sebelum teks; teks menurut abjad (hanya relevan lokal).

### 4.4 Antrean (handler push `subtasks` di `syncpush.js`)
- Bentuk entri: `{entity_type: "subtasks", cid: <cid butir>, task_cid, op: "create"|"rename"|"set_done"|"move"|"delete", payload}`; payload `create {title, parent_cid, index}`, `rename {title}`, `set_done {is_done}`, `move {parent_cid, index}`.
- Dikirim berurutan (`qid`). Menunggu bila task (`task_cid`) atau induk (`parent_cid`) masih punya `create` tertunda (pola `parentCreatePending`).
- Endpoint: `create` → `POST /api/tasks/{tsid}/subtasks {title, client_id: cid, parent_id, index}`; `rename`/`set_done` → `PATCH`; `move` → `POST …/move`; `delete` → `DELETE`.
- Berhasil: `create` → idmap + `server_id`; adopsi `task_progress` (pola Fase 1 + `rev`/`rev_bumped`); rev tersimpan dimajukan hanya bila `rev_bumped` **dan** `rev` = tersimpan + 1; selain itu dikosongkan (ambil ulang) — kecuali `rev` = tersimpan (tidak ada perubahan di server) → tetap. Rev yang dikosongkan membuat task diambil ulang saat antreannya kosong. Respons tanpa `task_progress` (`delete` 404) → dikosongkan.
- Galat sementara (jaringan, 5xx, 401, 429) → aksi tetap, siklus berhenti seperti entitas lain.
- Ditolak (403, 404, 422; kecuali `delete` 404 = berhasil) → aksi dibuang, aksi lain pada butir yang tak punya id server dan tak punya `create` tertunda ikut dibuang, rev tersimpan task itu dikosongkan, dan penghitung pembatalan naik.
- Akhir `pushOutbox`: bila penghitung > 0 → satu event → toast "N perubahan checklist dibatalkan karena checklist sudah berubah di perangkat lain."
- Task dihapus lokal → butir dan aksi checklist-nya dibuang.

### 4.5 Tampilan
- `ChecklistTree`: hapus penjaga "task belum tersinkron → tanpa panggilan"; rute lokal yang melayani.
- Indikator sinkron global (menghitung `outboxAll().length`) otomatis ikut (F6).
- Tidak ada perubahan perilaku lain dari Fase 1.

## 5. Kasus tepi

- **Pull sebelum push dalam satu siklus:** E5 mencegah isi/progress lokal tertimpa.
- **Perangkat baru yang langsung offline:** checklist belum pernah diunduh → `GET` diteruskan ke jaringan → gagal → pill tetap terkunci (Fase 1 `lockFor` `failed`).
- **Dua perangkat offline mengubah checklist yang sama:** aksi diputar ulang berurutan di server; yang terakhir menang per aksi; aksi yang tidak berlaku lagi dibatalkan (F3). Posisi pindah dihitung dari daftar perangkat masing-masing (sama dengan Fase 1 §10).
- **Bot mengubah checklist saat perangkat offline:** rev server naik; perangkat mengambil ulang setelah antreannya terkirim.
- **Pemulihan pohon di server** saat aksi diputar ulang (data rusak): rev naik 2 → perangkat mengambil ulang.
- **Antrean besar** (ratusan aksi): dikirim berurutan seperti entitas lain; tidak ada batas baru.
- **Logout:** perilaku penyimpanan lokal mengikuti entitas lain (tidak berubah).

## 6. Pengujian

- **pytest (PR A2):** rev +1 per operasi termasuk berantai; operasi tanpa perubahan tidak menaikkan; pemulihan menaikkan tersendiri; tanpa `updated_at`; migrasi rev task lama (idempoten); `GET /api/checklists` (bentuk, batas 200, id tidak sah, akses per task, task tak dikenal); `PATCH {is_done}` (berantai, aman diulang, kombinasi dengan `title`, body kosong); `client_id` per task (termasuk bertabrakan lintas task); `task_progress.rev` dan `rev_bumped` di semua respons; `merge_db.py` menaikkan rev task penerima butir.
- **node --test (PR B2):** rute lokal (tiap endpoint, bentuk respons, galat 422, progress lokal, id campuran); antrean (urutan, menunggu task/induk, tambah-lalu-hapus dibuang, galat sementara vs ditolak, `delete` 404, toast sekali); `pullChecklists` (lewati task berantrean, ganti isi + pertahankan `cid`, hapus butir hilang, batch 200, gagal tidak menggagalkan siklus); balapan pull vs aksi lokal; vektor Fase 1 tetap lulus.
- **E2E (PR B2):** offline → tambah, Tab, seret, centang, hapus → muat ulang offline → tetap ada → online → server + perangkat kedua sama; task baru offline + checklist; bentrok dengan perangkat lain → satu pesan; perangkat baru mengunduh semua checklist; `e2e_checklist_tree.py` tetap lulus.

## 7. Rilis (F7)

- **PR A2 (server):** §3 + ADR (nomor berikutnya yang bebas; ADR-050 dipesan 1d-2 → pakai **ADR-051**). Deploy: cadangkan `taskflow.db` (`./backup.sh`) sebelum merge, workflow, lalu `sudo systemctl restart taskflow taskflow-web`.
- **PR B2 (aplikasi):** §4 + SW berikutnya (v503 atau v504 tergantung PR 1d-2) + entri "Apa yang baru" (draf: "Checklist kini bisa dipakai saat offline. Perubahan terkirim otomatis begitu tersambung lagi."). Deploy statis.

## 8. Di luar cakupan

- Catatan task offline (F4), memindah butir antar task, urungkan (undo), tanda "belum terkirim" per butir (F6).

## Catatan implementasi PR A2 (server) — 2026-11-11

Branch `claude/checklist-offline-server`; rencana `docs/superpowers/plans/2026-11-11-checklist-offline-pr-a2-server.md`; ADR-051.

- **Indeks unik global `idx_subtasks_client_id` sudah ada** (tabel fakta rencana keliru). Idempotensi tambah dicari per task (`client_id` asli atau berprefiks `"<task_id>:"`); `client_id` yang sudah dipakai task lain disimpan berprefiks, sehingga pengiriman ulang tetap idempoten tanpa ubah skema. **PR B2: cid butir tidak boleh dipakai ulang lintas task** (mis. saat menduplikasi task).
- **`task_progress.rev_bumped`** (tambahan atas review): E2/§4.4 kini memakai sinyal ini, karena aturan "rev = tersimpan + 1" saja keliru bila aksi klien ternyata tanpa perubahan (kenaikan itu milik perangkat lain).
- **Akses batch** memakai satu kueri dengan aturan setara `_can_access_task` (diuji kesetaraannya untuk semua kombinasi akses); endpoint `def` (threadpool). 200 task × 30 butir ≈ 90–160 ms.
- **Kenaikan rev pemulihan** ada di dalam `_heal_task_tree` (semua pemanggil ikut); gagal 422 me-rollback kenaikannya.
- **`merge_db.py`** menaikkan `checklist_rev` task penerima butir (tujuan wajib sudah dimigrasi).
- **Sesudah review akhir:** kirim ulang tambah butir tidak mengirim notifikasi workspace lagi (hanya bila `rev_bumped`); `client_id` kosong/spasi = tanpa `client_id` (sebelumnya 500); ADR-051 memuat aturan rollback (aman hanya sebelum B2; deploy ulang menaikkan rev semua task bercheklist sekali).
- **Angka:** pytest 1765 passed / 1 skipped (basis 1674 / 1); `import webapp, bot` OK; E2E klien v502 `e2e_checklist_tree.py` 152/152 terhadap server baru.
