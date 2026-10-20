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

  function remarkMediaPlugin() {
    return function transformer(tree) {
      function walk(node, parent, index) {
        if (node.type === 'text' && typeof node.value === 'string' && parent) {
          const regex = new RegExp(MEDIA_REGEX.source, 'gi');
          const parts = [];
          let lastIndex = 0;
          let match;
          while ((match = regex.exec(node.value)) !== null) {
            if (match.index > lastIndex) {
              parts.push({ type: 'text', value: node.value.slice(lastIndex, match.index) });
            }
            const p = fromMatch(match);
            parts.push({ type: 'mediaDirective', cid: p.cid, name: p.name });
            lastIndex = regex.lastIndex;
          }
          if (parts.length > 0) {
            if (lastIndex < node.value.length) {
              parts.push({ type: 'text', value: node.value.slice(lastIndex) });
            }
            parent.children.splice(index, 1, ...parts);
            return index + parts.length;
          }
        }
        if (node.children && Array.isArray(node.children)) {
          let i = 0;
          while (i < node.children.length) {
            const next = walk(node.children[i], node, i);
            i = next !== undefined ? next : i + 1;
          }
        }
      }
      walk(tree, null, 0);
    };
  }

  return { MEDIA_REGEX, MEDIA_EXTS, parseMediaDirective, formatMediaDirective, newClientId, isMediaFileName, remarkMediaPlugin };
});
