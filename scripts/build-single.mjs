import { build } from 'vite';
import { parseSync } from '@babel/core';
import { mkdir, writeFile, rename } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);
// Build in memory first. Never clear folders or overwrite the original HTML.
const result = await build({ root, configFile: resolve(root, 'vite.config.js'), mode: 'single', build: { write: false } });
const output = (Array.isArray(result) ? result : [result]).flatMap(bundle => bundle.output || []);
if (output.length !== 1 || output[0].type !== 'asset' || !output[0].fileName.endsWith('.html')) {
  throw new Error('Single-file build still has external assets: ' + output.map(file => file.fileName).join(', '));
}
let html = String(output[0].source);
const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)];
if (scripts.length !== 1 || /\bsrc\s*=/i.test(scripts[0][1])) throw new Error('Expected one inline application script');
const script = scripts[0][2];
const ast = parseSync(script, { sourceType: 'module' });
if (ast.program.body.some(node => /^(Import|Export)/.test(node.type))) throw new Error('External ES module dependency remains');
const markup = html.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, '');
if (/<link\b[^>]*\bhref\s*=/i.test(markup) || /\b(?:src|srcset)\s*=\s*["'](?!data:|#)/i.test(markup)) throw new Error('External markup resource remains');
for (const [, css] of markup.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi)) {
  for (const [, , url] of css.matchAll(/url\(\s*(["']?)(.*?)\1\s*\)/gi)) {
    if (!/^(data:|#)/i.test(url)) throw new Error('External CSS resource remains: ' + url);
  }
}
// Adapt only the static loading hint; the application code is unchanged.
html = html.replace('Завантаження Military Suite… Якщо цей напис не зникає, відкрийте програму через start.cmd, а не як HTML-файл.',
  'Завантаження Military Suite… Для роботи потрібен браузер, у якому дозволений JavaScript у локальних HTML-файлах.');
const folder = resolve(root, 'dist-single');
const target = resolve(folder, 'MilitarySuite.html');
if (dirname(folder) !== root || dirname(target) !== folder) throw new Error('Invalid output path');
await mkdir(folder, { recursive: true });
await writeFile(target + '.tmp', html, 'utf8');
await rename(target + '.tmp', target);
console.log('\nГотово: dist-single/MilitarySuite.html (' + (Buffer.byteLength(html) / 1024 / 1024).toFixed(2) + ' MiB). Сервер для запуску не потрібен.');
