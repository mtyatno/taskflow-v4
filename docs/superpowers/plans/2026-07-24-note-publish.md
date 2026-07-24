# Note Publish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implementasi fitur publish note — note jadi halaman publik dengan link khusus, password opsional, SEO-friendly, wikilink ke note lain yang juga published.

**Architecture:** Backend (webapp.py): endpoint publik `/pub/{slug}` SSR HTML dengan meta OG + `/pub/{slug}/unlock` password gate dengan 3-lapis bruteforce + `/pub/attachments/{id}`. Endpoint API auth: POST/DELETE `/api/scratchpad/{id}/publish` + GET `/api/scratchpad/published`. Cookie signing via HMAC. Frontend (index.html): tombol Publish di NotePanel toolbar + modal + section "Published Notes" di sidebar NotesPage.

**Tech Stack:** FastAPI, Python stdlib (hmac, hashlib, sqlite3), mistune (markdown server-side), React (frontend existing)

## Global Constraints

- Tidak mengubah `scratchpad_notes` schema
- Tidak mengubah `_note_access_clause` atau existing auth flow
- `hash_password`/`verify_password` existing digunakan untuk password gate
- `WEBAPP_URL` dari `config.py` untuk BASE_URL
- KaTeX bundle existing (`static/vendor/katex/`) digunakan di halaman publik
- Attachment proxy pattern existing diikuti untuk `/pub/attachments/{id}`
- SW cache version harus di-bump (karena index.html berubah)

---

### Task 1: Database — tabel `published_notes`

**Files:**
- Modify: `repository.py` — di dalam `_ensure_tables()` / block CREATE TABLE

**Interfaces:**
- Produces: Tabel `published_notes(note_id, user_id, slug, password_hash, published_at)` + index `idx_published_slug`, `idx_published_user`

- [ ] **Step 1: Tambahkan CREATE TABLE di repository.py**

Buka `repository.py`, cari block terakhir `CREATE TABLE IF NOT EXISTS habit_templates` (sekitar line 426), tambahkan setelahnya:

```python
                # --- Published Notes ---
                CREATE TABLE IF NOT EXISTS published_notes (
                    note_id       INTEGER NOT NULL UNIQUE REFERENCES scratchpad_notes(id) ON DELETE CASCADE,
                    user_id       INTEGER NOT NULL REFERENCES users(id),
                    slug          TEXT NOT NULL UNIQUE,
                    password_hash TEXT,
                    published_at  TEXT NOT NULL
                )
            """)
            conn.execute("CREATE INDEX IF NOT EXISTS idx_published_slug ON published_notes(slug)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_published_user ON published_notes(user_id)")
```

- [ ] **Step 2: Verify migration tidak error**

Run: `python -c "from repository import TaskRepository; r = TaskRepository('taskflow.db'); print('OK')"`
Expected: tidak ada error, tabel `published_notes` terbuat.

- [ ] **Step 3: Commit**

```bash
git add repository.py
git commit -m "feat(publish): add published_notes table + indexes"
```

---

### Task 2: Backend — API endpoints (auth required)

**Files:**
- Modify: `webapp.py` — tambahkan di dekat endpoint scratchpad existing (sekitar line 3370 setelah `toggle_pin_scratchpad`)

**Interfaces:**
- Consumes: `published_notes` table (Task 1), `hash_password`/`verify_password` existing, `get_current_user` existing
- Produces: `POST /api/scratchpad/{id}/publish`, `DELETE /api/scratchpad/{id}/publish`, `GET /api/scratchpad/published`

- [ ] **Step 1: Tambahkan Pydantic model untuk request body**

Di area class definitions (sekitar line 617, setelah `NoteShareReq`):

```python
class PublishReq(BaseModel):
    password: Optional[str] = None  # None/empty = no password
```

- [ ] **Step 2: Tambahkan `generate_slug()` helper**

Di area helpers (sekitar line 2632, dekat `_parse_wikilinks`):

```python
def _generate_publish_slug(conn) -> str:
    """Generate unique 8-char URL-safe slug for published notes."""
    import secrets as _secrets
    for _ in range(999):
        slug = _secrets.token_urlsafe(6)[:8]
        exists = conn.execute("SELECT 1 FROM published_notes WHERE slug = ?", (slug,)).fetchone()
        if not exists:
            return slug
    raise HTTPException(status_code=500, detail="Gagal generate slug unik — coba lagi")
```

- [ ] **Step 3: Tambahkan `POST /api/scratchpad/{note_id}/publish`**

Setelah `toggle_pin_scratchpad` (sekitar line 3390):

```python
@app.post("/api/scratchpad/{note_id}/publish")
async def publish_scratchpad(note_id: int, req: PublishReq, user=Depends(get_current_user)):
    """Publish a note (or update password). Only the note owner can publish."""
    uid = user["sub"]
    now = datetime.now(_TZ_JKT).isoformat()
    with get_db() as conn:
        row = conn.execute(
            "SELECT id, user_id FROM scratchpad_notes WHERE id = ?", (note_id,)
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Note tidak ditemukan")
        if row["user_id"] != uid:
            raise HTTPException(status_code=403, detail="Hanya pemilik note yang bisa publish")
        
        slug = _generate_publish_slug(conn)
        password = (req.password or "").strip()
        pw_hash = hash_password(password) if password else None
        conn.execute(
            """INSERT OR REPLACE INTO published_notes (note_id, user_id, slug, password_hash, published_at)
               VALUES (?, ?, ?, ?, ?)""",
            (note_id, uid, slug, pw_hash, now)
        )
        conn.commit()
        return {"slug": slug, "published_at": now, "password_set": bool(password)}
```

