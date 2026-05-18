# PWA Share Target — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tambahkan Web Share Target ke TaskFlow PWA sehingga user mobile bisa share URL dari browser apapun langsung ke Notes dengan tag #bookmark.

**Architecture:** Tambah `share_target` ke `static/manifest.json` (GET method, action `/`). SPA membaca `?share_url=` params saat load dan auto-clip ke Notes. Kalau belum login, data disimpan di `sessionStorage` dan diproses setelah login. Tidak ada perubahan backend.

**Tech Stack:** Web Share Target API (PWA), React hooks (useState/useEffect), existing `/api/scratchpad` endpoint.

**Spec:** `docs/superpowers/specs/2026-05-18-pwa-share-target-design.md`

---

## File Map

- Modify: `static/manifest.json` — tambah `share_target`
- Modify: `static/sw.js` — bump cache version
- Modify: `static/index.html` — tambah `shareData` state + 3 useEffect di `App` component

`static/index.html` sudah dalam bentuk compiled JS (bukan JSX). Edit langsung sebagai plain JS. `node compile.js` akan no-op (tidak ada `<script type="text/babel">`).

---

## Task 1: manifest.json + SW cache bump

**Files:**
- Modify: `static/manifest.json`
- Modify: `static/sw.js`

- [ ] **Step 1: Tambah share_target di manifest.json**

  Buka `static/manifest.json`. Tambahkan field `share_target` setelah field `shortcuts`:

  ```json
  {
    "name": "TaskFlow V4",
    "short_name": "TaskFlow",
    "description": "GTD Task Manager",
    "start_url": "/",
    "scope": "/",
    "display": "standalone",
    "orientation": "portrait",
    "background_color": "#0f172a",
    "theme_color": "#0f172a",
    "icons": [
      { "src": "/static/icon-32.png",  "sizes": "32x32",   "type": "image/png", "purpose": "any" },
      { "src": "/static/icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any" },
      { "src": "/static/icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "maskable" },
      { "src": "/static/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any" },
      { "src": "/static/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
    ],
    "shortcuts": [
      {
        "name": "Buat Baru",
        "short_name": "Buat Baru",
        "description": "Buka form tambah task, habit, note, atau goal",
        "url": "/?action=new-task",
        "icons": [{ "src": "/static/icon-new-task.svg", "sizes": "any", "type": "image/svg+xml" }]
      }
    ],
    "share_target": {
      "action": "/",
      "method": "GET",
      "params": {
        "title": "share_title",
        "text":  "share_text",
        "url":   "share_url"
      }
    }
  }
  ```

- [ ] **Step 2: Bump SW cache version di static/sw.js**

  Ganti baris pertama di `static/sw.js`:
  ```js
  const CACHE = "taskflow-v105-pwa-share-target";
  ```

- [ ] **Step 3: Verify manifest valid JSON**

  ```bash
  python3 -c "import json; json.load(open('static/manifest.json')); print('OK')"
  ```
  Expected: `OK`

- [ ] **Step 4: Commit**

  ```bash
  git add static/manifest.json static/sw.js
  git commit -m "feat: add PWA share_target to manifest and bump SW cache to v105"
  ```

---

## Task 2: SPA — shareData state + auto-clip logic

**Files:**
- Modify: `static/index.html` (compiled JS, edit langsung)

File ini ~21000 baris. Semua edit dilakukan di dalam fungsi `App` (komponen utama). Gunakan grep untuk menemukan lokasi yang tepat sebelum edit.

- [ ] **Step 1: Temukan lokasi insert untuk shareData state**

  ```bash
  grep -n "extAuthState\|pendingJoinCode" static/index.html | head -5
  ```

  Cari baris seperti:
  ```
  20172:  const [extAuthState, setExtAuthState] = React.useState(() => {
  ```

  State baru akan ditambahkan SETELAH blok `extAuthState` (3 baris setelah baris itu).

- [ ] **Step 2: Tambah shareData state setelah extAuthState**

  Temukan pattern ini di sekitar baris 20172-20175:
  ```js
  const [extAuthState, setExtAuthState] = React.useState(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("ext_auth") === "1" ? params.get("state") || "" : "";
  });
  ```

  Tambahkan SETELAH closing `});` blok extAuthState:
  ```js
  const [shareData, setShareData] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    const url = params.get("share_url");
    if (!url) return null;
    return {
      url,
      title: params.get("share_title") || url,
      text: params.get("share_text") || ""
    };
  });
  ```

