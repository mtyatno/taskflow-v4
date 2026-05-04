# Recurring Tasks Design

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Tambahkan recurring tasks ke sistem task yang sudah ada — task berulang muncul di calendar dan today view sebagai virtual instances, tanpa generate row DB per occurrence.

**Architecture:** Master recurring task disimpan sebagai task biasa di tabel `tasks` dengan tambahan kolom recurrence. Virtual instances dihitung on-the-fly di frontend JS saat render calendar dan today view. Hanya interaksi user (mark done/skip) yang menulis ke DB.

**Tech Stack:** FastAPI, SQLite, React Babel in-browser, Telegram bot

---

## 1. Data Model

### Tambah 4 kolom ke tabel `tasks`

```sql
ALTER TABLE tasks ADD COLUMN recurrence_type TEXT DEFAULT NULL;
-- NULL | 'daily' | 'weekly' | 'monthly' | 'weekdays'

ALTER TABLE tasks ADD COLUMN recurrence_days TEXT DEFAULT NULL;
-- JSON array integer, 0=Senin s/d 6=Minggu
-- Contoh weekly Sen/Rab/Jum: [0, 2, 4]
-- NULL untuk daily, weekdays, monthly

ALTER TABLE tasks ADD COLUMN recurrence_end_date TEXT DEFAULT NULL;
-- YYYY-MM-DD, auto = created_at + 3 bulan, tidak bisa diubah manual user
-- NULL = bukan recurring task

ALTER TABLE tasks ADD COLUMN recurrence_notif_level TEXT DEFAULT NULL;
-- NULL → 'week' → 'day' → 'expired'
-- Track level notifikasi yang sudah dikirim agar tidak repeat
```

### Tabel baru: `recurring_exceptions`

```sql
CREATE TABLE IF NOT EXISTS recurring_exceptions (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id          INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id          INTEGER NOT NULL REFERENCES users(id),
  occurrence_date  TEXT NOT NULL,   -- YYYY-MM-DD
  status           TEXT NOT NULL,   -- 'done' | 'skipped'
  created_at       TEXT NOT NULL,
  UNIQUE(task_id, occurrence_date)
);

CREATE INDEX IF NOT EXISTS idx_rec_exc_task_date ON recurring_exceptions(task_id, occurrence_date);
CREATE INDEX IF NOT EXISTS idx_rec_exc_user ON recurring_exceptions(user_id);
```

**Catatan:** Master task tetap satu row. Tabel exceptions hanya tumbuh saat user berinteraksi — maksimal ~90 row per task per 3 bulan.

---

## 2. API

### Existing endpoints (perubahan minimal)

**`POST /api/tasks`** — tambah field opsional:
```json
{
  "recurrence_type": "weekly",
  "recurrence_days": [0, 2, 4]
}
```
Backend auto-set `recurrence_end_date = today + 3 months` jika `recurrence_type` tidak null.

**`PUT /api/tasks/{id}`** — tambah field opsional:
```json
{
  "recurrence_type": "daily",
  "recurrence_days": null
}
```
Khusus "perpanjang": kirim `{ "recurrence_renew": true }` → backend set `recurrence_end_date = today + 3 months` dan reset `recurrence_notif_level = null`.

**`GET /api/tasks`** — return recurrence fields di response (sudah otomatis karena `SELECT *`).

### Endpoint baru

**`POST /api/tasks/{id}/occurrences/{date}/mark`**
```
date format: YYYY-MM-DD
body: { "status": "done" | "skipped" }
response: { "id": 1, "task_id": 5, "occurrence_date": "2026-05-04", "status": "done" }
```
Upsert ke `recurring_exceptions`. Validasi: `date` harus ≤ `recurrence_end_date` dan ≥ `created_at` date task, serta task milik user.

**`GET /api/recurring/exceptions`**
```
query: ?from=YYYY-MM-DD&to=YYYY-MM-DD
response: { "42": [{ "occurrence_date": "2026-05-04", "status": "done" }], "7": [...] }
```
Return semua exceptions milik user dalam range, dikelompokkan per `task_id`. Satu call untuk semua recurring tasks — menghindari N+1 calls saat render kalender.

**`POST /api/recurring/check-expiry`**
```
response: { "notified": ["week", "expired"], "tasks": [{ "id": 5, "title": "...", "level": "week" }] }
```
Backend cek semua recurring tasks milik user:
- Hitung `days_until_expiry = recurrence_end_date - today`
- Jika `days_until_expiry <= 7` dan `notif_level` masih NULL → kirim notif level 'week', update DB
- Jika `days_until_expiry <= 1` dan `notif_level` masih 'week' → kirim notif level 'day', update DB
- Jika `days_until_expiry < 0` dan `notif_level` masih 'day' atau 'week' → kirim notif level 'expired', update DB
- Notifikasi: insert ke `notifications` table (in-app) + kirim Telegram jika `user.telegram_id` ada

---

## 3. Frontend

### TaskFormModal — Recurring Section

Tambah section di bawah deadline field:

