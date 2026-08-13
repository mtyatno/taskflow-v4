# Shared Notes — Frontend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Update the frontend Notes UI to support shared notes: 👥 indicator on shared notes, share toggle button in NotePanel, last-editor attribution, autosave (debounced 2.5s), and polling (5s interval for shared notes with conflict banner).

**Architecture:** All changes in `static/index.html`. `NotesPage` receives `user` and `sharedLists` props (added to call site in `App`). `NoteModal` receives `sharedLists` and `currentUserId`. `NotePanel` receives `user`. `noteTitles` shape changes from `[{id,title}]` to `[{id,title,user_id,list_id,owner_username}]` — callers that pass `.map(n=>n.title)` to `renderMarkdown` are unchanged. Autosave and polling use the new `GET /api/scratchpad/{id}` and `PUT /api/scratchpad/{id}` endpoints from the backend plan.

**Dependency:** Backend plan (`2026-04-26-shared-notes-backend.md`) MUST be deployed before this plan is tested end-to-end. Frontend changes are backward-compatible with old backend (new fields are simply absent/null).

**Tech Stack:** React (inline SPA), JSX Babel, existing `api.get/post/put/patch` helpers, `isOfflineErr` pattern

---

## File Map

| File | Aksi | Tanggung Jawab |
|------|------|----------------|
| `static/index.html` | Modify | CSS: `.wikilink-private` |
| `static/index.html` | Modify | `App`: pass `user` + `sharedLists` to `NotesPage`, pass `sharedLists` + `user` to `NoteModal` call in `NotesPage` |
| `static/index.html` | Modify | `NotesPage`: accept `user`, `sharedLists`; show 👥 in note card; pass `user`, `sharedLists` to `NoteModal` |
| `static/index.html` | Modify | `NotePanel`: accept `user`, `sharedLists`; share toggle button; 👥 badge; last-editor line |
| `static/index.html` | Modify | `NoteModal`: accept `sharedLists`, `currentUserId`; share toggle button; autosave; polling; conflict banner |

---

## Task 1: CSS — `.wikilink-private` dan `.note-shared-badge`

**Files:**
- Modify: `static/index.html` (blok `<style>`, setelah `.wikilink-broken` ~baris 789)

- [ ] **Step 1: Tambah CSS**

Cari baris (sekitar 789):
```css
    .wikilink-broken { color: var(--text-light); border-bottom: 1px dashed var(--text-light); cursor: default; font-style: italic; }
```

Tambahkan tepat setelahnya:
```css
    .wikilink-private { color: var(--text-light); border-bottom: 1px dashed var(--text-light); cursor: default; font-style: italic; opacity: 0.7; }
    .note-shared-badge { display: inline-flex; align-items: center; gap: 3px; font-size: 10px; font-weight: 700; color: var(--text-secondary); background: var(--bg-primary); border: 1px solid var(--border); border-radius: 10px; padding: 1px 6px; vertical-align: middle; }
```

- [ ] **Step 2: Commit**

```bash
git add static/index.html
git commit -m "feat: add wikilink-private and note-shared-badge CSS"
```

---

## Task 2: App — Teruskan `user` dan `sharedLists` ke `NotesPage`

**Files:**
- Modify: `static/index.html` (`App` render `NotesPage`, ~baris 8007)

- [ ] **Step 1: Update `NotesPage` call di `App`**

Cari baris (sekitar 8007):
```jsx
          return <NotesPage tasks={tasks} showToast={showToast} onTaskClick={setSelectedTask} />;
```

Ganti dengan:
```jsx
          return <NotesPage tasks={tasks} showToast={showToast} onTaskClick={setSelectedTask} user={user} sharedLists={sharedLists} />;
```

- [ ] **Step 2: Commit**

```bash
git add static/index.html
git commit -m "feat: pass user and sharedLists from App to NotesPage"
```

---

## Task 3: NotesPage — Props Baru, 👥 Indicator di Note Card

