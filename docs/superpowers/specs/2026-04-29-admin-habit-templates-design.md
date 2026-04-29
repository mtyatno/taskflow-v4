# Admin Page — Habit Templates Management Design

**Date:** 2026-04-29
**Status:** Approved

## Overview

Tambah Admin page di SPA untuk CRUD management `habit_templates` (pengganti HABIT_DATABANK yang sebelumnya hardcoded di JS). Hanya user dengan `is_admin = 1` yang bisa akses admin page. Data di-serve via API dan di-cache service worker untuk offline support.

## Data Model

### Kolom baru di `users`
```sql
ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0
```

### Tabel baru `habit_templates`
```sql
CREATE TABLE habit_templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kategori TEXT NOT NULL,
    subkategori TEXT NOT NULL,
    type TEXT NOT NULL CHECK(type IN ('habit','task')),
    item TEXT NOT NULL,
    frequency TEXT NOT NULL CHECK(frequency IN ('daily','monthly')),
    priority TEXT NOT NULL CHECK(priority IN ('low','medium','high')),
    difficulty TEXT NOT NULL CHECK(difficulty IN ('easy','medium','hard')),
    tags TEXT NOT NULL DEFAULT '[]'
)
```

### Seed data
1000 item dari `habits_tasks_1000.json` di-seed ke `habit_templates` saat startup, hanya jika tabel kosong (idempotent). Menggunakan `INSERT OR IGNORE` per baris.

## Backend API

### Auth middleware baru
`get_admin_user` — extends `get_current_user`, throw `403 Forbidden` jika `user["is_admin"] == 0`.

### Endpoints

```
GET    /api/habit-templates           → list semua item (no auth — diakses semua user + SW cache)
POST   /api/habit-templates           → create item (is_admin required)
PUT    /api/habit-templates/{id}      → update item (is_admin required)
DELETE /api/habit-templates/{id}      → delete item (is_admin required)
GET    /api/admin/users               → list users dengan is_admin flag (is_admin required)
PUT    /api/admin/users/{id}/toggle-admin → toggle is_admin 0↔1 (is_admin required)
```

`GET /api/habit-templates` tidak butuh auth karena diakses GoalTab oleh semua user.
`toggle-admin` tidak bisa men-demote diri sendiri (cek `uid != id`).

### Pydantic models
```python
class HabitTemplateCreate(BaseModel):
    kategori: str
    subkategori: str
    type: Literal["habit", "task"]
    item: str
    frequency: Literal["daily", "monthly"]
    priority: Literal["low", "medium", "high"]
    difficulty: Literal["easy", "medium", "hard"]
    tags: list[str] = []
```

`HabitTemplateUpdate` — field yang sama dengan `HabitTemplateCreate`, semua required. PUT menggantikan seluruh item (bukan PATCH).

## Admin Page UI

### Sidebar
Link "Admin" dengan icon 🔧 ditambahkan ke `links` array di `Sidebar` component, hanya muncul jika `user?.is_admin`.

### AdminPage component

**Header:** filter dropdown kategori + subkategori (subkategori menyesuaikan kategori yang dipilih) + tombol "+ Tambah Item".

**Tabel:**
| Kategori | Subkategori | Type | Item | Actions |
|---|---|---|---|---|
| Karir | Networking | habit | Kirim pesan ke... | ✏️ 🗑️ |

Pagination 50 item per halaman. Filter di frontend (dari data yang sudah di-fetch).

**Modal Create/Edit** — form field:
- Kategori (input text dengan datalist dari kategori yang ada)
- Subkategori (input text dengan datalist dari subkategori yang ada)
- Type: radio habit | task
- Item (textarea)
- Frequency: select daily | monthly
- Priority: select low | medium | high
- Difficulty: select easy | medium | hard
- Tags (input text, comma-separated → disimpan sebagai JSON array)

**User Management section** — di bawah tabel template: list semua user dengan username, display_name, dan toggle checkbox `is_admin`.

## GoalTab Changes

- Hapus `const HABIT_DATABANK = [...]` dari `index.html` (~202KB dikurangi)
- Hapus `buildGoalCategories()`, `FREQ_MAP`, `PRIORITY_MAP`, `CATEGORY_ICONS` yang bergantung pada HABIT_DATABANK — ganti dengan data dari API
- GoalTab tambah state: `templates` (array, default `[]`) + `templatesLoading` (bool)
- Fetch `/api/habit-templates` saat GoalTab pertama kali render (jika `templates.length === 0`)
- `buildGoalCategories()` baru: derive dari `templates` array yang sudah di-fetch
- `FREQ_MAP`, `PRIORITY_MAP`, `CATEGORY_ICONS` tetap ada sebagai constants kecil (tidak bergantung HABIT_DATABANK)

## Service Worker

- Bump CACHE name: `"taskflow-v7-admin"`
- Tambah handler untuk `/api/habit-templates`: **network-first + fallback to cache**
  - Saat online: fetch terbaru, simpan ke cache
  - Saat offline: serve dari cache
  - Jika tidak ada cache: return `503`

## Scope

- `repository.py` — tambah `habit_templates` table, seed data, `is_admin` migration
- `webapp.py` — `get_admin_user`, 6 endpoint baru, `HabitTemplateCreate/Update` models, auth check di GET `/api/auth/me` sertakan `is_admin`
- `static/index.html` — hapus HABIT_DATABANK constant, update GoalTab (fetch), tambah AdminPage component, update Sidebar
- `static/sw.js` — bump cache version, tambah network-first handler untuk `/api/habit-templates`
- `habits_tasks_1000.json` — tetap ada sebagai seed source
