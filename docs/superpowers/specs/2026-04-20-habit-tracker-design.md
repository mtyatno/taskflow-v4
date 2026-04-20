# Habit Tracker — Design Spec

**Date:** 2026-04-20
**Status:** Approved

## Context

TaskFlow sudah menangani task GTD + Eisenhower. Habit Tracker ditambahkan sebagai modul terpisah untuk kebiasaan harian yang bersifat recurring dan identity-driven — berbeda secara psikologis dan operasional dari task. Habit tidak punya deadline, tidak "selesai" dan hilang dari DB, melainkan reset setiap hari.

---

## Keputusan Desain

| Aspek | Keputusan |
|---|---|
| Entry point tambah habit | Toggle `[Task] \| [Habit]` di atas modal existing (bisa dari halaman mana saja) |
| Habit Dashboard desktop | Satu tabel besar, fase sebagai group row berwarna |
| Habit Dashboard mobile | Card scroll vertikal per fase |
| Check-in interaction | Klik row (desktop) / tap card (mobile) → modal Done/Skip |
| Offline support | Full offline — creation (tempId) + check-in via IndexedDB queue |
| Dashboard task filter | GTD/Eisenhower tetap filter out habit (tidak ada `type` field — habit di tabel terpisah) |

---

## Section 1: Backend

### Tabel Baru (`repository.py`)

```sql
CREATE TABLE IF NOT EXISTS habits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    phase TEXT NOT NULL CHECK(phase IN ('pagi','siang','malam')),
    micro_target TEXT DEFAULT '',
    frequency TEXT DEFAULT '["mon","tue","wed","thu","fri","sat","sun"]',  -- JSON array
    identity_pillar TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS habit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    habit_id INTEGER NOT NULL REFERENCES habits(id) ON DELETE CASCADE,
    date TEXT NOT NULL,           -- YYYY-MM-DD
    status TEXT NOT NULL CHECK(status IN ('done','skipped','missed')),
    skip_reason TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(habit_id, date)        -- satu log per habit per hari
);
```

### API Endpoints (`webapp.py`)

| Method | URL | Deskripsi |
|---|---|---|
| `GET` | `/api/habits` | List semua habit milik user |
| `POST` | `/api/habits` | Tambah habit baru |
| `DELETE` | `/api/habits/{id}` | Hapus habit |
| `GET` | `/api/habits/today` | Habits + status hari ini + 7-hari log per habit |
| `POST` | `/api/habits/{id}/checkin` | Log done/skipped untuk hari ini (upsert) |

#### Schema Request/Response

**POST /api/habits body:**
```json
{
  "title": "Meditasi",
  "phase": "pagi",
  "micro_target": "5 menit",
  "frequency": ["mon","tue","wed","thu","fri","sat","sun"],
  "identity_pillar": "Saya adalah orang yang tenang dan fokus"
}
```

**GET /api/habits/today response (per item):**
```json
{
  "id": 1,
  "title": "Meditasi",
  "phase": "pagi",
  "micro_target": "5 menit",
  "identity_pillar": "...",
  "today_status": "done" | "skipped" | "missed" | null,
  "skip_reason": "",
  "streak": 5,
  "week_log": ["done","done","skipped","done","done","missed","done"]  // Sen–Min
}
```

**POST /api/habits/{id}/checkin body:**
```json
{
  "status": "done" | "skipped",
  "skip_reason": ""
}
```

---

## Section 2: Modal Toggle (Task/Habit)

**File:** `static/index.html` — `TaskFormModal` component

Tambah segmented control di paling atas form, sebelum semua field:

```
[ ✓ Task ]  [ 🔁 Habit ]
```

- State: `const [mode, setMode] = useState("task")`
- Default: `"task"` — behavior existing tidak berubah sama sekali
- `mode === "task"`: semua field existing tampil normal
- `mode === "habit"`: field task disembunyikan (`display:none`), form habit muncul

**Form Habit Fields:**
1. **Nama Habit** — text input, required
2. **Fase** — select: Pagi (05:30–06:15) / Siang (06:15–18:30) / Malam (18:30–22:00)
3. **Micro Target** — text input, placeholder "5 menit, 2 halaman...", optional
4. **Frekuensi** — default "Setiap Hari", toggle per hari (Sen Sel Rab Kam Jum Sab Min) jika dikustomisasi
5. **Identity Pillar** — text input, placeholder "Saya adalah...", optional

**Submit Habit (online):**
- `POST /api/habits` → refresh habit state jika `page === "habit"`
- Toast: "Habit berhasil ditambahkan"

**Submit Habit (offline):**
- Sama persis dengan task offline:
  - `tempId = "tmp_habit_" + Date.now()`
  - `OfflineDB.queueAdd({ method: "POST", url: "/api/habits", body, tempId, createdAt })`
  - Tambah ke local `habits` state dengan `_pending: true`
  - Toast: "Tersimpan offline, akan sync saat online 📶"

