# Spec: Checklist bertingkat — urutan, sub checklist tanpa batas, progress otomatis (Fase 1)

- **Tanggal:** 2026-11-06 (ditulis), 2026-11-09 (basis diperbarui ke `main` terbaru; nomor baris dicek ulang).
- **Basis kode:** `main` @ `a04f0e6` (mtyatno/taskflow-v4; SW `taskflow-v500-target-pomodoro`, ADR terakhir ADR-047).
- **Status:** **DISETUJUI pemilik 2026-11-09 06.00 WIB** ("Setuju, tulis rencana PR A"; dampak Timeline diterima apa adanya, K17). Desain disetujui per bagian dalam sesi brainstorming 2026-11-06 (Bagian 1 Data & API, Bagian 2 Tampilan & interaksi, Bagian 3 Pengujian & rilis). Rencana PR A: `docs/superpowers/plans/2026-11-09-checklist-bertingkat-pr-a-server.md`; rencana PR B ditulis setelah PR A di-merge. Belum ada kode.
- **Salinan:** repo `docs/superpowers/specs/2026-11-06-checklist-bertingkat-design.md`. Salinan Project claude.ai "alurik" (`claude/spec-checklist-bertingkat-2026-11-06.md`) **belum ada**: penulisan dari sesi 2026-11-06 ditolak (403); salin manual bila perlu.
- **Sumber:** catatan brainstorming `docs/superpowers/specs/2026-11-06-checklist-bertingkat-brainstorm.md` (K1–K5, A1–A4, tiga pendekatan, titik sentuh repo).
- **Istilah:**
  - *butir* = satu baris tabel `subtasks` (UI: "butir checklist"). Di UI, "Subtask" berarti **task anak** (`tasks.parent_id`), bukan butir.
  - *level atas* = butir dengan `parent_id IS NULL`; *sub butir* = butir yang punya induk.
  - *turunan* = semua butir di bawah suatu butir, berapa pun tingkatnya; *saudara* = butir dengan task dan induk yang sama.
  - *pre-order* = induk lalu turunannya, saudara menurut `sort_order` (lalu `id`).
  - *detail* = `TaskDetailBody` (modal + panel Live Edit); *Fokus* = halaman Fokus (`FocusSubtasks`).

---

## 1. Tujuan

Permintaan pemilik (2026-11-06):

> feature baru, aku ingin checklist di setiap task, perlu bisa untuk di rearrange urutannya, dan diharapkan bisa juga untuk unlimited sub checklist, maksudnya satu checklist bisa punya sub checklist, sub checklist tidak mempengaruhi progress task.

**Kriteria berhasil**
1. **Urutan bisa diubah.** Butir bisa diseret lewat pegangan ⠿ (mouse dan sentuh) dan dipindah dengan keyboard. Turunan selalu ikut pindah bersama induknya.
2. **Tingkat tanpa batas.** Data tidak membatasi kedalaman. Tampilan menjorok sampai 6 tingkat lalu berhenti menjorok.
3. **Sub checklist tidak memengaruhi progress.** Bar checklist, angka selesai/total, label tab "Checklist (N)", badge halaman Fokus, dan persen Progress task hanya menghitung butir level atas.
4. **Persen Progress otomatis dan sama di mana-mana.** Task yang punya checklist memperoleh persennya dari checklist. Slider manual terkunci, dan angka yang sama tampil di detail, daftar task, Timeline, bot Telegram, dan perangkat lain.
5. **Data lama aman.** Checklist yang sudah ada tampil seperti sekarang (semua level atas, urutan sama). Persen task lama yang punya checklist dihitung ulang sekali saat rilis.
6. **Perangkat yang belum diperbarui tetap berjalan.** Mereka melihat daftar berurutan tanpa indentasi dan tidak bisa merusak angka Progress.
7. **Sama di dua tempat.** Detail task dan halaman Fokus memakai komponen yang sama dengan kemampuan yang sama.

## 2. Keputusan

**Jawaban pemilik**

| # | Keputusan |
|---|---|
| K1 | "Progress" yang tidak dipengaruhi sub checklist = **dua-duanya**: hitungan selesai/total (bar tab Checklist, badge Fokus) **dan** persen Progress task. Keduanya hanya dari butir level atas. |
| K2 | Task punya ≥ 1 butir level atas → persen = selesai/total level atas, slider Progress **terkunci** (baca-saja, keterangan "dari checklist"). Tanpa checklist → manual seperti sekarang. |
| K3 | Urutan lewat **seret ⠿** (mouse dan sentuh, turunan ikut). Tingkat lewat **Tab / Shift+Tab** dan **menu ⋯** per butir ("Jadikan sub" / "Naikkan level"). |
| K4 | **Dua fase.** Fase 1 (spec ini) = checklist bertingkat + seret + progress otomatis, online seperti checklist sekarang. Fase 2 = checklist local-first (outbox + sinkron), spec terpisah. |
| K5 | Centang induk → **semua turunan ikut selesai**. Anak bisa dicentang sendiri tanpa mengubah induk. Membuka lagi induk tidak membuka anak. |
| K6 (A1) | Berlaku di **detail task** (modal + panel Live Edit) **dan halaman Fokus**. |
| K7 (A2) | Hapus butir induk **ikut menghapus semua turunannya**, dengan konfirmasi bila butir punya anak. |
| K8 (A3) | Butir yang punya anak bisa **dilipat/dibuka** (▸/▾); status lipat **diingat per perangkat**. |
| K9 (A4) | Istilah UI tetap "Checklist" / "Sub checklist"; tabel database tetap `subtasks`. |
| K10 | Pendekatan **kolom `parent_id` di `subtasks`** + endpoint `move`. (Ditolak: jalur berurut `0003.0001` — pindah butir menulis ulang semua turunan; JSON di task — edit bersamaan saling menimpa.) |
| K11 | Butir level atas terakhir dihapus → Progress **tetap di nilai terakhir**, slider kembali manual mulai dari angka itu. |
| K12 | Teks butir **bisa diubah** setelah dibuat (sekarang harus hapus lalu tambah). |
| K13 | Tombol × "Hapus butir" di baris **pindah ke menu ⋯**. |
| K14 | Tab / Shift+Tab mengubah tingkat **hanya saat mengetik** (kotak ubah teks atau kotak tambah butir di bawah daftar). Di luar itu Tab tetap memindah fokus. |
| K15 | Task lama yang sudah punya checklist: Progress **dihitung ulang saat migrasi**; dicatat di "Apa yang baru". |
| K16 | Rilis **dua PR berurutan**: PR A server, lalu PR B tampilan (§12). |
| K17 | Dampak Timeline **diterima apa adanya** (2026-11-09): butir level atas tercentang (termasuk hasil hitung ulang migrasi) membuat task dianggap sudah mulai (`progress > 0`), sama seperti slider manual. Plugin Timeline tidak diubah. |

