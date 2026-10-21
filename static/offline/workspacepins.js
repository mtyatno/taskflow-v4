;(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory(root);
  } else {
    root.TF = root.TF || {};
    factory(root);
  }
})(typeof self !== "undefined" ? self : globalThis, function (root) {
  "use strict";

  const PIN_LIMIT = 5;

  function pinnedForRail(lists) {
    return (lists || [])
      .filter((l) => l && l.pinned === true)
      .sort((a, b) => {
        const pa = a.pin_position != null ? a.pin_position : Infinity;
        const pb = b.pin_position != null ? b.pin_position : Infinity;
        if (pa !== pb) return pa < pb ? -1 : 1;
        const sa = String(a.id), sb = String(b.id);
        return sa < sb ? -1 : sa > sb ? 1 : 0;
      })
      .slice(0, PIN_LIMIT);
  }

  function avatarInitial(name) {
    const chars = Array.from(String(name == null ? "" : name).trim());
    return chars.length ? chars[0].toUpperCase() : "?";
  }

  function avatarColorIndex(id) {
    if (typeof id === "number") return Math.abs(id) % 8;
    let sum = 0;
    const s = String(id == null ? "" : id);
    for (let i = 0; i < s.length; i++) sum += s.charCodeAt(i);
    return sum % 8;
  }

  function canPinMore(lists) {
    return (lists || []).filter((l) => l && l.pinned === true).length < PIN_LIMIT;
  }

  function applyPinChange(lists, listId, pinned, pinPosition) {
    return (lists || []).map((l) =>
      l && l.id === listId ? Object.assign({}, l, { pinned: pinned, pin_position: pinPosition }) : l);
  }

  // --- Identitas workspace (spec kelola-workspace-fase1 §1.2): cermin workspace_identity.normalize_avatar ---
  const AVATAR_ERROR = "Avatar harus 1–2 huruf/angka atau satu emoji";
  const ZWJ = 0x200D, VS16 = 0xFE0F, KEYCAP = 0x20E3;
  const EMOJI_RANGES = [[0x1F000, 0x1FAFF], [0x2600, 0x27BF], [0x2300, 0x23FF], [0x2B00, 0x2BFF]];
  const inEmojiRange = (cp) => EMOJI_RANGES.some((r) => cp >= r[0] && cp <= r[1]);
  const isSkin = (cp) => cp >= 0x1F3FB && cp <= 0x1F3FF;
  const isRegional = (cp) => cp >= 0x1F1E6 && cp <= 0x1F1FF;

  function isSingleEmoji(s) {
    const cps = Array.from(s).map((c) => c.codePointAt(0));
    if (!cps.length || cps.length > 16) return false;
    const last = cps[cps.length - 1];
    if (last === KEYCAP && "0123456789#*".indexOf(String.fromCodePoint(cps[0])) >= 0 && (cps.length === 2 || cps.length === 3)) {
      return cps.length === 2 || cps[1] === VS16;
    }
    if (cps[0] === ZWJ || last === ZWJ) return false;
    let bases = 0, run = 0, prev = null;
    for (const cp of cps) {
      if (cp === ZWJ) {
        if (prev === ZWJ) return false;
      } else if (cp === KEYCAP) {
        return false;
      } else if (cp === VS16) {
        // diabaikan
      } else if (inEmojiRange(cp)) {
        if (isRegional(cp)) {
          run++;
          if (run % 2 === 1) bases++;
        } else {
          if (run % 2) return false;
          run = 0;
          if (!isSkin(cp) && prev !== ZWJ) bases++;
        }
      } else {
        return false;
      }
      prev = cp;
    }
    return bases === 1 && run % 2 === 0;
  }

  function validateAvatar(input) {
    if (input == null) return { ok: true, value: null };
    if (typeof input !== "string") return { ok: false, value: null, error: AVATAR_ERROR };
    const v = input.trim();
    if (!v) return { ok: true, value: null };
    const u = v.toUpperCase(); // "ß" -> "SS": batas 2 karakter diperiksa setelahnya
    if (Array.from(u).length <= 2 && /^[\p{L}\p{N}]+$/u.test(u)) return { ok: true, value: u };
    if (isSingleEmoji(v)) return { ok: true, value: v };
    return { ok: false, value: null, error: AVATAR_ERROR };
  }

  function avatarFor(list) {
    const l = list || {};
    const colorIdx = Number.isInteger(l.color_idx) && l.color_idx >= 0 && l.color_idx <= 7
      ? l.color_idx : avatarColorIndex(l.id);
    if (typeof l.avatar === "string" && l.avatar) {
      return { text: l.avatar, colorIdx: colorIdx, isEmoji: !/^[\p{L}\p{N}]+$/u.test(l.avatar) };
    }
    return { text: avatarInitial(l.name), colorIdx: colorIdx, isEmoji: false };
  }

  function pinOrderAfterMove(ids, fromIndex, toIndex) {
    const out = (ids || []).slice();
    const n = out.length;
    if (!Number.isInteger(fromIndex) || !Number.isInteger(toIndex) ||
        fromIndex < 0 || fromIndex >= n || toIndex < 0 || toIndex >= n) return out;
    const moved = out.splice(fromIndex, 1)[0];
    out.splice(toIndex, 0, moved);
    return out;
  }

  const exported = { PIN_LIMIT, pinnedForRail, avatarInitial, avatarColorIndex, canPinMore, applyPinChange,
    AVATAR_ERROR, validateAvatar, avatarFor, pinOrderAfterMove };
  if (root && typeof root === "object") { root.TF = root.TF || {}; root.TF.workspacepins = exported; }
  return exported;
});
