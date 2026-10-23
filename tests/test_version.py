import os, re, shutil
import webapp

SW = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "static", "sw.js")

def _cache_name(path=SW):
    return re.search(r'^const CACHE = "([^"]+)";', open(path, encoding="utf-8").read(), re.M).group(1)

def test_get_app_version(client):
    r = client.get("/api/version")
    assert r.status_code == 200
    d = r.json()
    assert d["app_version"] == "4.0.0"
    assert d["sw_version"] == _cache_name() == d["cache_name"]
    assert isinstance(d["timestamp"], int) and d["timestamp"] > 0
    cc = r.headers.get("Cache-Control", "")
    assert "no-cache" in cc and "no-store" in cc and "must-revalidate" in cc
    assert r.headers.get("Pragma") == "no-cache" and r.headers.get("Expires") == "0"

def test_version_follows_sw_js_without_restart(client, tmp_path, monkeypatch):
    shutil.copy(SW, tmp_path / "sw.js")
    monkeypatch.setattr(webapp, "STATIC_DIR", tmp_path)
    assert client.get("/api/version").json()["sw_version"] == _cache_name()
    p = tmp_path / "sw.js"
    p.write_text(re.sub(r'^const CACHE = "[^"]+";', 'const CACHE = "taskflow-v999-uji";', p.read_text(encoding="utf-8"), flags=re.M), encoding="utf-8")
    st = os.stat(p); os.utime(p, ns=(st.st_atime_ns, st.st_mtime_ns + 2_000_000_000))
    assert client.get("/api/version").json()["sw_version"] == "taskflow-v999-uji"

def test_version_500_when_sw_missing(client, tmp_path, monkeypatch):
    monkeypatch.setattr(webapp, "STATIC_DIR", tmp_path)
    r = client.get("/api/version")
    assert r.status_code == 500
    assert r.json()["detail"] == "SW version unavailable"

def test_webapp_has_no_hardcoded_sw_version():
    src = open(os.path.join(os.path.dirname(SW), "..", "webapp.py"), encoding="utf-8").read()
    assert 'sw_cache = "' not in src

def test_serve_sw_headers(client):
    r = client.get("/sw.js")
    assert r.status_code == 200
    assert r.headers.get("Service-Worker-Allowed") == "/"

    cc = r.headers.get("Cache-Control", "")
    assert "no-cache" in cc
    assert "no-store" in cc
    assert "must-revalidate" in cc
    assert "max-age=0" in cc
    assert r.headers.get("Pragma") == "no-cache"
    assert r.headers.get("Expires") == "0"
