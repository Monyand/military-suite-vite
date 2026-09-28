const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');
const { D } = require('./suite-document-journal.cjs');
const { createHarness } = require('./suite-backup-unit.cjs');

(async () => {
    const browser = await chromium.launch({ channel: process.env.SUITE_BROWSER || 'msedge', headless: true });
    try {
        // Fresh incognito storage: never opens the user's browser profile or database.
        const context = await browser.newContext({ viewport: { width: 1600, height: 1050 }, acceptDownloads: true });
        const page = await context.newPage(), errors = [];
        page.setDefaultTimeout(15000); page.on('pageerror', error => { errors.push(error.message); console.error('PAGEERROR:', error.message); });
        const url = process.env.SUITE_TEST_URL || pathToFileURL(path.resolve(__dirname, '../dist-single/MilitarySuite.html')).href;
        const ready = () => page.getByRole('heading', { name: 'Стрічка подій', exact: true }).waitFor();
        await page.goto(url); await ready();
        const journal = D.migrate({ ...D.empty(), tasks: [{ ...D.cleanRow('tasks', { date: '2026-09-28', task: 'TEST TASK', status: 'Виконано', reportedInPbd: true }), id: 'task-1' }] });
        await page.evaluate(async journal => {
            await window.SuiteRuntime.drain();
            await localforage.setItem('document_journal_v1', journal);
            await localforage.setItem('enemy_events_v2', [{ id: 'event-1', types: ['Інші ураження'], createdAt: '2026-09-28T10:00:00', description: '<img src=x onerror="window.__reviewInjected=true">', isRealEvent: true, actionDetails: { startDate: '2026-09-28', startTime: '10:00', docLoc: 'TEST', factLoc: '' }, enemyLosses: [], friendlyLosses: { count200: 0, count300: 0, countZBV: 0 } }]);
        }, journal);
        await page.reload(); await ready();
        const top = name => page.getByRole('button', { name, exact: true }).first().click();
        await top('Завдання');
        await page.locator('#document-journal textarea:visible').first().waitFor();
        await top('Втрати ОВТ'); await page.locator('#document-journal').getByRole('button', { name: 'Додати запис', exact: true }).click();
        await page.getByLabel('Категорія', { exact: true }).selectOption('БпЛА');
        await page.getByLabel('Статус', { exact: true }).selectOption('ПОШКОДЖЕНО');
        await page.waitForFunction(() => document.querySelector('.ovt-preview textarea')?.value.includes('було пошкоджено'));
        await page.getByRole('button', { name: 'Скасувати', exact: true }).last().click();
        await top('Статус позицій'); await page.locator('#document-journal').waitFor();
        await top('Втрати Противника'); await top('База в/сл противника');
        const search = page.getByPlaceholder('Пошук (позивний)...'); await search.fill('keep-filter');
        await top('Стрічка'); await top('База в/сл противника');
        assert.equal(await search.inputValue(), 'keep-filter', 'Parent re-render must not reset nested registry state');
        await top('Таблиця');
        const popupPromise = page.waitForEvent('popup'); await page.getByRole('button', { name: 'PDF Звіт', exact: true }).click();
        const popup = await popupPromise; await popup.waitForLoadState('domcontentloaded');
        assert.ok((await popup.locator('body').innerText()).includes('<img src=x onerror='));
        assert.equal(await popup.locator('img').count(), 0); assert.equal(await popup.evaluate(() => !!window.__reviewInjected), false);
        await popup.close();
        await top('Перевірка даних');
        await page.getByRole('dialog', { name: 'Перевірка цілісності даних' }).getByText(/Перевірено:/).waitFor();
        await page.getByRole('dialog', { name: 'Перевірка цілісності даних' }).getByRole('button', { name: 'Закрити', exact: true }).click();
        const h = createHarness(); h.persistent.set(D.KEY, { ...journal, tasks: journal.tasks.map(row => ({ ...row, reportedInPbd: false })) });
        const encrypted = await h.api.encrypt(await h.api.collect(), 'synthetic-ui-password');
        await top('Відновити бекап');
        await page.getByLabel('Файл єдиного бекапу').setInputFiles({ name: 'test.mils.enc', mimeType: 'application/octet-stream', buffer: Buffer.from(JSON.stringify(encrypted)) });
        await page.getByText('Обрано: test.mils.enc').waitFor();
        await page.getByLabel('Пароль єдиного бекапу', { exact: true }).fill('synthetic-ui-password');
        await page.getByRole('button', { name: 'Перевірити файл', exact: true }).click();
        await page.getByRole('columnheader', { name: 'Зникнуть', exact: true }).waitFor();
        assert.equal(await page.evaluate(async () => (await localforage.getItem('document_journal_v1')).tasks[0].reportedInPbd), true, 'Preview does not mutate PBD');
        assert.deepEqual(errors, []);
        console.log('PASS: isolated offline HTML UI, document hooks, category report status, persistent filters, escaped printable HTML, integrity modal and non-mutating restore preview.');
        await context.close();
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
