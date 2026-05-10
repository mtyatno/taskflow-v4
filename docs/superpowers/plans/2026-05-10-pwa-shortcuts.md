# PWA Shortcuts — Quick Create Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a PWA home screen shortcut "Buat Baru" that opens `TaskFormModal` directly when tapped, plus a one-time hint toast educating installed users about the long-press feature.

**Architecture:** `/?action=new-task` URL param is read at App() init time (same pattern as `?join=`), stored in `pendingAction` state, and consumed by a `useEffect` that fires once `user` is set. A separate `useEffect` shows a one-time `showToast` on first standalone launch. The manifest shortcut and SW cache list are updated to include the new icon SVG.

**Tech Stack:** Vanilla React (in-browser Babel), PWA manifest, Service Worker

---

## File Map

| File | Change |
|------|--------|
| `static/icon-new-task.svg` | CREATE — shortcut icon (plus sign, accent background) |
| `static/manifest.json` | MODIFY — add `shortcuts` array |
| `static/sw.js` | MODIFY — add SVG to `STATIC` cache list |
| `static/index.html` | MODIFY — add `pendingAction` state + two useEffects in `App()` |

---

## Task 1: Create shortcut icon SVG

**Files:**
- Create: `static/icon-new-task.svg`

- [ ] **Step 1: Create the SVG file**

  Write `static/icon-new-task.svg` with this exact content:

  ```svg
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96">
    <rect width="96" height="96" rx="20" fill="#A8C500"/>
    <path d="M48 26v44M26 48h44" stroke="white" stroke-width="10" stroke-linecap="round"/>
  </svg>
  ```

  Accent color `#A8C500` matches the app's `--accent` CSS variable. The `rx="20"` gives rounded corners matching Android adaptive icon style.

- [ ] **Step 2: Verify SVG renders correctly**

  Open `static/icon-new-task.svg` directly in a browser. You should see a green-yellow rounded square with a white plus sign centered in it.

- [ ] **Step 3: Commit**

  ```bash
  git add static/icon-new-task.svg
  git commit -m "feat: add PWA shortcut icon SVG"
  ```

---

## Task 2: Update manifest.json

**Files:**
- Modify: `static/manifest.json`

- [ ] **Step 1: Add shortcuts array**

  Current `static/manifest.json` ends with the `icons` array closing bracket. Add a `shortcuts` key after `icons`:

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
    ]
  }
  ```

- [ ] **Step 2: Validate JSON is valid**

  ```bash
  python -c "import json; json.load(open('static/manifest.json')); print('OK')"
  ```

  Expected output: `OK`

- [ ] **Step 3: Commit**

  ```bash
  git add static/manifest.json
  git commit -m "feat: add PWA shortcuts to manifest"
  ```

---

## Task 3: Update Service Worker cache list

**Files:**
- Modify: `static/sw.js` (lines 1–13)

- [ ] **Step 1: Add SVG icon to STATIC array**

  In `static/sw.js`, the `STATIC` array currently ends with `"/static/icon-512.png"`. Add the new SVG:

  ```js
  const STATIC = [
    "/",
    "/static/vendor/react.production.min.js",
    "/static/vendor/react-dom.production.min.js",
    "/static/vendor/babel.min.js",
    "/static/vendor/chart.umd.min.js",
    "/static/vendor/marked.min.js",
    "/static/vendor/tailwind.min.css",
    "/manifest.json",
    "/static/icon-192.png",
    "/static/icon-512.png",
    "/static/icon-new-task.svg",
  ];
  ```

  Also bump the cache version string from `"taskflow-v31-recurring"` to `"taskflow-v32-shortcuts"` so the old cache is evicted and the new one (with the SVG) is installed:

  ```js
  const CACHE = "taskflow-v32-shortcuts";
  ```

- [ ] **Step 2: Verify SW looks correct**

  ```bash
  python -c "
  content = open('static/sw.js').read()
  assert 'taskflow-v32-shortcuts' in content
  assert '/static/icon-new-task.svg' in content
  print('OK')
  "
  ```

  Expected: `OK`

- [ ] **Step 3: Commit**

  ```bash
  git add static/sw.js
  git commit -m "feat: cache PWA shortcut icon in service worker"
  ```

---

## Task 4: Add pendingAction state and useEffect in App()

**Files:**
- Modify: `static/index.html` (around line 10028 and 10040)

- [ ] **Step 1: Add pendingAction state**

  In `static/index.html`, locate this block (around line 10027–10031):

  ```js
      // Handle ?join=<code> invite link from URL
      const [pendingJoinCode, setPendingJoinCode] = useState(() => {
        const params = new URLSearchParams(window.location.search);
        return params.get("join") || "";
      });
  ```

  Immediately **after** the closing `});` of `pendingJoinCode`, add:

  ```js
      const [pendingAction, setPendingAction] = useState(() => {
        const params = new URLSearchParams(window.location.search);
        return params.get("action") || "";
      });
  ```

- [ ] **Step 2: Add useEffect to consume the action**

  Locate the join `useEffect` (around line 10034–10040):

  ```js
      useEffect(() => {
        if (user && pendingJoinCode) {
          setJoinModal(true);
          // Clean URL
          window.history.replaceState({}, "", "/");
        }
      }, [user, pendingJoinCode]);
  ```

  Immediately **after** that closing `}, [user, pendingJoinCode]);`, add:

  ```js
      useEffect(() => {
        if (!user || !pendingAction) return;
        if (pendingAction === "new-task") {
          setEditTask(null);
          setShowForm(true);
        }
        setPendingAction("");
        window.history.replaceState({}, "", "/");
      }, [user, pendingAction]);
  ```

- [ ] **Step 3: Verify the edit**

  ```bash
  python -c "
  c = open('static/index.html', encoding='utf-8').read()
  assert 'pendingAction' in c, 'pendingAction not found'
  assert 'params.get(\"action\")' in c, 'params.get not found'
  assert 'setPendingAction(\"\")' in c, 'setPendingAction clear not found'
  print('OK')
  "
  ```

  Expected: `OK`

- [ ] **Step 4: Browser test — shortcut URL**

  Open `http://localhost:<port>/?action=new-task` in browser while logged in.

  Expected: TaskFormModal opens immediately with Task tab active. URL in address bar changes to `/` (cleaned up).

