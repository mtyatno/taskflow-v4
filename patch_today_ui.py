import io, sys
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

with open('static/index.html', encoding='utf-8') as f:
    h = f.read()

# Insert recurring section BEFORE the TASK LIST section div
old = ('          <div style={{ marginBottom: 20 }}>\n'
       '            {/* Section header \xe2\x80\x94 habit-style */}\n'
       '            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>\n'
       '              <span style={{ fontSize: 13, fontWeight: 700, color: "var(--accent)", letterSpacing: "0.5px" }}>\xf0\x9f\x93\x8b TASK LIST</span>')

# Try to find with decoded string
old_decoded = (
    '          <div style={{ marginBottom: 20 }}>\n'
    '            {/* Section header — habit-style */}\n'
    '            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>\n'
    '              <span style={{ fontSize: 13, fontWeight: 700, color: "var(--accent)", letterSpacing: "0.5px" }}>\U0001f4cb TASK LIST</span>'
)

new = (
    '          {recurringToday.length > 0 && (\n'
    '            <div style={{ marginBottom: 20 }}>\n'
    '              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>\n'
    '                <span style={{ fontSize: 13, fontWeight: 700, color: "var(--accent)", letterSpacing: "0.5px" }}>\xf0\x9f\x94\x81 RECURRING HARI INI</span>\n'
    '                <div style={{ flex: 1, height: 1, background: "rgba(168,197,0,0.3)" }} />\n'
    '                <span style={{ fontSize: 12, color: "var(--text-light)" }}>{recurringToday.length} task</span>\n'
    '              </div>\n'
    '              {recurringToday.map(t => (\n'
    '                <div key={t.id} style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderLeft: "3px solid var(--accent)", borderRadius: 10, padding: "10px 14px", marginBottom: 8, display: "flex", alignItems: "center", gap: 10 }}>\n'
    '                  <div style={{ flex: 1 }}>\n'
    '                    <div style={{ fontWeight: 600, fontSize: 14 }}>\xf0\x9f\x94\x81 {t.title}</div>\n'
    '                    <div style={{ fontSize: 12, color: "var(--text-light)" }}>{t.priority} \xc2\xb7 {t.recurrence_type}</div>\n'
    '                  </div>\n'
    '                  <button onClick={async () => {\n'
    '                    await api.post("/api/tasks/" + t.id + "/occurrences/" + todayStr + "/mark", { status: "done" });\n'
    '                    const data = await api.get("/api/recurring/exceptions?from=" + todayStr + "&to=" + todayStr);\n'
    '                    setTodayExceptions(data || {});\n'
    '                  }} style={{ padding: "5px 12px", borderRadius: 8, background: "var(--accent)", color: "#000", border: "none", fontWeight: 700, cursor: "pointer", fontSize: 13 }}>\n'
    '                    \xe2\x9c\x93 Done\n'
    '                  </button>\n'
    '                </div>\n'
    '              ))}\n'
    '            </div>\n'
    '          )}\n'
    '          <div style={{ marginBottom: 20 }}>\n'
    '            {/* Section header — habit-style */}\n'
    '            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>\n'
    '              <span style={{ fontSize: 13, fontWeight: 700, color: "var(--accent)", letterSpacing: "0.5px" }}>\U0001f4cb TASK LIST</span>'
)

if old_decoded in h:
    h = h.replace(old_decoded, new, 1)
    print('Today recurring UI: OK')
else:
    print('ERROR: TASK LIST pattern not found')
    sys.exit(1)

with open('static/index.html', 'w', encoding='utf-8') as f:
    f.write(h)
print('Done')
