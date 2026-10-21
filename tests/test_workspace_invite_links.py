"""Link undangan workspace: masa berlaku, batas pemakaian, pembatalan (spec fase2a §1.3)."""
import threading
import uuid
from datetime import datetime, timedelta

import webapp
from conftest import db, register_user
from repository import TaskRepository


class U:
    def __init__(self, client, prefix="lk"):
        name = f"{prefix}{uuid.uuid4().hex[:8]}"
        info = register_user(client, name, f"{name}@test.id")
        self.client = client
        self.name = name
        self.id = info["user_id"]
        self.h = {"Authorization": f"Bearer {info['token']}"}

    def _call(self, method, url, **kw):
        self.client.cookies.clear()
        return getattr(self.client, method)(url, headers=self.h, **kw)

    def get(self, url, **kw): return self._call("get", url, **kw)
    def post(self, url, **kw): return self._call("post", url, **kw)
    def delete(self, url, **kw): return self._call("delete", url, **kw)


def _ws(u):
    r = u.post("/api/lists", json={"name": f"WS{uuid.uuid4().hex[:8]}"})
    assert r.status_code == 200, r.text
    return r.json()["id"]


def _gen(u, lid, **body):
    return u.post(f"/api/lists/{lid}/generate-link", json=body)


def _row(code):
    conn = db()
    r = conn.execute("SELECT * FROM list_invites WHERE code=?", (code,)).fetchone()
    conn.close()
    return dict(r)


def _set(code, **cols):
    conn = db()
    sets = ", ".join(f"{k}=?" for k in cols)
    conn.execute(f"UPDATE list_invites SET {sets} WHERE code=?", (*cols.values(), code))
    conn.commit()
    conn.close()


def test_generate_defaults_1d_single_use(client):
    o = U(client)
    lid = _ws(o)
    r = _gen(o, lid)
    assert r.status_code == 200, r.text
    j = r.json()
    assert j["max_uses"] == 1 and j["uses"] == 0
    assert j["code"] in j["join_url"]
    exp = datetime.fromisoformat(j["expires_at"])
    assert exp.tzinfo is not None
    assert timedelta(hours=23) < exp - datetime.now().astimezone() <= timedelta(hours=24, seconds=5)
    assert _row(j["code"])["created_at"]


def test_generate_options_valid(client):
    o = U(client)
    lid = _ws(o)
    r = _gen(o, lid, expires_in="1h", max_uses=10).json()
    assert r["max_uses"] == 10
    assert timedelta(minutes=59) < datetime.fromisoformat(r["expires_at"]) - datetime.now().astimezone() <= timedelta(hours=1, seconds=5)
    r = _gen(o, lid, expires_in="7d", max_uses=None).json()
    assert r["max_uses"] is None
    assert timedelta(days=6, hours=23) < datetime.fromisoformat(r["expires_at"]) - datetime.now().astimezone()


def test_generate_invalid_options_422(client):
    o = U(client)
    lid = _ws(o)
    assert _gen(o, lid, expires_in="2d").status_code == 422
    assert _gen(o, lid, max_uses=5).status_code == 422


def test_non_owner_links_403(client):
    o, x = U(client), U(client)
    lid = _ws(o)
    code = _gen(o, lid).json()["code"]
    assert _gen(x, lid).status_code == 403
    assert x.get(f"/api/lists/{lid}/links").status_code == 403
    assert x.delete(f"/api/lists/{lid}/links/{code}").status_code == 403
    assert x.delete(f"/api/lists/{lid}/links").status_code == 403


def test_links_lists_active_only(client):
    o = U(client)
    lid = _ws(o)
    ok = _gen(o, lid, max_uses=None).json()["code"]
    revoked = _gen(o, lid).json()["code"]
    expired = _gen(o, lid).json()["code"]
    full = _gen(o, lid).json()["code"]
    assert o.delete(f"/api/lists/{lid}/links/{revoked}").status_code == 200
    _set(expired, expires_at=(datetime.now() - timedelta(minutes=1)).isoformat())
    _set(full, uses=1)
    r = o.get(f"/api/lists/{lid}/links")
    assert r.status_code == 200
    items = r.json()
    assert [i["code"] for i in items] == [ok]
    assert set(items[0]) >= {"code", "join_url", "expires_at", "max_uses", "uses", "created_at"}


