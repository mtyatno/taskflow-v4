"use strict";

// Bug lama (2026-10-26): overlay "Task dengan tag" di TaskDetailBody (`position: absolute`) berjangkar ke wadah
// gulirnya (`.modal-content` di modal, `aside.tl-live-panel` di panel). Dengan `inset: 0` overlay selalu berada di
// bagian atas isi, jadi saat wadah sudah digulir area yang terlihat tidak tertutup. Perbaikan: overlay ditaruh di area
// terlihat wadah (top = scrollTop, tinggi = clientHeight, left/right 0) dan gulir wadah dikunci selama overlay terbuka;
// overflow semula dikembalikan saat ditutup / unmount. Spec live edit §12.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const indexHtml = fs.readFileSync(path.resolve(__dirname, "../../static/index.html"), "utf8").replace(/\r\n/g, "\n");

function fnSource(name) {
  const start = indexHtml.indexOf(`\nfunction ${name}(`);
  assert.ok(start >= 0, `${name} must exist`);
  const end = indexHtml.indexOf("\n}\n", start + 1);
  return indexHtml.slice(start, end + 2);
}

// Wadah gulir palsu: cukup untuk pinOverlayToScrollBox (style, scrollTop, clientHeight, listener).
function fakeEnv({ withRO = true, overflow = "" } = {}) {
  const listeners = { box: {}, win: {} };
  const add = (bag) => (type, fn) => { (bag[type] = bag[type] || []).push(fn); };
  const remove = (bag) => (type, fn) => { bag[type] = (bag[type] || []).filter((f) => f !== fn); };
  const box = {
    style: { overflow }, scrollTop: 340, clientHeight: 500,
    addEventListener: add(listeners.box), removeEventListener: remove(listeners.box),
  };
  const win = { addEventListener: add(listeners.win), removeEventListener: remove(listeners.win) };
  const observers = [];
  class FakeRO {
    constructor(cb) { this.cb = cb; this.targets = []; this.disconnected = false; observers.push(this); }
    observe(t) { this.targets.push(t); }
    disconnect() { this.disconnected = true; }
  }
  const pin = new Function("window", "ResizeObserver", fnSource("pinOverlayToScrollBox") + "\nreturn pinOverlayToScrollBox;")(
    win, withRO ? FakeRO : undefined);
  const overlay = { parentElement: box };
  return { pin, box, overlay, listeners, observers };
}
const fire = (bag, type) => (bag[type] || []).forEach((fn) => fn());

test("pinOverlayToScrollBox: overlay di area terlihat wadah dan gulir wadah dikunci", () => {
  const env = fakeEnv();
  const places = [];
  env.pin(env.overlay, (pos) => places.push(pos));
  assert.deepEqual(places, [{ top: 340, height: 500 }], "top = scrollTop, tinggi = clientHeight");
  assert.equal(env.box.style.overflow, "hidden");
});

test("pinOverlayToScrollBox: ukur ulang saat wadah berubah ukuran, jendela di-resize, atau wadah digulir", () => {
  const env = fakeEnv();
  const places = [];
  env.pin(env.overlay, (pos) => places.push(pos));
  assert.equal(env.observers.length, 1);
  assert.deepEqual(env.observers[0].targets, [env.box]);
  env.box.clientHeight = 420; env.observers[0].cb([]);
  env.box.clientHeight = 380; fire(env.listeners.win, "resize");
  env.box.scrollTop = 300; fire(env.listeners.box, "scroll");
  assert.deepEqual(places.slice(1), [{ top: 340, height: 420 }, { top: 340, height: 380 }, { top: 300, height: 380 }]);
});

test("pinOverlayToScrollBox: pembersih mengembalikan overflow semula dan melepas semua listener", () => {
  const env = fakeEnv({ overflow: "auto" });
  const release = env.pin(env.overlay, () => {});
  assert.equal(env.box.style.overflow, "hidden");
  release();
  assert.equal(env.box.style.overflow, "auto", "nilai inline semula, bukan string kosong");
  assert.equal(env.observers[0].disconnected, true);
  assert.equal((env.listeners.win.resize || []).length, 0);
  assert.equal((env.listeners.box.scroll || []).length, 0);
  const plain = fakeEnv(); // overflow dari CSS (inline kosong) → inline kembali kosong
  plain.pin(plain.overlay, () => {})();
  assert.equal(plain.box.style.overflow, "");
});

test("pinOverlayToScrollBox: tanpa ResizeObserver tetap jalan; overlay tanpa wadah → no-op", () => {
  const env = fakeEnv({ withRO: false });
  const places = [];
  const release = env.pin(env.overlay, (pos) => places.push(pos));
  env.box.clientHeight = 300; fire(env.listeners.win, "resize");
  assert.deepEqual(places, [{ top: 340, height: 500 }, { top: 340, height: 300 }]);
  release();
  assert.equal(env.box.style.overflow, "");
  assert.doesNotThrow(() => env.pin(null, () => assert.fail("tidak boleh dipanggil"))());
  assert.doesNotThrow(() => env.pin({ parentElement: null }, () => assert.fail("tidak boleh dipanggil"))());
});

test("TaskDetailBody: efek overlay memakai pinOverlayToScrollBox selama overlay terbuka", () => {
  const s = fnSource("TaskDetailBody");
  assert.match(s, /const tagOverlayRef = useRef\(null\);/);
  assert.match(s, /const \[tagOverlayPos, setTagOverlayPos\] = useState\(null\);/);
  assert.match(s, /const tagOverlayOpen = !!tagTasksModal;/);
  assert.match(s, /React\.useLayoutEffect\(\(\) => \{\s*if \(!tagOverlayOpen\) return undefined;\s*const release = pinOverlayToScrollBox\(tagOverlayRef\.current, setTagOverlayPos\);\s*return \(\) => \{\s*release\(\);\s*setTagOverlayPos\(null\);\s*\};\s*\}, \[tagOverlayOpen\]\);/);
});

test("TaskDetailBody: overlay 'Task dengan tag' memakai posisi area terlihat (bukan inset: 0), warna tetap", () => {
  const s = fnSource("TaskDetailBody");
  const start = s.indexOf("tagTasksModal && /*#__PURE__*/React.createElement(\"div\", {");
  assert.ok(start > 0, "overlay ada");
  const overlay = s.slice(start, s.indexOf("\"Task dengan tag \"", start));
  assert.match(overlay, /ref: tagOverlayRef,/);
  assert.match(overlay, /position: "absolute",\s*left: 0,\s*right: 0,\s*top: tagOverlayPos \? tagOverlayPos\.top : 0,\s*height: tagOverlayPos \? tagOverlayPos\.height : "100%",/);
  assert.doesNotMatch(overlay, /inset: 0/);
  assert.match(overlay, /background: "rgba\(0,0,0,0\.6\)"/);
  assert.match(overlay, /zIndex: 10/);
  assert.doesNotMatch(overlay, /borderLeft|border-left/);
  const list = s.slice(s.indexOf("\"Task dengan tag \"", start));
  assert.match(list, /overflowY: "auto",\s*flex: 1/, "isi overlay tetap bisa digulir sendiri");
});

test("pinOverlayToScrollBox didefinisikan sebelum TaskDetailBody (bukan di antara Body dan Modal)", () => {
  const p = indexHtml.indexOf("\nfunction pinOverlayToScrollBox("), b = indexHtml.indexOf("\nfunction TaskDetailBody({");
  assert.ok(p > 0 && b > p);
});