- [ ] **Step 4: Tambahkan `DELETE /api/scratchpad/{note_id}/publish`**

```python
@app.delete("/api/scratchpad/{note_id}/publish")
async def unpublish_scratchpad(note_id: int, user=Depends(get_current_user)):
    """Unpublish a note. Only the note owner can unpublish."""
    uid = user["sub"]
    with get_db() as conn:
        row = conn.execute(
            "SELECT id, user_id FROM scratchpad_notes WHERE id = ?", (note_id,)
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Note tidak ditemukan")
        if row["user_id"] != uid:
            raise HTTPException(status_code=403, detail="Hanya pemilik note yang bisa unpublish")
        conn.execute("DELETE FROM published_notes WHERE note_id = ? AND user_id = ?", (note_id, uid))
        conn.commit()
        return {"ok": True}
```

- [ ] **Step 5: Tambahkan `GET /api/scratchpad/published`**

```python
@app.get("/api/scratchpad/published")
async def list_published(user=Depends(get_current_user)):
    """List all published notes owned by the current user."""
    uid = user["sub"]
    with get_db() as conn:
        rows = conn.execute(
            """SELECT p.note_id, n.title, p.slug, p.password_hash, p.published_at
               FROM published_notes p
               JOIN scratchpad_notes n ON n.id = p.note_id
               WHERE p.user_id = ?
               ORDER BY p.published_at DESC""",
            (uid,)
        ).fetchall()
        return [{
            "note_id": r["note_id"],
            "title": r["title"],
            "slug": r["slug"],
            "password_set": bool(r["password_hash"]),
            "published_at": r["published_at"]
        } for r in rows]
```

- [ ] **Step 6: Verify endpoints**

Run server: `python webapp.py` (atau start ulang taskflow-web di VPS), test dengan curl:

```bash
# Publish note
curl -X POST http://localhost:8080/api/scratchpad/1/publish \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"password": "test123"}'

# List published
curl -H "Authorization: Bearer <token>" http://localhost:8080/api/scratchpad/published

# Unpublish
curl -X DELETE -H "Authorization: Bearer <token>" http://localhost:8080/api/scratchpad/1/publish
```

Expected: publish returns `{slug, published_at, password_set: true}`, list returns array, unpublish returns `{ok: true}`.

- [ ] **Step 7: Commit**

```bash
git add webapp.py
git commit -m "feat(publish): add POST/DELETE /api/scratchpad/{id}/publish + GET /api/scratchpad/published"
```

---

### Task 3: Backend — Bruteforce tracker (in-memory)

**Files:**
- Modify: `webapp.py` — tambahkan di area helpers (dekat `_nc_dav_url` / `_nc_auth` helpers)

**Interfaces:**
- Consumes: `SECRET_KEY` existing, `hashlib`, `time`, `collections.deque`
- Produces: `check_bruteforce(ip, slug) -> None | raise HTTPException`, `record_failed_attempt(ip, slug)`, `reset_bruteforce(ip, slug)`

- [ ] **Step 1: Tambahkan tracker state + functions**

Di area setelah import `from collections import defaultdict` (line 18) dan sebelum `_TZ_JKT`:

```python
from collections import deque
import time as _time

# Brute-force protection for published note unlock
_ip_attempts: dict[str, deque] = defaultdict(lambda: deque(maxlen=50))
_slug_fails: dict[str, dict] = {}       # slug -> {"count": int, "locked_until": float|0}
_progressive: dict[str, dict] = {}      # "ip:slug" -> {"failures": int, "last_attempt": float}

def _cleanup_bruteforce():
    """Remove expired entries from trackers."""
    now = _time.time()
    for ip in list(_ip_attempts):
        while _ip_attempts[ip] and _ip_attempts[ip][0] < now - 900:  # 15 min expiry
            _ip_attempts[ip].popleft()
        if not _ip_attempts[ip]:
            del _ip_attempts[ip]
    for slug in list(_slug_fails):
        sf = _slug_fails[slug]
        if sf.get("locked_until", 0) > 0 and sf["locked_until"] < now:
            del _slug_fails[slug]  # Lock expired — clean up
        elif not sf.get("locked_until") and sf.get("count", 0) == 0:
            del _slug_fails[slug]  # Empty tracker — clean up
    for key in list(_progressive):
        if _progressive[key]["last_attempt"] < now - 1800:  # 30 min expiry
            del _progressive[key]

def _check_bruteforce(ip: str, slug: str):
    """Check rate limits. Raise HTTPException if blocked."""
    _cleanup_bruteforce()  # Lazy cleanup every check
    now = _time.time()
    
    # 1. Progressive delay
    prog_key = f"{ip}:{slug}"
    if prog_key in _progressive:
        p = _progressive[prog_key]
        delay = min(2 ** (p["failures"] - 1), 8)  # 0,1,2,4,8 seconds
        elapsed = now - p["last_attempt"]
        if elapsed < delay:
            import time as _t
            _t.sleep(delay - elapsed)
            now = _time.time()  # refresh after sleep
    
    # 2. IP-based rate limit
    if len(_ip_attempts[ip]) >= 5:
        raise HTTPException(
            status_code=429,
            detail="Terlalu banyak percobaan, coba lagi nanti",
            headers={"Retry-After": str(max(1, int(900 - (now - _ip_attempts[ip][0]))))}
        )
    
    # 3. Slug-based lock
    if slug in _slug_fails:
        sf = _slug_fails[slug]
        if sf.get("locked_until", 0) > now:
            remaining = int(sf["locked_until"] - now)
            raise HTTPException(
                status_code=429,
                detail=f"Halaman ini terkunci sementara, coba lagi dalam {remaining // 60 + 1} menit",
                headers={"Retry-After": str(remaining)}
            )

def _record_failed_attempt(ip: str, slug: str):
    """Record a failed unlock attempt."""
    now = _time.time()
    _ip_attempts[ip].append(now)
    
    sf = _slug_fails.setdefault(slug, {"count": 0, "locked_until": 0})
    sf["count"] += 1
    if sf["count"] >= 10:
        sf["locked_until"] = now + 1800  # 30 min lock
        sf["count"] = 0
    
    prog_key = f"{ip}:{slug}"
    p = _progressive.setdefault(prog_key, {"failures": 0, "last_attempt": 0})
    p["failures"] += 1
    p["last_attempt"] = now

def _reset_bruteforce(ip: str, slug: str):
    """Reset trackers on successful unlock."""
    if ip in _ip_attempts:
        _ip_attempts[ip].clear()
    if slug in _slug_fails:
        del _slug_fails[slug]
    prog_key = f"{ip}:{slug}"
    if prog_key in _progressive:
        del _progressive[prog_key]
```

