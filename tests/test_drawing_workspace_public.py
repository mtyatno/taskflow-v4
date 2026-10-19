"""Halaman publik dan ekspor DOCX mengikuti akses drawing milik workspace (PR 2, Task 5).

Spec §3 (aturan PR 1 tetap berlaku: note tepercaya, gerbang password, 404 seragam, tanpa judul/id note sebagai kunci)
dan §4.3 butir terakhir: setelah PR 2, drawing tampil di note publish bersama di W bila drawings.list_id = W.
DB tes dipakai bersama satu sesi pytest: username, judul, client_id, dan marker dibuat unik.
"""
import io
import uuid

import docx

import webapp
from conftest import db
from drawing_ws_helpers import add_member, auth, drawing_row, make_drawing, uid_of, workspace
from test_pub_access import _publish, _unlock_cookie, _svg, anon


def _tag():
    return uuid.uuid4().hex[:10]


def _set_list(did, list_id):
    conn = db()
    try:
        conn.execute("UPDATE drawings SET list_id = ? WHERE id = ?", (list_id, did))
        conn.commit()
    finally:
        conn.close()


def test_shared_published_note_shows_workspace_drawing(client):
    tag = _tag()
    ha = auth(client, f"pwa_{tag}")
    w = workspace(client, ha, f"W {tag}")
    marker = f"MARKER-WS-{tag}"
    d = make_drawing(client, ha, f"gws-{tag}", cid=f"cid-ws-{tag}", list_id=w, svg=_svg(marker))
    assert drawing_row(d["id"])["list_id"] == w
    _, slug, username = _publish(client, ha, f"Note W {tag}", f"::draw[{d['id']}]\n\n::draw[{d['client_id']}]", list_id=w)
    pub = anon()
    page = pub.get(f"/pub/{username}/{slug}")
    assert page.status_code == 200
    assert marker in page.text
    assert "Gambar tidak tersedia" not in page.text
    assert pub.get(f"/pub/drawings/{d['id']}").status_code == 200
    assert pub.get(f"/pub/drawings/{d['client_id']}").status_code == 200


def test_shared_published_note_hides_non_workspace_drawing(client):
    """Anggota B menyisipkan ::draw[k] (k pribadi milik A, pemilik note) ke note W yang dipublish."""
    tag = _tag()
    ha = auth(client, f"pwo_{tag}")
    hb = auth(client, f"pwm_{tag}")
    w = workspace(client, ha, f"W {tag}")
    add_member(w, uid_of(f"pwm_{tag}"))
    marker = f"MARKER-K-{tag}"
    k = make_drawing(client, ha, f"k-{tag}", cid=f"cid-k-{tag}", svg=_svg(marker))
    nid, slug, username = _publish(client, ha, f"Note W {tag}", "awal", list_id=w)
    r = client.put(f"/api/scratchpad/{nid}", json={"content": f"::draw[{k['id']}]\n\n::draw[{k['client_id']}]"}, headers=hb)
    assert r.status_code == 200, r.text
    pub = anon()
    page = pub.get(f"/pub/{username}/{slug}")
    assert page.status_code == 200
    assert marker not in page.text
    assert "Gambar tidak tersedia" in page.text
    assert pub.get(f"/pub/drawings/{k['id']}").status_code == 404
    assert pub.get(f"/pub/drawings/{k['client_id']}").status_code == 404
    assert drawing_row(k["id"])["list_id"] is None


