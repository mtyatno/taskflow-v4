"use strict";
// Pagar penulis store `tasks` (spec plugin Fase 1 K25; rencana 1c-0 R9, ADR-043).
//
// Penanda ext saja (`ext_only_rev`) aman hanya bila SETIAP penulis yang mengubah field inti task membatalkannya
// (rev naik) atau memang tidak menyentuh field inti. Tes ini membaca teks sumber (tanpa IndexedDB) dan membekukan
// daftar penulis store `tasks` per (berkas, pola). Lokasi baru/berkurang → gagal: tinjau dampaknya ke penanda lalu
// perbarui AUDIT beserta alasannya. Komentar (baris dan blok, termasuk kode yang menyusul `/* … */` di baris yang
// sama) dibuang sebelum pemindaian. Kasus kontrol di bagian bawah membuktikan pemindai tidak buta terhadap kutip
// tunggal/backtick, nama store dari variabel, mode dari variabel, dan nama parameter pembantu generik.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..", "..", "static");
const OFFLINE = path.join(ROOT, "offline");

// ── pembuang komentar ────────────────────────────────────────────────────────────────────────────────────────
// Pemindai leksikal kecil: string ('', "", ``) dan literal regex dipertahankan apa adanya; komentar `/* */`
// (juga multibaris) dan `//` diganti spasi (baris baru dipertahankan). Kesalahan tafsir hanya bisa membuat teks
// komentar ikut terhitung (gagal keras), bukan membuang kode, karena string selalu dipertahankan.
function stripComments(src) {
  let out = "";
  let i = 0;
  const n = src.length;
  let prev = ""; // karakter bermakna terakhir (untuk membedakan `/` pembagi vs regex)
  const regexAllowed = () => prev === "" || "(,=:[!&|?{};+-*%<>~^".indexOf(prev) >= 0
    || /\b(return|typeof|case|in|of|delete|void|throw|new)$/.test(out.replace(/\s+$/, "").slice(-8));
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === "/" && d === "*") {
      const e = src.indexOf("*/", i + 2);
      const end = e < 0 ? n : e + 2;
      out += src.slice(i, end).replace(/[^\n]/g, " ");
      i = end;
      continue;
    }
    if (c === "/" && d === "/") {
      let e = src.indexOf("\n", i);
      if (e < 0) e = n;
      out += " ".repeat(e - i);
      i = e;
      continue;
    }
    if (c === "\"" || c === "'") {
      let j = i + 1;
      while (j < n && src[j] !== c && src[j] !== "\n") { if (src[j] === "\\") j++; j++; }
      j = Math.min(j + 1, n);
      out += src.slice(i, j);
      prev = c;
      i = j;
      continue;
    }
    if (c === "`") {
      let j = i + 1;
      while (j < n && src[j] !== "`") { if (src[j] === "\\") j++; j++; }
      j = Math.min(j + 1, n);
      out += src.slice(i, j);
      prev = c;
      i = j;
      continue;
    }
    if (c === "/" && regexAllowed()) {
      let j = i + 1;
      let cls = false;
      while (j < n && src[j] !== "\n") {
        if (src[j] === "\\") j++;
        else if (src[j] === "[") cls = true;
        else if (src[j] === "]") cls = false;
        else if (src[j] === "/" && !cls) break;
        j++;
      }
      if (src[j] === "/") {
        j++;
        while (/[a-z]/.test(src[j] || "")) j++;
        out += src.slice(i, j);
        prev = ")";
        i = j;
        continue;
      }
    }
    out += c;
    if (!/\s/.test(c)) prev = c;
    i++;
  }
  return out;
}

