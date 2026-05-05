import io, sys
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

with open('static/index.html', encoding='utf-8') as f:
    h = f.read()

old = '      const [taskPomodoros, setTaskPomodoros] = useState({});'

new = ('      const [taskPomodoros, setTaskPomodoros] = useState({});\n'
       '      const [todayExceptions, setTodayExceptions] = useState({});\n'
       '      const todayStr = new Date().toISOString().slice(0,10);\n'
       '      React.useEffect(() => {\n'
       '        const recurringTasks = tasks.filter(t => t.recurrence_type && t.recurrence_end_date);\n'
       '        if (recurringTasks.length === 0) return;\n'
       '        api.get("/api/recurring/exceptions?from=" + todayStr + "&to=" + todayStr)\n'
       '          .then(data => setTodayExceptions(data || {}))\n'
       '          .catch(() => {});\n'
       '      }, [tasks]);\n'
       '      const recurringToday = tasks.filter(t => {\n'
       '        if (!t.recurrence_type || !t.recurrence_end_date) return false;\n'
       '        const occs = computeOccurrences(t, todayStr, todayStr);\n'
       '        if (occs.length === 0) return false;\n'
       '        const excs = todayExceptions[String(t.id)] || [];\n'
       '        const exc = excs.find(e => e.occurrence_date === todayStr);\n'
       '        return !exc || (exc.status !== "done" && exc.status !== "skipped");\n'
       '      });')

if old in h:
    h = h.replace(old, new, 1)
    print('Today recurring state: OK')
else:
    print('ERROR: taskPomodoros pattern not found')
    sys.exit(1)

with open('static/index.html', 'w', encoding='utf-8') as f:
    f.write(h)
print('Done')
