# Note Templates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tambahkan fitur template catatan — user pilih template dari dropdown di toolbar editor (paling kiri, sebelum H), hanya aktif saat konten kosong, dikelola di page Akun.

**Architecture:** Backend menyimpan template per-user di tabel `note_templates`; GET auto-seed 9 default template jika user belum punya; `NoteToolbar` fetch + render dropdown; 3 tempat pemakaian NoteToolbar menerima prop `content` + `onApplyTemplate`.

**Tech Stack:** FastAPI + SQLite (backend), React JSX pre-compiled (frontend, single file `static/index.html`), Service Worker cache bump wajib tiap ubah `index.html`.

---

## File Map

| File | Perubahan |
|---|---|
| `webapp.py` | Migration tabel, Pydantic models, 4 endpoints baru |
| `static/index.html` | NoteToolbar (props + dropdown), 3 call sites, NoteTemplatesSettings di SettingsPage |
| `static/sw.js` | Bump cache v80 → v81 |

---

## Task 1: Backend — Migrasi Tabel `note_templates`

**Files:** Modify `webapp.py`

- [ ] **Tambahkan migration block** di akhir fungsi `migrate_db()` (setelah blok messages.note_id, sekitar baris 230):

```python
    # Create note_templates table
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS note_templates (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id     INTEGER NOT NULL,
                name        TEXT NOT NULL,
                group_name  TEXT NOT NULL,
                content     TEXT NOT NULL,
                is_default  INTEGER NOT NULL DEFAULT 0,
                sort_order  INTEGER NOT NULL DEFAULT 0,
                created_at  TEXT NOT NULL,
                updated_at  TEXT NOT NULL
            )
        """)
        conn.commit()
    finally:
        conn.close()
```

- [ ] **Tambahkan Pydantic models** setelah class `MindmapShareReq` (cari `class MindmapShareReq`):

```python
class NoteTemplateCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    group_name: str = Field(min_length=1, max_length=100)
    content: str = Field(min_length=1)

class NoteTemplateUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=100)
    group_name: Optional[str] = Field(default=None, min_length=1, max_length=100)
    content: Optional[str] = None
```

- [ ] **Tambahkan konstanta default templates** tepat sebelum endpoint `GET /api/note-templates` (tambahkan di bawah Pydantic models):

```python
_DEFAULT_NOTE_TEMPLATES = [
    {
        "group_name": "Umum & Penangkapan Cepat",
        "name": "Catatan Cepat",
        "sort_order": 0,
        "content": "# Catatan Cepat\n\n## Inti Pikiran\n- \n\n## Detail\n- \n\n## Tindakan Selanjutnya\n- [ ] ",
    },
    {
        "group_name": "Umum & Penangkapan Cepat",
        "name": "Curah Pikiran",
        "sort_order": 1,
        "content": "# Curah Pikiran\n\n## Apa yang Sedang Saya Pikirkan\n- ",
    },
    {
        "group_name": "Pekerjaan & Proyek",
        "name": "Log Harian",
        "sort_order": 0,
        "content": "# Log Harian - [Tanggal]\n\n## Fokus Hari Ini\n- \n\n## Progress\n- \n\n## Hambatan\n- \n\n## Besok\n- ",
    },
    {
        "group_name": "Pekerjaan & Proyek",
        "name": "Catatan Rapat",
        "sort_order": 1,
        "content": "# Judul Rapat\n\n**Tanggal:**  \n**Peserta:**  \n\n## Agenda\n- \n\n## Diskusi\n- \n\n## Keputusan\n- \n\n## Tindak Lanjut\n- [ ] ",
    },
    {
        "group_name": "Pekerjaan & Proyek",
        "name": "Perencanaan Proyek",
        "sort_order": 2,
        "content": "# Nama Proyek\n\n## Tujuan\n- \n\n## Ruang Lingkup\n- \n\n## Timeline & Milestone\n- \n\n## Tugas\n- [ ] ",
    },
    {
        "group_name": "Pekerjaan & Proyek",
        "name": "Pemecahan Masalah",
        "sort_order": 3,
        "content": "# Masalah / Isu\n\n## Kondisi Saat Ini\n- \n\n## Akar Penyebab\n- \n\n## Dampak\n- \n\n## Solusi\n- \n\n## Tindakan Lanjutan\n- [ ] ",
    },
    {
        "group_name": "Pekerjaan & Proyek",
        "name": "Pengambilan Keputusan",
        "sort_order": 4,
        "content": "# Topik Keputusan\n\n## Opsi\n- \n\n## Kelebihan & Kekurangan\n- **Opsi A:** (+)... (-) ...\n- **Opsi B:** (+)... (-) ...\n\n## Keputusan Akhir\n- ",
    },
    {
        "group_name": "Evaluasi & Pembelajaran",
        "name": "Tinjauan Mingguan",
        "sort_order": 0,
        "content": "# Tinjauan Mingguan\n\n## Pencapaian\n- \n\n## Kegagalan / Tantangan\n- \n\n## Pelajaran yang Dipetik\n- \n\n## Fokus Minggu Depan\n- ",
    },
    {
        "group_name": "Evaluasi & Pembelajaran",
        "name": "Catatan Pembelajaran",
        "sort_order": 1,
        "content": "# Topik\n\n**Sumber:**  \n\n## Insight Utama\n- \n\n## Kutipan Penting\n> \n\n## Hal yang Dapat Diterapkan\n- ",
    },
]
```