**Keputusan desain (disetujui bersama bagiannya)**

| # | Keputusan | Alasan |
|---|---|---|
| D1 | Aturan centang berantai, hapus berantai, penomoran ulang, dan hitung progress ada di `repository.py`, bukan di endpoint. | Bot Telegram memanggil `toggle_subtask` / `delete_subtask` / `add_subtask` langsung; web dan bot harus berperilaku sama. |
| D2 | `tasks.progress` dan kolom baru `tasks.checklist_total` adalah **field turunan server**: ditulis saat checklist berubah **tanpa menaikkan `updated_at`**, diambil klien lewat `TASK_DERIVED` di `syncpull.js` (pola `pomodoros_done`). | Centang oleh anggota workspace tidak boleh memicu konflik sinkron pada anggota lain yang sedang mengedit task itu offline. |
| D3 | Selama task punya butir level atas, `PUT /api/tasks/{id}` **mengabaikan** `progress`. | `syncpush.js` (±152) selalu mengirim `progress` di setiap edit task; salinan lama tidak boleh menimpa angka dari checklist. Ini juga menjaga perangkat yang belum diperbarui. |
| D4 | `GET …/subtasks` tetap daftar **datar**, berurutan pre-order, ditambah `parent_id` dan `depth`. | Klien lama tetap menampilkan urutan yang masuk akal (anak tepat di bawah induk, tanpa indentasi). |
| D5 | Tanpa FK cascade pada `parent_id`; turunan dihapus eksplisit dalam satu transaksi. | Banyak koneksi `webapp.py` dibuka dengan `foreign_keys=False`. |
| D6 | Logika pohon jadi modul murni `static/offline/checklist.js` (`TF.checklist`); tampilannya satu komponen `ChecklistTree` untuk detail dan Fokus. | Teruji di Node tanpa browser (pola `taskdetail.js`, `liveedit.js`); dua tempat tidak bercabang perilakunya lagi. |
| D7 | Seret memakai pola pin sidebar (`kanbanDragStart` / `kanbanDragShouldStart`, pointer events, `setPointerCapture`). | Sudah teruji untuk mouse dan sentuh; sentuh mulai setelah tahan ±250 ms sehingga daftar tetap bisa digulir. |
| D8 | Indentasi visual dibatasi 6 tingkat (20 px per tingkat; 16 px di ≤ 640 px). | Teks butir di HP tidak terjepit. Data tetap tanpa batas. |
| D9 | Mutasi checklist dikirim lewat **antrean berurutan** per daftar; seret, ubah teks, dan Tab/Shift+Tab tampil langsung (optimistis). Gagal → toast + muat ulang daftar. | Urutan di server sama dengan urutan aksi pengguna; tampilan tidak menyimpang dari server setelah galat. |
| D10 | Persen dibulatkan **setengah ke atas** dengan rumus bilangan bulat yang sama di Python dan JS. | `round()` Python membulatkan ke genap; rumus bersama mencegah selisih 1% antar tempat. |
| D11 | Alt+↑ / Alt+↓ memindah butir di antara saudaranya. | Alternatif keyboard untuk seret (aksesibilitas). |

## 3. Data

### 3.1 Skema

Di `TaskRepository._init_db` (pola migrasi kolom `client_id`, `repository.py` ±945–949):
- `ALTER TABLE subtasks ADD COLUMN parent_id INTEGER DEFAULT NULL` bila belum ada.
- `CREATE INDEX IF NOT EXISTS idx_subtasks_tree ON subtasks(task_id, parent_id, sort_order)`.
- `ALTER TABLE tasks ADD COLUMN checklist_total INTEGER DEFAULT 0` bila belum ada (pola kolom `tasks` lain di `_init_db`).

Tidak ada FK pada `parent_id` (D5).

### 3.2 Arti kolom

- `parent_id` = id butir induk di task yang sama; `NULL` = level atas.
- `sort_order` = urutan **di antara saudara**. Urutan tampil: `sort_order`, lalu `id` (data lama bisa punya nilai sama). Data lama semuanya level atas dan urutannya tetap sah; tidak ada penomoran ulang massal.
- `tasks.checklist_total` = jumlah butir level atas task itu (0 = tanpa checklist). Hanya server yang menulisnya.

