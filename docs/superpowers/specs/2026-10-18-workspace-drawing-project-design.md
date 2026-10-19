# Spec: Drawing & Project sebagai entitas workspace

- **Tanggal:** 2026-10-18
- **Basis kode:** `main` @ `2bca256` (mtyatno/taskflow-v4)
- **Status:** **Disetujui seluruhnya** (2026-10-18). Hak kelola project: **opsi C** (§5.2).
- **Salinan:** repo `docs/superpowers/specs/2026-10-18-workspace-drawing-project-design.md` dan Project claude.ai "alurik" `claude/spec-workspace-drawing-project-2026-10-18.md`. Isi keduanya sama.
- **Istilah:** "workspace" = `shared_lists` di kode; "W" = satu workspace tertentu; "scope" = pribadi atau satu workspace; "penerbit" = pemilik note yang dipublish (hanya pemilik note yang bisa publish).

---

## 1. Prinsip yang disepakati

1. **Siapa pun yang bisa membuka note harus bisa melihat semua drawing di dalamnya**, supaya anggota W mendapat konteks note secara utuh.
2. **Share hanya mengalir dari note ke drawing di dalamnya, dan hanya lewat aksi yang disengaja.** Drawing tidak pernah menyeret note ke workspace. Note pribadi tidak pernah ter-share otomatis.
3. **Drawing di dalam note adalah tautan** (`::draw[id]`), bukan salinan. Salinan hanya dibuat kalau user memilihnya.
4. **Satu drawing punya satu scope:** pribadi, atau satu workspace (`list_id` tunggal, sama seperti mindmap).
5. **Project menjadi entitas** dengan scope pribadi atau satu workspace. Anggota W memakai project W yang sama, dan project pribadi tetap terpisah.

## 2. Kondisi sekarang

| Entitas | Scope saat ini |
|---|---|
| Task, Notes, Mindmap, Chat, File | bisa milik workspace (`list_id`) |
| Drawing | hanya `user_id`; semua endpoint memfilter `WHERE user_id = ?` |
| Project | teks bebas `tasks.project`; `/api/projects` = `DISTINCT project` dari task aktif milik user |

Akibatnya:
- Drawing di note bersama tidak bisa dimuat anggota lain (404).
- `_drawing_enrich` mengisi `linked_notes` dari note milik **pemilik drawing**. Begitu drawing bisa di-share, judul note pribadi pemilik akan terlihat oleh anggota W.
- Halaman publik sudah membocorkan drawing milik user lain sekarang, lihat §3.

## 3. Prasyarat keamanan: halaman publik dan ekspor (PR 1, kerjakan duluan)

Halaman publik (`/pub/...`) bisa dibuka tanpa login, dan ekspor DOCX bisa dipakai user terdaftar mana pun (pendaftaran terbuka). Celah yang ditutup PR 1:

| # | Lokasi | Masalah |
|---|---|---|
| 3a | `GET /pub/drawings/{id}` | Mengembalikan `data_json` dan `svg_preview` drawing milik siapa pun lewat id angka (berurutan, mudah ditebak) atau `client_id`. Tidak dicek apakah drawing dipakai di note publish, dan password note publish terlewati. |
| 3b | `_render_published_content` | Token `::draw[x]` dicari dengan `WHERE id = x OR title = x` tanpa filter pemilik, lalu SVG-nya ditanam di halaman. Siapa pun bisa mempublish note berisi `::draw[123]` untuk menampilkan gambar orang lain. Kalau `x` adalah `client_id` (UUID, format default sejak offline-first), pencarian gagal lalu jatuh ke `WHERE id = note_id`, sehingga halaman bisa menampilkan gambar user lain yang id-nya kebetulan sama dengan id note. |
| 3c | `view_published_note`, seksi "🎨 Drawing" | Setiap halaman publish mencari `drawings WHERE id = note_id` (tanpa filter pemilik) sebagai "kanvas legacy per-note", lalu menanam `data_json` lengkapnya. Kanvas per-note sudah tidak ada di app (S6 audit 2026-10-15), jadi yang tampil hanyalah gambar yang id-nya kebetulan sama, bisa milik user lain. |
| 3d | `/pub/attachments/{id}`, seksi "Related", wikilink | Lampiran note publish berpassword bisa diunduh tanpa password. "Related" menampilkan judul note publish berpassword. Wikilink `[[Judul]]`/`[[id:N]]` me-resolve note berpassword milik siapa pun, jadi slug (berisi judul) bisa ditebak lewat `[[id:1..N]]`. Judul, username, dan slug user lain ditanam mentah (XSS lintas user). |
| 3e | Ekspor DOCX, drawing (`_make_drawing_resolver`) | Drawing dicari tanpa filter pemilik: `is_pinned = 1` milik siapa pun, judul, `title = x OR id = x`, dan fallback `id = note_id`. |
| 3f | Ekspor DOCX, lampiran (`_make_image_resolver`) | Lampiran dicari lewat id tanpa cek akses, dan `note_id` dari body `POST /api/scratchpad/export/docx` dipakai tanpa cek. Gambar lampiran user lain bisa ditarik ke DOCX (diambil server dari Nextcloud). |

Aturan perbaikan:
- **Note publish tepercaya.** Note publish dianggap ditulis penerbitnya hanya bila `list_id` kosong, pemilik note = penerbit, dan `last_edited_by` kosong atau sama dengan pemilik. Hanya note tepercaya yang boleh menampilkan drawing penerbit dan me-resolve wikilink ke note berpassword milik penerbit.
  - Alasan: note bersama bisa diedit anggota. Note yang dulu bersama masih menyimpan sisipan anggota setelah di-unshare atau setelah workspace-nya dihapus, dan owner workspace bisa menghapus workspace sendirian.
  - Sisa risiko yang diterima: begitu pemilik menyimpan note itu lagi, seluruh isinya (termasuk sisipan lama) dianggap miliknya. Pemilik melihat drawing yang disisipkan di note itu di aplikasi sebelum menyimpan.
- Drawing tampil publik hanya bila dirujuk `::draw[id|client_id]` di note tepercaya **dan dimiliki penerbit**. Rujukan saja tidak cukup, karena isi note bisa diubah orang lain.
- Note publish bersama: di PR 1 tidak ada drawing yang tampil. Setelah PR 2, drawing tampil bila `drawings.list_id = W` (sudah terlihat oleh semua anggota W).
- Note berpassword: wajib cookie `pub_unlock_{slug}` yang valid (`_verify_cookie`). Drawing yang dirujuk beberapa note publish cukup lolos di salah satunya.
- Render publik me-resolve token hanya lewat id atau `client_id` di antara drawing yang lolos aturan di atas. Pencocokan judul dan fallback `id = note_id` dihapus. Token yang tidak ter-resolve tampil sebagai kartu "Gambar tidak tersedia". Seksi kanvas legacy per-note dihapus.
- `/pub/attachments/{id}` memeriksa password note induknya. "Related" tidak memuat note publish berpassword. Wikilink ke note berpassword hanya ter-resolve dari note tepercaya milik pemilik note berpassword itu.
- Judul, username, dan slug milik user lain di-escape di halaman publik. Kebijakan HTML untuk isi note sendiri ada di PR 1b.
- Id yang tidak masuk akal (digit Unicode, di luar INTEGER 64-bit SQLite) diperlakukan sebagai "tidak ditemukan", bukan error 500.
- Ekspor DOCX, drawing: hanya milik pengekspor (setelah PR 2: yang bisa ia akses), lewat id atau `client_id`. Heuristik judul hanya dipakai untuk token yang bukan id angka maupun UUID, supaya rujukan yang tidak ditemukan tidak diganti drawing lain yang kebetulan judulnya sama.
- Ekspor DOCX, lampiran: lewat id hanya bila note lampiran bisa diakses pengekspor atau dipublish tanpa password (memang sudah publik). `note_id` dari request hanya dipakai bila note itu bisa diakses.
- Semua penolakan menjawab 404 dengan pesan yang sama seperti "tidak ditemukan", supaya keberadaan drawing atau lampiran tidak bocor.