**Files:**
- Modify: `static/index.html` (`NotesPage` ~baris 6268 dan note card ~baris 6581)

- [ ] **Step 1: Update tanda tangan fungsi `NotesPage`**

Cari baris (sekitar 6268):
```javascript
    function NotesPage({ tasks, showToast, onTaskClick }) {
```

Ganti dengan:
```javascript
    function NotesPage({ tasks, showToast, onTaskClick, user, sharedLists = [] }) {
```

- [ ] **Step 2: Tambah 👥 indicator di note card**

Cari baris (sekitar 6586) di dalam `sortedNotes.map(n => {...})`:
```jsx
                          <div className="note-card-title">
                            {n.pinned && <span style={{ fontSize: 11, marginRight: 4, opacity: 0.8 }}>📌</span>}
                            {n.title || n.content.slice(0, 60)}
                          </div>
```

Ganti dengan:
```jsx
                          <div className="note-card-title">
                            {n.pinned && <span style={{ fontSize: 11, marginRight: 4, opacity: 0.8 }}>📌</span>}
                            {n.list_id && <span className="note-shared-badge" style={{ marginRight: 4 }}>👥</span>}
                            {n.title || n.content.slice(0, 60)}
                          </div>
```

- [ ] **Step 3: Teruskan `user` dan `sharedLists` ke `NoteModal` dan `NotePanel`**

Cari `<NoteModal` di NotesPage (sekitar baris 6720):
```jsx
            <NoteModal
              key={selected?.id}
              note={selected}
              tasks={tasks}
              onClose={() => { setShowModal(false); setSelected(null); }}
              onSave={handleSave}
              onDelete={handleDelete}
              onTaskClick={onTaskClick}
              showToast={showToast}
            />
```

Ganti dengan:
```jsx
            <NoteModal
              key={selected?.id}
              note={selected}
              tasks={tasks}
              onClose={() => { setShowModal(false); setSelected(null); }}
              onSave={handleSave}
              onDelete={handleDelete}
              onTaskClick={onTaskClick}
              showToast={showToast}
              sharedLists={sharedLists}
              currentUserId={user?.id}
            />
```

Cari `<NotePanel` di NotesPage (sekitar baris 6691):
```jsx
                <NotePanel
                  note={panelNote}
                  allNotes={allNotes}
                  noteTitles={noteTitles}
```

Tambahkan prop `sharedLists` dan `currentUserId`:
```jsx
                <NotePanel
                  note={panelNote}
                  allNotes={allNotes}
                  noteTitles={noteTitles}
                  sharedLists={sharedLists}
                  currentUserId={user?.id}
```

- [ ] **Step 4: Commit**

```bash
git add static/index.html
git commit -m "feat: NotesPage accepts user/sharedLists, shows shared badge on note cards"
```

---

## Task 4: NotePanel — Share Toggle, 👥 Badge, Last-Editor Line

**Files:**
- Modify: `static/index.html` (`NotePanel` ~baris 6118)

- [ ] **Step 1: Update tanda tangan fungsi `NotePanel`**

Cari baris (sekitar 6118):
```javascript
    function NotePanel({ note, allNotes, noteTitles, backlinks, outlinks, navTrail, onEdit, onClose, onDelete, onPin, onNavigate, onNavigateFrom, onTrailClick }) {
```

Ganti dengan:
```javascript
    function NotePanel({ note, allNotes, noteTitles, backlinks, outlinks, navTrail, onEdit, onClose, onDelete, onPin, onNavigate, onNavigateFrom, onTrailClick, sharedLists = [], currentUserId }) {
```

- [ ] **Step 2: Tambah state share dropdown dan handler**

Cari baris (sekitar 6119) setelah pembuka fungsi NotePanel:
```javascript
      const [openDropdownIdx, setOpenDropdownIdx] = useState(null);
```