### 3.3 Invarian

1. Induk berada di task yang sama.
2. Tidak ada siklus (butir bukan turunan dirinya sendiri).
3. Tidak ada butir yatim (`parent_id` selalu menunjuk butir yang ada).

Endpoint menjaga ketiganya (§4). Sebagai pertahanan, `migrate_db()` menjalankan pembersihan setiap start: `parent_id` yang menunjuk butir tidak ada atau butir task lain → `NULL`. Pembangun pohon di server dan klien juga memperlakukan butir yatim atau bersiklus sebagai level atas, dengan traversal iteratif (tanpa rekursi).

### 3.4 Hitung ulang progress di migrasi (K15)

`migrate_db()` (berjalan saat deploy **dan** setiap start `taskflow-web`) menjalankan hitung ulang yang idempoten:
- Task dengan ≥ 1 butir level atas → `progress = persen(selesai, total)`, `checklist_total = total`.
- Task dengan `checklist_total ≠ 0` tetapi tanpa butir level atas → `checklist_total = 0` (`progress` tetap).
- `updated_at` tidak disentuh.

Karena berjalan setiap start, perubahan checklist yang masuk lewat proses lama (antara deploy dan restart) ikut terhitung begitu proses baru hidup. Biayanya satu agregat `GROUP BY task_id`.

## 4. API

Semua respons butir berbentuk `{id, task_id, parent_id, depth, title, is_done, sort_order}`. Field lama tetap ada dengan arti yang sama.

`task_progress` = `{done, total, progress}`: `done`/`total` = level atas; `progress` = nilai `tasks.progress` setelah perubahan (bila `total = 0`, nilai terakhir yang tersimpan, K11).

| Endpoint | Body | Respons | Galat |
|---|---|---|---|
| `GET /api/tasks/{id}/subtasks` | – | daftar butir pre-order dengan `depth` | sama seperti sekarang |
| `POST /api/tasks/{id}/subtasks` | `{title, client_id?, parent_id?, index?}` | butir baru + `task_progress` | 422 "Induk checklist tidak ditemukan" (induk tidak ada / task lain / id di luar rentang INTEGER); 422 "Teks butir tidak boleh kosong" (judul kosong setelah trim) |
| **baru** `PATCH /api/subtasks/{id}` | `{title}` | butir + `task_progress` | 404; 422 "Teks butir tidak boleh kosong" |
| **baru** `POST /api/subtasks/{id}/move` | `{parent_id, index?}` | `{items: [daftar lengkap pre-order], task_progress}` | 404; 422 "Induk checklist tidak ditemukan"; 422 "Butir tidak bisa dipindah ke dalam dirinya sendiri" |
| `POST /api/subtasks/{id}/toggle` | – | butir + `changed_ids` + `task_progress` | sama seperti sekarang |
| `DELETE /api/subtasks/{id}` | – | `{ok: true, deleted_ids, task_progress}` | sama seperti sekarang |

**Rincian**
- **Tambah:** `parent_id` kosong = level atas. `index` = posisi di antara saudara (0 = paling atas), kosong = paling akhir, di-clamp ke `0..n`. Idempotensi `client_id` tetap (butir yang sudah ada dikembalikan dengan `task_progress` terkini). Judul di-trim.
- **Ubah teks:** judul di-trim; kosong ditolak. Judul sama → 200 tanpa tulis.
- **Pindah:** `parent_id` wajib ada di body (boleh `null`). `index` = posisi akhir di antara saudara baru **setelah** butir dikeluarkan dari tempat lamanya; kosong = paling akhir; di-clamp. Ditolak bila induk tujuan adalah butir itu sendiri, salah satu turunannya, atau butir task lain. Validasi dan tulis dalam satu transaksi tulis (`BEGIN IMMEDIATE` sebelum membaca), lalu kelompok saudara lama dan baru dinomori ulang `0..n−1`. Posisi tidak berubah → 200 tanpa tulis. Turunan ikut karena `parent_id`-nya tidak berubah.
- **Centang:** menjadi selesai → butir dan semua turunannya `is_done = 1`. Dibuka lagi → hanya butir itu. `changed_ids` = semua id yang nilainya berubah, termasuk butir itu sendiri.
- **Hapus:** butir dan semua turunannya dalam satu transaksi. `deleted_ids` = semua id yang terhapus. Saudara yang tersisa tidak perlu dinomori ulang (celah `sort_order` tidak masalah).
- **Akses:** sama seperti sekarang. `GET` dan toggle memakai `_can_access_task` baca; tambah, ubah teks, pindah, dan hapus memakai `write=True`.
- **Notifikasi workspace:** "menambah item checklist" tetap dikirim untuk butir baru di tingkat mana pun. Ubah teks, pindah, centang, dan hapus tanpa notifikasi (sama seperti centang/hapus sekarang).

**Perubahan server lain**
- `PUT /api/tasks/{id}` (D3): bila `progress` dikirim dan task punya ≥ 1 butir level atas (dihitung di koneksi yang sama), `progress` dibuang dari `updates`. Bila setelah itu tidak ada field lain dan tidak ada `ext_patch`, respons 200 berisi baris sekarang **tanpa** `UPDATE` (bukan 400 "No fields to update"), sehingga `updated_at` tidak naik dan tidak ada notifikasi. Task tanpa checklist: `progress` diterima seperti sekarang.
- `GET /api/tasks/child-counts` (±2334–2380): `sub_total` / `sub_done` hanya level atas (`WHERE parent_id IS NULL`).
- `get_subtask_progress` (dipakai bot): hanya level atas.
- Ekspor (±7526–7537): `subtasks` pre-order, tiap butir `{title, done, depth}`.

