"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const amb = require("../../static/offline/ambient.js");
const indexHtml = fs.readFileSync(path.resolve(__dirname, "../../static/index.html"), "utf8").replace(/\r\n/g, "\n");
const swJs = fs.readFileSync(path.resolve(__dirname, "../../static/sw.js"), "utf8").replace(/\r\n/g, "\n");

const WORK_RUN = { mode: "work", phase: "countdown", isRunning: true, timeLeft: 1200 };
const WORK_PAUSED = { mode: "work", phase: "countdown", isRunning: false, timeLeft: 900 };
const WORK_IDLE = { mode: "work", phase: "countdown", isRunning: false, timeLeft: 1500 };

// ---------- fakes ----------
const settle = () => new Promise((r) => setImmediate(r));

function makeClock() {
  let t = 0;
  let seq = 0;
  const timers = new Map();
  return {
    now: () => t,
    setTimeout: (fn, ms) => { const id = ++seq; timers.set(id, { at: t + Math.max(0, ms || 0), fn }); return id; },
    clearTimeout: (id) => { timers.delete(id); },
    pending: () => timers.size,
    async advance(ms) {
      const end = t + ms;
      await settle();
      for (;;) {
        let next = null;
        for (const [id, x] of timers) if (x.at <= end && (!next || x.at < next[1].at)) next = [id, x];
        if (!next) break;
        timers.delete(next[0]);
        t = next[1].at;
        next[1].fn();
        await settle();
      }
      t = end;
      await settle();
    }
  };
}

function makeAudio(o, clock) {
  const a = {
    paused: true, currentTime: 0, volume: 1, loop: false, src: "", playCalls: 0, pauseCalls: 0,
    canPlayType: () => (o.ogg === false ? "" : "probably"),
    play() {
      a.playCalls++;
      if (o.deferPlay) {
        // play() tertunda: paused langsung false, Promise selesai setelah jam dimajukan.
        a.paused = false;
        return new Promise((resolve, reject) => {
          clock.setTimeout(() => {
            if (o.rejectPlay) {
              a.paused = true;
              const name = o.rejectPlay;
              reject(Object.assign(new Error(name), { name }));
            } else resolve();
          }, o.deferPlay);
        });
      }
      if (o.rejectPlay) {
        const name = o.rejectPlay;
        return Promise.reject(Object.assign(new Error(name), { name }));
      }
      a.paused = false;
      return Promise.resolve();
    },
    pause() { a.pauseCalls++; a.paused = true; }
  };
  return a;
}

function makeDoc() {
  const listeners = [];
  return {
    listeners,
    addEventListener(type, fn, opts) { listeners.push({ type, fn, opts }); },
    removeEventListener(type, fn) {
      const i = listeners.findIndex((l) => l.type === type && l.fn === fn);
      if (i >= 0) listeners.splice(i, 1);
    },
    dispatch(type) {
      for (const l of listeners.slice()) {
        if (l.type !== type) continue;
        if (l.opts && l.opts.once) listeners.splice(listeners.indexOf(l), 1);
        l.fn({ type });
      }
    }
  };
}

function makeCtx() {
  const ctx = {
    state: "running", resumeCalls: 0, destination: {}, gainNode: null, sources: 0,
    createMediaElementSource() { ctx.sources++; return { connect() {} }; },
    createGain() { ctx.gainNode = { gain: { value: 1 }, connect() {} }; return ctx.gainNode; },
    resume() { ctx.resumeCalls++; ctx.state = "running"; return Promise.resolve(); },
    close() { return Promise.resolve(); }
  };
  return ctx;
}

