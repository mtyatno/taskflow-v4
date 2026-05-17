# Browser Clipper Extension — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Browser extension (Chrome + Firefox) yang memungkinkan user men-clip halaman web ke TaskFlow Notes dengan tag `#bookmark` dalam 1 klik.

**Architecture:** Backend menambah tabel `ext_tokens` + 4 endpoint auth baru di `webapp.py`. SPA mendapat overlay ext-auth dan section settings. Extension adalah project Vite terpisah (`taskflow-clipper/`) yang memanggil `POST /api/scratchpad` menggunakan JWT long-lived.

**Tech Stack:** FastAPI (backend), React JSX in single HTML (frontend SPA), Vite + webextension-polyfill (extension), SQLite (ext_tokens table)

**Spec:** `docs/superpowers/specs/2026-05-18-browser-clipper-design.md`

---

## File Map

### Dimodifikasi (TaskFlow repo)
- `webapp.py` — tambah `ext_tokens` migration, 4 endpoint `/api/ext-auth/*`, revocation check di `get_current_user`
- `static/index.html` — tambah ext-auth overlay di `App` component, tambah "Browser Clipper" section di `SettingsPage`

### Dibuat baru (project terpisah `taskflow-clipper/` di luar repo TaskFlow)
- `taskflow-clipper/package.json`
- `taskflow-clipper/vite.config.js`
- `taskflow-clipper/manifest.chrome.json` — MV3
- `taskflow-clipper/manifest.firefox.json` — MV2
- `taskflow-clipper/src/popup.html`
- `taskflow-clipper/src/popup.js`
- `taskflow-clipper/src/background.js`
- `taskflow-clipper/src/content.js`
- `taskflow-clipper/src/options.html`
- `taskflow-clipper/src/options.js`

### Test
- `test_ext_auth.py` — integration test backend endpoints

---

## Task 1: Backend — ext_tokens migration

**Files:**
- Modify: `webapp.py` — fungsi `migrate_db()`

- [ ] **Step 1: Tambah blok CREATE TABLE ext_tokens di akhir migrate_db()**

  Temukan akhir fungsi `migrate_db()` (sekitar baris 268, setelah blok `note_templates`). Tambahkan blok ini sebelum penutup fungsi:

  ```python
      # Create ext_tokens table (browser clipper auth)
      conn = sqlite3.connect(DB_PATH)
      conn.row_factory = sqlite3.Row
      try:
          conn.execute("""
              CREATE TABLE IF NOT EXISTS ext_tokens (
                  id         INTEGER PRIMARY KEY AUTOINCREMENT,
                  user_id    INTEGER NOT NULL,
                  token      TEXT,
                  state      TEXT UNIQUE,
                  created_at TEXT NOT NULL,
                  expires_at TEXT NOT NULL
              )
          """)
          conn.execute("CREATE INDEX IF NOT EXISTS idx_ext_tokens_state ON ext_tokens(state)")
          conn.execute("CREATE INDEX IF NOT EXISTS idx_ext_tokens_user  ON ext_tokens(user_id)")
          conn.commit()
      finally:
          conn.close()
  ```

- [ ] **Step 2: Restart service dan verifikasi tabel terbuat**

  ```bash
  sudo systemctl restart taskflow-web
  sqlite3 /home/yatno/todo-system/taskflow-v4/taskflow.db ".schema ext_tokens"
  ```

  Expected output:
  ```
  CREATE TABLE ext_tokens (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id    INTEGER NOT NULL,
      token      TEXT,
      state      TEXT UNIQUE,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
  );
  ```

- [ ] **Step 3: Commit**

  ```bash
  git add webapp.py
  git commit -m "feat: add ext_tokens table migration for browser clipper"
  ```

---

## Task 2: Backend — ext-auth endpoints + revocation check

**Files:**
- Modify: `webapp.py` — fungsi `get_current_user`, tambah 4 endpoint baru

- [ ] **Step 1: Tambah helper create_ext_token di bawah create_token (sekitar baris 294)**

  ```python
  def create_ext_token(user_id: int, username: str) -> str:
      payload = {
          "sub": str(user_id),
          "username": username,
          "scope": "ext",
          "exp": datetime.utcnow() + timedelta(days=30),
      }
      return jwt.encode(payload, SECRET_KEY, algorithm=JWT_ALGORITHM)
  ```

- [ ] **Step 2: Tambah revocation check di get_current_user**

  Temukan `get_current_user` (sekitar baris 308). Setelah baris `data["sub"] = int(data["sub"])`, tambahkan:

  ```python
      if data.get("scope") == "ext":
          with get_db() as conn:
              row = conn.execute(
                  "SELECT id FROM ext_tokens WHERE token = ?", (token,)
              ).fetchone()
          if not row:
              raise HTTPException(status_code=401, detail="Token sudah direvoke")
  ```

- [ ] **Step 3: Tambah Pydantic model untuk confirm request (di blok schema, sekitar baris 470)**

  ```python
  class ExtAuthConfirmReq(BaseModel):
      state: str
  ```

