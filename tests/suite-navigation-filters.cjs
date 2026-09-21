const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');

(async () => {
    const browser = await chromium.launch({ channel: process.env.SUITE_BROWSER || 'msedge', headless: true });
    let debugPage;
    try {
        const page = await browser.newPage({ viewport: { width: 1800, height: 1100 }, offline: process.env.SUITE_TEST_OFFLINE === '1' });
        debugPage = page;
        page.setDefaultTimeout(20000);
        await page.route('http://127.0.0.1:8765/**', route => route.abort());
        const errors = [];
        page.on('pageerror', error => { errors.push(error.message); console.error('PAGE:', error.message); });
        await page.goto((process.env.SUITE_TEST_URL || 'http://127.0.0.1:5173'), { waitUntil: 'domcontentloaded', timeout: 45000 });
        await page.getByRole('heading', { name: 'Стрічка подій', exact: true }).waitFor({ timeout: 45000 });
        const enemy = page.locator('[data-suite-module=enemy]'), med = page.locator('[data-suite-module=med]'), docs = page.locator('#document-journal');
        const top = name => page.getByRole('button', { name, exact: true }).first().click();
        const snapshot = scope => scope.locator('input:visible, select:visible, textarea:visible').evaluateAll(elements => elements.filter(el => !['file', 'password'].includes(el.type)).map(el => ({ label: el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.type, value: el.value, checked: ['checkbox', 'radio'].includes(el.type) ? el.checked : undefined })));
        await enemy.getByPlaceholder('Опис, позивний, зброя...', { exact: true }).fill('Тестовий пошук');
        await enemy.locator('input[type=date]:visible').nth(0).fill('2026-09-01');
        await enemy.locator('input[type=date]:visible').nth(1).fill('2026-09-15');
        await enemy.locator('select:visible').filter({ has: page.locator('option[value="test"]') }).selectOption('test');
        await enemy.getByRole('checkbox', { name: 'Лише з втратами', exact: true }).check();
        const list = await snapshot(enemy);

        const docSnapshots = {};
        for (const [index, name] of ['Завдання', 'Втрати ОВТ', 'Статус позицій'].entries()) {
            await top(name);
            await docs.getByRole('heading', { name, exact: true }).first().waitFor();
            await docs.getByLabel('Пошук у документах', { exact: true }).fill('Фільтр ' + name);
            const dates = docs.locator('input[type=date]:visible');
            await dates.nth(0).fill('2026-09-0' + (index + 1));
            await dates.nth(1).fill('2026-09-1' + (index + 1));
            await docs.getByLabel('Фільтр статусу журналу', { exact: true }).selectOption({ index: index + 1 });
            if (name !== 'Втрати ОВТ') await docs.getByRole('checkbox', { name: 'Лише не подані в ПБД', exact: true }).check();
            else await docs.getByLabel('Фільтр категорії ОВТ', { exact: true }).selectOption('Транспорт');
            docSnapshots[name] = await snapshot(docs);
        }
        await top('Медична Евакуація');
        await med.getByRole('heading', { name: 'MedTactical', exact: true }).waitFor();
        await med.getByPlaceholder('Пошук... [Ctrl+F]', { exact: true }).fill('Медичний тест');
        await med.getByRole('button', { name: 'Календар', exact: true }).click();
        await med.locator('input[type=date]:visible').nth(0).fill('2026-09-04');
        await med.locator('input[type=date]:visible').nth(1).fill('2026-09-12');
        await med.getByRole('button', { name: 'Застосувати', exact: true }).click();
        const medList = await snapshot(med);
        await top('Журнал О/С');
        await page.locator('#nav-personnel').click();
        await page.locator('#search-input').fill('Тест журналу');
        await page.locator('#filter-status').selectOption('300');
        const personnel = await snapshot(page.locator('#tab-personnel'));
        for (let cycle = 0; cycle < 2; cycle++) {
            for (const name of ['Завдання', 'Втрати ОВТ', 'Статус позицій']) { await top(name); assert.deepEqual(await snapshot(docs), docSnapshots[name], name + ' retains independent filters'); }
            await top('Медична Евакуація'); assert.deepEqual(await snapshot(med), medList, 'Medical journal filters survive switching');
            await med.getByRole('button', { name: '09-04 — 09-12', exact: true }).waitFor();
            await top('Журнал О/С'); assert.deepEqual(await snapshot(page.locator('#tab-personnel')), personnel);
            await top('Втрати Противника'); assert.deepEqual(await snapshot(enemy), list, 'Event list filters survive switching');
        }
        console.log('PASS: list search, dates, status, checkboxes survive repeated switching through all six programs');

        await enemy.getByRole('button', { name: 'Дашборд', exact: true }).click();
        await enemy.locator('input[type=date]:visible').nth(0).fill('2026-08-10');
        await enemy.locator('input[type=date]:visible').nth(1).fill('2026-08-20');
        const check = enemy.locator('input[type=checkbox]:visible').first();
        await check.setChecked(!(await check.isChecked()));
        const dashboard = await snapshot(enemy);
        await enemy.getByRole('button', { name: 'Таблиця', exact: true }).click();
        await enemy.locator('input[type=date]:visible').nth(0).fill('2026-07-10');
        await enemy.locator('input[type=date]:visible').nth(1).fill('2026-07-20');
        await enemy.locator('select:visible').first().selectOption({ index: 1 });
        const table = await snapshot(enemy);
        await top('Завдання'); await top('Втрати Противника');
        assert.deepEqual(await snapshot(enemy), table, 'Table filters survive root switching');
        await enemy.getByRole('button', { name: 'Дашборд', exact: true }).click();
        assert.deepEqual(await snapshot(enemy), dashboard, 'Dashboard dates and checkbox selections survive inner switching');
        await enemy.getByRole('button', { name: 'Стрічка', exact: true }).click();
        assert.deepEqual(await snapshot(enemy), list, 'Event list survives inner switching');

        // A genuine source update rerenders the parent independently of top navigation.
        await page.evaluate(async () => {
            await localforage.setItem('med_episodes_v3', [{ id: 'synthetic-sync', soldierId: 'synthetic-only', date: '2026-09-14T10:00', lossType: 'Поранення (300)' }]);
            window.dispatchEvent(new Event('suite-medical-data-changed'));
        });
        await page.waitForFunction(() => document.querySelector('[data-testid="medical-sync-status"]')?.textContent.includes('Враховано епізодів: 1'));
        assert.deepEqual(await snapshot(enemy), list, 'Sync-triggered rerender must preserve filters');
        await enemy.getByRole('button', { name: 'Дашборд', exact: true }).click();
        assert.deepEqual(await snapshot(enemy), dashboard);
        await enemy.getByRole('button', { name: 'Таблиця', exact: true }).click();
        assert.deepEqual(await snapshot(enemy), table);
        await top('Створити Єдиний Бекап');
        await page.getByLabel('Пароль єдиного бекапу', { exact: true }).fill('test-only-password');
        await page.getByRole('dialog').getByRole('button', { name: 'Закрити', exact: true }).click();
        assert.deepEqual(await snapshot(enemy), table, 'Backup modal renders must preserve filters');
        await enemy.getByRole('button', { name: 'Стрічка', exact: true }).click();
        await enemy.getByRole('button', { name: 'Скинути фільтри', exact: true }).click();
        await top('Втрати ОВТ'); await top('Втрати Противника');
        assert.equal(await enemy.getByPlaceholder('Опис, позивний, зброя...', { exact: true }).inputValue(), '');
        assert.equal(await enemy.locator('select:visible').filter({ has: page.locator('option[value="test"]') }).inputValue(), 'all');
        assert.deepEqual(errors, []);
        console.log('PASS: inner views, dashboard/table options, real source refresh, backup dialog, explicit reset, no JavaScript errors');
    } catch (error) {
        if (debugPage) { console.error(await debugPage.locator('body').innerText()); await debugPage.screenshot({ path: require('node:path').join(__dirname, '../test-results/navigation-failure.png') }); }
        throw error;
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
