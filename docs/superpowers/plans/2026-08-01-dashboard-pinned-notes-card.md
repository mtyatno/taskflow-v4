# Dashboard Pinned Notes Card — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add "📌 Notes Disematkan" card to dashboard, above "Prioritas Hari Ini", showing user's pinned notes.

**Architecture:** New API endpoint `GET /api/scratchpad/pinned` (backend) feeds a `pinnedNotes` state in the Dashboard component (frontend). The card reuses the existing `.card` CSS class and follows the same visual pattern as "Prioritas Hari Ini" — single-line rows with pin icon + title + date badge.

**Tech Stack:** Python FastAPI + SQLite (backend), React (frontend, JSX via Babel pre-compile)

## Global Constraints

- Card goes **above** "Prioritas Hari Ini", after scratchpad bar
- Card "📝 Notes Terbaru" stays unchanged
- Max 3 notes visible, rest collapsed with "+N lainnya ▼"
- Empty state: educational message with link to Notes page
- Click row → `onNoteClick(n)` (existing prop, opens note tab)
- Refresh on `noteSaved` custom event

---

### Task 1: Add `GET /api/scratchpad/pinned` endpoint

**Files:**
- Modify: `webapp.py` (insert after `recent_scratchpad` at line ~2958)

**Interfaces:**
- Consumes: `_note_access_clause(uid)` (existing), `_scratchpad_row(row, conn, uid)` (existing), `get_current_user` (existing)
- Produces: `GET /api/scratchpad/pinned` → `Note[]` (same shape as `/api/scratchpad`)

- [ ] **Step 1: Add endpoint in webapp.py**

Insert after `recent_scratchpad` function (after line 2958, before `_NOTE_SELECT`):

```python
@app.get("/api/scratchpad/pinned")
async def pinned_scratchpad(user=Depends(get_current_user)):
    uid = user["sub"]
    access_clause, access_params = _note_access_clause(uid)
    with get_db() as conn:
        rows = conn.execute(f"""
            SELECT s.* FROM scratchpad_notes s
            JOIN note_pins np ON np.note_id = s.id AND np.user_id = ?
            WHERE {access_clause}
            ORDER BY s.updated_at DESC
        """, [uid] + access_params).fetchall()
        return [_scratchpad_row(r, conn, uid) for r in rows]
```

- [ ] **Step 2: Verify endpoint is first in route order**

The `@app.get("/api/scratchpad/pinned")` MUST be defined BEFORE `@app.get("/api/scratchpad/{note_id}")` because FastAPI matches routes in definition order. The `{note_id}` route would capture `"pinned"` as a note_id if it's defined first. Check that `pinned_scratchpad` is placed before `get_scratchpad_note` (which is at line 3339).

Current order (correct):
- Line 2918: `/api/scratchpad` (list)
- Line 2948: `/api/scratchpad/recent`
- **Line 2959+: `/api/scratchpad/pinned` ← NEW, insert here**
- Line 2960: `_NOTE_SELECT`
- Line 2962: `/api/scratchpad/titles`
- Line 3339: `/api/scratchpad/{note_id}` (must stay AFTER pinned)

This placement is safe because it's before `{note_id}`.

- [ ] **Step 3: Test endpoint with curl**

Run TaskFlow locally, then:

```bash
# Login first to get token
curl -s -X POST http://localhost:8000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"test","password":"test"}' -c /tmp/cookies

# Hit pinned endpoint
curl -s http://localhost:8000/api/scratchpad/pinned -b /tmp/cookies | python -m json.tool
```

Expected: JSON array of pinned notes (may be empty `[]` if no notes pinned).

- [ ] **Step 4: Commit**

```bash
git add webapp.py
git commit -m "feat(api): add GET /api/scratchpad/pinned endpoint

Returns notes pinned by the current user, joined from note_pins table,
enriched via _scratchpad_row. Placed before /api/scratchpad/{note_id}
to avoid route conflict."
```

---

### Task 2: Add Pinned Notes card to Dashboard

**Files:**
- Modify: `static/index.html` — Dashboard component (two insertion points)

**Interfaces:**
- Consumes: `api.get("/api/scratchpad/pinned")`, `onNoteClick(n)` (existing prop), `onNav("notes")` (existing prop)
- Produces: Rendered card in Dashboard UI

- [ ] **Step 1: Add `pinnedNotes` state and useEffect**

Find the `recentNotes` state block (near line 10476):

```js
const [recentNotes, setRecentNotes] = useState([]);
```

Add after it:

```js
const [pinnedNotes, setPinnedNotes] = useState([]);
```

Then find the `useEffect` for `recentNotes` (lines 10477-10482):

```js
useEffect(() => {
  api.get("/api/scratchpad/recent").then(setRecentNotes).catch(() => {});
  const handler = () => api.get("/api/scratchpad/recent").then(setRecentNotes).catch(() => {});
  window.addEventListener("noteSaved", handler);
  return () => window.removeEventListener("noteSaved", handler);
}, []);
```

Add a second `useEffect` after it:

```js
useEffect(() => {
  api.get("/api/scratchpad/pinned").then(setPinnedNotes).catch(() => {});
  const handler = () => api.get("/api/scratchpad/pinned").then(setPinnedNotes).catch(() => {});
  window.addEventListener("noteSaved", handler);
  return () => window.removeEventListener("noteSaved", handler);
}, []);
```

- [ ] **Step 2: Insert the Pinned Notes card JSX**

Insert the card after the scratchpad bar IIFE ends and before the "Prioritas Hari Ini" IIFE starts. That means: after `}))` (currently line 10647, end of scratchpad) and before `(() => {` (currently line 10648, start of Prioritas Hari Ini).

The card JSX (using Babel-precompile-style `React.createElement`):

```jsx
/*#__PURE__*/ (() => {
  if (!pinnedNotes || pinnedNotes.length === 0) {
    // Empty state
    return /*#__PURE__*/React.createElement("div", {
      className: "card",
      style: { marginBottom: 28, padding: "18px 22px", textAlign: "center" }
    }, /*#__PURE__*/React.createElement("div", {
      style: { fontSize: 15, fontWeight: 700, marginBottom: 10, textAlign: "left" }
    }, "📌 Notes Disematkan"), /*#__PURE__*/React.createElement("p", {
      style: { fontSize: 13, color: "var(--text-secondary)", margin: "12px 0" }
    }, "Belum ada note yang disematkan."), /*#__PURE__*/React.createElement("span", {
      onClick: () => onNav("notes"),
      style: { fontSize: 13, color: "var(--accent)", cursor: "pointer", fontWeight: 600 }
    }, "Pin note dari halaman Notes & Draw →"));
  }
  const fmtDate = d => {
    if (!d) return "";
    const parts = d.slice(0, 10).split("-");
    const mn = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"][parseInt(parts[1]) - 1];
    return `${parseInt(parts[2])} ${mn}`;
  };
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? pinnedNotes : pinnedNotes.slice(0, 3);
  const hasMore = pinnedNotes.length > 3;
  return /*#__PURE__*/React.createElement("div", {
    className: "card",
    style: { marginBottom: 28, padding: "18px 22px" }
  }, /*#__PURE__*/React.createElement("div", {
    style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }
  }, /*#__PURE__*/React.createElement("div", {
    style: { fontSize: 15, fontWeight: 700, display: "flex", alignItems: "center", gap: 7 }
  }, "📌 Notes Disematkan"), /*#__PURE__*/React.createElement("span", {
    onClick: () => onNav("notes"),
    style: { fontSize: 12, color: "var(--accent)", cursor: "pointer", fontWeight: 600, flexShrink: 0 }
  }, "Lihat semua →")), visible.map((n, i) => /*#__PURE__*/React.createElement(React.Fragment, { key: n.id },
    /*#__PURE__*/React.createElement("div", {
      onClick: () => onNoteClick ? onNoteClick(n) : onNav("notes"),
      style: {
        display: "flex", alignItems: "center", gap: 9,
        padding: "7px 0",
        borderBottom: i < visible.length - 1 || hasMore ? "1px solid var(--border)" : "none",
        cursor: "pointer"
      }
    },
      /*#__PURE__*/React.createElement(Icon, { name: "pin", size: 15, style: { color: "var(--accent)", flexShrink: 0 } }),
      /*#__PURE__*/React.createElement("span", {
        style: { flex: 1, fontSize: 13, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }
      }, n.title || n.content.slice(0, 60)),
      /*#__PURE__*/React.createElement("span", {
        style: { fontSize: 11, flexShrink: 0, color: "var(--text-light)", background: "#f1f5f9", padding: "2px 6px", borderRadius: 4 }
      }, fmtDate(n.updated_at || n.created_at))
    )
  )), hasMore && /*#__PURE__*/React.createElement("div", {
    onClick: () => setExpanded(e => !e),
    style: { fontSize: 12, color: "var(--accent)", marginTop: 8, cursor: "pointer", fontWeight: 600, textAlign: "right" }
  }, expanded ? "Sembunyikan ▲" : `+${pinnedNotes.length - 3} lainnya ▼`));
})()
```

- [ ] **Step 3: Verify the card appears**

Run the app and check:
1. Login, go to Dashboard
2. If no pinned notes → empty state card visible
3. Pin a note from Notes & Draw page
4. Return to Dashboard → pinned note appears in card
5. Click row → navigates to the note in Notes page
6. Click "Lihat semua →" → navigates to Notes page

- [ ] **Step 4: Verify existing cards unchanged**

Confirm these still work correctly:
- "🔴 Prioritas Hari Ini" card appears below the new card
- "📝 Notes Terbaru" card appears below Prioritas Hari Ini
- KPI stat cards, Analytics, Eisenhower, GTD Status all render normally

- [ ] **Step 5: Bump SW cache version**

In `index.html`, find `const SW_VERSION =` and increment the version number.

- [ ] **Step 6: Commit**

```bash
git add static/index.html
git commit -m "feat(dashboard): add pinned notes card above Prioritas Hari Ini

New card shows up to 3 pinned notes with expand/collapse, empty state
with link to Notes page. Uses new /api/scratchpad/pinned endpoint.
Refreshes on noteSaved event."
```
