"use strict";

const { test, beforeEach, afterEach, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { deleteDB } = require("./setup.js");
const { DB_NAME, DB_VERSION, openDB, clearAll, _reset } = require("../../static/offline/db.js");

const htmlPath = path.join(__dirname, "../../static/index.html");
const swPath = path.join(__dirname, "../../static/sw.js");
const webappPath = path.join(__dirname, "../../webapp.py");

beforeEach(async () => {
  _reset();
  await deleteDB(DB_NAME);
});

afterEach(async () => {
  _reset();
  await deleteDB(DB_NAME);
});

after(async () => {
  _reset();
  await deleteDB(DB_NAME);
});

test("1. TF.db.clearAll() clears all entity and system stores in taskflow-offline", async () => {
  const db = await openDB();

  await new Promise((resolve, reject) => {
    const tx = db.transaction(["tasks", "habits", "scratchpad_notes", "_outbox", "_meta"], "readwrite");
    tx.objectStore("tasks").add({ cid: "t-101", title: "User 1 Task", updated_at: 1000 });
    tx.objectStore("habits").add({ cid: "h-101", name: "User 1 Habit", updated_at: 1000 });
    tx.objectStore("scratchpad_notes").add({ cid: "n-101", content: "User 1 Private Note", updated_at: 1000 });
    tx.objectStore("_outbox").add({ op: "insert", cid: "t-101" });
    tx.objectStore("_meta").put("user_101", "current_user_id");
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });

  // Verify records exist before clearAll
  const tasksBefore = await new Promise((res) => {
    const req = db.transaction("tasks", "readonly").objectStore("tasks").getAll();
    req.onsuccess = () => res(req.result);
  });
  assert.equal(tasksBefore.length, 1, "Task should exist before clearAll");

  await clearAll();

  // Verify all specified stores are now empty
  for (const storeName of ["tasks", "habits", "scratchpad_notes", "_outbox", "_meta"]) {
    const items = await new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, "readonly");
      const req = tx.objectStore(storeName).getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    assert.equal(items.length, 0, `Store ${storeName} should be empty after clearAll`);
  }

  // Schema and database connection remain valid
  assert.ok(db.objectStoreNames.contains("tasks"));
  assert.ok(db.objectStoreNames.contains("_meta"));
  db.close();
  _reset();
  await deleteDB(DB_NAME);
});

test("2. OfflineDB.clearAll() clears cache and queue stores in taskflow-legacy-cache", async () => {
  const LEGACY_DB_NAME = "taskflow-legacy-cache";
  let dbConnection = null;

  const openLegacy = () => new Promise((res, rej) => {
    if (dbConnection) return res(dbConnection);
    const r = indexedDB.open(LEGACY_DB_NAME, 1);
    r.onupgradeneeded = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains("cache")) db.createObjectStore("cache");
      if (!db.objectStoreNames.contains("queue")) db.createObjectStore("queue", {
        keyPath: "id",
        autoIncrement: true
      });
    };
    r.onsuccess = () => {
      dbConnection = r.result;
      res(dbConnection);
    };
    r.onerror = rej;
  });

  const tr = (store, mode, fn) => openLegacy().then(db => new Promise((res, rej) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    const r = fn(s);
    t.oncomplete = () => res(r?.result);
    t.onerror = rej;
    t.onabort = rej;
  }));

  const OfflineDB = {
    cacheGet: k => tr("cache", "readonly", s => s.get(k)),
    cacheSet: (k, v) => tr("cache", "readwrite", s => s.put(v, k)),
    cacheClear: () => tr("cache", "readwrite", s => s.clear()),
    clearAll: () => Promise.all([tr("cache", "readwrite", s => s.clear()), tr("queue", "readwrite", s => s.clear())]).catch(() => null),
    queueAdd: v => tr("queue", "readwrite", s => s.add({
      ...v,
      createdAt: Date.now()
    })),
    queueGetAll: () => openLegacy().then(db => new Promise((res, rej) => {
      const r = db.transaction("queue", "readonly").objectStore("queue").getAll();
      r.onsuccess = () => res(r.result || []);
      r.onerror = rej;
    })).catch(() => [])
  };

  await OfflineDB.cacheSet("cached_user_profile", { id: 101, name: "Alice" });
  await OfflineDB.queueAdd({ url: "/api/tasks", method: "POST", body: { title: "Draft Task" } });

  const cachedBefore = await OfflineDB.cacheGet("cached_user_profile");
  assert.equal(cachedBefore.id, 101);
  const queueBefore = await OfflineDB.queueGetAll();
  assert.equal(queueBefore.length, 1);

  await OfflineDB.clearAll();

  const cachedAfter = await OfflineDB.cacheGet("cached_user_profile");
  assert.equal(cachedAfter, undefined, "cache store should be cleared");
  const queueAfter = await OfflineDB.queueGetAll();
  assert.equal(queueAfter.length, 0, "queue store should be cleared");

  if (dbConnection) {
    dbConnection.close();
    dbConnection = null;
  }
  await deleteDB(LEGACY_DB_NAME);
});

