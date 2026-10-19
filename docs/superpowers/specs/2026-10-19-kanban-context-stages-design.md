# Spec: Kanban dengan tahap kustom berbasis Context

- **Tanggal:** 2026-10-19
- **Basis kode:** `main` @ `0d382ab` (mtyatno/taskflow-v4)
- **Status:** desain disetujui per bagian dalam sesi brainstorming 2026-10-19 (pemilik + Claude). Spec tertulis ini menunggu review pemilik sebelum rencana implementasi dibuat.
- **Salinan:** repo `docs/superpowers/specs/2026-10-19-kanban-context-stages-design.md` dan Project claude.ai "alurik" `claude/spec-kanban-context-stages-2026-10-19.md`. Isi keduanya sama.
- **Istilah:**
  - *context* = baris tabel `contexts` baru; di papan Kanban disebut *tahap*;
  - *scope* = pribadi (milik satu user) atau satu workspace (`shared_lists`, disebut "W");
  - *papan* = mode tampilan Kanban di `TaskListView`;
  - *kolom bawaan* = kolom "Belum ada tahap" dan "Selesai", yang bukan baris `contexts`.

---

## 1. Tujuan

User bisa menyusun alur kerjanya sendiri sebagai tahap (context) berurutan, **sebelum** ada task di tahap itu, lalu memindahkan task antar tahap di Kanban, di desktop maupun HP. Tahap workspace dipakai bersama semua anggota.

**Kriteria berhasil**
1. User bisa membuat, mengurutkan, mengganti nama, mengarsip, dan menghapus tahap untuk scope pribadi dan untuk tiap workspace.
2. Papan Group by Context menampilkan "Belum ada tahap" → semua tahap aktif sesuai urutan → "Selesai", termasuk kolom yang kosong.
3. Menyeret kartu ke tahap mengganti context task; ke "Belum ada tahap" mengosongkannya; ke "Selesai" menandai task done; keluar dari "Selesai" membatalkan done.
4. Drag jalan dengan mouse dan layar sentuh, juga untuk task yang dibuat offline (id lokal).
5. Bot Telegram, filter, review, ekspor, dan klien lama yang membaca teks `tasks.context` tetap berfungsi.
6. Rename atau hapus tahap tidak membuat ulang nama lama dari perangkat yang masih offline.

## 2. Keputusan

| # | Keputusan |
|---|---|
| D1 | Tahap kustom memakai field **Context** yang sudah ada; Kanban tetap tersedia untuk Group by Priority, Project, dan Context. |
| D2 | Context menjadi **entitas** (tabel `contexts`) dengan scope pribadi atau satu workspace, meniru tabel `projects` (spec workspace drawing/project §5). Teks `tasks.context` tetap diisi nama. |
| D3 | Papan selalu punya kolom bawaan **"Selesai"** di ujung kanan: drop = tandai done; isinya task yang selesai 7 hari terakhir. |
| D4 | Task tanpa context tampil di kolom bawaan **"Belum ada tahap"** di ujung kiri. Task baru tidak diberi context secara diam-diam. |
| D5 | Urutan kartu di dalam kolom tetap **otomatis**: prioritas, lalu deadline terdekat, lalu judul. Tidak ada urutan manual. |
| D6 | **Satu papan = satu scope.** Halaman workspace memakai tahap W; halaman yang mencampur scope punya pemilih "Papan: Pribadi / <W>". |
| D7 | Hak kelola mengikuti opsi C project: semua anggota W boleh membuat dan memakai tahap; rename, warna, urutan, arsip, dan hapus oleh pembuat tahap + owner W. |
| D8 | Membuat tahap boleh offline; rename, warna, urutan, arsip, dan hapus hanya online di v1. |
| D9 | Drag memakai Pointer Events (mouse + sentuh) menggantikan HTML5 drag-and-drop. |

## 3. Kondisi sekarang