def test_revoke_one_and_all(client):
    o = U(client)
    lid = _ws(o)
    other = _ws(o)
    a = _gen(o, lid).json()["code"]
    b = _gen(o, lid).json()["code"]
    c = _gen(o, lid).json()["code"]
    oc = _gen(o, other).json()["code"]
    assert o.delete(f"/api/lists/{lid}/links/{oc}").status_code == 404
    assert o.delete(f"/api/lists/{lid}/links/nope").status_code == 404
    assert o.delete(f"/api/lists/{lid}/links/{a}").status_code == 200
    r = o.delete(f"/api/lists/{lid}/links")
    assert r.status_code == 200 and r.json() == {"revoked": 2}
    assert o.get(f"/api/lists/{lid}/links").json() == []
    assert _row(b)["revoked_at"] and _row(c)["revoked_at"]
    assert _row(oc)["revoked_at"] is None


def test_single_use_second_person_full(client):
    o, p1, p2 = U(client), U(client), U(client)
    lid = _ws(o)
    code = _gen(o, lid).json()["code"]
    assert p1.post("/api/lists/join", json={"code": code}).status_code == 200
    r = p2.post("/api/lists/join", json={"code": code})
    assert r.status_code == 400
    assert r.json()["detail"] == "Link sudah mencapai batas pemakaian."
    assert _row(code)["used"] == 1 and _row(code)["uses"] == 1


def test_unlimited_two_people(client):
    o, p1, p2 = U(client), U(client), U(client)
    lid = _ws(o)
    code = _gen(o, lid, max_uses=None).json()["code"]
    assert p1.post("/api/lists/join", json={"code": code}).status_code == 200
    assert p2.post("/api/lists/join", json={"code": code}).status_code == 200
    assert _row(code)["uses"] == 2 and _row(code)["used"] == 0


def test_member_join_does_not_consume(client):
    o, p = U(client), U(client)
    lid = _ws(o)
    code = _gen(o, lid).json()["code"]
    r = o.post("/api/lists/join", json={"code": code})
    assert r.status_code == 400 and r.json()["detail"] == "Kamu adalah owner list ini."
    assert p.post("/api/lists/join", json={"code": code}).status_code == 200
    code2 = _gen(o, lid).json()["code"]
    r = p.post("/api/lists/join", json={"code": code2})
    assert r.status_code == 400 and r.json()["detail"] == "Kamu sudah menjadi anggota list ini."
    assert _row(code2)["uses"] == 0


def test_preview_and_join_error_messages(client):
    o, p = U(client), U(client)
    lid = _ws(o)

    def both(code, msg):
        for resp in (p.get(f"/api/lists/preview/{code}"), p.post("/api/lists/join", json={"code": code})):
            assert resp.status_code == 400, resp.text
            assert resp.json()["detail"] == msg

    both("tidak-ada", "Kode tidak valid.")
    rv = _gen(o, lid).json()["code"]
    o.delete(f"/api/lists/{lid}/links/{rv}")
    both(rv, "Link sudah dibatalkan owner.")
    ex = _gen(o, lid).json()["code"]
    _set(ex, expires_at=(datetime.now() - timedelta(minutes=1)).isoformat())
    both(ex, "Link sudah kedaluwarsa.")
    fu = _gen(o, lid).json()["code"]
    _set(fu, uses=1)
    both(fu, "Link sudah mencapai batas pemakaian.")
    ok = _gen(o, lid).json()["code"]
    pv = p.get(f"/api/lists/preview/{ok}").json()
    assert pv["owner_name"] and pv["member_count"] == 1 and pv["list_id"] == lid


def test_concurrent_join_last_use(client):
    o = U(client)
    lid = _ws(o)
    code = _gen(o, lid).json()["code"]
    repo = TaskRepository(webapp.DB_PATH)
    res = []
    barrier = threading.Barrier(2)

    def run():
        barrier.wait()
        res.append(repo.consume_list_invite(code))

    ts = [threading.Thread(target=run) for _ in range(2)]
    [t.start() for t in ts]
    [t.join() for t in ts]
    assert sorted(x is None for x in res) == [False, True]
    assert _row(code)["uses"] == 1


