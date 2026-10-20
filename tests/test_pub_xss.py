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


def test_public_details_block_not_wrapped_in_p(client):
    """Blok <details> (dipakai pengguna) tidak dibungkus <p>; paragraf isi berada di dalam <details>."""
    body = _page_body(client, '<details>\n<summary>Judul</summary>\n\nIsi **tebal**\n\n</details>')
    assert '<p><details>' not in body and '<p>&lt;details' not in body
    assert '</details></p>' not in body
    m = re.search(r'<details>\s*<summary>Judul</summary>\s*(.*?)\s*</details>', body, re.S)
    assert m, body
    assert m.group(1) == '<p>Isi <strong>tebal</strong></p>', body
    _assert_no_active_markup(body)


def test_pub_markdown_block_html_escaped_without_p():
    out = webapp._render_pub_markdown('<div onclick=x>\n<b>a</b>\n</div>\n\nteks')
    assert out.startswith('&lt;div onclick=x&gt;\n&lt;b&gt;a&lt;/b&gt;\n&lt;/div&gt;\n'), out
    assert '<p>&lt;div' not in out
    assert '<p>teks</p>' in out


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


# ── Kolom halaman publik, SVG, script halaman (Task 2; spec §3, §5) ──────────

from conftest import db  # noqa: E402
from test_pub_access import _attachment, _drawing, _uid  # noqa: E402


def _set_tag(user_id, note_id, name):
    conn = db()
    try:
        cur = conn.execute("INSERT INTO tags (user_id, name) VALUES (?, ?)", (user_id, name))
        conn.execute("INSERT INTO entity_tags (tag_id, user_id, entity_type, entity_id) VALUES (?, ?, 'note', ?)",
                     (cur.lastrowid, user_id, note_id))
        conn.commit()
    finally:
        conn.close()


def _page_outside_scripts(text):
    """Halaman tanpa isi <script>…</script> buatan Alurik (script halaman memuat kata seperti innerHTML)."""
    return re.sub(r"<script\b[^>]*>.*?</script>", "", text, flags=re.S | re.I)


def test_public_fields_escaped(client):
    tag = _uniq()
    uname = f"pubfld_{tag}"
    h = _auth(client, uname)
    title = f'</title><script>window.__x=1</script>"\'{tag}'
    att_name = f'a"><img src=x onerror=1>{tag}.png'
    content = f"# <img src=x onerror=1>\n\nisi {tag}\n\n## kedua <b>x</b>"
    note_id, slug, username = _publish(client, h, title, content)
    _set_tag(_uid(uname), note_id, '<img src=x onerror=1>')
    _attachment(note_id, _uid(uname), f"fld-{tag}.png", "x", mime='image/png"><svg onload=1>')
    conn = db()
    try:
        conn.execute("UPDATE note_attachments SET original_name = ? WHERE note_id = ?", (att_name, note_id))
        conn.commit()
    finally:
        conn.close()

    page = anon().get(f"/pub/{username}/{slug}")
    assert page.status_code == 200, page.text
    text = page.text
    assert '<script>window.__x' not in text
    assert '&lt;/title&gt;&lt;script&gt;window.__x=1&lt;/script&gt;' in text
    assert f'<title>&lt;/title&gt;&lt;script&gt;window.__x=1&lt;/script&gt;&quot;&#x27;{tag} — Alurik Publish</title>' in text
    assert f'<meta property="og:title" content="&lt;/title&gt;&lt;script&gt;window.__x=1&lt;/script&gt;&quot;&#x27;{tag}">' in text
    assert '<span class="pub-tag">&lt;img src=x onerror=1&gt;</span>' in text
    assert f'alt="a&quot;&gt;&lt;img src=x onerror=1&gt;{tag}.png"' in text
    assert '<a href="#img-srcx-onerror1">&lt;img src=x onerror=1&gt;</a>' in text  # TOC
    assert '&lt;b&gt;x&lt;/b&gt;</a>' in text
    # seluruh <body> (tanpa script halaman): markup tetap template (tombol print, style) dikecualikan
    rest = _page_outside_scripts(text).split('<body>', 1)[1]
    rest = rest.replace('<button onclick="window.print()">', '<button>')
    rest = re.sub(r' style="[a-z0-9:;%(),.\- ]*"', '', rest)  # style tetap template lampiran/kartu (tanpa nilai pengguna)
    _assert_no_active_markup(rest)
    head = text.split('<body>', 1)[0]
    assert head.count('<title>') == 1 and '<script' not in head


