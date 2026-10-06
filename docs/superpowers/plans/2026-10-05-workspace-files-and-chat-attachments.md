# Workspace Files Repository & Chat File Attachments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Menambahkan sistem katalog berkas terpusat di halaman Workspace (`slist_<id>`) dan integrasi lampiran berkas pada obrolan Diskusi (`ChatRoom`), lengkap dengan agregasi otomatis lampiran task, pelacakan asal berkas (*provenance*), preview/download, serta kontrol hak akses hapus terproteksi (uploader & owner).

**Architecture:**
- Backend: Tabel baru SQLite `workspace_files`, kolom `messages.file_id`, endpoint CRUD berkas `/api/lists/{list_id}/files`, otorisasi berbasis keanggotaan/owner workspace, penyimpanan fisik berbasis UUID di `UPLOAD_DIR`, dan sinkronisasi otomatis dari `POST /api/tasks/{task_id}/attachments`.
- Frontend: Tab navigasi `[ 📋 Tasks ] [ 📁 Files (N) ]` pada halaman workspace `slist_<id>`, katalog `WorkspaceFilesView` dengan pencarian & filter tipe, tab `[ 📁 File ]` di `AttachPopup`, chip pratinjau lampiran di `ChatInputBar`, dan kartu interaktif `FileMiniCard` di `ChatRoom`.
- Offline/Realtime: Event pesan berkas disiarkan via SSE chat bus; berkas unduh/unggah berstatus network-only dengan feedback toast offline yang jelas.

**Tech Stack:** FastAPI, SQLite (Python `sqlite3`), React (frontend bundle `static/index.html`), Service Worker (`static/sw.js`), Pytest, Node.js Test Runner.

## Global Constraints
- Database migrations must be idempotent via `migrate_db()` in `webapp.py`.
- No accent stripes: jangan gunakan garis tepi berwarna tebal pada kartu/komponen baru (mematuhi audit desain Alurik).
- Permission policy: penghapusan file HANYA boleh dilakukan oleh `uploader` berkas (`user_id`) atau `owner` workspace (`shared_lists.owner_id`). Pengguna lain menerima HTTP 403.
- Penghapusan berkas fisik di disk disertai pembaruan status `is_deleted = 1` (soft-delete) agar riwayat bubble chat tidak rusak dan menampilkan kartu berkas terhapus secara anggun.
- Service Worker cache bump ke `taskflow-v368-workspace-files`.

---

### Task 1: Database Migration & Schema Setup

**Files:**
- Modify: `webapp.py` (di dalam fungsi `migrate_db()`)
- Test: `tests/test_workspace_files.py`

**Interfaces:**
- Produces: Tabel `workspace_files` dan kolom `messages.file_id` di database SQLite.

- [ ] **Step 1: Write test for database migration and table structure**

Create `tests/test_workspace_files.py`:
```python
import pytest
import sqlite3
import os
import tempfile
from webapp import DB_PATH, migrate_db

def test_workspace_files_table_and_columns():
    migrate_db()
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        # Check workspace_files table columns
        cols = {r["name"]: r["type"].upper() for r in conn.execute("PRAGMA table_info(workspace_files)").fetchall()}
        assert "id" in cols
        assert "list_id" in cols
        assert "user_id" in cols
        assert "filename" in cols
        assert "original_name" in cols
        assert "file_size" in cols
        assert "mime_type" in cols
        assert "source" in cols
        assert "task_id" in cols
        assert "is_deleted" in cols
        assert "created_at" in cols

        # Check messages table file_id column
        msg_cols = [r["name"] for r in conn.execute("PRAGMA table_info(messages)").fetchall()]
        assert "file_id" in msg_cols
    finally:
        conn.close()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_workspace_files.py -k test_workspace_files_table_and_columns -v`
Expected: FAIL (table `workspace_files` does not exist or `file_id` column not in `messages`).

- [ ] **Step 3: Implement `migrate_db` additions in `webapp.py`**

