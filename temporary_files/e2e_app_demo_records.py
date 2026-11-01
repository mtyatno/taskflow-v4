"""Aplikasi pembungkus E2E plugin Fase 1 PR 1a-2 (rencana R23). Tidak dijalankan CI.

Server memakai `webapp.app` apa adanya, lalu indeks plugin server diganti dengan indeks sementara (indeks nyata +
plugin contoh khusus tes `demo-ext` dan `demo-records`, hasil `buildPlugins` ke direktori tmp) supaya `demo-records`
berizin `records` (entitas `note`) dikenal server tanpa menyentuh `static/plugins/`:

    E2E_PLUGIN_INDEX=/tmp/.../plugins/index.json python -m uvicorn e2e_app_demo_records:app --app-dir temporary_files

`plugin_loader.load_known` juga mengganti path yang dibaca ulang `refresh_known()` (dipakai `_guard` endpoint record).
"""
import os

import plugin_loader
import webapp

_index = os.environ.get("E2E_PLUGIN_INDEX")
if not _index:
    raise RuntimeError("E2E_PLUGIN_INDEX wajib diisi (index.json sementara berisi demo-records)")
plugin_loader.load_known(_index)
if "demo-records" not in plugin_loader.known() or "records" not in plugin_loader.permissions("demo-records"):
    raise RuntimeError("indeks %s tidak memuat demo-records berizin records" % _index)
if "note" not in plugin_loader.records_decl("demo-records"):
    raise RuntimeError("indeks %s: records_decl('demo-records') tidak memuat entitas note" % _index)

app = webapp.app
