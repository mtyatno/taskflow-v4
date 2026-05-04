# Recurring Tasks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tambahkan recurring tasks ke sistem task yang sudah ada — task berulang muncul sebagai virtual instances di calendar dan today view, tanpa generate row DB per occurrence.

**Architecture:** Master recurring task = task biasa dengan 4 kolom tambahan di tabel `tasks`. Virtual instances dihitung on-the-fly di frontend JS. Mark done/skip menulis ke tabel `recurring_exceptions`. Expiry notification via in-app + Telegram, dipicu saat app load.

**Tech Stack:** FastAPI, SQLite, React Babel in-browser (single `static/index.html`), python-telegram-bot

---

## Context Penting untuk Implementor

- **Single file frontend:** Seluruh React app ada di `static/index.html` (~700KB). Setiap perubahan JS harus sangat hati-hati dengan escape sequences — gunakan Python patch file (Write tool lalu `python patch_xxx.py`) untuk string yang mengandung `\n` atau newlines.
- **Pattern migrasi DB:** `repository.py._init_db()` cek kolom via `PRAGMA table_info` lalu `ALTER TABLE ADD COLUMN` jika belum ada. Ikuti pola yang sama.
- **Pattern notifikasi:** `repo.add_notification(user_id, message, task_id=...)` untuk in-app. `_tg_bot.send_message(chat_id=tg_id, text=..., parse_mode="HTML")` untuk Telegram.
- **task_row_to_dict:** Semua field `tasks.*` otomatis masuk response karena `dict(row)`. Kolom baru akan otomatis tersedia.
- **`recurrence_days`:** Disimpan sebagai JSON string di DB. Parse dengan `json.loads()` di backend, `JSON.parse()` di frontend.
- **JS date convention:** `recurrence_days` = array int 0=Senin s/d 6=Minggu. JS `Date.getDay()` = 0=Minggu s/d 6=Sabtu. Konversi: `(jsDay + 6) % 7` → 0=Senin.

---

## File Structure

| File | Perubahan |
|---|---|
| `repository.py` | Migrasi DB: 4 kolom baru di tasks + tabel recurring_exceptions |
| `webapp.py` | Pydantic models + 5 endpoint perubahan/baru |
| `static/index.html` | computeOccurrences helper, TaskFormModal, CalendarView, TodayFocusView, expiry banner |
| `static/sw.js` | Bump cache version |
| `test_recurring_api.py` | Manual test script untuk verifikasi endpoint |

---

## Task 1: Migrasi Database

**Files:**
- Modify: `repository.py` (dalam method `_init_db`)

- [ ] **Step 1: Cari posisi migrasi terakhir di `_init_db`**

Buka `repository.py`. Cari blok migrasi tasks terakhir — sekitar baris 240-260 ada:
```python
if "parent_id" not in cols:
    conn.execute("ALTER TABLE tasks ADD COLUMN parent_id INTEGER DEFAULT NULL REFERENCES tasks(id) ON DELETE SET NULL")
```
Tambahkan SETELAH blok ini.

- [ ] **Step 2: Tambah migrasi 4 kolom baru ke tasks**

```python
            # Migrate: recurring task columns
            cols = [row["name"] for row in conn.execute("PRAGMA table_info(tasks)").fetchall()]
            if "recurrence_type" not in cols:
                conn.execute("ALTER TABLE tasks ADD COLUMN recurrence_type TEXT DEFAULT NULL")
            if "recurrence_days" not in cols:
                conn.execute("ALTER TABLE tasks ADD COLUMN recurrence_days TEXT DEFAULT NULL")
            if "recurrence_end_date" not in cols:
                conn.execute("ALTER TABLE tasks ADD COLUMN recurrence_end_date TEXT DEFAULT NULL")
            if "recurrence_notif_level" not in cols:
                conn.execute("ALTER TABLE tasks ADD COLUMN recurrence_notif_level TEXT DEFAULT NULL")
```

- [ ] **Step 3: Tambah tabel `recurring_exceptions`**

Tambahkan setelah migrasi kolom di atas (masih dalam `_init_db`):

```python
            # Recurring exceptions table
            conn.execute("""
                CREATE TABLE IF NOT EXISTS recurring_exceptions (
                    id               INTEGER PRIMARY KEY AUTOINCREMENT,
                    task_id          INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
                    user_id          INTEGER NOT NULL REFERENCES users(id),
                    occurrence_date  TEXT NOT NULL,
                    status           TEXT NOT NULL,
                    created_at       TEXT NOT NULL,
                    UNIQUE(task_id, occurrence_date)
                )
            """)
            conn.execute("CREATE INDEX IF NOT EXISTS idx_rec_exc_task_date ON recurring_exceptions(task_id, occurrence_date)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_rec_exc_user ON recurring_exceptions(user_id)")
```

- [ ] **Step 4: Verifikasi migrasi berjalan**

```bash
cd "Z:\Todolist Manager V5.0"
python -c "
from repository import TaskRepository
repo = TaskRepository()
print('Migration OK')
import sqlite3
conn = sqlite3.connect('taskflow.db')
conn.row_factory = sqlite3.Row
cols = [r['name'] for r in conn.execute('PRAGMA table_info(tasks)').fetchall()]
print('recurrence_type' in cols, 'recurrence_end_date' in cols)
tables = [r['name'] for r in conn.execute(\"SELECT name FROM sqlite_master WHERE type='table'\").fetchall()]
print('recurring_exceptions' in tables)
conn.close()
"
```
Expected output:
```
Migration OK
True True
True
```

- [ ] **Step 5: Commit**

```bash
git add repository.py
git commit -m "feat: add recurring task columns and recurring_exceptions table"
```

---

## Task 2: Backend — Pydantic Models + Update Create/Update Task

**Files:**
- Modify: `webapp.py`

- [ ] **Step 1: Tambah field ke `TaskCreate`**

