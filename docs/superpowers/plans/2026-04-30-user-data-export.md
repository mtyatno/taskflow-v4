# User Data Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** User dapat mendownload semua datanya (notes, tasks, habits) sebagai satu file ZIP dari tombol di Settings page.

**Architecture:** Satu endpoint `GET /api/export/download` di `webapp.py` yang generate ZIP in-memory dengan Python stdlib `zipfile`. Notes diekspor sebagai file `.md` individual (wikilink `[[judul]]` as-is, kompatibel Obsidian). Tasks dan habits diekspor sebagai `.json` + `.csv`. Frontend: tombol di SettingsPage yang fetch blob dan trigger download.

**Tech Stack:** FastAPI `StreamingResponse`, Python `zipfile` + `csv` + `io`, React (Babel in-browser), native `fetch` untuk blob download.

---

## Files

| File | Action |
|------|--------|
| `webapp.py` | Modify — add `StreamingResponse`, `zipfile`, `csv`, `io` imports + `GET /api/export/download` endpoint |
| `static/index.html` | Modify — add `downloading` state + `handleExport` + Export section JSX ke `SettingsPage` |

---

### Task 1: webapp.py — export endpoint

**Files:**
- Modify: `webapp.py`

- [ ] **Step 1: Add missing imports**

Cari baris:
```python
from fastapi.responses import HTMLResponse, FileResponse
```

Ganti dengan:
```python
from fastapi.responses import HTMLResponse, FileResponse, StreamingResponse
import io
import zipfile
import csv
```

Verifikasi:
```bash
python3 -c "import webapp; print('OK')"
```
Expected: `OK`

- [ ] **Step 2: Add export endpoint**

Cari endpoint terakhir sebelum uvicorn run atau health check. Tambahkan endpoint ini sebelum `if __name__ == "__main__":` (atau di bagian endpoint lainnya, setelah endpoint `/api/admin/users/{target_id}/toggle-admin`):

```python
@app.get("/api/export/download")
async def export_user_data(user=Depends(get_current_user)):
    uid = user["sub"]
    today = datetime.now(_TZ_JKT).strftime("%Y-%m-%d")

    def _sanitize(title: str, note_id: int) -> str:
        name = re.sub(r'[/\\:*?"<>|]', '-', (title or "").strip())
        return name or f"untitled-{note_id}"

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:

        # ── Notes ──────────────────────────────────────────────────
        with get_db() as conn:
            notes = conn.execute(
                """SELECT n.id, n.title, n.content, n.created_at, n.updated_at,
                          GROUP_CONCAT(t.name) AS tag_names
                   FROM scratchpad_notes n
                   LEFT JOIN entity_tags et ON et.entity_type='note' AND et.entity_id=n.id
                   LEFT JOIN tags t ON t.id=et.tag_id
                   WHERE n.user_id=?
                   GROUP BY n.id ORDER BY n.id""",
                (uid,)
            ).fetchall()

        used: dict[str, int] = {}
        for note in notes:
            base = _sanitize(note["title"], note["id"])
            if base in used:
                used[base] += 1
                fname = f"{base} ({used[base]}).md"
            else:
                used[base] = 0
                fname = f"{base}.md"

            tags = [t.strip() for t in (note["tag_names"] or "").split(",") if t.strip()]
            tag_str = ", ".join(tags)
            frontmatter = (
                f"---\ntags: [{tag_str}]\n"
                f"created_at: {note['created_at']}\n"
                f"updated_at: {note['updated_at']}\n---\n\n"
            )
            content = frontmatter + (note["content"] or "")
            zf.writestr(f"notes/{fname}", content.encode("utf-8"))

        # ── Tasks ──────────────────────────────────────────────────
        with get_db() as conn:
            tasks_rows = conn.execute(
                "SELECT * FROM tasks WHERE user_id=? ORDER BY id", (uid,)
            ).fetchall()
            tasks_list = []
            for t in tasks_rows:
                td = dict(t)
                subs = conn.execute(
                    "SELECT title, is_done FROM subtasks WHERE task_id=? ORDER BY sort_order",
                    (t["id"],)
                ).fetchall()
                notes_rows = conn.execute(
                    "SELECT content FROM task_notes WHERE task_id=? ORDER BY id",
                    (t["id"],)
                ).fetchall()
                td["subtasks"] = [{"title": s["title"], "done": bool(s["is_done"])} for s in subs]
                td["notes"] = [n["content"] for n in notes_rows]
                tasks_list.append(td)

        zf.writestr(
            "tasks.json",
            json.dumps(tasks_list, ensure_ascii=False, indent=2).encode("utf-8")
        )

        csv_buf = io.StringIO()
        w = csv.writer(csv_buf)
        task_cols = ["id", "title", "description", "gtd_status", "priority", "quadrant",
                     "project", "context", "deadline", "waiting_for", "created_at", "completed_at"]
        w.writerow(task_cols)
        for t in tasks_list:
            w.writerow([t.get(c, "") or "" for c in task_cols])
        zf.writestr("tasks.csv", csv_buf.getvalue().encode("utf-8"))

        # ── Habits ─────────────────────────────────────────────────
        with get_db() as conn:
            habits_rows = conn.execute(
                "SELECT * FROM habits WHERE user_id=? ORDER BY id", (uid,)
            ).fetchall()
            habits_list = []
            for h in habits_rows:
                hd = dict(h)
                logs = conn.execute(
                    "SELECT date, status, skip_reason FROM habit_logs WHERE habit_id=? ORDER BY date DESC",
                    (h["id"],)
                ).fetchall()
                hd["logs"] = [dict(l) for l in logs]
                habits_list.append(hd)

        zf.writestr(
            "habits.json",
            json.dumps(habits_list, ensure_ascii=False, indent=2).encode("utf-8")
        )

        csv_buf2 = io.StringIO()
        w2 = csv.writer(csv_buf2)
        w2.writerow(["habit_title", "phase", "micro_target", "date", "status", "skip_reason"])
        for h in habits_list:
            for log in h["logs"]:
                w2.writerow([
                    h.get("title", ""), h.get("phase", ""), h.get("micro_target", "") or "",
                    log["date"], log["status"], log.get("skip_reason", "") or ""
                ])
        zf.writestr("habits.csv", csv_buf2.getvalue().encode("utf-8"))

    buf.seek(0)
    filename = f"taskflow-export-{today}.zip"
    return StreamingResponse(
        buf,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'}
    )
```

