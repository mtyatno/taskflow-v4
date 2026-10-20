"""Fungsi aman-HTML untuk isi note: escape, allowlist tag, filter URL, validasi atribut ::draw.

Aturan: docs/superpowers/specs/2026-10-19-xss-hardening-design.md §2 (server dan klien sama; padanan
klien static/offline/safehtml.js memakai kasus uji yang sama, termasuk OBFUSCATED_CASES). Modul ini
tidak meng-import webapp.
"""
from __future__ import annotations

import base64 as _base64
import html as _html
import json as _json
import re

__all__ = [
    "escape_html", "escape_attr", "restore_allowed_tags", "safe_url", "safe_draw_attrs", "svg_img_tag",
    "sanitize_mind_tree", "sanitize_mind_json", "OBFUSCATED_CASES",
]


def escape_html(s) -> str:
    """Escape teks untuk isi elemen: & < >."""
    if s is None:
        return ""
    return str(s).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def escape_attr(s) -> str:
    """Escape nilai atribut: & < > " '."""
    return escape_html(s).replace('"', "&quot;").replace("'", "&#x27;")


# ── Allowlist tag isi note (§2.1) ────────────────────────────────────────────
# Hanya bentuk ter-escape yang persis ini yang dikembalikan, tidak peka huruf. Bentuk itu hanya bisa
# berasal dari teks pengguna yang sudah di-escape, jadi tidak ada jalur menyisipkan atribut.
_ALLOWED_ESCAPED_RE = re.compile(r"&lt;(br(?: ?/)?|/?details|/?summary|/?mark)&gt;", re.IGNORECASE)
# Pemotong keluaran HTML: wilayah <pre>…</pre> / <code>…</code> (tanpa penutup = sampai akhir) dan tag
# apa pun (atribut tidak disentuh). Sisanya teks, satu-satunya tempat allowlist dikembalikan.
_SKIP_RE = re.compile(
    r"(<pre\b[^>]*>.*?(?:</pre\s*>|\Z)|<code\b[^>]*>.*?(?:</code\s*>|\Z)|<[^>]*>)",
    re.IGNORECASE | re.DOTALL,
)


def _restore_one(m) -> str:
    name = m.group(1).lower()
    return "<br>" if name.startswith("br") else f"<{name}>"


def restore_allowed_tags(html: str) -> str:
    """Kembalikan &lt;br&gt; &lt;br/&gt; &lt;br /&gt; &lt;details&gt; &lt;summary&gt; &lt;mark&gt; (dan penutupnya)
    menjadi tag tanpa atribut. Isi <code>/<pre> dan atribut tag tidak diubah."""
    if not html:
        return html or ""
    parts = _SKIP_RE.split(html)
    # split dengan satu grup: indeks genap = teks, ganjil = tag/kode yang dilewati
    for i in range(0, len(parts), 2):
        if "&lt;" in parts[i]:
            parts[i] = _ALLOWED_ESCAPED_RE.sub(_restore_one, parts[i])
    return "".join(parts)


# ── URL (§2.2) ───────────────────────────────────────────────────────────────
_CTRL_WS_RE = re.compile(r"[\x00-\x20\x7f]")
_SCHEME_RE = re.compile(r"^([a-zA-Z][a-zA-Z0-9+.-]*):")
_SAFE_SCHEMES = ("http", "https", "mailto", "tel")
_DATA_IMAGE_RE = re.compile(r"^data:image/(?:png|jpeg|gif|webp);base64,", re.IGNORECASE)


def _normalize_url(url: str) -> str:
    s = str(url)
    # decode entity sampai stabil (dibatasi): java&#x73;cript, java&amp;#x73;cript
    for _ in range(4):
        decoded = _html.unescape(s)
        if decoded == s:
            break
        s = decoded
    return _CTRL_WS_RE.sub("", s)


def safe_url(url, image: bool = False):
    """URL yang boleh masuk href/src, atau None (ditolak).

    Diizinkan: http:, https:, mailto:, tel:, path relatif (tanpa skema: /x, ./x, ../x, x.png, foo/bar), #…;
    untuk gambar juga data:image/(png|jpeg|gif|webp);base64,…. Skema = ^[a-zA-Z][a-zA-Z0-9+.-]*: sebelum
    / ? # pertama, diperiksa setelah entity HTML didecode dan karakter kontrol/spasi ASCII dibuang.
    Nilai kembalian = URL asli (spasi tepi dibuang); pemanggil tetap menulisnya lewat escape_attr."""
    if url is None:
        return None
    norm = _normalize_url(url)
    m = _SCHEME_RE.match(norm)
    if m:
        scheme = m.group(1).lower()
        if scheme in _SAFE_SCHEMES:
            return str(url).strip()
        if image and scheme == "data" and _DATA_IMAGE_RE.match(norm):
            return str(url).strip()
        return None
    return str(url).strip()


# ── Atribut ::draw (§2.3) ────────────────────────────────────────────────────
_DRAW_DIM_RE = re.compile(r"\d{1,4}(?:px|%)|small|medium|large")
_DRAW_SIZES = ("S", "M", "L")


def safe_draw_attrs(attrs) -> dict:
    """Atribut ::draw{...} yang sudah divalidasi. size ∈ S|M|L (tidak peka huruf, dinormalkan ke huruf besar);
    width/height = \\d{1,4}(px|%) atau small|medium|large. Nilai yang tidak cocok dibuang (pemanggil memakai
    default). Kunci lain (mis. title) diteruskan apa adanya dan harus di-escape saat dipakai."""
    out = {}
    for key, value in (attrs or {}).items():
        if key == "size":
            if isinstance(value, str) and value.upper() in _DRAW_SIZES:
                out["size"] = value.upper()
        elif key in ("width", "height"):
            if isinstance(value, str) and _DRAW_DIM_RE.fullmatch(value):
                out[key] = value
        else:
            out[key] = value
    return out


