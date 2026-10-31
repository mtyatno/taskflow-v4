// Plugin contoh KHUSUS TES (tidak pernah di static/plugins/): membuktikan slot taskList.views +
// taskDetail.sections dan api.taskExt (rencana Fase 1 PR 1a-1 Task 8). util.js digabung lebih dulu (parts).
const util = window.__demoExt;

function Board({ context, api }) {
  const tasks = Array.isArray(context.tasks) ? context.tasks : [];
  if (!tasks.length) return <div className="demo-ext-board demo-ext-empty">Tidak ada task</div>;
  return (
    <ul className="demo-ext-board">
      {tasks.map((t) => {
        const note = api.taskExt.read(t).note;
        return (
          <li key={t.id} data-task-id={t.id}>
            <button type="button" onClick={() => context.onTaskClick && context.onTaskClick(t)}>{util.label(t)}</button>
            {note ? <span className="demo-ext-note-text"> — {String(note)}</span> : null}
          </li>
        );
      })}
    </ul>
  );
}

function NoteSection({ context, api }) {
  const task = context.task;
  const current = task ? (api.taskExt.read(task).note || "") : "";
  const [note, setNote] = React.useState(current);
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => { setNote(current); }, [task && task.id, current]);
  if (!task) return null;
  const save = () => {
    setBusy(true);
    api.taskExt.set(task.id, { note: note ? note : null })
      .catch((err) => api.ui.toast(err && err.message ? err.message : "Gagal menyimpan", "error"))
      .then(() => setBusy(false));
  };
  return (
    <div className="demo-ext-section">
      <label>
        Catatan demo
        <input type="text" value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      <button type="button" disabled={busy} onClick={save}>Simpan</button>
    </div>
  );
}

window.TF.plugins.register(manifest, function () {
  return {
    slots: {
      "taskList.views": [{ id: "board", component: Board }],
      "taskDetail.sections": [{ id: "note", component: NoteSection }],
    },
  };
});
