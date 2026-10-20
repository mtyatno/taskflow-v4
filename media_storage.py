"""Penyimpanan file media (lokal). Modul murni: tidak mengimpor webapp."""
import os
import re
import uuid
from datetime import datetime
from pathlib import Path

_KEY_RE = re.compile(r"^\d{4}/\d{2}/[0-9a-f-]{36}(\.poster\.jpg|\.[a-z0-9]{2,4})$")
ACCEL_PREFIX = "/_alurik_media/"


def new_key(ext: str, now: datetime) -> str:
    return f"{now.year:04d}/{now.month:02d}/{uuid.uuid4()}{ext}"


def poster_key_for(key: str) -> str:
    return key.rsplit(".", 1)[0] + ".poster.jpg"


def is_valid_key(key) -> bool:
    return isinstance(key, str) and _KEY_RE.fullmatch(key) is not None


class LocalStorage:
    def __init__(self, root):
        self.root = Path(root)

    def temp_path(self, att_id: int) -> Path:
        d = self.root / ".tmp"
        d.mkdir(parents=True, exist_ok=True)
        return d / f"{att_id}.part"

    def path(self, key: str) -> Path:
        if not is_valid_key(key):
            raise ValueError("kunci media tidak valid")
        return self.root / key

    def commit(self, key: str, src: Path) -> None:
        dest = self.path(key)
        dest.parent.mkdir(parents=True, exist_ok=True)
        os.replace(src, dest)

    def delete(self, key) -> None:
        if not key:
            return
        try:
            self.path(key).unlink()
        except FileNotFoundError:
            pass

    def accel_uri(self, key: str) -> str:
        self.path(key)  # validasi
        return ACCEL_PREFIX + key


def get_storage(name: str, root: str) -> LocalStorage:
    if name == "local":
        return LocalStorage(Path(root))
    if name == "r2":
        raise NotImplementedError("penyimpanan r2 belum tersedia")
    raise ValueError(f"penyimpanan tidak dikenal: {name}")
