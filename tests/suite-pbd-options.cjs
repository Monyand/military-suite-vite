const assert = require('node:assert/strict');
const { D } = require('./suite-document-journal.cjs');
const { createHarness } = require('./suite-backup-unit.cjs');

(async () => {
    const row = (id, flag) => ({ ...D.cleanRow('tasks', { date: '2026-09-30', task: id, status: 'Виконано' }), id, ...(flag === undefined ? {} : { reportedInPbd: flag }) });
    const sender = createHarness();
    const incoming = { ...D.empty(), tasks: [row('a', false), row('b', true), row('new', true), row('missing', undefined)] };
    delete incoming.tasks[3].reportedInPbd;
    sender.persistent.set(D.KEY, incoming);
    const without = await sender.api.collect();
    const withFlags = await sender.api.collect({ includePbd: true });
    assert.equal(without.pbdIncluded, false);
    assert.equal(withFlags.pbdIncluded, true);
    assert.equal(withFlags.localOnly, undefined, 'Portable opt-in is not a local-only recovery');
    assert.ok(!JSON.stringify(without).includes('reportedInPbd'));
    assert.equal(withFlags.localforage[D.KEY].tasks[0].reportedInPbd, false);
    assert.equal(withFlags.localforage[D.KEY].tasks[1].reportedInPbd, true);
    for (const include of [false, true]) for (const importPbd of [false, true]) {
        const receiver = createHarness();
        receiver.persistent.set(D.KEY, { ...D.empty(), tasks: [row('a', true), row('b', false), row('missing', true)] });
        const encrypted = await sender.api.encrypt(include ? withFlags : without, 'synthetic-pbd-password');
        const data = await receiver.api.decrypt(encrypted, 'synthetic-pbd-password');
        await receiver.api.restore(data, 'synthetic-pbd-password', { importPbd });
        const flags = Object.fromEntries(receiver.persistent.get(D.KEY).tasks.map(item => [item.id, item.reportedInPbd]));
        assert.deepEqual(flags, { a: include && importPbd ? false : true, b: include && importPbd, new: include && importPbd, missing: true });
        const recovery = await receiver.api.decrypt(await receiver.api.getRecovery(), 'synthetic-pbd-password');
        assert.equal(recovery.localforage[D.KEY].tasks[0].reportedInPbd, true);
    }
    const failed = createHarness();
    const before = { ...D.empty(), tasks: [row('a', true), row('b', false)] };
    failed.persistent.set(D.KEY, before); failed.failNext(D.KEY);
    await assert.rejects(failed.api.restore(withFlags, 'synthetic-pbd-password', { importPbd: true }));
    assert.deepEqual(failed.persistent.get(D.KEY), before, 'Failed restore rolls back local flags exactly');
    console.log('PASS: PBD export/import opt-in matrix, true/false values, missing flags, new IDs, encrypted recovery, rollback and safe defaults.');
})().catch(error => { console.error(error); process.exitCode = 1; });
