export const MEDICAL_SERIES = [
    { key: '200', label: 'Бойові 200', color: '#cbd5e1' },
    { key: '200 ПВР', label: '200 (ПВР)', color: '#94a3b8' },
    { key: 'Неб. смерть', label: 'Небойові 200', color: '#a8a29e' },
    { key: 'Поранення', label: 'Поранення', color: '#fb7185' },
    { key: 'Бойове', label: 'Бойові травми', color: '#fb923c' },
    { key: 'Небойове', label: 'Небойові травми', color: '#facc15' },
    { key: 'ЗБВ', label: 'ЗБВ', color: '#60a5fa' },
    { key: 'СЗЧ', label: 'СЗЧ', color: '#c084fc' },
    { key: 'Дезертирство', label: 'Дезертирство', color: '#f472b6' },
];

const keys = MEDICAL_SERIES.map(series => series.key);
const validKeys = (value, fallback) => Array.isArray(value) ? keys.filter(key => value.includes(key)) : [...fallback];

export function normalizeChartView(value) {
    const view = value && typeof value === 'object' ? value : {};
    return {
        visible: validKeys(view.visible, keys),
        combined: validKeys(view.combined, ['Поранення', 'Бойове']),
        showCombined: view.showCombined === true,
        type: view.type === 'bar' ? 'bar' : 'line',
    };
}

export function buildMedicalSeries(buckets, rows, preferences, labels = buckets) {
    const view = normalizeChartView(preferences);
    const value = (bucket, key) => Math.max(0, Number(rows[bucket]?.[key]) || 0);
    const selected = MEDICAL_SERIES.filter(series => view.visible.includes(series.key));
    const datasets = selected.map(series => ({
        label: series.label, seriesKeys: [series.key],
        data: buckets.map(bucket => value(bucket, series.key)),
        borderColor: series.color, backgroundColor: series.color + '33',
        borderWidth: 2, tension: 0.25, fill: false, pointRadius: buckets.length > 40 ? 0 : 3,
        pointHoverRadius: 5, pointHitRadius: 10, maxBarThickness: 30,
    }));
    if (view.showCombined && view.combined.length) {
        const combinedLabel = 'Разом: ' + MEDICAL_SERIES.filter(series => view.combined.includes(series.key)).map(series => series.label).join(' + ');
        datasets.push({
            label: view.combined.length > 2 ? `Разом: ${view.combined.length} типів` : combinedLabel,
            exportLabel: combinedLabel,
            seriesKeys: view.combined, isCombined: true,
            data: buckets.map(bucket => view.combined.reduce((sum, key) => sum + value(bucket, key), 0)),
            borderColor: '#38bdf8', backgroundColor: 'rgba(56,189,248,0.12)',
            borderWidth: 3, tension: 0.25, fill: view.type === 'line',
            pointRadius: 0, pointHoverRadius: 6, pointHitRadius: 10,
            maxBarThickness: 30, order: -1,
        });
    }
    // Separate curves can overlap the summary. Count each category once in Excel.
    const uniqueKeys = [...new Set(datasets.flatMap(dataset => dataset.seriesKeys))];
    return {
        labels, datasets,
        exportTotals: buckets.map(bucket => uniqueKeys.reduce((sum, key) => sum + value(bucket, key), 0)),
    };
}
