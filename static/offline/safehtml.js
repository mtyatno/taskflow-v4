// Fungsi aman-HTML untuk isi note di klien: escape, allowlist tag, filter URL, validasi atribut ::draw.
// Padanan server: safehtml.py. Aturannya satu (spec docs/superpowers/specs/2026-10-19-xss-hardening-design.md §2)
// dan perilakunya harus identik; paritas dicek tests/offline/safehtml_parity.test.js (korpus yang sama dijalankan
// di python3) dan tests/test_safehtml_js_parity.py (daftar OBFUSCATED_CASES).
// Browser: window.TF.safehtml. Node: module.exports. Pemakai di index.html mengambil TF.safehtml saat dipanggil.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.TF = root.TF || {};
    root.TF.safehtml = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function escapeHtml(s) {
    if (s === null || s === undefined) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function escapeAttr(s) {
    return escapeHtml(s).replace(/"/g, '&quot;').replace(/'/g, '&#x27;');
  }

  // ── Allowlist tag isi note (§2.1) ────────────────────────────────────────────
  // Sama dengan safehtml.py: re.IGNORECASE Python pada pola str memakai case folding Unicode (ſ ~ s, K ~ k),
  // jadi di sini flag "iu". \b dan \s Python peka Unicode → kelas eksplisit.
  const PY_WS = '\\t\\n\\x0b\\x0c\\r\\x1c-\\x20\\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000';
  const PY_WORD_END = '(?![\\p{L}\\p{N}_])';
  const ALLOWED_ESCAPED_RE = /&lt;(br(?: ?\/)?|\/?details|\/?summary|\/?mark)&gt;/giu;
  // Wilayah <pre>…</pre> / <code>…</code> (tanpa penutup = sampai akhir) dan tag apa pun (atribut tidak disentuh).
  const SKIP_RE = new RegExp(
    '(<pre' + PY_WORD_END + '[^>]*>[\\s\\S]*?(?:</pre[' + PY_WS + ']*>|$)' +
    '|<code' + PY_WORD_END + '[^>]*>[\\s\\S]*?(?:</code[' + PY_WS + ']*>|$)' +
    '|<[^>]*>)', 'iu');

  function restoreOne(m, name) {
    const n = name.toLowerCase();
    return n.startsWith('br') ? '<br>' : '<' + n + '>';
  }

  function restoreAllowedTags(html) {
    if (!html) return '';
    const parts = String(html).split(SKIP_RE);
    // split dengan satu grup: indeks genap = teks, ganjil = tag/kode yang dilewati
    for (let i = 0; i < parts.length; i += 2) {
      if (parts[i].indexOf('&lt;') !== -1) parts[i] = parts[i].replace(ALLOWED_ESCAPED_RE, restoreOne);
    }
    return parts.join('');
  }

  // ── Decode entity HTML: port html.unescape Python ───────────────────────────
  // Entity bernama: yang hasilnya ASCII + semua nama yang diawali nama "legacy" (tanpa titik koma), supaya
  // pencarian prefiks terpanjang sama dengan Python. Entity lain (hasil non-ASCII, tanpa prefiks legacy) tidak
  // didecode di sini; hasil keputusan safeUrl tetap sama karena '&' dan karakter non-ASCII sama-sama bukan
  // karakter skema dan tidak bisa membentuk entity baru.
  const NAMED = {
    "AElig":"\u00c6","AElig;":"\u00c6","AMP":"&","AMP;":"&","Aacute":"\u00c1","Aacute;":"\u00c1","Acirc":"\u00c2",
    "Acirc;":"\u00c2","Agrave":"\u00c0","Agrave;":"\u00c0","Aring":"\u00c5","Aring;":"\u00c5","Atilde":"\u00c3",
    "Atilde;":"\u00c3","Auml":"\u00c4","Auml;":"\u00c4","COPY":"\u00a9","COPY;":"\u00a9","Ccedil":"\u00c7",
    "Ccedil;":"\u00c7","DiacriticalGrave;":"`","ETH":"\u00d0","ETH;":"\u00d0","Eacute":"\u00c9",
    "Eacute;":"\u00c9","Ecirc":"\u00ca","Ecirc;":"\u00ca","Egrave":"\u00c8","Egrave;":"\u00c8","Euml":"\u00cb",
    "Euml;":"\u00cb","GT":">","GT;":">","Hat;":"^","Iacute":"\u00cd","Iacute;":"\u00cd","Icirc":"\u00ce",
    "Icirc;":"\u00ce","Igrave":"\u00cc","Igrave;":"\u00cc","Iuml":"\u00cf","Iuml;":"\u00cf","LT":"<","LT;":"<",
    "NewLine;":"\n","Ntilde":"\u00d1","Ntilde;":"\u00d1","Oacute":"\u00d3","Oacute;":"\u00d3","Ocirc":"\u00d4",
    "Ocirc;":"\u00d4","Ograve":"\u00d2","Ograve;":"\u00d2","Oslash":"\u00d8","Oslash;":"\u00d8","Otilde":"\u00d5",
    "Otilde;":"\u00d5","Ouml":"\u00d6","Ouml;":"\u00d6","QUOT":"\"","QUOT;":"\"","REG":"\u00ae","REG;":"\u00ae",
    "THORN":"\u00de","THORN;":"\u00de","Tab;":"\t","Uacute":"\u00da","Uacute;":"\u00da","Ucirc":"\u00db",
    "Ucirc;":"\u00db","Ugrave":"\u00d9","Ugrave;":"\u00d9","UnderBar;":"_","Uuml":"\u00dc","Uuml;":"\u00dc",
    "VerticalLine;":"|","Yacute":"\u00dd","Yacute;":"\u00dd","aacute":"\u00e1","aacute;":"\u00e1",
    "acirc":"\u00e2","acirc;":"\u00e2","acute":"\u00b4","acute;":"\u00b4","aelig":"\u00e6","aelig;":"\u00e6",
    "agrave":"\u00e0","agrave;":"\u00e0","amp":"&","amp;":"&","apos;":"'","aring":"\u00e5","aring;":"\u00e5",
    "ast;":"*","atilde":"\u00e3","atilde;":"\u00e3","auml":"\u00e4","auml;":"\u00e4","brvbar":"\u00a6",
    "brvbar;":"\u00a6","bsol;":"\\","ccedil":"\u00e7","ccedil;":"\u00e7","cedil":"\u00b8","cedil;":"\u00b8",
    "cent":"\u00a2","cent;":"\u00a2","centerdot;":"\u00b7","colon;":":","comma;":",","commat;":"@",
    "copy":"\u00a9","copy;":"\u00a9","copysr;":"\u2117","curren":"\u00a4","curren;":"\u00a4","deg":"\u00b0",
    "deg;":"\u00b0","divide":"\u00f7","divide;":"\u00f7","divideontimes;":"\u22c7","dollar;":"$",
    "eacute":"\u00e9","eacute;":"\u00e9","ecirc":"\u00ea","ecirc;":"\u00ea","egrave":"\u00e8","egrave;":"\u00e8",
    "equals;":"=","eth":"\u00f0","eth;":"\u00f0","euml":"\u00eb","euml;":"\u00eb","excl;":"!","fjlig;":"fj",
    "frac12":"\u00bd","frac12;":"\u00bd","frac14":"\u00bc","frac14;":"\u00bc","frac34":"\u00be",
    "frac34;":"\u00be","grave;":"`","gt":">","gt;":">","gtcc;":"\u2aa7","gtcir;":"\u2a7a","gtdot;":"\u22d7",
    "gtlPar;":"\u2995","gtquest;":"\u2a7c","gtrapprox;":"\u2a86","gtrarr;":"\u2978","gtrdot;":"\u22d7",
    "gtreqless;":"\u22db","gtreqqless;":"\u2a8c","gtrless;":"\u2277","gtrsim;":"\u2273","iacute":"\u00ed",
    "iacute;":"\u00ed","icirc":"\u00ee","icirc;":"\u00ee","iexcl":"\u00a1","iexcl;":"\u00a1","igrave":"\u00ec",
    "igrave;":"\u00ec","iquest":"\u00bf","iquest;":"\u00bf","iuml":"\u00ef","iuml;":"\u00ef","laquo":"\u00ab",
    "laquo;":"\u00ab","lbrace;":"{","lbrack;":"[","lcub;":"{","lowbar;":"_","lpar;":"(","lsqb;":"[","lt":"<",
    "lt;":"<","ltcc;":"\u2aa6","ltcir;":"\u2a79","ltdot;":"\u22d6","lthree;":"\u22cb","ltimes;":"\u22c9",
    "ltlarr;":"\u2976","ltquest;":"\u2a7b","ltrPar;":"\u2996","ltri;":"\u25c3","ltrie;":"\u22b4",
    "ltrif;":"\u25c2","macr":"\u00af","macr;":"\u00af","micro":"\u00b5","micro;":"\u00b5","midast;":"*",
    "middot":"\u00b7","middot;":"\u00b7","nbsp":"\u00a0","nbsp;":"\u00a0","not":"\u00ac","not;":"\u00ac",
    "notin;":"\u2209","notinE;":"\u22f9\u0338","notindot;":"\u22f5\u0338","notinva;":"\u2209","notinvb;":"\u22f7",
    "notinvc;":"\u22f6","notni;":"\u220c","notniva;":"\u220c","notnivb;":"\u22fe","notnivc;":"\u22fd",
    "ntilde":"\u00f1","ntilde;":"\u00f1","num;":"#","oacute":"\u00f3","oacute;":"\u00f3","ocirc":"\u00f4",
    "ocirc;":"\u00f4","ograve":"\u00f2","ograve;":"\u00f2","ordf":"\u00aa","ordf;":"\u00aa","ordm":"\u00ba",
    "ordm;":"\u00ba","oslash":"\u00f8","oslash;":"\u00f8","otilde":"\u00f5","otilde;":"\u00f5","ouml":"\u00f6",
    "ouml;":"\u00f6","para":"\u00b6","para;":"\u00b6","parallel;":"\u2225","percnt;":"%","period;":".",
    "plus;":"+","plusmn":"\u00b1","plusmn;":"\u00b1","pound":"\u00a3","pound;":"\u00a3","quest;":"?","quot":"\"",
    "quot;":"\"","raquo":"\u00bb","raquo;":"\u00bb","rbrace;":"}","rbrack;":"]","rcub;":"}","reg":"\u00ae",
    "reg;":"\u00ae","rpar;":")","rsqb;":"]","sect":"\u00a7","sect;":"\u00a7","semi;":";","shy":"\u00ad",
    "shy;":"\u00ad","sol;":"/","sup1":"\u00b9","sup1;":"\u00b9","sup2":"\u00b2","sup2;":"\u00b2","sup3":"\u00b3",
    "sup3;":"\u00b3","szlig":"\u00df","szlig;":"\u00df","thorn":"\u00fe","thorn;":"\u00fe","times":"\u00d7",
    "times;":"\u00d7","timesb;":"\u22a0","timesbar;":"\u2a31","timesd;":"\u2a30","uacute":"\u00fa",
    "uacute;":"\u00fa","ucirc":"\u00fb","ucirc;":"\u00fb","ugrave":"\u00f9","ugrave;":"\u00f9","uml":"\u00a8",
    "uml;":"\u00a8","uuml":"\u00fc","uuml;":"\u00fc","verbar;":"|","vert;":"|","yacute":"\u00fd",
    "yacute;":"\u00fd","yen":"\u00a5","yen;":"\u00a5","yuml":"\u00ff","yuml;":"\u00ff"
  };
  const INVALID_CHARREFS = {
    0x00: '\ufffd', 0x0d: '\r', 0x80: '\u20ac', 0x81: '\x81', 0x82: '\u201a', 0x83: '\u0192', 0x84: '\u201e',
    0x85: '\u2026', 0x86: '\u2020', 0x87: '\u2021', 0x88: '\u02c6', 0x89: '\u2030', 0x8a: '\u0160', 0x8b: '\u2039',
    0x8c: '\u0152', 0x8d: '\x8d', 0x8e: '\u017d', 0x8f: '\x8f', 0x90: '\x90', 0x91: '\u2018', 0x92: '\u2019',
    0x93: '\u201c', 0x94: '\u201d', 0x95: '\u2022', 0x96: '\u2013', 0x97: '\u2014', 0x98: '\u02dc', 0x99: '\u2122',
    0x9a: '\u0161', 0x9b: '\u203a', 0x9c: '\u0153', 0x9d: '\x9d', 0x9e: '\u017e', 0x9f: '\u0178',
  };
  function invalidCodepoint(n) {
    return (n >= 0x1 && n <= 0x8) || n === 0xb || (n >= 0xe && n <= 0x1f) || (n >= 0x7f && n <= 0x9f) ||
      (n >= 0xfdd0 && n <= 0xfdef) || (n & 0xfffe) === 0xfffe;
  }
  const CHARREF_RE = /&(#[0-9]+;?|#[xX][0-9a-fA-F]+;?|[^\t\n\f <&#;]{1,32};?)/gu;
  const hasOwn = Object.prototype.hasOwnProperty;

  function replaceCharref(m, s) {
    if (s[0] === '#') {
      const body = s.replace(/;+$/, '');
      const num = (s[1] === 'x' || s[1] === 'X') ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      if (hasOwn.call(INVALID_CHARREFS, num)) return INVALID_CHARREFS[num];
      if ((num >= 0xd800 && num <= 0xdfff) || num > 0x10ffff) return '\ufffd';
      if (invalidCodepoint(num)) return '';
      return String.fromCodePoint(num);
    }
    if (hasOwn.call(NAMED, s)) return NAMED[s];
    const cps = Array.from(s);
    for (let x = cps.length - 1; x > 1; x--) {
      const pre = cps.slice(0, x).join('');
      if (hasOwn.call(NAMED, pre)) return NAMED[pre] + cps.slice(x).join('');
    }
    return '&' + s;
  }

  function unescapeEntities(s) {
    if (s.indexOf('&') === -1) return s;
    return s.replace(CHARREF_RE, replaceCharref);
  }

  // ── URL (§2.2) ───────────────────────────────────────────────────────────────
  const CTRL_WS_RE = /[\x00-\x20\x7f]/g;
  const SCHEME_RE = /^([a-zA-Z][a-zA-Z0-9+.-]*):/;
  const SAFE_SCHEMES = ['http', 'https', 'mailto', 'tel'];
  const DATA_IMAGE_RE = /^data:image\/(?:png|jpeg|gif|webp);base64,/iu;
  const PY_STRIP_RE = new RegExp('^[' + PY_WS + ']+|[' + PY_WS + ']+$', 'gu');

  function pyStrip(s) { return s.replace(PY_STRIP_RE, ''); }

  function normalizeUrl(url) {
    let s = String(url);
    // decode entity sampai stabil (dibatasi): java&#x73;cript, java&amp;#x73;cript
    for (let i = 0; i < 4; i++) {
      const decoded = unescapeEntities(s);
      if (decoded === s) break;
      s = decoded;
    }
    return s.replace(CTRL_WS_RE, '');
  }

  // URL yang boleh masuk href/src, atau null (ditolak). Nilai kembalian = URL asli (spasi tepi dibuang);
  // pemanggil tetap menulisnya lewat escapeAttr.
  function safeUrl(url, opts) {
    if (url === null || url === undefined) return null;
    const image = !!(opts && opts.image);
    const norm = normalizeUrl(url);
    const m = SCHEME_RE.exec(norm);
    if (m) {
      const scheme = m[1].toLowerCase();
      if (SAFE_SCHEMES.indexOf(scheme) !== -1) return pyStrip(String(url));
      if (image && scheme === 'data' && DATA_IMAGE_RE.test(norm)) return pyStrip(String(url));
      return null;
    }
    return pyStrip(String(url));
  }

  // ── Atribut ::draw (§2.3) ────────────────────────────────────────────────────
  // \d Python = kategori Unicode Nd.
  const DRAW_DIM_RE = /^(?:\p{Nd}{1,4}(?:px|%)|small|medium|large)$/u;
  const DRAW_SIZES = ['S', 'M', 'L'];

  // size ∈ S|M|L (tidak peka huruf, dinormalkan ke huruf besar); width/height = \d{1,4}(px|%) atau
  // small|medium|large. Nilai yang tidak cocok dibuang (pemanggil memakai default). Kunci lain diteruskan apa
  // adanya dan harus di-escape saat dipakai.
  function safeDrawAttrs(attrs) {
    const out = {};
    if (!attrs) return out;
    for (const key of Object.keys(attrs)) {
      const value = attrs[key];
      if (key === 'size') {
        if (typeof value === 'string' && DRAW_SIZES.indexOf(value.toUpperCase()) !== -1) out.size = value.toUpperCase();
      } else if (key === 'width' || key === 'height') {
        if (typeof value === 'string' && DRAW_DIM_RE.test(value)) out[key] = value;
      } else {
        out[key] = value;
      }
    }
    return out;
  }

  // ── Notifikasi (§4) ──────────────────────────────────────────────────────────
  // Server meng-escape nilai pengguna (pesan baru: "<b>A &amp; B</b>"); baris lama bisa berisi HTML mentah.
  // Entity dasar didecode SEKALI (satu lintasan: "&amp;lt;" → teks "&lt;", bukan "<"), lalu semua di-escape,
  // lalu hanya <b> </b> <i> </i> <br> persis (tanpa atribut, tidak peka huruf) yang dikembalikan.
  const NOTIF_ENTITY_RE = /&(amp|lt|gt|quot|#x27|#39);/g;
  const NOTIF_ENTITIES = { 'amp': '&', 'lt': '<', 'gt': '>', 'quot': '"', '#x27': "'", '#39': "'" };
  const NOTIF_ALLOWED_RE = /&lt;(\/?[bi]|br)&gt;/gi;

  function renderNotificationHtml(msg) {
    if (msg === null || msg === undefined) return '';
    const decoded = String(msg).replace(NOTIF_ENTITY_RE, function (m, name) { return NOTIF_ENTITIES[name]; });
    return escapeHtml(decoded).replace(NOTIF_ALLOWED_RE, function (m, tag) { return '<' + tag.toLowerCase() + '>'; });
  }

  // ── SVG drawing lewat <img> (§3) ─────────────────────────────────────────────
  // SVG tidak pernah masuk DOM sebagai markup: <img src="data:image/svg+xml;base64,…"> (skrip/handler di dalam
  // SVG tidak jalan di konteks gambar). Sengaja BUKAN blob: — blob URL mewarisi origin aplikasi, jadi bila
  // dibuka top-level ("buka gambar di tab baru") skrip SVG jalan sebagai dokumen same-origin; navigasi top-level
  // ke data: diblokir browser. DOM diambil saat dipanggil; tanpa DOM (node) → null.
  const SVG_IMG_STYLE = 'width:100%;height:auto;max-height:100%;display:block;object-fit:contain';
  const SVG_DATA_PREFIX = 'data:image/svg+xml;base64,';

  function domEnv() {
    const g = typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : null);
    if (!g || !g.document || typeof g.document.createElement !== 'function') return null;
    if (typeof g.btoa !== 'function') return null;
    return g;
  }

  function isSvgMarkup(svg) {
    return typeof svg === 'string' && svg.trim().startsWith('<svg');
  }

  // base64 dari byte UTF-8 (btoa sendiri hanya menerima Latin-1). Potongan 32K menghindari batas argumen
  // String.fromCharCode.apply pada SVG besar. Surrogate tunggal → null (encodeURIComponent melempar).
  function utf8Base64(g, s) {
    let bin = '';
    if (typeof g.TextEncoder === 'function') {
      const bytes = new g.TextEncoder().encode(s);
      for (let i = 0; i < bytes.length; i += 0x8000) {
        bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
      }
    } else {
      bin = unescape(encodeURIComponent(s));
    }
    return g.btoa(bin);
  }

  // <img> dengan data: URL SVG, atau null (bukan SVG / tanpa DOM / gagal encode).
  function svgToImg(svg, alt) {
    if (!isSvgMarkup(svg)) return null;
    const g = domEnv();
    if (!g) return null;
    let b64;
    try { b64 = utf8Base64(g, svg); } catch (_) { return null; }
    const img = g.document.createElement('img');
    img.alt = alt === null || alt === undefined ? '' : String(alt);
    img.draggable = false;
    img.style.cssText = SVG_IMG_STYLE;
    img.src = SVG_DATA_PREFIX + b64;
    return img;
  }

  // Ganti isi container dengan <img> SVG. Isi tidak valid → null, container tidak disentuh.
  function mountSvgImg(container, svg, alt) {
    if (!container) return null;
    const img = svgToImg(svg, alt);
    if (!img) return null;
    container.textContent = '';
    container.appendChild(img);
    return img;
  }

  // ── Kasus uji bersama ────────────────────────────────────────────────────────
  // Salinan persis safehtml.OBFUSCATED_CASES, ditulis sebagai literal JSON di antara penanda (dibaca
  // tests/test_safehtml_js_parity.py). Jangan ubah di satu sisi saja.
  const OBFUSCATED_CASES = Object.freeze(/* OBFUSCATED_CASES:BEGIN */
  [
    "<script>window.__xss=1</script>",
    "<img src=x onerror=window.__xss=1>",
    "<svg onload=window.__xss=1>",
    "[x](javascript:window.__xss=1)",
    "![x](x\"onerror=\"window.__xss=1)",
    "</title><script>window.__xss=1</script>",
    "[x](java&#x73;cript:window.__xss=1)",
    "[x](java&#115;cript:window.__xss=1)",
    "[x](&#106;avascript:window.__xss=1)",
    "[x](javascript&colon;window.__xss=1)",
    "[x](JaVaScRiPt:window.__xss=1)",
    "[x](\tjavascript:window.__xss=1)",
    "[x]( javascript:window.__xss=1)",
    "[x](<javascript:window.__xss=1>)",
    "<javascript:window.__xss=1>",
    "[x](vbscript:msgbox(1))",
    "[x](data:text/html,<script>window.__xss=1</script>)",
    "![x](javascript:window.__xss=1)",
    "![x](data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9YWxlcnQoMSk+)",
    "[ref]\n\n[ref]: javascript:window.__xss=1",
    "<SCRIPT>window.__xss=1</SCRIPT>",
    "<scr<script>ipt>window.__xss=1</script>",
    "<a href=\"javascript:window.__xss=1\">x</a>",
    "<iframe src=javascript:window.__xss=1></iframe>",
    "<object data=javascript:window.__xss=1></object>",
    "<br onclick=x>",
    "<BR/onclick=window.__xss=1>",
    "<mark style=\"background:url(javascript:window.__xss=1)\">m</mark>",
    "<MaRk onmouseover=window.__xss=1>m</MaRk>",
    "<details open ontoggle=window.__xss=1><summary>s</summary>d</details>",
    "&lt;br onclick=window.__xss=1&gt;",
    "==<img src=x onerror=window.__xss=1>==",
    "[[<img src=x onerror=window.__xss=1>]]",
    "::draw[tidakada]{width='x\" onclick=\"window.__xss=1' size='S\" onmouseover=\"window.__xss=1'}",
    "::draw[tidakada]{title='<img src=x onerror=window.__xss=1>' height='1px;background:url(javascript:x)'}"
  ]
  /* OBFUSCATED_CASES:END */);

  return {
    escapeHtml: escapeHtml,
    escapeAttr: escapeAttr,
    restoreAllowedTags: restoreAllowedTags,
    safeUrl: safeUrl,
    safeDrawAttrs: safeDrawAttrs,
    renderNotificationHtml: renderNotificationHtml,
    isSvgMarkup: isSvgMarkup,
    svgToImg: svgToImg,
    mountSvgImg: mountSvgImg,
    SVG_IMG_STYLE: SVG_IMG_STYLE,
    OBFUSCATED_CASES: OBFUSCATED_CASES,
  };
});
