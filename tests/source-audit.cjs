const fs = require('node:fs');
const path = require('node:path');
const babel = require('@babel/core');
exports.references = () => {
  const references = new Map();
  const walk = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (/\.(js|jsx)$/.test(file)) babel.transformSync(fs.readFileSync(file, 'utf8'), {
        filename: file, ast: false, code: false, parserOpts: { plugins: ['jsx'] }, plugins: [() => ({ visitor: {
          ReferencedIdentifier(p) { if (!p.scope.hasBinding(p.node.name)) references.set(p.node.name, path.relative(dir, file) + ':' + p.node.loc.start.line); }
        } })]
      });
    }
  };
  walk(path.join(__dirname, '../src'));
  return references;
};
