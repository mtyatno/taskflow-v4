function resolveApiBase(host) {
  // The web app is served from these hosts (same-origin → no base). alurik.com is the
  // primary domain; todo.yatno.web.id stays listed during the domain transition period.
  // Anything else (the bundled Tauri webview at tauri.localhost / tauri://) targets the VPS.
  var WEB_HOSTS = ["alurik.com", "www.alurik.com", "todo.yatno.web.id", "localhost", "127.0.0.1"];
  return WEB_HOSTS.indexOf(host) === -1 ? "https://alurik.com" : "";
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = { resolveApiBase };
} else {
  try { window.__API_BASE = resolveApiBase(location.hostname || ""); } catch (e) {}
}