test("3. Cache purge logic cleans only /api/ paths and preserves static assets", async () => {
  const initialCache = new Map([
    ["http://localhost/api/tasks", "response_tasks"],
    ["http://localhost/api/auth/me", "response_auth"],
    ["http://localhost/static/index.html", "response_html"],
    ["http://localhost/static/sw.js", "response_sw"]
  ]);

  const mockCache = {
    keys: async () => Array.from(initialCache.keys()).map(url => ({ url })),
    delete: async (req) => {
      return initialCache.delete(req.url);
    }
  };

  const mockCaches = {
    keys: async () => ["taskflow-cache-v1"],
    open: async () => mockCache
  };

  // Run cache cleanup filter matching clearLocalUserData() in static/index.html
  const names = await mockCaches.keys();
  await Promise.all(names.map(async name => {
    try {
      const c = await mockCaches.open(name);
      const requests = await c.keys();
      await Promise.all(requests.filter(r => {
        try { return new URL(r.url).pathname.startsWith("/api/"); } catch (_) { return false; }
      }).map(r => c.delete(r)));
    } catch (_) {}
  }));

  assert.equal(initialCache.has("http://localhost/api/tasks"), false, "/api/tasks must be deleted");
  assert.equal(initialCache.has("http://localhost/api/auth/me"), false, "/api/auth/me must be deleted");
  assert.equal(initialCache.has("http://localhost/static/index.html"), true, "/static/index.html must be preserved");
  assert.equal(initialCache.has("http://localhost/static/sw.js"), true, "/static/sw.js must be preserved");
});

test("4. clearLocalUserData() cleans user-scoped localStorage keys while preserving general preferences", async () => {
  const storage = new Map([
    ["tf_user_id", "101"],
    ["tf_pomo_state", JSON.stringify({ active: true, taskId: 5 })],
    ["tf_last_review", "2026-10-13"],
    ["tf_review_snooze", "1728800000"],
    ["tf_last_backup", "2026-10-12"],
    ["tf_backup_snooze", "1728800000"],
    ["tf_dismiss_onboarding", "true"],
    ["tf_ai_review_optin", "true"],
    ["theme", "dark"]
  ]);

  const mockLocalStorage = {
    getItem: (k) => storage.get(k) ?? null,
    setItem: (k, v) => storage.set(k, String(v)),
    removeItem: (k) => storage.delete(k)
  };

  const mockApi = { _localRouter: { routes: ["task"] } };
  let dbCleared = false;
  let offlineDBCleared = false;
  let resetCalled = false;
  let chatUser = "user1";
  let noteUser = "user1";
  let mindmapUser = "user1";

  const mockWindow = {
    TF: {
      db: {
        clearAll: async () => { dbCleared = true; },
        _reset: () => { resetCalled = true; }
      },
      chatrepo: { setCurrentUser: (u) => { chatUser = u; } },
      noterepo: { setCurrentUser: (u) => { noteUser = u; } },
      mindmaprepo: { setCurrentUser: (u) => { mindmapUser = u; } }
    },
    caches: null
  };
  const mockOfflineDB = {
    clearAll: async () => { offlineDBCleared = true; }
  };

  // Extract clearLocalUserData implementation from static/index.html and execute it
  const html = fs.readFileSync(htmlPath, "utf8");
  const funcMatch = html.match(/async function clearLocalUserData\(\)\s*\{[\s\S]*?\n\}/);
  assert.ok(funcMatch, "clearLocalUserData function must be found in static/index.html");

  const clearFn = new Function("window", "OfflineDB", "localStorage", "api", `
    ${funcMatch[0]}
    return clearLocalUserData;
  `)(mockWindow, mockOfflineDB, mockLocalStorage, mockApi);

  await clearFn();

  assert.equal(dbCleared, true, "TF.db.clearAll must be called");
  assert.equal(offlineDBCleared, true, "OfflineDB.clearAll must be called");
  assert.equal(resetCalled, true, "TF.db._reset must be called");
  assert.equal(chatUser, null, "chatrepo user must be reset to null");
  assert.equal(noteUser, null, "noterepo user must be reset to null");
  assert.equal(mindmapUser, null, "mindmaprepo user must be reset to null");

  const userKeys = [
    "tf_user_id",
    "tf_pomo_state",
    "tf_last_review",
    "tf_review_snooze",
    "tf_last_backup",
    "tf_backup_snooze",
    "tf_dismiss_onboarding",
    "tf_ai_review_optin"
  ];
  for (const k of userKeys) {
    assert.equal(mockLocalStorage.getItem(k), null, `${k} must be removed`);
  }

  // General non-user preference preserved
  assert.equal(mockLocalStorage.getItem("theme"), "dark", "theme preference must remain intact");
  assert.equal(mockApi._localRouter, null, "api._localRouter must be nullified");
});

