(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.TF = root.TF || {};
    root.TF.drawdirective = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const DRAW_REGEX = /\\?::draw\\?\[([0-9a-zA-Z_-]+)\\?\](?:\s*\\?\{([^}]*)\\?\})?/i;

  function parseAttributes(attrRaw) {
    const res = {};
    if (!attrRaw) return res;
    const re = /([a-zA-Z0-9_-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s,}]+))/g;
    let m;
    while ((m = re.exec(attrRaw)) !== null) {
      res[m[1]] = m[2] !== undefined ? m[2] : m[3] !== undefined ? m[3] : m[4];
    }
    return res;
  }

  function parseDirective(rawText) {
    const match = DRAW_REGEX.exec(rawText || '');
    if (!match) return null;
    const id = match[1];
    const attrs = parseAttributes(match[2]);
    const title = attrs.title || 'Gambar';
    const size = (attrs.size || (attrs.width === '40%' || attrs.width === '50%' || attrs.width === 'small' ? 'S' : attrs.width === '70%' || attrs.width === '75%' || attrs.width === 'medium' ? 'M' : 'L')).toUpperCase();
    const width = attrs.width || (size === 'S' ? '50%' : size === 'M' ? '75%' : '100%');
    const height = attrs.height || (size === 'S' ? '200px' : size === 'M' ? '300px' : '400px');
    return { id, title, size, width, height };
  }

  function formatDirective(attrs) {
    const id = attrs.id || '';
    const title = attrs.title || 'Gambar';
    const size = attrs.size || 'L';
    const width = attrs.width || (size === 'S' ? '50%' : size === 'M' ? '75%' : '100%');
    return `::draw[${id}]{title="${title}" size="${size}" width="${width}"}`;
  }

  function remarkDrawPlugin() {
    return function transformer(tree) {
      function walk(node, parent, index) {
        if (node.type === 'text' && typeof node.value === 'string') {
          const regex = /\\?::draw\\?\[([0-9a-zA-Z_-]+)\\?\](?:\s*\\?\{([^}]*)\\?\})?/gi;
          const parts = [];
          let lastIndex = 0;
          let match;
          while ((match = regex.exec(node.value)) !== null) {
            if (match.index > lastIndex) {
              parts.push({
                type: 'text',
                value: node.value.slice(lastIndex, match.index)
              });
            }
            const parsed = parseDirective(match[0]);
            parts.push({
              type: 'drawingDirective',
              id: parsed.id,
              title: parsed.title,
              size: parsed.size,
              width: parsed.width,
              height: parsed.height
            });
            lastIndex = regex.lastIndex;
          }
          if (parts.length > 0) {
            if (lastIndex < node.value.length) {
              parts.push({
                type: 'text',
                value: node.value.slice(lastIndex)
              });
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

  return { parseAttributes, parseDirective, formatDirective, remarkDrawPlugin, DRAW_REGEX };
});
