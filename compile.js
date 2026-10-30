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
const LINT_RE = /tokenStore|API_BASE|fetch\(|localStorage/;
const MANIFEST_FIELDS = ['id', 'name', 'description', 'version', 'minApi', 'slots', 'permissions', 'defaultEnabled'];
const SW_BEGIN = '  // plugins:begin — ditulis compile.js dari static/plugins/index.json, jangan edit manual';
const SW_END = '  // plugins:end';

class PluginBuildError extends Error {}

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
  const out = {};
  for (const k of MANIFEST_FIELDS) out[k] = m[k];
  out.builtin = true;
  return out;
}

function buildOne(pluginsDir, id, written) {
  const dir = path.join(pluginsDir, id);
  const manifest = readManifest(dir, id);
  let code;
  try {
    code = compileJsx(fs.readFileSync(path.join(dir, 'plugin.jsx'), 'utf8'), path.join(id, 'plugin.jsx'));
  } catch (err) {
    throw new PluginBuildError(`plugin ${id}: gagal kompilasi plugin.jsx: ${err.message}`);
  }
  const lint = LINT_RE.exec(code);
  if (lint) throw new PluginBuildError(`plugin ${id}: lint — plugin.js tidak boleh memakai "${lint[0]}" (pakai TF.api)`);
  // Manifest dari manifest.json disuntik sebagai konstanta `manifest` (satu sumber kebenaran); kode plugin
  // memanggil window.TF.plugins.register(manifest, factory).
  const js = PLUGIN_HEADER +
    '(function () {\n' +
    '"use strict";\n' +
    'const manifest = Object.freeze(' + JSON.stringify(manifest) + ');\n' +
    code.replace(/^"use strict";\n*/, '') + '\n' +
    '})();\n';
  writeIfChanged(path.join(dir, 'plugin.js'), js, written);
  const files = ['plugin.js'];
  if (fs.existsSync(path.join(dir, 'style.css'))) files.push('style.css');
  const hash = crypto.createHash('sha1')
    .update(Buffer.concat(files.map((f) => fs.readFileSync(path.join(dir, f)))))
    .digest('hex').slice(0, 8);
  const entry = {};
  for (const k of MANIFEST_FIELDS) entry[k] = manifest[k];
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

module.exports = { buildPlugins, compileJsx, PluginBuildError, LINT_RE };

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
