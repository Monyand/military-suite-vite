const { readSource } = require('./source.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { webcrypto } = require('node:crypto');
const { createHarness } = require('./suite-backup-unit.cjs');
const source = readSource('core/documents.js');
const D = new Function('crypto', source + '\nreturn DocumentJournal;')(webcrypto);
const incoming = {
    tasks: [{ date: '14.09.2026', task: 'Перевірити реєстр документів', status: 'Виконано', reportedInPbd: 'Так', comment: 'Тест' }],
    ovt: [{ date: '2026-09-13', time: 0.5, category: 'Транспорт', nomenclature: 'Тестовий макет', status: 'ПОШКОДЖЕНО', serialNumber: 'TEST-VIN-001', position: 'Архівний запис', urgentDocNo: 'ТЕСТ/001', isEvent: false }],
    positions: [{ date: '12.09.2026', name: 'Документальний тест', status: 'знята', docNumber: 'ТЕСТ/002', details: 'Історичний запис для перевірки', reportedInPbd: false }]
};

async function main() {
    assert.equal(D.dateKey('31.02.2026'), '');
    assert.equal(D.dateKey('29.02.2024'), '2024-02-29');
    assert.equal(D.dateKey(25569), '1970-01-01');
    assert.equal(D.timeValue(0), '00:00');
    assert.equal(D.timeValue('9:05:00'), '09:05');
    assert.equal(D.timeValue('25:00'), '');
    assert.equal(D.checked('Ні'), false);
    const result = D.merge(D.empty(), incoming);
    assert.equal(result.added, 3);
    assert.equal(D.validate(result.next), result.next);
    assert.equal(result.next.ovt[0].time, '12:00');
    assert.equal(result.next.tasks[0].reportedInPbd, true);
    assert.equal(result.next.positions[0].reportedInPbd, false);
    assert.equal(D.merge(result.next, incoming).duplicates, 3);
    const changedFlag = structuredClone(incoming);
    changedFlag.positions[0].reportedInPbd = true;
    assert.equal(D.merge(result.next, changedFlag).next.positions[0].reportedInPbd, false, 'Import cannot overwrite PBD checkbox');
    assert.equal(D.merge(result.next, { ...incoming, assaults: [{ secret: 'never import' }], enemy: [], orders: [] }).next.assaults, undefined);
    assert.equal(D.filtered('positions', result.next.positions, { ...D.filters(), unreported: true }).length, 1);
    assert.equal(D.filtered('positions', result.next.positions, { ...D.filters(), search: 'тест/002' }).length, 1);
    assert.equal(D.filtered('positions', result.next.positions, { ...D.filters(), from: '2026-09-13' }).length, 0);
    assert.equal(D.hasDoc({ docNumber: 'неофіційно' }), false);
    assert.equal(D.filtered('positions', result.next.positions, { ...D.filters(), missingDoc: true }).length, 0);
    assert.equal(D.settings({ tab: 'enemy', filters: { positions: { search: {}, unreported: 'false' } } }).tab, 'tasks');
    assert.equal(D.settings({ filters: { positions: { search: {} } } }).filters.positions.search, '');
    assert.throws(() => D.validate({ ...result.next, positions: [...result.next.positions, result.next.positions[0]] }), /ID/);
    const workbook = { SheetNames: ['ЗАВДАННЯ', 'Статус позицій', 'ВТРАТИ ОВТ', 'Штурмові дії', 'Втрати противника', 'Виконання БР'], Sheets: {} };
    workbook.Sheets['ЗАВДАННЯ'] = [['head'], ['14.09.2026', 'Тест', 'Ні', 'Заплановано', 'note'], ['31.02.2026', 'Bad date', '', 'Виконано'], ['Дата', 'Повторна шапка']];
    workbook.Sheets['Статус позицій'] = [['head'], ['12.09.2026', 'Документальний тест', 'знята', 'ТЕСТ/002', 'note']];
    workbook.Sheets['ВТРАТИ ОВТ'] = [['head'], ['14.09.2026', 'broken time', '', 'Транспорт', 'TEST', 'ВТРАЧЕНО']];
    const readSheets = [];
    const parsed = D.readWorkbook(workbook, { utils: { sheet_to_json: sheet => { assert.ok(sheet); readSheets.push(sheet); return sheet; } } });
    assert.equal(readSheets.length, 3, 'Excluded sheets must never be read');
    assert.equal(parsed.ignored.length, 3);
    assert.equal(parsed.issues.length, 3);
    assert.equal(parsed.incoming.tasks.length, 1);
    assert.equal(parsed.incoming.positions[0].reportedInPbd, false, 'Old 5-column position sheet supported');
    assert.equal(parsed.incoming.positions[0].docNumber, 'ТЕСТ/002');
    const h = createHarness();
    h.persistent.set(D.KEY, result.next);
    h.storage.setItem('document_journal_view_v1', JSON.stringify({ ...result.next.settings, tab: 'positions' }));
    const snapshot = await h.api.collect();
    const encrypted = await h.api.encrypt(snapshot, 'test-document-password');
    assert.ok(!JSON.stringify(encrypted).includes('TEST-VIN-001'));
    const decrypted = await h.api.decrypt(encrypted, 'test-document-password');
    h.persistent.set(D.KEY, D.empty());
    await h.api.restore(decrypted, 'test-document-password');
    const restored = D.migrate(result.next);
    for (const tab of ['tasks', 'positions']) restored[tab].forEach(row => { row.reportedInPbd = false; });
    assert.deepEqual(h.persistent.get(D.KEY), restored, 'Transferred PBD flags never replace recipient state; a clean browser starts unreported');
    assert.equal(JSON.parse(h.storage.getItem('document_journal_view_v1')).tab, 'positions');
    assert.throws(() => h.api.validate({ ...snapshot, localforage: { [D.KEY]: {} } }), /журнал/);
    console.log('PASS: three-register allowlist, dates/times, old/new position schema, deduplication, PBD preservation, filters, encrypted backup/restore with settings');
}
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { D, incoming };
