# Browser Clipper Extension — Design Spec
**Date:** 2026-05-18  
**Status:** Draft

## Overview

Browser extension untuk Chrome dan Firefox yang memungkinkan user men-clip halaman web langsung ke TaskFlow Notes dengan tag `#bookmark`. Satu klik — URL, judul, dan deskripsi halaman tersimpan sebagai note pribadi.

---

## Goals

- Clip halaman aktif ke Notes dengan 1 klik
- Simpan: judul, URL, dan meta/OG description
- Tag `#bookmark` otomatis pada setiap note yang di-clip
- Auth sekali via magic link — tidak perlu login ulang (token 30 hari)
- Berjalan di Chrome (MV3) dan Firefox (MV2)

## Non-Goals

- Screenshot / image capture
- Clip selected text
- Simpan ke Shared List (hanya notes pribadi)
- Popup form untuk edit sebelum simpan

---

## Architecture

### Extension (project terpisah: `taskflow-clipper/`)

**Stack:** Vite + webextension-polyfill, plain JS, tanpa framework UI.

**File structure:**
```
taskflow-clipper/
├── src/
│   ├── popup.html          # UI popup saat klik icon
│   ├── popup.js            # Logic: clip, state management
│   ├── background.js       # Service worker (MV3) / background page (MV2)
│   ├── content.js          # Inject ke halaman — ambil meta/OG tags
│   ├── options.html        # Settings: server URL, status token
│   └── options.js
├── manifest.chrome.json    # MV3
├── manifest.firefox.json   # MV2
├── vite.config.js
└── package.json
```

**Permissions:**
- `activeTab` — baca URL + title halaman aktif
- `storage` — simpan token + serverUrl
- `tabs` — buka tab auth
- `scripting` — inject content script untuk ambil meta tags
- Host permission: nilai dari `serverUrl` (dikonfigurasi user)

**Settings (browser.storage.local):**
```json
{
  "serverUrl": "https://todo.yatno.web.id",
  "token": "<jwt>",
  "tokenExpiry": "<iso-date>"
}
```

`serverUrl` wajib diisi user di options page sebelum bisa dipakai. Tidak ada domain yang di-hardcode di kode extension.

---

## Auth Flow (Magic Link / Polling)

1. User klik "Connect to TaskFlow" di popup
2. Extension generate UUID sebagai `state`
3. `POST <serverUrl>/api/ext-auth/begin` — backend simpan state di DB, TTL 5 menit
4. Extension buka tab: `<serverUrl>/#/ext-auth?state=<uuid>`
5. Halaman SPA tampil "Authorize Browser Clipper?" — user harus sudah login
6. User klik Authorize → frontend `POST /api/ext-auth/confirm?state=<uuid>` → backend generate JWT 30 hari, simpan di `ext_tokens`
7. Background script polling `GET /api/ext-auth/poll?state=<uuid>` setiap 2 detik (timeout 5 menit)
8. Dapat token → simpan ke `browser.storage.local` → tutup tab auth otomatis
9. Popup berganti status "● Connected"

---

## Clip Flow

Saat user klik "Clip to Notes":

1. `popup.js` query tab aktif → dapat `url` + `title`
2. Inject `content.js` → ambil `og:description` atau `meta[name=description]` dari halaman
3. `POST <serverUrl>/api/scratchpad` dengan body:
```json
{
  "title": "<judul halaman>",
  "content": "**Source:** <url>\n\n> <meta description>",
  "tags": ["bookmark"]
}
```
4. Response `201` → tampil state sukses 2 detik + link "Buka di TaskFlow →"
5. Response error → tampil pesan error singkat di popup

Kalau meta description tidak ada, content hanya berisi `**Source:** <url>`.

---

## Popup UI States

**State 1 — Belum Connect:** Warning kuning + tombol "Connect to TaskFlow"  
**State 2 — Ready:** Preview judul + URL, tag `#bookmark`, tombol "Clip to Notes"  
**State 3 — Loading:** Tombol disabled + spinner saat POST berlangsung  
**State 4 — Sukses:** Konfirmasi hijau + link ke note baru (2 detik, lalu reset ke State 2)  
**State 5 — Error:** Pesan error singkat + tombol retry  

---

## Backend Changes

### Tabel baru: `ext_tokens`
```sql
CREATE TABLE ext_tokens (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token      TEXT NOT NULL UNIQUE,
    state      TEXT UNIQUE,        -- NULL setelah token di-claim
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
);
CREATE INDEX idx_ext_tokens_state ON ext_tokens(state);
CREATE INDEX idx_ext_tokens_user  ON ext_tokens(user_id);
```

### Endpoints baru di `webapp.py`

| Method | Path | Auth | Keterangan |
|--------|------|------|------------|
| POST | `/api/ext-auth/begin` | Tidak perlu | Buat state UUID, simpan di ext_tokens (token=NULL), return `{state_id}` |
| POST | `/api/ext-auth/confirm` | JWT webapp (cookie) | Isi token untuk state yang ada, return `{ok: true}` |
| GET | `/api/ext-auth/poll` | Tidak perlu | Query param `state` — return `{token}` kalau sudah ada, `{pending: true}` kalau belum |
| DELETE | `/api/ext-auth/revoke` | Bearer token | Hapus token dari DB |

`/api/ext-auth/poll` rate-limit: 1 request/2 detik per state (cukup check di memory/cache sederhana).

### Route SPA baru: `/#/ext-auth`

Halaman minimal di `index.html`:
- Cek user sudah login → kalau belum, redirect ke login
- Tampil nama user + tombol "Authorize Browser Clipper"
- Klik → POST `/api/ext-auth/confirm?state=<state>` → tampil "Berhasil! Kamu bisa tutup tab ini."

### Webapp Settings

Tambah section "Browser Clipper" di halaman Settings:
- Tampil status: "Token aktif, dibuat <tanggal>"
- Tombol "Revoke" → call `DELETE /api/ext-auth/revoke`

---

## Security

- `ext_tokens.state` di-clear setelah token di-claim (satu kali claim)
- State expired setelah 5 menit jika tidak di-confirm
- JWT extension scope terbatas: hanya bisa `POST /api/scratchpad` + `GET /api/ext-auth/poll`
- Scope enforcement via claim di JWT payload: `{"sub": <uid>, "scope": "ext"}`
- Token bisa di-revoke kapan saja dari webapp settings

---

## Build & Distribution

Extension tidak dipublish ke Chrome Web Store / Firefox Add-ons. Distribusi manual:
- Chrome: `chrome://extensions` → "Load unpacked" → pilih folder `dist/chrome/`
- Firefox: `about:debugging` → "Load Temporary Add-on" → pilih `dist/firefox/manifest.json`

Build:
```bash
npm run build        # output ke dist/chrome/ dan dist/firefox/
```
