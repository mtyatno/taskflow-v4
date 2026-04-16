# Chat / Diskusi — Design Spec

**Date:** 2026-04-17
**Status:** Approved

## Context

TaskFlow V4 mendukung shared lists dengan multi-user (owner + members). User ingin fitur diskusi berbentuk chat per shared list, sehingga anggota list bisa berdiskusi, attach task yang sudah ada, atau membuat task baru langsung dari chat.

---

## Keputusan Desain

| Aspek | Keputusan |
|---|---|
| Scope | Per shared list — hanya anggota/owner list |
| Real-time | SSE (Server-Sent Events) via `sse-starlette` |
| Persistensi | Permanen di SQLite — history tidak terhapus antar session |
| Pagination | 50 pesan terakhir saat buka, tombol "Load lebih lama" untuk +50 sebelumnya |
| Layout | WhatsApp-style: panel list (kiri) + panel chat (kanan) |
| Task attach | Tombol 📌 di toolbar → popup search task atau buat task baru |
| Lokasi menu | Sidebar, tepat di bawah "Fokus Hari Ini" |

---

## DB Schema — Tabel Baru `messages`

```sql
CREATE TABLE IF NOT EXISTS messages (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    list_id     INTEGER NOT NULL,
    user_id     INTEGER NOT NULL,
    content     TEXT NOT NULL,
    task_id     INTEGER DEFAULT NULL,
    msg_type    TEXT NOT NULL DEFAULT 'text',  -- 'text' | 'task_attach' | 'task_create'
    created_at  TEXT NOT NULL,
    FOREIGN KEY (list_id) REFERENCES shared_lists(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_list ON messages(list_id, created_at);
```

---

## Backend — Endpoint Baru

### `GET /api/lists/{list_id}/messages`
- Query params: `limit=50`, `before_id` (untuk pagination "load lebih lama")
- Auth: hanya member/owner list
- Response: array pesan, urut ascending, beserta `username` dan `display_name` sender, dan task info jika ada `task_id`

### `POST /api/lists/{list_id}/messages`
- Body: `{ content: str, task_id?: int, msg_type?: str }`
- Auth: hanya member/owner list
- Simpan ke DB → broadcast ke semua SSE subscriber list ini
- Response: pesan yang baru dibuat (format sama dengan GET)

### `GET /api/lists/{list_id}/messages/stream`
- SSE endpoint — koneksi persistent
- Auth: hanya member/owner list
- Saat ada pesan baru di list ini, push event `data: {message JSON}`
- Client reconnect otomatis (SSE native browser behavior)

### SSE Broadcast Mechanism
```python
# In-memory, module-level
chat_subscribers: dict[int, set[asyncio.Queue]] = defaultdict(set)

# On POST message: save to DB, then:
for q in chat_subscribers.get(list_id, set()):
    await q.put(message_dict)

# SSE stream generator:
q = asyncio.Queue()
chat_subscribers[list_id].add(q)
try:
    while True:
        msg = await q.get()
        yield {"data": json.dumps(msg)}
finally:
    chat_subscribers[list_id].discard(q)
```

---

## Frontend — Komponen Baru

### Sidebar
```js
{ id: "chat", icon: "💬", label: "Diskusi" }
// Disisipkan setelah { id: "today", ... }
```

### `ChatPage({ user, showToast })`
Layout dua panel:
- **Kiri** (`ChatListPanel`): daftar shared lists yang user ikuti (owner atau member). Klik list → buka `ChatRoom` untuk list tersebut.
- **Kanan** (`ChatRoom`): area chat untuk list yang dipilih. Jika belum ada list yang dipilih, tampilkan placeholder.

### `ChatRoom({ list, user, showToast })`
- Mount: load 50 pesan terakhir via `GET /api/lists/{id}/messages`
- Mount: buka SSE ke `GET /api/lists/{id}/messages/stream`, append pesan baru ke state
- Unmount: tutup SSE connection
- Scroll otomatis ke bawah saat ada pesan baru
- Tombol "Load lebih lama" di atas jika ada pesan sebelumnya (`before_id` pagination)

### Render pesan
- Pesan dari user sendiri: bubble kanan, background hijau muda (`#dcfce7`)
- Pesan dari orang lain: bubble kiri, background abu (`#f1f5f9`) + avatar + nama
- Pesan dengan task (`msg_type: 'task_attach'` atau `'task_create'`): tampilkan `TaskMiniCard` di dalam bubble (background kuning, judul task, priority, deadline)

### `TaskMiniCard({ task })`
Kartu kecil inline dalam chat:
```
📌 [Judul Task]
P1 · Deadline: 20 Apr · Q1
```
Klik → buka task detail modal (gunakan `onTaskClick` yang sudah ada di app).

### Input Toolbar
```
[ input text (flex 1) ] [ 📌 ] [ Kirim ]
```

### `TaskAttachPopup`
Muncul saat tombol 📌 diklik, di atas input:
- Search box → filter tasks dari list yang aktif (fetch dari `/api/lists/{list_id}/tasks`)
- List hasil pencarian — klik task → attach ke pesan yang akan dikirim
- Tombol `+ Buat Task Baru` → buka `TaskFormModal` (komponen yang sudah ada), saat task berhasil dibuat, task otomatis ter-attach ke pesan

### Mengirim pesan dengan task
1. User klik 📌 → pilih/buat task → task terpilih muncul sebagai preview di input
2. User ketik teks (opsional) + klik Kirim
3. `POST /api/lists/{id}/messages` dengan `{ content, task_id, msg_type: 'task_attach' | 'task_create' }`

---

## Dark Mode
Semua komponen chat menggunakan CSS variables (`--bg-card`, `--bg-primary`, `--text-primary`, `--border`) — tidak ada hardcoded color. Bubble sendiri pakai `var(--accent)` versi transparan jika perlu.

---

## Out of Scope (V1)
- Reactions / emoji reaction
- Reply/thread per pesan
- Edit / hapus pesan
- File attachment (non-task)
- Unread badge di sidebar (bisa ditambah V2)
- Notifikasi push saat ada pesan baru (bisa ditambah V2)
- Multi-worker SSE dengan Redis pub/sub (single worker VPS cukup)
