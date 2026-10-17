"use strict";
// Sesi login koheren antar-tab + perpanjangan token (plan 2026-10-17-multi-tab-session, Task 2–4).
// localStorage.tf_token = sumber kebenaran bersama; __token = cache per tab. 401 hanya mengakhiri sesi bila
// token yang dipakai request itu masih token tersimpan (S2); tab lain mengikuti login/logout (S1/S3).
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const indexHtml = fs.readFileSync(path.join(__dirname, "../../static/index.html"), "utf8");

function extract(re, name) {
  const m = indexHtml.match(re);
  assert.ok(m, name + " harus ada di index.html");
  return m[0];
}

const SRC = {
  tokenInit: () => extract(/let __token = .*;\n/, "let __token"),
  readStoredToken: () => extract(/function readStoredToken\(\) \{[\s\S]*?\n\}/, "readStoredToken"),
  tokenStore: () => extract(/const tokenStore = \{[\s\S]*?\n\};/, "tokenStore"),
  tokenPayload: () => extract(/function tokenPayload\(t\) \{[\s\S]*?\n\}/, "tokenPayload"),
  handleAuthExpired: () => extract(/function handleAuthExpired\(failedToken\) \{[\s\S]*?\n\}/, "handleAuthExpired(failedToken)"),
  sharedTokenAction: () => extract(/function sharedTokenAction\(token, currentUserId, lastUserId, storedUserId\) \{[\s\S]*?\n\}/, "sharedTokenAction"),
  onSharedTokenChanged: () => extract(/function onSharedTokenChanged\(\) \{[\s\S]*?\n\}/, "onSharedTokenChanged"),
  renewConsts: () => ["TOKEN_RENEW_THROTTLE_MS", "TOKEN_RENEW_CHECK_MS", "TOKEN_DEFAULT_LIFETIME_MS"]
    .map((n) => extract(new RegExp("const " + n + " = .*;\\n"), n)).join(""),
  tokenRenewDue: () => extract(/function tokenRenewDue\(payload, nowMs\) \{[\s\S]*?\n\}/, "tokenRenewDue"),
  maybeRenewToken: () => extract(/let __tokenRenewInFlight = null;\nfunction maybeRenewToken\(\) \{[\s\S]*?\n\}/, "maybeRenewToken"),
  tabReload: () => extract(/let __tabReloading = false;\nfunction beginTabReload\(\) \{[\s\S]*?\n\}/, "beginTabReload"),
  syncFetch: () => extract(/function syncFetch\(url, opts, timeoutMs\) \{[\s\S]*?\n\}/, "syncFetch"),
  tokenWriteFlag: () => extract(/let __tokenWriteFailed = false;\n/, "__tokenWriteFailed"),
  logoutGuard: () => extract(/let __logoutInProgress = false;\nfunction beginLogoutGuard\(\) \{[\s\S]*?\n\}\nfunction endLogoutGuard\(\) \{[\s\S]*?\n\}/, "beginLogoutGuard/endLogoutGuard"),
  api: () => extract(/const api = \{[\s\S]*?\n\};/, "api"),
  syncTransport: () => extract(/const __syncTransport = \{[\s\S]*?\n\};/, "__syncTransport"),
  syncRawFetch: () => extract(/const __syncRawFetch = \([\s\S]*?\n\};/, "__syncRawFetch"),
  storageListener: () => extract(/window\.addEventListener\("storage", [\s\S]*?\n\}\);/, "storage listener"),
};

const b64url = (s) => Buffer.from(s, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const jwt = (payload) => "eyJhbGciOiJIUzI1NiJ9." + b64url(JSON.stringify(payload)) + ".sig";

function makeLocalStorage(init) {
  const m = new Map(Object.entries(init || {}));
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
    _map: m,
  };
}

