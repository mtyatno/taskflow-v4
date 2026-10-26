# Spec: Live Edit — panel detail task di samping daftar (tanpa modal)

- **Tanggal:** 2026-10-26
- **Basis kode:** `main` @ `0ab062d` (mtyatno/taskflow-v4; SW v468 `taskflow-v468-fokus-parkir-toast`, `app.css?v=366`)
- **Status:** diimplementasikan di branch `claude/live-edit` (PR B, ditumpuk di atas PR A `claude/task-detail-body` = draft PR #96; SW `taskflow-v470-live-edit`, `app.css?v=367`), belum di-merge. Desain disetujui per bagian dalam sesi brainstorming 2026-10-26 (pemilik + Claude): tata letak, struktur komponen, edit/autosave, pengujian/rilis/cakupan. Spec tertulis disetujui pemilik 2026-10-26 13:41 WIB. Keputusan rencana R1, R6, R7 (`claude/plan-live-edit-2026-10-26.md`) sudah dilebur ke §5.5, §6.4, §7.1, §7.3. Keputusan pelaksanaan R9–R16 (daftar di bagian "Rulings saat eksekusi" pada plan) dan dua penyimpangan Task 7 dilebur ke §4.2, §4.3, §5.5, §6.2, §6.4, §7.3, §7.4; temuan baru di §12. Keputusan tinjauan akhir R19 (project/context hanya tersimpan saat keluar field/Enter/flush, opsi yang ada langsung) dan R21 (tag dimuat ulang sebelum setiap simpan judul) dilebur ke §5.5, §7.3, §7.4.
- **Salinan:** Project claude.ai "alurik" `claude/spec-live-edit-2026-10-26.md`; ikut di-commit ke repo `docs/superpowers/specs/2026-10-26-live-edit-design.md` saat implementasi dimulai di branch. Isi keduanya sama.
- **Istilah:**
  - *daftar task* = `TaskListView` (`static/index.html`), dipakai halaman seperti Inbox, Next Actions, Waiting, Someday, Project, Tag, dan tab Task halaman workspace (`slist_<W>`);
  - *view* = pilihan tampilan daftar yang sudah ada: Normal, Compact, Kanban (`tf_viewmode`);
  - *panel* = kolom kanan berisi detail task terpilih saat Live Edit menyala;
  - *Live Edit* = tombol on/off yang menampilkan/menyembunyikan panel, terpisah dari tombol view;
  - *area konten* = lebar elemen akar `TaskListView`;
  - *task terpilih* = task yang sedang tampil di panel;
  - *field utama* = judul, deskripsi, priority, status GTD, project, context, deadline, waiting for, assignee, progress (field yang sekarang diedit lewat ✏️ Edit di modal);
  - *bagian langsung* = checklist, sub-task (task anak), tag, catatan, lampiran (sudah tersimpan per aksi di modal sekarang).

---

## 1. Tujuan

Pengguna ingin mengedit satu task cukup lama dengan konsentrasi, lalu berpindah ke task berikutnya dengan cepat tanpa harus menutup modal (tombol ✕) setiap kali. Merapikan banyak task secara berurutan ikut terlayani lewat perpindahan cepat itu. Di layar sempit (HP) perilaku modal tetap seperti sekarang.

**Kriteria berhasil**
1. **Tombol Live Edit.** Di daftar task ada tombol on/off "Live Edit" di samping tiga tombol view. Saat menyala, halaman terbagi dua: kiri view aktif (Normal, Compact, atau Kanban) apa adanya, kanan panel detail task.
2. **Pilih = tampil.** Klik baris/kartu saat panel menyala menampilkan task itu di panel; tidak ada modal dan tidak perlu menutup apa pun.
3. **Edit langsung.** Field utama di panel langsung bisa diedit dan tersimpan otomatis. Tidak ada tombol Edit/Simpan/Batal di panel.
4. **Satu isi detail.** Modal dan panel memakai komponen isi yang sama (`TaskDetailBody`). Tidak ada dua salinan isi detail task.
5. **Panel tidak "direbut".** Panel hanya berganti task bila pengguna memilih task lain. Task yang dicentang selesai atau keluar dari daftar karena hasil editnya tetap tampil di panel.
6. **Layar sempit tetap modal.** Bila area konten kurang dari ambang, tombol Live Edit tidak tampil, panel tidak tampil, dan klik task membuka modal seperti sekarang.
7. **Aman untuk data.** Membuka task tanpa mengubah apa pun tidak menyimpan apa pun. Edit di panel bekerja offline (router lokal) seperti modal.
8. **Modal HP tidak berubah.** Modal tetap memakai alur lihat → ✏️ Edit → 💾 Simpan.

## 2. Keputusan

| # | Keputusan | Alasan |
|---|---|---|
| K1 | Live Edit = tombol on/off panel, terpisah dari tombol view, bisa dipakai bersama Normal, Compact, dan Kanban. | Pilihan pemilik (awalnya view ke-4; diganti setelah dibahas). Kanban + panel memungkinkan menggeser kartu sambil mengedit detail. |
| K2 | Isi modal dipisah menjadi `TaskDetailBody` dengan `variant: "modal" \| "panel"`; modal dan panel hanya pembungkus. | Pilihan pemilik: tidak ada ongkos merawat dua hal yang maksud dan isinya sama. |
| K3 | Pendekatan 1: modal tetap lihat → Edit → Simpan; panel langsung edit + autosave. | Pilihan pemilik. Panel benar-benar live tanpa mengubah pengalaman HP. Bisa diperluas ke modal di rilis lain. |
| K4 | Task yang selesai atau keluar dari daftar tetap tampil di panel sampai pengguna memilih task lain (opsi A). | Pilihan pemilik. Sesuai pemakaian utama (edit dengan konsentrasi); salah centang bisa dibatalkan lewat status di panel. |
| K5 | Ketersediaan diukur dari lebar area konten (bukan lebar layar); ambang 760 px. | Sidebar lebar/ikon mengubah ruang yang tersisa. 420 px panel minimum + 320 px daftar minimum + jarak. |
| K6 | Lebar panel = 50% area konten, dibatasi 420–680 px, sama untuk ketiga view. | Tidak ada kasus khusus per view; modal sekarang 520 px. Di Kanban papan tetap digulir ke samping (kolom 280 px). |
| K7 | Status panel disimpan per perangkat (`tf_liveedit`), terpisah dari `tf_viewmode`, berlaku global seperti view. | Pilihan view yang sekarang juga global per perangkat. Reset Kanban → Normal saat Group by tidak cocok tidak menyentuh panel. |
| K8 | Autosave mengirim hanya field yang berubah dibanding versi terakhir yang tersimpan; tidak ada simpan saat dibuka. | Mencegah masalah note dulu (audit offline 2026-10-15 T4: membuka note memicu simpan dan bisa menimpa edit orang lain). |
| K9 | Judul disimpan hanya saat keluar field / Enter; deskripsi dan waiting for saat keluar field atau 1,5 dtk diam; pilihan langsung. | `updateTask` memisahkan `#tag` dari judul saat disimpan; simpan di tengah mengetik akan menyimpan tag setengah jadi. Antrean outbox tidak menggabungkan update berurutan, jadi frekuensi dijaga. |
| K10 | Logika murni di modul baru `static/offline/liveedit.js` (`TF.liveedit`), UI di `index.html`. | Pola `kanbanboard.js` / `focusfilter.js`: diuji di Node tanpa React. |
| K11 | Cakupan halaman = halaman yang merender `TaskListView`. Fokus Hari Ini, Dashboard, Kalender tidak berubah. | Tiga view hanya ada di `TaskListView`. |
| K12 | Dua PR: PR A pemisahan isi modal tanpa perubahan perilaku; PR B Live Edit. | Pemisahan ~1.080 baris isi modal paling berisiko; tes lama menjaga modal tetap sama sebelum fitur baru ditumpuk. |
| K13 | Hanya klien. Tidak ada perubahan server, skema, atau API. *(Pengecualian R20, commit tersendiri yang boleh di-drop: server menggabungkan notifikasi "memperbarui task" per aktor per task per 10 menit, §10.)* | `PUT /api/tasks/:id` (rute lokal) sudah menerima patch sebagian. |

## 3. Kondisi sekarang

- **`TaskDetailModal`** (`index.html` ±8422–9499) dirender sekali di App (`selectedTask && createElement(TaskDetailModal, …)`) dengan props `task, onClose, onEdit, onDone, onDelete, onRefresh, onOfflineEdit, onToggleFocus, onOpenTask, projects, contexts, collaborators, sharedLists`.
  - Pembungkus: `div.modal-overlay` (klik → `onClose`) › `div.modal-content.scale-in` (`max-width: 520px`), tombol ✕ di kanan atas.
  - State `isEditing`. Mode lihat: badge status/priority/kuadran, tag, deskripsi, project/context/deadline/waiting for/assignee, progress, dibuat/selesai. Mode edit: input judul, select Priority & GTD Status, `ComboSelect` project/context per scope (`useScopeProjects/useScopeContexts(task.list_id)`), date deadline, waiting for, assignee (anggota list, dimuat saat `isEditing` dan `task.list_id`), range progress, `MentionInput` deskripsi.
  - `handleSave`: `api.put('/api/tasks/'+task.id, form)` dengan **seluruh form**, lalu `onRefresh()` + `onClose()`; cabang `isOfflineErr` → `OfflineDB.queueAdd` + `onOfflineEdit` (jalur lama; rute lokal sudah menangani offline).
  - Bagian langsung (checklist `/subtasks`, task anak `/child-tasks`, tag, `ModalNotes`, `ModalAttachments`) dimuat per `task.id` dan tersimpan per aksi. Klik task anak → `onOpenTask(ct)`.
  - Aksi bawah (mode lihat): Hapus, Pindah ke Workspace (task pribadi tingkat atas; `moveTaskToWorkspace`, online saja, lalu `onClose`), Fokus (`onToggleFocus` lalu `onClose`), ✏️ Edit, ✅ Done. Overlay "Task dengan tag" absolut di dalam kotak modal.
- **App:** `handleDone` dan `handleDelete` (dengan `confirm("Hapus task ini?")`) memanggil `setSelectedTask(null)`; `handleDelete` tidak mengembalikan hasil. `openTaskById` (notifikasi) dan `onTaskClick` note/halaman lain memanggil `setSelectedTask`.
- **`TaskListView`** (±17811): state `viewMode` dari `tf_viewmode` (`normal`/`compact`/`kanban`), `groupBy` dari `tf_groupby`; efek mengembalikan Kanban ke Normal bila Group by None/Tag/Quadrant. Segmen `.tl-view-seg` berisi tombol `.tl-view-btn` dengan `ViewGlyph` dan `aria-pressed`. Baris: `TaskRow({task, onClick, …})` memanggil `onClick(task)`; `CompactRow({task, onTaskClick, …})` memanggil `onTaskClick(task)` dan mengubah `style.background` lewat `onMouseEnter/Leave`; Kanban: `KanbanCard({task, onTaskClick, …})`, kolom 280 px, `maxHeight: calc(100vh - 240px)`.
- **App → `TaskListView`:** `allTasks: tasks` (App memuat `/api/tasks?include_done=true`, jadi task selesai ikut ada), `onTaskClick: setSelectedTask`, `onDone`, `onToggleFocus`, `onUpdateTask`, `projects`, `contexts`, `collaborators`, `sharedLists`, dll. Belum ada `onDelete`, `onRefresh`, `onOfflineEdit`.
- **Id task:** baris dari rute lokal memakai `id = server_id ?? cid` (`taskroutes.js` `displayIdOf`) dan tetap membawa `cid`. Setelah sync, `id` task baru berubah dari cid ke id server.
- **Simpan lokal:** `PUT /api/tasks/:id` → `TFrepo.updateTask(cid, patch)` hanya menerapkan field yang ada di patch (`!= null`); deadline dikosongkan dengan `""`/`"-"`, assignee dilepas dengan `0`; judul diproses `extractTags` (judul kosong setelah tag dibuang → error "Judul tidak boleh kosong setelah strip tag"). Setiap update menambah satu op `update` di `_outbox` dengan payload record penuh; op tidak digabung.
- **Tata letak:** `.desktop-topbar` sticky `top: 0`; `.main-content` padding 16px 28px. Pola daftar kiri + isi kanan sudah ada di halaman Mindmap dan Sketsa.

## 4. Ketersediaan dan tata letak

### 4.1 Konstanta (`TF.liveedit`)

```
MIN_CONTENT_WIDTH = 760   // px, area konten minimum agar Live Edit tersedia
PANEL_RATIO       = 0.5
PANEL_MIN         = 420   // px
PANEL_MAX         = 680   // px
TEXT_IDLE_MS      = 1500  // deskripsi & waiting for
STORAGE_KEY       = "tf_liveedit"   // "1" | "0"
```

### 4.2 Ketersediaan

- Hook `useLiveEdit(rootRef)` di `TaskListView`:
  - mengukur lebar `rootRef` dengan `ResizeObserver` (fallback: event `resize` window), menghitung `available = TF.liveedit.isAvailable(width)`. Lebar yang diukur = `clientWidth` + lebar scrollbar halaman (`innerWidth − documentElement.clientWidth`), yaitu lebar seolah tanpa scrollbar (penyimpangan Task 7). Tanpa itu panel yang memanjangkan halaman memunculkan scrollbar klasik (±6–17 px), di dekat 760 px area konten jatuh di bawah ambang, panel mematikan dirinya sendiri, scrollbar hilang, panel menyala lagi, dan seterusnya (kedip; terukur 37–48 mutasi panel per detik). Konsekuensinya ambang menghitung lebar tanpa scrollbar halaman (selisih paling banyak ±6–17 px, diserap kolom daftar yang `flex: 1; min-width: 0`);
  - membaca/menulis `on` lewat `readOn/writeOn(storage)`;
  - mengembalikan `{ available, on, active: available && on, panelWidth, toggle }`.
- `active` = panel tampil. Bila `!available`: tombol Live Edit tidak dirender, panel tidak dirender, klik task memanggil `onTaskClick` (modal). Nilai `on` tetap tersimpan; begitu `available` lagi, panel tampil lagi.

### 4.3 Susunan saat `active`

- Judul halaman, baris Group by/view/Live Edit, cari, dan filter tetap di atas selebar area konten (tidak berubah).
- Di bawahnya `div.tl-live` (flex, `gap: 16px`, `align-items: flex-start`):
  - kiri `div.tl-live-list` (`flex: 1; min-width: 0`): isi view aktif apa adanya (daftar grup Normal/Compact atau `KanbanView`); mengikuti gulir halaman seperti sekarang; Kanban tetap bergulir horizontal di dalamnya;
  - kanan `aside.tl-live-panel` (`aria-label="Detail task"`): `width = panelWidth` (`clamp(round(w × 0.5), 420, 680)`), `flex-shrink: 0`, `position: sticky`, `top` = `offsetHeight` `.desktop-topbar` (diukur di `useLiveEdit`; 0 bila tidak ada) + 12 px, `max-height` diukur langsung (R15, lihat di bawah), `overflow-y: auto`, kartu (`--bg-card`, `1px solid var(--border)`, radius 12 px, padding 20 px).
- **Tinggi maksimum panel (R15).** `max-height = max(200, innerHeight − max(top, rect.top panel) − 16)` px, ditulis langsung ke elemen (bukan style React) oleh pendengar `scroll` dan `resize` yang pasif dan di-throttle `requestAnimationFrame`, diukur juga saat mount, saat `top` berubah, dan setelah tiap render (isi di atas panel, mis. panel Filter, bisa menggeser panel tanpa gulir atau resize). Rumus statis `calc(100vh − top − 16px)` dari desain awal membuat dasar panel, dan bar aksi (Hapus … Done) yang menempel di dasarnya, jatuh di bawah layar selama halaman belum digulir, karena panel masih berada lebih rendah dari posisi menempelnya. Dengan rumus ini dasar panel selalu 16 px di atas dasar viewport; lantai 200 px menjaga viewport sangat pendek.
- Tombol aksi panel menempel di bawah panel (`position: sticky; bottom: 0` di dalam panel, latar `--bg-card`, garis atas `inset 0 1px 0 var(--border)`).
- Tanpa pembatas kolom yang bisa digeser (di luar cakupan).

### 4.4 Tombol Live Edit

- Diletakkan setelah `.tl-view-seg`, dipisah garis tipis vertikal (`1px var(--border)`, tinggi 20 px, margin 0 6 px), dalam pembungkus yang sama-sama `margin-left: auto`.
- `button.tl-view-btn.tl-live-btn` `type="button"`, `aria-pressed={on}`, `aria-label="Live Edit"`, `title` = "Tampilkan panel detail di samping" / "Sembunyikan panel detail", isi `ViewGlyph name="live"` (ikon baru bergaya duotone seperti tiga glyph view: persegi dengan panel kanan berisi lembut) + teks "Live Edit" (teks disembunyikan bila baris alat sempit, `aria-label` tetap).
- Tersedia untuk ketiga view dan semua Group by.

## 5. Struktur komponen

### 5.1 `TaskDetailBody(props)`

- Berisi seluruh isi `TaskDetailModal` sekarang (judul, field, bagian langsung, panel Pindah ke Workspace, aksi bawah, overlay "Task dengan tag"), tanpa `modal-overlay`/`modal-content`/tombol ✕.
- Props: semua props `TaskDetailModal` sekarang ditambah:
  - `variant: "modal" | "panel"` (default `"modal"`);
  - `headerAction` (node React, opsional): dirender di kanan baris judul, di tempat tombol ✕ sekarang. Hanya modal yang mengisinya (✕). Pada `variant="panel"` tempat itu diisi indikator simpan milik body sendiri (§7.5), karena state simpan ada di body.
- `variant="modal"`: perilaku persis sama dengan sekarang (PR A tidak mengubah apa pun selain memindahkan kode).
- `variant="panel"`: §7. `onClose` tidak dipanggil oleh Fokus, Pindah ke Workspace, maupun simpan.

### 5.2 `TaskDetailModal(props)`

- Signature dan pemakaian App tidak berubah. Isinya: `modal-overlay` › `modal-content scale-in` › `TaskDetailBody {...props, variant: "modal", headerAction: <span ✕ onClick=onClose>}`.
- Tombol ✕ tetap di posisi yang sama (kanan atas, sejajar judul) dengan gaya yang sama; hasil render modal harus identik dengan sekarang.

### 5.3 `TaskDetailPanel(props)`

- `aside.tl-live-panel` › `TaskDetailBody {...detailProps, task, variant: "panel", key: stableKey(task)}` (indikator simpan dirender body di baris judul, §7.5).
- `stableKey(task)` = `task.cid || String(task.id)`, supaya pergantian id cid → id server setelah sync tidak me-mount ulang form (edit yang belum tersimpan tidak hilang).
- Keadaan khusus (tanpa body): "Tidak ada task" (daftar kosong), "Pilih task di daftar" (tidak ada yang terpilih, mis. setelah Hapus), "Task ini sudah dihapus atau tidak bisa diakses lagi." (§6.4).

### 5.4 `useLiveEdit(rootRef)` — §4.2.

### 5.5 Modul murni `static/offline/liveedit.js` (`TF.liveedit`, UMD seperti `focusfilter.js`)

```
isAvailable(width) -> boolean                    // width >= MIN_CONTENT_WIDTH
panelWidth(width) -> number                      // clamp(round(width*PANEL_RATIO), PANEL_MIN, PANEL_MAX)
readOn(storage) -> boolean                       // try/catch; default false
writeOn(storage, on) -> void                     // try/catch; gagal diam
taskRef(task) -> { id: string, cid: string|null }
sameTask(task, ref) -> boolean                   // String(id)===ref.id || (cid && cid===ref.cid) || String(server_id)===ref.id
findTask(tasks, ref) -> task|null
pickInitial(visibleTasks, allTasks, currentRef) -> ref|null
EDITABLE_FIELDS = ["title","description","priority","gtd_status","project","context",
                   "deadline","waiting_for","assigned_to","progress"]
formFromTask(task) -> form                       // default sama dengan modal: priority "P3", gtd "inbox", "" untuk teks, assigned_to null, progress 0
changedFields(saved, form) -> string[]           // urutan EDITABLE_FIELDS; title dibandingkan setelah trim; lainnya ===
buildPatch(form, fields) -> object               // title trim; deadline kosong -> ""; assigned_to null/"" -> 0; progress Number
saveTrigger(field, value) -> "now" | "idle" | "blur"
                                                 // title, progress, project, context -> "blur" (R19);
                                                 // description, waiting_for -> "idle"; lainnya -> "now"
mergeExternal({form, saved}, incomingTask) -> {form, saved}
                                                 // saved' = formFromTask(incoming); untuk tiap field:
                                                 // bila form[f] === saved[f] (tidak dirty) -> form'[f] = saved'[f], selain itu form[f] tetap
validateTitle(title) -> string|null              // kosong, atau kosong setelah `#tag` dibuang (regex server
                                                 // #([a-zA-Z0-9_À-ɏ]+)) -> "Judul tidak boleh kosong" (R13: judul
                                                 // hanya-tag membuat setiap autosave berikutnya gagal)
titleWithTags(title, tags) -> string             // R9: menambah " #nama" untuk tiap tag yang belum ada di judul;
                                                 // pemanggil memanggil validateTitle lebih dulu
isNotFound(err) -> boolean                       // status 404 atau pesan "not found"
selectionReducer(sel, action) -> sel             // sel = {ref, snapshot, cleared}; aksi select | init | deleted | snapshot (§6.2)
createAutosaver({task, put, onChange, ...}) -> Autosaver   // orkestrasi §7.2–§7.4, diuji di Node
```

### 5.6 Wiring App → `TaskListView`

- App meneruskan prop baru `detailProps` ke kedua pemakaian `TaskListView` (halaman workspace dan halaman default):
  ```
  detailProps = { onDone: id => handleDone(id), onDelete: id => handleDelete(id),
                  onToggleFocus: handleToggleFocus, onRefresh: fetchAll,
                  onOfflineEdit: handleOfflineEdit, projects, contexts, collaborators, sharedLists }
  ```
- `handleDelete(taskId)` mengembalikan `true` bila task benar-benar terhapus, `false` bila dibatalkan di `confirm` atau gagal. Perilaku modal tidak berubah.
- `TaskDetailPanel` memetakan `detailProps` ke props body: `onDone: () => detailProps.onDone(task.id)`, `onDelete: async () => { if (await detailProps.onDelete(task.id)) clearSelection(); }`, `onOpenTask: t => select(t)`, `onEdit` tidak dipakai, `onClose: () => {}`.

## 6. Pilihan task

### 6.1 State di `TaskListView`

- `selRef` = `{ id, cid }` atau `null`; `selSnapshot` = objek task terakhir yang dipilih (untuk task yang tidak ada di `allTasks`, mis. task anak yang dibuka dari panel, sampai data App memuatnya).
- Task panel = `findTask(allTasks, selRef) || selSnapshot` (selalu data terbaru bila ada di `allTasks`).

### 6.2 Kapan pilihan berubah

- Klik baris/kartu saat `active` → `select(task)` (bukan `onTaskClick`).
- Klik task anak di panel (`onOpenTask`) → `select(childTask)`.
- Panel dinyalakan, halaman (`page`) berganti, atau `active` berubah dari false ke true → `pickInitial(visibleTasks, allTasks, selRef)`:
  - pilihan sekarang masih ada di `allTasks` dan halaman sama → tetap;
  - selain itu task pertama sesuai urutan tampil (grup terlipat dilewati; Kanban: kartu teratas di kolom pertama yang berisi kartu);
  - tidak ada task → `null` ("Tidak ada task").
  - Efek init (layout effect, agar tidak ada satu frame "Tidak ada task") juga berjalan saat `visibleTasks` pertama kali berubah dari kosong ke berisi (`hasVisible`): App memulai dengan `loading = false`, jadi task bisa tiba sesudah panel tampil; init itu memakai `keep = true` (halaman sama) sehingga pilihan yang ada, atau keadaan "Pilih task di daftar" setelah Hapus, tidak diganti. Penanda halaman sebelumnya diperbarui hanya saat init benar-benar dikirim, jadi pindah halaman selagi panel tersembunyi (area konten sempit) memilih task pertama halaman baru begitu panel kembali (penyimpangan Task 7).
- Hapus lewat panel yang berhasil → `null` ("Pilih task di daftar").
- **Tidak** mengubah pilihan: centang selesai (di baris atau panel), edit yang membuat task keluar dari daftar/filter/cari, drag kartu Kanban, sync, perubahan Group by atau view (bila task masih ada di `allTasks`).
- `visibleTasks` = urutan task yang sedang dirender di sisi kiri (dibangun bersamaan dengan render grup/papan).

### 6.3 Penanda terpilih

- `TaskRow`, `CompactRow`, `KanbanCard` menerima prop `selected` (boolean, `sameTask(task, selRef)`):
  - kelas `is-selected` → latar `var(--bg-hover)` lebih kuat (token baru `--bg-selected`, terang `rgba(15,23,42,0.07)`, gelap `rgba(255,255,255,0.10)`) dan `box-shadow: inset 0 0 0 1px var(--border)`; **tanpa `border-left`**;
  - `aria-current="true"` pada elemen baris/kartu terpilih.
- `CompactRow` pindah dari `onMouseEnter/Leave` yang menulis `style.background` ke kelas CSS (`.compact-row:hover`, `.compact-row.is-selected`) agar sorotan tidak hilang saat kursor keluar. Tampilan hover lama dipertahankan.
- Checkbox, ⭐, tombol Fokus, chip status, menu "Pindah ke…", dan drag tetap memakai `stopPropagation`/jalur sendiri sehingga tidak memindahkan pilihan.

### 6.4 Task tidak ada di `allTasks`

- Bila `findTask(allTasks, selRef)` null dan `selSnapshot` ada: panel memakai `selSnapshot` dan sekali memeriksa `api.get('/api/tasks/'+ref.id)` (rute lokal). Respons ada → dipakai sebagai snapshot baru; 404/"not found" → keadaan "Task ini sudah dihapus atau tidak bisa diakses lagi." (hanya teks, tanpa isi detail, sama dengan §5.3). Respons `null` juga dianggap tidak ditemukan.
- **R16.** Keadaan "sudah dihapus" dibuang begitu task ditemukan lagi (di `allTasks` atau lewat pemeriksaan) atau pilihan berganti, dan pemeriksaan satu kali itu dipasang ulang sehingga task yang kemudian benar-benar hilang diperiksa lagi (bukan terus mengedit snapshot basi). Selama panel tersembunyi (area konten sempit) keadaan itu dipertahankan agar panel yang kembali tidak me-mount body task yang sudah dihapus (yang akan meminta catatan/lampiran/checklist dan mendapat 404).
- Teks keadaan ini menggantikan "Task ini sudah dihapus" yang disebut saat brainstorming, karena task juga bisa hilang dari `allTasks` setelah keluar dari workspace.

## 7. Edit dan simpan otomatis (variant panel)

### 7.1 Tampilan field

- Field utama selalu dirender sebagai input (komponen yang sama dengan mode edit modal): judul (input bergaya judul 18 px/700), Priority, GTD Status, Project & Context (`ComboSelect` per scope task), Deadline, Waiting for, Assignee (bila `task.list_id`; anggota dimuat saat panel terbuka untuk task itu), Progress (range), Deskripsi (`MentionInput` textarea, `rows` 4, bisa di-resize vertikal seperti modal).
- Info baca-saja dari mode lihat yang bukan field: badge Kuadran, tag (bisa dihapus/diklik seperti sekarang), "Dibuat …", "Selesai …", penanda terlambat.
- Tidak ada tombol ✏️ Edit, Batal, 💾 Simpan. Aksi bawah: Hapus, Pindah ke Workspace, Fokus, ✅ Done (Done disembunyikan bila status done, seperti sekarang).

### 7.2 State form

- `saved` = `formFromTask(task)` saat mount; `form` = salinan `saved`.
- `dirty(f)` = `form[f]` berbeda dari `saved[f]` menurut `changedFields`.
- Saat objek `task` dari luar berubah (prop baru dengan `updated_at`/isi berbeda): `({form, saved}) = mergeExternal({form, saved}, task)`.

### 7.3 Pemicu simpan

- `saveTrigger(f) === "now"` (priority, status, deadline, assignee): simpan setelah `onChange`.
- Progress (`"blur"`): simpan saat `pointerup`, `keyup`, atau `blur` slider, bukan setiap `input`.
- Project dan Context (`"blur"`, R19): `ComboSelect` mengirim perubahan di setiap ketikan saat membuat nama baru dan nilai kosong saat "+ Baru" dipilih, sedangkan server membuat project / tahap Kanban untuk setiap nama yang belum ada (`repository.py` resolve project/context). Karena itu nama yang diketik hanya disimpan saat keluar field (blur pembungkus field, pindah fokus di dalamnya diabaikan), `Enter` di dalam field, atau flush; diam tidak menyimpan apa pun, sehingga "Mark" lalu jeda lalu "Marketing" tidak membuat project "Mark". Memilih opsi yang sudah ada di scope (nilai ada di daftar `options` yang sama dengan yang diterima `ComboSelect`) langsung di-`commit`. Nilai kosong dari "+ Baru" juga hanya tersimpan saat keluar field atau flush, supaya memilih "+ Baru" lalu diam tidak menghapus project lama.
- `"idle"`: simpan `TEXT_IDLE_MS` setelah ketikan terakhir, atau saat `blur`, mana yang lebih dulu.
- `"blur"` (judul): simpan saat `blur` atau `Enter`. `Escape` di judul mengembalikan judul ke `saved.title`.
- Flush seketika (semua field dirty dikirim): unmount body (pindah task, panel dimatikan, halaman berganti, area konten menyempit), `visibilitychange` → `hidden`, `pagehide`.
- **Simpan eksplisit vs bukan (R11).** `commit(field)` (Enter, blur, `pointerup`/`keyup` progress), `flush`, dan `retry` = eksplisit; perubahan "now" dan timer idle bukan. Simpan yang bukan eksplisit membuang field yang `saveTrigger(f, form[f]) === "blur"` (judul, progress, project/context): memilih Priority selagi judul sedang diketik tidak mengirim judul setengah jadi, dan "+ Baru" (project kosong) lalu diam tidak menghapus project lama. Permintaan eksplisit yang tertunda dibawa ke simpan berikutnya.
- **Flush dan dispose (R12).** `dispose()` (unmount) tetap mengirim flush yang sudah antre: loop tetap memanggil `put` (fire-and-forget, tanpa state atau emit sesudah dispose); flush eksplisit yang antre juga dicoba setelah `put` yang gagal.

### 7.4 Proses simpan

1. `fields = changedFields(saved, form)`; kosong → selesai tanpa request.
2. Bila `title` ada di `fields` dan `validateTitle(form.title)` mengembalikan pesan → `title` dikeluarkan dari `fields`, pesan tampil di bawah input judul (`role="alert"`); saat `blur`, `form.title = saved.title`.
3. `patch = buildPatch(form, fields)` → `api.put('/api/tasks/'+task.id, patch)` (rute lokal; offline aman). Bila `patch.title` ada, judulnya menjadi `titleWithTags(title, tag task sekarang)` (R9): `PUT /api/tasks/:id` yang memuat `title` menimpa tag task dengan `#tag` dari judul itu (server `webapp.py` dan `TFrepo.updateTask` lewat `extractTags`), dan judul yang tersimpan tidak memuat `#tag`, jadi tanpa ini tiap simpan judul menghapus semua tag. Sebelum setiap simpan judul, tag task dimuat ulang (R21; `GET /api/tasks/:id/tags` rute lokal, jalan offline) dan judul disusun dari hasil muatan itu, bukan dari chip yang dimuat saat mount: tag bisa diubah lewat modal atau perangkat lain, dan daftar basi akan memulihkan tag yang sudah dihapus atau menghapus tag baru. Gagal dimuat → diambil ulang sekali; gagal lagi → `put` ditolak (indikator "Gagal menyimpan", tag tetap utuh, "Coba lagi" memuat lagi) (R14: tanpa daftar tag, `titleWithTags(title, [])` menghapus semua tag). Sesudah simpan yang mengirim judul chip tag dimuat ulang (judul dengan `#tagbaru` menjadi tag); di panel chip juga dimuat ulang setiap kali `task.updated_at` berubah (sync, modal, perangkat lain).
4. Satu simpan berjalan pada satu waktu per panel; pemicu yang datang saat simpan berjalan ditandai dan dijalankan sekali setelah selesai (dengan `changedFields` terbaru).
5. Sukses → untuk tiap field di `fields`: `saved[f] = nilai yang dikirim` (R10: dan `form[f] = saved[f]` bila nilai form-nya belum berubah sejak dikirim, sehingga nilai yang dinormalkan, mis. judul yang di-trim, tidak tersisa sebagai field "dirty" basi bagi `mergeExternal`; UI menyimpan progress dan assignee sebagai angka seperti `parseInt` yang sudah ada), kecuali judul: `saved.title = form.title = respons.title` bila respons membawa judul (karena `#tag` dipisah menjadi tag), sehingga input judul menampilkan judul tanpa tag; `window.dispatchEvent(new CustomEvent("taskUpdated", {detail: {taskId}}))` dan `onRefresh()` di-debounce 500 ms agar daftar kiri ikut terbarui.
6. Gagal → `saved` tidak berubah, nilai form tidak dibuang, indikator "Gagal menyimpan" + tombol "Coba lagi" (menjalankan langkah 1–5 lagi). Pesan error lokal (mis. "Judul tidak boleh kosong setelah strip tag") ditampilkan di bawah indikator.
- Saat unmount, flush memanggil `api.put` tanpa menunggu hasil (fire-and-forget); router lokal menulis IndexedDB secara asinkron sehingga tetap tersimpan.

### 7.5 Indikator simpan

- Di baris atas panel (kanan, 12 px, `--text-light`), `aria-live="polite"`:
  - `"Menyimpan…"` selama request;
  - `"Tersimpan"` setelah sukses, memudar setelah 2 dtk;
  - `"Gagal menyimpan"` + tombol `"Coba lagi"` (warna danger) bila gagal.
- Tidak tampil apa-apa sebelum ada edit.

### 7.6 Perilaku aksi di panel

- **Done:** `onDone(task.id)` (App `handleDone`). Panel tetap menampilkan task; status di panel menjadi Done lewat data terbaru. Membatalkan: ubah GTD Status ke status lain (autosave `"now"`).
- **Fokus:** `onToggleFocus(task.id)`; panel tetap.
- **Pindah ke Workspace:** seperti modal, tetapi tanpa `onClose`; panel tetap menampilkan task (kini task workspace, data terbaru setelah sync).
- **Hapus:** `confirm` di App; sukses → pilihan `null` ("Pilih task di daftar"); dibatalkan → tidak ada perubahan.
- **Klik task anak:** pilih task anak di panel (§6.2).

## 8. Error dan kasus tepi

- **Area konten menyempit saat panel tampil** (jendela dikecilkan, sidebar dilebarkan): panel di-unmount (flush simpan), klik berikutnya membuka modal. Pilihan dipertahankan di state; saat lebar cukup lagi, task yang sama tampil bila masih ada.
- **Modal terbuka dari luar (notifikasi, tautan note) saat panel tampil untuk task yang sama:** keduanya bisa mengedit; simpan modal memperbarui `allTasks` → panel menerapkan `mergeExternal` (field yang sedang diketik di panel tidak ditimpa). Tidak ada kunci khusus.
- **Id berubah setelah sync** (cid → id server): `sameTask` mencocokkan lewat `cid`; `stableKey` mencegah remount.
- **Task berulang:** field recurrence tidak ada di form modal sekarang, jadi tidak diedit di panel (sama dengan modal). Centang selesai pada baris task berulang mengikuti perilaku daftar sekarang.
- **Perubahan Group by ke None/Tag/Quadrant saat Kanban** (Kanban → Normal otomatis): panel tetap menyala dan pilihan tetap.
- **localStorage diblokir/JSON rusak:** `readOn` → `false`, `writeOn` gagal diam; Live Edit tetap bisa dinyalakan selama sesi.
- **`ResizeObserver` tidak ada:** fallback event `resize` window ditambah pengukuran ulang di efek setelah setiap render `TaskListView` (menangkap perubahan lebar sidebar).
- **Banyak edit berurutan:** setiap simpan = satu op outbox; dengan pemicu §7.3, mengetik deskripsi panjang menghasilkan beberapa op, bukan satu per huruf. Penggabungan op di luar cakupan.
- **Mode gelap:** semua warna lewat token (`--bg-card`, `--border`, `--text-*`, `--bg-selected`, `--accent`); `[data-theme="dark"]` mengikuti.
- **Aksesibilitas:** panel `aside` ber-`aria-label`; perpindahan pilihan tidak memindahkan fokus keyboard (pengguna bisa sedang di daftar); tombol Live Edit dan baris tetap bisa dioperasikan keyboard seperti sekarang (Enter pada kartu Kanban memilih bila panel aktif).

## 9. Pengujian

### 9.1 Unit — `tests/offline/liveedit.test.js` (Node, modul UMD)

- `isAvailable` (759 → false, 760 → true); `panelWidth` (800 → 420, 1000 → 500, 1600 → 680).
- `readOn/writeOn` dengan storage null, `getItem` melempar, nilai asing.
- `sameTask/findTask`: cocok lewat id angka vs string, lewat cid setelah id berubah ke id server, tidak cocok.
- `pickInitial`: pilihan tetap bila masih ada; task pertama tampil; daftar kosong → null.
- `formFromTask` default; `changedFields` (dibuka tanpa diubah → `[]`; judul beda spasi di ujung → `[]`; tiap field terdeteksi).
- `buildPatch`: deadline dikosongkan → `""`, assignee dilepas → `0`, judul di-trim, hanya field terpilih.
- `saveTrigger` untuk semua field.
- `mergeExternal`: field tidak dirty mengikuti data baru; field dirty tetap; `saved` = data baru.
- `validateTitle`.

### 9.2 Sumber — `tests/offline/liveedit_ui.test.js` (pola `fnSource`)

- PR A: `TaskDetailModal` merender `TaskDetailBody` dengan `variant: "modal"`; `TaskDetailBody` memuat `ModalNotes`, `ModalAttachments`, `handleSave`, "💾 Simpan", "✏️ Edit"; App masih merender `TaskDetailModal` dengan props yang sama.
- PR B: `TaskDetailPanel` memakai `variant: "panel"` dan `key` dari `cid`; `TaskListView` memakai `useLiveEdit`, merender `tl-live-btn` dengan `aria-pressed` hanya bila `available`, `aside` `aria-label: "Detail task"`; `TaskRow`, `CompactRow`, `KanbanCard` menerima `selected` dan memasang `aria-current`; teks persis: "Live Edit", "Tidak ada task", "Pilih task di daftar", "Task ini sudah dihapus atau tidak bisa diakses lagi.", "Menyimpan…", "Tersimpan", "Gagal menyimpan", "Coba lagi", "Judul tidak boleh kosong"; tidak ada `border-left` di CSS/inline baru; `index.html` memuat `<script src="/static/offline/liveedit.js">` dan `sw.js` `STATIC` memuatnya; `handleDelete` mengembalikan boolean.

### 9.3 Regresi

- Tes lama yang mengunci sumber modal/Kanban/daftar (`context_scope_form`, `project_scope_form`, `kanban_board_ui`, `kanban_drag`, `project_views`, dll.) tetap lulus. Bila ada yang harus disesuaikan karena kode pindah ke `TaskDetailBody`, perubahan dijelaskan per tes di laporan PR tanpa melemahkan yang diuji.
- `python -m pytest tests/ -q`, `npm test` (hanya `draw_local_reactive` yang diketahui boleh gagal), `node temporary_files/check_inline_scripts.js`, dan tes PROTOCOL §4.

### 9.4 E2E — `temporary_files/e2e_live_edit.py` (Playwright, tidak di CI)

- PR A: buka modal dari daftar, mode lihat/edit/simpan, Done, Hapus, Pindah, tag overlay — tangkapan layar sebelum/sesudah identik secara visual (1280 px dan 375 px).
- PR B (1280 px, sidebar lebar dan ikon):
  - nyalakan Live Edit di Normal, Compact, Kanban; task pertama terbuka; klik task lain mengganti panel; sorotan pindah;
  - ubah priority (tersimpan langsung), deskripsi (tersimpan setelah diam), judul (tersimpan saat blur) → reload → nilai bertahan;
  - membuka 3 task tanpa edit → jumlah op `_outbox` tidak bertambah;
  - offline (CDP) → edit → online → tersinkron;
  - Done di panel → task tetap di panel, hilang dari daftar Next; ubah status kembali → muncul lagi;
  - Hapus di panel → "Pilih task di daftar";
  - drag kartu Kanban saat panel tampil → pilihan tidak berubah;
  - 375 px dan 900 px dengan sidebar lebar (< 760 px area konten) → tombol tidak ada, klik membuka modal;
  - mode gelap; tanpa error konsol/pageerror.
- **Realisasi** (`temporary_files/e2e_live_edit.py`, 118 langkah) menambah kasus dari tinjauan tiap task: task pertama terbuka juga saat daftar tiba sesudah panel tampil (muat segar dengan Live Edit nyala, dan daftar kosong lalu task tiba); task terpilih dihapus di tempat lain → hanya teks "sudah dihapus" (R6/R16); tanpa kedip di sekitar ambang 760 px (scrollbar klasik sungguhan, daftar pendek berjudul panjang; diuji kena bila kompensasi lebar scrollbar dicabut); bar aksi (Hapus … Done) di dalam viewport pada scrollTop 0 dan sesudah digulir dengan task tinggi; mengganti judul mempertahankan tag dan `#tagbaru` di judul menjadi tag (lokal dan server); "+ Baru" project lalu diam 2 dtk tidak menghapus project lama; nama project baru yang diketik lalu diam tidak tersimpan sampai keluar field, nama project dan context yang diketik dua bagian dengan jeda 2 dtk lalu blur/Enter hanya membuat nama lengkap di server (tanpa "Pema"/"@gud"), memilih project yang sudah ada tersimpan langsung (R19); tag yang dihapus di luar panel tidak dipulihkan oleh simpan judul berikutnya (R21) — kasus R19/R21 diuji kena pada kode klien sebelum perbaikan (8 langkah gagal); membuka 3 task tidak menyimpan apa pun, diuji dengan halaman OFFLINE (CDP) supaya op tidak terkuras oleh push 1,5 dtk setelah mutasi: `_outbox` (basis data IndexedDB `taskflow-offline`) tetap dan `updated_at`/`rev`/`dirty` rekaman lokal tiap task tetap (diuji kena bila panel menyimpan saat dibuka); berpindah view/task secara online tidak mengirim request tulis ke `/api/tasks*`. Catatan harness: memilih menu di sidebar selalu melipat sidebar ke bilah ikon (efek `[page]` di App), jadi "sidebar lebar" didapat dengan menekan › sesudah berpindah halaman; di 900 px bilah ikon masih memberi area konten ≈ 780 px (Live Edit tersedia), baru sidebar lebar menurunkannya di bawah 760 px. Pengecualian konsol: 404 pra-ada `GET /api/tasks/:id` dari `syncpull` (konfirmasi "task benar-benar hilang") setelah hapus + sync, dan `net::ERR_INTERNET_DISCONNECTED` untuk URL `/api/...` selama emulasi offline; akhir skrip menegaskan bahwa setiap respons >= 400 pada `/api/tasks/<id>` adalah `GET` 404.

## 10. Rilis

- **PR A — `claude/task-detail-body`** (pemisahan isi modal): tanpa perubahan perilaku; tanpa modul baru; versi SW naik ke nomor kosong berikutnya di atas `main` dan PR terbuka; entri teratas `static/whatsnew.json` `{"version", "date", "silent": true}`; `app.css` hanya naik bila berubah. Checklist `.agents/PROTOCOL.md` §4.
- **PR B — `claude/live-edit`** (di atas PR A setelah di-merge):
  - `static/offline/liveedit.js` masuk `STATIC` di `sw.js` (URL persis) dan dimuat lewat `<script>` di `index.html` bersama modul offline lain;
  - CSS baru di `static/app.css` (`.tl-live*`, `.tl-live-btn`, `.is-selected`, `.compact-row`, token `--bg-selected` terang/gelap) → `app.css?v=` naik di `index.html` dan `STATIC`;
  - versi SW naik (nama cache `taskflow-v<N>-live-edit`), tes versi disesuaikan;
  - entri teratas `static/whatsnew.json` untuk pengguna: judul "Edit task langsung di samping daftar", poin baru "Tombol Live Edit di halaman task: pilih task di kiri, lalu edit detailnya langsung di kanan tanpa membuka jendela." dan "Perubahan di panel tersimpan otomatis, juga saat offline.";
  - ADR di `.agents/DECISIONS.md` (§13).
- Keduanya file statis saja: tanpa migrasi, tanpa perubahan `webapp.py`, tanpa restart `taskflow-web` (`/api/version` membaca `sw.js`). **Pengecualian R20 (PR B, commit tersendiri):** autosave panel membuat banyak `PUT` per sesi edit, dan setiap `PUT` task workspace mengirim notifikasi "✏️ … memperbarui task …" (in-app + Telegram) ke semua anggota; `update_task` di `webapp.py` melewatinya bila aktor yang sama sudah memicunya untuk task yang sama dalam `TASK_UPDATE_NOTIFY_WINDOW_MIN = 10` menit terakhir (notifikasi penugasan tidak terpengaruh). Dengan commit ini deploy PR B butuh `sudo systemctl restart taskflow-web`; tanpa commit ini (di-drop) PR B kembali file statis saja.
- Merge hanya setelah pemilik bilang "merge dan deploy". `CURRENT_STATE.md` dan `SESSION_LOG.md` diperbarui di tiap PR.

## 11. Di luar cakupan

- Pindah task dengan keyboard (↑/↓, j/k).
- Pembatas kolom yang bisa digeser / lebar panel yang diingat.
- Panel di Fokus Hari Ini, Dashboard, Kalender, atau halaman lain di luar `TaskListView`.
- Autosave di modal (pendekatan 2).
- Penggabungan op `update` berurutan di outbox.
- Mengingat task terpilih setelah reload atau URL/deep link task terpilih.
- Mengedit recurrence atau estimasi 🍅 dari panel (tidak ada di form modal sekarang).
- Memperbaiki perilaku modal lama yang tidak terkait (mis. modal mengirim `assigned_to: null` yang tidak melepas assignee); dicatat sebagai temuan.

## 12. Temuan selama desain (tidak diubah)

- `TaskDetailModal.handleSave` mengirim `assigned_to: null` saat assignee dikosongkan, sedangkan `updateTask` hanya melepas assignee dengan `0`; kemungkinan assignee tidak bisa dilepas lewat modal. Panel memakai `0` lewat `buildPatch`.
- Cabang offline `handleSave` (`OfflineDB.queueAdd`) tampak tidak terpakai karena `PUT /api/tasks/:id` dilayani rute lokal.
- **Bug lama di modal (ada di `main`, tidak diperbaiki di fitur ini; tindak lanjut terpisah):** menyimpan lewat modal (💾 Simpan) selalu mengirim `title`, dan server maupun store lokal (`TFrepo.updateTask` lewat `extractTags`) mengganti tag task dengan `#tag` yang ada di judul itu. Judul yang tersimpan tidak memuat `#tag`, jadi **semua tag task terhapus pada setiap simpan lewat modal**. Dicek di `main`: tag terpasang → ✏️ Edit → Simpan → tag kosong. Panel Live Edit menghindarinya lewat `titleWithTags` (R9) dan tidak mengirim judul bila judul tidak berubah; perilaku modal sengaja tidak diubah (K3, PR A).
- Overlay "Task dengan tag" (`position: absolute; inset: 0`) ikut tergulir bersama isi `.modal-content` / `aside.tl-live-panel` (ada di `main`): saat kotak tergulir, overlay tidak menutupi seluruh area yang terlihat; bounding box sama dengan kotak hanya pada scrollTop 0. Perilaku panel sama dengan modal.

## 13. ADR

**ADR-031 (atau nomor kosong berikutnya): Satu isi detail task untuk modal dan panel; panel Live Edit menyimpan otomatis per field yang berubah.**
- **Konteks:** Pengguna ingin mengedit detail task di samping daftar tanpa membuka/menutup modal. Isi modal ±1.080 baris; menyalinnya untuk panel berarti dua salinan yang harus dirawat. Simpan task lokal menambah op outbox penuh tanpa penggabungan; autosave note pernah menimpa edit orang lain karena menyimpan saat dibuka.
- **Keputusan:** `TaskDetailBody` dengan `variant: "modal" | "panel"`; modal tetap lihat → Edit → Simpan; panel langsung edit dengan autosave yang hanya mengirim field berubah (judul dan nama project/context yang diketik saat blur/Enter, teks panjang saat blur/1,5 dtk diam, pilihan langsung) dan tidak pernah menyimpan saat dibuka. Panel Live Edit adalah toggle per perangkat (`tf_liveedit`) yang terpisah dari view, tersedia bila area konten ≥ 760 px.
- **Konsekuensi:** Satu tempat untuk mengubah isi detail task. Ada percabangan `variant` di dalam body. Edit panjang di panel menghasilkan beberapa op outbox (bukan satu per huruf). Memperluas autosave ke modal cukup mengganti cabang `variant`.