In `webapp.py` inside `migrate_db()`:
```python
    # Create workspace_files table
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS workspace_files (
                id            INTEGER PRIMARY KEY AUTOINCREMENT,
                list_id       INTEGER NOT NULL REFERENCES shared_lists(id) ON DELETE CASCADE,
                user_id       INTEGER NOT NULL REFERENCES users(id),
                filename      TEXT NOT NULL,
                original_name TEXT NOT NULL,
                file_size     INTEGER DEFAULT 0,
                mime_type     TEXT DEFAULT '',
                source        TEXT NOT NULL DEFAULT 'direct',
                task_id       INTEGER DEFAULT NULL,
                is_deleted    INTEGER DEFAULT 0,
                created_at    TEXT NOT NULL
            )
        """)
        conn.execute("CREATE INDEX IF NOT EXISTS idx_workspace_files_list ON workspace_files(list_id, created_at)")
        conn.commit()
    finally:
        conn.close()

    # Migrate messages.file_id column
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        cols = [r["name"] for r in conn.execute("PRAGMA table_info(messages)").fetchall()]
        if "file_id" not in cols:
            conn.execute("ALTER TABLE messages ADD COLUMN file_id INTEGER DEFAULT NULL REFERENCES workspace_files(id)")
            conn.commit()
    finally:
        conn.close()
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_workspace_files.py -k test_workspace_files_table_and_columns -v`
Expected: PASS.

- [ ] **Step 5: Commit changes**

```bash
git add webapp.py tests/test_workspace_files.py
git commit -m "feat(db): add workspace_files table and messages.file_id migration"
```

---

### Task 2: Backend API for Workspace Files CRUD & Download

**Files:**
- Modify: `webapp.py` (tambahkan section `# ── Workspace Files API ──`)
- Test: `tests/test_workspace_files.py`

**Interfaces:**
- Produces:
  - `GET /api/lists/{list_id}/files`: list active workspace files (with optional query `?q=` and `?type=`).
  - `POST /api/lists/{list_id}/files`: upload new workspace file with size check & storage in `UPLOAD_DIR`.
  - `GET /api/lists/{list_id}/files/{file_id}/download`: authenticated download/preview.
  - `DELETE /api/lists/{list_id}/files/{file_id}`: soft-delete and unlink physical file; restricted to uploader or workspace owner.

- [ ] **Step 1: Write tests for Workspace Files API**

Append to `tests/test_workspace_files.py`:
```python
import io
from fastapi.testclient import TestClient
from webapp import app

def test_workspace_files_crud_and_permissions(test_client, auth_headers_owner, auth_headers_member, auth_headers_outsider, sample_shared_list_id):
    client = test_client
    list_id = sample_shared_list_id

    # 1. Outsider cannot list or upload files
    res = client.get(f"/api/lists/{list_id}/files", headers=auth_headers_outsider)
    assert res.status_code == 403

    # 2. Member uploads file
    file_content = b"PDF mock content for commissioning"
    res = client.post(
        f"/api/lists/{list_id}/files",
        headers=auth_headers_member,
        files={"file": ("SOP_Commissioning.pdf", io.BytesIO(file_content), "application/pdf")},
        data={"source": "direct"}
    )
    assert res.status_code == 201
    file_data = res.json()
    assert file_data["original_name"] == "SOP_Commissioning.pdf"
    assert file_data["file_size"] == len(file_content)
    file_id = file_data["id"]

    # 3. List files shows uploaded file
    res = client.get(f"/api/lists/{list_id}/files", headers=auth_headers_member)
    assert res.status_code == 200
    files = res.json()
    assert any(f["id"] == file_id for f in files)

    # 4. Download file
    res = client.get(f"/api/lists/{list_id}/files/{file_id}/download", headers=auth_headers_owner)
    assert res.status_code == 200
    assert res.content == file_content

    # 5. Non-uploader member cannot delete file (403)
    res = client.delete(f"/api/lists/{list_id}/files/{file_id}", headers=auth_headers_other_member)
    assert res.status_code == 403

    # 6. Uploader or Owner can delete file
    res = client.delete(f"/api/lists/{list_id}/files/{file_id}", headers=auth_headers_member)
    assert res.status_code == 200
    assert res.json()["success"] is True

    # 7. File no longer appears in active files list
    res = client.get(f"/api/lists/{list_id}/files", headers=auth_headers_member)
    assert not any(f["id"] == file_id for f in res.json())
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_workspace_files.py -k test_workspace_files_crud_and_permissions -v`
Expected: FAIL (endpoints not found / 404).

- [ ] **Step 3: Implement endpoints in `webapp.py`**

