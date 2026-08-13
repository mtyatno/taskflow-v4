# Notes Two-Panel Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign NotesPage menjadi layout dua panel — panel kiri (daftar + search + tag filter + sort) dan panel kanan (preview note, links keluar, backlinks, nav trail) — dengan connectivity hints di setiap kartu.

**Architecture:** Semua perubahan ada di `static/index.html`. Tambah komponen `NotePanel` baru (read-only preview). `NoteModal` yang sudah ada tetap digunakan untuk editing. Mobile tetap single-panel (panel kanan disembunyikan via CSS). Tidak ada perubahan backend.

**Tech Stack:** React (inline SPA di `static/index.html`), `renderMarkdown` (sudah ada line ~5421), endpoint yang sudah ada: `/api/scratchpad`, `/api/scratchpad/titles`, `/api/scratchpad/{id}/backlinks`

---

## File Map

| File | Aksi | Tanggung Jawab |
|------|------|----------------|
| `static/index.html` | Modify | CSS dua panel (line ~726), komponen `NotePanel` baru (sebelum line 5926), state baru di `NotesPage`, JSX baru di `NotesPage` |

---

## Task 1: CSS + state shell + full JSX (layout, sort, collapsible tags, connectivity hints)

**Files:**
- Modify: `static/index.html` (CSS ~line 730, NotesPage state ~line 5934, return JSX ~line 6098)

- [ ] **Step 1: Tambah CSS dua panel**

Cari baris `.note-card { background: var(--bg-card); ...` (line 729). Sisipkan tepat SEBELUMNYA:

```css
.notes-layout { display: flex; gap: 0; height: calc(100vh - 120px); min-height: 400px; }
.notes-left { width: 340px; min-width: 260px; flex-shrink: 0; display: flex; flex-direction: column; overflow: hidden; border-right: 1px solid var(--border); padding-right: 0; }
.notes-left-inner { flex: 1; overflow-y: auto; padding: 0 12px 16px 0; }
.notes-right { flex: 1; overflow-y: auto; padding: 0 0 16px 20px; min-width: 0; }
.notes-panel-empty { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; color: var(--text-light); gap: 12px; }
.notes-panel-header { display: flex; align-items: center; gap: 8px; padding-bottom: 12px; border-bottom: 1px solid var(--border); margin-bottom: 14px; flex-shrink: 0; }
.notes-panel-title { font-size: 18px; font-weight: 700; color: var(--text-primary); flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.notes-nav-trail { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; font-size: 11px; color: var(--text-light); margin-bottom: 12px; }
.notes-nav-crumb { cursor: pointer; color: var(--accent); }
.notes-nav-crumb:hover { text-decoration: underline; }
.notes-section-label { font-size: 11px; font-weight: 700; color: var(--text-light); text-transform: uppercase; letter-spacing: 0.8px; margin: 16px 0 8px; }
.notes-link-item { display: flex; align-items: center; gap: 8px; padding: 7px 10px; border-radius: 8px; cursor: pointer; font-size: 13px; color: var(--text-primary); }
.notes-link-item:hover { background: var(--bg-primary); }
.note-conn { font-size: 10px; color: var(--text-light); margin-left: auto; flex-shrink: 0; white-space: nowrap; }
@media (max-width: 767px) {
  .notes-layout { display: block; height: auto; }
  .notes-left { width: 100%; border-right: none; overflow: visible; }
  .notes-left-inner { overflow: visible; padding: 0; }
  .notes-right { display: none; }
}
```

- [ ] **Step 2: Tambah state baru di `NotesPage`**

Cari baris `const [showModal, setShowModal] = useState(false);` (line ~5934). Tambahkan tepat SETELAHNYA:

```javascript
const [panelNote, setPanelNote]           = useState(null);
const [panelBacklinks, setPanelBacklinks] = useState([]);
const [panelOutlinks, setPanelOutlinks]   = useState([]);
const [navTrail, setNavTrail]             = useState([]);
const [noteTitles, setNoteTitles]         = useState([]);
const [tagsOpen, setTagsOpen]             = useState(true);
const [sortBy, setSortBy]                 = useState("updated");
```

- [ ] **Step 3: Tambah useEffect fetch `noteTitles` di NotesPage**

Cari baris `useEffect(() => { fetchNotes(); }, []);` (line ~5974). Tambahkan useEffect baru SETELAHNYA:

```javascript
useEffect(() => {
  api.get("/api/scratchpad/titles").then(setNoteTitles).catch(() => {});
}, []);
```

- [ ] **Step 4: Tambah useEffect fetch backlinks + outlinks saat `panelNote` berubah**

Letakkan tepat setelah useEffect fetch noteTitles dari Step 3:

```javascript
useEffect(() => {
  if (!panelNote?.id) { setPanelBacklinks([]); setPanelOutlinks([]); return; }
  api.get(`/api/scratchpad/${panelNote.id}/backlinks`).then(setPanelBacklinks).catch(() => {});
  const wikiTitles = [...new Set((panelNote.content || "").match(/\[\[([^\[\]]+)\]\]/g) || [])]
    .map(s => s.slice(2, -2).trim().toLowerCase());
  const outs = allNotes.filter(n => n.id !== panelNote.id && wikiTitles.includes((n.title || "").toLowerCase()));
  setPanelOutlinks(outs);
}, [panelNote?.id]);
```

- [ ] **Step 5: Ganti handler `openNote` event**

Cari seluruh blok useEffect yang berisi `window.addEventListener("openNote", handler)` (line ~5983–5996). **Ganti** dengan:

```javascript
useEffect(() => {
  const handler = async (e) => {
    const id = e.detail;
    let note = allNotes.find(n => n.id === id);
    if (!note) {
      try {
        const all = await api.get("/api/scratchpad");
        setAllNotes(all); setNotes(all);
        note = all.find(n => n.id === id);
      } catch {}
    }
    if (note) {
      setPanelNote(note);
      setNavTrail(t => [...t.slice(-7), note]);
    }
  };
  window.addEventListener("openNote", handler);
  return () => window.removeEventListener("openNote", handler);
}, [allNotes]);
```

- [ ] **Step 6: Ganti return JSX `NotesPage`**

Cari baris `return (` tepat sebelum `<div className="fade-in">` di NotesPage (line ~6098). **Ganti seluruh return block** (dari `return (` sampai `);` penutup sebelum `}` fungsi NotesPage, sekitar baris 6098–6191) dengan:

```jsx
const sortedNotes = [...notes].sort((a, b) => {
  if (sortBy === "alpha") return (a.title || "").localeCompare(b.title || "");
  if (sortBy === "created") return new Date(a.created_at) - new Date(b.created_at);
  if (sortBy === "links") return ((b.linked_to || []).length) - ((a.linked_to || []).length);
  return new Date(b.updated_at) - new Date(a.updated_at);
});

return (
  <div className="fade-in">
    <div className="notes-layout">

      {/* ── LEFT PANEL ── */}
      <div className="notes-left">
        {/* Header */}
        <div className="notes-panel-header">
          <h1 style={{ fontSize: 18, fontWeight: 700, margin: 0, flex: 1 }}>📝 Notes</h1>
          <select value={sortBy} onChange={e => setSortBy(e.target.value)}
            style={{ fontSize: 11, border: "1px solid var(--border)", borderRadius: 6, padding: "3px 6px", background: "var(--bg-primary)", color: "var(--text-secondary)", cursor: "pointer" }}>
            <option value="updated">Terbaru</option>
            <option value="created">Terlama</option>
            <option value="alpha">A–Z</option>
            <option value="links">Terbanyak link</option>
          </select>
          <button onClick={openNew}
            style={{ background: "var(--accent)", color: "#111", border: "none", borderRadius: 8, fontWeight: 700, fontSize: 14, cursor: "pointer", padding: "5px 12px", flexShrink: 0, lineHeight: 1 }}>
            ＋
          </button>
        </div>

        {/* Search */}
        <div className="scratchpad-bar" style={{ marginBottom: 8, marginRight: 0 }}>
          <span style={{ fontSize: 15, color: "var(--text-secondary)" }}>🔍</span>
          <input
            value={q}
            onChange={e => handleSearch(e.target.value)}
            placeholder="Cari catatan... atau ketik tag:nama"
          />
          {q && <button onClick={() => { setQ(""); setNotes(applyFilters("", activeTags, allNotes)); }}
            style={{ background: "none", border: "none", color: "var(--text-secondary)", cursor: "pointer", fontSize: 16 }}>✕</button>}
        </div>

        {/* Tag filter bar */}
        {allTags.length > 0 && (
          <div style={{ marginBottom: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: "var(--text-light)", textTransform: "uppercase", letterSpacing: "0.8px" }}>Tags</span>
              <button onClick={() => setTagsOpen(o => !o)}
                style={{ background: "none", border: "none", cursor: "pointer", fontSize: 11, color: "var(--text-light)", padding: 0, lineHeight: 1 }}>
                {tagsOpen ? "▲" : "▼"}
              </button>
              {activeTags.length > 0 && (
                <span onClick={() => { setActiveTags([]); setNotes(applyFilters(q, [], allNotes)); }}
                  style={{ fontSize: 11, color: "var(--text-secondary)", cursor: "pointer", padding: "1px 5px", marginLeft: "auto" }}>
                  ✕ reset
                </span>
              )}
            </div>
            {tagsOpen && (
              <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                {allTags.map(tag => {
                  const isActive = activeTags.includes(tag) || parseQuery(q).syntaxTags.includes(tag);
                  return (
                    <span key={tag} onClick={() => handleTagFilter(tag)} className="note-tag"
                      style={{ cursor: "pointer", fontSize: 11, background: isActive ? "var(--accent)" : "rgba(168,197,0,0.12)", color: isActive ? "#111" : "var(--accent)", fontWeight: isActive ? 700 : 600, transition: "all 0.15s" }}>
                      #{tag}
                    </span>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Note list */}
        <div className="notes-left-inner">
          {loading ? (
            <div style={{ color: "var(--text-secondary)", textAlign: "center", padding: 40 }}>Memuat...</div>
          ) : sortedNotes.length === 0 ? (
            <div style={{ color: "var(--text-secondary)", textAlign: "center", padding: 40, fontSize: 13 }}>
              {activeTags.length > 0
                ? `Tidak ada catatan dengan tag ${activeTags.map(t => "#" + t).join(" + ")}`
                : q ? "Tidak ada catatan yang cocok."
                : "Belum ada catatan. Tulis sesuatu!"}
            </div>
          ) : (
            sortedNotes.map(n => {
              const outCount = (n.linked_to || []).length;
              const inCount = allNotes.filter(m => m.id !== n.id && (m.linked_to || []).includes(n.id)).length;
              const isSelected = panelNote?.id === n.id;
              return (
                <div key={n.id} className="note-card"
                  onClick={() => { setPanelNote(n); setNavTrail([n]); }}
                  style={{ borderColor: isSelected ? "var(--accent)" : undefined, background: isSelected ? "rgba(168,197,0,0.06)" : undefined }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                    <div className="note-card-title">{n.title || n.content.slice(0, 60)}</div>
                    <span style={{ fontSize: 11, color: "var(--text-light)", flexShrink: 0 }}>{fmtDate(n.updated_at)}</span>
                  </div>
                  {n.title && <div className="note-card-preview" dangerouslySetInnerHTML={{ __html: n.content.slice(0, 200) }} />}
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6, alignItems: "center" }}>
                    {(n.tags || []).map(tag => (
                      <span key={tag} className="note-tag"
                        style={{ cursor: "pointer", fontSize: 11, background: activeTags.includes(tag) ? "var(--accent)" : undefined, color: activeTags.includes(tag) ? "#111" : undefined }}
                        onClick={e => { e.stopPropagation(); handleTagFilter(tag); }}>
                        #{tag}
                      </span>
                    ))}
                    {(n.linked_tasks || []).map(t => (
                      <span key={t.id} style={{ fontSize: 11, color: "var(--text-secondary)", background: "var(--bg-primary)", borderRadius: 6, padding: "2px 8px" }}>
                        📌 {t.title}
                      </span>
                    ))}
                    {(outCount > 0 || inCount > 0) && (
                      <span className="note-conn">
                        {outCount > 0 && `🔗${outCount}`}{outCount > 0 && inCount > 0 && " "}{inCount > 0 && `←${inCount}`}
                      </span>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* ── RIGHT PANEL ── */}
      <div className="notes-right">
        {!panelNote ? (
          <div className="notes-panel-empty">
            <span style={{ fontSize: 40, opacity: 0.3 }}>📝</span>
            <span style={{ fontSize: 13 }}>Pilih catatan untuk membaca</span>
            <button onClick={openNew} className="btn btn-secondary btn-sm">＋ Catatan Baru</button>
          </div>
        ) : (
          <NotePanel
            note={panelNote}
            allNotes={allNotes}
            noteTitles={noteTitles}
            backlinks={panelBacklinks}
            outlinks={panelOutlinks}
            navTrail={navTrail}
            onEdit={() => openEdit(panelNote)}
            onClose={() => { setPanelNote(null); setNavTrail([]); }}
            onNavigate={(n) => { setPanelNote(n); setNavTrail(t => [...t.slice(-7), n]); }}
            onTrailClick={(n) => {
              const idx = navTrail.findIndex(x => x.id === n.id);
              setPanelNote(n);
              setNavTrail(idx >= 0 ? navTrail.slice(0, idx + 1) : navTrail);
            }}
          />
        )}
      </div>

    </div>

    {/* Modal — edit only */}
    {showModal && (
      <NoteModal
        key={selected?.id}
        note={selected}
        tasks={tasks}
        onClose={() => { setShowModal(false); setSelected(null); }}
        onSave={handleSave}
        onDelete={handleDelete}
        onTaskClick={onTaskClick}
      />
    )}
  </div>
);
```

