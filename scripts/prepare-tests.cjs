const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const previous = path.resolve(root, '../military-suite-vite/tests');
fs.mkdirSync(path.join(root, 'tests'), { recursive: true });
const names = ['source', 'source-audit', 'suite-backup-unit', 'suite-document-journal', 'suite-medical-totals', 'suite-personnel-directory', 'suite-navigation-filters', 'suite-selected-fixes', 'suite-controls-backup', 'suite-merge-audit'];
for (const name of names) {
  const out = path.join(root, 'tests', name + '.cjs');
  if (fs.existsSync(out)) throw new Error('Refusing to overwrite test: ' + name);
  fs.copyFileSync(path.join(previous, name + '.cjs'), out);
}
console.log('Copied regression suites applicable to the selected HTML version.');
