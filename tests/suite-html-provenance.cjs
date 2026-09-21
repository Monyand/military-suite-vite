const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { readSource } = require('./source.cjs');
const root = path.resolve(__dirname, '..');
const manifest = require('../migration-manifest.json');
const hash = value => createHash('sha256').update(value).digest('hex');
const original = path.resolve(root, manifest.source);
if (fs.existsSync(original)) assert.equal(hash(fs.readFileSync(original)), manifest.sha256, 'Selected source HTML must remain unchanged');
assert.equal(manifest.source, '../Втрати противника/міл/MilitarySuite.html');
// Preserve the original extraction hashes; explicitly audit requested changes separately.
for (const [name, amendment] of Object.entries(manifest.amendments || {})) {
    assert.ok(name in manifest.payloadHashes, 'Amendment must refer to an original payload');
    assert.ok(amendment.date && amendment.reason && /^[a-f0-9]{64}$/.test(amendment.sha256), 'Amendment must be documented');
}
for (const [name, digest] of Object.entries(manifest.payloadHashes)) {
    assert.equal(hash(readSource(name).trim()), manifest.amendments?.[name]?.sha256 || digest, 'Application payload matches extraction or documented amendment: ' + name);
}
for (const file of ['core/history.js', 'core/dictionaries.js', 'core/migrations.js', 'components/SaveStatus.jsx', 'components/MigrationGate.jsx']) assert.equal(fs.existsSync(path.join(root, 'src', file)), false, 'Later-version feature must not be silently reintroduced: ' + file);
assert.ok(readSource('modules/personnel/personnel.js').includes('function runMigrations()'));
const modules = fs.readdirSync(path.join(root, 'src/modules')).sort();
assert.deepEqual(modules, ['documents', 'events', 'medical', 'personnel']);
console.log('PASS: application payloads match the HTML baseline or documented amendments; original SHA-256 unchanged; four blocks; later-version features absent');
