const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { D } = require('./suite-document-journal.cjs');

(async () => {
    const browser = await chromium.launch({ channel: process.env.SUITE_BROWSER || 'msedge', headless: true });
    try {
        const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, offline: process.env.SUITE_TEST_OFFLINE === '1' });
        page.setDefaultTimeout(15000);
        const errors = []; page.on('pageerror', error => errors.push(error.message));
        await page.route('http://127.0.0.1:8765/**', route => route.abort());
        await page.goto(process.env.SUITE_TEST_URL || 'http://127.0.0.1:5173');
        await page.getByRole('heading', { name: 'Стрічка подій', exact: true }).waitFor();
        const row = (id, name, category, extra = {}) => ({ ...D.cleanRow('positions', { name, category, status: 'виставлена', date: '2026-01-01', docNumber: 'ТЕСТ/' + id, ...extra }), id, positionId: extra.positionId || id, createdAt: '2026-01-01T09:00:00Z' });
        const seed = [row('a', 'Архів Альфа', 'Мін. Батр.'), row('b', 'Архів Бета', 'Вогневі'), row('c', 'Інший запис', 'Піхотні'), row('old', 'Архів Бета', 'Інші', { date: '2025-01-01' }), row('closed', 'Архів Бета', 'Інші', { date: '2025-02-01', status: 'знята', positionId: 'old' })];
        await page.evaluate(data => localforage.setItem('document_journal_v1', data), { ...D.empty(), positions: seed });
        await page.reload();
        const top = name => page.getByRole('button', { name, exact: true }).first().click();
        await top('Статус позицій');
        const scope = page.locator('#document-journal'), dialog = page.getByRole('dialog');
        const store = () => page.evaluate(() => localforage.getItem('document_journal_v1'));
        const group = scope.getByTestId('position-category-cards').getByRole('button', { name: /^ОВгП/ });
        assert.equal(await group.locator('.dj-stat-number').textContent(), '2');
        await group.click(); assert.equal(await scope.locator('tbody [data-document-id]').count(), 2);
        assert.equal(await scope.getByLabel('Фільтр категорії позицій').inputValue(), 'ОВгП');
        await top('Завдання'); await top('Статус позицій');
        assert.equal(await group.getAttribute('aria-pressed'), 'true');
        await page.reload(); await top('Статус позицій');
        assert.equal(await group.getAttribute('aria-pressed'), 'true');
        assert.equal(await scope.locator('tbody [data-document-id]').count(), 2);
        await group.click(); assert.equal(await scope.locator('tbody [data-document-id]').count(), seed.length);
        const open = async (status, date = '2026-02-01') => {
            await scope.getByRole('button', { name: 'Додати запис', exact: true }).click();
            await dialog.getByLabel('Документальна дія', { exact: true }).selectOption(status);
            await dialog.getByLabel('Дата зміни', { exact: true }).fill(date);
            await dialog.getByLabel('№ Позатермінового донесення', { exact: true }).fill('ТЕСТ/ДОК');
        };
        const save = async () => { await dialog.getByRole('button', { name: 'Зберегти запис', exact: true }).click(); await dialog.waitFor({ state: 'hidden' }); };
        const source = dialog.getByRole('combobox', { name: 'Позиція з реєстру', exact: true });
        const destination = dialog.getByRole('combobox', { name: 'На місце іншої позиції', exact: true });
        const pick = async (input, query, id) => { await input.fill(query); await dialog.locator(`[role="option"][data-position-id="${id}"]`).click(); };
        await open('перейменована');
        await source.fill('АЛЬФ'); assert.equal(await dialog.getByRole('listbox').getByRole('option').count(), 1);
        await source.press('ArrowDown'); await source.press('Enter');
        assert.equal(await source.inputValue(), 'Архів Альфа');
        assert.equal(await source.getAttribute('aria-expanded'), 'false');
        assert.equal((await store()).positions.length, seed.length, 'Enter selects instead of submitting');
        await dialog.getByLabel('Нова назва позиції', { exact: true }).fill('Нова Альфа'); await save();
        assert.equal((await store()).positions.at(-1).positionId, 'a');
        await open('переміщена', '2026-02-02');
        await pick(source, 'нова', 'a');
        await destination.fill('БЕТ'); assert.equal(await dialog.getByRole('listbox').getByRole('option').count(), 2, 'Repeated historical names stay separate');
        fs.mkdirSync(path.join(__dirname, '../test-results'), { recursive: true });
        await dialog.screenshot({ path: path.join(__dirname, '../test-results/position-search-picker.png') });
        await dialog.locator('[role="option"][data-position-id="old"]').click();
        await destination.fill('НЕІСНУЮЧА');
        await dialog.getByRole('button', { name: 'Зберегти запис', exact: true }).click();
        assert.equal((await store()).positions.length, seed.length + 1, 'Optional query must not save a stale destination');
        assert.equal(await destination.evaluate(el => el.validity.valid), false);
        await pick(destination, 'Бета', 'old');
        await source.fill('НЕІСНУЮЧА');
        await source.press('Escape'); assert.equal(await dialog.isVisible(), true, 'Escape closes suggestions, not form');
        await dialog.getByRole('button', { name: 'Зберегти запис', exact: true }).click();
        assert.equal((await store()).positions.length, seed.length + 1);
        await pick(source, 'нова', 'a');
        assert.equal(await destination.inputValue(), '', 'Changing source clears old destination link');
        await pick(destination, 'Бета', 'old'); await save();
        assert.equal((await store()).positions.at(-1).destinationPositionId, 'old');
        assert.equal((await store()).positions.at(-1).newName, '', 'Movement rename is optional');
        for (const [status, name, id, newName, date] of [
            ['облаштовується', 'Нова Альфа', 'a', 'Назва після облаштування', '2026-02-03'],
            ['знята', 'Назва після облаштування', 'a', 'Архівна кінцева назва', '2026-02-04'],
            ['знищена', 'Архів Бета', 'b', 'Закритий документ Бета', '2026-02-05']
        ]) {
            await open(status, date); await pick(source, name, id);
            await dialog.getByLabel('Нова назва позиції', { exact: true }).fill(newName); await save();
            const latest = (await store()).positions.at(-1);
            assert.equal(latest.status, status); assert.equal(latest.newName, newName); assert.equal(latest.name, name);
        }
        for (const [status, name, newName] of [['виставлена', 'Початкова', 'Нова виставлена'], ['облаштовується', 'Початкове облаштування', 'Нова підготовка']]) {
            await open(status);
            await dialog.getByLabel('Назва позиції', { exact: true }).fill(name);
            await dialog.getByLabel('Категорія позиції', { exact: true }).selectOption('Інші');
            await dialog.getByLabel('Нова назва позиції', { exact: true }).fill(newName); await save();
        }
        const saved = await store();
        assert.deepEqual(saved.positions.slice(0, seed.length), seed, 'Original categories and documents unchanged');
        const P = await import('../src/modules/documents/position-register.js');
        const registry = P.buildPositionRegister(saved.positions);
        assert.equal(registry.issues.size, 0);
        assert.equal(registry.entries.find(entry => entry.id === 'a').name, 'Архівна кінцева назва');
        const removal = saved.positions.find(record => record.newName === 'Архівна кінцева назва');
        await scope.getByRole('button', { name: 'Історія позиції ' + removal.id, exact: true }).click();
        await dialog.getByText('Назва після облаштування → Архівна кінцева назва', { exact: false }).first().waitFor();
        assert.equal(await dialog.getByTestId('position-history').locator('ol > li').count(), 5);
        await dialog.getByRole('button', { name: 'Закрити вікно журналу', exact: true }).click();
        await page.reload(); await top('Статус позицій');
        assert.deepEqual(await store(), saved, 'Reload preserves full data and audit');
        assert.deepEqual(errors, []);
        console.log('PASS: typing/current names, keyboard selection, duplicate-name ID choices, invalid-query guards, Escape, optional rename across all statuses, immutable history, OVgP count/filter/navigation/reload and no browser errors');
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