Efek yang terlihat pengguna:
- Drawing tidak tampil di halaman publik untuk: note publish bersama (sampai PR 2), note yang terakhir disunting orang selain pemiliknya (sampai pemilik menyimpannya lagi), drawing milik user lain, dan rujukan lewat judul.
- Halaman publish tidak lagi punya seksi "🎨 Drawing" di bawah konten.
- Tautan wikilink dan entri "Related" yang menunjuk note berpassword orang lain menjadi teks biasa.
- Ekspor DOCX oleh anggota note bersama tidak memuat drawing pribadi pemilik note (sama seperti di aplikasi). Rujukan id/UUID yang tidak ditemukan menjadi placeholder.

Ditemukan saat mengerjakan §3, untuk PR terpisah:
1. **XSS tersimpan (PR 1b).** Halaman publish menampilkan HTML mentah dari isi note (`mistune` dengan `escape=False`, tanpa sanitasi, tanpa CSP), satu origin dengan aplikasi yang menyimpan token di `localStorage`. Termasuk `_esc` yang hanya menggandakan kurung kurawal (judul, TOC, tag, nama lampiran), username/slug mentah di halaman password, dan lampiran Nextcloud yang disajikan `inline`. Butuh keputusan HTML apa yang boleh di note publish.
2. **SSRF di ekspor DOCX.** `docx_exporter._resolve_image_bytes` mengambil URL http(s) apa pun dari isi note (dan dari data gambar kiriman klien) di sisi server. Rute ekspor juga mengembalikan traceback Python saat gagal.
3. **Lampiran di note bersama.** Di aplikasi, lampiran hanya bisa dilihat pengunggahnya, sementara prinsip 1 menyatakan siapa pun yang bisa membuka note melihat semua isinya. Ekspor DOCX sudah mengikuti akses note.
4. **500 di aplikasi.** `POST`/`PUT /api/scratchpad` gagal 500 untuk `[[<20+ digit>]]` (`_resolve_linked_to`).

## 4. Drawing milik workspace (meniru mindmap)

### 4.1 Skema

```sql
ALTER TABLE drawings ADD COLUMN list_id INTEGER DEFAULT NULL REFERENCES shared_lists(id) ON DELETE SET NULL;
ALTER TABLE drawings ADD COLUMN last_edited_by INTEGER DEFAULT NULL REFERENCES users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_drawings_list ON drawings(list_id, updated_at);
```

Dengan `ON DELETE SET NULL`, kalau workspace dihapus, drawing kembali menjadi drawing pribadi pemiliknya. `PRAGMA foreign_keys=ON` sudah aktif di `get_db`.

### 4.2 Hak akses

| Aksi | Siapa | Rujukan pola |
|---|---|---|
| Lihat, edit isi dan judul | pemilik + anggota/owner W | `_mindmap_access_clause` |
| Share, pindah, unshare | pemilik drawing | `share_mindmap` |
| Hapus | pemilik drawing | `delete_mindmap` |
| Pin | pemilik (pin per user di luar cakupan) | `toggle_pin_mindmap` |
| Salin | siapa pun yang bisa melihat; salinan jadi milik penyalin | baru |
| Tag | disimpan di bawah `user_id` pemilik drawing | pola `_upsert_tags_for_note` |

### 4.3 Endpoint

