const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { createHarness } = require('./suite-backup-unit.cjs');
const { chromium } = require('playwright');

(async () => {
    const browser = await chromium.launch({ channel: process.env.SUITE_BROWSER || 'msedge', headless: true });
    try {
        const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, acceptDownloads: true, offline: process.env.SUITE_TEST_OFFLINE === '1' });
        await context.route('http://127.0.0.1:8765/**', route => route.abort());
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', error => { errors.push(error.message); console.error('PAGEERROR: ' + error.message); });
        page.on('requestfailed', request => { if (request.resourceType() === 'script') console.error('SCRIPT LOAD FAILED: ' + request.url()); });
        await page.goto((process.env.SUITE_TEST_URL || 'http://127.0.0.1:5173'), { waitUntil: 'networkidle', timeout: 60000 });
        await page.getByRole('heading', { name: 'Стрічка подій', exact: true }).waitFor({ timeout: 30000 });
        await page.getByRole('button', { name: 'Медична Евакуація', exact: true }).click();
        await page.getByRole('button', { name: 'Створити запис', exact: true }).waitFor({ timeout: 30000 });
        for (const name of [/^Евакуація\s*0$/, /^Аналітика$/, /^Лог змін$/, /^Журнал\s*0$/]) {
            await page.getByRole('button', { name }).click();
            await page.waitForTimeout(250);
            assert.deepEqual(errors, [], 'Medical navigation errors: ' + name);
        }
        console.log('PASS: medical tab handlers');

        await page.getByRole('button', { name: 'Журнал О/С', exact: true }).click();
        for (const name of ['personnel', 'positions', 'rotations', 'journal', 'dashboard']) {
            await page.locator('#nav-' + name).click();
            await page.locator('#tab-' + name).waitFor({ state: 'visible' });
            assert.deepEqual(errors, [], 'Journal navigation errors: ' + name);
        }
        await page.getByTitle('Експорт зашифрованої копії', { exact: true }).click();
        await page.locator('#modal-export-password').waitFor({ state: 'visible' });
        await page.locator('#modal-export-password').getByRole('button', { name: /Скасувати/ }).click();
        await page.locator('#modal-export-password').waitFor({ state: 'hidden' });
        console.log('PASS: journal navigation and native backup modal');

        const password = 'test-only-password-2026';
        await page.getByRole('button', { name: 'Створити Єдиний Бекап', exact: true }).click();
        const dialog = page.getByRole('dialog', { name: 'Єдиний зашифрований бекап' });
        await dialog.waitFor();
        // Isolated synthetic data only. No user browser profile or live service is accessed.
        await page.evaluate(async () => {
            await localforage.setItem('document_ui_test_v1', { marker: 'BACKUP_UI_SECRET_ТЕСТ', flag: false });
            localStorage.setItem('med_view_mode', 'list');
            localStorage.setItem('tactical_backup_schedule', '["08:45"]');
            localStorage.setItem('tactical_collapsed_groups', '{"test":true}');
        });
        await dialog.getByRole('button', { name: 'Зашифрувати й завантажити' }).click();
        await dialog.getByRole('alert').filter({ hasText: '12 символів' }).waitFor();
        await dialog.getByLabel('Пароль єдиного бекапу', { exact: true }).fill(password);
        await dialog.getByLabel('Повтор пароля єдиного бекапу', { exact: true }).fill('mismatched-password');
        await dialog.getByRole('button', { name: 'Зашифрувати й завантажити' }).click();
        await dialog.getByRole('alert').filter({ hasText: 'не збігаються' }).waitFor();
        await dialog.getByLabel('Повтор пароля єдиного бекапу', { exact: true }).fill(password);
        const downloaded = page.waitForEvent('download');
        await dialog.getByRole('button', { name: 'Зашифрувати й завантажити' }).click();
        const download = await downloaded;
        const encryptedText = fs.readFileSync(await download.path(), 'utf8');
        assert.ok(download.suggestedFilename().endsWith('.mils.enc'));
        assert.ok(!encryptedText.includes('BACKUP_UI_SECRET'));
        const envelope = JSON.parse(encryptedText);
        const snapshot = await createHarness().api.decrypt(envelope, password);
        assert.equal(snapshot.localforage.document_ui_test_v1.marker, 'BACKUP_UI_SECRET_ТЕСТ');
        assert.equal(snapshot.localstorage.med_view_mode, 'list');
        assert.equal(snapshot.localstorage.tactical_backup_schedule, '["08:45"]');
        await dialog.getByRole('button', { name: 'Закрити', exact: true }).click();
        console.log('PASS: password validation and downloaded encrypted file');

        await page.getByRole('button', { name: 'Відновити бекап', exact: true }).click();
        const restoreDialog = page.getByRole('dialog', { name: 'Відновлення єдиного бекапу' });
        await page.evaluate(async () => {
            await localforage.setItem('document_ui_test_v1', { marker: 'CHANGED' });
            localStorage.setItem('med_view_mode', 'grid');
        });
        await restoreDialog.getByLabel('Файл єдиного бекапу').setInputFiles({ name: 'test.mils.enc', mimeType: 'application/octet-stream', buffer: Buffer.from(encryptedText) });
        await restoreDialog.getByLabel('Пароль єдиного бекапу', { exact: true }).fill('wrong-password');
        await restoreDialog.getByRole('button', { name: 'Перевірити файл' }).click();
        await restoreDialog.getByRole('alert').filter({ hasText: 'Неправильний пароль' }).waitFor();
        assert.equal(await page.evaluate(async () => (await localforage.getItem('document_ui_test_v1')).marker), 'CHANGED');
        await restoreDialog.getByLabel('Пароль єдиного бекапу', { exact: true }).fill(password);
        await restoreDialog.getByRole('button', { name: 'Перевірити файл' }).click();
        await restoreDialog.getByText(/Файл перевірено/).waitFor();
        assert.equal(await restoreDialog.getByRole('button', { name: 'Відновити всі дані' }).isDisabled(), true);
        await restoreDialog.getByRole('checkbox', { name: 'Я закрив інші вкладки та підтверджую заміну поточних даних', exact: true }).check();
        await page.screenshot({ path: path.join(__dirname, 'suite-restore-preview.png') });
        await restoreDialog.getByRole('button', { name: 'Відновити всі дані' }).click();
        await restoreDialog.getByRole('button', { name: 'Перезавантажити програму' }).waitFor();
        assert.equal(await page.evaluate(async () => (await localforage.getItem('document_ui_test_v1')).marker), 'BACKUP_UI_SECRET_ТЕСТ');
        assert.equal(await page.evaluate(() => localStorage.getItem('med_view_mode')), 'list');
        const recovery = await page.evaluate(() => localforage.getItem('military_suite_recovery_v1'));
        assert.equal((await createHarness().api.decrypt(recovery, password)).localforage.document_ui_test_v1.marker, 'CHANGED');
        await restoreDialog.getByRole('button', { name: 'Перезавантажити програму' }).click();
        await page.getByRole('button', { name: 'Відновити бекап', exact: true }).waitFor({ timeout: 30000 });
        console.log('PASS: wrong password is non-mutating; encrypted restore and reload preserve settings');

        await page.getByRole('button', { name: 'Відновити бекап', exact: true }).click();
        await restoreDialog.getByRole('button', { name: 'Попередній стан', exact: true }).click();
        await restoreDialog.getByLabel('Пароль єдиного бекапу', { exact: true }).fill(password);
        await restoreDialog.getByRole('button', { name: 'Перевірити файл' }).click();
        await restoreDialog.getByText(/Файл перевірено/).waitFor();
        await restoreDialog.getByRole('checkbox', { name: 'Я закрив інші вкладки та підтверджую заміну поточних даних', exact: true }).check();
        await restoreDialog.getByRole('button', { name: 'Відновити всі дані' }).click();
        await restoreDialog.getByRole('button', { name: 'Перезавантажити програму' }).waitFor();
        assert.equal(await page.evaluate(async () => (await localforage.getItem('document_ui_test_v1')).marker), 'CHANGED');
        await restoreDialog.getByRole('button', { name: 'Перезавантажити програму' }).click();
        await page.getByRole('button', { name: 'Відновити бекап', exact: true }).waitFor({ timeout: 30000 });
        console.log('PASS: previous-state recovery through the interface');

        await page.getByRole('button', { name: 'Відновити бекап', exact: true }).click();
        await restoreDialog.getByLabel('Файл єдиного бекапу').setInputFiles({ name: 'legacy.mils', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(snapshot)) });
        await restoreDialog.getByText(/Це стара незашифрована копія/).waitFor();
        await restoreDialog.getByLabel('Пароль єдиного бекапу', { exact: true }).fill(password);
        await restoreDialog.getByLabel('Повтор пароля єдиного бекапу', { exact: true }).fill(password);
        await restoreDialog.getByRole('button', { name: 'Перевірити файл' }).click();
        await restoreDialog.getByText(/Файл перевірено/).waitFor();
        await restoreDialog.getByRole('checkbox', { name: 'Я закрив інші вкладки та підтверджую заміну поточних даних', exact: true }).check();
        await restoreDialog.getByRole('button', { name: 'Відновити всі дані' }).click();
        await restoreDialog.getByRole('button', { name: 'Перезавантажити програму' }).waitFor();
        assert.equal(await page.evaluate(async () => (await localforage.getItem('document_ui_test_v1')).marker), 'BACKUP_UI_SECRET_ТЕСТ');
        assert.deepEqual(errors, [], 'No uncaught JavaScript errors');
        console.log('PASS: legacy .mils import with encrypted safety snapshot; no uncaught JavaScript errors');
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