function setup(o = {}) {
  const clock = makeClock();
  const audios = [];
  const fetches = [];
  const revoked = [];
  const created = [];
  const states = [];
  const doc = makeDoc();
  let ctx = null;
  const env = {
    createAudio: () => { const a = makeAudio(o, clock); audios.push(a); return a; },
    createAudioContext: o.noWebAudio ? null : () => { ctx = makeCtx(); if (o.ctxState) ctx.state = o.ctxState; return ctx; },
    fetch: (url) => {
      fetches.push(url);
      if (o.fetchFail === "reject") return Promise.reject(new TypeError("Failed to fetch"));
      const ok = o.fetchFail !== "404";
      return Promise.resolve({ ok, status: ok ? 200 : 404, blob: async () => ({ url }) });
    },
    createObjectURL: () => { const u = "blob:" + (created.length + 1); created.push(u); return u; },
    revokeObjectURL: (u) => { revoked.push(u); },
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    now: clock.now,
    document: doc,
    onState: (s) => { states.push(s); }
  };
  const p = amb.createPlayer(env);
  return {
    p, o, clock, audios, fetches, revoked, created, states, doc,
    get ctx() { return ctx; },
    get audio() { return audios[0]; },
    get gain() { return ctx ? ctx.gainNode.gain.value : audios[0].volume; }
  };
}

async function playing(o) {
  const s = setup(o);
  s.p.setSound("hujan");
  await s.clock.advance(0);
  s.p.update(WORK_RUN);
  await s.clock.advance(1000);
  return s;
}

const close = (a, b) => Math.abs(a - b) < 1e-9;

// ---------- konstanta & fungsi murni ----------
test("konstanta", () => {
  assert.deepEqual(amb.SOUNDS, [
    { key: "off", label: "Off" },
    { key: "hujan", label: "Hujan" },
    { key: "brown-noise", label: "Brown Noise" },
    { key: "detak-jam", label: "Detak Jam" }
  ]);
  assert.equal(amb.FADE_MS, 1000);
  assert.equal(amb.SOUND_KEY, "tf_ambient_sound");
  assert.equal(amb.VOLUME_KEY, "tf_ambient_volume");
});

test("ambientTarget: semua baris Global Constraints", () => {
  const t = amb.ambientTarget;
  assert.equal(t(WORK_RUN), "play");
  assert.equal(t({ mode: "work", phase: "overtime", isRunning: true, timeLeft: 0 }), "play");
  assert.equal(t({ mode: "work", phase: "overtime", isRunning: false, timeLeft: 0 }), "pause");
  assert.equal(t(WORK_IDLE), "stop");
  assert.equal(t(WORK_PAUSED), "pause");
  assert.equal(t({ mode: "work", phase: "awaiting", isRunning: false, timeLeft: 0 }), "pause");
  assert.equal(t({ mode: "work", phase: "awaiting", isRunning: false, timeLeft: 1500 }), "pause");
  assert.equal(t({ mode: "shortBreak", phase: "countdown", isRunning: true, timeLeft: 300 }), "pause");
  assert.equal(t({ mode: "longBreak", phase: "countdown", isRunning: true, timeLeft: 900 }), "pause");
  assert.equal(t({ mode: "shortBreak", phase: "countdown", isRunning: false, timeLeft: 300 }), "pause");
  assert.equal(t({ mode: "longBreak", phase: "countdown", isRunning: false, timeLeft: 1500 }), "pause");
});

test("readPrefs: default, jepit volume, storage melempar", () => {
  const store = (m) => ({ getItem: (k) => (k in m ? m[k] : null) });
  assert.deepEqual(amb.readPrefs(store({})), { sound: "off", volume: 50 });
  assert.deepEqual(amb.readPrefs(store({ tf_ambient_sound: "hujan", tf_ambient_volume: "70" })), { sound: "hujan", volume: 70 });
  assert.deepEqual(amb.readPrefs(store({ tf_ambient_sound: "ombak", tf_ambient_volume: "150" })), { sound: "off", volume: 100 });
  assert.deepEqual(amb.readPrefs(store({ tf_ambient_sound: "detak-jam", tf_ambient_volume: "-3" })), { sound: "detak-jam", volume: 0 });
  assert.deepEqual(amb.readPrefs(store({ tf_ambient_volume: "abc" })), { sound: "off", volume: 50 });
  assert.deepEqual(amb.readPrefs(store({ tf_ambient_volume: "" })), { sound: "off", volume: 50 });
  assert.deepEqual(amb.readPrefs({ getItem() { throw new Error("SecurityError"); } }), { sound: "off", volume: 50 });
  assert.deepEqual(amb.readPrefs(null), { sound: "off", volume: 50 });
});