- Kanban adalah `viewMode === "kanban"` di `TaskListView` (`static/index.html`, `KanbanCard`/`KanbanColumn`/`KanbanView`). Kolom dibangun `buildGroups()` dari nilai yang **ada di task**, sehingga kolom tanpa task tidak pernah muncul (berlaku juga untuk P1–P4 di Group by Priority).
- Tombol Kanban dimatikan untuk Group by None, Tag, dan Quadrant.
- `GET /api/contexts` (`webapp.py`) dan route lokal (`taskquery.getContexts` → `distinctActiveField("context")`) mengembalikan `DISTINCT context` dari task aktif **milik user sendiri**. Context tidak bisa ada tanpa task, hilang saat semua task-nya selesai, diurut alfabetis, dan tidak dibagi di workspace.
- `onMoveTask` mengirim `{ context: <nama> }` lewat `onUpdateTask`; done hanya lewat checkbox.
- Drag memakai HTML5 drag-and-drop (tidak jalan di layar sentuh) dan membaca id kartu dengan `parseInt`, sehingga task berid lokal (cid) tidak bisa diseret.
- Penanda terlambat/hari ini di `KanbanCard` memakai `new Date().toISOString()` (tanggal UTC), salah antara 00.00–07.00 WIB.

## 4. Model data

### 4.1 Skema (idempoten di `migrate_db()`)

```sql
CREATE TABLE IF NOT EXISTS contexts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,                                          -- disimpan sudah di-trim
  user_id     INTEGER REFERENCES users(id) ON DELETE CASCADE,         -- scope pribadi
  list_id     INTEGER REFERENCES shared_lists(id) ON DELETE CASCADE,  -- scope workspace
  position    INTEGER NOT NULL DEFAULT 0,                             -- urutan kolom di scope
  color       TEXT DEFAULT NULL,                                      -- '#rrggbb' atau NULL
  archived    INTEGER NOT NULL DEFAULT 0,
  created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  CHECK ((user_id IS NULL) <> (list_id IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_contexts_user ON contexts(user_id, name COLLATE NOCASE) WHERE list_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_contexts_list ON contexts(list_id, name COLLATE NOCASE) WHERE list_id IS NOT NULL;
ALTER TABLE tasks ADD COLUMN context_id INTEGER DEFAULT NULL REFERENCES contexts(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_tasks_context_id ON tasks(context_id);
```

- Teks `tasks.context` tetap dipertahankan dan selalu sama dengan `contexts.name` bila `context_id` terisi.
- `position` tidak harus rapat; urutan = `ORDER BY position, name COLLATE NOCASE, id`.

### 4.2 Backfill

Mengikuti backfill project (PR 4), idempoten di setiap `migrate_db()`:
- **Pribadi:** task dengan `list_id IS NULL` (atau list-nya sudah terhapus) dikelompokkan per (`user_id`, nama NOCASE). **Workspace:** per (`list_id`, nama NOCASE), `created_by` = pembuat task tertua. Ejaan nama dari task yang paling baru diubah.
- `position` untuk context hasil backfill: urut alfabetis NOCASE (sama dengan urutan kolom sekarang), lalu ditambahkan di belakang context yang sudah ada di scope itu.
- `archived = 1` untuk context tanpa task aktif (`gtd_status NOT IN ('done','archived')`), supaya isi dropdown sama dengan sekarang.
- Isi `tasks.context_id`; perbaiki link basi (nama/scope tidak cocok). Data rusak (pemilik/list yatim) dilewati per SAVEPOINT dan dicatat di log. Juga dipanggil setelah akun Telegram ditautkan ke akun web.

### 4.3 Record lokal (IndexedDB)

Task menyimpan `context_id` dan `context_ref_name` (nama context saat `context_id` diikat), sama seperti `project_id`/`project_ref_name` (ADR-011).

## 5. Resolusi context saat task disimpan