In `webapp.py`:
- `GET /api/lists/{list_id}/files`:
  Validate membership via `repo.is_list_member_or_owner(list_id, uid)`.
  Select from `workspace_files wf` joined with `users u` on `wf.user_id = u.id` and left joined with `tasks t` on `wf.task_id = t.id`.
  Filter by `wf.list_id = ? AND wf.is_deleted = 0`.
  Support optional filtering: `if q: ... AND wf.original_name LIKE ?`, `if type: ...`.
  Order by `wf.created_at DESC`.
- `POST /api/lists/{list_id}/files`:
  Validate membership. Read file content, check `MAX_FILE_SIZE`.
  Save to `UPLOAD_DIR` with `f"{uuid.uuid4().hex}{ext}"`.
  Insert into `workspace_files` and return record.
- `GET /api/lists/{list_id}/files/{file_id}/download`:
  Validate membership in `list_id`. Fetch file record where `id = file_id AND list_id = list_id`.
  If not found or `is_deleted = 1`, return 404.
  Serve file via `FileResponse` with safe `original_name`.
- `DELETE /api/lists/{list_id}/files/{file_id}`:
  Validate membership. Check file record.
  Enforce: `uid == file_row["user_id"] or is_owner`. If not, raise 403.
  Set `is_deleted = 1`. If local disk file exists, remove via `os.unlink()`.
  Return `{"success": True, "message": "Berkas berhasil dihapus"}`.

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_workspace_files.py -k test_workspace_files_crud_and_permissions -v`
Expected: PASS.

- [ ] **Step 5: Commit changes**

```bash
git add webapp.py tests/test_workspace_files.py
git commit -m "feat(api): add workspace files CRUD, download, and delete endpoints"
```

---

### Task 3: Task Attachment Auto-Sync & Chat Message File Attachment

**Files:**
- Modify: `webapp.py` (di dalam `upload_attachment`, `get_messages`, dan `post_message`)
- Test: `tests/test_workspace_files.py`

**Interfaces:**
- Consumes: `workspace_files` table, `task_attachments`, `messages`.
- Produces:
  - Otomatis mendaftarkan entri di `workspace_files` saat file diunggah ke task yang memiliki `list_id`.
  - Dukungan payload `file_id` dan `msg_type: "file_attach"` pada `post_message`.
  - Serialisasi detail file (`file_original_name`, `file_size`, `file_mime_type`, `file_is_deleted`) pada `get_messages` dan SSE broadcast.

- [ ] **Step 1: Write test for task attachment auto-sync and chat file attach**

Append to `tests/test_workspace_files.py`:
```python
def test_task_attachment_auto_sync_to_workspace_files(test_client, auth_headers_member, sample_workspace_task_id, sample_shared_list_id):
    # Upload attachment to task in workspace
    res = test_client.post(
        f"/api/tasks/{sample_workspace_task_id}/attachments",
        headers=auth_headers_member,
        files={"file": ("FAT_Report.pdf", io.BytesIO(b"FAT content"), "application/pdf")}
    )
    assert res.status_code == 200

    # Verify it automatically appeared in workspace files
    res = test_client.get(f"/api/lists/{sample_shared_list_id}/files", headers=auth_headers_member)
    assert res.status_code == 200
    files = res.json()
    fat_file = next((f for f in files if f["original_name"] == "FAT_Report.pdf"), None)
    assert fat_file is not None
    assert fat_file["source"] == "task"
    assert fat_file["task_id"] == sample_workspace_task_id