test("writePrefs: menulis dan tidak pernah melempar", () => {
  const m = {};
  amb.writePrefs({ setItem: (k, v) => { m[k] = v; } }, { sound: "brown-noise", volume: 33 });
  assert.deepEqual(m, { tf_ambient_sound: "brown-noise", tf_ambient_volume: "33" });
  assert.doesNotThrow(() => amb.writePrefs({ setItem() { throw new Error("QuotaExceeded"); } }, { sound: "hujan", volume: 10 }));
  assert.doesNotThrow(() => amb.writePrefs(null, { sound: "hujan", volume: 10 }));
});

test("soundUrl: ogg / mp3", () => {
  assert.equal(amb.soundUrl("hujan", true), "/static/sounds/hujan-v1.ogg");
  assert.equal(amb.soundUrl("brown-noise", false), "/static/sounds/brown-noise-v1.mp3");
  assert.equal(amb.soundUrl("detak-jam", true), "/static/sounds/detak-jam-v1.ogg");
});

// ---------- lazy load ----------
test("lazy load: tanpa setSound tidak ada fetch; setSound tepat 1 fetch; key sama tidak fetch lagi", async () => {
  const s = setup();
  s.p.update(WORK_RUN);
  await s.clock.advance(2000);
  assert.equal(s.fetches.length, 0);
  assert.equal(s.audios.length, 0);
  s.p.setSound("hujan");
  assert.equal(s.p.state().state, "loading");
  await s.clock.advance(0);
  assert.deepEqual(s.fetches, ["/static/sounds/hujan-v1.ogg"]);
  s.p.setSound("hujan");
  await s.clock.advance(0);
  assert.equal(s.fetches.length, 1);
});

test("lazy load: memilih mp3 bila ogg tidak didukung", async () => {
  const s = setup({ ogg: false });
  s.p.setSound("detak-jam");
  await s.clock.advance(0);
  assert.deepEqual(s.fetches, ["/static/sounds/detak-jam-v1.mp3"]);
});

test("restore preload:false: 0 fetch sampai Work berjalan, lalu tepat 1 fetch", async () => {
  const s = setup();
  s.p.setSound("hujan", { preload: false });
  s.p.update(WORK_IDLE);
  s.p.update(WORK_PAUSED);
  await s.clock.advance(3000);
  assert.equal(s.fetches.length, 0);
  assert.equal(s.p.state().sound, "hujan");
  assert.equal(s.p.state().state, "idle");
  s.p.update(WORK_RUN);
  await s.clock.advance(1000);
  assert.deepEqual(s.fetches, ["/static/sounds/hujan-v1.ogg"]);
  assert.equal(s.audio.paused, false);
  assert.equal(s.p.state().state, "playing");
  s.p.update(WORK_PAUSED);
  await s.clock.advance(1000);
  s.p.update(WORK_RUN);
  await s.clock.advance(1000);
  assert.equal(s.fetches.length, 1);
});

test("restore preload:false saat Work sudah berjalan → langsung diambil", async () => {
  const s = setup();
  s.p.update(WORK_RUN);
  s.p.setSound("brown-noise", { preload: false });
  await s.clock.advance(1000);
  assert.deepEqual(s.fetches, ["/static/sounds/brown-noise-v1.ogg"]);
  assert.equal(s.p.state().state, "playing");
});