- [ ] **Commit:**
```bash
git add webapp.py
git commit -m "feat: add note_templates table migration and Pydantic models"
```

---

## Task 2: Backend — GET /api/note-templates dengan auto-seed

**Files:** Modify `webapp.py`

- [ ] **Tambahkan endpoint GET** setelah konstanta `_DEFAULT_NOTE_TEMPLATES`:

```python
@app.get("/api/note-templates")
async def list_note_templates(user=Depends(get_current_user)):
    uid = user["sub"]
    now = datetime.now(_TZ_JKT).isoformat()
    with get_db() as conn:
        rows = conn.execute(
            "SELECT id, name, group_name, content, is_default, sort_order FROM note_templates "
            "WHERE user_id = ? ORDER BY group_name, sort_order, name",
            (uid,)
        ).fetchall()
        if not rows:
            # Seed default templates
            for t in _DEFAULT_NOTE_TEMPLATES:
                conn.execute(
                    "INSERT INTO note_templates (user_id, name, group_name, content, is_default, sort_order, created_at, updated_at) "
                    "VALUES (?, ?, ?, ?, 1, ?, ?, ?)",
                    (uid, t["name"], t["group_name"], t["content"], t["sort_order"], now, now)
                )
            conn.commit()
            rows = conn.execute(
                "SELECT id, name, group_name, content, is_default, sort_order FROM note_templates "
                "WHERE user_id = ? ORDER BY group_name, sort_order, name",
                (uid,)
            ).fetchall()
        return [dict(r) for r in rows]
```

- [ ] **Test via curl** (ganti TOKEN dengan token login kamu):
```bash
curl -H "Authorization: Bearer TOKEN" https://todo.yatno.web.id/api/note-templates
```
Expected: JSON array dengan 9 template default.

- [ ] **Commit:**
```bash
git add webapp.py
git commit -m "feat: GET /api/note-templates with auto-seed 9 default templates"
```

---

## Task 3: Backend — POST / PUT / DELETE /api/note-templates

**Files:** Modify `webapp.py`

- [ ] **Tambahkan 3 endpoint** tepat setelah GET:

```python
@app.post("/api/note-templates")
async def create_note_template(req: NoteTemplateCreate, user=Depends(get_current_user)):
    uid = user["sub"]
    now = datetime.now(_TZ_JKT).isoformat()
    with get_db() as conn:
        max_order = conn.execute(
            "SELECT COALESCE(MAX(sort_order), -1) FROM note_templates WHERE user_id = ? AND group_name = ?",
            (uid, req.group_name)
        ).fetchone()[0]
        cur = conn.execute(
            "INSERT INTO note_templates (user_id, name, group_name, content, is_default, sort_order, created_at, updated_at) "
            "VALUES (?, ?, ?, ?, 0, ?, ?, ?)",
            (uid, req.name, req.group_name, req.content, max_order + 1, now, now)
        )
        row = conn.execute(
            "SELECT id, name, group_name, content, is_default, sort_order FROM note_templates WHERE id = ?",
            (cur.lastrowid,)
        ).fetchone()
        return dict(row)


@app.put("/api/note-templates/{tid}")
async def update_note_template(tid: int, req: NoteTemplateUpdate, user=Depends(get_current_user)):
    uid = user["sub"]
    now = datetime.now(_TZ_JKT).isoformat()
    with get_db() as conn:
        row = conn.execute(
            "SELECT id, name, group_name, content FROM note_templates WHERE id = ? AND user_id = ?",
            (tid, uid)
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Template tidak ditemukan")
        new_name    = req.name       if req.name       is not None else row["name"]
        new_group   = req.group_name if req.group_name is not None else row["group_name"]
        new_content = req.content    if req.content    is not None else row["content"]
        conn.execute(
            "UPDATE note_templates SET name=?, group_name=?, content=?, updated_at=? WHERE id=?",
            (new_name, new_group, new_content, now, tid)
        )
        updated = conn.execute(
            "SELECT id, name, group_name, content, is_default, sort_order FROM note_templates WHERE id=?",
            (tid,)
        ).fetchone()
        return dict(updated)


@app.delete("/api/note-templates/{tid}")
async def delete_note_template(tid: int, user=Depends(get_current_user)):
    uid = user["sub"]
    with get_db() as conn:
        if not conn.execute(
            "SELECT id FROM note_templates WHERE id = ? AND user_id = ?", (tid, uid)
        ).fetchone():
            raise HTTPException(status_code=404, detail="Template tidak ditemukan")
        conn.execute("DELETE FROM note_templates WHERE id = ?", (tid,))
    return {"ok": True}
```

