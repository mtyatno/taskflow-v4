# Rancangan Desain: Workspace Files Repository & Chat File Attachments

**Tanggal:** 2026-10-05  
**Status:** Disetujui (Approved via Brainstorming)  
**Lingkup:** Full-Stack (Backend `webapp.py`, Database SQLite, Frontend `static/index.html`, Styling `static/app.css`, Test Suites `tests/`)

---

## 1. Latar Belakang & Motivasi
Pada ruang kolaborasi Workspace Alurik (`shared_lists`), pengguna saat ini dapat berdiskusi di halaman Diskusi (`ChatPage` / `ChatRoom`) serta menautkan Task (`msg_type: "task_attach"`) dan Catatan (`msg_type: "note_attach"`). Namun, pengguna belum dapat melampirkan berkas dokumen (seperti PDF, spreadsheet Excel, dokumen Word, atau gambar teknis) langsung di obrolan.

Kebutuhan kolaborasi di lapangan (seperti peninjauan dokumen teknik, SOP, formulir commissioning, dan laporan) menuntut:
1. **Kemampuan Melampirkan Berkas di Chat**: Pengguna dapat mengunggah berkas baru atau memilih berkas yang sudah ada di workspace untuk dikirimkan ke obrolan.
2. **Katalog Berkas Terpusat (Katalog Tab Files di Workspace)**: Berkas tidak hanya terkubur di riwayat percakapan chat (*chat black hole*), melainkan otomatis terdaftar di katalog tab **Files** pada halaman Workspace (`slist_<id>`).
3. **Agregasi Otomatis dari Lampiran Task**: Semua berkas yang diunggah sebagai attachment pada task di dalam workspace tersebut juga otomatis terdata di katalog tab Files ini.
4. **Pusat Berkas Terpadu**: Pengguna juga dapat mengunggah berkas langsung di tab Files tanpa harus melalui chat/task, lalu berkas tersebut dapat dicari dan ditautkan ke chat jika dibutuhkan.

---

## 2. Arsitektur Data & Penyimpanan

### 2.1 Penyimpanan Fisik Berkas
- Berkas fisik disimpan di direktori server `UPLOAD_DIR` (atau Nextcloud WebDAV jika dikonfigurasi) menggunakan nama acak berbasis UUID (`<uuid>.<ext>`) untuk mencegah tabrakan nama file asli (*collision*).
- Batas ukuran berkas mengikuti `MAX_FILE_SIZE` (default 10 MB).
- Akses berkas (unduh dan pratinjau) harus selalu melalui validasi keanggotaan workspace (`is_list_member_or_owner`).

### 2.2 Skema Tabel Baru: `workspace_files`
Tabel ini bertindak sebagai *single source of truth* untuk semua berkas di dalam workspace:

```sql
CREATE TABLE IF NOT EXISTS workspace_files (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    list_id       INTEGER NOT NULL REFERENCES shared_lists(id) ON DELETE CASCADE,
    user_id       INTEGER NOT NULL REFERENCES users(id),
    filename      TEXT NOT NULL,                  -- nama berkas tersimpan di disk (e.g. 5a1b2c...pdf)
    original_name TEXT NOT NULL,                  -- nama asli berkas (e.g. SOP_Commissioning.pdf)
    file_size     INTEGER DEFAULT 0,              -- ukuran berkas dalam byte
    mime_type     TEXT DEFAULT '',                -- tipe MIME (e.g. application/pdf)
    source        TEXT NOT NULL DEFAULT 'direct', -- 'direct' | 'chat' | 'task'
    task_id       INTEGER DEFAULT NULL,           -- referensi task jika bersumber dari lampiran task
    is_deleted    INTEGER DEFAULT 0,              -- soft delete (1 = dihapus)
    created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_workspace_files_list ON workspace_files(list_id, created_at);
```

### 2.3 Relasi dengan Pesan Diskusi (`messages`)
- Kolom baru di tabel `messages`: `file_id INTEGER DEFAULT NULL REFERENCES workspace_files(id) ON DELETE SET NULL`.
- `msg_type`: Nilai baru `"file_attach"`.
- Jika berkas berstatus `is_deleted = 1`, kartu pesan di chat tetap dirender namun menampilkan status informatif: *"Berkas telah dihapus"*.

### 2.4 Sinkronisasi Lampiran Task
- Ketika pengguna mengunggah lampiran pada task (`POST /api/tasks/{task_id}/attachments`) dan task tersebut memiliki `list_id` (berada di dalam workspace), sistem backend secara otomatis menyalin/mendaftarkan rekaman metadata berkas tersebut ke dalam `workspace_files` dengan `source: 'task'` dan `task_id: task_id`.