test("preload:false lalu setSound default (dropdown) → fetch", async () => {
  const s = setup();
  s.p.setSound("hujan", { preload: false });
  await s.clock.advance(0);
  assert.equal(s.fetches.length, 0);
  s.p.setSound("hujan");
  await s.clock.advance(0);
  assert.equal(s.fetches.length, 1);
});

// ---------- play / pause / stop ----------
test("play → pause: fade-in ke volume, fade-out ke 0 lalu pause tanpa reset posisi", async () => {
  const s = await playing();
  assert.equal(s.audio.paused, false);
  assert.ok(close(s.gain, 0.5));
  assert.equal(s.audio.loop, true);
  assert.equal(s.p.state().state, "playing");
  assert.equal(s.p.state().target, "play");
  s.audio.currentTime = 42;
  s.p.update(WORK_PAUSED);
  await s.clock.advance(500);
  assert.equal(s.audio.paused, false);
  assert.ok(s.gain > 0 && s.gain < 0.5);
  await s.clock.advance(500);
  assert.equal(s.gain, 0);
  assert.equal(s.audio.paused, true);
  assert.equal(s.audio.currentTime, 42);
  assert.equal(s.p.state().state, "idle");
  assert.equal(s.p.state().paused, true);
});

test("fade-in bertahap: setengah jalan sekitar setengah volume", async () => {
  const s = setup();
  s.p.setSound("hujan");
  await s.clock.advance(0);
  s.p.update(WORK_RUN);
  await s.clock.advance(500);
  assert.ok(s.gain > 0.2 && s.gain < 0.3, String(s.gain));
});

test("stop: setelah fade currentTime === 0", async () => {
  const s = await playing();
  s.audio.currentTime = 42;
  s.p.update(WORK_IDLE);
  await s.clock.advance(1000);
  assert.equal(s.audio.paused, true);
  assert.equal(s.audio.currentTime, 0);
  assert.equal(s.p.state().target, "stop");
});

test("pause lalu stop saat sudah diam → currentTime direset", async () => {
  const s = await playing();
  s.p.update(WORK_PAUSED);
  await s.clock.advance(1000);
  s.audio.currentTime = 42;
  s.p.update(WORK_IDLE);
  await s.clock.advance(0);
  assert.equal(s.audio.currentTime, 0);
});

test("Ambil Istirahat (Review Focus 4): istirahat berjalan → berhenti", async () => {
  const s = await playing();
  s.p.update({ mode: "shortBreak", phase: "countdown", isRunning: true, timeLeft: 300 });
  await s.clock.advance(1000);
  assert.equal(s.audio.paused, true);
  assert.equal(s.gain, 0);
  assert.equal(s.p.state().target, "pause");
});

test("Overtime berjalan → tetap berbunyi, update dengan target sama tidak memicu transisi", async () => {
  const s = await playing();
  const plays = s.audio.playCalls;
  s.p.update({ mode: "work", phase: "overtime", isRunning: true, timeLeft: 0 });
  s.p.update({ mode: "work", phase: "countdown", isRunning: true, timeLeft: 1100 });
  await s.clock.advance(1000);
  assert.equal(s.audio.playCalls, plays);
  assert.equal(s.audio.paused, false);
  assert.ok(close(s.gain, 0.5));
});

// ---------- cepat berturut-turut (Review Focus 2) ----------
test("Mulai lalu Jeda dalam 300 ms → akhirnya diam, play() tidak dipanggil lagi", async () => {
  const s = setup();
  s.p.setSound("hujan");
  await s.clock.advance(0);
  s.p.update(WORK_RUN);
  await s.clock.advance(300);
  s.p.update(WORK_PAUSED);
  const plays = s.audio.playCalls;
  await s.clock.advance(2000);
  assert.equal(s.audio.paused, true);
  assert.equal(s.gain, 0);
  assert.equal(s.audio.playCalls, plays);
  assert.equal(s.p.state().state, "idle");
  assert.equal(s.clock.pending(), 0);
});

