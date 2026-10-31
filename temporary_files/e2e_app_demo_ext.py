"""Aplikasi pembungkus E2E plugin Fase 1 PR 1a-1 (rencana R21). Tidak dijalankan CI.

Server memakai `webapp.app` apa adanya, lalu indeks plugin server diganti dengan indeks sementara (indeks nyata +
plugin contoh khusus tes `demo-ext`, hasil `buildPlugins` ke direktori tmp) supaya `demo-ext` berizin `task.ext`
dikenal server tanpa menyentuh `static/plugins/`:

    E2E_PLUGIN_INDEX=/tmp/.../plugins/index.json python -m uvicorn e2e_app_demo_ext:app --app-dir temporary_files

`plugin_loader.load_known` juga mengganti path yang dibaca ulang `refresh_known()` (namespace `task.ext`).
"""
import os

import plugin_loader
import webapp

_index = os.environ.get("E2E_PLUGIN_INDEX")
if not _index:
    raise RuntimeError("E2E_PLUGIN_INDEX wajib diisi (index.json sementara berisi demo-ext)")
plugin_loader.load_known(_index)
if "demo-ext" not in plugin_loader.known() or "task.ext" not in plugin_loader.permissions("demo-ext"):
    raise RuntimeError("indeks %s tidak memuat demo-ext berizin task.ext" % _index)

app = webapp.app
