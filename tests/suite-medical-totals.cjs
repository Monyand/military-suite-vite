const { readSource } = require('./source.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = readSource('core/medical-totals.js');
const localMedicalInput = new Function(readSource('core/medical-records.js').replace(/^export /gm, '') + '\nreturn localMedicalInput;')();
const html = readSource('modules/events/EventsApp.jsx');
function harness(forageValue, legacy = {}) {
    return new Function('localforage', 'localStorage', 'localMedicalInput', source + '\nreturn MedicalDailyTotals;')(
        { getItem: async () => forageValue }, { getItem: key => legacy[key] ?? null }, localMedicalInput);
}
const fixture = [
    { id: 'dead', date: '2026-09-14T23:59:00', lossType: 'Загибель (200)', evacTime: '2026-09-16' },
    { id: 'wounded', date: '2026-09-14', lossType: 'Поранення (300)' },
    { id: 'trauma', date: '14.09.2026 10:15', lossType: 'Бойове травмування (300)' },
    { id: 'trauma-old', date: '2026-09-14', lossType: 'Бойове травмування' },
    { id: 'missing', date: '2026-09-15T00:01:00', lossType: 'Зниклий безвісти (ЗБВ)' },
    { id: 'noncombat200', date: '2026-09-14', lossType: 'Небойова смерть (200)' },
    { id: 'noncombat300', date: '2026-09-14', lossType: 'Небойове травмування (300)' },
    { id: 'awol', date: '2026-09-14', lossType: 'СЗЧ' },
    { id: 'desertion', date: '2026-09-14', lossType: 'Дезертирство' },
    { id: 'unknown', date: '2026-09-14', lossType: 'Невідомий тип 300' },
    { id: 'invalid', date: '2026-02-30', lossType: 'Загибель (200)' },
    { id: 'invalid-2', date: '', lossType: 'Поранення (300)' },
    { id: 'dead', date: '2026-09-14', lossType: 'Загибель (200)' }
];
async function main() {
    const api = harness(fixture);
    const result = await api.read();
    assert.deepEqual(result.daily, {
        '2026-09-14': { count200: 1, count300: 3, countZBV: 0, source: 'medical' },
        '2026-09-15': { count200: 0, count300: 0, countZBV: 1, source: 'medical' }
    });
    assert.equal(result.included, 5);
    assert.equal(result.excluded, 5);
    assert.equal(result.invalid, 2);
    assert.equal(result.duplicates, 1);
    assert.deepEqual(await api.read(), result, 'Repeated reads never accumulate counts');
    assert.equal(api.dateKey('2024-02-29'), '2024-02-29');
    assert.equal(api.dateKey('2026-02-29'), '');
    assert.equal(api.dateKey('2026-13-01'), '');
    assert.equal(api.dateKey('2026-09-14T23:59:00Z'), localMedicalInput('2026-09-14T23:59:00Z').slice(0, 10), 'Use the same local episode day as medical UI');
    assert.equal(api.dateKey(45550.5), '2024-09-15');
    assert.equal(api.dateKey('14.09.2026 22:55'), '2026-09-14');
    const edited = fixture.filter(row => !['dead', 'wounded', 'trauma-old'].includes(row.id)).map(row => row.id === 'trauma' ? { ...row, date: '2026-09-15' } : row);
    assert.deepEqual(api.aggregate(edited).daily, { '2026-09-15': { count200: 0, count300: 1, countZBV: 1, source: 'medical' } });
    assert.deepEqual((await harness([], { med_episodes_v2: JSON.stringify(fixture) }).read()).daily, {}, 'Empty current database overrides old records');
    assert.deepEqual((await harness(null, { med_episodes_v2: JSON.stringify(fixture) }).read()).daily, result.daily);
    assert.deepEqual((await harness(null).read()).daily, {});
    await assert.rejects(harness({}).read(), /формат/);
    await assert.rejects(harness(null, { med_episodes_v3: 'broken JSON' }).read());
    const samePerson = [
        { id: 'episode-a', soldierId: 'same-person', date: '2026-09-14', lossType: 'Поранення (300)' },
        { id: 'episode-b', soldierId: 'same-person', date: '2026-09-15', lossType: 'Загибель (200)' }
    ];
    assert.equal(api.aggregate(samePerson).included, 2, 'Distinct documented episodes remain in their historical dates');
    assert.ok(!/importFriendlyLossesFromExcel|handleFriendlyLossChange|saveDailyFriendlyLosses|excelFileRef/.test(html));
    console.log('PASS: medical source only, 200/300/ZBV mapping, combat trauma, exclusions, dates, duplicates, edits/deletions, empty DB, legacy fallback, invalid-data errors and removed manual/Excel handlers.');
}
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { fixture };