Cari class `TaskCreate(BaseModel)` di `webapp.py` (sekitar baris 262). Tambah 2 field baru setelah `parent_id`:

```python
class TaskCreate(BaseModel):
    title: str = Field(min_length=1)
    description: str = ""
    priority: str = "P3"
    project: str = ""
    context: str = ""
    deadline: Optional[str] = None
    gtd_status: str = "inbox"
    waiting_for: str = ""
    list_id: Optional[int] = None
    assigned_to: Optional[int] = None
    parent_id: Optional[int] = None
    recurrence_type: Optional[str] = None   # daily|weekly|monthly|weekdays
    recurrence_days: Optional[list] = None  # [0,2,4] untuk weekly Sen/Rab/Jum
```

- [ ] **Step 2: Tambah field ke `TaskUpdate`**

Cari class `TaskUpdate(BaseModel)` (sekitar baris 275). Tambah 3 field baru:

```python
class TaskUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    priority: Optional[str] = None
    project: Optional[str] = None
    context: Optional[str] = None
    deadline: Optional[str] = None
    gtd_status: Optional[str] = None
    waiting_for: Optional[str] = None
    assigned_to: Optional[int] = None
    progress: Optional[int] = None
    recurrence_type: Optional[str] = None
    recurrence_days: Optional[list] = None
    recurrence_renew: Optional[bool] = None  # True = perpanjang 3 bulan
```

- [ ] **Step 3: Update `create_task` — tambah recurrence logic**

Cari fungsi `create_task` (sekitar baris 654). Cari blok INSERT INTO tasks dan tambahkan recurrence sebelum blok tersebut:

```python
    # Recurrence
    recurrence_type = req.recurrence_type if req.recurrence_type in ("daily","weekly","monthly","weekdays") else None
    recurrence_days_json = None
    recurrence_end_date = None
    if recurrence_type:
        import json as _json
        if recurrence_type == "weekly" and req.recurrence_days:
            recurrence_days_json = _json.dumps([int(d) for d in req.recurrence_days if 0 <= int(d) <= 6])
        elif recurrence_type == "monthly" and req.recurrence_days:
            day_of_month = max(1, min(28, int(req.recurrence_days[0])))
            recurrence_days_json = _json.dumps([day_of_month])
        from datetime import timedelta
        recurrence_end_date = (date.today() + timedelta(days=90)).isoformat()
```

Kemudian update INSERT INTO tasks untuk menyertakan kolom baru — cari:
```python
        cur = conn.execute(
            """INSERT INTO tasks
               (title, description, gtd_status, priority, quadrant,
                project, context, deadline, waiting_for, user_id, list_id, assigned_to, parent_id, created_at, updated_at)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (req.title, req.description, req.gtd_status, req.priority.upper(), quadrant,
             req.project, req.context, deadline, req.waiting_for, uid, req.list_id, req.assigned_to, parent_id, now, now),
        )
```

Ganti dengan:
```python
        cur = conn.execute(
            """INSERT INTO tasks
               (title, description, gtd_status, priority, quadrant,
                project, context, deadline, waiting_for, user_id, list_id, assigned_to, parent_id,
                recurrence_type, recurrence_days, recurrence_end_date,
                created_at, updated_at)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (req.title, req.description, req.gtd_status, req.priority.upper(), quadrant,
             req.project, req.context, deadline, req.waiting_for, uid, req.list_id, req.assigned_to, parent_id,
             recurrence_type, recurrence_days_json, recurrence_end_date,
             now, now),
        )
```

- [ ] **Step 4: Update `update_task` — tambah recurrence logic**

Cari fungsi `update_task` (sekitar baris 765). Di dalam blok `with get_db() as conn:`, setelah blok `if req.progress is not None:`, tambahkan:

```python
        import json as _json
        from datetime import timedelta
        if req.recurrence_renew:
            updates["recurrence_end_date"] = (date.today() + timedelta(days=90)).isoformat()
            updates["recurrence_notif_level"] = None
        elif req.recurrence_type is not None:
            if req.recurrence_type in ("daily","weekly","monthly","weekdays"):
                updates["recurrence_type"] = req.recurrence_type
                if req.recurrence_type == "weekly" and req.recurrence_days is not None:
                    updates["recurrence_days"] = _json.dumps([int(d) for d in req.recurrence_days if 0 <= int(d) <= 6])
                elif req.recurrence_type == "monthly" and req.recurrence_days is not None:
                    day_of_month = max(1, min(28, int(req.recurrence_days[0])))
                    updates["recurrence_days"] = _json.dumps([day_of_month])
                else:
                    updates["recurrence_days"] = None
                if not existing.get("recurrence_end_date"):
                    updates["recurrence_end_date"] = (date.today() + timedelta(days=90)).isoformat()
            else:
                updates["recurrence_type"] = None
                updates["recurrence_days"] = None
                updates["recurrence_end_date"] = None
                updates["recurrence_notif_level"] = None
```

- [ ] **Step 5: Verifikasi dengan test script**

Buat file `test_task_recurrence.py`:

```python
import requests, json

BASE = "http://localhost:8000"
s = requests.Session()

# Login
r = s.post(f"{BASE}/api/auth/login", json={"username": "admin", "password": "admin123"})
token = r.json()["access_token"]
s.headers["Authorization"] = f"Bearer {token}"

# Create recurring task
r = s.post(f"{BASE}/api/tasks", json={
    "title": "Test Recurring Weekly",
    "priority": "P3",
    "recurrence_type": "weekly",
    "recurrence_days": [0, 2, 4]  # Sen, Rab, Jum
})
assert r.status_code == 200, r.text
t = r.json()
assert t["recurrence_type"] == "weekly", t
assert t["recurrence_end_date"] is not None, t
print("Create recurring: OK", t["id"], t["recurrence_end_date"])

task_id = t["id"]

# Update with renew
r = s.put(f"{BASE}/api/tasks/{task_id}", json={"recurrence_renew": True})
assert r.status_code == 200, r.text
t2 = r.json()
assert t2["recurrence_notif_level"] is None, t2
print("Renew: OK", t2["recurrence_end_date"])

print("ALL PASSED")
```