- [ ] **Step 4: Tambah 4 endpoint ext-auth (letakkan setelah endpoint /api/auth/logout)**

  Cari endpoint logout (`@app.post("/api/auth/logout")`), lalu tambahkan blok berikut di bawahnya:

  ```python
  @app.post("/api/ext-auth/begin")
  async def ext_auth_begin():
      """Extension panggil ini untuk mulai auth flow. Return state UUID."""
      state = str(uuid.uuid4())
      now = datetime.now(_TZ_JKT).isoformat()
      expires = (datetime.now(_TZ_JKT) + timedelta(minutes=5)).isoformat()
      with get_db() as conn:
          conn.execute(
              "INSERT INTO ext_tokens (user_id, token, state, created_at, expires_at) VALUES (0, NULL, ?, ?, ?)",
              (state, now, expires)
          )
      return {"state": state}


  @app.get("/api/ext-auth/poll")
  async def ext_auth_poll(state: str = Query(...)):
      """Extension poll ini setiap 2 detik sampai token tersedia."""
      with get_db() as conn:
          row = conn.execute(
              "SELECT token, expires_at FROM ext_tokens WHERE state = ?", (state,)
          ).fetchone()
      if not row:
          raise HTTPException(status_code=404, detail="State tidak ditemukan atau sudah expired")
      # Cek apakah state sudah expired
      try:
          exp = datetime.fromisoformat(row["expires_at"])
          if datetime.now(_TZ_JKT) > exp.replace(tzinfo=_TZ_JKT):
              raise HTTPException(status_code=410, detail="State expired")
      except (ValueError, TypeError):
          pass
      if row["token"] is None:
          return {"pending": True}
      return {"token": row["token"]}


  @app.post("/api/ext-auth/confirm")
  async def ext_auth_confirm(req: ExtAuthConfirmReq, user=Depends(get_current_user)):
      """User (sudah login webapp) approve extension. Generate token."""
      uid = user["sub"]
      with get_db() as conn:
          row = conn.execute(
              "SELECT id, token, expires_at FROM ext_tokens WHERE state = ?", (req.state,)
          ).fetchone()
          if not row:
              raise HTTPException(status_code=404, detail="State tidak ditemukan")
          if row["token"] is not None:
              raise HTTPException(status_code=409, detail="State sudah diklaim")
          # Cek apakah state expired
          try:
              exp = datetime.fromisoformat(row["expires_at"])
              if datetime.now(_TZ_JKT) > exp.replace(tzinfo=_TZ_JKT):
                  raise HTTPException(status_code=410, detail="State expired")
          except (ValueError, TypeError):
              pass
          # Generate token, update created_at menjadi now, expires_at +30 hari
          username = user.get("username", "")
          token = create_ext_token(uid, username)
          now = datetime.now(_TZ_JKT).isoformat()
          expires = (datetime.now(_TZ_JKT) + timedelta(days=30)).isoformat()
          conn.execute(
              "UPDATE ext_tokens SET token = ?, user_id = ?, state = NULL, created_at = ?, expires_at = ? WHERE id = ?",
              (token, uid, now, expires, row["id"])
          )
      return {"ok": True}


  @app.delete("/api/ext-auth/revoke")
  async def ext_auth_revoke(user=Depends(get_current_user)):
      """User revoke semua ext tokens miliknya."""
      uid = user["sub"]
      with get_db() as conn:
          conn.execute("DELETE FROM ext_tokens WHERE user_id = ? AND token IS NOT NULL", (uid,))
      return {"ok": True}
  ```

- [ ] **Step 5: Restart service**

  ```bash
  sudo systemctl restart taskflow-web
  ```

- [ ] **Step 6: Smoke test manual**

  ```bash
  # Test begin
  curl -s -X POST http://localhost:8080/api/ext-auth/begin | python3 -m json.tool
  # Expected: {"state": "<uuid>"}

  # Test poll dengan state yang baru dibuat
  STATE=$(curl -s -X POST http://localhost:8080/api/ext-auth/begin | python3 -c "import sys,json; print(json.load(sys.stdin)['state'])")
  curl -s "http://localhost:8080/api/ext-auth/poll?state=$STATE" | python3 -m json.tool
  # Expected: {"pending": true}
  ```

- [ ] **Step 7: Commit**

  ```bash
  git add webapp.py
  git commit -m "feat: add ext-auth endpoints and token revocation for browser clipper"
  ```

---

## Task 3: Backend — integration test

**Files:**
- Create: `test_ext_auth.py`