- [ ] **Commit + push** (trigger deploy agar tabel terbentuk di VPS):
```bash
git add webapp.py
git commit -m "feat: POST/PUT/DELETE /api/note-templates endpoints"
git push
```

---

## Task 4: Frontend — NoteToolbar template button + dropdown

**Files:** Modify `static/index.html`

Cari `function NoteToolbar({ milkdownEditorRef, noteId, onAttachUploaded })` (sekitar baris 7708).

- [ ] **Ubah signature NoteToolbar** — tambah 2 prop baru:

```javascript
function NoteToolbar({ milkdownEditorRef, noteId, onAttachUploaded, content = "", onApplyTemplate }) {
```

- [ ] **Tambahkan state + ref + fetch** di dalam NoteToolbar, tepat setelah deklarasi `uploading` state (setelah baris `const [uploading, setUploading] = React.useState(false);`):

```javascript
  const [templates, setTemplates] = React.useState([]);
  const [tplOpen, setTplOpen] = React.useState(false);
  const tplRef = React.useRef(null);
  const isEmpty = !content || !content.trim();

  React.useEffect(() => {
    api.get("/api/note-templates").then(setTemplates).catch(() => {});
  }, []);

  React.useEffect(() => {
    if (!tplOpen) return;
    const close = (e) => { if (tplRef.current && !tplRef.current.contains(e.target)) setTplOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [tplOpen]);
```

- [ ] **Tambahkan helper** untuk mengelompokkan template by group, tepat setelah `useEffect` di atas:

```javascript
  const templateGroups = React.useMemo(() => {
    const map = {};
    for (const t of templates) {
      if (!map[t.group_name]) map[t.group_name] = [];
      map[t.group_name].push(t);
    }
    return Object.entries(map);
  }, [templates]);
```

- [ ] **Tambahkan template button** sebagai elemen pertama di dalam `return (<div className="note-toolbar">`, sebelum `{/* Heading dropdown */}`:

```jsx
          {/* Template dropdown */}
          {onApplyTemplate && (
            <div ref={tplRef} style={{ position: "relative", flexShrink: 0 }}>
              <button
                onMouseDown={e => { e.preventDefault(); if (isEmpty) setTplOpen(o => !o); }}
                title={isEmpty ? "Pilih template" : "Template tidak tersedia — konten sudah ada"}
                style={{
                  opacity: isEmpty ? 1 : 0.35,
                  cursor: isEmpty ? "pointer" : "not-allowed",
                  color: isEmpty ? "var(--accent)" : "var(--text-light)",
                  borderColor: isEmpty ? "var(--accent)" : "var(--border)",
                }}
              >
                📋 Template ▾
              </button>
              {tplOpen && templateGroups.length > 0 && (
                <div style={{
                  position: "absolute", top: "calc(100% + 4px)", left: 0, zIndex: 300,
                  background: "var(--bg-card)", border: "1px solid var(--border)",
                  borderRadius: 12, boxShadow: "0 8px 24px rgba(0,0,0,0.15)",
                  minWidth: 220, maxWidth: 280, overflow: "hidden",
                }}>
                  {templateGroups.map(([group, items], gi) => (
                    <React.Fragment key={group}>
                      {gi > 0 && <div style={{ height: 1, background: "var(--border)", margin: "4px 0" }} />}
                      <div style={{ padding: "6px 14px 3px", fontSize: 9, fontWeight: 700, color: "var(--text-light)", textTransform: "uppercase", letterSpacing: "0.8px" }}>
                        {group}
                      </div>
                      {items.map(t => (
                        <div key={t.id}
                          onMouseDown={e => {
                            e.preventDefault();
                            onApplyTemplate(t.content);
                            setTplOpen(false);
                          }}
                          style={{ padding: "7px 14px", fontSize: 13, cursor: "pointer", color: "var(--text-primary)" }}
                          onMouseEnter={e => e.currentTarget.style.background = "var(--bg-primary)"}
                          onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                        >
                          {t.name}
                        </div>
                      ))}
                    </React.Fragment>
                  ))}
                  <div style={{ height: 1, background: "var(--border)", margin: "4px 0" }} />
                  <div
                    onMouseDown={e => {
                      e.preventDefault();
                      setTplOpen(false);
                      window.dispatchEvent(new CustomEvent("openSettings"));
                    }}
                    style={{ padding: "8px 14px", fontSize: 12, cursor: "pointer", color: "var(--accent)", fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}
                    onMouseEnter={e => e.currentTarget.style.background = "var(--bg-primary)"}
                    onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                  >
                    ⚙️ Kelola Template...
                  </div>
                </div>
              )}
            </div>
          )}
          {onApplyTemplate && <div className="sep" />}
```

- [ ] **Tambahkan listener `openSettings`** di App component. Cari `const [selectedTask, setSelectedTask] = useState(null);` (sekitar baris 11200), lalu tambahkan `useEffect` di bawahnya:

```javascript
      useEffect(() => {
        const handler = () => setPage("settings");
        window.addEventListener("openSettings", handler);
        return () => window.removeEventListener("openSettings", handler);
      }, []);
```

- [ ] **Bump SW cache** di `static/sw.js`:
```javascript
const CACHE = "taskflow-v81-note-templates";
```

- [ ] **Commit:**
```bash
git add static/index.html static/sw.js
git commit -m "feat: NoteToolbar template dropdown — leftmost position, groups, footer link"
```

---

## Task 5: Frontend — Wire up `content` + `onApplyTemplate` di 3 tempat

**Files:** Modify `static/index.html`

### 5a — NoteModal (regular view, baris ~8665)

Cari:
```jsx
<NoteToolbar milkdownEditorRef={milkdownEditorRef} noteId={savedNoteId} onAttachUploaded={att => setAttachments(prev => [...prev, att])} />
```
Ganti dengan:
```jsx
<NoteToolbar
  milkdownEditorRef={milkdownEditorRef}
  noteId={savedNoteId}
  onAttachUploaded={att => setAttachments(prev => [...prev, att])}
  content={content}
  onApplyTemplate={(tpl) => {
    milkdownEditorRef.current?.action(window.MilkdownBundle.replaceAll(tpl));
    setContent(tpl);
  }}
/>
```

### 5b — NoteModal fullscreen (baris ~9040)

Cari (hanya ada satu NoteToolbar lain di NoteModal):
```jsx
<NoteToolbar milkdownEditorRef={milkdownEditorRef} noteId={savedNoteId} onAttachUploaded={att => setAttachments(prev => [...prev, att])} />
```
Ganti dengan:
```jsx
<NoteToolbar
  milkdownEditorRef={milkdownEditorRef}
  noteId={savedNoteId}
  onAttachUploaded={att => setAttachments(prev => [...prev, att])}
  content={content}
  onApplyTemplate={(tpl) => {
    milkdownEditorRef.current?.action(window.MilkdownBundle.replaceAll(tpl));
    setContent(tpl);
  }}
/>
```

### 5c — TaskFormModal tab Note (baris ~2795)

Cari:
```jsx
<NoteToolbar milkdownEditorRef={noteMilkdownRef} noteId={null} onAttachUploaded={() => {}} />
```
Ganti dengan:
```jsx
<NoteToolbar
  milkdownEditorRef={noteMilkdownRef}
  noteId={null}
  onAttachUploaded={() => {}}
  content={noteForm.content}
  onApplyTemplate={(tpl) => {
    noteMilkdownRef.current?.action(window.MilkdownBundle.replaceAll(tpl));
    setNote("content", tpl);
  }}
/>
```