def test_chat_message_with_file_attachment(test_client, auth_headers_member, sample_shared_list_id):
    # Upload a file first
    res = test_client.post(
        f"/api/lists/{sample_shared_list_id}/files",
        headers=auth_headers_member,
        files={"file": ("Doc1.pdf", io.BytesIO(b"Doc1"), "application/pdf")},
        data={"source": "chat"}
    )
    file_id = res.json()["id"]

    # Post message with file_id
    res = test_client.post(
        f"/api/lists/{sample_shared_list_id}/messages",
        headers=auth_headers_member,
        json={
            "content": "Ini dokumen penting",
            "file_id": file_id,
            "msg_type": "file_attach"
        }
    )
    assert res.status_code == 200
    msg = res.json()
    assert msg["file_id"] == file_id
    assert msg["file_original_name"] == "Doc1.pdf"
    assert msg["file_size"] == 4
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_workspace_files.py -k "test_task_attachment_auto_sync or test_chat_message_with_file" -v`
Expected: FAIL.

- [ ] **Step 3: Implement task attachment sync and chat message file fields**

In `webapp.py`:
1. In `upload_attachment`:
   If `task_row["list_id"]`:
   Insert into `workspace_files (list_id, user_id, filename, original_name, file_size, mime_type, source, task_id, is_deleted, created_at)`
2. In `MessageCreate` pydantic model:
   Add `file_id: Optional[int] = None`.
3. In `get_messages` and `post_message`:
   Join `LEFT JOIN workspace_files wf ON wf.id = m.file_id`
   Select `m.file_id, wf.original_name as file_original_name, wf.file_size as file_size, wf.mime_type as file_mime_type, wf.is_deleted as file_is_deleted`.
   In `post_message`: save `req.file_id` into `messages`.

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_workspace_files.py -k "test_task_attachment_auto_sync or test_chat_message_with_file" -v`
Expected: PASS.

- [ ] **Step 5: Commit changes**

```bash
git add webapp.py tests/test_workspace_files.py
git commit -m "feat(api): auto-sync task attachments to workspace files and support chat file_attach"
```

---

### Task 4: Frontend Chat Input Bar Attach Popup File Tab & Preview Chip

**Files:**
- Modify: `static/index.html` (di dalam `AttachPopup` dan `ChatInputBar`)
- Test: `tests/offline/workspace_files_chat.test.js`

**Interfaces:**
- Consumes: `/api/lists/{list_id}/files`, `/api/lists/{list_id}/files` POST.
- Produces:
  - Tab `[ 📁 File ]` di `AttachPopup` dengan pencarian dan tombol `➕ Unggah Berkas Baru`.
  - Preview chip lampiran file di atas `ChatInputBar` dengan tombol batal `✕`.
  - Mengirim `file_id` dan `msg_type: "file_attach"` saat tombol kirim ditekan.

- [ ] **Step 1: Write offline unit test for Chat attach popup and input bar**

Create `tests/offline/workspace_files_chat.test.js`:
```javascript
const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const indexHtml = fs.readFileSync(path.join(__dirname, '../../static/index.html'), 'utf8');

describe('Workspace Files and Chat Attachments UI', () => {
  test('AttachPopup includes File tab and file upload triggers', () => {
    assert.match(indexHtml, /tabBtn\("file",\s*["']📁 File["']\)/);
    assert.match(indexHtml, /Unggah Berkas Baru/);
  });

  test('ChatInputBar supports attachedFile preview and payload file_id', () => {
    assert.match(indexHtml, /attachedFile/);
    assert.match(indexHtml, /msg_type:\s*attachedFile\s*\?\s*["']file_attach["']/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/offline/workspace_files_chat.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement File tab in `AttachPopup` and preview chip in `ChatInputBar`**

In `static/index.html`:
1. In `AttachPopup`:
   Add `tabBtn("file", "📁 File")`.
   In tab `"file"`:
   - Hidden file input `<input type="file" ref={fileInputRef} onChange={handleFileUpload} />`.
   - Button `➕ Unggah Berkas Baru`.
   - Search input for workspace files.
   - List files fetched from `api.get(/api/lists/${list.id}/files)`.
   - On click file, call `onSelectFile(f)`.
2. In `ChatInputBar`:
   - State `attachedFile`, `setAttachedFile`.
   - When file selected: render preview chip above input field:
     `📎 ${attachedFile.original_name} (${formatFileSize(attachedFile.file_size)}) [✕]`.
   - In `handleSend`:
     Include `file_id: attachedFile?.id || null`, `msg_type: attachedFile ? "file_attach" : ...`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/offline/workspace_files_chat.test.js`
Expected: PASS.

- [ ] **Step 5: Verify syntax**

Run: `node scratch/check_inline.js static/index.html`
Expected: 5/5 scripts OK.

- [ ] **Step 6: Commit changes**

```bash
git add static/index.html tests/offline/workspace_files_chat.test.js
git commit -m "feat(ui): add File tab to chat attach popup and attachment preview chip"
```

---

### Task 5: Frontend Chat Bubble File Card (`FileMiniCard`)