## 5. Aturan progress

- **Rumus** (D10), `total > 0`: Python `(done * 200 + total) // (2 * total)`, JS `Math.floor((done * 200 + total) / (2 * total))`. Contoh: 0/3 → 0, 1/3 → 33, 2/3 → 67, 1/8 → 13, 3/8 → 38, 1/200 → 1, 5/5 → 100. Tabel contoh yang sama dipakai di pytest dan `node --test`.
- **Kapan dihitung:** di `repository.py`, dalam transaksi yang sama, setiap tambah, centang, hapus, dan pindah (pindah bisa mengubah jumlah level atas). Ubah teks tidak mengubah angka tetapi tetap mengembalikan `task_progress`.
- **`total` jadi 0** (K11): `checklist_total = 0`, `progress` tidak diubah; slider kembali manual mulai dari nilai itu.
- **Tidak ada otomatisasi status:** progress 100% tidak menyelesaikan task; menyelesaikan task tidak mencentang checklist (sama seperti sekarang).
- **Timeline:** `cpm.js` menganggap task "sudah mulai" bila `progress > 0`. Akibatnya, mencentang butir level atas pertama membuat task dianggap sudah mulai, sehingga jadwal otomatis tidak lagi memindahkannya (ADR-046). Ini sama dengan menggeser slider sekarang, tetapi juga berlaku untuk task lama yang progress-nya naik karena hitung ulang migrasi (§10). Diterima pemilik (K17); plugin Timeline tidak diubah.

## 6. Tampilan

### 6.1 Komponen

- **`ChecklistTree`** (baru, `static/index.html`, ditulis `React.createElement`): props `{ taskId, task, collaborators, variant /* "detail" | "focus" */, autoRefreshMs, onCounts, onProgress }`. Memuat daftar sendiri, mengelola antrean mutasi (D9), status lipat, seret, menu, dan kotak isian.
  - `onCounts({done, total, loaded: true})` (level atas) dipanggil sesudah muat pertama, sukses atau gagal (gagal = 0/0), lalu setiap hitungan berubah. Detail memakainya untuk label tab, `initialTab`, dan kunci pill; Fokus untuk badge.
  - `autoRefreshMs` (Fokus: 15000; detail: tidak ada) memuat ulang daftar berkala, ditunda selama komponen sibuk (§6.6).
  - Setiap `task_progress` dari server: `ChecklistTree` memanggil `TF.checklist.adoptTaskProgress` lalu `onProgress(tp)` (§7.8).
- **Detail:** tab Checklist memakai `ChecklistTree variant="detail"`; `ChecklistRow` dihapus. Bar `.td-check-bar` + "selesai/total" tetap di atas daftar, dari level atas.
- **Fokus:** `FocusSubtasks` mempertahankan cangkangnya (bar `ftask-progress`, "Belum ada checklist.", kotak "Tambah item checklist, tekan Enter" + tombol "Tambah") dan memakai `ChecklistTree variant="focus"` untuk daftar dan perilakunya. Halaman Fokus mendapat ubah teks, hapus, seret, dan lipat.
- **CSS** di blok `/* ── Detail task: awal ── */ … /* ── Detail task: akhir ── */` (`app.css`) untuk kedua varian: hanya token warna, tanpa `#hex` baru, tanpa `rgba(`, tanpa `border-left` (dijaga `theme_guard.test.js`).

### 6.2 Baris

Urutan elemen: pegangan ⠿ · tombol lipat ▸/▾ (hanya bila punya anak; selain itu ruang kosong selebar tombol supaya teks sejajar) · kotak centang · teks · tombol ⋯.

- Indentasi `padding-inline-start = min(depth, 6) × 20px` (16 px di ≤ 640 px) (D8).
- Target sentuh ⠿, ▸/▾, centang, dan ⋯ minimal 32 × 32 px.
- Disusun sebagai `ul > li` bersarang, sehingga pembaca layar ikut membaca tingkatnya.
- Butir selesai dicoret seperti sekarang. Induk yang selesai boleh punya anak yang belum (anak dibuka lagi setelah induk dicentang).

### 6.3 Menu ⋯

`DetailPopover role="menu"` dengan kelas `td-menu` (pola menu workspace ±5683). Isi:

| Item | Aksi | Nonaktif bila |
|---|---|---|
| Ubah teks | buka kotak ubah teks (§7.4) | – |
| Tambah sub butir | buka kotak sub butir di bawah butir ini (§7.3) | – |
| Jadikan sub | = Tab (§7.2) | butir pertama di antara saudaranya |
| Naikkan level | = Shift+Tab (§7.2) | butir level atas |
| Hapus | hapus (§7.6) | – |

### 6.4 Lipat (K8)

- Tombol ▸/▾ `aria-expanded`, `aria-label` "Lipat sub butir «judul»" / "Buka sub butir «judul»".
- Butir terlipat menampilkan chip hitungan anak langsungnya, mis. "2/3".
- Disimpan di `localStorage` kunci `tf_check_collapsed`: array id butir terlipat, maksimal 500 (yang tertua dibuang), setiap baca/tulis dibungkus `try/catch`. Tidak dihapus saat logout. Id yang tidak ada lagi dibiarkan sampai terbuang.
- Butir baru default terbuka. Menjatuhkan atau menambah sub butir ke butir terlipat membuka butir itu.

