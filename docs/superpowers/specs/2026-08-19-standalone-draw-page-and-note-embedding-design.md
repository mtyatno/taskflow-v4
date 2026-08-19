# Dedicated Standalone Draw Page & Note Embedding Design

**Date:** 2026-08-19  
**Status:** Approved  
**Author:** Antigravity (Gemini 3.7 Flash) & User  

---

## 1. Overview & Goals

Saat ini, kanvas gambar (`tldraw`) di TaskFlow berfungsi sebagai pelengkap kecil di bawah editor catatan (*Notes*). Fitur ini bertujuan untuk meningkatkan kanvas gambar menjadi **Entitas Tingkat Pertama (First-Class Entity)** mandiri dengan halaman tersendiri (**Draw Page**), sekaligus menghadirkan integrasi penanaman gambar ke dalam teks catatan (*Note Embedding*).

### Key Goals:
1. **Dedicated Standalone Draw Page (`DrawPage`):** Layout 2-kolom (daftar gambar di sisi kiri dan kanvas gambar penuh di sisi kanan), setara dengan fitur di Notes dan Mindmaps.
2. **Multi-Tab Workspace:** Dukungan multi-tab di bagian atas kanvas untuk membuka dan berpindah hingga 5 gambar sekaligus secara instan tanpa reload.
3. **Note Integration (Embed & Quick-Draw):** Kemudahan menyisipkan dan mengedit gambar langsung di dalam catatan melalui menu slash `/` (`/draw`, `/canvas`, `/gambar`), tombol toolbar `+Gambar`, dan render blok pratinjau (*live preview card*).
4. **Offline-First & Local-First PWA:** Dukungan IndexedDB, sinkronisasi Outbox 2-arah, dan Service Worker cache-first.
5. **Zero Data Loss Migration:** Migrasi otomatis seluruh gambar catatan yang sudah ada di database ke entitas baru `drawings` dan otomatis ditautkan ke catatan asal.
6. **Global Search (`Ctrl+K`) & Dashboard Pinning:** Integrasi pencarian global dan card gambar disematkan di Dashboard.

---

## 2. Backend & Data Architecture

### 2.1 Database Schema (`models.py`)
Tabel baru `drawings` di SQLite:

```sql
CREATE TABLE drawings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL DEFAULT 'Untitled Drawing',
    data_json TEXT NOT NULL DEFAULT '{}',
    svg_preview TEXT DEFAULT '',
    is_pinned INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_drawings_user_updated ON drawings(user_id, updated_at DESC);
CREATE INDEX idx_drawings_user_pinned ON drawings(user_id, is_pinned DESC);
```

* **Relasi Tag:** Menggunakan tabel relasi `entity_tags` yang sudah ada dengan `entity_type = 'drawing'`.
* **Relasi Catatan:** Relasi dicatat melalui referensi sintaks markdown di dalam teks catatan `::draw[<drawing_id>]{title="..."}` dan di-query untuk menampilkan badge tautan dua arah.

### 2.2 API Endpoints (`webapp.py`)
* `GET /api/drawings`: Mengambil daftar ringkasan gambar user (`id`, `title`, `is_pinned`, `updated_at`, `tags`, `linked_notes`).
* `POST /api/drawings`: Membuat gambar baru (body: `{ title, data_json?, tags? }`).
* `GET /api/drawings/{id}`: Mengambil detail lengkap gambar termasuk snapshot `data_json` dan `svg_preview`.
* `PUT /api/drawings/{id}`: Menyimpan pembaruan gambar (`title`, `data_json`, `svg_preview`, `tags`).
* `DELETE /api/drawings/{id}`: Menghapus gambar dan relasi tag-nya.
* `PATCH /api/drawings/{id}/pin`: Toggle status pin gambar.
* `GET /api/search`: Memperluas query pencarian global agar mencakup entitas `drawings` (berdasarkan `title`, `tags`, dan teks node di canvas jika ada).

### 2.3 Automatic Migration
Saat inisialisasi server (`startup` event / database migration helper):
* Cek apakah ada record di tabel/kolom drawing lama (`/api/drawings/{note_id}`).
* Untuk setiap drawing yang belum termigrasi:
  1. Insert record baru ke tabel `drawings` dengan judul `"Gambar - [Judul Catatan]"`.
  2. Sisipkan tag `::draw[<new_id>]{title="..."}` ke akhir isi catatan tersebut agar tetap tertaut rapi.

---

## 3. Offline-First PWA & Sync Architecture

### 3.1 IndexedDB Store (`static/offline/db.js`)
* Tambahkan object store `drawings` dengan indeks `user_id`, `updated_at`, `is_pinned`, dan `dirty`.

### 3.2 UMD Offline Modules (`static/offline/`)
* **`drawingrepo.js`:** Logika CRUD lokal IndexedDB, filter tag, search query, dan outbox queuing.
* **`drawingroutes.js`:** Intersepsi routing REST API offline (`/api/drawings/*`).
* **`drawingtabs.js`:** State helper multi-tab (open, close, switch, rename, reorder, cap 5 tabs).

### 3.3 Service Worker (`static/sw.js`)
* Daftarkan file modul offline `drawingtabs.js` di daftar aset `STATIC`.
* Naikkan nama cache Service Worker (`taskflow-v...`).