Tambahkan setelahnya:
```javascript
      const [shareOpen, setShareOpen] = React.useState(false);
      const shareRef = React.useRef(null);

      React.useEffect(() => {
        if (!shareOpen) return;
        const close = (e) => { if (shareRef.current && !shareRef.current.contains(e.target)) setShareOpen(false); };
        document.addEventListener("mousedown", close);
        return () => document.removeEventListener("mousedown", close);
      }, [shareOpen]);

      const handleShare = async (listId) => {
        setShareOpen(false);
        try {
          await api.patch(`/api/scratchpad/${note.id}/share`, { list_id: listId });
          window.dispatchEvent(new CustomEvent("noteSaved"));
        } catch (e) { /* silent — note still works */ }
      };
```

- [ ] **Step 3: Update header NotePanel — tambah 👥 badge, last-editor line, share button**

Cari blok `{/* Header */}` di NotePanel (sekitar 6216):
```jsx
          {/* Header */}
          <div className="notes-panel-header">
            <div className="notes-panel-title">{note.title || "(tanpa judul)"}</div>
            <span style={{ fontSize: 11, color: "var(--text-light)", flexShrink: 0 }}>{fmtDate(note.updated_at)}</span>
            <button onClick={() => onPin(note.id)} title={note.pinned ? "Unpin" : "Pin"}
```

Ganti seluruh header block (sampai tutup `</div>` setelah tombol ✕, sekitar baris 6240):
```jsx
          {/* Header */}
          <div className="notes-panel-header">
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="notes-panel-title" style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                {note.list_id && <span className="note-shared-badge">👥 Bersama</span>}
                {note.title || "(tanpa judul)"}
              </div>
              {note.last_editor_username && note.last_edited_by !== note.user_id && (
                <div style={{ fontSize: 11, color: "var(--text-light)", marginTop: 2 }}>
                  Diedit oleh <b>{note.last_editor_display_name || note.last_editor_username}</b> · {fmtDate(note.updated_at)}
                </div>
              )}
              {(!note.last_editor_username || note.last_edited_by === note.user_id) && (
                <div style={{ fontSize: 11, color: "var(--text-light)", marginTop: 2 }}>{fmtDate(note.updated_at)}</div>
              )}
            </div>
            {/* Share button — only for owner */}
            {note.user_id === currentUserId && sharedLists.length > 0 && (
              <div ref={shareRef} style={{ position: "relative", flexShrink: 0 }}>
                <button onClick={() => setShareOpen(o => !o)}
                  title={note.list_id ? "Atur berbagi" : "Bagikan ke list"}
                  style={{ background: note.list_id ? "rgba(168,197,0,0.12)" : "none", border: "1px solid var(--border)", borderRadius: 7, fontSize: 12, fontWeight: 600, color: note.list_id ? "var(--accent)" : "var(--text-light)", cursor: "pointer", padding: "4px 8px", flexShrink: 0 }}>
                  👥
                </button>
                {shareOpen && (
                  <div style={{ position: "absolute", top: "calc(100% + 4px)", right: 0, zIndex: 300, background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 10, boxShadow: "0 6px 20px rgba(0,0,0,0.18)", minWidth: 180, padding: "4px 0" }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: "var(--text-light)", textTransform: "uppercase", letterSpacing: 1, padding: "6px 14px 4px" }}>Bagikan ke List</div>
                    {sharedLists.map(l => (
                      <div key={l.id}
                        onMouseDown={e => { e.preventDefault(); handleShare(l.id); }}
                        style={{ padding: "7px 14px", fontSize: 13, cursor: "pointer", color: note.list_id === l.id ? "var(--accent)" : "var(--text-primary)", fontWeight: note.list_id === l.id ? 700 : 400 }}
                        onMouseEnter={e => e.currentTarget.style.background = "var(--bg-primary)"}
                        onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                        {note.list_id === l.id ? "✓ " : ""}{l.name}
                      </div>
                    ))}
                    {note.list_id && (
                      <div
                        onMouseDown={e => { e.preventDefault(); handleShare(null); }}
                        style={{ padding: "7px 14px", fontSize: 13, cursor: "pointer", color: "#ef4444", borderTop: "1px solid var(--border)" }}
                        onMouseEnter={e => e.currentTarget.style.background = "var(--bg-primary)"}
                        onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                        Batal berbagi
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
            <button onClick={() => onPin(note.id)} title={note.pinned ? "Unpin" : "Pin"}
              style={{ background: note.pinned ? "rgba(168,197,0,0.15)" : "none", border: "1px solid var(--border)", borderRadius: 7, fontSize: 12, fontWeight: 600, color: note.pinned ? "var(--accent)" : "var(--text-light)", cursor: "pointer", padding: "4px 10px", flexShrink: 0 }}>
              📌
            </button>
            <button onClick={handlePrint} title="Cetak / Simpan PDF"
              style={{ background: "none", border: "1px solid var(--border)", borderRadius: 7, fontSize: 12, fontWeight: 600, color: "var(--text-light)", cursor: "pointer", padding: "4px 10px", flexShrink: 0 }}>
              PDF
            </button>
            <button onClick={onEdit}
              style={{ background: "none", border: "1px solid var(--border)", borderRadius: 7, fontSize: 12, fontWeight: 600, color: "var(--accent)", cursor: "pointer", padding: "4px 10px", flexShrink: 0 }}>
              ✏ Edit
            </button>
            <button onClick={() => { if (window.confirm("Hapus catatan ini?")) onDelete(note.id); }}
              style={{ background: "none", border: "1px solid var(--border)", borderRadius: 7, fontSize: 12, fontWeight: 600, color: "#ef4444", cursor: "pointer", padding: "4px 10px", flexShrink: 0 }}>
              🗑
            </button>
            <button onClick={onClose}
              style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18, color: "var(--text-light)", padding: 0, lineHeight: 1, flexShrink: 0 }}>
              ✕
            </button>
          </div>
```