Satu helper `resolve_task_context` di `repository.py`, dipakai semua jalur tulis task di webapp dan bot:
- Scope = `task.list_id` (W) atau pribadi milik `task.user_id`.
- Hanya berjalan bila context task berubah (`context_id` beda, atau nama beda tanpa memperhatikan kapital). Edit lain tidak menyentuh context.
- Ada `context_id`:
  - berada di scope task → `context` diisi `contexts.name`; bila context itu diarsip, ia diaktifkan lagi;
  - sama dengan `context_id` task saat ini → context dianggap tidak berubah (teks yang basi setelah rename tidak ditulis ulang);
  - tidak ada lagi (sudah dihapus) → seluruh perubahan context diabaikan; task tetap memakai nilai server (kosong, karena hapus sudah mengosongkannya). Perangkat basi tidak membuat ulang tahap yang dihapus;
  - berada di scope lain → 400.
- Tanpa `context_id`, nama `context` tidak kosong → cari NOCASE di scope (termasuk yang diarsip, yang lalu diaktifkan lagi); bila tidak ada, buat baru dengan `created_by = actor` dan `position` = maks + 1.
- `context == ''` → kosongkan keduanya.
- Subtask: perilaku teks context yang sekarang dipertahankan; `context_id` di-resolve dari teks itu di scope subtask (sama dengan scope parent).
- Klien lama yang hanya mengirim teks `context` tetap berfungsi.

Server tidak menerima `context_ref_name`. Klien hanya mengirim `context_id` selama teks context sama dengan nama saat id diikat (§8.3); bila user sengaja mengganti context ke nama lain, klien mengirim nama tanpa id. Sisa yang diterima (sama dengan Project): pindah tahap offline ke tahap yang dihapus sebelum push → perubahan itu diabaikan.

## 6. API

| Endpoint | Perilaku |
|---|---|
| `GET /api/contexts` | Tetap `string[]`: context pribadi tidak diarsip, urut posisi. Bentuk tidak berubah demi APK dan cache SW. |
| `GET /api/contexts?list_id=W` | `string[]` context W (cek keanggotaan). |
| `GET /api/contexts?format=full[&list_id=W][&scope=all][&include_archived=1]` | `[{id, name, list_id, user_id, position, color, archived, created_by, task_count, can_manage, updated_at}]`. `scope=all` = pribadi + semua W yang bisa diakses (untuk cache offline). |
| `POST /api/contexts {name, list_id?, client_id?}` | Resolve-or-create di scope; idempoten berdasarkan nama (yang diarsip diaktifkan lagi). Context baru di posisi terakhir. |
| `PATCH /api/contexts/{id} {name?, color?, archived?}` | Sesuai hak kelola. Rename ke nama yang sudah ada → 409 `CONTEXT_NAME_TAKEN`. Rename memperbarui `tasks.context` + `updated_at` semua task terkait dalam satu transaksi. Warna divalidasi `#rrggbb`. |
| `PUT /api/contexts/order {list_id: null|W, ids: [..]}` | Sesuai hak kelola (pribadi: pemilik; W: owner W **atau** pembuat semua context yang posisinya berubah). `ids` harus tepat himpunan context tidak diarsip di scope itu; bila tidak → 409 `CONTEXT_ORDER_STALE`. Menulis `position = indeks`. |
| `DELETE /api/contexts/{id}` | Sesuai hak kelola. Task terkait: `context_id = NULL`, `context = ''`, `updated_at` di-bump. Klien menampilkan jumlah task sebelum konfirmasi; arsip disarankan. |

- Hak kelola: pribadi = pemilik; W = pembuat context + owner W (`can_manage` di respons).
- Penolakan akses = 404 dengan pesan yang sama seperti "tidak ditemukan".
- Bila pembuat context keluar dari W, context tetap milik W dan dikelola owner W.
- Workspace dihapus → `contexts` W ikut terhapus (CASCADE), `tasks.context_id` menjadi NULL (teks tetap, mengikuti perilaku task saat list terhapus).

## 7. Papan Kanban

### 7.1 Kolom