- [ ] **Step 2: Verifikasi tidak ada import error**

Run: `python -c "from webapp import _check_bruteforce, _record_failed_attempt, _reset_bruteforce; print('OK')"`
Expected: `OK` (tidak crash saat import)

- [ ] **Step 3: Commit**

```bash
git add webapp.py
git commit -m "feat(publish): add in-memory brute-force tracker (IP + slug + progressive delay)"
```

---

### Task 4: Backend — Cookie signing helper (HMAC)

**Files:**
- Modify: `webapp.py` — tambahkan di area helpers (dekat SECRET_KEY)

**Interfaces:**
- Consumes: `SECRET_KEY` existing, `hmac`, `hashlib`
- Produces: `sign_cookie(slug) -> str`, `verify_cookie(signed) -> str|None`

- [ ] **Step 1: Tambahkan import hmac (jika belum ada)**

Di top webapp.py, cek apakah `import hmac` sudah ada. Jika belum, tambahkan di line 10 area:

```python
import hmac
```

- [ ] **Step 2: Tambahkan sign/verify cookie functions**

Di area dekat SECRET_KEY (sekitar line 57-59):

```python
# ── Cookie signing (for published note unlock) ─────────────────────────────────
def _sign_cookie(slug: str) -> str:
    """Sign a slug with HMAC-SHA256 for tamper-proof cookie."""
    h = hmac.new(SECRET_KEY.encode(), slug.encode(), "sha256").hexdigest()[:24]
    return f"{slug}:{h}"

def _verify_cookie(signed: str) -> str | None:
    """Verify HMAC cookie, return slug if valid, None if tampered."""
    try:
        slug, h = signed.rsplit(":", 1)
    except ValueError:
        return None
    expected = hmac.new(SECRET_KEY.encode(), slug.encode(), "sha256").hexdigest()[:24]
    return slug if hmac.compare_digest(h, expected) else None
```

- [ ] **Step 3: Commit**

```bash
git add webapp.py
git commit -m "feat(publish): add HMAC cookie signing for published note unlock"
```

---

### Task 5: Backend — Public HTML endpoints (`/pub/*`)

**Files:**
- Modify: `webapp.py` — tambahkan di area baru setelah endpoint API publish

**Interfaces:**
- Consumes: `published_notes` table (Task 1), `verify_password` existing (line 371), `_check_bruteforce`/`_record_failed_attempt`/`_reset_bruteforce` (Task 3), `_sign_cookie`/`_verify_cookie` (Task 4), `WEBAPP_URL` from config
- Produces: `GET /pub/{slug}`, `POST /pub/{slug}/unlock`, `GET /pub/attachments/{att_id}`

- [ ] **Step 1: Tambahkan markdown-to-HTML pipeline function**

Di area helpers (dekat `_parse_wikilinks`):