// Muat inti auth index.html dalam sandbox: localStorage/window/fetch palsu, akses __token lewat getter.
function load(opts = {}) {
  const ls = opts.localStorage || makeLocalStorage(opts.stored);
  const listeners = {};
  const calls = { authExpired: 0, schedulePush: 0, shared: [], fetch: [], syncFetch: [], tauri: [] };
  const win = {
    addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
    __onAuthExpired: () => { calls.authExpired++; },
    __onSharedTokenChanged: (next, prev) => { calls.shared.push([next, prev]); },
    location: { reload: () => { calls.reload = (calls.reload || 0) + 1; } },
    fetch: (url, init) => { calls.fetch.push({ url, init }); return (opts.windowFetch || (() => Promise.reject(new Error("no fetch"))))(url, init); },
  };
  if (opts.tauri) win.__TAURI__ = { core: { invoke: (cmd, args) => { calls.tauri.push([cmd, args]); return Promise.resolve(); } } };
  const fetchStub = (url, init) => { calls.fetch.push({ url, init }); return opts.fetch(url, init); };
  const syncFetchStub = (url, init, ms) => { calls.syncFetch.push({ url, init, ms }); return opts.syncFetch(url, init, ms); };
  const parts = [
    SRC.readStoredToken(), SRC.tokenInit(), SRC.tabReload(), SRC.tokenWriteFlag(), SRC.tokenStore(), SRC.tokenPayload(),
    "function schedulePush() { calls.schedulePush++; }",
    SRC.handleAuthExpired(), SRC.sharedTokenAction(), SRC.onSharedTokenChanged(),
    SRC.renewConsts(), SRC.tokenRenewDue(), SRC.maybeRenewToken(), SRC.logoutGuard(),
    "window.__handleAuthExpired = handleAuthExpired;",
  ];
  if (opts.withApi) parts.push(SRC.api());
  if (opts.withSync) parts.push(SRC.syncTransport(), SRC.syncRawFetch());
  if (opts.realSyncFetch) parts.push("const SYNC_FETCH_TIMEOUT_MS = 30000, SYNC_UPLOAD_MAX_MS = 600000;", SRC.syncFetch());
  if (opts.withStorageListener) parts.push(SRC.storageListener());
  parts.push(`return {
    readStoredToken, tokenStore, tokenPayload, handleAuthExpired, sharedTokenAction, onSharedTokenChanged,
    beginTabReload, isReloading: () => __tabReloading,
    realSyncFetch: typeof syncFetch === "function" && ${opts.realSyncFetch ? "true" : "false"} ? syncFetch : null,
    tokenRenewDue, maybeRenewToken, beginLogoutGuard, endLogoutGuard, TOKEN_RENEW_THROTTLE_MS, TOKEN_RENEW_CHECK_MS, TOKEN_DEFAULT_LIFETIME_MS,
    api: typeof api !== "undefined" ? api : null,
    syncTransport: typeof __syncTransport !== "undefined" ? __syncTransport : null,
    syncRawFetch: typeof __syncRawFetch !== "undefined" ? __syncRawFetch : null,
    getToken: () => __token, setToken: (t) => { __token = t; },
  };`);
  const mod = new Function("localStorage", "window", "navigator", "API_BASE", "apiUrl", "fetch", "syncFetch", "calls",
    parts.join("\n"))(ls, win, opts.navigator || { onLine: true }, opts.apiBase != null ? opts.apiBase : "", (p) => p,
    fetchStub, syncFetchStub, calls);
  return Object.assign(mod, { ls, win, calls, listeners });
}

const resp = (status, body) => ({ status, ok: status >= 200 && status < 300, text: async () => (body == null ? "" : JSON.stringify(body)), json: async () => body });

// ── handleAuthExpired ─────────────────────────────────────────────────────────────────────────────
const tokA = (n, sub = "7") => jwt({ sub, n, exp: 9e9 }); // token akun `sub`, varian n

test("handleAuthExpired adopts a newer stored token of the same account: returns true, no login form, storage untouched", () => {
  const T1 = tokA(1), T2 = tokA(2);
  const m = load({ stored: { tf_token: T2, tf_user_id: "7" } });
  m.setToken(T1);
  assert.equal(m.handleAuthExpired(T1), true);
  assert.equal(m.getToken(), T2, "token tersimpan diadopsi");
  assert.equal(m.ls.getItem("tf_token"), T2);
  assert.equal(m.calls.authExpired, 0);
  assert.equal(m.calls.schedulePush, 1, "push dijadwalkan ulang dengan token baru");
});

test("handleAuthExpired: genuine expiry clears memory + storage, calls __onAuthExpired once; second call is a no-op", () => {
  const m = load({ stored: { tf_token: "T1", tf_user_id: "7" }, tauri: true, apiBase: "https://x" });
  assert.equal(m.getToken(), "T1");
  assert.equal(m.handleAuthExpired("T1"), false);
  assert.equal(m.getToken(), null);
  assert.equal(m.ls.getItem("tf_token"), null);
  assert.equal(m.ls.getItem("tf_user_id"), "7", "tf_user_id dipertahankan (sesi berakhir ≠ ganti pengguna)");
  assert.equal(m.calls.authExpired, 1);
  assert.deepEqual(m.calls.tauri.map((c) => c[0]), ["delete_token"]);
  assert.equal(m.handleAuthExpired("T1"), false);
  assert.equal(m.handleAuthExpired(), false);
  assert.equal(m.calls.authExpired, 1, "request paralel yang sama-sama 401 tidak menampilkan login dua kali");
});

test("handleAuthExpired() without argument means the token this tab currently holds", () => {
  const m = load({ stored: { tf_token: "T1" } });
  assert.equal(m.handleAuthExpired(), false);
  assert.equal(m.ls.getItem("tf_token"), null);
  assert.equal(m.calls.authExpired, 1);
});

test("S2: stale tab (memory T1, stored T2) gets a late 401 for T1 → stored T2 survives, tab adopts T2", () => {
  const T1 = tokA(1), T2 = tokA(2);
  const m = load({ stored: { tf_token: T1 } });
  m.ls.setItem("tf_token", T2); // tab A login setelah token kedaluwarsa (tanpa event storage)
  assert.equal(m.getToken(), T1);
  assert.equal(m.handleAuthExpired(T1), true);
  assert.equal(m.ls.getItem("tf_token"), T2);
  assert.equal(m.getToken(), T2);
  assert.equal(m.calls.authExpired, 0);
});

test("handleAuthExpired: 401 for an old token while this tab already holds a newer one → true, nothing cleared", () => {
  const T1 = tokA(1), T2 = tokA(2);
  const m = load({ stored: { tf_token: T2 } });
  assert.equal(m.handleAuthExpired(T1), true);
  assert.equal(m.getToken(), T2);
  assert.equal(m.ls.getItem("tf_token"), T2);
  assert.equal(m.calls.authExpired, 0);
});

