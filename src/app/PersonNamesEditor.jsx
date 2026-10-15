import { useEffect, useMemo, useState } from 'react';
import { inventoryPersonNames, duplicateNameGroups, planPersonNames, normalizePersonName, formatPersonName, planPersonNameFormatting } from '../core/person-names.js';
import { SharedDictionaries } from '../core/dictionary-service.js';
import { SuiteBackup } from '../core/backup.js';

const slotKey = item => `${item.storage}/${item.key}/${item.path}`;
export function PersonNamesEditor({ onBusyChange, onPendingChange, onSuspend, onApplied, onError }) {
    const [snapshot, setSnapshot] = useState(null), [error, setError] = useState(''), [search, setSearch] = useState('');
    const [selected, setSelected] = useState([]), [target, setTarget] = useState(''), [plan, setPlan] = useState(null);
    const [password, setPassword] = useState(''), [confirmation, setConfirmation] = useState(''), [ack, setAck] = useState(false);
    const [busy, setBusy] = useState(false), [showAll, setShowAll] = useState(false), [ignored, setIgnored] = useState([]);
    const invoke = async action => { if (busy) return; setBusy(true); onBusyChange(true); setError(''); try { await action(); } catch (failure) { setError(failure.message); onError(failure.message); } finally { setBusy(false); onBusyChange(false); } };
    const refresh = () => invoke(async () => { await window.SuiteRuntime.drain(); const next = await SuiteBackup.collect(); inventoryPersonNames(next); setSnapshot(next); setPlan(null); setSelected([]); setTarget(''); });
    useEffect(() => { refresh(); }, []);
    useEffect(() => { onPendingChange(!!selected.length || !!target || !!plan); return () => onPendingChange(false); }, [selected, target, plan]);
    const items = useMemo(() => snapshot ? inventoryPersonNames(snapshot) : [], [snapshot]);
    const formatCount = useMemo(() => items.filter(item => item.value !== formatPersonName(item.value)).length, [items]);
    const groups = useMemo(() => duplicateNameGroups(items).filter(group => new Set(group.entries.map(item => formatPersonName(item.value))).size > 1), [items]);
    const visible = (showAll ? [{ key: 'all', entries: items }] : groups).filter(group => !ignored.includes(group.key) && group.entries.some(item => normalizePersonName(item.value).includes(normalizePersonName(search))));
    const toggle = key => { setSelected(value => value.includes(key) ? value.filter(item => item !== key) : [...value, key]); setPlan(null); };
    return <section className="sd-card">
        <h3>Єдиний формат ПІБ для всієї бази</h3>
        <p>Прізвище — ВЕЛИКИМИ ЛІТЕРАМИ, ім’я та по батькові — з великої. Наприклад: «Петренко ІВАН ПЕТРОВИЧ» → «ПЕТРЕНКО Іван Петрович».</p>
        <p className="sd-note">Одна масова операція без вибору кожного військовослужбовця. Однакові ПІБ з різним регістром отримають однакове написання. Прізвищем вважається перше слово; складене прізвище через дефіс теж буде великими літерами. Букви й порядок слів не виправляються, анкети не об’єднуються, ID та зв’язки з подіями зберігаються.</p>
        <details className="sd-note"><summary>Де зміняться ПІБ</summary><p>Журнал О/С, медичні анкети, ПІБ у знімках епізодів, старі структуровані медичні записи та іменні поля реєстру подій. Довільні коментарі, тексти старих доповідей, журнали аудиту й резервні копії не переписуються.</p></details>
        {error && <p className="sd-notice" role="alert">{error}</p>}
        <fieldset disabled={busy}>
            <div className="sd-actions"><button className="sd-primary" disabled={!snapshot || !formatCount} onClick={() => invoke(async () => { const next = planPersonNameFormatting(snapshot); setSelected([]); setTarget(''); setPlan({ ...next, automatic: true }); setAck(false); })}>Стандартизувати всі ПІБ</button><button onClick={refresh}>Оновити пошук ПІБ</button></div>
            {snapshot && <p role="status">Перевірено {items.length} полів ПІБ. {formatCount ? `Потребують форматування: ${formatCount}.` : 'Усі ПІБ уже мають єдиний формат.'} Неоднозначних груп для ручної перевірки: {groups.length}.</p>}
            <details><summary>Неоднозначні збіги та ручне виправлення ({groups.length})</summary>
            <p className="sd-note">Тут лише написання, що відрізняються не тільки регістром або пробілами. Схожі ПІБ знайдено за алгоритмом «Додатка 6», але вони можуть належати різним людям. Оберіть потрібні записи лише якщо хочете виправити самі літери або склад ПІБ.</p>
            <label>Пошук ПІБ<input value={search} onChange={event => setSearch(event.target.value)} /></label>
            <label className="sd-check"><input type="checkbox" checked={showAll} onChange={event => setShowAll(event.target.checked)} />Показати всі імена для ручної стандартизації</label>
            <div style={{ maxHeight: '42vh', overflow: 'auto' }}>{visible.slice(0, 100).map(group => <section className="sd-card" key={group.key}>
                <div className="sd-actions"><strong>{group.entries[0]?.value}</strong><button onClick={() => { setSelected(value => [...new Set([...value, ...group.entries.map(slotKey)])]); setPlan(null); }}>Обрати всю групу</button>{!showAll && <button onClick={() => setIgnored(value => [...value, group.key])}>Пропустити групу</button>}</div>
                {group.entries.map(item => <label key={slotKey(item)} className="sd-check"><input type="checkbox" checked={selected.includes(slotKey(item))} onChange={() => toggle(slotKey(item))} /><span>{item.value}<small style={{ display: 'block' }}>{item.module} · {item.callsign || 'без позивного'} · {item.unit || 'без підрозділу'} · ID: {item.personId} · {item.key}/{item.path}</small></span><button type="button" onClick={event => { event.preventDefault(); setTarget(formatPersonName(item.value)); setPlan(null); }}>Як стандарт</button></label>)}
            </section>)}</div>
            {visible.length > 100 && <p>Показано перші 100 груп. Уточніть пошук.</p>}
            {ignored.length > 0 && <button onClick={() => setIgnored([])}>Повернути пропущені групи ({ignored.length})</button>}
            <label>Стандартне ПІБ<input value={target} onChange={event => { setTarget(event.target.value); setPlan(null); }} placeholder="ПРІЗВИЩЕ Ім’я По батькові" /></label>
            <div className="sd-actions"><span>Обрано полів: {selected.length}</span><button onClick={() => { setSelected([]); setPlan(null); }}>Зняти вибір</button><button className="sd-primary" onClick={() => invoke(async () => { const next = planPersonNames(snapshot, selected, target); if (!next.changes.length) throw new Error('Написання вже однакові. ID не об’єднуються.'); setPlan(next); setAck(false); })}>Переглянути заміни ПІБ</button></div>
            </details>
            {plan && <section className="sd-card"><h3>Буде змінено {plan.changes.length} полів</h3>
                {plan.automatic && <p>Усі зміни застосуються разом. Підтверджувати кожен ПІБ окремо не потрібно. Перед записом автоматично створиться зашифрована захисна копія.</p>}
                <details open={!plan.automatic}><summary>{plan.automatic ? `Приклади замін (перші ${Math.min(plan.changes.length, 50)} із ${plan.changes.length})` : 'Усі вибрані заміни'}</summary><div className="sd-list">{(plan.automatic ? plan.changes.slice(0, 50) : plan.changes).map(change => <p key={change.storage + change.key + change.path}>{change.module}: {change.before} → <strong>{change.after}</strong></p>)}</div></details>
                <label>Пароль захисної копії<input type="password" value={password} onChange={event => setPassword(event.target.value)} /></label><label>Повторіть пароль<input type="password" value={confirmation} onChange={event => setConfirmation(event.target.value)} /></label>
                <label className="sd-check"><input type="checkbox" checked={ack} onChange={event => setAck(event.target.checked)} />{plan.automatic ? 'Підтверджую масове форматування ПІБ. Інші вкладки програми закриті.' : 'Перевірив вибрані записи й закрив інші вкладки програми.'} Після заміни потрібне перезавантаження.</label>
                <button className="sd-danger" disabled={!ack || password.length < 12 || password !== confirmation} onClick={() => invoke(async () => { const recovery = await SharedDictionaries.apply(plan, password, onSuspend); onApplied(recovery); })}>{plan.automatic ? 'Застосувати до всієї бази' : 'Захисна копія й заміна ПІБ'}</button>
            </section>}
        </fieldset>
    </section>;
}
