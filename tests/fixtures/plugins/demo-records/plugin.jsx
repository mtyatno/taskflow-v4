// Plugin contoh KHUSUS TES (tidak pernah di static/plugins/): membuktikan api.records (rencana Fase 1 PR 1a-2
// Task 7; dipakai E2E Task 11). View `recs`: scope "list:<id>" di halaman workspace, "user" di halaman project.
// Plugin ini sengaja tidak memakai api.taskExt.
function scopeOf(context) {
  return context.pageKind === "workspace" && context.listId ? "list:" + context.listId : "user";
}

function RecsView({ context, api }) {
  const scope = scopeOf(context);
  const tasks = Array.isArray(context.tasks) ? context.tasks : [];
  const firstTask = tasks.length ? tasks[0] : null;
  const [items, setItems] = React.useState([]);
  const [text, setText] = React.useState("");
  const [lost, setLost] = React.useState([]);
  const [err, setErr] = React.useState("");

  const reload = React.useCallback(() => {
    return api.records.list("note", { scope }).then((res) => setItems(res && res.items ? res.items : []))
      .catch((e) => setErr(e && e.message ? e.message : "Gagal memuat"));
  }, [api, scope]);

  React.useEffect(() => {
    reload();
    const off = api.records.onChange((ev) => {
      if (ev.entity !== "note") return;
      if (ev.lost && ev.lost.length) setLost((cur) => cur.concat(ev.lost));
      reload();
    });
    return off;
  }, [api, reload]);

  const add = () => {
    const data = { text: text || "catatan" };
    if (firstTask) data.task = { "$task": firstTask.id };
    setErr("");
    api.records.put("note", null, data, { scope })
      .then(() => { setText(""); return reload(); })
      .catch((e) => setErr(e && e.message ? e.message : "Gagal menyimpan"));
  };
  const edit = (rec) => {
    const data = Object.assign({}, rec.data, { text: String(rec.data.text || "") + " ✓" });
    api.records.put("note", rec.id, data, { scope: rec.scope })
      .then(reload).catch((e) => setErr(e && e.message ? e.message : "Gagal mengubah"));
  };
  const del = (rec) => {
    api.records.remove("note", rec.id).then(reload).catch((e) => setErr(e && e.message ? e.message : "Gagal menghapus"));
  };

  return (
    <div className="demo-records" data-scope={scope}>
      <div className="demo-records-form">
        <input type="text" data-testid="dr-input" value={text} onChange={(e) => setText(e.target.value)} />
        <button type="button" data-testid="dr-add" onClick={() => add()}>Tambah</button>
        <button type="button" data-testid="dr-add-ref" disabled={!firstTask} onClick={() => add()}>Tambah (ref)</button>
      </div>
      {err ? <div className="demo-records-error" data-testid="dr-error">{err}</div> : null}
      {lost.map((id, i) => <div key={id + ":" + i} data-testid="dr-lost">{"Perubahan kalah: " + id}</div>)}
      <ul className="demo-records-list">
        {items.map((rec) => (
          <li key={rec.id} data-testid="dr-item" data-record-id={rec.id}>
            <span>{String(rec.data && rec.data.text != null ? rec.data.text : "")}</span>
            {rec.pending ? <span> (menunggu sinkron)</span> : null}
            {rec.error ? <span>{" (gagal: " + rec.error + ")"}</span> : null}
            <button type="button" data-testid="dr-edit" onClick={() => edit(rec)}>Ubah</button>
            <button type="button" data-testid="dr-del" onClick={() => del(rec)}>Hapus</button>
          </li>
        ))}
      </ul>
    </div>
  );
}

window.TF.plugins.register(manifest, function () {
  return {
    slots: {
      "taskList.views": [{ id: "recs", component: RecsView }],
    },
  };
});
