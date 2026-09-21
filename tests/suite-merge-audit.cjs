const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');

(async () => {
    const browser = await chromium.launch({ channel: process.env.SUITE_BROWSER || 'msedge', headless: true });
    try {
        const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, offline: process.env.SUITE_TEST_OFFLINE === '1' });
        page.setDefaultTimeout(20000);
        await page.route('http://127.0.0.1:8765/**', route => route.abort());
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.goto((process.env.SUITE_TEST_URL || 'http://127.0.0.1:5173'), { waitUntil: 'domcontentloaded', timeout: 45000 });
        await page.getByRole('heading', { name: 'Стрічка подій', exact: true }).waitFor({ timeout: 30000 });
        const references = require("./source-audit.cjs").references();
        const audit = await page.evaluate(references => ({ missing: references.filter(([name]) => !(name in window)), chart: Chart.version, labels: typeof ChartDataLabels, excel: typeof ExcelJS, crypto: typeof CryptoJS }), [...references]);
        assert.deepEqual(audit.missing, [], 'Unresolved global references in merged React modules');
        assert.equal(audit.labels, 'object');
        assert.equal(audit.excel, 'object');
        assert.equal(audit.crypto, 'object');
        console.log('PASS: static scope audit; Chart.js ' + audit.chart + ', labels, ExcelJS and legacy crypto loaded');

        await page.evaluate(async () => {
            const people = Array.from({ length: 4 }, (_, i) => ({ id: 'audit-person-' + i, name: 'Тест ' + i, callsign: 'Тест-' + i, rank: 'Не вказано', unit: 'Тест' }));
            await localforage.setItem('med_soldiers_v3', people);
            await localforage.setItem('med_episodes_v3', people.map((p, i) => ({ id: 'audit-record-' + i, soldierId: p.id, date: new Date().toISOString(),
                lossType: i === 0 ? 'Загибель (200)' : 'Поранення (300)', severity: i === 0 ? null : 'Легкий', injuries: {},
                cause: 'Тест', evacStatus: 'Не евакуйований', actualLoc: '', docLoc: '', unit: p.unit, notes: 'Синтетичні дані для тесту' })));
            await localforage.setItem('medtactical_auto_snapshot', { timestamp: new Date().toISOString(), actionNote: 'Тестовий знімок',
                soldiers: people, episodes: await localforage.getItem('med_episodes_v3') });
        });
        // The current suite keeps modules mounted in the background. Rehydrate
        // the synthetic fixture before exercising the already-mounted medical UI.
        await page.reload({ waitUntil: 'domcontentloaded', timeout: 45000 });
        await page.getByRole('heading', { name: 'Стрічка подій', exact: true }).waitFor({ timeout: 30000 });
        await page.getByRole('button', { name: 'Медична Евакуація', exact: true }).click();
        await page.getByRole('heading', { name: 'MedTactical', exact: true }).waitFor({ timeout: 30000 });
        await page.locator('#med-app > header').getByRole('button', { name: 'Аналітика', exact: true }).click();
        const labelModels = () => page.evaluate(() => Object.values(Chart.instances).filter(c => c.canvas.closest('#med-app')).flatMap(c =>
            (c.$datalabels?._labels || []).filter(label => label._model?.display).flatMap(label => label._model.lines)));
        await page.waitForFunction(() => Object.values(Chart.instances).some(c => c.canvas.closest('#med-app')));
        assert.equal((await labelModels()).length, 0);
        assert.equal(await page.getByRole('checkbox', { name: 'у %', exact: true }).isDisabled(), true);
        await page.getByRole('checkbox', { name: 'Цифри', exact: true }).check();
        await page.waitForFunction(() => Object.values(Chart.instances).some(c => c.canvas.closest('#med-app') && c.$datalabels?._labels.some(l => l._model?.display)));
        assert.ok((await labelModels()).some(value => Number(value) > 0), 'Numbers must actually be rendered');
        await page.getByRole('checkbox', { name: 'у %', exact: true }).check();
        await page.waitForFunction(() => Object.values(Chart.instances).some(c => c.canvas.closest('#med-app') && c.$datalabels?._labels.some(l => l._model?.lines.some(s => String(s).includes('%')))));
        const percentages = await labelModels();
        assert.ok(percentages.includes('25%') && percentages.includes('75%'), 'Synthetic 1:3 split must yield 25% and 75%');
        const pieId = await page.evaluate(() => {
            const chart = Object.values(Chart.instances).find(c => c.canvas.closest('#med-app') && ['pie', 'doughnut'].includes(c.config.type) && c.$datalabels?._labels.some(l => l._model?.lines.includes('75%')));
            chart.canvas.setAttribute('data-audit-chart', 'percentages');
            return 'percentages';
        });
        await page.locator('[data-audit-chart=' + pieId + ']').screenshot({ path: path.join(__dirname, 'suite-chart-percentages.png') });
        await page.getByRole('checkbox', { name: 'Цифри', exact: true }).uncheck();
        await page.waitForFunction(() => Object.values(Chart.instances).filter(c => c.canvas.closest('#med-app')).every(c => !(c.$datalabels?._labels || []).some(l => l._model?.display)));
        console.log('PASS: numbers on/off; percentages are drawn and match fixture totals');

        const excelDownload = page.waitForEvent('download');
        await page.getByTitle('Завантажити звіт в Excel (сирі дані + діаграма)', { exact: true }).first().click();
        const excel = await excelDownload;
        const excelBytes = fs.readFileSync(await excel.path());
        assert.equal(excelBytes.subarray(0, 2).toString(), 'PK');
        const workbook = await page.evaluate(async base64 => {
            const book = new ExcelJS.Workbook();
            await book.xlsx.load(Uint8Array.from(atob(base64), c => c.charCodeAt(0)));
            return { sheets: book.worksheets.length, rows: book.worksheets[0].rowCount, images: book.model.media.length };
        }, excelBytes.toString('base64'));
        assert.ok(workbook.sheets > 0 && workbook.rows > 0 && workbook.images > 0);
        console.log('PASS: chart Excel export creates a readable workbook including its chart image');

        await page.locator('#suite-content').evaluate(el => { el.scrollTop = 0; });
        await page.getByRole('button', { name: 'База / Бекап', exact: true }).click();
        const password = 'test-med-backup-password';
        await page.getByPlaceholder('Придумайте пароль для захисту файлу...').fill(password);
        const backupDownload = page.waitForEvent('download');
        await page.getByRole('button', { name: 'Завантажити зашифрований .enc файл', exact: true }).click();
        const backup = await backupDownload;
        const encrypted = fs.readFileSync(await backup.path(), 'utf8');
        assert.ok(!encrypted.includes('audit-person-'));
        const roundTrip = await page.evaluate(({ encrypted, password }) => {
            const restored = JSON.parse(CryptoJS.AES.decrypt(encrypted, password).toString(CryptoJS.enc.Utf8));
            return { people: restored.soldiers.length, episodes: restored.episodes.length };
        }, { encrypted, password });
        assert.deepEqual(roundTrip, { people: 4, episodes: 4 });
        await page.locator('#med-app input[type=file][accept=".enc"]').setInputFiles({ name: 'audit.enc', mimeType: 'text/plain', buffer: Buffer.from(encrypted) });
        await page.getByPlaceholder('Пароль для розшифрування файлу...').fill(password);
        await page.getByRole('button', { name: 'Розшифрувати та відновити базу', exact: true }).click();
        await page.getByText('Дані успішно імпортовано!', { exact: true }).waitFor();
        await page.getByRole('button', { name: 'База / Бекап', exact: true }).click();
        page.on('dialog', dialog => dialog.accept());
        await page.getByRole('button', { name: '↩ Відновити з останнього знімка', exact: true }).click();
        await page.getByText('Базу успішно відновлено з аварійного знімка!', { exact: true }).waitFor();
        await page.waitForFunction(async () => (await localforage.getItem('med_logs_v3')).some(log => log.action === 'RESTORE_SNAPSHOT'));
        assert.deepEqual(errors, []);
        console.log('PASS: native medical backup export/import and snapshot restore with audit log; no uncaught JavaScript errors');
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
