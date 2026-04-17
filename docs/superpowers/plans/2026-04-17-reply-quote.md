# Reply / Quote Pesan — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tambah kemampuan reply/quote per pesan di chat — hover bubble → tombol ↩ → preview di input bar → bubble terkirim menampilkan quote block.

**Architecture:** Tambah kolom `reply_to_id` ke tabel `messages` via migration. Backend GET dan POST diperluas untuk menyertakan data quoted message (JOIN). Frontend: state `replyTo` di `ChatRoom`, tombol ↩ per bubble (hover desktop / visible mobile), preview bar di `ChatInputBar`, render quote block di dalam bubble.

**Tech Stack:** FastAPI + SQLite, React 18 UMD (single-file SPA `static/index.html`), CSS variables.

---

## Files yang Dimodifikasi

- Modify: `repository.py` — migration `reply_to_id` di `__init__`
- Modify: `webapp.py` — `MessageCreate` schema + 2 query GET diperluas + INSERT + fetch-after-insert diperluas
- Modify: `static/index.html` — CSS baru, state `replyTo` di `ChatRoom`, tombol ↩ di bubble, quote block render, reply preview + `handleSend` di `ChatInputBar`

---

## Task 1: DB Migration — Kolom `reply_to_id`

**Files:**
- Modify: `repository.py` — dalam `__init__`, setelah baris `idx_messages_list` (~baris 200)

- [ ] **Step 1: Tambah migration reply_to_id**

  Cari baris (sekitar 200):
  ```python
  conn.execute("CREATE INDEX IF NOT EXISTS idx_messages_list ON messages(list_id, created_at)")
  ```
  Tambahkan tepat sesudahnya:
  ```python
  # Reply/quote migration
  cols_msg = [r["name"] for r in conn.execute("PRAGMA table_info(messages)").fetchall()]
  if "reply_to_id" not in cols_msg:
      conn.execute("ALTER TABLE messages ADD COLUMN reply_to_id INTEGER DEFAULT NULL REFERENCES messages(id) ON DELETE SET NULL")
  ```

- [ ] **Step 2: Verifikasi kolom terbuat**

  ```bash
  python3 -c "
  import sqlite3, os
  db = os.getenv('DB_PATH', 'taskflow.db')
  conn = sqlite3.connect(db)
  cols = [r[1] for r in conn.execute(\"PRAGMA table_info(messages)\").fetchall()]
  print(cols)
  assert 'reply_to_id' in cols, 'MISSING reply_to_id!'
  print('OK')
  "
  ```
  Expected: list kolom termasuk `reply_to_id`, lalu `OK`.

- [ ] **Step 3: Commit**

  ```bash
  git add repository.py
  git commit -m "feat: add reply_to_id column to messages table"
  ```

---

## Task 2: Backend — Schema + GET + POST diperluas

**Files:**
- Modify: `webapp.py` — `MessageCreate` (~baris 172), GET messages (~baris 1150), POST messages (~baris 1205)

### Step 1: Tambah `reply_to_id` ke `MessageCreate`

Cari (baris ~172–175):
```python
class MessageCreate(BaseModel):
    content: str = Field(min_length=1, max_length=2000)
    task_id: Optional[int] = None
    msg_type: str = "text"
```
Ganti dengan:
```python
class MessageCreate(BaseModel):
    content: str = Field(min_length=1, max_length=2000)
    task_id: Optional[int] = None
    msg_type: str = "text"
    reply_to_id: Optional[int] = None
```

- [ ] **Step 2: Perbarui query GET messages (kedua cabang: before_id dan tanpa)**

  Kedua query SELECT di `GET /api/lists/{list_id}/messages` (baris ~1151 dan ~1165) perlu diperluas. Ganti seluruh blok `with get_db() as conn:` di endpoint GET messages:

  ```python
  with get_db() as conn:
      base_select = """
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
      """
      if before_id:
          rows = conn.execute(
              base_select + "WHERE m.list_id = ? AND m.id < ? ORDER BY m.created_at DESC LIMIT ?",
              (list_id, before_id, limit),
          ).fetchall()
          rows = list(reversed(rows))
      else:
          rows = conn.execute(
              base_select + "WHERE m.list_id = ? ORDER BY m.created_at DESC LIMIT ?",
              (list_id, limit),
          ).fetchall()
          rows = list(reversed(rows))
  return [dict(r) for r in rows]
  ```