- [ ] **Commit:**
```bash
git add static/index.html
git commit -m "feat: wire content + onApplyTemplate to NoteToolbar in all 3 places"
```

---

## Task 6: Frontend — NoteTemplatesSettings di Page Akun

**Files:** Modify `static/index.html`

Cari `function SettingsPage({ user, onUsernameChange, showToast })` (baris ~7381).

- [ ] **Tambahkan komponen `NoteTemplatesSettings`** tepat SEBELUM `function SettingsPage`:

```jsx
    function NoteTemplatesSettings({ showToast }) {
      const [templates, setTemplates] = React.useState([]);
      const [loading, setLoading] = React.useState(true);
      const [form, setForm] = React.useState(null); // null = closed, {} = new, {id,...} = edit
      const [deleteId, setDeleteId] = React.useState(null);

      const load = () => {
        setLoading(true);
        api.get("/api/note-templates").then(d => { setTemplates(d); setLoading(false); }).catch(() => setLoading(false));
      };
      React.useEffect(() => { load(); }, []);

      const groups = React.useMemo(() => {
        const map = {};
        for (const t of templates) {
          if (!map[t.group_name]) map[t.group_name] = [];
          map[t.group_name].push(t);
        }
        return Object.entries(map);
      }, [templates]);

      const existingGroups = [...new Set(templates.map(t => t.group_name))];

      const handleSave = async () => {
        if (!form?.name?.trim() || !form?.group_name?.trim() || !form?.content?.trim()) {
          showToast("Nama, grup, dan konten wajib diisi", "error"); return;
        }
        try {
          if (form.id) {
            await api.put(`/api/note-templates/${form.id}`, { name: form.name, group_name: form.group_name, content: form.content });
          } else {
            await api.post("/api/note-templates", { name: form.name, group_name: form.group_name, content: form.content });
          }
          showToast("✅ Template disimpan");
          setForm(null);
          load();
        } catch (e) { showToast(e.message || "Gagal menyimpan", "error"); }
      };

      const handleDelete = async (id) => {
        try {
          await api.delete(`/api/note-templates/${id}`);
          showToast("Template dihapus");
          setDeleteId(null);
          load();
        } catch (e) { showToast(e.message || "Gagal menghapus", "error"); }
      };

      const inputStyle = { width: "100%", padding: "7px 10px", fontSize: 13, border: "1px solid var(--border)", borderRadius: 8, background: "var(--bg-primary)", color: "var(--text-primary)", outline: "none", boxSizing: "border-box" };

      return (
        <div style={{ marginTop: 32, borderTop: "1px solid var(--border)", paddingTop: 24 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: 15 }}>📋 Template Catatan</div>
              <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 2 }}>Template muncul di toolbar editor saat catatan masih kosong</div>
            </div>
            <button className="btn btn-primary btn-sm" onClick={() => setForm({ name: "", group_name: existingGroups[0] || "", content: "" })}>＋ Tambah</button>
          </div>

          {loading && <div style={{ color: "var(--text-light)", fontSize: 13 }}>Memuat...</div>}

          {groups.map(([group, items]) => (
            <div key={group} style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: "var(--text-light)", textTransform: "uppercase", letterSpacing: "0.8px", marginBottom: 6 }}>{group}</div>
              <div style={{ border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden" }}>
                {items.map((t, i) => (
                  <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderBottom: i < items.length - 1 ? "1px solid var(--border)" : "none" }}>
                    <span style={{ flex: 1, fontWeight: 600, fontSize: 13 }}>{t.name}</span>
                    <span style={{ fontSize: 10, color: t.is_default ? "var(--text-light)" : "var(--accent)", background: t.is_default ? "var(--bg-primary)" : "rgba(182,212,0,0.1)", padding: "1px 7px", borderRadius: 10, fontWeight: 600 }}>
                      {t.is_default ? "default" : "custom"}
                    </span>
                    <button className="btn btn-secondary btn-sm" onClick={() => setForm({ id: t.id, name: t.name, group_name: t.group_name, content: t.content })} style={{ fontSize: 11 }}>✏️ Edit</button>
                    {deleteId === t.id ? (
                      <div style={{ display: "flex", gap: 4 }}>
                        <button onClick={() => handleDelete(t.id)} style={{ padding: "3px 8px", borderRadius: 6, border: "none", background: "#ef4444", color: "#fff", fontSize: 11, cursor: "pointer" }}>Hapus</button>
                        <button className="btn btn-secondary btn-sm" onClick={() => setDeleteId(null)} style={{ fontSize: 11 }}>Batal</button>
                      </div>
                    ) : (
                      <button onClick={() => setDeleteId(t.id)} style={{ padding: "3px 8px", borderRadius: 6, border: "1px solid #fecaca", background: "none", color: "#ef4444", fontSize: 11, cursor: "pointer" }}>🗑</button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}

          {form !== null && (
            <div style={{ border: "1px solid var(--border)", borderRadius: 10, padding: 16, marginTop: 8, background: "var(--bg-primary)" }}>
              <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 12 }}>{form.id ? "Edit Template" : "Tambah Template Baru"}</div>
              <div style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 11, color: "var(--text-secondary)", marginBottom: 4 }}>Nama Template</div>
                <input style={inputStyle} value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Catatan Rapat" />
              </div>
              <div style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 11, color: "var(--text-secondary)", marginBottom: 4 }}>Grup</div>
                <input style={inputStyle} value={form.group_name} onChange={e => setForm(f => ({ ...f, group_name: e.target.value }))} placeholder="Pekerjaan & Proyek" list="tpl-groups" />
                <datalist id="tpl-groups">{existingGroups.map(g => <option key={g} value={g} />)}</datalist>
              </div>
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 11, color: "var(--text-secondary)", marginBottom: 4 }}>Konten (Markdown)</div>
                <textarea style={{ ...inputStyle, minHeight: 120, resize: "vertical", fontFamily: "monospace", fontSize: 12, lineHeight: 1.6 }}
                  value={form.content} onChange={e => setForm(f => ({ ...f, content: e.target.value }))} placeholder="# Judul&#10;## Bagian&#10;- " />
              </div>
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                <button className="btn btn-secondary btn-sm" onClick={() => setForm(null)}>Batal</button>
                <button className="btn btn-primary btn-sm" onClick={handleSave}>Simpan</button>
              </div>
            </div>
          )}
        </div>
      );
    }
```

