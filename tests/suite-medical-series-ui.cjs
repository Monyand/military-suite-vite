const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

(async () => {
    const browser = await chromium.launch({ channel: process.env.SUITE_BROWSER || 'msedge', headless: true });
    try {
        const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, offline: process.env.SUITE_TEST_OFFLINE === '1' });
        page.setDefaultTimeout(20000);
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.route('http://127.0.0.1:8765/**', route => route.abort());
        await page.goto(process.env.SUITE_TEST_URL || 'http://127.0.0.1:5173');
        const openMedical = async () => {
            await page.getByRole('button', { name: 'Медична Евакуація', exact: true }).click();
            await page.locator('#med-app > header').getByRole('button', { name: 'Аналітика', exact: true }).click();
            await page.locator('[data-med-chart=daily] canvas').waitFor();
        };
        await page.getByRole('heading', { name: 'Стрічка подій', exact: true }).waitFor();
        await page.evaluate(async () => {
            const types = ['Загибель (200)', 'Зниклий безвісти (ЗБВ)', 'Поранення (300)', 'Небойове травмування (300)', 'СЗЧ', 'Дезертирство', 'Небойова смерть (200)'];
            const people = types.map((_, i) => ({ id: 'series-person-' + i, name: 'Синтетичний запис ' + i, unit: 'Тест', rank: 'Тест' }));
            const episodes = types.map((lossType, i) => ({ id: 'series-episode-' + i, soldierId: people[i].id, lossType, date: i < 3 ? '2026-09-01T08:00' : '2026-09-03T15:00', evacStatus: 'Не евакуйований', severity: 'Легкий', injuries: {}, cause: 'Тест', actualLoc: '', docLoc: '' }));
            await localforage.setItem('med_soldiers_v3', people);
            await localforage.setItem('med_episodes_v3', episodes);
        });
        await page.reload();
        await openMedical();
        assert.equal(await page.getByRole('checkbox', { name: "Об'єднати групи", exact: true }).count(), 1);
        const snapshot = () => page.evaluate(async () => JSON.stringify({ episodes: await localforage.getItem('med_episodes_v3'), people: await localforage.getItem('med_soldiers_v3') }));
        const before = await snapshot();
        const chart = id => page.evaluate(id => {
            const c = Chart.getChart(document.querySelector(`[data-med-chart=${id}] canvas`));
            return { type: c.config.type, labels: c.data.labels, datasets: c.data.datasets.map(ds => ({ label: ds.label, data: ds.data, combined: !!ds.isCombined })), total: c.data.exportTotals };
        }, id);
        const daily = page.locator('[data-med-chart=daily]');
        const hourly = page.locator('[data-med-chart=hourly]');
        for (const id of ['daily', 'hourly']) {
            const appearance = await page.evaluate(id => {
                const card = document.querySelector(`[data-med-chart=${id}]`), c = Chart.getChart(card.querySelector('canvas'));
                return { background: getComputedStyle(card).backgroundColor, radius: getComputedStyle(card).borderRadius,
                    legendColor: c.options.plugins.legend.labels.color, legendWidth: c.options.plugins.legend.labels.boxWidth,
                    pointLegend: c.options.plugins.legend.labels.usePointStyle, grid: c.options.scales.x.grid.color,
                    rotation: c.options.scales.x.ticks.maxRotation, labels: c.options.scales.x.ticks.callback.call(c.scales.x, 0) };
            }, id);
            assert.equal(appearance.background, 'rgb(15, 23, 42)');
            assert.equal(appearance.radius, '16px');
            assert.equal(appearance.legendColor, '#94a3b8');
            assert.equal(appearance.legendWidth, 12);
            assert.equal(appearance.pointLegend, false);
            assert.equal(appearance.grid, 'rgba(51,65,85,0.35)');
            assert.equal(appearance.rotation, 0);
            assert.equal(appearance.labels, id === 'daily' ? '01.09' : '00:00');
        }
        const baseHourly = await chart('hourly');
        const otherChartSnapshot = () => page.evaluate(() => Object.values(Chart.instances).filter(c => c.canvas.closest('#med-app') && !c.canvas.closest('[data-med-chart]')).map(c => JSON.stringify(c.data)));
        const otherCharts = await otherChartSnapshot();
        await daily.getByRole('button', { name: '200 + ЗБВ', exact: true }).click();
        let state = await chart('daily');
        assert.deepEqual(state.labels, ['01.09.2026', '02.09.2026', '03.09.2026']);
        assert.deepEqual(state.datasets.find(ds => ds.combined).data, [2, 0, 0]);
        assert.deepEqual(state.total, [3, 0, 4]);
        fs.mkdirSync(path.join(__dirname, '../test-results'), { recursive: true });
        await daily.screenshot({ path: path.join(__dirname, '../test-results/medical-series-reference-style.png') });
        assert.deepEqual(await chart('hourly'), baseHourly, 'Views are independent');
        await daily.getByRole('button', { name: 'Приховати окремі', exact: true }).click();
        const summary = daily.locator('fieldset').nth(1);
        await summary.getByRole('checkbox', { name: 'Бойові 200', exact: true }).uncheck();
        await summary.getByRole('checkbox', { name: 'Небойові травми', exact: true }).check();
        state = await chart('daily');
        assert.deepEqual(state.datasets[0].data, [1, 0, 1], 'Arbitrary combination beyond presets');
        assert.equal(state.datasets.length, 1);
        await hourly.getByRole('button', { name: 'Усі 300', exact: true }).click();
        await hourly.getByRole('button', { name: 'Стовпчики', exact: true }).click();
        const hourlyCombined = (await chart('hourly')).datasets.find(ds => ds.combined).data;
        assert.equal(hourlyCombined[8], 1);
        assert.equal(hourlyCombined[15], 1);
        assert.equal(hourlyCombined.reduce((a, b) => a + b, 0), 2);
        assert.equal((await chart('hourly')).type, 'bar');
        assert.deepEqual(await otherChartSnapshot(), otherCharts, 'Grouping cannot affect other charts or evacuation aggregates');
        assert.equal(await snapshot(), before, 'Grouping cannot modify records');
        // Export overlapping separate series + their summary: unique total must remain seven.
        const downloading = page.waitForEvent('download');
        await hourly.getByTitle('Завантажити звіт в Excel (сирі дані + діаграма)', { exact: true }).click();
        const download = await downloading;
        const ExcelJS = require('exceljs');
        const book = new ExcelJS.Workbook();
        await book.xlsx.load(fs.readFileSync(await download.path()));
        const sheet = book.worksheets[0];
        assert.equal(sheet.getRow(3).getCell(sheet.columnCount).value, 'Всього (без повторів)');
        assert.equal(Array.from({ length: 24 }, (_, i) => sheet.getRow(i + 4).getCell(sheet.columnCount).value).reduce((a, b) => a + b, 0), 7);
        await page.getByRole('checkbox', { name: 'Цифри', exact: true }).check();
        await page.getByRole('checkbox', { name: 'у %', exact: true }).check();
        await page.waitForFunction(() => Chart.getChart(document.querySelector('[data-med-chart=hourly] canvas')).$datalabels._labels.some(label => label._model?.lines.includes('50%')));
        const savedViews = await page.evaluate(async () => (await localforage.getItem('med_settings_v3')).medicalChartViews);
        await page.getByRole('button', { name: 'Втрати Противника', exact: true }).click();
        await openMedical();
        assert.equal((await chart('hourly')).type, 'bar', 'Module switching retains preferences');
        assert.deepEqual((await chart('daily')).datasets[0].data, [1, 0, 1]);
        await page.reload();
        await openMedical();
        assert.equal((await chart('hourly')).type, 'bar');
        assert.deepEqual((await chart('daily')).datasets[0].data, [1, 0, 1]);
        assert.equal(await snapshot(), before);
        fs.mkdirSync(path.join(__dirname, '../test-results'), { recursive: true });
        await daily.screenshot({ path: path.join(__dirname, '../test-results/medical-series-daily.png') });
        await hourly.screenshot({ path: path.join(__dirname, '../test-results/medical-series-hourly.png') });
        await page.setViewportSize({ width: 760, height: 1050 });
        await daily.screenshot({ path: path.join(__dirname, '../test-results/medical-series-narrow.png') });
        assert.equal(await daily.evaluate(el => el.scrollWidth <= el.clientWidth), true, 'Controls must wrap without horizontal overflow');
        await page.setViewportSize({ width: 1440, height: 1100 });
        await daily.getByRole('button', { name: 'Приховати окремі', exact: true }).click();
        await daily.getByRole('checkbox', { name: 'Зведення — сума обраних', exact: true }).uncheck();
        await daily.getByRole('status').getByText('Оберіть окремі типи', { exact: false }).waitFor();
        await daily.getByRole('button', { name: 'Скинути', exact: true }).click();
        assert.equal((await chart('daily')).datasets.length, 9, 'Reset shows every supported medical loss category, including 200 (ПВР)');
        assert.equal((await chart('hourly')).type, 'bar', 'Reset applies only to one chart');
        // Backup includes the chart preferences, without changing its established format.
        await page.getByRole('button', { name: 'База / Бекап', exact: true }).click();
        await page.getByPlaceholder('Придумайте пароль для захисту файлу...').fill('test-series-password');
        const backupDownloading = page.waitForEvent('download');
        await page.getByRole('button', { name: 'Завантажити зашифрований .enc файл', exact: true }).click();
        const encrypted = fs.readFileSync(await (await backupDownloading).path(), 'utf8');
        const backupViews = await page.evaluate(encrypted => JSON.parse(CryptoJS.AES.decrypt(encrypted, 'test-series-password').toString(CryptoJS.enc.Utf8)).settings.medicalChartViews, encrypted);
        assert.deepEqual(backupViews.hourly, savedViews.hourly);
        await page.getByRole('heading', { name: 'Резервні копії та база', exact: true }).locator('../../..').getByRole('button').click();
        await page.locator('#med-app > header').getByRole('button', { name: 'Аналітика', exact: true }).click();
        await hourly.getByRole('button', { name: 'Скинути', exact: true }).click();
        assert.equal((await chart('hourly')).type, 'line');
        await page.getByRole('button', { name: 'База / Бекап', exact: true }).click();
        await page.locator('#med-app input[type=file][accept=".enc"]').setInputFiles({ name: 'series.enc', mimeType: 'text/plain', buffer: Buffer.from(encrypted) });
        await page.getByPlaceholder('Пароль для розшифрування файлу...').fill('test-series-password');
        await page.getByRole('button', { name: 'Розшифрувати та відновити базу', exact: true }).click();
        await page.getByText('Дані успішно імпортовано!', { exact: true }).waitFor();
        await openMedical();
        assert.equal((await chart('hourly')).type, 'bar', 'Backup restore recovers chart preferences');
        assert.equal(await snapshot(), before);
        assert.deepEqual(errors, []);
        console.log('PASS: independent daily/hourly grouping, totals and Excel without duplication, labels/percentages, persistence, backup, reset, responsive layout; records unchanged');
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
