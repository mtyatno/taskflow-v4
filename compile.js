#!/usr/bin/env node
/**
 * Pre-compiles JSX in static/index.html to plain JavaScript.
 * Run after `git pull`, before restarting the service.
 * Source (with JSX) stays in git; compiled version is what gets served.
 *
 * Plugin (spec docs/superpowers/specs/2026-10-29-plugin-fase0a-design.md §6): setiap
 * static/plugins/<id>/plugin.jsx (folder berawalan "_" dilewati) → plugin.js, lalu tulis
 * static/plugins/index.json dan blok plugin di STATIC static/sw.js. Gagal → exit 1.
 * `node compile.js --plugins-only` (npm run compile:plugins) hanya menjalankan bagian plugin.
 */

const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');
const babel  = require('@babel/core');

function compileJsx(code, filename) {
  return babel.transformSync(code, {
    presets: [['@babel/preset-react', { runtime: 'classic' }]],
    compact: false,
    babelrc: false,
    configFile: false,
    filename,
  }).code;
}

function compileIndex(log) {
  const htmlPath = path.join(__dirname, 'static', 'index.html');
  let html = fs.readFileSync(htmlPath, 'utf8');

  // Remove babel.min.js — no longer needed at runtime
  html = html.replace(/[ \t]*<script src="\/static\/vendor\/babel\.min\.js"><\/script>\n?/, '');

  const START = '<script type="text/babel">';
  const END   = '</script>';

  const startIdx = html.indexOf(START);
  if (startIdx === -1) {
    log('No <script type="text/babel"> found — already compiled, skipping.');
    return true;
  }

  const contentStart = startIdx + START.length;
  const endIdx       = html.indexOf(END, contentStart);
  if (endIdx === -1) {
    console.error('ERROR: could not find closing </script>');
    return false;
  }

  const jsxContent = html.slice(contentStart, endIdx);
  log(`Extracted ${jsxContent.length.toLocaleString()} bytes of JSX`);
  log('Compiling...');

  let code;
  try {
    code = compileJsx(jsxContent, 'index.html.jsx');
  } catch (err) {
    console.error('Compile error:', err.message);
    return false;
  }

  log(`Compiled → ${code.length.toLocaleString()} bytes`);

  const output =
    html.slice(0, startIdx) +
    '<script>\n' +
    code  +
    '\n'         +
    html.slice(endIdx);   // starts with </script>

  fs.writeFileSync(htmlPath, output);
  log('Done — written to static/index.html');
  return true;
}

