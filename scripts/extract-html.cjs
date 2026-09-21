// Mechanical extraction from the exact HTML selected by the user. No ../src reads.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const babel = require('@babel/core');
const root = path.resolve(__dirname, '..');
const base = path.resolve(root, '../міл/MilitarySuite.html');
const infrastructure = path.resolve(root, '../military-suite-vite');
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const raw = fs.readFileSync(base);
const html = raw.toString('utf8').replace(/\r\n/g, '\n');
const write = (name, data) => { const out = path.join(root, name); fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, data); };
if (fs.existsSync(path.join(root, 'src'))) throw new Error('Source already exists. Extraction cannot overwrite it.');

// Reuse build infrastructure only, never later application modules or features.
for (const file of ['package.json', 'package-lock.json', '.gitignore', 'index.html', 'vite.config.js', 'postcss.config.cjs', 'tailwind.config.cjs', 'start.cmd', 'start.ps1', 'src/main.jsx', 'src/core/vendor.js', 'src/app/loadModules.js', 'src/modules/events/index.js', 'src/modules/medical/index.js', 'src/modules/documents/index.js', 'src/modules/personnel/index.js']) write(file, fs.readFileSync(path.join(infrastructure, file)));

const scripts = [...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)].filter(match => match[2].trim());
if (scripts.length !== 3 || !scripts[2][1].includes('text/babel')) throw new Error('Unexpected HTML script structure');
const [runtime, nativeScript, jsxScript] = scripts.map(match => match[2]);
const starts = ['const { useState', 'window.EnemyLossesModule =', 'window.MedTacticalModule =', 'const DocumentJournal =', 'const DocumentJournalIcon =', 'const SuiteBackup =', 'const RootApp ='];
const parts = starts.map((marker, i) => {
  const from = jsxScript.indexOf(marker), to = i + 1 < starts.length ? jsxScript.indexOf(starts[i + 1]) : jsxScript.length;
  if (from < 0 || to <= from) throw new Error('Cannot locate module ' + marker);
  return jsxScript.slice(from, to);
});
const code = new Map();
code.set('core/runtime.js', runtime.slice(0, runtime.indexOf('        tailwind.config =')));
code.set('core/medical-totals.js', parts[0].slice(parts[0].indexOf('const MedicalDailyTotals'), parts[0].indexOf('const MedicalPersonnelDirectory')));
code.set('core/personnel-directory.js', parts[0].slice(parts[0].indexOf('const MedicalPersonnelDirectory')));
code.set('modules/events/EventsApp.jsx', parts[1].replace('window.EnemyLossesModule =', 'const EventsApp ='));
code.set('modules/medical/MedicalApp.jsx', parts[2].replace('window.MedTacticalModule =', 'const MedicalApp ='));
code.set('core/documents.js', parts[3]);
code.set('modules/documents/DocumentsApp.jsx', parts[4]);
code.set('core/backup.js', parts[5]);
code.set('app/App.jsx', parts[6].replace('const RootApp = () =>', 'const RootApp = ({ EventsApp, MedicalApp, DocumentJournalApp }) =>')
  .replace('window.EnemyLossesModule', 'EventsApp').replace('window.MedTacticalModule', 'MedicalApp')
  .replace(/\s*const root = ReactDOM\.createRoot\([\s\S]+$/, '\n'));

// ESM executes after DOMContentLoaded in a dynamically imported module. Preserve
// the original startup body but invoke it after the native markup is mounted.
let native = nativeScript.replace(/\s*if \(typeof (?:tailwind|lucide|XLSX) === 'undefined'\) \{\s*document\.write\([^\n]+\);\s*\}/g, '');
const initFrom = native.indexOf("document.addEventListener('DOMContentLoaded', () => {");
const initTo = native.indexOf('// ─── УТИЛІТИ', initFrom);
if (initFrom < 0 || initTo < 0) throw new Error('Native startup boundary missing');
const startup = native.slice(initFrom, initTo).replace("document.addEventListener('DOMContentLoaded', () => {", 'function bootstrapPersonnel() {')
  .replace("typeof tailwind === 'undefined' || ", '').replace(/\}\);\s*$/, '}\n\n    ');
