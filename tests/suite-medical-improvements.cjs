const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const ExcelJS = require('exceljs');

(async () => {
    if (!process.argv.includes('--zone')) {
        for (const TZ of ['Europe/Kyiv', 'America/Los_Angeles']) {
            const run = spawnSync(process.execPath, [__filename, '--zone'], { env: { ...process.env, TZ }, stdio: 'inherit' });
            if (run.status !== 0) process.exit(run.status || 1);
        }
        return;
    }
    const M = await import('../src/core/medical-records.js');
    const N = await import('../src/core/person-names.js');
    const { createMedicalWorkbook } = await import('../src/modules/medical/medical-workbook.js');
    assert.equal(M.parseMedicalDate('2026-09-29T21:30:00.000Z'), Date.parse('2026-09-29T21:30:00.000Z'));
    assert.equal(M.parseMedicalDate('2026-09-29T21:30:00+03:00'), Date.parse('2026-09-29T21:30:00+03:00'));
    assert.equal(M.localMedicalInput(45550.5), '2024-09-15T12:00');
    assert.equal(M.localMedicalInput('45550.5'), '2024-09-15T12:00');
    assert.equal(M.localMedicalInput('29.09.2026 12:34'), '2026-09-29T12:34');
    for (const value of ['2026-02-30', '2026-09-29T25:00', 'oops', new Date('invalid'), null]) assert.equal(M.parseMedicalDate(value), 0);
    assert.equal(M.medicalWaitTime('2026-09-29T12:00', new Date('2026-09-29T13:30').getTime()), '1г 30хв');
    const wound = { id: 'w', soldierId: 'm', lossType: 'Поранення (300)', date: '2026-09-20T12:00', injuries: { head: { eye: true, tbi: true }, arm_l: { amp_hand: true }, arm_r: { amputation: true } }, evacStatus: 'Не евакуйований' };
    const dead = { id: 'd', soldierId: 'm', lossType: '200 (від ран)', date: '2026-09-25T12:00', evacStatus: 'Не евакуйований' };
    assert.equal(M.chronologyIssues([dead, wound]).length, 0, 'Backdated wound must remain allowed');
    assert.equal(M.chronologyIssues([dead, { ...wound, date: '2026-09-30T12:00' }]).length, 1);
    assert.equal(M.pickMedicalEpisode(dead, { ...wound, date: '2026-09-30T12:00' }), dead);
    assert.equal(M.pickMedicalEpisode(wound, dead), dead);
    assert.equal(M.chronologyIssues([{ ...wound, date: 'invalid' }])[0].type, 'date');
    assert.deepEqual(new Set(M.injuryGroups(wound.injuries)), new Set(['Травма ока', 'ЧМТ', 'Ампутація']));
    assert.match(M.describeInjuries(wound.injuries, [{ id: 'head', name: 'Голова' }]), /Травма ока/);
    const person = { id: 'm', name: 'ТЕСТОВИЙ Іван Петрович', callsign: 'Альфа', unit: 'Група А', sourceRosterId: 'r' };
    assert.equal(N.personCandidates({ name: 'TЕСТОВИЙ   ІВАН ПЕТРОВИЧ' }, [person]).length, 1);
    assert.equal(N.personCandidates({ name: 'ТЕСТОВИЙ Іван' }, [person]).length, 1);
    assert.equal(N.personCandidates({ name: 'Інша Людина' }, [person]).length, 0);
    const snapshot = { format: 'military-suite-unified', version: 1, localforage: {
        med_soldiers_v3: [person], med_episodes_v3: [{ ...wound, personnelSnapshot: { name: 'Тестовий Іван Петрович', unit: 'Група А' } }, dead],
        document_journal_v1: { tasks: [{ id: 'task', reportedInPbd: true, comment: 'Тестовий Іван Петрович' }] },
        med_logs_v3: [{ details: 'Тестовий Іван Петрович' }], med_safety_snapshot: { soldiers: [person] }
    }, localstorage: { tactical_personnel: JSON.stringify([{ id: 'r', fullName: 'Тестовий Іван Петрович', positionId: 'p' }]) } };
    const before = JSON.stringify(snapshot), items = N.inventoryPersonNames(snapshot);
    assert.equal(items.length, 3); assert.equal(N.duplicateNameGroups(items).length, 1);
    const key = item => `${item.storage}/${item.key}/${item.path}`;
    const plan = N.planPersonNames(snapshot, items.map(key), 'Тестовий Іван Петрович');
    assert.equal(plan.changes.length, 1);
    assert.equal(plan.next.localforage.med_soldiers_v3[0].id, 'm');
    assert.equal(plan.next.localforage.med_episodes_v3[0].soldierId, 'm');
    assert.equal(plan.next.localforage.document_journal_v1.tasks[0].reportedInPbd, true);
    assert.deepEqual(plan.next.localforage.med_logs_v3, snapshot.localforage.med_logs_v3);
    assert.deepEqual(plan.next.localforage.med_safety_snapshot, snapshot.localforage.med_safety_snapshot);
    assert.equal(JSON.stringify(snapshot), before);
    const selectedPlan = N.planPersonNames(snapshot, [key(items[0])], 'Інше Стандартне ПІБ');
    assert.equal(selectedPlan.changes.length, 1, 'Unselected homonyms must not change');
    assert.equal(N.formatPersonName('  петренко\u00a0ІВАН   ПЕТРОВИЧ '), 'ПЕТРЕНКО Іван Петрович');
    assert.equal(N.formatPersonName('ПЕТРЕНКО Іван Петрович'), 'ПЕТРЕНКО Іван Петрович');
    assert.equal(N.formatPersonName("кулик-овчаренко АННА-МАРІЯ ЛУК’ЯНІВНА"), 'КУЛИК-ОВЧАРЕНКО Анна-Марія Лук’янівна');
    assert.equal(N.formatPersonName('петренко і.п.'), 'ПЕТРЕНКО І.П.');
    assert.equal(N.formatPersonName('петренко'), 'ПЕТРЕНКО');
    assert.equal(N.formatPersonName(null), '');
    assert.notEqual(N.formatPersonName('Петренко Іван Петрович'), N.formatPersonName('Петренко Іван Петревич'), 'Spelling differences are not auto-corrected');
    assert.notEqual(N.formatPersonName('Петренко Іван'), N.formatPersonName('Петренко Іван Петрович'), 'Missing patronymics are not inferred');
    const formatted = N.planPersonNameFormatting(snapshot);
    assert.equal(formatted.changes.length, 2);
    assert.ok(N.inventoryPersonNames(formatted.next).every(item => item.value === 'ТЕСТОВИЙ Іван Петрович'));
    assert.deepEqual(formatted.next.localforage.med_safety_snapshot, snapshot.localforage.med_safety_snapshot);
    assert.deepEqual(formatted.next.localforage.med_logs_v3, snapshot.localforage.med_logs_v3);
    assert.deepEqual(formatted.next.localforage.document_journal_v1, snapshot.localforage.document_journal_v1);
    assert.equal(JSON.stringify(snapshot), before, 'Formatting preview cannot mutate the live snapshot');
    const repeated = N.planPersonNameFormatting(formatted.next);
    assert.equal(repeated.changes.length, 0);
    assert.deepEqual(repeated.next, formatted.next, 'Repeating formatting is a no-op, including audit history');
    const large = { localforage: {}, localstorage: { tactical_personnel: JSON.stringify(Array.from({ length: 1300 }, (_, index) => ({ id: `r${index}`, fullName: `Тестовий${index} ІВАН ПЕТРОВИЧ`, unit: 'Тестовий підрозділ' }))) } };
    const bulk = N.planPersonNameFormatting(large), bulkRows = JSON.parse(bulk.next.localstorage.tactical_personnel);
    assert.equal(bulk.changes.length, 1300, 'One plan covers all 1300 names, with no selection limit');
    assert.ok(bulkRows.every((row, index) => row.id === `r${index}` && row.fullName === `ТЕСТОВИЙ${index} Іван Петрович` && row.unit === 'Тестовий підрозділ'));
    const rows = [wound, dead, { ...wound, id: 'w2', soldierId: 'm2', lossType: 'Небойове травмування (300)', date: 45550.5 }];
    const workbook = createMedicalWorkbook(ExcelJS, { episodes: rows, personFor: () => person, regions: [], filters: 'Тест', now: new Date('2026-09-30T12:00') });
    assert.equal(workbook.worksheets.length, 6);
    assert.equal(workbook.getWorksheet('Детальний реєстр').getCell('F1').value, 'Тип втрати');
    assert.equal(workbook.getWorksheet('Детальний реєстр').rowCount, 4);
    assert.equal(workbook.getWorksheet('Черга на евакуацію').getColumn(13).values.filter(value => ['w', 'd', 'w2'].includes(value)).length, 2, 'A deceased person must not also get a wounded queue row');
    const buffer = await workbook.xlsx.writeBuffer();
    const restored = new ExcelJS.Workbook(); await restored.xlsx.load(buffer);
    assert.equal(restored.worksheets.length, 6);
    assert.equal(restored.getWorksheet('Детальний реєстр').getCell('A4').value.toISOString(), '2024-09-15T00:00:00.000Z');
    assert.equal(restored.getWorksheet('Детальний реєстр').getCell('F3').value, '200 (ПВР)');
    console.log('PASS: safe dates/Excel serials, chronology, death priority, name suggestions and scoped replacement, injury descriptions, six-sheet XLSX round-trip (' + process.env.TZ + ').');
})().catch(error => { console.error(error); process.exitCode = 1; });