def test_public_title_with_braces_renders(client):
    tag = _uniq()
    h = _auth(client, f"pubbrace_{tag}")
    title = f"a {{b}} {{{{c}}}} %d $x ${{y}} {tag}"
    _, slug, username = _publish(client, h, title, "isi {x} {{y}} $z")
    page = anon().get(f"/pub/{username}/{slug}")
    assert page.status_code == 200
    assert f'<h1 class="pub-title">{title}</h1>' in page.text
    assert 'isi {x} {{y}} $z' in page.text
    assert '{{' not in page.text.replace('{{y}}', '').replace('{{c}}', '')
    assert '{title}' not in page.text and '$title' not in page.text and '@@' not in page.text


def test_password_page_escapes_username_and_slug(client):
    tag = _uniq()
    uname = f"pubpwq_{tag}"
    h = _auth(client, uname)
    _, slug, _ = _publish(client, h, f"Kunci {tag}", "rahasia", password="rahasia123")
    evil = f'x" onfocus="alert(1)" a="{tag}'
    conn = db()
    try:
        conn.execute("UPDATE users SET username = ? WHERE id = ?", (evil, _uid(uname)))
        conn.commit()
    finally:
        conn.close()
    import urllib.parse as up
    path = f"/pub/{up.quote(evil, safe='')}/{slug}"
    try:
        resps = (anon().get(path), anon().post(path + "/unlock", data={"password": "salah"}))
    finally:
        webapp._ip_attempts.clear()  # batas percobaan per IP dipakai bersama seluruh sesi tes
        webapp._progressive.clear()
    for resp in resps:
        assert resp.status_code == 200, resp.text
        assert '" onfocus' not in resp.text
        assert f'action="/pub/{up.quote(evil, safe="")}/{slug}/unlock"' in resp.text
        _assert_no_active_markup(resp.text.split('<body>', 1)[1].replace('<form method="post"', '<f method="post"'))


def test_public_svg_rendered_as_img(client):
    tag = _uniq()
    h = _auth(client, f"pubsvg_{tag}")
    svg = f'<svg onload="window.__x=1"><script>window.__x=1</script><text>{tag}</text></svg>'
    d = _drawing(client, h, f'judul "<b>{tag}', svg=svg, cid=f"cid-svg-{tag}")
    _, slug, username = _publish(client, h, f"Note svg {tag}", f"::draw[{d['id']}]")
    page = anon().get(f"/pub/{username}/{slug}")
    assert page.status_code == 200
    body = _body(page.text)
    import base64
    b64 = base64.b64encode(svg.encode("utf-8")).decode("ascii")
    img = (f'<img src="data:image/svg+xml;base64,{b64}" alt="judul &quot;&lt;b&gt;{tag}" '
           f'style="{webapp._PUB_SVG_IMG_STYLE}">')
    assert img in body
    assert '<svg onload' not in page.text
    assert '<script>window.__x' not in page.text
    # _assert_no_active_markup menolak data:image/svg+xml dan style di luar div; selain img itu tidak ada markup aktif
    _assert_no_active_markup(body.replace(img, ""))


def test_public_svg_without_svg_prefix_not_embedded(client):
    tag = _uniq()
    h = _auth(client, f"pubsvg2_{tag}")
    d = _drawing(client, h, f"bukan-svg-{tag}", svg=f'<img src=x onerror=1><svg>{tag}</svg>', cid=f"cid-ns-{tag}")
    _, slug, username = _publish(client, h, f"Note ns {tag}", f"::draw[{d['id']}]")
    body = _body(anon().get(f"/pub/{username}/{slug}").text)
    assert 'data:image/svg+xml' not in body
    assert '<iframe src="/static/vendor/tldraw/index.html?noteId=' in body
    # iframe tldraw buatan Alurik (style tetap) dibuang dulu; sisanya tidak boleh punya markup aktif
    body = re.sub(r'<iframe src="/static/vendor/tldraw/index.html\?noteId=\d+" style="[^"]*" title="Drawing"></iframe>', '', body)
    _assert_no_active_markup(body)


def test_public_page_script_uses_img_for_svg_and_checks_source(client):
    tag = _uniq()
    h = _auth(client, f"pubscr_{tag}")
    _, slug, username = _publish(client, h, f"Note scr {tag}", "isi")
    text = anon().get(f"/pub/{username}/{slug}").text
    scripts = "".join(re.findall(r"<script>(.*?)</script>", text, flags=re.S))
    assert 'innerHTML = d.svg_preview' not in scripts
    assert 'innerHTML = e.data.svg' not in scripts
    assert not re.search(r"innerHTML\s*=\s*(d\.svg_preview|e\.data\.svg)", scripts)
    # data: URL, bukan blob: (blob mewarisi origin halaman; dibuka top-level → skrip SVG jalan same-origin)
    assert 'createObjectURL' not in scripts and 'new Blob' not in scripts
    assert "'data:image/svg+xml;base64,' + " in scripts
    assert 'e.source' in scripts and 'contentWindow' in scripts
    assert 'CSS.escape' in scripts
    assert '{{' not in scripts and '}}' not in scripts