- [ ] **Step 4: Commit**

```bash
git add static/index.html
git commit -m "feat: NotePanel share toggle button, shared badge, last-editor attribution"
```

---

## Task 5: NoteModal — Share Button

**Files:**
- Modify: `static/index.html` (`NoteModal` ~baris 5666)

- [ ] **Step 1: Update tanda tangan fungsi `NoteModal`**

Cari baris (sekitar 5666):
```javascript
    function NoteModal({ note, tasks, onClose, onSave, onDelete, onTaskClick, showToast }) {
```

Ganti dengan:
```javascript
    function NoteModal({ note, tasks, onClose, onSave, onDelete, onTaskClick, showToast, sharedLists = [], currentUserId }) {
```

- [ ] **Step 2: Tambah state share dropdown dan handler di NoteModal**

Cari baris (sekitar 5683) setelah `const textareaRef = useRef(null);`:
```javascript
      const textareaRef               = useRef(null);

      // Wikilink autocomplete
```

Tambahkan setelah `textareaRef`:
```javascript
      const textareaRef               = useRef(null);

      // Share dropdown
      const [shareOpen, setShareOpen] = useState(false);
      const shareRef = useRef(null);
      useEffect(() => {
        if (!shareOpen) return;
        const close = (e) => { if (shareRef.current && !shareRef.current.contains(e.target)) setShareOpen(false); };
        document.addEventListener("mousedown", close);
        return () => document.removeEventListener("mousedown", close);
      }, [shareOpen]);
      const [noteListId, setNoteListId] = useState(note?.list_id ?? null);
      const handleModalShare = async (listId) => {
        setShareOpen(false);
        if (!note?.id) return;
        try {
          const updated = await api.patch(`/api/scratchpad/${note.id}/share`, { list_id: listId });
          setNoteListId(updated.list_id ?? null);
          window.dispatchEvent(new CustomEvent("noteSaved"));
        } catch (e) { /* silent */ }
      };

      // Wikilink autocomplete
```

- [ ] **Step 3: Tambah share button di header NoteModal**