- [ ] **Step 7: Verifikasi di browser**

Buka halaman Notes:
- [ ] Layout dua kolom tampil di desktop (kiri 340px, kanan flex)
- [ ] Mobile: hanya kolom kiri terlihat
- [ ] Sort dropdown berfungsi (Terbaru / A-Z / dll)
- [ ] Tag collapsible berfungsi (▲/▼)
- [ ] Klik note card → kartu highlighted, panel kanan "Pilih catatan..." (NotePanel belum ada, error expected — lanjut ke Task 2)

- [ ] **Step 8: Commit**

```bash
git add static/index.html
git commit -m "feat: notes two-panel layout shell with sort, collapsible tags, connectivity hints"
```

---

## Task 2: Komponen `NotePanel` — preview, links, backlinks, nav trail

**Files:**
- Modify: `static/index.html` (tambah `NotePanel` tepat sebelum `function NotesPage`, line ~5926)

- [ ] **Step 1: Tambah komponen `NotePanel`**

Cari baris `function NotesPage({ tasks, showToast, onTaskClick }) {` (line 5926). Sisipkan kode berikut tepat SEBELUMNYA:

```jsx
function NotePanel({ note, allNotes, noteTitles, backlinks, outlinks, navTrail, onEdit, onClose, onNavigate, onTrailClick }) {
  const handlePreviewClick = (e) => {
    const el = e.target.closest("[data-wiki-title]");
    if (!el) return;
    const t = el.getAttribute("data-wiki-title");
    const found = allNotes.find(n => (n.title || "").toLowerCase() === t.toLowerCase());
    if (found) onNavigate(found);
  };

  const fmtDate = (s) => {
    if (!s) return "";
    const d = new Date(s);
    return d.toLocaleString("id-ID", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  };

  return (
    <div>
      {/* Nav trail — only when navigated through wikilinks */}
      {navTrail.length > 1 && (
        <div className="notes-nav-trail">
          {navTrail.map((n, i) => (
            <React.Fragment key={n.id}>
              {i > 0 && <span style={{ opacity: 0.4 }}>›</span>}
              <span
                className="notes-nav-crumb"
                style={{
                  fontWeight: i === navTrail.length - 1 ? 700 : 400,
                  color: i === navTrail.length - 1 ? "var(--text-secondary)" : undefined,
                  cursor: i === navTrail.length - 1 ? "default" : "pointer",
                }}
                onClick={() => { if (i < navTrail.length - 1) onTrailClick(n); }}
              >
                {n.title || "(tanpa judul)"}
              </span>
            </React.Fragment>
          ))}
        </div>
      )}

      {/* Header */}
      <div className="notes-panel-header">
        <div className="notes-panel-title">{note.title || "(tanpa judul)"}</div>
        <span style={{ fontSize: 11, color: "var(--text-light)", flexShrink: 0 }}>{fmtDate(note.updated_at)}</span>
        <button onClick={onEdit}
          style={{ background: "none", border: "1px solid var(--border)", borderRadius: 7, fontSize: 12, fontWeight: 600, color: "var(--accent)", cursor: "pointer", padding: "4px 10px", flexShrink: 0 }}>
          ✏ Edit
        </button>
        <button onClick={onClose}
          style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18, color: "var(--text-light)", padding: 0, lineHeight: 1, flexShrink: 0 }}>
          ✕
        </button>
      </div>

      {/* Tags */}
      {(note.tags || []).length > 0 && (
        <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 14 }}>
          {(note.tags || []).map(t => (
            <span key={t} className="note-tag" style={{ fontSize: 11 }}>#{t}</span>
          ))}
        </div>
      )}

      {/* Rendered content */}
      <div className="note-rendered"
        style={{ lineHeight: 1.75 }}
        onClick={handlePreviewClick}
        dangerouslySetInnerHTML={{
          __html: renderMarkdown(note.content || "", noteTitles.map(n => n.title)) ||
            '<span style="color:var(--text-light);font-style:italic">Catatan kosong.</span>'
        }}
      />

      {/* Outgoing links */}
      {outlinks.length > 0 && (
        <div>
          <div className="notes-section-label">🔗 Links keluar ({outlinks.length})</div>
          {outlinks.map(n => (
            <div key={n.id} className="notes-link-item" onClick={() => onNavigate(n)}>
              <span style={{ fontSize: 15 }}>📝</span>
              <span style={{ flex: 1, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {n.title || "(tanpa judul)"}
              </span>
              <span style={{ fontSize: 11, color: "var(--text-light)", flexShrink: 0 }}>{n.updated_at?.slice(0, 10)}</span>
            </div>
          ))}
        </div>
      )}

      {/* Backlinks */}
      {backlinks.length > 0 && (
        <div>
          <div className="notes-section-label">← Backlinks ({backlinks.length})</div>
          {backlinks.map(n => (
            <div key={n.id} className="notes-link-item" onClick={() => onNavigate(n)}>
              <span style={{ fontSize: 15 }}>📝</span>
              <span style={{ flex: 1, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {n.title || "(tanpa judul)"}
              </span>
              <span style={{ fontSize: 11, color: "var(--text-light)", flexShrink: 0 }}>{n.updated_at?.slice(0, 10)}</span>
            </div>
          ))}
        </div>
      )}

      {outlinks.length === 0 && backlinks.length === 0 && (
        <div style={{ fontSize: 12, color: "var(--text-light)", marginTop: 24, textAlign: "center" }}>
          Catatan ini belum terhubung ke catatan lain.
        </div>
      )}
    </div>
  );
}

```