---

## Section 3: HabitPage Component

**File:** `static/index.html` — komponen baru `HabitPage`

### Header
```
Minggu, 20 April 2026
"Saya adalah orang yang tenang dan fokus"   ← identity_pillar dari habit pertama, atau fallback quote
```

### Desktop Layout (≥768px) — Tabel Besar

Satu tabel, fase sebagai group row berwarna:
- **Pagi** → background `rgba(168,197,0,0.08)`, label lime
- **Siang** → background `rgba(250,204,21,0.08)`, label kuning
- **Malam** → background `rgba(129,140,248,0.08)`, label ungu

Kolom tabel:
| Habit | Sen | Sel | Rab | Kam | Jum | Sab | Min | 🔥 |
|---|---|---|---|---|---|---|---|---|
| Nama habit | ✓/~/– | ... | ... | ... | ... | ... | ... | streak |

- Kolom hari ini: border lime + background `rgba(168,197,0,0.1)`, bold
- Simbol: `✓` = done (lime), `~` = skipped (kuning), `–` = missed/belum (abu)
- **Klik mana saja di row** → `HabitCheckinModal` (jika hari ini belum done/skipped, tombol aktif; jika sudah, modal tampilkan status + opsi ubah)

### Mobile Layout (<768px) — Card Scroll

Per fase, section dengan label berwarna sesuai fase. Tiap habit = card:
```
┌────────────────────────────────────┐
│ 🧘 Meditasi          🔥 5 hari     │
│ 5 menit                            │
│ ▉ ▉ ▉ ▉ ▉ ▢ ▢   (7 kotak mini)   │
└────────────────────────────────────┘
```
- Kotak mini: hijau=done, kuning=skipped, abu=missed, putih=belum (hari ini)
- Tap card → `HabitCheckinModal`

### HabitCheckinModal

Modal kecil, muncul tengah layar:
```
┌─────────────────────────┐
│  🧘 Meditasi            │
│  Minggu, 20 April       │
│                         │
│  [ ✓ Done ]  [ ↷ Skip ] │
│                         │
│  Alasan skip... (jika   │
│  Skip dipilih)          │
└─────────────────────────┘
```

- Done → `POST /api/habits/{id}/checkin { status: "done" }` → update local state
- Skip → tampilkan input alasan → submit → `POST /api/habits/{id}/checkin { status: "skipped", skip_reason }`
- **Offline:** queue mutation ke IndexedDB, update local `habits` state langsung (`today_status`)

---

## Section 4: Sidebar & Routing

**Sidebar (`static/index.html`):**
```js
{ id: "today", icon: "🍅", label: "Fokus Hari Ini", count: todayCount },
{ id: "habit", icon: "🔁", label: "Habit Tracker" },   // ← tambah di sini
{ id: "chat", icon: "💬", label: "Diskusi" },
```

**Routing di App:**
```jsx
if (page === "habit") {
  return <HabitPage user={user} showToast={showToast} />;
}
```

**State di App:**
- `habits` state dikelola di dalam `HabitPage` sendiri (tidak perlu naik ke App) — habit tidak berinteraksi dengan task state
- `HabitPage` fetch `/api/habits/today` saat mount, refresh setelah check-in

---

## Section 5: Offline Architecture

### Cache (saat online)
- `OfflineDB.cacheSet("habits_today", data)` setelah fetch `/api/habits/today`
- Load dari cache saat offline

### Queue — Creation
```js
// tempId pattern sama seperti task
const tempId = `tmp_habit_${Date.now()}`;
OfflineDB.queueAdd({ method: "POST", url: "/api/habits", body, tempId, createdAt: Date.now() });
// Tambah ke local habits state dengan _pending: true
```

### Queue — Check-in
```js
OfflineDB.queueAdd({ method: "POST", url: `/api/habits/${id}/checkin`, body: { status, skip_reason } });
// Update local habits state: today_status = status
```

### processQueue
`processQueue` existing di App sudah handle POST generically → check-in habit otomatis tersync saat online. Tidak ada perubahan pada `processQueue`.

### Reconstruct saat Reload Offline
Di `HabitPage` `useEffect` fetchHabits:
1. Coba fetch `/api/habits/today` dari network
2. Jika gagal (offline): load dari `OfflineDB.cacheGet("habits_today")`
3. Apply pending queue items: untuk setiap `POST /api/habits/{id}/checkin` di queue → update `today_status` di local state
4. Untuk pending creation (`POST /api/habits` dengan tempId): tambah ke list dengan `_pending: true`

---

## Out of Scope

- Edit habit (nama, fase, dll.) — bisa diimplementasi di iterasi berikutnya
- Statistik/analytics habit jangka panjang (heatmap bulanan)
- Notifikasi/reminder per fase
- Bot Telegram untuk habit check-in
- Habit yang di-share ke shared list