Jalankan (pastikan server aktif):
```bash
python test_task_recurrence.py
```
Expected: `ALL PASSED`

- [ ] **Step 6: Commit**

```bash
git add webapp.py
git commit -m "feat: add recurrence fields to TaskCreate/TaskUpdate and create/update endpoints"
```

---

## Task 3: Backend — 3 Endpoint Baru

**Files:**
- Modify: `webapp.py`

Tambahkan semua endpoint baru ini setelah endpoint `delete_task` (sekitar baris 901). Cari `@app.delete("/api/tasks/{task_id}")`.

- [ ] **Step 1: Tambah endpoint `POST /api/tasks/{task_id}/occurrences/{date}/mark`**

```python
class RecurrenceMarkReq(BaseModel):
    status: str  # "done" | "skipped"

@app.post("/api/tasks/{task_id}/occurrences/{occurrence_date}/mark")
async def mark_occurrence(task_id: int, occurrence_date: str, req: RecurrenceMarkReq, user=Depends(get_current_user)):
    uid = user["sub"]
    if req.status not in ("done", "skipped"):
        raise HTTPException(status_code=400, detail="status harus 'done' atau 'skipped'")
    # Validate date format
    try:
        occ_date = date.fromisoformat(occurrence_date)
    except ValueError:
        raise HTTPException(status_code=400, detail="Format tanggal tidak valid (YYYY-MM-DD)")
    with get_db() as conn:
        task = _can_access_task(conn, task_id, uid)
        if not task["recurrence_type"]:
            raise HTTPException(status_code=400, detail="Task ini bukan recurring task")
        task_created = date.fromisoformat(task["created_at"][:10])
        task_end = date.fromisoformat(task["recurrence_end_date"])
        if occ_date < task_created or occ_date > task_end:
            raise HTTPException(status_code=400, detail="Tanggal di luar range recurring task")
        now = datetime.now().isoformat()
        conn.execute("""
            INSERT INTO recurring_exceptions (task_id, user_id, occurrence_date, status, created_at)
            VALUES (?,?,?,?,?)
            ON CONFLICT(task_id, occurrence_date) DO UPDATE SET status=excluded.status
        """, (task_id, uid, occurrence_date, req.status, now))
        row = conn.execute(
            "SELECT * FROM recurring_exceptions WHERE task_id=? AND occurrence_date=?",
            (task_id, occurrence_date)
        ).fetchone()
    return dict(row)
```

- [ ] **Step 2: Tambah endpoint `GET /api/recurring/exceptions`**

```python
@app.get("/api/recurring/exceptions")
async def get_recurring_exceptions(
    from_date: str = Query(..., alias="from"),
    to_date: str = Query(..., alias="to"),
    user=Depends(get_current_user)
):
    uid = user["sub"]
    try:
        date.fromisoformat(from_date)
        date.fromisoformat(to_date)
    except ValueError:
        raise HTTPException(status_code=400, detail="Format tanggal tidak valid (YYYY-MM-DD)")
    with get_db() as conn:
        rows = conn.execute("""
            SELECT re.task_id, re.occurrence_date, re.status
            FROM recurring_exceptions re
            JOIN tasks t ON t.id = re.task_id
            WHERE re.user_id = ?
              AND re.occurrence_date >= ?
              AND re.occurrence_date <= ?
        """, (uid, from_date, to_date)).fetchall()
    result = {}
    for r in rows:
        key = str(r["task_id"])
        if key not in result:
            result[key] = []
        result[key].append({"occurrence_date": r["occurrence_date"], "status": r["status"]})
    return result
```

- [ ] **Step 3: Tambah endpoint `POST /api/recurring/check-expiry`**

```python
@app.post("/api/recurring/check-expiry")
async def check_recurring_expiry(background_tasks: BackgroundTasks, user=Depends(get_current_user)):
    uid = user["sub"]
    today = date.today()
    with get_db() as conn:
        tasks_rows = conn.execute("""
            SELECT id, title, recurrence_end_date, recurrence_notif_level, user_id
            FROM tasks
            WHERE user_id = ? AND recurrence_type IS NOT NULL AND recurrence_end_date IS NOT NULL
        """, (uid,)).fetchall()

    notified = []
    expiring_tasks = []

    for t in tasks_rows:
        end_date = date.fromisoformat(t["recurrence_end_date"])
        days_left = (end_date - today).days
        current_level = t["recurrence_notif_level"]
        new_level = None

        if days_left < 0 and current_level in (None, "week", "day"):
            new_level = "expired"
            msg = f'🔄 Recurring task "{t["title"]}" telah berakhir. Buat ulang jika masih diperlukan.'
            tg_msg = f'🔄 <b>Recurring Task Berakhir</b>\n"{t["title"]}" telah berakhir.\nBuka TaskFlow untuk membuat ulang.'
        elif days_left <= 1 and current_level == "week":
            new_level = "day"
            msg = f'⚠️ Recurring task "{t["title"]}" berakhir besok. Perpanjang jika masih diperlukan.'
            tg_msg = f'⚠️ <b>Recurring Task Reminder</b>\n"{t["title"]}" berakhir besok.\nBuka TaskFlow untuk memperpanjang.'
        elif days_left <= 7 and current_level is None:
            new_level = "week"
            msg = f'⚠️ Recurring task "{t["title"]}" akan berakhir dalam {days_left} hari. Perpanjang jika masih diperlukan.'
            tg_msg = f'⚠️ <b>Recurring Task Reminder</b>\n"{t["title"]}" akan berakhir dalam {days_left} hari.\nBuka TaskFlow untuk memperpanjang.'
        else:
            continue

        # Update DB level
        with get_db() as conn:
            conn.execute(
                "UPDATE tasks SET recurrence_notif_level=? WHERE id=?",
                (new_level, t["id"])
            )

        # In-app notification
        repo = TaskRepository(DB_PATH)
        repo.add_notification(uid, msg, task_id=t["id"])

        # Telegram notification
        if _tg_bot:
            with get_db() as conn:
                user_row = conn.execute("SELECT telegram_id FROM users WHERE id=?", (uid,)).fetchone()
            if user_row and user_row["telegram_id"]:
                tg_id = user_row["telegram_id"]
                background_tasks.add_task(_send_tg_message, tg_id, tg_msg)

        notified.append(new_level)
        expiring_tasks.append({"id": t["id"], "title": t["title"], "level": new_level, "days_left": days_left})

    return {"notified": notified, "tasks": expiring_tasks}


async def _send_tg_message(tg_id: int, text: str):
    try:
        await _tg_bot.send_message(chat_id=tg_id, text=text, parse_mode="HTML")
    except Exception:
        pass
```

