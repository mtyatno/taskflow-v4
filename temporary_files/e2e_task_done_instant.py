"""E2E: centang "Tandai selesai" → baris task langsung hilang walau sync() lambat. Tidak dijalankan CI.

Bug: handleDone / handleDoneAll / handleDoneParentOnly memanggil fetchAll() (yang menunggu sync() penuh)
tanpa memperbarui state `tasks`, sehingga baris bertahan sampai sync selesai (10–15 dtk di produksi).
Di sini server dibuat "lambat" dengan MENAHAN semua request /api/** di Playwright (tidak di-continue)
selama centang; baris harus hilang ≤ 1 dtk sementara request masih tertahan, lalu request dilepas dan
task harus tercatat done di server.

Skenario: a Fokus Hari Ini (task pribadi + workspace)  b Next (task pribadi + workspace)
c Next: induk + subtask → "Done semua"  d Next: induk + subtask → "Parent saja" (subtask tetap).

    E2E_PYTHON=/path/python-dengan-dependensi-webapp python3 temporary_files/e2e_task_done_instant.py
"""
import os
import subprocess
import sys
import shutil
import tempfile
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from playwright.sync_api import sync_playwright  # noqa: E402
from e2e_focus_page import start_server, register, api, open_app, nav, today_iso  # noqa: E402

results = []


def check(step, ok, note=""):
    results.append((step, bool(ok), note))
    print(("PASS " if ok else "FAIL ") + step + (" — " + note if note else ""), flush=True)
    return ok


class Hold:
    """Tahan request /api/** (route tidak di-continue) selama aktif; release() melepas semuanya."""

    def __init__(self, ctx):
        self.on = False
        self.held = []
        ctx.route("**/api/**", self._handle)

    def _handle(self, route):
        if self.on:
            self.held.append(route)
        else:
            route.continue_()

    def start(self):
        self.held = []
        self.on = True

    def release(self):
        self.on = False
        held, self.held = self.held, []
        for r in held:
            try:
                r.continue_()
            except Exception:
                pass
        return len(held)


def all_tasks(base, user):
    data = api(base, user, "GET", "/api/tasks?include_done=true&limit=1000")[1]
    return data if isinstance(data, list) else data.get("tasks", data.get("items", []))


def server_status(base, user, tid):
    for t in all_tasks(base, user):
        if t["id"] == tid:
            return t.get("gtd_status")
    return None


def wait_server_done(page, base, user, ids, timeout=15):
    # page.wait_for_timeout (bukan time.sleep): Playwright sync hanya memproses handler route saat dipompa.
    end = time.time() + timeout
    st = {}
    while time.time() < end:
        st = {i: server_status(base, user, i) for i in ids}
        if all(v == "done" for v in st.values()):
            return True, st
        page.wait_for_timeout(500)
    return False, st


def row_gone_within(page, row_sel, title, limit_ms=1000):
    """Tunggu sampai baris dengan judul ini hilang; kembalikan (ok, ms)."""
    t0 = time.time()
    while (time.time() - t0) * 1000 < limit_ms:
        if page.locator(row_sel).filter(has_text=title).count() == 0:
            return True, int((time.time() - t0) * 1000)
        page.wait_for_timeout(50)
    return page.locator(row_sel).filter(has_text=title).count() == 0, int((time.time() - t0) * 1000)


def toast_seen(page, text):
    try:
        page.locator(".toast").filter(has_text=text).first.wait_for(state="visible", timeout=1500)
        return True
    except Exception:
        return False


def tick_and_assert(page, hold, base, user, step, row_sel, title, tid, toast_text, extra_gone=(), confirm=None,
                    stays=(), done_ids=None):
    row = page.locator(row_sel).filter(has_text=title).first
    if not check(step + "0 baris tampil sebelum centang", row.count() > 0 and row.is_visible(), title):
        return
    hold.start()
    row.locator(".check-btn").first.click()
    if confirm:
        btn = page.locator("button").filter(has_text=confirm).first
        btn.wait_for(state="visible", timeout=3000)
        btn.click()
    ok, ms = row_gone_within(page, row_sel, title)
    check(step + "1 baris hilang ≤ 1 dtk saat sync tertahan", ok, "%d ms, %d request tertahan" % (ms, len(hold.held)))
    for t in extra_gone:
        ok2, ms2 = row_gone_within(page, row_sel, t, 300)
        check(step + "1b baris '%s' ikut hilang" % t, ok2, "%d ms" % ms2)
    check(step + "2 toast '%s'" % toast_text, toast_seen(page, toast_text))
    for t in stays:
        check(step + "2b baris '%s' tetap tampil" % t, page.locator(row_sel).filter(has_text=t).count() > 0)
    n = hold.release()
    ok3, st = wait_server_done(page, base, user, done_ids or [tid])
    check(step + "3 server done setelah request dilepas", ok3, "dilepas %d, status %r" % (n, st))
    page.wait_for_timeout(1500)


