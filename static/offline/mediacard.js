;(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(root, function () { return require("./safehtml.js"); });
  } else {
    root.TF = root.TF || {};
    root.TF.mediacard = factory(root, function () { return root.TF.safehtml; });
  }
})(typeof self !== "undefined" ? self : globalThis, function (root, getSafe) {
  "use strict";

  // Model tampilan + HTML kartu media note. Murni (tanpa DOM, tanpa jaringan).
  // Pemanggil (hidrasi mode baca/editor) memanggil viewFor(...) lalu cardHtml(view), dan membuat
  // elemen <video>/<audio> sendiri lewat DOM API memakai playerAttrs(view) — cardHtml TIDAK pernah
  // mengeluarkan <video>/<audio>/<script>/<iframe>, hanya slot [data-media-player].
  //
  // Field URL di view (src, poster, downloadUrl) diisi MENTAH (relatif, mis. "/media/<token>") dari meta.
  // Pemanggil wajib membungkusnya dengan apiUrl() — untuk downloadUrl sebelum cardHtml, untuk src/poster
  // sebelum dipasang ke elemen. TF.safehtml di-resolve saat dipanggil (urutan <script> tidak penting).

  function safe() { return getSafe() || {}; }
  function esc(s) { return safe().escapeHtml(s == null ? "" : String(s)); }
  function escA(s) { return safe().escapeAttr(s == null ? "" : String(s)); }

  var ACTIVE = { uploading: 1, waiting: 1, completing: 1 };

  // Sama dengan server media_probe.format_duration: m:ss, h:mm:ss bila >= 1 jam, '' bila tak diketahui/0.
  function formatDuration(ms) {
    var n = Number(ms);
    if (!isFinite(n) || n <= 0) return "";
    var total = Math.floor(n / 1000);
    var h = Math.floor(total / 3600);
    var m = Math.floor((total % 3600) / 60);
    var s = total % 60;
    var ss = (s < 10 ? "0" : "") + s;
    if (h > 0) return h + ":" + (m < 10 ? "0" : "") + m + ":" + ss;
    return m + ":" + ss;
  }

  function percent(upload, meta) {
    var size = Number(upload && upload.size) || Number(meta && meta.file_size) || 0;
    var sent = Number(upload && upload.sent) || 0;
    if (size <= 0) return 0;
    return Math.max(0, Math.min(100, Math.floor((sent / size) * 100)));
  }

  function viewFor(o) {
    o = o || {};
    var meta = o.meta || null;
    var upload = o.upload || null;
    var uid = o.uid;
    var own = !!(meta && uid != null && meta.uploaded_by === uid);
    var activeLocal = !!(upload && ACTIVE[upload.phase]);
    var v = {
      state: "loading",
      name: (meta && meta.original_name) || o.nameAttr || "Media",
      kind: (meta && (meta.media_type === "audio" || meta.media_type === "video")) ? meta.media_type : null,
      durationText: meta ? formatDuration(meta.duration_ms) : "",
      progress: 0,
      uploaderName: (meta && meta.uploaded_by_name) || "",
      error: "",
      canDelete: !!(meta && ((uid != null && meta.uploaded_by === uid) || (uid != null && uid === o.noteOwnerId))),
      canCancel: false,
      warnFormat: false,
      src: (meta && meta.play_url) || "",
      poster: (meta && meta.poster_url) || "",
      mime: (meta && meta.mime_type) || "",
      downloadUrl: (meta && meta.download_url) || "",
    };

    if (o.httpStatus === 404) { v.state = "missing"; v.canDelete = false; return v; }
    if (!meta) { v.state = o.online === false ? "offline" : "loading"; return v; }
    if (o.online === false && !activeLocal) { v.state = "offline"; return v; }

    if (meta.status === "uploading") {
      if (activeLocal) {
        v.state = "uploading-local";
        v.progress = percent(upload, meta);
        v.canCancel = true;
      } else if (upload && upload.phase === "failed" && upload.retryable) {
        v.state = "uploading-stalled";
        v.error = upload.error || "";
        v.canCancel = true;
      } else if (upload && upload.phase === "failed") {
        v.state = "failed";
        v.error = upload.error || "";
      } else if (own) {
        v.state = "uploading-stalled";
        v.canCancel = true;
      } else {
        v.state = "uploading-other";
      }
    } else if (meta.status === "processing") {
      v.state = "processing";
    } else if (meta.status === "ready") {
      v.state = "ready";
      v.warnFormat = typeof o.canPlay === "function" ? o.canPlay(meta.mime_type) === "" : false;
    } else if (meta.status === "failed") {
      v.state = "failed";
      v.error = meta.error || "";
    }
    return v;
  }

  function btn(action, label) {
    return '<button type="button" class="note-media-btn" data-media-action="' + action + '">' + label + "</button>";
  }

  function safeHref(u) {
    u = String(u || "");
    if (!u) return "";
    return /^(\/|https?:\/\/)/i.test(u) && !/^\/\//.test(u) ? u : "";
  }

  function cardHtml(view) {
    view = view || {};
    var icon = view.kind === "video" ? "🎬" : view.kind === "audio" ? "🎵" : "📎";
    var cap = '<div class="note-media-caption"><span class="note-media-icon">' + icon + '</span> <span class="note-media-name">' +
      esc(view.name || "Media") + "</span>" +
      (view.durationText ? ' <span class="note-media-duration">' + esc(view.durationText) + "</span>" : "") + "</div>";
    var status = function (t) { return '<div class="note-media-status">' + t + "</div>"; };
    var actions = function (list) { return list.length ? '<div class="note-media-actions">' + list.join("") + "</div>" : ""; };
    var del = view.canDelete ? btn("delete", "Hapus") : "";
    var out = cap;

    switch (view.state) {
      case "uploading-local":
        out += status("Mengunggah… " + (Number(view.progress) || 0) + "%") +
          '<div class="note-media-bar"><span style="width:' + (Number(view.progress) || 0) + '%"></span></div>' +
          actions(view.canCancel ? [btn("cancel", "Batal")] : []);
        break;
      case "uploading-stalled":
        out += status(esc(view.error || "Unggahan terhenti — pilih file yang sama untuk melanjutkan")) +
          actions([btn("resume", "Pilih file")].concat(view.canCancel ? [btn("cancel", "Batal")] : [del]));
        break;
      case "uploading-other":
        out += status("Sedang diunggah oleh " + esc(view.uploaderName)) + actions([del]);
        break;
      case "processing":
        out += status("Memproses…") + actions([del]);
        break;
      case "offline":
        out += status("Butuh koneksi untuk memutar");
        break;
      case "missing":
        out += status("Media tidak tersedia untukmu: sudah dihapus atau bukan bagian dari catatan ini.");
        break;
      case "failed":
        out += status(esc(view.error)) + actions([del]);
        break;
      case "ready": {
        out += '<div class="note-media-player" data-media-player></div>';
        if (view.warnFormat) out += status("Format ini mungkin tidak bisa diputar di perangkat ini");
        var href = safeHref(view.downloadUrl);
        var links = [];
        if (href) links.push('<a data-media-download href="' + escA(href) + '" download>Unduh</a>');
        if (del) links.push(del);
        out += actions(links);
        break;
      }
      default: // loading
        out += status("Memuat…");
    }
    return out;
  }

  // Atribut untuk membuat elemen player lewat DOM API. src/poster masih mentah; pemanggil membungkus apiUrl().
  // poster hanya untuk video.
  function playerAttrs(view) {
    view = view || {};
    var tag = view.kind === "audio" ? "audio" : "video";
    return { tag: tag, src: view.src || "", poster: tag === "video" ? (view.poster || "") : "", mime: view.mime || "" };
  }

  return { formatDuration: formatDuration, viewFor: viewFor, cardHtml: cardHtml, playerAttrs: playerAttrs };
});
