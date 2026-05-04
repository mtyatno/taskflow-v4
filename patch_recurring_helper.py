import io, sys
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

with open('static/index.html', encoding='utf-8') as f:
    h = f.read()

old = '    // ── Calendar View ───────────────────────────────────────────\n    function CalendarView'
new = ('    // ── Recurring Task Helper ───────────────────────────────────────\n'
       '    function computeOccurrences(task, fromDate, toDate) {\n'
       '      // Returns array of YYYY-MM-DD strings for recurring occurrences in [fromDate, toDate]\n'
       '      if (!task.recurrence_type || !task.recurrence_end_date) return [];\n'
       '      const days = task.recurrence_days ? JSON.parse(task.recurrence_days) : [];\n'
       "      const startD = new Date(task.created_at.slice(0,10) + 'T00:00:00');\n"
       "      const endD   = new Date(task.recurrence_end_date + 'T00:00:00');\n"
       "      const fromD  = new Date(fromDate + 'T00:00:00');\n"
       "      const toD    = new Date(toDate + 'T00:00:00');\n"
       '      const lo = startD > fromD ? startD : fromD;\n'
       '      const hi = endD < toD ? endD : toD;\n'
       '      if (lo > hi) return [];\n'
       '      const result = [];\n'
       '      const cur = new Date(lo);\n'
       '      while (cur <= hi) {\n'
       '        const jsDay = cur.getDay();\n'
       '        const myDay = (jsDay + 6) % 7;\n'
       '        let match = false;\n'
       "        if (task.recurrence_type === 'daily') match = true;\n"
       "        else if (task.recurrence_type === 'weekdays') match = myDay <= 4;\n"
       "        else if (task.recurrence_type === 'weekly') match = days.includes(myDay);\n"
       "        else if (task.recurrence_type === 'monthly') match = cur.getDate() === days[0];\n"
       '        if (match) {\n'
       '          const y = cur.getFullYear();\n'
       "          const m = String(cur.getMonth()+1).padStart(2,'0');\n"
       "          const d = String(cur.getDate()).padStart(2,'0');\n"
       "          result.push(y + '-' + m + '-' + d);\n"
       '        }\n'
       '        cur.setDate(cur.getDate() + 1);\n'
       '      }\n'
       '      return result;\n'
       '    }\n'
       '\n'
       '    // ── Calendar View ───────────────────────────────────────────\n'
       '    function CalendarView')

if old in h:
    h = h.replace(old, new, 1)
    print('computeOccurrences helper: OK')
else:
    print('ERROR: marker not found')
    import sys; sys.exit(1)

with open('static/index.html', 'w', encoding='utf-8') as f:
    f.write(h)

with open('static/index.html', encoding='utf-8') as f:
    v = f.read()
print('computeOccurrences in file:', 'computeOccurrences' in v)
print('CalendarView still exists:', 'function CalendarView' in v)
