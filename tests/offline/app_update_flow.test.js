"use strict";

// Alur banner pembaruan (spec docs/superpowers/specs/2026-10-23-apa-yang-baru-design.md §3.1) dengan
// registration/worker palsu yang meniru transisi state SW di browser.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const au = require("../../static/offline/appupdate.js");
const T = au.TEXT;

const PAGE = "taskflow-v900-x";
const NEWER = "taskflow-v901-x";

function spy(impl) {
  const f = (...args) => {
    f.calls.push(args);
    return impl ? impl(...args) : undefined;
  };
  f.calls = [];
  return f;
}

function fakeWorker(state = "installing") {
  const listeners = [];
  const w = {
    state,
    reg: null,
    postMessage: spy(),
    addEventListener(type, fn) {
      if (type === "statechange") listeners.push(fn);
    },
    listenerCount: () => listeners.length,
    // Seperti browser: slot registration diperbarui dulu, baru event statechange dikirim.
    set(next) {
      const reg = w.reg;
      if (reg) {
        if (next === "installed" && reg.installing === w) {
          reg.waiting = w;
          reg.installing = null;
        }
        if (next === "activating" && reg.waiting === w) {
          reg.active = w;
          reg.waiting = null;
        }
        if (next === "redundant") {
          for (const k of ["installing", "waiting", "active"]) if (reg[k] === w) reg[k] = null;
        }
      }
      w.state = next;
      for (const fn of listeners.slice()) fn({ type: "statechange", target: w });
    },
  };
  return w;
}

// update: undefined → tidak ada versi baru; Error → menolak; worker → install worker itu lalu resolve.
function fakeReg({ waiting = null, installing = null, update } = {}) {
  const listeners = [];
  const reg = {
    waiting,
    installing,
    active: null,
    addEventListener(type, fn) {
      if (type === "updatefound") listeners.push(fn);
    },
    // Install worker baru seperti browser: `installing` diisi, lalu updatefound.
    fire(worker) {
      worker.reg = reg;
      reg.installing = worker;
      for (const fn of listeners.slice()) fn({ type: "updatefound" });
    },
    update: spy(() => {
      if (update instanceof Error) return Promise.reject(update);
      if (update) reg.fire(update);
      return Promise.resolve(reg);
    }),
  };
  for (const w of [waiting, installing]) if (w) w.reg = reg;
  return reg;
}

// version: string → 200 {sw_version}; number → status gagal (mis. 500 dari Task 1); Error → jaringan gagal.
function fakeFetch(result) {
  return spy(() => {
    if (result instanceof Error) return Promise.reject(result);
    if (typeof result === "number") {
      return Promise.resolve({ ok: false, status: result, json: async () => ({ detail: "SW version unavailable" }) });
    }
    return Promise.resolve({ ok: true, status: 200, json: async () => ({ sw_version: result }) });
  });
}

function fakeTimers() {
  const pending = [];
  const setTimeout = spy((fn) => {
    pending.push(fn);
    return pending.length;
  });
  setTimeout.flush = () => {
    for (const fn of pending.splice(0)) fn();
  };
  return setTimeout;
}

function setup({ reg = null, controlled = true, sw, version = PAGE } = {}) {
  const deps = {
    sw: sw !== undefined ? sw : { controller: controlled ? fakeWorker("activated") : null },
    getRegistration: () => reg,
    fetch: fakeFetch(version),
    reload: spy(),
    setTimeout: fakeTimers(),
    toast: spy(),
    pageVersion: PAGE,
    onReady: spy(),
  };
  return { ...deps, reg, u: au.createAppUpdater(deps) };
}

const toasts = (t) => t.toast.calls.map(([m, type]) => [m, type]);

test("TEXT dan APPLY_FALLBACK_MS sesuai spec", () => {
  assert.equal(au.APPLY_FALLBACK_MS, 5000);
  assert.deepEqual({ ...au.TEXT }, {
    checking: "Mengecek pembaruan...",
    ready: "Pembaruan tersedia! Silakan muat ulang.",
    downloading: "Mengunduh pembaruan…",
    failed: "Pembaruan gagal diunduh, coba lagi saat koneksi stabil.",
    latest: "Aplikasi sudah dalam versi terbaru",
    checkFailed: "Gagal memeriksa pembaruan",
  });
});

