;(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory(root);
  } else {
    root.TF = root.TF || {};
    factory(root);
  }
})(typeof self !== "undefined" ? self : globalThis, function (root) {
  "use strict";

  const TFdb = (typeof module !== "undefined" && module.exports)
    ? require("./db.js")
    : root.TF.db;

  function outboxAdd(op) {
    const record = Object.assign({ ts: Date.now(), retries: 0 }, op);
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const tx = db.transaction("_outbox", "readwrite");
      const r = tx.objectStore("_outbox").add(record);
      r.onsuccess = () => { record.qid = r.result; };
      tx.oncomplete = () => resolve(record.qid);
      tx.onerror = () => reject(tx.error);
    }));
  }

  function outboxAll() {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const r = db.transaction("_outbox", "readonly").objectStore("_outbox").getAll();
      r.onsuccess = () => resolve(r.result || []);
      r.onerror = () => reject(r.error);
    }));
  }

  function outboxRemove(qid) {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const tx = db.transaction("_outbox", "readwrite");
      tx.objectStore("_outbox").delete(qid);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    }));
  }

  function outboxByEntity(type, cid) {
    return outboxAll().then((all) => all.filter((o) => o.entity_type === type && o.cid === cid));
  }

  // Kunci lintas tab untuk antrean bersama (perbaikan review akhir W2 PR B2 checklist offline). Semua tab satu origin
  // memakai IndexedDB yang sama, dan event `online` / fetchAll 30 dtk memicu sync() di SETIAP tab: tanpa kunci dua tab
  // menguras _outbox bersamaan (entri yang sama terkirim dua kali, tab yang tertinggal mengirim ulang aksi lama sesudah
  // aksi yang lebih baru) dan pullChecklists di satu tab menimpa checklist saat tab lain sedang mengirim. Kunci Web Locks
  // `navigator.locks` (eksklusif, dilepas otomatis saat callback selesai/galat atau tab ditutup) dipegang selama
  // pushOutbox dan pullChecklists. Kunci hanya mengatur SIAPA yang mengirim; isi yang dikirim tetap entri antrean yang
  // dibaca sesudah kunci didapat, jadi hasil sinkron sama dengan satu tab.
  // - opts.wait false (bawaan, sinkron latar): kunci dipegang tab lain → fn TIDAK dijalankan → {ran: false}; tab itu
  //   yang mengosongkan antrean, pemanggil menjadwalkan ulang (busy) / siklus berikutnya mengambil sisanya.
  // - opts.wait true (dorong sekarang: __pushNow sebelum logout / bagikan / id server): antre sampai kunci dilepas.
  // - Tanpa navigator.locks (Safari < 15.4, WebView lama) atau request kunci gagal sebelum callback (mis. SecurityError)
  //   → fn tetap dijalankan tanpa kunci (perilaku sebelumnya). Galat fn sendiri diteruskan apa adanya.
  // → Promise<{ran: true, value} | {ran: false}>.
  const QUEUE_LOCK = "tf-antrean-sinkron:" + (TFdb && TFdb.DB_NAME ? TFdb.DB_NAME : "taskflow-offline");
  function lockManager() {
    try {
      const nav = root && root.navigator;
      const L = nav && nav.locks;
      return L && typeof L.request === "function" ? L : null;
    } catch (_) { return null; }
  }
  function withQueueLock(fn, opts) {
    const run = () => Promise.resolve().then(fn).then((value) => ({ ran: true, value }));
    const L = lockManager();
    if (!L) return run();
    let entered = false;
    let req;
    try {
      req = L.request(QUEUE_LOCK, opts && opts.wait ? {} : { ifAvailable: true }, (lock) => {
        entered = true;
        return lock ? run() : { ran: false };
      });
    } catch (e) {
      return run();
    }
    return Promise.resolve(req).catch((e) => {
      if (entered) throw e;
      return run();
    });
  }

  const exported = { outboxAdd, outboxAppend: outboxAdd, outboxAll, outboxRemove, outboxByEntity, withQueueLock, QUEUE_LOCK };
  if (root && typeof root === "object") { root.TF = root.TF || {}; root.TF.outbox = exported; }
  return exported;
});