- `_drawing_access_clause(uid)`: sama dengan `_mindmap_access_clause`. Boleh digabung jadi satu helper umum.
- `GET /api/drawings`: kembalikan semua drawing yang bisa diakses, sertakan `list_id`, `user_id`, `last_edited_by`.
- `GET` / `PUT /api/drawings/{did}`: access clause dipakai untuk lookup lewat id **dan** `client_id`. Karena `client_id` hanya unik per user, lookup lintas user memakai `ORDER BY (user_id = :uid) DESC LIMIT 1`. PUT mengisi `last_edited_by`. `_check_base_rev` tetap dipakai.
- `POST /api/drawings`: tambah `list_id` opsional (dicek dengan `is_list_member_or_owner`). Dipakai untuk gambar baru yang dibuat dari note W atau dari daftar drawing W.
- `PATCH /api/drawings/{did}/share {list_id}`: hanya pemilik. Bump `updated_at` supaya pull klien ikut mengambil `list_id` baru (sama seperti audit K4 di note). Ikuti aturan di §4.5.
- `GET /api/lists/{list_id}/drawings`: daftar drawing milik W.
- `POST /api/drawings/{did}/copy {list_id: null|int, title?}`: buat drawing baru milik penyalin di scope tujuan (keanggotaan tujuan dicek), lalu salin `data_json` dan `svg_preview`.
- `GET /api/lists/{list_id}/leave-impact`: daftar note pribadi milik user yang memuat drawing W milik orang lain. Dipakai untuk menawarkan salinan sebelum user keluar.
- `_drawing_enrich(row, conn, viewer_uid)`: `linked_notes` memakai `_note_access_clause(viewer_uid)`, bukan `user_id` pemilik drawing.
- Akses publik (§3) setelah PR 2: note publish tepercaya → drawing yang bisa diakses penerbit (access clause yang sama); note publish bersama di W → hanya drawing dengan `list_id = W`. Ekspor DOCX memakai access clause pengekspor.

### 4.4 Sinkron note → drawing (di server)

Helper `_pull_note_drawings_into_list(conn, note, actor_uid)` dipanggil setelah penulisan di `POST /api/scratchpad`, `PUT /api/scratchpad/{id}`, `PATCH /api/scratchpad/{id}/share`, dan restore dari trash kalau note punya `list_id`. Outbox offline memutar ulang endpoint yang sama, jadi jalur sync ikut tercakup.

1. Kalau `note.list_id` kosong, selesai. Note pribadi tidak pernah mengubah drawing.
2. Ambil semua `::draw[x]` dari content, pakai regex yang sama dengan render publik (`_DRAW_DIRECTIVE_RE`, PR 1).
3. Untuk tiap drawing D:
   - Kalau `D.list_id == note.list_id`, lewati.
   - Kalau `D.list_id IS NULL` dan `D.user_id = actor_uid`: set `D.list_id = note.list_id`, bump `updated_at`, lalu masukkan D ke `moved_drawings` di respons.
   - Selain itu (milik workspace lain, atau drawing pribadi orang lain, **termasuk milik pemilik note**): **server tidak mengubahnya**, cukup masukkan ke `unresolved_drawings` di respons. Drawing tidak pernah dipindahkan oleh edit orang lain; kalau tidak, anggota bisa menarik drawing pribadi pemilik note ke W hanya dengan menyisipkan `::draw[k]`.
4. Server tidak pernah menulis ulang content note, supaya tidak bentrok dengan edit offline. Penggantian referensi ke salinan dilakukan oleh klien.

### 4.5 Tabel aturan (final)

| Situasi | Hasil |
|---|---|
| Drawing W disisipkan ke note pribadi | Tetap tautan; note tetap pribadi; ada badge "👥 W" dan pemberitahuan; bisa "Jadikan salinan pribadi" |
| Drawing pribadi milik sendiri disisipkan ke note W | Drawing ikut ke W, diberitahukan di `DrawingInsertModal` sebelum disisipkan |
| Gambar baru dibuat dari note W (`/draw`) | Langsung dibuat dengan `list_id = W` |
| Note pribadi di-share ke W | Drawing pribadi milik user ikut ke W; dialog share menampilkan daftarnya |
| Drawing sudah milik W | Tidak berubah |
| Drawing milik W2 masuk ke note W (lewat sisip atau share) | Default: klien menyalinnya ke W (`/copy`) lalu mengganti referensi. Pilihan lain: batal |
| Note di-unshare dari W | Drawing tetap di W. Dialog unshare menawarkan menarik kembali drawing milik user yang tidak dipakai note W lain |
| Pemilik unshare atau memindahkan drawing yang masih dipakai note W | **Ditolak (409)** dengan daftar note-nya (turunan dari prinsip 1). Pesan menyarankan "buat salinan pribadi" sebagai gantinya |
| Pemilik menghapus drawing yang dipakai note W | Boleh, dengan peringatan dan daftar note; note menampilkan placeholder |
| User keluar dari W | Sebelum keluar, ditawarkan salinan pribadi untuk drawing W milik orang lain yang dipakai di note pribadinya |
| User dikeluarkan, atau W dihapus | Embed tanpa akses menampilkan placeholder; data offline lewat alur `access_lost` → `keep_as_personal` yang sudah ada di `syncconflict.js` |