test("1. track: SW menunggu + terkendali → onReady sekali", () => {
  const reg = fakeReg({ waiting: fakeWorker("installed") });
  const t = setup({ reg });
  t.u.track(reg);
  assert.equal(t.onReady.calls.length, 1);
  assert.equal(t.toast.calls.length, 0);

  // Tidak terkendali (hard reload): SW menunggu saja tidak memunculkan banner.
  const reg2 = fakeReg({ waiting: fakeWorker("installed") });
  const t2 = setup({ reg: reg2, controlled: false });
  t2.u.track(reg2);
  assert.equal(t2.onReady.calls.length, 0);
});

test('2. track: installing sudah ada → onReady setelah state "installed" (celah C)', () => {
  const w = fakeWorker("installing");
  const reg = fakeReg({ installing: w });
  const t = setup({ reg });
  t.u.track(reg);
  assert.equal(t.onReady.calls.length, 0);
  w.set("installed");
  assert.equal(reg.waiting, w);
  assert.equal(t.onReady.calls.length, 1);
  assert.equal(t.toast.calls.length, 0);
});

test('3. track: updatefound → worker baru → "installed" → onReady', () => {
  const reg = fakeReg();
  const t = setup({ reg });
  t.u.track(reg);
  const w = fakeWorker("installing");
  reg.fire(w);
  assert.equal(t.onReady.calls.length, 0);
  w.set("installed");
  assert.equal(t.onReady.calls.length, 1);

  // Install pertama (halaman belum terkendali): "installed" tidak memunculkan banner.
  const reg2 = fakeReg();
  const t2 = setup({ reg: reg2, controlled: false });
  t2.u.track(reg2);
  const w2 = fakeWorker("installing");
  reg2.fire(w2);
  w2.set("installed");
  assert.equal(t2.onReady.calls.length, 0);
});

test("4. auto check terkendali + /api/version beda → reg.update dipanggil, onReady TIDAK dipanggil, toast tidak dipanggil (bug A)", async () => {
  const reg = fakeReg();
  const t = setup({ reg, version: NEWER });
  t.u.track(reg);
  await t.u.check();
  assert.equal(reg.update.calls.length, 1);
  assert.equal(t.onReady.calls.length, 0);
  assert.equal(t.toast.calls.length, 0);
  assert.equal(t.fetch.calls.length, 1);
  const [url, opts] = t.fetch.calls[0];
  assert.match(url, /^\/api\/version\?t=\d+$/);
  assert.deepEqual(opts, { cache: "no-store", headers: { "Cache-Control": "no-cache" } });
});

test("auto check terkendali + versi beda, update menemukan SW baru → onReady baru setelah installed", async () => {
  const w = fakeWorker("installing");
  const reg = fakeReg({ update: w });
  const t = setup({ reg, version: NEWER });
  t.u.track(reg);
  await t.u.check();
  assert.equal(t.onReady.calls.length, 0);
  w.set("installed");
  assert.equal(t.onReady.calls.length, 1);
  assert.equal(w.listenerCount(), 1, "statechange dipasang sekali per worker");
  assert.equal(t.toast.calls.length, 0);
});

test("auto check terkendali: SW menunggu → onReady tanpa fetch; SW ter-install → tanpa fetch, onReady saat installed", async () => {
  const reg = fakeReg({ waiting: fakeWorker("installed") });
  const t = setup({ reg, version: NEWER });
  await t.u.check();
  assert.equal(t.onReady.calls.length, 1, "banner yang ditutup muncul lagi");
  assert.equal(t.fetch.calls.length, 0);
  assert.equal(reg.update.calls.length, 0);

  const w = fakeWorker("installing");
  const reg2 = fakeReg({ installing: w });
  const t2 = setup({ reg: reg2, version: NEWER });
  t2.u.track(reg2);
  await t2.u.check();
  assert.equal(t2.fetch.calls.length, 0);
  assert.equal(reg2.update.calls.length, 0);
  assert.equal(t2.onReady.calls.length, 0);
  w.set("installed");
  assert.equal(t2.onReady.calls.length, 1);
  assert.equal(w.listenerCount(), 1, "track + check pada worker yang sama → satu pendengar");
  assert.equal(t2.toast.calls.length, 0);
});

