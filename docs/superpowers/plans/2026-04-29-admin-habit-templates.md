# Admin Page — Habit Templates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tambah admin page untuk CRUD management habit_templates, pindahkan data dari HABIT_DATABANK JS constant ke database, dan serve via API dengan SW cache untuk offline support.

**Architecture:** `habit_templates` table di SQLite di-seed dari `habits_tasks_1000.json`. GoalTab fetch dari `/api/habit-templates` (menggantikan HABIT_DATABANK embedded 207KB). AdminPage component dengan tabel, filter, pagination, CRUD modal, dan user management. SW cache network-first untuk API tersebut.

**Tech Stack:** FastAPI, SQLite, React (Babel in-browser), `api.get/post/put/del` client, Service Worker.

---

## Files

| File | Action |
|------|--------|
| `repository.py` | Modify — add `habit_templates` table + `is_admin` migration + seed |
| `webapp.py` | Modify — `get_admin_user`, `HabitTemplateCreate/Update`, `get_me`, 6 endpoints |
| `static/sw.js` | Modify — bump cache, add `/api/habit-templates` network-first handler |
| `static/index.html` | Modify — remove HABIT_DATABANK, update GoalTab, add AdminPage, update Sidebar + App |

---

### Task 1: Repository — habit_templates table + is_admin migration + seed

**Files:**
- Modify: `repository.py`

- [ ] **Step 1: Add `is_admin` migration to users table**

In `repository.py`, find the migrations section (after all CREATE TABLE blocks, look for `ALTER TABLE` patterns). Add after existing migrations:

```python
            # Migrate: add is_admin to users if missing
            user_cols = [r["name"] for r in conn.execute("PRAGMA table_info(users)").fetchall()]
            if "is_admin" not in user_cols:
                conn.execute("ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0")
```

- [ ] **Step 2: Add `habit_templates` CREATE TABLE**

In `repository.py`, find the `CREATE TABLE IF NOT EXISTS drawings` block (added earlier). After it, add:

```python
            conn.execute("""
                CREATE TABLE IF NOT EXISTS habit_templates (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    kategori TEXT NOT NULL,
                    subkategori TEXT NOT NULL,
                    type TEXT NOT NULL CHECK(type IN ('habit','task')),
                    item TEXT NOT NULL,
                    frequency TEXT NOT NULL CHECK(frequency IN ('daily','monthly')),
                    priority TEXT NOT NULL CHECK(priority IN ('low','medium','high')),
                    difficulty TEXT NOT NULL CHECK(difficulty IN ('easy','medium','hard')),
                    tags TEXT NOT NULL DEFAULT '[]'
                )
            """)
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_habit_templates_kat ON habit_templates(kategori, subkategori)"
            )
```

- [ ] **Step 3: Verify tables exist**

```bash
cd "Z:\Todolist Manager V5.0"
python3 -c "
from repository import TaskRepository
from config import DB_PATH
TaskRepository(DB_PATH)
import sqlite3
conn = sqlite3.connect(DB_PATH)
conn.row_factory = sqlite3.Row
tables = conn.execute(\"SELECT name FROM sqlite_master WHERE type='table' AND name IN ('habit_templates')\").fetchall()
print('Tables:', [t['name'] for t in tables])
cols = [r['name'] for r in conn.execute('PRAGMA table_info(users)').fetchall()]
print('is_admin in users:', 'is_admin' in cols)
"
```

Expected:
```
Tables: ['habit_templates']
is_admin in users: True
```

- [ ] **Step 4: Commit**

```bash
git add repository.py
git commit -m "feat: add habit_templates table and is_admin migration"
```

---

### Task 2: webapp.py — models, get_admin_user, get_me update, seed function

**Files:**
- Modify: `webapp.py`

- [ ] **Step 1: Add HabitTemplateCreate and HabitTemplateUpdate Pydantic models**

Find `class DrawingUpsert(BaseModel):` in webapp.py. Before it, add:

```python
class HabitTemplateCreate(BaseModel):
    kategori: str
    subkategori: str
    type: Literal["habit", "task"]
    item: str
    frequency: Literal["daily", "monthly"]
    priority: Literal["low", "medium", "high"]
    difficulty: Literal["easy", "medium", "hard"]
    tags: list[str] = []

class HabitTemplateUpdate(BaseModel):
    kategori: str
    subkategori: str
    type: Literal["habit", "task"]
    item: str
    frequency: Literal["daily", "monthly"]
    priority: Literal["low", "medium", "high"]
    difficulty: Literal["easy", "medium", "hard"]
    tags: list[str] = []
```