- [ ] **Step 3: Verify syntax**

```bash
python3 -c "import webapp; print('OK')"
```

Expected: `OK`

- [ ] **Step 4: Verify endpoint registered**

```bash
python3 -c "
import webapp
routes = [r.path for r in webapp.app.routes if 'export' in r.path]
print(routes)
"
```

Expected: `['/api/export/download']`

- [ ] **Step 5: Commit**

```bash
git add webapp.py
git commit -m "feat: add GET /api/export/download — ZIP with notes, tasks, habits"
```

---

### Task 2: index.html — Export UI in SettingsPage

**Files:**
- Modify: `static/index.html` (gunakan Python script — file terlalu besar)

- [ ] **Step 1: Add `downloading` state to SettingsPage**

```bash
python3 << 'EOF'
import io, sys
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

with open('static/index.html', encoding='utf-8') as f:
    html = f.read()

old = '      const [tgLoading, setTgLoading] = useState(false);'
new = ('      const [tgLoading, setTgLoading] = useState(false);\n'
       '      const [downloading, setDownloading] = React.useState(false);')

if old in html:
    html = html.replace(old, new, 1)
    print('downloading state added: OK')
else:
    print('Pattern not found')

with open('static/index.html', 'w', encoding='utf-8') as f:
    f.write(html)
EOF
```

- [ ] **Step 2: Add `handleExport` function to SettingsPage**

```bash
python3 << 'EOF'
import io, sys
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

with open('static/index.html', encoding='utf-8') as f:
    html = f.read()

old = '      const setL = (k, v) => setLoading(l => ({ ...l, [k]: v }));'
new = """      const setL = (k, v) => setLoading(l => ({ ...l, [k]: v }));

      const handleExport = async () => {
        setDownloading(true);
        try {
          const res = await fetch('/api/export/download', {
            headers: typeof __token !== 'undefined' && __token ? { Authorization: 'Bearer ' + __token } : {}
          });
          if (!res.ok) throw new Error('Gagal');
          const blob = await res.blob();
          const today = new Date().toISOString().slice(0, 10);
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = 'taskflow-export-' + today + '.zip';
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
        } catch (e) {
          showToast('Gagal export data', 'error');
        } finally {
          setDownloading(false);
        }
      };"""

if old in html:
    html = html.replace(old, new, 1)
    print('handleExport added: OK')
else:
    print('Pattern not found')

with open('static/index.html', 'w', encoding='utf-8') as f:
    f.write(html)
EOF
```

- [ ] **Step 3: Add Export section JSX at bottom of SettingsPage return**

```bash
python3 << 'EOF'
import io, sys
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

with open('static/index.html', encoding='utf-8') as f:
    html = f.read()

# Insert export section before the outer wrapper closing div of SettingsPage
old = ('          </div>\n'
       '        </div>\n'
       '      );\n'
       '    }\n'
       '\n'
       '    // ── Notes / Scratchpad')

new = ('          </div>\n'
       '        <div style={{ marginTop: 32, paddingTop: 24, borderTop: \'1px solid var(--border)\' }}>\n'
       '          <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>Backup & Export</h3>\n'
       '          <p style={{ fontSize: 13, color: \'var(--text-secondary)\', marginBottom: 12 }}>\n'
       '            Download semua datamu: notes (Markdown, kompatibel Obsidian), tasks, dan habits.\n'
       '          </p>\n'
       '          <button className="btn btn-primary" onClick={handleExport} disabled={downloading} style={{ minWidth: 190 }}>\n'
       '            {downloading ? \'Menyiapkan...\' : \'⬇ Download Backup (.zip)\'}\n'
       '          </button>\n'
       '        </div>\n'
       '        </div>\n'
       '      );\n'
       '    }\n'
       '\n'
       '    // ── Notes / Scratchpad')

if old in html:
    html = html.replace(old, new, 1)
    print('Export section added: OK')
else:
    print('Pattern not found')

with open('static/index.html', 'w', encoding='utf-8') as f:
    f.write(html)
EOF
```

- [ ] **Step 4: Verify**

```bash
python3 -c "
with open('static/index.html', encoding='utf-8') as f:
    h = f.read()
print('downloading state:', 'const [downloading' in h)
print('handleExport:', 'handleExport' in h)
print('Download Backup:', 'Download Backup' in h)
"
```

Expected: semua `True`.

- [ ] **Step 5: Bump SW cache version**

```bash
python3 -c "
with open('static/sw.js', encoding='utf-8') as f:
    content = f.read()
content = content.replace('\"taskflow-v7-admin\"', '\"taskflow-v8-export\"', 1)
with open('static/sw.js', 'w', encoding='utf-8') as f:
    f.write(content)
print('Cache bumped:', '\"taskflow-v8-export\"' in content)
"
```

Expected: `Cache bumped: True`

- [ ] **Step 6: Commit and push**

```bash
git add static/index.html static/sw.js
git commit -m "feat: add Export Backup section in Settings page"
git push
```