Placeholder memakai satu pesan yang tidak membocorkan keberadaan drawing: *"Gambar tidak tersedia untukmu: sudah dihapus atau tidak dibagikan ke workspace ini."* Editor yang punya akses ke drawing itu lewat workspace lain mendapat tombol "Salin ke W".

### 4.6 Backfill data lama

Sekarang drawing belum bisa di-share, jadi note bersama yang memuat drawing sudah melanggar prinsip 1. Migrasi (idempoten):
- Untuk tiap note dengan `list_id` terisi: drawing yang dirujuk, yang `list_id IS NULL` dan `user_id = note.user_id`, di-set `list_id = note.list_id`.
- Drawing yang dirujuk oleh note bersama di lebih dari satu workspace ikut workspace dari note yang paling baru diubah. Sisanya dicatat di log migrasi untuk ditangani manual (perkiraannya jarang atau tidak ada).
- Backfill menganggap rujukan ke drawing pemilik note di note bersama dibuat oleh pemilik itu sendiri. Rujukan yang disisipkan anggota sebelum migrasi tidak bisa dibedakan, tetapi sebelum PR 1 anggota tidak mendapat apa pun dari menyisipkannya, jadi kasus ini dianggap tidak realistis.

### 4.7 UI

- **DrawPage:** tombol "👥 Share" untuk pemilik (seperti di tab mindmap), badge workspace di item daftar, dan filter per workspace.
- **Halaman workspace:** daftar Drawing, seperti daftar Notes dan Mindmap.
- **`DrawingInsertModal`:** kelompokkan jadi "Pribadi" dan per workspace. Tampilkan pemberitahuan sesuai §4.5: drawing W ke note pribadi, drawing pribadi ke note W, dan drawing W2 ke note W ("akan disalin").
- **Embed di note:** badge "👥 W" kalau scope drawing berbeda dari scope note, dan menu "Jadikan salinan pribadi".
- **Editor (QuickDrawModal) dibuka dari note pribadi untuk drawing W:** tampilkan banner *"Kamu mengedit drawing milik workspace W. Perubahan terlihat oleh semua anggota."*
- **Dialog share/unshare note dan dialog keluar workspace:** sesuai §4.5.

### 4.8 Offline

- `drawingrepo.js`: simpan `list_id`, `user_id`, `last_edited_by` (ikuti pola `mindmaprepo.js`).
- `drawingroutes.js`: route lokal `GET /api/lists/{id}/drawings` (ikuti pola `mindmaproutes.js`), share, dan copy (penyalinan lokal kalau datanya ada di cache).
- `syncpull.js`: pull sekarang memuat drawing W milik orang lain. Drawing yang hilang dari hasil pull masuk alur `access_lost` yang sudah ada.
- `drawdirective.js` / node view: tampilkan placeholder seperti di §4.5.
- Kalau respons simpan note membawa `moved_drawings`, perbarui `list_id` drawing tersebut di cache lokal.

## 5. Project sebagai entitas

### 5.1 Skema