NoteModal memiliki header di expanded mode dan compact mode. Cari tombol Pin di NoteModal (sekitar baris dalam `inner` JSX):
```jsx
          <button title={note?.id && note.pinned ? "Unpin" : "Pin"}
```

Cari blok yang berisi tombol-tombol header di NoteModal. Temukan `note-modal-header` atau `onClose` button di header. Cari baris yang berisi expand/collapse dan close button di header:

```jsx
                style={{ background: "none", border: "none", cursor: "pointer", fontSize: 20, color: "var(--text-light)", padding: 0, lineHeight: 1, flexShrink: 0 }}
                onClick={onClose}>✕
```

Cari keseluruhan header baris di `inner` yang ada `onClose`. Tambahkan share button SEBELUM tombol close. Cari pattern (baris ~5890):
```jsx
              <button
                style={{ background: "none", border: "none", cursor: "pointer", fontSize: 20, color: "var(--text-light)", padding: 0, lineHeight: 1, flexShrink: 0 }}
                onClick={onClose}>✕
              </button>
```

Tambahkan sebelum tombol ✕ tersebut:
```jsx
              {note?.id && note.user_id === currentUserId && sharedLists.length > 0 && (
                <div ref={shareRef} style={{ position: "relative", flexShrink: 0 }}>
                  <button onClick={() => setShareOpen(o => !o)}
                    title={noteListId ? "Atur berbagi" : "Bagikan ke list"}
                    style={{ background: noteListId ? "rgba(168,197,0,0.12)" : "none", border: "1px solid var(--border)", borderRadius: 7, fontSize: 12, fontWeight: 600, color: noteListId ? "var(--accent)" : "var(--text-light)", cursor: "pointer", padding: "4px 8px" }}>
                    👥
                  </button>
                  {shareOpen && (
                    <div style={{ position: "absolute", top: "calc(100% + 4px)", right: 0, zIndex: 300, background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 10, boxShadow: "0 6px 20px rgba(0,0,0,0.18)", minWidth: 180, padding: "4px 0" }}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: "var(--text-light)", textTransform: "uppercase", letterSpacing: 1, padding: "6px 14px 4px" }}>Bagikan ke List</div>
                      {sharedLists.map(l => (
                        <div key={l.id}
                          onMouseDown={e => { e.preventDefault(); handleModalShare(l.id); }}
                          style={{ padding: "7px 14px", fontSize: 13, cursor: "pointer", color: noteListId === l.id ? "var(--accent)" : "var(--text-primary)", fontWeight: noteListId === l.id ? 700 : 400 }}
                          onMouseEnter={e => e.currentTarget.style.background = "var(--bg-primary)"}
                          onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                          {noteListId === l.id ? "✓ " : ""}{l.name}
                        </div>
                      ))}
                      {noteListId && (
                        <div
                          onMouseDown={e => { e.preventDefault(); handleModalShare(null); }}
                          style={{ padding: "7px 14px", fontSize: 13, cursor: "pointer", color: "#ef4444", borderTop: "1px solid var(--border)" }}
                          onMouseEnter={e => e.currentTarget.style.background = "var(--bg-primary)"}
                          onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                          Batal berbagi
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
              <button
                style={{ background: "none", border: "none", cursor: "pointer", fontSize: 20, color: "var(--text-light)", padding: 0, lineHeight: 1, flexShrink: 0 }}
                onClick={onClose}>✕
              </button>
```

**Cara menemukan baris yang tepat:** Cari `onClick={onClose}>✕` di dalam `function NoteModal` — ada dua (satu di expanded, satu di compact). Tambahkan share button di KEDUANYA untuk konsistensi, atau hanya di expanded (yang paling sering digunakan).

- [ ] **Step 4: Commit**

```bash
git add static/index.html
git commit -m "feat: add share toggle button to NoteModal header"
```

---

## Task 6: NoteModal — Autosave (Debounced 2.5s)

