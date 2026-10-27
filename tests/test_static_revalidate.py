"""Revalidasi aset precache SW (spec docs/superpowers/specs/2026-10-22-sw-precache-shell-design.md §3.3).

sw.js memasang precache dengan request ``cache: "no-cache"``: bila HTTP cache browser punya salinan, browser
mengirim request bersyarat (If-None-Match). StaticFiles harus menjawab 304 tanpa body untuk file yang tidak
berubah, supaya setiap rilis SW tidak mengunduh ulang seluruh shell. index.html ("/") tetap no-store sehingga
selalu diunduh penuh dan tidak pernah dijawab 304 dari salinan basi.
"""
import pytest


@pytest.mark.parametrize("url", [
    "/static/app.css",
    "/static/app.css?v=375",
    "/static/vendor/milkdown.bundle.js?v=289",  # query versi tidak mengganggu ETag/304
])
def test_static_asset_revalidates_with_etag_304(client, url):
    first = client.get(url)
    assert first.status_code == 200
    etag = first.headers.get("etag")
    assert etag, "StaticFiles harus mengirim ETag"
    assert first.content

    again = client.get(url, headers={"If-None-Match": etag})
    assert again.status_code == 304
    assert again.content == b""
    assert again.headers.get("etag") == etag


def test_index_html_stays_no_store(client):
    r = client.get("/")
    assert r.status_code == 200
    assert "no-store" in r.headers.get("cache-control", "")
    assert "etag" not in r.headers

    # request bersyarat tetap mendapat isi penuh
    r2 = client.get("/", headers={"If-None-Match": '"apa-saja"', "If-Modified-Since": "Thu, 01 Jan 2099 00:00:00 GMT"})
    assert r2.status_code == 200
    assert r2.content == r.content
