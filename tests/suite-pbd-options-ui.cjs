const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');
const { D } = require('./suite-document-journal.cjs');
const { createHarness } = require('./suite-backup-unit.cjs');

(async () => {
    const browser = await chromium.launch({ channel: process.env.SUITE_BROWSER || 'msedge', headless: true });
    try {
        const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, acceptDownloads: true });
        const page = await context.newPage(), errors = [], password = 'synthetic-pbd-password';
        page.setDefaultTimeout(15000); page.on('pageerror', error => errors.push(error.message));
        await page.route('http://127.0.0.1:8765/**', route => route.abort());
        await page.goto(process.env.SUITE_TEST_URL || pathToFileURL(path.resolve(__dirname, '../dist-single/MilitarySuite.html')).href);
        const ready = () => page.getByRole('heading', { name: 'Стрічка подій', exact: true }).waitFor();
        await ready();
        const task = flag => ({ ...D.cleanRow('tasks', { date: '2026-09-30', task: 'ПБД — тест', status: 'Виконано' }), id: 'task-1', reportedInPbd: flag });
        const seed = async flag => {
            await page.evaluate(async journal => { await window.SuiteRuntime.drain(); await localforage.setItem('document_journal_v1', journal); }, { ...D.empty(), tasks: [task(flag)] });
            await page.reload(); await ready();
        };
        await seed(true);
        const exports = [];
        for (const include of [false, true]) {
            await page.getByRole('button', { name: 'Створити Єдиний Бекап', exact: true }).click();
            const dialog = page.getByRole('dialog', { name: 'Єдиний зашифрований бекап', exact: true });
            const toggle = dialog.getByRole('checkbox', { name: 'Включити в бекап відмітки «Подано в ПБД»', exact: true });
            assert.equal(await toggle.isChecked(), false);
            if (include) await toggle.check();
            await dialog.getByLabel('Пароль єдиного бекапу', { exact: true }).fill(password);
            await dialog.getByLabel('Повтор пароля єдиного бекапу', { exact: true }).fill(password);
            const downloading = page.waitForEvent('download');
            await dialog.getByRole('button', { name: 'Зашифрувати й завантажити', exact: true }).click();
            const buffer = fs.readFileSync(await (await downloading).path()); exports.push(buffer);
            const decoded = await createHarness().api.decrypt(JSON.parse(buffer.toString()), password);
            assert.equal(decoded.localforage[D.KEY].tasks[0].reportedInPbd, include ? true : undefined);
            await dialog.getByRole('button', { name: 'Закрити', exact: true }).click();
        }
        const inspect = async buffer => {
            await page.getByRole('button', { name: 'Відновити бекап', exact: true }).click();
            const dialog = page.getByRole('dialog', { name: 'Відновлення єдиного бекапу', exact: true });
            await dialog.getByLabel('Файл єдиного бекапу').setInputFiles({ name: 'pbd-test.mils.enc', mimeType: 'application/octet-stream', buffer });
            await dialog.getByText('Обрано: pbd-test.mils.enc').waitFor();
            await dialog.getByLabel('Пароль єдиного бекапу', { exact: true }).fill(password);
            await dialog.getByRole('button', { name: 'Перевірити файл', exact: true }).click();
            await dialog.getByRole('checkbox', { name: 'Завантажити з бекапу відмітки «Подано в ПБД»', exact: true }).waitFor();
            return dialog;
        };
        const noFlags = await inspect(exports[0]);
        assert.equal(await noFlags.getByRole('checkbox', { name: 'Завантажити з бекапу відмітки «Подано в ПБД»', exact: true }).isDisabled(), true);
        await noFlags.getByRole('button', { name: 'Закрити', exact: true }).click();
        for (const importPbd of [false, true]) {
            await seed(false);
            const dialog = await inspect(exports[1]);
            const toggle = dialog.getByRole('checkbox', { name: 'Завантажити з бекапу відмітки «Подано в ПБД»', exact: true });
            assert.equal(await toggle.isChecked(), false);
            if (importPbd) await toggle.check();
            await dialog.getByRole('checkbox', { name: 'Я закрив інші вкладки та підтверджую заміну поточних даних', exact: true }).check();
            await dialog.getByRole('button', { name: 'Відновити всі дані', exact: true }).click();
            await dialog.getByText(/Відновлення завершено/).waitFor();
            assert.equal(await page.evaluate(async () => (await localforage.getItem('document_journal_v1')).tasks[0].reportedInPbd), importPbd);
            await page.reload(); await ready();
        }
        assert.deepEqual(errors, []);
        console.log('PASS: UI PBD export opt-in, disabled missing flags, import preserve/replace choice, safe defaults and encrypted files.');
        await context.close();
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
