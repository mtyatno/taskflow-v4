# Global Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tambahkan fitur pencarian global via popup modal yang dapat dibuka dari ikon kaca pembesar di nav atas, menampilkan hasil grouped: Tags, Tasks, Notes.

**Architecture:** Satu endpoint baru `GET /api/search?q=...` di backend yang mengembalikan hasil terkelompok. Di frontend, komponen `SearchModal` baru ditambahkan ke `App`, dipicu dari ikon 🔍 di mobile-topbar dan desktop-topbar, serta shortcut `Ctrl+K`.

**Tech Stack:** FastAPI (Python), React (frontend SPA di `static/index.html`), SQLite LIKE query

---

## File Map

| File | Aksi | Tanggung Jawab |
|------|------|----------------|
| `webapp.py` | Modify | Tambah `GET /api/search` endpoint |
| `static/index.html` | Modify | Komponen `SearchModal`, ikon di nav, state di App |

---

## Task 1: Backend — `GET /api/search` endpoint

**Files:**
- Modify: `webapp.py` (tambah setelah `DELETE /api/tags/{tag_id}` sekitar baris 1982)

- [ ] **Step 1: Tambah endpoint `GET /api/search`**

Cari baris `# ══════════════════════════════════` setelah `delete_tag` (baris ~1984), sisipkan sebelumnya:

```python
@app.get("/api/search")
async def global_search(q: str = "", user=Depends(get_current_user)):
    q = q.strip()
    if len(q) < 2:
        raise HTTPException(status_code=400, detail="Query minimal 2 karakter")
    uid = user["sub"]
    like = f"%{q}%"
    with get_db() as conn:
        # Tags
        tag_rows = conn.execute("""
            SELECT t.id, t.name, COUNT(et.entity_id) as count
            FROM tags t
            LEFT JOIN entity_tags et ON t.id = et.tag_id
            WHERE t.user_id = ? AND t.name LIKE ?
            GROUP BY t.id ORDER BY count DESC, t.name ASC
            LIMIT 5
        """, (uid, like)).fetchall()

        # Tasks (exclude done/archived)
        access_clause = (
            "user_id = ? OR list_id IN ("
            "  SELECT id FROM shared_lists WHERE owner_id = ?"
            "  UNION SELECT list_id FROM list_members WHERE user_id = ?"
            ")"
        )
        task_rows = conn.execute(f"""
            SELECT id, title, priority, gtd_status, deadline, quadrant
            FROM tasks
            WHERE ({access_clause})
              AND gtd_status NOT IN ('done','archived')
              AND (title LIKE ? OR description LIKE ?)
            ORDER BY priority, deadline
            LIMIT 8
        """, (uid, uid, uid, like, like)).fetchall()

        # Notes
        note_rows = conn.execute("""
            SELECT id, title, content, updated_at
            FROM scratchpad_notes
            WHERE user_id = ? AND (title LIKE ? OR content LIKE ?)
            ORDER BY updated_at DESC
            LIMIT 8
        """, (uid, like, like)).fetchall()

    def snippet(text, length=80):
        if not text:
            return ""
        text = text.strip()
        return text[:length] + ("…" if len(text) > length else "")

    return {
        "tags": [dict(r) for r in tag_rows],
        "tasks": [dict(r) for r in task_rows],
        "notes": [
            {**dict(r), "content": snippet(r["content"])}
            for r in note_rows
        ],
    }
```

- [ ] **Step 2: Verifikasi endpoint bisa dipanggil**

Di VPS setelah deploy:
```bash
# Login dulu di browser, lalu:
curl -s "http://localhost:8000/api/search?q=pro" -H "Cookie: access_token=<jwt>" | python3 -m json.tool
# Expected: {"tags": [...], "tasks": [...], "notes": [...]}

curl -s "http://localhost:8000/api/search?q=x" -H "Cookie: access_token=<jwt>"
# Expected: 400 {"detail": "Query minimal 2 karakter"}
```

- [ ] **Step 3: Commit**

```bash
git add webapp.py
git commit -m "feat: add GET /api/search endpoint with grouped results (tags, tasks, notes)"
```

---

## Task 2: Frontend — Komponen `SearchModal`

**Files:**
- Modify: `static/index.html` (tambah komponen `SearchModal` sebelum `function App()`, sekitar baris 6818)

- [ ] **Step 1: Tambah komponen `SearchModal`**

Cari baris `function App()` (sekitar baris 6818), tambahkan tepat sebelumnya:

```jsx
function SearchModal({ onClose, onTaskClick, onNoteClick }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const inputRef = React.useRef(null);
  const debounceRef = React.useRef(null);

  useEffect(() => {
    inputRef.current?.focus();
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const search = (val) => {
    setQuery(val);
    clearTimeout(debounceRef.current);
    if (val.trim().length < 2) { setResults(null); return; }
    debounceRef.current = setTimeout(() => {
      setLoading(true);
      api.get(`/api/search?q=${encodeURIComponent(val.trim())}`)
        .then(data => { setResults(data); setLoading(false); })
        .catch(() => { setResults(null); setLoading(false); });
    }, 300);
  };

  const PRI_COLOR = { P1: "#ef4444", P2: "#f97316", P3: "#eab308", P4: "#22c55e" };
  const hasResults = results && (results.tags.length > 0 || results.tasks.length > 0 || results.notes.length > 0);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{
        background: "var(--bg-card)", borderRadius: 16, width: "90%", maxWidth: 580,
        boxShadow: "0 20px 60px rgba(0,0,0,0.25)", overflow: "hidden",
        marginTop: "8vh",
        alignSelf: "flex-start",
      }}>
        {/* Search input */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 16px", borderBottom: "1px solid var(--border)" }}>
          <span style={{ fontSize: 18, color: "var(--text-light)" }}>🔍</span>
          <input
            ref={inputRef}
            value={query}
            onChange={e => search(e.target.value)}
            placeholder="Cari task, catatan, atau tag…"
            style={{
              flex: 1, border: "none", outline: "none", fontSize: 15,
              background: "transparent", color: "var(--text-primary)", fontFamily: "inherit",
            }}
          />
          {loading && <span style={{ fontSize: 12, color: "var(--text-light)" }}>…</span>}
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18, color: "var(--text-light)", padding: 0, lineHeight: 1 }}>✕</button>
        </div>

        {/* Results */}
        <div style={{ maxHeight: "60vh", overflowY: "auto", padding: query.trim().length >= 2 ? "8px 0" : "20px 16px" }}>
          {query.trim().length < 2 && (
            <div style={{ color: "var(--text-light)", fontSize: 13, textAlign: "center" }}>
              Ketik minimal 2 karakter untuk mulai mencari
            </div>
          )}

          {query.trim().length >= 2 && !loading && results && !hasResults && (
            <div style={{ color: "var(--text-light)", fontSize: 13, textAlign: "center", padding: "20px 16px" }}>
              Tidak ditemukan hasil untuk "<b>{query}</b>"
            </div>
          )}

          {/* Tags */}
          {results?.tags?.length > 0 && (
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-light)", textTransform: "uppercase", letterSpacing: 1, padding: "6px 16px 4px" }}>
                🏷️ Tags
              </div>
              {results.tags.map(tag => (
                <div key={tag.id}
                  onClick={() => { onClose(); window.dispatchEvent(new CustomEvent("searchTag", { detail: tag.name })); }}
                  style={{ padding: "8px 16px", cursor: "pointer", display: "flex", alignItems: "center", gap: 8 }}
                  onMouseEnter={e => e.currentTarget.style.background = "var(--bg-primary)"}
                  onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                >
                  <span style={{ color: "var(--accent)", fontWeight: 700, fontSize: 14 }}>#{tag.name}</span>
                  <span style={{ fontSize: 11, color: "var(--text-light)", marginLeft: "auto" }}>{tag.count} item</span>
                </div>
              ))}
            </div>
          )}

          {/* Tasks */}
          {results?.tasks?.length > 0 && (
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-light)", textTransform: "uppercase", letterSpacing: 1, padding: "6px 16px 4px" }}>
                📋 Tasks
              </div>
              {results.tasks.map(task => (
                <div key={task.id}
                  onClick={() => { onClose(); onTaskClick(task); }}
                  style={{ padding: "8px 16px", cursor: "pointer", display: "flex", alignItems: "center", gap: 8 }}
                  onMouseEnter={e => e.currentTarget.style.background = "var(--bg-primary)"}
                  onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                >
                  <span style={{ fontSize: 11, fontWeight: 700, color: PRI_COLOR[task.priority] || "var(--text-light)", background: "var(--bg-primary)", borderRadius: 4, padding: "1px 5px", flexShrink: 0 }}>{task.priority || "—"}</span>
                  <span style={{ fontSize: 14, color: "var(--text-primary)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{task.title}</span>
                  {task.deadline && <span style={{ fontSize: 11, color: "var(--text-light)", flexShrink: 0 }}>{task.deadline}</span>}
                </div>
              ))}
            </div>
          )}

          {/* Notes */}
          {results?.notes?.length > 0 && (
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-light)", textTransform: "uppercase", letterSpacing: 1, padding: "6px 16px 4px" }}>
                📝 Notes
              </div>
              {results.notes.map(note => (
                <div key={note.id}
                  onClick={() => { onClose(); onNoteClick(note); }}
                  style={{ padding: "8px 16px", cursor: "pointer" }}
                  onMouseEnter={e => e.currentTarget.style.background = "var(--bg-primary)"}
                  onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                >
                  <div style={{ fontSize: 14, color: "var(--text-primary)", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {note.title || "(tanpa judul)"}
                  </div>
                  {note.content && (
                    <div style={{ fontSize: 12, color: "var(--text-light)", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {note.content}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add static/index.html
git commit -m "feat: add SearchModal component with debounced grouped results"
```

