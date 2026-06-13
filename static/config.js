function resolveApiBase(host) {
  // The web app is served from these hosts (same-origin → no base). Anything else
  // (the bundled Tauri webview at tauri.localhost / tauri://) targets the VPS.
  var WEB_HOSTS = ["todo.yatno.web.id", "localhost", "127.0.0.1"];
  return WEB_HOSTS.indexOf(host) === -1 ? "https://todo.yatno.web.id" : "";
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = { resolveApiBase };
} else {
  try { window.__API_BASE = resolveApiBase(location.hostname || ""); } catch (e) {}
}