- [ ] **Step 3: Perbarui INSERT dan fetch-after-insert di POST messages**

  Cari baris INSERT (~1222):
  ```python
  cur = conn.execute(
      "INSERT INTO messages (list_id, user_id, content, task_id, msg_type, created_at) "
      "VALUES (?,?,?,?,?,?)",
      (list_id, uid, req.content, req.task_id, req.msg_type, now),
  )
  ```
  Ganti dengan:
  ```python
  cur = conn.execute(
      "INSERT INTO messages (list_id, user_id, content, task_id, msg_type, reply_to_id, created_at) "
      "VALUES (?,?,?,?,?,?,?)",
      (list_id, uid, req.content, req.task_id, req.msg_type, req.reply_to_id, now),
  )
  ```

  Lalu cari fetch-after-insert (~baris 1228–1238):
  ```python
  row = conn.execute(
      """SELECT m.id, m.list_id, m.user_id, m.content, m.task_id, m.msg_type, m.created_at,
                u.username, u.display_name,
                t.title as task_title, t.priority as task_priority,
                t.deadline as task_deadline, t.quadrant as task_quadrant
         FROM messages m
         JOIN users u ON u.id = m.user_id
         LEFT JOIN tasks t ON t.id = m.task_id
         WHERE m.id = ?""",
      (msg_id,),
  ).fetchone()
  ```
  Ganti dengan:
  ```python
  row = conn.execute(
      """SELECT m.id, m.list_id, m.user_id, m.content, m.task_id, m.msg_type,
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
         WHERE m.id = ?""",
      (msg_id,),
  ).fetchone()
  ```

- [ ] **Step 4: Verifikasi manual**

  Restart service lokal, lalu di DevTools console:
  ```js
  // Kirim pesan tanpa reply
  fetch('/api/lists/1/messages', {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({content:'test tanpa reply', msg_type:'text'})
  }).then(r=>r.json()).then(d => { console.assert(d.reply_to_id === null); console.log('OK tanpa reply', d); });

  // Kirim pesan dengan reply (ganti 1 dengan id pesan yang ada)
  fetch('/api/lists/1/messages', {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({content:'test reply', msg_type:'text', reply_to_id: 1})
  }).then(r=>r.json()).then(d => { console.assert(d.reply_to_content !== null); console.log('OK dengan reply', d); });

  // GET messages — pastikan reply_to_* fields ada
  fetch('/api/lists/1/messages').then(r=>r.json()).then(msgs => {
    console.log('fields:', Object.keys(msgs[0]));
  });
  ```

- [ ] **Step 5: Commit**

  ```bash
  git add webapp.py
  git commit -m "feat: reply_to_id in MessageCreate, GET/POST messages include reply_to_* fields"
  ```

---

## Task 3: Frontend — CSS Reply

**Files:**
- Modify: `static/index.html` — `<style>` block, setelah `.chat-mention-item:hover` (~baris 193)

