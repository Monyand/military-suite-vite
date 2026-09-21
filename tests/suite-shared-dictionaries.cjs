const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { readSource } = require('./source.cjs');

(async () => {
    const model = await import('../src/core/shared-dictionaries.js');
    const positions = await import('../src/modules/documents/position-register.js');
    const { emptyDictionaries, addRules, parseReplacementPairs, validateDictionaries, canonicalLabel, planLabelReplacement, inventoryLabels, snapshotSignature, DICTIONARY_KEY } = model;
    let config = addRules(emptyDictionaries(), 'units', parseReplacementPairs('старий\tСтандарт\nваріант → Стандарт'));
    config = addRules(config, 'ranks', [{ from: 'с-т', to: 'Сержант' }]);
    config = addRules(config, 'docPlaces', [{ from: 'архів а', to: 'Архів А' }]);
    config = addRules(config, 'actualPlaces', [{ from: 'місце-а', to: 'Місце А' }]);
    config = addRules(config, 'weapons', [{ from: 'засіб-а', to: 'Засіб А' }]);
    config = addRules(config, 'causes', [{ from: 'причина-а', to: 'Причина А' }]);
    assert.equal(canonicalLabel(config, 'units', '  СТАРИЙ  '), 'Стандарт');
    assert.equal(canonicalLabel(config, 'units', 'старий додатково'), undefined);
    assert.equal(model.normalizeLabel('  Об’єкт   №1 '), "об'єкт no1");
    assert.throws(() => parseReplacementPairs('a → b → c'), /Рядок 1/);
    assert.throws(() => parseReplacementPairs(''), /хоча б/);
    assert.throws(() => addRules(config, 'units', [{ from: 'старий', to: 'Другий стандарт' }]), /інше правило/);
    assert.throws(() => addRules(config, 'units', [{ from: 'Стандарт', to: 'Новий стандарт' }]), /Правило/);
    const invalid = emptyDictionaries(); invalid.dictionaries.units.canonical = ['Одна', 'одна'];
    assert.throws(() => validateDictionaries(invalid), /Дві стандартні/);
    const record = { id: 'same', unit: 'старий', rank: 'с-т', name: 'старий', status: 'старий', description: 'старий', positionId: 'старий' };
    const journal = { version: 1, tasks: [], ovt: [{ id: 'ovt', position: 'архів а' }], positions: [{ id: 'doc1', name: 'архів а', status: 'виставлена', date: '2026-01-01' }], settings: {}, positionAudit: [{ before: { name: 'архів а' } }] };
    const snapshot = { format: 'military-suite-unified', version: 1, localforage: {
        med_soldiers_v3: [record],
        med_episodes_v3: [{ ...record, personnelSnapshot: { ...record }, cause: 'причина-а', docLoc: 'архів а', actualLoc: 'місце-а' }],
        med_settings_v3: { units: ['старий', 'Стандарт'], ranks: ['Сержант', 'Сержант'], sectors: ['архів а'], medicalChartViews: { visible: [] } },
        enemy_events_v2: [{ id: 'event', actionDetails: { docLoc: 'архів а', factLoc: 'місце-а', conductedBy: 'старий', position: 'архів а' }, enemyLosses: [{ weapon: 'засіб-а', inflicter: 'старий', callsign: 'старий' }], description: 'архів а' }],
        document_journal_v1: journal,
        document_before_restore_v1: { old: 'старий' },
        med_logs_v3: [{ text: 'старий' }],
    }, localstorage: {
        tactical_personnel: JSON.stringify([record]), tactical_positions: '[ { "name": "архів а", "state": "старий" } ]', tactical_rotations: '[{"unit":"старий"}]', med_episodes_v2: JSON.stringify([{ unit: 'старий' }]),
    } };
    const raw = JSON.stringify(snapshot);
    const plan = planLabelReplacement(snapshot, config, model.DICTIONARY_KINDS.map(([kind]) => kind));
    assert.equal(JSON.stringify(snapshot), raw, 'Preview must never mutate input');
    assert.equal(plan.next.localforage.med_soldiers_v3[0].unit, 'Стандарт');
    assert.equal(plan.next.localforage.med_soldiers_v3[0].name, 'старий');
    assert.equal(plan.next.localforage.med_episodes_v3[0].personnelSnapshot.rank, 'Сержант');
    assert.equal(plan.next.localforage.enemy_events_v2[0].enemyLosses[0].inflicter, 'старий', 'Ambiguous field excluded by default');
    assert.equal(plan.next.localforage.enemy_events_v2[0].actionDetails.position, 'архів а', 'Non-documentary assignment excluded');
    assert.equal(plan.next.localforage.enemy_events_v2[0].actionDetails.conductedBy, 'старий', 'Callsigns excluded');
    assert.equal(plan.next.localstorage.tactical_positions, snapshot.localstorage.tactical_positions);
    assert.equal(plan.next.localstorage.tactical_rotations, snapshot.localstorage.tactical_rotations);
    assert.deepEqual(plan.next.localforage.med_logs_v3, snapshot.localforage.med_logs_v3);
    assert.deepEqual(plan.next.localforage.document_journal_v1.positionAudit, journal.positionAudit);
    assert.equal(plan.next.localforage[DICTIONARY_KEY].history.length, 1);
    const unitOnly = planLabelReplacement(snapshot, config, ['units']);
    assert.deepEqual(unitOnly.next.localforage.med_settings_v3.units, ['Стандарт']);
    assert.deepEqual(unitOnly.next.localforage.med_settings_v3.ranks, ['Сержант', 'Сержант'], 'Unchanged option lists must not be deduplicated');
    assert.deepEqual(unitOnly.next.localforage.med_settings_v3.medicalChartViews, { visible: [] });
    assert.equal(planLabelReplacement(snapshot, config, ['units'], true).next.localforage.enemy_events_v2[0].enemyLosses[0].inflicter, 'Стандарт');
    assert.equal(inventoryLabels(snapshot, config).units.find(item => item.value === 'старий').canonical, 'Стандарт');
    const changedUnrelated = structuredClone(snapshot); changedUnrelated.localforage.med_logs_v3.push({ text: 'new log' });
    assert.notEqual(snapshotSignature(snapshot), snapshotSignature(changedUnrelated), 'Stale guard includes unrelated data');
    assert.equal(snapshotSignature(snapshot), snapshotSignature({ ...snapshot, timestamp: 'later' }));
    assert.throws(() => inventoryLabels({ ...snapshot, localstorage: { tactical_personnel: '{' } }, config), /Не вдалося/);

    // Same service code with isolated storage; no real browser records accessed.
    const source = readSource('core/dictionary-service.js').replace('export const SharedDictionaries', 'const SharedDictionaries');
    let storage = structuredClone(snapshot), restored = false, frozen = false, suspended = false;
    const runtime = { freeze() { frozen = true; }, async drain() {}, async setItem(key, value) { storage.localforage[key] = structuredClone(value); } };
    const service = new Function('window', 'localforage', 'SuiteBackup', ...Object.keys(model), 'positionChangeError', 'withPositionAudit', 'documentaryNameCatalog', source + '\nreturn SharedDictionaries;')(
        { SuiteRuntime: runtime, dispatchEvent() {}, addEventListener() {} }, { async getItem(key) { return structuredClone(storage.localforage[key] ?? null); } },
        { async collect() { return structuredClone(storage); }, async restore(next, password) { restored = true; assert.ok(password.length >= 12); storage = structuredClone(next); return { cipher: 'AES-256-GCM' }; } },
        ...Object.values(model), positions.positionChangeError, positions.withPositionAudit, positions.documentaryNameCatalog);
    await service.initialize(); await service.save(config);
    const templateRow = { category: 'Транспорт', status: 'ПОШКОДЖЕНО', equipmentType: 'Тестовий тип', consequence: 'тестовий наслідок' };
    const dictionaryBefore = service.read(), writeItem = runtime.setItem;
    runtime.setItem = async () => { throw new Error('test quota'); };
    await assert.rejects(service.learnOvt(templateRow), /test quota/);
    assert.deepEqual(service.read(), dictionaryBefore, 'Failed learning must not advertise unsaved templates');
    runtime.setItem = writeItem;
    storage.localforage[DICTIONARY_KEY].dictionaries.units.canonical.push('Нова назва з іншого вікна');
    await service.learnOvt(templateRow);
    assert.ok(service.read().dictionaries.units.canonical.includes('Нова назва з іншого вікна'), 'Learning reads current persisted dictionary');
    assert.equal(service.ovtTemplates().consequences[0].status, 'ПОШКОДЖЕНО');
    assert.ok(service.options('units', ['старий']).includes('Стандарт'));
    assert.ok(!service.options('units', ['старий']).includes('старий'));
    assert.ok(service.options('units', ['старий'], 'старий').includes('старий'), 'Already selected raw value preserved');
    assert.ok(service.options('docPlaces').includes('архів а'), 'Document registry spelling is authoritative until a correction is confirmed');
    const preview = await service.preview(config, ['units']);
    await assert.rejects(service.apply(preview, 'short', () => {}), /12 символів/);
    assert.equal(frozen, false, 'Password validation before suspension');
    storage.localforage.med_logs_v3.push({ text: 'concurrent edit' });
    await assert.rejects(service.apply(preview, 'test-password-2026', () => { suspended = true; }), /дані змінилися/);
    assert.equal(suspended, true); assert.equal(restored, false, 'Stale plan cannot restore');
    const fresh = await service.preview(config, ['units']);
    await service.apply(fresh, 'test-password-2026', () => {});
    assert.equal(restored, true); assert.equal(storage.localforage.med_logs_v3.at(-1).text, 'concurrent edit');

    storage = structuredClone(snapshot);
    storage.localforage.document_journal_v1 = { ...journal, positions: [{ id: 'a', name: 'A', status: 'виставлена', date: '2026-01-01' }, { id: 'b', name: 'B', status: 'виставлена', date: '2026-01-02' }] };
    await assert.rejects(service.preview(addRules(emptyDictionaries(), 'docPlaces', [{ from: 'B', to: 'A' }]), ['docPlaces']), /історію|реєстрі/);
    const docConfig = addRules(emptyDictionaries(), 'docPlaces', [{ from: 'A', to: 'Виправлено' }]);
    const docPlan = await service.preview(docConfig, ['docPlaces']);
    assert.equal(docPlan.next.localforage.document_journal_v1.positionAudit.at(-1).before.name, 'A');
    assert.equal(docPlan.next.localforage.document_journal_v1.positionAudit.at(-1).after.name, 'Виправлено');
    assert.equal(docPlan.next.localforage.document_journal_v1.positions[0].id, 'a');
    console.log('PASS: shared dictionaries, exact aliases, parsing, allowlists, old stores, no record merging, preserved fields, history, preview, stale guard and document integrity');
})().catch(error => { console.error(error); process.exit(1); });
