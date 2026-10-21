"""Helper bersama tes komentar note (dipakai Task 2-7)."""
import os

from conftest import register_user
from repository import TaskRepository


class U:
    def __init__(self, client, name):
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
    def put(self, url, **kw): return self._call("put", url, **kw)
    def patch(self, url, **kw): return self._call("patch", url, **kw)
    def delete(self, url, **kw): return self._call("delete", url, **kw)


def shared_note(owner, members, title):
    """Buat workspace (owner + members) dan note di dalamnya -> (note_id, list_id)."""
    repo = TaskRepository(os.environ["DB_PATH"])
    lst = repo.create_shared_list(f"WS {title}", owner.id)
    for m in members:
        repo.add_list_member(lst["id"], m.id)
    r = owner.post("/api/scratchpad", json={"title": title, "content": "isi", "list_id": lst["id"]})
    assert r.status_code == 200, r.text
    return r.json()["id"], lst["id"]


def private_note(owner, title):
    r = owner.post("/api/scratchpad", json={"title": title, "content": "isi"})
    assert r.status_code == 200, r.text
    return r.json()["id"]
