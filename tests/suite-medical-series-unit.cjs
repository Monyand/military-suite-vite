const assert = require('node:assert/strict');

(async () => {
    const { MEDICAL_SERIES, normalizeChartView, buildMedicalSeries } = await import('../src/modules/medical/chart-series.js');
    assert.equal(normalizeChartView().visible.length, 8);
    assert.equal(normalizeChartView(null).showCombined, false);
    assert.deepEqual(normalizeChartView({ visible: [], combined: ['200', '200', 'bad'], type: 'bad' }), { visible: [], combined: ['200'], type: 'line', showCombined: false });
    const rows = { a: { '200': 2, 'ЗБВ': 3, 'Поранення': 4, 'Бойове': 1, 'Небойове': 7 }, b: { '200': 1, 'Поранення': 2 } };
    const original = JSON.stringify(rows);
    const preferences = { visible: ['200'], combined: ['200', 'ЗБВ', '200'], showCombined: true };
    const data = buildMedicalSeries(['a', 'b', 'c'], rows, preferences);
    assert.deepEqual(data.datasets.map(ds => ds.data), [[2, 1, 0], [5, 1, 0]]);
    assert.deepEqual(data.exportTotals, [5, 1, 0], 'Summary overlap must not double count Excel total');
    const combinedOnly = buildMedicalSeries(['a', 'b'], rows, { visible: [], combined: ['Поранення', 'Бойове', 'Небойове'], showCombined: true, type: 'bar' });
    assert.deepEqual(combinedOnly.datasets[0].data, [12, 2]);
    assert.deepEqual(combinedOnly.exportTotals, [12, 2]);
    const arbitrary = buildMedicalSeries(['a'], rows, { visible: ['Поранення'], combined: ['200', 'Небойове'], showCombined: true });
    assert.deepEqual(arbitrary.exportTotals, [13]);
    const empty = buildMedicalSeries(['a'], rows, { visible: [], combined: [], showCombined: true });
    assert.deepEqual(empty.datasets, []);
    assert.deepEqual(empty.exportTotals, [0]);
    const all = buildMedicalSeries(['a'], rows, { visible: MEDICAL_SERIES.map(series => series.key), combined: MEDICAL_SERIES.map(series => series.key), showCombined: true });
    assert.deepEqual(all.exportTotals, [17]);
    assert.equal(JSON.stringify(rows), original, 'Presentation must not mutate medical data');
    assert.deepEqual(preferences.combined, ['200', 'ЗБВ', '200']);
    console.log('PASS: arbitrary chart groups, unique totals, legacy trauma, empty/malformed settings, no source mutation');
})().catch(error => { console.error(error); process.exitCode = 1; });
