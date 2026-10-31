"""
Alurik — loader modul server plugin (`plugins/<id>.py`), dipakai web dan bot.
Spec Fase 0b K6–K10, §4.4; rencana PR B R1, R3–R6; ADR-039.

- `load_known()` membaca `static/plugins/index.json` (ditulis `compile.js`) → id dikenal + `defaultEnabled`.
- `discover()` memindai `plugins/*.py` (bukan `_*`), mengimpor terisolasi, memvalidasi kontrak.
- `migrate()` (hanya web, dari `migrate_db`) = skema `plugin_states` + `ensure_schema` tiap plugin, masing-masing
  dalam `write_tx` dengan pagar nama `plg_<id_>_`; tidak pernah melempar.
- `mount()`/`init_web()` memasang router di `/api/plugins/<id>` dengan login + cek plugin aktif.
- `load_for_bot()` = indeks + discover, tanpa DDL dan tanpa router.

Satu plugin rusak tidak pernah menjatuhkan web, bot, atau `migrate_db` (`deploy.yml` memakai `set -e`).
"""
from __future__ import annotations

import importlib.util
import inspect
import json
import logging
import re
import sys
import types
from dataclasses import dataclass
from pathlib import Path
from types import ModuleType
from typing import Callable

from fastapi import APIRouter, Depends, HTTPException
from fastapi.routing import APIRoute

import dbconn
import plugin_host

logger = logging.getLogger("alurik.plugins")

ROOT = Path(__file__).parent
PLUGINS_DIR = ROOT / "plugins"
INDEX_PATH = ROOT / "static" / "plugins" / "index.json"

ID_RE = re.compile(r"^[a-z][a-z0-9-]{2,31}$")
RESERVED_IDS = frozenset({"state"})
MODULE_PREFIX = "alurik_plugins"

# Simbol kontrak B11 yang belum didukung: plugin yang memilikinya ditolak utuh (K7, R6).
PENDING_HOOKS = {"on_task_written": "Fase 1", "jobs": None, "register_bot": None, "intake": None}

_known: dict[str, dict] = {}
_index_ok: bool = False
_index_path = INDEX_PATH
_loaded: list = []
_health: dict[str, str] = {}


@dataclass(frozen=True)
class LoadedPlugin:
    id: str
    module: ModuleType
    router: APIRouter | None
    ensure_schema: Callable | None


class PluginRejected(Exception):
    pass


class SchemaViolation(Exception):
    pass


# ── Indeks ────────────────────────────────────────────────────────────────────

def _read_index(index_path) -> dict[str, dict]:
    data = json.loads(Path(index_path).read_text(encoding="utf-8"))
    items = data.get("plugins") if isinstance(data, dict) else None
    if not isinstance(items, list):
        raise ValueError("'plugins' bukan list")
    known = {}
    for it in items:
        if not isinstance(it, dict) or not isinstance(it.get("id"), str):
            raise ValueError("entri plugin tanpa id")
        known[it["id"]] = {"defaultEnabled": it.get("defaultEnabled") is True}
    return known


def load_known(index_path=INDEX_PATH) -> dict[str, dict]:
    """Baca indeks plugin. Gagal/bentuk salah → `{}` + `index_ok() is False` + log ERROR; tidak melempar."""
    global _known, _index_ok, _index_path
    _index_path = index_path
    try:
        known = _read_index(index_path)
    except Exception as e:  # noqa: BLE001 — indeks rusak tidak boleh menjatuhkan proses
        logger.error("plugin server: indeks %s tidak terbaca (%s: %s)", index_path, type(e).__name__, e)
        _known, _index_ok = {}, False
        return {}
    _known, _index_ok = known, True
    return dict(known)


def refresh_known() -> dict[str, dict]:
    """Baca ulang indeks terakhir (deploy menulis `index.json` baru sebelum proses di-restart). Hanya mengganti
    daftar bila berhasil; gagal → daftar lama tetap dipakai (log WARNING). Modul server plugin TIDAK dimuat ulang."""
    global _known, _index_ok
    try:
        known = _read_index(_index_path)
    except Exception as e:  # noqa: BLE001
        logger.warning("plugin server: baca ulang indeks %s gagal (%s: %s)", _index_path, type(e).__name__, e)
        return dict(_known)
    _known, _index_ok = known, True
    return dict(known)