### 6.5 Hitungan dan pill Progress

- Label tab "Checklist (N)" dan `initialTab` memakai N = jumlah level atas.
- **Pill Progress di detail** (`ProgressPill`, ±9108) mendapat prop `locked: {done, total} | true | null`. Sumbernya: hitungan dari `onCounts` bila sudah dimuat (`total > 0` → `{done, total}`); sebelum dimuat, `task.checklist_total > 0` → `true` (hitungan belum diketahui). Saat terkunci:
  - `aria-label` "Progress 60%, otomatis dari checklist";
  - popover tetap terbuka saat diklik: slider `disabled`, chip preset 0/25/50/75/100 disembunyikan, keterangan "Otomatis dari checklist (3/5)" (tanpa "(3/5)" bila `locked === true`), tombol "Buka Checklist" (pindah ke tab Checklist dan menutup popover).
- **Form edit lengkap** (`TaskFormModal`, ±7976–7987): bila `task.checklist_total > 0`, slider `disabled` dengan keterangan "Otomatis dari checklist".
- Live Edit tidak pernah menyimpan `progress` selama terkunci: karena slider nonaktif, field itu tidak pernah diubah pengguna, dan nilai baru dari server masuk lewat `mergeExternal` sebagai perubahan dari luar (§7.8).

### 6.6 Halaman Fokus

- Badge `subDone/subTotal` dari `child-counts` (sudah level atas) dan `onCounts` dari `ChecklistTree` (level atas), diteruskan ke `onCount` `FocusSubtasks` yang sudah ada.
- Pembaruan otomatis 15 detik pindah dari `FocusSubtasks` ke `ChecklistTree` (`autoRefreshMs`) dan **ditunda** selama komponen sibuk: seret berjalan, kotak ubah teks/tambah berisi teks, menu terbuka, atau antrean mutasi belum kosong.

### 6.7 Teks UI persis

- Menu: "Ubah teks", "Tambah sub butir", "Jadikan sub", "Naikkan level", "Hapus".
- `aria-label`: "Pindahkan «judul»" (⠿), "Aksi butir «judul»" (⋯), "Lipat sub butir «judul»" / "Buka sub butir «judul»", "Ubah teks butir" (kotak ubah teks), "Sub butir baru" (kotak sub butir, juga placeholder-nya).
- Yang sudah ada tetap: "+ Tambah butir checklist baru", "Butir checklist baru", "Belum ada checklist", "Belum ada checklist.", "Tambah item checklist, tekan Enter", "Tambah".
- Konfirmasi: "Hapus «judul» beserta N sub butir?"
- Progress: "Otomatis dari checklist (3/5)", "Otomatis dari checklist", "Buka Checklist".
- Toast: "Gagal menambah butir", "Gagal mencentang butir", "Gagal menyimpan teks butir", "Gagal memindah butir", "Gagal menghapus butir".
- Pengumuman (`aria-live="polite"`, satu per `ChecklistTree`): "«judul» dipindah ke tingkat N, posisi P dari M."

## 7. Interaksi

### 7.1 Seret ⠿ (K3, D7)

- Mulai **hanya dari pegangan ⠿**. Mouse: mulai setelah bergeser melewati ambang; sentuh: setelah tahan ±250 ms, dan geser ≥ 6 px sebelum itu = gulir biasa (`kanbanDragStart` / `kanbanDragShouldStart`). `setPointerCapture`, `touchmove` non-pasif dicegah hanya selama seret, `contextmenu` ditekan, `pointerup` yang hilang membongkar seret, Escape membatalkan.
- Saat mulai: subtree yang diseret diredupkan dan dikeluarkan dari perhitungan; posisi baris lain diukur sekali.
- **Celah tujuan** dari posisi vertikal. **Tingkat** = `clamp(tingkatAwal + round(dx / indentPx), min, max)` dengan `min` = tingkat baris di bawah celah (0 bila tidak ada) dan `max` = tingkat baris di atas celah + 1 (0 bila tidak ada). Garis penanda tampil di celah dengan indentasi tingkat itu (visual dibatasi 6).
- Menjatuhkan sebagai anak butir terlipat → menjadi anak terakhirnya dan butir itu dibuka.
- Gulir otomatis saat penunjuk ≤ 40 px dari tepi atas/bawah wadah gulir (modal, panel, atau halaman Fokus).
- Hasil (celah, tingkat) → `TF.checklist.dropTarget` → `{parent_id, index}` atau `null` (posisi sama, tanpa permintaan).

### 7.2 Keyboard

- **Tab** (kotak ubah teks, K14): jadikan anak **terakhir** dari saudara sebelumnya (butir itu dibuka bila terlipat). **Shift+Tab:** jadi saudara induknya, tepat di bawah induk. Saudara-saudara berikutnya **tetap** di induk lama (tidak diadopsi). Di kotak ubah teks, Tab/Shift+Tab selalu ditangkap (tidak memindah fokus) walaupun aksinya tidak mungkin; keluar dengan Enter atau Escape.
- **Alt+↑ / Alt+↓** (D11) di elemen mana pun dalam baris, termasuk kotak ubah teks: tukar posisi dengan saudara sebelumnya/berikutnya. Di ujung = tidak terjadi apa-apa.
- Setelah pindah, fokus tetap di butir yang sama (dicari lagi menurut id setelah render ulang), dan kotak ubah teks tetap terbuka bila sebelumnya terbuka.
- Semua pindah lewat `POST /api/subtasks/{id}/move`; tujuan dihitung `TF.checklist.indentTarget` / `outdentTarget` / `siblingMoveTarget`.