Check that `Literal` is imported — find `from typing import` line and add `Literal` if missing:
```bash
grep -n "from typing import" webapp.py | head -3
```

If `Literal` is not there, add it to the imports.

- [ ] **Step 2: Add get_admin_user dependency**

Find `async def get_current_user(request: Request) -> dict:` in webapp.py. After the closing of that function, add:

```python
async def get_admin_user(user: dict = Depends(get_current_user)) -> dict:
    with get_db() as conn:
        row = conn.execute("SELECT is_admin FROM users WHERE id = ?", (user["sub"],)).fetchone()
        if not row or not row["is_admin"]:
            raise HTTPException(status_code=403, detail="Admin access required")
    return {**user, "is_admin": 1}
```

- [ ] **Step 3: Update get_me to include is_admin**

Find `async def get_me(user=Depends(get_current_user)):`. The query currently selects:
```python
"SELECT id, username, display_name, created_at, telegram_id FROM users WHERE id = ?"
```

Change to:
```python
"SELECT id, username, display_name, created_at, telegram_id, is_admin FROM users WHERE id = ?"
```

- [ ] **Step 4: Add seed_habit_templates function**

Find the startup section in webapp.py (look for `@app.on_event("startup")` or the section after `TaskRepository(DB_PATH)`). Add this function before or after seed call:

```python
def seed_habit_templates():
    """Seed habit_templates from JSON if table is empty."""
    import os
    json_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'habits_tasks_1000.json')
    if not os.path.exists(json_path):
        return
    with get_db() as conn:
        count = conn.execute("SELECT COUNT(*) FROM habit_templates").fetchone()[0]
        if count > 0:
            return
        with open(json_path, encoding='utf-8') as f:
            items = json.load(f)
        for item in items:
            conn.execute(
                """INSERT OR IGNORE INTO habit_templates
                   (kategori, subkategori, type, item, frequency, priority, difficulty, tags)
                   VALUES (?,?,?,?,?,?,?,?)""",
                (item['kategori'], item['subkategori'], item['type'], item['item'],
                 item['frequency'], item['priority'], item['difficulty'],
                 json.dumps(item.get('tags', [])))
            )
        conn.commit()
```

Find where `TaskRepository(DB_PATH)` is called at startup and add `seed_habit_templates()` right after:
```python
TaskRepository(DB_PATH)
seed_habit_templates()
```

- [ ] **Step 5: Verify Python syntax**

```bash
cd "Z:\Todolist Manager V5.0"
python3 -c "import webapp; print('OK')"
```

Expected: `OK`

- [ ] **Step 6: Commit**

```bash
git add webapp.py
git commit -m "feat: add HabitTemplate models, get_admin_user, update get_me, seed function"
```

---

### Task 3: webapp.py — 6 API endpoints

**Files:**
- Modify: `webapp.py`

Add all 6 endpoints. Find `@app.get("/api/drawings/{note_id}")` and insert BEFORE it:

- [ ] **Step 1: Add GET /api/habit-templates (no auth)**

```python
@app.get("/api/habit-templates")
async def list_habit_templates():
    with get_db() as conn:
        rows = conn.execute(
            "SELECT * FROM habit_templates ORDER BY kategori, subkategori, id"
        ).fetchall()
        return [dict(r) for r in rows]
```

- [ ] **Step 2: Add POST /api/habit-templates**

```python
@app.post("/api/habit-templates")
async def create_habit_template(req: HabitTemplateCreate, user=Depends(get_admin_user)):
    with get_db() as conn:
        cur = conn.execute(
            """INSERT INTO habit_templates (kategori, subkategori, type, item, frequency, priority, difficulty, tags)
               VALUES (?,?,?,?,?,?,?,?)""",
            (req.kategori, req.subkategori, req.type, req.item,
             req.frequency, req.priority, req.difficulty, json.dumps(req.tags))
        )
        conn.commit()
        row = conn.execute("SELECT * FROM habit_templates WHERE id = ?", (cur.lastrowid,)).fetchone()
        return dict(row)
```