test("5. auto check terkendali + versi sama → reg.update tidak dipanggil", async () => {
  const reg = fakeReg();
  const t = setup({ reg, version: PAGE });
  t.u.track(reg);
  await t.u.check();
  assert.equal(t.fetch.calls.length, 1);
  assert.equal(reg.update.calls.length, 0);
  assert.equal(t.onReady.calls.length, 0);
});

test("6. auto check: reg.update menolak (offline) → tidak ada exception, tidak ada toast", async () => {
  const reg = fakeReg({ update: new Error("offline") });
  const t = setup({ reg, version: NEWER });
  t.u.track(reg);
  await assert.doesNotReject(t.u.check());
  assert.equal(reg.update.calls.length, 1);
  assert.equal(t.toast.calls.length, 0);
  assert.equal(t.onReady.calls.length, 0);
});

test("7. auto check: fetch versi gagal → diam", async () => {
  // Jaringan gagal (offline) atau 500 "SW version unavailable" = tidak ada info versi.
  for (const failure of [new Error("offline"), 500]) {
    for (const controlled of [true, false]) {
      const reg = fakeReg();
      const t = setup({ reg, controlled, version: failure });
      t.u.track(reg);
      await assert.doesNotReject(t.u.check());
      assert.equal(t.fetch.calls.length, 1);
      assert.equal(reg.update.calls.length, 0);
      assert.equal(t.onReady.calls.length, 0);
      assert.equal(t.toast.calls.length, 0);
    }
  }
});

test("8. tidak terkendali + versi beda → onReady; sw ada tapi getRegistration() null + versi beda → onReady (Review Focus 4)", async () => {
  // Hard reload: ada registration, halaman tidak dikendalikan SW.
  const reg = fakeReg();
  const t = setup({ reg, controlled: false, version: NEWER });
  t.u.track(reg);
  await t.u.check();
  assert.equal(t.onReady.calls.length, 1);
  assert.equal(reg.update.calls.length, 0);
  assert.equal(t.toast.calls.length, 0);

  // Pendaftaran SW gagal: navigator.serviceWorker ada, registration null.
  const t2 = setup({ reg: null, sw: { controller: null }, version: NEWER });
  await assert.doesNotReject(t2.u.check());
  assert.equal(t2.onReady.calls.length, 1);
  assert.equal(t2.toast.calls.length, 0);

  // Browser tanpa SW; versi sama → diam.
  const t3 = setup({ reg: null, sw: null, version: NEWER });
  await t3.u.check();
  assert.equal(t3.onReady.calls.length, 1);
  const t4 = setup({ reg: null, sw: null, version: PAGE });
  await t4.u.check();
  assert.equal(t4.onReady.calls.length, 0);
});

// Halaman terkendali tetapi registration belum diketahui (visibilitychange sebelum register() selesai):
// selisih versi tetap tidak boleh memunculkan banner langsung (spec §3.1).
test("8b. auto check terkendali + getRegistration() null + versi beda → onReady tidak dipanggil, tanpa toast", async () => {
  const t = setup({ reg: null, version: NEWER });
  await assert.doesNotReject(t.u.check());
  assert.equal(t.onReady.calls.length, 0);
  assert.equal(t.toast.calls.length, 0);
  assert.equal(t.fetch.calls.length, 0);
});

test('8c. manual terkendali + getRegistration() null, tanpa sw.getRegistration → toast checkFailed "error"', async () => {
  const t = setup({ reg: null, version: NEWER });
  assert.equal(typeof t.sw.getRegistration, "undefined");
  await assert.doesNotReject(t.u.check({ manual: true }));
  assert.deepEqual(toasts(t), [[T.checking, "info"], [T.checkFailed, "error"]]);
  assert.equal(t.onReady.calls.length, 0);
});