test("Mulai lalu Jeda sebelum play() selesai → pause, tanpa fade-in", async () => {
  const s = setup();
  s.p.setSound("hujan");
  await s.clock.advance(0);
  s.p.update(WORK_RUN);
  s.p.update(WORK_PAUSED); // sebelum microtask play() resolve
  await s.clock.advance(2000);
  assert.equal(s.audio.paused, true);
  assert.equal(s.gain, 0);
  assert.equal(s.audio.playCalls, 1);
});

test("Mulai sebelum fetch selesai lalu Jeda → tidak pernah play()", async () => {
  const s = setup();
  s.p.setSound("hujan", { preload: false });
  s.p.update(WORK_RUN);
  s.p.update(WORK_PAUSED);
  await s.clock.advance(2000);
  assert.equal(s.fetches.length, 1);
  assert.equal(s.audio.playCalls, 0);
  assert.equal(s.audio.paused, true);
});

test("ganti sound di tengah fade → satu elemen audio, Blob lama di-revoke, fade-in sound baru", async () => {
  const s = setup();
  s.p.setSound("hujan");
  await s.clock.advance(0);
  s.p.update(WORK_RUN);
  await s.clock.advance(400);
  const oldSrc = s.audio.src;
  assert.equal(oldSrc, "blob:1");
  s.p.setSound("brown-noise");
  await s.clock.advance(1000); // fade-out lalu ganti sumber
  assert.equal(s.audios.length, 1);
  assert.deepEqual(s.revoked, ["blob:1"]);
  assert.equal(s.audio.src, "blob:2");
  await s.clock.advance(1000);
  assert.equal(s.audio.paused, false);
  assert.ok(close(s.gain, 0.5));
  assert.equal(s.p.state().sound, "brown-noise");
  assert.equal(s.p.state().state, "playing");
  assert.deepEqual(s.fetches, ["/static/sounds/hujan-v1.ogg", "/static/sounds/brown-noise-v1.ogg"]);
});

test("ganti sound berkali-kali saat fetch berjalan → hanya hasil terakhir dipakai", async () => {
  const s = setup();
  s.p.setSound("hujan");
  s.p.setSound("brown-noise");
  s.p.setSound("detak-jam");
  await s.clock.advance(0);
  s.p.update(WORK_RUN);
  await s.clock.advance(1000);
  assert.equal(s.audios.length, 1);
  assert.equal(s.created.length, 1);
  assert.equal(s.audio.src, "blob:1");
  assert.equal(s.p.state().sound, "detak-jam");
  assert.equal(s.p.state().state, "playing");
});

// ---------- autoplay ditolak (Review Focus 1) ----------
test("autoplay ditolak → waiting-tap; pointerdown mencoba lagi sekali → playing", async () => {
  const o = { rejectPlay: "NotAllowedError" };
  const s = setup(o);
  s.p.setSound("hujan", { preload: false });
  s.p.update(WORK_RUN);
  await s.clock.advance(1000);
  assert.equal(s.p.state().state, "waiting-tap");
  assert.equal(s.audio.playCalls, 1);
  assert.deepEqual(s.doc.listeners.map((l) => l.type).sort(), ["click", "keydown", "pointerdown", "pointerup"]);
  assert.ok(s.doc.listeners.every((l) => l.opts.capture === true));
  s.p.setVolume(60); // tidak menambah listener / play
  assert.equal(s.doc.listeners.length, 4);
  assert.equal(s.audio.playCalls, 1);
  o.rejectPlay = null;
  s.doc.dispatch("pointerdown");
  await s.clock.advance(1000);
  assert.equal(s.audio.playCalls, 2);
  assert.equal(s.p.state().state, "playing");
  assert.ok(close(s.gain, 0.6));
  assert.ok(s.ctx.resumeCalls >= 1);
  assert.equal(s.doc.listeners.length, 0);
  s.doc.dispatch("pointerdown");
  await s.clock.advance(0);
  assert.equal(s.audio.playCalls, 2);
});