- [ ] **Step 3: Temukan lokasi insert untuk useEffect**

  ```bash
  grep -n "pendingAction.*replaceState\|replaceState.*\/" static/index.html | head -5
  ```

  Cari baris seperti:
  ```
  20195:    window.history.replaceState({}, "", "/");
  20196:  }, [user, pendingAction]);
  ```

  Tiga useEffect baru akan ditambahkan SETELAH baris `}, [user, pendingAction]);`.

- [ ] **Step 4: Tambah tiga useEffect setelah pendingAction effect**

  Temukan pattern ini:
  ```js
    window.history.replaceState({}, "", "/");
  }, [user, pendingAction]);
  ```

  Tambahkan SETELAH `}, [user, pendingAction]);`:

  ```js
  // Share Target: simpan ke sessionStorage kalau belum login
  useEffect(() => {
    if (shareData && !tokenStore.get()) {
      sessionStorage.setItem("pendingShare", JSON.stringify(shareData));
      setShareData(null);
      window.history.replaceState({}, "", "/");
    }
  }, []);
  // Share Target: setelah login, ambil dari sessionStorage
  useEffect(() => {
    if (!user) return;
    const pending = sessionStorage.getItem("pendingShare");
    if (!pending) return;
    sessionStorage.removeItem("pendingShare");
    try { setShareData(JSON.parse(pending)); } catch(e) {}
  }, [user]);
  // Share Target: auto-clip note
  useEffect(() => {
    if (!user || !shareData) return;
    const content = shareData.text
      ? `**Source:** ${shareData.url}\n\n> ${shareData.text}`
      : `**Source:** ${shareData.url}`;
    api.post("/api/scratchpad", {
      title: shareData.title,
      content,
      tags: ["bookmark"]
    }).then(() => {
      showToast("Tersimpan di Notes! 📎");
      setShareData(null);
      window.history.replaceState({}, "", "/");
      setTimeout(() => window.close(), 2000);
    }).catch(err => {
      showToast("Gagal menyimpan: " + (err && err.message ? err.message : "Error"), "error");
      setShareData(null);
      window.history.replaceState({}, "", "/");
    });
  }, [user, shareData]);
  ```

- [ ] **Step 5: Verify tidak ada syntax error**

  Buka `https://localhost:8080` (atau server lokal) dan cek Console tidak ada error.
  
  Atau test manual: buka URL ini di browser:
  ```
  http://localhost:8080/?share_url=https://github.com&share_title=GitHub&share_text=Social+coding
  ```
  
  Expected: kalau sudah login → toast "Tersimpan di Notes! 📎" → window close setelah 2 detik.
  Buka TaskFlow Notes → ada note baru dengan tag #bookmark, title "GitHub", content berisi `**Source:** https://github.com`.

- [ ] **Step 6: Commit**

  ```bash
  git add static/index.html
  git commit -m "feat: add share target handler to SPA for PWA URL sharing"
  ```

---

## Task 3: Deploy + Test Mobile

- [ ] **Step 1: Push ke GitHub**

  ```bash
  git push origin main
  ```

  CI/CD auto-deploy ke VPS.

- [ ] **Step 2: Restart VPS service**

  ```bash
  sudo systemctl restart taskflow-web
  ```

- [ ] **Step 3: Install TaskFlow sebagai PWA di Android**

  1. Buka `https://todo.yatno.web.id` di Chrome Android
  2. Tap menu ⋮ → "Add to Home screen" → Install
  3. Tunggu sampai icon TaskFlow muncul di home screen

- [ ] **Step 4: Test share flow**

  1. Buka halaman web apapun di Chrome Android (contoh: `https://github.com`)
  2. Tap Share (icon share di browser)
  3. Cari "TaskFlow" di share sheet → tap
  4. TaskFlow terbuka sebentar → toast "Tersimpan di Notes! 📎" → window close
  5. Buka TaskFlow → Notes → filter tag `#bookmark` → ada note GitHub baru

- [ ] **Step 5: Test skenario belum login**

  1. Logout dari TaskFlow
  2. Share URL dari browser
  3. TaskFlow terbuka → redirect ke login
  4. Login
  5. Note ter-save otomatis setelah login

  Expected: note tersimpan setelah step 5.