### 2.5 Hak Akses & Kebijakan Hapus (Opsi A)
- **Unggah**: Semua member dan owner workspace dapat mengunggah berkas.
- **Hapus**: Hanya **Pengunggah berkas (`user_id`)** dan **Owner workspace (`shared_lists.owner_id`)** yang berhak menghapus berkas. Member lain akan ditolak dengan respons `403 Forbidden`.
- **Mekanisme Hapus**: Berkas fisik di disk dihapus dan status database ditandai `is_deleted = 1` (soft delete / tombstone) agar bubble chat masa lalu tetap utuh secara visual dan tidak mengalami crash.

---

## 3. Fitur & Tampilan di Diskusi / Chat (`ChatRoom`)

### 3.1 Pembaruan Attach Popup (Ikon 📎)
Ketika pengguna mengklik ikon `📎` pada `ChatInputBar`:
- Tab popup bertambah menjadi 3: `[ 📌 Task ]  [ 📝 Note ]  [ 📁 File ]`.
- Pada tab `[ 📁 File ]`:
  1. Tombol atas: **`➕ Unggah Berkas Baru`** (membuka file picker sistem OS).
  2. Input pencarian: `[ 🔍 Cari berkas di workspace... ]`.
  3. Daftar berkas yang sudah ada di workspace ini:
     - Menampilkan ikon jenis file, nama asli file, ukuran (misal 2.4 MB), nama pengunggah, dan tanggal.
     - Mengklik salah satu berkas akan langsung memilihnya sebagai lampiran di input bar tanpa upload ulang.

### 3.2 Pratinjau Lampiran di Input Bar
- Ketika berkas dipilih (baik berkas baru maupun dari pustaka), chip lampiran muncul di atas input bar:
  `📎 [Nama File] ([Ukuran])  ✕`
- Pengguna dapat mengetik pesan pengantar (caption) sebelum menekan tombol Kirim.

### 3.3 Kartu Berkas di Bubble Chat (`FileMiniCard`)
- Pesan dengan `msg_type: "file_attach"` atau memiliki `file_id` dirender dengan komponen `FileMiniCard`.
- **Status Normal**:
  - Badge tipe: `📄 PDF`, `📊 SPREADSHEET`, `🖼️ GAMBAR`, atau `📁 DOKUMEN`.
  - Judul berkas: `original_name`.
  - Keterangan ukuran berkas.
  - Tombol aksi:
    - **`👁️ Pratinjau`**: Membuka preview PDF / gambar di browser modal tanpa berpindah halaman.
    - **`⬇️ Unduh`**: Mengunduh berkas langsung.
- **Status Terhapus (`is_deleted = 1`)**:
  - Tampilan muted / abu-abu dengan label `🗑️ BERKAS TELAH DIHAPUS` dan keterangan *"Berkas tidak lagi tersedia di workspace"*.

### 3.4 Real-time SSE
- Event penambahan pesan berkas disiarkan melalui bus SSE chat yang sudah ada (`/api/lists/{list_id}/messages/stream`), sehingga anggota lain langsung melihat berkas muncul seketika di timeline.

---

## 4. Fitur & Tampilan di Tab Files Workspace (`slist_<id>`)

### 4.1 Navigasi Tab di Halaman Workspace
Ketika membuka workspace dari sidebar (`slist_<id>`):
- Header workspace menampilkan tab:
  `[ 📋 Tasks ]   [ 📁 Files (N) ]`
- Tab `[ 📋 Tasks ]` mempertahankan perilaku daftar task yang sudah ada 100%.
- Tab `[ 📁 Files ]` menampilkan katalog berkas terpusat.

### 4.2 Konten Tab Files
1. **Header & Aksi**:
   - Judul & counter berkas aktif.
   - Tombol **`➕ Unggah Berkas`** untuk mengunggah langsung ke workspace.
   - Kolom pencarian instan berdasarkan nama berkas.
   - Filter cepat kategori berkas: *Semua, PDF, Dokumen/Sheet, Gambar, Lainnya*.
2. **Daftar Berkas**:
   - Ikon berkas sesuai ekstensi.
   - Nama asli berkas (`original_name`).
   - Metadata transparan:
     - Ukuran berkas.
     - Asal-usul (*provenance*): `💬 dari Diskusi`, `📌 dari Task "[Judul Task]"`, atau `📁 Unggahan Langsung`.
     - Nama pengunggah dan waktu unggah.
   - Tombol aksi:
     - `👁️ Pratinjau`.
     - `⬇️ Unduh`.
     - `💬 Bagikan ke Chat` (langsung mengirim kartu berkas ini ke room diskusi workspace dengan 1 klik).
     - `🗑️ Hapus` (hanya aktif untuk uploader berkas atau owner workspace, dengan modal konfirmasi).
