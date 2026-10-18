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

## 3. Prasyarat keamanan: halaman publik (PR 1, kerjakan duluan)

Halaman publik (`/pub/...`) bisa dibuka tanpa login. Ada empat celah:

| # | Lokasi | Masalah |
|---|---|---|
| 3a | `GET /pub/drawings/{id}` | Mengembalikan `data_json` dan `svg_preview` drawing milik siapa pun lewat id angka (berurutan, mudah ditebak) atau `client_id`. Tidak dicek apakah drawing dipakai di note publish, dan password note publish terlewati. |
| 3b | `_render_published_content` | Token `::draw[x]` dicari dengan `WHERE id = x OR title = x` tanpa filter pemilik, lalu SVG-nya ditanam di halaman. Siapa pun bisa mempublish note berisi `::draw[123]` untuk menampilkan gambar orang lain. Kalau `x` adalah `client_id` (UUID, format default sejak offline-first), pencarian gagal lalu jatuh ke `WHERE id = note_id`, sehingga halaman bisa menampilkan gambar user lain yang id-nya kebetulan sama dengan id note. |
| 3c | `view_published_note`, seksi "🎨 Drawing" | Setiap halaman publish mencari `drawings WHERE id = note_id` (tanpa filter pemilik) sebagai "kanvas legacy per-note", lalu menanam `data_json` lengkapnya. Kanvas per-note sudah tidak ada di app (S6 audit 2026-10-15), jadi yang tampil hanyalah gambar yang id-nya kebetulan sama, bisa milik user lain. |
| 3d | `/pub/attachments/{id}` dan seksi "Related" | Lampiran note publish berpassword bisa diunduh tanpa password. Seksi backlink "Related" menampilkan judul note publish berpassword yang menautkan ke halaman ini. |
| 3e | Ekspor DOCX (`_make_drawing_resolver`) | Dipakai `GET /api/scratchpad/{id}/export/docx` dan `POST /api/scratchpad/export/docx`. Drawing dicari tanpa filter pemilik: `is_pinned = 1` milik siapa pun, judul, `title = x OR id = x`, dan fallback `id = note_id`. Endpoint POST menerima isi bebas, jadi user terdaftar mana pun (pendaftaran terbuka) bisa mengekspor drawing orang lain. |

Aturan perbaikan:
- **Note publish pribadi** (`list_id` kosong, hanya pemilik yang bisa mengedit isinya): drawing tampil hanya kalau dirujuk `::draw[id|client_id]` di note itu **dan dimiliki penerbit**. Rujukan saja tidak cukup, karena isi note dikendalikan penulisnya.
- **Note publish bersama** (`list_id` = W, anggota W ikut mengedit isinya): di PR 1 tidak ada drawing yang tampil publik. Kalau aturan "dimiliki penerbit" dipakai di sini, anggota bisa menyisipkan `::draw[k]` ke note bersama yang dipublish untuk membuka drawing pribadi pemilik note lewat halaman publik. Setelah PR 2, drawing tampil kalau `drawings.list_id = W` (sudah terlihat oleh semua anggota W).
- Kalau note berpassword, wajib cookie `pub_unlock_{slug}` yang valid (`_verify_cookie`), sama seperti `view_published_note`. Drawing yang dirujuk beberapa note publish cukup lolos di salah satunya.
- Render publik me-resolve token hanya di antara drawing yang lolos aturan di atas (id atau `client_id`). Pencocokan judul dan fallback `id = note_id` dihapus. Token yang tidak ter-resolve tampil sebagai kartu "Gambar tidak tersedia".
- Seksi kanvas legacy per-note dihapus dari halaman publish.
- `/pub/attachments/{id}` memeriksa password note induknya. Backlink "Related" tidak memuat note publish berpassword. Wikilink (`[[Judul]]`, `[[id:N]]`) hanya me-resolve note berpassword milik penerbit sendiri dari note publish pribadinya.
- Judul, username, dan slug milik user lain yang tampil di halaman publik di-escape (XSS lintas user). Kebijakan HTML untuk isi note sendiri tetap di PR 1b.
- Ekspor DOCX hanya memakai drawing milik pengekspor (setelah PR 2: yang bisa ia akses), lewat id, `client_id`, atau judul; tanpa fallback `id = note_id`.
- Ekspor DOCX hanya memakai lampiran dari note yang bisa diakses pengekspor (lewat id lampiran maupun `note_id` dari request).
- Semua penolakan menjawab 404 dengan pesan yang sama seperti "tidak ditemukan", supaya keberadaan drawing atau lampiran tidak bocor.

Efek yang terlihat pengguna:
- Drawing di note publish bersama, dan drawing milik user lain di note publish pribadi, tidak tampil di halaman publik sampai PR 2 (backfill §4.6 memindahkan drawing pemilik note bersama ke W).
- Halaman publish tidak lagi punya seksi "🎨 Drawing" di bawah konten.
- Anggota yang mengekspor note bersama tidak mendapat drawing pribadi pemilik note, sama seperti di aplikasi.

Di luar §3 tetapi ditemukan saat mengerjakannya (PR terpisah): (1) ekspor DOCX mengambil URL http(s) apa pun dari isi note di sisi server (SSRF buta), dan rute ekspor live mengembalikan traceback Python ke klien saat gagal; (2) halaman publish menampilkan HTML mentah dari isi note (`mistune` dengan `escape=False`, tanpa sanitasi dan tanpa CSP), satu origin dengan aplikasi yang menyimpan token di `localStorage`. Ini XSS tersimpan; perbaikannya PR terpisah dan butuh keputusan HTML apa yang boleh di note publish.

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
- Akses publik (§3) setelah PR 2: note publish pribadi → drawing yang bisa diakses penerbit (access clause yang sama); note publish bersama di W → hanya drawing dengan `list_id = W`. Ekspor DOCX memakai access clause pengekspor.

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
- Isi `tasks.project_id`. Migrasi idempoten.
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

### 5.8 Bot Telegram dan pembaca lain

- `#project`, `/projects`, dan `/list #project` tetap di scope pribadi. `repo.list_projects` membaca tabel `projects` (yang tidak diarsip), dan `add_task` memakai helper resolusi yang sama.
- `ai_review.py`, `review_history.py`, filter, dan export tetap membaca `tasks.project`, jadi tidak perlu diubah di v1.

## 6. Urutan PR

1. **Keamanan halaman publik dan ekspor (§3).** Backend saja (`webapp.py` + tes), tanpa kenaikan versi SW. Deploy perlu `sudo systemctl restart taskflow-web`. Rencana: `docs/superpowers/plans/2026-10-18-pub-drawing-access.md`.
1b. **XSS halaman publish** (temuan di luar §3): PR terpisah setelah keputusan HTML yang boleh dipakai di note publish.
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