def known() -> dict:
    return dict(_known)


def index_ok() -> bool:
    return _index_ok


def default_enabled(pid: str) -> bool:
    return bool(_known.get(pid, {}).get("defaultEnabled", False))


def is_valid_id(pid) -> bool:
    return isinstance(pid, str) and bool(ID_RE.match(pid)) and pid not in RESERVED_IDS


# ── Discover ──────────────────────────────────────────────────────────────────

def _module_name(pid: str) -> str:
    return f"{MODULE_PREFIX}.{pid.replace('-', '_')}"


def _ensure_package() -> None:
    if MODULE_PREFIX not in sys.modules:
        pkg = types.ModuleType(MODULE_PREFIX)
        pkg.__path__ = []  # namespace kosong; modul plugin didaftarkan manual
        sys.modules[MODULE_PREFIX] = pkg


def _import(pid: str, path: Path) -> ModuleType:
    name = _module_name(pid)
    _ensure_package()
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise PluginRejected("import gagal: spec tidak dapat dibuat")
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod  # R5: pydantic/anotasi butuh modul ada di sys.modules saat exec
    try:
        spec.loader.exec_module(mod)
    except KeyboardInterrupt:
        sys.modules.pop(name, None)
        raise
    except BaseException as e:  # noqa: BLE001 — termasuk SystemExit dari plugin (R5)
        sys.modules.pop(name, None)
        raise PluginRejected(f"import gagal: {type(e).__name__}: {e}") from None
    return mod


def _accepts_one_positional(fn) -> bool:
    if not callable(fn):
        return False
    try:
        inspect.signature(fn).bind(None)
    except (TypeError, ValueError):
        return False
    return True


def _validate(pid: str, mod: ModuleType) -> LoadedPlugin:
    for hook, phase in PENDING_HOOKS.items():
        if hasattr(mod, hook):
            when = phase if phase else "ditunda, Lampiran B"
            raise PluginRejected(f"{hook} belum didukung ({when})")
    need = getattr(mod, "MIN_HOST_API", 1)
    if not isinstance(need, int) or isinstance(need, bool) or need > plugin_host.HOST_API:
        raise PluginRejected(f"butuh host API {need}, host {plugin_host.HOST_API}")
    router = getattr(mod, "router", None)
    if router is not None:
        if not isinstance(router, APIRouter):
            raise PluginRejected("router bukan APIRouter")
        if router.prefix != "":
            raise PluginRejected("router tidak boleh punya prefix")
        for route in router.routes:
            if isinstance(route, APIRoute):
                ep = route.endpoint
                if inspect.iscoroutinefunction(ep) and not getattr(ep, "__plugin_allow_async__", False):
                    raise PluginRejected(f"endpoint {route.path} async; tulis def atau @host.allow_async")
    ensure = getattr(mod, "ensure_schema", None)
    if ensure is not None and not _accepts_one_positional(ensure):
        raise PluginRejected("ensure_schema harus fungsi (conn)")
    return LoadedPlugin(id=pid, module=mod, router=router, ensure_schema=ensure)


def discover(plugins_dir=PLUGINS_DIR, known=None) -> tuple[list[LoadedPlugin], dict[str, str]]:
    """Pindai `plugins_dir/*.py` (bukan `_*`, urut nama). Mengembalikan (dimuat, {id: alasan ditolak})."""
    known_ids = _known if known is None else known
    loaded: list[LoadedPlugin] = []
    rejected: dict[str, str] = {}
    d = Path(plugins_dir)
    try:
        files = sorted(p for p in d.glob("*.py") if p.is_file() and not p.name.startswith("_"))
    except OSError as e:
        logger.error("plugin server: folder %s tidak terbaca (%s)", d, e)
        return [], {}
    for path in files:
        pid = path.stem
        try:
            if not ID_RE.match(pid):
                raise PluginRejected("id tidak valid")
            if pid in RESERVED_IDS:
                raise PluginRejected(f"id '{pid}' dicadangkan")
            if pid not in known_ids:
                raise PluginRejected("tidak terdaftar di static/plugins/index.json")
            mod = _import(pid, path)
            try:
                loaded.append(_validate(pid, mod))
            except BaseException:
                sys.modules.pop(_module_name(pid), None)
                raise
        except PluginRejected as e:
            rejected[pid] = str(e)
        except KeyboardInterrupt:
            raise
        except BaseException as e:  # noqa: BLE001 — validasi yang meledak = penolakan
            rejected[pid] = f"validasi gagal: {type(e).__name__}: {e}"
    return loaded, rejected