- [ ] **Step 1: Tambah CSS reply**

  Cari baris:
  ```css
  .chat-mention-item:hover { background: var(--bg-primary); }
  ```
  Tambahkan sesudahnya (sebelum `@media (max-width: 768px)`):
  ```css
  /* ── Chat Reply ── */
  .chat-bubble-wrap { position: relative; }
  .chat-reply-btn {
    position: absolute; top: 0;
    background: var(--bg-card); border: 1px solid var(--border); border-radius: 50%;
    width: 26px; height: 26px; display: flex; align-items: center; justify-content: center;
    font-size: 13px; cursor: pointer; box-shadow: 0 1px 4px rgba(0,0,0,0.1);
    opacity: 0; transition: opacity 0.15s; z-index: 2; color: var(--text-secondary);
  }
  .chat-bubble-wrap:hover .chat-reply-btn { opacity: 1; }
  .chat-bubble-wrap:not(.self) .chat-reply-btn { right: -34px; }
  .chat-bubble-wrap.self .chat-reply-btn { left: -34px; }
  .chat-quote-block {
    border-left: 3px solid var(--accent); border-radius: 4px;
    background: rgba(0,0,0,0.07); padding: 4px 8px; margin-bottom: 6px; font-size: 12px;
  }
  [data-theme="dark"] .chat-quote-block { background: rgba(255,255,255,0.07); }
  .chat-quote-block .quote-sender { font-weight: 700; color: var(--accent); margin-bottom: 2px; font-size: 11px; }
  .chat-quote-block .quote-text {
    color: var(--text-secondary); overflow: hidden;
    display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
  }
  .chat-reply-preview {
    border-left: 3px solid var(--accent); border-top: 1px solid var(--border);
    padding: 6px 12px; display: flex; align-items: flex-start; gap: 8px;
    font-size: 12px; background: var(--bg-primary);
  }
  .chat-reply-preview .preview-sender { font-weight: 700; color: var(--accent); font-size: 11px; }
  .chat-reply-preview .preview-text { color: var(--text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 260px; }
  .chat-reply-preview .preview-close { margin-left: auto; background: none; border: none; cursor: pointer; color: var(--text-light); font-size: 18px; padding: 0; flex-shrink: 0; line-height: 1; }
  ```

  Lalu tambahkan dalam `@media (max-width: 768px)`:
  ```css
  .chat-reply-btn { opacity: 0.5; position: static; width: 22px; height: 22px; font-size: 11px; }
  .chat-bubble-wrap:not(.self) { flex-wrap: wrap; }
  ```

- [ ] **Step 2: Commit**

  ```bash
  git add static/index.html
  git commit -m "feat: CSS for reply button, quote block, reply preview bar"
  ```

---

## Task 4: Frontend — ChatRoom state + tombol ↩ + quote block

**Files:**
- Modify: `static/index.html` — `ChatRoom` component

- [ ] **Step 1: Tambah state `replyTo` di ChatRoom**

  Cari baris di `function ChatRoom`:
  ```js
  const [loadingMore, setLoadingMore] = useState(false);
  ```
  Tambahkan sesudahnya:
  ```js
  const [replyTo, setReplyTo] = useState(null);
  // replyTo shape: { id, content, username, display_name } | null
  ```

- [ ] **Step 2: Tambah tombol ↩ di setiap bubble**

  Cari baris di messages.map (render bubble):
  ```jsx
  <div className={`chat-bubble-wrap${isSelf ? " self" : ""}`}>
  ```
  Ganti dengan:
  ```jsx
  <div className={`chat-bubble-wrap${isSelf ? " self" : ""}`}>
    <button
      className="chat-reply-btn"
      onClick={e => { e.stopPropagation(); setReplyTo({ id: msg.id, content: msg.content, username: msg.username, display_name: msg.display_name }); textareaRef.current?.focus(); }}
      title="Reply"
    >↩</button>
  ```

  Catatan: `textareaRef` ada di `ChatInputBar`, bukan di `ChatRoom`. Karena itu, focus tidak bisa langsung dipanggil dari sini — hapus `textareaRef.current?.focus()` dari onClick di atas. Cukup set `replyTo`.

  Jadi onClick yang benar:
  ```jsx
  onClick={e => { e.stopPropagation(); setReplyTo({ id: msg.id, content: msg.content, username: msg.username, display_name: msg.display_name }); }}
  ```

- [ ] **Step 3: Tambah quote block di dalam bubble**

  Cari baris di dalam `.chat-bubble`:
  ```jsx
  {renderMessageContent(msg.content, user.username)}
  ```
  Tambahkan SEBELUMNYA:
  ```jsx
  {msg.reply_to_id && msg.reply_to_content && (
    <div className="chat-quote-block">
      <div className="quote-sender">{msg.reply_to_display_name || msg.reply_to_username}</div>
      <div className="quote-text">{msg.reply_to_content}</div>
    </div>
  )}
  ```

