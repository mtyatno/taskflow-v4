# User Switch & Local Database Session Isolation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent local database & offline cache data from leaking across different user accounts on shared devices (Chrome PWA) when logging out and logging in with a different account.

**Architecture:** Add `clearAll()` to `TF.db` (`taskflow-offline`) and `OfflineDB` (`taskflow-legacy-cache`). Implement `clearLocalUserData()` in `static/index.html` that wipes IndexedDB stores, purges cached `/api/` entries from Service Worker CacheStorage, resets `api._localRouter` and repo user closures, and clears user-scoped `localStorage` keys. Enforce session isolation on `logout()` and add an automatic account-switch detector in `handleLogin()` and `tryAuth()` via `tf_user_id` tracking.

**Tech Stack:** JavaScript (ES6+), React 18, IndexedDB, Service Worker CacheStorage API, Node.js Test Runner, Python FastAPI (pytest).

**Spec:** Local database session isolation on shared devices.

## Global Constraints
- IndexedDB database names `taskflow-offline` and `taskflow-legacy-cache` must be preserved (verified by `tests/offline/rebrand.test.js`).
- ZERO `border-left` or `borderLeft` styling introduced.
- Strict isolation of note editor / Milkdown components (no regressions).
- All offline test suites and python test suites must pass.

---

### Task 1: Add `clearAll()` method to `static/offline/db.js`

**Files:**
- Modify: `static/offline/db.js`
- Test: `tests/offline/db.test.js`

**Interfaces:**
- Produces: `TF.db.clearAll(): Promise<void>`
- Behavior: opens `taskflow-offline`, creates a `readwrite` transaction covering all `db.objectStoreNames`, calls `.clear()` on each object store, and resolves when the transaction completes.

- [ ] **Step 1: Write unit tests in `tests/offline/db.test.js` testing `clearAll()`**
Add a test asserting that when records exist in entity stores (`tasks`, `habits`, `scratchpad_notes`) and system stores (`_outbox`, `_idmap`, `_meta`), calling `clearAll()` empties all stores while keeping the database connection and schema intact.

- [ ] **Step 2: Implement `clearAll()` in `static/offline/db.js`**
Implement `clearAll()` using `openDB().then(db => ...)`, iterating through `db.objectStoreNames` with `tx.objectStore(name).clear()`. Export `clearAll` in `publicApi` and module exports.

- [ ] **Step 3: Run unit tests and verify**
Run `node --test tests/offline/db.test.js` to ensure the new tests pass along with existing tests.

---

### Task 2: Implement `OfflineDB.clearAll()` & `clearLocalUserData()` in `static/index.html`

**Files:**
- Modify: `static/index.html`

**Interfaces:**
- Produces: `OfflineDB.cacheClear(): Promise<void>`
- Produces: `OfflineDB.clearAll(): Promise<void>`
- Produces: `clearLocalUserData(): Promise<void>`
- Wire into:
  - `logout()`: push pending outbox if online, call `await clearLocalUserData()`, clear React states.
  - `handleLogin(data)`: compare `localStorage.getItem("tf_user_id")` with `data.user_id`. If changed or not set, `await clearLocalUserData()`. Set `localStorage.setItem("tf_user_id", String(data.user_id))`.
  - `tryAuth()`: on `/api/auth/me` success and offline fallback, check `tf_user_id` switch. If user changed, `await clearLocalUserData()`. Set `localStorage.setItem("tf_user_id", String(u.id))`. On 401 error, call `await clearLocalUserData()`.

- [ ] **Step 1: Add `cacheClear()` and `clearAll()` to `OfflineDB` in `static/index.html`**
Extend `OfflineDB` with `cacheClear: () => tr("cache", "readwrite", s => s.clear())` and `clearAll: () => Promise.all([tr("cache", "readwrite", s => s.clear()), tr("queue", "readwrite", s => s.clear())]).catch(() => null)`.

- [ ] **Step 2: Implement `clearLocalUserData()` helper in `static/index.html`**
Implement async `clearLocalUserData()` that:
1. Calls `window.TF?.db?.clearAll ? await window.TF.db.clearAll() : Promise.resolve()`
2. Calls `OfflineDB.clearAll ? await OfflineDB.clearAll() : Promise.resolve()`
3. Purges cached `/api/` entries from Service Worker CacheStorage via `window.caches`
4. Clears user-scoped keys from `localStorage`: `tf_user_id`, `tf_pomo_state`, `tf_last_review`, `tf_review_snooze`, `tf_last_backup`, `tf_backup_snooze`, `tf_dismiss_onboarding`, `tf_ai_review_optin`
5. Resets in-memory singletons: `api._localRouter = null`, `window.TF?.db?._reset?.()`, `initialLoad.current = true`, `window.TF?.chatrepo?.setCurrentUser(null)`, `window.TF?.noterepo?.setCurrentUser(null)`, `window.TF?.mindmaprepo?.setCurrentUser(null)`.

- [ ] **Step 3: Integrate `clearLocalUserData()` into `logout()`, `handleLogin()`, and `tryAuth()`**
Update `logout()` to push pending changes if online, then call `await clearLocalUserData()`.
Update `handleLogin(data)` to detect user ID switch and clean stale data before initializing state.
Update `tryAuth()` to detect user ID switch and handle 401 cleanup.

---

### Task 3: Unit test suite for user session isolation & version bump

**Files:**
- Create: `tests/offline/user_session_isolation.test.js`
- Modify: `webapp.py`
- Modify: `static/sw.js`
- Modify: `tests/test_version.py`
- Modify: `tests/offline/*.test.js` (synchronize SW cache name)

**Interfaces:**
- Produces: comprehensive test suite testing:
  - `TF.db.clearAll()` wipes all entity and system stores.
  - `OfflineDB.clearAll()` wipes cache and queue.
  - Account switch simulation (User 1 data in DB -> account switch -> User 2 cannot access User 1 data).
  - Logout clears all local stores and user keys.
- Version bump:
  - Cache: `taskflow-v399-user-switch-localdb-isolation`
  - Backend version endpoint: `v399`

- [ ] **Step 1: Write `tests/offline/user_session_isolation.test.js`**
Create automated unit tests verifying the full cleanup and user isolation behavior.

- [ ] **Step 2: Bump SW cache version and sync test assertions**
Bump `sw_cache` in `webapp.py`, `static/sw.js`, fallback `window.__SW_VERSION` in `static/index.html`, and update `tests/test_version.py` and all offline test files.

---

### Task 4: Full verification & safety checks

**Files:**
- Verify: all touched files

- [ ] **Step 1: Run inline scripts check**
Execute `node temporary_files/check_inline_scripts.js static/index.html`.

- [ ] **Step 2: Run Service Worker syntax check**
Execute `node --check static/sw.js`.

- [ ] **Step 3: Run border-left violation check**
Execute `git diff -U0 | grep -iE "border-?left"` and ensure 0 matches.

- [ ] **Step 4: Run python pytest**
Execute `venv/bin/python -m pytest tests/test_version.py`.

- [ ] **Step 5: Run all offline node test suites**
Execute `node --test tests/offline/*.test.js`.