- **Group by Context:** `Belum ada tahap` → context tidak diarsip di scope papan, urut posisi → `Selesai`. Semua tampil walau kosong. Task aktif yang context-nya diarsip atau tidak dikenal (data lama sebelum pull) tampil di kolom sementara bertanda "(diarsip)"/"(belum tersinkron)" sebelum `Selesai`, supaya tidak ada task yang hilang dari papan.
- **Group by Priority:** P1–P4 selalu tampil, plus "Tanpa Priority" bila ada isinya, lalu `Selesai`.
- **Group by Project:** seperti sekarang (kolom dari project yang punya task) + `Selesai`. Tahap kustom untuk project di luar cakupan.
- Kanban tetap tidak tersedia untuk None, Tag, dan Quadrant.
- Mode daftar (normal/compact) tidak berubah, kecuali Group by Context di mode daftar ikut memakai urutan posisi.

### 7.2 Scope papan

- Halaman workspace W → papan scope W.
- Halaman yang menampilkan task beberapa scope (Today, Next Actions, dll.): saat Kanban aktif dengan Group by Context, muncul pemilih **"Papan: Pribadi ▾"** berisi Pribadi + workspace yang punya task di halaman itu. Default Pribadi; pilihan disimpan per halaman di `localStorage` (`tf_kanban_scope:<page>`). Task dari scope lain tidak tampil di papan (tetap tampil di mode daftar), dan ada keterangan kecil "N task dari scope lain tidak ditampilkan".
- Group by Priority dan Project tidak memakai pemilih scope (kolomnya tidak bergantung scope).

### 7.3 Kolom "Selesai"

- Isi: task di scope papan (dan lolos filter halaman) dengan `gtd_status = 'done'` dan `completed_at` dalam 7 hari terakhir (tanggal Asia/Jakarta), terbaru di atas. Kartu tampil redup dengan centang.
- Halaman yang tidak memuat task done (filter `include_done`) mengambil daftar ini dari cache task lokal; tidak ada endpoint baru.
- Untuk task berulang, drop ke Selesai memakai jalur "tandai selesai" yang sama dengan checkbox (occurrence hari itu); kartu kembali ke tahapnya sesuai perilaku recurring yang ada.

### 7.4 Pindah kartu

| Dari → ke | Hasil |
|---|---|
| Kolom apa pun → tahap X | `{context_id: X.id, context: X.name}` (lewat `onUpdateTask`, rollback + toast bila gagal) |
| → Belum ada tahap | `{context_id: null, context: ""}` |
| → Selesai | Jalur done yang sudah ada (`onDone`); context tidak diubah |
| Selesai → tahap X / Belum ada tahap | Un-done lewat jalur yang ada, lalu set context tujuan |
| Kolom Priority/Project | Seperti sekarang (`priority`, `project` via `projectDropTarget`) |

Checkbox di kartu tetap ada dan setara dengan pindah ke Selesai.

### 7.5 Kelola tahap dari papan

- Tombol **"+ Tahap"** sebagai kolom tipis sebelum `Selesai`: input nama → `POST /api/contexts` (lewat route lokal, bisa offline) → kolom baru di posisi terakhir.
- Header kolom tahap punya menu ⋯: Ganti nama, Warna, Geser ke kiri, Geser ke kanan, Arsip, Hapus. Item mengikuti `can_manage` dan nonaktif saat offline (tooltip "Butuh koneksi internet"). Hapus menampilkan "N task akan pindah ke Belum ada tahap".
- Modal **"Kelola tahap"** (tombol di samping "Kelola project", dan di menu ⋯): daftar per scope dengan drag urutan, rename, warna, arsip/aktifkan, hapus, plus tampilan tahap yang diarsip. Pola sama dengan modal "Kelola project" (online, `{network:true}`).
- Form task: field Context menjadi dropdown per scope (seperti Project setelah PR 5) dengan "+ Tambah baru…"; label "Tahap/Context · Pribadi" atau "· W". Ganti workspace di form mengosongkan context bila tidak ada di scope baru.

### 7.6 Interaksi drag