```python
def _render_published_content(raw_content: str, conn) -> str:
    """Process raw markdown for public page: strip internal tokens, resolve wikilinks, render to HTML."""
    import re as _re
    content = raw_content or ""
    
    # 1. Strip tasklink tokens
    content = _re.sub(r'\\?\[tasklink:[0-9a-f-]+\]', '', content)
    
    # 2. Strip ==highlight== → render as <mark>
    content = _re.sub(r'==([^=\n]+)==', r'<mark>\1</mark>', content)
    
    # 3. Build wikilink map: title → slug (only for published notes)
    published_map = {}
    for row in conn.execute(
        "SELECT n.title, p.slug FROM published_notes p JOIN scratchpad_notes n ON n.id = p.note_id"
    ).fetchall():
        key = row["title"].strip().lower()
        published_map[key] = row["slug"]
    
    # 4. Rewrite [[wikilink]]
    def _replace_wikilink(m):
        raw = m.group(1).replace('\\(', '(').replace('\\)', ')')
        title = raw.split("|")[0].strip()
        norm = title.strip().lower()
        # Check by title
        if norm in published_map:
            return f'<a href="/pub/{published_map[norm]}">[[{title}]]</a>'
        # Check by id: prefix
        m_id = _re.match(r'^(?:id|note)\s*:\s*(\d+)$', norm, _re.IGNORECASE)
        if m_id:
            row2 = conn.execute(
                "SELECT p.slug FROM published_notes p WHERE p.note_id = ?", (int(m_id.group(1)),)
            ).fetchone()
            if row2:
                return f'<a href="/pub/{row2["slug"]}">[[{title}]]</a>'
        # Check by numeric id
        if norm.isdigit():
            row2 = conn.execute(
                "SELECT p.slug FROM published_notes p WHERE p.note_id = ?", (int(norm),)
            ).fetchone()
            if row2:
                return f'<a href="/pub/{row2["slug"]}">[[{title}]]</a>'
        # Not published → plain text
        return f'[[{title}]]'
    
    content = _re.sub(r'(?:\\?\[){2}([^\[\]\\]+)(?:\\?\]){2}', _replace_wikilink, content)
    
    # 5. Rewrite attachment URLs
    content = _re.sub(
        r'!\[([^\]]*)\]\(/api/scratchpad/attachments/(\d+)/view\)',
        r'![\1](/pub/attachments/\2)',
        content
    )
    
    # 6. Checklist [ ] / [x] → read-only
    content = _re.sub(r'^(\s*)- \[ \]', r'\1- ☐', content, flags=_re.MULTILINE)
    content = _re.sub(r'^(\s*)- \[[xX]\]', r'\1- ☑', content, flags=_re.MULTILINE)
    
    # 7. Render markdown → HTML via mistune
    try:
        import mistune
        md_renderer = mistune.create_markdown(escape=False)
        html = md_renderer(content)
    except ImportError:
        # Fallback: wrap in <pre> if mistune not installed
        escaped = content.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')
        html = f'<pre style="white-space:pre-wrap;font:inherit">{escaped}</pre>'
    
    return html
```

- [ ] **Step 2: Tambahkan `GET /pub/{slug}`**

```python
@app.get("/pub/{slug}")
async def view_published_note(slug: str, request: Request):
    """Public page for a published note. Server-side rendered HTML with OG meta."""
    with get_db() as conn:
        row = conn.execute(
            """SELECT n.title, n.content, n.updated_at, p.published_at, p.password_hash, p.note_id
               FROM published_notes p
               JOIN scratchpad_notes n ON n.id = p.note_id
               WHERE p.slug = ?""",
            (slug,)
        ).fetchone()
        if not row:
            return HTMLResponse(
                content=_NOT_FOUND_HTML,
                status_code=404
            )
        
        # Password gate
        if row["password_hash"]:
            cookie_key = f"pub_unlock_{slug}"
            cookie_val = request.cookies.get(cookie_key, "")
            if not cookie_val or _verify_cookie(cookie_val) != slug:
                # Show password form
                return HTMLResponse(content=_PASSWORD_GATE_HTML.format(
                    slug=slug,
                    error_html=""
                ))
        
        # Render full page
        description = (row["content"] or "")[:200].replace('\n', ' ').strip()
        body_html = _render_published_content(row["content"] or "", conn)
        date_str = datetime.fromisoformat(row["updated_at"] or row["published_at"]).strftime("%d %B %Y")
        
        html = _PUBLIC_PAGE_HTML.format(
            title=row["title"] or "Untitled",
            description=description,
            base_url=WEBAPP_URL,
            slug=slug,
            date=date_str,
            body=body_html
        )
        return HTMLResponse(content=html)
```

- [ ] **Step 3: Tambahkan `POST /pub/{slug}/unlock`**

```python
@app.post("/pub/{slug}/unlock")
async def unlock_published_note(slug: str, request: Request):
    """Verify password for a published note, set signed cookie on success."""
    ip = request.client.host if request.client else "unknown"
    
    # Check brute-force limits
    _check_bruteforce(ip, slug)
    
    with get_db() as conn:
        row = conn.execute(
            "SELECT password_hash FROM published_notes WHERE slug = ?", (slug,)
        ).fetchone()
        if not row or not row["password_hash"]:
            # No password set → redirect to page (shouldn't happen normally)
            return RedirectResponse(url=f"/pub/{slug}", status_code=302)
        
        # Read password from form
        form = await request.form()
        password = (form.get("password") or "").strip()
        
        if not password or not verify_password(password, row["password_hash"]):
            _record_failed_attempt(ip, slug)
            remaining = 5 - len(_ip_attempts.get(ip, deque()))
            return HTMLResponse(content=_PASSWORD_GATE_HTML.format(
                slug=slug,
                error_html=f'<p class="pub-error">Password salah. {max(0, remaining)} percobaan tersisa</p>'
            ))
        
        # Success
        _reset_bruteforce(ip, slug)
        cookie_key = f"pub_unlock_{slug}"
        cookie_val = _sign_cookie(slug)
        response = RedirectResponse(url=f"/pub/{slug}", status_code=302)
        response.set_cookie(
            key=cookie_key,
            value=cookie_val,
            max_age=30 * 24 * 3600,   # 30 days
            httponly=True,
            samesite="lax"
        )
        return response
```

- [ ] **Step 4: Tambahkan `GET /pub/attachments/{att_id}`**

