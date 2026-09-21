import React from 'react';
import { DocumentJournal as D } from '../../core/documents.js';

export function PositionHistory({ row, register, audit, onEdit }) {
    const link = register.links.get(row.id) || row.positionId;
    const entry = register.entries.find(item => item.id === link);
    const records = entry?.records || [row];
    const edits = audit.filter(item => (link && item.positionId === link) || records.some(record => record.id === item.recordId));
    const fields = D.schemas.positions.fields.filter(([key]) => key !== 'positionId');
    return <div className="space-y-5" data-testid="position-history">
        <div className="rounded-xl border border-slate-700 bg-slate-900 p-4 space-y-2">
            <h3 className="text-lg font-bold text-emerald-300 break-words">{entry?.name || row.name}</h3>
            <p className="text-xs text-slate-400">Історія документів за весь час — незалежно від поточних фільтрів.</p>
            {entry ? <><p className="text-sm">Остання документальна дія: <b>{entry.status}</b> · {D.dateLabel(entry.date)}</p><p className="text-xs text-slate-400 break-words">Назви в історії: {entry.aliases.join(' → ')}</p>{!entry.established && <p className="text-amber-200 text-xs">Історія облаштування. Документ виставлення ще не внесений.</p>}</> : <p className="text-amber-300 text-sm">Запис поки не пов’язаний із виставленням або окремою історією облаштування. Інші записи з подібною назвою не приєднано автоматично.</p>}
        </div>
        <ol className="space-y-3 border-l-2 border-emerald-800 ml-2 pl-5">{records.map(record => <li key={record.id} className="relative rounded-xl border border-slate-800 bg-slate-900/50 p-4 space-y-2">
            <span className="absolute -left-7 top-5 w-3 h-3 rounded-full bg-emerald-400 border-2 border-slate-950" />
            <div className="flex justify-between gap-3 flex-wrap"><div><span className="font-mono text-xs text-slate-400">{D.dateLabel(record.date)}</span><h4 className="font-bold">{record.status}{(record.status === 'перейменована' || record.newName) && `: ${record.name} → ${record.newName || 'нова назва не вказана'}`}</h4></div><button className="dj-button" onClick={() => onEdit(record)}>Редагувати запис</button></div>
            {record.destinationPositionId && <p className="text-sm text-cyan-200">На місце позиції: {record.destinationName || record.destinationPositionId} (назва за цим документом)</p>}
            {record.renameBatchId && <p className="text-xs text-teal-300">Частина пакета перейменування</p>}
            <p className={`text-sm ${D.hasDoc(record) ? 'text-indigo-300' : 'text-rose-300 font-bold'}`}>{D.hasDoc(record) ? `Позатермінове № ${record.docNumber}` : '⚠ Очікується номер позатермінового донесення'}</p>
            <p className="text-xs text-slate-400">{record.category || 'Категорію не визначено'} · {record.reportedInPbd ? 'Подано в ПБД' : 'Не подано в ПБД'}</p>
            {record.details && <p className="text-sm whitespace-pre-wrap break-words">{record.details}</p>}
            {register.issues.has(record.id) && <p className="text-amber-300 text-xs">Потребує звірки: {register.issues.get(record.id)}</p>}
        </li>)}</ol>
        <details className="border-t border-slate-800 pt-4">
            <summary className="cursor-pointer text-sm text-slate-300">Журнал виправлень і видалень ({edits.length})</summary>
            <p className="text-xs text-slate-500 mt-2">Фіксується з моменту цього оновлення; попередні виправлення відновити неможливо.</p>
            <ul className="space-y-3 mt-3">{edits.slice().reverse().map(item => <li key={item.id} className="text-xs rounded-lg bg-slate-900 p-3 space-y-1"><p className="text-slate-400">{new Date(item.at).toLocaleString('uk-UA')} · {item.before && item.after ? 'Виправлення запису' : item.after ? 'Додано до журналу' : 'Видалення запису'}</p>{fields.filter(([key]) => JSON.stringify(item.before?.[key] ?? '') !== JSON.stringify(item.after?.[key] ?? '')).map(([key, title, type]) => {
                const label = value => type === 'checkbox' ? (value ? 'Так' : 'Ні') : (value || '—');
                return <p key={key} className="break-words"><b>{title}:</b> {label(item.before?.[key])} → {label(item.after?.[key])}</p>;
            })}</li>)}</ul>
        </details>
    </div>;
}