// ── pola penulis ─────────────────────────────────────────────────────────────────────────────────────────────
const Q = "[\"'`]"; // kutip ganda, tunggal, backtick
const NOT_RO = "(?!\\s*" + Q + "readonly" + Q + ")"; // mode apa pun selain literal "readonly" (termasuk variabel)
const WRITE_VERBS = "(?:[Pp]ut|[Dd]elete|[Ww]rite|[Ss]ave|[Pp]atch|[Uu]pdate|[Cc]lear|[Rr]emove|[Aa]dd|[Ss]et|[Aa]dopt|[Aa]pply|[Rr]ewrite)";
const PATTERNS = {
  // TFdb.mutate("tasks", …) / mutate('tasks', …) / mutate(`tasks`, …)
  P_MUTATE: new RegExp("\\bmutate\\(\\s*" + Q + "tasks" + Q, "g"),
  // transaction("tasks", <mode apa pun selain readonly>) — mode boleh variabel
  P_TX: new RegExp("transaction\\(\\s*" + Q + "tasks" + Q + "\\s*," + NOT_RO, "g"),
  // transaction([…"tasks"…], <mode apa pun selain readonly>)
  P_TX_MULTI: new RegExp("transaction\\(\\s*\\[[^\\]]*" + Q + "tasks" + Q + "[^\\]]*\\]\\s*," + NOT_RO, "g"),
  // transaction(<bukan literal string/array>, <mode apa pun selain readonly>): store dari variabel/parameter
  P_TX_DYN: new RegExp("transaction\\(\\s*(?!" + Q + "|\\[)[^,()]+," + NOT_RO, "g"),
  P_PUTIF: new RegExp("putIfUnchanged\\(\\s*" + Q + "tasks" + Q, "g"),
  P_MARK: new RegExp("markPushed\\(\\s*" + Q + "tasks" + Q, "g"),
  // penanda sync_error / conflict pada record task
  P_FAIL: new RegExp("(?:markSyncError|accessLost|failPermanent)\\(\\s*" + Q + "tasks" + Q, "g"),
  P_OP: new RegExp("(?:ensureEntityOp|requeueOp)\\(\\s*" + Q + "task" + Q + "|requeueIfDirty\\(\\s*" + Q + "tasks" + Q
    + "|entity_type:\\s*" + Q + "task" + Q, "g"),
  // pembantu generik dengan nama store dari variabel/parameter APA PUN (bukan hanya store/storeName)
  P_GENERIC: new RegExp("\\b(?:mutate|patchRec|putIfUnchanged|markPushed)\\(\\s*(?!" + Q + ")[A-Za-z_$]", "g"),
  // pembantu tulis apa pun yang dipanggil dengan literal "tasks" sebagai argumen pertama (put("tasks", r), cacheSet(…))
  P_HELPER: new RegExp("\\b(?!putIfUnchanged\\b|markPushed\\b|markSyncError\\b|accessLost\\b|failPermanent\\b|addEntityTags\\b)\\w*"
    + WRITE_VERBS + "\\w*\\(\\s*" + Q + "tasks" + Q, "g"),
};
// Penaik rev: pola dari brief + `rev: nextRev` (rewriteTaskExtRefs) + `next.rev = (cur.rev || 0) + 1` (syncconflict).
const REV_RE = /rev:\s*\(cur\.rev \|\| 0\) \+ 1|next\.rev = \(base\.rev|\brev:\s*nextRev\b|next\.rev = \(cur\.rev \|\| 0\) \+ 1/g;

function count(text, re) {
  const m = text.match(new RegExp(re.source, "g"));
  return m ? m.length : 0;
}
// Hitungan per pola atas teks sumber (komentar dibuang): { P_MUTATE: n, …, REV: n } (hanya yang > 0).
function scanText(text) {
  const src = stripComments(text);
  const out = {};
  for (const name of Object.keys(PATTERNS)) {
    const n = count(src, PATTERNS[name]);
    if (n) out[name] = n;
  }
  const rv = count(src, REV_RE);
  if (rv) out.REV = rv;
  return out;
}

function sourceFiles() {
  const names = fs.readdirSync(OFFLINE).filter((f) => f.endsWith(".js")).sort().map((f) => "static/offline/" + f);
  names.push("static/index.html");
  return names;
}
function readSource(rel) {
  return stripComments(fs.readFileSync(path.join(ROOT, "..", rel), "utf8"));
}
function scan() {
  const found = {};
  for (const f of sourceFiles()) {
    const r = scanText(fs.readFileSync(path.join(ROOT, "..", f), "utf8"));
    for (const k of Object.keys(r)) found[f + "|" + k] = r[k];
  }
  return found;
}

// ── AUDIT dibekukan: tabel R9 (rencana 1c-0) + pembantu generik/dinamis. `cat`: "rev+1" = menaikkan rev (penanda
// batal otomatis); "same-rev" = rev tetap tetapi tidak menyentuh field inti / menangani penanda secara eksplisit;
// "none" = bukan penulis record task (definisi, op outbox, store lain, cache). ─────────────────────────────────
const AUDIT = [
  { file: "static/index.html", pat: "P_HELPER", n: 4, cat: "none", reason: "cacheSet('tasks') = cache OfflineDB lama (DB terpisah, bukan store tasks TF) + setWorkspaceTab/setPage (state UI)" },
  { file: "static/index.html", pat: "P_MUTATE", n: 1, cat: "rev+1", reason: "applyMovedTasksLocal (pindah workspace): nilai server + rev+1 (R9, tanpa ubah index.html)" },
  { file: "static/index.html", pat: "P_TX_DYN", n: 1, cat: "none", reason: "OfflineDB.tr(store, mode): DB cache lama 'taskflow-offline', bukan IndexedDB TF" },
  { file: "static/index.html", pat: "REV", n: 2, tasks: 1, cat: "rev+1", reason: "applyMovedTasksLocal (task); 1 sisanya mindmap" },
  { file: "static/offline/checklist.js", pat: "P_MUTATE", n: 1, cat: "same-rev", reason: "adoptTaskProgress (checklist bertingkat, ADR-048): progress/checklist_total turunan server dari task_progress; rev, dirty, base_rev, updated_at, penanda tidak disentuh (pola adoptTaskDerived; server mengabaikan progress selama ada checklist, D3)" },
  { file: "static/offline/commentrepo.js", pat: "P_GENERIC", n: 2, cat: "none", reason: "mutate() lokal pembantu komentar (bukan TFdb.mutate; store komentar)" },
  { file: "static/offline/commentrepo.js", pat: "P_TX_DYN", n: 1, cat: "none", reason: "storeOp(store, mode): hanya store komentar (STORE) dan baca scratchpad_notes; tidak pernah tasks" },
  { file: "static/offline/db.js", pat: "P_GENERIC", n: 1, cat: "none", reason: "definisi TFdb.mutate generik (bukan penulis)" },
  { file: "static/offline/db.js", pat: "P_TX_DYN", n: 2, cat: "none", reason: "clearAll (logout: kosongkan semua store, tidak ada record tersisa) + isi TFdb.mutate (CAS generik; pemanggilnya diaudit per berkas)" },
  { file: "static/offline/habithydrate.js", pat: "P_TX_DYN", n: 1, cat: "none", reason: "put(store, rec): hanya 'habits' dan 'habit_logs' (literal di pemanggil)" },
  { file: "static/offline/hydrate.js", pat: "P_TX", n: 1, cat: "same-rev", reason: "hydrateTasks/putTask: record baru dari server (taskFromServer, tanpa penanda); R9 `hydrateTasks` tidak perlu" },
  { file: "static/offline/plugin_sync.js", pat: "P_TX_DYN", n: 1, cat: "none", reason: "runTx(stores, mode): hanya store plugin (plugin_records, _kv, _outbox); tidak pernah tasks" },
  { file: "static/offline/pluginstate.js", pat: "P_TX_DYN", n: 1, cat: "none", reason: "runTx(stores, mode): hanya _meta dan _outbox; tidak pernah tasks" },
  { file: "static/offline/pomolog.js", pat: "P_TX_MULTI", n: 1, cat: "same-rev", reason: "ackPushed: pomodoros_done milik server, rev/dirty/penanda tidak disentuh (R9 `pomolog.ackPushed`)" },
  { file: "static/offline/syncconflict.js", pat: "P_GENERIC", n: 6, cat: "same-rev", reason: "patchRec: definisi, retry (penanda dipertahankan, R10), discard_local (kunci dihapus, R10), keep_as_* (rev+1), hapus notice (bukan inti)" },
  { file: "static/offline/syncconflict.js", pat: "P_TX_DYN", n: 1, cat: "same-rev", reason: "deleteRaw(store, cid): menghapus record (discard / lokal tanpa server_id), tidak ada record yang tersisa untuk penanda" },
  { file: "static/offline/syncconflict.js", pat: "REV", n: 1, cat: "rev+1", reason: "keep_as_new/personal: entitas baru, rev+1 membatalkan penanda (R9)" },
  { file: "static/offline/syncpull.js", pat: "P_GENERIC", n: 3, cat: "same-rev", reason: "backfillClientIds (client_id bukan inti) + definisi putIfUnchanged generik dan isinya (CAS: tulis hanya bila rev/dirty/deleted sama)" },
  { file: "static/offline/syncpull.js", pat: "P_MUTATE", n: 2, cat: "same-rev", reason: "adoptTaskDerived (field turunan server, R9) + flag conflict remote_deleted (bukan inti)" },
  { file: "static/offline/syncpull.js", pat: "P_OP", n: 1, cat: "none", reason: "requeueOp('task') setelah R11 (op susulan untuk kunci ext_dirty)" },
  { file: "static/offline/syncpull.js", pat: "P_PUTIF", n: 2, cat: "same-rev", reason: "pull write/putIfUnchanged: record baru dari server (R7: tanpa penanda, atau ext saja lewat withLocalExt)" },
  { file: "static/offline/syncpull.js", pat: "P_TX", n: 2, cat: "none", reason: "helper putTask/deleteTask pull: nilai server / remote_deleted (R9 `deleteTask`/`remote_deleted` pull)" },
  { file: "static/offline/syncpush.js", pat: "P_FAIL", n: 4, cat: "same-rev", reason: "accessLost/failPermanent task (opUpdate dan opCreate): hanya sync_error/conflict; rev, dirty, penanda tidak berubah; Coba lagi mengirim ulang perubahan tertunda yang sama (R9, R10)" },
  { file: "static/offline/syncpush.js", pat: "P_GENERIC", n: 3, cat: "same-rev", reason: "freshRecreateClientId (client_id) + definisi markPushed generik dan isinya (CAS rev: adopt hanya bila rev sama)" },
  { file: "static/offline/syncpush.js", pat: "P_MARK", n: 2, cat: "same-rev", reason: "markPushed task (opUpdate ext saja + penuh): adopsi hanya bila rev sama / adoptAny hanya bila extOnlyNow (R5)" },
  { file: "static/offline/syncpush.js", pat: "P_MUTATE", n: 3, cat: "rev+1", reason: "rewriteTaskExtRefs (ext, rev+1, penanda via extOnlyNext; R6), flag conflict remote_deleted, rewriteTasksWithContextCid (adoptContextServerId rev+1 / releaseContextCid rev tetap, R9)" },
  { file: "static/offline/syncpush.js", pat: "P_OP", n: 4, cat: "none", reason: "ensureEntityOp (rewriteTaskExtRefs), requeueIfDirty x3 (setelah PUT dan adoptContextServerId)" },
  { file: "static/offline/syncpush.js", pat: "P_TX_DYN", n: 2, cat: "same-rev", reason: "markSyncError + accessLost (storeName): hanya sync_error/conflict pada record; rev dan penanda tidak berubah (R9 `opUpdate 404/403/4xx`)" },
  { file: "static/offline/syncpush.js", pat: "REV", n: 5, tasks: 2, cat: "rev+1", reason: "rewriteTaskExtRefs + adoptContextServerId (task); 3 sisanya note/mindmap (bukan store tasks)" },
  { file: "static/offline/taskrepo.js", pat: "P_MUTATE", n: 1, cat: "rev+1", reason: "updateTask lewat applyTaskPatch (R2: penanda via extOnlyNext atas record terkini)" },
  { file: "static/offline/taskrepo.js", pat: "P_OP", n: 4, cat: "none", reason: "outboxAdd create/update/delete + op update updateTaskExtMany (bentuk sama, transaksi tasks + _outbox; rencana 1c-1 R22)" },
  { file: "static/offline/taskrepo.js", pat: "P_TX", n: 1, cat: "rev+1", reason: "putRaw: createTask (rev 1, tanpa penanda) dan deleteTask (rev+1, kunci dihapus)" },
  { file: "static/offline/taskrepo.js", pat: "P_TX_MULTI", n: 1, cat: "rev+1", reason: "updateTaskExtMany (rencana 1c-1 R22): satu transaksi tasks + _outbox, setiap record lewat applyTaskPatch (rev+1, penanda via extOnlyNext atas record terkini)" },
  { file: "static/offline/taskrepo.js", pat: "REV", n: 1, cat: "rev+1", reason: "applyTaskPatch next.rev = (base.rev || 0) + 1 (dipakai updateTask dan updateTaskExtMany)" },
  { file: "static/offline/taskroutes.js", pat: "P_MUTATE", n: 1, cat: "rev+1", reason: "hapus tag (rute): record ext saja -> rev+1 (R8)" },
  { file: "static/offline/taskroutes.js", pat: "REV", n: 1, cat: "rev+1", reason: "hapus tag (rute) rev+1" },
];

// Penaik rev di berkas lain (bukan store `tasks`; dibekukan agar penulis task baru tidak menyelinap lewat pola yang sama).
const REV_NON_TASK = {
  "static/offline/drawingrepo.js": 3,
  "static/offline/drawingshare.js": 2,
  "static/offline/mindmaprepo.js": 7,
  "static/offline/noterepo.js": 4,
  "static/offline/syncpull.js": 2,
};

function expectedFromAudit() {
  const expected = {};
  for (const a of AUDIT) {
    assert.ok(a.reason && a.reason.length > 10, "entri AUDIT wajib beralasan: " + a.file + " " + a.pat);
    assert.ok(["rev+1", "same-rev", "none"].indexOf(a.cat) >= 0, "kategori AUDIT tidak dikenal: " + a.file + " " + a.pat);
    const k = a.file + "|" + a.pat;
    assert.equal(k in expected, false, "entri AUDIT ganda: " + k);
    expected[k] = a.n;
  }
  for (const f of Object.keys(REV_NON_TASK)) expected[f + "|REV"] = (expected[f + "|REV"] || 0) + REV_NON_TASK[f];
  return expected;
}
// Selisih found vs expected sebagai pesan gagal (kosong = persis sama).
function auditDiff(found, expected) {
  const msgs = [];
  const keys = new Set(Object.keys(found).concat(Object.keys(expected)));
  for (const k of Array.from(keys).sort()) {
    const [file, pat] = k.split("|");
    if ((found[k] || 0) !== (expected[k] || 0)) {
      msgs.push("penulis store tasks berubah di " + file + " (" + pat + ": ditemukan " + (found[k] || 0) + ", AUDIT "
        + (expected[k] || 0) + "): tinjau ext_only_rev (R9, ADR-043) lalu perbarui AUDIT");
    }
  }
  return msgs;
}

if (process.env.FENCE_DUMP) console.log("FENCE_DUMP " + JSON.stringify(scan(), null, 1));

test("daftar penulis store tasks persis tabel audit R9", () => {
  assert.deepEqual(auditDiff(scan(), expectedFromAudit()), []);
});

// ── aturan penanda ───────────────────────────────────────────────────────────────────────────────────────────
// Di luar taskext.js (setelah komentar dibuang): literal `ext_only_rev` tidak boleh muncul sama sekali; kunci
// penanda (`EXT_ONLY_KEY` atau alias `const K = …EXT_ONLY_KEY`) hanya boleh dipakai sebagai nama properti pada
// `delete x[K]` atau `x[K] = …`; membaca (`x[K]` di sisi mana pun dari pembanding, kebenaran/truthiness, `K in x`,
// hasOwnProperty) dilarang — pembacaan hanya lewat TF.taskext.extOnlyNow.
function markerViolations(text) {
  const src = stripComments(text);
  const v = [];
  if (/ext_only_rev/.test(src)) v.push("literal ext_only_rev");
  const aliases = [];
  const aliasRe = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=[^;\n]*EXT_ONLY_KEY/g;
  let m;
  while ((m = aliasRe.exec(src))) aliases.push(m[1]);
  const keyExpr = "(?:[\\w$]+\\.)*EXT_ONLY_KEY" + aliases.map((a) => "|" + a.replace(/\$/g, "\\$")).join("");
  const bracket = new RegExp("\\[\\s*(" + keyExpr + ")\\s*\\]", "g");
  while ((m = bracket.exec(src))) {
    const before = src.slice(0, m.index);
    const after = src.slice(m.index + m[0].length);
    const isDelete = /\bdelete\s+[\w$.]+$/.test(before);
    const isAssign = /^\s*=(?!=)/.test(after);
    if (!isDelete && !isAssign) v.push("pembacaan kunci penanda: " + (before.slice(-24) + m[0] + after.slice(0, 12)).replace(/\s+/g, " "));
  }
  if (new RegExp("(?:" + keyExpr + ")\\s+in\\b").test(src)) v.push("K in x");
  if (new RegExp("hasOwnProperty(?:\\.call)?\\([^)]*(?:" + keyExpr + ")\\s*\\)").test(src)) v.push("hasOwnProperty(K)");
  if (/\.\s*ext_only_rev\b/.test(src)) v.push("properti .ext_only_rev");
  return v;
}

test("ext_only_rev tidak muncul di luar taskext.js; EXT_ONLY_KEY hanya dalam bentuk delete x[K] / x[K] = …", () => {
  let scanned = 0;
  for (const f of sourceFiles()) {
    if (f === "static/offline/taskext.js") continue;
    scanned++;
    const raw = fs.readFileSync(path.join(ROOT, "..", f), "utf8");
    assert.deepEqual(markerViolations(raw), [], f + ": penanda hanya boleh dibaca lewat TF.taskext.extOnlyNow");
  }
  assert.ok(scanned > 80, "pemindai harus mencakup semua berkas offline + index.html (" + scanned + ")");
  // kontrol kepekaan: taskext.js memang membaca/membandingkan penanda (jika tidak, pemindai ini buta)
  assert.ok(markerViolations(fs.readFileSync(path.join(OFFLINE, "taskext.js"), "utf8")).length > 0);
  assert.equal(/rec\[EXT_ONLY_KEY\]\s*===/.test(readSource("static/offline/taskext.js")), true);
});

test("kontrol aturan penanda: bentuk yang melanggar HARUS terdeteksi, bentuk yang sah tidak", () => {
  const bad = {
    "pembanding sisi kanan": "const KEY = X.EXT_ONLY_KEY;\nif (3 === rec[KEY]) {}",
    "pembanding sisi kiri": "if (rec[X.EXT_ONLY_KEY] === rec.rev) {}",
    "kunci string literal": "rec['ext_only_rev'] = 1;",
    "kunci string literal ganda": "if (rec[\"ext_only_rev\"]) {}",
    "template literal": "const k = `ext_only_rev`;",
    "kebenaran (truthiness)": "if (rec[X.EXT_ONLY_KEY]) { go(); }",
    "kebenaran lewat alias": "const K = TFtaskext.EXT_ONLY_KEY;\nconst on = !!cur[K];",
    "kebenaran ternary": "const a = cur[X.EXT_ONLY_KEY] ? 1 : 2;",
    "ekspresi (cur || {})[K]": "const K = X.EXT_ONLY_KEY; const v = (cur || {})[K];",
    "K in x": "const K = X.EXT_ONLY_KEY;\nif (K in rec) {}",
    "hasOwnProperty": "if (Object.prototype.hasOwnProperty.call(rec, X.EXT_ONLY_KEY)) {}",
    "properti langsung": "if (rec.ext_only_rev) {}",
    "kode setelah komentar blok": "/* c */ if (rec[X.EXT_ONLY_KEY]) {}",
  };
  for (const label of Object.keys(bad)) {
    assert.ok(markerViolations(bad[label]).length > 0, "harus terdeteksi: " + label);
  }
  const good = [
    "const KEY = X.EXT_ONLY_KEY;\nif (KEY) delete next[KEY];\nnext[KEY] = mark;",
    "if (X && X.EXT_ONLY_KEY) delete next[X.EXT_ONLY_KEY];",
    "if (mark === undefined) delete next[X.EXT_ONLY_KEY]; else next[X.EXT_ONLY_KEY] = mark;",
    "// rec.ext_only_rev === 3 hanya komentar\n/* rec['ext_only_rev'] */ const ok = 1;",
  ];
  for (const g of good) assert.deepEqual(markerViolations(g), [], "tidak boleh terdeteksi: " + g);
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
  // setiap entri kategori rev+1 punya penaik rev yang nyata di sumbernya
  for (const a of AUDIT.filter((x) => x.cat === "rev+1" && x.pat !== "REV")) {
    assert.ok(found[a.file + "|REV"] > 0, a.file + ": entri rev+1 tanpa penaik rev di sumber");
  }
});

// ── kasus kontrol pemindai penulis ───────────────────────────────────────────────────────────────────────────
test("kontrol pemindai: kutip tunggal/backtick, store dan mode dari variabel, parameter generik, kode setelah /* */ HARUS terdeteksi", () => {
  const cases = [
    ["transaction kutip tunggal", "db.transaction('tasks', 'readwrite')", "P_TX"],
    ["transaction backtick", "db.transaction(`tasks`, `readwrite`)", "P_TX"],
    ["transaction mode variabel", "db.transaction(\"tasks\", mode)", "P_TX"],
    ["transaction array kutip tunggal", "db.transaction(['_outbox', 'tasks'], 'readwrite')", "P_TX_MULTI"],
    ["transaction array mode variabel", "db.transaction([\"tasks\", \"_outbox\"], m)", "P_TX_MULTI"],
    ["transaction store variabel", "const S = 'tasks';\nconst tx = db.transaction(S, 'readwrite');", "P_TX_DYN"],
    ["transaction store dan mode variabel", "d.transaction(stores, mode)", "P_TX_DYN"],
    ["transaction array variabel", "d.transaction(names, \"readwrite\")", "P_TX_DYN"],
    ["mutate kutip tunggal", "TFdb.mutate('tasks', cid, (cur) => cur)", "P_MUTATE"],
    ["mutate backtick", "TFdb.mutate(`tasks`, cid, (cur) => cur)", "P_MUTATE"],
    ["mutate nama parameter lain", "TFdb.mutate(entityStore, cid, (cur) => cur)", "P_GENERIC"],
    ["mutate ekspresi", "TFdb.mutate(STORE[entity], cid, (cur) => cur)", "P_GENERIC"],
    ["putIfUnchanged parameter lain", "putIfUnchanged(st, rec, local)", "P_GENERIC"],
    ["putIfUnchanged kutip tunggal", "putIfUnchanged('tasks', rec, local)", "P_PUTIF"],
    ["markPushed kutip tunggal", "markPushed('tasks', cid, 1, 'x', null, fn)", "P_MARK"],
    ["markPushed parameter lain", "markPushed(s, cid, 1, 'x', null, fn)", "P_GENERIC"],
    ["accessLost kutip tunggal", "return accessLost('tasks', op.cid, op, result);", "P_FAIL"],
    ["failPermanent backtick", "return failPermanent(`tasks`, op.cid, res, op, result);", "P_FAIL"],
    ["pembantu put dengan literal", "putAny('tasks', rec)", "P_HELPER"],
    ["cacheSet kutip tunggal", "await OfflineDB.cacheSet('tasks', updated);", "P_HELPER"],
    ["op outbox kutip tunggal", "outboxAdd({ op: 'update', entity_type: 'task', cid })", "P_OP"],
    ["kode setelah komentar blok", "const a = 1; /* komentar */ TFdb.mutate('tasks', c, f);", "P_MUTATE"],
    ["kode setelah komentar blok multibaris", "/* a\n b */ db.transaction('tasks', 'readwrite');", "P_TX"],
    ["kode setelah // di baris berikut", "// c\ndb.transaction('tasks', 'readwrite');", "P_TX"],
    ["penaik rev", "return Object.assign({}, cur, { rev: (cur.rev || 0) + 1 });", "REV"],
  ];
  for (const [label, src, pat] of cases) {
    const r = scanText(src);
    assert.ok(r[pat] >= 1, "harus terdeteksi (" + pat + "): " + label + " → " + JSON.stringify(r));
  }
  // bukan penulis / komentar: tidak boleh terhitung
  const none = [
    "db.transaction('tasks', 'readonly')",
    "db.transaction(\"tasks\")",
    "db.transaction(store, \"readonly\")",
    "// db.transaction('tasks', 'readwrite')",
    "/* TFdb.mutate('tasks', c, f) */",
    "/* a\n TFdb.mutate('tasks', c, f)\n */",
    "const re = /\\/\\*/; const x = 1;",
  ];
  for (const src of none) {
    const r = scanText(src);
    for (const pat of ["P_TX", "P_TX_DYN", "P_MUTATE"]) assert.equal(r[pat] || 0, 0, "tidak boleh terhitung: " + src);
  }
});

test("kontrol pagar: penulis baru (kutip tunggal / store variabel) di berkas mana pun menggagalkan perbandingan AUDIT", () => {
  const expected = expectedFromAudit();
  const base = scan();
  assert.deepEqual(auditDiff(base, expected), []);
  const injected = {
    "kutip tunggal": "function w(db) { return db.transaction('tasks', 'readwrite'); }",
    "store variabel": "function w(db, s) { return db.transaction(s, 'readwrite'); }",
    "mode variabel": "function w(db, m) { return db.transaction('tasks', m); }",
    "mutate kutip tunggal": "TFdb.mutate('tasks', c, f);",
    "mutate parameter lain": "TFdb.mutate(entityStore, c, f);",
  };
  for (const label of Object.keys(injected)) {
    const file = "static/offline/berkas_baru.js";
    const found = Object.assign({}, base);
    const r = scanText(injected[label]);
    assert.ok(Object.keys(r).length > 0, "pemindai harus menemukan: " + label);
    for (const k of Object.keys(r)) found[file + "|" + k] = r[k];
    const diff = auditDiff(found, expected);
    assert.ok(diff.length > 0, "perbandingan AUDIT harus gagal: " + label);
    assert.match(diff[0], /penulis store tasks berubah di static\/offline\/berkas_baru\.js/);
    assert.match(diff[0], /tinjau ext_only_rev \(R9, ADR-043\) lalu perbarui AUDIT/);
  }
  // lokasi berkurang juga gagal
  const fewer = Object.assign({}, base);
  const someKey = Object.keys(fewer).find((k) => k.endsWith("|P_MUTATE"));
  fewer[someKey] -= 1;
  assert.ok(auditDiff(fewer, expected).length > 0);
});
