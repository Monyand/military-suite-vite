import { useEffect, useMemo, useRef, useState } from 'react';
import { SharedDictionaries } from '../core/dictionary-service.js';
import { DICTIONARY_KINDS, emptyDictionaries, addRules, parseReplacementPairs, validateDictionaries, inventoryLabels, normalizeLabel } from '../core/shared-dictionaries.js';
import { SuiteBackup } from '../core/backup.js';
import { OvtTemplatesEditor } from './OvtTemplatesEditor.jsx';
import { PersonNamesEditor } from './PersonNamesEditor.jsx';
import './shared-dictionaries.css';

const lines = text => text.split(/\r?\n/).map(value => value.trim()).filter(Boolean);
const titles = Object.fromEntries(DICTIONARY_KINDS);

export function SharedDictionariesPanel({ onClose, onSuspend }) {
    const [config, setConfig] = useState(emptyDictionaries);
    const [snapshot, setSnapshot] = useState(null);
    const [kind, setKind] = useState('units');
    const [dirty, setDirty] = useState(false);
    const [templatePending, setTemplatePending] = useState(false);
    const [busy, setBusy] = useState(false);
    const [fatal, setFatal] = useState(false);
    const [message, setMessage] = useState('');
    const [standards, setStandards] = useState('');
    const [sources, setSources] = useState('');
    const [target, setTarget] = useState('');
    const [pairs, setPairs] = useState('');
    const [mode, setMode] = useState('many');
    const [search, setSearch] = useState('');
    const [unknownOnly, setUnknownOnly] = useState(true);
    const [mixed, setMixed] = useState(false);
    const [plan, setPlan] = useState(null);
    const [password, setPassword] = useState('');
    const [confirm, setConfirm] = useState('');
    const [acknowledged, setAcknowledged] = useState(false);
    const [suspended, setSuspended] = useState(false);
    const [recovery, setRecovery] = useState(null);
    const lock = useRef(false);
    const panel = useRef(null);
    const previewPanel = useRef(null);
    useEffect(() => { if (plan) previewPanel.current?.scrollIntoView({ block: 'start' }); }, [plan]);
    const invoke = async operation => {
        if (lock.current) return;
        lock.current = true; setBusy(true); setMessage('');
        try { await operation(); } catch (error) { setMessage(error.message || 'Не вдалося виконати дію.'); }
        finally { lock.current = false; setBusy(false); }
    };
    useEffect(() => {
        let active = true;
        (async () => {
            setBusy(true);
            try {
                const saved = SharedDictionaries.read();
                const state = await SharedDictionaries.inspect(saved);
                if (active) { setConfig(saved); setSnapshot(state.snapshot); }
            } catch (error) { if (active) { setMessage(error.message); setFatal(true); } }
            finally { if (active) setBusy(false); }
        })();
        panel.current?.focus();
        return () => { active = false; };
    }, []);
    const close = () => {
        if (busy || suspended) return;
        if ((dirty || templatePending || standards.trim() || sources.trim() || pairs.trim()) && !window.confirm('Закрити довідники без збереження незастосованих змін?')) return;
        onClose();
    };
    const onKeyDown = event => {
        if (event.key === 'Escape') { event.stopPropagation(); close(); }
        if (event.key !== 'Tab') return;
        const fields = [...panel.current.querySelectorAll('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled)')].filter(node => node.getClientRects().length);
        const first = fields[0], last = fields.at(-1);
        if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && (document.activeElement === last || document.activeElement === panel.current)) { event.preventDefault(); first?.focus(); }
    };
    const { inventory, inventoryError } = useMemo(() => {
        const empty = Object.fromEntries(DICTIONARY_KINDS.map(([key]) => [key, []]));
        try { return { inventory: snapshot ? inventoryLabels(snapshot, config, mixed) : empty, inventoryError: '' }; }
        catch (error) { return { inventory: empty, inventoryError: error.message }; }
    }, [snapshot, config, mixed]);
    const dictionary = config.dictionaries[kind];
    const observed = (inventory[kind] || []).filter(item => (!unknownOnly || !item.canonical) && normalizeLabel(item.value).includes(normalizeLabel(search)));
    const unknownCount = (inventory[kind] || []).filter(item => !item.canonical).length;
    const legacyPlaces = snapshot?.localforage?.med_settings_v3?.sectors || [];
    const edit = next => { setConfig(validateDictionaries(next)); setDirty(true); setPlan(null); setMessage(''); };
    const addStandards = names => {
        if (!names.length) throw new Error('Введіть назви: кожна з нового рядка.');
        const next = structuredClone(config);
        for (const name of names) {
            const alias = next.dictionaries[kind].aliases.find(rule => normalizeLabel(rule.from) === normalizeLabel(name));
            if (alias && normalizeLabel(alias.to) !== normalizeLabel(name)) throw new Error('«' + name + '» уже є варіантом іншої назви. Спершу видаліть правило.');
            if (!next.dictionaries[kind].canonical.some(value => normalizeLabel(value) === normalizeLabel(name))) next.dictionaries[kind].canonical.push(name);
        }
        edit(next);
    };
    const addMappings = () => invoke(() => {
        const rules = mode === 'pairs' ? parseReplacementPairs(pairs) : lines(sources).map(from => ({ from, to: target.trim() }));
        if (!rules.length) throw new Error('Вставте варіанти назв.');
        edit(addRules(config, kind, rules)); setSources(''); setTarget(''); setPairs('');
    });
    const save = () => invoke(async () => {
        if (templatePending) throw new Error('Спочатку натисніть «Додати» для введених шаблонів ОВТ.');
        await SharedDictionaries.save(config); setDirty(false); setPlan(null);
        setSnapshot((await SharedDictionaries.inspect(config, mixed)).snapshot);
        setMessage('Довідники збережено. Підказки оновлено в усіх підключених формах. Записи не переписувалися.');
    });
    const preview = kinds => invoke(async () => {
        if (templatePending) throw new Error('Спочатку додайте введені шаблони ОВТ.');
        if (standards.trim() || sources.trim() || pairs.trim()) throw new Error('Спочатку натисніть «Додати назви» або «Додати правила» для введеного тексту.');
        const next = await SharedDictionaries.preview(config, kinds, mixed);
        setPlan(next); setAcknowledged(false); setPassword(''); setConfirm('');
        if (!next.changes.length) setMessage('Збігів для виправлення немає. Збережіть довідники окремою кнопкою, якщо змінювали правила.');
    });
    const apply = () => invoke(async () => {
        if (!acknowledged) throw new Error('Підтвердьте перевірку змін і закриття інших вкладок.');
        if (password !== confirm) throw new Error('Паролі не збігаються.');
        const copy = await SharedDictionaries.apply(plan, password, () => { setSuspended(true); onSuspend(); });
        setRecovery(copy); setDirty(false); setPassword(''); setConfirm('');
        setMessage('Масове виправлення завершено. Попередній стан збережено зашифрованим у браузері. Завантажте захисну копію та перезавантажте програму. Для відновлення: «Відновити бекап» → «Попередній стан», із заданим тут паролем.');
        try { SuiteBackup.download(copy, 'before_dictionary_correction'); } catch { /* Persistent encrypted recovery is already saved. */ }
    });
    return <div className="sd-overlay" onKeyDown={onKeyDown}>
        <section ref={panel} tabIndex={-1} className="sd-panel" role="dialog" aria-modal="true" aria-labelledby="sd-title">
            <header className="sd-header"><div><div className="sd-eyebrow">ЄДИНИЙ СТАНДАРТ НАПИСАННЯ</div><h2 id="sd-title">Спільні довідники</h2><p>Підказки для форм · перевірка назв · контрольоване виправлення документів</p></div><button type="button" disabled={busy || suspended} onClick={close} aria-label="Закрити спільні довідники">Закрити ✕</button></header>
            <div className="sd-layout">
                <nav aria-label="Розділи спільних довідників">{DICTIONARY_KINDS.map(([key, title]) => <button type="button" key={key} aria-pressed={key === kind} disabled={busy || suspended} onClick={() => {
                    if ((templatePending || standards.trim() || sources.trim() || pairs.trim()) && !window.confirm('Очистити ще не доданий текст і перейти до іншого розділу?')) return;
                    setKind(key); setStandards(''); setSources(''); setPairs(''); setTarget(''); setSearch(''); setPlan(null); setMessage('');
                }}><span>{title}</span><small>{config.dictionaries[key].canonical.length} стандартів · {inventory[key].filter(item => !item.canonical).length} невідомих</small></button>)}
                    <button type="button" aria-pressed={kind === 'ovtTemplates'} disabled={busy || suspended} onClick={() => {
                        if ((templatePending || standards.trim() || sources.trim() || pairs.trim()) && !window.confirm('Очистити ще не доданий текст і перейти до шаблонів ОВТ?')) return;
                        setKind('ovtTemplates'); setStandards(''); setSources(''); setPairs(''); setTarget(''); setPlan(null); setMessage('');
                    }}><span>Шаблони ОВТ</span><small>Завдання · маршрут · тип · подія · наслідок</small></button>
                    <button type="button" aria-pressed={kind === 'names'} disabled={busy || suspended} onClick={() => {
                        if (dirty || templatePending || standards.trim() || sources.trim() || pairs.trim()) { setMessage('Спочатку збережіть або скасуйте незастосовані зміни довідників.'); return; }
                        setKind('names'); setPlan(null); setMessage('');
                    }}><span>ПІБ і дублікати</span><small>Усі модулі · перевірка збігів · стандартне написання</small></button>
                    <p className="sd-note">Підказки документальних назв беруться з останніх незакритих історій у «Статусі позицій». Старі назви залишаються в документах та історії. Це не підтвердження фактичного стану.</p>
                </nav>
                <main className="sd-main">
                    {(message || inventoryError) && <p role="alert" className="sd-notice">{message || inventoryError}</p>}
                    {busy && <p role="status">Обробка… не закривайте програму.</p>}
                    {suspended ? <div className="sd-card"><h3>{recovery ? 'Зміни збережено' : 'Запис даних призупинено'}</h3><p>Модулі зупинені, щоб старий відкритий стан не перезаписав дані. Після завершення операції потрібно перезавантаження.</p>{!busy && <div className="sd-actions">{recovery && <button onClick={() => SuiteBackup.download(recovery, 'before_dictionary_correction')}>Завантажити захисну копію</button>}<button className="sd-primary" onClick={() => location.reload()}>Перезавантажити програму</button></div>}</div> : !fatal && <fieldset disabled={busy}>
                        <div hidden={kind !== 'ovtTemplates'}><OvtTemplatesEditor value={config.ovtTemplates} onChange={ovtTemplates => edit({ ...config, ovtTemplates })} onPendingChange={setTemplatePending} /></div>
                        {kind === 'names' && <PersonNamesEditor onError={setMessage} onBusyChange={setBusy} onPendingChange={setTemplatePending} onSuspend={() => { setSuspended(true); onSuspend(); }} onApplied={copy => {
                            setRecovery(copy); setDirty(false); setTemplatePending(false);
                            setMessage('ПІБ стандартизовано. ID та зв’язки з подіями збережено. Попередній стан збережено зашифрованим; завантажте захисну копію й перезавантажте програму.');
                            try { SuiteBackup.download(copy, 'before_name_standardization'); } catch { /* Recovery remains in storage and can be downloaded above. */ }
                        }} />}
                        {kind !== 'ovtTemplates' && kind !== 'names' && <><div className="sd-section-heading"><h3>{titles[kind]}</h3><span className="sd-badge">{unknownCount} нерозпізнаних</span></div>
                        <p className="sd-note">Правила зіставляють повне значення поля (без урахування регістру та зайвих пробілів). Коментарі, ПІБ, ідентифікатори та статуси не змінюються. Збереження правил саме по собі не переписує наявні записи.</p>
                        <div className="sd-columns">
                            <section className="sd-card"><h3>1. Стандартні назви</h3><label>Нові стандартні назви<textarea aria-label="Нові стандартні назви" value={standards} onChange={event => setStandards(event.target.value)} placeholder="Кожна назва — з нового рядка" rows={4} /></label><button onClick={() => invoke(() => { addStandards(lines(standards)); setStandards(''); })}>Додати назви</button>
                                <details><summary>Перелік стандартів ({dictionary.canonical.length})</summary><div className="sd-list">{dictionary.canonical.map(name => <div key={name}><span>{name}</span><button aria-label={'Видалити стандарт ' + name} onClick={() => invoke(() => { const next = structuredClone(config); next.dictionaries[kind].canonical = next.dictionaries[kind].canonical.filter(value => value !== name); edit(next); })}>×</button></div>)}</div></details>
                            </section>
                            <section className="sd-card"><h3>2. Варіанти → стандарт</h3><div className="sd-actions"><button aria-pressed={mode === 'many'} onClick={() => setMode('many')}>Багато → одна</button><button aria-pressed={mode === 'pairs'} onClick={() => setMode('pairs')}>Список пар</button></div>
                                {mode === 'many' ? <><label>Варіанти назв<textarea aria-label="Варіанти назв" value={sources} onChange={event => setSources(event.target.value)} placeholder="Кожен варіант — з нового рядка" rows={3} /></label><label>Стандартна назва<input aria-label="Стандартна назва" list="sd-targets" value={target} onChange={event => setTarget(event.target.value)} placeholder="Оберіть або введіть нову" /></label><datalist id="sd-targets">{dictionary.canonical.map(name => <option key={name} value={name} />)}</datalist></> : <label>Пари назв<textarea aria-label="Пари назв" value={pairs} onChange={event => setPairs(event.target.value)} placeholder={'Старе написання → Стандартне написання\nАбо вставте дві колонки з Excel (Tab)'} rows={5} /></label>}
                                <button onClick={addMappings}>Додати правила</button>
                            </section>
                        </div>
                        <details className="sd-card"><summary>Правила цього розділу ({dictionary.aliases.length})</summary><div className="sd-list">{dictionary.aliases.map((rule, index) => <div key={index}><span>{rule.from} <b>→</b> {rule.to}</span><button aria-label={'Видалити правило ' + rule.from} onClick={() => invoke(() => { const next = structuredClone(config); next.dictionaries[kind].aliases.splice(index, 1); edit(next); })}>Видалити</button></div>)}</div></details>
                        {['docPlaces', 'actualPlaces'].includes(kind) && Array.isArray(legacyPlaces) && !!legacyPlaces.length && <details className="sd-card"><summary>Старий спільний список місць із медичних налаштувань ({legacyPlaces.length})</summary><p className="sd-note">Раніше цей список був спільним для двох полів. Самостійно рознесіть потрібні назви: кнопка додає назву до поточного розділу, вихідний список не видаляється.</p><div className="sd-list">{legacyPlaces.filter(value => typeof value === 'string').map((name, index) => <div key={index}><span>{name}</span><button onClick={() => invoke(() => addStandards([name]))}>Додати до «{titles[kind]}»</button></div>)}</div></details>}
                        <section className="sd-card"><div className="sd-section-heading"><h3>3. Назви у збережених даних</h3><button onClick={() => invoke(async () => { setSnapshot((await SharedDictionaries.inspect(config, mixed)).snapshot); setPlan(null); })}>Оновити перелік</button></div>
                            <div className="sd-actions"><input aria-label="Пошук назви у довідниках" placeholder="Знайти написання…" value={search} onChange={event => setSearch(event.target.value)} /><label className="sd-check"><input type="checkbox" checked={unknownOnly} onChange={event => setUnknownOnly(event.target.checked)} />Лише нерозпізнані</label></div>
                            {kind === 'units' && <label className="sd-check sd-note"><input type="checkbox" checked={mixed} onChange={event => { setMixed(event.target.checked); setPlan(null); }} />Також змішане поле «Позивний / Підрозділ» у журналі подій. Увімкніть лише якщо правило точно стосується підрозділу.</label>}
                            <p className="sd-note">Кількість — це входження у поля, не кількість людей чи подій. Старі сховища та довідники також враховано. «Взяти для правила» не змінює дані.</p>
                            <div className="sd-table-wrap"><table><thead><tr><th>Написання / джерело</th><th>Входжень</th><th>Стандарт</th><th>Дія</th></tr></thead><tbody>{observed.slice(0, 100).map(item => <tr key={item.value}><td>{item.value}<small>{item.modules.join(' · ')}</small></td><td>{item.count}</td><td>{item.canonical || <span className="sd-unknown">Не розпізнано</span>}</td><td><div className="sd-actions"><button onClick={() => { setMode('many'); setSources(item.value); setTarget(item.canonical); panel.current.querySelector('textarea[aria-label="Варіанти назв"]')?.scrollIntoView({ block: 'center' }); }}>Взяти для правила</button>{!item.canonical && <button onClick={() => invoke(() => addStandards([item.value]))}>Це стандарт</button>}</div></td></tr>)}</tbody></table></div>
                            {!observed.length && <p className="sd-note">Значень за цим фільтром немає.</p>}{observed.length > 100 && <p className="sd-note">Показано 100 із {observed.length}. Уточніть пошук; масове виправлення охоплює весь список.</p>}
                        </section>
                        {plan && <section ref={previewPanel} className="sd-card sd-preview" data-testid="dictionary-preview"><h3>Попередній перегляд: {plan.changes.length} полів</h3><p>{[...new Set(plan.changes.map(change => change.module))].join(' · ')}</p><p className="sd-note">Буде збережено також поточні правила довідників. Видалення дублів у списках підказок не видаляє записи.</p><div className="sd-table-wrap"><table><thead><tr><th>Модуль / поле</th><th>Було</th><th>Стане</th></tr></thead><tbody>{plan.changes.slice(0, 150).map((change, index) => <tr key={index}><td>{change.module}<small>{change.key} · {change.path}</small></td><td>{change.before}</td><td>{change.after}</td></tr>)}</tbody></table></div>{plan.changes.length > 150 && <p>Показано перші 150 із {plan.changes.length} полів; застосовано буде весь перелік.</p>}
                            {!!plan.changes.length && <><p>Перед записом створюється захисна копія всіх даних та налаштувань: AES-256-GCM. Запам’ятайте пароль — відновити його неможливо.</p><div className="sd-columns"><label>Пароль захисної копії<input aria-label="Пароль захисної копії довідників" type="password" autoComplete="new-password" value={password} onChange={event => setPassword(event.target.value)} /></label><label>Повторіть пароль<input aria-label="Повтор пароля захисної копії довідників" type="password" autoComplete="new-password" value={confirm} onChange={event => setConfirm(event.target.value)} /></label></div><label className="sd-check"><input type="checkbox" checked={acknowledged} onChange={event => setAcknowledged(event.target.checked)} />Перевірив заміни, зберіг відкриті чернетки та закрив інші вкладки програми. Підтверджую виправлення всіх показаних полів.</label><button className="sd-danger" disabled={!acknowledged || password.length < 12 || password !== confirm} onClick={apply}>Створити захисну копію й застосувати</button></>}
                        </section>}
                        <details className="sd-card"><summary>Історія масових виправлень ({config.history.length})</summary><ol className="sd-list">{[...config.history].reverse().map((item, index) => <li key={index}>{new Date(item.at).toLocaleString('uk-UA')} · {item.changedFields} полів · {(item.kinds || []).map(key => titles[key]).join(', ')}</li>)}</ol></details></>}
                    </fieldset>}
                </main>
            </div>
            {!suspended && kind !== 'names' && <footer className="sd-footer"><span>{templatePending ? 'Є ще не доданий текст шаблонів' : dirty ? 'Є незбережені зміни довідників' : 'Наявні записи не змінюються при збереженні довідників'}</span><div className="sd-actions">{kind !== 'ovtTemplates' && <><button disabled={busy || fatal || !!inventoryError} onClick={() => preview([kind])}>Перегляд цього розділу</button><button disabled={busy || fatal || !!inventoryError} onClick={() => preview(DICTIONARY_KINDS.map(([key]) => key))}>Перегляд усіх замін</button></>}<button className="sd-primary" disabled={busy || fatal || (!dirty && !templatePending)} onClick={save}>Зберегти довідники</button></div></footer>}
        </section>
    </div>;
}