```python
@app.get("/pub/attachments/{att_id}")
async def view_published_attachment(att_id: int):
    """Public attachment view — only if the parent note is published."""
    import requests as _req
    with get_db() as conn:
        att = conn.execute(
            """SELECT a.* FROM note_attachments a
               JOIN published_notes p ON p.note_id = a.note_id
               WHERE a.id = ?""",
            (att_id,)
        ).fetchone()
        if not att:
            raise HTTPException(status_code=404, detail="Attachment tidak ditemukan")
        r = _req.get(_nc_dav_url(att["nextcloud_path"]), auth=_nc_auth(), timeout=30, stream=True)
        if r.status_code != 200:
            raise HTTPException(status_code=404, detail="File tidak ditemukan")
        safe_name = att["original_name"].replace('"', '_').replace('\r', '').replace('\n', '')
        return StreamingResponse(
            r.iter_content(chunk_size=8192),
            media_type=att["mime_type"],
            headers={"Content-Disposition": f'inline; filename="{safe_name}"'}
        )
```

- [ ] **Step 5: Tambahkan HTML template constants**

Di area sebelum endpoint `/pub/*`, tambahkan CSS + HTML template strings:

```python
_PUBLIC_CSS = """<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; line-height: 1.7; color: #1a1a2e; background: #fff; max-width: 720px; margin: 0 auto; padding: 24px 20px 60px; }
  @media (prefers-color-scheme: dark) {
    body { color: #e2e2e2; background: #1a1a2e; }
    a { color: #a8c500; }
    pre, code { background: #2a2a3e; }
    .pub-header, .pub-footer { color: #888; }
    hr { border-color: #333; }
    blockquote { border-left-color: #555; color: #bbb; }
    table th, table td { border-color: #444; }
  }
  .pub-header { font-size: 12px; color: #999; margin-bottom: 24px; }
  .pub-header a { color: inherit; text-decoration: none; }
  .pub-header a:hover { text-decoration: underline; }
  h1 { font-size: 1.8em; margin-bottom: 8px; line-height: 1.3; }
  .pub-date { font-size: 13px; color: #888; margin-bottom: 28px; }
  .pub-body h1, .pub-body h2, .pub-body h3 { margin-top: 1.2em; margin-bottom: 0.4em; }
  .pub-body h2 { font-size: 1.3em; }
  .pub-body h3 { font-size: 1.1em; }
  .pub-body p { margin-bottom: 0.8em; }
  .pub-body a { color: #a8c500; text-decoration: none; }
  .pub-body a:hover { text-decoration: underline; }
  .pub-body pre { background: #f5f5f5; padding: 12px 16px; border-radius: 6px; overflow-x: auto; font-size: 0.9em; margin-bottom: 1em; }
  .pub-body code { font-size: 0.9em; background: #f0f0f0; padding: 2px 5px; border-radius: 3px; }
  .pub-body pre code { background: none; padding: 0; }
  .pub-body blockquote { border-left: 3px solid #ddd; padding-left: 16px; color: #666; margin-bottom: 0.8em; }
  .pub-body ul, .pub-body ol { margin-bottom: 0.8em; padding-left: 1.5em; }
  .pub-body li { margin-bottom: 0.3em; }
  .pub-body table { border-collapse: collapse; width: 100%; margin-bottom: 1em; }
  .pub-body table th, .pub-body table td { border: 1px solid #ddd; padding: 8px 12px; text-align: left; }
  .pub-body table th { background: #f5f5f5; font-weight: 600; }
  .pub-body img { max-width: 100%%; height: auto; border-radius: 4px; }
  .pub-body hr { border: none; border-top: 1px solid #eee; margin: 24px 0; }
  .pub-body mark { background: #fff3b0; color: inherit; padding: 1px 3px; border-radius: 2px; }
  hr { border: none; border-top: 1px solid #eee; margin: 28px 0; }
  .pub-footer { text-align: center; font-size: 12px; color: #999; margin-top: 40px; }
  .pub-footer a { color: inherit; }
  .pub-password { max-width: 360px; margin: 80px auto; text-align: center; }
  .pub-password h1 { font-size: 1.2em; margin-bottom: 16px; }
  .pub-password input { width: 100%%; padding: 10px 14px; border: 1px solid #ddd; border-radius: 6px; font-size: 14px; font-family: inherit; margin-bottom: 10px; }
  .pub-password button { width: 100%%; padding: 10px; background: #a8c500; color: #1a1a2e; border: none; border-radius: 6px; font-size: 14px; font-weight: 600; cursor: pointer; font-family: inherit; }
  .pub-password button:hover { background: #96b000; }
  .pub-error { color: #ef4444; font-size: 13px; margin-top: 6px; }
  .pub-body .math-block, .pub-body .math-inline { /* KaTeX will replace these */ }
</style>"""
```

```python
_PUBLIC_PAGE_HTML = """<!DOCTYPE html>
<html lang="id">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title} — TaskFlow Publish</title>
<meta name="description" content="{description}">
<meta property="og:title" content="{title}">
<meta property="og:description" content="{description}">
<meta property="og:type" content="article">
<meta property="og:url" content="{base_url}/pub/{slug}">
<link rel="stylesheet" href="/static/vendor/katex/katex.min.css">
""" + _PUBLIC_CSS + """
</head>
<body>
<div class="pub-header">🔗 Published via <a href="{base_url}">TaskFlow</a></div>
<h1>{title}</h1>
<div class="pub-date">{date}</div>
<div class="pub-body">{body}</div>
<hr>
<div class="pub-footer">Powered by <a href="{base_url}">TaskFlow</a></div>
<script src="/static/vendor/katex/katex.min.js"></script>
<script src="/static/vendor/katex/auto-render.min.js"></script>
<script>
  try {{
    renderMathInElement(document.body, {{
      delimiters: [
        {{left: '$$', right: '$$', display: true}},
        {{left: '$', right: '$', display: false}}
      ]
    }});
  }} catch(e) {{}}
</script>
</body>
</html>"""
```