- [ ] **Step 4: Pass `replyTo` dan `onClearReply` ke ChatInputBar**

  Cari baris render ChatInputBar (baris ~4184):
  ```jsx
  <ChatInputBar list={list} user={user} onSent={(msg) => { setMessages(prev => [...prev, msg]); setTimeout(scrollToBottom, 30); }} showToast={showToast} onTaskClick={onTaskClick} />
  ```
  Ganti dengan:
  ```jsx
  <ChatInputBar
    list={list}
    user={user}
    onSent={(msg) => { setMessages(prev => [...prev, msg]); setTimeout(scrollToBottom, 30); }}
    showToast={showToast}
    onTaskClick={onTaskClick}
    replyTo={replyTo}
    onClearReply={() => setReplyTo(null)}
  />
  ```

- [ ] **Step 5: Commit**

  ```bash
  git add static/index.html
  git commit -m "feat: ChatRoom — replyTo state, tombol reply per bubble, quote block render"
  ```

---

## Task 5: Frontend — ChatInputBar reply preview + handleSend

**Files:**
- Modify: `static/index.html` — `ChatInputBar` component

- [ ] **Step 1: Tambah `replyTo` dan `onClearReply` ke props ChatInputBar**

  Cari:
  ```js
  function ChatInputBar({ list, user, onSent, showToast, onTaskClick }) {
  ```
  Ganti dengan:
  ```js
  function ChatInputBar({ list, user, onSent, showToast, onTaskClick, replyTo, onClearReply }) {
  ```

- [ ] **Step 2: Tambah reply preview di JSX ChatInputBar**

  Cari dalam return ChatInputBar, bagian `.chat-input-bar` div:
  ```jsx
  <div className="chat-input-bar">
        {/* @mention dropdown */}
  ```
  Tambahkan reply preview sesudah `<div className="chat-input-bar">`:
  ```jsx
  {replyTo && (
    <div className="chat-reply-preview">
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="preview-sender">↩ {replyTo.display_name || replyTo.username}</div>
        <div className="preview-text">{replyTo.content}</div>
      </div>
      <button className="preview-close" onClick={onClearReply} title="Batal reply">✕</button>
    </div>
  )}
  ```

- [ ] **Step 3: Tambah `reply_to_id` ke payload handleSend dan clear setelah kirim**

  Cari `handleSend` di ChatInputBar, bagian payload:
  ```js
  const payload = {
    content: text.trim() || (attachedTask ? `📌 ${attachedTask.title}` : ""),
    task_id: attachedTask?.id || null,
    msg_type: attachedTask ? "task_attach" : "text",
  };
  ```
  Ganti dengan:
  ```js
  const payload = {
    content: text.trim() || (attachedTask ? `📌 ${attachedTask.title}` : ""),
    task_id: attachedTask?.id || null,
    msg_type: attachedTask ? "task_attach" : "text",
    reply_to_id: replyTo?.id || null,
  };
  ```

  Lalu cari baris setelah send sukses:
  ```js
  setText("");
  setAttachedTask(null);
  setMentionQuery(null);
  onSent(msg);
  ```
  Tambahkan `onClearReply();` setelah `setMentionQuery(null);`:
  ```js
  setText("");
  setAttachedTask(null);
  setMentionQuery(null);
  onClearReply();
  onSent(msg);
  ```

- [ ] **Step 4: Verifikasi end-to-end**

  1. Buka chat → hover bubble → tombol ↩ muncul
  2. Klik ↩ → preview bar muncul di atas textarea dengan nama sender dan teks quoted
  3. Klik ✕ di preview → preview hilang
  4. Ketik balasan → Enter / Kirim
  5. Pesan terkirim tampil dengan quote block di dalam bubble (border kiri lime, teks 2 baris)
  6. User lain (tab berbeda) menerima pesan via SSE — quote block juga tampil
  7. Mobile: tombol ↩ terlihat (opacity 50%) di samping bubble

- [ ] **Step 5: Commit**

  ```bash
  git add static/index.html
  git commit -m "feat: ChatInputBar — reply preview bar, reply_to_id di payload"
  ```

---

## Task 6: Deploy

- [ ] **Step 1: Push ke GitHub**

  ```bash
  git push origin main
  ```

- [ ] **Step 2: Verifikasi production**

  Buka `https://todo.yatno.web.id`:
  - Hover bubble → tombol ↩ muncul
  - Reply dengan quote → quote block tampil di bubble
  - SSE real-time: user lain terima pesan dengan quote
  - Dark mode: quote block ikut tema
  - Mobile: tombol ↩ visible