test("handleAuthExpired never wipes local data", () => {
  const src = SRC.handleAuthExpired();
  assert.ok(!src.includes("clearLocalUserData("));
  assert.match(src, /clearIfStored\(used\)/);
});

// ── tokenStore ────────────────────────────────────────────────────────────────────────────────────
test("tokenStore.clearIfStored never removes a different stored token", () => {
  const m = load({ stored: { tf_token: "T2" } });
  m.tokenStore.clearIfStored("T1");
  assert.equal(m.getToken(), null);
  assert.equal(m.ls.getItem("tf_token"), "T2");
  m.setToken("T2");
  m.tokenStore.clearIfStored("T2");
  assert.equal(m.ls.getItem("tf_token"), null);
});

test("tokenStore.syncFromStorage adopts the stored value and reports whether it changed", () => {
  const m = load({ stored: { tf_token: "T1" } });
  assert.equal(m.tokenStore.syncFromStorage(), false);
  m.ls.setItem("tf_token", "T2");
  assert.equal(m.tokenStore.syncFromStorage(), true);
  assert.equal(m.tokenStore.get(), "T2");
  m.ls.removeItem("tf_token");
  assert.equal(m.tokenStore.syncFromStorage(), true);
  assert.equal(m.tokenStore.get(), null);
});

test("readStoredToken falls back to the in-memory token when localStorage throws", () => {
  const m = load({ stored: { tf_token: "T1" } });
  m.ls.getItem = () => { throw new Error("SecurityError"); };
  assert.equal(m.readStoredToken(), "T1");
});

// ── tokenPayload ──────────────────────────────────────────────────────────────────────────────────
test("tokenPayload decodes base64url (with - / _ and no padding) and returns null on garbage", () => {
  const m = load();
  // username dipilih supaya base64-nya memuat '+' dan '/' (→ '-' dan '_' di base64url)
  const payload = { sub: "42", username: "ü>>?~~é", exp: 1 };
  const tok = jwt(payload);
  const seg = tok.split(".")[1];
  assert.ok(/[-_]/.test(seg), "segmen uji harus memuat karakter base64url");
  assert.ok(seg.length % 4 !== 0, "segmen uji tanpa padding");
  assert.deepEqual(m.tokenPayload(tok), payload);
  assert.equal(m.tokenPayload(null), null);
  assert.equal(m.tokenPayload(""), null);
  assert.equal(m.tokenPayload("abc"), null);
  assert.equal(m.tokenPayload("a.!!!.c"), null);
  assert.equal(m.tokenPayload("a." + b64url("not json") + ".c"), null);
});

// ── sharedTokenAction ─────────────────────────────────────────────────────────────────────────────
test("sharedTokenAction: every branch", () => {
  const { sharedTokenAction: act } = load();
  const t7 = jwt({ sub: "7", exp: 9e9 });
  const t8 = jwt({ sub: "8", exp: 9e9 });
  // token dihapus tab lain
  assert.equal(act(null, null, 7, "7"), "none", "tab sudah di form login");
  assert.equal(act(null, 7, 7, "7"), "expire", "tf_user_id masih ada → sesi berakhir di tab lain");
  assert.equal(act(null, 7, 7, null), "reload", "logout manual menghapus tf_user_id");
  // token baru, tab ini masuk
  assert.equal(act(t7, 7, 7, "7"), "none", "perpanjangan / login ulang akun sama");
  assert.equal(act(t8, 7, 7, "8"), "reload", "akun lain masuk di tab lain");
  assert.equal(act("garbage", 7, 7, "7"), "none", "payload tak terbaca → jangan reload");
  // token baru, tab ini di form login
  assert.equal(act(t7, null, 7, "7"), "restore");
  assert.equal(act(t7, null, null, "7"), "restore", "belum pernah masuk di tab ini");
  assert.equal(act(t8, null, 7, "8"), "reload", "akun berbeda dari yang terakhir masuk di tab ini");
});

// ── onSharedTokenChanged + listener storage ───────────────────────────────────────────────────────
test("onSharedTokenChanged calls the hook with (next, prev) only when the stored value changed", () => {
  const m = load({ stored: { tf_token: "T1" } });
  assert.equal(m.onSharedTokenChanged(), false);
  assert.equal(m.calls.shared.length, 0);
  m.ls.setItem("tf_token", "T2");
  assert.equal(m.onSharedTokenChanged(), true);
  assert.deepEqual(m.calls.shared, [["T2", "T1"]]);
  assert.equal(m.getToken(), "T2");
  m.ls.removeItem("tf_token");
  m.win.__onSharedTokenChanged = () => { throw new Error("boom"); };
  assert.equal(m.onSharedTokenChanged(), true, "error di hook tidak bocor");
  assert.equal(m.getToken(), null);
});

test("storage listener reacts to tf_token / clear() on localStorage only", () => {
  const m = load({ stored: { tf_token: "T1" }, withStorageListener: true });
  const fire = (e) => m.listeners.storage.forEach((fn) => fn(e));
  m.ls.setItem("tf_token", "T2");
  fire({ key: "tf_theme", storageArea: m.ls });
  assert.equal(m.calls.shared.length, 0, "kunci lain diabaikan");
  fire({ key: "tf_token", storageArea: {} });
  assert.equal(m.calls.shared.length, 0, "sessionStorage diabaikan");
  fire({ key: "tf_token", storageArea: m.ls, newValue: "T2" });
  assert.deepEqual(m.calls.shared, [["T2", "T1"]]);
  m.ls.removeItem("tf_token");
  fire({ key: null, storageArea: m.ls });
  assert.deepEqual(m.calls.shared[1], [null, "T2"], "localStorage.clear() → key null");
});