test('8d. manual terkendali + getRegistration() null, sw.getRegistration() → reg menunggu → onReady + toast ready "info"', async () => {
  const reg = fakeReg({ waiting: fakeWorker("installed") });
  const sw = { controller: fakeWorker("activated"), getRegistration: spy(() => Promise.resolve(reg)) };
  const t = setup({ reg: null, sw, version: NEWER });
  await t.u.check({ manual: true });
  assert.equal(sw.getRegistration.calls.length, 1);
  assert.equal(reg.update.calls.length, 1);
  assert.deepEqual(toasts(t), [[T.checking, "info"], [T.ready, "info"]]);
  assert.equal(t.onReady.calls.length, 1);

  // sw.getRegistration() menolak atau tidak menemukan registration → checkFailed.
  for (const getRegistration of [() => Promise.reject(new Error("x")), () => Promise.resolve(undefined)]) {
    const t2 = setup({ reg: null, sw: { controller: fakeWorker("activated"), getRegistration }, version: NEWER });
    await assert.doesNotReject(t2.u.check({ manual: true }));
    assert.deepEqual(toasts(t2), [[T.checking, "info"], [T.checkFailed, "error"]]);
    assert.equal(t2.onReady.calls.length, 0);
  }
});

test('9. apply dengan reg.waiting → postMessage({type:"SKIP_WAITING"}) ke worker menunggu, bukan ke sw.controller; reload setelah 5000 ms (bug B)', () => {
  const waiting = fakeWorker("installed");
  const reg = fakeReg({ waiting });
  const t = setup({ reg });
  t.u.apply();
  assert.deepEqual(waiting.postMessage.calls, [[{ type: "SKIP_WAITING" }]]);
  assert.equal(t.sw.controller.postMessage.calls.length, 0);
  assert.equal(t.reload.calls.length, 0, "reload menunggu controllerchange");
  assert.equal(t.setTimeout.calls.length, 1);
  assert.equal(t.setTimeout.calls[0][1], 5000);
  t.setTimeout.flush();
  assert.equal(t.reload.calls.length, 1);
});

test("apply: controllerchange terjadi sebelum 5 detik → pengaman tidak memuat ulang lagi", () => {
  const waiting = fakeWorker("installed");
  const reg = fakeReg({ waiting });
  const t = setup({ reg });
  t.u.apply();
  // SW baru mengambil alih: skrip inline (penjaga refreshing) yang memuat ulang.
  waiting.set("activating");
  t.sw.controller = waiting;
  t.setTimeout.flush();
  assert.equal(t.reload.calls.length, 0);
});

test("10. apply tanpa SW menunggu → reload langsung", () => {
  // Bug B: SW baru masih installing → jangan kirim SKIP_WAITING ke SW aktif / installing.
  const installing = fakeWorker("installing");
  const reg = fakeReg({ installing });
  const t = setup({ reg });
  t.u.apply();
  assert.equal(t.reload.calls.length, 1);
  assert.equal(installing.postMessage.calls.length, 0);
  assert.equal(t.sw.controller.postMessage.calls.length, 0);
  assert.equal(t.setTimeout.calls.length, 0);

  const t2 = setup({ reg: null, sw: null });
  t2.u.apply();
  assert.equal(t2.reload.calls.length, 1);
});

test('11a. manual: waiting → toast ready "info"', async () => {
  // SW menunggu sudah ada (banner sempat ditutup); update() tidak menemukan versi lebih baru lagi.
  const reg = fakeReg({ waiting: fakeWorker("installed") });
  const t = setup({ reg });
  await t.u.check({ manual: true });
  assert.equal(reg.update.calls.length, 1);
  assert.deepEqual(toasts(t), [[T.checking, "info"], [T.ready, "info"]]);
  assert.equal(t.onReady.calls.length, 1);
});

test('11b. manual: installing → toast downloading lalu failed saat "redundant"', async () => {
  const w = fakeWorker("installing");
  const reg = fakeReg({ update: w });
  const t = setup({ reg });
  t.u.track(reg);
  await t.u.check({ manual: true });
  assert.deepEqual(toasts(t), [[T.checking, "info"], [T.downloading, "info"]]);
  w.set("redundant");
  assert.deepEqual(toasts(t), [[T.checking, "info"], [T.downloading, "info"], [T.failed, "error"]]);
  assert.equal(t.onReady.calls.length, 0);
});

test('11c. manual: installing → toast ready saat "installed"', async () => {
  const w = fakeWorker("installing");
  const reg = fakeReg({ update: w });
  const t = setup({ reg });
  t.u.track(reg);
  await t.u.check({ manual: true });
  w.set("installed");
  assert.deepEqual(toasts(t), [[T.checking, "info"], [T.downloading, "info"], [T.ready, "info"]]);
  assert.equal(t.onReady.calls.length, 1);
  // Transisi berikutnya tidak memunculkan toast lagi.
  w.set("activating");
  assert.equal(t.toast.calls.length, 3);
});

