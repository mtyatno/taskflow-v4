# Design Specification: Note Saved Searches & View Mode Toggle (Card vs. Compact)

- **Author:** Antigravity / Gemini
- **Date:** 2026-10-03
- **Status:** Approved (Ready for Implementation Planning)
- **Target:** Backend (`webapp.py`), Frontend UI (`static/index.html`, `static/app.css`, `static/sw.js`), Unit Tests

---

## 1. Overview & Motivation
Catatan Alurik saat ini telah memiliki pengurutan fleksibel (*SortBy*: Terbaru, Terlama, A-Z, Terbanyak link) dan pencarian canggih berbasis SQLite FTS5 dengan operator `tag:` dan `-tag:`. Namun, terdapat dua kebutuhan alur kerja pengguna yang penting:
1. **Saved Searches (Pencarian Tersimpan):** Memungkinkan pengguna menyimpan kueri pencarian kompleks atau berulang (contoh: `tag:kerja -tag:arsip laporan`) dengan label ringkas, dan mengaksesnya kembali dengan satu klik. Kueri ini disimpan di database agar tersinkronisasi lintas perangkat (PC, HP, tablet) dan di-cache lokal untuk akses offline.
2. **Toggle View Mode (Tampilan Kartu vs. Tampilan Ringkas):** Daftar catatan di sidebar saat ini selalu menampilkan preview cuplikan teks 200 karakter (`.note-card-preview`), yang menghabiskan ruang vertikal saat pengguna memiliki banyak catatan. Pengguna memerlukan tombol toggle untuk beralih antara **Card View** (dengan preview teks) dan **Compact List View** (1-2 baris padat tanpa preview teks), dengan preferensi yang tersimpan per-perangkat di `localStorage`.

---

## 2. Database Schema & Migration (`webapp.py`)

### 2.1 Schema Definition
Tabel `note_saved_searches` ditambahkan ke SQLite:
```sql
CREATE TABLE IF NOT EXISTS note_saved_searches (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    query      TEXT NOT NULL,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_note_saved_searches_user ON note_saved_searches(user_id, created_at);
```

### 2.2 Migration in `migrate_db()`
Fungsi `migrate_db()` di `webapp.py` mengeksekusi DDL di atas secara idempoten saat startup server, memastikan tabel dan indeks tersedia tanpa memblokir atau merusak data yang ada.

---

## 3. Backend API Endpoints (`webapp.py`)

### 3.1 Endpoints
1. **`GET /api/scratchpad/saved-searches`:**
   - Memfilter berdasarkan user yang login: `WHERE user_id = ? ORDER BY created_at DESC`.
   - Mengembalikan array: `[{"id": 1, "name": "Laporan Aktif", "query": "tag:kerja -tag:arsip", "created_at": "..."}]`.
2. **`POST /api/scratchpad/saved-searches`:**
   - Menerima payload JSON: `{"name": str, "query": str}`.
   - Validasi: `name.strip()` dan `query.strip()` tidak boleh kosong (400 Bad Request jika kosong).
   - Menghasilkan timestamp ISO dan menyisipkan data baru dengan `user_id = user["sub"]`.
   - Mengembalikan objek yang baru dibuat.
3. **`DELETE /api/scratchpad/saved-searches/{id}`:**
   - Memastikan hanya pemilik yang dapat menghapus: `WHERE id = ? AND user_id = ?`.
   - Melempar 404 jika tidak ditemukan atau milik user lain.
   - Mengembalikan `{"ok": True}`.

---

## 4. Frontend Client Integration

### 4.1 View Mode Toggle (Card vs. Compact)
- **State `viewMode`:** Diinisialisasi di `NotesPage` (`static/index.html`) menggunakan:
  ```javascript
  const [viewMode, setViewMode] = useState(() => localStorage.getItem("tf_notes_view_mode") || "card");
  ```
- **Tombol Header Sidebar:**
  - Ditambahkan di samping dropdown sortir di header sidebar `NotesPage`.
  - Berupa icon button dengan toggle `setViewMode(prev => prev === "card" ? "compact" : "card")`.
  - Menyimpan pilihan ke `localStorage.setItem("tf_notes_view_mode", next)`.
- **CSS Styling (`static/app.css`):**
  - Pada `.note-card.note-card--compact`:
    - `.note-card-preview { display: none !important; }`
    - Padding dirapatkan (`padding: 8px 10px; margin-bottom: 4px;`)
    - Judul catatan dibatasi 1 baris elipsis (`white-space: nowrap; overflow: hidden; text-overflow: ellipsis;`).

### 4.2 Saved Searches UI
- **State & Inisialisasi:**
  - `const [savedSearches, setSavedSearches] = useState([]);`
  - Mengambil data dari `OfflineDB.cacheGet("note_saved_searches")` saat startup, dilanjutkan fetch `/api/scratchpad/saved-searches` di latar belakang.
- **Aksi Simpan (Tombol Bintang ⭐):**
  - Pada bar pencarian `.scratchpad-bar`, saat `q.trim()` terisi dan belum ada di daftar `savedSearches`, tombol bintang ⭐ muncul di sebelah tombol clear `✕`.
  - Mengklik ⭐ memunculkan prompt/input nama pencarian (default nilai awal: `q`).
  - Menyimpan via `api.post("/api/scratchpad/saved-searches", { name, query: q })`, memperbarui state dan cache lokal `OfflineDB.cacheSet`.
- **Daftar Chip Saved Search:**
  - Jika `savedSearches.length > 0`, dirender deretan chip horizontal di bawah bar pencarian.
  - Mengklik chip langsung mengaktifkan `handleSearch(s.query)`.
  - Tombol `×` pada chip memanggil `api.del("/api/scratchpad/saved-searches/" + s.id)` dengan konfirmasi singkat.

### 4.3 Service Worker Cache Version
- Bump versi di `static/sw.js` ke: **`taskflow-v350-note-saved-searches-view-mode`**.

---

## 5. Verification & Testing Strategy
1. **Backend Tests (`tests/test_note_saved_searches.py`):**
   - Verifikasi pembuatan tabel dan indeks di `migrate_db()`.
   - Verifikasi `POST` saved search dengan validasi string kosong.
   - Verifikasi `GET` mengembalikan daftar terurut milik user terkait.
   - Verifikasi `DELETE` berhasil dan menghapus hanya milik pemilik.
   - Verifikasi isolasi multi-user (user lain tidak bisa membaca atau menghapus).
2. **Frontend Offline Tests (`tests/offline/note_saved_searches_view_mode.test.js`):**
   - Verifikasi kelas CSS `.note-card--compact` menyembunyikan preview.
   - Verifikasi penanganan state `viewMode` dan persistensi `localStorage`.
   - Verifikasi keberadaan komponen tombol bintang ⭐, chip pencarian tersimpan, dan tombol toggle view mode.
   - Verifikasi asersi Service Worker versi `v350`.
   - Pengecekan sintaks: `node scratch/check_inline.js static/index.html` dan `node --check static/sw.js`.
3. **Full Regression Suites:**
   - `python -m pytest tests/` (100% lulus).
   - `node --test tests/offline/*.test.js` (100% lulus).