# ── Migrasi (hanya web) ───────────────────────────────────────────────────────

_SCHEMA_SQL = ("SELECT type, name, tbl_name, sql FROM sqlite_master "
               "WHERE substr(name, 1, 7) != 'sqlite_'")


def _schema_snapshot(conn) -> dict:
    return {(r[0], r[1]): (r[2], r[3]) for r in conn.execute(_SCHEMA_SQL).fetchall()}


class _SchemaConn:
    """Koneksi untuk `ensure_schema`: transaksi dipegang loader, jadi plugin tidak boleh
    commit/rollback/close/executescript (executescript meng-COMMIT transaksi terbuka)."""

    _BLOCKED = frozenset({"commit", "rollback", "close", "executescript"})

    def __init__(self, conn):
        object.__setattr__(self, "_conn", conn)

    def __getattr__(self, name):
        if name in self._BLOCKED:
            def _blocked(*a, **k):
                raise SchemaViolation(f"ensure_schema tidak boleh memanggil {name}()")
            return _blocked
        return getattr(self._conn, name)

    def __setattr__(self, name, value):
        raise SchemaViolation("ensure_schema tidak boleh mengubah atribut koneksi")


def _run_ensure_schema(conn, p: LoadedPlugin) -> None:
    prefix = "plg_" + p.id.replace("-", "_") + "_"
    with dbconn.write_tx(conn):
        before = _schema_snapshot(conn)
        p.ensure_schema(_SchemaConn(conn))
        if not conn.in_transaction:
            raise SchemaViolation("ensure_schema mengakhiri transaksi (COMMIT/ROLLBACK)")
        after = _schema_snapshot(conn)
        touched = [k for k in set(before) | set(after) if before.get(k) != after.get(k)]
        bad = sorted(
            name for (typ, name) in touched
            if not name.startswith(prefix)
            or not (after.get((typ, name)) or before.get((typ, name)))[0].startswith(prefix)
        )
        if bad:
            raise SchemaViolation(f"objek di luar prefix {prefix}: {', '.join(bad)}")
        for typ, name in sorted(touched):
            if typ == "table" and (typ, name) in after:
                rows = conn.execute(f'PRAGMA foreign_key_check("{name}")').fetchall()
                if rows:
                    raise SchemaViolation(f"pelanggaran foreign key di {name} ({len(rows)} baris)")


def migrate(db_path, plugins=None) -> dict[str, str]:
    """Skema `plugin_states` + `ensure_schema` tiap plugin (R1, R3). Tidak pernah melempar."""
    plugins = list(_loaded if plugins is None else plugins)
    result: dict[str, str] = {}

    def _fail_all(reason):
        for p in plugins:
            if p.ensure_schema is None:
                _health[p.id] = result[p.id] = "ok"
            else:
                _health[p.id] = result[p.id] = "schema_failed"
                logger.error("plugin %s: ensure_schema gagal — %s", p.id, reason)

    try:
        conn = dbconn.connect(db_path, foreign_keys=False)
    except Exception as e:  # noqa: BLE001
        logger.error("plugin server: migrasi tidak bisa membuka DB (%s: %s)", type(e).__name__, e)
        _fail_all(f"DB tidak terbuka: {type(e).__name__}: {e}")
        return result
    try:
        try:
            import plugin_states  # R4: import di dalam fungsi
            with dbconn.write_tx(conn):
                plugin_states.ensure_schema(conn)
        except Exception as e:  # noqa: BLE001
            logger.error("plugin server: skema plugin_states gagal (%s: %s)", type(e).__name__, e)
        for p in plugins:
            if p.ensure_schema is None:
                _health[p.id] = result[p.id] = "ok"
                continue
            try:
                _run_ensure_schema(conn, p)
            except KeyboardInterrupt:
                raise
            except BaseException as e:  # noqa: BLE001 — satu plugin tidak menggagalkan migrasi
                reason = str(e) if isinstance(e, SchemaViolation) else f"{type(e).__name__}: {e}"
                logger.error("plugin %s: ensure_schema gagal — %s", p.id, reason)
                _health[p.id] = result[p.id] = "schema_failed"
                if conn.in_transaction:
                    try:
                        conn.rollback()
                    except Exception:  # noqa: BLE001
                        pass
            else:
                _health[p.id] = result[p.id] = "ok"
    finally:
        conn.close()
    return result


