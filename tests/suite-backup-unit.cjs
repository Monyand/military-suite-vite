const { readSource } = require('./source.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { webcrypto } = require('node:crypto');

const source = readSource('core/backup.js');
assert.ok(source.includes('AES-GCM'), 'Backup source must be found');

function createHarness() {
    const persistent = new Map();
    const local = {};
    let failKey = null;
    const storage = {};
    Object.defineProperties(storage, {
        getItem: { value: key => Object.hasOwn(local, key) ? local[key] : null },
        setItem: { value: (key, value) => { local[key] = String(value); Object.defineProperty(storage, key, { configurable: true, enumerable: true, value: String(value) }); } },
        removeItem: { value: key => { delete local[key]; delete storage[key]; } },
        key: { value: index => Object.keys(local)[index] || null },
        length: { get: () => Object.keys(local).length }
    });
    const forage = {
        keys: async () => [...persistent.keys()],
        getItem: async key => persistent.has(key) ? structuredClone(persistent.get(key)) : null,
        setItem: async (key, value) => {
            if (key === failKey) { failKey = null; throw new Error('Simulated disk failure'); }
            persistent.set(key, structuredClone(value)); return value;
        },
        removeItem: async key => { persistent.delete(key); }
    };
    const api = new Function('window', 'localforage', 'localStorage', 'crypto', source + '\nreturn SuiteBackup;')(
        { crypto: webcrypto }, forage, storage, webcrypto);
    return { api, persistent, storage, failNext: key => { failKey = key; } };
}

async function main() {
    const { api, persistent, storage, failNext } = createHarness();
    const password = 'test-only-password-2026';
    persistent.set('document_test_v1', { marker: 'CONFIDENTIAL_TEST_MARKER', text: 'Українські дані 🔐' });
    persistent.set('enemy_settings_v1', { weapons: ['test'], positions: [], documentView: { showHistory: false } });
    persistent.set('med_settings_v3', { test: true });
    persistent.set('outside_scope', { untouched: true });
    storage.setItem('med_view_mode', 'list');
    storage.setItem('tactical_backup_schedule', '["09:00"]');
    storage.setItem('tactical_collapsed_groups', '{"test":true}');
    storage.setItem('outside_scope', 'untouched');
    const original = await api.collect();
    assert.equal(original.localstorage.med_view_mode, 'list');
    assert.equal(original.localforage.outside_scope, undefined);
    const encrypted = await api.encrypt(original, password);
    assert.equal(encrypted.cipher, 'AES-256-GCM');
    assert.equal(encrypted.iterations, 600000);
    assert.equal(Buffer.from(encrypted.salt, 'base64').length, 16);
    assert.equal(Buffer.from(encrypted.iv, 'base64').length, 12);
    assert.ok(!JSON.stringify(encrypted).includes('CONFIDENTIAL_TEST_MARKER'));
    assert.ok(!JSON.stringify(encrypted).includes(password));
    assert.deepEqual(await api.decrypt(encrypted, password), original);
    const repeated = await api.encrypt(original, password);
    assert.notEqual(repeated.salt, encrypted.salt);
    assert.notEqual(repeated.iv, encrypted.iv);
    assert.notEqual(repeated.ciphertext, encrypted.ciphertext);
    await assert.rejects(api.decrypt(encrypted, 'wrong-password'), /пароль/);
    const damaged = { ...encrypted };
    const bytes = Buffer.from(damaged.ciphertext, 'base64'); bytes[0] ^= 1;
    damaged.ciphertext = bytes.toString('base64');
    await assert.rejects(api.decrypt(damaged, password), /пошкоджено/);
    await assert.rejects(api.decrypt({ ...encrypted, iterations: 1e12 }, password), /формат/);
    assert.throws(() => api.validate({ ...original, localstorage: { outside_scope: 'bad' } }), /параметр/);
    assert.throws(() => api.validate(JSON.parse('{"format":"military-suite-unified","version":1,"localforage":{"__proto__":{}},"localstorage":{}}')), /Небезпечний/);
    assert.throws(() => api.validate({ ...original, localforage: { enemy_events_v2: {} } }), /список/);
    const legacy = await api.readFile(new Blob([JSON.stringify(original)]));
    assert.deepEqual(legacy, original);
    await assert.rejects(api.readFile(new Blob(['not json'])), /JSON/);
    await assert.rejects(api.readFile(new Blob(['{"format":"other"}'])), /єдину/);

    persistent.set('document_test_v1', { marker: 'CHANGED' });
    persistent.set('document_extra_v1', { newRecord: true });
    storage.setItem('med_view_mode', 'grid');
    storage.setItem('tactical_extra_setting', 'new');
    const beforeRestore = await api.collect();
    await api.restore(original, password);
    const restored = await api.collect();
    assert.deepEqual(restored.localforage, original.localforage);
    assert.deepEqual(restored.localstorage, original.localstorage);
    assert.deepEqual(persistent.get('outside_scope'), { untouched: true });
    assert.equal(storage.getItem('outside_scope'), 'untouched');
    assert.deepEqual((await api.decrypt(await api.getRecovery(), password)).localforage, beforeRestore.localforage);
    assert.ok(!JSON.stringify(await api.getRecovery()).includes('CHANGED'));

    failNext('med_settings_v3');
    await assert.rejects(api.restore(beforeRestore, password), /Попередні дані повернуто/);
    assert.deepEqual((await api.collect()).localforage, original.localforage);
    assert.deepEqual((await api.collect()).localstorage, original.localstorage);
    failNext('military_suite_recovery_v1');
    await assert.rejects(api.restore(beforeRestore, password), /Simulated/);
    assert.deepEqual((await api.collect()).localforage, original.localforage);
    console.log('PASS: AES-256-GCM round-trip, fresh salt/IV, wrong password, tampering, hostile/invalid files, legacy import, complete settings, scoped replacement, encrypted recovery and rollback on write failure.');
}
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { createHarness };
