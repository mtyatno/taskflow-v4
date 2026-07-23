# Note Publish — Design Spec

**Date:** 2026-07-23
**Status:** Draft
**Scope:** Backend + Frontend — fitur publish note jadi halaman publik

## Overview

Menambahkan fitur "publish note" yang membuat note bisa diakses publik via link khusus, tanpa perlu login/komentar/input dari pengunjung. Mirip Obsidian Publish / Notion Share-to-web.

**Prinsip:**
- Halaman publik = read-only, no-auth, SEO-friendly (SSR meta tags + OG preview)
- Wikilink `[[title]]` hanya jadi link jika note target juga di-publish
- Password opsional per note (unlisted + proteksi tambahan)
- Tidak ada halaman index publik (true unlisted — harus tahu URL)
- Live sync: edit note → publish otomatis menampilkan versi terbaru
- Math + attachment tetap berfungsi di halaman publik

---

## 1. Database

### Tabel baru `published_notes`

```sql
CREATE TABLE IF NOT EXISTS published_notes (
    note_id       INTEGER NOT NULL UNIQUE REFERENCES scratchpad_notes(id) ON DELETE CASCADE,
    user_id       INTEGER NOT NULL REFERENCES users(id),
    slug          TEXT NOT NULL UNIQUE,
    password_hash TEXT,                              -- bcrypt, NULL = no password
    published_at  TEXT NOT NULL                      -- isoformat JKT
);
CREATE INDEX IF NOT EXISTS idx_published_slug ON published_notes(slug);
CREATE INDEX IF NOT EXISTS idx_published_user ON published_notes(user_id);
```

- `user_id` di-denormalize untuk query "list all published by me" tanpa JOIN
- `slug`: 8 char random URL-safe (`secrets.token_urlsafe(6)`)
- `password_hash`: `NULL` = tidak ada password; pakai `hash_password()` existing (PBKDF2-SHA256)
- Slug collision: generate ulang hingga 999x, raise error jika gagal

**Tidak ada perubahan di `scratchpad_notes`.**

---

## 2. API Endpoints

### 2A. Endpoint publik (tanpa auth)

#### `GET /pub/{slug}`

Halaman HTML lengkap, server-side rendered.

**Flow:**
1. Query `published_notes p JOIN scratchpad_notes n ON n.id = p.note_id` WHERE `p.slug = ?`
2. Tidak ditemukan → 404 HTML
3. Jika `p.password_hash IS NOT NULL` dan cookie `pub_unlock_{slug}` tidak valid:
   - Tampilkan halaman password gate (form input password + tombol Buka)
   - **Tidak** menampilkan konten note
4. Jika unlocked / no password → render full page:
   - Meta tags (OG, title, description)
   - Konten note (markdown → HTML server-side)
   - KaTeX auto-render + attachment rewrite

**Meta tags:**
```html
<title>{note.title} — TaskFlow Publish</title>
<meta property="og:title" content="{note.title}">
<meta property="og:description" content="{first 200 chars stripped}">
<meta property="og:type" content="article">
<meta property="og:url" content="{BASE_URL}/pub/{slug}">
```

**CSS:** Inline stylesheet ~100 baris, no external dependency kecuali KaTeX:
- Font system stack
- Max-width 720px centered
- Dark mode via `prefers-color-scheme`
- Print-friendly

#### `POST /pub/{slug}/unlock`

Submit password, verify, set cookie.

**Proteksi bruteforce (3 lapis, in-memory):**

| Lapis | Mekanisme | Threshold |
|---|---|---|
| IP-based | Maks percobaan per IP per window | 5 gagal / 15 menit |
| Slug-based | Maks percobaan per slug (akumulatif) | 10 gagal → slug locked 30 menit |
| Progressive delay | Delay bertahap tiap gagal beruntun per IP+slug | 0s → 1s → 2s → 4s → 8s |

**Flow:**
1. Cek progressive delay — sleep jika perlu
2. Cek IP rate limit → **429** + `Retry-After` header
3. Cek slug lock → **429** + "Halaman ini terkunci sementara, coba lagi dalam X menit"
4. Cek password via `verify_password(password, hash)` (existing di webapp.py):
   - **Salah:** catat di tracker, return **401** "Password salah. X percobaan tersisa"
   - **Benar:** reset semua tracker, set signed cookie `pub_unlock_{slug}`, redirect ke `GET /pub/{slug}`

**Cookie:**
```python
# itsdangerous URLSafeTimedSerializer
cookie_value = serializer.dumps({"slug": slug})
response.set_cookie(
    key=f"pub_unlock_{slug}",
    value=cookie_value,
    max_age=30 * 24 * 3600,  # 30 hari
    httponly=True,
    samesite="lax",
    secure=True
)
```

