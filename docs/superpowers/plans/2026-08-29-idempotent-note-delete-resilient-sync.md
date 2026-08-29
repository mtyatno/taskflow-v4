# Idempotent Note Delete and Resilient Outbox Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix `DELETE /api/scratchpad/{note_id}` on the server to be idempotent and safe, and enhance `syncpush.js` outbox processing so server errors on single operations do not block the entire outbox queue.

**Architecture:**
1. In `webapp.py` (`delete_scratchpad`):
   - Make `DELETE /api/scratchpad/{note_id}` idempotent. If `note_id` is not found, return `{"ok": True, "detail": "Note already deleted"}` instead of raising 403 or 500.
   - Clean up all related table rows (`entity_tags`, `note_pins`, `published_notes`, `note_attachments`).
2. In `static/offline/syncpush.js`:
   - In `send(transport, ...)`: HTTP 500 is a server response (device is online), so set `e.__network = false` and `e.status = res.status`.
   - In `pushOutbox`: Only stop the queue on true network disconnections (`err.__network === true`). When a specific entity operation returns 5xx or fails, mark `result.failed++` without aborting unrelated outbox operations.
   - In delete handlers (`opNoteDelete`, `opDelete`, `opHabitDelete`, etc.): Treat 404 and 200 as successful removal and clean up local records/idmap.
3. In `static/sw.js`:
   - Bump Service Worker cache name to `taskflow-v326-idempotent-note-delete-resilient-sync`.
4. Unit Tests:
   - Add Python test in `tests/test_scratchpad.py` validating idempotent note deletion and cleanup.
   - Add JS offline tests in `tests/offline/notesync_autoheal.test.js` or `tests/offline/syncpush_resilience.test.js` verifying that a failing 500 delete op does not block subsequent note create ops in the outbox.

**Tech Stack:** FastAPI, SQLite, React, IndexedDB (`db.js`, `outbox.js`, `syncpush.js`), Node.js test runner, Pytest.

## Global Constraints
- All 594+ offline JS tests must pass.
- All 57+ Pytest backend tests must pass.
- Keep CRLF line endings consistent on Windows.

---

### Task 1: Add Unit Tests for Idempotent Note Deletion and Outbox Resilience
**Files:**
- Modify: `tests/test_scratchpad.py`
- Modify: `tests/offline/notesync_autoheal.test.js`

**Interfaces:**
- Consumes: `webapp.py`, `static/offline/syncpush.js`
- Produces: Test coverage for idempotent delete and non-blocking outbox push

- [ ] **Step 1: Write backend tests in `tests/test_scratchpad.py`**
Test deleting an existing note, deleting an already deleted note (idempotent 200), and deleting a non-existent note.

- [ ] **Step 2: Write offline JS resilience tests in `tests/offline/notesync_autoheal.test.js`**
Test that if one outbox op encounters a server 500 error, subsequent note create operations in outbox are still processed.

- [ ] **Step 3: Run tests to verify failure on unpatched code**
Run: `python -m pytest tests/test_scratchpad.py` and `node --test tests/offline/notesync_autoheal.test.js`

---

### Task 2: Implement Idempotent Deletion in `webapp.py`, Resilient Outbox in `static/offline/syncpush.js`, and Bump SW
**Files:**
- Modify: `webapp.py`
- Modify: `static/offline/syncpush.js`
- Modify: `static/sw.js`

**Interfaces:**
- Consumes: `delete_scratchpad`, `send`, `pushOutbox`
- Produces: Safe idempotent backend note delete and non-blocking client outbox queue

- [ ] **Step 1: Update `delete_scratchpad` in `webapp.py`**
```python
@app.delete("/api/scratchpad/{note_id}")
async def delete_scratchpad(note_id: int, user=Depends(get_current_user)):
    uid = user["sub"]
    with get_db() as conn:
        row = conn.execute("SELECT id, user_id FROM scratchpad_notes WHERE id = ?", (note_id,)).fetchone()
        if not row:
            return {"ok": True, "detail": "Note already deleted"}
        if row["user_id"] != uid:
            raise HTTPException(status_code=403, detail="Hanya pemilik yang bisa menghapus catatan ini")
        conn.execute("DELETE FROM entity_tags WHERE entity_type='note' AND entity_id=?", (note_id,))
        conn.execute("DELETE FROM note_pins WHERE note_id=?", (note_id,))
        conn.execute("DELETE FROM published_notes WHERE note_id=?", (note_id,))
        conn.execute("DELETE FROM note_attachments WHERE note_id=?", (note_id,))
        conn.execute("DELETE FROM scratchpad_notes WHERE id = ?", (note_id,))
        conn.commit()
    return {"ok": True}
```

- [ ] **Step 2: Update `send` and `pushOutbox` in `static/offline/syncpush.js`**
Ensure `send` sets `e.__network = false` on 5xx responses, and `pushOutbox` only halts on true network disconnections (`err.__network === true`).

- [ ] **Step 3: Bump Service Worker cache in `static/sw.js`**
Bump to `taskflow-v326-idempotent-note-delete-resilient-sync`.

- [ ] **Step 4: Run full test suite and syntax verification**
Run:
- `node scratch/check_inline.js static/index.html`
- `node --check static/sw.js`
- `node --test tests/offline/*.test.js`
- `python -m pytest tests/`