**Files:**
- Modify: `static/index.html` (`NoteModal` ~baris 5666)

- [ ] **Step 1: Tambah `isDirtyRef` dan autosave useEffect**

Cari baris setelah state `[saving, setSaving]` di NoteModal (sekitar 5679):
```javascript
      const [saving, setSaving]       = useState(false);
      const [expanded, setExpanded]   = useState(false);
```

Tambahkan setelah `saving` state:
```javascript
      const [saving, setSaving]       = useState(false);
      const isDirtyRef                = useRef(false);
      const autosaveTimerRef          = useRef(null);
      const [expanded, setExpanded]   = useState(false);
```

Cari baris `useEffect` pertama di NoteModal yang load titles (sekitar 5694):
```javascript
      useEffect(() => {
        api.get("/api/scratchpad/titles").then(setNoteTitles).catch(() => {});
```

Tambahkan useEffect autosave SEBELUM useEffect tersebut:
```javascript
      // Autosave: debounced 2.5s setelah perubahan, hanya untuk note yang sudah ada
      useEffect(() => {
        if (!note?.id) return;
        isDirtyRef.current = true;
        clearTimeout(autosaveTimerRef.current);
        autosaveTimerRef.current = setTimeout(async () => {
          if (!navigator.onLine) return;
          try {
            await api.put(`/api/scratchpad/${note.id}`, {
              title, content, tags,
              linked_task_ids: linkedTaskIds,
              linked_task_id: linkedTaskIds[0] || null,
            });
            isDirtyRef.current = false;
          } catch (e) {
            if (!isOfflineErr(e)) console.warn("Autosave failed:", e.message);
          }
        }, 2500);
        return () => clearTimeout(autosaveTimerRef.current);
      }, [title, content, tags, linkedTaskIds]);

      useEffect(() => {
        api.get("/api/scratchpad/titles").then(setNoteTitles).catch(() => {});
```

- [ ] **Step 2: Set `isDirtyRef.current = false` saat manual save**

Cari `saveOnly` function (sekitar 5877):
```javascript
      const saveOnly = async () => {
        setSaving(true);
        await onSave({ title, content, tags, linked_task_ids: linkedTaskIds, linked_task_id: linkedTaskIds[0] || null });
        setSaving(false);
      };
```

Ganti dengan:
```javascript
      const saveOnly = async () => {
        setSaving(true);
        clearTimeout(autosaveTimerRef.current);
        await onSave({ title, content, tags, linked_task_ids: linkedTaskIds, linked_task_id: linkedTaskIds[0] || null });
        isDirtyRef.current = false;
        setSaving(false);
      };
```

- [ ] **Step 3: Commit**

```bash
git add static/index.html
git commit -m "feat: autosave in NoteModal, debounced 2.5s on content/title change"
```

---

## Task 7: NoteModal — Polling dan Conflict Banner

**Files:**
- Modify: `static/index.html` (`NoteModal` ~baris 5666)

- [ ] **Step 1: Tambah state dan polling useEffect**

Cari state `[saving, setSaving]` (sekitar 5679), tambahkan setelah `isDirtyRef`:
```javascript
      const isDirtyRef                = useRef(false);
      const autosaveTimerRef          = useRef(null);
      const [conflictBanner, setConflictBanner] = useState(null); // { editor: string }
      const [expanded, setExpanded]   = useState(false);
```