def test_public_katex_does_not_create_tags(client):
    body = _page_body(client, "rumus $<img src=x onerror=1>$ dan $$<svg onload=1>$$")
    assert '&lt;img src=x onerror=1&gt;' in body
    _assert_no_active_markup(body)


def test_password_unlock_correct_password_redirects(client):
    """Jalur password benar sempat 500 (NameError _verify_password); kini memasang cookie dan redirect."""
    tag = _uniq()
    h = _auth(client, f"pubunl_{tag}")
    _, slug, username = _publish(client, h, f"Kunci {tag}", "rahasia", password="rahasia123")
    try:
        r = anon().post(f"/pub/{username}/{slug}/unlock", data={"password": "rahasia123"}, follow_redirects=False)
    finally:
        webapp._ip_attempts.clear()
        webapp._progressive.clear()
    assert r.status_code == 302, r.text
    assert r.headers["location"] == f"/pub/{username}/{slug}"
    assert f"pub_unlock_{slug}=" in r.headers.get("set-cookie", "")


# ── Fix round 1: KaTeX per text node, redirect unlock, cover ────────────────

def _page_scripts(text):
    return re.findall(r"<script>(.*?)</script>", text, flags=re.S)


def test_public_katex_script_walks_text_nodes(client):
    tag = _uniq()
    h = _auth(client, f"pubkx_{tag}")
    _, slug, username = _publish(client, h, f"Kx {tag}", "isi $x$")
    scripts = _page_scripts(anon().get(f"/pub/{username}/{slug}").text)
    joined = "".join(scripts)
    assert 'body.innerHTML =' not in joined and '.innerHTML = html' not in joined
    assert 'innerHTML' not in joined.replace('re-parse innerHTML', '').replace('ulang innerHTML', '')
    assert 'createTreeWalker' in scripts[0] and 'katex.render(' in scripts[0]
    assert 'renderToString' not in joined


def test_public_katex_attribute_dollar_untouched_node(client, tmp_path):
    """Script KaTeX asli dijalankan di DOM tiruan: `$` di nilai atribut tidak pernah ikut dipasangkan."""
    import shutil
    import subprocess
    node = shutil.which("node")
    if not node:
        pytest.skip("node tidak tersedia")
    tag = _uniq()
    h = _auth(client, f"pubkx2_{tag}")
    _, slug, username = _publish(client, h, f"Kx2 {tag}", "harga $5 ![$<img src=x onerror=alert(1)>](/a.png) $y$")
    page = anon().get(f"/pub/{username}/{slug}").text
    # payload gabungan dari ruling: di sisi server tetap teks/atribut ter-escape
    _assert_no_active_markup(_body(page))
    script = tmp_path / "katex.js"
    script.write_text(_page_scripts(page)[0], encoding="utf-8")
    harness = __import__("os").path.join(__import__("os").path.dirname(__file__), "pub_katex_harness.js")
    assert subprocess.run([node, "--check", str(script)], capture_output=True).returncode == 0
    r = subprocess.run([node, harness, str(script)], capture_output=True, text=True)
    assert r.returncode == 0, r.stdout + r.stderr
    assert "katex harness OK" in r.stdout


def _raw_asgi(method, path, body=b"", content_type=None):
    """Panggil app ASGI langsung dengan scope seperti dari uvicorn (path sudah di-decode sekali).
    TestClient Starlette meng-unquote path yang sudah di-decode httpx (decode dua kali), jadi username
    berisi %xx tidak bisa diuji lewat TestClient."""
    import asyncio
    headers = [(b"host", b"testserver")]
    if content_type:
        headers.append((b"content-type", content_type.encode()))
    headers.append((b"content-length", str(len(body)).encode()))
    scope = {"type": "http", "asgi": {"version": "3.0"}, "http_version": "1.1", "method": method, "scheme": "http",
             "path": path, "raw_path": __import__("urllib.parse").parse.quote(path).encode(), "query_string": b"",
             "root_path": "", "headers": headers, "client": ("127.0.0.9", 1), "server": ("testserver", 80)}
    out = {"status": None, "headers": {}, "body": b""}
    sent = [False]

    async def receive():
        if not sent[0]:
            sent[0] = True
            return {"type": "http.request", "body": body, "more_body": False}
        return {"type": "http.disconnect"}

    async def send(msg):
        if msg["type"] == "http.response.start":
            out["status"] = msg["status"]
            out["headers"] = {k.decode().lower(): v.decode() for k, v in msg["headers"]}
        elif msg["type"] == "http.response.body":
            out["body"] += msg.get("body", b"")

    asyncio.run(webapp.app(scope, receive, send))
    return out