```python
_NOT_FOUND_HTML = """<!DOCTYPE html>
<html lang="id">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Not Found — TaskFlow</title>""" + _PUBLIC_CSS + """</head>
<body style="text-align:center;padding-top:80px">
<h1>404</h1>
<p>Halaman tidak ditemukan atau sudah di-unpublish.</p>
</body></html>"""
```

```python
_PASSWORD_GATE_HTML = """<!DOCTYPE html>
<html lang="id">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>🔒 Protected — TaskFlow</title>""" + _PUBLIC_CSS + """</head>
<body>
<div class="pub-password">
  <h1>🔒 Halaman ini dilindungi password</h1>
  <form method="post" action="/pub/{slug}/unlock">
    <input type="password" name="password" placeholder="Masukkan password" autofocus required>
    <button type="submit">Buka</button>
  </form>
  {error_html}
</div>
</body></html>"""
```

- [ ] **Step 6: Verifikasi endpoint publik**

Start server dan test:

```bash
# A. Akses halaman publik note yang sudah di-publish
curl http://localhost:8080/pub/<slug>
# Expected: HTML lengkap dengan meta tags + konten

# B. Akses slug tidak valid
curl http://localhost:8080/pub/nonexist
# Expected: 404 HTML

# C. Akses dengan password gate (jika ada password)
curl -v http://localhost:8080/pub/<slug-with-password>
# Expected: Form password

# D. Unlock dengan password salah
curl -X POST http://localhost:8080/pub/<slug>/unlock -d "password=wrong"
# Expected: Error message

# E. Attachment publik
curl http://localhost:8080/pub/attachments/<id>
```

- [ ] **Step 7: Install mistune**

```bash
pip install mistune
```

Update `requirements.txt`:

```
python-telegram-bot[job-queue]==21.*
python-dotenv==1.*
dateparser==1.*
requests==2.*
trafilatura==1.*
mistune==3.*
```

- [ ] **Step 8: Commit**

```bash
git add webapp.py requirements.txt
git commit -m "feat(publish): add public HTML endpoints /pub/{slug}, /pub/{slug}/unlock, /pub/attachments/{id}"
```

---

### Task 6: Frontend — Publish button + modal di NotePanel

**Files:**
- Modify: `static/index.html` — di dalam `NotePanel` function

**Interfaces:**
- Consumes: `WEBAPP_URL` (dari window atau config global), `fetch` API dengan auth token, `showToast` dari parent
- Note: `NotePanel` harus bisa trigger refresh data `publishedNotes` di `NotesPage` parent. Gunakan callback `onPublishChange` atau window event.

- [ ] **Step 1: Cari cara passing callback dari NotesPage ke NotePanel**

Cek di `NotesPage` tempat render `NotePanel` — cari props `onPin`, `onDelete`, dll yang dipassing. Kita tambahkan `onPublish` dan `publishedNoteMeta`.

Pertama, di `NotesPage`, tambahkan state:

```javascript
const [publishedNotes, setPublishedNotes] = useState([]); // {note_id, slug, password_set, published_at}
```

Tambahkan fetch published notes saat mount:

```javascript
React.useEffect(() => {
  fetch('/api/scratchpad/published', { headers: authHeaders() })
    .then(r => r.json())
    .then(data => setPublishedNotes(Array.isArray(data) ? data : []))
    .catch(() => {});
}, [allNotes]); // re-fetch saat allNotes berubah
```

- [ ] **Step 2: Tambahkan publish handler di NotesPage**

```javascript
const handlePublish = async (noteId, password) => {
  const res = await fetch(`/api/scratchpad/${noteId}/publish`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: password || null })
  });
  if (!res.ok) { const e = await res.json(); throw new Error(e.detail); }
  const data = await res.json();
  // Refresh published list
  const listRes = await fetch('/api/scratchpad/published', { headers: authHeaders() });
  const listData = await listRes.json();
  setPublishedNotes(Array.isArray(listData) ? listData : []);
  return data;
};

const handleUnpublish = async (noteId) => {
  await fetch(`/api/scratchpad/${noteId}/publish`, { method: 'DELETE', headers: authHeaders() });
  setPublishedNotes(prev => prev.filter(p => p.note_id !== noteId));
};
```

- [ ] **Step 3: Tambahkan props ke NotePanel call**

**Note:** `NotePanel` harus menerima props baru `publishedMeta`, `onPublish`, `onUnpublish`. Cek signature existing `function NotePanel({...})` di sekitar line 17965 dan tambahkan props ini. Gunakan pola passing yang sama seperti `onPin`, `onDelete` yang sudah ada. `showToast` sudah tersedia di scope parent (NotesPage) — teruskan sebagai prop jika NotePanel belum menerimanya.

Cari di mana `<NotePanel` di-render di `NotesPage`, tambahkan props:

```javascript
publishedMeta={publishedNotes.find(p => p.note_id === note.id)}
onPublish={(noteId, password) => handlePublish(noteId, password)}
onUnpublish={(noteId) => handleUnpublish(noteId)}
```

- [ ] **Step 4: Di NotePanel, tambahkan state modal publish + Publish button di toolbar**

Di dalam `NotePanel` function, tambahkan state:

```javascript
const [publishOpen, setPublishOpen] = useState(false);
const [publishSlug, setPublishSlug] = useState(publishedMeta?.slug || '');
const [publishPassword, setPublishPassword] = useState('');
const [publishHasPassword, setPublishHasPassword] = useState(publishedMeta?.password_set || false);
const [publishShowPassword, setPublishShowPassword] = useState(false);
const [publishWorking, setPublishWorking] = useState(false);
const [publishError, setPublishError] = useState('');
```

