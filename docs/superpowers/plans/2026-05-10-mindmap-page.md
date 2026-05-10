# Mindmap Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a full Mindmap page to TaskFlow with collapsible sidebar, mind-elixir iframe editor, backend storage, pin, and search.

**Architecture:** mind-elixir IIFE embedded in an iframe at `/static/vendor/mind-elixir/index.html`, communicating with the parent SPA via `postMessage` (same pattern as tldraw). Data stored in a new `mindmaps` SQLite table, accessed via 6 FastAPI endpoints. `MindmapPage` and `MindmapListItem` added as top-level functions in `static/index.html`.

**Tech Stack:** FastAPI + SQLite (backend), React hooks + Babel standalone JSX (frontend), mind-elixir v5.11.0 IIFE build.

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `static/vendor/mind-elixir/MindElixir.iife.js` | Create (download) | mind-elixir JS library |
| `static/vendor/mind-elixir/MindElixir.css` | Create (download) | mind-elixir styles |
| `static/vendor/mind-elixir/index.html` | Create | iframe host — initializes mind-elixir, relays postMessage |
| `webapp.py` | Modify | DB migration + Pydantic models + 6 endpoints |
| `static/index.html` | Modify | `MindmapListItem`, `MindmapPage` components + nav + routing |

---

## Task 1: Download mind-elixir vendor files + create iframe host

**Files:**
- Create: `static/vendor/mind-elixir/MindElixir.iife.js`
- Create: `static/vendor/mind-elixir/MindElixir.css`
- Create: `static/vendor/mind-elixir/index.html`

- [ ] **Step 1: Create vendor directory and download files**

Run this Python script from `Z:\Todolist Manager V5.0`:

```python
import os, urllib.request
os.makedirs("static/vendor/mind-elixir", exist_ok=True)
base = "https://cdn.jsdelivr.net/npm/mind-elixir@5.11.0/dist/"
for fname in ["MindElixir.iife.js", "MindElixir.css"]:
    url = base + fname
    dest = f"static/vendor/mind-elixir/{fname}"
    print(f"Downloading {fname}...")
    urllib.request.urlretrieve(url, dest)
    print(f"  → {os.path.getsize(dest):,} bytes")
print("Done.")
```

Expected output:
```
Downloading MindElixir.iife.js...
  → ~87,000 bytes
Downloading MindElixir.css...
  → ~11,000 bytes
Done.
```

- [ ] **Step 2: Create `static/vendor/mind-elixir/index.html`**

Write this file exactly:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Mindmap</title>
  <link rel="stylesheet" href="MindElixir.css">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body, #map { width: 100%; height: 100%; overflow: hidden; }
  </style>
</head>
<body>
  <div id="map"></div>
  <script src="MindElixir.iife.js"></script>
  <script>
    let mind = null;

    function initMind(data) {
      if (mind) {
        mind.init(data);
        return;
      }
      mind = new MindElixir({
        el: '#map',
        direction: MindElixir.SIDE,
        draggable: true,
        editable: true,
        contextMenu: true,
        toolBar: true,
        keypress: true,
      });
      mind.init(data);
      mind.bus.addListener('operation', () => {
        window.parent.postMessage({ type: 'change', data: mind.getData() }, '*');
      });
    }

    window.addEventListener('message', (e) => {
      if (e.origin !== window.location.origin) return;
      if (e.data && e.data.type === 'load') {
        initMind(e.data.data);
      }
    });

    window.parent.postMessage({ type: 'ready' }, '*');
  </script>