def test_shared_published_note_other_workspace_drawing_hidden(client):
    """Drawing di workspace LAIN (walau A anggotanya) tidak tampil di note W1: list_id harus sama dengan note."""
    tag = _tag()
    ha = auth(client, f"pwx_{tag}")
    w1 = workspace(client, ha, f"W1 {tag}")
    w2 = workspace(client, ha, f"W2 {tag}")
    marker = f"MARKER-W2-{tag}"
    d = make_drawing(client, ha, f"w2-{tag}", cid=f"cid-w2-{tag}", list_id=w2, svg=_svg(marker))
    _, slug, username = _publish(client, ha, f"Note W1 {tag}", "awal", list_id=w1)
    conn = db()
    try:
        conn.execute("UPDATE scratchpad_notes SET content = ? WHERE id = (SELECT note_id FROM published_notes WHERE slug = ?)",
                     (f"::draw[{d['id']}]", slug))
        conn.commit()
    finally:
        conn.close()
    pub = anon()
    assert marker not in pub.get(f"/pub/{username}/{slug}").text
    assert pub.get(f"/pub/drawings/{d['id']}").status_code == 404


def test_owner_save_after_member_injection_keeps_drawing_off_public_page(client):
    tag = _tag()
    ha = auth(client, f"pwi_{tag}")
    hb = auth(client, f"pwj_{tag}")
    w = workspace(client, ha, f"W {tag}")
    add_member(w, uid_of(f"pwj_{tag}"))
    marker = f"MARKER-INJ-{tag}"
    k = make_drawing(client, ha, f"k-{tag}", cid=f"cid-inj-{tag}", svg=_svg(marker))
    nid, slug, username = _publish(client, ha, f"Note W {tag}", "awal", list_id=w)
    r = client.put(f"/api/scratchpad/{nid}", json={"title": "t", "content": f"awal ::draw[{k['id']}]"}, headers=hb)
    assert r.status_code == 200, r.text
    r = client.put(f"/api/scratchpad/{nid}", json={"title": "t", "content": f"awal edit ::draw[{k['id']}]"}, headers=ha)
    assert r.status_code == 200, r.text
    assert drawing_row(k["id"])["list_id"] is None
    pub = anon()
    assert marker not in pub.get(f"/pub/{username}/{slug}").text
    assert pub.get(f"/pub/drawings/{k['id']}").status_code == 404


def test_owner_save_after_uppercase_injection_keeps_drawing_off_public_page(client):
    tag = _tag()
    ha = auth(client, f"pwu_{tag}")
    hb = auth(client, f"pwv_{tag}")
    w = workspace(client, ha, f"W {tag}")
    add_member(w, uid_of(f"pwv_{tag}"))
    marker = f"MARKER-UP-{tag}"
    k = make_drawing(client, ha, f"ku-{tag}", cid=f"cid-up-{tag}", svg=_svg(marker))
    nid, slug, username = _publish(client, ha, f"Note W {tag}", "awal", list_id=w)
    r = client.put(f"/api/scratchpad/{nid}", json={"title": "t", "content": f"awal ::DRAW[{k['id']}]"}, headers=hb)
    assert r.status_code == 200, r.text
    r = client.put(f"/api/scratchpad/{nid}", json={"title": "t", "content": f"awal edit ::draw[{k['id']}]{{title=\"x\"}}"}, headers=ha)
    assert r.status_code == 200, r.text
    assert drawing_row(k["id"])["list_id"] is None
    pub = anon()
    assert marker not in pub.get(f"/pub/{username}/{slug}").text
    assert pub.get(f"/pub/drawings/{k['id']}").status_code == 404


def test_shared_published_note_password_gate(client):
    tag = _tag()
    ha = auth(client, f"pwp_{tag}")
    w = workspace(client, ha, f"W {tag}")
    marker = f"MARKER-PW-{tag}"
    d = make_drawing(client, ha, f"pw-{tag}", list_id=w, svg=_svg(marker))
    _, slug, username = _publish(client, ha, f"Note W {tag}", f"::draw[{d['id']}]", password="rahasia123", list_id=w)
    pub = anon()
    assert pub.get(f"/pub/drawings/{d['id']}").status_code == 404
    assert marker not in pub.get(f"/pub/{username}/{slug}").text
    assert pub.get(f"/pub/drawings/{d['id']}", headers=_unlock_cookie(slug)).status_code == 200
    assert marker in pub.get(f"/pub/{username}/{slug}", headers=_unlock_cookie(slug)).text