- [ ] **Step 1: Tulis test file**

  ```python
  import requests, json

  BASE = "http://localhost:8080"
  s = requests.Session()

  # Login dulu
  r = s.post(f"{BASE}/api/auth/login", json={"username": "admin", "password": "admin123"})
  assert r.status_code == 200, f"Login failed: {r.text}"
  token = r.json()["access_token"]
  s.headers["Authorization"] = f"Bearer {token}"

  # 1. Begin — dapat state
  r = requests.post(f"{BASE}/api/ext-auth/begin")
  assert r.status_code == 200, f"begin failed: {r.text}"
  state = r.json()["state"]
  assert len(state) == 36, f"state bukan UUID: {state}"
  print("begin: OK", state[:8])

  # 2. Poll sebelum confirm — harus pending
  r = requests.get(f"{BASE}/api/ext-auth/poll", params={"state": state})
  assert r.status_code == 200, f"poll failed: {r.text}"
  assert r.json().get("pending") is True, f"expected pending: {r.json()}"
  print("poll pending: OK")

  # 3. Confirm — pakai session yang sudah login
  r = s.post(f"{BASE}/api/ext-auth/confirm", json={"state": state})
  assert r.status_code == 200, f"confirm failed: {r.text}"
  print("confirm: OK")

  # 4. Poll setelah confirm — harus dapat token
  r = requests.get(f"{BASE}/api/ext-auth/poll", params={"state": state})
  assert r.status_code == 200, f"poll after confirm failed: {r.text}"
  ext_token = r.json().get("token")
  assert ext_token, f"token tidak ada: {r.json()}"
  print("poll with token: OK", ext_token[:20], "...")

  # 5. Pakai ext token untuk clip note
  clip_headers = {"Authorization": f"Bearer {ext_token}"}
  r = requests.post(f"{BASE}/api/scratchpad", json={
      "title": "Test Clip — GitHub",
      "content": "**Source:** https://github.com\n\n> Social coding platform",
      "tags": ["bookmark"]
  }, headers=clip_headers)
  assert r.status_code == 200, f"clip failed: {r.text}"
  note_id = r.json()["id"]
  assert note_id, f"note id tidak ada: {r.json()}"
  print("clip note: OK", note_id)

  # 6. Poll dengan state yang sudah NULL — harus 404
  r = requests.get(f"{BASE}/api/ext-auth/poll", params={"state": state})
  assert r.status_code == 404, f"expected 404 after claim: {r.status_code}"
  print("poll after claim: OK (404)")

  # 7. Revoke
  r = requests.delete(f"{BASE}/api/ext-auth/revoke", headers=clip_headers)
  assert r.status_code == 200, f"revoke failed: {r.text}"
  print("revoke: OK")

  # 8. Clip setelah revoke — harus 401
  r = requests.post(f"{BASE}/api/scratchpad", json={
      "title": "Should fail",
      "content": "test",
      "tags": ["bookmark"]
  }, headers=clip_headers)
  assert r.status_code == 401, f"expected 401 after revoke: {r.status_code}"
  print("clip after revoke: OK (401)")

  # Cleanup: hapus note test
  s.delete(f"{BASE}/api/scratchpad/{note_id}")
  print("\nALL PASSED ✓")
  ```

- [ ] **Step 2: Jalankan test (server harus running)**

  ```bash
  python3 test_ext_auth.py
  ```

  Expected:
  ```
  begin: OK <8-char uuid prefix>
  poll pending: OK
  confirm: OK
  poll with token: OK eyJhbGciOiJIUzI1NiIs...
  clip note: OK <note_id>
  poll after claim: OK (404)
  revoke: OK
  clip after revoke: OK (401)

  ALL PASSED ✓
  ```

- [ ] **Step 3: Commit**

  ```bash
  git add test_ext_auth.py
  git commit -m "test: add integration test for ext-auth flow"
  ```

---

## Task 4: SPA — ext-auth overlay

**Files:**
- Modify: `static/index.html`

Tujuan: Saat user membuka `https://todo.yatno.web.id/?ext_auth=1&state=<uuid>`, SPA menampilkan overlay "Authorize Browser Clipper?" alih-alih konten normal.

- [ ] **Step 1: Tambah ExtAuthOverlay component**

  Di `static/index.html`, cari `function SettingsPage` (baris ~7794). Tambahkan component baru tepat di atas `function SettingsPage`:

  ```jsx
  function ExtAuthOverlay({ state, user, showToast, onDone }) {
    const [loading, setLoading] = React.useState(false);
    const [done, setDone] = React.useState(false);

    const handleAuthorize = async () => {
      setLoading(true);
      try {
        await api.post("/api/ext-auth/confirm", { state });
        setDone(true);
        showToast("Browser Clipper berhasil diotorisasi ✅");
      } catch (err) {
        showToast(err.message || "Gagal", "error");
      }
      setLoading(false);
    };

    return (
      <div style={{
        position: "fixed", inset: 0, background: "var(--bg-page)",
        display: "flex", alignItems: "center", justifyContent: "center",
        zIndex: 9999, padding: 24
      }}>
        <div className="card" style={{ maxWidth: 420, width: "100%", textAlign: "center" }}>
          {done ? (
            <div>
              <div style={{ fontSize: 48, marginBottom: 12 }}>✅</div>
              <div style={{ fontWeight: 700, fontSize: 18, marginBottom: 8 }}>Berhasil!</div>
              <div style={{ fontSize: 14, color: "var(--text-secondary)", marginBottom: 20 }}>
                Browser Clipper sudah terhubung. Kamu bisa tutup tab ini.
              </div>
              <button className="btn btn-primary" onClick={() => window.close()}>
                Tutup Tab
              </button>
            </div>
          ) : (
            <div>
              <div style={{ fontSize: 48, marginBottom: 12 }}>📎</div>
              <div style={{ fontWeight: 700, fontSize: 18, marginBottom: 8 }}>Authorize Browser Clipper?</div>
              <div style={{ fontSize: 14, color: "var(--text-secondary)", marginBottom: 6 }}>
                Login sebagai <strong>{user?.username}</strong>
              </div>
              <div style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 24 }}>
                Extension akan mendapatkan akses untuk menyimpan halaman web ke Notes kamu dengan tag #bookmark.
              </div>
              <button
                className="btn btn-primary"
                style={{ width: "100%", marginBottom: 10 }}
                onClick={handleAuthorize}
                disabled={loading}
              >
                {loading ? "Memproses..." : "✅ Authorize"}
              </button>
              <button className="btn" style={{ width: "100%" }} onClick={() => window.close()}>
                Batal
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }
  ```