test('11d. manual: tidak ada update → toast latest "success"', async () => {
  const reg = fakeReg();
  const t = setup({ reg, version: NEWER });
  await t.u.check({ manual: true });
  assert.equal(reg.update.calls.length, 1);
  assert.deepEqual(toasts(t), [[T.checking, "info"], [T.latest, "success"]]);
  assert.equal(t.fetch.calls.length, 0, "halaman terkendali: hasil dari reg.update(), bukan /api/version");
  assert.equal(t.onReady.calls.length, 0);
});

test('11e. manual: reg.update menolak → toast checkFailed "error"', async () => {
  const reg = fakeReg({ update: new Error("offline") });
  const t = setup({ reg });
  await assert.doesNotReject(t.u.check({ manual: true }));
  assert.deepEqual(toasts(t), [[T.checking, "info"], [T.checkFailed, "error"]]);
  assert.equal(t.onReady.calls.length, 0);
});

test("manual tidak terkendali: versi beda → siap + toast ready; versi sama → toast latest", async () => {
  const t = setup({ reg: null, sw: { controller: null }, version: NEWER });
  await t.u.check({ manual: true });
  assert.deepEqual(toasts(t), [[T.checking, "info"], [T.ready, "info"]]);
  assert.equal(t.onReady.calls.length, 1);

  const t2 = setup({ reg: null, sw: null, version: PAGE });
  await t2.u.check({ manual: true });
  assert.deepEqual(toasts(t2), [[T.checking, "info"], [T.latest, "success"]]);
  assert.equal(t2.onReady.calls.length, 0);
});

test("toast null tidak membuat check melempar", async () => {
  const reg = fakeReg();
  const deps = {
    sw: { controller: fakeWorker("activated") },
    getRegistration: () => reg,
    fetch: fakeFetch(PAGE),
    reload: spy(),
    setTimeout: fakeTimers(),
    toast: null,
    pageVersion: PAGE,
    onReady: spy(),
  };
  await assert.doesNotReject(au.createAppUpdater(deps).check({ manual: true }));
});

// ---- Skrip inline terakhir index.html (pemasangan) ----

function inlineUpdateScript() {
  const html = fs.readFileSync(path.resolve(__dirname, "../../static/index.html"), "utf8");
  const blocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)]
    .map((m) => m[1])
    .filter((code) => code.includes("window.applyAppUpdate"));
  assert.ok(blocks.length > 0, "skrip inline dengan window.applyAppUpdate harus ada");
  return blocks[blocks.length - 1];
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

function runInline({ TF } = {}) {
  const on = (map) => (type, fn) => {
    (map[type] = map[type] || []).push(fn);
  };
  const emit = (map, type) => {
    for (const fn of map[type] || []) fn({ type });
  };
  const winL = {};
  const swL = {};
  const docL = {};
  const reg = fakeReg();
  const sw = {
    controller: fakeWorker("activated"),
    register: spy(() => Promise.resolve(reg)),
    addEventListener: on(swL),
  };
  const ctx = {
    navigator: { serviceWorker: sw },
    document: { visibilityState: "visible", addEventListener: on(docL) },
    setInterval: spy(() => 1),
    CustomEvent: class CustomEvent {
      constructor(type) {
        this.type = type;
      }
    },
    console: { warn: spy(), error: spy(), log: spy() },
    location: { reload: spy() },
    fetch: spy(() => Promise.resolve({ ok: false, status: 500 })),
    setTimeout: spy(() => 1),
    __SW_VERSION: PAGE,
  };
  ctx.window = ctx;
  ctx.addEventListener = on(winL);
  ctx.dispatchEvent = spy();
  if (TF) ctx.TF = TF;
  vm.createContext(ctx);
  vm.runInContext(inlineUpdateScript(), ctx);
  return {
    ctx,
    sw,
    reg,
    fireWindow: (type) => emit(winL, type),
    fireSw: (type) => emit(swL, type),
    fireDocument: (type) => emit(docL, type),
  };
}

