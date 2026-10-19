"""XSS di isi note halaman publik (/pub/{user}/{slug}): HTML mentah di-escape, allowlist tag,
filter URL link/gambar, wikilink, highlight, atribut ::draw, dan renderer cadangan tanpa mistune.

Spec: docs/superpowers/specs/2026-10-19-xss-hardening-design.md §1, §2. Halaman publik satu origin
dengan aplikasi (token di localStorage), jadi satu tag/atribut yang lolos = ambil alih akun.
DB tes dipakai bersama satu sesi pytest: username dan judul dibuat unik.
"""
import re
import sys
from html.parser import HTMLParser

import pytest

import webapp
from safehtml import OBFUSCATED_CASES
from test_pub_access import _auth, _publish, _uniq, anon


def _body(page_text):
    """Isi <div class="pub-body"> (sampai </main>): hanya hasil render isi note, tanpa script halaman."""
    assert '<div class="pub-body">' in page_text
    return page_text.split('<div class="pub-body">', 1)[1].split('</main>', 1)[0]


def _page_body(client, content, title=None):
    tag = _uniq()
    h = _auth(client, f"pubxss_{tag}")
    _, slug, username = _publish(client, h, title or f"XSS {tag}", content)
    page = anon().get(f"/pub/{username}/{slug}")
    assert page.status_code == 200, page.text
    return _body(page.text)