</body>
</html>
```

- [ ] **Step 3: Verify files exist**

```
dir "static\vendor\mind-elixir"
```

Expected: 3 files — `index.html`, `MindElixir.iife.js`, `MindElixir.css`

- [ ] **Step 4: Commit**

```
git add static/vendor/mind-elixir/
git commit -m "feat: add mind-elixir vendor files and iframe host"
```

---

## Task 2: Backend — DB migration + Pydantic models + 6 endpoints

**Files:**
- Modify: `webapp.py`

### Step 1: Add DB migration to `migrate_db()`

- [ ] Find the `migrate_db()` function in `webapp.py`. It ends around line 230. Add the mindmaps table migration **before** the closing of the function, after the last existing migration block. Find this exact block near the end of `migrate_db()`:

```python
    # Migrate scratchpad_notes.tags (JSON array) → tags + entity_tags
```

Add a new migration block **before** that line (insert above it):

```python
    # Ensure mindmaps table exists
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS mindmaps (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id    INTEGER NOT NULL,
                title      TEXT NOT NULL DEFAULT 'Untitled',
                data_json  TEXT NOT NULL DEFAULT '{}',
                is_pinned  INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
        """)
        conn.commit()
    finally:
        conn.close()

```

- [ ] **Verify migration anchor** — run:

```
python -c "from webapp import migrate_db; migrate_db(); print('OK')"
```

Expected: `OK` (no errors)

### Step 2: Add Pydantic models

- [ ] Find `class DrawingUpsert(BaseModel):` in `webapp.py` (around line 337). Add these two models **after** the `DrawingUpsert` class (after its closing line):

```python
class MindmapCreate(BaseModel):
    title: str = "Untitled"
    data_json: str = '{"nodeData":{"id":"root","topic":"Untitled","root":true,"children":[]}}'

    @field_validator("data_json")
    @classmethod
    def mindmap_json_valid(cls, v: str) -> str:
        try:
            json.loads(v)
        except ValueError:
            raise ValueError("data_json must be valid JSON")
        return v

class MindmapUpdate(BaseModel):
    title: Optional[str] = None
    data_json: Optional[str] = None

    @field_validator("data_json")
    @classmethod
    def mindmap_json_valid(cls, v: Optional[str]) -> Optional[str]:
        if v is not None:
            try:
                json.loads(v)
            except ValueError:
                raise ValueError("data_json must be valid JSON")
        return v
```

### Step 3: Add 6 mindmap endpoints

- [ ] Find the line `# ══════════════════════════════════════════════════════════════════════════════` near line 2840 (just before the holidays endpoint). Add all 6 mindmap endpoints **before** that separator line:

```python
# ── Mindmap endpoints ────────────────────────────────────────────────────────

@app.get("/api/mindmaps")
async def list_mindmaps(user=Depends(get_current_user)):
    uid = user["sub"]
    with get_db() as conn:
        rows = conn.execute(
            "SELECT id, title, is_pinned, created_at, updated_at FROM mindmaps "
            "WHERE user_id = ? ORDER BY is_pinned DESC, updated_at DESC",
            (uid,)
        ).fetchall()
        return [dict(r) for r in rows]

@app.post("/api/mindmaps")
async def create_mindmap(req: MindmapCreate, user=Depends(get_current_user)):
    uid = user["sub"]
    now = datetime.now(_TZ_JKT).isoformat()
    with get_db() as conn:
        cur = conn.execute(
            "INSERT INTO mindmaps (user_id, title, data_json, is_pinned, created_at, updated_at) "
            "VALUES (?, ?, ?, 0, ?, ?)",
            (uid, req.title, req.data_json, now, now)
        )
        row = conn.execute("SELECT * FROM mindmaps WHERE id = ?", (cur.lastrowid,)).fetchone()
        return dict(row)

@app.get("/api/mindmaps/{mid}")
async def get_mindmap(mid: int, user=Depends(get_current_user)):
    uid = user["sub"]
    with get_db() as conn:
        row = conn.execute(
            "SELECT * FROM mindmaps WHERE id = ? AND user_id = ?", (mid, uid)
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Mindmap tidak ditemukan")
        return dict(row)

@app.put("/api/mindmaps/{mid}")
async def update_mindmap(mid: int, req: MindmapUpdate, user=Depends(get_current_user)):
    uid = user["sub"]
    now = datetime.now(_TZ_JKT).isoformat()
    with get_db() as conn:
        row = conn.execute(
            "SELECT id, title, data_json FROM mindmaps WHERE id = ? AND user_id = ?", (mid, uid)
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Mindmap tidak ditemukan")
        new_title = req.title if req.title is not None else row["title"]
        new_data = req.data_json if req.data_json is not None else row["data_json"]
        conn.execute(
            "UPDATE mindmaps SET title = ?, data_json = ?, updated_at = ? WHERE id = ?",
            (new_title, new_data, now, mid)
        )
        updated = conn.execute("SELECT * FROM mindmaps WHERE id = ?", (mid,)).fetchone()
        return dict(updated)

@app.patch("/api/mindmaps/{mid}/pin")
async def toggle_pin_mindmap(mid: int, user=Depends(get_current_user)):
    uid = user["sub"]
    with get_db() as conn:
        row = conn.execute(
            "SELECT id, is_pinned FROM mindmaps WHERE id = ? AND user_id = ?", (mid, uid)
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Mindmap tidak ditemukan")
        conn.execute(
            "UPDATE mindmaps SET is_pinned = ? WHERE id = ?",
            (0 if row["is_pinned"] else 1, mid)
        )
        updated = conn.execute("SELECT * FROM mindmaps WHERE id = ?", (mid,)).fetchone()
        return dict(updated)

@app.delete("/api/mindmaps/{mid}")
async def delete_mindmap(mid: int, user=Depends(get_current_user)):
    uid = user["sub"]
    with get_db() as conn:
        if not conn.execute(
            "SELECT id FROM mindmaps WHERE id = ? AND user_id = ?", (mid, uid)
        ).fetchone():
            raise HTTPException(status_code=404, detail="Mindmap tidak ditemukan")
        conn.execute("DELETE FROM mindmaps WHERE id = ?", (mid,))
    return {"ok": True}

```

- [ ] **Verify endpoints parse correctly:**

```
python -c "import webapp; print('OK')"
```

Expected: `OK`

- [ ] **Commit**

```
git add webapp.py
git commit -m "feat: add mindmaps table migration, Pydantic models, and 6 API endpoints"
```

---

## Task 3: Frontend — MindmapListItem + MindmapPage components

**Files:**
- Modify: `static/index.html`

Add both components as top-level functions before the existing `// ── Compact task row` comment (around line 4361). Use the Edit tool to find the exact anchor.

- [ ] **Step 1: Find the anchor**

In `static/index.html`, find this exact line:

```js
    // ── Compact task row (minimal: checkbox + title + date) ──────
```

- [ ] **Step 2: Insert both components before that anchor**

```jsx
    // ── Mindmap list item ─────────────────────────────────────────
    function MindmapListItem({ m, isSelected, onSelect, onPin }) {
      const [hovered, setHovered] = useState(false);
      return (
        <div onClick={onSelect}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
          style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 10px",
            cursor: "pointer", borderRadius: 6, transition: "background 0.1s",
            background: isSelected ? "rgba(168,197,0,0.1)" : "transparent",
            borderRight: isSelected ? "2px solid var(--accent)" : "2px solid transparent" }}>
          <span style={{ flex: 1, fontSize: 12,
            color: isSelected ? "var(--accent)" : "var(--text-secondary)",
            fontWeight: isSelected ? 600 : 400,
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {m.title}
          </span>
          {(hovered || m.is_pinned) && (
            <span onClick={e => { e.stopPropagation(); onPin(m); }}
              title={m.is_pinned ? "Unpin" : "Pin"}
              style={{ fontSize: 11, cursor: "pointer", flexShrink: 0,
                color: m.is_pinned ? "var(--accent)" : "var(--text-light)" }}>
              {m.is_pinned ? "★" : "☆"}
            </span>
          )}
        </div>
      );
    }

    // ── Mindmap page ──────────────────────────────────────────────
    function MindmapPage({ showToast }) {
      const [mindmaps, setMindmaps] = useState([]);
      const [selected, setSelected] = useState(null);
      const [loading, setLoading] = useState(true);
      const [sidebarOpen, setSidebarOpen] = useState(
        () => (localStorage.getItem("tf_mindmap_sidebar") || "open") === "open"
      );
      const [searchQ, setSearchQ] = useState("");
      const [creating, setCreating] = useState(false);
      const [newTitle, setNewTitle] = useState("");
      const [renaming, setRenaming] = useState(false);
      const [renameVal, setRenameVal] = useState("");
      const [deleteConfirm, setDeleteConfirm] = useState(false);
      const [iframeReady, setIframeReady] = useState(false);
      const [syncStatus, setSyncStatus] = useState("saved");
      const iframeRef = useRef(null);
      const saveTimerRef = useRef(null);

      // Load list
      useEffect(() => {
        api.get("/api/mindmaps")
          .then(data => {
            setMindmaps(data || []);
            try { localStorage.setItem("tf_mindmap_list", JSON.stringify(data || [])); } catch(_) {}
          })
          .catch(() => {
            const cached = JSON.parse(localStorage.getItem("tf_mindmap_list") || "[]");
            setMindmaps(cached);
          })
          .finally(() => setLoading(false));
      }, []);

      // Persist sidebar state
      useEffect(() => {
        localStorage.setItem("tf_mindmap_sidebar", sidebarOpen ? "open" : "collapsed");
      }, [sidebarOpen]);

      // Reset iframe state when selected mindmap changes
      useEffect(() => {
        setIframeReady(false);
        setSyncStatus("saved");
        setDeleteConfirm(false);
        setRenaming(false);
      }, [selected?.id]);

      // postMessage handler — receive ready + change from iframe
      useEffect(() => {
        const handler = (e) => {
          if (e.origin !== window.location.origin) return;
          if (e.data && e.data.type === "ready") {
            setIframeReady(true);
          }
          if (e.data && e.data.type === "change" && selected) {
            const dataStr = JSON.stringify(e.data.data);
            try { localStorage.setItem(`tf_mindmap_pending_${selected.id}`, dataStr); } catch(_) {}
            if (!navigator.onLine) { setSyncStatus("offline"); return; }
            setSyncStatus("saving");
            clearTimeout(saveTimerRef.current);
            saveTimerRef.current = setTimeout(() => {
              api.put(`/api/mindmaps/${selected.id}`, { data_json: dataStr })
                .then(() => {
                  setSyncStatus("saved");
                  try { localStorage.removeItem(`tf_mindmap_pending_${selected.id}`); } catch(_) {}
                })
                .catch(() => setSyncStatus("offline"));
            }, 1000);
          }
        };
        window.addEventListener("message", handler);
        return () => window.removeEventListener("message", handler);
      }, [selected?.id]);

      // Send data to iframe when it signals ready
      useEffect(() => {
        if (!iframeReady || !selected) return;
        const pending = localStorage.getItem(`tf_mindmap_pending_${selected.id}`);
        const dataStr = pending || selected.data_json;
        try {
          const data = JSON.parse(dataStr);
          iframeRef.current?.contentWindow?.postMessage({ type: "load", data }, "*");
          if (pending) setSyncStatus("offline");
        } catch(_) {}
      }, [iframeReady, selected?.id]);

      // Flush pending data when coming back online
      useEffect(() => {
        const handler = () => {
          if (!selected) return;
          const pending = localStorage.getItem(`tf_mindmap_pending_${selected.id}`);
          if (pending) {
            api.put(`/api/mindmaps/${selected.id}`, { data_json: pending })
              .then(() => {
                setSyncStatus("saved");
                try { localStorage.removeItem(`tf_mindmap_pending_${selected.id}`); } catch(_) {}
              })
              .catch(() => {});
          }
        };
        window.addEventListener("online", handler);
        return () => window.removeEventListener("online", handler);
      }, [selected?.id]);

      const selectMindmap = async (m) => {
        if (selected?.id === m.id) return;
        try {
          const full = await api.get(`/api/mindmaps/${m.id}`);
          setSelected(full);
        } catch(e) { showToast("Gagal memuat mindmap", "error"); }
      };

      const handleCreate = async () => {
        const title = newTitle.trim() || "Untitled";
        const defaultData = JSON.stringify({
          nodeData: { id: "root", topic: title, root: true, children: [] }
        });
        try {
          const created = await api.post("/api/mindmaps", { title, data_json: defaultData });
          setMindmaps(prev => [created, ...prev]);
          try { localStorage.setItem("tf_mindmap_list", JSON.stringify([created, ...mindmaps])); } catch(_) {}
          setSelected(created);
          setNewTitle("");
          setCreating(false);
          showToast("✅ Mindmap dibuat");
        } catch(e) { showToast("Gagal membuat mindmap", "error"); }
      };

      const handleRename = async () => {
        if (!selected || !renameVal.trim()) return;
        try {
          const updated = await api.put(`/api/mindmaps/${selected.id}`, { title: renameVal.trim() });
          setMindmaps(prev => prev.map(m => m.id === updated.id ? { ...m, title: updated.title } : m));
          setSelected(s => ({ ...s, title: updated.title }));
          setRenaming(false);
          showToast("✅ Mindmap diubah");
        } catch(e) { showToast("Gagal rename", "error"); }
      };

      const handleDelete = async () => {
        if (!selected) return;
        try {
          await api.del(`/api/mindmaps/${selected.id}`);
          const next = mindmaps.filter(m => m.id !== selected.id);
          setMindmaps(next);
          try { localStorage.setItem("tf_mindmap_list", JSON.stringify(next)); } catch(_) {}
          setSelected(next.length > 0 ? null : null);
          setDeleteConfirm(false);
          showToast("🗑 Mindmap dihapus");
        } catch(e) { showToast("Gagal hapus", "error"); }
      };

      const handlePin = async (m) => {
        try {
          const updated = await api.patch(`/api/mindmaps/${m.id}/pin`, {});
          setMindmaps(prev => {
            const next = prev.map(x => x.id === updated.id ? { ...x, is_pinned: updated.is_pinned } : x);
            return next.sort((a, b) => b.is_pinned - a.is_pinned || new Date(b.updated_at) - new Date(a.updated_at));
          });
        } catch(e) { showToast("Gagal pin/unpin", "error"); }
      };

      // Filter + group
      const q = searchQ.trim().toLowerCase();
      const filtered = q ? mindmaps.filter(m => m.title.toLowerCase().includes(q)) : mindmaps;
      const pinned = filtered.filter(m => m.is_pinned);
      const unpinned = filtered.filter(m => !m.is_pinned);
      const hasPinnedSection = pinned.length > 0 && !q;

      return (
        <div className="fade-in" style={{ display: "flex", height: "calc(100vh - 112px)", overflow: "hidden", marginTop: 8 }}>

          {/* ── Sidebar ── */}
          <div style={{ width: sidebarOpen ? 200 : 36, flexShrink: 0, transition: "width 0.2s ease",
            overflow: "hidden", borderRight: "1px solid var(--border)",
            display: "flex", flexDirection: "column", background: "var(--bg-card)" }}>

            {sidebarOpen ? (
              <>
                {/* Search */}
                <div style={{ padding: "8px 8px 4px", display: "flex", gap: 4, alignItems: "center", flexShrink: 0 }}>
                  <input value={searchQ} onChange={e => setSearchQ(e.target.value)}
                    placeholder="🔍 Cari..."
                    style={{ flex: 1, fontSize: 11, padding: "4px 8px", borderRadius: 6,
                      border: "1px solid var(--border)", background: "var(--bg-primary)",
                      color: "var(--text-primary)", outline: "none" }} />
                  {searchQ && (
                    <span onClick={() => setSearchQ("")}
                      style={{ cursor: "pointer", fontSize: 11, color: "var(--text-light)", flexShrink: 0 }}>✕</span>
                  )}
                </div>

                {/* New button / inline create */}
                <div style={{ padding: "4px 8px", flexShrink: 0 }}>
                  {creating ? (
                    <div>
                      <input autoFocus value={newTitle} onChange={e => setNewTitle(e.target.value)}
                        placeholder="Nama mindmap..."
                        onKeyDown={e => {
                          if (e.key === "Enter") handleCreate();
                          if (e.key === "Escape") { setCreating(false); setNewTitle(""); }
                        }}
                        style={{ width: "100%", fontSize: 12, padding: "4px 8px", borderRadius: 6,
                          border: "1px solid var(--accent)", background: "var(--bg-primary)",
                          color: "var(--text-primary)", outline: "none", marginBottom: 4 }} />
                      <div style={{ display: "flex", gap: 4 }}>
                        <button className="btn btn-primary btn-sm" onClick={handleCreate}
                          style={{ flex: 1, fontSize: 11 }}>Buat</button>
                        <button className="btn btn-secondary btn-sm"
                          onClick={() => { setCreating(false); setNewTitle(""); }}
                          style={{ fontSize: 11 }}>✕</button>
                      </div>
                    </div>
                  ) : (
                    <button onClick={() => setCreating(true)}
                      style={{ width: "100%", padding: "5px 8px", borderRadius: 6,
                        border: "1px dashed var(--border)", background: "none",
                        color: "var(--accent)", cursor: "pointer", fontSize: 11,
                        fontWeight: 600, textAlign: "left" }}>
                      + Baru
                    </button>
                  )}
                </div>

                {/* List */}
                <div style={{ flex: 1, overflowY: "auto", padding: "4px 0" }}>
                  {loading ? (
                    <div style={{ padding: "8px 12px", color: "var(--text-light)", fontSize: 11 }}>Memuat...</div>
                  ) : filtered.length === 0 ? (
                    <div style={{ padding: "8px 12px", color: "var(--text-light)", fontSize: 11 }}>
                      {q ? "Tidak ditemukan" : "Belum ada mindmap"}
                    </div>
                  ) : (
                    <>
                      {hasPinnedSection && (
                        <>
                          <div style={{ padding: "4px 10px 2px", fontSize: 10, fontWeight: 700,
                            color: "var(--text-light)", textTransform: "uppercase", letterSpacing: "0.6px" }}>
                            ★ Pinned
                          </div>
                          {pinned.map(m => (
                            <MindmapListItem key={m.id} m={m} isSelected={selected?.id === m.id}
                              onSelect={() => selectMindmap(m)} onPin={handlePin} />
                          ))}
                          <div style={{ height: 1, background: "var(--border)", margin: "4px 0" }} />
                          <div style={{ padding: "4px 10px 2px", fontSize: 10, fontWeight: 700,
                            color: "var(--text-light)", textTransform: "uppercase", letterSpacing: "0.6px" }}>
                            Semua
                          </div>
                        </>
                      )}
                      {unpinned.map(m => (
                        <MindmapListItem key={m.id} m={m} isSelected={selected?.id === m.id}
                          onSelect={() => selectMindmap(m)} onPin={handlePin} />
                      ))}
                    </>
                  )}
                </div>

                {/* Collapse button */}
                <button onClick={() => setSidebarOpen(false)}
                  style={{ padding: "8px 12px", background: "none", border: "none",
                    borderTop: "1px solid var(--border)", cursor: "pointer",
                    color: "var(--text-light)", fontSize: 11, textAlign: "left", flexShrink: 0 }}>
                  ‹ Sembunyikan
                </button>
              </>
            ) : (
              /* Collapsed */
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", paddingTop: 10, gap: 10 }}>
                <span style={{ fontSize: 14 }}>🧠</span>
                <button onClick={() => setSidebarOpen(true)}
                  style={{ background: "none", border: "none", cursor: "pointer",
                    color: "var(--text-light)", fontSize: 16, lineHeight: 1 }}>›</button>
              </div>
            )}
          </div>

          {/* ── Editor area ── */}
          <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>

            {/* Mini topbar — only when mindmap selected */}
            {selected && (
              <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 14px",
                borderBottom: "1px solid var(--border)", background: "var(--bg-card)",
                flexShrink: 0, minHeight: 38 }}>
                {renaming ? (
                  <>
                    <input autoFocus value={renameVal} onChange={e => setRenameVal(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === "Enter") handleRename();
                        if (e.key === "Escape") setRenaming(false);
                      }}
                      style={{ flex: 1, maxWidth: 280, fontSize: 13, fontWeight: 600,
                        padding: "2px 8px", borderRadius: 6,
                        border: "1px solid var(--accent)", background: "var(--bg-primary)",
                        color: "var(--text-primary)", outline: "none" }} />
                    <button className="btn btn-primary btn-sm" onClick={handleRename} style={{ fontSize: 11 }}>Simpan</button>
                    <button className="btn btn-secondary btn-sm" onClick={() => setRenaming(false)} style={{ fontSize: 11 }}>Batal</button>
                  </>
                ) : (
                  <>
                    <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)",
                      flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      🧠 {selected.title}
                    </span>
                    <span style={{ fontSize: 11, color: syncStatus === "offline" ? "#ef4444" : "var(--text-light)", flexShrink: 0 }}>
                      {syncStatus === "saving" ? "Menyimpan..." : syncStatus === "offline" ? "Offline" : "Tersimpan"}
                    </span>
                    <button className="btn btn-secondary btn-sm"
                      onClick={() => { setRenaming(true); setRenameVal(selected.title); }}
                      style={{ fontSize: 11 }}>Rename</button>
                    {deleteConfirm ? (
                      <>
                        <span style={{ fontSize: 11, color: "#ef4444", flexShrink: 0 }}>Hapus?</span>
                        <button onClick={handleDelete}
                          style={{ padding: "3px 8px", borderRadius: 6, border: "none", cursor: "pointer",
                            background: "#ef4444", color: "#fff", fontSize: 11 }}>Ya</button>
                        <button className="btn btn-secondary btn-sm"
                          onClick={() => setDeleteConfirm(false)} style={{ fontSize: 11 }}>Batal</button>
                      </>
                    ) : (
                      <button onClick={() => setDeleteConfirm(true)}
                        style={{ padding: "3px 8px", borderRadius: 6, cursor: "pointer", fontSize: 11,
                          background: "none", border: "1px solid #ef4444", color: "#ef4444" }}>Hapus</button>
                    )}
                  </>
                )}
              </div>
            )}

            {/* Placeholder or iframe */}
            {!selected ? (
              <div style={{ flex: 1, display: "flex", flexDirection: "column",
                alignItems: "center", justifyContent: "center", gap: 10 }}>
                <span style={{ fontSize: 40 }}>🧠</span>
                <span style={{ color: "var(--text-light)", fontSize: 13 }}>
                  {mindmaps.length === 0 && !loading ? "Buat mindmap pertamamu" : "Pilih mindmap dari daftar"}
                </span>
                {mindmaps.length === 0 && !loading && !creating && (
                  <button className="btn btn-primary" onClick={() => { setSidebarOpen(true); setCreating(true); }}
                    style={{ marginTop: 4 }}>
                    + Buat Mindmap Pertama
                  </button>
                )}
              </div>
            ) : (
              <iframe ref={iframeRef}
                src="/static/vendor/mind-elixir/index.html"
                style={{ flex: 1, border: "none", width: "100%" }}
                title="Mindmap editor" />
            )}
          </div>
        </div>
      );
    }

    // ── Compact task row (minimal: checkbox + title + date) ──────
```

- [ ] **Step 3: Verify no JSX syntax errors** — open browser, navigate to any page, check DevTools console for errors.

- [ ] **Step 4: Commit**

```
git add static/index.html
git commit -m "feat: add MindmapListItem and MindmapPage components"
```

---

## Task 4: Frontend — Nav link + renderContent routing

**Files:**
- Modify: `static/index.html`

- [ ] **Step 1: Add nav link**

Find this exact block (around line 1696):

```js
        { id: "notes", icon: "📝", label: "Notes & Draw" },
        { id: "chat", icon: "💬", label: "Diskusi" },
```

Replace with:

```js
        { id: "notes", icon: "📝", label: "Notes & Draw" },
        { id: "mindmap", icon: "🧠", label: "Mindmap" },
        { id: "chat", icon: "💬", label: "Diskusi" },
```

- [ ] **Step 2: Add renderContent case**

Find this exact block in `renderContent()`:

```js
        if (page === "notes") {
          return <NotesPage tasks={tasks} showToast={showToast} onTaskClick={setSelectedTask} user={user} sharedLists={sharedLists} />;
        }
```

Add after it:

```js
        if (page === "mindmap") {
          return <MindmapPage showToast={showToast} />;
        }
```

- [ ] **Step 3: Verify in browser**

1. Reload the app → "🧠 Mindmap" appears in sidebar
2. Click "Mindmap" → page opens with empty state "Buat mindmap pertamamu"
3. Click "+ Buat Mindmap Pertama" → inline create input appears in sidebar
4. Type a name, press Enter → mindmap created, editor opens with mind-elixir
5. Add a node in the editor → after 1 second, "Tersimpan" status shown
6. Click "★" on a mindmap → moves to Pinned section
7. Type in search box → list filters in realtime
8. Click sidebar collapse button → sidebar shrinks to 36px strip

- [ ] **Step 4: Commit**

```
git add static/index.html
git commit -m "feat: add Mindmap nav link and renderContent routing"
```

---

## Task 5: Deploy to GitHub

- [ ] **Step 1: Push to remote**

```
git push origin main
```

- [ ] **Step 2: Verify deployment** — Wait for CI/CD, then test all flows from Task 4 Step 3 on the live URL.

---

## Self-Review

**Spec coverage check:**

| Spec requirement | Task |
|-----------------|------|
| mindmaps table with is_pinned | Task 2 step 1 |
| GET/POST/GET/:id/PUT/PATCH pin/DELETE endpoints | Task 2 step 3 |
| mind-elixir iframe host with postMessage | Task 1 step 2 |
| MindmapPage collapsible sidebar 200px/36px | Task 3 |
| Sidebar search — realtime client-side filter | Task 3 |
| Pinned section at top, Semua below | Task 3 |
| ☆/★ pin toggle on hover | Task 3 MindmapListItem |
| Create inline (Enter/Escape) | Task 3 handleCreate |
| Rename inline in topbar | Task 3 handleRename |
| Delete with confirmation | Task 3 handleDelete |
| Auto-save debounce 1s | Task 3 saveTimerRef |
| Offline queue tf_mindmap_pending_<id> | Task 3 postMessage handler |
| Online flush | Task 3 online useEffect |
| tf_mindmap_list cache | Task 3 useEffect load |
| tf_mindmap_sidebar persistence | Task 3 sidebarOpen useEffect |
| Nav link 🧠 Mindmap | Task 4 |
| Empty state | Task 3 |

**No placeholders found.**

**Type consistency:** All handlers reference `selected.id` consistently. `api.patch` passes `{}` as body (same pattern as other patch endpoints in the codebase). `MindmapListItem` props (`m`, `isSelected`, `onSelect`, `onPin`) are consistent with usage in `MindmapPage`.