- [ ] **Step 4: Tambah import yang dibutuhkan**

Pastikan di atas `webapp.py` ada import `Query` dari fastapi. Cari baris import fastapi:
```python
from fastapi import FastAPI, Depends, HTTPException, UploadFile, File as FastAPIFile, BackgroundTasks, Query
```
Jika `Query` belum ada, tambahkan ke import tersebut.

- [ ] **Step 5: Test 3 endpoint baru**

Buat `test_recurring_endpoints.py`:

```python
import requests
from datetime import date, timedelta

BASE = "http://localhost:8000"
s = requests.Session()

r = s.post(f"{BASE}/api/auth/login", json={"username": "admin", "password": "admin123"})
token = r.json()["access_token"]
s.headers["Authorization"] = f"Bearer {token}"

# Create recurring task
r = s.post(f"{BASE}/api/tasks", json={
    "title": "Test Recurring Daily",
    "priority": "P3",
    "recurrence_type": "daily",
})
assert r.status_code == 200, r.text
task_id = r.json()["id"]
print("Created task:", task_id)

# Mark today as done
today = date.today().isoformat()
r = s.post(f"{BASE}/api/tasks/{task_id}/occurrences/{today}/mark", json={"status": "done"})
assert r.status_code == 200, r.text
assert r.json()["status"] == "done"
print("Mark occurrence done: OK")

# Get exceptions
from_d = date.today().isoformat()
to_d = (date.today() + timedelta(days=7)).isoformat()
r = s.get(f"{BASE}/api/recurring/exceptions", params={"from": from_d, "to": to_d})
assert r.status_code == 200, r.text
exc = r.json()
assert str(task_id) in exc
assert exc[str(task_id)][0]["status"] == "done"
print("Get exceptions: OK")

# Check expiry
r = s.post(f"{BASE}/api/recurring/check-expiry")
assert r.status_code == 200, r.text
print("Check expiry: OK", r.json())

print("ALL PASSED")
```

Jalankan:
```bash
python test_recurring_endpoints.py
```
Expected: `ALL PASSED`

- [ ] **Step 6: Commit**

```bash
git add webapp.py
git commit -m "feat: add recurring task endpoints (mark occurrence, get exceptions, check-expiry)"
```

---

## Task 4: Frontend — Helper `computeOccurrences`

**Files:**
- Modify: `static/index.html`

- [ ] **Step 1: Cari posisi yang tepat untuk menambahkan helper**

Di `static/index.html`, cari fungsi `CalendarView` (sekitar baris 4582). Tambahkan fungsi `computeOccurrences` TEPAT SEBELUM baris `function CalendarView`.

- [ ] **Step 2: Tulis patch file untuk menambahkan `computeOccurrences`**

Buat file `patch_recurring_helper.py`:

```python
import io, sys
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

with open('static/index.html', encoding='utf-8') as f:
    h = f.read()

# Marker: function CalendarView
old = '    // ── Calendar View ───────────────────────────────────────────\n    function CalendarView'
new = '''    // ── Recurring Task Helper ───────────────────────────────────────
    function computeOccurrences(task, fromDate, toDate) {
      // Returns array of 'YYYY-MM-DD' strings for recurring occurrences in [fromDate, toDate]
      if (!task.recurrence_type || !task.recurrence_end_date) return [];
      const days = task.recurrence_days ? JSON.parse(task.recurrence_days) : [];
      const startD = new Date(task.created_at.slice(0,10) + 'T00:00:00');
      const endD   = new Date(task.recurrence_end_date + 'T00:00:00');
      const fromD  = new Date(fromDate + 'T00:00:00');
      const toD    = new Date(toDate + 'T00:00:00');
      const lo = startD > fromD ? startD : fromD;
      const hi = endD < toD ? endD : toD;
      if (lo > hi) return [];
      const result = [];
      const cur = new Date(lo);
      while (cur <= hi) {
        const jsDay = cur.getDay(); // 0=Sun
        const myDay = (jsDay + 6) % 7; // 0=Mon
        let match = false;
        if (task.recurrence_type === 'daily') match = true;
        else if (task.recurrence_type === 'weekdays') match = myDay <= 4;
        else if (task.recurrence_type === 'weekly') match = days.includes(myDay);
        else if (task.recurrence_type === 'monthly') match = cur.getDate() === days[0];
        if (match) {
          const y = cur.getFullYear();
          const m = String(cur.getMonth()+1).padStart(2,'0');
          const d = String(cur.getDate()).padStart(2,'0');
          result.push(y + '-' + m + '-' + d);
        }
        cur.setDate(cur.getDate() + 1);
      }
      return result;
    }

    // ── Calendar View ───────────────────────────────────────────
    function CalendarView'''

if old in h:
    h = h.replace(old, new, 1)
    print('computeOccurrences helper: OK')
else:
    print('ERROR: marker not found')

with open('static/index.html', 'w', encoding='utf-8') as f:
    f.write(h)

with open('static/index.html', encoding='utf-8') as f:
    v = f.read()
print('computeOccurrences in file:', 'computeOccurrences' in v)
```

