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

  // ["a"] -> "a"; ["a","b"] -> "a dan b"; ["a","b","c"] -> "a, b dan c".
  function joinParts(parts) {
    if (parts.length <= 1) return parts.join("");
    return `${parts.slice(0, -1).join(", ")} dan ${parts[parts.length - 1]}`;
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
    const mindmaps = num(i.mindmaps_to_personal);

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
    if (mindmaps > 0) returned.push(`${mindmaps} mindmap`);
    if (returned.length) lines.push(`${joinParts(returned)} kembali menjadi pribadi`);

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
      const row = { id: m.id, username: m.username, display_name: m.display_name, role: "member" };
      if (m.joined_at) row.joined_at = m.joined_at;
      rows.push(row);
    }

    return rows;
  }

  function trimStr(v) {
    return typeof v === "string" ? v.trim() : (v == null ? "" : String(v).trim());
  }
  function colorOf(v) {
    return Number.isInteger(v) ? v : null;
  }
  function avatarOf(v) {
    const s = trimStr(v);
    return s ? s : null;
  }

  // Perubahan identitas workspace untuk body PATCH: hanya field yang berbeda dari aslinya.
  // Nama/deskripsi di-trim; deskripsi null ≡ ""; avatar ""/null ≡ null; color_idx non-integer ≡ null.
  function identityDiff(original, draft) {
    const o = original || {};
    const d = draft || {};
    const out = {};
    if (Object.prototype.hasOwnProperty.call(d, "name")) {
      const n = trimStr(d.name);
      if (n !== trimStr(o.name)) out.name = n;
    }
    if (Object.prototype.hasOwnProperty.call(d, "description")) {
      const desc = trimStr(d.description);
      if (desc !== trimStr(o.description)) out.description = desc;
    }
    if (Object.prototype.hasOwnProperty.call(d, "color_idx")) {
      const c = colorOf(d.color_idx);
      if (c !== colorOf(o.color_idx)) out.color_idx = c;
    }
    if (Object.prototype.hasOwnProperty.call(d, "avatar")) {
      const a = avatarOf(d.avatar);
      if (a !== avatarOf(o.avatar)) out.avatar = a;
    }
    return out;
  }

  // joined_at dari server ("YYYY-MM-DD HH:MM:SS" UTC SQLite, atau ISO) → Date; tidak valid → null.
  function joinedDate(v) {
    if (v == null || v === "") return null;
    let s = String(v).trim();
    if (/^\d{4}-\d{2}-\d{2} \d/.test(s)) s = s.replace(" ", "T");
    if (/^\d{4}-\d{2}-\d{2}T[\d:.]+$/.test(s)) s += "Z";
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
  }

  // Cari workspace di halaman daftar: cocok nama atau deskripsi (case-insensitive, query di-trim).
  // Query kosong → semua (salinan). Urutan asli dipertahankan.
  function filterWorkspaces(lists, query) {
    const arr = (Array.isArray(lists) ? lists : []).filter((l) => l && typeof l === "object");
    const q = trimStr(query).toLowerCase();
    if (!q) return arr.slice();
    return arr.filter((l) =>
      trimStr(l.name).toLowerCase().indexOf(q) >= 0 || trimStr(l.description).toLowerCase().indexOf(q) >= 0);
  }

  // Indeks baris tujuan drag pin: baris yang memuat y; di atas semua → 0; di bawah semua → terakhir;
  // celah antar baris → baris terdekat. bands = [{top, bottom}] urut dari atas. Kosong → -1.
  function pinDropIndex(bands, y) {
    const b = Array.isArray(bands) ? bands : [];
    if (!b.length) return -1;
    let best = 0, bestDist = Infinity;
    for (let i = 0; i < b.length; i++) {
      const top = num(b[i] && b[i].top), bottom = num(b[i] && b[i].bottom);
      const dist = y < top ? top - y : y > bottom ? y - bottom : 0;
      if (dist < bestDist) { best = i; bestDist = dist; }
      if (dist === 0) break;
    }
    return best;
  }

  // Identitas berubah dari luar (sync / perangkat lain) saat form owner sedang diedit: gabung per field.
  // Field yang draft-nya masih sama dengan nilai asli sebelumnya mengikuti nilai asli baru; field yang
  // sudah diubah pengguna dipertahankan. Avatar (avatarMode/initials/emoji) diperlakukan sebagai satu field.
  // Semua argumen berbentuk draft form (name, description, color_idx, avatarMode, initials, emoji).
  const AVATAR_KEYS = ["avatarMode", "initials", "emoji"];
  function mergeIdentityDraft(prevOriginal, nextOriginal, draft) {
    const p = prevOriginal || {};
    const n = nextOriginal || {};
    const d = draft || {};
    const out = Object.assign({}, d);
    const groups = [];
    let avatarSeen = false;
    Object.keys(n).forEach((k) => {
      if (AVATAR_KEYS.indexOf(k) >= 0) {
        if (!avatarSeen) { avatarSeen = true; groups.push(AVATAR_KEYS.filter((a) => Object.prototype.hasOwnProperty.call(n, a))); }
      } else groups.push([k]);
    });
    groups.forEach((keys) => {
      const untouched = keys.every((k) => d[k] === p[k]);
      if (untouched) keys.forEach((k) => { out[k] = n[k]; });
    });
    return out;
  }

  const exported = { nameMatches, impactLines, memberRows, identityDiff, joinedDate, filterWorkspaces, pinDropIndex, mergeIdentityDraft };
  if (root && typeof root === "object") { root.TF = root.TF || {}; root.TF.wsmanage = exported; }
  return exported;
});
