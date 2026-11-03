const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');
const { createHarness } = require('./suite-backup-unit.cjs');

(async () => {
    const browser = await chromium.launch({ channel: process.env.SUITE_BROWSER || 'msedge', headless: true });
    let activePage;
    try {
        const context = await browser.newContext({ timezoneId: 'Europe/Kyiv', viewport: { width: 1800, height: 1100 }, offline: process.env.SUITE_TEST_OFFLINE === '1' });
        const page = await context.newPage();
        activePage = page;
        page.setDefaultTimeout(25000);
        await page.route('http://127.0.0.1:8765/**', route => route.abort());
        await page.clock.setFixedTime(new Date('2026-09-15T21:30:00Z'));
        const errors = [];
        page.on('pageerror', error => { errors.push(error.message); console.error('PAGE ERROR:', error.message); });
        const ready = () => Promise.race([
            page.getByRole('heading', { name: 'Стрічка подій', exact: true }).waitFor({ timeout: 45000 }),
            page.locator('#document-journal').waitFor({ timeout: 45000 })
        ]);
        const top = name => page.getByRole('button', { name, exact: true }).first().click();
        await page.goto((process.env.SUITE_TEST_URL || 'http://127.0.0.1:5173'), { waitUntil: 'domcontentloaded', timeout: 60000 });
        await ready();
        await top('Втрати ОВТ');
        const docs = page.locator('#document-journal');
        await docs.getByRole('button', { name: 'За добу', exact: true }).click();
        assert.equal(await docs.getByLabel('Дата від', { exact: true }).inputValue(), '2026-09-16');
        assert.equal(await docs.getByLabel('Дата до', { exact: true }).inputValue(), '2026-09-16');
        await docs.getByRole('button', { name: '7 днів', exact: true }).click();
        assert.equal(await docs.getByLabel('Дата від', { exact: true }).inputValue(), '2026-09-10');
        const ranges = await page.evaluate(() => [
            SuiteDates.recent(2, new Date('2026-01-01T00:30:00+02:00')),
            SuiteDates.recent(2, new Date('2026-03-30T00:30:00+03:00')),
            SuiteDates.recent(2, new Date('2026-10-26T00:30:00+02:00')),
            SuiteDates.recent(2, new Date('2024-03-01T00:30:00+02:00'))
        ]);
        assert.deepEqual(ranges, [{ from: '2025-12-30', to: '2026-01-01' }, { from: '2026-03-28', to: '2026-03-30' }, { from: '2026-10-24', to: '2026-10-26' }, { from: '2024-02-28', to: '2024-03-01' }]);
        console.log('PASS: local midnight, year boundary, both DST transitions, leap year');

        const dictDialog = page.getByRole('dialog', { name: 'Налаштування номенклатури ОВТ', exact: true });
        const dictionaryField = dictDialog.locator('label').filter({ has: page.locator('span', { hasText: /^Інше$/ }) }).locator('textarea');
        await docs.getByRole('button', { name: 'Налаштування номенклатури ОВТ', exact: true }).click();
        await dictionaryField.fill('Синтетичний довідник');
        await dictDialog.getByRole('button', { name: 'Зберегти', exact: true }).click();
        await dictDialog.waitFor({ state: 'hidden' });
        assert.deepEqual(await page.evaluate(async () => (await localforage.getItem('document_journal_v1')).settings.ovtDict['Інше']), ['Синтетичний довідник']);
        await page.reload({ waitUntil: 'domcontentloaded' }); await ready(); await top('Втрати ОВТ');
        await docs.getByRole('button', { name: 'Налаштування номенклатури ОВТ', exact: true }).click();
        assert.equal(await dictionaryField.inputValue(), 'Синтетичний довідник');
        await page.evaluate(() => {
            window.originalSetItem = localforage.setItem.bind(localforage);
            localforage.setItem = (key, value) => key === 'document_journal_v1' ? Promise.reject(new Error('TEST storage failure')) : originalSetItem(key, value);
        });
        await dictionaryField.fill('Не повинно зберегтись');
        await dictDialog.getByRole('button', { name: 'Зберегти', exact: true }).click();
        await docs.getByText(/Не збережено: TEST storage failure/).waitFor();
        assert.deepEqual(await page.evaluate(async () => (await localforage.getItem('document_journal_v1')).settings.ovtDict['Інше']), ['Синтетичний довідник']);
        await page.evaluate(() => { localforage.setItem = originalSetItem; });
        await dictDialog.getByRole('button', { name: 'Скасувати', exact: true }).click();
        console.log('PASS: dictionary persists across reload; failed save preserves previous data');

        await top('Втрати Противника');
        const enemy = page.locator('[data-suite-module=enemy]');
        await enemy.getByRole('button', { name: 'Додати подію', exact: true }).click();
        const draft = enemy.getByPlaceholder('Додаткова інформація...', { exact: true }).last();
        await draft.fill('Синтетична незбережена чернетка');
        await draft.evaluate(el => { window.draftNode = el; el.focus(); el.setSelectionRange(4, 9); });
        await page.evaluate(async () => {
            await localforage.setItem('med_episodes_v3', [{ id: 'test-source', soldierId: 'test-person', date: '2026-09-16T10:00', lossType: 'Поранення (300)' }]);
            window.dispatchEvent(new Event('suite-medical-data-changed'));
        });
        await page.waitForFunction(() => document.querySelector('[data-testid="medical-sync-status"]')?.textContent.includes('Враховано епізодів: 1'));
        assert.equal(await draft.inputValue(), 'Синтетична незбережена чернетка');
        assert.equal(await draft.evaluate(el => el === window.draftNode && el.isConnected && document.activeElement === el && el.selectionStart === 4 && el.selectionEnd === 9), true);
        await page.keyboard.press('Tab'); await page.keyboard.press('Escape');
        console.log('PASS: source refresh preserves form DOM identity, draft, focus and cursor selection');

        const password = 'test-restore-barrier-password';
        const snapshot = await page.evaluate(async () => ({ format: 'military-suite-unified', version: 1, timestamp: new Date().toISOString(),
            localforage: { document_suite_schema_v1: await localforage.getItem('document_suite_schema_v1'), document_journal_v1: await localforage.getItem('document_journal_v1'), med_soldiers_v3: [], med_episodes_v3: [], med_logs_v3: [], med_settings_v3: {} }, localstorage: { med_view_mode: 'list' } }));
        const envelope = await createHarness().api.encrypt(snapshot, password);
        const prepareRestore = async () => {
            await top('Відновити бекап');
            const dialog = page.getByRole('dialog', { name: 'Відновлення єдиного бекапу' });
            await dialog.getByLabel('Файл єдиного бекапу').setInputFiles({ name: 'synthetic.enc', mimeType: 'application/octet-stream', buffer: Buffer.from(JSON.stringify(envelope)) });
            await dialog.getByLabel('Пароль єдиного бекапу', { exact: true }).fill(password);
            await dialog.getByRole('button', { name: 'Перевірити файл', exact: true }).click();
            await dialog.getByText(/Файл перевірено/).waitFor();
            await dialog.getByRole('checkbox', { name: 'Я закрив інші вкладки та підтверджую заміну поточних даних', exact: true }).check();
            return dialog;
        };
        const dialog = await prepareRestore();
        await page.evaluate(() => {
            window.pendingWrite = SuiteRuntime.runAsync(() => new Promise(resolve => { window.releaseWrite = resolve; }).then(() => localforage.setItem('document_pending_test', 'last committed value')));
        });
        await dialog.getByRole('button', { name: 'Відновити всі дані', exact: true }).click();
        assert.equal(await page.locator('[data-suite-module]').count(), 0, 'All React modules must unmount before restore writes');
        assert.equal(await page.evaluate(() => SuiteRuntime.restoring), true);
        assert.equal(await page.evaluate(async () => { try { await SuiteRuntime.setItem('med_episodes_v3', ['stale']); return false; } catch { return true; } }), true);
        assert.equal(await page.evaluate(() => { try { SuiteRuntime.setLocalItem('tactical_personnel', 'stale'); return false; } catch { return true; } }), true);
        assert.equal(await page.evaluate(() => localforage.getItem('military_suite_recovery_v1')), null, 'Restore must wait for pending writes before collecting recovery');
        await page.evaluate(() => { window.releaseWrite(); });
        await dialog.getByRole('button', { name: 'Перезавантажити програму', exact: true }).waitFor();
        const recovery = await page.evaluate(() => localforage.getItem('military_suite_recovery_v1'));
        assert.equal((await createHarness().api.decrypt(recovery, password)).localforage.document_pending_test, 'last committed value');
        assert.deepEqual(await page.evaluate(() => localforage.getItem('med_episodes_v3')), []);
        await page.evaluate(() => { window.dispatchEvent(new Event('suite-medical-data-changed')); window.dispatchEvent(new Event('focus')); });
        assert.deepEqual(await page.evaluate(() => localforage.getItem('med_episodes_v3')), []);
        await dialog.getByRole('button', { name: 'Перезавантажити програму', exact: true }).click(); await ready();
        assert.equal(await page.evaluate(() => SuiteRuntime.restoring), false);
        await page.evaluate(() => SuiteRuntime.setItem('document_after_reload_test', true));
        console.log('PASS: restore suspends modules, drains pending writes, blocks stale writes, rehydrates on reload');

        await prepareRestore();
        await page.evaluate(() => {
            const original = localforage.setItem.bind(localforage); let fail = true;
            localforage.setItem = (key, value) => { if (fail && key === 'med_settings_v3') { fail = false; return Promise.reject(new Error('TEST restore failure')); } return original(key, value); };
        });
        await dialog.getByRole('button', { name: 'Відновити всі дані', exact: true }).click();
        await dialog.getByText(/Попередні дані повернуто/).waitFor();
        assert.equal(await page.locator('[data-suite-module]').count(), 0);
        assert.equal(await page.evaluate(() => SuiteRuntime.restoring), true);
        assert.equal(await page.evaluate(() => localforage.getItem('document_after_reload_test')), true);
        await dialog.getByRole('button', { name: 'Перезавантажити програму', exact: true }).click(); await ready();
        assert.deepEqual(errors, []);
        console.log('PASS: failed restore rolls back and remains suspended until reload; no JavaScript errors');

        const h = createHarness();
        const record = { id: 'synthetic-document', date: '2026-09-28', task: 'Синтетичне завдання', status: 'Виконано', comment: '', reportedInPbd: true };
        const journal = { version: 1, settings: {}, tasks: [record], ovt: [], positions: [] };
        h.persistent.set('document_journal_v1', journal);
        const older = await h.api.collect(); older.localforage.document_journal_v1.tasks[0].reportedInPbd = false;
        await h.api.restore(older, password);
        assert.equal(h.persistent.get('document_journal_v1').tasks[0].reportedInPbd, true);
        console.log('PASS: intentional preservation of current PBD flags is unchanged');
    } catch (error) {
        if (activePage) console.error(await activePage.locator('body').innerText());
        throw error;
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
