import React, { useEffect, useRef, useState } from 'react';
import { chronologyIssues, localMedicalInput, parseMedicalDate } from '../../core/medical-records.js';

function ReviewDialog({ title, children, onClose }) {
    const panel = useRef(null);
    useEffect(() => { const before = document.activeElement; panel.current?.focus(); return () => { if (before?.isConnected) before.focus(); }; }, []);
    return <div className="sd-overlay" style={{ zIndex: 22010 }} onKeyDown={event => {
        event.stopPropagation();
        if (event.key === 'Escape') onClose();
        if (event.key === 'Tab') {
            const fields = [...panel.current.querySelectorAll('button,input,select')].filter(node => !node.disabled);
            if (event.shiftKey && [panel.current, fields[0]].includes(document.activeElement)) { event.preventDefault(); fields.at(-1)?.focus(); }
            else if (!event.shiftKey && document.activeElement === fields.at(-1)) { event.preventDefault(); fields[0]?.focus(); }
        }
    }}><section ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-label={title} className="sd-panel" style={{ maxWidth: 920 }}>
        <header className="sd-header"><h2>{title}</h2><button type="button" onClick={onClose}>Закрити</button></header>
        <div className="sd-main" style={{ overflow: 'auto', padding: 20 }}>{children}</div>
    </section></div>;
}

export function StatusHistoryChainBadge({ episodes = [], onReview }) {
    const ordered = [...episodes].sort((a, b) => parseMedicalDate(a.date) - parseMedicalDate(b.date));
    const issues = chronologyIssues(ordered);
    if (ordered.length < 2 && !issues.length) return null;
    const chain = [];
    ordered.forEach(ep => {
        const label = ep.lossType || 'Невідомо';
        if (chain.at(-1)?.label === label) chain.at(-1).count++;
        else chain.push({ label, count: 1 });
    });
    const text = chain.map(item => item.label + (item.count > 1 ? ` ×${item.count}` : '')).join(' → ');
    return <button type="button" onClick={event => { event.stopPropagation(); onReview?.(); }} title={text + (issues.length ? '. Натисніть, щоб перевірити дати.' : '. Історія дат подій.')}
        className={'text-[10px] border rounded px-2 py-1 text-left ' + (issues.length ? 'text-rose-200 bg-rose-950 border-rose-500 animate-pulse' : 'text-amber-300 bg-amber-950/70 border-amber-700')}>
        {issues.length ? '⚠ Помилка дат · ' : '↳ '}{text}
    </button>;
}

export function ChronologyDialog({ review, onApply, onClose }) {
    const [dates, setDates] = useState(() => Object.fromEntries(review.rows.map(row => [row.id, localMedicalInput(row.date)])));
    const [error, setError] = useState('');
    const proposed = review.rows.map(row => ({ ...row, date: dates[row.id] }));
    const issues = chronologyIssues(proposed);
    return <ReviewDialog title="Перевірка хронології" onClose={onClose}>
        <p className="sd-note">{review.name}. Давніше поранення можна додати після реєстрації загибелі, якщо дата самого поранення не пізніша за загибель. Перевірте документи й виправте потрібну дату — програма не змінює її автоматично.</p>
        {issues.length > 0 && <p role="alert" className="sd-notice">{issues.map(issue => `${issue.episode.lossType}: ${issue.message}`).join('; ')}</p>}
        {error && <p role="alert" className="sd-notice">{error}</p>}
        <div className="sd-list">{review.rows.map(row => <label key={row.id} className="sd-card">
            <span>{row.id === '__draft' ? 'Нова подія — ' : ''}{row.lossType}</span>
            <small>Було: {String(row.date || 'дата відсутня')}</small>
            <input aria-label={'Дата ' + row.id} type="datetime-local" value={dates[row.id]} onChange={event => setDates({ ...dates, [row.id]: event.target.value })} />
        </label>)}</div>
        <p className="sd-note">Зміни дат наявних записів зберігаються окремо з записом у журналі. Якщо відкрита форма нової події — після виправлення її потрібно зберегти.</p>
        <button type="button" className="sd-primary" disabled={issues.length > 0} onClick={() => {
            try {
                const changed = Object.fromEntries(review.rows.filter(row => dates[row.id] !== localMedicalInput(row.date)).map(row => [row.id, dates[row.id]]));
                onApply(changed);
            } catch (failure) { setError(failure.message); }
        }}>Застосувати виправлення дат</button>
    </ReviewDialog>;
}

export function PersonMatchDialog({ candidates, onChoose, onSeparate, onClose }) {
    return <ReviewDialog title="Можливий повторний запис військовослужбовця" onClose={onClose}>
        <p className="sd-note">Ви ввели дані вручну, але в базі є збіги. Перевірте ПІБ, позивний та підрозділ. Схожість не доводить, що це одна людина.</p>
        <div className="sd-list">{candidates.map(person => <div className="sd-card" key={person.source + ':' + person.id}>
            <strong>{person.name}</strong><p>{person.callsign || 'Без позивного'} · {person.unit || 'Підрозділ не вказано'} · {person.rank || 'Звання не вказано'}</p>
            <small>{person.source === 'roster' ? 'Журнал О/С' : 'Медична база'} · ID: {person.id}</small>
            <button type="button" onClick={() => onChoose(person)}>Це цей військовослужбовець</button>
        </div>)}</div>
        <button type="button" onClick={() => { if (window.confirm('Підтверджуєте, що це інша людина і потрібна окрема анкета?')) onSeparate(); }}>Це інша людина — створити окрему анкету</button>
    </ReviewDialog>;
}
