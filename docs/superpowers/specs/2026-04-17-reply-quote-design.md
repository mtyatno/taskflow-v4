# Reply / Quote Pesan — Design Spec

**Date:** 2026-04-17
**Status:** Approved

## Context

Fitur chat per shared list sudah berjalan. User ingin kemampuan reply/quote per pesan agar konteks diskusi lebih jelas — terutama saat percakapan panjang dengan banyak peserta.

---

## Keputusan Desain

| Aspek | Keputusan |
|---|---|
| Trigger | Hover bubble (desktop) → tombol ↩ muncul di luar bubble; mobile → tombol ↩ kecil selalu visible via CSS |
| Preview | Reply preview bar muncul di atas textarea saat reply aktif, bisa di-dismiss |
| Render | Quote block di dalam bubble (border-left accent, bg lebih gelap, max 2 baris) |
| Scroll-to-original | Out of scope V1 |
| Edit / hapus pesan | Out of scope |

---

## DB Schema — Perubahan Tabel `messages`

```sql
ALTER TABLE messages ADD COLUMN reply_to_id INTEGER DEFAULT NULL
  REFERENCES messages(id) ON DELETE SET NULL;
```

Tidak perlu index tambahan — `reply_to_id` di-resolve via JOIN saat fetch, bukan diquery mandiri.

---

## Backend

### Perubahan `repository.py`

Tambah migrasi `reply_to_id` di `__init__`:
```python
cols = [r["name"] for r in conn.execute("PRAGMA table_info(messages)").fetchall()]
if "reply_to_id" not in cols:
    conn.execute("ALTER TABLE messages ADD COLUMN reply_to_id INTEGER DEFAULT NULL REFERENCES messages(id) ON DELETE SET NULL")
```

### Perubahan `webapp.py`

#### `MessageCreate` schema
```python
class MessageCreate(BaseModel):
    content: str
    task_id: Optional[int] = None
    msg_type: str = "text"
    reply_to_id: Optional[int] = None
```

#### `GET /api/lists/{list_id}/messages`

Query JOIN diperluas untuk mengambil data pesan yang di-quote:

```sql
SELECT m.id, m.list_id, m.user_id, m.content, m.task_id, m.msg_type,
       m.created_at, m.reply_to_id,
       u.username, u.display_name,
       t.title as task_title, t.priority as task_priority,
       t.deadline as task_deadline, t.quadrant as task_quadrant,
       ru.username as reply_to_username,
       ru.display_name as reply_to_display_name,
       rm.content as reply_to_content
FROM messages m
JOIN users u ON u.id = m.user_id
LEFT JOIN tasks t ON t.id = m.task_id
LEFT JOIN messages rm ON rm.id = m.reply_to_id
LEFT JOIN users ru ON ru.id = rm.user_id
WHERE m.list_id = ?
  [AND m.id < :before_id]
ORDER BY m.created_at ASC
LIMIT 50
```

Response shape per pesan:
```json
{
  "id": 5,
  "user_id": 2,
  "username": "yatno",
  "display_name": "Yatno",
  "content": "Sudah 80%!",
  "msg_type": "text",
  "task_id": null,
  "reply_to_id": 3,
  "reply_to_username": "andi",
  "reply_to_display_name": "Andi",
  "reply_to_content": "Gimana progress task laporan?",
  "created_at": "2026-04-17T10:32:00"
}
```

Saat tidak ada reply: `reply_to_id`, `reply_to_username`, `reply_to_display_name`, `reply_to_content` bernilai `null`.

#### `POST /api/lists/{list_id}/messages`

Simpan `reply_to_id` ke DB:
```python
cur = conn.execute(
    "INSERT INTO messages (list_id, user_id, content, task_id, msg_type, reply_to_id, created_at) VALUES (?,?,?,?,?,?,?)",
    (list_id, uid, req.content, req.task_id, req.msg_type, req.reply_to_id, now),
)
```

Setelah insert, fetch ulang dengan JOIN yang sama (termasuk `reply_to_*`) sebelum broadcast SSE — sehingga SSE subscriber langsung terima data lengkap.

#### SSE Stream

Tidak ada perubahan struktur SSE — broadcast payload sudah mengandung semua field termasuk `reply_to_*`.

---

## Frontend — `static/index.html`

### CSS baru