// ── Plugin ──────────────────────────────────────────────────────────────────
const PLUGIN_HEADER = '// generated from plugin.jsx — jangan edit\n';
// Pagar murah (spec §11.2, Lampiran A #10): plugin hanya memakai TF.api, bukan modul/penyimpanan host.
const LINT_RE = /tokenStore|API_BASE|localStorage|innerHTML|indexedDB|XMLHttpRequest|TF\.api\.for\(|window\.TF\.(?:meta|db|taskroutes)\b/;
// fetch (spec Fase 0b §6.4, rencana R15): fetch polos dan window|self|globalThis.fetch selalu ditolak;
// `.fetch(` (api.fetch) hanya boleh bila manifest.permissions memuat "network".
const BARE_FETCH_RE = /(?<![\w$.])fetch\s*\(/;
const GLOBAL_FETCH_RE = /\b(?:window|self|globalThis)\s*\.\s*fetch\b/;
const DOT_FETCH_RE = /\.\s*fetch\s*\(/;
const PLUGIN_ID_RE = /^[a-z][a-z0-9-]{2,31}$/;
const RESERVED_PLUGIN_IDS = ['state'];
const MANIFEST_FIELDS = ['id', 'name', 'description', 'version', 'minApi', 'slots', 'permissions', 'defaultEnabled'];
// Fase 1 (rencana PR 1a-1 R13): disalin ke index.json dan konstanta manifest hanya bila ada. `parts` hanya saat build.
const OPTIONAL_FIELDS = ['contributes', 'taskExt'];
// Aturan contributes/taskExt sama dengan validateManifest di static/plugin-runtime.js (spec Fase 1 K19).
const CONTRIB_SLOTS = ['taskList.views', 'taskDetail.sections'];
const CONTRIB_ID_RE = /^[a-z][a-z0-9-]{0,31}$/;
const VIEW_PAGES = ['project', 'workspace'];
const ICON_PATH_RE = /^[MmLlHhVvCcSsQqTtAaZz0-9.,\- ]+$/;
const ICON_PATH_MAX_BYTES = 2048;
const LABEL_MAX = 40;
const EXT_FIELD_RE = /^[a-zA-Z][a-zA-Z0-9_]{0,31}$/;
const PART_RE = /^[a-z0-9][a-z0-9_-]*\.js$/;
const SW_BEGIN = '  // plugins:begin — ditulis compile.js dari static/plugins/index.json, jangan edit manual';
const SW_END = '  // plugins:end';

class PluginBuildError extends Error {}

// Potongan terlarang pertama di plugin.js, atau null bila bersih.
function lintPlugin(code, manifest) {
  const m = LINT_RE.exec(code);
  if (m) return m[0];
  if (BARE_FETCH_RE.test(code)) return 'fetch(';
  const g = GLOBAL_FETCH_RE.exec(code);
  if (g) return g[0];
  const perms = (manifest && Array.isArray(manifest.permissions)) ? manifest.permissions : [];
  if (DOT_FETCH_RE.test(code) && perms.indexOf('network') < 0) return '.fetch(';
  return null;
}

const isPlainObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

function labelError(where, label) {
  if (typeof label !== 'string' || !label.trim()) return where + ': label wajib diisi';
  if (Array.from(label).length > LABEL_MAX) return where + ': label maksimal ' + LABEL_MAX + ' karakter';
  return null;
}

// Alasan (string) bila manifest.contributes tidak sah, null bila sah atau tidak ada.
function validateContributes(m) {
  if (!m || m.contributes === undefined) return null;
  const c = m.contributes;
  if (!isPlainObj(c)) return 'contributes harus objek';
  const slots = Array.isArray(m.slots) ? m.slots : [];
  for (const slot of Object.keys(c)) {
    if (CONTRIB_SLOTS.indexOf(slot) < 0) return 'contributes: slot tidak didukung: ' + slot;
    if (slots.indexOf(slot) < 0) return 'contributes: slot ' + slot + ' tidak ada di slots';
    const items = c[slot];
    if (!Array.isArray(items)) return 'contributes: ' + slot + ' harus array';
    const seen = new Set();
    for (const it of items) {
      if (!isPlainObj(it)) return 'contributes: item ' + slot + ' harus objek';
      if (typeof it.id !== 'string' || !CONTRIB_ID_RE.test(it.id)) return 'contributes: id ' + slot + ' tidak valid: ' + it.id;
      if (seen.has(it.id)) return 'contributes: id ' + slot + ' ganda: ' + it.id;
      seen.add(it.id);
      const where = 'contributes: ' + slot + ' ' + it.id;
      const le = labelError(where, it.label);
      if (le) return le;
      if (slot === 'taskList.views') {
        const p = isPlainObj(it.icon) ? it.icon.path : undefined;
        if (typeof p !== 'string' || !p || !ICON_PATH_RE.test(p)) return where + ': icon.path hanya perintah path SVG (M L H V C S Q T A Z, angka)';
        if (Buffer.byteLength(p, 'utf8') > ICON_PATH_MAX_BYTES) return where + ': icon.path melebihi ' + ICON_PATH_MAX_BYTES + ' byte';
        if (!Array.isArray(it.pages) || !it.pages.length) return where + ': pages wajib array tak kosong';
        if (new Set(it.pages).size !== it.pages.length) return where + ': pages ganda';
        for (const pg of it.pages) if (VIEW_PAGES.indexOf(pg) < 0) return where + ': pages tidak dikenal: ' + pg;
      } else if (it.order !== undefined && (typeof it.order !== 'number' || !Number.isFinite(it.order))) {
        return where + ': order harus angka';
      }
    }
  }
  return null;
}

// Izin task.ext ⇔ taskExt.keys (array field unik, tak kosong).
function validateTaskExt(m) {
  const perms = (m && Array.isArray(m.permissions)) ? m.permissions : [];
  const has = !!m && m.taskExt !== undefined;
  const perm = perms.indexOf('task.ext') >= 0;
  if (perm && !has) return 'izin task.ext butuh taskExt.keys';
  if (!has) return null;
  if (!perm) return 'taskExt butuh izin task.ext';
  const keys = isPlainObj(m.taskExt) ? m.taskExt.keys : undefined;
  if (!Array.isArray(keys) || !keys.length) return 'taskExt.keys wajib array tak kosong';
  if (new Set(keys).size !== keys.length) return 'taskExt.keys ganda';
  for (const k of keys) if (typeof k !== 'string' || !EXT_FIELD_RE.test(k)) return 'taskExt.keys tidak valid: ' + k;
  return null;
}

// Isi parts (mentah, tanpa Babel) yang didahulukan sebelum kode plugin.jsx.
function readParts(dir, id, parts) {
  if (parts === undefined) return '';
  if (!Array.isArray(parts)) throw new PluginBuildError(`plugin ${id}: parts harus array nama berkas`);
  const seen = new Set();
  let out = '';
  for (const name of parts) {
    if (typeof name !== 'string' || !PART_RE.test(name) || name === 'plugin.js') {
      throw new PluginBuildError(`plugin ${id}: parts tidak valid: ${name} (pola [a-z0-9][a-z0-9_-]*.js, bukan plugin.js)`);
    }
    if (seen.has(name)) throw new PluginBuildError(`plugin ${id}: parts ganda: ${name}`);
    seen.add(name);
    const file = path.join(dir, name);
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) throw new PluginBuildError(`plugin ${id}: parts ${name} tidak ada`);
    out += '// part: ' + name + '\n' + fs.readFileSync(file, 'utf8').replace(/\s+$/, '') + '\n';
  }
  return out;
}

function writeIfChanged(file, content, written) {
  if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') === content) return;
  fs.writeFileSync(file, content);
  written.push(file);
}

function readManifest(dir, id) {
  const file = path.join(dir, 'manifest.json');
  if (!fs.existsSync(file)) throw new PluginBuildError(`plugin ${id}: manifest.json wajib ada`);
  let m;
  try { m = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) {
    throw new PluginBuildError(`plugin ${id}: manifest.json bukan JSON valid: ${e.message}`);
  }
  if (m.id !== id) throw new PluginBuildError(`plugin ${id}: id manifest "${m.id}" harus sama dengan nama folder`);
  for (const k of MANIFEST_FIELDS) {
    if (m[k] === undefined) throw new PluginBuildError(`plugin ${id}: manifest.json tanpa field ${k}`);
  }
  const ce = validateContributes(m);
  if (ce) throw new PluginBuildError(`plugin ${id}: ${ce}`);
  const te = validateTaskExt(m);
  if (te) throw new PluginBuildError(`plugin ${id}: ${te}`);
  const out = {};
  for (const k of MANIFEST_FIELDS) out[k] = m[k];
  for (const k of OPTIONAL_FIELDS) if (m[k] !== undefined) out[k] = m[k];
  out.builtin = true;
  return { manifest: out, parts: m.parts };
}

function buildOne(pluginsDir, id, written) {
  if (!PLUGIN_ID_RE.test(id) || RESERVED_PLUGIN_IDS.includes(id)) {
    throw new PluginBuildError(`plugin ${id}: id tidak valid atau dicadangkan`);
  }
  const dir = path.join(pluginsDir, id);
  const { manifest, parts } = readManifest(dir, id);
  const partsCode = readParts(dir, id, parts);
  let code;
  try {
    code = compileJsx(fs.readFileSync(path.join(dir, 'plugin.jsx'), 'utf8'), path.join(id, 'plugin.jsx'));
  } catch (err) {
    throw new PluginBuildError(`plugin ${id}: gagal kompilasi plugin.jsx: ${err.message}`);
  }
  // Manifest dari manifest.json disuntik sebagai konstanta `manifest` (satu sumber kebenaran); kode plugin
  // memanggil window.TF.plugins.register(manifest, factory). parts (mentah) mendahului kode plugin.jsx.
  const js = PLUGIN_HEADER +
    '(function () {\n' +
    '"use strict";\n' +
    'const manifest = Object.freeze(' + JSON.stringify(manifest) + ');\n' +
    partsCode +
    code.replace(/^"use strict";\n*/, '') + '\n' +
    '})();\n';
  const lint = lintPlugin(js, manifest);
  if (lint) {
    const hint = lint === '.fetch(' ? ' tanpa izin "network"' : '';
    throw new PluginBuildError(`plugin ${id}: lint — plugin.js tidak boleh memakai "${lint}"${hint} (pakai TF.api)`);
  }
  writeIfChanged(path.join(dir, 'plugin.js'), js, written);
  const files = ['plugin.js'];
  if (fs.existsSync(path.join(dir, 'style.css'))) files.push('style.css');
  const hash = crypto.createHash('sha1')
    .update(Buffer.concat(files.map((f) => fs.readFileSync(path.join(dir, f)))))
    .digest('hex').slice(0, 8);
  const entry = {};
  for (const k of MANIFEST_FIELDS) entry[k] = manifest[k];
  for (const k of OPTIONAL_FIELDS) if (manifest[k] !== undefined) entry[k] = manifest[k];
  entry.files = files;
  entry.hash = hash;
  return entry;
}

function writeSwBlock(swPath, index, written) {
  const sw = fs.readFileSync(swPath, 'utf8');
  const b = sw.indexOf(SW_BEGIN + '\n');
  const e = sw.indexOf(SW_END + '\n', b);
  if (b < 0 || e < 0) throw new PluginBuildError(`sw.js: penanda blok plugin tidak ditemukan (${SW_BEGIN.trim()} … ${SW_END.trim()})`);
  const lines = ['  "/static/plugins/index.json",'];
  for (const p of index.plugins) {
    for (const f of p.files) lines.push(`  "/static/plugins/${p.id}/${f}?v=${p.hash}",`);
  }
  const next = sw.slice(0, b + SW_BEGIN.length + 1) + lines.join('\n') + '\n' + sw.slice(e);
  writeIfChanged(swPath, next, written);
}

function buildPlugins(opts) {
  const o = opts || {};
  const pluginsDir = o.pluginsDir || path.join(__dirname, 'static', 'plugins');
  const swPath = o.swPath || path.join(__dirname, 'static', 'sw.js');
  const log = o.log || console.log;
  const written = [];
  const ids = fs.existsSync(pluginsDir) ? fs.readdirSync(pluginsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith('_') && fs.existsSync(path.join(pluginsDir, d.name, 'plugin.jsx')))
    .map((d) => d.name).sort() : [];
  const index = { v: 1, plugins: ids.map((id) => buildOne(pluginsDir, id, written)) };
  fs.mkdirSync(pluginsDir, { recursive: true });
  writeIfChanged(path.join(pluginsDir, 'index.json'), JSON.stringify(index, null, 2) + '\n', written);
  writeSwBlock(swPath, index, written);
  log(`Plugins: ${ids.length} dibangun${written.length ? ', ditulis: ' + written.map((f) => path.relative(__dirname, f)).join(', ') : ', tidak ada perubahan'}`);
  return { index, written };
}

module.exports = {
  buildPlugins, compileJsx, PluginBuildError, LINT_RE, lintPlugin,
  OPTIONAL_FIELDS, ICON_PATH_RE, validateContributes, validateTaskExt,
};

if (require.main === module) {
  const pluginsOnly = process.argv.includes('--plugins-only');
  if (!pluginsOnly && !compileIndex(console.log)) process.exit(1);
  try {
    buildPlugins({
      pluginsDir: process.env.ALURIK_PLUGINS_DIR || undefined,
      swPath: process.env.ALURIK_SW_PATH || undefined,
    });
  } catch (err) {
    console.error('ERROR plugin build:', err.message);
    process.exit(1);
  }
}