**Cleanup tracker:** APScheduler job setiap 5 menit hapus entries expired.

#### `GET /pub/attachments/{att_id}`

Public attachment view — tanpa auth.

**Flow:**
1. Query `note_attachments a JOIN published_notes p ON p.note_id = a.note_id` WHERE `a.id = ?`
2. Tidak ditemukan atau note tidak published → 404
3. Valid → stream file dari Nextcloud WebDAV (sama seperti `GET /api/scratchpad/attachments/{id}/view` tapi tanpa auth)

---

### 2B. Endpoint API (auth required)

#### `POST /api/scratchpad/{note_id}/publish`

Publish atau update published note.

**Auth:** `get_current_user` — cek note milik user via `user_id` (bukan `_note_access_clause`, hanya owner yang bisa publish)

**Body:**
```json
{
  "password": "string | null"
}
```

**Flow:**
1. Cek note exists & `user_id == uid` → jika tidak → **404** atau **403**
2. Generate slug: `slug = secrets.token_urlsafe(6)[:8]` (8 char), retry jika collision
3. Hash password: `hash_password(password)` (existing PBKDF2), atau `None` jika null/empty
4. `INSERT OR REPLACE` ke `published_notes`
5. Return `{ slug, published_at }`

#### `DELETE /api/scratchpad/{note_id}/publish`

Unpublish note.

**Flow:**
1. Cek note exists & owned by user
2. `DELETE FROM published_notes WHERE note_id = ? AND user_id = ?`
3. Return `{ ok: true }`

#### `GET /api/scratchpad/published`

List semua published notes milik user (untuk section di Notes page).

**Response:**
```json
[
  {
    "note_id": 123,
    "title": "Judul Note",
    "slug": "abc123xy",
    "password_set": true,
    "published_at": "2026-07-23T10:00:00+07:00"
  }
]
```

---

## 3. Halaman Publik — HTML Template

### Tampilan normal (no password / unlocked)

```
┌─────────────────────────────────────────┐
│  🔗 Published via TaskFlow              │  branding kecil
│                                         │
│  # Judul Note                           │  h1
│  23 Juli 2026                           │  tanggal
│                                         │
│  ──────────────────────────────────     │
│                                         │
│  Konten note (markdown → HTML)          │
│  - [[wikilink]] → link ke note lain    │
│  - $$math$$ → KaTeX                    │
│  - ![gambar](/pub/attachments/123)     │
│                                         │
│  ──────────────────────────────────     │
│  Powered by TaskFlow                    │  footer
└─────────────────────────────────────────┘
```

### Halaman password gate

```
┌─────────────────────────────────────────┐
│  🔒 Halaman ini dilindungi password     │
│                                         │
│  ┌─────────────────────────────────┐    │
│  │ password______________________  │    │
│  └─────────────────────────────────┘    │
│  [Buka]                                 │
│                                         │
│  (pesan error jika salah)               │
└─────────────────────────────────────────┘
```

### Server-side markdown processing

1. Strip token internal: `[tasklink:...]` → dihapus
2. Strip `==highlight==` → render sebagai `<mark>` di HTML (atau strip marker, sisakan teks)
3. Checklist `[ ]` / `[x]` → render sebagai read-only checkbox (non-interactive)
4. Rewrite wikilink:
   - `[[Title]]` dengan target `IN (SELECT note_id FROM published_notes)` → `<a href="/pub/{target_slug}">[[Title]]</a>`
   - `[[Title]]` dengan target NOT published → teks biasa (tidak klik)
5. Rewrite attachment:
   - `![...](/api/scratchpad/attachments/{id}/view)` → `![...](/pub/attachments/{id})`
6. Render markdown → HTML (mistune)
7. Jangan render math (biarkan `$...$` / `$$...$$` mentah — KaTeX client-side)

### Client-side JS (minimal)

```html
<!-- KaTeX CSS -->
<link rel="stylesheet" href="/static/vendor/katex/katex.min.css">

<!-- KaTeX JS -->
<script src="/static/vendor/katex/katex.min.js"></script>
<script src="/static/vendor/katex/auto-render.min.js"></script>
<script>
  renderMathInElement(document.body, {
    delimiters: [
      {left: '$$', right: '$$', display: true},
      {left: '$', right: '$', display: false}
    ]
  });
</script>
```

---

## 4. Frontend — Notes Page

### 4A. Tombol Publish di Note Toolbar

Di toolbar note panel kanan, di antara tombol existing:

```
[📌 Pin] [🔗 Publish] [✏️ Edit] [...] [🗑️ Delete]
```

**State indikator:**
- Belum publish: ikon default (`🔗`)
- Sudah publish: ikon hijau (`color: #16a34a`)
- Ada password: tambahkan ikon gembok kecil (`🔗🔒`)

