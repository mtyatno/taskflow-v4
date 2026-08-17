"use strict";
const { test, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const TF = require("../../static/offline/voicedictate.js");

// UMD wrapper menangkap `globalThis` sebagai root saat load — mutasi global
// di sini terlihat oleh runtime check modul (dibaca saat call, bukan load).
let calls;
function mockTauri(invokeImpl) {
  calls = [];
  globalThis.__TAURI__ = {
    core: {
      invoke: (cmd, args) => {
        calls.push({ cmd, args });
        return invokeImpl ? invokeImpl(cmd, args) : Promise.resolve("");
      },
    },
  };
}
function mockAndroid() {
  globalThis.navigator = { userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel) AppleWebKit/537.36" };
}
afterEach(() => {
  delete globalThis.__TAURI__;
  delete globalThis.navigator;
});

test("parseSpeechEvents: parse baris valid, lewati korup", () => {
  const raw = [
    '{"type":"state","state":"listening"}',
    "not-json",
    '{"type":"partial","text":"halo"}',
    "",
    '{"noType":true}',
    '{"type":"final","text":"halo dunia"}',
  ].join("\r\n");
  const events = TF.voicedictate.parseSpeechEvents(raw);
  assert.equal(events.length, 3);
  assert.deepEqual(events[0], { type: "state", state: "listening" });
  assert.deepEqual(events[1], { type: "partial", text: "halo" });
  assert.deepEqual(events[2], { type: "final", text: "halo dunia" });
});

test("parseSpeechEvents: input kosong/null → array kosong", () => {
  assert.deepEqual(TF.voicedictate.parseSpeechEvents(""), []);
  assert.deepEqual(TF.voicedictate.parseSpeechEvents(null), []);
});

test("dispatchEvents: routing + mapping waiting→paused + end→paused", () => {
  const seen = { states: [], partials: [], finals: [], errors: [] };
  const n = TF.voicedictate.dispatchEvents(
    [
      '{"type":"state","state":"waiting"}',
      '{"type":"state","state":"listening"}',
      '{"type":"partial","text":"seb"}',
      '{"type":"final","text":"sebentar"}',
      '{"type":"end"}',
      '{"type":"error","message":"boom"}',
    ].join("\n"),
    {
      onState: (s) => seen.states.push(s),
      onText: (t, isFinal) => (isFinal ? seen.finals.push(t) : seen.partials.push(t)),
      onError: (m) => seen.errors.push(m),
    }
  );
  assert.equal(n, 6);
  assert.deepEqual(seen.states, ["paused", "listening", "paused"]);
  assert.deepEqual(seen.partials, ["seb"]);
  assert.deepEqual(seen.finals, ["sebentar"]);
  assert.deepEqual(seen.errors, ["boom"]);
});

test("deteksi native: isSupported true + create() kembalikan impl native", () => {
  mockTauri();
  mockAndroid();
  assert.equal(TF.voicedictate.isSupported(), true);
  const impl = TF.voicedictate.create({});
  assert.equal(typeof impl.start, "function");
  assert.equal(typeof impl.stop, "function");
  assert.equal(typeof impl.getState, "function");
});

test("start/stop kirim command yang benar, stop bersihkan poller", () => {
  mockTauri();
  mockAndroid();
  const impl = TF.voicedictate.create({ onStateChange: () => {} });
  impl.start();
  assert.deepEqual(calls.map((c) => c.cmd), ["read_speech_events", "speech_cmd"]);
  assert.deepEqual(JSON.parse(calls[1].args.cmd), { cmd: "start", lang: "id-ID" });
  assert.equal(impl.getState(), "listening");
  impl.stop();
  assert.equal(calls[2].cmd, "speech_cmd");
  assert.deepEqual(JSON.parse(calls[2].args.cmd), { cmd: "stop" });
  assert.equal(impl.getState(), "idle");
});

test("tanpa Tauri/Android di node → isSupported false (fallback web impl)", () => {
  assert.equal(TF.voicedictate.isSupported(), false);
});

test("diagnostic fire SEKALI jika tidak ada event sama sekali", async () => {
  mockTauri(); // semua invoke resolve "" → poll selamanya tanpa event
  mockAndroid();
  const errs = [];
  const impl = TF.voicedictate.create({
    onError: (m) => errs.push(m),
    silentLimit: 2,
    pollIntervalMs: 5,
  });
  impl.start();
  await new Promise((r) => setTimeout(r, 80));
  impl.stop();
  assert.equal(errs.length, 1);
  assert.ok(errs[0].startsWith("Dikte tidak merespons"));
});

test("diagnostic TIDAK fire jika ada event diterima", async () => {
  mockTauri((cmd) =>
    cmd === "read_speech_events"
      ? Promise.resolve('{"type":"state","state":"listening"}')
      : Promise.resolve("")
  );
  mockAndroid();
  const errs = [];
  const impl = TF.voicedictate.create({
    onError: (m) => errs.push(m),
    silentLimit: 2,
    pollIntervalMs: 5,
  });
  impl.start();
  await new Promise((r) => setTimeout(r, 80));
  impl.stop();
  assert.equal(errs.length, 0);
});

test("error → idle menghentikan poller (tidak ada IPC lanjutan)", async () => {
  let readCount = 0;
  // Panggilan read_speech_events PERTAMA adalah drain event stale di start()
  // (hasilnya sengaja dibuang) — error tiba di poll pertama (baca ke-2).
  mockTauri((cmd) => {
    if (cmd === "read_speech_events") {
      readCount++;
      return Promise.resolve(readCount === 2 ? '{"type":"error","message":"boom"}' : "");
    }
    return Promise.resolve("");
  });
  mockAndroid();
  const impl = TF.voicedictate.create({
    onError: () => {},
    onStateChange: () => {},
    pollIntervalMs: 5,
  });
  impl.start();
  await new Promise((r) => setTimeout(r, 60));
  const countAfterError = readCount;
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(readCount, countAfterError);
  assert.equal(impl.getState(), "idle");
});

// ── planInsert: logika insert teks dikte (regresi "kata terpisah") ──

test("planInsert: skip duplikat & teks kosong", () => {
  assert.deepEqual(TF.voicedictate.planInsert("sela", "sela"), { kind: "skip" });
  assert.deepEqual(TF.voicedictate.planInsert("sela", ""), { kind: "skip" });
});

test("planInsert: append delta saat text memperpanjang prev (tanpa spasi)", () => {
  // Regresi bug "sela mat pagi": partial "sela" lalu final "selamat pagi"
  // harus append delta "mat pagi" — BUKAN " mat pagi" dengan spasi.
  const p = TF.voicedictate.planInsert("sela", "selamat pagi");
  assert.deepEqual(p, { kind: "append", delta: "mat pagi" });
  assert.equal(p.delta.charAt(0), "m");
});

test("planInsert: replace saat recognizer merevisi hipotesis", () => {
  assert.deepEqual(TF.voicedictate.planInsert("selamat pagi", "selamat malam"), {
    kind: "replace",
    text: "selamat malam",
  });
  // revisi ke teks lebih pendek juga = replace, bukan duplikasi
  assert.deepEqual(TF.voicedictate.planInsert("selamat pagi semua", "selamat"), {
    kind: "replace",
    text: "selamat",
  });
});

test("planInsert: insert utuh saat utterance baru (prev kosong)", () => {
  assert.deepEqual(TF.voicedictate.planInsert("", "halo dunia"), {
    kind: "insert",
    text: "halo dunia",
  });
});