test("waiting-tap lalu timer dijeda → listener dilepas, ketukan tidak memutar", async () => {
  const o = { rejectPlay: "NotAllowedError" };
  const s = setup(o);
  s.p.setSound("hujan");
  await s.clock.advance(0);
  s.p.update(WORK_RUN);
  await s.clock.advance(0);
  assert.equal(s.p.state().state, "waiting-tap");
  s.p.update(WORK_PAUSED);
  assert.equal(s.doc.listeners.length, 0);
  assert.equal(s.p.state().state, "idle");
  o.rejectPlay = null;
  s.doc.dispatch("pointerdown");
  await s.clock.advance(1000);
  assert.equal(s.audio.playCalls, 1);
  assert.equal(s.audio.paused, true);
});

test("AudioContext suspended setelah play → waiting-tap, ketukan me-resume lalu fade-in", async () => {
  const s = setup({ ctxState: "suspended" });
  s.p.setSound("hujan");
  await s.clock.advance(0);
  // resume() tanpa gesture tidak berhasil
  s.ctx.resume = () => { s.ctx.resumeCalls++; return new Promise(() => {}); };
  s.p.update(WORK_RUN);
  await s.clock.advance(1000);
  assert.equal(s.p.state().state, "waiting-tap");
  assert.equal(s.gain, 0);
  s.ctx.resume = () => { s.ctx.resumeCalls++; s.ctx.state = "running"; return Promise.resolve(); };
  s.doc.dispatch("pointerdown");
  await s.clock.advance(1000);
  assert.equal(s.p.state().state, "playing");
  assert.ok(close(s.gain, 0.5));
});

for (const type of ["pointerdown", "pointerup", "click", "keydown"]) {
  test("gesture " + type + " saja → mencoba lagi dan melepas keempat listener", async () => {
    const o = { rejectPlay: "NotAllowedError" };
    const s = setup(o);
    s.p.setSound("hujan");
    await s.clock.advance(0);
    s.p.update(WORK_RUN);
    await s.clock.advance(0);
    assert.equal(s.p.state().state, "waiting-tap");
    assert.equal(s.doc.listeners.length, 4);
    o.rejectPlay = null;
    s.doc.dispatch(type);
    await s.clock.advance(1000);
    assert.equal(s.audio.playCalls, 2);
    assert.equal(s.p.state().state, "playing");
    assert.equal(s.doc.listeners.length, 0);
  });
}

test("ketukan: resume() selesai setelah play() → satu ketukan berakhir playing", async () => {
  const s = setup({ rejectPlay: "NotAllowedError" });
  s.p.setSound("hujan");
  await s.clock.advance(0);
  s.ctx.state = "suspended";
  s.ctx.resume = () => { s.ctx.resumeCalls++; return new Promise(() => {}); }; // tanpa gesture: menggantung
  s.p.update(WORK_RUN);
  await s.clock.advance(0);
  assert.equal(s.p.state().state, "waiting-tap");
  s.o.rejectPlay = null;
  s.ctx.resume = () => {
    s.ctx.resumeCalls++;
    return new Promise((r) => s.clock.setTimeout(() => { s.ctx.state = "running"; r(); }, 5));
  };
  s.doc.dispatch("pointerdown");
  await s.clock.advance(0); // play() sudah selesai, resume belum
  assert.equal(s.ctx.state, "suspended");
  await s.clock.advance(505);
  assert.equal(s.p.state().state, "playing");
  assert.ok(s.gain > 0.2 && s.gain < 0.5, String(s.gain));
  assert.equal(s.doc.listeners.length, 0);
  await s.clock.advance(1000);
  assert.ok(close(s.gain, 0.5));
});