### 7.3 Tambah

- **Kotak bawah** ("+ Tambah butir checklist baru" di detail, kotak Fokus): menyimpan `depth` (awal 0). Tab menaikkan sampai `depth butir terakhir pre-order + 1`; Shift+Tab menurunkan sampai 0; kotak menjorok sesuai `depth`. Induk = leluhur butir terakhir pada tingkat `depth − 1` (atau butir terakhir itu sendiri). Enter menambah di posisi paling akhir dan kotak tetap terbuka dengan `depth` yang sama. Escape menutup dan mengembalikan `depth` ke 0.
- **"Tambah sub butir"** (menu ⋯): kotak muncul di bawah turunan terakhir butir itu, satu tingkat lebih dalam. Enter menambah sebagai anak terakhir dan kotak tetap terbuka. Escape, atau blur saat kosong, menutup. Tab di kotak ini tidak ditangkap (fokus pindah seperti biasa).
- Mention tetap bekerja di kedua kotak (`MentionInput`).

### 7.4 Ubah teks (K12)

- Klik teks butir, atau ⋯ → "Ubah teks", membuka `MentionInput` berisi teks lama (kursor di akhir).
- Enter atau blur menyimpan: di-trim; sama dengan lama → tanpa permintaan; kosong → kembali ke teks lama tanpa menghapus butir. Escape membatalkan.
- Tab/Shift+Tab di kotak ini menyimpan teks dulu (bila berubah) lalu memindah butir (§7.2).

### 7.5 Centang

- Seperti sekarang: menunggu respons server, lalu semua `changed_ids` diperbarui (centang induk mencoret turunannya).

### 7.6 Hapus (K7, K13)

- ⋯ → "Hapus". Butir dengan turunan → `window.confirm("Hapus «judul» beserta N sub butir?")` (N = jumlah turunan). Butir tanpa turunan langsung terhapus seperti sekarang.
- Setelah respons, semua `deleted_ids` dibuang dari daftar.

### 7.7 Antrean dan kegagalan (D9)

- Satu antrean berurutan per `ChecklistTree`.
- Pindah dan ubah teks diterapkan langsung ke tampilan (`TF.checklist.applyMove`), lalu dikirim. Tambah, centang, dan hapus menunggu respons (seperti sekarang).
- Respons `move` mengganti daftar dengan `items` dari server **bila antrean sudah kosong**.
- Galat apa pun (termasuk offline): toast yang sesuai (§6.7), antrean dikosongkan, daftar dimuat ulang dari server (bila gagal dimuat, daftar terakhir yang dikenal server tetap tampil).

### 7.8 Progress ke task lokal

- Setiap respons berisi `task_progress` → `ChecklistTree` (kedua varian) memanggil `TF.checklist.adoptTaskProgress(task, tp)`, yang menulis `progress` dan `checklist_total` ke record task di IndexedDB (dicari menurut `server_id`) **tanpa** mengubah `dirty`, `rev`, atau `base_rev`. Lalu `onProgress(tp)`: detail memperbarui kunci pill dan memanggil `onRefresh?.()`; Fokus memanggil penyegar daftar Fokus yang sudah ada. Daftar task dan Timeline langsung menampilkan angka baru; Live Edit menerimanya lewat `mergeExternal` dan tidak menyimpannya ulang.

## 8. Bot Telegram, ekspor, `merge_db.py`

- **Bot** (`bot.py`): perilaku centang dan hapus mengikuti repository (D1). `/sub` tetap menambah butir level atas. `/view` menampilkan butir pre-order dengan indentasi dua spasi per tingkat (berhenti di tingkat 6, D8) + "↳ " untuk sub butir; judul bagian checklist memakai hitungan level atas. Tombol centang per butir diberi awalan "↳ " untuk sub butir. Pada mode hapus, tombol butir yang punya turunan diberi akhiran " (+N sub)".
- **Ekspor:** §4.
- **`merge_db.py`** (±111): menyalin `parent_id` dengan memetakan id lama → id baru (induk dimasukkan sebelum anak, pre-order); induk yang tidak ikut tersalin → level atas.

## 9. Offline dan sinkron (Fase 1)

- `hydrate.js` `COPY`: tambah `checklist_total` (bawaan 0).
- `syncpull.js`: `progress` dan `checklist_total` masuk `TASK_DERIVED` (diadopsi pada record bersih yang `base_rev`-nya sama, D2); `checklist_total` juga masuk `ONLY_IF_SENT` (server lama tidak mengirimnya).
- `syncpush.js`: tidak berubah; `progress` tetap dikirim dan server mengabaikannya bila perlu (D3).
- `taskroutes.js`: tidak berubah. `/api/subtasks/*` tidak punya rute lokal, jadi `move` dan `PATCH` langsung ke jaringan; offline → galat → §7.7. Checklist pada task yang belum tersinkron (id = cid) tetap seperti sekarang.
- Store IndexedDB `subtasks` tidak disentuh (Fase 2).

## 10. Kasus tepi dan risiko