```sql
CREATE TABLE IF NOT EXISTS projects (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,                                          -- disimpan sudah di-trim
  user_id     INTEGER REFERENCES users(id) ON DELETE CASCADE,         -- scope pribadi
  list_id     INTEGER REFERENCES shared_lists(id) ON DELETE CASCADE,  -- scope workspace
  color       TEXT DEFAULT NULL,
  archived    INTEGER NOT NULL DEFAULT 0,
  created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  CHECK ((user_id IS NULL) <> (list_id IS NULL))                      -- tepat satu pemilik
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_projects_user ON projects(user_id, name COLLATE NOCASE) WHERE list_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_projects_list ON projects(list_id, name COLLATE NOCASE) WHERE list_id IS NOT NULL;
ALTER TABLE tasks ADD COLUMN project_id INTEGER DEFAULT NULL REFERENCES projects(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_tasks_project_id ON tasks(project_id);
```

Kolom teks `tasks.project` tetap dipertahankan dan selalu diisi nama project. Bot, NLP, review, filter, dan klien lama masih membacanya.

### 5.2 Hak kelola (disetujui: opsi C, 2026-10-18)

| Aksi | Project pribadi | Project workspace |
|---|---|---|
| Lihat dan pakai di task | pemilik | semua anggota + owner W |
| Buat baru ("+ Tambah baru…") | pemilik | semua anggota + owner W |
| Rename, ganti warna, arsip | pemilik | pembuat project + owner W |
| Hapus | pemilik | pembuat project + owner W |

- Alasan: membuat project tidak boleh menghambat anggota yang sedang mengisi task, sedangkan rename, arsip, dan hapus mengubah task milik semua orang. Polanya sama dengan aturan `delete_task` yang sudah ada ("hanya task owner atau list owner yang bisa menghapus").
- Respons API menyertakan `can_manage` supaya UI tahu tombol mana yang ditampilkan.
- Kalau pembuat project keluar dari W, project tetap milik W dan dikelola owner W.

### 5.3 API

- `GET /api/projects`: tetap `string[]`, project pribadi yang tidak diarsip. Bentuknya tidak berubah demi klien lama (APK dan cache SW).
- `GET /api/projects?list_id=W`: `string[]` project milik W (dengan cek keanggotaan).
- `GET /api/projects?format=full[&list_id=W][&include_archived=1]`: `[{id, name, list_id, user_id, color, archived, created_by, active_task_count, can_manage}]`.
- `POST /api/projects {name, list_id?}`: resolve-or-create. Idempoten berdasarkan nama di scope; kalau yang cocok sedang diarsip, project itu diaktifkan lagi.
- `PATCH /api/projects/{id} {name?, color?, archived?}`: mengikuti hak kelola. Rename ke nama yang sudah dipakai di scope yang sama → 409. Rename juga memperbarui `tasks.project` dan `updated_at` semua task terkait dalam satu transaksi. Task yang sedang diedit offline akan melewati alur REV_MISMATCH yang sudah ada.
- `DELETE /api/projects/{id}`: mengikuti hak kelola. Task terkait di-set `project_id = NULL`, `project = ''`, dan `updated_at` di-bump. Klien menampilkan jumlah task sebelum konfirmasi; arsip adalah aksi yang disarankan.
- Rename, arsip, dan hapus hanya bisa online di v1.
- **Batasan v1 (PR 4), ditutup di PR 5:** perangkat dengan edit tertunda dari sebelum rename/hapus dulu mengirim nama lama dan server membuat lagi project bernama lama. PR 5 mengirim `project_id` yang diikat ke `project_ref_name` (lihat §5.7); `base_rev` task tidak dipakai.
- Resolusi hanya berjalan bila project task benar-benar berubah (`project_id` beda, atau nama beda tanpa memperhatikan kapital). Edit lain tidak menyentuh project: arsip tetap bertahan, dan pemilik task yang sudah keluar dari W tetap bisa menyimpan edit lain.

### 5.4 Resolusi project saat task disimpan