- [ ] **Step 5: Browser test — logged out**

  Log out, then navigate to `/?action=new-task`.

  Expected: Login page shown. After logging in, TaskFormModal opens automatically.

- [ ] **Step 6: Commit**

  ```bash
  git add static/index.html
  git commit -m "feat: handle ?action=new-task URL param to open TaskFormModal"
  ```

---

## Task 5: Add one-time hint toast for installed users

**Files:**
- Modify: `static/index.html` (immediately after the useEffect added in Task 4)

- [ ] **Step 1: Add hint useEffect**

  Immediately after the `useEffect` added in Task 4 (`}, [user, pendingAction]);`), add:

  ```js
      useEffect(() => {
        if (!user) return;
        const isStandalone = window.matchMedia('(display-mode: standalone)').matches;
        if (isStandalone && !localStorage.getItem('tf_shortcut_hint')) {
          showToast("💡 Tekan lama ikon app untuk akses cepat buat task/habit/note");
          localStorage.setItem('tf_shortcut_hint', '1');
        }
      }, [user]);
  ```

- [ ] **Step 2: Browser test — hint appears once**

  To test without needing a real PWA install:
  1. Open browser DevTools → Application → Local Storage → delete key `tf_shortcut_hint` if it exists
  2. In console, run: `window.matchMedia = () => ({ matches: true })` to simulate standalone mode
  3. Reload the page while logged in
  4. Expected: toast appears with "💡 Tekan lama ikon app..."
  5. Reload again — toast should NOT appear (hint already stored)

- [ ] **Step 3: Browser test — no hint in browser mode**

  Without the `matchMedia` override, reload the app in a normal browser tab (not PWA installed). Expected: no hint toast appears.

- [ ] **Step 4: Commit**

  ```bash
  git add static/index.html
  git commit -m "feat: show one-time hint toast for PWA shortcut on standalone launch"
  ```

---

## Task 6: End-to-end verification and push

- [ ] **Step 1: Full flow test on desktop browser**

  1. Open app → verify normal usage unaffected (no stray toasts, no modal auto-opening)
  2. Navigate to `/?action=new-task` → TaskFormModal opens, Task tab active
  3. Submit a task via this flow → task appears in list

- [ ] **Step 2: Verify manifest via DevTools**

  Chrome DevTools → Application → Manifest

  Expected:
  - Shortcuts section shows "Buat Baru" with URL `/?action=new-task`
  - Icon preview shows the green plus SVG

- [ ] **Step 3: Verify SW cache version**

  DevTools → Application → Service Workers → check active SW is `taskflow-v32-shortcuts`.

  If old SW still active: click "Update" or "Skip waiting".

- [ ] **Step 4: Test offline shortcut**

  1. Install PWA or test via `/?action=new-task`
  2. DevTools → Network → set to Offline
  3. Reload `/?action=new-task`
  4. Expected: app loads from cache, TaskFormModal opens
  5. Submit task → no network error (OfflineDB queue handles it)
  6. Set Network back to Online → verify task syncs

- [ ] **Step 5: Push to remote**

  ```bash
  git push
  ```

  CI/CD will deploy to VPS automatically.

- [ ] **Step 6: Verify on Android (after deploy)**

  1. Open TaskFlow in Chrome Android → long-press PWA icon on home screen
  2. Expected: "Buat Baru" shortcut appears above the icon
  3. Tap it → TaskFormModal opens with Task tab active
