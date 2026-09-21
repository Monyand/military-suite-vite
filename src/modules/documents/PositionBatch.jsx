import React, { useEffect, useRef, useState } from 'react';
import { DocumentJournal as D } from '../../core/documents.js';
import { POSITION_CATEGORIES } from './position-register.js';
import { preparePositionBatch } from './position-batch.js';

export function PositionBatch({ rows, busy, onApply }) {
    const [options, setOptions] = useState(() => ({ mode: 'create', date: window.SuiteDates.localISO(), category: 'Інші', docNumber: '', awaitingDoc: false, reportedInPbd: false, details: '', text: '' }));
    const [plan, setPlan] = useState(null);
    const [error, setError] = useState('');
    const [password, setPassword] = useState('');
    const [confirm, setConfirm] = useState('');
    const [acknowledged, setAcknowledged] = useState(false);
    const preview = useRef(null);
    useEffect(() => { if (plan) preview.current?.scrollIntoView({ block: 'nearest' }); }, [plan]);
    const change = patch => { setOptions({ ...options, ...patch }); setPlan(null); setError(''); setAcknowledged(false); };
    const stale = plan && plan.beforeSignature !== JSON.stringify(rows);
    const prepare = () => {
        try { setPlan(preparePositionBatch(rows, options)); setError(''); setAcknowledged(false); }
        catch (problem) { setError(problem.message); setPlan(null); }
    };
    const apply = async () => {
        if (!acknowledged || password.length < 12 || password !== confirm || stale) return;
        try { if (await onApply(plan, password)) { setPassword(''); setConfirm(''); } }
        catch (problem) { setError(problem.message); }
    };
    return <div className="space-y-4" data-testid="position-batch">
        <p className="text-sm text-slate-300">Вставте список із тексту або Excel. Кожен рядок стане окремим документальним записом. Наявні записи не перезаписуються; збереження пакета — лише після перевірки всього списку.</p>
        <fieldset disabled={busy} className="space-y-4">
            <div className="grid grid-cols-2 gap-2"><button type="button" aria-pressed={options.mode === 'create'} className={'dj-button justify-center ' + (options.mode === 'create' ? 'dj-primary' : '')} onClick={() => change({ mode: 'create' })}>Масове виставлення</button><button type="button" aria-pressed={options.mode === 'rename'} className={'dj-button justify-center ' + (options.mode === 'rename' ? 'dj-primary' : '')} onClick={() => change({ mode: 'rename' })}>Масове перейменування</button></div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <label className="text-sm space-y-1"><span>Дата здійсненої дії *</span><input aria-label="Дата пакета" type="date" max={window.SuiteDates.localISO()} value={options.date} onChange={event => change({ date: event.target.value })} className="dj-input w-full" /></label>
                <label className="text-sm space-y-1"><span>{options.mode === 'create' ? 'Загальна категорія' : 'Категорія, якщо раніше не вказана'}</span><select aria-label="Категорія пакета" value={options.category} onChange={event => change({ category: event.target.value })} className="dj-input w-full">{POSITION_CATEGORIES.map(category => <option key={category}>{category}</option>)}</select></label>
                <label className="text-sm space-y-1 sm:col-span-2"><span>№ Позатермінового донесення для пакета</span><input aria-label="Номер донесення пакета" maxLength={1000} value={options.docNumber} onChange={event => change({ docNumber: event.target.value })} className="dj-input w-full" /></label>
            </div>
            <div className="flex gap-4 flex-wrap text-xs"><label className="flex items-center gap-2 text-rose-200"><input type="checkbox" checked={options.awaitingDoc} onChange={event => change({ awaitingDoc: event.target.checked })} />Очікую номери донесень — зберегти без номера з червоним нагадуванням</label><label className="flex items-center gap-2"><input type="checkbox" checked={options.reportedInPbd} onChange={event => change({ reportedInPbd: event.target.checked })} />Подано в ПБД для всього пакета</label></div>
            <label className="block text-sm space-y-2"><span>{options.mode === 'create' ? 'Назви позицій — кожна з нового рядка' : 'Попередня назва → нова назва — кожна пара з нового рядка'}</span><textarea aria-label="Список документальних позицій" rows={8} value={options.text} onChange={event => change({ text: event.target.value })} className="dj-input w-full font-mono text-sm" placeholder={options.mode === 'create' ? 'Архів А\nАрхів Б\n\nАбо три колонки з Excel: назва, категорія, № донесення' : 'Архів А → Архів В\nАрхів Б → Архів Г\n\nАбо дві колонки з Excel через Tab'} /><span className="block text-xs text-slate-400">{options.mode === 'create' ? 'До 1000 рядків. Категорію та номер можна вказати окремо в другій і третій колонках через Tab. Однозначне попереднє облаштування продовжить ту саму історію.' : 'Назви перевіряються на обрану дату. Підтримуються Tab, → та =>. Взаємна заміна А → Б, Б → А зберігається одним пакетом.'}</span></label>
            <label className="block text-sm space-y-1"><span>Спільна примітка до документів</span><textarea aria-label="Примітка пакета" rows={2} maxLength={10000} value={options.details} onChange={event => change({ details: event.target.value })} className="dj-input w-full" /></label>
            <button type="button" onClick={prepare} className="dj-button dj-indigo">Перевірити список</button>
            {error && <p role="alert" className="text-rose-300">{error}</p>}
            {plan && <section ref={preview} className="space-y-3 rounded-xl border border-teal-800 bg-teal-950/10 p-4" data-testid="position-batch-preview">
                <h3 className="font-bold text-teal-200">Перевірено рядків: {plan.totalLines} · записів: {plan.records.length} · помилок: {plan.errors.length}</h3>
                {!!plan.errors.length && <><p className="text-rose-300 text-sm">Пакет не буде збережений частково. Спочатку виправте всі помилки.</p><ul className="max-h-48 overflow-auto text-sm text-rose-200 space-y-1">{plan.errors.map((item, index) => <li key={index}>Рядок {item.line}: {item.message}</li>)}</ul></>}
                <div className="overflow-auto max-h-72"><table className="dj-table text-xs"><thead><tr><th>Назва у документі</th>{options.mode === 'rename' && <th>Нова назва</th>}<th>Категорія</th><th>Дата / донесення</th></tr></thead><tbody>{plan.records.slice(0, 200).map(row => <tr key={row.id}><td>{row.name}</td>{options.mode === 'rename' && <td className="text-teal-300">{row.newName}</td>}<td>{row.category}</td><td>{D.dateLabel(row.date)}<div className={!D.hasDoc(row) ? 'text-rose-300' : 'text-slate-400'}>{D.hasDoc(row) ? '№ ' + row.docNumber : 'Очікується номер'}</div></td></tr>)}</tbody></table></div>
                {plan.records.length > 200 && <p className="text-xs text-slate-400">Показано перші 200 із {plan.records.length}; буде збережено весь перевірений пакет.</p>}
                {!plan.errors.length && !!plan.records.length && <><p className="text-xs text-slate-300">Перед внесенням буде створено повний захисний бекап AES-256-GCM. Пароль від 12 символів потрібен для відновлення; збережіть його окремо.</p><div className="grid sm:grid-cols-2 gap-3"><label className="text-sm">Пароль захисного бекапу<input aria-label="Пароль бекапу пакета" type="password" autoComplete="new-password" value={password} onChange={event => setPassword(event.target.value)} className="dj-input w-full mt-1" /></label><label className="text-sm">Повторіть пароль<input aria-label="Повтор пароля бекапу пакета" type="password" autoComplete="new-password" value={confirm} onChange={event => setConfirm(event.target.value)} className="dj-input w-full mt-1" /></label></div><label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={acknowledged} onChange={event => setAcknowledged(event.target.checked)} />Перевірив усі рядки та закрив інші вкладки програми. Підтверджую внесення документальних записів.</label>{stale && <p role="alert" className="text-amber-300">Записи змінилися. Натисніть «Перевірити список» повторно.</p>}<button type="button" disabled={stale || !acknowledged || password.length < 12 || password !== confirm} onClick={apply} className="dj-button dj-primary">Зберегти пакет: {plan.records.length} записів</button></>}
            </section>}
        </fieldset>
        {busy && <p role="status" className="text-amber-300">Створення захисної копії та збереження пакета… не закривайте програму.</p>}
    </div>;
}