# ── Data mindmap (mind-elixir) ──────────────────────────────────────────────
# Mesin mind-elixir memakai node.dangerouslySetInnerHTML sebagai innerHTML dan node.hyperLink sebagai href tanpa
# cek skema; data_json peta bersama ditulis anggota mana pun. Kunci /^dangerously/i (ASCII, tidak peka huruf)
# dibuang di semua tingkat; hyperLink dipertahankan hanya bila string dan lolos safe_url. Padanan klien:
# TF.safehtml.sanitizeMindTree (paritas di tests/offline/safehtml_parity.test.js).
_MIND_DANGEROUS_KEY_RE = re.compile(r"^dangerously", re.IGNORECASE | re.ASCII)


def _sanitize_mind_tree(obj):
    """(salinan bersih, berubah?) — iteratif (tanpa batas rekursi), tidak mengubah obj."""
    if not isinstance(obj, (dict, list)):
        return obj, False
    changed = False
    out = {} if isinstance(obj, dict) else []
    stack = [(obj, out)]
    while stack:
        src, dst = stack.pop()
        items = src.items() if isinstance(src, dict) else enumerate(src)
        for k, v in items:
            if isinstance(src, dict):
                if isinstance(k, str) and _MIND_DANGEROUS_KEY_RE.match(k):
                    changed = True
                    continue
                if k == "hyperLink":
                    safe = safe_url(v) if isinstance(v, str) else None
                    if safe is None:
                        changed = True
                        continue
                    if safe != v:
                        changed = True
                    dst[k] = safe
                    continue
            if isinstance(v, (dict, list)):
                child = {} if isinstance(v, dict) else []
                stack.append((v, child))
                v = child
            if isinstance(dst, dict):
                dst[k] = v
            else:
                dst.append(v)
    return out, changed


def sanitize_mind_tree(obj):
    """Salinan data mindmap tanpa kunci dangerously* dan tanpa hyperLink yang tidak aman (di semua tingkat:
    nodeData, children, summaries, arrows, …). Selain dict/list dikembalikan apa adanya."""
    return _sanitize_mind_tree(obj)[0]


def sanitize_mind_json(s):
    """String data_json → string bersih. JSON tidak valid / bukan dict/list → apa adanya; tanpa perubahan →
    string asli (format klien dipertahankan)."""
    if not isinstance(s, str):
        return s
    try:
        parsed = _json.loads(s)
    except (ValueError, RecursionError):
        return s
    if not isinstance(parsed, (dict, list)):
        return s
    clean, changed = _sanitize_mind_tree(parsed)
    if not changed:
        return s
    return _json.dumps(clean, ensure_ascii=False)


# ── Kasus uji bersama (Review Focus #1 rencana + kriteria §1 spec) ──────────
# Isi note (markdown) yang tidak boleh menghasilkan tag/atribut aktif di render publik maupun klien.
# Task berikutnya menyalin daftar ini ke tes JS; jaga tetap berupa string biasa.
# ── SVG drawing (§3) ─────────────────────────────────────────────────────────
def svg_img_tag(svg, alt, style: str = ""):
    """Pratinjau SVG sebagai <img src="data:image/svg+xml;base64,…">, tidak pernah sebagai markup di DOM
    (script/handler di dalam SVG tidak jalan di konteks <img>). None bila isi bukan SVG
    (syarat: svg.strip().startswith("<svg")). alt dan style di-escape sebagai atribut."""
    if not isinstance(svg, str) or not svg.strip().startswith("<svg"):
        return None
    b64 = _base64.b64encode(svg.encode("utf-8")).decode("ascii")
    style_attr = f' style="{escape_attr(style)}"' if style else ""
    return f'<img src="data:image/svg+xml;base64,{b64}" alt="{escape_attr(alt)}"{style_attr}>'


OBFUSCATED_CASES: list[str] = [
    # §1 spec
    "<script>window.__xss=1</script>",
    "<img src=x onerror=window.__xss=1>",
    "<svg onload=window.__xss=1>",
    "[x](javascript:window.__xss=1)",
    '![x](x"onerror="window.__xss=1)',
    "</title><script>window.__xss=1</script>",
    # URL tersamar
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
    # tag tersamar
    "<SCRIPT>window.__xss=1</SCRIPT>",
    "<scr<script>ipt>window.__xss=1</script>",
    "<a href=\"javascript:window.__xss=1\">x</a>",
    "<iframe src=javascript:window.__xss=1></iframe>",
    "<object data=javascript:window.__xss=1></object>",
    # allowlist dengan atribut tetap ter-escape
    "<br onclick=x>",
    "<BR/onclick=window.__xss=1>",
    "<mark style=\"background:url(javascript:window.__xss=1)\">m</mark>",
    "<MaRk onmouseover=window.__xss=1>m</MaRk>",
    "<details open ontoggle=window.__xss=1><summary>s</summary>d</details>",
    "&lt;br onclick=window.__xss=1&gt;",
    # kartu buatan Alurik
    "==<img src=x onerror=window.__xss=1>==",
    "[[<img src=x onerror=window.__xss=1>]]",
    "::draw[tidakada]{width='x\" onclick=\"window.__xss=1' size='S\" onmouseover=\"window.__xss=1'}",
    "::draw[tidakada]{title='<img src=x onerror=window.__xss=1>' height='1px;background:url(javascript:x)'}",
]
