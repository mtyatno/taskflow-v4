import io, sys
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

with open('static/index.html', encoding='utf-8') as f:
    h = f.read()

old = ('onChange={e => set("deadline", e.target.value)} style={{ marginBottom: 14 }} />\n'
       '\n'
       '              {form.gtd_status === "waiting"')

new = ('onChange={e => set("deadline", e.target.value)} style={{ marginBottom: 14 }} />\n'
       '\n'
       '              {/* Recurring Task Section */}\n'
       '              <div style={{ marginTop: 0, marginBottom: 14, padding: "10px 12px", background: "var(--bg-primary)", borderRadius: 10, border: "1px solid var(--border)" }}>\n'
       '                <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontWeight: 600, fontSize: 13 }}>\n'
       '                  <input type="checkbox" checked={recurringOn} onChange={e => setRecurringOn(e.target.checked)}\n'
       '                    style={{ accentColor: "var(--accent)", width: 16, height: 16 }} />\n'
       '                  🔁 Berulang\n'
       '                </label>\n'
       '                {recurringOn && (\n'
       '                  <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>\n'
       '                    <select value={recurForm.type} onChange={e => setRecur("type", e.target.value)}\n'
       '                      style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg-primary)", color: "var(--text-primary)", fontSize: 13 }}>\n'
       '                      <option value="daily">Setiap Hari</option>\n'
       '                      <option value="weekdays">Hari Kerja (Sen-Jum)</option>\n'
       '                      <option value="weekly">Mingguan</option>\n'
       '                      <option value="monthly">Bulanan</option>\n'
       '                    </select>\n'
       '                    {recurForm.type === "weekly" && (\n'
       '                      <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>\n'
       '                        {[["Sen",0],["Sel",1],["Rab",2],["Kam",3],["Jum",4],["Sab",5],["Min",6]].map(([lbl,val]) => (\n'
       '                          <button key={val} type="button"\n'
       '                            onClick={() => setRecur("days", recurForm.days.includes(val) ? recurForm.days.filter(d => d !== val) : [...recurForm.days, val])}\n'
       '                            style={{ padding: "3px 10px", borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: "pointer",\n'
       '                              background: recurForm.days.includes(val) ? "var(--accent)" : "var(--bg-card)",\n'
       '                              color: recurForm.days.includes(val) ? "#000" : "var(--text-secondary)",\n'
       '                              border: "1px solid var(--border)" }}>{lbl}</button>\n'
       '                        ))}\n'
       '                      </div>\n'
       '                    )}\n'
       '                    {recurForm.type === "monthly" && (\n'
       '                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>\n'
       '                        <span style={{ fontSize: 13 }}>Tanggal</span>\n'
       '                        <input type="number" min={1} max={28} value={recurForm.dayOfMonth}\n'
       '                          onChange={e => setRecur("dayOfMonth", Math.max(1,Math.min(28,parseInt(e.target.value)||1)))}\n'
       '                          style={{ width: 60, padding: "4px 8px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg-primary)", color: "var(--text-primary)", fontSize: 13 }} />\n'
       '                        <span style={{ fontSize: 12, color: "var(--text-light)" }}>setiap bulan (maks. 28)</span>\n'
       '                      </div>\n'
       '                    )}\n'
       '                    {task && task.recurrence_end_date && !isRecurExpired && (\n'
       '                      <div style={{ fontSize: 12, color: "var(--text-light)" }}>\n'
       '                        Aktif hingga {task.recurrence_end_date}\n'
       '                      </div>\n'
       '                    )}\n'
       '                    {isRecurExpired && (\n'
       '                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>\n'
       '                        <span style={{ fontSize: 12, color: "#ef4444", fontWeight: 600 }}>Berakhir {task.recurrence_end_date}</span>\n'
       '                        <button type="button" onClick={async () => {\n'
       '                          try {\n'
       '                            const updated = await api.put("/api/tasks/" + task.id, { recurrence_renew: true });\n'
       '                            onSave && onSave(updated);\n'
       '                          } catch(e) {}\n'
       '                        }} style={{ padding: "3px 10px", borderRadius: 6, fontSize: 12, fontWeight: 600,\n'
       '                          background: "var(--accent)", color: "#000", border: "none", cursor: "pointer" }}>\n'
       '                          🔄 Perpanjang 3 Bulan\n'
       '                        </button>\n'
       '                      </div>\n'
       '                    )}\n'
       '                    {!(task && task.recurrence_end_date) && recurringOn && (\n'
       '                      <div style={{ fontSize: 12, color: "var(--text-light)" }}>\n'
       '                        Aktif selama 3 bulan setelah disimpan\n'
       '                      </div>\n'
       '                    )}\n'
       '                  </div>\n'
       '                )}\n'
       '              </div>\n'
       '\n'
       '              {form.gtd_status === "waiting"')

if old in h:
    h = h.replace(old, new, 1)
    print('Recurring UI section: OK')
else:
    print('ERROR: deadline input pattern not found')
    idx = h.find('onChange={e => set("deadline", e.target.value)}')
    if idx != -1:
        print('Deadline onChange found at:', idx)
        print(repr(h[idx:idx+150]))
    sys.exit(1)

with open('static/index.html', 'w', encoding='utf-8') as f:
    f.write(h)
print('Done')
