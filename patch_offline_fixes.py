import io, sys
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

with open('static/index.html', encoding='utf-8') as f:
    h = f.read()

errors = []

# ── Patch 1: expose showToast via window.__showToast ─────────────────────────
old1 = 'window.__logout = logout;\n'
new1 = 'window.__logout = logout;\n      window.__showToast = showToast;\n'
if old1 in h:
    h = h.replace(old1, new1, 1)
    print('Patch 1 (window.__showToast): OK')
else:
    errors.append('Patch 1 FAILED')

# ── Patch 2: Today view Done button ──────────────────────────────────────────
old2 = (
    '                  <button onClick={async () => {\n'
    '                    await api.post("/api/tasks/" + t.id + "/occurrences/" + todayStr + "/mark", { status: "done" });\n'
    '                    const data = await api.get("/api/recurring/exceptions?from=" + todayStr + "&to=" + todayStr);\n'
    '                    setTodayExceptions(data || {});\n'
    '                  }}'
)
new2 = (
    '                  <button onClick={async () => {\n'
    '                    if (!navigator.onLine) { window.__showToast?.("Tidak bisa dilakukan saat offline", "error"); return; }\n'
    '                    try {\n'
    '                      await api.post("/api/tasks/" + t.id + "/occurrences/" + todayStr + "/mark", { status: "done" });\n'
    '                      const data = await api.get("/api/recurring/exceptions?from=" + todayStr + "&to=" + todayStr);\n'
    '                      setTodayExceptions(data || {});\n'
    '                    } catch(e) { window.__showToast?.("Gagal: " + e.message, "error"); }\n'
    '                  }}'
)
if old2 in h:
    h = h.replace(old2, new2, 1)
    print('Patch 2 (Today Done button): OK')
else:
    errors.append('Patch 2 FAILED')

# ── Patch 3: Calendar popup Selesai button ────────────────────────────────────
old3 = (
    '                  <button onClick={async () => {\n'
    '                    await api.post(\'/api/tasks/\' + recurPopup.task.id + \'/occurrences/\' + recurPopup.date + \'/mark\', { status: "done" });\n'
    '                    setRecurPopup(null);\n'
    '                    const fl = year + \'-\' + String(month+1).padStart(2,\'0\') + \'-01\';\n'
    '                    const ll = new Date(year, month+1, 0).toISOString().slice(0,10);\n'
    '                    api.get(\'/api/recurring/exceptions?from=\' + fl + \'&to=\' + ll).then(d => setRecurExceptions(d || {})).catch(()=>{});\n'
    '                  }} style={{ padding: "6px 14px", borderRadius: 8, background: "var(--accent)", color: "#000", border: "none", fontWeight: 700, cursor: "pointer", fontSize: 13 }}>\n'
    '                    ✓ Selesai\n'
    '                  </button>'
)
new3 = (
    '                  <button onClick={async () => {\n'
    '                    if (!navigator.onLine) { window.__showToast?.("Tidak bisa dilakukan saat offline", "error"); return; }\n'
    '                    try {\n'
    '                      await api.post(\'/api/tasks/\' + recurPopup.task.id + \'/occurrences/\' + recurPopup.date + \'/mark\', { status: "done" });\n'
    '                      setRecurPopup(null);\n'
    '                      const fl = year + \'-\' + String(month+1).padStart(2,\'0\') + \'-01\';\n'
    '                      const ll = new Date(year, month+1, 0).toISOString().slice(0,10);\n'
    '                      api.get(\'/api/recurring/exceptions?from=\' + fl + \'&to=\' + ll).then(d => setRecurExceptions(d || {})).catch(()=>{});\n'
    '                    } catch(e) { window.__showToast?.("Gagal: " + e.message, "error"); }\n'
    '                  }} style={{ padding: "6px 14px", borderRadius: 8, background: "var(--accent)", color: "#000", border: "none", fontWeight: 700, cursor: "pointer", fontSize: 13 }}>\n'
    '                    ✓ Selesai\n'
    '                  </button>'
)
if old3 in h:
    h = h.replace(old3, new3, 1)
    print('Patch 3 (Calendar Selesai): OK')
else:
    errors.append('Patch 3 FAILED')