- [ ] **Step 3: Add PUT /api/habit-templates/{id}**

```python
@app.put("/api/habit-templates/{template_id}")
async def update_habit_template(template_id: int, req: HabitTemplateUpdate, user=Depends(get_admin_user)):
    with get_db() as conn:
        existing = conn.execute("SELECT id FROM habit_templates WHERE id = ?", (template_id,)).fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail="Template tidak ditemukan")
        conn.execute(
            """UPDATE habit_templates SET
               kategori=?, subkategori=?, type=?, item=?, frequency=?, priority=?, difficulty=?, tags=?
               WHERE id=?""",
            (req.kategori, req.subkategori, req.type, req.item,
             req.frequency, req.priority, req.difficulty, json.dumps(req.tags), template_id)
        )
        conn.commit()
        row = conn.execute("SELECT * FROM habit_templates WHERE id = ?", (template_id,)).fetchone()
        return dict(row)
```

- [ ] **Step 4: Add DELETE /api/habit-templates/{id}**

```python
@app.delete("/api/habit-templates/{template_id}")
async def delete_habit_template(template_id: int, user=Depends(get_admin_user)):
    with get_db() as conn:
        existing = conn.execute("SELECT id FROM habit_templates WHERE id = ?", (template_id,)).fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail="Template tidak ditemukan")
        conn.execute("DELETE FROM habit_templates WHERE id = ?", (template_id,))
        conn.commit()
    return {"ok": True}
```

- [ ] **Step 5: Add GET /api/admin/users**

```python
@app.get("/api/admin/users")
async def list_admin_users(user=Depends(get_admin_user)):
    with get_db() as conn:
        rows = conn.execute(
            "SELECT id, username, display_name, is_admin, created_at FROM users ORDER BY id"
        ).fetchall()
        return [dict(r) for r in rows]
```

- [ ] **Step 6: Add PUT /api/admin/users/{id}/toggle-admin**

```python
@app.put("/api/admin/users/{target_id}/toggle-admin")
async def toggle_admin(target_id: int, user=Depends(get_admin_user)):
    if target_id == user["sub"]:
        raise HTTPException(status_code=400, detail="Tidak bisa mengubah status admin diri sendiri")
    with get_db() as conn:
        row = conn.execute("SELECT id, is_admin FROM users WHERE id = ?", (target_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="User tidak ditemukan")
        new_val = 0 if row["is_admin"] else 1
        conn.execute("UPDATE users SET is_admin = ? WHERE id = ?", (new_val, target_id))
        conn.commit()
        return {"id": target_id, "is_admin": new_val}
```

- [ ] **Step 7: Verify endpoints registered**

```bash
python3 -c "
import webapp
routes = [r.path for r in webapp.app.routes if 'habit' in r.path or 'admin' in r.path]
print(routes)
"
```

Expected:
```
['/api/habit-templates', '/api/habit-templates', '/api/habit-templates/{template_id}', '/api/habit-templates/{template_id}', '/api/admin/users', '/api/admin/users/{target_id}/toggle-admin']
```

- [ ] **Step 8: Commit**

```bash
git add webapp.py
git commit -m "feat: add habit-templates and admin API endpoints"
```

---

### Task 4: Service Worker — cache bump + API handler

**Files:**
- Modify: `static/sw.js`

- [ ] **Step 1: Bump CACHE name**

```bash
python3 << 'EOF'
with open('static/sw.js', encoding='utf-8') as f:
    content = f.read()
content = content.replace('"taskflow-v6-draw"', '"taskflow-v7-admin"', 1)
with open('static/sw.js', 'w', encoding='utf-8') as f:
    f.write(content)
print('Cache bumped:', '"taskflow-v7-admin"' in content)
EOF
```

- [ ] **Step 2: Add network-first handler for /api/habit-templates**

In `static/sw.js`, find the tldraw cache-first handler block (starts with `if (url.pathname.startsWith('/static/vendor/tldraw/'))`). Add BEFORE it:

```js
  // /api/habit-templates — network-first + cache fallback for offline
  if (url.pathname === '/api/habit-templates' && request.method === 'GET') {
    e.respondWith(
      fetch(request).then(res => {
        if (res.ok) {
          caches.open(CACHE).then(c => c.put(request, res.clone()))
        }
        return res
      }).catch(() =>
        caches.match(request).then(cached =>
          cached || new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } })
        )
      )
    )
    return
  }
```