- **Toggle** 🔁 "Berulang" (off by default)
- Kalau toggle on:
  - **Dropdown type:** `Setiap Hari` / `Hari Kerja (Sen-Jum)` / `Mingguan` / `Bulanan`
  - Kalau `Mingguan`: checkbox row hari — `Sen Sel Rab Kam Jum Sab Min` (multi-select)
  - Kalau `Bulanan`: input angka 1–28 (tanggal tiap bulan, max 28 agar aman semua bulan)
  - **Label info** (read-only): `"Aktif hingga {recurrence_end_date}"` — dihitung otomatis saat save
- Kalau task sudah ada dan sudah expired (`recurrence_end_date < today`):
  - Tampilkan label merah: `"Berakhir {recurrence_end_date}"`
  - Tombol **"🔄 Perpanjang 3 Bulan"** → call `PUT /api/tasks/{id}` dengan `{ "recurrence_renew": true }`

### Helper JS: `computeOccurrences(task, fromDate, toDate)`

Fungsi pure JS yang menerima master task dan date range, return array tanggal (`YYYY-MM-DD`) kemunculan:

```javascript
function computeOccurrences(task, fromDate, toDate) {
  // task.recurrence_type: 'daily'|'weekly'|'monthly'|'weekdays'
  // task.recurrence_days: array of int (0=Mon) untuk weekly
  // task.recurrence_end_date: batas akhir
  // Returns: ['2026-05-04', '2026-05-06', ...]
}
```

Logic:
- `daily`: setiap hari dari `max(start_date, fromDate)` s/d `min(end_date, toDate)`
- `weekdays`: setiap hari Senin-Jumat dalam range
- `weekly`: setiap hari yang `.getDay()` (adjusted ke 0=Mon) ada di `recurrence_days`
- `monthly`: hari ke-N setiap bulan dalam range

`start_date` = `created_at` date dari task.

### CalendarView — update

Saat render bulan:
1. Filter `tasks` yang punya `recurrence_type` tidak null dan `recurrence_end_date >= firstDayOfMonth`
2. Untuk setiap recurring task, call `computeOccurrences(task, firstDay, lastDay)` → dapat list tanggal
3. Fetch exceptions untuk bulan ini: `GET /api/recurring/exceptions?from=&to=` — satu call untuk semua recurring tasks, response dikelompokkan per task_id
4. Merge: tanggal yang belum ada di exceptions → tampilkan sebagai virtual instance di kalender dengan badge 🔁
5. Tanggal yang ada di exceptions dengan status `done` → tampilkan dengan ✓, status `skipped` → tampilkan redup

**Popup saat klik occurrence:**
```
[🔁 Laporan Mingguan]
Senin, 5 Mei 2026
[✓ Selesai]  [— Lewati]  [Lihat Task]
```

### Today View / Dashboard

Saat app load:
1. JS ambil semua recurring tasks dari `tasks` state
2. Hitung: apakah hari ini (`today`) adalah occurrence dari task tersebut?
3. Fetch exceptions untuk hari ini saja
4. Task yang occurrence hari ini dan belum done/skipped → tampil di today view dengan badge 🔁

### Expiry Banner

Saat app load, call `POST /api/recurring/check-expiry`. Kalau response `tasks` tidak kosong:
- Tampilkan banner sticky di bawah navbar:
  - Kuning jika ada yang level `week` atau `day`: `"⚠️ {n} recurring task akan berakhir — Perpanjang"`
  - Merah jika ada yang level `expired`: `"🔴 {n} recurring task telah berakhir — Buat ulang"`
- Klik banner → navigasi ke task list dengan filter recurring yang expiring/expired

---

## 4. Notifikasi

**Trigger:** Frontend call `POST /api/recurring/check-expiry` saat app load (sekali per sesi).

**3 Level (per task, tidak repeat):**

| Level | Kondisi | `recurrence_notif_level` sebelum | Set menjadi |
|---|---|---|---|
| `week` | end_date - today ≤ 7 hari | NULL | 'week' |
| `day` | end_date - today ≤ 1 hari | 'week' | 'day' |
| `expired` | today > end_date | 'week' atau 'day' | 'expired' |

**In-app notification** (insert ke tabel `notifications`):
```
⚠️ Recurring task "Laporan mingguan" akan berakhir dalam 7 hari. Perpanjang jika masih diperlukan.
```

**Telegram** (kirim via bot ke `user.telegram_id` kalau ada):
```
⚠️ *Recurring Task Reminder*
"Laporan mingguan" akan berakhir dalam 7 hari\.
Buka TaskFlow untuk memperpanjang\.
```

**Reset notif:** Saat user klik "Perpanjang 3 Bulan" → backend reset `recurrence_notif_level = NULL` → siklus notifikasi mulai lagi dari awal.

---

## 5. Batasan & Edge Cases

- Monthly: hari tersimpan di `recurrence_days[0]`, max 28 agar aman untuk semua bulan termasuk Februari
- Task recurring yang di-delete → `recurring_exceptions` ikut terhapus (CASCADE)
- Recurring task yang sudah expired masih tampil di task list (dengan label expired), tidak hilang — user yang tentukan hapus atau perpanjang
- `check-expiry` idempotent: level tidak di-downgrade, hanya naik. Aman dipanggil berkali-kali
- Offline: `computeOccurrences` berjalan tanpa network. Mark done butuh network (write operation)