Di toolbar, setelah tombol Pin (line ~18492), tambahkan:

```javascript
/*#__PURE__*/React.createElement("button", {
  onClick: () => {
    const meta = publishedMeta;
    setPublishSlug(meta?.slug || '');
    setPublishHasPassword(meta?.password_set || false);
    setPublishPassword('');
    setPublishError('');
    setPublishOpen(true);
  },
  title: publishedMeta ? "Publish Settings" : "Publish Note",
  style: {
    background: publishedMeta ? "rgba(168,197,0,0.10)" : "none",
    border: publishedMeta ? "1.5px solid var(--accent)" : "1px solid var(--border)",
    borderRadius: 7,
    fontSize: 11,
    fontWeight: 700,
    color: publishedMeta ? "var(--accent)" : "var(--text-light)",
    cursor: "pointer",
    padding: "4px 10px",
    display: "flex",
    alignItems: "center",
    gap: 3
  }
}, publishedMeta?.password_set ? "🔗🔒 Publish" : "🔗 Publish")
```

- [ ] **Step 5: Tambahkan Modal Publish**

Setelah toolbar, buat conditional render modal (mirror pola modal share existing):

```javascript
publishOpen && /*#__PURE__*/React.createElement(ModalOverlay, { onClose: () => setPublishOpen(false) },
  /*#__PURE__*/React.createElement("div", {
    className: "modal",
    style: { maxWidth: 420, padding: 20 }
  }, /*#__PURE__*/React.createElement("h3", { style: { marginTop: 0 } }, "🔗 Publish Note"),
    publishedMeta && /*#__PURE__*/React.createElement(React.Fragment, null,
      /*#__PURE__*/React.createElement("div", { style: { fontSize: 12, color: '#16a34a', marginBottom: 8 } }, "✅ Published"),
      /*#__PURE__*/React.createElement("div", { style: { fontSize: 11, color: 'var(--text-light)', marginBottom: 4 } }, "Link publik:"),
      /*#__PURE__*/React.createElement("div", { style: { display: 'flex', gap: 6, marginBottom: 12 } },
        /*#__PURE__*/React.createElement("input", {
          readOnly: true,
          value: WEBAPP_URL + '/pub/' + publishSlug,
          style: { flex: 1, padding: '6px 10px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 12, fontFamily: 'monospace', background: 'var(--bg-secondary)' }
        }),
        /*#__PURE__*/React.createElement("button", {
          onClick: () => { navigator.clipboard.writeText(WEBAPP_URL + '/pub/' + publishSlug); showToast('Link disalin'); },
          style: { padding: '6px 12px', background: 'var(--accent)', border: 'none', borderRadius: 6, color: '#fff', fontSize: 11, fontWeight: 600, cursor: 'pointer' }
        }, "📋 Copy")
      )
    ),
    /*#__PURE__*/React.createElement("hr", { style: { border: 'none', borderTop: '1px solid var(--border)', margin: '16px 0' } }),
    /*#__PURE__*/React.createElement("div", { style: { fontSize: 11, color: 'var(--text-light)', marginBottom: 4 } }, "Password (opsional):"),
    /*#__PURE__*/React.createElement("div", { style: { display: 'flex', gap: 6, marginBottom: 8 } },
      /*#__PURE__*/React.createElement("input", {
        type: publishShowPassword ? "text" : "password",
        value: publishPassword,
        onChange: e => setPublishPassword(e.target.value),
        placeholder: publishHasPassword ? "•••••• (biarkan kosong = hapus)" : "Kosongkan = tanpa password",
        style: { flex: 1, padding: '6px 10px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 12 }
      }),
      /*#__PURE__*/React.createElement("button", {
        onClick: () => setPublishShowPassword(!publishShowPassword),
        style: { background: 'none', border: '1px solid var(--border)', borderRadius: 6, padding: '4px 8px', cursor: 'pointer', fontSize: 14 }
      }, publishShowPassword ? "🙈" : "👁")
    ),
    publishError && /*#__PURE__*/React.createElement("div", { style: { color: '#ef4444', fontSize: 11, marginBottom: 8 } }, publishError),
    /*#__PURE__*/React.createElement("div", { style: { display: 'flex', gap: 8, justifyContent: 'space-between' } },
      /*#__PURE__*/React.createElement("div", null,
        publishedMeta && /*#__PURE__*/React.createElement("button", {
          onClick: async () => {
            if (!window.confirm('Unpublish note ini? Link publik akan mati.')) return;
            setPublishWorking(true);
            try {
              await onUnpublish(note.id);
              setPublishOpen(false);
              showToast('Note di-unpublish');
            } catch (e) { setPublishError(e.message); }
            setPublishWorking(false);
          },
          disabled: publishWorking,
          style: { background: 'none', border: '1px solid #ef4444', borderRadius: 6, color: '#ef4444', padding: '6px 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }
        }, "🗑️ Unpublish")
      ),
      /*#__PURE__*/React.createElement("button", {
        onClick: async () => {
          setPublishWorking(true);
          setPublishError('');
          try {
            const result = await onPublish(note.id, publishPassword);
            setPublishSlug(result.slug);
            setPublishHasPassword(result.password_set);
            showToast('Note di-publish!');
          } catch (e) { setPublishError(e.message || 'Gagal publish'); }
          setPublishWorking(false);
        },
        disabled: publishWorking,
        style: { padding: '6px 18px', background: 'var(--accent)', border: 'none', borderRadius: 6, color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer' }
      }, publishWorking ? "Menyimpan..." : "💾 Simpan")
    )
  )
)
```