Note: Falls back to `[]` (empty array) rather than 503 so GoalTab renders without crashing.

- [ ] **Step 3: Verify syntax**

```bash
node --check static/sw.js
```

Expected: no output (no syntax errors).

- [ ] **Step 4: Commit**

```bash
git add static/sw.js
git commit -m "feat: bump SW cache to v7-admin, add network-first handler for /api/habit-templates"
```

---

### Task 5: index.html — Remove HABIT_DATABANK, update GoalTab

**Files:**
- Modify: `static/index.html` (use Python for all edits — file is ~700KB)

- [ ] **Step 1: Remove HABIT_DATABANK constant**

```bash
python3 << 'EOF'
with open('static/index.html', encoding='utf-8') as f:
    html = f.read()

# HABIT_DATABANK is one long line (minified JSON)
# Find: const HABIT_DATABANK = [...];
start = html.find('\n    const HABIT_DATABANK = ')
end = html.find(';\n\n    const FREQ_MAP', start) + 2  # keep the \n\n

if start != -1 and end > start:
    removed_len = end - start
    html = html[:start] + html[end:]
    print(f'HABIT_DATABANK removed: {removed_len} chars')
else:
    print('Pattern not found')

with open('static/index.html', 'w', encoding='utf-8') as f:
    f.write(html)

print('HABIT_DATABANK still present:', 'const HABIT_DATABANK' in html)
EOF
```

Expected: `HABIT_DATABANK removed: ~207734 chars`, `HABIT_DATABANK still present: False`

- [ ] **Step 2: Update buildGoalCategories to accept templates parameter**

```bash
python3 << 'EOF'
with open('static/index.html', encoding='utf-8') as f:
    html = f.read()

old = 'function buildGoalCategories() {\n      const map = {};\n      for (const item of HABIT_DATABANK) {'
new = 'function buildGoalCategories(templates) {\n      const map = {};\n      for (const item of templates) {'

if old in html:
    html = html.replace(old, new, 1)
    print('buildGoalCategories updated: OK')
else:
    print('Pattern not found')

with open('static/index.html', 'w', encoding='utf-8') as f:
    f.write(html)
EOF
```

- [ ] **Step 3: Add templates state + fetch useEffect to GoalTab**

Find `function GoalTab({ onSave, onClose }) {` and the first state line. Add after the first `const [loading, setLoading]` state:

```bash
python3 << 'EOF'
with open('static/index.html', encoding='utf-8') as f:
    html = f.read()

old = '      const [loading, setLoading] = React.useState(false);\n\n      const selectCategory'
new = """      const [loading, setLoading] = React.useState(false);
      const [templates, setTemplates] = React.useState([]);
      const [templatesLoading, setTemplatesLoading] = React.useState(true);

      React.useEffect(() => {
        api.get('/api/habit-templates')
          .then(data => { setTemplates(data); setTemplatesLoading(false); })
          .catch(() => setTemplatesLoading(false));
      }, []);

      const selectCategory"""

assert old in html, 'Pattern not found'
html = html.replace(old, new, 1)
print('Templates state + fetch added: OK')

with open('static/index.html', 'w', encoding='utf-8') as f:
    f.write(html)
EOF
```

- [ ] **Step 4: Replace HABIT_DATABANK references in GoalTab with templates state**

