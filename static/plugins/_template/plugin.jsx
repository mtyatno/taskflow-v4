// Templat plugin Alurik (Fase 0a). Salin folder ini ke static/plugins/<id>/ (tanpa "_" di depan), sesuaikan
// manifest.json (id = nama folder), lalu jalankan `npm run compile:plugins`. Jangan sunting plugin.js hasil build.
//
// `manifest` adalah konstanta yang disuntik compile.js dari manifest.json. Plugin hanya memakai `api` (TF.api v1)
// dan React global; modul host, penyimpanan browser, dan jaringan tidak boleh dipakai (lint build menolaknya).

function MyCard({ context, api }) {
  const [count, setCount] = React.useState(0);
  React.useEffect(() => api.events.on("task.completed", () => setCount((n) => n + 1)), []);
  return (
    <div className="dash-card">
      <div className="dash-card-title">{manifest.name}</div>
      <p>Task selesai sejak Dashboard dibuka: {count}</p>
    </div>
  );
}

window.TF.plugins.register(manifest, function factory(api) {
  return {
    slots: { "dashboard.widgets": [{ id: "card", order: 100, component: MyCard }] },
    onEnable() { api.log.info("aktif"); },
    onDisable() { api.log.info("nonaktif"); },
  };
});
