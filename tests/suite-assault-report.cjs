const assert = require('node:assert/strict');

const fixture = (extra = {}) => ({
    id: 'report-fixture', types: ['ШД'], isRealEvent: true, createdAt: '2026-09-20T10:00:00Z',
    description: 'Синтетичний документ для перевірки шаблону',
    actionDetails: { startDate: '2026-09-18', startTime: '18:00', endTime: '19:30', endDate: '', direction: 'Зелена долина', docLoc: 'БП "Огірок"', factLoc: 'Не підставляти фактичне місце', friendlyCount: 4, enemySize: 2, hasVehicles: false, vehicleDetails: '' },
    friendlyLosses: { count200: 0, count300: 0, countZBV: 0, details: '' }, enemyLosses: [], ...extra
});
module.exports = { fixture };

async function run() {
    const { buildAssaultReport: build, isCompletedAssault, numberToUkrainianWords: words } = await import('../src/modules/events/assault-report.js');
    const noLosses = fixture(), unchanged = JSON.stringify(noLosses);
    const report = build(noLosses);
    assert.equal(report.available, true);
    assert.equal(report.text, '18:00 - 19:30 18.09.2026 бойове зіткнення з напрямку Зелена долина на БП "Огірок" (4 в/с), ШГр до 2 в/сл противника без техніки. Втрати о/с відсутні. Позиція не втрачена. Противник успіху не мав. результат: уточнюється.');
    assert.ok(report.warnings.some(message => message.includes('формулювання з вашого шаблону')));
    assert.ok(!report.text.includes(noLosses.actionDetails.factLoc));
    assert.equal(JSON.stringify(noLosses), unchanged);
    const losses = fixture({ friendlyLosses: { count200: 2, count300: 1, countZBV: 3 }, enemyLosses: [
        { count200: 1, count300: '2', count200Unconfirmed: 8, count200Discovered: 10, countPOW: 2, count200POW: 3 },
        { count200: '3', count300: 3 }
    ] });
    const originalLosses = JSON.stringify(losses), completed = build(losses);
    assert.ok(completed.text.includes('Втрати: безповоротні - 2 (ДВА) в/сл; санітарні - 1 (ОДИН) в/сл; зниклі безвісти - 3 (ТРИ) в/сл.'));
    assert.ok(completed.text.endsWith("результат: ЗНИЩЕНО – 22 (ДВАДЦЯТЬ ДВА) В/СЛ ЗС рф, ПОРАНЕНО – 5 (П'ЯТЬ) В/СЛ ЗС рф."));
    assert.ok(completed.warnings.some(message => message.includes('не додано')));
    assert.ok(completed.warnings.some(message => message.includes('звичайні — 4; непідтверджені — 8; виявлені — 10')));
    assert.equal(JSON.stringify(losses), originalLosses);
    for (const [number, text] of [[0, 'НУЛЬ'], [1, 'ОДИН'], [2, 'ДВА'], [4, 'ЧОТИРИ'], [5, "П'ЯТЬ"], [11, 'ОДИНАДЦЯТЬ'], [19, "ДЕВ'ЯТНАДЦЯТЬ"], [21, 'ДВАДЦЯТЬ ОДИН'], [47, 'СОРОК СІМ'], [99, "ДЕВ'ЯНОСТО ДЕВ'ЯТЬ"], [100, 'СТО'], [214, 'ДВІСТІ ЧОТИРНАДЦЯТЬ'], [1000, 'ОДНА ТИСЯЧА'], [2002, 'ДВІ ТИСЯЧІ ДВА'], [11000, 'ОДИНАДЦЯТЬ ТИСЯЧ'], [21000, 'ДВАДЦЯТЬ ОДНА ТИСЯЧА'], [22001, 'ДВАДЦЯТЬ ДВІ ТИСЯЧІ ОДИН'], [999999, "ДЕВ'ЯТСОТ ДЕВ'ЯНОСТО ДЕВ'ЯТЬ ТИСЯЧ ДЕВ'ЯТСОТ ДЕВ'ЯНОСТО ДЕВ'ЯТЬ"]]) assert.equal(words(number), text);
    for (const invalid of [-1, 1.1, NaN, Infinity, 1000000, null, undefined, true, '', ' ', '2x', '2.5']) assert.equal(words(invalid), '');
    assert.equal(words(' 12 '), 'ДВАНАДЦЯТЬ');
    for (const details of [{ endTime: '' }, { endTime: '24:00' }, { endTime: '19:99' }]) {
        const event = fixture({ actionDetails: { ...noLosses.actionDetails, ...details } });
        assert.equal(isCompletedAssault(event), false); assert.equal(build(event).text, '');
    }
    assert.equal(build(fixture({ types: ['УПД'] })).available, false);
    const missing = build(fixture({ actionDetails: { endTime: '19:30', factLoc: 'Не документальне місце' }, friendlyLosses: undefined, enemyLosses: undefined }));
    assert.ok(missing.text.includes('[дата уточнюється]'));
    assert.ok(missing.text.includes('[документальна позиція уточнюється]'));
    assert.ok(missing.text.includes('[наявність техніки уточнюється]'));
    assert.ok(!missing.text.includes('Втрати о/с відсутні'));
    assert.ok(!missing.text.includes('20.09.2026'), 'Creation timestamp is not substituted as event date');
    assert.ok(!missing.text.includes('Не документальне місце'));
    assert.ok(build(fixture({ friendlyLosses: { count200: -1, count300: 0, countZBV: 0 } })).text.includes('безповоротні - [кількість уточнюється]'));
    const incomplete = build(fixture({ enemyLosses: [{ count200: 2, count300: 1 }, { count200: '', count300: 2 }] }));
    assert.ok(incomplete.text.endsWith('результат: уточнюється.'));
    assert.ok(incomplete.warnings.some(message => message.includes('неповний')));
    assert.ok(build(fixture({ enemyLosses: [{ count200: 0, count300: 4 }] })).text.endsWith('результат: ПОРАНЕНО – 4 (ЧОТИРИ) В/СЛ ЗС рф.'));
    assert.ok(build(fixture({ enemyLosses: [{ count200: 0, count300: 0, count200Discovered: 5 }] })).text.endsWith("результат: ЗНИЩЕНО – 5 (П'ЯТЬ) В/СЛ ЗС рф."));
    assert.ok(build(fixture({ enemyLosses: [{ count200: 0, count300: 0, count200Unconfirmed: '2' }] })).text.endsWith('результат: ЗНИЩЕНО – 2 (ДВА) В/СЛ ЗС рф.'));
    assert.ok(build(fixture({ enemyLosses: [{ count200: 3, count300: 0 }] })).text.endsWith('результат: ЗНИЩЕНО – 3 (ТРИ) В/СЛ ЗС рф.'), 'Legacy records without optional categories still work');
    assert.ok(build(fixture({ enemyLosses: [{ count200: 0, count300: 0, countPOW: 2, count200POW: 3 }] })).text.endsWith('результат: уточнюється.'), 'Prisoner categories remain separate');
    for (const key of ['count200Unconfirmed', 'count200Discovered']) {
        for (const value of [-1, 1.5, 'bad', '', null]) {
            const invalid = build(fixture({ enemyLosses: [{ count200: 1, count300: 0, [key]: value }] }));
            assert.ok(invalid.text.endsWith('результат: уточнюється.'), 'Malformed optional count must not silently become zero');
        }
    }
    assert.ok(build(fixture({ enemyLosses: [{ count200: 999999, count300: 0, count200Discovered: 1 }] })).text.endsWith('результат: уточнюється.'), 'Combined count has the same supported range as words');
    assert.ok(build(fixture({ isRealEvent: false })).warnings[0].startsWith('ТЕСТОВА ПОДІЯ'));
    const overMidnight = fixture({ actionDetails: { ...noLosses.actionDetails, startTime: '23:50', endTime: '00:20' } });
    assert.ok(build(overMidnight).warnings.some(message => message.includes('через північ')));
    assert.ok(build({ ...overMidnight, actionDetails: { ...overMidnight.actionDetails, endDate: '2026-09-19' } }).text.startsWith('23:50 18.09.2026 - 00:20 19.09.2026'));
    assert.ok(build(fixture({ actionDetails: { ...noLosses.actionDetails, startDate: '2026-02-30' } })).text.includes('[дата уточнюється]'));
    assert.ok(build(fixture({ actionDetails: { ...noLosses.actionDetails, hasVehicles: true, vehicleDetails: '2 одиниці (за документом)' } })).text.includes('з технікою (2 одиниці (за документом)).'));
    console.log('PASS: retrospective template, combined regular/unconfirmed/discovered 200 totals and words, component breakdown, legacy/invalid counts, separate prisoner categories, missing-data/midnight warnings and immutable records');
}
if (require.main === module) run().catch(error => { console.error(error); process.exitCode = 1; });