test("5. Account switch detection in handleLogin triggers clearLocalUserData only when user ID changes", async () => {
  const storage = new Map([
    ["tf_user_id", "101"]
  ]);
  const mockLocalStorage = {
    getItem: (k) => storage.get(k) ?? null,
    setItem: (k, v) => storage.set(k, String(v)),
    removeItem: (k) => storage.delete(k)
  };

  let clearCallCount = 0;
  const mockClearLocalUserData = async () => {
    clearCallCount++;
  };

  const simulateHandleLogin = async (data) => {
    const prevUserId = mockLocalStorage.getItem("tf_user_id");
    if (!prevUserId || String(prevUserId) !== String(data.user_id)) {
      await mockClearLocalUserData();
    }
    mockLocalStorage.setItem("tf_user_id", String(data.user_id));
  };

  // Case A: User 101 is logged in, User 102 logs in -> Account switch detected!
  await simulateHandleLogin({ user_id: 102, username: "user_two" });
  assert.equal(clearCallCount, 1, "clearLocalUserData must be triggered on account switch");
  assert.equal(mockLocalStorage.getItem("tf_user_id"), "102");

  // Case B: User 102 logs in again (same user) -> No purge needed!
  clearCallCount = 0;
  await simulateHandleLogin({ user_id: 102, username: "user_two" });
  assert.equal(clearCallCount, 0, "clearLocalUserData must NOT be triggered when logging in as the same user");
  assert.equal(mockLocalStorage.getItem("tf_user_id"), "102");

  // Case C: No previous user ID recorded (fresh browser session or post-logout) -> Purge triggered as precaution
  mockLocalStorage.removeItem("tf_user_id");
  clearCallCount = 0;
  await simulateHandleLogin({ user_id: 103, username: "user_three" });
  assert.equal(clearCallCount, 1, "clearLocalUserData must be triggered when no previous user ID was stored");
  assert.equal(mockLocalStorage.getItem("tf_user_id"), "103");
});