- [ ] **Step 2: Deteksi state di App component**

  Di `App` component, cari blok `useState` untuk `pendingJoinCode` (sekitar baris 12331). Tambahkan tepat setelah blok `pendingJoinCode`:

  ```jsx
  const [extAuthState, setExtAuthState] = React.useState(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("ext_auth") === "1" ? (params.get("state") || "") : "";
  });
  ```

- [ ] **Step 3: Render overlay di App**

  Di `App` component, cari `return (` bagian render utama (sekitar baris 12868). Tambahkan di dalam `return`, tepat setelah tag `<div>` pembuka dan sebelum `<Sidebar`:

  ```jsx
  {extAuthState && user && (
    <ExtAuthOverlay
      state={extAuthState}
      user={user}
      showToast={showToast}
      onDone={() => setExtAuthState("")}
    />
  )}
  ```

- [ ] **Step 4: Compile JSX**

  Di folder project TaskFlow (Windows lokal):
  ```bash
  node compile.js
  ```

  Expected: `Done — written to static/index.html`

- [ ] **Step 5: Test manual**

  1. Buka `http://localhost:8080` di browser, pastikan sudah login
  2. Buka `http://localhost:8080/?ext_auth=1&state=test-state-123`
  3. Harus muncul overlay "Authorize Browser Clipper?"
  4. Klik Authorize → muncul error 404 (state tidak ada) — ini normal untuk test manual
  5. Overlay muncul dengan UI yang benar — PASS

- [ ] **Step 6: Commit**

  ```bash
  git add static/index.html
  git commit -m "feat: add ext-auth overlay to SPA for browser clipper authorization"
  ```

---

## Task 5: SPA — Settings browser clipper section

**Files:**
- Modify: `static/index.html` — `SettingsPage` component

- [ ] **Step 1: Tambah state untuk ext token di SettingsPage**

  Di `function SettingsPage` (sekitar baris 7794), tambahkan state baru di blok `useState`:

  ```jsx
  const [extToken, setExtToken] = useState(null);  // {created_at, expires_at} | null | "loading"
  const [extRevoking, setExtRevoking] = useState(false);
  ```

- [ ] **Step 2: Tambah useEffect fetch ext token status**

  Di `SettingsPage`, di bawah blok state declarations, tambahkan:

  ```jsx
  useEffect(() => {
    setExtToken("loading");
    api.get("/api/ext-auth/status")
      .then(data => setExtToken(data.token || null))
      .catch(() => setExtToken(null));
  }, []);
  ```

- [ ] **Step 3: Tambah endpoint GET /api/ext-auth/status di webapp.py**

  Di `webapp.py`, di bawah endpoint `ext_auth_revoke`, tambahkan:

  ```python
  @app.get("/api/ext-auth/status")
  async def ext_auth_status(user=Depends(get_current_user)):
      """Return info token aktif milik user, tanpa expose token value."""
      uid = user["sub"]
      with get_db() as conn:
          row = conn.execute(
              "SELECT created_at, expires_at FROM ext_tokens WHERE user_id = ? AND token IS NOT NULL ORDER BY created_at DESC LIMIT 1",
              (uid,)
          ).fetchone()
      if not row:
          return {"token": None}
      return {"token": {"created_at": row["created_at"], "expires_at": row["expires_at"]}}
  ```

- [ ] **Step 4: Tambah handler revoke di SettingsPage**

  Di `SettingsPage`, tambahkan fungsi handleRevokeExt:

  ```jsx
  const handleRevokeExt = async () => {
    if (!confirm("Revoke semua token Browser Clipper? Extension perlu connect ulang.")) return;
    setExtRevoking(true);
    try {
      await api.delete("/api/ext-auth/revoke");
      setExtToken(null);
      showToast("Token Browser Clipper berhasil direvoke ✅");
    } catch (err) {
      showToast(err.message, "error");
    }
    setExtRevoking(false);
  };
  ```

- [ ] **Step 5: Tambah card Browser Clipper di return SettingsPage**

  Di `SettingsPage` return, cari section Telegram card (sekitar `<div className="card">`). Tambahkan card baru setelah Telegram card, sebelum Backup & Export:

  ```jsx
  <div className="card" style={{ marginBottom: 20, marginTop: 20 }}>
    <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 4 }}>Browser Clipper</div>
    <div style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 14 }}>
      Extension browser untuk menyimpan halaman web ke Notes dengan tag #bookmark.
    </div>
    {extToken === "loading" ? (
      <div style={{ fontSize: 13, color: "var(--text-secondary)" }}>Memuat...</div>
    ) : extToken ? (
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
          <span style={{ fontSize: 20 }}>✅</span>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600 }}>Token aktif</div>
            <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>
              Dibuat: {new Date(extToken.created_at).toLocaleDateString("id-ID")} · 
              Expired: {new Date(extToken.expires_at).toLocaleDateString("id-ID")}
            </div>
          </div>
        </div>
        <button className="btn btn-danger btn-sm" onClick={handleRevokeExt} disabled={extRevoking}>
          {extRevoking ? "Merevoking..." : "🗑 Revoke Token"}
        </button>
      </div>
    ) : (
      <div style={{ fontSize: 13, color: "var(--text-secondary)" }}>
        Belum ada token aktif. Connect dari extension untuk memulai.
      </div>
    )}
  </div>
  ```

