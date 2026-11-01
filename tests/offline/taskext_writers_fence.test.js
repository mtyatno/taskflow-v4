"use strict";
// Pagar penulis store `tasks` (spec plugin Fase 1 K25; rencana 1c-0 R9, ADR-043).
//
// Penanda ext saja (`ext_only_rev`) aman hanya bila SETIAP penulis yang mengubah field inti task membatalkannya
// (rev naik) atau memang tidak menyentuh field inti. Tes ini membaca teks sumber (tanpa IndexedDB) dan membekukan
// daftar penulis store `tasks` per (berkas, pola). Lokasi baru/berkurang → gagal: tinjau dampaknya ke penanda lalu
// perbarui AUDIT beserta alasannya. Komentar satu baris penuh (`//`, `*`) tidak dihitung.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..", "..", "static");
const OFFLINE = path.join(ROOT, "offline");

const PATTERNS = {
  P_MUTATE: /\bmutate\(\s*"tasks"/g,
  P_TX: /transaction\(\s*"tasks"\s*,\s*"readwrite"/g,
  P_TX_MULTI: /transaction\(\s*\[[^\]]*"tasks"[^\]]*\]\s*,\s*"readwrite"/g,
  P_PUTIF: /putIfUnchanged\(\s*"tasks"/g,
  P_MARK: /markPushed\(\s*"tasks"/g,
  P_OP: /(ensureEntityOp|requeueOp)\(\s*"task"|requeueIfDirty\(\s*"tasks"|entity_type:\s*"task"/g,
  // penulis generik (nama store dari variabel): syncconflict/syncpush/syncpull + definisi TFdb.mutate
  P_GENERIC: /\b(patchRec|mutate)\(\s*(store|storeName)\b/g,
};

// Penaik rev: pola dari brief + `rev: nextRev` (rewriteTaskExtRefs) + `next.rev = (cur.rev || 0) + 1` (syncconflict).
const REV_RE = /rev:\s*\(cur\.rev \|\| 0\) \+ 1|next\.rev = \(base\.rev|\brev:\s*nextRev\b|next\.rev = \(cur\.rev \|\| 0\) \+ 1/g;

function sourceFiles() {
  const names = fs.readdirSync(OFFLINE).filter((f) => f.endsWith(".js")).sort().map((f) => "static/offline/" + f);
  names.push("static/index.html");
  return names;
}
function readSource(rel) {
  const text = fs.readFileSync(path.join(ROOT, "..", rel), "utf8");
  return text.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
}
function count(text, re) {
  const m = text.match(new RegExp(re.source, "g"));
  return m ? m.length : 0;
}

// ── AUDIT dibekukan: tabel R9 (rencana 1c-0). `cat`: "rev+1" = menaikkan rev (penanda batal otomatis);
// "same-rev" = rev tetap tetapi tidak menyentuh field inti / menangani penanda secara eksplisit; "none" = bukan
// penulis record (definisi, op outbox, baca). ──────────────────────────────────────────────────────────────────
const AUDIT = [
  { file: "static/offline/db.js", pat: "P_GENERIC", n: 1, cat: "none", reason: "definisi TFdb.mutate generik (bukan penulis)" },
  { file: "static/offline/hydrate.js", pat: "P_TX", n: 1, cat: "same-rev", reason: "hydrateTasks/putTask: record baru dari server (taskFromServer, tanpa penanda); R9 `hydrateTasks` tidak perlu" },
  { file: "static/offline/pomolog.js", pat: "P_TX_MULTI", n: 1, cat: "same-rev", reason: "ackPushed: pomodoros_done milik server, rev/dirty/penanda tidak disentuh (R9 `pomolog.ackPushed`)" },
  { file: "static/offline/syncconflict.js", pat: "P_GENERIC", n: 6, cat: "same-rev", reason: "patchRec: definisi, retry (penanda dipertahankan, R10), discard_local (kunci dihapus, R10), keep_as_* (rev+1), hapus notice (bukan inti)" },
  { file: "static/offline/syncconflict.js", pat: "REV", n: 1, cat: "rev+1", reason: "keep_as_new/personal: entitas baru, rev+1 membatalkan penanda (R9)" },
  { file: "static/offline/syncpull.js", pat: "P_MUTATE", n: 2, cat: "same-rev", reason: "adoptTaskDerived (field turunan server, R9) + flag conflict remote_deleted (bukan inti)" },
  { file: "static/offline/syncpull.js", pat: "P_TX", n: 2, cat: "none", reason: "helper putTask/deleteTask pull: nilai server / remote_deleted (R9 `deleteTask`/`remote_deleted` pull)" },
  { file: "static/offline/syncpull.js", pat: "P_PUTIF", n: 2, cat: "same-rev", reason: "pull write/putIfUnchanged: record baru dari server (R7: tanpa penanda, atau ext saja lewat withLocalExt)" },
  { file: "static/offline/syncpull.js", pat: "P_OP", n: 1, cat: "none", reason: "requeueOp('task') setelah R11 (op susulan untuk kunci ext_dirty)" },
  { file: "static/offline/syncpull.js", pat: "P_GENERIC", n: 2, cat: "same-rev", reason: "backfillClientIds (client_id bukan inti) + putIfUnchanged generik (CAS)" },
  { file: "static/offline/syncpush.js", pat: "P_MUTATE", n: 3, cat: "rev+1", reason: "rewriteTaskExtRefs (ext, rev+1, penanda via extOnlyNext; R6), flag conflict remote_deleted, rewriteTasksWithContextCid (adoptContextServerId rev+1 / releaseContextCid rev tetap, R9)" },
  { file: "static/offline/syncpush.js", pat: "REV", n: 5, tasks: 2, cat: "rev+1", reason: "rewriteTaskExtRefs + adoptContextServerId (task); 3 sisanya note/mindmap (bukan store tasks)" },
  { file: "static/offline/syncpush.js", pat: "P_MARK", n: 2, cat: "same-rev", reason: "markPushed task (opUpdate ext saja + penuh): adopsi hanya bila rev sama / adoptAny hanya bila extOnlyNow (R5)" },
  { file: "static/offline/syncpush.js", pat: "P_OP", n: 4, cat: "none", reason: "ensureEntityOp (rewriteTaskExtRefs), requeueIfDirty ×3 (setelah PUT dan adoptContextServerId)" },
  { file: "static/offline/syncpush.js", pat: "P_GENERIC", n: 2, cat: "same-rev", reason: "freshRecreateClientId (client_id) + markPushed generik (CAS rev: adopt hanya bila rev sama)" },
  { file: "static/offline/taskrepo.js", pat: "P_MUTATE", n: 1, cat: "rev+1", reason: "updateTask (R2: penanda via extOnlyNext atas record terkini)" },
  { file: "static/offline/taskrepo.js", pat: "P_TX", n: 1, cat: "rev+1", reason: "putRaw: createTask (rev 1, tanpa penanda) dan deleteTask (rev+1, kunci dihapus)" },
  { file: "static/offline/taskrepo.js", pat: "P_OP", n: 3, cat: "none", reason: "outboxAdd create/update/delete" },
  { file: "static/offline/taskrepo.js", pat: "REV", n: 1, cat: "rev+1", reason: "updateTask next.rev = (base.rev || 0) + 1" },
  { file: "static/offline/taskroutes.js", pat: "P_MUTATE", n: 1, cat: "rev+1", reason: "hapus tag (rute): record ext saja → rev+1 (R8)" },
  { file: "static/offline/taskroutes.js", pat: "REV", n: 1, cat: "rev+1", reason: "hapus tag (rute) rev+1" },
  { file: "static/index.html", pat: "P_MUTATE", n: 1, cat: "rev+1", reason: "applyMovedTasksLocal (pindah workspace): nilai server + rev+1 (R9, tanpa ubah index.html)" },
  { file: "static/index.html", pat: "REV", n: 2, tasks: 1, cat: "rev+1", reason: "applyMovedTasksLocal (task); 1 sisanya mindmap" },
];

// Penaik rev di berkas lain (bukan store `tasks`; dibekukan agar penulis task baru tidak menyelinap lewat pola yang sama).
const REV_NON_TASK = {
  "static/offline/drawingrepo.js": 3,
  "static/offline/drawingshare.js": 2,
  "static/offline/mindmaprepo.js": 7,
  "static/offline/noterepo.js": 4,
  "static/offline/syncpull.js": 2,
};

function scan() {
  const found = {};
  for (const f of sourceFiles()) {
    const src = readSource(f);
    for (const name of Object.keys(PATTERNS)) {
      const n = count(src, PATTERNS[name]);
      if (n) found[f + "|" + name] = n;
    }
    const rv = count(src, REV_RE);
    if (rv) found[f + "|REV"] = rv;
  }
  return found;
}

test("daftar penulis store tasks persis tabel audit R9", () => {
  const found = scan();
  const expected = {};
  for (const a of AUDIT) {
    assert.ok(a.reason && a.reason.length > 10, "entri AUDIT wajib beralasan: " + a.file + " " + a.pat);
    expected[a.file + "|" + a.pat] = a.n;
  }
  for (const f of Object.keys(REV_NON_TASK)) expected[f + "|REV"] = (expected[f + "|REV"] || 0) + REV_NON_TASK[f];
  const keys = new Set(Object.keys(found).concat(Object.keys(expected)));
  for (const k of Array.from(keys).sort()) {
    const [file, pat] = k.split("|");
    assert.equal(found[k] || 0, expected[k] || 0,
      "penulis store tasks berubah di " + file + " (" + pat + "): tinjau ext_only_rev (R9, ADR-043) lalu perbarui AUDIT");
  }
});

test("ext_only_rev hanya dibandingkan di taskext.js", () => {
  const CMP = /ext_only_rev\s*(===|!==|==|!=|<=|>=|<|>)/;
  const CMP_KEY = /\[\s*(?:[A-Za-z_$][\w$]*\.)?(?:EXT_ONLY_KEY|markKey|KEY)\s*\]\s*(===|!==|==|!=|<=|>=|<|>)/;
  const CMP_KEY_REV = /(===|!==|==|!=|<=|>=|<|>)\s*[\w$.]*\[\s*(?:[A-Za-z_$][\w$]*\.)?(?:EXT_ONLY_KEY|markKey|KEY)\s*\]/;
  let scanned = 0;
  for (const f of sourceFiles()) {
    if (f === "static/offline/taskext.js") continue;
    scanned++;
    const src = readSource(f);
    assert.equal(CMP.test(src), false, f + ": ext_only_rev dibandingkan langsung — pakai TF.taskext.extOnlyNow");
    assert.equal(CMP_KEY.test(src), false, f + ": kunci penanda dibandingkan langsung — pakai TF.taskext.extOnlyNow");
    assert.equal(CMP_KEY_REV.test(src), false, f + ": kunci penanda dibandingkan langsung — pakai TF.taskext.extOnlyNow");
  }
  assert.ok(scanned > 80, "pemindai harus mencakup semua berkas offline + index.html (" + scanned + ")");
  // kontrol kepekaan: taskext.js memang membandingkan (jika tidak, pemindai ini buta)
  assert.equal(/rec\[EXT_ONLY_KEY\]\s*===/.test(readSource("static/offline/taskext.js")), true);
});

test("penulis yang menaikkan rev ada di daftar AUDIT dengan kategori 'rev+1'", () => {
  const found = scan();
  const revFiles = Object.keys(found).filter((k) => k.endsWith("|REV")).map((k) => k.split("|")[0]);
  assert.ok(revFiles.length >= 10, "pemindai penaik rev harus menemukan penulis (" + revFiles.length + ")");
  for (const f of revFiles) {
    const audited = AUDIT.filter((a) => a.file === f && a.pat === "REV");
    if (REV_NON_TASK[f] && !audited.length) continue; // berkas yang hanya menulis store lain
    assert.ok(audited.length > 0, f + ": penaik rev tanpa entri AUDIT");
    for (const a of audited) assert.equal(a.cat, "rev+1", f + ": entri REV harus berkategori rev+1");
  }
  // setiap berkas yang memanggil mutate/transaction task dengan kategori rev+1 punya penaik rev yang nyata
  for (const a of AUDIT.filter((x) => x.cat === "rev+1" && x.pat !== "REV")) {
    assert.ok(found[a.file + "|REV"] > 0, a.file + ": entri rev+1 tanpa penaik rev di sumber");
  }
});