- [ ] **Step 3: Jalankan patch**

```bash
python patch_recurring_helper.py
```
Expected:
```
computeOccurrences helper: OK
computeOccurrences in file: True
```

- [ ] **Step 4: Commit**

```bash
git add static/index.html patch_recurring_helper.py
git commit -m "feat: add computeOccurrences helper JS function"
```

---

## Task 5: Frontend — TaskFormModal Recurring Section

**Files:**
- Modify: `static/index.html`

- [ ] **Step 1: Tambah recurrence state ke TaskFormModal**

Di `static/index.html`, cari dalam `function TaskFormModal` state initialization (sekitar baris 2182):
```javascript
      const [form, setForm] = useState({
        ...
        progress: task?.progress || 0,
      });
```

Tambahkan SETELAH state `form`:
```javascript
      const [recurringOn, setRecurringOn] = useState(!!(task?.recurrence_type));
      const [recurForm, setRecurForm] = useState({
        type: task?.recurrence_type || 'daily',
        days: task?.recurrence_days ? JSON.parse(task.recurrence_days) : [0,2,4],
        dayOfMonth: task?.recurrence_days ? JSON.parse(task.recurrence_days)[0] : 1,
      });
      const setRecur = (k, v) => setRecurForm(f => ({ ...f, [k]: v }));
      const isRecurExpired = !!(task?.recurrence_end_date && task.recurrence_end_date < new Date().toISOString().slice(0,10));
```

- [ ] **Step 2: Update `handleSave` di TaskFormModal untuk kirim recurrence fields**

Cari fungsi `handleSave` di dalam `TaskFormModal` (cari `const handleSave` atau `async function handleSave`). Sebelum baris `await api.post(...)` atau `await api.put(...)`, tambahkan logic recurrence ke payload:

Cari pola dimana `form` dikirim ke API. Biasanya ada `const payload = { ...form }` atau langsung `api.post('/api/tasks', form)`. Tambahkan recurrence fields ke payload:

```javascript
      const recurrencePayload = recurringOn ? {
        recurrence_type: recurForm.type,
        recurrence_days: recurForm.type === 'weekly' ? recurForm.days :
                         recurForm.type === 'monthly' ? [recurForm.dayOfMonth] : null,
      } : { recurrence_type: null, recurrence_days: null };
```

Dan sertakan `...recurrencePayload` dalam payload API.

- [ ] **Step 3: Tulis patch file untuk UI recurring section di TaskFormModal**

Buat `patch_taskform_recurring.py`. Cari bagian form di TaskFormModal yang menampilkan deadline (field deadline ada di UI). Tambahkan recurring section setelah deadline field.

Cari marker yang unik di dalam TaskFormModal — deadline field UI biasanya terlihat sebagai:
```
title="Deadline"
```

Tulis patch:

```python
import io, sys
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

with open('static/index.html', encoding='utf-8') as f:
    h = f.read()

# Find the deadline field closing tag in TaskFormModal task tab
# Look for the unique pattern after the deadline input in the task form
OLD_MARKER = '              value={form.deadline} onChange={e => set("deadline", e.target.value)}'
NEW_SECTION = '''              value={form.deadline} onChange={e => set("deadline", e.target.value)}'''

# We'll search for the line after deadline input and add recurring section
# The deadline input row ends with type="date" and its container closes
OLD = '              value={form.deadline} onChange={e => set("deadline", e.target.value)}\n              style={{ width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg-primary)", color: "var(--text-primary)", fontSize: 14 }} />'

if OLD not in h:
    # Try alternate pattern
    import re
    m = re.search(r'value=\{form\.deadline\}[^\n]+\n[^\n]+type="date"[^\n]+/>', h)
    if m:
        print("Found deadline pattern at:", m.start())
    else:
        print("ERROR: deadline field pattern not found — check manually")
        sys.exit(1)

NEW = OLD + '''
              {/* Recurring Task Section */}
              <div style={{ marginTop: 12, padding: "10px 12px", background: "var(--bg-primary)", borderRadius: 10, border: "1px solid var(--border)" }}>
                <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontWeight: 600, fontSize: 13 }}>
                  <input type="checkbox" checked={recurringOn} onChange={e => setRecurringOn(e.target.checked)}
                    style={{ accentColor: "var(--accent)", width: 16, height: 16 }} />
                  🔁 Berulang
                </label>
                {recurringOn && (
                  <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
                    <select value={recurForm.type} onChange={e => setRecur("type", e.target.value)}
                      style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg-primary)", color: "var(--text-primary)", fontSize: 13 }}>
                      <option value="daily">Setiap Hari</option>
                      <option value="weekdays">Hari Kerja (Sen-Jum)</option>
                      <option value="weekly">Mingguan</option>
                      <option value="monthly">Bulanan</option>
                    </select>
                    {recurForm.type === "weekly" && (
                      <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                        {[["Sen",0],["Sel",1],["Rab",2],["Kam",3],["Jum",4],["Sab",5],["Min",6]].map(([lbl,val]) => (
                          <button key={val} type="button"
                            onClick={() => setRecur("days", recurForm.days.includes(val) ? recurForm.days.filter(d => d !== val) : [...recurForm.days, val])}
                            style={{ padding: "3px 10px", borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: "pointer",
                              background: recurForm.days.includes(val) ? "var(--accent)" : "var(--bg-card)",
                              color: recurForm.days.includes(val) ? "#000" : "var(--text-secondary)",
                              border: "1px solid var(--border)" }}>{lbl}</button>
                        ))}
                      </div>
                    )}
                    {recurForm.type === "monthly" && (
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ fontSize: 13 }}>Tanggal</span>
                        <input type="number" min={1} max={28} value={recurForm.dayOfMonth}
                          onChange={e => setRecur("dayOfMonth", Math.max(1,Math.min(28,parseInt(e.target.value)||1)))}
                          style={{ width: 60, padding: "4px 8px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg-primary)", color: "var(--text-primary)", fontSize: 13 }} />
                        <span style={{ fontSize: 12, color: "var(--text-light)" }}>setiap bulan (maks. 28)</span>
                      </div>
                    )}
                    {task?.recurrence_end_date && !isRecurExpired && (
                      <div style={{ fontSize: 12, color: "var(--text-light)" }}>
                        Aktif hingga {task.recurrence_end_date}
                      </div>
                    )}
                    {isRecurExpired && (
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ fontSize: 12, color: "#ef4444", fontWeight: 600 }}>Berakhir {task.recurrence_end_date}</span>
                        <button type="button" onClick={async () => {
                          try {
                            const updated = await api.put("/api/tasks/" + task.id, { recurrence_renew: true });
                            showToast("Recurring task diperpanjang 3 bulan");
                            onSave && onSave(updated);
                          } catch(e) { showToast("Gagal perpanjang", "error"); }
                        }} style={{ padding: "3px 10px", borderRadius: 6, fontSize: 12, fontWeight: 600,
                          background: "var(--accent)", color: "#000", border: "none", cursor: "pointer" }}>
                          🔄 Perpanjang 3 Bulan
                        </button>
                      </div>
                    )}
                    {!task?.recurrence_end_date && recurringOn && (
                      <div style={{ fontSize: 12, color: "var(--text-light)" }}>
                        Aktif selama 3 bulan setelah disimpan
                      </div>
                    )}
                  </div>
                )}
              </div>'''

if OLD in h:
    h = h.replace(OLD, NEW, 1)
    print('Recurring section in TaskFormModal: OK')
else:
    print('ERROR: deadline input marker not found — check pattern manually')

with open('static/index.html', 'w', encoding='utf-8') as f:
    f.write(h)
```