def test_unlock_redirect_percent_encodes_username(client):
    tag = _uniq()
    uname = f"pubpct_{tag}"
    h = _auth(client, uname)
    _, slug, _ = _publish(client, h, f"Kunci {tag}", "rahasia", password="rahasia123")
    odd = f"a%41b_{tag}"
    conn = db()
    try:
        conn.execute("UPDATE users SET username = ? WHERE id = ?", (odd, _uid(uname)))
        conn.commit()
    finally:
        conn.close()
    try:
        ok = _raw_asgi("POST", f"/pub/{odd}/{slug}/unlock", b"password=rahasia123",
                       "application/x-www-form-urlencoded")
        bad = _raw_asgi("POST", f"/pub/{odd}/{slug}/unlock", b"password=salah", "application/x-www-form-urlencoded")
    finally:
        webapp._ip_attempts.clear()
        webapp._progressive.clear()
    assert ok["status"] == 302, ok
    assert ok["headers"]["location"] == f"/pub/a%2541b_{tag}/{slug}"
    assert bad["status"] == 200 and f'action="/pub/a%2541b_{tag}/{slug}/unlock"' in bad["body"].decode()
    # path yang ditunjuk Location (di-decode sekali oleh server) = halaman note yang sama, bukan user "aAb"
    page = _raw_asgi("GET", f"/pub/{odd}/{slug}")
    assert page["status"] == 200 and "dilindungi password" in page["body"].decode()


def test_public_cover_never_uses_drawing_svg(client):
    tag = _uniq()
    h = _auth(client, f"pubcov_{tag}")
    d = _drawing(client, h, f"cov-{tag}", svg=f"<svg><text>{tag}</text></svg>", cid=f"cid-cov-{tag}")
    _, slug, username = _publish(client, h, f"Cov {tag}", f"![tolak](javascript:alert(1))\n\n::draw[{d['id']}]")
    page = anon().get(f"/pub/{username}/{slug}").text
    assert '<div class="pub-cover">' not in page
    assert 'data:image/svg+xml;base64,' in _body(page)
    # cover biasa tetap jalan
    _, slug2, _ = _publish(client, h, f"Cov2 {tag}", f"![c](https://ok.example/c.png)\n\n::draw[{d['id']}]")
    page2 = anon().get(f"/pub/{username}/{slug2}").text
    assert re.search(r'<div class="pub-cover"><img style="[^"]*" src="https://ok.example/c.png"', page2), page2
    assert 'data:image/svg+xml;base64,' in _body(page2)


def test_public_page_scripts_parse_and_show_svg_as_data_url(client, tmp_path):
    """Semua script halaman publik lolos node --check; _showSvg memasang <img src=data:…base64> (UTF-8 aman)."""
    import json
    import shutil
    import subprocess
    node = shutil.which("node")
    if not node:
        pytest.skip("node tidak tersedia")
    tag = _uniq()
    h = _auth(client, f"pubsvgd_{tag}")
    _, slug, username = _publish(client, h, f"Note svgd {tag}", "isi")
    page = anon().get(f"/pub/{username}/{slug}").text
    scripts = _page_scripts(page)
    assert scripts
    for i, s in enumerate(scripts):
        f = tmp_path / f"s{i}.js"
        f.write_text(s, encoding="utf-8")
        r = subprocess.run([node, "--check", str(f)], capture_output=True, text=True)
        assert r.returncode == 0, r.stderr
    joined = "\n".join(scripts)
    fns = re.search(r"function _svgBase64\(svg\) \{.*?\n  \}\n  function _showSvg\(container, svg\) \{.*?\n  \}", joined, flags=re.S)
    assert fns, "_svgBase64/_showSvg harus ada"
    svg = '<svg xmlns="http://www.w3.org/2000/svg" onload="x()"><text>Rapat — ü 日本 🎨</text>' + "<g/>" * 50000 + "</svg>"
    harness = tmp_path / "show.js"
    harness.write_text(
        "const document = { createElement: t => ({ tagName: t, attrs: {}, setAttribute(k, v) { this.attrs[k] = v; } }) };\n"
        + fns.group(0) + "\n"
        + "const box = { kids: ['old'], set textContent(v) { this.kids = []; }, appendChild(c) { this.kids.push(c); } };\n"
        + f"const svg = {json.dumps(svg)};\n"
        + "_showSvg(box, svg);\n"
        + "const img = box.kids[0];\n"
        + "const p = 'data:image/svg+xml;base64,';\n"
        + "if (box.kids.length !== 1 || !img.src.startsWith(p)) throw new Error('bukan data url: ' + (img && img.src));\n"
        + "if (Buffer.from(img.src.slice(p.length), 'base64').toString('utf8') !== svg) throw new Error('decode beda');\n"
        + "console.log('show OK');\n",
        encoding="utf-8")
    r = subprocess.run([node, str(harness)], capture_output=True, text=True)
    assert r.returncode == 0 and "show OK" in r.stdout, r.stdout + r.stderr