- [ ] **Step 6: Restart backend (karena webapp.py berubah), lalu compile JSX**

  ```bash
  sudo systemctl restart taskflow-web
  node compile.js
  ```

- [ ] **Step 7: Test manual**

  1. Buka Settings page
  2. Scroll ke section "Browser Clipper"
  3. Harus tampil "Belum ada token aktif"
  4. Jalankan `test_ext_auth.py` (partial — sampai step confirm)
  5. Refresh Settings → harus tampil "Token aktif" dengan tanggal
  6. Klik "Revoke Token" → kembali ke "Belum ada token aktif"

- [ ] **Step 8: Commit**

  ```bash
  git add static/index.html webapp.py
  git commit -m "feat: add browser clipper settings section and ext-auth status endpoint"
  ```

---

## Task 6: Extension — Project setup

**Files:**
- Create: `taskflow-clipper/package.json`
- Create: `taskflow-clipper/vite.config.js`
- Create: `taskflow-clipper/manifest.chrome.json`
- Create: `taskflow-clipper/manifest.firefox.json`

Buat folder `taskflow-clipper/` di luar folder `taskflow-v4/` (bukan di dalam repo TaskFlow).

- [ ] **Step 1: Init project**

  ```bash
  mkdir taskflow-clipper && cd taskflow-clipper
  npm init -y
  npm install --save-dev vite webextension-polyfill
  mkdir src
  ```

- [ ] **Step 2: Buat vite.config.js**

  ```js
  import { defineConfig } from 'vite';
  import { resolve } from 'path';
  import { copyFileSync, mkdirSync, existsSync } from 'fs';

  export default defineConfig(({ mode }) => {
    const browser = process.env.BROWSER || 'chrome';
    const outDir = `dist/${browser}`;

    return {
      build: {
        outDir,
        emptyOutDir: true,
        rollupOptions: {
          input: {
            popup:      resolve(__dirname, 'src/popup.html'),
            options:    resolve(__dirname, 'src/options.html'),
            background: resolve(__dirname, 'src/background.js'),
            content:    resolve(__dirname, 'src/content.js'),
          },
          output: {
            entryFileNames: '[name].js',
            chunkFileNames: '[name].js',
            assetFileNames: '[name].[ext]',
          },
        },
      },
      plugins: [{
        name: 'copy-manifest',
        closeBundle() {
          const src = resolve(__dirname, `manifest.${browser}.json`);
          const dest = resolve(__dirname, `${outDir}/manifest.json`);
          copyFileSync(src, dest);
        },
      }],
    };
  });
  ```

- [ ] **Step 3: Tambah build scripts di package.json**

  Edit `package.json`, ganti bagian `"scripts"`:

  ```json
  "scripts": {
    "build:chrome": "BROWSER=chrome vite build",
    "build:firefox": "BROWSER=firefox vite build",
    "build": "npm run build:chrome && npm run build:firefox"
  }
  ```

  Di Windows, ganti `BROWSER=chrome` dengan `cross-env BROWSER=chrome`:
  ```bash
  npm install --save-dev cross-env
  ```
  Lalu scripts:
  ```json
  "scripts": {
    "build:chrome":  "cross-env BROWSER=chrome vite build",
    "build:firefox": "cross-env BROWSER=firefox vite build",
    "build":         "npm run build:chrome && npm run build:firefox"
  }
  ```

- [ ] **Step 4: Buat manifest.chrome.json**

  ```json
  {
    "manifest_version": 3,
    "name": "TaskFlow Clipper",
    "version": "1.0.0",
    "description": "Clip halaman web ke TaskFlow Notes",
    "permissions": ["activeTab", "storage", "tabs", "scripting"],
    "host_permissions": ["<all_urls>"],
    "action": {
      "default_popup": "popup.html",
      "default_title": "TaskFlow Clipper"
    },
    "background": {
      "service_worker": "background.js"
    },
    "options_ui": {
      "page": "options.html",
      "open_in_tab": false
    },
    "content_scripts": []
  }
  ```

- [ ] **Step 5: Buat manifest.firefox.json**

  ```json
  {
    "manifest_version": 2,
    "name": "TaskFlow Clipper",
    "version": "1.0.0",
    "description": "Clip halaman web ke TaskFlow Notes",
    "permissions": ["activeTab", "storage", "tabs", "<all_urls>"],
    "browser_action": {
      "default_popup": "popup.html",
      "default_title": "TaskFlow Clipper"
    },
    "background": {
      "scripts": ["background.js"],
      "persistent": false
    },
    "options_ui": {
      "page": "options.html",
      "open_in_tab": false
    },
    "browser_specific_settings": {
      "gecko": {
        "id": "taskflow-clipper@yatno"
      }
    }
  }
  ```

- [ ] **Step 6: Commit**

  ```bash
  git init
  echo "node_modules/\ndist/" > .gitignore
  git add .
  git commit -m "feat: init taskflow-clipper extension project"
  ```

---

## Task 7: Extension — Options page (server URL)

**Files:**
- Create: `taskflow-clipper/src/options.html`
- Create: `taskflow-clipper/src/options.js`

