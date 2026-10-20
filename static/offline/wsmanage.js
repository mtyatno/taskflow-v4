;(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory(root);
  } else {
    root.TF = root.TF || {};
    factory(root);
  }
})(typeof self !== "undefined" ? self : globalThis, function (root) {
  "use strict";

  function num(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }

  // Cocok bila input (setelah trim, case-insensitive) sama dengan nama workspace.
  // Input kosong selalu tidak cocok.
  function nameMatches(input, name) {
    const a = String(input == null ? "" : input).trim().toLowerCase();
    if (!a) return false;
    return a === String(name == null ? "" : name).trim().toLowerCase();
  }

  // Ringkasan dampak penghapusan workspace, dalam bahasa Indonesia.
  // Baris bernilai 0 dihilangkan; semua 0 -> satu baris "kosong".
  function impactLines(impact) {
    const i = impact || {};
    const tasksTotal = num(i.tasks_total);
    const tasksActive = num(i.tasks_active);
    const files = num(i.files);
    const messages = num(i.messages);
    const projects = num(i.projects);
    const stages = num(i.stages);
    const notes = num(i.notes_to_personal);
    const drawings = num(i.drawings_to_personal);

    const lines = [];

    if (tasksTotal > 0) {
      const active = tasksActive > 0 ? ` (${tasksActive} aktif)` : "";
      lines.push(`${tasksTotal} task${active} akan kembali menjadi task pribadi pembuatnya`);
    }

    const destroyed = [];
    if (files > 0) destroyed.push(`${files} berkas`);
    if (messages > 0) destroyed.push(`${messages} pesan chat`);
    if (destroyed.length) lines.push(`${destroyed.join(" dan ")} dihapus permanen`);

    const removed = [];
    if (projects > 0) removed.push(`${projects} project`);
    if (stages > 0) removed.push(`${stages} tahap`);
    if (removed.length) lines.push(`${removed.join(" dan ")} dihapus`);

    const returned = [];
    if (notes > 0) returned.push(`${notes} catatan`);
    if (drawings > 0) returned.push(`${drawings} drawing`);
    if (returned.length) lines.push(`${returned.join(" dan ")} kembali menjadi pribadi`);

    return lines.length ? lines : ["Workspace ini kosong."];
  }

  // Daftar anggota untuk tampilan: owner pertama, lalu anggota sesuai urutan asli.
  // Owner yang juga muncul di members tidak digandakan.
  function memberRows(detail) {
    const d = detail || {};
    const rows = [];
    const seen = new Set();

    if (d.owner) {
      const o = d.owner;
      rows.push({ id: o.id, username: o.username, display_name: o.display_name, role: "owner" });
      seen.add(o.id);
    }

    for (const m of d.members || []) {
      if (!m || seen.has(m.id)) continue;
      seen.add(m.id);
      rows.push({ id: m.id, username: m.username, display_name: m.display_name, role: "member" });
    }

    return rows;
  }

  const exported = { nameMatches, impactLines, memberRows };
  if (root && typeof root === "object") { root.TF = root.TF || {}; root.TF.wsmanage = exported; }
  return exported;
});
