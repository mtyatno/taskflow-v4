# Note Attachments via Nextcloud Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tambah fitur attach file (gambar + PDF) ke notes, disimpan di Nextcloud via WebDAV, dengan TaskFlow sebagai proxy.

**Architecture:** TaskFlow menerima upload dari browser, meneruskan ke Nextcloud via WebDAV HTTPS menggunakan App Password, menyimpan metadata di tabel `note_attachments`. Download/view diproxy oleh TaskFlow sehingga Nextcloud tidak perlu akses publik.

**Tech Stack:** FastAPI, SQLite, `requests` (WebDAV), marked.js (inline image), Nextcloud WebDAV API.

---

## Section 1: Arsitektur & Alur Data

### Upload
```
Browser → POST /api/scratchpad/{note_id}/attachments
        → webapp.py validasi auth + mime type
        → PUT ke Nextcloud WebDAV HTTPS (App Password)
        → simpan metadata ke note_attachments
        → return {id, original_name, mime_type, file_size}
        → frontend insert syntax ke markdown
```

### View / Download
```
Browser → GET /api/scratchpad/attachments/{id}/view
        → webapp.py cek auth + ownership
        → GET dari Nextcloud WebDAV
        → stream file ke browser
```

### Offline Behavior
- Saat offline: note teks tetap terbaca dari cache SW
- Gambar inline tampil broken image + CSS placeholder "File tidak tersedia offline"
- Service worker tidak diubah — attachment tidak di-cache

### Konfigurasi `.env`
```
NEXTCLOUD_URL=https://cloud.example.com
NEXTCLOUD_USER=taskflow-bot
NEXTCLOUD_APP_PASSWORD=xxxxx-xxxxx-xxxxx-xxxxx
NEXTCLOUD_FOLDER=/TaskFlow/attachments
```

Credentials menggunakan **Nextcloud App Password** (bukan password login utama).
App Password dibuat di: Nextcloud → Settings → Security → App Passwords.

### Nextcloud Path Format
```
/TaskFlow/attachments/{uuid4}-{original_filename}
```
Flat folder, UUID prefix mencegah nama collision.

---

## Section 2: Database

### Tabel baru `note_attachments`
```sql
CREATE TABLE IF NOT EXISTS note_attachments (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    note_id        INTEGER NOT NULL REFERENCES scratchpad_notes(id) ON DELETE CASCADE,
    user_id        INTEGER NOT NULL REFERENCES users(id),
    nextcloud_path TEXT NOT NULL,
    original_name  TEXT NOT NULL,
    file_size      INTEGER NOT NULL,
    mime_type      TEXT NOT NULL,
    created_at     TEXT DEFAULT (datetime('now'))
);
```

Dibuat via auto-migration di `init_db()` (pola yang sudah ada di webapp.py).

### Endpoint Baru
| Method | Path | Fungsi |
|---|---|---|
| POST | `/api/scratchpad/{note_id}/attachments` | Upload file |
| GET | `/api/scratchpad/{note_id}/attachments` | List attachments |
| DELETE | `/api/scratchpad/attachments/{id}` | Hapus dari DB + Nextcloud |
| GET | `/api/scratchpad/attachments/{id}/view` | Proxy stream ke browser |

### Validasi Server-side
- Mime type diizinkan: `image/png`, `image/jpeg`, `image/webp`, `application/pdf`
- Max file size: ikut `MAX_FILE_SIZE` dari config (sama dengan task attachments)
- Ownership check: user hanya bisa akses attachment milik note yang ia punya

---

## Section 3: Frontend

### 3.1 Toolbar Upload (NoteModal)
Tambah tombol 📎 di toolbar editor, sejajar dengan tombol bold/italic/dll.

**Flow klik 📎:**
```
Note belum tersimpan (baru)?
  → auto-save silent (tanpa tutup modal, note dapat ID)
  → lanjut ke file picker

Note sudah tersimpan?
  → langsung buka file picker

File picker terbuka (accept: .png,.jpg,.jpeg,.webp,.pdf)
  → user pilih file
  → loading indicator di tombol 📎 selama upload
  → POST /api/scratchpad/{note_id}/attachments
  → berhasil:
      Gambar → insert "![nama](/api/scratchpad/attachments/{id}/view)" di posisi cursor
      PDF    → insert "[📄 nama.pdf](/api/scratchpad/attachments/{id}/view)" di posisi cursor
  → gagal → toast error
```

### 3.2 Inline Rendering

marked.js otomatis render `![alt](url)` menjadi `<img>`. Tambah CSS:

```css
.note-rendered img {
  max-width: 100%;
  border-radius: 6px;
  margin: 6px 0;
  display: block;
}
```

Saat offline, gambar gagal load dan browser tampilkan broken image icon default — ini acceptable. `img::after` tidak bisa dipakai karena `<img>` adalah replaced element (pseudo-element tidak dirender browser).

Untuk handling error yang lebih baik, marked renderer di-override untuk wrap `<img>` dalam `<span>` agar bisa pakai `onerror` handler:
```javascript
// di marked.use({ renderer: { ... } })
image({ href, text }) {
  return `<img src="${href}" alt="${text}" onerror="this.style.display='none';this.nextSibling.style.display='inline'" /><span class="img-offline-placeholder" style="display:none">📎 ${text} — tidak tersedia offline</span>`;
}
```

PDF render sebagai link — klik buka di tab baru.

### 3.3 Panel Attachments

Section di bawah konten note, tampil di **NoteModal** dan **NotePanel**. Fetch saat note dibuka.

**Tampilan:**
```
── Attachments (2) ──────────────────────
  🖼  screenshot.png     120 KB   [🗑]
  📄  laporan.pdf        2.1 MB   [🗑]
─────────────────────────────────────────
```

- Klik nama file → buka di tab baru
- Klik 🗑 → dialog konfirmasi → DELETE → hapus dari panel + Nextcloud
- Panel hanya muncul jika ada attachment (tidak tampil kalau kosong)
- Saat offline → panel tetap tampil tapi link diganti label "Tidak tersedia offline"

---

## Keputusan Desain

| Topik | Keputusan |
|---|---|
| Storage | Nextcloud self-hosted VPS terpisah (2TB) |
| Protokol | WebDAV HTTPS |
| Auth ke Nextcloud | App Password (bukan password login) |
| File yang diizinkan | PNG, JPG, WebP, PDF |
| Offline behavior | Attachment tidak di-cache, tampil placeholder |
| Upload UX | Auto-save silent jika note belum tersimpan |
| Akses file | Diproxy TaskFlow, Nextcloud tidak perlu akses publik |
