#!/usr/bin/env node
/**
 * Pre-compiles JSX in static/index.html to plain JavaScript.
 * Run after `git pull`, before restarting the service.
 * Source (with JSX) stays in git; compiled version is what gets served.
 */

const fs   = require('fs');
const path = require('path');
const babel = require('@babel/core');

const htmlPath = path.join(__dirname, 'static', 'index.html');
let html = fs.readFileSync(htmlPath, 'utf8');

// Remove babel.min.js — no longer needed at runtime
html = html.replace(/[ \t]*<script src="\/static\/vendor\/babel\.min\.js"><\/script>\n?/, '');

const START = '<script type="text/babel">';
const END   = '</script>';

const startIdx = html.indexOf(START);
if (startIdx === -1) {
  console.log('No <script type="text/babel"> found — already compiled, skipping.');
  process.exit(0);
}

const contentStart = startIdx + START.length;
const endIdx       = html.indexOf(END, contentStart);
if (endIdx === -1) {
  console.error('ERROR: could not find closing </script>');
  process.exit(1);
}

const jsxContent = html.slice(contentStart, endIdx);
console.log(`Extracted ${jsxContent.length.toLocaleString()} bytes of JSX`);
console.log('Compiling...');

let result;
try {
  result = babel.transformSync(jsxContent, {
    presets: [['@babel/preset-react', { runtime: 'classic' }]],
    compact: false,
  });
} catch (err) {
  console.error('Compile error:', err.message);
  process.exit(1);
}

console.log(`Compiled → ${result.code.length.toLocaleString()} bytes`);

const output =
  html.slice(0, startIdx) +
  '<script>\n' +
  result.code  +
  '\n'         +
  html.slice(endIdx);   // starts with </script>

fs.writeFileSync(htmlPath, output);
console.log('Done — written to static/index.html');
