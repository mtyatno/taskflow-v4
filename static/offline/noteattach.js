;(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory(root);
  } else {
    root.TF = root.TF || {};
    root.TF.noteattach = factory(root);
  }
})(typeof self !== "undefined" ? self : globalThis, function (root) {
  "use strict";

  // Lampiran note lewat tombol 📎 editor (gambar → ![nama](url), file lain → [📄 nama](url)).
  // Bug 2026-10-22: sintaks disisipkan sebagai teks mentah → serializer Milkdown meng-escape-nya menjadi
  // `!\[nama]\(/api/scratchpad/attachments/N/view)` sehingga tidak pernah tampil sebagai gambar/tautan.

  const ATT_URL_RE = /^\/api\/scratchpad\/attachments\/\d+\/view$/;

  // Escape teks label agar aman di dalam [ ] markdown (nama file boleh berisi ] [ \).
  function escapeLabel(s) {
    return String(s == null ? "" : s).replace(/[\r\n]+/g, " ").replace(/([\\\[\]])/g, "\\$1");
  }

  // att: respons POST /api/scratchpad/{id}/attachments → markdown untuk diparse editor.
  function attachmentMarkdown(att) {
    const a = att || {};
    const url = "/api/scratchpad/attachments/" + Number(a.id) + "/view";
    const name = a.original_name || (isImage(a) ? "image" : "file");
    return isImage(a) ? "![" + escapeLabel(name) + "](" + url + ")" : "[📄 " + escapeLabel(name) + "](" + url + ")";
  }

  function isImage(att) {
    return /^image\//i.test(String((att && att.mime_type) || ""));
  }

  // Pulihkan isi yang sudah terlanjur rusak: `!\[nama]\(url)` / `\[📄 nama]\(url)` hanya untuk URL lampiran
  // note. Syarat: `[` benar-benar ter-escape (jumlah backslash ganjil), label tanpa kurung siku, di luar blok
  // kode (``` / ~~~) dan inline code. Backslash escape di dalam nama dilepas lalu di-escape ulang seperlunya.
  const BROKEN_RE = /(?<!\\)((?:\\\\)*)(!?)\\\[((?:[^\[\]\n\\]|\\[^\[\]\n])*)\\?\]\\?\((\/api\/scratchpad\/attachments\/\d+\/view)\\?\)/g;
  function repairSegment(text) {
    return text.replace(BROKEN_RE, function (all, even, bang, label, url) {
      if (!ATT_URL_RE.test(url)) return all;
      const plain = label.replace(/\\([!-/:-@\[-`{-~])/g, "$1");
      return even + bang + "[" + escapeLabel(plain) + "](" + url + ")";
    });
  }
  function repairEscapedAttachmentLinks(md) {
    if (!md || md.indexOf("\\[") === -1 || md.indexOf("/api/scratchpad/attachments/") === -1) return md;
    let fence = null;
    return md.split("\n").map(function (line) {
      const f = /^\s*(`{3,}|~{3,})/.exec(line);
      if (f) {
        if (!fence) fence = f[1][0];
        else if (f[1][0] === fence) fence = null;
        return line;
      }
      if (fence || line.indexOf("\\[") === -1) return line;
      // segmen ganjil = inline code (`…`) → tidak disentuh
      return line.split(/(`+[^`]*`+)/).map(function (seg, i) { return i % 2 ? seg : repairSegment(seg); }).join("");
    }).join("\n");
  }

  // Label indikator (persentase ditampilkan terpisah, lihat percent). loaded/total dalam byte (total 0 = tak diketahui).
  // Setelah semua byte terkirim, server masih meneruskan file ke penyimpanan → "Menyimpan …".
  function statusText(name, loaded, total) {
    const n = String(name || "file");
    if (total > 0 && loaded >= total) return "Menyimpan " + n + "…";
    return "Mengunggah " + n + "…";
  }

  // 0–99 selama byte dikirim, 100 setelah terkirim; null bila total tak diketahui.
  function percent(loaded, total) {
    if (!(total > 0)) return null;
    if (loaded >= total) return 100;
    return Math.max(0, Math.min(99, Math.floor((loaded / total) * 100)));
  }

  return { attachmentMarkdown, isImage, escapeLabel, repairEscapedAttachmentLinks, statusText, percent };
});