// ---------- sumber tertunda basi ----------
test("Hujan → Brown Noise (fetch selesai saat fade-out) → Hujan lagi: tanpa fetch ulang, Blob brown di-revoke", async () => {
  const s = await playing();
  assert.equal(s.audio.src, "blob:1");
  s.p.setSound("brown-noise");
  await s.clock.advance(300); // fetch brown selesai, masih fade-out
  assert.equal(s.created.length, 2);
  assert.equal(s.audio.src, "blob:1");
  s.p.setSound("hujan");
  assert.deepEqual(s.revoked, ["blob:2"]);
  await s.clock.advance(2000);
  assert.deepEqual(s.fetches, ["/static/sounds/hujan-v1.ogg", "/static/sounds/brown-noise-v1.ogg"]);
  assert.equal(s.audio.src, "blob:1");
  assert.deepEqual(s.revoked, ["blob:2"]);
  assert.equal(s.audio.paused, false);
  assert.ok(close(s.gain, 0.5));
  assert.equal(s.p.state().state, "playing");
  assert.equal(s.p.state().sound, "hujan");
});

test("play() tertunda: ganti sound lalu play() ditolak → waiting-tap, ketukan memutar sound BARU", async () => {
  const o = { deferPlay: 50, rejectPlay: "NotAllowedError" };
  const s = setup(o);
  s.p.setSound("hujan");
  await s.clock.advance(0);
  s.p.update(WORK_RUN);
  assert.equal(s.audio.paused, false); // play() berjalan
  s.p.setSound("brown-noise");
  await s.clock.advance(10); // fetch brown selesai, play() hujan masih tertunda
  assert.equal(s.created.length, 2);
  await s.clock.advance(100); // play() ditolak
  assert.equal(s.p.state().state, "waiting-tap");
  assert.equal(s.p.state().sound, "brown-noise");
  assert.equal(s.audio.paused, true);
  assert.equal(s.audio.src, "blob:2");
  assert.deepEqual(s.revoked, ["blob:1"]);
  o.rejectPlay = null;
  s.doc.dispatch("click");
  await s.clock.advance(1100);
  assert.equal(s.audios.length, 1);
  assert.equal(s.audio.src, "blob:2");
  assert.equal(s.audio.paused, false);
  assert.equal(s.p.state().state, "playing");
  assert.ok(close(s.gain, 0.5));
  assert.equal(s.doc.listeners.length, 0);
});

test("play() tertunda lalu Jeda sebelum selesai → diam, tanpa fade-in", async () => {
  const s = setup({ deferPlay: 50 });
  s.p.setSound("hujan");
  await s.clock.advance(0);
  s.p.update(WORK_RUN);
  await s.clock.advance(20);
  s.p.update(WORK_PAUSED);
  await s.clock.advance(2000);
  assert.equal(s.audio.paused, true);
  assert.equal(s.gain, 0);
  assert.equal(s.audio.playCalls, 1);
  assert.equal(s.p.state().state, "idle");
});

// ---------- fetch gagal (Review Focus 3) ----------
test("fetch ditolak (offline) → error; setSound key lain dengan fetch berhasil → pulih", async () => {
  const o = { fetchFail: "reject" };
  const s = setup(o);
  s.p.update(WORK_RUN);
  s.p.setSound("hujan");
  await s.clock.advance(1000);
  assert.equal(s.p.state().state, "error");
  o.fetchFail = null;
  s.p.setSound("brown-noise");
  await s.clock.advance(1000);
  assert.equal(s.p.state().state, "playing");
  assert.equal(s.audio.paused, false);
  assert.ok(close(s.gain, 0.5));
});