def health(pid: str) -> str:
    """`ok` | `pending` (dimuat, migrasi belum jalan) | `schema_failed` | `unknown`."""
    return _health.get(pid, "unknown")


# ── Pemasangan router (web) ───────────────────────────────────────────────────

def require_plugin_enabled(plugin_id: str) -> Callable:
    """Dependency `def` (K9): token clipper → 403, plugin tidak sehat → 503, nonaktif → 403."""
    def _dep(user: dict = Depends(plugin_host.current_user)) -> None:
        import plugin_states  # R4
        if user.get("scope") == "ext":
            raise HTTPException(status_code=403, detail={"code": "PLUGIN_FORBIDDEN_TOKEN"})
        if health(plugin_id) != "ok":
            raise HTTPException(status_code=503,
                                detail={"code": "PLUGIN_UNAVAILABLE", "plugin_id": plugin_id})
        with plugin_host.get_conn() as conn:
            on = plugin_states.effective_enabled(conn, user["sub"], plugin_id, default_enabled(plugin_id))
        if not on:
            raise HTTPException(status_code=403,
                                detail={"code": "PLUGIN_DISABLED", "plugin_id": plugin_id})
    _dep.__name__ = f"require_plugin_enabled_{plugin_id.replace('-', '_')}"
    return _dep


def mount(app, plugins) -> None:
    for p in plugins:
        if p.router is None:
            continue
        try:
            app.include_router(
                p.router,
                prefix=f"/api/plugins/{p.id}",
                tags=[f"plugin:{p.id}"],
                dependencies=[Depends(plugin_host.current_user), Depends(require_plugin_enabled(p.id))],
            )
        except Exception as e:  # noqa: BLE001
            logger.error("plugin %s: router gagal dipasang (%s: %s)", p.id, type(e).__name__, e)
            _health[p.id] = "schema_failed"


def _log_summary(loaded, rejected) -> None:
    logger.info("plugin server: %d dimuat, %d ditolak", len(loaded), len(rejected))
    for pid, reason in rejected.items():
        logger.warning("plugin %s ditolak: %s", pid, reason)


def init_web(app, *, plugins_dir=PLUGINS_DIR, index_path=INDEX_PATH) -> list[LoadedPlugin]:
    """Indeks → discover → health → mount. Tidak pernah melempar."""
    global _loaded
    try:
        load_known(index_path)
        loaded, rejected = discover(plugins_dir, _known)
        _loaded = list(loaded)
        for p in loaded:
            _health[p.id] = "pending" if p.ensure_schema is not None else "ok"
        mount(app, loaded)
        _log_summary(loaded, rejected)
        return list(loaded)
    except KeyboardInterrupt:
        raise
    except BaseException as e:  # noqa: BLE001
        logger.error("plugin server: loader gagal (%s: %s)", type(e).__name__, e)
        return []


def load_for_bot(application=None, *, plugins_dir=PLUGINS_DIR, index_path=INDEX_PATH) -> tuple[int, int]:
    """Bot: indeks + discover saja (tanpa DDL, tanpa router). Tidak pernah melempar.
    `application` disiapkan untuk `register_bot` kelak (belum didukung, K7)."""
    global _loaded
    try:
        load_known(index_path)
        loaded, rejected = discover(plugins_dir, _known)
        _loaded = list(loaded)
        _log_summary(loaded, rejected)
        return len(loaded), len(rejected)
    except KeyboardInterrupt:
        raise
    except BaseException as e:  # noqa: BLE001
        logger.error("plugin server: loader gagal (%s: %s)", type(e).__name__, e)
        return 0, 0


def _reset_for_tests() -> None:
    global _known, _index_ok, _loaded, _health, _index_path
    _known, _index_ok, _loaded, _health = {}, False, [], {}
    _index_path = INDEX_PATH
    for name in [n for n in sys.modules if n.startswith(MODULE_PREFIX + ".")]:
        sys.modules.pop(name, None)