test("top-level listeners: visibility/focus/pageshow resync, online + interval renew", () => {
  assert.match(indexHtml, /document\.addEventListener\("visibilitychange", \(\) => \{[\s\S]*?onSharedTokenChanged\(\);[\s\S]*?maybeRenewToken\(\);/);
  assert.match(indexHtml, /window\.addEventListener\("focus", \(\) => \{?\s*onSharedTokenChanged\(\)/);
  assert.match(indexHtml, /window\.addEventListener\("pageshow", \(\) => \{?\s*onSharedTokenChanged\(\)/);
  assert.match(indexHtml, /window\.addEventListener\("online", \(\) => \{?\s*maybeRenewToken\(\)/);
  assert.match(indexHtml, /setInterval\(maybeRenewToken, TOKEN_RENEW_CHECK_MS\)/);
  assert.match(indexHtml, /window\.__maybeRenewToken = maybeRenewToken;/);
  // listener level atas terpasang sebelum React mount (sebelum function App)
  assert.ok(indexHtml.indexOf('window.addEventListener("storage"') < indexHtml.indexOf("function App("));
});

// ── tokenRenewDue ─────────────────────────────────────────────────────────────────────────────────
test("tokenRenewDue: fresh false, 25h-old 72h token true, expired false, legacy (no iat) uses 72h", () => {
  const { tokenRenewDue: due, TOKEN_DEFAULT_LIFETIME_MS, TOKEN_RENEW_THROTTLE_MS, TOKEN_RENEW_CHECK_MS } = load();
  assert.equal(TOKEN_DEFAULT_LIFETIME_MS, 72 * 3600 * 1000);
  assert.equal(TOKEN_RENEW_THROTTLE_MS, 10 * 60 * 1000);
  assert.equal(TOKEN_RENEW_CHECK_MS, 3600 * 1000);
  const now = 1_800_000_000_000;
  const s = Math.floor(now / 1000);
  const H = 3600;
  assert.equal(due({ iat: s - 60, exp: s - 60 + 72 * H }, now), false, "token segar");
  assert.equal(due({ iat: s - 25 * H, exp: s - 25 * H + 72 * H }, now), true, "umur 25 jam ≥ 24 jam");
  assert.equal(due({ iat: s - 23 * H, exp: s - 23 * H + 72 * H }, now), false, "umur 23 jam");
  assert.equal(due({ iat: s - 80 * H, exp: s - 8 * H }, now), false, "sudah kedaluwarsa");
  assert.equal(due({ exp: s + 47 * H }, now), true, "tanpa iat: umur 25 jam dari 72");
  assert.equal(due({ exp: s + 60 * H }, now), false, "tanpa iat: umur 12 jam dari 72");
  assert.equal(due({ iat: s }, now), false, "tanpa exp");
  assert.equal(due(null, now), false);
});

// ── maybeRenewToken ───────────────────────────────────────────────────────────────────────────────
const nowS = () => Math.floor(Date.now() / 1000);
const oldTok = (sub = "7") => jwt({ sub, iat: nowS() - 30 * 3600, exp: nowS() + 42 * 3600 });
const freshTok = () => jwt({ sub: "7", iat: nowS(), exp: nowS() + 72 * 3600 });

test("maybeRenewToken: due → POST /api/auth/refresh with the bearer, stores the new token (+ Tauri)", async () => {
  const t1 = oldTok();
  const t2 = freshTok();
  const m = load({ stored: { tf_token: t1 }, tauri: true, apiBase: "https://x", windowFetch: async () => resp(200, { renewed: true, token: t2, expires_in: 259200 }) });
  assert.equal(await m.maybeRenewToken(), true);
  assert.equal(m.calls.fetch.length, 1);
  assert.equal(m.calls.fetch[0].url, "/api/auth/refresh");
  assert.equal(m.calls.fetch[0].init.method, "POST");
  assert.equal(m.calls.fetch[0].init.headers.Authorization, "Bearer " + t1);
  assert.equal(m.getToken(), t2);
  assert.equal(m.ls.getItem("tf_token"), t2);
  assert.ok(Number(m.ls.getItem("tf_token_renew_at")) > 0, "throttle antar-tab dicatat");
  assert.deepEqual(m.calls.tauri, [["save_token", { token: t2 }]]);
});

test("maybeRenewToken: concurrent calls share one in-flight request", async () => {
  let release;
  const m = load({ stored: { tf_token: oldTok() }, windowFetch: () => new Promise((r) => { release = () => r(resp(200, { renewed: true, token: "N" })); }) });
  const p1 = m.maybeRenewToken();
  const p2 = m.maybeRenewToken();
  assert.equal(p1, p2);
  await new Promise((r) => setImmediate(r));
  release();
  assert.equal(await p1, true);
  assert.equal(m.calls.fetch.length, 1);
});

test("maybeRenewToken: not due / offline / no token → no fetch", async () => {
  const fail = async () => { throw new Error("tidak boleh fetch"); };
  const fresh = load({ stored: { tf_token: freshTok() }, windowFetch: fail });
  assert.equal(await fresh.maybeRenewToken(), false);
  assert.equal(fresh.calls.fetch.length, 0);
  const offline = load({ stored: { tf_token: oldTok() }, navigator: { onLine: false }, windowFetch: fail });
  assert.equal(await offline.maybeRenewToken(), false);
  assert.equal(offline.calls.fetch.length, 0);
  const none = load({ windowFetch: fail });
  assert.equal(await none.maybeRenewToken(), false);
  assert.equal(none.calls.fetch.length, 0);
});

test("maybeRenewToken: token changed while in flight → new token not overwritten", async () => {
  const t1 = oldTok();
  let m;
  m = load({ stored: { tf_token: t1 }, windowFetch: async () => { m.tokenStore.set("OTHER"); return resp(200, { renewed: true, token: "RENEWED" }); } });
  assert.equal(await m.maybeRenewToken(), false);
  assert.equal(m.getToken(), "OTHER");
  assert.equal(m.ls.getItem("tf_token"), "OTHER");
});

test("maybeRenewToken: cross-tab throttle key recent → no fetch; stale key → fetch", async () => {
  const m = load({ stored: { tf_token: oldTok(), tf_token_renew_at: String(Date.now() - 60 * 1000) }, windowFetch: async () => resp(200, { renewed: true, token: "N" }) });
  assert.equal(await m.maybeRenewToken(), false);
  assert.equal(m.calls.fetch.length, 0);
  m.ls.setItem("tf_token_renew_at", String(Date.now() - 11 * 60 * 1000));
  assert.equal(await m.maybeRenewToken(), true);
  assert.equal(m.calls.fetch.length, 1);
});

test("maybeRenewToken: non-ok / renewed:false / network error → false, token kept", async () => {
  for (const wf of [async () => resp(401, { detail: "x" }), async () => resp(200, { renewed: false, reason: "max_age" }), async () => { throw new TypeError("Failed to fetch"); }]) {
    const t1 = oldTok();
    const m = load({ stored: { tf_token: t1 }, windowFetch: wf });
    assert.equal(await m.maybeRenewToken(), false);
    assert.equal(m.getToken(), t1);
    assert.equal(m.ls.getItem("tf_token"), t1);
    assert.equal(m.calls.authExpired, 0, "refresh gagal tidak menampilkan form login");
  }
});

// ── api.fetch ─────────────────────────────────────────────────────────────────────────────────────
test("api.fetch: 401 after another tab logged in (same account) → retries once with the adopted token", async () => {
  const T1 = tokA(1), T2 = tokA(2);
  const seen = [];
  const m = load({
    stored: { tf_token: T1 }, withApi: true,
    fetch: async (url, init) => {
      seen.push(init.headers.Authorization);
      if (init.headers.Authorization === "Bearer " + T1) { m.ls.setItem("tf_token", T2); return resp(401, { detail: "expired" }); }
      return resp(200, { ok: 1 });
    },
  });
  assert.deepEqual(await m.api.get("/api/tasks"), { ok: 1 });
  assert.deepEqual(seen, ["Bearer " + T1, "Bearer " + T2]);
  assert.equal(m.calls.authExpired, 0);
  assert.ok(!m.calls.fetch.some((c) => "__authRetried" in c.init), "flag internal tidak diteruskan ke fetch");
});

test("api.fetch: retry does not loop when the adopted token is also rejected", async () => {
  let n = 0;
  const m = load({
    stored: { tf_token: tokA(1) }, withApi: true,
    fetch: async () => { n++; m.ls.setItem("tf_token", tokA(n + 1)); return resp(401, {}); },
  });
  await assert.rejects(m.api.get("/api/tasks"), (e) => e.status === 401);
  assert.equal(n, 2, "satu request + satu retry");
});

test("api.fetch: genuine 401 → session expired once, error thrown, no retry", async () => {
  const m = load({ stored: { tf_token: "T1" }, withApi: true, fetch: async () => resp(401, {}) });
  await assert.rejects(m.api.get("/api/tasks"), (e) => e.status === 401);
  assert.equal(m.calls.fetch.length, 1);
  assert.equal(m.calls.authExpired, 1);
  assert.equal(m.ls.getItem("tf_token"), null);
});

test("api.fetch: /api/auth/* 401 is not treated as session expiry", async () => {
  const m = load({ stored: { tf_token: "T1" }, withApi: true, fetch: async () => resp(401, { detail: "bad" }) });
  await assert.rejects(m.api.get("/api/auth/me"), (e) => e.status === 401);
  assert.equal(m.calls.authExpired, 0);
  assert.equal(m.ls.getItem("tf_token"), "T1");
});

// ── transport sinkron ─────────────────────────────────────────────────────────────────────────────
test("__syncTransport reports the token it sent (stale 401 does not clear a newer token)", async () => {
  const T1 = tokA(1), T2 = tokA(2);
  const m = load({
    stored: { tf_token: T1 }, withSync: true,
    syncFetch: async () => { m.ls.setItem("tf_token", T2); return resp(401, { detail: "expired" }); },
  });
  const r = await m.syncTransport.request("POST", "/api/sync/x", { a: 1 });
  assert.equal(r.status, 401, "respons dikembalikan apa adanya (syncpush menghentikan drain)");
  assert.deepEqual(r.data, { detail: "expired" });
  assert.equal(m.calls.syncFetch[0].init.headers.Authorization, "Bearer " + T1);
  assert.equal(m.getToken(), T2);
  assert.equal(m.ls.getItem("tf_token"), T2);
  assert.equal(m.calls.authExpired, 0);
});

test("__syncTransport: genuine 401 ends the session; 200 does not touch auth", async () => {
  const m = load({ stored: { tf_token: "T1" }, withSync: true, syncFetch: async () => resp(401, {}) });
  await m.syncTransport.request("GET", "/api/x");
  assert.equal(m.calls.authExpired, 1);
  assert.equal(m.ls.getItem("tf_token"), null);
  const ok = load({ stored: { tf_token: "T1" }, withSync: true, syncFetch: async () => resp(200, { a: 1 }) });
  assert.deepEqual(await ok.syncTransport.request("GET", "/api/x"), { status: 200, data: { a: 1 } });
  assert.equal(ok.calls.authExpired, 0);
});

test("__syncRawFetch reports the token it sent and returns the raw response", async () => {
  const T1 = tokA(1), T2 = tokA(2);
  const m = load({
    stored: { tf_token: T1 }, withSync: true,
    syncFetch: async () => { m.ls.setItem("tf_token", T2); return resp(401, {}); },
  });
  const r = await m.syncRawFetch("/api/tasks", 1234);
  assert.equal(r.status, 401);
  assert.equal(m.calls.syncFetch[0].init.headers.Authorization, "Bearer " + T1);
  assert.equal(m.calls.syncFetch[0].ms, 1234);
  assert.equal(m.getToken(), T2);
  assert.equal(m.calls.authExpired, 0);
  const g = load({ stored: { tf_token: "T1" }, withSync: true, syncFetch: async () => resp(401, {}) });
  await g.syncRawFetch("/api/tasks");
  assert.equal(g.calls.authExpired, 1);
});

// ── sync() dan App ────────────────────────────────────────────────────────────────────────────────
test("sync(): no second auth report and no tf:auth-expired window listener", () => {
  const m = indexHtml.match(/function sync\(\) \{[\s\S]*?\n\}/);
  assert.ok(m);
  assert.ok(!/stepFailed = [^\n]*handleAuthExpired/.test(m[0]), "stepFailed tidak lagi memanggil handleAuthExpired");
  assert.ok(!indexHtml.includes('window.addEventListener("tf:auth-expired"'), "listener tf:auth-expired dihapus (transport sudah melapor)");
});

test("App wires tryAuth / shared-token handler", () => {
  assert.match(indexHtml, /window\.__restoreSession = \(\) => tryAuth\(\);/);
  assert.match(indexHtml, /const adopted = [^\n]*__handleAuthExpired\(token\)/);
  assert.match(indexHtml, /window\.__onSharedTokenChanged = /);
  assert.match(indexHtml, /sharedTokenAction\(token, userRef\.current/);
  assert.match(indexHtml, /const userRef = useRef\(null\);/);
  assert.match(indexHtml, /const lastUserIdRef = useRef\(null\);/);
});

// ── Review 2026-10-17: C1 / C2 / I3 / logout setelah adopsi ─────────────────────────────────────────
test("C1: handleAuthExpired does not silently adopt another account's token → hands it to the App hook", () => {
  const X1 = tokA(1, "7"), Y = tokA(1, "8");
  const m = load({ stored: { tf_token: X1, tf_user_id: "7" } });
  m.ls.setItem("tf_token", Y); // tab A login sebagai Y (tanpa event storage di tab ini)
  assert.equal(m.handleAuthExpired(X1), false, "bukan adopsi → tidak ada retry");
  assert.deepEqual(m.calls.shared, [[Y, X1]], "sharedTokenAction App yang memutuskan (reload/restore)");
  assert.equal(m.calls.schedulePush, 0, "op akun X tidak dikirim sebagai Y");
  assert.equal(m.calls.authExpired, 0);
  assert.equal(m.ls.getItem("tf_token"), Y, "token Y tidak dihapus");
});

test("C1: unparseable tokens are never adopted silently", () => {
  const m = load({ stored: { tf_token: "T1" } });
  m.ls.setItem("tf_token", "T2");
  assert.equal(m.handleAuthExpired("T1"), false);
  assert.deepEqual(m.calls.shared, [["T2", "T1"]]);
  assert.equal(m.calls.schedulePush, 0);
});

test("C1: api.fetch does not retry under another account's token", async () => {
  const X1 = tokA(1, "7"), Y = tokA(1, "8");
  const seen = [];
  const m = load({
    stored: { tf_token: X1 }, withApi: true,
    fetch: async (url, init) => { seen.push(init.headers.Authorization); m.ls.setItem("tf_token", Y); return resp(401, {}); },
  });
  await assert.rejects(m.api.post("/api/tasks", { title: "milik X" }), (e) => e.status === 401);
  assert.deepEqual(seen, ["Bearer " + X1], "POST milik X tidak diulang sebagai Y");
  assert.equal(m.calls.shared.length, 1);
});

test("C1: tryAuth 401 without adoption but with a token handed over → no login form", () => {
  const m = indexHtml.match(/if \(err && err\.status === 401\) \{([\s\S]*?)\n\s*setShowForm\(false\);/);
  assert.ok(m);
  assert.match(m[1], /if \(adopted === true\) \{\s*tryAuth\(\);\s*return;\s*\}/);
  assert.match(m[1], /if \(tokenStore\.get\(\)\) return;/);
});

const renewDeferred = (t1) => {
  let release;
  const m = load({ stored: { tf_token: t1 }, windowFetch: () => new Promise((r) => { release = () => r(resp(200, { renewed: true, token: "RENEWED" })); }) });
  return { m, release: () => release() };
};
const tick = () => new Promise((r) => setImmediate(r));

test("C2: renewal resolving after beginLogoutGuard() does not write the token", async () => {
  const t1 = oldTok();
  const { m, release } = renewDeferred(t1);
  const p = m.maybeRenewToken();
  await tick();
  const g = m.beginLogoutGuard();
  assert.equal(g, p, "logout menunggu perpanjangan in-flight");
  assert.ok(Number(m.ls.getItem("tf_logout_at")) > 0);
  release();
  assert.equal(await g, false);
  assert.equal(m.getToken(), t1);
  assert.equal(m.ls.getItem("tf_token"), t1);
  m.endLogoutGuard();
});

test("C2: beginLogoutGuard without a renewal in flight resolves", async () => {
  const m = load({ stored: { tf_token: freshTok() } });
  await m.beginLogoutGuard();
  m.endLogoutGuard();
});

test("C2: tf_logout_at written by another tab after the renewal started → token not written", async () => {
  const t1 = oldTok();
  const { m, release } = renewDeferred(t1);
  const p = m.maybeRenewToken();
  await tick();
  m.ls.setItem("tf_logout_at", String(Date.now() + 1));
  release();
  assert.equal(await p, false);
  assert.equal(m.ls.getItem("tf_token"), t1);
});

test("C2: stored token changed or cleared while in flight → not written", async () => {
  for (const mutate of [(ls) => ls.removeItem("tf_token"), (ls) => ls.setItem("tf_token", "OTHER")]) {
    const t1 = oldTok();
    const { m, release } = renewDeferred(t1);
    const p = m.maybeRenewToken();
    await tick();
    const before = (mutate(m.ls), m.ls.getItem("tf_token"));
    release();
    assert.equal(await p, false);
    assert.equal(m.ls.getItem("tf_token"), before, "tidak menghidupkan sesi yang sudah keluar");
    assert.equal(m.getToken(), t1, "memori diperbarui lewat event storage, bukan oleh perpanjangan");
  }
});

test("C2: normal renewal works after endLogoutGuard() and with an older tf_logout_at", async () => {
  const t1 = oldTok();
  const m = load({ stored: { tf_token: t1, tf_logout_at: String(Date.now() - 60000) }, windowFetch: async () => resp(200, { renewed: true, token: "N" }) });
  await m.beginLogoutGuard();
  m.endLogoutGuard();
  m.ls.setItem("tf_logout_at", String(Date.now() - 60000));
  assert.equal(await m.maybeRenewToken(), true);
  assert.equal(m.ls.getItem("tf_token"), "N");
});

test("C2: logout() sets the guard only after confirmations and always ends it", () => {
  const m = indexHtml.match(/const logout = useCallback\(async \(\) => \{[\s\S]*?\n  \}, \[\]\);/);
  assert.ok(m);
  const src = m[0];
  const iConfirm = src.indexOf("window.confirm(");
  const iGuard = src.indexOf("await beginLogoutGuard()");
  const iPost = src.indexOf('api.post("/api/auth/logout"');
  assert.ok(iConfirm > 0 && iGuard > iConfirm && iPost > iGuard, "guard setelah konfirmasi, sebelum POST logout");
  assert.match(src.slice(iGuard), /\} finally \{\s*endLogoutGuard\(\);/);
});

test("I3: setItem failure → syncFromStorage keeps the in-memory token", () => {
  const m = load({ stored: { tf_token: "OLD" } });
  const real = m.ls.setItem;
  m.ls.setItem = () => { throw new Error("QuotaExceededError"); };
  m.tokenStore.set("NEW");
  assert.equal(m.getToken(), "NEW");
  assert.equal(m.tokenStore.syncFromStorage(), false, "nilai basi tidak menimpa token di memori");
  assert.equal(m.onSharedTokenChanged(), false);
  assert.equal(m.getToken(), "NEW");
  m.ls.setItem = real;
  m.tokenStore.set("NEW2");
  m.ls.setItem("tf_token", "FROM_TAB");
  assert.equal(m.tokenStore.syncFromStorage(), true, "tulis berhasil lagi → sinkron normal");
});

test("I3: setItem failure → handleAuthExpired ignores the stale stored token", () => {
  const OLD = tokA(1), NEW = tokA(2);
  const m = load({ stored: { tf_token: OLD } });
  m.ls.setItem = () => { throw new Error("QuotaExceededError"); };
  m.tokenStore.set(NEW);
  assert.equal(m.handleAuthExpired(NEW), false, "token gagal = token tab ini → sesi berakhir");
  assert.equal(m.calls.authExpired, 1);
  assert.equal(m.getToken(), null);
});

test("I3: clear() success resets the write-failed flag", () => {
  const m = load({ stored: { tf_token: "OLD" } });
  const real = m.ls.setItem;
  m.ls.setItem = () => { throw new Error("quota"); };
  m.tokenStore.set("NEW");
  m.ls.setItem = real;
  m.tokenStore.clear();
  m.ls.setItem("tf_token", "T2");
  assert.equal(m.tokenStore.syncFromStorage(), true);
});

test("logout after a push 401 that ended in adoption pushes again instead of silently cancelling", () => {
  const m = indexHtml.match(/const logout = useCallback\(async \(\) => \{[\s\S]*?\n  \}, \[\]\);/);
  assert.ok(m);
  assert.match(m[0], /if \(r && r\.authExpired && tokenStore\.get\(\)\) \{[\s\S]*?await window\.__pushNow\(\)/);
  assert.match(m[0], /if \(r && r\.authExpired && !tokenStore\.get\(\) && pending > 0\)/);
});

// ── Re-review: jendela sebelum reload (akun lain masuk di tab lain) ──────────────────────────────────
test("beginTabReload sets the flag, clears the in-memory token (storage untouched) and reloads", () => {
  const m = load({ stored: { tf_token: "Y" } });
  assert.equal(m.isReloading(), false);
  m.beginTabReload();
  assert.equal(m.isReloading(), true);
  assert.equal(m.getToken(), null);
  assert.equal(m.ls.getItem("tf_token"), "Y", "token akun lain milik tab lain tidak dihapus");
  assert.equal(m.calls.reload, 1);
});

test("while reloading: syncFetch rejects like a network failure without fetching", async () => {
  const m = load({ stored: { tf_token: "T1" }, realSyncFetch: true, windowFetch: async () => resp(200, {}) });
  m.beginTabReload();
  await assert.rejects(m.realSyncFetch("/api/x", {}), (e) => e instanceof TypeError && e.name !== "AbortError");
  assert.equal(m.calls.fetch.length, 0);
});

test("while reloading: __syncTransport / __syncRawFetch send nothing (syncpush sees a network error)", async () => {
  const m = load({ stored: { tf_token: "T1" }, withSync: true, realSyncFetch: true, windowFetch: async () => resp(200, {}) });
  m.beginTabReload();
  await assert.rejects(m.syncTransport.request("POST", "/api/x", { a: 1 }));
  await assert.rejects(m.syncRawFetch("/api/tasks"));
  assert.equal(m.calls.fetch.length, 0, "tidak ada request (cookie bersama = akun lain)");
  assert.equal(m.calls.authExpired, 0);
});

test("syncFetch still fetches normally when not reloading", async () => {
  const m = load({ realSyncFetch: true, windowFetch: async () => resp(200, { ok: 1 }) });
  const r = await m.realSyncFetch("/api/x", { headers: {} });
  assert.equal(r.status, 200);
  assert.equal(m.calls.fetch.length, 1);
});

test("while reloading: api.fetch network path throws without fetching", async () => {
  const m = load({ stored: { tf_token: "T1" }, withApi: true, fetch: async () => resp(200, {}) });
  m.beginTabReload();
  await assert.rejects(m.api.post("/api/tasks", { title: "x" }));
  assert.equal(m.calls.fetch.length, 0);
});

test("while reloading: maybeRenewToken resolves false without fetching", async () => {
  const m = load({ stored: { tf_token: oldTok() }, windowFetch: async () => resp(200, { renewed: true, token: "N" }) });
  m.setToken(oldTok()); // token masih ada di memori: guard harus tetap menahan
  m.beginTabReload();
  m.setToken(oldTok());
  assert.equal(await m.maybeRenewToken(), false);
  assert.equal(m.calls.fetch.length, 0);
});

test("while reloading: handleAuthExpired and onSharedTokenChanged are inert", () => {
  const m = load({ stored: { tf_token: tokA(1) } });
  m.beginTabReload();
  m.ls.setItem("tf_token", tokA(2));
  assert.equal(m.handleAuthExpired(tokA(1)), false);
  assert.equal(m.onSharedTokenChanged(), false);
  assert.equal(m.getToken(), null, "tidak mengadopsi apa pun");
  assert.equal(m.calls.authExpired, 0);
  assert.equal(m.calls.shared.length, 0);
  assert.equal(m.calls.schedulePush, 0);
  assert.equal(m.ls.getItem("tf_token"), tokA(2));
});

test("schedulePush is a no-op while reloading", () => {
  const src = extract(/function schedulePush\(\) \{[\s\S]*?\n\}/, "schedulePush");
  assert.match(src, /if \(__tabReloading/);
});

test("App shared-token handler reloads via beginTabReload()", () => {
  const m = indexHtml.match(/const handler = token => \{[\s\S]*?\n    \};/);
  assert.ok(m);
  assert.match(m[0], /if \(action === "reload"\) beginTabReload\(\);/);
  assert.ok(!m[0].includes("location.reload()"));
});

test("logout re-push after adoption only for the same account; otherwise abort (reload pending)", () => {
  const m = indexHtml.match(/const logout = useCallback\(async \(\) => \{[\s\S]*?\n  \}, \[\]\);/);
  assert.ok(m);
  const src = m[0];
  const iGuard = src.indexOf("if (r && r.authExpired && tokenStore.get()) {");
  const iSame = src.indexOf("tokenPayload(tokenStore.get())");
  const iRepush = src.indexOf("r = await window.__pushNow();", iGuard);
  assert.ok(iGuard > 0 && iSame > iGuard && iRepush > iSame, "cek akun sama sebelum push ulang");
  assert.match(src.slice(iGuard, iRepush), /userRef\.current/);
  assert.match(src.slice(iGuard, iRepush), /__tabReloading/);
  assert.match(src.slice(iGuard, iRepush), /return;/);
});
