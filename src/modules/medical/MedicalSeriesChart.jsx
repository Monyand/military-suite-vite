import React, { useMemo } from 'react';
import { MEDICAL_SERIES, buildMedicalSeries, normalizeChartView } from './chart-series.js';
import './charts.css';

const presets = [
    { label: '200 + ЗБВ', keys: ['200', 'ЗБВ'] },
    { label: 'Усі 300', keys: ['Поранення', 'Бойове', 'Небойове'] },
    { label: 'Усі типи', keys: MEDICAL_SERIES.map(series => series.key) },
];

export function MedicalSeriesChart({ id, title, exportTitle, buckets, rows, preferences, onChange, ChartComponent, showLabels, showPercentages, daily = false }) {
    const view = normalizeChartView(preferences);
    const data = useMemo(() => buildMedicalSeries(buckets, rows, preferences, daily ? buckets.map(date => date.split('-').reverse().join('.')) : buckets), [buckets, rows, preferences, daily]);
    const toggle = (field, key) => onChange({ ...view, [field]: view[field].includes(key) ? view[field].filter(value => value !== key) : [...view[field], key] });
    const total = data.exportTotals.reduce((sum, value) => sum + value, 0);
    const checks = field => MEDICAL_SERIES.map(series => (
        <label key={series.key} className="med-series-chip" style={{ '--series-color': series.color }}>
            <input type="checkbox" checked={view[field].includes(series.key)} onChange={() => toggle(field, series.key)} />
            <span>{series.label}</span>
        </label>
    ));
    return (
        <section className="med-series-card lg:col-span-12" aria-labelledby={`${id}-heading`} data-med-chart={id}>
            <div className="med-series-heading">
                <div>
                    <p className="med-chart-eyebrow">{daily ? 'Хронологія' : 'Розподіл за годинами'}</p>
                    <h3 id={`${id}-heading`}>{title}</h3>
                    <p className="med-chart-caption">{daily ? `${buckets.length} днів · ` : 'Заокруглено до години · '}{total} епізодів у вибраних типах, без повторів</p>
                </div>
                <div className="med-chart-actions" aria-label="Вигляд діаграми">
                    <button type="button" aria-pressed={view.type === 'line'} onClick={() => onChange({ ...view, type: 'line' })}>Лінії</button>
                    <button type="button" aria-pressed={view.type === 'bar'} onClick={() => onChange({ ...view, type: 'bar' })}>Стовпчики</button>
                    <button type="button" title="Скинути лише налаштування цієї діаграми" onClick={() => onChange(normalizeChartView())}>Скинути</button>
                </div>
            </div>
            <div className="med-series-settings">
                <fieldset>
                    <legend>Окремі {view.type === 'line' ? 'криві' : 'ряди'}</legend>
                    <div className="med-series-chips">{checks('visible')}</div>
                    <div className="med-series-shortcuts">
                        <button type="button" onClick={() => onChange({ ...view, visible: MEDICAL_SERIES.map(series => series.key) })}>Показати всі</button>
                        <button type="button" onClick={() => onChange({ ...view, visible: [] })}>Приховати окремі</button>
                    </div>
                </fieldset>
                <fieldset className="med-series-summary">
                    <legend><label><input type="checkbox" checked={view.showCombined} onChange={event => onChange({ ...view, showCombined: event.target.checked })} /> Зведення — сума обраних</label></legend>
                    <div className="med-series-chips">{checks('combined')}</div>
                    <div className="med-series-shortcuts">{presets.map(preset => <button key={preset.label} type="button" onClick={() => onChange({ ...view, showCombined: true, combined: [...preset.keys] })}>{preset.label}</button>)}</div>
                    {view.showCombined && !view.combined.length && <p className="med-chart-caption" role="status">Оберіть хоча б один тип для зведення.</p>}
                </fieldset>
            </div>
            <p className="med-chart-caption med-chart-note">Блакитний {view.type === 'line' ? 'пунктир' : 'ряд'} — сума обраних типів. Налаштування діють лише на цю діаграму; записи та звіти не змінюються.</p>
            {data.datasets.length && buckets.length ? <ChartComponent
                title={exportTitle} type={view.type} data={data} showLabels={showLabels} showPercentages={showPercentages}
                className="med-series-canvas"
                options={{
                    interaction: { mode: 'index', intersect: false },
                    plugins: { legend: { position: 'bottom' }, tooltip: { mode: 'index', intersect: false } },
                    scales: { x: { grid: { display: false }, ticks: { maxRotation: 45, autoSkip: true, maxTicksLimit: daily ? 16 : 24 } }, y: { beginAtZero: true, grace: '12%', ticks: { precision: 0 }, title: { display: true, text: 'Кількість епізодів' } } },
                }}
            /> : <div className="med-chart-empty" role="status">{buckets.length ? 'Оберіть окремі типи або увімкніть зведення, щоб побудувати діаграму.' : 'За вибраний період немає даних. Спробуйте змінити фільтри.'}</div>}
        </section>
    );
}