---

## Task 3: Frontend — Nav integration, state, keyboard shortcut

**Files:**
- Modify: `static/index.html` (komponen `App`, sekitar baris 6818–7500)

- [ ] **Step 1: Tambah state `showSearch` di `App`**

Cari baris `const [isOnline, setIsOnline] = useState(navigator.onLine)` (sekitar baris 6818), tambahkan tepat setelahnya:

```javascript
const [showSearch, setShowSearch] = useState(false);
```

- [ ] **Step 2: Tambah keyboard shortcut Ctrl+K / Cmd+K**

Di dalam `App`, cari blok `useEffect` yang menangani `visibilitychange` atau `document.addEventListener` (sekitar baris 7048). Tambahkan useEffect baru:

```javascript
useEffect(() => {
  const handler = (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "k") {
      e.preventDefault();
      setShowSearch(s => !s);
    }
  };
  document.addEventListener("keydown", handler);
  return () => document.removeEventListener("keydown", handler);
}, []);
```

- [ ] **Step 3: Tambah ikon 🔍 di mobile-topbar**

Cari baris mobile-topbar (sekitar baris 7350):
```jsx
<div className="mobile-topbar">
  <button onClick={() => setSidebarOpen(!sidebarOpen)} ...>☰</button>
  <div style={{ flex: 1, fontWeight: 700, fontSize: 16 }}>⚡ TaskFlow</div>
  <button onClick={handleOpenNotif} ...>
```

Tambahkan tombol search SEBELUM tombol notif:
```jsx
<button onClick={() => setShowSearch(true)} style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", padding: "0 4px", lineHeight: 1, color: "var(--text-secondary)" }} title="Cari (Ctrl+K)">🔍</button>
```

Sehingga urutan mobile-topbar menjadi: ☰ → judul → 🔍 → 🔔 → ThemeToggle

- [ ] **Step 4: Tambah ikon 🔍 di desktop-topbar**

Cari bagian desktop-topbar `<div data-notif-panel ...>` (sekitar baris 7368), tambahkan tombol search SEBELUM tombol notif (`<button onClick={handleOpenNotif}`):

```jsx
<button onClick={() => setShowSearch(true)} title="Cari (Ctrl+K)" style={{ background: "none", border: "1px solid var(--border)", borderRadius: 8, cursor: "pointer", fontSize: 18, padding: "5px 10px", color: "var(--text-secondary)", lineHeight: 1 }}>🔍</button>
```

- [ ] **Step 5: Tambah handler `onNoteClick` di App**

Cari handler untuk membuka note dari notifikasi atau dari dashboard, atau tambahkan baru di blok handler App. Tambahkan setelah handler yang ada (cari `const handleDone` atau area handler lainnya):

```javascript
const handleSearchNoteClick = (note) => {
  setPage("notes");
  setTimeout(() => window.dispatchEvent(new CustomEvent("openNote", { detail: note.id })), 100);
};
```

- [ ] **Step 6: Mount `SearchModal` di JSX modals section**

Cari blok `{/* Modals */}` di JSX App (sekitar baris 7424), tambahkan setelah modal terakhir (sebelum `{/* Toast */}`):

```jsx
{showSearch && (
  <SearchModal
    onClose={() => setShowSearch(false)}
    onTaskClick={(task) => { setShowSearch(false); openTaskById(task.id); }}
    onNoteClick={handleSearchNoteClick}
  />
)}
```

- [ ] **Step 7: Verifikasi `openTaskById` dan `openNote` handler sudah ada**

`openTaskById` sudah ada di line ~7093 di App — tidak perlu ditambah, langsung dipakai di Step 6.

`openNote` event listener sudah ada di NotesPage (line ~5984) dan sudah melakukan fetch + buka modal — tidak perlu ditambah.

- [ ] **Step 8: Commit**

```bash
git add static/index.html
git commit -m "feat: global search icon in nav, Ctrl+K shortcut, SearchModal wired to App"
git push origin main
```

> Note: `handleSearchNoteClick` menggunakan `setPage("notes")` + setTimeout 100ms sebelum dispatch `openNote` event, memberi waktu React untuk mount NotesPage dan register event listener.

---

## Catatan Deploy

```bash
git pull origin main
sudo systemctl restart taskflow-web
```

Backend berubah (Task 1) — perlu restart service. Frontend (Task 2 & 3) — cukup hard-refresh browser.