- **Jendela PR A → PR B dengan klien lama:** centang induk di klien lama hanya memperbarui baris induk sampai daftar dimuat ulang; hapus induk meninggalkan baris anak di layar sampai dimuat ulang (centang pada baris itu → 404 di konsol); slider lama pada task bercheklist tampak tersimpan, tetapi angkanya **tertinggal di perangkat itu** sampai PR B di-deploy atau ada edit lain pada task itu (respons PUT dan pull tidak mengadopsi `progress` karena `base_rev` maju; dibuktikan review PR A); server dan perangkat lain tetap memakai angka checklist. Klien lama juga baru melihat angka hasil hitung ulang migrasi (K15) dan perubahan akibat centang setelah PR B. Karena itu PR B di-deploy segera setelah PR A.
- **Dua anggota memindah bersamaan:** transaksi tulis menjaga invarian (§3.3); yang terakhir menang. Daftar yang sedang terbuka di perangkat lain baru berubah saat dimuat ulang (detail: saat task dibuka lagi; Fokus: 15 detik).
- **Hitung ulang migrasi menaikkan progress task lama** → di Timeline task itu dianggap sudah mulai (§5). `taskflow.db` dicadangkan sebelum deploy PR A.
- **Daftar sangat dalam:** traversal iteratif di Python dan JS; tampilan berhenti menjorok di tingkat 6.
- **Task terhapus / akses dicabut saat daftar terbuka:** respons 404/403 → toast + muat ulang (yang akan gagal dan menampilkan "Belum ada checklist").
- **Papan tombol bot untuk checklist panjang** bisa melebihi batas Telegram; ini sudah terjadi sekarang dan tidak diubah di Fase 1.

## 11. Pengujian

### 11.1 Unit modul murni — `tests/offline/checklist.test.js`

- `buildTree` / `flatten`: daftar datar → pohon pre-order; butir yatim dan siklus → level atas; status lipat menyembunyikan turunan; hitungan anak langsung untuk chip.
- `topLevelCounts`, `percent`: tabel contoh §5 (sama dengan pytest).
- `indentTarget`, `outdentTarget`, `siblingMoveTarget`: butir pertama, butir level atas, butir terakhir, induk terlipat.
- `dropRange`, `dropTarget`: rentang tingkat di setiap celah; tidak bisa jatuh ke turunan sendiri; posisi sama → `null`; jatuh ke butir terlipat → anak terakhir.
- `applyMove`: hasil sama dengan respons server untuk kasus yang sama.
- `addParentFor(depth)` (kotak bawah).
- Penyimpanan lipat: batas 500, `localStorage` yang melempar error, JSON rusak.
- `adoptTaskProgress`: tidak mengubah `dirty`/`rev`/`base_rev`.

### 11.2 pytest — `tests/test_checklist_tree.py` (baru)

- Migrasi: kolom ada dan aman dijalankan dua kali; hitung ulang (1/3 → 33), task tanpa checklist tidak berubah, `updated_at` tidak naik; pembersihan `parent_id` yatim dan lintas task.
- Tambah dengan `parent_id`/`index`; induk task lain → 422; `client_id` idempoten.
- Ubah teks: trim, kosong → 422, akses tulis.
- Pindah: urutan dan penomoran ulang; turunan ikut; ke diri/turunan → 422; ke task lain → 422; `index` di-clamp; posisi sama tanpa tulis; pengguna tanpa akses → 403.
- Centang berantai dan `changed_ids`; buka induk → anak tetap; buka anak → induk tetap.
- Hapus berantai, `deleted_ids`, cabang lain utuh.
- Progress: level atas saja; pembulatan; `progress` + `checklist_total` tanpa naik `updated_at`; level atas terakhir dihapus → nilai tetap, `checklist_total` 0.
- `PUT /api/tasks`: `progress` diabaikan selama ada checklist; PUT hanya-`progress` → 200 tanpa naik `updated_at`; task tanpa checklist tetap menerima `progress`.
- Diperbarui: `test_task_child_counts.py` (level atas). Baru: tampilan `/view` bot (indentasi, hitungan), ekspor (`depth`), `merge_db.py` (pemetaan induk).

### 11.3 node --test lain

- `syncpull.test.js`: `progress` dan `checklist_total` diadopsi untuk record bersih, tidak untuk record dengan editan belum terkirim; server tanpa `checklist_total` tidak mengubah nilai lokal.
- Disesuaikan: `task_detail_redesign.test.js` (× pindah ke ⋯, `ChecklistTree`), `focus_child_counts.test.js`, `focus_filter_ui.test.js`, `taskroutes.test.js`; `theme_guard.test.js` tetap lulus.

### 11.4 E2E Playwright — `temporary_files/e2e_checklist_tree.py` (baru)

Panel 1280 px tema terang; modal dan Fokus 375 px tema gelap.
- `C-1` tambah butir, Tab di kotak bawah → sub butir menjorok; "Checklist (N)" dan pill hanya level atas.
- `C-2` seret mouse butir yang punya anak → anak ikut; muat ulang → urutan bertahan.
- `C-3` 375 px: tahan lalu seret dengan sentuh; menggeser biasa menggulir, tidak menyeret.
- `C-4` Tab/Shift+Tab di kotak ubah teks; Alt+↑/↓; fokus tetap di butir yang sama.
- `C-5` centang induk → anak dicoret; pill: slider nonaktif + "Otomatis dari checklist (x/y)"; "Buka Checklist" pindah tab.
- `C-6` hapus induk → konfirmasi menyebut N sub butir; hapus level atas terakhir → slider aktif lagi dengan nilai terakhir.
- `C-7` lipat → muat ulang → tetap terlipat dengan chip "2/3".
- `C-8` Fokus: badge level atas; pembaruan 15 detik tidak mengganggu kotak ubah teks yang terbuka.
- `C-9` daftar task dan Timeline menampilkan persen baru tanpa muat ulang.
- E2E lama disesuaikan: `e2e_detail_redesign.py` (B-3), `e2e_live_edit.py`, `e2e_task_detail_body.py`, `e2e_focus_page.py`.

