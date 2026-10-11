import pytest


def test_get_app_version(client):
    r = client.get("/api/version")
    assert r.status_code == 200
    data = r.json()
    assert data["app_version"] == "4.0.0"
    assert data["sw_version"] == "taskflow-v383-app-update-notifier"
    assert data["cache_name"] == "taskflow-v383-app-update-notifier"
    assert isinstance(data["timestamp"], int)
    assert data["timestamp"] > 0

    # Cache control headers
    cc = r.headers.get("Cache-Control", "")
    assert "no-cache" in cc
    assert "no-store" in cc
    assert "must-revalidate" in cc
    assert r.headers.get("Pragma") == "no-cache"
    assert r.headers.get("Expires") == "0"


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