- Pointer Events dengan ambang gerak 6 px (mouse) dan tekan-tahan ~250 ms (sentuh) agar scroll vertikal/horizontal papan tetap normal.
- Selama drag: kartu "hantu" mengikuti jari/pointer, kolom tujuan disorot, papan auto-scroll horizontal saat pointer mendekati tepi (40 px).
- Escape atau pointer dilepas di luar kolom = batal.
- Id kartu dipakai apa adanya (angka server atau cid lokal), bukan `parseInt`.
- Aksesibilitas: kartu bisa difokus; menu kartu (tombol kecil "Pindah ke…") untuk memindahkan tanpa drag, termasuk di HP.

### 7.7 Perbaikan kecil yang ikut

- Penanda terlambat/hari ini memakai tanggal Asia/Jakarta (helper yang sudah ada, mis. pola `todayLocalISO` di `taskquery.js`).
- Di papan workspace, kartu menampilkan inisial assignee bila ada.
- Hitungan di header kolom tetap jumlah kartu yang tampil.

## 8. Offline dan sinkron

### 8.1 Cache context

`static/offline/contextcache.js` (baru, pola `projectcache.js`): `_meta` "contexts:v1" berisi hasil `GET /api/contexts?format=full&scope=all&include_archived=1`, di-refresh setiap sync pull.

### 8.2 Route lokal

`GET /api/contexts` di `taskroutes.js` menerima `list_id`, `format`, `scope`, `include_archived`: gabungan cache server untuk scope itu + context lokal yang belum tersinkron + nama dari task lokal di scope yang sama (`distinctActiveField` difilter `list_id`). Bentuk `string[]` tanpa `format`.

`POST /api/contexts` lokal: bila nama (NOCASE) sudah ada di scope → kembalikan yang ada; bila belum → simpan entri lokal `{cid, name, list_id, position: maks+1, pending: 1}` dan antrekan op `context_create` di outbox.

### 8.3 Push

- `context_create`: `POST /api/contexts {name, list_id, client_id: cid}` (idempoten per nama di scope); respons mengganti entri lokal dengan id server dan memetakan cid → id di task lokal yang memakai cid itu.
- Task: kirim `context_id` (id server) selama teks `context` masih sama dengan `context_ref_name`, walau context sudah di-rename/dihapus di server; server (§5) menormalisasi. Bila user mengganti context offline ke nama yang belum ada, kirim nama saja.
- Task yang context-nya masih cid (op `context_create` belum terkirim): op task ditahan sampai `context_create` selesai (pola dependensi T10 audit), bukan dikirim tanpa context.
- 4xx permanen pada `context_create` (mis. 403 karena keluar dari W) → entri lokal dihapus, task lokal yang memakainya tetap membawa teks nama dan di-push tanpa `context_id`.

### 8.4 Pull dan adopsi

Respons/pull task mengadopsi `context`, `context_id`, dan memperbarui `context_ref_name`. Context yang dihapus di server hilang dari cache saat refresh; task yang masih menunjuknya dikoreksi oleh pull task berikutnya (server sudah mengosongkannya).

## 9. Bot Telegram dan pembaca lain

- `@context` saat menambah task, `/list @context`, dan daftar context bot tetap scope pribadi. `repo.list_contexts` membaca tabel `contexts` (tidak diarsip, urut posisi). `add_task`/update dari bot memakai `resolve_task_context`; context baru dari bot masuk di posisi terakhir.
- `ai_review.py`, `review_history.py`, filter, dan ekspor tetap membaca `tasks.context`.

## 10. Penanganan error

