const assert = require('node:assert/strict');
const { webcrypto } = require('node:crypto');
const { readSource } = require('./source.cjs');
const { createHarness } = require('./suite-backup-unit.cjs');
const D = new Function('crypto', readSource('core/documents.js') + '\nreturn DocumentJournal;')(webcrypto);
const localMedicalInput = new Function(readSource('core/medical-records.js').replace(/^export /gm, '') + '\nreturn localMedicalInput;')();
const medical = new Function('localforage', 'localStorage', 'localMedicalInput', readSource('core/medical-totals.js') + '\nreturn MedicalDailyTotals;')({}, {}, localMedicalInput);

(async () => {
    const password = 'synthetic-test-password';
    const task = (id, flag, status = 'Заплановано') => ({ ...D.cleanRow('tasks', { date: '2026-09-28', task: 'TEST ' + id, status, reportedInPbd: flag }), id });
    const sender = createHarness(), recipient = createHarness();
    const incoming = { ...D.empty(), tasks: [task('a', false, 'Виконано'), task('b', true), task('c', true)] };
    const local = { ...D.empty(), tasks: [task('a', true), task('b', false), task('old', true)] };
    incoming.positionAudit = [{ id: 'audit', recordId: 'p', positionId: 'p', at: '2026-09-28', before: { reportedInPbd: true }, after: { reportedInPbd: false } }];
    sender.persistent.set(D.KEY, incoming);
    sender.persistent.set('med_settings_v3', { test: true });
    recipient.persistent.set(D.KEY, local);
    recipient.persistent.set('med_settings_v3', { before: true });
    const transfer = await sender.api.collect();
    assert.ok(!JSON.stringify(transfer).includes('reportedInPbd'), 'Even nested audit snapshots omit local PBD flags');
    assert.equal(sender.persistent.get(D.KEY).tasks[1].reportedInPbd, true, 'Collect never mutates sender data');
    const encrypted = await sender.api.encrypt(transfer, password);
    const decoded = await recipient.api.decrypt(encrypted, password), untouched = JSON.stringify(decoded);
    const summary = recipient.api.backupSummary(decoded, await recipient.api.collect({ localState: true }));
    assert.deepEqual(summary.find(row => row.title === 'Завдання'), { title: 'Завдання', current: 3, incoming: 3, added: 1, removed: 1 });
    await recipient.api.restore(decoded, password);
    let result = recipient.persistent.get(D.KEY);
    assert.deepEqual(result.tasks.map(row => row.reportedInPbd), [true, false, false]);
    assert.equal(result.tasks[0].status, 'Виконано', 'Operational clerk updates still arrive');
    D.validate(result);
    assert.equal(JSON.stringify(decoded), untouched, 'Restore does not mutate selected backup');
    const recovery = await recipient.api.decrypt(await recipient.api.getRecovery(), password);
    assert.equal(recovery.localOnly, true);
    assert.deepEqual(recovery.localforage[D.KEY], local, 'Local rollback retains exact recipient flags');

    // Next day: recipient both checks and unchecks items; neither can be overwritten by the sender.
    result.tasks[0].reportedInPbd = false; result.tasks[1].reportedInPbd = true;
    recipient.persistent.set(D.KEY, result);
    await recipient.api.restore(decoded, password);
    assert.deepEqual(recipient.persistent.get(D.KEY).tasks.map(row => row.reportedInPbd), [false, true, false]);
    const fresh = createHarness(); await fresh.api.restore(decoded, password);
    assert.deepEqual(fresh.persistent.get(D.KEY).tasks.map(row => row.reportedInPbd), [false, false, false]);
    D.validate(fresh.persistent.get(D.KEY));
    const legacyWithFlags = structuredClone(decoded); legacyWithFlags.localforage[D.KEY].tasks.forEach(row => { row.reportedInPbd = true; });
    await recipient.api.restore(legacyWithFlags, password);
    assert.deepEqual(recipient.persistent.get(D.KEY).tasks.map(row => row.reportedInPbd), [false, true, false], 'Even older incoming flags are ignored');

    const beforeFailure = structuredClone(recipient.persistent.get(D.KEY));
    recipient.failNext('med_settings_v3');
    await assert.rejects(recipient.api.restore({ ...decoded, localforage: { ...decoded.localforage, [D.KEY]: D.empty() } }, password), /Попередні дані повернуто/);
    assert.deepEqual(recipient.persistent.get(D.KEY), beforeFailure, 'Partial restore rollback must not lose recipient flags');
    await recipient.api.restore(recovery, password, { localRecovery: true });
    assert.deepEqual(recipient.persistent.get(D.KEY), D.migrate(local), 'Explicit local recovery restores local workflow state');
    const migrated = D.migrate(decoded.localforage[D.KEY]);
    assert.deepEqual(D.migrate(migrated), migrated, 'Version migration is idempotent');
    assert.throws(() => D.migrate({ ...incoming, schemaRevision: 2 }), /новішою/);
    const bad = structuredClone(decoded); bad.localforage[D.KEY].tasks.push(bad.localforage[D.KEY].tasks[0]);
    const beforeInvalid = structuredClone(recipient.persistent.get(D.KEY));
    await assert.rejects(recipient.api.restore(bad, password), /ID/);
    assert.deepEqual(recipient.persistent.get(D.KEY), beforeInvalid, 'Invalid backup rejected before writes');
    assert.throws(() => recipient.api.validate({ ...decoded, localforage: { enemy_events_v2: [{ id: 'broken', enemyLosses: [] }] } }), /тип або дата/);

    assert.equal(medical.aggregate([{ id: 'e', date: '2026-09-28', lossType: '200 (від ран)' }]).daily['2026-09-28'].count200, 1);
    assert.equal(medical.classify('Небойова смерть (200)'), 'excluded');
    assert.equal(medical.classify('NEW UNKNOWN'), 'unknown');
    const { buildPositionRegister } = await import('../src/modules/documents/position-register.js');
    const inspect = new Function('D', 'MedicalDailyTotals', 'buildPositionRegister', readSource('core/integrity.js').replace(/^export /gm, '') + '\nreturn inspectIntegrity;')(D, medical, buildPositionRegister);
    const auditData = {
        localstorage: {}, localforage: {
            [D.KEY]: incoming, med_soldiers_v3: [{ id: 's' }], med_episodes_v3: [
                { id: 'ok', soldierId: 's', date: '2026-09-28', lossType: '200 (від ран)' },
                { id: 'bad', soldierId: 'missing', date: '2026-02-30', lossType: 'NEW UNKNOWN' },
                { id: 'bad', soldierId: 's', date: '2026-09-28', lossType: 'СЗЧ' }
            ]
        }
    };
    const auditRaw = JSON.stringify(auditData), audit = inspect(auditData);
    assert.equal(audit.medical.included, 1); assert.ok(audit.issues.length >= 4);
    assert.ok(audit.issues.some(issue => issue.recordId === 'bad' && issue.message.includes('Нерозпізнаний')));
    assert.equal(JSON.stringify(auditData), auditRaw, 'Integrity check is read-only');
    assert.ok(inspect({ localstorage: {}, localforage: { [D.KEY]: null } }).issues.some(issue => issue.severity === 'error'));
    const malformed = { ...D.empty(), tasks: [{ ...task('malformed', false), task: { invalid: true } }] };
    assert.equal(typeof inspect({ localstorage: {}, localforage: { [D.KEY]: malformed } }).issues[0].label, 'string', 'Malformed content remains safe to render in diagnostics');

    const { buildOvtReport } = await import('../src/modules/documents/ovt-report.js');
    for (const [status, word] of Object.entries({ ВТРАЧЕНО: 'втрачено', ЗНИЩЕНО: 'знищено', ПОШКОДЖЕНО: 'пошкоджено', ЗНАЙДЕНО: 'знайдено' })) {
        const report = buildOvtReport({ category: 'БпЛА', status, date: '2026-09-28', identifierType: 'factory', factoryNumber: 'TEST' });
        assert.ok(report.includes('було ' + word)); assert.ok(report.includes('з/н TEST'));
    }
    const { escapeHtml } = await import('../src/core/html.js');
    assert.equal(escapeHtml('<b>"&\'</b>'), '&lt;b&gt;&quot;&amp;&#39;&lt;/b&gt;');
    const documentSource = readSource('modules/documents/DocumentsApp.jsx');
    const pagination = documentSource.match(/    const start =[^\n]+\n    const end =[^\n]+\n    const visible =[^\n]+/)[0];
    const getPage = new Function('tab', 'rows', 'shownPage', 'pageSize', pagination + '\nreturn visible;');
    const rows = Array.from({ length: 120 }, (_, i) => i);
    for (const tab of ['ovt', 'positions']) {
        assert.deepEqual(getPage(tab, rows, 1, 50), rows.slice(0, 50));
        assert.deepEqual(getPage(tab, rows, 3, 50), rows.slice(100));
    }
    assert.deepEqual(getPage('tasks', rows, 1, 50), rows.slice(0, 50), 'Top-first task page for newest-first sorting');
    assert.ok(documentSource.includes('date: window.SuiteDates.localISO()'));
    assert.ok(!readSource('modules/events/EventsApp.jsx').includes('const PersonnelView ='));
    console.log('PASS: multi-day local PBD transfer, fresh restore, legacy flags, exact rollback, preview, version migration, invalid-data rejection, integrity audit, new medical type, OVT status, HTML escaping and pagination.');
})().catch(error => { console.error(error); process.exitCode = 1; });