```bash
python3 << 'EOF'
with open('static/index.html', encoding='utf-8') as f:
    html = f.read()

# Find GoalTab function boundaries
gt_start = html.find('function GoalTab(')
gt_end = html.find('\n    function TaskFormModal', gt_start)

gt = html[gt_start:gt_end]

# Replace all HABIT_DATABANK references with templates
gt_new = gt.replace('HABIT_DATABANK', 'templates')

# Also replace buildGoalCategories() call (no args) with buildGoalCategories(templates)
gt_new = gt_new.replace('buildGoalCategories()', 'buildGoalCategories(templates)')

# Fix: category step — add loading check
# Replace the category step return
old_cat = "      if (step === \"category\") {\n        return ("
new_cat = """      if (step === "category") {
        if (templatesLoading) return (
          <div style={{ textAlign: 'center', padding: 30, color: 'var(--text-light)' }}>Memuat...</div>
        );
        return ("""

gt_new = gt_new.replace(old_cat, new_cat, 1)

html = html[:gt_start] + gt_new + html[gt_end:]

with open('static/index.html', 'w', encoding='utf-8') as f:
    f.write(html)

# Verify
with open('static/index.html', encoding='utf-8') as f:
    h = f.read()
gt = h[h.find('function GoalTab('):h.find('\n    function TaskFormModal', h.find('function GoalTab('))]
print('HABIT_DATABANK in GoalTab:', 'HABIT_DATABANK' in gt)
print('templates state:', 'const [templates' in gt)
print('templatesLoading:', 'templatesLoading' in gt)
print('buildGoalCategories(templates):', 'buildGoalCategories(templates)' in gt)
EOF
```

Expected: all `False/True` matching — no HABIT_DATABANK in GoalTab, templates state present.

- [ ] **Step 5: Commit**

```bash
git add static/index.html
git commit -m "feat: remove HABIT_DATABANK, update GoalTab to fetch from /api/habit-templates"
```

---

### Task 6: index.html — AdminPage + AdminTemplateModal components

**Files:**
- Modify: `static/index.html` — insert before `function App()`

- [ ] **Step 1: Find insertion point (just before function App)**

```bash
python3 -c "
with open('static/index.html', encoding='utf-8') as f:
    html = f.read()
idx = html.find('    function App()')
print(f'App() at: {idx}')
print(repr(html[idx-50:idx+30]))
"
```

- [ ] **Step 2: Insert AdminTemplateModal and AdminPage components**