test("respons tidak ok → error; Work mulai lagi mencoba lagi (online kembali)", async () => {
  const o = { fetchFail: "404" };
  const s = setup(o);
  s.p.setSound("hujan", { preload: false });
  s.p.update(WORK_RUN);
  await s.clock.advance(0);
  assert.equal(s.p.state().state, "error");
  assert.equal(s.created.length, 0);
  o.fetchFail = null;
  s.p.update(WORK_PAUSED);
  s.p.update(WORK_RUN);
  await s.clock.advance(1000);
  assert.equal(s.fetches.length, 2);
  assert.equal(s.p.state().state, "playing");
});

// ---------- volume ----------
test("volume 0 → play() tidak dipanggil", async () => {
  const s = setup();
  s.p.setVolume(0);
  s.p.setSound("hujan");
  await s.clock.advance(0);
  s.p.update(WORK_RUN);
  await s.clock.advance(1000);
  assert.equal(s.audio.playCalls, 0);
  assert.equal(s.p.state().volume, 0);
  s.p.setVolume(40);
  await s.clock.advance(1000);
  assert.equal(s.audio.playCalls, 1);
  assert.ok(close(s.gain, 0.4));
});

test("sound off → tidak pernah play(); off saat berbunyi → pause()", async () => {
  const s = await playing();
  s.p.setSound("off");
  assert.equal(s.audio.paused, true);
  assert.equal(s.p.state().state, "idle");
  assert.equal(s.p.state().sound, "off");
  const plays = s.audio.playCalls;
  s.p.update(WORK_PAUSED);
  s.p.update(WORK_RUN);
  await s.clock.advance(1000);
  assert.equal(s.audio.playCalls, plays);
});

test("setVolume saat berbunyi → gain berubah dalam ≤ 100 ms", async () => {
  const s = await playing();
  s.p.setVolume(80);
  await s.clock.advance(100);
  assert.ok(close(s.gain, 0.8));
  assert.equal(s.p.state().volume, 80);
  s.p.setVolume(150);
  await s.clock.advance(100);
  assert.ok(close(s.gain, 1));
  s.p.setVolume(0);
  await s.clock.advance(100);
  assert.equal(s.gain, 0);
  assert.equal(s.audio.paused, true);
});

test("tanpa Web Audio → fade memakai audio.volume", async () => {
  const s = await playing({ noWebAudio: true });
  assert.equal(s.ctx, null);
  assert.ok(close(s.audio.volume, 0.5));
  s.p.update(WORK_PAUSED);
  await s.clock.advance(1000);
  assert.equal(s.audio.volume, 0);
  assert.equal(s.audio.paused, true);
});

test("Web Audio: satu GainNode, audio.volume tidak dipakai", async () => {
  const s = await playing();
  assert.equal(s.ctx.sources, 1);
  assert.equal(s.audio.volume, 1);
  assert.ok(close(s.p.state().gain, 0.5));
});

test("onState dipanggil saat status berubah", async () => {
  const s = await playing();
  const seq = s.states.map((x) => x.state);
  assert.ok(seq.includes("loading"));
  assert.equal(seq[seq.length - 1], "playing");
  assert.equal(s.states[s.states.length - 1].sound, "hujan");
});

test("dispose: pause, revoke Blob, lepas timer dan listener", async () => {
  const s = await playing();
  s.p.update(WORK_PAUSED);
  s.p.dispose();
  await s.clock.advance(2000);
  assert.equal(s.audio.paused, true);
  assert.deepEqual(s.revoked, ["blob:1"]);
  assert.equal(s.clock.pending(), 0);
});

// ---------- source ----------
test("index.html memuat ambient.js setelah pomolog.js", () => {
  const a = indexHtml.indexOf('src="/static/offline/pomolog.js"');
  const b = indexHtml.indexOf('src="/static/offline/ambient.js"');
  assert.ok(a >= 0 && b > a);
});
test("sw.js memuat ambient.js di STATIC, bukan file suara", () => {
  assert.ok(swJs.includes('"/static/offline/ambient.js"'));
  assert.ok(!/"\/static\/sounds\/[^"]+"/.test(swJs));
});
