import React from 'react';
import { DocumentJournal as D } from '../../core/documents.js';

export function PositionHistory({ row, register, audit, onEdit }) {
    const link = register.links.get(row.id) || row.positionId;
    const entry = register.entries.find(item => item.id === link);
    const records = entry?.records || [row];
    const edits = audit.filter(item => (link && item.positionId === link) || records.some(record => record.id === item.recordId));
    const fields = D.schemas.positions.fields.filter(([key]) => key !== 'positionId');
    return <div className="space-y-4" data-testid="position-history">
        <div className="rounded-sm border border-[#2e3138] bg-[#101113] p-4 space-y-1.5">
            <h3 className="text-base font-bold text-[#f3f4f6] break-words">{entry?.name || row.name}</h3>
            <p className="text-xs text-[#b8bec8]">Історія документів за весь час — незалежно від поточних фільтрів.</p>
            {entry ? <><p className="text-sm text-[#cbd5e1] tabular-nums">Остання документальна дія: <b className="text-[#f3f4f6]">{entry.status}</b> · {D.dateLabel(entry.date)}</p><p className="text-xs text-[#b8bec8] break-words">Назви в історії: {entry.aliases.join(' → ')}</p>{!entry.established && <p className="text-[#d99b26] text-xs">Історія облаштування. Документ виставлення ще не внесений.</p>}</> : <p className="text-[#d99b26] text-sm">Запис поки не пов’язаний із виставленням або окремою історією облаштування. Інші записи з подібною назвою не приєднано автоматично.</p>}
        </div>
        <ol className="space-y-3 border-l border-[#2e3138] ml-2 pl-4">{records.map(record => <li key={record.id} className="relative rounded-sm border border-[#2e3138] bg-[#101113] p-3.5 space-y-1.5">
            <span className="absolute -left-[21px] top-4 w-2 h-2 bg-[#4c8ed9]" aria-hidden="true" />
            <div className="flex justify-between gap-3 flex-wrap"><div><span className="font-mono text-xs text-[#b8bec8] tabular-nums">{D.dateLabel(record.date)}</span><h4 className="font-semibold text-[#f3f4f6]">{record.status}{(record.status === 'перейменована' || record.newName) && `: ${record.name} → ${record.newName || 'нова назва не вказана'}`}</h4></div><button className="dj-button" onClick={() => onEdit(record)}>Редагувати запис</button></div>
            {record.destinationPositionId && <p className="text-sm text-[#4c8ed9]">На місце позиції: {record.destinationName || record.destinationPositionId} (назва за цим документом)</p>}
            {record.renameBatchId && <p className="text-xs text-[#b8bec8]">Частина пакета перейменування</p>}
            <p className={`text-sm font-mono tabular-nums ${D.hasDoc(record) ? 'text-[#cbd5e1]' : 'text-[#f3a3a0] font-bold'}`}>{D.hasDoc(record) ? `Позатермінове № ${record.docNumber}` : 'Очікується номер позатермінового донесення'}</p>
            <p className="text-xs text-[#b8bec8]">{record.category || 'Категорію не визначено'} · {record.reportedInPbd ? 'Подано в ПБД' : 'Не подано в ПБД'}</p>
            {record.details && <p className="text-sm text-[#cbd5e1] whitespace-pre-wrap break-words">{record.details}</p>}
            {register.issues.has(record.id) && <p className="text-[#d99b26] text-xs">Потребує звірки: {register.issues.get(record.id)}</p>}
        </li>)}</ol>
        <details className="border-t border-[#2e3138] pt-3">
            <summary className="cursor-pointer text-sm text-[#cbd5e1] tabular-nums">Журнал виправлень і видалень ({edits.length})</summary>
            <p className="text-xs text-[#989fa9] mt-2">Фіксується з моменту цього оновлення; попередні виправлення відновити неможливо.</p>
            <ul className="space-y-2 mt-3">{edits.slice().reverse().map(item => <li key={item.id} className="text-xs rounded-sm border border-[#2e3138] bg-[#101113] p-3 space-y-1"><p className="text-[#b8bec8] tabular-nums">{new Date(item.at).toLocaleString('uk-UA')} · {item.before && item.after ? 'Виправлення запису' : item.after ? 'Додано до журналу' : 'Видалення запису'}</p>{fields.filter(([key]) => JSON.stringify(item.before?.[key] ?? '') !== JSON.stringify(item.after?.[key] ?? '')).map(([key, title, type]) => {
                const label = value => type === 'checkbox' ? (value ? 'Так' : 'Ні') : (value || '—');
                return <p key={key} className="break-words text-[#f3f4f6]"><b>{title}:</b> {label(item.before?.[key])} → {label(item.after?.[key])}</p>;
            })}</li>)}</ul>
        </details>
    </div>;
}