**Files:**
- Modify: `static/index.html` (komponen `FileMiniCard` dan pemanggilan di `ChatRoom`)
- Test: `tests/offline/workspace_files_chat.test.js`

**Interfaces:**
- Consumes: `msg.file_id`, `msg.file_original_name`, `msg.file_size`, `msg.file_mime_type`, `msg.file_is_deleted`.
- Produces: Komponen `FileMiniCard` interaktif di bubble chat dengan status normal (pratinjau & unduh) serta status terhapus.

- [ ] **Step 1: Write test for FileMiniCard in offline test suite**

Append to `tests/offline/workspace_files_chat.test.js`:
```javascript
  test('FileMiniCard component handles normal and deleted file states', () => {
    assert.match(indexHtml, /function FileMiniCard\(/);
    assert.match(indexHtml, /BERKAS TELAH DIHAPUS/);
    assert.match(indexHtml, /Pratinjau|Lihat/);
    assert.match(indexHtml, /Unduh/);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/offline/workspace_files_chat.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement `FileMiniCard` and render in `ChatRoom`**

In `static/index.html`:
```javascript
function FileMiniCard({ msg, listId, showToast }) {
  if (!msg?.file_id && msg?.msg_type !== "file_attach") return null;
  const isDeleted = msg.file_is_deleted || !msg.file_original_name;
  if (isDeleted) {
    return React.createElement("div", {
      className: "chat-task-card chat-file-deleted",
      style: { opacity: 0.7, borderStyle: "dashed" }
    },
      React.createElement("div", { style: { fontSize: 11, fontWeight: 700, color: "var(--text-light)" } }, "🗑️ BERKAS TELAH DIHAPUS"),
      React.createElement("div", { style: { fontSize: 12, color: "var(--text-secondary)", marginTop: 2 } }, msg.file_original_name || "Berkas tidak lagi tersedia di workspace")
    );
  }
  const downloadUrl = apiUrl(`/api/lists/${listId || msg.list_id}/files/${msg.file_id}/download`) + (API_BASE && __token ? `?token=${encodeURIComponent(__token)}` : "");
  const ext = (msg.file_original_name || "").split('.').pop().toLowerCase();
  const isPdf = ext === "pdf";
  const isImg = ["png", "jpg", "jpeg", "webp", "gif"].includes(ext);
  const badgeLabel = isPdf ? "📄 PDF" : isImg ? "🖼️ GAMBAR" : ["xlsx", "xls", "csv"].includes(ext) ? "📊 SPREADSHEET" : "📁 BERKAS";

  return React.createElement("div", { className: "chat-task-card" },
    React.createElement("div", { style: { fontSize: 11, fontWeight: 700, color: "var(--accent)", marginBottom: 3 } }, badgeLabel),
    React.createElement("div", { style: { fontSize: 13, fontWeight: 600, color: "var(--text-primary)", wordBreak: "break-all" } }, msg.file_original_name),
    React.createElement("div", { style: { fontSize: 11, color: "var(--text-light)", marginTop: 2 } }, formatFileSize(msg.file_size)),
    React.createElement("div", { style: { display: "flex", gap: 8, marginTop: 8 } },
      (isPdf || isImg) && React.createElement("a", {
        href: downloadUrl,
        target: "_blank",
        rel: "noopener noreferrer",
        className: "btn btn-secondary btn-xs"
      }, "👁️ Pratinjau"),
      React.createElement("a", {
        href: downloadUrl,
        download: msg.file_original_name,
        className: "btn btn-secondary btn-xs"
      }, "⬇️ Unduh")
    )
  );
}
```
In `ChatRoom` bubble rendering:
Render `msg.file_id && React.createElement(FileMiniCard, { msg, listId: list.id, showToast })`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/offline/workspace_files_chat.test.js`
Expected: PASS.

- [ ] **Step 5: Verify syntax**

Run: `node scratch/check_inline.js static/index.html`
Expected: 5/5 scripts OK.

- [ ] **Step 6: Commit changes**

```bash
git add static/index.html tests/offline/workspace_files_chat.test.js
git commit -m "feat(ui): add FileMiniCard to chat room message bubbles"
```

---

### Task 6: Frontend Workspace Tabs & `WorkspaceFilesView`

**Files:**
- Modify: `static/index.html` (di dalam `App` rendering saat `page.startsWith("slist_")` dan komponen baru `WorkspaceFilesView`)
- Test: `tests/offline/workspace_files_chat.test.js`