- [ ] **Step 4: Jalankan patch**

```bash
python patch_taskform_recurring.py
```

Jika `ERROR: deadline input marker not found`, buka `static/index.html`, cari `type="date"` di area TaskFormModal, temukan pola yang unik, update OLD di patch file, dan jalankan ulang.

Expected output: `Recurring section in TaskFormModal: OK`

- [ ] **Step 5: Cek visual di browser**

Buka http://localhost:8000, buka form create task, pastikan ada toggle "🔁 Berulang" di bawah deadline field. Klik toggle → muncul dropdown type. Pilih "Mingguan" → muncul checkboxes hari. Pilih "Bulanan" → muncul input tanggal.

- [ ] **Step 6: Commit**

```bash
git add static/index.html patch_taskform_recurring.py
git commit -m "feat: add recurring section to TaskFormModal"
```

---

## Task 6: Frontend — CalendarView Update (Virtual Instances)

**Files:**
- Modify: `static/index.html`

- [ ] **Step 1: Tambah state dan fetch exceptions di CalendarView**

Cari `function CalendarView({ tasks, onTaskClick })` di `static/index.html`. Di dalam komponen ini, tambahkan state dan fetch setelah `const [holidays, setHolidays] = useState({})`:

Cari pattern ini di dalam CalendarView:
```javascript
      const [holidays, setHolidays] = useState({});  // { "YYYY-MM-DD": "Nama Libur" }
```

Tambahkan setelah baris itu:
```javascript
      const [recurExceptions, setRecurExceptions] = useState({});  // { "task_id": [{occurrence_date, status}] }
      const [recurPopup, setRecurPopup] = useState(null); // { task, date, x, y }
```

- [ ] **Step 2: Tambah useEffect fetch exceptions saat month/year berubah**

Cari useEffect yang fetch holidays di CalendarView:
```javascript
      useEffect(() => {
        const cacheKey = `hl2_${year}`;
```

Tambahkan useEffect BARU setelah useEffect holidays tersebut:
```javascript
      useEffect(() => {
        const recurringTasks = tasks.filter(t => t.recurrence_type && t.recurrence_end_date);
        if (recurringTasks.length === 0) { setRecurExceptions({}); return; }
        const firstDay = new Date(year, month, 1).toISOString().slice(0,10);
        const lastDay = new Date(year, month + 1, 0).toISOString().slice(0,10);
        api.get(`/api/recurring/exceptions?from=${firstDay}&to=${lastDay}`)
          .then(data => setRecurExceptions(data || {}))
          .catch(() => setRecurExceptions({}));
      }, [year, month, tasks]);
```

- [ ] **Step 3: Tambah virtual instance ke `byDay` map**

Di CalendarView, cari blok ini:
```javascript
      const byDay = {};
      tasksWithDeadline.forEach(t => {
        const { d } = parseDeadline(t.deadline);
        if (!byDay[d]) byDay[d] = [];
        byDay[d].push(t);
      });
```

Tambahkan setelah blok tersebut:
```javascript
      // Add virtual recurring instances
      const recurringTasks = tasks.filter(t => t.recurrence_type && t.recurrence_end_date);
      const firstDayStr = `${year}-${String(month+1).padStart(2,'0')}-01`;
      const lastDayStr = new Date(year, month+1, 0).toISOString().slice(0,10);
      recurringTasks.forEach(t => {
        const occurrences = computeOccurrences(t, firstDayStr, lastDayStr);
        const exceptions = recurExceptions[String(t.id)] || [];
        const exMap = {};
        exceptions.forEach(e => { exMap[e.occurrence_date] = e.status; });
        occurrences.forEach(dateStr => {
          const d = parseInt(dateStr.slice(8,10));
          if (!byDay[d]) byDay[d] = [];
          const existing = byDay[d].find(x => x.id === t.id && x._isRecurring);
          if (!existing) {
            byDay[d].push({ ...t, _isRecurring: true, _occurrenceDate: dateStr, _occurrenceStatus: exMap[dateStr] || null });
          }
        });
      });
```