- [ ] **Step 1: Buat options.html**

  ```html
  <!DOCTYPE html>
  <html lang="id">
  <head>
    <meta charset="UTF-8">
    <title>TaskFlow Clipper — Settings</title>
    <style>
      body { font-family: system-ui, sans-serif; max-width: 400px; margin: 40px auto; padding: 0 20px; color: #333; }
      h2 { font-size: 18px; margin-bottom: 20px; }
      label { display: block; font-size: 13px; margin-bottom: 6px; color: #666; }
      input { width: 100%; padding: 8px 10px; border: 1px solid #ddd; border-radius: 6px; font-size: 14px; box-sizing: border-box; }
      button { margin-top: 14px; padding: 9px 18px; background: #A8C500; color: #fff; border: none; border-radius: 6px; font-size: 14px; cursor: pointer; font-weight: 600; }
      button:hover { background: #95AD00; }
      #status { margin-top: 10px; font-size: 13px; min-height: 20px; }
      .ok { color: #364d00; }
      .err { color: #c0392b; }
    </style>
  </head>
  <body>
    <h2>⚙️ TaskFlow Clipper Settings</h2>
    <label for="serverUrl">Server URL</label>
    <input id="serverUrl" type="url" placeholder="https://todo.yatno.web.id" />
    <button id="saveBtn">Simpan</button>
    <div id="status"></div>
    <script src="options.js"></script>
  </body>
  </html>
  ```

- [ ] **Step 2: Buat options.js**

  ```js
  import browser from 'webextension-polyfill';

  const serverUrlInput = document.getElementById('serverUrl');
  const saveBtn = document.getElementById('saveBtn');
  const status = document.getElementById('status');

  browser.storage.local.get(['serverUrl']).then(data => {
    if (data.serverUrl) serverUrlInput.value = data.serverUrl;
  });

  saveBtn.addEventListener('click', async () => {
    const val = serverUrlInput.value.trim().replace(/\/$/, '');
    if (!val.startsWith('http')) {
      status.textContent = 'URL harus dimulai dengan http:// atau https://';
      status.className = 'err';
      return;
    }
    await browser.storage.local.set({ serverUrl: val });
    status.textContent = 'Tersimpan ✓';
    status.className = 'ok';
    setTimeout(() => { status.textContent = ''; }, 2000);
  });
  ```

- [ ] **Step 3: Build dan verifikasi**

  ```bash
  npm run build:chrome
  ls dist/chrome/
  # Expected: background.js  content.js  manifest.json  options.html  options.js  popup.html  popup.js
  ```

- [ ] **Step 4: Commit**

  ```bash
  git add src/options.html src/options.js
  git commit -m "feat: add options page for server URL configuration"
  ```

---

## Task 8: Extension — Background script (auth flow)

**Files:**
- Create: `taskflow-clipper/src/background.js`

Background script handle: auth polling, open auth tab, close tab setelah token diterima.

