const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');
const ExcelJS = require('exceljs');
const { D } = require('./suite-document-journal.cjs');
const { createHarness } = require('./suite-backup-unit.cjs');

(async () => {
    const browser = await chromium.launch({ channel: process.env.SUITE_BROWSER || 'msedge', headless: true });
    try {
        const context = await browser.newContext({ viewport: { width: 1600, height: 1100 }, timezoneId: 'Europe/Kyiv', acceptDownloads: true });
        const page = await context.newPage(), errors = [];
        page.setDefaultTimeout(12000);
        page.on('pageerror', error => { errors.push(error.message); console.error('PAGEERROR', error.message); });
        await page.route('http://127.0.0.1:8765/**', route => route.abort());
        await page.clock.install({ time: new Date('2026-09-30T12:00:00+03:00') });
        await page.goto(process.env.SUITE_TEST_URL || pathToFileURL(path.resolve(__dirname, '../dist-single/MilitarySuite.html')).href);
        const ready = () => Promise.race([
            page.getByRole('heading', { name: 'Стрічка подій', exact: true }).waitFor(),
            page.locator('[data-suite-module="med"]').waitFor()
        ]);
        await ready();
        const journal = D.migrate({ ...D.empty(), tasks: [{ ...D.cleanRow('tasks', { date: '2026-09-29', task: 'Тестове завдання', status: 'Виконано', reportedInPbd: true }), id: 'task-1' }] });
        await page.evaluate(async journal => {
            await window.SuiteRuntime.drain();
            const person = { id: 'm1', name: 'ТЕСТОВИЙ Іван Петрович', callsign: 'ТЕСТ', unit: 'Тестова група', rank: 'Солдат', sourceRosterId: 'r1' };
            const another = { id: 'm2', name: 'Інший Тестовий Запис', callsign: 'ТЕСТ2', unit: 'Тестова група', rank: 'Солдат' };
            localStorage.setItem('tactical_personnel', JSON.stringify([{ id: 'r1', fullName: 'Тестовий Іван Петрович', callsign: 'ТЕСТ', unit: 'Тестова група', rank: 'Солдат' }]));
            await localforage.setItem('med_soldiers_v3', [person, another]);
            await localforage.setItem('med_settings_v3', { ranks: ['Солдат'], units: ['Тестова група'], sectors: ['Тестове місце'], causes: ['Тестова причина'] });
            const base = { soldierId: 'm1', unit: 'Тестова група', cause: 'Тестова причина', severity: 'Легкий', evacStatus: 'Не евакуйований', actualLoc: 'Тестове місце', docLoc: '', inUdp: false, injuries: {} };
            await localforage.setItem('med_episodes_v3', [
                { ...base, id: 'w1', lossType: 'Поранення (300)', date: '2026-09-30T10:00', injuries: { head: { eye: true } }, personnelSnapshot: { ...person, name: 'Тестовий Іван Петрович' } },
                { ...base, id: 'd1', lossType: '200 (від ран)', date: '2026-09-29T12:00' },
                { ...base, id: 'w2', soldierId: 'm2', lossType: 'Поранення (300)', date: '2026-09-30T11:15' }
            ]);
            await localforage.setItem('document_journal_v1', journal);
        }, journal);
        await page.reload(); await ready();
        await page.getByRole('button', { name: 'Медична Евакуація', exact: true }).click();
        const med = page.locator('#med-app');
        await med.getByRole('button', { name: /Перевірити: ТЕСТОВИЙ/ }).click();
        const chronology = page.getByRole('dialog', { name: 'Перевірка хронології', exact: true });
        await chronology.getByLabel('Дата w1', { exact: true }).fill('2026-09-28T10:00');
        await chronology.getByRole('button', { name: 'Застосувати виправлення дат', exact: true }).click();
        await page.waitForFunction(async () => (await localforage.getItem('med_episodes_v3')).find(ep => ep.id === 'w1')?.date === '2026-09-28T10:00');
        assert.equal(await med.getByText(/Виявлено \d+ суперечностей дат/).count(), 0);

        await med.getByRole('button', { name: 'Створити запис', exact: true }).click();
        const form = med.locator('form').filter({ has: page.getByPlaceholder('ПІБ повністю...') });
        await form.getByPlaceholder('ПІБ повністю...').fill('Тестовий  Іван Петрович');
        await form.getByPlaceholder('Позивний (за наявності)...').fill('ТЕСТ');
        await form.getByLabel('Підрозділ військовослужбовця').selectOption('Тестова група');
        await form.getByLabel('Тип медичного запису').selectOption('Поранення (300)');
        await form.getByLabel('Важкість у медичному записі').selectOption('Легкий');
        await form.getByLabel('Причина медичного запису').selectOption('Тестова причина');
        await form.getByLabel('Дата й час медичного запису').fill('2026-09-27T12:00');
        await form.locator('button[type=submit]').click();
        const matches = page.getByRole('dialog', { name: 'Можливий повторний запис військовослужбовця', exact: true });
        await matches.getByRole('button', { name: 'Це цей військовослужбовець', exact: true }).first().click();
        await form.locator('button[type=submit]').click();
        await page.waitForFunction(async () => (await localforage.getItem('med_episodes_v3')).length === 4);
        assert.equal(await page.evaluate(async () => (await localforage.getItem('med_soldiers_v3')).length), 2, 'Manual typing must not duplicate a person');
        assert.ok(await page.evaluate(async () => (await localforage.getItem('med_episodes_v3')).some(ep => ep.soldierId === 'm1' && ep.date === '2026-09-27T12:00')));
        await med.locator('header').getByRole('button', { name: /^Евакуація/ }).click();
        await med.getByText('45 хв', { exact: true }).first().waitFor();
        await page.clock.fastForward(60000);
        await med.getByText('46 хв', { exact: true }).first().waitFor();

        await med.locator('header').getByRole('button', { name: 'Аналітика', exact: true }).click();
        await page.locator('[data-med-chart=daily] canvas').waitFor();
        assert.equal(await med.getByRole('checkbox', { name: "Об'єднати групи", exact: true }).count(), 1);
        const downloadWait = page.waitForEvent('download');
        await med.getByRole('button', { name: 'Експорт (Excel)', exact: true }).click();
        const download = await downloadWait;
        const book = new ExcelJS.Workbook(); await book.xlsx.readFile(await download.path());
        assert.equal(book.worksheets.length, 6);

        await page.getByRole('button', { name: 'Спільні довідники', exact: true }).click();
        const dictionaries = page.getByRole('dialog', { name: 'Спільні довідники', exact: true });
        await dictionaries.getByRole('button', { name: /ПІБ і дублікати/ }).click();
        await dictionaries.getByRole('button', { name: 'Стандартизувати всі ПІБ', exact: true }).click();
        assert.equal(await dictionaries.getByRole('button', { name: 'Обрати всю групу', exact: true }).count(), 0, 'Case-only matches do not require manual review');
        await dictionaries.getByLabel('Пароль захисної копії', { exact: true }).fill('synthetic-name-password');
        await dictionaries.getByLabel('Повторіть пароль', { exact: true }).fill('synthetic-name-password');
        await dictionaries.getByRole('checkbox', { name: /Підтверджую масове форматування ПІБ/ }).check();
        await dictionaries.getByRole('button', { name: 'Застосувати до всієї бази', exact: true }).click();
        await dictionaries.getByText(/ПІБ стандартизовано/).waitFor();
        const result = await page.evaluate(async () => ({
            people: await localforage.getItem('med_soldiers_v3'), episodes: await localforage.getItem('med_episodes_v3'),
            roster: JSON.parse(localStorage.getItem('tactical_personnel')), journal: await localforage.getItem('document_journal_v1'), recovery: await localforage.getItem('military_suite_recovery_v1')
        }));
        assert.equal(result.people[0].id, 'm1'); assert.equal(result.people[0].name, 'ТЕСТОВИЙ Іван Петрович');
        assert.equal(result.people[1].id, 'm2'); assert.equal(result.people[1].name, 'ІНШИЙ Тестовий Запис');
        assert.equal(result.roster[0].id, 'r1'); assert.equal(result.roster[0].fullName, 'ТЕСТОВИЙ Іван Петрович');
        assert.equal(result.episodes.find(ep => ep.id === 'w1').personnelSnapshot.name, 'ТЕСТОВИЙ Іван Петрович');
        assert.equal(result.journal.tasks[0].reportedInPbd, true);
        assert.equal(result.episodes.find(ep => ep.id === 'd1').date, '2026-09-29T12:00');
        assert.equal(result.recovery.cipher, 'AES-256-GCM');
        const recovery = await createHarness().api.decrypt(result.recovery, 'synthetic-name-password');
        assert.equal(recovery.localforage.med_soldiers_v3[0].name, 'ТЕСТОВИЙ Іван Петрович');
        assert.equal(JSON.parse(recovery.localstorage.tactical_personnel)[0].fullName, 'Тестовий Іван Петрович');
        await page.reload(); await ready();
        await page.getByRole('button', { name: 'Спільні довідники', exact: true }).click();
        await dictionaries.getByRole('button', { name: /ПІБ і дублікати/ }).click();
        await dictionaries.getByText(/Усі ПІБ уже мають єдиний формат/).waitFor();
        assert.equal(await dictionaries.getByRole('button', { name: 'Стандартизувати всі ПІБ', exact: true }).isDisabled(), true);
        assert.deepEqual(errors, []);
        console.log('PASS: isolated offline UI, chronology correction, manual-name duplicate prevention, older wound after death, minute timer, six-sheet export, one-batch name formatting with encrypted recovery, preserved PBD/IDs and no-op after reload.');
        await context.close();
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