# ── Patch 4: Calendar popup Lewati button ─────────────────────────────────────
old4 = (
    '                  <button onClick={async () => {\n'
    '                    await api.post(\'/api/tasks/\' + recurPopup.task.id + \'/occurrences/\' + recurPopup.date + \'/mark\', { status: "skipped" });\n'
    '                    setRecurPopup(null);\n'
    '                    const fl = year + \'-\' + String(month+1).padStart(2,\'0\') + \'-01\';\n'
    '                    const ll = new Date(year, month+1, 0).toISOString().slice(0,10);\n'
    '                    api.get(\'/api/recurring/exceptions?from=\' + fl + \'&to=\' + ll).then(d => setRecurExceptions(d || {})).catch(()=>{});\n'
    '                  }} style={{ padding: "6px 14px", borderRadius: 8, background: "var(--bg-primary)", color: "var(--text-secondary)", border: "1px solid var(--border)", cursor: "pointer", fontSize: 13 }}>\n'
    '                    — Lewati\n'
    '                  </button>'
)
new4 = (
    '                  <button onClick={async () => {\n'
    '                    if (!navigator.onLine) { window.__showToast?.("Tidak bisa dilakukan saat offline", "error"); return; }\n'
    '                    try {\n'
    '                      await api.post(\'/api/tasks/\' + recurPopup.task.id + \'/occurrences/\' + recurPopup.date + \'/mark\', { status: "skipped" });\n'
    '                      setRecurPopup(null);\n'
    '                      const fl = year + \'-\' + String(month+1).padStart(2,\'0\') + \'-01\';\n'
    '                      const ll = new Date(year, month+1, 0).toISOString().slice(0,10);\n'
    '                      api.get(\'/api/recurring/exceptions?from=\' + fl + \'&to=\' + ll).then(d => setRecurExceptions(d || {})).catch(()=>{});\n'
    '                    } catch(e) { window.__showToast?.("Gagal: " + e.message, "error"); }\n'
    '                  }} style={{ padding: "6px 14px", borderRadius: 8, background: "var(--bg-primary)", color: "var(--text-secondary)", border: "1px solid var(--border)", cursor: "pointer", fontSize: 13 }}>\n'
    '                    — Lewati\n'
    '                  </button>'
)
if old4 in h:
    h = h.replace(old4, new4, 1)
    print('Patch 4 (Calendar Lewati): OK')
else:
    errors.append('Patch 4 FAILED')

# ── Patch 5: Perpanjang button ────────────────────────────────────────────────
# Find the perpanjang button with its existing try/catch
import re
# Pattern: any button with recurrence_renew: true
m = re.search(
    r'(<button type="button" onClick=\{async \(\) => \{)(.*?recurrence_renew: true.*?)\}(.*?</button>)',
    h, re.DOTALL
)
if m:
    full = m.group(0)
    # Check if already has online guard
    if 'navigator.onLine' not in full:
        new_onclick = (
            '<button type="button" onClick={async () => {\n'
            '                          if (!navigator.onLine) { window.__showToast?.("Tidak bisa dilakukan saat offline", "error"); return; }\n'
        )
        # Replace the opening
        new_full = full.replace('<button type="button" onClick={async () => {\n', new_onclick, 1)
        # Also update catch to use window.__showToast
        new_full = new_full.replace(
            'showToast("Gagal perpanjang", "error")',
            'window.__showToast?.("Gagal perpanjang", "error")'
        )
        h = h.replace(full, new_full, 1)
        print('Patch 5 (Perpanjang button): OK')
    else:
        print('Patch 5 (Perpanjang button): already has online guard, skip')
else:
    errors.append('Patch 5 FAILED — Perpanjang button not found')

with open('static/index.html', 'w', encoding='utf-8') as f:
    f.write(h)

# ── Verify ────────────────────────────────────────────────────────────────────
with open('static/index.html', encoding='utf-8') as f:
    v = f.read()

print()
print('=== Verification ===')
print('window.__showToast:', 'window.__showToast = showToast' in v)
print('Today online guard:', 'navigator.onLine' in v and 'todayStr' in v)
print('Calendar online guard:', v.count('navigator.onLine') >= 3)
print('Perpanjang online guard:', 'recurrence_renew' in v and 'navigator.onLine' in v)
print()
if errors:
    for e in errors:
        print('ERROR:', e)
else:
    print('All patches OK')