Satu helper di `repository.py`, dipakai oleh webapp dan bot:
- Scope ditentukan oleh `task.list_id` (W), atau pribadi milik `task.user_id`.
- Kalau ada `project_id`: harus berada di scope task (kalau tidak, 400), lalu `project` diisi `projects.name`.
- Kalau tidak ada `project_id` tapi ada nama `project` yang tidak kosong: cari di scope (NOCASE, termasuk yang diarsip, yang lalu diaktifkan lagi). Kalau tidak ditemukan, buat baru dengan `created_by = actor`. Lalu isi `project_id`.
- Kalau `project == ''`: kosongkan keduanya.
- Subtask mewarisi `project_id` dari parent (sekarang sudah mewarisi `list_id` dan teks `project`).
- Klien lama yang hanya mengirim teks `project` tetap berfungsi.

### 5.5 Backfill

- **Pribadi:** task dengan `list_id IS NULL`, atau yang list-nya sudah terhapus, dikelompokkan per (`user_id`, nama NOCASE) menjadi satu project. Ejaan nama diambil dari yang paling baru dipakai.
- **Workspace:** task dengan `list_id` yang valid dikelompokkan per (`list_id`, nama NOCASE) menjadi satu project. `created_by` diambil dari pembuat task tertua.
- `archived = 1` untuk project yang tidak punya task aktif (`gtd_status NOT IN ('done','archived')`), supaya isi dropdown sama dengan sekarang.
- Isi `tasks.project_id`. Migrasi idempoten dan dijalankan di setiap `migrate_db()` (deploy dan start server); juga memperbaiki link basi (nama/scope tidak cocok) dan dipanggil setelah akun Telegram ditautkan ke akun web.
- Data rusak (pemilik atau `parent_id` yang sudah tidak ada) tidak pernah menggagalkan migrasi: grup itu dilewati per SAVEPOINT dan dicatat di log.
- Efek yang perlu diketahui: nama project yang selama ini hanya dipakai di task workspace akan pindah dari dropdown pribadi ke dropdown workspace tersebut.

### 5.6 UI

- **Form task:** pilihan workspace dinaikkan dari "Opsi Tambahan" ke baris atas, sebelum atau sebaris dengan Project. Dropdown Project memuat project sesuai scope, dan labelnya menyebut scope ("Project · Pribadi" / "Project · W"). Kalau workspace diganti, project dikosongkan bila tidak ada di scope baru.
- **Edit task:** scope mengikuti `task.list_id` (form edit memang tidak menampilkan pilihan list).
- Klien mengirim `project_id` kalau nama yang dipilih ada di daftar scope. Nama baru cukup dikirim sebagai teks.
- **Tampilan dan pengelompokan per project** (dashboard, filter) memakai `project_id`, supaya "taskflow" pribadi dan "taskflow" milik W tidak tercampur. Project workspace diberi badge.
- **Kelola:** section Project di halaman workspace; project pribadi dikelola di halaman/pengaturan Projects. Tombol kelola mengikuti `can_manage`.

### 5.7 Offline

- Cache dipisah per scope: `projects:personal` dan `projects:list:<id>`. Sekarang App hanya punya satu key `"projects"`.
- Route lokal `GET /api/projects` di `taskroutes.js` menerima `list_id` dan `format`. Isinya gabungan cache server untuk scope itu dan nama dari task lokal di scope yang sama (`distinctActiveField` difilter `list_id`), supaya project yang dibuat offline langsung muncul.
- Task yang disimpan offline cukup membawa nama (plus `project_id` kalau sudah diketahui). Server me-resolve saat push.
- **Implementasi PR 5:** cache project dari server (`static/offline/projectcache.js`, `_meta` "projects:v1", di-refresh setiap sync pull lewat `GET /api/projects?format=full&scope=all&include_archived=1`). Record task menyimpan `project_ref_name` (nama saat `project_id` diikat); push mengirim `project_id` selama teks masih sama dengan nama itu, walau project sudah di-rename/dihapus di server, sehingga perangkat basi tidak membuat ulang project bernama lama (server: id sama → tidak berubah; id yang sudah dihapus → diabaikan). Sisa yang diterima: pindah project offline ke project yang dihapus sebelum push → task tetap di project lama.