def test_trusted_note_shows_publisher_accessible_workspace_drawing(client):
    """Note pribadi A (tepercaya) merujuk drawing W milik B (A anggota W): tampil."""
    tag = _tag()
    ha = auth(client, f"pta_{tag}")
    hb = auth(client, f"ptb_{tag}")
    w = workspace(client, hb, f"W {tag}")
    add_member(w, uid_of(f"pta_{tag}"))
    marker = f"MARKER-TB-{tag}"
    d = make_drawing(client, hb, f"tb-{tag}", cid=f"cid-tb-{tag}", list_id=w, svg=_svg(marker))
    _, slug, username = _publish(client, ha, f"Note A {tag}", f"::draw[{d['id']}]")
    pub = anon()
    assert marker in pub.get(f"/pub/{username}/{slug}").text
    assert pub.get(f"/pub/drawings/{d['id']}").status_code == 200


def test_trusted_note_still_hides_inaccessible_drawing(client):
    tag = _tag()
    ha = auth(client, f"pia_{tag}")
    hc = auth(client, f"pic_{tag}")
    marker = f"MARKER-C-{tag}"
    c = make_drawing(client, hc, f"c-{tag}", cid=f"cid-c-{tag}", svg=_svg(marker))
    w = workspace(client, hc, f"Wc {tag}")  # A bukan anggota
    cw = make_drawing(client, hc, f"cw-{tag}", list_id=w, svg=_svg(marker + "W"))
    _, slug, username = _publish(client, ha, f"Note A {tag}", f"::draw[{c['id']}]\n\n::draw[{cw['id']}]")
    pub = anon()
    page = pub.get(f"/pub/{username}/{slug}")
    assert marker not in page.text
    assert "Gambar tidak tersedia" in page.text
    assert pub.get(f"/pub/drawings/{c['id']}").status_code == 404
    assert pub.get(f"/pub/drawings/{cw['id']}").status_code == 404


def _docx_text(client, headers, content, note_id=None):
    r = client.post("/api/scratchpad/export/docx", headers=headers,
                    json={"note_id": note_id, "title": "Ekspor", "content": content})
    assert r.status_code == 200, r.text
    d = docx.Document(io.BytesIO(r.content))
    return "\n".join(p.text for p in d.paragraphs), len(d.inline_shapes)


def test_export_docx_resolves_member_accessible_drawing(client):
    tag = _tag()
    ha = auth(client, f"exa_{tag}")
    hb = auth(client, f"exb_{tag}")
    w = workspace(client, ha, f"W {tag}")
    add_member(w, uid_of(f"exb_{tag}"))
    dw = make_drawing(client, ha, f"dw-{tag}", cid=f"cid-dw-{tag}", list_id=w, svg=_svg("DW"))
    dp = make_drawing(client, ha, f"dp-{tag}", cid=f"cid-dp-{tag}", svg=_svg("DP"))
    text, pics = _docx_text(client, hb, f"::draw[{dw['id']}]{{title=\"x\"}}")
    assert pics == 1 and "[Gambar/Canvas" not in text
    text, pics = _docx_text(client, hb, f"::draw[{dw['client_id']}]")
    assert pics == 1
    text, pics = _docx_text(client, hb, f"::draw[{dp['id']}]\n\n::draw[{dp['client_id']}]")
    assert pics == 0 and "[Gambar/Canvas" in text
    # heuristik judul tidak menjangkau drawing pribadi A
    text, pics = _docx_text(client, hb, f"::draw[tidak-ada]{{title=\"{dp['title']}\"}}")
    assert pics == 0
    # heuristik judul menjangkau drawing W yang bisa diakses B
    text, pics = _docx_text(client, hb, f"::draw[tidak-ada]{{title=\"{dw['title']}\"}}")
    assert pics == 1
