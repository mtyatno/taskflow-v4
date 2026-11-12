"use strict";
// Web Locks palsu (navigator.locks) untuk tes antar tab di node: satu pengelola dipakai bersama oleh beberapa instans
// modul (tab) dalam satu proses, seperti navigator.locks yang dipakai bersama semua tab satu origin. Hanya mode
// eksklusif: request(name, [opsi], cb) → janji hasil cb; kunci dilepas saat janji cb selesai (sukses / galat);
// {ifAvailable: true} saat kunci dipegang → cb(null) langsung; tanpa opsi → antre sampai dilepas (FIFO).

function createLockManager() {
  const held = new Set();
  const queues = new Map();
  const log = [];
  function release(name) {
    const q = queues.get(name);
    if (q && q.length) q.shift()();
    else held.delete(name);
  }
  function run(name, cb) {
    held.add(name);
    log.push(["acquire", name]);
    let p;
    try { p = Promise.resolve(cb({ name, mode: "exclusive" })); } catch (e) { p = Promise.reject(e); }
    return p.then((v) => { log.push(["release", name]); release(name); return v; },
      (e) => { log.push(["release", name]); release(name); throw e; });
  }
  function request(name, opts, cb) {
    if (typeof opts === "function") { cb = opts; opts = {}; }
    opts = opts || {};
    if (held.has(name)) {
      if (opts.ifAvailable) {
        log.push(["unavailable", name]);
        return Promise.resolve().then(() => cb(null));
      }
      return new Promise((resolve) => {
        if (!queues.has(name)) queues.set(name, []);
        queues.get(name).push(resolve);
      }).then(() => run(name, cb));
    }
    return run(name, cb);
  }
  return { request, isHeld: (name) => held.has(name), log };
}

// Pasang `mgr` sebagai navigator.locks global → fungsi pelepas.
function installLocks(mgr) {
  const nav = globalThis.navigator;
  Object.defineProperty(nav, "locks", { value: mgr, configurable: true, writable: true });
  return () => { delete nav.locks; };
}

module.exports = { createLockManager, installLocks };
