const fs = require('node:fs');
const path = require('node:path');
// Storage fakes execute the same pure core code, without bundler import/export syntax.
exports.readSource = name => fs.readFileSync(path.join(__dirname, '../src', name), 'utf8')
  .replace(/^import .*;\r?\n/gm, '')
  .replace(/^export \{[^}]*\};?\r?\n?/gm, '');