- [ ] **Render `NoteTemplatesSettings`** di dalam `SettingsPage`. Cari penutup `</div>` paling akhir sebelum closing tag komponen SettingsPage, tambahkan tepat sebelumnya:

```jsx
        <NoteTemplatesSettings showToast={showToast} />
```

*(Cari akhir SettingsPage dengan grep: `grep -n "function SettingsPage" static/index.html` lalu baca sampai penutup function — tambahkan `<NoteTemplatesSettings showToast={showToast} />` sebelum return statement ditutup)*

- [ ] **Commit:**
```bash
git add static/index.html
git commit -m "feat: NoteTemplatesSettings section in SettingsPage — list, add, edit, delete"
```

---

## Task 7: Final commit + push

- [ ] **Verifikasi SW cache** sudah di-bump ke `taskflow-v81-note-templates` di `static/sw.js`

- [ ] **Push ke GitHub** untuk trigger deploy:
```bash
git push
```

- [ ] **Verifikasi setelah deploy:**
  1. Buka app, hard refresh (`Ctrl+Shift+R`)
  2. Buka Notes & Draw → buat note baru → toolbar harus tampilkan `📋 Template ▾` di paling kiri
  3. Klik template → konten terisi di editor
  4. Isi konten → tombol template jadi abu-abu (disabled)
  5. Buka TaskFormModal → tab Note → sama, template tersedia saat kosong
  6. Buka Akun → scroll ke bawah → section "📋 Template Catatan" tampil
  7. Tambah template baru → muncul di dropdown
  8. Klik "⚙️ Kelola Template..." di dropdown → navigate ke page Akun

---

## Checklist Spec Coverage

- [x] Tabel `note_templates` dengan semua kolom (+ `is_default`)
- [x] GET auto-seed 9 default template jika kosong
- [x] POST/PUT/DELETE endpoints, owner-only
- [x] NoteToolbar: button `📋 Template ▾` paling kiri
- [x] Disabled saat content tidak kosong
- [x] Dropdown: grup + divider + footer "⚙️ Kelola Template..."
- [x] 3 tempat call site: NoteModal, NoteModal fullscreen, TaskFormModal
- [x] SettingsPage: list per grup, badge default/custom, edit, delete, tambah
- [x] Offline: tidak ada perubahan SW (GET /api/* otomatis di-cache)
- [x] SW cache bump v81