### 4B. Modal Publish

```
┌──────────────────────────────────────┐
│  🔗 Publish Note                     │
│                                      │
│  Status: ✅ Published                │
│                                      │
│  Link publik:                        │
│  ┌────────────────────────────────┐  │
│  │ https://app.com/pub/abc123xy   │  │
│  └────────────────────────────────┘  │
│  [📋 Copy Link]                      │
│                                      │
│  ─── Opsional ───                    │
│  Password:                           │
│  ┌────────────────────────────────┐  │
│  │ _______________          [👁]  │  │
│  └────────────────────────────────┘  │
│  Kosongkan = hapus password          │
│                                      │
│  [💾 Simpan]  [🗑️ Unpublish]        │
└──────────────────────────────────────┘
```

**Behavior:**
- Pertama publish: isi + Simpan → `POST /api/scratchpad/{id}/publish`
- Sudah publish: tampilkan link + status → edit password → Simpan (upsert)
- Copy Link → `navigator.clipboard.writeText()` + toast singkat
- Unpublish → konfirmasi → `DELETE /api/scratchpad/{id}/publish`
- Hapus password → kosongkan field → Simpan
- Toggle 👁 → show/hide password field

### 4C. Section "Published Notes" di Sidebar

Di sidebar Notes page, setelah tags / sebelum daftar note:

```
┌──────────────────────┐
│ 📝 Notes             │
│ 🏷️ Tags              │
│ 🔗 Published (3)  ▾  │  ← collapsible
│   ┌────────────────┐ │
│   │ 🔗 Judul A     │ │  klik → buka note
│   │    📋 Copy link│ │
│   ├────────────────┤ │
│   │ 🔗🔒 Judul B   │ │  ikon gembok = ada password
│   │    📋 Copy link│ │
│   ├────────────────┤ │
│   │ 🔗 Judul C     │ │
│   │    📋 Copy link│ │
│   └────────────────┘ │
└──────────────────────┘
```

**Data:** `GET /api/scratchpad/published` dipanggil saat Notes page mount.
**Collapsible:** default terbuka jika ada published notes, collapsed jika kosong.

---

## 5. Wikilink Behavior Summary

| Skenario | Halaman publik |
|---|---|
| Target note **published** | `<a href="/pub/{target_slug}">` — bisa diklik |
| Target note **tidak published** | Teks biasa — tidak klik |
| Target note **dihapus** | Teks biasa (broken, tapi bukan link) |
| Wikilink dengan `id:N` syntax | Di-resolve ke slug jika published, teks jika tidak |

Di app utama (authenticated), wikilink tetap bekerja seperti biasa — tidak ada perubahan.

---

## 6. Markdown Parser Server-side

Untuk render markdown di Python, pilihan:

**Rekomendasi: `mistune`** — library pure Python, ringan (~50KB), support plugin (highlight, math, table). Sudah banyak dipakai di ekosistem Python.

Alternatif: custom transformer berbasis regex + `markdown` library stdlib (lebih minimal, cukup untuk kebutuhan publish).

**Pipeline render:**
```
raw_content
  → strip [tasklink:...]
  → rewrite [[wikilink]] (cek published_notes)
  → rewrite attachment URLs
  → render markdown → HTML
```

---

## 7. Files Changed

| File | Change |
|---|---|
| `webapp.py` | +4 endpoint (`/pub/*`, `/api/scratchpad/{id}/publish`, `/api/scratchpad/published`) + HTML render + bruteforce tracker + `init_db` migration |
| `repository.py` | +`published_notes` table migration (auto di `init_db`) |
| `static/index.html` | Modal Publish + section Published Notes + tombol toolbar |
| `requirements.txt` | +`mistune` (markdown server-side), +`itsdangerous` jika belum explicit |

**Tidak berubah:** `scratchpad_notes` schema, `_note_access_clause`, existing note CRUD, wikilink di app utama, offline/sync modules.
**Reuse existing:** `hash_password`/`verify_password` (PBKDF2), KaTeX bundle, attachment proxy pattern.

---

## 8. Decisions

| # | Decision |
|---|---|
| D1 | Endpoint publik `/pub/{slug}` — tanpa auth, SSR HTML |
| D2 | Wikilink hanya link jika target juga published |
| D3 | Live sync (edit = langsung ter-reflect di halaman publik) |
| D4 | Unlisted + password opsional |
| D5 | SEO-friendly dengan meta tags server-rendered |
| D6 | Math client-side (KaTeX auto-render) |
| D7 | Attachment via public proxy `/pub/attachments/{id}` |
| D8 | Bruteforce: 3-lapis in-memory (IP + slug + progressive delay) |
| D9 | Published notes management via modal + sidebar section |
| D10 | `mistune` untuk server-side markdown rendering |
