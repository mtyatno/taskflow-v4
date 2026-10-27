# Spec: Redesain detail task — klik nilai untuk mengubah, simpan otomatis di modal dan panel

- **Tanggal:** 2026-10-26
- **Basis kode:** `main` @ `ff0d317` (mtyatno/taskflow-v4; SW `taskflow-v471-simpan-tag`, `app.css?v=368`). Live Edit (#96/#97) dan perbaikan tag (#98) sudah di `main`.
- **Status:** **diimplementasikan di branch `claude/redesain-detail-task`** (2026-10-27, Task 1–8 dengan review per task); `origin/main` b365263 (tema PR A #99) sudah di-merge ke branch, sehingga rilisnya **SW `taskflow-v473-detail-baru`, `app.css?v=370`, ADR-034** (v472/369/ADR-033 sudah dipakai tema PR A). Menunggu review akhir dan PR draft; merge hanya setelah pemilik bilang "merge dan deploy". Desain disetujui per bagian dalam sesi brainstorming 2026-10-26 (bagian 1 "ok", bagian 2 "ok", bagian 3 "pas", bagian 4 pengujian/rilis/cakupan); lihat "Keputusan pelaksanaan" di bawah §12.
- **Salinan:** Project claude.ai "alurik" `claude/spec-redesain-detail-task-2026-10-26.md`; repo `docs/superpowers/specs/2026-10-26-redesain-detail-task-design.md`. Isi keduanya sama.
- **Sumber desain:** dua mockup pemilik (2026-10-26). Mockup 1: bar atas `#239 • Dibuat …` + Fokus / Selesai / ⋯, judul besar, chip Q1 / Terlambat / progress, kisi properti dua kolom, deskripsi tanpa bingkai, tab. Mockup 2 (dipilih sebagai arah): pill progress membuka popover "Ubah Progress" (slider + 0/25/50/75/100%), baris Menunggu dan Tag dengan "+", tab Subtask (2) / Checklist (3) / Catatan / Lampiran, baris subtask dengan centang, `#id`, chip status, tanggal, ↗, dan "+ Buat subtask baru…".
- **Istilah:**
  - *detail* = `TaskDetailBody` (`static/index.html`), isi yang dipakai modal (`TaskDetailModal`) dan panel Live Edit (`TaskDetailPanel`);
  - *modal* = `variant="modal"` (dibuka dari mana pun lewat `selectedTask` di App; satu-satunya bentuk di layar sempit);
  - *panel* = `variant="panel"` (kolom kanan Live Edit);
  - *properti* = baris label + nilai di kisi properti (Status, Prioritas, Tahap, Proyek, Deadline, Assign ke, Menunggu, Tag);
  - *popover* = kotak kecil yang terbuka saat nilai properti atau pill progress diklik;
  - *pengendali simpan* = `useTaskAutosave` / `TF.liveedit.createAutosaver` (sudah ada dari Live Edit).

---

## 1. Tujuan

Tampilan detail task sekarang adalah formulir: label di atas input, `select` bawaan browser, dan di modal dua mode (lihat → ✏️ Edit → 💾 Simpan). Pemilik ingin tampilan yang lebih rapi dan lebih cepat dipakai: nilai tampil sebagai teks, diklik untuk diubah, dan tersimpan sendiri. Karena isi detail sudah satu sumber (ADR-031), perubahan di `TaskDetailBody` berlaku untuk modal dan panel sekaligus.

**Kriteria berhasil**
1. **Satu tampilan.** Modal dan panel menampilkan isi yang sama persis. Bedanya hanya: ✕ di modal, bar atas menempel di panel, dan modal tertutup setelah Selesai.
2. **Klik nilai = ubah.** Setiap properti tampil sebagai teks; klik membuka popover untuk mengubahnya. Tidak ada tombol Edit, Batal, atau Simpan di mana pun.
3. **Simpan otomatis di modal juga.** Modal memakai pengendali simpan yang sama dengan panel. Menutup modal mengirim perubahan yang tertunda.
4. **Aman untuk data.** Membuka task tanpa mengubah apa pun tidak menyimpan apa pun. Tag tidak hilang saat judul diubah. Nama proyek/tahap baru hanya dibuat atas perintah jelas ("+ Buat").
5. **Isi terkelompok.** Subtask, Checklist, Catatan, dan Lampiran ada dalam tab dengan jumlah isinya; tab pertama yang berisi terbuka otomatis.
6. **Ikon, bukan emoji; warna lewat token.** Elemen detail yang baru memakai ikon garis/duotone (`Icon`, `ViewGlyph`) dan token warna, sehingga terang/gelap dan tema palet (Sakura/Lavender, rencana terpisah) ikut tanpa kerja tambahan.
7. **HP tetap nyaman.** Di 375 px kisi properti satu kolom dan popover selebar layar.

## 2. Keputusan

| # | Keputusan | Alasan |
|---|---|---|
| D1 | Opsi **A**: modal dan panel sama persis — klik nilai untuk mengubah, simpan otomatis, tanpa Edit/Simpan. Menggantikan K3 spec Live Edit (modal lihat → Edit → Simpan). | Pilihan pemilik. Satu cara kerja untuk satu isi. |
| D2 | Pendekatan **1**: logika `TaskDetailBody` (pengendali simpan, `tagsForTitle`, overlay tag, Pindah ke Workspace, pemuatan checklist/subtask/tag) dipertahankan; tampilannya diganti dengan komponen kecil baru. | Pilihan pemilik. Logika simpan Live Edit sudah teruji (R9–R21); yang berubah hanya tampilan dan cara memicu simpan. |
| D3 | Variant hanya mengatur tiga hal: ✕ (modal), bar atas menempel (panel), tutup setelah Selesai (modal, lewat jalur App yang sudah ada). | Kriteria 1. |
| D4 | Nilai properti hanya berubah saat dipilih di popover. Mengetik di kotak cari popover tidak mengubah form. | Menghapus kebutuhan "simpan saat blur" untuk nama yang diketik (R19): tidak ada nilai setengah jadi di form. |
| D5 | Tag ditambah lewat jalur judul `#tag` (lokal menambah, ADR-032), bukan rute tag baru. | Rute lokal hanya punya `GET`/`DELETE` tag; jalur judul sudah aman dan ter-push dengan himpunan lengkap. |
| D6 | Semua isi tab dimuat sekaligus saat detail dibuka; panel tab yang tidak aktif disembunyikan (`hidden`), bukan di-unmount. | Jumlah di setiap tab dan pilihan tab pertama butuh data keempatnya; catatan/lampiran memuat sendiri saat mount. |
| D7 | Logika murni baru di `static/offline/taskdetail.js` (`TF.taskdetail`, UMD). | Pola `liveedit.js` / `focusfilter.js`: diuji di Node tanpa React. |
| D8 | Hanya klien. Tanpa perubahan server, skema, atau API; satu PR. | Tampilan baru dan autosave modal tidak masuk akal dirilis terpisah. |

## 3. Kondisi sekarang (yang diganti)

- `TaskDetailBody` (`index.html` ±8553–9824): baris judul (`#id`, judul `h2`/input, ✕ atau `TaskSaveIndicator`), kotak "↳ Subtask dari" berwarna biru tetap, meta panel (kuadran, Terlambat, 🕐 Created, ✅ Done), chip tag, lalu:
  - panel atau modal mode edit: kisi `select` Priority/GTD Status, `ComboSelect` Project/Context, `input type=date` Deadline, Waiting For (hanya status waiting), `select` Assign ke, slider Progress, `MentionInput` Deskripsi;
  - modal mode lihat: badge status/prioritas/kuadran, deskripsi dalam kotak, kisi teks berawalan emoji, bar progress;
  - bagian 📌 Subtask (baris berwarna per prioritas + form tambah dengan `select` status), ✅ Checklist (bar progress, baris, form tambah), `ModalNotes`, `ModalAttachments`, panel Pindah ke Workspace;
  - bar aksi bawah: 🗑️ Hapus, Pindah ke Workspace, Fokus, ✏️ Edit (modal), ✅ Done; mode edit modal: Batal, 💾 Simpan (`handleSave` mengirim seluruh form);
  - overlay "Task dengan tag".
- Modal: `useTaskAutosave(task, isPanel, …)` mengembalikan `null`, jadi modal memakai `form`/`setF` lokal dan `handleSave`.
- `TF.liveedit.saveTrigger`: title/progress/project/context → `"blur"`; description/waiting_for → `"idle"`; priority/gtd_status/deadline/assigned_to → `"now"`.

## 4. Tata letak

Urutan dari atas ke bawah, sama di modal dan panel:

### 4.1 Bar atas (`DetailTopBar`)

- Kiri, teks kecil `--text-light`: `#<id> • Dibuat <tanggal>` (`TF.taskdetail.formatCreated`, mis. "Dibuat 21 Okt 2026"); bila selesai ditambah ` • Selesai <tanggal>`. Bila task punya induk, di bawahnya satu baris "↳ Subtask dari #<parent_id> — <parent_title>" (token `--text-secondary`, tanpa warna biru tetap).
- Kanan, berurutan:
  - **Fokus**: tombol ikon `star` (`aria-pressed`, `aria-label="Fokus"`, `title` "Tambahkan ke Fokus" / "Hapus dari Fokus"), isi bintang saat fokus. Klik → `onToggleFocus(task.id)`; status tampil langsung lewat state lokal yang mengikuti `task.is_focused` saat prop berubah. Tidak menutup modal. Disembunyikan bila status done.
  - **Selesai / Buka lagi**: bila status bukan done → tombol "Selesai" (ikon `check`) → `onDone()` (jalur App `handleDone`: konfirmasi subtask tertunda, toast; modal tertutup, panel tetap). Bila done → "Buka lagi" (ikon `refresh`) → `change("gtd_status", "next")` (simpan `"now"`). Status dibaca dari form (nilai terkini), bukan dari prop.
  - **⋯** (ikon `menu`, `aria-label="Aksi lain"`, `aria-haspopup="menu"`): popover menu berisi "Pindah ke Workspace" (hanya task pribadi tingkat atas, `canMove`; membuka panel Pindah yang sudah ada di bawah bar atas) dan "Hapus" (warna danger; `onDelete()` → `confirm` di App).
  - **✕** (hanya modal, `headerAction`): menutup modal (flush lewat unmount).
  - **Indikator simpan** (`TaskSaveIndicator`) di sebelah kiri tombol-tombol itu, keduanya variant.
- Panel: bar atas `position: sticky; top: 0` di dalam panel (latar `--bg-card`, garis bawah `--border` saat isi tergulir). Modal: tidak menempel.

### 4.2 Judul

- Input satu baris bergaya teks (tanpa bingkai sampai hover/fokus), 20 px / 700, `aria-label="Judul task"`. Perilaku sama dengan panel sekarang: simpan saat blur/Enter, Escape mengembalikan, `validateTitle` + `titleNotice` (`role="alert"`), `tagsForTitle` (R21/R14).

### 4.3 Chip (`DetailChips`)

- **Kuadran** (baca saja): `QuadBadge` dengan kuadran dihitung dari nilai form terkini (`TF.tasklogic.calculateQuadrant({priority, deadline})`), sehingga berubah langsung saat prioritas/deadline diubah.
- **Terlambat**: bila `TF.taskdetail.isOverdue(form.deadline, form.gtd_status, hari ini)`; teks "Terlambat" + titik `overdue-indicator`, warna `--danger`.
- **Progress** (`ProgressPill`): tombol pill "15%" dengan bar mini; klik → popover "Ubah Progress": slider 0–100 langkah 5 dan tombol preset 0/25/50/75/100% (`TF.taskdetail.PROGRESS_PRESETS`). Slider: `change` saat geser, `commit` saat `pointerup`/`keyup`/`blur`; preset: `change` + `commit`; menutup popover juga `commit("progress")`. Warna `--success` saat 100%.

### 4.4 Kisi properti (`PropertyRow`)

Dua kolom (label kecil di atas nilai), satu kolom di bawah 640 px; urutan: Status, Prioritas, Tahap, Proyek, Deadline, Assign ke (hanya task workspace), Menunggu, lalu Tag selebar kisi. Nilai kosong tampil "+ Tambah" (`--text-light`). Seluruh nilai adalah `button` (`aria-haspopup="dialog"`, `aria-expanded`) yang membuka popover di bawahnya.

**Aturan simpan properti (satu untuk semua):** memilih di popover = `change(field, nilai)` lalu popover ditutup; **menutup popover properti dengan cara apa pun** (pilihan, Enter, Escape, klik di luar, ✕ di popover) memanggil `commit(field)`. Commit tanpa perubahan tidak mengirim apa pun. Escape tidak membuang ketikan.

| Properti | Nilai tampil | Popover (`…Picker`) | Kapan tersimpan |
|---|---|---|---|
| Status | ikon `GTD_ICON` + `GTD_LABELS` | `OptionPicker`: Inbox, Next, Waiting, Someday, Done | saat dipilih (`"now"`) |
| Prioritas | titik `PRI_DOT` + "P1 Critical" | `OptionPicker`: P1–P4 | saat dipilih (`"now"`) |
| Tahap | nama tahap | `NamePicker` (opsi `useScopeContexts(task.list_id)`, judul popover `contextScopeLabel`) | opsi yang ada, "+ Buat '…'", Enter, atau "Kosongkan" → `change` + tutup (commit) |
| Proyek | nama proyek | `NamePicker` (opsi `useScopeProjects(task.list_id)`, judul popover `projectScopeLabel`) | sama dengan Tahap |
| Deadline | "21 Okt 2026" (merah bila terlambat) | `DatePicker`: Hari ini / Besok / Senin depan (`taskDatePromptQuickPicks`), `input type=date`, "Hapus deadline" | tombol cepat / Hapus → `change` + tutup; input tanggal → `change` saja (field `"blur"`, tidak tersimpan per digit), tersimpan saat popover ditutup |
| Assign ke | nama anggota (hanya task workspace, `task.list_id`) | `MemberPicker`: anggota `GET /api/lists/:id/members` (dimuat saat detail dibuka) + "Lepas" | saat dipilih (`"now"`; Lepas = `0` lewat `buildPatch`) |
| Menunggu | teks | `TextPicker`: satu input (`change` per ketikan, field `"blur"`) + "Simpan" | Enter / Simpan / popover ditutup |
| Tag | chip `#nama` (klik = overlay "Task dengan tag", × = hapus seperti sekarang) + tombol "+" (`aria-label="Tambah tag"`) | `TagAdder`: input + saran dari `GET /api/tags` yang belum terpasang | §6.3 |

- `NamePicker`: kotak cari (`autofocus`, placeholder "Cari atau buat baru…"), daftar opsi yang cocok (`TF.taskdetail.filterOptions`, tidak membedakan huruf besar/kecil, cocok di mana pun), "+ Buat '<teks>'" bila `TF.taskdetail.canCreate(query, options)` (teks tidak kosong setelah trim dan tidak sama persis tanpa beda huruf dengan opsi yang ada), dan "Kosongkan" bila ada nilai. Enter = opsi yang sama persis tanpa beda huruf (`exactOption`, nama opsi yang ada dipakai apa adanya), kalau tidak ada maka "+ Buat" dengan teks yang di-trim; kotak kosong + Enter tidak melakukan apa pun. Mengetik tidak mengubah form (D4).
- "Menunggu" selalu tampil (sebelumnya hanya untuk status Waiting), sesuai mockup.
- Tidak ada lagi `ComboSelect`, `select`, atau `label.input-label` di detail. `TaskFormModal` (buat task) tidak berubah.

### 4.5 Deskripsi

- `MentionInput` `as="textarea"` dengan kelas `td-desc`: tanpa bingkai dan latar (garis tipis hanya saat fokus), placeholder "Tulis deskripsi atau catatan lingkup tugas di sini…", tinggi mengikuti isi (`scrollHeight`) sampai ±12 baris lalu bergulir, tanpa resize. Mention tetap bekerja. Simpan `"idle"` (1,5 dtk diam) atau saat blur, seperti sekarang.

### 4.6 Tab (`DetailTabs`)

- `div[role=tablist]` dengan empat `button[role=tab]` (`aria-selected`, `aria-controls`): "Subtask", "Checklist", "Catatan", "Lampiran", masing-masing dengan jumlah dalam kurung bila > 0 (Checklist: jumlah butir). Panel `div[role=tabpanel]` dengan atribut `hidden` saat tidak aktif (tetap ter-mount, D6).
- Tab awal: `TF.taskdetail.initialTab(counts)` = tab pertama yang berisi dengan urutan Subtask, Checklist, Catatan, Lampiran; semua kosong → Subtask. Dihitung sekali setelah keempat muatan selesai (gagal dihitung 0); sampai saat itu Subtask aktif. Bila pengguna sudah mengklik tab, pilihan otomatis tidak menimpanya.
- **Subtask** (`SubtaskRow`): kotak centang (selesai → `POST /api/tasks/:id/done`; buka lagi → `PUT /api/tasks/:id {gtd_status: "next"}`; lalu muat ulang task anak + `onRefresh`), `#id` + judul (dicoret bila done, klik = buka), `StatusBadge`, deadline singkat (`TF.taskdetail.formatShortDate`, mis. "21 Okt"; merah bila terlambat), tombol ↗ (`aria-label="Buka subtask"`) → `onOpenTask(ct)` (panel: ganti pilihan; modal: ganti task di modal). Di bawahnya input "+ Buat subtask baru…" (Enter → `POST /api/tasks {title, gtd_status: "inbox", parent_id}`). `select` status di form tambah dihapus. Baris tidak lagi berwarna per prioritas.
- **Checklist** (`ChecklistRow`): bar progress tipis (selesai/total) bila ada butir; baris kotak centang + judul + tombol × (`aria-label="Hapus butir"`, tampil saat hover; selalu tampil di perangkat tanpa hover). Di bawahnya "+ Tambah butir checklist baru" (klik → input `MentionInput`; Enter tambah dan tetap terbuka untuk butir berikutnya, Escape tutup).
- **Catatan / Lampiran**: `ModalNotes` / `ModalAttachments` dengan prop baru `bare` (tanpa garis atas dan judul bagian "📓 Catatan"/"📎 Lampiran"; tombol Upload tetap) dan `onCount(n)` (dipanggil setiap jumlah berubah, termasuk 0 saat muat gagal). Pemakaian lain komponen itu (tanpa prop baru) tidak berubah.

### 4.7 Lain-lain

- Panel Pindah ke Workspace tampil tepat di bawah bar atas saat dibuka dari menu ⋯ (isi dan perilaku sama).
- Bar aksi bawah (`task-detail-actions`) dihapus beserta CSS stickinya.
- Overlay "Task dengan tag" dan `pinOverlayToScrollBox` tidak berubah.

## 5. Popover (`DetailPopover`)

- Dirender lewat `ReactDOM.createPortal` ke `document.body`, `position: fixed`, `z-index` di atas `.modal-overlay` (50) → 60; latar `--bg-card`, `1px solid var(--border)`, radius 12 px, bayangan.
- Posisi dari `getBoundingClientRect()` jangkar: di bawah jangkar, rata kiri, lebar `min(320 px, lebar viewport − 16)`; bila ruang di bawah kurang dari tinggi popover dan ruang di atas lebih besar → di atas jangkar; digeser agar tidak keluar tepi kiri/kanan (8 px). Di bawah 640 px: `left: 8; right: 8`. Dihitung ulang saat gulir (capture) dan resize.
- Posisi dihitung oleh fungsi murni `TF.taskdetail.popoverPosition` (§7) sehingga bisa diuji di Node; komponen hanya mengukur jangkar dan popover (layout effect, sebelum tampil).
- Tertutup oleh: Escape, `pointerdown` di luar popover dan jangkar, pilihan yang menutup, atau unmount detail (pindah task di panel, modal ditutup: portal ikut hilang, tidak ada popover yatim). Fokus pindah ke elemen pertama (atau yang ber-`autofocus`) saat terbuka dan kembali ke jangkar saat tertutup bila fokus masih di dalam popover. `role="dialog"` + `aria-label` (judul popover); menu ⋯ memakai `role="menu"`/`menuitem`.
- Klik di dalam popover tidak menutup modal: event React dari portal naik ke induk React-nya (di dalam `.modal-content` yang menghentikan propagasi).
- Satu popover terbuka pada satu waktu per detail (state `openPop` di `TaskDetailBody`).

## 6. Perilaku simpan

### 6.1 Satu pengendali untuk kedua variant

- `useTaskAutosave(task, true, {onSaved, getTags: tagsForTitle})` untuk modal dan panel; `fv`/`sf` selalu dari pengendali. Dihapus: `isEditing`, `setIsEditing`, `form`/`setF`/`resetForm` lokal, `saving`, `handleSave` (beserta cabang `OfflineDB.queueAdd`), tombol ✏️ Edit / Batal / 💾 Simpan, dan prop `onEdit`/`onOfflineEdit` yang tidak terpakai lagi di body (props App tetap diterima tanpa efek).
- Menutup modal (✕, klik overlay, Escape bila ada, Selesai) me-unmount body → `flush(); dispose()` seperti panel (R12): perubahan tertunda tetap terkirim lewat rute lokal.
- `onSaved` sama dengan panel: event `taskUpdated`, muat ulang tag bila judul ikut, `onRefresh` di-debounce 500 ms. Pemuatan ulang chip tag saat `updated_at` berubah berlaku juga untuk modal.

### 6.2 Pemicu (`TF.liveedit.saveTrigger`)

| Field | Pemicu | Berubah dari sekarang |
|---|---|---|
| gtd_status, priority, assigned_to | `"now"` | — |
| project, context | `"blur"` (komit saat popover ditutup) | nilai hanya berubah saat dipilih di `NamePicker` (D4) |
| deadline | `"blur"` (komit saat popover ditutup) | dari `"now"` |
| progress | `"blur"` (komit saat lepas slider / keyup / preset / popover ditutup) | — |
| waiting_for | `"blur"` (komit saat Enter / Simpan / popover ditutup) | dari `"idle"` |
| title | `"blur"` (blur / Enter) | — |
| description | `"idle"` (1,5 dtk / blur) | — |

Deadline menjadi `"blur"` supaya mengetik tanggal di `input type=date` (tahun digit demi digit) tidak mengirim satu simpan per digit; simpan non-eksplisit membuang field `"blur"` (R11) sehingga memilih Status saat deadline belum dikomit tidak mengirim tanggal setengah jadi.

### 6.3 Tambah tag

1. Nama dinormalkan (`TF.taskdetail.normalizeTagName`: trim, buang `#` di depan; kosong → "Tulis nama tag"; tidak cocok `^[A-Za-z0-9_À-ɏ]+$` → "Tag hanya boleh huruf, angka, dan _").
2. `await auto.flush()`; bila sesudahnya status simpan "error" → batal dengan pesan "Perubahan lain belum tersimpan. Coba lagi dulu." di bawah input. (Judul tidak valid tidak mungkin tertunda di sini: membuka popover memindahkan fokus dari judul, dan blur judul yang tidak valid mengembalikannya.)
3. Muat tag segar (`tagsForTitle`), lalu `api.put('/api/tasks/'+id, {title: titleWithTags(saved.title, [...tags, {name}])})` — rute lokal; store lokal menambah tag (ADR-032), push mengirim himpunan lengkap.
4. Sukses → muat ulang chip, kosongkan input (popover tetap terbuka untuk tag berikutnya), `onSaved`. Gagal → pesan di popover, tag lama utuh.
5. Tag yang sudah terpasang (tanpa beda huruf) tidak dikirim; saran hanya tag yang belum terpasang.

## 7. Struktur kode

- **Komponen baru** (di `index.html`, tepat sebelum `TaskDetailBody`, setelah `pinOverlayToScrollBox`): `DetailPopover`, `DetailTopBar`, `DetailChips`, `ProgressPill`, `PropertyRow`, `OptionPicker`, `NamePicker`, `DatePicker`, `MemberPicker`, `TextPicker`, `TagAdder`, `DetailTabs`, `SubtaskRow`, `ChecklistRow`. Semua `React.createElement` (tanpa JSX), gaya lewat kelas `td-*` di `app.css` (bukan `style` inline berwarna).
- **Modul baru** `static/offline/taskdetail.js` (`TF.taskdetail`, UMD; memakai `TF.tasklogic` di browser, `require("./tasklogic.js")` di Node):
  ```
  TAB_ORDER = ["subtask", "checklist", "notes", "attachments"]
  PROGRESS_PRESETS = [0, 25, 50, 75, 100]
  MONTHS_SHORT = ["Jan","Feb","Mar","Apr","Mei","Jun","Jul","Agu","Sep","Okt","Nov","Des"]
  initialTab(counts) -> tab                  // counts {subtask, checklist, notes, attachments}; null/undefined = 0
  isOverdue(deadline, status, todayISO) -> boolean   // deadline < hari ini, status bukan done/archived; kosong → false
  formatCreated(iso) -> "21 Okt 2026" | ""   // terima "YYYY-MM-DD" atau "YYYY-MM-DDTHH:MM…"
  formatShortDate(iso, todayISO) -> "21 Okt" | "21 Okt 2027"   // tahun hanya bila beda tahun dengan hari ini
  formatDeadline(iso) -> "21 Okt 2026" | ""
  filterOptions(options, query) -> string[]  // trim, tanpa beda huruf, substring; query kosong → semua
  canCreate(query, options) -> boolean
  exactOption(query, options) -> string|null // opsi yang sama persis tanpa beda huruf
  normalizeTagName(raw) -> {name} | {error}
  clampProgress(v) -> 0..100 kelipatan 5
  STATUS_ORDER = ["inbox","next","waiting","someday","done"]; PRIORITY_ORDER = ["P1","P2","P3","P4"]
  popoverPosition({anchor, size, viewport}) -> {top, left, width, maxHeight, placement}
                                             // anchor {top,bottom,left}; size {height}; viewport {width,height};
                                             // margin 8, jarak 4, lebar min(320, vw−16), maxHeight min(420, 0.7·vh);
                                             // vw < 640 → left 8, lebar vw−16; di atas jangkar bila ruang bawah
                                             // < tinggi dan ruang atas lebih besar; left dijepit ke [8, vw−8−lebar]
  ```
  Dimuat lewat `<script src="/static/offline/taskdetail.js">` sesudah `tasklogic.js` dan masuk `STATIC` di `sw.js`.
- **`TF.liveedit.saveTrigger`**: deadline dan waiting_for → `"blur"` (§6.2). Tes unit yang ada disesuaikan.
- **CSS** (`app.css`, blok baru bertanda `/* ── Detail task: awal ── */` … `/* ── Detail task: akhir ── */` di akhir berkas): `.td-top`, `.td-title`, `.td-chips`, `.td-pill`, `.td-props`, `.td-prop`, `.td-prop-val`, `.td-empty`, `.td-desc`, `.td-tabs`, `.td-tab`, `.td-sub-row`, `.td-check-row`, `.td-pop`, `.td-pop-item`, `.td-menu` dsb.; hanya token (`--bg-card`, `--bg-hover`, `--bg-subtle`, `--bg-selected`, `--border`, `--text-*`, `--accent`, `--success`, `var(--danger, #dc2626)`), latar lembut beraksen lewat token `--accent-soft` (ADR-033; awalnya `color-mix(in srgb, var(--accent) 14%, transparent)`, diganti saat merge tema PR A), bukan `rgba` lime tetap, tanpa `border-left`; tombol "Selesai" netral (latar `--bg-card`, garis `--border`, ikon centang `--success`) supaya tidak butuh warna teks di atas aksen; `@media (max-width: 640px)` untuk kisi satu kolom; `@media (hover: none)` untuk × checklist. `#id` panjang (task belum tersinkron, id = cid) dipotong dengan elipsis. CSS `.tl-live-panel .task-detail-actions` dihapus.

## 8. Error dan kasus tepi

- **Simpan gagal**: indikator "Gagal menyimpan" + "Coba lagi" di bar atas (kedua variant); nilai form tidak dibuang. Modal ditutup saat gagal → flush terakhir dicoba sekali (fire-and-forget, R12).
- **Offline**: semua jalur memakai rute lokal (PUT task, subtask/checklist, child task, done). Daftar anggota (Assign) dan `GET /api/tags` saran memakai data lokal/terakhir; bila daftar anggota gagal dimuat, picker menampilkan "Tidak bisa memuat anggota" dan nilai lama tetap; saran tag yang gagal dimuat hanya membuat daftar saran kosong.
- **Task berubah dari luar** (sync, panel lain): `mergeExternal` seperti sekarang; popover yang terbuka tidak ditutup.
- **Modal dibuka ulang lewat ↗** (task anak): App sudah me-reset `selectedTask` (null lalu task) → body baru, flush body lama.
- **Selesai di modal untuk task dengan subtask tertunda**: konfirmasi App seperti sekarang; modal tetap terbuka bila dibatalkan.
- **Judul tidak valid saat tag ditambah**: §6.3 langkah 2.
- **Layar sangat pendek**: popover dibatasi `max-height: min(420px, 70vh)` dan bergulir.
- **Mode gelap / tema**: hanya token; tidak ada `#hex` baru di elemen detail kecuali `--danger` fallback.
- **Aksesibilitas**: semua nilai properti, chip progress, tab, dan aksi adalah `button` dengan label; tab bisa dipindah dengan panah kiri/kanan (pola tablist standar); popover menjaga fokus seperti §5.

## 9. Pengujian

### 9.1 Unit — `tests/offline/taskdetail.test.js` (Node)
- `initialTab`: urutan prioritas; semua kosong → subtask; nilai null.
- `isOverdue`: kemarin/hari ini/besok; status done dan archived; deadline kosong.
- `formatCreated`, `formatDeadline`, `formatShortDate` (tahun sama vs beda, input dengan jam, kosong).
- `filterOptions`, `exactOption`, `canCreate` (kosong, spasi, sama persis beda huruf, substring).
- `normalizeTagName` (`#`, spasi, karakter terlarang, aksen).
- `clampProgress`, `PROGRESS_PRESETS`.
- `tests/offline/liveedit.test.js`: `saveTrigger` deadline/waiting_for → `"blur"`; autosaver: deadline diubah lalu priority dipilih → patch hanya priority; commit → deadline terkirim.

### 9.2 Sumber — `tests/offline/task_detail_redesign.test.js` (pola `fnSource`)
- `TaskDetailBody` tidak memuat `isEditing`, `handleSave`, "💾 Simpan", "✏️ Edit", `ComboSelect`, `task-detail-actions`, `OfflineDB.queueAdd`; memanggil `useTaskAutosave(task, true`.
- ✕ hanya lewat `headerAction` modal; bar atas memuat "Selesai", "Buka lagi", "Aksi lain", "Fokus"; teks persis placeholder deskripsi, "+ Buat subtask baru…", "+ Tambah butir checklist baru", "Ubah Progress", "+ Tambah", "Kosongkan", "Hapus deadline", "Lepas".
- `DetailPopover` memakai `ReactDOM.createPortal`, Escape, `pointerdown` di luar; tab `role="tablist"`/`"tab"`/`"tabpanel"` + `hidden`.
- Komponen detail baru tanpa emoji (rentang emoji umum) dan tanpa `border-left`; CSS `td-*` tanpa warna hex kecuali fallback token.
- `index.html` memuat `taskdetail.js` sesudah `tasklogic.js`; `sw.js` `STATIC` memuatnya.
- `ModalNotes`/`ModalAttachments` menerima `bare` dan `onCount`.
- Jembatan pytest `tests/test_taskdetail_node.py` menjalankan kedua berkas (tanpa `fake-indexeddb`).

### 9.3 Regresi
- Tes lama yang mengunci tampilan lama disesuaikan tanpa melemahkan yang dijaga, dijelaskan per tes di laporan PR: `task_detail_body.test.js` (✕ hanya modal tetap), `liveedit_ui.test.js` (varian panel, "Modal tetap: handleSave menutup" → modal autosave + flush, R19 → NamePicker komit saat pilih, CSS aksi menempel → bar atas menempel), `context_scope_form.test.js` dan `project_scope_form.test.js` (opsi mengikuti scope task lewat `NamePicker`), `tag_tasks_overlay.test.js`, `task_move_workspace.test.js`.
- `python3 -m pytest tests/ -q`, `npm test` (hanya `draw_local_reactive` boleh gagal), `node temporary_files/check_inline_scripts.js`, tes PROTOCOL §4.

### 9.4 E2E (Playwright, tidak di CI)
- Skrip baru `temporary_files/e2e_detail_redesign.py` (kelompok per bagian, `E2E_ONLY=…`) tumbuh bersama implementasi; `temporary_files/e2e_task_detail_body.py` dan `temporary_files/e2e_live_edit.py` disesuaikan dengan tampilan baru tanpa membuang kasus lamanya (overlay tag, tag aman, offline, perpindahan Live Edit). Gabungannya mencakup, di 375 px dan 1280 px, terang dan gelap:
  - tiap properti diubah lewat popover → reload → bertahan (lokal dan server);
  - buka 3 task tanpa mengubah apa pun → `_outbox` dan rekaman lokal tetap (offline CDP, seperti Live Edit);
  - ketik deskripsi lalu langsung ✕ → tersimpan; judul diubah → tag utuh; tag ditambah lewat "+" dan dihapus lewat ×;
  - ketik nama proyek "Pema" lalu jeda lalu tutup popover → tidak ada proyek "Pema"; "+ Buat 'Pemasaran'" → proyek dibuat sekali;
  - ketik tahun di input deadline → satu simpan saat popover ditutup (hitung request/op);
  - preset progress + slider;
  - subtask: buat, centang, ↗ (panel ganti pilihan; modal ganti task); checklist: tambah, centang, hapus;
  - tab awal dan jumlah benar (task dengan hanya catatan → tab Catatan);
  - popover tidak terpotong di tepi kanan/bawah (jangkar di dekat tepi) dan selebar layar di 375 px;
  - Selesai menutup modal; panel tetap dan tombol berubah "Buka lagi" → status Next;
  - overlay tag; menu ⋯ Pindah ke Workspace dan Hapus;
  - Live Edit: pindah task mem-flush, bar atas menempel saat panel digulir;
  - tanpa error konsol/pageerror (pengecualian yang sama dengan skrip Live Edit).

## 10. Rilis

- Satu PR `claude/redesain-detail-task`, frontend saja (tanpa restart `taskflow-web`).
- `static/offline/taskdetail.js` masuk `STATIC` (URL persis) dan `<script>` di `index.html`.
- SW naik ke nomor kosong berikutnya: **`taskflow-v473-detail-baru`** (v472 dipakai tema PR A `taskflow-v472-tema-fondasi`); **`app.css?v=370`** di `index.html` dan `STATIC`; tes versi disesuaikan (sed massal tanpa `static/whatsnew.json`).
- Entri teratas `static/whatsnew.json`: judul "Tampilan detail task baru"; `new`: "Klik nilai mana pun di detail task untuk mengubahnya; perubahan tersimpan otomatis, juga di jendela detail di HP.", "Subtask, checklist, catatan, dan lampiran kini dalam tab dengan jumlah isinya.", "Atur progress dengan cepat lewat pilihan 0, 25, 50, 75, atau 100%.".
- ADR-034 di `.agents/DECISIONS.md` (§12; ADR-033 dipakai tema). `CURRENT_STATE.md`, `SESSION_LOG.md` diperbarui. Merge hanya setelah pemilik bilang "merge dan deploy".
- **Koordinasi tema:** tema PR A (#99, ADR-033) sudah di `main` dan di-merge ke branch ini. Detail baru sejak awal memakai token; saat merge, latar lembut beraksen `color-mix(in srgb, var(--accent) 14%, transparent)` diganti token `--accent-soft` (peran "latar chip/aktif") agar palet PR B mengaturnya. Hover 22% dan garis 30% tetap `color-mix(var(--accent))` (tanpa token setara; tetap mengikuti palet lewat `--accent`).

## 11. Di luar cakupan

- Form buat task (`TaskFormModal`) dan wizard Inbox.
- Mengurutkan ulang checklist/subtask dengan geser.
- Tampilan markdown di deskripsi.
- Mengedit recurrence dan estimasi 🍅 dari detail.
- Menarik tag task dari server untuk perangkat kedua, dan op outbox setelah hapus tag lewat × (tindak lanjut ADR-032).
- Pintasan keyboard (selain Escape/Enter/panah tab yang disebut di atas).
- Mengubah status subtask dari chip di barisnya (chip baca saja).

## 12. ADR

**ADR-034: Detail task satu tampilan klik-untuk-ubah dengan simpan otomatis di modal dan panel.**
- **Konteks:** ADR-031 menyatukan isi detail untuk modal dan panel, tetapi modal masih lihat → Edit → Simpan dan tampilannya berupa formulir. Pemilik ingin tampilan yang lebih rapi dan sama di kedua tempat.
- **Keputusan:** `TaskDetailBody` menampilkan nilai sebagai teks yang membuka popover saat diklik; modal ikut memakai pengendali simpan otomatis Live Edit. Nilai hanya berubah saat dipilih di popover (nama baru lewat "+ Buat"), deadline dan "menunggu" dikomit saat popover ditutup, tag ditambah lewat jalur judul `#tag`. Isi bawah dikelompokkan dalam tab yang dimuat sekaligus.
- **Konsekuensi:** Tidak ada lagi dua mode di modal; menutup modal mengirim perubahan tertunda. Komponen picker kecil menjadi pola untuk tampilan detail lain. Op outbox di modal kini per field (bukan satu op seluruh form).

## Keputusan pelaksanaan (2026-10-27)

Keputusan kontroler selama eksekusi Task 1–8 (ledger `.superpowers/sdd/2026-10-26-redesain-detail-task/progress.md`):

- `<script>` `taskdetail.js` ditaruh setelah `focusfilter.js` (bukan tepat setelah `tasklogic.js`): tes lama mengunci `focusfilter.js` tepat setelah `tasklogic.js`; spec hanya butuh setelah `tasklogic.js`.
- Opsi status GTD "✅ Done" → "Done" (tanpa emoji); select itu sendiri diganti popover di Task 4.
- Baris "↳ Subtask dari" mencari induk lewat GET lokal (baris lokal hanya punya `parent_cid`): satu GET lokal tambahan saat membuka anak.
- `TF.taskdetail.formatCreated` menampilkan tanggal kalender **lokal** untuk stempel berjam (`YYYY-MM-DD HH:MM:SS` tanpa zona = UTC); tanggal tanpa jam tidak diubah. Mengalahkan "tanpa Date" di §7, agar task yang dibuat 00:00–07:00 WIB tidak tampil sebagai kemarin.
- `TaskMovePanel` diekstrak dan select status di tambah-subtask dihapus lebih awal (Task 4, bukan Task 6) karena tes "tanpa select di `TaskDetailBody`".
- Menutup popover properti dengan mengeklik ulang tombol nilainya juga mengomit field itu (§4.4 "menutup popover dengan cara apa pun").
- Tag tampil huruf kecil (`#rapat`) mengikuti normalisasi `tagrepo` yang ada; contoh "#Rapat" di spec tidak mengikat.
- Membuat subtask dari detail mengirim `parent_cid` bersama `parent_id` (router lokal mengabaikan `parent_id`), sekaligus memperbaiki subtask lokal yatim yang sudah ada sebelumnya.
- Rilis dinomori ulang setelah `main` bergerak ke b365263 (tema PR A): merge commit (tanpa rebase/force-push), `taskflow-v473-detail-baru`, `app.css?v=370`, ADR-034.

**Tindak lanjut yang diketahui (di luar branch ini):**

- **"Lepas" (unassign) tidak sampai ke server.** `syncpush` `taskToUpdatePayload` mengirim `assigned_to: null` dan PUT server mengabaikan `null`, jadi lepas-assign hanya mengubah toko lokal (sudah terjadi di panel Live Edit sejak #97). Mengirim `0` untuk setiap `null` berisiko perangkat basi menghapus assignment dari perangkat lain, jadi butuh desain sendiri.
- **Subtask antre di `TaskFormModal` yatim secara lokal.** Form buat task (di luar cakupan, §11) masih membuat subtask antre hanya dengan `parent_id`, sehingga di toko lokal subtask itu tidak tertaut ke induk sampai sinkron; perbaikan `parent_cid` di branch ini hanya untuk jalur detail.

## 13. Revisi 2026-10-27: detail padat (SW `taskflow-v474-detail-padat`, `app.css?v=371`)

Permintaan pemilik setelah memakai v473 di laptop 14": deskripsi dan tab tertutup di bawah lipatan panel karena tiap properti memakan dua baris. Disetujui ketiganya:
1. **Properti satu baris** — label kiri (84 px), nilai kanan (`.td-prop` grid). Kisi dua pasang kolom hanya bila wadah ≥ 560 px (`@container` pada `.td-props-box`, bukan lebar layar), selain itu satu kolom (modal, HP, panel sempit).
2. **Jarak dirapatkan** — bar atas panel, judul (19 px), chip, kisi, dan deskripsi.
3. **Properti opsional kosong diringkas** — Assign ke (task workspace), Menunggu, dan Tag yang kosong tampil sebagai satu baris tombol kecil "+ Assign · + Menunggu · + Tag" (`.td-prop-add`, aria-label sama dengan tombol nilainya: "Assign ke: kosong", "Menunggu: kosong", "Tambah tag"). Klik membuka baris penuhnya beserta popover; baris tetap penuh selama popover terbuka atau setelah terisi, dan kembali diringkas bila ditutup dalam keadaan kosong.