def test_legacy_invite_backfill(client):
    o, p1, p2 = U(client), U(client), U(client)
    lid = _ws(o)
    exp = datetime.now() + timedelta(hours=10)
    conn = db()
    for code, used in (("legacy-open", 0), ("legacy-used", 1)):
        conn.execute("INSERT INTO list_invites (code, list_id, created_by, expires_at, used) VALUES (?,?,?,?,?)",
                     (code, lid, o.id, exp.isoformat(), used))
    conn.commit()
    conn.close()
    webapp.migrate_db()
    webapp.migrate_db()  # idempoten
    r = _row("legacy-open")
    assert r["max_uses"] == 1 and r["uses"] == 0
    assert datetime.fromisoformat(r["created_at"]) == exp - timedelta(hours=48)
    assert _row("legacy-used")["uses"] == 1
    assert p1.post("/api/lists/join", json={"code": "legacy-open"}).status_code == 200
    r = p2.post("/api/lists/join", json={"code": "legacy-open"})
    assert r.json()["detail"] == "Link sudah mencapai batas pemakaian."
    r = p2.post("/api/lists/join", json={"code": "legacy-used"})
    assert r.json()["detail"] == "Link sudah mencapai batas pemakaian."


def test_link_and_preview_timestamps_offset_aware(client):
    o, p = U(client), U(client)
    lid = _ws(o)
    code = _gen(o, lid).json()["code"]
    links = o.get(f"/api/lists/{lid}/links").json()
    assert links and all(datetime.fromisoformat(x["expires_at"]).tzinfo is not None
                         and datetime.fromisoformat(x["created_at"]).tzinfo is not None for x in links)
    pv = p.get(f"/api/lists/preview/{code}").json()
    assert datetime.fromisoformat(pv["expires_at"]).tzinfo is not None
    # penyimpanan tetap naive; instan sama
    raw = _row(code)["expires_at"]
    assert datetime.fromisoformat(raw).tzinfo is None
    assert datetime.fromisoformat(pv["expires_at"]) == datetime.fromisoformat(raw).astimezone()


def test_double_join_spends_one_use(client):
    o, p = U(client), U(client)
    lid = _ws(o)
    code = _gen(o, lid, max_uses=10).json()["code"]
    assert p.post("/api/lists/join", json={"code": code}).status_code == 200
    r = p.post("/api/lists/join", json={"code": code})
    assert r.status_code == 400 and r.json()["detail"] == "Kamu sudah menjadi anggota list ini."
    assert _row(code)["uses"] == 1


def test_single_use_double_submit_gets_already_member(client):
    o, p = U(client), U(client)
    lid = _ws(o)
    code = _gen(o, lid).json()["code"]
    assert p.post("/api/lists/join", json={"code": code}).status_code == 200
    r = p.post("/api/lists/join", json={"code": code})
    assert r.status_code == 400 and r.json()["detail"] == "Kamu sudah menjadi anggota list ini."


def test_join_via_invite_rolls_back_when_already_member(client):
    o, p = U(client), U(client)
    lid = _ws(o)
    code = _gen(o, lid, max_uses=10).json()["code"]
    repo = TaskRepository(webapp.DB_PATH)
    assert repo.join_list_via_invite(code, p.id) == {"status": "ok", "list_id": lid}
    assert repo.join_list_via_invite(code, p.id) == {"status": "already_member", "list_id": lid}
    assert repo.join_list_via_invite(code, o.id) == {"status": "owner", "list_id": lid}
    assert _row(code)["uses"] == 1


def test_concurrent_same_user_join_single_use(client):
    o, p = U(client), U(client)
    lid = _ws(o)
    code = _gen(o, lid).json()["code"]
    repo = TaskRepository(webapp.DB_PATH)
    res = []
    barrier = threading.Barrier(2)

    def run():
        barrier.wait()
        res.append(repo.join_list_via_invite(code, p.id)["status"])

    ts = [threading.Thread(target=run) for _ in range(2)]
    [t.start() for t in ts]
    [t.join() for t in ts]
    assert res.count("ok") == 1
    assert _row(code)["uses"] == 1
    conn = db()
    n = conn.execute("SELECT COUNT(*) FROM list_members WHERE list_id=? AND user_id=?", (lid, p.id)).fetchone()[0]
    conn.close()
    assert n == 1


def test_rerevoke_own_link_200_other_workspace_404(client):
    o = U(client)
    lid, lid2 = _ws(o), _ws(o)
    code = _gen(o, lid).json()["code"]
    assert o.delete(f"/api/lists/{lid}/links/{code}").status_code == 200
    first = _row(code)["revoked_at"]
    assert o.delete(f"/api/lists/{lid}/links/{code}").status_code == 200
    assert _row(code)["revoked_at"] == first
    assert o.delete(f"/api/lists/{lid2}/links/{code}").status_code == 404