## 12. Rilis (K16)

**PR A — server**
- Skema, migrasi, hitung ulang (§3), endpoint (§4), aturan progress (§5), bot, ekspor, `merge_db.py` (§8), pytest §11.2.
- Tanpa perubahan `static/` → tanpa naik versi SW.
- Deploy: cadangkan `taskflow.db`; workflow menjalankan `migrate_db()`; restart `taskflow-web` **dan** bot.

**PR B — tampilan** (di-deploy segera setelah PR A)
- `static/offline/checklist.js`, `ChecklistTree`, kunci Progress, halaman Fokus, `hydrate.js`/`syncpull.js` (§9), tes §11.1, §11.3, §11.4.
- Checklist rilis frontend PROTOCOL §4: naikkan versi SW (nomor berikutnya setelah yang ada di `main` saat itu) di semua tempat; `app.css?v=` di `index.html` dan `STATIC`; `checklist.js` masuk `STATIC` di `sw.js` **dan** `<script>` di `index.html`; entri teratas `static/whatsnew.json`. Draf:
  - Judul: "Checklist bertingkat"
  - "Butir checklist kini bisa punya sub checklist. Tekan Tab saat mengetik untuk menjadikannya sub."
  - "Seret ⠿ untuk mengubah urutan; sub checklist ikut pindah bersama butir induknya."
  - "Progress task kini otomatis dari checklist utama, termasuk task lama. Sub checklist tidak ikut dihitung."
  - "Centang butir induk sekaligus menyelesaikan semua sub-nya. Teks butir juga bisa diubah."

**Keduanya:** ADR baru di `.agents/DECISIONS.md` (nomor berikutnya di `main`): `progress` dan `checklist_total` adalah field turunan server yang tidak menaikkan `updated_at`, dan `PUT` mengabaikan `progress` selama ada checklist. Update `CURRENT_STATE.md` dan `SESSION_LOG.md`; merge hanya setelah pemilik bilang "merge dan deploy".

## 13. Di luar cakupan

- Fase 2: checklist local-first (outbox, sinkron, rute lokal).
- Memindah butir antar task; mengubah butir menjadi task anak atau sebaliknya.
- Pilih banyak butir sekaligus; urungkan (undo).
- Enter di kotak ubah teks membuat butir baru di bawahnya (gaya outliner).
- Tenggat, penanggung jawab, atau catatan per butir.
- Perintah bot untuk membuat sub butir atau memindah butir.

## Catatan implementasi PR A (server) — 2026-11-09

Branch `claude/checklist-bertingkat-server`; rencana `docs/superpowers/plans/2026-11-09-checklist-bertingkat-pr-a-server.md`; ADR-048. Dikerjakan subagent implementer per tugas dengan review terpisah per kelompok tugas (T1–T4, perbaikan + T5–T7, T8–T9).

- **Pohon efektif = `parent_id` tersimpan (tambahan atas review).** Setiap operasi tulis checklist memanggil `_heal_task_tree` di awal transaksinya (butir yatim, lintas task, atau bersiklus → level atas sesuai `checklist_tree.preorder`), dan `GET …/subtasks` mengembalikan `parent_id` efektif. Alasannya: tanpa itu tampilan dan perhitungan (`parent_id IS NULL`) tidak sepakat pada data rusak (mis. dibuat bot lama di jendela deploy). Aturan pemutus siklus: anggota dengan `(sort_order NULL→0, id)` terkecil naik ke level atas — **PR B harus menirunya di `TF.checklist`**.
- **§4:** `POST …/subtasks` dengan judul kosong setelah trim → 422 "Teks butir tidak boleh kosong" (sebelumnya akan 500). `parent_id` di luar rentang INTEGER SQLite → 422 "Induk checklist tidak ditemukan". DELETE yang kalah balapan (butir hilang antara cek akses dan hapus) → 404.
- **D3 / R7:** pengecekan "punya checklist" di PUT = ada butir apa pun (setara dengan ≥ 1 level atas di pohon efektif). Payload penuh yang hanya berbeda di `progress` tetap menaikkan `updated_at` (perilaku D3, dicatat di ADR-048).
- **§8 bot:** indentasi memakai spasi biasa (praktik yang sudah ada di bot), berhenti di tingkat 6 supaya pesan `/view` tetap di bawah 4.096 karakter; `ChecklistError` ditangkap di `/sub` dan input teks. Judul bagian tetap "📝 Subtasks".
- **§10:** klaim "slider lama kembali ke angka checklist saat sinkron" dikoreksi (lihat §10).
- **Residual (pra-ada, di luar cakupan):** id di path > 2⁶³ → 500 di seluruh API; idempotensi `client_id` di `add_subtask` tidak dibatasi per task; `merge_db.py` menggabung checklist cadangan ke task duplikat (menjalankan dua kali menggandakan butir).
- **Angka:** pytest 1633 passed / 3 skipped (basis 1476 / 3). E2E dan verifikasi akhir: lihat handover PR A.