test('12. skrip inline index.html: tanpa TF.appupdate tetap register("/sw.js") pada load dan reload sekali pada controllerchange', async () => {
  const r = runInline();
  assert.equal(r.ctx.TF, undefined);
  assert.equal(r.sw.register.calls.length, 0, "register menunggu load");
  r.fireWindow("load");
  await flush();
  assert.equal(r.sw.register.calls.length, 1);
  assert.equal(r.sw.register.calls[0][0], "/sw.js");
  assert.equal(r.sw.register.calls[0][1].scope, "/"); // objek dari realm vm: bandingkan field
  assert.equal(r.ctx.__SW_REGISTRATION, r.reg);
  assert.equal(r.reg.update.calls.length, 1);

  r.fireSw("controllerchange");
  r.fireSw("controllerchange");
  assert.equal(r.ctx.location.reload.calls.length, 1);

  // Pembungkus tetap ada tanpa modul: cek → Promise selesai, terapkan → reload biasa.
  r.fireDocument("visibilitychange");
  const interval = r.ctx.setInterval.calls[0];
  assert.equal(interval[1], 1800000);
  interval[0]();
  await assert.doesNotReject(r.ctx.checkForAppUpdate({ manual: true }));
  r.ctx.applyAppUpdate();
  assert.equal(r.ctx.location.reload.calls.length, 2);
  assert.equal(r.ctx.fetch.calls.length, 0);
});

test("skrip inline index.html: dengan TF.appupdate meneruskan track/check/apply ke updater", async () => {
  const checked = Promise.resolve();
  const updater = { track: spy(), check: spy(() => checked), apply: spy() };
  const createAppUpdater = spy(() => updater);
  const r = runInline({ TF: { appupdate: { createAppUpdater } } });
  assert.equal(createAppUpdater.calls.length, 1);
  const deps = createAppUpdater.calls[0][0];
  assert.equal(deps.sw, r.sw);
  assert.equal(deps.pageVersion, PAGE);
  assert.equal(deps.getRegistration(), null);

  r.fireWindow("load");
  await flush();
  assert.equal(deps.getRegistration(), r.reg);
  assert.deepEqual(updater.track.calls, [[r.reg]]);
  assert.equal(r.reg.update.calls.length, 1);

  // onReady = notifyAppUpdateAvailable (dipakai App).
  assert.equal(r.ctx.__APP_UPDATE_AVAILABLE, false);
  deps.onReady();
  assert.equal(r.ctx.__APP_UPDATE_AVAILABLE, true);
  assert.equal(r.ctx.dispatchEvent.calls[0][0].type, "appupdateavailable");

  // toast → window.showToast, lalu window.__showToast, tanpa keduanya diam.
  assert.doesNotThrow(() => deps.toast("m", "info"));
  r.ctx.__showToast = spy();
  deps.toast("a", "info");
  assert.deepEqual(r.ctx.__showToast.calls, [["a", "info"]]);
  r.ctx.showToast = spy();
  deps.toast("b", "error");
  assert.deepEqual(r.ctx.showToast.calls, [["b", "error"]]);

  deps.reload();
  assert.equal(r.ctx.location.reload.calls.length, 1);
  deps.fetch("/x");
  assert.deepEqual(r.ctx.fetch.calls[0], ["/x"]);
  deps.setTimeout(() => {}, 5);
  assert.equal(r.ctx.setTimeout.calls.length, 1);

  assert.equal(r.ctx.checkForAppUpdate({ manual: true }), checked, "mengembalikan Promise dari updater.check");
  assert.deepEqual(updater.check.calls[0], [{ manual: true }]);
  r.ctx.applyAppUpdate();
  assert.equal(updater.apply.calls.length, 1);
  assert.equal(r.ctx.location.reload.calls.length, 1, "apply lewat updater, bukan reload langsung");

  r.ctx.document.visibilityState = "hidden";
  r.fireDocument("visibilitychange");
  assert.equal(updater.check.calls.length, 1);
  r.ctx.document.visibilityState = "visible";
  r.fireDocument("visibilitychange");
  assert.equal(updater.check.calls.length, 2);
  r.ctx.setInterval.calls[0][0]();
  assert.equal(updater.check.calls.length, 3);

  r.fireSw("controllerchange");
  r.fireSw("controllerchange");
  assert.equal(r.ctx.location.reload.calls.length, 2);
});