```css
/* Reply trigger button */
.chat-reply-btn {
  position: absolute;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 50%;
  width: 26px; height: 26px;
  display: flex; align-items: center; justify-content: center;
  font-size: 13px; cursor: pointer;
  box-shadow: 0 1px 4px rgba(0,0,0,0.1);
  opacity: 0; transition: opacity 0.15s;
  top: 0;
}
.chat-bubble-wrap:hover .chat-reply-btn { opacity: 1; }
/* Self bubble: button di kiri wrap; others: di kanan */
.chat-bubble-wrap:not(.self) .chat-reply-btn { right: -34px; }
.chat-bubble-wrap.self .chat-reply-btn { left: -34px; }

/* Mobile: selalu visible */
@media (hover: none) {
  .chat-reply-btn { opacity: 0.45; position: static; margin: 0 4px; }
  .chat-bubble-wrap:not(.self) { align-items: flex-end; }
}

/* Quote block dalam bubble */
.chat-quote-block {
  border-left: 3px solid var(--accent);
  border-radius: 4px;
  background: rgba(0,0,0,0.07);
  padding: 4px 8px;
  margin-bottom: 6px;
  font-size: 12px;
  cursor: default;
}
[data-theme="dark"] .chat-quote-block { background: rgba(255,255,255,0.07); }
.chat-quote-block .quote-sender { font-weight: 700; color: var(--accent); margin-bottom: 2px; }
.chat-quote-block .quote-text {
  color: var(--text-secondary);
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

/* Reply preview bar di atas input */
.chat-reply-preview {
  background: var(--bg-primary);
  border-left: 3px solid var(--accent);
  border-top: 1px solid var(--border);
  padding: 6px 12px;
  display: flex;
  align-items: flex-start;
  gap: 8px;
  font-size: 12px;
}
.chat-reply-preview .preview-sender { font-weight: 700; color: var(--accent); }
.chat-reply-preview .preview-text { color: var(--text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.chat-reply-preview .preview-close { margin-left: auto; background: none; border: none; cursor: pointer; color: var(--text-light); font-size: 16px; padding: 0; flex-shrink: 0; }
```

### State baru di `ChatRoom`

```js
const [replyTo, setReplyTo] = useState(null);
// shape: { id, content, username, display_name } | null
```

`replyTo` diteruskan ke `ChatInputBar` via prop. Saat pesan terkirim, `setReplyTo(null)`.

### Render tombol ↩ di setiap bubble

Di dalam `.chat-bubble-wrap`, sebelum avatar:

```jsx
<button
  className="chat-reply-btn"
  onClick={e => { e.stopPropagation(); setReplyTo({ id: msg.id, content: msg.content, username: msg.username, display_name: msg.display_name }); }}
  title="Reply"
>↩</button>
```

Posisi `absolute` diatur CSS (`right: -34px` atau `left: -34px`). `.chat-bubble-wrap` perlu `position: relative`.

### Render quote block di dalam bubble

Di dalam `.chat-bubble`, sebelum `renderMessageContent`:

```jsx
{msg.reply_to_id && msg.reply_to_content && (
  <div className="chat-quote-block">
    <div className="quote-sender">{msg.reply_to_display_name || msg.reply_to_username}</div>
    <div className="quote-text">{msg.reply_to_content}</div>
  </div>
)}
```

### Reply preview di `ChatInputBar`

Props tambahan: `replyTo`, `onClearReply`.

Di dalam `.chat-input-bar`, sebelum `<textarea>`:

```jsx
{replyTo && (
  <div className="chat-reply-preview">
    <div style={{ flex: 1, minWidth: 0 }}>
      <div className="preview-sender">↩ {replyTo.display_name || replyTo.username}</div>
      <div className="preview-text">{replyTo.content}</div>
    </div>
    <button className="preview-close" onClick={onClearReply}>✕</button>
  </div>
)}
```

### Perubahan `handleSend` di `ChatInputBar`

```js
const payload = {
  content: text.trim() || (attachedTask ? `📌 ${attachedTask.title}` : ""),
  task_id: attachedTask?.id || null,
  msg_type: attachedTask ? "task_attach" : "text",
  reply_to_id: replyTo?.id || null,   // ← tambahan
};
// setelah send sukses:
onClearReply();
```

---

## Out of Scope (V1)

- Scroll ke pesan original saat klik quote block
- Nested reply (reply dari reply)
- Edit / hapus pesan
