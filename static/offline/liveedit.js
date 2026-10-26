;(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory(root);
  } else {
    root.TF = root.TF || {};
    root.TF.liveedit = factory(root);
  }
})(typeof self !== "undefined" ? self : globalThis, function (root) {
  "use strict";

  // Live Edit: panel detail task di samping daftar (spec docs/superpowers/specs/2026-10-26-live-edit-design.md §5.5).
  // Modul murni: ketersediaan panel, pilihan task, bentuk form, dan aturan simpan. Tanpa DOM/React.

  const MIN_CONTENT_WIDTH = 760;
  const PANEL_RATIO = 0.5;
  const PANEL_MIN = 420;
  const PANEL_MAX = 680;
  const TEXT_IDLE_MS = 1500;
  const STORAGE_KEY = "tf_liveedit";

  const EDITABLE_FIELDS = Object.freeze([
    "title", "description", "priority", "gtd_status", "project", "context",
    "deadline", "waiting_for", "assigned_to", "progress",
  ]);
  const EMPTY_SELECTION = Object.freeze({ ref: null, snapshot: null, cleared: false });

  const TITLE_REQUIRED = "Judul tidak boleh kosong";
  // Sama dengan regex #tag di webapp.py dan tagrepo.js: karakter tag = [a-zA-Z0-9_À-ɏ].
  const TAG_CHARS = "A-Za-z0-9_\\u00C0-\\u024F";

  // ---- ketersediaan & lebar ----
  function isAvailable(width) {
    return typeof width === "number" && width >= MIN_CONTENT_WIDTH;
  }

  function panelWidth(width) {
    const w = Math.round((Number(width) || 0) * PANEL_RATIO);
    return Math.min(PANEL_MAX, Math.max(PANEL_MIN, w));
  }

  // ---- preferensi nyala/mati ----
  function readOn(storage) {
    try {
      return storage.getItem(STORAGE_KEY) === "1";
    } catch (_) {
      return false;
    }
  }

  function writeOn(storage, on) {
    try { storage.setItem(STORAGE_KEY, on ? "1" : "0"); } catch (_) { /* abaikan */ }
  }

  // ---- identitas task ----
  // Id dibandingkan sebagai string; task bisa berganti id dari cid ke id server, jadi cid ikut dicocokkan.
  function taskRef(task) {
    if (!task) return null;
    const cid = task.cid != null && task.cid !== "" ? String(task.cid) : null;
    const id = task.id != null && task.id !== "" ? String(task.id) : cid;
    if (id == null) return null;
    return { id, cid };
  }

  function sameTask(task, ref) {
    if (!task || !ref) return false;
    if (task.id != null && String(task.id) === ref.id) return true;
    if (ref.cid && task.cid != null && String(task.cid) === ref.cid) return true;
    return task.server_id != null && String(task.server_id) === ref.id;
  }

  function findTask(tasks, ref) {
    if (!Array.isArray(tasks) || !ref) return null;
    for (const t of tasks) if (sameTask(t, ref)) return t;
    return null;
  }

  // keep = pilihan sekarang dipertahankan bila masih ada di allTasks (halaman sama); selain itu task pertama yang tampil.
  function pickInitial(visible, all, ref, keep) {
    if (keep && ref && findTask(all, ref)) return ref;
    return taskRef(Array.isArray(visible) && visible.length ? visible[0] : null);
  }

  function sameRef(a, b) {
    return !!a && !!b && a.id === b.id && a.cid === b.cid;
  }

  function selectionReducer(sel, action) {
    const act = action || {};
    switch (act.type) {
      case "select": {
        const ref = taskRef(act.task);
        return ref ? { ref, snapshot: act.task, cleared: false } : sel;
      }
      case "init": {
        // Setelah Hapus, "Pilih task di daftar" bertahan sampai pemilihan eksplisit.
        if (act.keep && sel.cleared) return sel;
        const picked = pickInitial(act.visible, act.all, sel.ref, act.keep);
        if (!picked) return EMPTY_SELECTION;
        if (sameRef(picked, sel.ref)) return sel;
        const task = findTask(act.all, picked) || findTask(act.visible, picked);
        return { ref: picked, snapshot: task, cleared: false };
      }
      case "deleted":
        return { ref: null, snapshot: null, cleared: true };
      case "snapshot":
        return sameTask(act.task, sel.ref) ? { ref: sel.ref, snapshot: act.task, cleared: sel.cleared } : sel;
      default:
        return sel;
    }
  }

  // ---- form ----
  // Default sama dengan form di modal detail task.
  function formFromTask(task) {
    const t = task || {};
    return {
      title: t.title || "",
      description: t.description || "",
      priority: t.priority || "P3",
      gtd_status: t.gtd_status || "inbox",
      project: t.project || "",
      context: t.context || "",
      deadline: t.deadline || "",
      waiting_for: t.waiting_for || "",
      assigned_to: t.assigned_to || null,
      progress: t.progress || 0,
    };
  }

  function assigneeValue(v) {
    return v == null || v === "" ? 0 : Number(v) || 0;
  }

  function progressValue(v) {
    return Number(v) || 0;
  }

  function fieldChanged(field, a, b) {
    switch (field) {
      case "title": return String(a == null ? "" : a).trim() !== String(b == null ? "" : b).trim();
      case "assigned_to": return assigneeValue(a) !== assigneeValue(b);
      case "progress": return progressValue(a) !== progressValue(b);
      default: return String(a == null ? "" : a) !== String(b == null ? "" : b);
    }
  }

  function changedFields(saved, form) {
    const s = saved || {};
    const f = form || {};
    return EDITABLE_FIELDS.filter(k => fieldChanged(k, s[k], f[k]));
  }

  function buildPatch(form, fields) {
    const f = form || {};
    const want = Array.isArray(fields) ? fields : [];
    const patch = {};
    for (const k of EDITABLE_FIELDS) {
      if (want.indexOf(k) === -1) continue;
      const v = f[k];
      if (k === "title") patch[k] = String(v == null ? "" : v).trim();
      else if (k === "assigned_to") patch[k] = assigneeValue(v);
      else if (k === "progress") patch[k] = progressValue(v);
      else patch[k] = v == null ? "" : v;
    }
    return patch;
  }

  // Kapan perubahan sebuah field disimpan (R1, R19):
  //  - "now": langsung setelah onChange (pilihan diskret);
  //  - "idle": TEXT_IDLE_MS setelah perubahan terakhir, atau saat keluar field/flush;
  //  - "blur": hanya saat keluar field/Enter/flush (commit eksplisit). Judul tidak boleh disimpan setengah jalan;
  //    progress = slider; project/context (R19): ComboSelect memanggil onChange di setiap ketikan nama baru dan
  //    server membuat setiap nama yang belum ada (project / tahap Kanban), jadi nama setengah jadi ("Mark" sebelum
  //    "Marketing") tidak boleh tersimpan karena diam; "" dari "+ Baru" tidak boleh menghapus nilai lama.
  //    Memilih opsi yang sudah ada disimpan langsung oleh panel lewat commit (bukan lewat pemicu ini).
  function saveTrigger(field, _value) {
    switch (field) {
      case "title":
      case "progress":
      case "project":
      case "context":
        return "blur";
      case "description":
      case "waiting_for":
        return "idle";
      default:
        return "now";
    }
  }

  // Data task baru dari luar (sync, modal): field yang tidak sedang diubah pengguna ikut data baru,
  // field yang dirty tetap; `saved` selalu data baru. Dirty = perbandingan mentah (form[k] !== saved[k], spec §5.5),
  // BUKAN changedFields: judul dibanding setelah trim di jalur simpan, tetapi di sini spasi ujung yang sedang
  // diketik ("Rapat ") harus bertahan agar kata berikutnya tidak menempel ("Rapatbesok").
  function mergeExternal(state, incoming) {
    const saved = (state && state.saved) || {};
    const form = (state && state.form) || {};
    const nextSaved = formFromTask(incoming);
    const nextForm = Object.assign({}, form);
    for (const k of EDITABLE_FIELDS) {
      if (form[k] === saved[k]) nextForm[k] = nextSaved[k];
    }
    return { form: nextForm, saved: nextSaved };
  }

  // Judul wajib punya teks selain #tag: server membuang #tag dari judul (regex yang sama dengan TAG_CHARS) dan
  // menolak hasil yang kosong, jadi "#x" atau "  #a #b " ditolak di klien tanpa memanggil put.
  function validateTitle(title) {
    const text = String(title == null ? "" : title).replace(new RegExp("#[" + TAG_CHARS + "]+", "g"), "");
    return text.trim() === "" ? TITLE_REQUIRED : null;
  }

  function isNotFound(err) {
    if (!err) return false;
    if (err.status === 404) return true;
    const msg = typeof err === "string" ? err : err.message;
    return /not found|tidak ditemukan/i.test(String(msg == null ? "" : msg));
  }

  // R9: judul tersimpan tidak memuat #tag. Store lokal MENAMBAH #tag yang di-parse dari judul ke tag task (ADR-032),
  // tetapi server MENGGANTI tag task dengan #tag di judul yang di-push. Tag yang belum ada di judul ditambahkan di
  // belakang supaya simpan judul membawa himpunan tag lengkap; daftar tag harus segar (R21), karena daftar basi akan
  // menambahkan kembali tag yang sudah dihapus di tempat lain.
  function titleHasTag(title, name) {
    const esc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp("#" + esc + "(?![" + TAG_CHARS + "])", "i").test(title);
  }

  function titleWithTags(title, tags) {
    let out = String(title == null ? "" : title).trim();
    const list = Array.isArray(tags) ? tags : [];
    for (const t of list) {
      const raw = t && typeof t === "object" ? t.name : t;
      const name = raw == null ? "" : String(raw).trim();
      if (!name || titleHasTag(out, name)) continue;
      out = out ? out + " #" + name : "#" + name;
    }
    return out;
  }

  // ---- pengendali autosave (R2) ----
  // Orkestrasi simpan otomatis tanpa React/DOM: timer idle (satu, dibagi semua field idle), satu simpan berjalan
  // dengan satu simpan tertunda, flush, retry, dan gabung perubahan luar. `put(patch)` milik pemanggil (URL/id,
  // titleWithTags, router lokal); hasilnya row server/lokal atau undefined.
  //
  // Simpan "eksplisit" (commit, flush, retry) mengirim semua field yang berubah. Simpan non-eksplisit (pilihan "now"
  // dan timer idle) membuang field yang pemicunya "blur" (R1/R11/R19): judul dan progress yang masih diketik/digeser,
  // serta project/context (nama yang sedang diketik atau "" dari "+ Baru"). Permintaan yang antre ikut eksplisit bila
  // salah satunya eksplisit.
  function errorMessage(err) {
    if (err == null) return "Gagal menyimpan";
    if (typeof err === "string") return err || "Gagal menyimpan";
    return err.message ? String(err.message) : "Gagal menyimpan";
  }

  function createAutosaver(opts) {
    const o = opts || {};
    const put = o.put;
    const onChange = typeof o.onChange === "function" ? o.onChange : function () {};
    const idleMs = o.idleMs == null ? TEXT_IDLE_MS : o.idleMs;
    const setTimer = typeof o.setTimer === "function" ? o.setTimer : function (fn, ms) { return setTimeout(fn, ms); };
    const clearTimer = typeof o.clearTimer === "function" ? o.clearTimer : function (h) { clearTimeout(h); };

    let form = formFromTask(o.task);
    let saved = formFromTask(o.task);
    let saveState = "idle";
    let error = null;
    let titleError = null;
    let timer = null;
    let running = null; // promise gelung simpan yang sedang berjalan
    let pending = false; // ada permintaan simpan saat running: dijalankan sekali setelah selesai
    let pendingExplicit = false; // salah satu permintaan yang antre eksplisit
    let disposed = false;
    let frozen = null; // state saat dispose: setelah itu pengamat tidak melihat perubahan apa pun

    function current() {
      return { form: Object.assign({}, form), saved: Object.assign({}, saved), saveState, error, titleError };
    }

    function snapshot() {
      const s = frozen || current();
      return { form: Object.assign({}, s.form), saved: Object.assign({}, s.saved), saveState: s.saveState, error: s.error, titleError: s.titleError };
    }

    function emit() {
      if (!disposed) onChange(snapshot());
    }

    function cancelTimer() {
      if (timer == null) return;
      const h = timer;
      timer = null;
      clearTimer(h);
    }

    // Satu putaran simpan. Mengembalikan false bila gagal.
    // Setelah dispose putaran yang antre tetap berjalan (R12), tetapi emit() diam dan getState() beku.
    async function saveOnce(explicit) {
      const dirty = changedFields(saved, form);
      let fields = explicit ? dirty : dirty.filter(function (f) { return saveTrigger(f, form[f]) !== "blur"; });
      let nextTitleError = titleError;
      if (dirty.indexOf("title") === -1) {
        nextTitleError = null;
      } else if (explicit) {
        nextTitleError = validateTitle(form.title);
        if (nextTitleError) fields = fields.filter(function (f) { return f !== "title"; });
      }
      let changed = nextTitleError !== titleError;
      titleError = nextTitleError;
      if (!fields.length) {
        // Tidak ada yang dikirim: error lama sudah basi bila pengguna yang meminta (retry/flush/commit) atau
        // tidak ada lagi field yang berubah. Simpan non-eksplisit yang hanya membuang field "blur" membiarkannya.
        if (saveState === "error" && (explicit || !dirty.length)) {
          saveState = "idle";
          error = null;
          changed = true;
        }
        if (changed) emit();
        return true;
      }

      const patch = buildPatch(form, fields);
      const sent = {};
      for (const f of fields) sent[f] = form[f];
      saveState = "saving";
      error = null;
      emit();

      let row;
      try {
        row = await put(patch);
      } catch (err) {
        saveState = "error";
        error = errorMessage(err);
        emit();
        return false;
      }

      // `form`/`saved` bisa sudah diganti oleh external() selama put berjalan, jadi dibaca ulang di sini.
      const titleUntouched = fields.indexOf("title") !== -1 && form.title === sent.title;
      for (const f of fields) {
        saved[f] = patch[f];
        // R10: field yang belum diketik ulang sejak dikirim ikut nilai tersimpan (judul ber-trim, assigned_to 0).
        if (form[f] === sent[f]) form[f] = saved[f];
      }
      // Judul dari server/store bisa berbeda dari yang dikirim (#tag dibuang); ikuti bila belum diubah lagi.
      if (titleUntouched && row && row.title) {
        saved.title = row.title;
        form.title = row.title;
      }
      saveState = "saved";
      error = null;
      emit();
      return true;
    }

    // Satu gelung: simpan, lalu sekali lagi bila ada permintaan masuk saat berjalan. Setelah put gagal hanya
    // permintaan eksplisit yang tetap dicoba; yang non-eksplisit (pilihan, timer idle) dibuang dan pengguna memakai retry.
    async function drain(first) {
      let explicit = first;
      try {
        for (;;) {
          pending = false;
          pendingExplicit = false;
          const ok = await saveOnce(explicit);
          if (!pending) break;
          if (!ok && !pendingExplicit) break;
          explicit = pendingExplicit;
        }
      } finally {
        // Tanpa await antara pemeriksaan `pending` dan baris ini, jadi tidak ada permintaan yang hilang.
        running = null;
        pending = false;
        pendingExplicit = false;
      }
    }

    function save(explicit) {
      if (disposed) return Promise.resolve();
      if (running) {
        pending = true;
        pendingExplicit = pendingExplicit || !!explicit;
        return running;
      }
      running = drain(!!explicit);
      return running;
    }

    function saveSilently(explicit) {
      save(explicit).catch(function () { /* hasil simpan sudah tercermin di state */ });
    }

    function change(field, value) {
      if (disposed) return;
      form[field] = value;
      emit();
      const trigger = saveTrigger(field, value);
      if (trigger === "now") {
        saveSilently(false);
      } else if (trigger === "idle") {
        cancelTimer();
        timer = setTimer(function () {
          timer = null;
          if (!disposed) saveSilently(false);
        }, idleMs);
      }
    }

    function commit(_field) {
      if (disposed) return;
      cancelTimer();
      saveSilently(true);
    }

    function flush() {
      if (disposed) return Promise.resolve();
      cancelTimer();
      return save(true);
    }

    function retry() {
      return save(true);
    }

    function revertTitle() {
      if (disposed) return;
      form.title = saved.title;
      titleError = null;
      emit();
    }

    function external(task) {
      if (disposed) return;
      const merged = mergeExternal({ form, saved }, task);
      form = merged.form;
      saved = merged.saved;
      emit();
    }

    // Cleanup unmount (`flush(); dispose()`): timer dibatalkan dan hasil put tidak lagi terlihat (tanpa onChange,
    // getState beku). Simpan yang sudah diantre lewat flush/commit/retry tetap dikirim (R12); antrean non-eksplisit dibuang.
    function dispose() {
      if (disposed) return;
      frozen = current();
      disposed = true;
      if (!pendingExplicit) pending = false;
      cancelTimer();
    }

    return { getState: snapshot, change, commit, revertTitle, external, flush, retry, dispose };
  }

  return {
    MIN_CONTENT_WIDTH, PANEL_RATIO, PANEL_MIN, PANEL_MAX, TEXT_IDLE_MS, STORAGE_KEY,
    EDITABLE_FIELDS, EMPTY_SELECTION,
    isAvailable, panelWidth, readOn, writeOn,
    taskRef, sameTask, findTask, pickInitial, selectionReducer,
    formFromTask, changedFields, buildPatch, saveTrigger, mergeExternal,
    validateTitle, isNotFound, titleWithTags, createAutosaver,
  };
});
