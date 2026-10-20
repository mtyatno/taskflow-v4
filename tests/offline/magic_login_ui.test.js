"use strict";
// Magic link Telegram (/auth/magic → /?magic=1): SPA tanpa token menukar cookie httpOnly jadi token.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const html = fs.readFileSync(path.join(__dirname, "../../static/index.html"), "utf8");
const py = fs.readFileSync(path.join(__dirname, "../../webapp.py"), "utf8");

function fnSource(name) {
  const i = html.indexOf("function " + name + "(");
  assert.ok(i >= 0, "missing function " + name);
  const j = html.indexOf("\n}\n", i);
  return html.slice(i, j + 2);
}

test("backend: /auth/magic mengarah ke /?magic=1", () => {
  assert.match(py, /RedirectResponse\(url="\/\?magic=1", status_code=302\)/);
});

test("wantsMagicLogin: hanya web same-origin, tanpa token, dengan magic=1", () => {
  const ctx = { URLSearchParams };
  vm.runInNewContext(fnSource("wantsMagicLogin") + "\nthis.f = wantsMagicLogin;", ctx);
  const f = ctx.f;
  assert.equal(f("?magic=1", "", false), true);
  assert.equal(f("?join=abc&magic=1", "", false), true);
  assert.equal(f("?magic=1", "", true), false, "sudah ada token tersimpan");
  assert.equal(f("?magic=1", "https://alurik.com", false), false, "Tauri / API lintas origin");
  assert.equal(f("", "", false), false);
  assert.equal(f("?magic=0", "", false), false);
});

test("stripMagicParam: hapus magic saja, parameter lain dipertahankan", () => {
  const calls = [];
  const ctx = {
    URL,
    window: {
      location: { href: "https://alurik.com/?reset_token=r1&magic=1&join=J#x" },
      history: { state: null, replaceState: (s, t, u) => calls.push(u) },
    },
  };
  vm.runInNewContext(fnSource("stripMagicParam") + "\nstripMagicParam();", ctx);
  assert.deepEqual(calls, ["/?reset_token=r1&join=J#x"]);
  ctx.window.location.href = "https://alurik.com/?join=J";
  vm.runInNewContext("stripMagicParam();", ctx);
  assert.equal(calls.length, 1, "tanpa magic → tidak replaceState");
});

test("exchangeCookieSession: fetch same-origin biasa ke /api/auth/refresh tanpa Authorization", () => {
  const b = fnSource("exchangeCookieSession");
  assert.match(b, /window\.fetch\("\/api\/auth\/refresh", \{ method: "POST", credentials: "same-origin" \}\)/);
  assert.doesNotMatch(b, /Authorization/);
  assert.match(b, /d && d\.token \? d\.token : null/);
  assert.match(b, /\.catch\(\(\) => null\)/);
});

test("App: authChecked mulai false saat magic login (tanpa kilasan form login)", () => {
  assert.match(html, /const \[magicLogin\] = useState\(\(\) => wantsMagicLogin\(window\.location\.search, API_BASE, !!tokenStore\.get\(\)\)\);/);
  assert.match(html, /const \[authChecked, setAuthChecked\] = useState\(!tokenStore\.get\(\) && !magicLogin\);/);
});

test("tryAuth: tukar cookie sekali → tokenStore.set → jalur /api/auth/me; gagal → form login; URL dibersihkan", () => {
  const i = html.indexOf("const tryAuth = async () => {");
  assert.ok(i >= 0);
  const b = html.slice(i, html.indexOf('api.get("/api/auth/me")', i));
  assert.match(b, /if \(!token && magicLogin && !magicTriedRef\.current\) \{\s*magicTriedRef\.current = true;\s*token = await exchangeCookieSession\(\);\s*if \(token\) tokenStore\.set\(token\);\s*if \(!token\) \{\s*setAuthChecked\(true\);\s*return;\s*\}\s*\}/);
  // parameter magic selalu dibuang saat mount (juga bila tidak dipakai: sudah ada token / Tauri)
  assert.match(html, /useEffect\(\(\) => \{\s*stripMagicParam\(\);\s*\}, \[\]\);/);
});
