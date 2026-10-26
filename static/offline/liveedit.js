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

  // Kapan perubahan sebuah field disimpan (R1):
  //  - "now": langsung setelah onChange (pilihan diskret);
  //  - "idle": TEXT_IDLE_MS setelah perubahan terakhir, atau saat keluar field/flush;
  //  - "blur": hanya saat keluar field/flush (judul tidak boleh disimpan setengah jalan; progress = slider;
  //    nilai kosong project/context datang dari "+ Baru" dan tidak boleh menghapus nilai lama bila pengguna diam).
  function saveTrigger(field, value) {
    switch (field) {
      case "title":
      case "progress":
        return "blur";
      case "description":
      case "waiting_for":
        return "idle";
      case "project":
      case "context":
        return value == null || String(value).trim() === "" ? "blur" : "idle";
      default:
        return "now";
    }
  }

  // Data task baru dari luar (sync, modal): field yang tidak sedang diubah pengguna ikut data baru,
  // field yang dirty tetap; `saved` selalu data baru.
  function mergeExternal(state, incoming) {
    const saved = (state && state.saved) || {};
    const form = (state && state.form) || {};
    const nextSaved = formFromTask(incoming);
    const dirty = changedFields(saved, form);
    const nextForm = Object.assign({}, form);
    for (const k of EDITABLE_FIELDS) {
      if (dirty.indexOf(k) === -1) nextForm[k] = nextSaved[k];
    }
    return { form: nextForm, saved: nextSaved };
  }

  function validateTitle(title) {
    return String(title == null ? "" : title).trim() === "" ? TITLE_REQUIRED : null;
  }

  function isNotFound(err) {
    if (!err) return false;
    if (err.status === 404) return true;
    const msg = typeof err === "string" ? err : err.message;
    return /not found|tidak ditemukan/i.test(String(msg == null ? "" : msg));
  }

  // R9: menyimpan `title` membuat server dan store lokal MENGGANTI tag task dengan #tag yang di-parse dari judul,
  // sedangkan judul tersimpan tidak memuat #tag. Tag yang belum ada di judul ditambahkan di belakang supaya
  // simpan judul tidak menghapus tag.
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

  return {
    MIN_CONTENT_WIDTH, PANEL_RATIO, PANEL_MIN, PANEL_MAX, TEXT_IDLE_MS, STORAGE_KEY,
    EDITABLE_FIELDS, EMPTY_SELECTION,
    isAvailable, panelWidth, readOn, writeOn,
    taskRef, sameTask, findTask, pickInitial, selectionReducer,
    formFromTask, changedFields, buildPatch, saveTrigger, mergeExternal,
    validateTitle, isNotFound, titleWithTags,
  };
});