**Interfaces:**
- Produces:
  - Header tab `[ 📋 Tasks ] [ 📁 Files (N) ]` pada workspace page.
  - Komponen `WorkspaceFilesView` dengan pencarian, filter kategori, pelacakan asal berkas, tombol `➕ Unggah Berkas`, pratinjau, unduh, bagikan ke chat, dan hapus dengan otorisasi.

- [ ] **Step 1: Write test for Workspace Files tab and view**

Append to `tests/offline/workspace_files_chat.test.js`:
```javascript
  test('Workspace page renders Tasks and Files tabs and WorkspaceFilesView', () => {
    assert.match(indexHtml, /workspaceTab/);
    assert.match(indexHtml, /function WorkspaceFilesView\(/);
    assert.match(indexHtml, /Bagikan ke Chat/);
    assert.match(indexHtml, /Hapus berkas ini dari workspace/);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/offline/workspace_files_chat.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement `WorkspaceFilesView` and tab navigation**

In `static/index.html`:
1. In `App`:
   State `const [workspaceTab, setWorkspaceTab] = useState("tasks");` (reset on workspace change).
   In workspace header view: render sub-tab pills:
   `[ 📋 Tasks ]` and `[ 📁 Files ${filesCount ? `(${filesCount})` : ''} ]`.
   If `workspaceTab === "files"`, render `WorkspaceFilesView`.
2. Implement `WorkspaceFilesView({ list, user, showToast, onShareToChat })`:
   - State `files`, `loading`, `query`, `typeFilter`, `uploading`.
   - Top action: `➕ Unggah Berkas` (trigger file input), `Cari berkas...`, filter chips (`Semua`, `PDF`, `Dokumen`, `Gambar`, `Lainnya`).
   - File cards:
     - Icon by type.
     - `original_name`.
     - Metadata: size, provenance badge (`💬 dari Diskusi`, `📌 dari Task "..."`, `📁 Unggahan Langsung`), uploader, date.
     - Actions: `👁️ Pratinjau`, `⬇️ Unduh`, `💬 Bagikan ke Chat` (panggil API post message dan arahkan ke chat), `🗑️ Hapus` (hanya tampil jika `user.id === f.user_id || list.role === "owner"`).

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/offline/workspace_files_chat.test.js`
Expected: PASS.

- [ ] **Step 5: Verify syntax**

Run: `node scratch/check_inline.js static/index.html`
Expected: 5/5 scripts OK.

- [ ] **Step 6: Commit changes**

```bash
git add static/index.html tests/offline/workspace_files_chat.test.js
git commit -m "feat(ui): add workspace Files tab and WorkspaceFilesView component"
```

---

### Task 7: Service Worker Bump & Full Test Suite Verification

**Files:**
- Modify: `static/sw.js` (bump version ke `taskflow-v368-workspace-files`)
- Modify: `tests/offline/*.test.js` (sinkronisasi asersi versi cache SW ke `v368`)
- Test: Full suites (`python -m pytest tests/`, `node --test tests/offline/*.test.js`)

**Interfaces:**
- Produces: Service worker cache version `taskflow-v368-workspace-files` dan validasi regresi 100% hijau.

- [ ] **Step 1: Bump SW version in `static/sw.js`**

Change line 1 in `static/sw.js`:
```javascript
const CACHE = "taskflow-v368-workspace-files";
```

- [ ] **Step 2: Synchronize version assertion in all offline test files**

Update test files in `tests/offline/` asserting `taskflow-v367-...` or earlier to expect `taskflow-v368-workspace-files`.

- [ ] **Step 3: Run SW syntax check**

Run: `node --check static/sw.js`
Expected: OK.

- [ ] **Step 4: Run inline syntax check**

Run: `node scratch/check_inline.js static/index.html`
Expected: 5/5 scripts OK.

- [ ] **Step 5: Run all backend tests**

Run: `python -m pytest tests/`
Expected: All tests PASS.

- [ ] **Step 6: Run all frontend offline tests**

Run: `node --test tests/offline/*.test.js`
Expected: All suites PASS.

- [ ] **Step 7: Commit changes**

```bash
git add static/sw.js tests/offline/
git commit -m "chore(sw): bump cache to v368-workspace-files and sync test assertions"
```
