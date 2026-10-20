"""PUT /api/lists/pins/order (spec kelola-workspace-fase1 §1.4)."""
import uuid

from conftest import register_user


class U:
    def __init__(self, client, prefix="po"):
        name = f"{prefix}{uuid.uuid4().hex[:8]}"
        info = register_user(client, name, f"{name}@test.id")
        self.client = client
        self.id = info["user_id"]
        self.h = {"Authorization": f"Bearer {info['token']}"}

    def _call(self, method, url, **kw):
        self.client.cookies.clear()
        return getattr(self.client, method)(url, headers=self.h, **kw)

    def get(self, url, **kw): return self._call("get", url, **kw)
    def post(self, url, **kw): return self._call("post", url, **kw)
    def put(self, url, **kw): return self._call("put", url, **kw)


def _ws(u):
    r = u.post("/api/lists", json={"name": f"WS{uuid.uuid4().hex[:8]}"})
    assert r.status_code == 200, r.text
    return r.json()["id"]


def _setup(client, n=3):
    """User dengan n workspace; tepat 3 pertama (atau semua bila n<=3) di-pin."""
    u = U(client)
    ids = [_ws(u) for _ in range(n)]
    u.get("/api/lists")  # seed: <=3 workspace terbaru di-pin
    return u, ids


def _pins(u):
    items = [x for x in u.get("/api/lists").json() if x["pinned"]]
    return {x["id"]: x["pin_position"] for x in items}


def test_pin_order_success(client):
    u, (w1, w2, w3) = _setup(client)
    assert set(_pins(u)) == {w1, w2, w3}
    r = u.put("/api/lists/pins/order", json={"list_ids": [w3, w1, w2]})
    assert r.status_code == 200, r.text
    assert r.json() == {"ok": True, "list_ids": [w3, w1, w2]}
    assert _pins(u) == {w3: 0, w1: 1, w2: 2}


def test_pin_order_mismatch_missing(client):
    u, (w1, w2, w3) = _setup(client)
    before = _pins(u)
    r = u.put("/api/lists/pins/order", json={"list_ids": [w1, w2]})
    assert r.status_code == 409
    assert r.json()["detail"] == {"code": "PIN_ORDER_MISMATCH",
                                  "message": "Urutan pin sudah berubah di perangkat lain"}
    assert _pins(u) == before


def test_pin_order_mismatch_extra(client):
    u, ids = _setup(client, 4)
    pinned = list(_pins(u))
    assert len(pinned) == 3
    w4 = [i for i in ids if i not in pinned][0]
    r = u.put("/api/lists/pins/order", json={"list_ids": pinned + [w4]})
    assert r.status_code == 409
    assert r.json()["detail"]["code"] == "PIN_ORDER_MISMATCH"


def test_pin_order_duplicate(client):
    u, (w1, w2, w3) = _setup(client)
    before = _pins(u)
    r = u.put("/api/lists/pins/order", json={"list_ids": [w1, w1, w2]})
    assert r.status_code == 409
    r = u.put("/api/lists/pins/order", json={"list_ids": [w1, w1, w2, w3]})
    assert r.status_code == 409
    assert _pins(u) == before


def test_pin_order_other_users_untouched(client):
    u, (w1, w2, w3) = _setup(client)
    other = U(client)
    o1, o2 = _ws(other), _ws(other)
    other.get("/api/lists")
    before = _pins(other)
    assert u.put("/api/lists/pins/order", json={"list_ids": [w3, w2, w1]}).status_code == 200
    assert _pins(other) == before
    # list_ids milik user lain ditolak
    assert u.put("/api/lists/pins/order", json={"list_ids": [o1, o2]}).status_code == 409


def test_pin_order_empty_when_no_pins(client):
    u = U(client)
    r = u.put("/api/lists/pins/order", json={"list_ids": []})
    assert r.status_code == 200
    assert r.json() == {"ok": True, "list_ids": []}


def test_pin_order_bad_body_422(client):
    u = U(client)
    assert u.put("/api/lists/pins/order", json={"list_ids": "x"}).status_code == 422
    assert u.put("/api/lists/pins/order", json={}).status_code == 422
