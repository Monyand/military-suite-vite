const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ExcelJS = require('exceljs');
const { spawnSync } = require('node:child_process');

function fixture() {
    const episode = (id, date, extra = {}) => ({ id, soldierId: id, date, lossType: 'Поранення (300)', severity: 'Середній', unit: 'Тестова рота',
        actualLoc: 'Локація А', docLoc: 'Документальна А', cause: 'Тестова причина', inUdp: true, evacStatus: 'Не евакуйований', injuries: {}, ...extra });
    const allEpisodes = [
        episode('old', '2026-09-25T10:00', { evacStatus: 'Евакуйований', evacTime: '2026-09-28T10:00' }),
        episode('late-evac', '2026-09-27T10:00', { evacStatus: 'Евакуйований', evacTime: '2026-10-02T10:00' }),
        episode('before-pvr', '2026-09-26T10:00', { soldierId: 'pvr', evacStatus: 'Евакуйований', evacTime: '2026-09-27T10:00' }),
        episode('pvr', '2026-09-28T10:00', { lossType: '200 (від ран)', evacStatus: 'Евакуйований', evacTime: '2026-09-29T10:00' }),
        episode('before-future-death', '2026-09-28T10:00', { soldierId: 'future-person' }),
        episode('future-death', '2026-10-01T10:00', { soldierId: 'future-person', lossType: 'Загибель (200)' }),
        episode('critical', '2026-09-29T10:00', { severity: 'Критичний', injuries: { left: { amp_hand: true }, right: { amputation: true }, head: { eye: true } }, notes: 'Тестова примітка з довгим описом для перевірки перенесення тексту. '.repeat(4) }),
        episode('light', '2026-09-26T10:00', { severity: 'Легкий' }),
        episode('mia', '2026-09-26T10:00', { lossType: 'Зниклий безвісти (ЗБВ)' }),
        episode('dead', '2026-09-27T10:00', { lossType: 'Загибель (200)' }),
        episode('nc-dead', '2026-09-27T10:00', { lossType: 'Небойова смерть (200)', evacStatus: 'Евакуйований', evacTime: '2026-09-30T11:00' }),
        episode('combat', '2026-09-29T10:00', { lossType: 'Бойове травмування (300)', evacStatus: 'Евакуйований', evacTime: '2026-09-30T13:00' }),
        episode('noncombat', '2026-09-29T10:00', { lossType: 'Небойове травмування (300)' }),
        episode('awol', '2026-09-28T10:00', { lossType: 'СЗЧ', awolStatus: 'Повернувся', evacStatus: 'Не потребує евакуації', weaponStatus: 'Зброя залишена', description: 'Опис із попереднього формату запису', hasReport: true, reportDate: '2026-09-29' }),
        episode('desert', '2026-09-28T10:00', { lossType: 'Дезертирство', awolStatus: 'Розшук', evacStatus: 'Не потребує евакуації' }),
        episode('missing', '2026-09-29T10:00', { evacStatus: 'Евакуйований' }),
        episode('backwards', '2026-09-29T10:00', { evacStatus: 'Евакуйований', evacTime: '2026-09-28T10:00' }),
        episode('sector-excluded', '2026-09-28T10:00', { actualLoc: 'Локація Б', docLoc: 'Документальна Б' }),
        episode('udp-excluded', '2026-09-28T10:00', { inUdp: false }),
        episode('legacy', '2026-09-29T10:00', { lossType: 'Інший збережений тип' })
    ];
    return { allEpisodes, selection: { dateFrom: '2026-09-26', dateTo: '2026-09-30', sector: 'Локація А', udp: 'yes', showLatest: false },
        episodes: allEpisodes.filter(ep => ep.date >= '2026-09-26' && ep.date < '2026-10-01' && ep.actualLoc === 'Локація А' && ep.inUdp),
        now: new Date('2026-10-03T12:00:00+03:00'), regions: [{ id: 'left', name: 'Ліва рука' }, { id: 'right', name: 'Права рука' }, { id: 'head', name: 'Голова' }],
        personFor: ep => ({ name: 'ТЕСТОВИЙ Іван Петрович', rank: 'Солдат', callsign: ep.id, unit: 'Тестова рота' }) };
}
function findRow(ws, label, column = 1) {
    let result; ws.eachRow(row => { if (row.getCell(column).value === label) result = row; });
    assert.ok(result, `Missing row ${label} on ${ws.name}`); return result;
}
async function test() {
    if (!process.argv.includes('--zone')) {
        for (const TZ of ['Europe/Kyiv', 'America/Los_Angeles']) {
            const result = spawnSync(process.execPath, [__filename, '--zone', ...(process.argv.includes('--write-fixture') && TZ === 'Europe/Kyiv' ? ['--write-fixture'] : [])], { env: { ...process.env, TZ }, stdio: 'inherit' });
            if (result.status !== 0) process.exit(result.status || 1);
        }
        return;
    }
    const { createMedicalWorkbook, medicalReportData } = await import('../src/modules/medical/medical-workbook.js');
    const options = fixture(), before = JSON.stringify(options), data = medicalReportData(options);
    assert.deepEqual(data.evacuated.map(ep => ep.id), ['old', 'before-pvr', 'pvr', 'nc-dead', 'combat']);
    assert.deepEqual(new Set(data.pending.map(ep => ep.id)), new Set(['late-evac', 'before-future-death', 'critical', 'light', 'mia', 'dead', 'noncombat']));
    assert.equal(data.missingEvacDates, 1); assert.equal(data.wrongIntervals, 1);
    assert.throws(() => medicalReportData({ ...options, selection: { dateFrom: '2026-10-01', dateTo: '2026-09-30' } }), /Початок/);
    const beforeBoundary = medicalReportData({ ...options, selection: { ...options.selection, dateTo: '2026-09-28T09:59' } });
    assert.ok(beforeBoundary.pending.some(ep => ep.id === 'old'));
    const atBoundary = medicalReportData({ ...options, selection: { ...options.selection, dateTo: '2026-09-28T10:00' } });
    assert.ok(atBoundary.evacuated.some(ep => ep.id === 'old'));
    assert.equal(atBoundary.pending.some(ep => ep.id === 'old'), false);
    const alias = { ...options.allEpisodes[3], lossType: '200 (ПВР)', evacStatus: 'Не евакуйований' };
    assert.deepEqual(medicalReportData({ ...options, allEpisodes: [options.allEpisodes[2], alias] }).pending.map(ep => ep.id), ['pvr']);
    const book = createMedicalWorkbook(ExcelJS, options);
    assert.deepEqual(book.worksheets.map(ws => ws.name), ['Зведена довідка', 'Черга на евакуацію', 'Підрозділи та Сектори', 'Причини та Травми', 'Хронологія по днях', 'Детальний реєстр']);
    const summary = book.worksheets[0], queue = book.worksheets[1], units = book.worksheets[2], causes = book.worksheets[3], daily = book.worksheets[4], reg = book.worksheets[5];
    assert.equal(findRow(summary, '200 (ПВР)').getCell(2).value, 1);
    assert.equal(findRow(summary, 'РАЗОМ ВТРАТ').getCell(2).result, options.episodes.length);
    assert.deepEqual(findRow(summary, 'Евакуйовано за звітний період (епізодів)').values.slice(2), [3, 2, '—']);
    assert.deepEqual(findRow(summary, 'Залишаються неевакуйованими на дату (осіб)').values.slice(2), [5, 1, 1]);
    assert.equal(findRow(summary, 'З них події сталися до початку періоду').getCell(2).value, 1);
    assert.equal(queue.getCell('G3').value, 'critical');
    assert.equal(queue.getColumn(13).values.filter(value => data.pending.some(ep => ep.id === value)).length, 7);
    assert.equal(queue.getRow(3).getCell(1).fill.fgColor.argb, 'FFFFE4E6');
    assert.equal(findRow(units, 'РАЗОМ ПО ПІДРОЗДІЛАХ').getCell(12).result, options.episodes.length);
    assert.equal(findRow(units, 'РАЗОМ ПО ПІДРОЗДІЛАХ').getCell(3).result, 1, 'PVR has a distinct column');
    assert.equal(findRow(causes, 'Ампутація').getCell(2).value, 1, 'Repeated regions must not double-count one injury type');
    assert.equal(causes.getColumn(1).values.filter(value => typeof value === 'string' && /^\d\d:00$/.test(value)).length, 24);
    assert.equal(findRow(causes, 'РАЗОМ ЗА ДОБУ').getCell(12).result, options.episodes.length);
    assert.equal(daily.getColumn(1).values.filter(value => value instanceof Date).length, 5);
    assert.equal(findRow(daily, 'РАЗОМ ЗА ПЕРІОД').getCell(12).result, options.episodes.length);
    assert.equal(reg.getCell('F1').value, 'Тип втрати');
    const awol = findRow(reg, 'awol', 20);
    assert.equal(awol.getCell(14).value, 'Повернувся'); assert.equal(awol.getCell(16).value, 'Зброя залишена');
    assert.equal(awol.getCell(19).value, 'Опис із попереднього формату запису');
    assert.equal(awol.getCell(14).font.color.argb, 'FF15803D');
    assert.equal(findRow(reg, 'pvr', 20).getCell(6).value, '200 (ПВР)');
    for (const ws of book.worksheets) {
        assert.ok(ws.pageSetup.printArea); assert.ok(ws.pageSetup.fitToPage);
        ws.eachRow(row => row.eachCell(cell => { if (cell.formula) { assert.ok(!/NaN|undefined/.test(cell.formula)); assert.ok(cell.result !== undefined); } }));
    }
    const reloaded = new ExcelJS.Workbook(); await reloaded.xlsx.load(await book.xlsx.writeBuffer());
    assert.equal(reloaded.worksheets[5].getCell('A2').value.toISOString(), '2026-09-27T00:00:00.000Z');
    assert.equal(reloaded.worksheets[5].getCell('C2').value.toISOString(), '1899-12-30T10:00:00.000Z');
    assert.equal(JSON.stringify(options), before, 'Export must never modify medical records');
    const empty = createMedicalWorkbook(ExcelJS, { ...options, allEpisodes: [], episodes: [] });
    assert.equal(findRow(empty.worksheets[0], 'РАЗОМ ВТРАТ').getCell(2).result, 0);
    assert.equal(findRow(empty.worksheets[0], 'РАЗОМ / СЕРЕДНЄ').getCell(4).result, '—');
    const latestOnly = createMedicalWorkbook(ExcelJS, { ...options, episodes: options.episodes.filter(ep => ep.id !== 'before-pvr'), selection: { ...options.selection, showLatest: true } });
    assert.equal(findRow(latestOnly.worksheets[0], 'Евакуйовано за звітний період (епізодів)').getCell(2).value, 3);
    if (process.argv.includes('--write-fixture')) {
        const directory = path.resolve(__dirname, '../test-results/medical-workbook'); fs.mkdirSync(directory, { recursive: true });
        await book.xlsx.writeFile(path.join(directory, 'report.xlsx'));
        fs.writeFileSync(path.join(directory, 'sheets.json'), JSON.stringify(book.worksheets.map(ws => ({ name: ws.name, range: `A1:${ws.getColumn(ws.columnCount).letter}${ws.rowCount}` }))));
        const expected = [];
        for (const ws of book.worksheets) ws.eachRow(row => row.eachCell(cell => { if (cell.formula) expected.push({ sheet: ws.name, address: cell.address, result: cell.result }); }));
        fs.writeFileSync(path.join(directory, 'expected.json'), JSON.stringify(expected));
        const pvr = findRow(summary, '200 (ПВР)'); pvr.getCell(2).value = 4;
        await book.xlsx.writeFile(path.join(directory, 'edited-input.xlsx'));
        fs.writeFileSync(path.join(directory, 'edited-expected.json'), JSON.stringify({ sheet: summary.name, total: findRow(summary, 'РАЗОМ ВТРАТ').getCell(2).address, totalValue: options.episodes.length + 3, percentage: pvr.getCell(3).address, percentageValue: 4 / (options.episodes.length + 3) }));
    }
    console.log('PASS: six-sheet content/styles, PVR, historical evacuation periods, cutoffs, queue deduplication, severity order, all hours, empty data, formulas/caches, typed local dates and unchanged records (' + process.env.TZ + ').');
}
module.exports = { fixture, findRow };
if (require.main === module) test().catch(error => { console.error(error); process.exitCode = 1; });
