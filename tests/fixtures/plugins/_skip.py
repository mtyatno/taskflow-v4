"""Diawali `_` → dilewati loader (tidak pernah diimpor). Bila diimpor, tes gagal."""
raise RuntimeError("_skip.py tidak boleh diimpor loader")