native = native.slice(0, initFrom) + startup + native.slice(initTo);
const returnMarker = '            return {\n                init: () => {';
if (!native.includes(returnMarker)) throw new Error('Native API boundary missing');
native = native.replace(returnMarker, '            bootstrapPersonnel();\n' + returnMarker);
code.set('modules/personnel/personnel.js', 'const createPersonnelModule = () => {\n    if (window.TacticalModule) return;\n' + native + '\n};\n');

const providers = new Map(), exported = new Map();
for (const [file, source] of code) {
  const names = [];
  babel.transformSync(source, { filename: file, parserOpts: { plugins: ['jsx'] }, code: false, plugins: [() => ({ visitor: {
    Program(p) { for (const name of Object.keys(p.scope.bindings)) { if (providers.has(name)) throw new Error('Duplicate binding ' + name); names.push(name); providers.set(name, file); } }
  } })] });
  exported.set(file, names);
}
const hooks = new Set(['useState', 'useEffect', 'useMemo', 'useRef', 'useCallback', 'startTransition']);
const vendors = new Set(['ReactDOM', 'lucide', 'Chart', 'ChartDataLabels', 'ExcelJS', 'CryptoJS', 'localforage', 'XLSX']);
const payloadHashes = {};
for (const [file, source] of code) {
  const imports = new Map();
  const relative = target => { const rel = path.posix.relative(path.posix.dirname(file), target); return rel.startsWith('.') ? rel : './' + rel; };
  const add = (from, name) => { if (!imports.has(from)) imports.set(from, new Set()); imports.get(from).add(name); };
  babel.transformSync(source, { filename: file, parserOpts: { plugins: ['jsx'] }, code: false, plugins: [() => ({ visitor: {
    ReferencedIdentifier(p) {
      const name = p.node.name;
      if (p.scope.hasBinding(name)) return;
      if (name === 'React' || hooks.has(name)) add('react', name === 'React' ? 'default as React' : name);
      else if (vendors.has(name)) add(relative('core/vendor.js'), name);
      else if (providers.has(name)) add(relative(providers.get(name)), name);
    }
  } })] });
  const header = [...imports].map(([from, names]) => `import { ${[...names].join(', ')} } from '${from}';`).join('\n');
  const names = exported.get(file);
  write('src/' + file, header + '\n\n' + source.trim() + '\n' + (names.length ? `\nexport { ${names.join(', ')} };\n` : ''));
  payloadHashes[file] = digest(source.trim());
}
const nativeMarkup = html.slice(html.indexOf('<div id="app-tactical-container"'), html.indexOf('<!-- TACTICAL JS ISOLATION -->')).trim();
if (!nativeMarkup.startsWith('<div') || nativeMarkup.includes('<script')) throw new Error('Invalid native markup boundary');
write('src/modules/personnel/shell.html', nativeMarkup);
const css = /    <style>([\s\S]*?)    <\/style>/.exec(html);
write('src/styles/app.css', '@tailwind base;\n@tailwind components;\n@tailwind utilities;\n' + css[1].trim() + '\n');
write('migration-manifest.json', JSON.stringify({ createdAt: new Date().toISOString(), source: '../міл/MilitarySuite.html', sha256: digest(raw), sourceBytes: raw.length, sourceLines: html.split('\n').length, payloadHashes, adaptations: ['Explicit imports/exports and four module entry points', 'Native startup after static markup mount; original runMigrations retained', 'Build-time JSX/Tailwind and local vendor packages; no later ../src features'] }, null, 2) + '\n');
if (digest(fs.readFileSync(base)) !== digest(raw)) throw new Error('Source changed during extraction');
console.log('Extracted ' + code.size + ' modules directly from selected HTML; source untouched.');