- [ ] **Step 4: Update render chip di CalendarView untuk tampilkan badge 🔁**

Cari fungsi `chipColor` di CalendarView. Setelah fungsi itu, cari render chip di kalender grid. Cari pola yang render task chips/dots di dalam cell kalender. Biasanya ada map atas `dayTasks`. Tambahkan badge 🔁 untuk task recurring:

Cari pola render chip (bisa berupa span atau div kecil dengan task title). Tambahkan kondisi:
```javascript
{t._isRecurring && <span style={{fontSize:9, marginLeft:2}}>🔁</span>}
```

Dan untuk task yang `_occurrenceStatus === 'done'` tambahkan styling redup/strikethrough.

- [ ] **Step 5: Tambah popup saat klik recurring occurrence**

Cari handler `onClick` di cell kalender (biasanya `setSelectedDay(day)`). Saat user klik chip recurring task (bukan reguler), tampilkan `recurPopup` daripada `selectedDay`.

Tambahkan handler di chip recurring:
```javascript
onClick={(e) => {
  e.stopPropagation();
  setRecurPopup({ task: t, date: t._occurrenceDate });
}}
```

Tambahkan popup component di akhir return CalendarView:
```jsx
{recurPopup && (
  <div style={{ position: "fixed", inset: 0, zIndex: 200 }} onClick={() => setRecurPopup(null)}>
    <div onClick={e => e.stopPropagation()} style={{
      position: "fixed", top: "50%", left: "50%", transform: "translate(-50%,-50%)",
      background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 14,
      padding: 20, minWidth: 260, boxShadow: "0 8px 32px rgba(0,0,0,0.18)", zIndex: 201
    }}>
      <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>🔁 {recurPopup.task.title}</div>
      <div style={{ fontSize: 13, color: "var(--text-light)", marginBottom: 14 }}>
        {new Date(recurPopup.date + 'T00:00:00').toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
      </div>
      {recurPopup.task._occurrenceStatus === 'done' ? (
        <div style={{ color: "#16a34a", fontWeight: 600, fontSize: 13 }}>✓ Sudah selesai</div>
      ) : (
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={async () => {
            await api.post(`/api/tasks/${recurPopup.task.id}/occurrences/${recurPopup.date}/mark`, { status: "done" });
            setRecurPopup(null);
            const firstDay = `${year}-${String(month+1).padStart(2,'0')}-01`;
            const lastDay = new Date(year, month+1, 0).toISOString().slice(0,10);
            api.get(`/api/recurring/exceptions?from=${firstDay}&to=${lastDay}`).then(setRecurExceptions).catch(()=>{});
          }} style={{ padding: "6px 14px", borderRadius: 8, background: "var(--accent)", color: "#000", border: "none", fontWeight: 700, cursor: "pointer", fontSize: 13 }}>
            ✓ Selesai
          </button>
          <button onClick={async () => {
            await api.post(`/api/tasks/${recurPopup.task.id}/occurrences/${recurPopup.date}/mark`, { status: "skipped" });
            setRecurPopup(null);
            const firstDay = `${year}-${String(month+1).padStart(2,'0')}-01`;
            const lastDay = new Date(year, month+1, 0).toISOString().slice(0,10);
            api.get(`/api/recurring/exceptions?from=${firstDay}&to=${lastDay}`).then(setRecurExceptions).catch(()=>{});
          }} style={{ padding: "6px 14px", borderRadius: 8, background: "var(--bg-primary)", color: "var(--text-secondary)", border: "1px solid var(--border)", cursor: "pointer", fontSize: 13 }}>
            — Lewati
          </button>
          <button onClick={() => { setRecurPopup(null); onTaskClick && onTaskClick(recurPopup.task); }}
            style={{ padding: "6px 14px", borderRadius: 8, background: "var(--bg-primary)", color: "var(--text-secondary)", border: "1px solid var(--border)", cursor: "pointer", fontSize: 13 }}>
            Lihat Task
          </button>
        </div>
      )}
    </div>
  </div>
)}
```

- [ ] **Step 6: Test di browser**

1. Buat recurring task weekly (Sen, Rab, Jum)
2. Buka halaman Kalender
3. Pastikan muncul dots dengan badge 🔁 di hari Senin, Rabu, Jumat bulan ini
4. Klik salah satu dot → popup muncul dengan tombol "✓ Selesai", "— Lewati", "Lihat Task"
5. Klik "✓ Selesai" → dot berubah jadi redup/✓

- [ ] **Step 7: Commit**

```bash
git add static/index.html
git commit -m "feat: show recurring task virtual instances in CalendarView"
```

---

## Task 7: Frontend — Today View + Expiry Banner

**Files:**
- Modify: `static/index.html`

- [ ] **Step 1: Tambah recurring occurrences ke TodayFocusView**

Cari `function TodayFocusView({ tasks, onTaskClick, onDone, loading })` (sekitar baris 4138).

Tambahkan state dan logic setelah `const [taskPomodoros, setTaskPomodoros] = useState({})`:

```javascript
      const [todayExceptions, setTodayExceptions] = useState({});
      const todayStr = new Date().toISOString().slice(0,10);

      useEffect(() => {
        const recurringTasks = tasks.filter(t => t.recurrence_type && t.recurrence_end_date);
        if (recurringTasks.length === 0) return;
        api.get(`/api/recurring/exceptions?from=${todayStr}&to=${todayStr}`)
          .then(data => setTodayExceptions(data || {}))
          .catch(() => {});
      }, [tasks]);

      const recurringToday = tasks.filter(t => {
        if (!t.recurrence_type || !t.recurrence_end_date) return false;
        const occs = computeOccurrences(t, todayStr, todayStr);
        if (occs.length === 0) return false;
        const excs = todayExceptions[String(t.id)] || [];
        const status = excs.find(e => e.occurrence_date === todayStr)?.status;
        return status !== 'done' && status !== 'skipped';
      });
```