def main():
    tmp = tempfile.mkdtemp(prefix="e2e_task_done_instant_")
    proc, base = start_server(tmp)
    print("server", base, flush=True)
    try:
        user = register(base, "sela")
        _, ws = api(base, user, "POST", "/api/lists", json={"name": "Tim Instan"}, ok_codes=(200, 201))
        wsid = ws["id"]

        def mk(title, **kw):
            body = {"title": title, "priority": "P2", "gtd_status": "next", "deadline": today_iso()}
            body.update(kw)
            return api(base, user, "POST", "/api/tasks", json=body, ok_codes=(200, 201))[1]["id"]

        ids = {
            "fp": mk("Fokus pribadi satu"), "fw": mk("Fokus workspace satu", list_id=wsid),
            "np": mk("Next pribadi dua"), "nw": mk("Next workspace dua", list_id=wsid),
            "filler": mk("Task pengisi tetap"),
        }
        ids["pa"] = mk("Induk done semua")
        ids["ca"] = mk("Anak done semua", parent_id=ids["pa"])
        ids["pb"] = mk("Induk parent saja")
        ids["cb"] = mk("Anak parent saja", parent_id=ids["pb"])
        check("0 seed: workspace + 9 task", len(ids) == 9, "ws %s" % wsid)

        with sync_playwright() as pw:
            browser = pw.chromium.launch()
            ctx, p = open_app(browser, base, user, "light")
            hold = Hold(ctx)
            try:
                # a — Fokus Hari Ini
                nav(p, "Fokus Hari Ini")
                p.locator(".ftask").filter(has_text="Fokus pribadi satu").first.wait_for(timeout=20000)
                p.wait_for_timeout(5000)
                tick_and_assert(p, hold, base, user, "a1.", ".ftask", "Fokus pribadi satu", ids["fp"],
                                "Task selesai!")
                tick_and_assert(p, hold, base, user, "a2.", ".ftask", "Fokus workspace satu", ids["fw"],
                                "Task selesai!")

                # b — Next
                nav(p, "Next")
                p.locator(".task-row").filter(has_text="Next pribadi dua").first.wait_for(timeout=20000)
                p.wait_for_timeout(3000)
                tick_and_assert(p, hold, base, user, "b1.", ".task-row", "Next pribadi dua", ids["np"],
                                "Task selesai!")
                tick_and_assert(p, hold, base, user, "b2.", ".task-row", "Next workspace dua", ids["nw"],
                                "Task selesai!")

                # c — Done semua (induk + subtask)
                tick_and_assert(p, hold, base, user, "c.", ".task-row", "Induk done semua", ids["pa"],
                                "semua subtask selesai", extra_gone=("Anak done semua",), confirm="Done semua",
                                done_ids=[ids["pa"], ids["ca"]])

                # d — Parent saja (subtask tetap)
                tick_and_assert(p, hold, base, user, "d.", ".task-row", "Induk parent saja", ids["pb"],
                                "Task selesai!", confirm="Parent saja", done_ids=[ids["pb"]])
                check("d4 subtask 'Anak parent saja' tetap belum done di server",
                      server_status(base, user, ids["cb"]) != "done")
                check("e pengisi tidak tersentuh", server_status(base, user, ids["filler"]) == "next")
            finally:
                hold.release()
                ctx.close()
            browser.close()
    except Exception as e:
        import traceback
        traceback.print_exc()
        check("exception", False, "%s: %s" % (type(e).__name__, e))
    finally:
        proc.terminate()
        try:
            proc.wait(10)
        except subprocess.TimeoutExpired:
            proc.kill()
        shutil.rmtree(tmp, ignore_errors=True)
    failed = [r for r in results if not r[1]]
    print("\n%d langkah, %d gagal" % (len(results), len(failed)))
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