---

## 4. Draw Page UI Design (`DrawPage`)

### 4.1 Navigasi Sidebar
* Tambahkan menu **🎨 Draw** di sidebar utama aplikasi (navigasi desktop & bottom bar mobile).

### 4.2 Panel Kiri (Sidebar Daftar Gambar)
* **Header Daftar:**
  * Tombol ➕ **"Gambar Baru"** (aksen primary).
  * Kotak input pencarian (*real-time filter*).
* **Tag Filter Chips:** Baris horizontal tag pills (klik untuk memfilter gambar berdasarkan tag).
* **Daftar Item Gambar:**
  * Judul gambar dan badge tanggal modifikasi terakhir.
  * Icon pin ungu 📌 jika disematkan.
  * Badge tautan catatan (misal: `📝 [Nama Note]` yang dapat diklik untuk membuka catatan bersangkutan).
  * Menu opsi baris (Rename, Pin/Unpin, Hapus).

### 4.3 Panel Kanan (Kanvas & Multi-Tab Area)
* **Multi-Tab Bar:**
  * Tab aktif dengan border accent, icon `🎨`, judul gambar, dan tombol tutup `✕`.
  * Perpindahan tab instan (0ms delay) menggunakan teknik multi-instance DOM yang disembunyikan/ditampilkan.
* **Header Toolbar:**
  * Judul gambar (*inline editable*).
  * Tombol Pin 📌.
  * Tombol Ekspor Cepat (**PNG**, **SVG**, **JSON**).
  * Tombol Fullscreen ⤢.
* **Canvas Viewport:**
  * Iframe terisolasi `static/vendor/tldraw/index.html?noteId={drawing_id}` dengan engine `tldraw` v2.4.6 yang mendukung auto-save debounce ke IndexedDB & backend.

---

## 5. Integrasi Note Editor (Note Embedding)

### 5.1 Kemudahan Akses (Discoverability)
1. **Slash Menu Dropdown (`/`):**
   * Mengetik `/` memunculkan menu opsi:
     * `🎨 Gambar / Canvas` (`/draw`, `/canvas`, `/gambar`, `/sketsa`).
     * `📝 Task / To-Do` (`/task`, `/todo`).
     * `🧠 Mindmap` (`/mindmap`).
     * `🤖 AI Assistant` (`/ai`).
2. **Tombol Toolbar Editor:**
   * Tombol visual **🎨 `+Gambar`** di toolbar editor catatan.
3. **Trigger Autocomplete:**
   * Mengetik `[draw` atau `[gambar` membuka popover pencarian gambar.
4. **Placeholder Hint:**
   * Panduan teks halus di baris kosong catatan: *"Tulis catatan, atau ketik '/' untuk menyisipkan gambar, task, atau tabel..."*.

### 5.2 Alur Pembuatan & Penyematan
1. Saat user memilih opsi Gambar di catatan:
   * Muncul popover modal dengan 2 pilihan:
     * ➕ **Buat Gambar Baru:** Langsung membuka modal popup kanvas `tldraw` di atas catatan → user menggambar → klik *"Selesai"* → otomatis tersimpan dan tertanam di catatan.
     * 🔗 **Pilih Gambar yang Ada:** Memilih dari daftar gambar yang sudah ada di halaman Draw.
2. **Rendering di Dalam Catatan:**
   * Dirender sebagai **Interactive Drawing Block**:
     * Menampilkan pratinjau gambar SVG/vektor yang tajam dan responsif.
     * Tombol hover *"✏️ Edit Kanvas"* → membuka modal kanvas untuk mengubah gambar secara langsung.

---

## 6. Global Search & Dashboard Integration

### 6.1 Global Search (`Ctrl+K`)
* Pencarian global menyertakan kategori **🎨 Gambar**.
* Klik item hasil pencarian langsung membuka halaman Draw dan mengaktifkan tab gambar terkait di multi-tab bar.

### 6.2 Dashboard Integration
* Menambahkan card **🎨 Gambar Disematkan** di Dashboard untuk akses cepat ke gambar-gambar penting yang di-pin.

---

## 7. Verification & Test Plan

1. **Unit Tests (JS / TDD):**
   * `drawingtabs.test.js`: Tes buka tab, tutup tab, batas 5 tab, pindah tab, update judul tab.
   * `drawingrepo.test.js` & `drawingroutes.test.js`: Tes CRUD offline, filter tag, search, dan outbox sync.
2. **Backend Tests (Python / pytest):**
   * Tes endpoint `/api/drawings` (list, create, get, update, delete, pin, search).
   * Tes migrasi data drawing catatan lama.
3. **End-to-End / Browser Verification Checklist:**
   * Navigasi ke halaman Draw → Buat gambar baru → Gambar di kanvas → Cek auto-save.
   * Buka multi-tab (3-5 tab) → Beralih antar tab tanpa reload kanvas.
   * Buka catatan → Ketik `/draw` atau klik tombol `+Gambar` → Buat gambar baru → Muncul preview card di teks catatan.
   * Klik tombol edit pada preview card di catatan → Perubahan otomatis sinkron ke halaman Draw.
   * Ekspor gambar (PNG, SVG, JSON) dari toolbar atas.
   * Global search `Ctrl+K` menemukan gambar dan membuka tab dengan tepat.