Cari useEffect autosave yang baru ditambahkan di Task 6. Tambahkan useEffect polling SETELAHNYA (sebelum useEffect load titles):
```javascript
      // Polling: setiap 5 detik untuk shared notes saja
      useEffect(() => {
        if (!note?.id || !note?.list_id) return;
        const interval = setInterval(async () => {
          if (!navigator.onLine) return;
          try {
            const fresh = await api.get(`/api/scratchpad/${note.id}`);
            if (!fresh?.updated_at) return;
            const serverTime = new Date(fresh.updated_at).getTime();
            const localTime  = new Date(note.updated_at).getTime();
            if (serverTime <= localTime) return;
            // Ada versi lebih baru dari server
            if (!isDirtyRef.current) {
              // User tidak sedang mengetik — update silent
              setContent(fresh.content || "");
              setTitle(fresh.title || "");
              setConflictBanner(null);
            } else {
              // User sedang mengetik — tampilkan banner
              const editorName = fresh.last_editor_display_name || fresh.last_editor_username || "Pengguna lain";
              setConflictBanner({ editor: editorName, content: fresh.content, title: fresh.title });
            }
          } catch (_) { /* ignore poll errors */ }
        }, 5000);
        return () => clearInterval(interval);
      }, [note?.id, note?.list_id]);

      useEffect(() => {
        api.get("/api/scratchpad/titles").then(setNoteTitles).catch(() => {});
```

- [ ] **Step 2: Render conflict banner di dalam `inner` JSX**

Cari di JSX `inner` (di dalam NoteModal), setelah bagian Title input dan sebelum Content + ToC:
```jsx
          {/* Content + ToC */}
          <div style={{ display: "flex", gap: 0, alignItems: "flex-start", marginTop: 12 }}>
```

Tambahkan tepat sebelumnya:
```jsx
          {/* Conflict banner */}
          {conflictBanner && (
            <div style={{ background: "#fef3c7", border: "1px solid #fde68a", borderRadius: 8, padding: "8px 12px", marginBottom: 8, display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
              <span style={{ flex: 1, color: "#92400e" }}>
                ✏️ <b>{conflictBanner.editor}</b> baru saja menyimpan perubahan.
              </span>
              <button
                onClick={() => {
                  setContent(conflictBanner.content || "");
                  setTitle(conflictBanner.title || "");
                  isDirtyRef.current = false;
                  setConflictBanner(null);
                }}
                style={{ background: "#f59e0b", border: "none", borderRadius: 5, fontSize: 11, fontWeight: 700, color: "#fff", cursor: "pointer", padding: "3px 8px", flexShrink: 0 }}>
                Muat perubahan
              </button>
              <button
                onClick={() => setConflictBanner(null)}
                style={{ background: "none", border: "none", fontSize: 14, cursor: "pointer", color: "#92400e", padding: "0 2px" }}>
                ✕
              </button>
            </div>
          )}

          {/* Content + ToC */}
          <div style={{ display: "flex", gap: 0, alignItems: "flex-start", marginTop: 12 }}>
```

- [ ] **Step 3: Manual test**

1. Buka app, buat atau pilih note yang sudah di-share ke sebuah list
2. Buka note yang sama di dua browser tab (atau dua user berbeda)
3. Pada Tab A, edit konten, tunggu 2.5 detik (autosave harus terjadi)
4. Pada Tab B (dalam 5 detik), editor harus terupdate silent jika Tab B tidak sedang mengetik
5. Pada Tab B, mulai mengetik sesuatu, kemudian dari Tab A simpan — banner konflik harus muncul di Tab B
6. Klik "Muat perubahan" — konten Tab B harus terupdate ke versi Tab A
7. Verifikasi note personal (tanpa list_id) TIDAK melakukan polling
8. Verifikasi offline: matikan jaringan → autosave tidak error, polling skip

- [ ] **Step 4: Commit dan push**

```bash
git add static/index.html
git commit -m "feat: NoteModal polling 5s for shared notes, conflict banner when dirty"
git push origin main
```

---

## Catatan Deploy

Tidak ada perubahan backend di plan ini — cukup hard-refresh browser setelah pull.

Pastikan **backend plan** (`2026-04-26-shared-notes-backend.md`) sudah di-deploy terlebih dahulu agar:
- `GET /api/scratchpad/{note_id}` untuk polling tersedia
- `PATCH /api/scratchpad/{note_id}/share` tersedia
- `/api/scratchpad` dan `/api/scratchpad/titles` return `list_id`, `owner_username`, `last_editor_*` fields
