const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { readSource } = require('./source.cjs');

// Start separate processes so the time-zone tests also work on Windows.
if (!process.argv.includes('--zone')) {
    for (const TZ of ['Europe/Kyiv', 'America/Los_Angeles']) {
        const result = spawnSync(process.execPath, [__filename, '--zone'], { env: { ...process.env, TZ }, stdio: 'inherit' });
        if (result.status !== 0) process.exit(result.status || 1);
    }
} else {
    const eventSource = readSource('modules/events/EventsApp.jsx');
    const cases = process.env.TZ === 'Europe/Kyiv' ? [
        ['2026-09-28T21:30:00.123Z', '2026-09-29_00-30-00-123'],
        ['2026-01-28T22:30:00.123Z', '2026-01-29_00-30-00-123'],
        ['2026-03-29T00:59:00.000Z', '2026-03-29_02-59-00-000'],
        ['2026-03-29T01:00:00.000Z', '2026-03-29_04-00-00-000'],
        ['2026-10-25T00:59:00.000Z', '2026-10-25_03-59-00-000'],
        ['2026-10-25T01:00:00.000Z', '2026-10-25_03-00-00-000']
    ] : [['2026-09-29T06:30:00.123Z', '2026-09-28_23-30-00-123']];

    for (const [instant, stamp] of cases) {
        class FixedDate extends Date { constructor(...args) { super(...(args.length ? args : [instant])); } }
        const window = {};
        new Function('window', 'Date', readSource('core/runtime.js'))(window, FixedDate);
        const dates = window.SuiteDates;
        const day = stamp.slice(0, 10);
        assert.equal(dates.localISO(), day);
        assert.equal(dates.fileTimestamp(), stamp);
        assert.equal(dates.localDateTime(instant), new Date(instant).toLocaleString('uk-UA'));
        assert.equal(dates.localDateTime('invalid'), 'дата невідома');
        assert.equal(dates.localDateTime(null), 'дата невідома');
        assert.equal(dates.localISO(new Date('invalid')), '');

        const getDate = new Function('window', 'Date', 'return ' + eventSource.match(/const getEventDateStr = (.+);/)[1])(window, FixedDate);
        const existing = { actionDetails: { startDate: '2025-06-01' }, createdAt: instant };
        const before = JSON.stringify(existing);
        assert.equal(getDate(existing), '2025-06-01');
        assert.equal(JSON.stringify(existing), before, 'Explicit historical dates must not change');
        assert.equal(getDate({ createdAt: instant }), day);
        assert.equal(getDate({ createdAt: 'invalid' }), '');
        assert.equal(getDate({}), '');
        assert.match(eventSource, /startDate: window\.SuiteDates\.localISO\(\)/);
        assert.match(eventSource, /startDate: getEventDateStr\(e\)/);
        assert.match(eventSource, /const dateStr = getEventDateStr\(ev\)/);
        assert.match(eventSource, /const dStr = getEventDateStr\(ev\)/);
        assert.doesNotMatch(eventSource, /createdAt[^\n]*\.split\('T'\)/);

        const anchor = { click() {}, remove() {} };
        const backup = new Function('window', 'document', 'URL', 'setTimeout', 'backupSummary', readSource('core/backup.js') + '\nreturn SuiteBackup;')(
            window, { createElement: () => anchor, body: { appendChild() {} } },
            { createObjectURL: () => 'blob:test', revokeObjectURL() {} }, callback => callback(), () => ({}));
        backup.download({ test: true });
        assert.equal(anchor.download, `military_suite_backup_${stamp}.mils.enc`);
        backup.download({ test: true }, 'recovery');
        assert.equal(anchor.download, `recovery_${stamp}.mils.enc`);

        assert.match(readSource('app/App.jsx'), /window\.SuiteDates\.localDateTime\(backupPreview.timestamp\)/);
        assert.match(readSource('modules/documents/DocumentsApp.jsx'), /window\.SuiteDates\.localISO\(\) \+ '\.xlsx'/);
        assert.match(readSource('modules/medical/MedicalApp.jsx'), /med_backup_\$\{window\.SuiteDates\.localISO\(\)\}/);
        assert.match(eventSource, /const today = window\.SuiteDates\.localISO\(\)/);
        assert.match(readSource('core/backup.js'), /timestamp: new Date\(\)\.toISOString\(\)/, 'Stored UTC timestamps stay unchanged');
    }
    console.log(`PASS: local dates, backup download names/preview, exports and historical dates (${process.env.TZ}).`);
}
