;(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory(root);
  } else {
    root.TF = root.TF || {};
    factory(root);
  }
})(typeof self !== "undefined" ? self : globalThis, function (root) {
  "use strict";

  // Antrean log 🍅 selesai (PR B Target 🍅). Satu op outbox per sesi, cid = client_id (idempoten di server).
  // `pomodoros_done` pada record task = nilai server terakhir; jumlah pending hanya ditambahkan di jawaban
  // rute lokal (withPending) dan record hanya ditulis ulang dengan nilai server (ackPushed).
  const isNode = (typeof module !== "undefined" && module.exports);
  const req = (m, g) => (isNode ? require(m) : g);
  const TFdb = req("./db.js", root.TF && root.TF.db);
  const TFoutbox = req("./outbox.js", root.TF && root.TF.outbox);

  const ENTITY = "pomodoro_log";

  function isPomoOp(o) { return !!o && o.entity_type === ENTITY && o.op === "create"; }

  function enqueue(taskCid, entry) {
    const e = entry || {};
    // Dedupe baca-lalu-tulis (bukan satu transaksi): dua tab bisa sama-sama menambah op cid yang sama — tetap
    // aman karena server idempoten per client_id dan pendingByTaskCid menghitung tiap cid sekali.
    return TFoutbox.outboxAll().then((ops) => {
      if (ops.some((o) => isPomoOp(o) && o.cid === e.client_id)) return false;
      return TFoutbox.outboxAdd({
        entity_type: ENTITY,
        op: "create",
        cid: e.client_id,
        payload: {
          task_cid: taskCid,
          client_id: e.client_id,
          kind: e.kind,
          pomodoros: e.pomodoros,
          focus_seconds: e.focus_seconds,
          log_date: e.log_date,
          ended_at: e.ended_at,
        },
      }).then(() => true);
    });
  }

  function pendingByTaskCid() {
    return TFoutbox.outboxAll().then((ops) => {
      const seen = new Set();
      const out = {};
      for (const o of ops) {
        if (!isPomoOp(o) || seen.has(o.cid)) continue;
        seen.add(o.cid);
        const p = o.payload || {};
        if (p.task_cid == null) continue;
        out[p.task_cid] = (out[p.task_cid] || 0) + (Number(p.pomodoros) || 0);
      }
      return out;
    });
  }

  function withPending(row, pendingMap) {
    if (!row) return row;
    row.pomodoros_done = (row.pomodoros_done || 0) + ((pendingMap && pendingMap[row.cid]) || 0);
    return row;
  }

  // Satu transaksi: nilai server diadopsi dan op dihapus bersamaan → bacaan lokal tidak pernah menghitung
  // log yang sama dua kali (record baru + op lama). dirty/rev/base_rev tidak disentuh (field milik server).
  function ackPushed(qid, taskCid, pomodorosDone) {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const tx = db.transaction(["tasks", "_outbox"], "readwrite");
      if (taskCid != null && typeof pomodorosDone === "number") {
        const os = tx.objectStore("tasks");
        const r = os.get(taskCid);
        r.onsuccess = () => {
          const cur = r.result;
          if (!cur || cur.deleted) return;
          os.put(Object.assign({}, cur, { pomodoros_done: pomodorosDone }));
        };
      }
      tx.objectStore("_outbox").delete(qid);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      // Abort tanpa request error yang menggelembung (mis. kuota) tidak memicu onerror → jangan menggantung.
      tx.onabort = () => reject(tx.error || new Error("aborted"));
    }));
  }

  const exported = { enqueue, pendingByTaskCid, withPending, ackPushed };
  if (root && typeof root === "object") { root.TF = root.TF || {}; root.TF.pomolog = exported; }
  return exported;
});