```bash
python3 << 'EOF'
with open('static/index.html', encoding='utf-8') as f:
    html = f.read()

app_idx = html.find('    function App()')

components = """    function AdminTemplateModal({ item, kategories, allSubkategories, onSave, onClose }) {
      const [form, setForm] = React.useState({
        kategori: item?.kategori || '',
        subkategori: item?.subkategori || '',
        type: item?.type || 'habit',
        item: item?.item || '',
        frequency: item?.frequency || 'daily',
        priority: item?.priority || 'medium',
        difficulty: item?.difficulty || 'medium',
        tags: item?.tags ? (Array.isArray(item.tags) ? item.tags.join(', ') : item.tags) : '',
      });
      const [saving, setSaving] = React.useState(false);

      const handleSubmit = async (e) => {
        e.preventDefault();
        setSaving(true);
        await onSave({
          ...form,
          tags: form.tags ? form.tags.split(',').map(t => t.trim()).filter(Boolean) : [],
        });
        setSaving(false);
      };

      return (
        <div className="modal-overlay" onClick={onClose}>
          <div className="modal-content scale-in" onClick={e => e.stopPropagation()} style={{ maxWidth: 500 }}>
            <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 16 }}>{item ? 'Edit Item' : 'Tambah Item'}</h3>
            <form onSubmit={handleSubmit}>
              <datalist id="admin-kategori">{kategories.map(k => <option key={k} value={k} />)}</datalist>
              <datalist id="admin-subkategori">{allSubkategories.map(s => <option key={s} value={s} />)}</datalist>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
                <div>
                  <label className="input-label">Kategori *</label>
                  <input className="input" list="admin-kategori" value={form.kategori} onChange={e => setForm(f => ({...f, kategori: e.target.value}))} required />
                </div>
                <div>
                  <label className="input-label">Subkategori *</label>
                  <input className="input" list="admin-subkategori" value={form.subkategori} onChange={e => setForm(f => ({...f, subkategori: e.target.value}))} required />
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 10 }}>
                <div>
                  <label className="input-label">Type *</label>
                  <select className="input" value={form.type} onChange={e => setForm(f => ({...f, type: e.target.value}))}>
                    <option value="habit">habit</option>
                    <option value="task">task</option>
                  </select>
                </div>
                <div>
                  <label className="input-label">Frequency *</label>
                  <select className="input" value={form.frequency} onChange={e => setForm(f => ({...f, frequency: e.target.value}))}>
                    <option value="daily">daily</option>
                    <option value="monthly">monthly</option>
                  </select>
                </div>
                <div>
                  <label className="input-label">Priority *</label>
                  <select className="input" value={form.priority} onChange={e => setForm(f => ({...f, priority: e.target.value}))}>
                    <option value="low">low</option>
                    <option value="medium">medium</option>
                    <option value="high">high</option>
                  </select>
                </div>
              </div>
              <div style={{ marginBottom: 10 }}>
                <label className="input-label">Difficulty *</label>
                <select className="input" value={form.difficulty} onChange={e => setForm(f => ({...f, difficulty: e.target.value}))}>
                  <option value="easy">easy</option>
                  <option value="medium">medium</option>
                  <option value="hard">hard</option>
                </select>
              </div>
              <div style={{ marginBottom: 10 }}>
                <label className="input-label">Item *</label>
                <textarea className="input" value={form.item} onChange={e => setForm(f => ({...f, item: e.target.value}))} rows={3} required />
              </div>
              <div style={{ marginBottom: 16 }}>
                <label className="input-label">Tags (comma-separated)</label>
                <input className="input" value={form.tags} onChange={e => setForm(f => ({...f, tags: e.target.value}))} placeholder="e.g. olahraga, kesehatan" />
              </div>
              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                <button type="button" className="btn btn-secondary" onClick={onClose}>Batal</button>
                <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Menyimpan...' : 'Simpan'}</button>
              </div>
            </form>
          </div>
        </div>
      );
    }

    function AdminPage({ user, showToast }) {
      const PAGE_SIZE = 50;
      const [templates, setTemplates] = React.useState([]);
      const [loadingT, setLoadingT] = React.useState(true);
      const [filterKat, setFilterKat] = React.useState('');
      const [filterSub, setFilterSub] = React.useState('');
      const [page, setPage] = React.useState(1);
      const [showModal, setShowModal] = React.useState(false);
      const [editItem, setEditItem] = React.useState(null);
      const [users, setUsers] = React.useState([]);

      React.useEffect(() => {
        api.get('/api/habit-templates').then(d => { setTemplates(d); setLoadingT(false); }).catch(() => setLoadingT(false));
        api.get('/api/admin/users').then(setUsers).catch(() => {});
      }, []);

      const kategories = [...new Set(templates.map(t => t.kategori))].sort();
      const subkategories = [...new Set(templates.filter(t => !filterKat || t.kategori === filterKat).map(t => t.subkategori))].sort();
      const filtered = templates.filter(t => (!filterKat || t.kategori === filterKat) && (!filterSub || t.subkategori === filterSub));
      const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
      const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

      const handleDelete = async (id) => {
        if (!window.confirm('Hapus item ini?')) return;
        try {
          await api.del(`/api/habit-templates/${id}`);
          setTemplates(prev => prev.filter(t => t.id !== id));
          showToast('Item dihapus');
        } catch (e) { showToast(e.message || 'Gagal menghapus', 'error'); }
      };

      const handleSave = async (data) => {
        try {
          if (editItem) {
            const updated = await api.put(`/api/habit-templates/${editItem.id}`, data);
            setTemplates(prev => prev.map(t => t.id === editItem.id ? updated : t));
            showToast('Item diupdate');
          } else {
            const created = await api.post('/api/habit-templates', data);
            setTemplates(prev => [...prev, created]);
            showToast('Item ditambah');
          }
          setShowModal(false);
          setEditItem(null);
        } catch (e) { showToast(e.message || 'Gagal menyimpan', 'error'); }
      };

      const handleToggleAdmin = async (uid) => {
        try {
          const updated = await api.put(`/api/admin/users/${uid}/toggle-admin`, {});
          setUsers(prev => prev.map(u => u.id === uid ? {...u, is_admin: updated.is_admin} : u));
        } catch (e) { showToast(e.message || 'Gagal', 'error'); }
      };

      return (
        <div className="fade-in" style={{ padding: '0 0 40px' }}>
          <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 20 }}>Admin — Habit Templates</h2>
          <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
            <select className="input" style={{ width: 'auto' }} value={filterKat} onChange={e => { setFilterKat(e.target.value); setFilterSub(''); setPage(1); }}>
              <option value="">Semua Kategori</option>
              {kategories.map(k => <option key={k} value={k}>{k}</option>)}
            </select>
            <select className="input" style={{ width: 'auto' }} value={filterSub} onChange={e => { setFilterSub(e.target.value); setPage(1); }}>
              <option value="">Semua Subkategori</option>
              {subkategories.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <button className="btn btn-primary" onClick={() => { setEditItem(null); setShowModal(true); }}>+ Tambah Item</button>
            <span style={{ marginLeft: 'auto', fontSize: 13, color: 'var(--text-secondary)' }}>{filtered.length} item</span>
          </div>
          {loadingT ? (
            <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-light)' }}>Memuat...</div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ background: 'var(--bg-primary)', borderBottom: '2px solid var(--border)' }}>
                    {['Kategori','Subkategori','Type','Item','Freq','Pri','Aksi'].map(h => (
                      <th key={h} style={{ padding: '8px 12px', textAlign: h === 'Aksi' ? 'right' : 'left', whiteSpace: 'nowrap' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {paged.map(t => (
                    <tr key={t.id} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ padding: '7px 12px', whiteSpace: 'nowrap' }}>{t.kategori}</td>
                      <td style={{ padding: '7px 12px', whiteSpace: 'nowrap' }}>{t.subkategori}</td>
                      <td style={{ padding: '7px 12px' }}>
                        <span style={{ fontSize: 11, padding: '2px 6px', borderRadius: 4, background: t.type === 'habit' ? 'rgba(168,197,0,0.15)' : 'rgba(100,149,237,0.15)', color: t.type === 'habit' ? 'var(--accent)' : '#6495ed' }}>{t.type}</span>
                      </td>
                      <td style={{ padding: '7px 12px', maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.item}</td>
                      <td style={{ padding: '7px 12px', fontSize: 11, whiteSpace: 'nowrap' }}>{t.frequency}</td>
                      <td style={{ padding: '7px 12px', fontSize: 11, whiteSpace: 'nowrap' }}>{t.priority}</td>
                      <td style={{ padding: '7px 12px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                        <button onClick={() => { setEditItem(t); setShowModal(true); }} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 15, marginRight: 4 }}>✏️</button>
                        <button onClick={() => handleDelete(t.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 15 }}>🗑️</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {totalPages > 1 && (
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 16, alignItems: 'center' }}>
              <button className="btn btn-secondary btn-sm" onClick={() => setPage(p => Math.max(1, p-1))} disabled={page === 1}>Prev</button>
              <span style={{ fontSize: 13 }}>{page} / {totalPages}</span>
              <button className="btn btn-secondary btn-sm" onClick={() => setPage(p => Math.min(totalPages, p+1))} disabled={page === totalPages}>Next</button>
            </div>
          )}
          {showModal && (
            <AdminTemplateModal
              item={editItem}
              kategories={kategories}
              allSubkategories={[...new Set(templates.map(t => t.subkategori))].sort()}
              onSave={handleSave}
              onClose={() => { setShowModal(false); setEditItem(null); }}
            />
          )}
          <div style={{ marginTop: 40 }}>
            <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 12 }}>User Management</h3>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: 'var(--bg-primary)', borderBottom: '2px solid var(--border)' }}>
                  <th style={{ padding: '8px 12px', textAlign: 'left' }}>Username</th>
                  <th style={{ padding: '8px 12px', textAlign: 'left' }}>Display Name</th>
                  <th style={{ padding: '8px 12px', textAlign: 'center' }}>Admin</th>
                </tr>
              </thead>
              <tbody>
                {users.map(u => (
                  <tr key={u.id} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '7px 12px' }}>{u.username}</td>
                    <td style={{ padding: '7px 12px' }}>{u.display_name || '-'}</td>
                    <td style={{ padding: '7px 12px', textAlign: 'center' }}>
                      <input type="checkbox" checked={!!u.is_admin} onChange={() => handleToggleAdmin(u.id)}
                        style={{ accentColor: 'var(--accent)', cursor: 'pointer', width: 16, height: 16 }} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      );
    }

    """

html = html[:app_idx] + components + html[app_idx:]

with open('static/index.html', 'w', encoding='utf-8') as f:
    f.write(html)

with open('static/index.html', encoding='utf-8') as f:
    h = f.read()
print('AdminPage:', 'function AdminPage(' in h)
print('AdminTemplateModal:', 'function AdminTemplateModal(' in h)
print('handleToggleAdmin:', 'handleToggleAdmin' in h)
print('handleSave:', 'handleSave' in h)
EOF
```