| Kondisi | Perilaku |
|---|---|
| Drop ke tahap yang baru dihapus di perangkat lain | Server mengabaikan id; setelah pull task jatuh ke "Belum ada tahap"; toast "Tahap sudah tidak ada" bila respons memberi tahu |
| `PUT /api/contexts/order` basi | 409 `CONTEXT_ORDER_STALE`; klien memuat ulang daftar dan menampilkan urutan terbaru |
| Rename ke nama yang sudah dipakai | 409 `CONTEXT_NAME_TAKEN`; pesan "Nama tahap sudah dipakai" |
| Klien lama mengirim teks context baru | Resolver membuat context di posisi terakhir; tidak ada task yatim |
| Update task gagal saat drag (4xx/5xx) | Kartu kembali ke kolom asal + toast (rollback `handleUpdateTaskFields`) |
| Offline lalu kelola (rename/urut/arsip/hapus) | Tombol nonaktif dengan tooltip |
| Tidak punya hak kelola | Item menu tidak tampil; server 404 bila dipanggil langsung |

## 11. Pengujian

**pytest (`tests/test_contexts.py`, `tests/test_contexts_backfill.py`)**
- Migrasi + backfill idempoten (dua kali jalan), urutan posisi alfabetis, arsip untuk context tanpa task aktif, data rusak dilewati per SAVEPOINT, perbaikan link basi.
- Resolver: resolve-or-create per scope, NOCASE, aktifkan lagi yang diarsip, `context_id` beda scope → 400, `context_id` terhapus diabaikan, hanya jalan saat context berubah, subtask.
- Matriks hak kelola (pribadi, anggota, pembuat, owner W, non-anggota → 404).
- Rename menyebar ke task + `updated_at`; 409 nama kembar; hapus mengosongkan task; urutan 409 basi; `GET /api/contexts` tetap `string[]`; `scope=all`; bot `list_contexts` dan `add_task` memakai tabel.

**node (`tests/offline/contextcache.test.js`, `kanbanboard.test.js`, dll.)**
- Cache context + route lokal per scope; create lokal idempoten + op `context_create`; push dengan `context_ref_name`; penahanan op task sampai context dibuat; adopsi pull.
- Susunan kolom papan sebagai fungsi murni (`static/offline/kanbanboard.js` atau modul UMD baru): kolom bawaan, kolom kosong tampil, P1–P4 selalu tampil, kolom "(diarsip)", filter scope papan, isi Selesai 7 hari (zona Jakarta), urutan kartu otomatis.
- Pemetaan drop → patch untuk setiap baris tabel §7.4.

**Browser (Playwright, sebelum merge PR 2)**
Buat tahap tanpa task dan lihat kolom kosong; seret dengan mouse dan sentuh (emulasi); ke/dari Selesai termasuk task berulang; menu "Pindah ke…"; pemilih scope di halaman campuran; kelola tahap (rename, urutan, arsip, hapus) dan lihat efeknya di perangkat kedua; buat tahap + task offline lalu online; task cid bisa diseret; anggota workspace melihat tahap yang sama.

## 12. Rilis

1. **PR backend** — tabel, backfill, resolver (web + bot), API §6, pytest. Tanpa frontend/SW. Deploy: restart `taskflow-web` **dan** `taskflow` (bot), karena `repository.py` berubah.
2. **PR frontend + offline** — susunan papan (modul murni), kolom bawaan, pemilih scope, pointer drag + "Pindah ke…", kelola tahap (papan + modal), dropdown context per scope di form, cache/route/push/pull context, perbaikan tanggal Jakarta dan id cid. Naikkan versi SW (`static/sw.js`, fallback di `index.html`, `sw_cache`, `tests/test_version.py`) dan `app.css?v=`.

Keputusan arsitektur dicatat sebagai ADR baru di `.agents/DECISIONS.md` bersama PR backend (nomor = nomor kosong berikutnya saat itu; saat spec ditulis, terakhir ADR-015).

## 13. Di luar cakupan v1

- Urutan kartu manual di dalam kolom.
- Batas WIP per kolom, swimlane, dan aturan otomatis per tahap (mis. pindah tahap = ganti assignee).
- Tahap per project.
- Tahap kustom untuk Group by Project atau Quadrant.
- Kelola tahap (rename/urut/arsip/hapus) saat offline.
- Memindahkan task antar scope lewat drag.
- Riwayat perpindahan tahap per task (cycle time).
