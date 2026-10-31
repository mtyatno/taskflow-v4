// TF.taskext — aturan field plugin di task (`tasks.ext`) sisi klien, sama dengan server `task_ext.py`
// (spec plugin Fase 1 K4/K5/K7; rencana PR 1a-1 R3, R9). Modul murni tanpa dependensi.
//
// ext = objek datar berkunci "<pluginId>.<field>"; tulis = patch per kunci (null menghapus kunci).
// Ukuran = byte UTF-8 JSON.stringify — per namespace ≤ 4096, total ≤ 16384.
// Referensi task = {"$task": <id>}; di klien id boleh angka bulat (server id) atau cid string (≤ 64),
// server hanya menerima angka bulat (cid ditulis ulang/ditahan oleh syncpush sebelum terkirim).
;(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory(root);
  } else {
    root.TF = root.TF || {};
    factory(root);
  }
})(typeof self !== "undefined" ? self : globalThis, function (root) {
  "use strict";

  const KEY_RE = /^[a-z][a-z0-9-]{2,31}\.[a-zA-Z][a-zA-Z0-9_]{0,31}$/;
  const FIELD_RE = /^[a-zA-Z][a-zA-Z0-9_]{0,31}$/;
  const PLUGIN_MAX_BYTES = 4096;
  const TOTAL_MAX_BYTES = 16384;
  const REF_KEY = "$task";
  const CID_MAX = 64;
  const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

  function isPlainObject(v) {
    if (v === null || typeof v !== "object" || Array.isArray(v)) return false;
    const p = Object.getPrototypeOf(v);
    // Object.prototype realm lain (mis. hasil structured clone di konteks lain) juga polos.
    return p === null || p === Object.prototype || Object.getPrototypeOf(p) === null && hasOwn(p, "hasOwnProperty");
  }

  function utf8Bytes(str) {
    let n = 0;
    for (let i = 0; i < str.length; i++) {
      const c = str.charCodeAt(i);
      if (c < 0x80) n += 1;
      else if (c < 0x800) n += 2;
      else if (c >= 0xd800 && c <= 0xdbff && i + 1 < str.length) {
        const d = str.charCodeAt(i + 1);
        if (d >= 0xdc00 && d <= 0xdfff) { n += 4; i++; } else n += 3;
      } else n += 3;
    }
    return n;
  }

  function namespaceOf(key) {
    const i = String(key).indexOf(".");
    return i < 0 ? String(key) : String(key).slice(0, i);
  }

  function extError(code, key) {
    const e = new Error(code);
    e.code = code;
    e.key = key === undefined ? null : key;
    e.status = 422;
    return e;
  }

  function isRef(v) {
    return isPlainObject(v) && hasOwn(v, REF_KEY);
  }

  function refOk(v) {
    const keys = Object.keys(v);
    if (keys.length !== 1) return false;
    const id = v[REF_KEY];
    if (typeof id === "number") return Number.isInteger(id);
    if (typeof id === "string") return id.length > 0 && id.length <= CID_MAX;
    return false;
  }

  // null = sah; selain itu "EXT_INVALID" | "EXT_TASK_REF". `path` = leluhur (deteksi siklus; objek yang
  // dipakai dua kali tanpa siklus tetap sah, seperti JSON.stringify).
  function checkValue(v, path) {
    if (v === null || typeof v === "boolean" || typeof v === "string") return null;
    if (typeof v === "number") return Number.isFinite(v) ? null : "EXT_INVALID";
    if (typeof v !== "object") return "EXT_INVALID"; // undefined, fungsi, symbol, bigint
    if (path.has(v)) return "EXT_INVALID";
    let items;
    if (Array.isArray(v)) items = v;
    else if (!isPlainObject(v)) return "EXT_INVALID"; // Date, Map, kelas …
    else if (hasOwn(v, REF_KEY) && !refOk(v)) return "EXT_TASK_REF";
    else items = Object.keys(v).map((k) => v[k]);
    path.add(v);
    for (let i = 0; i < items.length; i++) {
      const code = checkValue(items[i], path);
      if (code) { path.delete(v); return code; }
    }
    path.delete(v);
    return null;
  }

  // Validasi patch: bentuk kunci, nilai JSON baku, referensi task. {code, key} | null.
  // allowNull (bawaan true): false → nilai null di tingkat atas dianggap tidak sah.
  function checkPatch(patch, opts) {
    const allowNull = !opts || opts.allowNull !== false;
    if (!isPlainObject(patch)) return { code: "EXT_INVALID", key: null };
    for (const key of Object.keys(patch)) {
      if (!KEY_RE.test(key)) return { code: "EXT_INVALID", key };
      const v = patch[key];
      if (v === null) {
        if (!allowNull) return { code: "EXT_INVALID", key };
        continue;
      }
      const code = checkValue(v, new Set());
      if (code) return { code, key };
    }
    return null;
  }

  function cleanNulls(patch) {
    const out = {};
    if (!isPlainObject(patch)) return out;
    for (const k of Object.keys(patch)) if (patch[k] !== null && patch[k] !== undefined) out[k] = patch[k];
    return out;
  }

  function applyPatch(ext, patch) {
    const out = Object.assign({}, isPlainObject(ext) ? ext : {});
    if (!isPlainObject(patch)) return out;
    for (const k of Object.keys(patch)) {
      const v = patch[k];
      if (v === undefined) continue;
      if (v === null) delete out[k];
      else out[k] = v;
    }
    return out;
  }

  function sizeError(ext) {
    if (!isPlainObject(ext)) return null;
    const byNs = {};
    for (const k of Object.keys(ext)) {
      const ns = namespaceOf(k);
      (byNs[ns] = byNs[ns] || {})[k] = ext[k];
    }
    for (const ns of Object.keys(byNs).sort()) {
      if (utf8Bytes(JSON.stringify(byNs[ns])) > PLUGIN_MAX_BYTES) return { code: "EXT_TOO_LARGE", key: ns };
    }
    if (utf8Bytes(JSON.stringify(ext)) > TOTAL_MAX_BYTES) return { code: "EXT_TOO_LARGE", key: null };
    return null;
  }

  function refsIn(value) {
    const out = [];
    const stack = [value];
    while (stack.length) {
      const v = stack.pop();
      if (Array.isArray(v)) { for (let i = 0; i < v.length; i++) stack.push(v[i]); continue; }
      if (!isPlainObject(v)) continue;
      if (hasOwn(v, REF_KEY)) { out.push(v[REF_KEY]); continue; }
      for (const k of Object.keys(v)) stack.push(v[k]);
    }
    return out;
  }

  // Salinan dalam `value` dengan setiap objek ref diganti fn(id, refObj) → {$task} | null.
  function mapRefs(value, fn) {
    if (Array.isArray(value)) return value.map((v) => mapRefs(v, fn));
    if (!isPlainObject(value)) return value;
    if (hasOwn(value, REF_KEY)) {
      const r = fn(value[REF_KEY], value);
      return r === undefined ? null : r;
    }
    const out = {};
    for (const k of Object.keys(value)) out[k] = mapRefs(value[k], fn);
    return out;
  }

  const exported = {
    KEY_RE, FIELD_RE, PLUGIN_MAX_BYTES, TOTAL_MAX_BYTES, REF_KEY,
    isPlainObject, utf8Bytes, namespaceOf, extError, checkPatch, cleanNulls, applyPatch, sizeError,
    isRef, refsIn, mapRefs,
  };
  if (root && typeof root === "object") { root.TF = root.TF || {}; root.TF.taskext = exported; }
  return exported;
});