- [ ] **Step 1: Buat background.js**

  ```js
  import browser from 'webextension-polyfill';

  let pollInterval = null;
  let authTabId = null;

  async function getServerUrl() {
    const data = await browser.storage.local.get(['serverUrl']);
    return (data.serverUrl || '').replace(/\/$/, '');
  }

  async function startAuth() {
    const serverUrl = await getServerUrl();
    if (!serverUrl) {
      return { error: 'Server URL belum diset. Buka Settings extension.' };
    }

    // Begin
    let res;
    try {
      res = await fetch(`${serverUrl}/api/ext-auth/begin`, { method: 'POST' });
    } catch (e) {
      return { error: 'Tidak bisa menghubungi server. Cek URL di Settings.' };
    }
    if (!res.ok) return { error: `Server error: ${res.status}` };
    const { state } = await res.json();

    // Buka tab auth
    const tab = await browser.tabs.create({
      url: `${serverUrl}/?ext_auth=1&state=${state}`,
      active: true,
    });
    authTabId = tab.id;

    // Polling
    return new Promise((resolve) => {
      let attempts = 0;
      const MAX_ATTEMPTS = 150; // 5 menit (150 × 2 detik)

      pollInterval = setInterval(async () => {
        attempts++;
        if (attempts > MAX_ATTEMPTS) {
          clearInterval(pollInterval);
          pollInterval = null;
          resolve({ error: 'Timeout. Coba lagi.' });
          return;
        }

        try {
          const r = await fetch(`${serverUrl}/api/ext-auth/poll?state=${state}`);
          if (r.status === 404 || r.status === 410) {
            clearInterval(pollInterval);
            pollInterval = null;
            resolve({ error: 'State tidak valid atau expired.' });
            return;
          }
          if (!r.ok) return;
          const data = await r.json();
          if (data.token) {
            clearInterval(pollInterval);
            pollInterval = null;
            await browser.storage.local.set({ token: data.token });
            // Tutup tab auth
            if (authTabId !== null) {
              try { await browser.tabs.remove(authTabId); } catch (_) {}
              authTabId = null;
            }
            resolve({ ok: true });
          }
        } catch (_) {}
      }, 2000);
    });
  }

  async function clipPage(tabId) {
    const serverUrl = await getServerUrl();
    if (!serverUrl) return { error: 'Server URL belum diset.' };

    const data = await browser.storage.local.get(['token']);
    if (!data.token) return { error: 'Belum terhubung. Klik Connect dulu.' };

    // Ambil info tab
    const tab = await browser.tabs.get(tabId);
    const url = tab.url || '';
    const title = tab.title || url;

    // Inject content script untuk ambil meta desc
    let description = '';
    try {
      const results = await browser.scripting.executeScript({
        target: { tabId },
        func: () => {
          const og = document.querySelector('meta[property="og:description"]');
          const meta = document.querySelector('meta[name="description"]');
          return (og && og.content) || (meta && meta.content) || '';
        },
      });
      description = results?.[0]?.result || '';
    } catch (_) {}

    const content = description
      ? `**Source:** ${url}\n\n> ${description}`
      : `**Source:** ${url}`;

    try {
      const res = await fetch(`${serverUrl}/api/scratchpad`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${data.token}`,
        },
        body: JSON.stringify({ title, content, tags: ['bookmark'] }),
      });
      if (res.status === 401) {
        await browser.storage.local.remove(['token']);
        return { error: 'Token expired atau direvoke. Connect ulang.' };
      }
      if (!res.ok) return { error: `Server error: ${res.status}` };
      const note = await res.json();
      return { ok: true, noteId: note.id, serverUrl };
    } catch (e) {
      return { error: 'Tidak bisa menghubungi server.' };
    }
  }

  // Message handler dari popup
  browser.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'START_AUTH') {
      startAuth().then(sendResponse);
      return true; // async
    }
    if (msg.type === 'CLIP_PAGE') {
      clipPage(msg.tabId).then(sendResponse);
      return true;
    }
    if (msg.type === 'CHECK_TOKEN') {
      browser.storage.local.get(['token', 'serverUrl']).then(data => {
        sendResponse({ hasToken: !!data.token, hasServerUrl: !!data.serverUrl });
      });
      return true;
    }
  });
  ```

- [ ] **Step 2: Commit**

  ```bash
  git add src/background.js
  git commit -m "feat: add background script with auth polling and clip logic"
  ```

---

## Task 9: Extension — Popup UI

**Files:**
- Create: `taskflow-clipper/src/popup.html`
- Create: `taskflow-clipper/src/popup.js`

- [ ] **Step 1: Buat popup.html**

  ```html
  <!DOCTYPE html>
  <html lang="id">
  <head>
    <meta charset="UTF-8">
    <style>
      * { box-sizing: border-box; margin: 0; padding: 0; }
      body { width: 280px; font-family: system-ui, sans-serif; font-size: 13px; background: #FAFAF7; color: #333; }
      .header { display: flex; align-items: center; gap: 8px; padding: 12px 14px; border-bottom: 1px solid #e8e8e0; }
      .logo { width: 20px; height: 20px; background: #A8C500; border-radius: 4px; flex-shrink: 0; }
      .logo-text { font-weight: 700; font-size: 14px; flex: 1; }
      .status-dot { font-size: 11px; font-weight: 600; }
      .status-dot.connected { color: #A8C500; }
      .status-dot.disconnected { color: #999; }
      .body { padding: 14px; }
      .warning { background: #fff3cd; border: 1px solid #ffc107; border-radius: 6px; padding: 10px; font-size: 12px; color: #856404; margin-bottom: 12px; }
      .page-preview { background: #fff; border: 1px solid #e0e0d8; border-radius: 6px; padding: 10px; margin-bottom: 10px; }
      .page-label { font-size: 11px; color: #999; margin-bottom: 4px; }
      .page-title { font-weight: 600; font-size: 12px; margin-bottom: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .page-url { font-size: 11px; color: #666; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .tags { display: flex; gap: 6px; margin-bottom: 10px; flex-wrap: wrap; }
      .tag { background: #eef5c0; color: #364d00; padding: 2px 8px; border-radius: 12px; font-size: 11px; }
      .btn { width: 100%; padding: 9px; border: none; border-radius: 6px; font-size: 13px; cursor: pointer; font-weight: 600; }
      .btn-primary { background: #A8C500; color: #fff; }
      .btn-primary:hover { background: #95AD00; }
      .btn-primary:disabled { background: #ccc; cursor: not-allowed; }
      .btn-secondary { background: transparent; color: #666; border: 1px solid #ddd; margin-top: 6px; }
      .success { background: #f0f7e0; border: 1px solid #A8C500; border-radius: 6px; padding: 14px; text-align: center; }
      .success-icon { font-size: 24px; margin-bottom: 6px; }
      .success-title { font-weight: 600; color: #364d00; margin-bottom: 4px; }
      .success-link { font-size: 12px; color: #A8C500; text-decoration: none; }
      .error { color: #c0392b; font-size: 12px; margin-top: 8px; }
      .footer { padding: 8px 14px; border-top: 1px solid #e8e8e0; text-align: right; }
      .footer a { font-size: 11px; color: #999; text-decoration: none; }
    </style>
  </head>
  <body>
    <div class="header">
      <div class="logo"></div>
      <span class="logo-text">TaskFlow Clipper</span>
      <span class="status-dot" id="statusDot"></span>
    </div>
    <div class="body" id="bodyContent"></div>
    <div class="footer">
      <a href="#" id="settingsLink">⚙ Settings</a>
    </div>
    <script src="popup.js"></script>
  </body>
  </html>
  ```

- [ ] **Step 2: Buat popup.js**

  ```js
  import browser from 'webextension-polyfill';

  const body = document.getElementById('bodyContent');
  const statusDot = document.getElementById('statusDot');
  const settingsLink = document.getElementById('settingsLink');

  settingsLink.addEventListener('click', (e) => {
    e.preventDefault();
    browser.runtime.openOptionsPage();
  });

  function renderNotConnected() {
    statusDot.textContent = '● Disconnected';
    statusDot.className = 'status-dot disconnected';
    body.innerHTML = `
      <div class="warning">⚠ Belum terhubung ke TaskFlow</div>
      <button class="btn btn-primary" id="connectBtn">Connect to TaskFlow</button>
      <div class="error" id="errMsg"></div>
    `;
    document.getElementById('connectBtn').addEventListener('click', async () => {
      const btn = document.getElementById('connectBtn');
      btn.disabled = true;
      btn.textContent = 'Menghubungkan...';
      document.getElementById('errMsg').textContent = '';
      const result = await browser.runtime.sendMessage({ type: 'START_AUTH' });
      if (result?.ok) {
        init();
      } else {
        btn.disabled = false;
        btn.textContent = 'Connect to TaskFlow';
        document.getElementById('errMsg').textContent = result?.error || 'Gagal terhubung';
      }
    });
  }

  function renderReady(tab) {
    statusDot.textContent = '● Connected';
    statusDot.className = 'status-dot connected';
    body.innerHTML = `
      <div class="page-preview">
        <div class="page-label">Halaman ini</div>
        <div class="page-title" title="${tab.title || ''}">${tab.title || tab.url}</div>
        <div class="page-url">${tab.url}</div>
      </div>
      <div class="tags">
        <span class="tag">#bookmark</span>
      </div>
      <button class="btn btn-primary" id="clipBtn">📎 Clip to Notes</button>
      <div class="error" id="errMsg"></div>
    `;
    document.getElementById('clipBtn').addEventListener('click', async () => {
      const btn = document.getElementById('clipBtn');
      btn.disabled = true;
      btn.textContent = 'Menyimpan...';
      document.getElementById('errMsg').textContent = '';
      const result = await browser.runtime.sendMessage({ type: 'CLIP_PAGE', tabId: tab.id });
      if (result?.ok) {
        renderSuccess(tab.title || tab.url, result.noteId, result.serverUrl);
      } else {
        btn.disabled = false;
        btn.textContent = '📎 Clip to Notes';
        document.getElementById('errMsg').textContent = result?.error || 'Gagal menyimpan';
        if (result?.error?.includes('Connect ulang')) {
          setTimeout(renderNotConnected, 1500);
        }
      }
    });
  }

  function renderSuccess(title, noteId, serverUrl) {
    body.innerHTML = `
      <div class="success">
        <div class="success-icon">✓</div>
        <div class="success-title">Tersimpan di Notes!</div>
        <div style="font-size:11px;color:#666;margin:4px 0 10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${title}</div>
        <a class="success-link" href="${serverUrl}/?note=${noteId}" target="_blank">Buka di TaskFlow →</a>
      </div>
    `;
    setTimeout(async () => {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      if (tab) renderReady(tab);
    }, 3000);
  }

  async function init() {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    const status = await browser.runtime.sendMessage({ type: 'CHECK_TOKEN' });

    if (!status.hasServerUrl || !status.hasToken) {
      renderNotConnected();
    } else {
      renderReady(tab);
    }
  }

  init();
  ```

- [ ] **Step 3: Build**

  ```bash
  npm run build
  ```

  Expected: folder `dist/chrome/` dan `dist/firefox/` masing-masing berisi 7+ files.

- [ ] **Step 4: Load extension di Chrome**

  1. Buka `chrome://extensions`
  2. Enable "Developer mode"
  3. "Load unpacked" → pilih `dist/chrome/`
  4. Extension muncul di toolbar

- [ ] **Step 5: Test end-to-end**

  1. Klik icon extension → harus muncul "Belum terhubung"
  2. Buka Settings extension → isi Server URL `http://localhost:8080` → Simpan
  3. Klik icon extension → "Connect to TaskFlow"
  4. Tab TaskFlow terbuka dengan overlay "Authorize Browser Clipper?"
  5. Klik Authorize → tab tertutup otomatis
  6. Popup berganti ke "● Connected" dengan preview halaman
  7. Klik "Clip to Notes" → muncul konfirmasi sukses
  8. Buka TaskFlow Notes → ada note baru dengan tag #bookmark

- [ ] **Step 6: Commit**

  ```bash
  git add src/popup.html src/popup.js
  git commit -m "feat: add popup UI with connect/clip/success states"
  ```

---

## Task 10: Deploy TaskFlow backend

- [ ] **Step 1: Push perubahan TaskFlow**

  ```bash
  git push origin main
  ```

  GitHub Actions deploy otomatis ke VPS.

- [ ] **Step 2: Restart service di VPS (manual)**

  ```bash
  sudo systemctl restart taskflow-web
  ```

- [ ] **Step 3: Verifikasi endpoint hidup**

  ```bash
  curl -s -X POST https://todo.yatno.web.id/api/ext-auth/begin | python3 -m json.tool
  # Expected: {"state": "<uuid>"}
  ```

- [ ] **Step 4: Update extension Server URL**

  Buka Settings extension → ubah Server URL dari `http://localhost:8080` ke `https://todo.yatno.web.id`

- [ ] **Step 5: Test end-to-end di production**

  Ulangi flow connect + clip di URL production. Verifikasi note tersimpan di `https://todo.yatno.web.id` dengan tag #bookmark.