- [ ] **Step 2: Verifikasi di browser**

Buka halaman Notes, lakukan:
- [ ] Klik note card → panel kanan tampilkan judul + konten ter-render dengan markdown
- [ ] `[[wikilink]]` di konten → klik → navigasi ke note target di panel kanan (tanpa modal)
- [ ] Nav trail muncul setelah navigasi wikilink (breadcrumb "Note A › Note B")
- [ ] Klik crumb di trail → kembali ke note sebelumnya, trail dipangkas
- [ ] ✏ Edit → NoteModal terbuka, bisa edit dan simpan
- [ ] Setelah simpan note → `panelNote` masih aktif, list di kiri refresh (karena `noteSaved` event)
- [ ] ✕ Tutup → panel kanan kembali ke placeholder
- [ ] Jika note punya `[[link]]` yang valid → "🔗 Links keluar" tampil di bawah konten
- [ ] Jika note punya backlinks → "← Backlinks" tampil di bawah konten
- [ ] Connectivity hints `🔗N ←N` tampil di kartu yang punya koneksi

- [ ] **Step 3: Fix `panelNote` stale setelah edit**

Setelah save di NoteModal, `panelNote` masih menyimpan data lama. Tambahkan satu useEffect di `NotesPage` untuk sync panelNote saat `allNotes` berubah:

Cari blok `useEffect(() => {` yang berisi fetch `noteTitles` (Step 3 Task 1). Tambahkan useEffect BARU setelahnya:

```javascript
useEffect(() => {
  if (panelNote?.id) {
    const fresh = allNotes.find(n => n.id === panelNote.id);
    if (fresh) setPanelNote(fresh);
  }
}, [allNotes]);
```

- [ ] **Step 4: Verifikasi sync setelah edit**

1. Buka note di panel kanan
2. Klik ✏ Edit → ubah judul/konten → Simpan
3. Panel kanan harus langsung menampilkan konten terbaru (judul baru, konten baru)

- [ ] **Step 5: Commit + push**

```bash
git add static/index.html
git commit -m "feat: NotePanel with preview, wikilink nav, links/backlinks, nav trail, connectivity hints"
git push origin main
```

---

## Catatan Deploy

```bash
git pull origin main
# Tidak ada perubahan backend — tidak perlu restart service
# Frontend: hard-refresh browser (Ctrl+Shift+R)
```