### 5.8 Bot Telegram dan pembaca lain

- `#project`, `/projects`, dan `/list #project` tetap di scope pribadi. `repo.list_projects` membaca tabel `projects` (yang tidak diarsip), dan `add_task` memakai helper resolusi yang sama.
- `ai_review.py`, `review_history.py`, filter, dan export tetap membaca `tasks.project`, jadi tidak perlu diubah di v1.

## 6. Urutan PR

1. **Keamanan halaman publik dan ekspor (§3).** Backend saja (`webapp.py` + tes), tanpa kenaikan versi SW. Deploy perlu `sudo systemctl restart taskflow-web`. Rencana: `docs/superpowers/plans/2026-10-18-pub-drawing-access.md`.
1b. **XSS halaman publish** dan follow-up lain di akhir §3: PR terpisah. XSS butuh keputusan HTML yang boleh dipakai di note publish.
2. Drawing workspace, backend: skema, akses, share, copy, daftar per W, `linked_notes`, sinkron note → drawing, aturan 409, backfill, akses publik sesuai §4.3, dan pytest.
3. Drawing workspace, frontend dan offline.
4. Project, backend: tabel, backfill, API, resolusi task, bot, dan pytest.
5. Project, frontend dan offline.

Setiap PR yang mengubah frontend menaikkan versi SW. Semua PR menjalankan `npm test` dan `pytest`, lalu memperbarui `.agents/`. Setiap PR punya rencana sendiri di `docs/superpowers/plans/` (skill writing-plans) sebelum implementasi.

## 7. Tes kunci

**pytest**
- PR 1: `/pub/drawings` untuk drawing yang tidak dipublish → 404; drawing yang di-embed di note publish pribadi (lewat id, `client_id`, atau direktif ter-escape) → 200; drawing user lain yang dirujuk note publish → 404 dan tidak tertanam di HTML; note publish bersama tidak menampilkan drawing, termasuk saat anggota menyisipkan `::draw[k]` milik pemilik note; note berpassword tanpa cookie atau dengan cookie palsu → 404, dengan cookie valid → 200; setelah unpublish → 404; render publik tidak memakai judul maupun fallback `id = note_id`; seksi kanvas legacy hilang; `/pub/attachments` note berpassword → 404 tanpa cookie; backlink tidak memuat note berpassword; resolver ekspor DOCX tidak me-resolve drawing user lain (id, `client_id`, judul, pin).
- PR 2: edit anggota yang menyisipkan drawing pribadi pemilik note tidak memindahkan drawing itu ke W.
- Akses drawing oleh anggota dan non-anggota; share dan hapus hanya oleh pemilik.
- `linked_notes` tidak memuat note pribadi milik orang lain.
- Sinkron note → drawing (lewat share, PUT dengan embed baru, POST dengan `list_id`). Drawing milik orang lain dan milik W2 tidak ikut diubah.
- Unshare drawing yang masih dipakai note W → 409.
- Hapus workspace → `drawings.list_id` menjadi NULL.
- Backfill idempoten.
- Project: resolve-or-create per scope, nama unik NOCASE, matriks hak kelola, rename menyebar ke task, hapus mengosongkan project di task, validasi scope `project_id`, dan `GET /api/projects` tetap `string[]`.

**node**
- `drawingrepo` menyimpan `list_id`.
- Route lokal drawing per workspace.
- Daftar project lokal per scope.

## 8. Di luar cakupan

- Pin per user untuk item bersama (mindmap dan drawing).
- Satu drawing di beberapa workspace sekaligus.
- Role admin workspace selain owner.
- Project untuk note, mindmap, atau drawing.
- Memindahkan task antar scope.
- Iframe drawing tanpa `svg_preview` di halaman publik tetap kosong (data tidak pernah dikirim ke iframe); bug lama, terpisah dari §3.
