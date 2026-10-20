(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.TF = root.TF || {};
    root.TF.mediadirective = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  // Direktif lampiran audio/video di note: ::media[<client_id>]{name="..."}
  const MEDIA_REGEX = /\\?::media\\?\[([0-9a-zA-Z_-]{1,64})\\?\](?:\s*\\?\{([^}]*)\\?\})?/gi;

  const MEDIA_EXTS = ['mp3', 'm4a', 'm4b', 'aac', 'wav', 'ogg', 'oga', 'opus', 'webm', 'flac', 'amr', '3gp', '3g2', 'mp4', 'm4v', 'mov', 'mkv'];

  // Hanya atribut name="..." yang dikenali. Backslash di depan tanda baca ASCII di-unescape: \" dan \\ dari
  // formatMediaDirective, juga escape markdown dari editor (remark-stringify menyimpan klip_uji sebagai klip\_uji).
  function parseName(attrRaw) {
    if (!attrRaw) return '';
    const m = /(?:^|[\s,])name\s*=\s*"((?:[^"\\]|\\.)*)"/.exec(attrRaw);
    if (!m) return '';
    return m[1].replace(/\\([!-\/:-@\[-`{-~])/g, '$1');
  }

  function fromMatch(m) {
    return { cid: m[1], name: parseName(m[2]) };
  }

  function parseMediaDirective(text) {
    if (typeof text !== 'string' || !text) return null;
    const re = new RegExp(MEDIA_REGEX.source, 'i');
    const m = re.exec(text);
    return m ? fromMatch(m) : null;
  }

  function formatMediaDirective(d) {
    const cid = (d && d.cid) || '';
    // '}' dan baris baru akan memutus pola direktif → diganti spasi.
    const name = String((d && d.name) || '').replace(/[}\r\n]/g, ' ').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    return `::media[${cid}]{name="${name}"}`;
  }

  function newClientId() {
    const c = typeof globalThis !== 'undefined' ? globalThis.crypto : null;
    if (c && typeof c.randomUUID === 'function') return c.randomUUID();
    let out = '';
    for (let i = 0; i < 32; i++) {
      const r = c && c.getRandomValues ? c.getRandomValues(new Uint8Array(1))[0] : Math.floor(Math.random() * 256);
      out += (r & 15).toString(16);
    }
    return out;
  }

  function isMediaFileName(name) {
    if (typeof name !== 'string') return false;
    const i = name.lastIndexOf('.');
    if (i < 0) return false;
    return MEDIA_EXTS.indexOf(name.slice(i + 1).toLowerCase()) !== -1;
  }

  // Sumber asli konstruksi (penanda emphasis/strong/delete, pagar inlineCode) bila posisi + sumber tersedia.
  function runAt(src, node, chars, max, def) {
    const o = node && node.position && node.position.start && node.position.start.offset;
    if (src && typeof o === 'number') {
      const ch = src.charAt(o);
      if (chars.indexOf(ch) !== -1) {
        let n = 0;
        while (n < max && src.charAt(o + n) === ch) n++;
        return ch.repeat(n);
      }
    }
    return def;
  }
  // Teks sumber (perkiraan) dari node inline yang dibuat remark di dalam name="…" (mis. _x_, *x*, ~x~, `x`,
  // autolink www./http): dipakai merakit ulang atribut direktif yang terpecah.
  function reconstruct(node, src) {
    if (!node) return '';
    if (node.type === 'text' || node.type === 'html') return node.value || '';
    if (node.type === 'inlineCode') { const f = runAt(src, node, '`', 16, '`'); return f + (node.value || '') + f; }
    if (node.type === 'break') return ' ';
    const inner = (node.children || []).map((c) => reconstruct(c, src)).join('');
    if (node.type === 'emphasis') { const m = runAt(src, node, '_*', 1, '_'); return m + inner + m; }
    if (node.type === 'strong') { const m = runAt(src, node, '_*', 2, '__'); return m + inner + m; }
    if (node.type === 'delete') { const m = runAt(src, node, '~', 2, '~'); return m + inner + m; }
    return inner; // link/autolink dan lainnya: teks yang terlihat
  }
  const INLINE_SWALLOW = { emphasis: 1, strong: 1, delete: 1, inlineCode: 1, link: 1, html: 1, break: 1 };

  // Memecah node teks menjadi node mediaDirective. Bila remark sudah memecah isi {name="…"} (konstruksi
  // markdown di dalam nama), node inline berikutnya sampai teks yang memuat '}' ikut ditelan dan nama dirakit
  // ulang — kartu tetap dikenali lewat cid tanpa sisa teks. Tanpa '}' → perilaku lama.
  function splitChildren(parent, src) {
    const ch = parent.children;
    const out = [];
    let changed = false;
    let i = 0;
    while (i < ch.length) {
      const node = ch[i];
      if (node.type !== 'text' || typeof node.value !== 'string') { out.push(node); i++; continue; }
      let value = node.value;
      let next = i + 1;
      const regex = new RegExp(MEDIA_REGEX.source, 'gi');
      let lastIndex = 0;
      let any = false;
      let match;
      while ((match = regex.exec(value)) !== null) {
        any = true;
        if (match.index > lastIndex) out.push({ type: 'text', value: value.slice(lastIndex, match.index) });
        let name = match[2] !== undefined ? parseName(match[2]) : '';
        lastIndex = regex.lastIndex;
        if (match[2] === undefined) {
          const open = /^\s*\\?\{/.exec(value.slice(lastIndex));
          if (open) {
            let attr = value.slice(lastIndex + open[0].length);
            let found = -1;
            let j = next;
            for (; j < ch.length; j++) {
              const sib = ch[j];
              if (sib.type === 'text' && typeof sib.value === 'string') {
                const k = sib.value.indexOf('}');
                if (k >= 0) { attr += sib.value.slice(0, k).replace(/\\$/, ''); found = j; break; }
                attr += sib.value;
              } else if (INLINE_SWALLOW[sib.type]) {
                attr += reconstruct(sib, src);
              } else break;
            }
            if (found >= 0) {
              name = parseName(attr);
              out.push({ type: 'mediaDirective', cid: match[1], name });
              // Lanjutkan memindai sisa teks setelah '}' (bisa memuat direktif lain).
              const sv = ch[found].value;
              value = sv.slice(sv.indexOf('}') + 1);
              next = found + 1;
              regex.lastIndex = 0;
              lastIndex = 0;
              continue;
            }
          }
        }
        out.push({ type: 'mediaDirective', cid: match[1], name });
      }
      if (any) {
        changed = true;
        if (lastIndex < value.length) out.push({ type: 'text', value: value.slice(lastIndex) });
      } else {
        out.push(node);
      }
      i = next;
    }
    if (changed) parent.children = out;
  }

  function remarkMediaPlugin() {
    return function transformer(tree, file) {
      let src = '';
      try { src = file != null ? String(file) : ''; } catch (e) { src = ''; }
      if (src === '[object Object]') src = '';
      function walk(node) {
        if (!node || !Array.isArray(node.children)) return;
        // Teks di dalam inlineCode/code tidak pernah berupa node text → tetap literal.
        splitChildren(node, src);
        node.children.forEach((c) => { if (c.type !== 'mediaDirective') walk(c); });
      }
      walk(tree);
    };
  }

  return { MEDIA_REGEX, MEDIA_EXTS, parseMediaDirective, formatMediaDirective, newClientId, isMediaFileName, remarkMediaPlugin };
});