Expected: all `True`.

- [ ] **Step 3: Commit**

```bash
git add static/index.html
git commit -m "feat: add AdminPage and AdminTemplateModal components"
```

---

### Task 7: index.html — Sidebar Admin link + App routing

**Files:**
- Modify: `static/index.html`

- [ ] **Step 1: Add Admin link to Sidebar**

The sidebar `links` array ends with `];`. Find the closing and add Admin link:

```bash
python3 << 'EOF'
with open('static/index.html', encoding='utf-8') as f:
    html = f.read()

# Find end of sidebar links array
old_links_end = '        { id: "q4", icon: "📦", label: "Q4 Singkirkan", count: qc("Q4") },\n      ];'
new_links_end = '        { id: "q4", icon: "📦", label: "Q4 Singkirkan", count: qc("Q4") },\n        ...(user?.is_admin ? [{ id: "admin", icon: "🔧", label: "Admin" }] : []),\n      ];'

if old_links_end in html:
    html = html.replace(old_links_end, new_links_end, 1)
    print('Admin link added: OK')
else:
    # Try finding the closing pattern differently
    idx = html.find('q4", icon:')
    line_end = html.find('\n      ];', idx)
    print(f'q4 at {idx}, links end at {line_end}')
    print(repr(html[line_end-80:line_end+10]))

with open('static/index.html', 'w', encoding='utf-8') as f:
    f.write(html)
EOF
```