Kemudian di JSX return, tambahkan section recurring SEBELUM "TASK LIST" section:

```jsx
{recurringToday.length > 0 && (
  <div style={{ marginBottom: 20 }}>
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
      <span style={{ fontSize: 13, fontWeight: 700, color: "var(--accent)", letterSpacing: "0.5px" }}>🔁 RECURRING HARI INI</span>
      <div style={{ flex: 1, height: 1, background: "rgba(168,197,0,0.3)" }} />
      <span style={{ fontSize: 12, color: "var(--text-light)" }}>{recurringToday.length} task</span>
    </div>
    {recurringToday.map(t => (
      <div key={t.id} style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderLeft: "3px solid var(--accent)", borderRadius: 10, padding: "10px 14px", marginBottom: 8, display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 600, fontSize: 14 }}>🔁 {t.title}</div>
          <div style={{ fontSize: 12, color: "var(--text-light)" }}>{t.priority} · {t.recurrence_type}</div>
        </div>
        <button onClick={async () => {
          await api.post(`/api/tasks/${t.id}/occurrences/${todayStr}/mark`, { status: "done" });
          const data = await api.get(`/api/recurring/exceptions?from=${todayStr}&to=${todayStr}`);
          setTodayExceptions(data || {});
        }} style={{ padding: "5px 12px", borderRadius: 8, background: "var(--accent)", color: "#000", border: "none", fontWeight: 700, cursor: "pointer", fontSize: 13 }}>
          ✓ Done
        </button>
      </div>
    ))}
  </div>
)}
```

- [ ] **Step 2: Tambah expiry banner di App component**

Cari `function App()` (sekitar baris 8904). Tambahkan state setelah state `[unreadCount, setUnreadCount]`:

```javascript
      const [recurExpiryAlert, setRecurExpiryAlert] = useState(null); // { count, hasExpired }
```

Di dalam `fetchAll` atau useEffect setelah data load, tambahkan expiry check. Cari baris di mana `fetchAll` selesai atau setelah `setIsOnline(navigator.onLine)`, tambahkan:

```javascript
        // Check recurring expiry
        if (navigator.onLine) {
          api.post('/api/recurring/check-expiry')
            .then(data => {
              if (data.tasks && data.tasks.length > 0) {
                const hasExpired = data.tasks.some(t => t.level === 'expired');
                setRecurExpiryAlert({ count: data.tasks.length, hasExpired });
              }
            })
            .catch(() => {});
        }
```

- [ ] **Step 3: Render expiry banner di JSX App**

Cari area di App JSX dimana navbar/header dirender. Tambahkan banner setelah navbar, sebelum konten utama:

```jsx
{recurExpiryAlert && (
  <div onClick={() => { setPage("tasks"); setRecurExpiryAlert(null); }}
    style={{ position: "sticky", top: 0, zIndex: 50, cursor: "pointer", padding: "8px 16px",
      background: recurExpiryAlert.hasExpired ? "#fef2f2" : "#fefce8",
      borderBottom: `1px solid ${recurExpiryAlert.hasExpired ? "#fca5a5" : "#fde68a"}`,
      display: "flex", alignItems: "center", justifyContent: "space-between" }}>
    <span style={{ fontSize: 13, fontWeight: 600, color: recurExpiryAlert.hasExpired ? "#b91c1c" : "#854d0e" }}>
      {recurExpiryAlert.hasExpired ? "🔴" : "⚠️"} {recurExpiryAlert.count} recurring task {recurExpiryAlert.hasExpired ? "telah berakhir" : "akan berakhir"} — Klik untuk lihat
    </span>
    <button onClick={e => { e.stopPropagation(); setRecurExpiryAlert(null); }}
      style={{ background: "transparent", border: "none", fontSize: 16, cursor: "pointer", color: "var(--text-light)" }}>✕</button>
  </div>
)}
```

- [ ] **Step 4: Test di browser**

1. Buka halaman "Fokus Hari Ini"
2. Pastikan recurring task yang occurrence hari ini muncul di section "🔁 RECURRING HARI INI"
3. Klik "✓ Done" → task hilang dari section
4. Buat task recurring dengan end_date besok (edit langsung di DB jika perlu), reload app → pastikan banner kuning muncul

- [ ] **Step 5: Commit**

```bash
git add static/index.html
git commit -m "feat: show recurring tasks in today view and expiry banner in app"
```

---

## Task 8: Bump SW Cache + Final Push

**Files:**
- Modify: `static/sw.js`

- [ ] **Step 1: Bump SW cache version**

Di `static/sw.js`, ubah:
```javascript
const CACHE = "taskflow-v30-offline";
```
Menjadi:
```javascript
const CACHE = "taskflow-v31-recurring";
```

- [ ] **Step 2: Final integration test**

```bash
cd "Z:\Todolist Manager V5.0"
python test_recurring_api.py 2>/dev/null || python test_task_recurrence.py
python test_recurring_endpoints.py
```
Semua harus `ALL PASSED`.

Lakukan manual verification di browser:
- [ ] Buat task recurring daily → muncul di calendar setiap hari bulan ini
- [ ] Buat task recurring weekly Sen/Rab/Jum → muncul di hari yang tepat
- [ ] Buat task recurring monthly tgl 15 → muncul di tgl 15
- [ ] Mark occurrence done via calendar popup → dot berubah
- [ ] Recurring task muncul di Today view jika hari ini adalah occurrence
- [ ] Toggle recurring off di form edit → recurrence hilang

- [ ] **Step 3: Commit dan push**

```bash
git add static/sw.js
git commit -m "chore: bump SW cache for recurring tasks release"
git push
```

Expected: CI/CD deploy berjalan. Cek https://todo.yatno.web.id setelah deploy selesai.