test("6. static/index.html includes clearLocalUserData, OfflineDB.clearAll, and account switch detection in handleLogin, logout, and tryAuth", () => {
  const html = fs.readFileSync(htmlPath, "utf8");

  // OfflineDB.clearAll and cacheClear
  assert.ok(html.includes("cacheClear: () => tr(\"cache\", \"readwrite\", s => s.clear())"), "OfflineDB must define cacheClear");
  assert.ok(html.includes("clearAll: () => Promise.all([tr(\"cache\", \"readwrite\", s => s.clear()), tr(\"queue\", \"readwrite\", s => s.clear())])"), "OfflineDB must define clearAll");

  // clearLocalUserData declaration and export
  assert.ok(html.includes("async function clearLocalUserData()"), "clearLocalUserData must be defined");
  assert.ok(html.includes("window.clearLocalUserData = clearLocalUserData;"), "clearLocalUserData must be exposed on window");

  // logout integration
  assert.match(
    html,
    /const logout = useCallback\(async \(\) =>\s*\{[\s\S]*?await clearLocalUserData\(\);[\s\S]*?tokenStore\.clear\(\);/,
    "logout must call await clearLocalUserData() before clearing token"
  );

  // handleLogin integration
  assert.match(
    html,
    /const handleLogin = async data =>\s*\{[\s\S]*?const prevUserId = localStorage\.getItem\("tf_user_id"\);[\s\S]*?await clearLocalUserData\(\);[\s\S]*?localStorage\.setItem\("tf_user_id", String\(data\.user_id\)\);/,
    "handleLogin must detect account switch and call clearLocalUserData()"
  );

  // tryAuth integration (both auth/me success and 401 handling)
  assert.match(
    html,
    /api\.get\("\/api\/auth\/me"\)\.then\(async u =>\s*\{[\s\S]*?const prevUserId = localStorage\.getItem\("tf_user_id"\);[\s\S]*?await clearLocalUserData\(\);[\s\S]*?localStorage\.setItem\("tf_user_id", String\(u\.id\)\);/,
    "tryAuth success must detect account switch"
  );
  // K1 (audit 2026-10-15): token kedaluwarsa ≠ ganti pengguna — tryAuth 401 TIDAK boleh menghapus data lokal
  // (outbox & edit offline); cukup jalur handleAuthExpired (hapus token, tampilkan login, toast).
  const m401 = html.match(/if \(err && err\.status === 401\) \{([\s\S]*?)\n\s*return;\s*\}/);
  assert.ok(m401, "tryAuth 401 handler must exist");
  assert.ok(!m401[1].includes("clearLocalUserData("), "tryAuth 401 handler must NOT call clearLocalUserData()");
  assert.match(m401[1], /__handleAuthExpired\(token\)/, "tryAuth 401 handler must go through handleAuthExpired with the token it used");
  const hae = html.match(/function handleAuthExpired\(failedToken\) \{[\s\S]*?\n\}/);
  assert.ok(hae, "handleAuthExpired must be defined");
  assert.ok(!hae[0].includes("clearLocalUserData("), "handleAuthExpired must NOT wipe local data");
  // multi-tab (2026-10-17): hanya hapus token tersimpan bila masih token yang gagal (S2)
  assert.match(hae[0], /tokenStore\.clearIfStored\(used\)/);
  assert.ok(!html.includes('window.addEventListener("tf:auth-expired"'), "push 401 is reported by the transport, not a second listener");
  // api.fetch 401: tidak lagi tokenStore.clear() lalu __logout() (sesi zombie) — satu jalur handleAuthExpired
  const apiFetch401 = html.match(/if \(res\.status === 401 && !url\.includes\("\/api\/auth\/"\)\) \{[\s\S]*?\n\s*\}/);
  assert.ok(apiFetch401, "api.fetch 401 branch must exist");
  assert.match(apiFetch401[0], /__handleAuthExpired\(reqToken\)/);
  assert.ok(!apiFetch401[0].includes("window.__logout"), "api.fetch 401 must not call __logout (early-returns once token is cleared)");
  assert.ok(!apiFetch401[0].includes("tokenStore.clear()"), "api.fetch 401 must not clear the token itself (handleAuthExpired does, once)");
  // handleLogin: akun sama → data lokal dipertahankan dan push dijalankan (__syncNow)
  assert.match(html, /const handleLogin = async data =>\s*\{[\s\S]*?sameUser[\s\S]*?window\.__syncNow\?\.\(\)/);
});

test("7. Service Worker cache version is taskflow-v475-panel-tanpa-scrollbar", () => {
  const sw = fs.readFileSync(swPath, "utf8");
  const html = fs.readFileSync(htmlPath, "utf8");
  const webapp = fs.readFileSync(webappPath, "utf8");

  assert.match(sw, /^const CACHE = "taskflow-v475-panel-tanpa-scrollbar";/m, "sw.js CACHE must be v401");
  assert.match(html, /window\.__SW_VERSION\s*=\s*"taskflow-v475-panel-tanpa-scrollbar";/, "index.html fallback SW version must be v401");
  assert.match(html, /window\.__SW_VERSION\s*\|\|\s*"taskflow-v475-panel-tanpa-scrollbar"/, "index.html About modal SW version fallback must be v401");
});