class _Tags(HTMLParser):
    """Tag dan atribut seperti dibaca browser (nilai atribut sudah di-decode entity-nya)."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.tags = []

    def handle_starttag(self, tag, attrs):
        self.tags.append((tag, attrs))

    handle_startendtag = handle_starttag


def _tags(fragment):
    p = _Tags()
    p.feed(fragment)
    p.close()
    return p.tags


def _assert_no_active_markup(fragment, label=""):
    assert not re.search(r"<\s*script", fragment, re.I), (label, fragment)
    for raw_tag in re.findall(r"<[a-zA-Z][^>]*>", fragment):
        unquoted = re.sub(r'"[^"]*"|\'[^\']*\'', '""', raw_tag)
        assert not re.search(r"[\s/]on[a-z]+\s*=", unquoted, re.I), (label, raw_tag)
    for tag, attrs in _tags(fragment):
        assert tag not in ("script", "svg", "iframe", "object", "embed", "style", "base", "form", "meta"), (label, tag)
        for name, value in attrs:
            assert not name.lower().startswith("on"), (label, tag, name)
            norm = re.sub(r"[\x00-\x20\x7f]", "", (value or "")).lower()
            assert "javascript:" not in norm and "vbscript:" not in norm, (label, tag, name, value)
            assert not norm.startswith("data:text"), (label, tag, name, value)
            if norm.startswith("data:"):
                assert re.match(r"data:image/(png|jpeg|gif|webp);base64,", norm), (label, tag, name, value)
            if name.lower() == "style":
                assert tag == "div", (label, tag, value)  # hanya kartu drawing buatan Alurik yang punya style


def test_public_body_escapes_raw_html_and_keeps_allowlist(client):
    content = ('<script>window.__x=1</script> <img src=x onerror=alert(1)> a<br>b '
               '<details><summary>S</summary>D</details> <mark>m</mark>')
    body = _page_body(client, content)
    assert '<script>window.__x' not in body
    assert 'onerror=' not in body.replace('&lt;img src=x onerror=alert(1)&gt;', '')  # hanya sebagai teks ter-escape
    assert '&lt;script&gt;window.__x=1&lt;/script&gt;' in body
    assert '&lt;img src=x onerror=alert(1)&gt;' in body
    for tag in ('<br>', '<details>', '</details>', '<summary>', '</summary>', '<mark>', '</mark>'):
        assert tag in body, tag
    _assert_no_active_markup(body)


def test_public_allowlist_block_and_code(client):
    content = ('<details>\n<summary>Judul</summary>\nIsi\n</details>\n\n'
               'inline `<br>` dan `<mark>`\n\n```\n<details>\n<br>\n```\n\n'
               'baris1<br/>baris2<BR />baris3\n\n<br onclick=x> <mark style="color:red">m</mark>')
    body = _page_body(client, content)
    assert '<details>' in body and '<summary>Judul</summary>' in body
    assert '<code>&lt;br&gt;</code>' in body and '<code>&lt;mark&gt;</code>' in body
    assert '&lt;details&gt;\n&lt;br&gt;' in body  # blok kode tetap teks
    assert 'baris1<br>baris2<br>baris3' in body
    assert '&lt;br onclick=x&gt;' in body
    assert '&lt;mark style=&quot;color:red&quot;&gt;' in body
    _assert_no_active_markup(body)


def test_public_links_and_images_filtered(client):
    content = ('[a](javascript:alert(1))\n\n![i](x"onerror="alert(1))\n\n[b](https://ok.example)\n\n'
               '![gambar ok](https://ok.example/p.png)\n\n![tolak alt](javascript:alert(2))\n\n'
               '![svg](data:image/svg+xml;base64,PHN2Zz4=)\n\n![png](data:image/png;base64,iVBORw0KGgo=)\n\n'
               '[rel](./x) [anchor](#h) [mail](mailto:a@b.c) [vb](vbscript:msgbox(1))\n\n'
               '[ttl](https://ok.example/t "a\\"b\' onmouseover=x")\n\n<javascript:alert(3)>')
    body = _page_body(client, content)
    assert 'href="javascript:' not in body.lower()
    # x"onerror="… tetap satu nilai src (relatif, " di-percent-encode), bukan atribut baru
    assert '<img src="x%22onerror=%22alert(1)" alt="i" />' in body
    assert 'onerror=' not in body.replace('src="x%22onerror=%22alert(1)"', '')
    assert 'href="https://ok.example"' in body
    assert '<img src="https://ok.example/p.png" alt="gambar ok"' in body
    assert '<img src="data:image/png;base64,iVBORw0KGgo=" alt="png"' in body
    assert 'svg+xml' not in body
    # link ditolak -> teks biasa; gambar ditolak -> teks alt
    assert re.search(r'<p>a</p>', body), body
    assert 'tolak alt' in body and 'alt="tolak alt"' not in body
    assert '<a href="./x">rel</a>' in body and '<a href="#h">anchor</a>' in body
    assert '<a href="mailto:a@b.c">mail</a>' in body
    assert 'href="vbscript' not in body.lower()
    assert 'title="a&quot;b&#x27; onmouseover=x"' in body
    _assert_no_active_markup(body)


@pytest.mark.parametrize("idx", range(len(OBFUSCATED_CASES)))
def test_public_obfuscated_cases(client, idx):
    case = OBFUSCATED_CASES[idx]
    body = _page_body(client, f"awal\n\n{case}\n\nakhir")
    assert 'awal' in body and 'akhir' in body
    _assert_no_active_markup(body, repr(case))
    for tag, attrs in _tags(body):
        if tag not in ('img', 'a'):  # src/href relatif boleh memuat teks payload (ter-encode); atribut lain tidak
            assert 'window.__xss' not in ''.join(v or '' for _, v in attrs), (case, tag, attrs)


def test_public_wikilink_and_highlight_escape(client):
    tag = _uniq()
    h = _auth(client, f"pubxsswl_{tag}")
    evil_title = f'<img src=x onerror=alert(1)>"\'{tag}'
    _publish(client, h, evil_title, "target")
    content = (f'[[{evil_title}]]\n\n[[<img src=x onerror=1>]]\n\n==<b>x</b>==\n\n'
               f'==<svg onload>x</svg>== dan ==*tebal*==\n\n![[[{evil_title}]]](x.png)')
    _, slug, username = _publish(client, h, f"Penaut {tag}", content)
    page = anon().get(f"/pub/{username}/{slug}")
    assert page.status_code == 200
    body = _body(page.text)
    # wikilink ter-resolve: tautan tetap ada, judulnya ter-escape
    assert re.search(r'<a href="/pub/[^"]+">\[\[&lt;img src=x onerror=alert\(1\)&gt;"\'' + tag + r'\]\]</a>', body), body
    assert '[[&lt;img src=x onerror=1&gt;]]' in body
    assert '<mark>&lt;b&gt;x&lt;/b&gt;</mark>' in body
    assert '<mark>&lt;svg onload&gt;x&lt;/svg&gt;</mark>' in body
    assert '<mark><em>tebal</em></mark>' in body
    # wikilink di dalam alt gambar: tidak ada markup yang disisipkan ke atribut
    assert f'<img src="x.png" alt="[[&lt;img src=x onerror=alert(1)&gt;&quot;&#x27;{tag}]]" />' in body
    assert [t for t, _ in _tags(body)].count('a') == 1  # hanya wikilink pertama; yang di alt tidak jadi <a>
    _assert_no_active_markup(body)


def test_public_draw_attr_injection_ignored(client):
    content = ("::draw[1]{width='x\" onclick=\"y'}\n\n"
               "::draw[tidakada]{size='S\" onmouseover=\"z' height='1px;background:url(javascript:alert(1))' "
               "title='<img src=x onerror=alert(3)>'}\n\n"
               "::draw[tidakada2]{width=\"60%\" height=\"250px\" size=\"m\"}")
    body = _page_body(client, content)
    assert 'onclick=' not in body
    assert 'onmouseover=' not in body
    assert 'javascript' not in body.lower()
    assert '🎨 &lt;img src=x onerror=alert(3)&gt;' in body
    assert 'data-size="M" style="width:60%;max-width:60%;margin:16px auto;"' in body
    assert 'height:250px;max-height:250px;' in body
    _assert_no_active_markup(body)


def test_fallback_renderer_escapes_direct():
    out = webapp._render_pub_markdown_fallback(
        '# <script>h</script>\n<script>alert(1)</script> a<br>b\n![i](javascript:x)\n[a](javascript:y)\n'
        '| <img src=x onerror=1> | b |\n|---|---|\n| c | <svg onload=1> |\n'
    )
    assert '<script' not in out.lower()
    assert '<img' not in out and '<a ' not in out and '<svg' not in out
    assert '<h1>&lt;script&gt;h&lt;/script&gt;</h1>' in out
    assert '<th>&lt;img src=x onerror=1&gt;</th>' in out and '<td>&lt;svg onload=1&gt;</td>' in out


def test_fallback_renderer_escapes(client, monkeypatch):
    # import mistune di dalam render gagal (ImportError) tanpa meng-uninstall paket
    monkeypatch.setitem(sys.modules, 'mistune', None)
    content = ('# Judul <script>h</script>\n\n<script>window.__x=1</script> a<br>b <mark>m</mark>\n\n'
               '![i](x"onerror="alert(1))\n\n[a](javascript:alert(1))\n\n::draw[tidakada]{width=\'x" onclick="y\'}\n\n'
               '| k | <img src=x onerror=alert(1)> |\n|---|---|\n| 1 | 2 |')
    body = _page_body(client, content)
    assert '<script' not in body.lower()
    assert 'a<br>b <mark>m</mark>' in body
    assert 'Gambar tidak tersedia' in body
    assert '<p><div' not in body
    _assert_no_active_markup(body)
