import React, { useRef, useState } from 'react';
import { DocumentJournal as D } from '../../core/documents.js';
import { useSharedDictionaries, useOvtTemplates } from '../../core/use-shared-dictionaries.js';
import { OVT_STATUSES, ovtTemplateOptions } from '../../core/ovt-templates.js';
import { OVT_IDENTIFIERS, OVT_REGISTRATIONS, prepareOvtDraft } from './ovt-form.js';
import { buildOvtReport } from './ovt-report.js';
import './ovt-form.css';

const lists = { nomenclature: 'models', taskText: 'tasks', routeText: 'routes', equipmentType: 'equipmentTypes', eventDescription: 'descriptions', consequence: 'consequences' };
export function OvtFields({ draft: source, setDraft, rows, modelOptions, busy }) {
    const options = useSharedDictionaries(), templates = useOvtTemplates();
    const draft = prepareOvtDraft(source), isTransport = draft.category === 'Транспорт';
    const preview = useRef(null), [message, setMessage] = useState('');
    const change = (key, value) => {
        setMessage('');
        const next = { ...draft, [key]: value };
        if (key === 'category' && value === 'Транспорт' && !OVT_STATUSES.includes(next.status)) next.status = 'ЗНИЩЕНО';
        if (['status', 'equipmentType'].includes(key) && draft[key] !== value && draft.consequence) {
            next.consequence = '';
            setMessage('Наслідок очищено: оберіть текст для нового статусу й типу транспорту.');
        }
        setDraft(prepareOvtDraft(next));
    };
    const field = (key, title, { type = 'text', choices, wide = false, required = false } = {}) => {
        if (choices === undefined) choices = key === 'position' ? options('docPlaces', rows.map(row => row.position), draft.position) : key === 'nomenclature' && !isTransport ? modelOptions : lists[key] ? ovtTemplateOptions(templates, lists[key], draft) : null;
        const id = 'ovt-field-' + key;
        return <label key={key} className={'ovt-field' + (wide ? ' ovt-wide' : '')}>
            <span>{title}{required ? ' *' : ''}</span>
            {type === 'select' ? <select aria-label={title} className="dj-input" disabled={busy} required={required} value={draft[key] || ''} onChange={event => change(key, event.target.value)}>
                {!choices.includes(draft[key]) && <option value={draft[key] || ''}>{draft[key] ? draft[key] + ' (старий статус — оберіть новий)' : 'Оберіть…'}</option>}
                {choices.map(item => <option key={item}>{item}</option>)}
            </select> : <><input aria-label={title} type={type} className="dj-input" disabled={busy} required={required} maxLength={1000} list={choices ? id : undefined} placeholder={lists[key] ? 'Виберіть або введіть власний варіант' : undefined} value={draft[key] || ''} onChange={event => change(key, event.target.value)} />
                {choices && <datalist id={id}>{choices.map(item => <option key={item} value={item} />)}</datalist>}</>}
        </label>;
    };
    const switchedField = (key, title, variants) => {
        const [valueKey, label] = variants[draft[key]];
        return <div className="ovt-field">
            <select aria-label={title} className="ovt-label-select" disabled={busy} value={draft[key]} onChange={event => change(key, event.target.value)}>{Object.entries(variants).map(([id, [, text]]) => <option value={id} key={id}>{text}</option>)}</select>
            <input aria-label={label} className="dj-input" disabled={busy} maxLength={1000} value={draft[valueKey] || ''} onChange={event => change(valueKey, event.target.value)} />
        </div>;
    };
    const hiddenIds = [
        ...(draft.identifierType === 'factory' ? [['Серійний номер / VIN', draft.serialNumber]] : [['Заводський номер', draft.factoryNumber]]),
        ...(draft.registrationType === 'board' ? [['Номер авто', draft.plateNumber]] : [['Бортовий номер', draft.boardNumber]]),
    ].filter(([, value]) => value);
    const legacyComment = isTransport && draft.comment && draft.comment !== draft.eventDescription;
    return <div className="ovt-workspace">
        <div className="ovt-fields-scroll">
            <div className="ovt-field-grid">
                {field('date', 'Дата', { type: 'date', required: true })}
                {field('time', 'Час', { type: 'time' })}
                {field('category', 'Категорія', { type: 'select', choices: D.schemas.ovt.fields.find(([key]) => key === 'category')[2] })}
                {field('status', 'Статус', { type: 'select', choices: isTransport ? OVT_STATUSES : D.schemas.ovt.fields.find(([key]) => key === 'status')[2] })}
                {isTransport && field('equipmentType', 'Тип транспорту', { wide: true })}
                {field('nomenclature', 'Номенклатура / Модель', { wide: true, required: true })}
                {switchedField('identifierType', 'Тип ідентифікатора', OVT_IDENTIFIERS)}
                {switchedField('registrationType', 'Тип реєстраційного номера', OVT_REGISTRATIONS)}
                {isTransport && field('taskText', 'Завдання', { wide: true })}
                <div className="ovt-wide ovt-location">
                    <div role="group" aria-label="Місце у документі" className="ovt-segments">{[['position', 'Позиція у документі'], ['route', 'Маршрут']].map(([value, label]) => <button key={value} type="button" disabled={busy} aria-pressed={draft.locationMode === value} onClick={() => change('locationMode', value)}>{label}</button>)}</div>
                    {draft.locationMode === 'route' ? field('routeText', 'Маршрут') : field('position', 'Позиція у документі')}
                </div>
                {isTransport ? <>
                    {field('eventDescription', 'Опис події', { wide: true })}
                    {field('coordinates', 'Координати події', { wide: true })}
                    {field('consequence', 'Наслідок', { wide: true })}
                </> : <label className="ovt-field ovt-wide"><span>Коментар / Причина</span><textarea aria-label="Коментар / Причина" className="dj-input" rows={3} disabled={busy} maxLength={10000} value={draft.comment || ''} onChange={event => change('comment', event.target.value)} /></label>}
                {field('urgentDocNo', '№ позатермінового донесення')}
                <label className="ovt-checkbox"><input aria-label="Подія з поміткою *" type="checkbox" disabled={busy} checked={!!draft.isEvent} onChange={event => change('isEvent', event.target.checked)} /> Подія з поміткою *</label>
            </div>
            {!!(hiddenIds.length || legacyComment) && <details className="ovt-legacy"><summary>Додаткові раніше збережені дані</summary><p>Збережені без видалення. У донесення входять лише вибрані вище номери.</p>{hiddenIds.map(([label, value]) => <p key={label}>{label}: {value}</p>)}{legacyComment && <label>Попередній коментар<textarea aria-label="Попередній коментар" className="dj-input" rows={2} value={draft.comment} disabled={busy} onChange={event => change('comment', event.target.value)} /></label>}</details>}
        </div>
        <aside className="ovt-preview">
            <div className="ovt-preview-heading"><div><span className="ovt-eyebrow">ПОЗАТЕРМІНОВЕ ДОНЕСЕННЯ</span><h3>Попередній перегляд</h3></div><span className="ovt-live">● Наживо</span></div>
            <textarea ref={preview} aria-label="Попередній перегляд донесення" readOnly value={buildOvtReport(draft)} />
            <p className="ovt-help">Текст змінюється разом із полями. Квадратні дужки позначають пропущені відомості.</p>
            {isTransport && <p className="ovt-help">Власні моделі й фрази запам’ятовуються після збереження за типом транспорту. Статус впливає тільки на наслідок. Номери й координати в шаблони не записуються.</p>}
            {message && <p role="status" className="ovt-message">{message}</p>}
            <button type="button" className="dj-button dj-indigo" onClick={async () => {
                try { await navigator.clipboard.writeText(buildOvtReport(draft)); setMessage('Текст скопійовано.'); }
                catch { preview.current?.focus(); preview.current?.select(); setMessage('Натисніть Ctrl+C — текст виділено.'); }
            }}>Копіювати текст</button>
        </aside>
    </div>;
}