3. **Empty State**:
   - Ketika workspace belum memiliki berkas, tampilkan instruksi ramah dengan tombol `➕ Unggah Berkas Pertama`.

---

## 5. Spesifikasi API

### 5.1 `GET /api/lists/{list_id}/files`
- **Tujuan**: Mengambil daftar semua berkas aktif dalam workspace.
- **Parameter Kueri**:
  - `q` (opsional): Pencarian nama berkas.
  - `type` (opsional): Filter tipe (`pdf`, `image`, `document`, dll).
- **Otorisasi**: Memerlukan keanggotaan/owner di `list_id`.
- **Respons (200 OK)**:
  ```json
  [
    {
      "id": 12,
      "list_id": 3,
      "user_id": 5,
      "uploader_name": "Zulhian",
      "filename": "a1b2c3d4e5f6.pdf",
      "original_name": "SOP_Commissioning_Unit_2.pdf",
      "file_size": 2516582,
      "mime_type": "application/pdf",
      "source": "chat",
      "task_id": null,
      "task_title": null,
      "created_at": "2026-10-05T10:45:00"
    }
  ]
  ```

### 5.2 `POST /api/lists/{list_id}/files`
- **Tujuan**: Mengunggah berkas baru ke workspace (Multipart form-data: `file`, opsional `source`: `'direct'` | `'chat'`, opsional `task_id`).
- **Otorisasi**: Memerlukan keanggotaan/owner di `list_id`.
- **Validasi**: Batas ukuran `MAX_FILE_SIZE`.
- **Respons (201 Created)**: Objek berkas yang baru dibuat.

### 5.3 `GET /api/lists/{list_id}/files/{file_id}/download`
- **Tujuan**: Mengunduh atau menampilkan konten biner berkas.
- **Header Respons**: `Content-Disposition`, `Content-Type`.
- **Otorisasi**: Memerlukan keanggotaan/owner di `list_id`.

### 5.4 `DELETE /api/lists/{list_id}/files/{file_id}`
- **Tujuan**: Menghapus berkas dari workspace.
- **Otorisasi**: Memerlukan pengguna sebagai uploader asli berkas (`user_id == uid`) ATAU owner workspace (`shared_lists.owner_id == uid`).
- **Aksi**: Menghapus berkas fisik dari `UPLOAD_DIR` dan memperbarui `is_deleted = 1` di tabel `workspace_files`.
- **Respons (200 OK)**: `{"success": true, "message": "Berkas berhasil dihapus"}`.

### 5.5 `POST /api/lists/{list_id}/messages` (Pembaruan)
- Memperluas payload `MessageCreate`:
  - `file_id`: `Optional[int] = None`
  - `msg_type`: mendukung `"file_attach"`
- Menghubungkan informasi berkas ke objek pesan yang dikembalikan dan disiarkan via SSE.

---

## 6. Edge Cases & Penanganan Keamanan
1. **Penanganan Offline**:
   - Pengunggahan berkas biner memerlukan koneksi internet aktif. Jika aplikasi berada dalam keadaan offline, tampilkan notifikasi toast jelas: *"Perlu koneksi internet untuk mengunggah berkas"*.
   - Metadata berkas yang sudah dimuat dapat di-cache secara read-only.
2. **Tabrakan Nama Berkas (*Name Collision*)**:
   - Selalu gunakan `uuid.uuid4().hex + ext` untuk nama berkas di disk. Nama asli hanya disimpan di kolom `original_name`.
3. **Pembersihan Berkas Fisik**:
   - Saat file dihapus dari workspace, berkas biner di disk langsung dibersihkan untuk menghemat kapasitas storage server.
4. **Isolasi Multi-Tenant / Antar-Workspace**:
   - Endpoint download dan delete selalu memverifikasi bahwa `file.list_id == list_id` dan pemohon adalah anggota resmi workspace tersebut.

---

## 7. Rencana Pengujian & Verifikasi
1. **Pengujian Backend (`pytest`)**:
   - Pengujian unggah berkas ke workspace.
   - Pengujian otorisasi: non-anggota ditolak (403), unduh berkas hanya oleh anggota.
   - Pengujian izin hapus: uploader dan owner berhasil menghapus; member lain ditolak (403).
   - Pengujian integrasi task attachment otomatis tercatat di `workspace_files`.
   - Pengujian pengiriman pesan chat bertipe `file_attach`.
2. **Pengujian Frontend (`tests/offline/`)**:
   - Verifikasi komponen `FileMiniCard` saat status berkas normal dan terhapus.
   - Verifikasi peralihan tab `Tasks` dan `Files` di halaman workspace.
   - Pemeriksaan sintaks: `node scratch/check_inline.js static/index.html` dan `node --check static/sw.js`.
