"""Plugin Timeline (Fase 1, PR 1b, Task 11): records `calendar` terhadap server NYATA 1a-2 dengan index.json repo
(bukan indeks fixture) — D2/D4/D6 rencana 1b."""
import json
import uuid
from datetime import datetime, timezone

import pytest

import plugin_loader
import plugin_records as pr
import plugin_states
import webapp
from conftest import db as _rawdb, register_user

PID = "timeline"
URL = f"/api/plugins/{PID}/records"
CAL = {"v": 1, "weekdays": [1, 2, 3, 4, 5, 6], "national": True, "cutiBersama": False,
       "off": [{"d": "2026-12-24", "n": "Brückentag"}], "work": []}


class User:
    def __init__(self, client, prefix="tl"):
        name = f"{prefix}{uuid.uuid4().hex[:8]}"
        info = register_user(client, name, f"{name}@test.id")
        self.client, self.id, self.name = client, info["user_id"], name
        self.h = {"Authorization": f"Bearer {info['token']}"}

    def call(self, method, url, **kw):
        self.client.cookies.clear()
        return getattr(self.client, method)(url, headers=self.h, **kw)

    def get(self, url, **kw):
        return self.call("get", url, **kw)

    def post(self, url, **kw):
        return self.call("post", url, **kw)

    def send(self, *items):
        r = self.post(URL, json={"items": list(items)})
        assert r.status_code == 200, r.text
        return r.json()["results"]


def cal_item(cal_id="cal@user", scope="user", data=None, **kw):
    base = {"entity": "calendar", "id": cal_id, "scope": scope, "data": CAL if data is None else data,
            "deleted": False, "updated_at": plugin_states.iso(datetime.now(timezone.utc)), "base_version": None}
    base.update(kw)
    return base


def _sql(sql, *params):
    c = _rawdb()
    try:
        c.execute(sql, params)
        c.commit()
    finally:
        c.close()


def _mk_workspace(owner, *members):
    r = owner.post("/api/lists", json={"name": "ws"})
    assert r.status_code == 200, r.text
    lid = r.json()["id"]
    for m in members:
        _sql("INSERT INTO list_members (list_id, user_id, joined_at) VALUES (?, ?, datetime('now'))", lid, m.id)
    return lid


@pytest.fixture
def real_index(client):
    plugin_loader.load_known()  # static/plugins/index.json repo
    pr._reset_for_tests()
    yield client
    plugin_loader.load_known()
    pr._reset_for_tests()


def test_records_decl_from_repo_index(real_index):
    assert plugin_loader.records_decl("timeline") == {"calendar": {"conflict": "lww", "maxBytes": 16384}, "project": {"conflict": "lww", "maxBytes": 1024}}
    assert "timeline" in plugin_loader.load_known()
    assert plugin_loader.default_enabled("timeline") is False


def test_workspace_members_share_cal_list(real_index):
    owner, member, outsider = User(real_index), User(real_index), User(real_index)
    lid = _mk_workspace(owner, member)
    cid = f"cal@list:{lid}"
    scope = f"list:{lid}"
    # pemilik menulis, anggota membaca (kursor) lalu mengedit (update LWW dengan base_version) — K14
    r = owner.send(cal_item(cid, scope))[0]
    assert r["applied"] is True and r["record"]["version"] == 1 and r["record"]["scope"] == scope
    page = member.get(URL, params={"cursor": ""}).json()
    assert [(i["entity"], i["id"], i["scope"]) for i in page["items"]] == [("calendar", cid, scope)]
    assert page["items"][0]["data"] == CAL
    edit = dict(CAL, cutiBersama=True)
    r = member.send(cal_item(cid, scope, data=edit, base_version=1))[0]
    assert r["applied"] is True and r["record"]["version"] == 2
    again = owner.get(URL, params={"cursor": page["cursor"]}).json()
    assert [i["data"] for i in again["items"]] == [edit], "pemilik menerima perubahan anggota"
    # anggota yang menulis pertama kali (kalender belum ada) juga diterima
    lid2 = _mk_workspace(owner, member)
    r = member.send(cal_item(f"cal@list:{lid2}", f"list:{lid2}"))[0]
    assert r["applied"] is True
    # orang luar tidak boleh menulis, dan tidak melihat kalender workspace
    r = outsider.send(cal_item(cid, scope, data=CAL, base_version=2))[0]
    assert r.get("error") == "FORBIDDEN_SCOPE"
    assert [i for i in outsider.get(URL, params={"cursor": ""}).json()["items"] if i["id"] == cid] == []


def test_personal_calendar_is_private(real_index):
    a, b = User(real_index), User(real_index)
    assert a.send(cal_item("cal@user", "user"))[0]["applied"] is True
    assert [i["id"] for i in a.get(URL, params={"cursor": ""}).json()["items"]] == ["cal@user"]
    assert b.get(URL, params={"cursor": ""}).json()["items"] == []


def test_calendar_over_16k_rejected_and_undeclared_entity(real_index):
    a = User(real_index)
    big = dict(CAL, off=[{"d": "2026-01-01", "n": "x" * 17000}])
    res = a.send(cal_item("cal@user", "user", data=big))[0]
    assert (res.get("error"), res.get("detail")) == ("INVALID", "size"), res
    res = a.send(dict(cal_item(), entity="proyek"))[0]
    assert res.get("error") == "INVALID", res
    assert a.get(URL, params={"cursor": ""}).json()["items"] == []


def test_deploy_window_reads_index_again_before_404(real_index, monkeypatch, tmp_path):
    """D6: proses lama belum mengenal `timeline` saat indeks baru sudah ditulis → baca ulang sekali, bukan 404."""
    for name in ("_known", "_index_ok", "_index_path", "_permissions", "_records"):
        monkeypatch.setattr(plugin_loader, name, getattr(plugin_loader, name))
    repo_index = json.loads(plugin_loader.INDEX_PATH.read_text(encoding="utf-8"))
    entries = [p for p in repo_index["plugins"] if p["id"] != "timeline"]
    idx = tmp_path / "index.json"
    idx.write_text(json.dumps({"v": 1, "plugins": entries}), encoding="utf-8")
    plugin_loader.load_known(idx)
    assert plugin_loader.records_decl("timeline") == {}
    a = User(real_index)
    # indeks belum memuat timeline → 404 (setelah satu baca ulang yang tidak menemukannya)
    assert a.get(URL).status_code == 404
    # deploy menulis indeks baru berisi timeline (tanpa restart proses)
    idx.write_text(json.dumps(repo_index), encoding="utf-8")
    r = a.get(URL)
    assert r.status_code == 200, r.text
    assert a.send(cal_item())[0]["applied"] is True
    assert plugin_loader.records_decl("timeline") == {"calendar": {"conflict": "lww", "maxBytes": 16384}, "project": {"conflict": "lww", "maxBytes": 1024}}