- [ ] **Step 2: Add admin page routing in App**

Find `if (page === "notes") {` in App component and add admin routing after it:

```bash
python3 << 'EOF'
with open('static/index.html', encoding='utf-8') as f:
    html = f.read()

# Find the notes page routing in App
old_notes = 'if (page === "notes") {\n          return <NotesPage tasks={tasks} showToast={showToast} onTaskClick={setSelectedTask} user={user} sharedLists={sharedLists} />;\n        }\n\n        if (page === "settings")'
new_notes = 'if (page === "notes") {\n          return <NotesPage tasks={tasks} showToast={showToast} onTaskClick={setSelectedTask} user={user} sharedLists={sharedLists} />;\n        }\n\n        if (page === "admin" && user?.is_admin) {\n          return <AdminPage user={user} showToast={showToast} />;\n        }\n\n        if (page === "settings")'

if old_notes in html:
    html = html.replace(old_notes, new_notes, 1)
    print('Admin routing added: OK')
else:
    print('Pattern not found, searching...')
    idx = html.find('page === "notes"')
    print(repr(html[idx:idx+200].encode('ascii','replace').decode()))

with open('static/index.html', 'w', encoding='utf-8') as f:
    f.write(html)
EOF
```

- [ ] **Step 3: Verify**

```bash
python3 -c "
with open('static/index.html', encoding='utf-8') as f:
    h = f.read()
print('Admin sidebar link:', 'id: \"admin\"' in h)
print('Admin routing:', 'page === \"admin\"' in h)
print('AdminPage render:', '<AdminPage user={user}' in h)
"
```

Expected: all `True`.

- [ ] **Step 4: Commit and push**

```bash
git add static/index.html
git commit -m "feat: add Admin sidebar link and app routing for admin page"
git push
```

---

### Task 8: Set is_admin for user yatno on VPS

After deploy, set your own account as admin. Run this on VPS (or via SSH):

- [ ] **Step 1: Set is_admin = 1 for admin user**

```bash
! ssh yatno@<vps-ip> "cd /home/yatno/todo-system/taskflow-v4 && python3 -c \"
import sqlite3
conn = sqlite3.connect('taskflow.db')
conn.execute(\\\"UPDATE users SET is_admin=1 WHERE username='yatno'\\\")
conn.commit()
result = conn.execute(\\\"SELECT username, is_admin FROM users WHERE username='yatno'\\\").fetchone()
print('Updated:', result)
conn.close()
\""
```

- [ ] **Step 2: Restart service**

Restart service di VPS seperti biasa.

- [ ] **Step 3: Verify admin page accessible**

Buka app → login sebagai yatno → sidebar harus tampil link "🔧 Admin" → klik → AdminPage tampil dengan tabel habit templates dan user management.