- [ ] **Step 6: Pastikan `WEBAPP_URL` tersedia di frontend**

Cek di `index.html` apakah `WEBAPP_URL` sudah di-inject. Biasanya ada di `<script>` inline di top file. Jika belum ada, tambahkan:

```html
<script>window.WEBAPP_URL = "{{ WEBAPP_URL }}";</script>
```

(Atau pakai pola existing jika sudah ada config injection via template).

- [ ] **Step 7: Commit**

```bash
git add static/index.html
git commit -m "feat(publish): add Publish button + modal in NotePanel toolbar"
```

---

### Task 7: Frontend — Published Notes section di sidebar

**Files:**
- Modify: `static/index.html` — di dalam `NotesPage` function, sidebar area

- [ ] **Step 1: Tambahkan section "🔗 Published" di sidebar**

Di area setelah Tags section (setelah line ~19442, sebelum shared lists), tambahkan:

```javascript
publishedNotes.length > 0 && /*#__PURE__*/React.createElement(React.Fragment, null,
  /*#__PURE__*/React.createElement("div", {
    style: { display: 'flex', alignItems: 'center', gap: 6, padding: '6px 0', cursor: 'pointer', userSelect: 'none' },
    onClick: () => setPublishedOpen(o => !o)
  },
    /*#__PURE__*/React.createElement("span", { style: { fontSize: 14 } }, "🔗"),
    /*#__PURE__*/React.createElement("span", { style: { fontWeight: 600, fontSize: 12, color: 'var(--text-primary)' } }, "Published"),
    /*#__PURE__*/React.createElement("span", { style: { fontSize: 10, color: 'var(--text-light)' } }, "(" + publishedNotes.length + ")"),
    /*#__PURE__*/React.createElement("span", { style: { marginLeft: 'auto', fontSize: 9, color: '#98A2B3' } }, publishedOpen ? '▲' : '▼')
  ),
  publishedOpen && /*#__PURE__*/React.createElement("div", { style: { paddingLeft: 4, marginBottom: 10 } },
    publishedNotes.map(p => /*#__PURE__*/React.createElement("div", {
      key: p.note_id,
      style: { display: 'flex', alignItems: 'center', gap: 4, padding: '3px 6px', borderRadius: 4, cursor: 'pointer', fontSize: 12, color: 'var(--text-secondary)' },
      onMouseEnter: e => { e.currentTarget.style.background = 'var(--bg-primary)'; e.currentTarget.style.color = 'var(--text-primary)'; },
      onMouseLeave: e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-secondary)'; }
    },
      /*#__PURE__*/React.createElement("span", {
        onClick: () => {
          const note = allNotes.find(n => n.id === p.note_id);
          if (note) openTab(note);
        },
        style: { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }
      }, (p.password_set ? "🔒 " : "🔗 ") + (p.title || "Untitled")),
      /*#__PURE__*/React.createElement("span", {
        onClick: () => {
          navigator.clipboard.writeText(WEBAPP_URL + '/pub/' + p.slug);
          showToast('Link disalin');
        },
        title: "Copy link",
        style: { cursor: 'pointer', fontSize: 10, padding: '2px 4px', flexShrink: 0 }
      }, "📋")
    ))
  )
)
```

- [ ] **Step 2: Tambahkan state `publishedOpen`**

Di `NotesPage` state declarations (dekat `tagsOpen`):

```javascript
const [publishedOpen, setPublishedOpen] = useState(true);
```

Pastikan state `publishedNotes` dan `setPublishedNotes` sudah ada (dari Task 6 Step 1).

- [ ] **Step 3: Commit**

```bash
git add static/index.html
git commit -m "feat(publish): add Published Notes section in sidebar"
```

---

### Task 8: Integration — bump SW cache + verify

**Files:**
- Modify: `static/index.html` — bump cache version

- [ ] **Step 1: Bump SW cache version**

Di `static/index.html`, cari `CACHE_VERSION` atau `v` di service worker registration. Bump ke versi berikutnya.

- [ ] **Step 2: Full integration test**

1. Start server: `python webapp.py`
2. Buka browser, login, buat note baru
3. Klik tombol "🔗 Publish" di toolbar note
4. Set password opsional, klik Simpan
5. Copy link, buka di incognito window
6. Verifikasi: halaman tampil, meta tags ada, math jalan, gambar tampil
7. Jika ada password: verifikasi password gate + bruteforce
8. Buka note lain, tambahkan `[[wikilink]]` ke note published
9. Refresh halaman publish: verifikasi wikilink jadi link
10. Unpublish note: verifikasi 404

- [ ] **Step 3: Commit final**

```bash
git add static/index.html
git commit -m "chore: bump SW cache version for publish feature"
```

---

## Implementation Order

```
Task 1 (DB table)
  → Task 2 (API endpoints auth)
    → Task 3 (bruteforce tracker)
    → Task 4 (cookie signing)
    → Task 5 (public HTML endpoints + mistune install)
      → Task 6 (frontend toolbar + modal)
      → Task 7 (frontend sidebar section)
      → Task 8 (integration + bump cache)
```

Tasks 3, 4, 5 bisa dikerjakan bersamaan jika parallel — tapi disarankan sequential karena semuanya di file yang sama (`webapp.py`).
