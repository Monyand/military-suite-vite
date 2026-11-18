import { default as React, useState, useRef, useEffect, useMemo } from 'react';
import { DocumentJournal } from '../../core/documents.js';
import { ExcelJS, localforage, XLSX } from '../../core/vendor.js';
import { POSITION_CATEGORIES, buildPositionRegister, positionBatchError, positionChangeError, withPositionAudit } from './position-register.js';
import { PositionFields } from './PositionFields.jsx';
import { PositionHistory } from './PositionHistory.jsx';
import { useSharedDictionaries } from '../../core/use-shared-dictionaries.js';
import { SharedDictionaries } from '../../core/dictionary-service.js';
import { PositionBatch } from './PositionBatch.jsx';
import { appendPositionBatch } from './position-batch.js';
import { SuiteBackup } from '../../core/backup.js';
import { OvtFields } from './OvtFields.jsx';
import { buildOvtReport } from './ovt-report.js';
import { prepareOvtDraft, ovtCellText } from './ovt-form.js';
import { OVT_STATUSES } from '../../core/ovt-templates.js';

const bindDialogFocusTrap = (dialogRef, lockRef, onClose) => {
    const last = document.activeElement;
    dialogRef.current?.querySelector('input, select, textarea, button')?.focus();
    const keydown = event => {
        if (event.key === 'Escape' && !lockRef.current) onClose();
        if (event.key === 'Tab' && dialogRef.current) {
            const items = [...dialogRef.current.querySelectorAll('button, input, select, textarea')].filter(el => !el.disabled && el.offsetParent !== null);
            const first = items[0], lastItem = items[items.length - 1];
            if (event.shiftKey && document.activeElement === first) { event.preventDefault(); lastItem?.focus(); }
            else if (!event.shiftKey && document.activeElement === lastItem) { event.preventDefault(); first?.focus(); }
        }
    };
    document.addEventListener('keydown', keydown);
    return () => { document.removeEventListener('keydown', keydown); if (last?.isConnected) last.focus(); };
};

const DocumentJournalIcon = ({ name, size = 16 }) => {
    const nodes = window.lucide?.icons?.[name];
    if (!Array.isArray(nodes)) return null;
    const children = nodes[0] === 'svg' ? nodes[2] : nodes;
    return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0">{children.map(([tag, attrs], i) => React.createElement(tag, { ...attrs, key: i }))}</svg>;
};

const TaskInlineEditor = ({ row, fieldKey, type, options, onSave, disabled, getStyle, autoFocus, onAutoFocusDone }) => {
    const [val, setVal] = useState(row[fieldKey] || '');
    const inputRef = useRef(null);
    useEffect(() => setVal(row[fieldKey] || ''), [row[fieldKey]]);
    useEffect(() => {
        if (autoFocus && inputRef.current) {
            inputRef.current.focus();
            onAutoFocusDone?.();
        }
    }, [autoFocus]);

    if (type === 'checkbox') {
        return <label className="inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap"><input type="checkbox" disabled={disabled} checked={!!val} onChange={e => { setVal(e.target.checked); onSave(row, fieldKey, e.target.checked); }} /><span className="dj-tag" style={val ? { background: 'rgba(61, 163, 114, 0.14)', borderColor: 'rgba(61, 163, 114, 0.42)', color: '#3da372' } : { background: '#222429', borderColor: '#2e3138', color: '#b8bec8' }}>{val ? 'Подано' : 'Не подано'}</span></label>;
    }
    if (Array.isArray(type)) {
        const customStyle = getStyle ? getStyle(val) : { background: '#222429', color: '#f3f4f6', borderColor: '#2e3138' };
        return <select disabled={disabled} className="dj-tag outline-none cursor-pointer font-semibold appearance-none px-2 pr-4 w-full max-w-[140px]" style={{ ...customStyle, backgroundImage: 'url("data:image/svg+xml;charset=US-ASCII,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2214%22%20height%3D%2214%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20stroke%3D%22currentColor%22%20stroke-width%3D%222%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%3E%3Cpath%20d%3D%22M6%209l6%206%206-6%22%2F%3E%3C%2Fsvg%3E")', backgroundRepeat: 'no-repeat', backgroundPosition: 'right 4px center', backgroundSize: '12px' }} value={val} onChange={e => { setVal(e.target.value); onSave(row, fieldKey, e.target.value); }}>{options.map(opt => <option key={opt} value={opt} className="bg-[#17181b] text-[#f3f4f6]">{opt}</option>)}</select>;
    }
    if (type === 'textarea') {
        return <textarea ref={inputRef} disabled={disabled} className="dj-input px-2 py-1 text-xs w-full leading-snug resize-y bg-[#101113] focus:bg-[#222429]" rows={1} style={{ minHeight: '28px' }} value={val} onFocus={() => { if (val === 'Нове завдання') setVal(''); }} onChange={e => setVal(e.target.value)} onBlur={() => { const cleaned = val === 'Нове завдання' ? '' : val; if (cleaned !== (row[fieldKey] || '')) onSave(row, fieldKey, cleaned); }} placeholder={fieldKey === 'task' ? 'Введіть зміст завдання…' : 'Коментар…'} />;
    }
    if (type === 'date') {
        const commitDate = () => {
            let next = String(val || '').trim();
            const twoDigitYear = next.match(/^00([2-9]\d)-(\d{2}-\d{2})$/);
            if (twoDigitYear) next = `20${twoDigitYear[1]}-${twoDigitYear[2]}`;
            if (!DocumentJournal.dateKey(next) || Number(next.slice(0, 4)) < 1900) {
                setVal(row[fieldKey] || window.SuiteDates.localISO());
                return;
            }
            if (next !== val) setVal(next);
            if (next !== (row[fieldKey] || '')) onSave(row, fieldKey, next);
        };
        return <input type="date" disabled={disabled} className="dj-input px-1.5 py-1 text-xs w-full font-mono tabular-nums bg-[#101113] focus:bg-[#222429]" value={val} onChange={e => setVal(e.target.value)} onBlur={commitDate} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); else if (e.key === 'Escape') { setVal(row[fieldKey] || ''); e.currentTarget.blur(); } }} />;
    }
    return <input ref={inputRef} type="text" disabled={disabled} className="dj-input px-1.5 py-1 text-xs w-full bg-[#101113] focus:bg-[#222429]" value={val} onChange={e => setVal(e.target.value)} onBlur={() => { if (val !== (row[fieldKey] || '')) onSave(row, fieldKey, val); }} placeholder="..." />;
};

const DocumentJournalApp = ({ onBackup, activeTab }) => {
    const dictionaryOptions = useSharedDictionaries();
    const D = DocumentJournal;
    const [data, setData] = useState(null);
    const [loadError, setLoadError] = useState('');
    const tab = activeTab || 'tasks';
    const [ovtSettingsOpen, setOvtSettingsOpen] = useState(false);
    const [ovtDictEdit, setOvtDictEdit] = useState({});
    const [viewFilters, setViewFilters] = useState(D.empty().settings.filters);
    const [busy, setBusy] = useState(false);
    const [notice, setNotice] = useState('');
    const [draft, setDraft] = useState(null);
    const [formError, setFormError] = useState('');
    const [pendingDelete, setPendingDelete] = useState(null);
    const [importPreview, setImportPreview] = useState(null);
    const [report, setReport] = useState(null);
    const [historyRow, setHistoryRow] = useState(null);
    const [batchOpen, setBatchOpen] = useState(false);
    const positionRegister = useMemo(() => buildPositionRegister(data?.positions || []), [data?.positions]);
    const positionEntries = useMemo(() => new Map(positionRegister.entries.map(entry => [entry.id, entry])), [positionRegister]);
    const filteredByTab = useMemo(() => Object.fromEntries(D.tabs.map(key => [key,
        D.filtered(key, data?.[key] || [], viewFilters[key]).filter(row => {
            if (key !== 'positions') return true;
            if (viewFilters[key].needsReview && !positionRegister.issues.has(row.id)) return false;
            if (!viewFilters[key].onlyActual) return true;
            const entry = positionEntries.get(positionRegister.links.get(row.id) || row.positionId || row.id);
            return !entry || entry.latest.id === row.id;
        })
    ])), [data?.tasks, data?.ovt, data?.positions, viewFilters, positionRegister, positionEntries]);
    const periodRows = useMemo(() => D.filtered(tab, data?.[tab] || [], { ...D.filters(), from: viewFilters[tab].from, to: viewFilters[tab].to }).filter(row => {
        if (tab !== 'positions' || !viewFilters[tab].onlyActual) return true;
        const entry = positionEntries.get(positionRegister.links.get(row.id) || row.positionId || row.id);
        return !entry || entry.latest.id === row.id;
    }), [tab, data?.[tab], viewFilters[tab].from, viewFilters[tab].to, viewFilters[tab].onlyActual, positionRegister, positionEntries]);
    const missingDocCount = useMemo(() => (data?.positions || []).filter(row => !D.hasDoc(row)).length, [data?.positions]);
    const uncategorizedCount = useMemo(() => periodRows.filter(row => !row.category).length, [periodRows]);
    const positionCategoryCounts = useMemo(() => Object.fromEntries(D.positionCategoryCards.map(cat => [cat, periodRows.filter(row => D.matchesPositionCategory(row.category, cat)).length])), [periodRows]);
    const [page, setPage] = useState(1);
    const [selectedIds, setSelectedIds] = useState([]);
    const [bulkDocNumber, setBulkDocNumber] = useState('');
    useEffect(() => { setSelectedIds([]); setBulkDocNumber(''); }, [tab]);
    const dataRef = useRef(null), lock = useRef(false), fileRef = useRef(null), lastAddedTaskIdRef = useRef(null), inlineQueueRef = useRef(Promise.resolve());
    const prefsRef = useRef(D.empty().settings), modalRef = useRef(null), ovtSettingsRef = useRef(null);
    const control = 'dj-input w-full';
    const button = 'dj-button';

    useEffect(() => {
        let alive = true;
        localforage.getItem(D.KEY).then(saved => {
            const value = D.validate(D.migrate(saved == null ? D.empty() : saved));
            if (!alive) return;
            let repaired = false;
            if (Array.isArray(value.tasks)) {
                const fallbackYear = String(new Date().getFullYear());
                value.tasks = value.tasks.map(row => {
                    if (!row || typeof row !== 'object') return row;
                    let nextDate = row.date;
                    const badYear = typeof nextDate === 'string' && nextDate.match(/^0\d{3}-(\d{2}-\d{2})$/);
                    if (badYear) {
                        const yr = typeof row.createdAt === 'string' && /^20\d{2}/.test(row.createdAt) ? row.createdAt.slice(0, 4) : fallbackYear;
                        nextDate = `${yr}-${badYear[1]}`;
                    }
                    let nextTask = typeof row.task === 'string' ? row.task : '';
                    if (nextTask === 'Нове завдання') nextTask = '';
                    else if (/(?:Нове завдання|ове завдання|ве завдання|(?<=Ровере)\s*завдання|(?<!за)вдання)$/.test(nextTask)) {
                        nextTask = nextTask.replace(/(?:Нове завдання|ове завдання|ве завдання|(?<=Ровере)\s*завдання|(?<!за)вдання)$/, '').trimEnd();
                    }
                    if (nextDate !== row.date || nextTask !== row.task) {
                        repaired = true;
                        return { ...row, date: nextDate, task: nextTask };
                    }
                    return row;
                });
                if (repaired) {
                    window.SuiteRuntime?.setItem?.(D.KEY, value)?.catch?.(() => { });
                }
            }
            let savedPrefs = value.settings;
            try {
                const local = JSON.parse(localStorage.getItem('document_journal_view_v1'));
                if (local) {
                    savedPrefs = { ...savedPrefs, tab: local.tab || savedPrefs.tab, filters: local.filters || savedPrefs.filters };
                }
            }
            catch { setNotice('Не вдалося прочитати збережені фільтри. Записи не змінено.'); }
            const prefs = D.settings(savedPrefs);
            prefsRef.current = prefs; dataRef.current = value;
            setViewFilters(prefs.filters); setData(value);
        }).catch(error => { if (alive) setLoadError(error.message || 'Не вдалося прочитати журнал.'); });
        return () => { alive = false; };
    }, []);

    const commit = async transform => {
        if (lock.current || !dataRef.current) return false;
        lock.current = true; setBusy(true);
        try {
            const transformed = await transform({ ...dataRef.current, settings: prefsRef.current });
            const next = withPositionAudit(dataRef.current, transformed);
            D.validate(next);
            await window.SuiteRuntime.setItem(D.KEY, next);
            window.dispatchEvent(new Event('suite-document-labels-changed'));
            prefsRef.current = next.settings;
            dataRef.current = next; setData(next);
            return true;
        } catch (error) { setNotice('Не збережено: ' + (error.message || 'помилка сховища')); return false; }
        finally { lock.current = false; setBusy(false); }
    };
    const changePrefs = (nextTab, nextFilters) => {
        setViewFilters(nextFilters); setPage(1);
        prefsRef.current = { ...prefsRef.current, tab: nextTab, filters: nextFilters };
        // Synchronous, isolated preference storage: never overwrite record data on navigation.
        try { window.SuiteRuntime.setLocalItem('document_journal_view_v1', JSON.stringify({ tab: nextTab, filters: nextFilters })); }
        catch { setNotice('Фільтр застосовано, але не вдалося зберегти налаштування браузера.'); }
    };
    const changeFilter = patch => changePrefs(tab, { ...viewFilters, [tab]: { ...viewFilters[tab], ...patch } });
    useEffect(() => {
        if (!draft && !pendingDelete && !importPreview && !report && !historyRow && !batchOpen) return;
        return bindDialogFocusTrap(modalRef, lock, () => { setDraft(null); setPendingDelete(null); setImportPreview(null); setReport(null); setHistoryRow(null); setBatchOpen(false); });
    }, [!!draft, !!pendingDelete, !!importPreview, !!report, !!historyRow, batchOpen]);
    useEffect(() => {
        if (!ovtSettingsOpen) return;
        return bindDialogFocusTrap(ovtSettingsRef, lock, () => setOvtSettingsOpen(false));
    }, [ovtSettingsOpen]);

    const openRecord = row => {
        const today = new Date();
        const date = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
        setFormError('');
        setHistoryRow(null);
        const next = row ? { ...D.cleanRow(tab, row), ...row } : { ...Object.fromEntries(D.schemas[tab].fields.map(([key, , type]) => [key, type === 'checkbox' ? false : Array.isArray(type) ? type[0] : ''])), date };
        if (tab === 'positions') {
            next.positionId = row ? (row.positionId || positionRegister.links.get(row.id) || '') : '';
            next.category = row?.category || '';
            next.awaitingDoc = !!row && !D.hasDoc(row);
        }
        setDraft(tab === 'ovt' ? prepareOvtDraft(next) : next);
    };
    useEffect(() => {
        const openReviewed = ({ detail }) => {
            if (detail?.module !== tab || !detail.recordId) return;
            const matches = (data?.[tab] || []).filter(row => String(row.id) === detail.recordId);
            if (matches.length === 1) openRecord(matches[0]);
            else setNotice('Запис неможливо однозначно відкрити за ID. Перевірте список і повідомлення про помилку.');
        };
        window.addEventListener('suite-review-record', openReviewed);
        return () => window.removeEventListener('suite-review-record', openReviewed);
    }, [tab, data, positionRegister]);
    const saveRecord = async (event, keepOpen = false) => {
        if (event) event.preventDefault();
        if (tab === 'positions' && !draft.id && draft.multiMode) {
            const names = String(draft.name || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
            if (!names.length) { setFormError('Введіть хоча б одну назву позиції.'); return; }
            const seen = new Set();
            for (const itemName of names) {
                const key = itemName.toLowerCase();
                if (seen.has(key)) { setFormError(`Повтор у списку: «${itemName}».`); return; }
                seen.add(key);
            }
            const now = new Date().toISOString();
            const addedRows = [];
            for (const itemName of names) {
                const clean = D.cleanRow('positions', { ...draft, name: itemName, newName: '' });
                const err = D.rowError('positions', clean);
                if (err) { setFormError(err); return; }
                if (clean.date > window.SuiteDates.localISO()) { setFormError('Журнал призначений для вже здійснених дій. Оберіть сьогоднішню або минулу дату.'); return; }
                if (!D.hasDoc(clean) && !draft.awaitingDoc) { setFormError('Вкажіть № Позатермінового донесення або підтвердьте, що очікуєте номер.'); return; }
                if (!POSITION_CATEGORIES.includes(clean.category)) { setFormError('Оберіть категорію позиції.'); return; }
                const id = 'doc_' + crypto.randomUUID();
                addedRows.push({
                    ...clean,
                    id,
                    positionId: id,
                    opensRegister: clean.status === 'облаштовується',
                    createdAt: now,
                    updatedAt: now
                });
            }
            if (await commit(value => {
                const records = [...value.positions, ...addedRows];
                const problem = positionBatchError(value.positions, records, addedRows.map(r => r.id));
                if (problem) { setFormError(problem); throw new Error(problem); }
                return { ...value, positions: records };
            })) {
                setDraft(null);
                setNotice(`Додано позицій: ${addedRows.length}.`);
            }
            return;
        }
        const clean = D.cleanRow(tab, draft), error = D.rowError(tab, clean);
        if (error) { setFormError(error); return; }
        const now = new Date().toISOString();
        const row = { ...clean, id: draft.id || 'doc_' + crypto.randomUUID(), createdAt: draft.createdAt || now, updatedAt: now };
        if (tab === 'ovt' && row.category === 'Транспорт' && !OVT_STATUSES.includes(row.status)) { setFormError('Для транспорту оберіть «ЗНИЩЕНО» або «ПОШКОДЖЕНО».'); return; }
        if (tab === 'positions') {
            if (!draft.id && row.date > window.SuiteDates.localISO()) { setFormError('Журнал призначений для вже здійснених дій. Оберіть сьогоднішню або минулу дату.'); return; }
            if (!D.hasDoc(row) && !draft.awaitingDoc) { setFormError('Вкажіть № Позатермінового донесення або підтвердьте, що очікуєте номер.'); return; }
            if (!draft.id && !POSITION_CATEGORIES.includes(row.category)) { setFormError('Оберіть категорію позиції.'); return; }
            if (row.status === 'виставлена' || (row.status === 'облаштовується' && (row.opensRegister || (!draft.id && !row.positionId)))) {
                row.positionId = row.positionId || row.id;
                row.opensRegister = row.status === 'облаштовується';
            }
            else if (!draft.id && !row.positionId) { setFormError('Оберіть позицію з реєстру попередніх виставлень.'); return; }
        }
        if (await commit(value => {
            const records = draft.id ? value[tab].map(item => item.id === draft.id ? row : item) : [...value[tab], row];
            const problem = tab === 'positions' ? positionChangeError(value.positions, records, row.id) : '';
            if (problem) { setFormError(problem); throw new Error(problem); }
            return { ...value, [tab]: records };
        })) {
            if (keepOpen && tab === 'positions' && !draft.id) {
                setFormError('');
                setDraft({
                    ...D.emptyRow('positions'),
                    date: row.date,
                    status: row.status,
                    category: row.category,
                    docNumber: row.docNumber,
                    awaitingDoc: !!draft.awaitingDoc,
                    details: row.details,
                    reportedInPbd: row.reportedInPbd,
                    opensRegister: row.status === 'облаштовується',
                    multiMode: false
                });
                setNotice('Запис збережено — можна вводити наступну позицію.');
                requestAnimationFrame(() => modalRef.current?.querySelector('#pos-name-field')?.focus());
            } else {
                setDraft(null); setNotice(tab === 'positions' && !D.hasDoc(row) ? 'Запис збережено з червоним нагадуванням: очікується номер донесення.' : 'Запис збережено.');
            }
            if (tab === 'ovt') {
                lock.current = true; setBusy(true);
                try { await SharedDictionaries.learnOvt(row); }
                catch (error) { setNotice('Запис збережено, але нові фрази не додано в довідник: ' + error.message + ' Відкрийте цей запис і збережіть повторно для повторної спроби.'); }
                finally { lock.current = false; setBusy(false); }
            }
        }
    };
    const togglePbd = async row => {
        if (await commit(value => ({ ...value, [tab]: value[tab].map(item => item.id === row.id ? { ...item, reportedInPbd: !item.reportedInPbd, updatedAt: new Date().toISOString() } : item) }))) setNotice('Відмітку «Подано в ПБД» збережено.');
    };
    const applyBulkPositionUpdate = async ({ setDoc = false, setPbd = false }) => {
        const docVal = bulkDocNumber.trim();
        if (setDoc && !docVal) { setNotice('Вкажіть № Позатермінового донесення для обраних записів.'); return; }
        const picked = new Set(selectedIds);
        if (!picked.size) return;
        const now = new Date().toISOString();
        if (await commit(value => ({
            ...value,
            positions: value.positions.map(item => {
                if (!picked.has(item.id)) return item;
                return {
                    ...item,
                    ...(setDoc ? { docNumber: docVal } : {}),
                    ...(setPbd ? { reportedInPbd: true } : {}),
                    updatedAt: now
                };
            })
        }))) {
            const count = picked.size;
            setSelectedIds([]);
            if (setDoc) setBulkDocNumber('');
            setNotice(setDoc ? `Оновлено № донесення для записів: ${count}.` : `Відмічено «Подано в ПБД» для записів: ${count}.`);
        }
    };
    const applyPositionBatch = async (plan, password) => {
        if (password.length < 12) throw new Error('Пароль має містити щонайменше 12 символів.');
        let safety;
        const saved = await commit(async value => {
            const next = appendPositionBatch(value, plan);
            await window.SuiteRuntime.drain();
            const snapshot = await SuiteBackup.collect();
            const stored = await localforage.getItem(D.KEY) || D.empty();
            if (JSON.stringify(D.migrate(stored)) !== JSON.stringify(dataRef.current)) throw new Error('Журнал змінено в іншій вкладці. Перезавантажте програму й перевірте список повторно.');
            safety = await SuiteBackup.encrypt(snapshot, password);
            await window.SuiteRuntime.setItem('military_suite_recovery_v1', safety);
            if (JSON.stringify(await localforage.getItem(D.KEY) || D.empty()) !== JSON.stringify(stored)) throw new Error('Під час підготовки копії журнал змінився. Пакет не записано. Перезавантажте програму.');
            return next;
        });
        if (saved) {
            try { SuiteBackup.download(safety, 'before_position_batch'); } catch { /* Encrypted browser recovery was saved before writing. */ }
            setBatchOpen(false); setPage(1);
            setNotice(`Додано ${plan.records.length} документальних записів. Попередні записи збережено в історії. Захисна копія: «Відновити бекап» → «Попередній стан», із заданим паролем.`);
        }
        return saved;
    };
    const saveOvtDict = async () => {
        if (await commit(value => ({ ...value, settings: { ...value.settings, ovtDict: ovtDictEdit } }))) {
            setOvtSettingsOpen(false);
            setNotice('Налаштування номенклатури збережено.');
        }
    };
    const changeField = async (row, key, newValue) => {
        if (tab === 'ovt' && row.category === 'Транспорт' && key === 'status') {
            setFormError('Статус змінено в чернетці. Оберіть відповідний наслідок і збережіть запис.');
            setDraft(prepareOvtDraft({ ...row, status: newValue, consequence: '' }));
            return;
        }
        inlineQueueRef.current = inlineQueueRef.current.then(async () => {
            while (lock.current) await new Promise(resolve => setTimeout(resolve, 25));
            const ok = await commit(value => ({ ...value, [tab]: value[tab].map(item => item.id === row.id ? { ...item, [key]: newValue, updatedAt: new Date().toISOString() } : item) }));
            if (ok) setNotice('Поле оновлено.');
        });
        await inlineQueueRef.current;
    };

    const addTaskRow = async () => {
        if (busy) return;
        const id = window.crypto?.randomUUID?.() || ('doc_' + Math.random().toString(36).substring(2) + Date.now().toString(36));
        const newTask = {
            id,
            date: window.SuiteDates.localISO(),
            task: '',
            reportedInPbd: false,
            status: 'Заплановано',
            comment: '',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };
        lastAddedTaskIdRef.current = id;
        setPage(1);
        if (await commit(value => ({ ...value, tasks: [...value.tasks, newTask] }))) {
            setNotice('Новий рядок додано.');
        }
    };
    const chooseImport = async file => {
        if (!file || lock.current) return;
        lock.current = true; setBusy(true); setNotice('');
        try {
            if (file.size > 20 * 1024 * 1024) throw new Error('Ліміт Excel-файлу — 20 МБ.');
            if (!window.XLSX) throw new Error('Бібліотека Excel не завантажилась. Перевірте підключення та оновіть сторінку.');
            const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: false });
            const parsed = D.readWorkbook(workbook, XLSX);
            const result = D.merge(dataRef.current, parsed.incoming);
            const positionIssues = [...buildPositionRegister(result.next.positions).issues.values()];
            setImportPreview({ ...parsed, positionIssues, name: file.name, added: result.added, duplicates: result.duplicates });
        } catch (error) { setNotice('Імпорт не виконано: ' + error.message); }
        finally { lock.current = false; setBusy(false); }
    };
    const applyImport = async () => {
        let result;
        if (await commit(value => { result = D.merge(value, importPreview.incoming); return result.next; })) {
            setNotice(`Імпортовано: ${result.added}. Повторів пропущено: ${result.duplicates}. Інші розділи та наявні відмітки ПБД не змінено.`);
            setImportPreview(null); setPage(1);
        }
    };
    const exportExcel = async onlyFiltered => {
        if (lock.current) return;
        lock.current = true; setBusy(true);
        try {
            const ExcelLib = ExcelJS || window.ExcelJS;
            if (!ExcelLib) throw new Error('Бібліотека Excel не завантажена.');
            const workbook = new ExcelLib.Workbook();
            workbook.creator = 'Military Suite';
            workbook.created = new Date();
            const border = { top: { style: 'thin', color: { argb: 'FFE2E8F0' } }, left: { style: 'thin', color: { argb: 'FFE2E8F0' } }, bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } }, right: { style: 'thin', color: { argb: 'FFE2E8F0' } } };
            const headBorder = { top: { style: 'thin', color: { argb: 'FF334155' } }, left: { style: 'thin', color: { argb: 'FF334155' } }, bottom: { style: 'medium', color: { argb: 'FF334155' } }, right: { style: 'thin', color: { argb: 'FF334155' } } };
            (onlyFiltered ? [tab] : D.tabs).forEach(key => {
                const fields = D.schemas[key].fields, records = onlyFiltered ? filteredRecords(key) : D.filtered(key, data[key], D.filters());
                const headers = fields.map(([, title]) => title);
                const dataRows = records.map(row => fields.map(([field, , type]) => field === 'positionId' ? (positionRegister.links.get(row.id) || row.positionId || '') : key === 'positions' && field === 'name' && row.newName ? `${row.name} → ${row.newName}` : key === 'ovt' && (field === 'position' || field === 'comment') ? (row[field] || ovtCellText(row, field)) : type === 'checkbox' ? (row[field] ? 'Так' : 'Ні') : type === 'date' ? D.dateLabel(row[field]) : (row[field] ?? '')));
                const ws = workbook.addWorksheet(D.schemas[key].title, { views: [{ state: 'frozen', ySplit: 1 }] });
                ws.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9, margins: { left: 0.25, right: 0.25, top: 0.4, bottom: 0.4, header: 0.15, footer: 0.15 } };
                ws.columns = fields.map(([, title, type], colIdx) => {
                    const maxLen = Math.max(String(title || '').length, ...dataRows.map(r => Math.max(0, ...String(r[colIdx] ?? '').split(/\r?\n/).map(line => line.length))));
                    const minW = type === 'date' || type === 'time' || type === 'checkbox' ? 13 : 16;
                    const maxW = type === 'textarea' ? 54 : 36;
                    return { width: Math.min(Math.max(maxLen + 3, minW), maxW) };
                });
                const headRow = ws.addRow(headers);
                headRow.height = 26;
                headRow.eachCell(cell => {
                    cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
                    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' } };
                    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
                    cell.border = headBorder;
                });
                dataRows.forEach((values, rIdx) => {
                    const row = ws.addRow(values);
                    let maxLines = 1;
                    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
                        const type = fields[colNumber - 1][2];
                        const width = Math.max(10, (ws.columns[colNumber - 1].width || 20) - 2);
                        const lines = String(values[colNumber - 1] ?? '').split(/\r?\n/).reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length / width)), 0);
                        if (lines > maxLines) maxLines = lines;
                        cell.font = { name: 'Calibri', size: 10, color: { argb: 'FF0F172A' } };
                        if (rIdx % 2 === 1) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
                        cell.alignment = { vertical: 'middle', horizontal: type === 'date' || type === 'time' || type === 'checkbox' ? 'center' : 'left', wrapText: true };
                        cell.border = border;
                    });
                    row.height = Math.min(220, Math.max(20, maxLines * 14 + 6));
                });
                ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: fields.length } };
            });
            const buffer = await workbook.xlsx.writeBuffer();
            const url = URL.createObjectURL(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
            const link = document.createElement('a');
            link.href = url;
            link.download = 'Документальний_журнал_' + (onlyFiltered ? tab + '_' : '') + window.SuiteDates.localISO() + '.xlsx';
            document.body.appendChild(link); link.click(); link.remove();
            setTimeout(() => URL.revokeObjectURL(url), 30000);
            setNotice('Excel підготовлено. Це незашифрований звіт; для захищеної копії використовуйте єдиний бекап.');
        } catch (error) { setNotice('Експорт не виконано: ' + error.message); }
        finally { lock.current = false; setBusy(false); }
    };
    const openOvtReport = row => {
        const text = buildOvtReport(row);
        setNotice(''); setReport({ title: 'Позатермінове донесення · ОВТ', text });
    };
    const dailyText = date => {
        const sections = D.tabs.map(key => {
            const records = data[key].filter(row => row.date === date);
            return D.schemas[key].title.toLocaleUpperCase('uk-UA') + ` (${records.length})\n` + (records.length ? records.map((row, index) => `${index + 1}. ` + D.schemas[key].fields.map(([field, title, type]) => `${title}: ${type === 'checkbox' ? (row[field] ? 'Так' : 'Ні') : type === 'date' ? D.dateLabel(row[field]) : (row[field] || '—')}`).join(' | ')).join('\n') : 'Записів за цю дату немає.');
        });
        return `ДОБОВИЙ ВИТЯГ ІЗ ЖУРНАЛУ\nДата: ${D.dateLabel(date)}\n\n` + sections.join('\n\n');
    };
    const openDailyReport = () => {
        const date = viewFilters[tab].from || new Date().toLocaleDateString('en-CA');
        setNotice(''); setReport({ title: 'Добовий витяг', date, text: dailyText(date) });
    };
    const copyReport = async () => {
        try { await navigator.clipboard.writeText(report.text); setNotice('Текст скопійовано. Відмітки ПБД та фільтри не змінено.'); }
        catch { modalRef.current?.querySelector('textarea')?.select(); setNotice('Автоматичне копіювання недоступне. Текст виділено — натисніть Ctrl+C.'); }
    };


    if (loadError) return <section id="document-journal" className="p-6 text-[#f3f4f6] bg-[#101113] space-y-3"><h1 className="text-xl font-bold">Документальний журнал</h1><p role="alert" className="text-[#f3a3a0]">{loadError}</p><p className="text-[#b8bec8]">Редагування вимкнено, щоб не перезаписати наявні дані. Використайте єдиний бекап для відновлення.</p></section>;
    if (!data) return <p className="p-6 text-[#b8bec8] bg-[#101113]" role="status">Завантаження журналу…</p>;
    const schema = D.schemas[tab], options = viewFilters[tab];
    const filteredRecords = key => filteredByTab[key];
    const rows = filteredRecords(tab), totalPages = Math.max(1, Math.ceil(rows.length / (options.pageSize || 50))), shownPage = Math.min(page, totalPages);
    const pageSize = options.pageSize || 50;
    const start = (shownPage - 1) * pageSize;
    const end = start + pageSize;
    const visible = rows.slice(start, end);
    const hasPbd = tab !== 'ovt', documentKey = tab === 'positions' ? 'docNumber' : 'urgentDocNo';
    const statusOptions = [...new Set([...schema.fields.find(([key]) => key === 'status')[2], ...data[tab].map(row => row.status)])];
    const hasOvtTransport = tab === 'ovt' && (options.category === 'Транспорт' || (!options.category && rows.some(row => row.category === 'Транспорт' || row.plateNumber || row.boardNumber)));
    const ovtOnlyTransport = tab === 'ovt' && (options.category === 'Транспорт' || (rows.length > 0 && rows.every(row => row.category === 'Транспорт')));
    const ovtOrder = ['date', 'time', 'position', 'category', 'nomenclature', 'status', 'serialNumber', 'urgentDocNo', 'comment'];
    const allFields = tab === 'ovt' ? ovtOrder.map(key => schema.fields.find(field => field[0] === key)) : tab === 'positions' ? ['date', 'name', 'category', 'status', 'docNumber', 'details', 'reportedInPbd'].map(key => schema.fields.find(field => field[0] === key)) : schema.fields;
    const palette = { teal: '#2dd4bf', emerald: '#34d399', blue: '#60a5fa', gold: '#facc15', orange: '#fb923c', violet: '#a78bfa', amber: '#fbbf24', rose: '#f87171', purple: '#a78bfa', slate: '#b8bec8' };
    const tabTheme = { tasks: ['gold', 'Truck'], ovt: ['orange', 'Flame'], positions: ['violet', 'MapPin'] };
    const tone = palette[tabTheme[tab][0]] || '#4c8ed9';
    const tagStyle = color => ({ color: palette[color], background: palette[color] + '1a', borderColor: palette[color] + '4d' });
    const statusTone = value => ({ 'Виконано': 'emerald', 'Виконується': 'amber', 'Заплановано': 'blue', 'Не виконано': 'rose', 'ВТРАЧЕНО': 'amber', 'ЗНИЩЕНО': 'rose', 'ПОШКОДЖЕНО': 'amber', 'ЗНАЙДЕНО': 'emerald', 'виставлена': 'emerald', 'облаштовується': 'slate', 'знята': 'blue', 'знищена': 'rose', 'переміщена': 'amber', 'перейменована': 'purple', 'БпЛА': 'amber', 'Зброя': 'rose', 'Транспорт': 'emerald', 'РЕБ': 'purple', 'Зв\'язок': 'blue', 'Інше': 'slate' }[value] || 'slate');

    const countStatus = status => periodRows.filter(row => row.status === status).length;
    const done = countStatus('Виконано'), pbdCount = periodRows.filter(row => row.reportedInPbd).length;
    const cards = tab === 'tasks' ? [
        ['Всього завдань', periodRows.length, 'записів за період', 'ListTodo', 'blue', {}],
        ['Заплановано', countStatus('Заплановано'), 'очікують на виконання', 'Clock', 'slate', { status: 'Заплановано' }],
        ['Виконується', countStatus('Виконується'), 'в процесі', 'Play', 'amber', { status: 'Виконується' }],
        ['Виконано', countStatus('Виконано'), `${periodRows.length ? Math.round(countStatus('Виконано') / periodRows.length * 100) : 0}% успішності`, 'CircleCheck', 'emerald', { status: 'Виконано' }],
        ['Не виконано', countStatus('Не виконано'), 'завдання не виконано', 'CircleX', 'rose', { status: 'Не виконано' }]
    ] : tab === 'ovt' ? [
        ['Загалом втрат', periodRows.length, 'записів', 'Flame', 'rose', {}],
        ...['БпЛА', 'Зброя', 'Транспорт', 'Інше'].map(cat => [cat, periodRows.filter(row => row.category === cat).length, '', { 'БпЛА': 'Plane', 'Зброя': 'Crosshair', 'Транспорт': 'Truck', 'Інше': 'Box' }[cat] || 'Box', statusTone(cat), { category: cat }])
    ] : [
        ['Виставлення', countStatus('виставлена'), 'документально зафіксовані події', 'ShieldCheck', 'emerald', { status: 'виставлена' }],
        ['Облаштування', countStatus('облаштовується'), 'записи про облаштування', 'Hammer', 'slate', { status: 'облаштовується' }],
        ['Зняття', countStatus('знята'), 'записи про зняття', 'CircleX', 'blue', { status: 'знята' }],
        ['Знищення', countStatus('знищена'), 'записи про знищення', 'CircleX', 'rose', { status: 'знищена' }]
    ];
    const columnTitle = key => ({ date: 'Дата', time: 'Час', position: 'Позиція', nomenclature: 'Модель', isEvent: 'Подія (*)', serialNumber: tab === 'ovt' ? (ovtOnlyTransport ? 'VIN / Номер авто' : hasOvtTransport ? 'Серійний № / Авто' : 'Серійний №') : 'Серійний № / VIN', plateNumber: 'Номер авто', urgentDocNo: 'Позатермінове №', docNumber: 'Позатермінове №', status: tab === 'positions' ? 'Статус / Дія' : 'Статус' }[key]);

    const copyFilteredTasks = async () => {
        const tasks = rows.map(r => String(r.task || '').trim()).filter(Boolean);
        if (!tasks.length) { setNotice('У вибірці немає заповненого тексту завдань.'); return; }
        const text = tasks.join('\n');
        try {
            await navigator.clipboard.writeText(text);
            setNotice('Вибірку завдань скопійовано в буфер обміну.');
        } catch {
            const area = document.createElement('textarea');
            area.value = text;
            area.setAttribute('readonly', '');
            area.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
            document.body.appendChild(area);
            try {
                area.select();
                if (!document.execCommand('copy')) throw new Error('copy rejected');
                setNotice('Вибірку завдань скопійовано в буфер обміну.');
            } catch {
                setNotice('Не вдалося скопіювати автоматично. Ваш браузер блокує буфер.');
            } finally {
                area.remove();
            }
        }
    };

    return <section id="document-journal" data-tab={tab} style={{ '--dj-accent': tone, '--dj-solid': '#2b67ab' }} className="w-full min-w-0 text-[#f3f4f6]">
        <style>{`
                    #document-journal{min-height:100%;background:#101113;padding:0 20px 16px;font-family:'Segoe UI Variable Text','Inter',system-ui,sans-serif}
                    #document-journal .dj-header{margin:0 -20px 8px;padding:7px 20px;background:#17181b;border-bottom:1px solid #2e3138}
                    #document-journal .dj-headline{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}
                    #document-journal .dj-logo{display:flex;align-items:center;justify-content:center;width:30px;height:30px;background:color-mix(in srgb,var(--dj-accent) 14%,#17181b);border:1px solid color-mix(in srgb,var(--dj-accent) 45%,#2e3138);border-radius:2px;color:var(--dj-accent)}
                    #document-journal h1{font-size:15px;font-weight:700;letter-spacing:-.01em;line-height:1.2;color:#f3f4f6}
                    #document-journal .dj-actions{display:flex;align-items:center;flex-wrap:wrap;gap:6px}
                    #document-journal .dj-button{display:inline-flex;align-items:center;justify-content:center;gap:5px;height:32px;padding:0 10px;border:1px solid #2e3138;border-radius:2px;background:#222429;color:#cbd5e1;font-size:11.5px;font-weight:600;line-height:1;white-space:nowrap;transition:background-color .15s,border-color .15s;cursor:pointer}
                    #document-journal .dj-button:hover:not(:disabled){background:#282b31;border-color:#3c404a;color:#ffffff}#document-journal button:disabled{opacity:.45;cursor:not-allowed}
                    #document-journal .dj-blue{background:#2b67ab;border-color:#4c8ed9;color:#ffffff}#document-journal .dj-blue:hover:not(:disabled){background:#3477c2}
                    #document-journal .dj-green{background:rgba(61,163,114,.16);border-color:rgba(61,163,114,.45);color:#8ad8b1}#document-journal .dj-green:hover:not(:disabled){background:rgba(61,163,114,.25)}
                    #document-journal .dj-indigo{background:#222429;border-color:#3c404a;color:#f3f4f6}
                    #document-journal .dj-primary{background:var(--dj-solid);border-color:#4c8ed9;color:#ffffff;font-weight:600}#document-journal .dj-primary:hover:not(:disabled){background:#3477c2}
                    #document-journal .dj-nav{display:flex;gap:8px;overflow-x:auto;padding:10px 0;margin-top:12px;border-top:1px solid #2e3138}
                    #document-journal .dj-tab{display:flex;align-items:center;gap:8px;white-space:nowrap;padding:8px 14px;border:1px solid #2e3138;border-radius:2px;background:#17181b;color:#cbd5e1;font-size:12px;font-weight:600;text-transform:uppercase;transition:background-color .15s,border-color .15s}
                    #document-journal .dj-tab:hover{border-color:#3c404a;background:#222429}
                    #document-journal .dj-tab[aria-pressed=true]{background:#222429;border-color:#4c8ed9;color:#f3f4f6}
                    #document-journal .dj-tab-count{font-family:'Cascadia Mono','JetBrains Mono',monospace;font-variant-numeric:tabular-nums;border-radius:2px;padding:1px 6px;background:#101113;border:1px solid #2e3138;color:#b8bec8;font-size:11px}
                    #document-journal .dj-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:6px;margin-bottom:6px}
                    #document-journal .dj-stat{text-align:left;background:#1a1c20;border:1px solid #3a3e47;border-radius:2px;padding:6px 10px;min-height:auto;font-variant-numeric:tabular-nums}
                    #document-journal .dj-stat-label{font-size:11px;text-transform:uppercase;color:#cbd5e1;font-weight:700;letter-spacing:.04em;line-height:1.25}
                    #document-journal .dj-stat-number{font:700 19px 'Cascadia Mono','JetBrains Mono',monospace;font-variant-numeric:tabular-nums;line-height:1.15;margin-top:3px}
                    #document-journal .dj-stat-hint{font:11px 'Cascadia Mono','JetBrains Mono',monospace;color:#b8bec8;margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
                    #document-journal .dj-stat-icon{padding:4px;border-radius:2px;border:1px solid;display:flex;align-items:center;justify-content:center}
                    #document-journal .dj-stat-icon svg{width:13px;height:13px}
                    #document-journal .dj-position-categories{gap:6px;margin-bottom:6px}
                    #document-journal .dj-position-categories .dj-stat{padding:5px 10px;min-height:auto}
                    #document-journal .dj-position-categories .dj-stat .dj-stat-number{font-size:16px;margin-top:2px}
                    #document-journal .dj-position-categories .dj-stat .dj-stat-hint{font-size:10.5px;margin-top:2px;color:#b8bec8}
                    #document-journal .dj-toolbar{display:flex;align-items:center;gap:6px;flex-wrap:wrap;padding:6px 10px;border:1px solid #3a3e47;border-radius:2px;background:#1a1c20;margin:0 0 6px}
                    #document-journal .dj-filter-main,#document-journal .dj-filter-extra{display:contents}
                    #document-journal .dj-filter-main>label{flex:0 0 auto}#document-journal .dj-filter-main>label:first-child{flex:1 1 130px;max-width:210px;min-width:110px}
                    #document-journal .dj-toolbar-actions{display:flex;gap:5px;margin-left:auto;align-items:center;flex-wrap:wrap}
                    #document-journal .dj-filter-main label>span,#document-journal .dj-filter-main>div>span{display:none}
                    #document-journal .dj-filter-main>div input[type=date]{width:116px;font-variant-numeric:tabular-nums}
                    #document-journal .dj-input{min-height:32px;padding:4px 8px;border:1px solid #2e3138;background:#101113;color:#f3f4f6;border-radius:2px;font-size:11.5px;outline:none}
                    #document-journal .dj-input:focus{border-color:#4c8ed9}#document-journal input[type=checkbox]{accent-color:#4c8ed9;width:14px;height:14px;flex-shrink:0}
                    #document-journal .dj-table-wrap{overflow:auto;max-height:calc(100vh - 210px);background:#17181b;border:1px solid #3c404a;border-radius:2px;margin-top:6px}
                    #document-journal .dj-table{width:100%;font-size:13px;text-align:left;border-collapse:separate;border-spacing:0;font-variant-numeric:tabular-nums;color:#f3f4f6}
                    #document-journal .dj-table th{position:sticky;top:0;background:#222429;z-index:2;padding:8px 10px;color:#f3f4f6;font-weight:700;font-size:11.5px;text-transform:uppercase;letter-spacing:.04em;white-space:nowrap;border-bottom:2px solid #424652}
                    #document-journal .dj-table th:not(:last-child){border-right:1px solid #2e3138}
                    #document-journal .dj-table td{padding:8px 10px;border-bottom:1px solid #32363e;vertical-align:middle}
                    #document-journal .dj-table td:not(:last-child){border-right:1px solid #262930}
                    #document-journal .dj-table tr:last-child td{border-bottom:0}
                    #document-journal[data-tab=tasks] .dj-table td{padding:4px 6px}
                    #document-journal .dj-table tbody tr:nth-child(odd){background:#131417}#document-journal .dj-table tbody tr:nth-child(even){background:#1a1c20}#document-journal .dj-table tbody tr:hover{background:#25272d}
                    #document-journal .dj-table tr.dj-marked{background:#25272d;border-left:2px solid var(--dj-accent)}
                    #document-journal .dj-table td[data-field=name],#document-journal .dj-table td[data-field=position]{color:#38bdf8;font-weight:600;white-space:nowrap}
                    #document-journal .dj-table td[data-field=comment],#document-journal .dj-table td[data-field=details]{color:#d4d8e0}
                    #document-journal .dj-table td[data-field=serialNumber]{color:#e5e7eb;font-family:'Cascadia Mono','JetBrains Mono',monospace;white-space:nowrap}
                    #document-journal .dj-table td[data-field=docNumber],#document-journal .dj-table td[data-field=urgentDocNo]{color:#c4b5fd;font-family:'Cascadia Mono','JetBrains Mono',monospace;font-weight:600;white-space:nowrap}
                    #document-journal .dj-table td[data-field=nomenclature]{color:#f9fafb;font-family:'Cascadia Mono','JetBrains Mono',monospace;font-weight:700;white-space:nowrap}
                    #document-journal .dj-tag{display:inline-flex;align-items:center;gap:5px;font:600 11px 'Cascadia Mono','JetBrains Mono',monospace;font-variant-numeric:tabular-nums;padding:2px 7px;border:1px solid;border-radius:2px;white-space:nowrap}
                    #document-journal .dj-icon-button{display:inline-flex;align-items:center;justify-content:center;padding:5px;border-radius:2px;color:#b8bec8;border:1px solid transparent}#document-journal .dj-icon-button:hover{background:#222429;border-color:#2e3138;color:#f3f4f6}
                    #document-journal .dj-footer{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:10px;padding-top:10px;color:#989fa9;font:11px 'Cascadia Mono','JetBrains Mono',monospace;font-variant-numeric:tabular-nums}
                    #document-journal .dj-modal{background:#17181b;border-color:#2e3138;border-radius:2px;overscroll-behavior:contain}
                    @media(prefers-reduced-motion:reduce){#document-journal .dj-tab,#document-journal .dj-button{transition:none}}
                    @media(max-width:800px){#document-journal{padding:0 12px 16px}#document-journal .dj-header{margin:0 -12px 8px;padding:8px 12px}#document-journal .dj-stats{grid-template-columns:repeat(2,minmax(0,1fr))}#document-journal .dj-filter-main>label:first-child{max-width:none}#document-journal .dj-tab{padding:8px 12px}}
                    #document-journal .dj-stat[aria-pressed=true]{border-color:#4c8ed9;background:#222429}
                    #document-journal .dj-table tbody tr.dj-missing-doc{background:rgba(217,83,79,.13)}
                    #document-journal .dj-table tbody tr.dj-missing-doc td:first-child{border-left:3px solid #d9534f}
                `}</style>
        <header className="dj-header">
            <div className="dj-headline"><div className="flex items-center gap-2.5"><div className="dj-logo"><DocumentJournalIcon name={tabTheme[tab][1]} size={16} /></div><div className="flex items-center gap-2 flex-wrap"><h1>{schema.title}</h1><span className="dj-tag" style={tagStyle(tabTheme[tab][0])}>ЖБД · ОБЛІК</span><span className="text-[11px] text-[#b8bec8]">· Документальний журнал</span></div></div>
                <div className="dj-actions"><input ref={fileRef} aria-label="Імпорт Excel документального журналу" type="file" accept=".xlsx,.xls" className="hidden" onChange={event => { const file = event.target.files[0]; event.target.value = ''; chooseImport(file); }} /><button aria-label="Імпорт Excel" disabled={busy} className="dj-button dj-blue" onClick={() => fileRef.current.click()}><DocumentJournalIcon name="FileUp" size={14} />Імпорт (.xlsx)</button><button aria-label="Експорт трьох вкладок" disabled={busy} className="dj-button dj-green" onClick={() => exportExcel(false)}><DocumentJournalIcon name="FileDown" size={14} />Експорт (.xlsx)</button><button disabled={busy} className="dj-button" onClick={openDailyReport}><DocumentJournalIcon name="FileText" size={14} />Добовий витяг</button>{tab === 'ovt' && <button aria-label="Налаштування номенклатури ОВТ" disabled={busy} className="dj-button" style={{ borderColor: '#4c8ed9', color: '#f3f4f6' }} onClick={() => { setOvtDictEdit(prefsRef.current.ovtDict || D.defaultOvtDict); setOvtSettingsOpen(true); }}><DocumentJournalIcon name="Settings" size={14} />Налаштування ОВТ</button>}{tab === 'tasks' ? <button type="button" aria-label="Додати завдання" disabled={busy} onClick={addTaskRow} className="dj-button dj-primary"><DocumentJournalIcon name="Plus" size={14} />Додати завдання</button> : <button aria-label="Додати запис" disabled={busy} onClick={() => openRecord(null)} className="dj-button dj-primary"><DocumentJournalIcon name="Plus" size={14} />{tab === 'ovt' ? 'Додати запис ОВТ' : 'Додати подію позиції'}</button>}</div>
            </div>
        </header>
        {notice && <div role="status" className="flex items-center justify-between gap-3 px-3 py-1.5 mb-1.5 rounded-sm bg-[#17181b] border border-[#2e3138] text-xs text-[#f3f4f6]"><span>{notice}</span><button aria-label="Закрити повідомлення журналу" className="dj-icon-button" onClick={() => setNotice('')}><DocumentJournalIcon name="X" size={14} /></button></div>}
        <div className="dj-stats" data-testid="document-action-cards">{cards.map(([title, value, hint, icon, color, filter]) => {
            const isFilterable = Object.keys(filter).length > 0;
            const CardTag = isFilterable ? 'button' : 'div';
            const isActive = isFilterable && Object.entries(filter).every(([k, v]) => options[k] === v);
            return <CardTag key={title} className="dj-stat" style={{ ...(isActive ? {} : { borderColor: '#2e3138' }), ...(isFilterable ? { cursor: 'pointer' } : {}) }} {...(isFilterable ? {
                type: 'button', 'aria-pressed': isActive, onClick: () => {
                    const newFilter = {};
                    for (const key of Object.keys(filter)) newFilter[key] = isActive ? D.filters()[key] : filter[key];
                    changeFilter(newFilter);
                }, title: 'Фільтрувати записи: ' + title
            } : {})}><div className="flex items-center justify-between gap-2"><span className="dj-stat-label">{title}</span><span className="dj-stat-icon" style={tagStyle(color)}><DocumentJournalIcon name={icon} size={12} /></span></div><div className="flex items-baseline justify-between gap-2"><div className="dj-stat-number" style={{ color: palette[color] }}>{value}</div><p className="dj-stat-hint">{hint}</p></div></CardTag>;
        })}</div>
        {tab === 'positions' && <>
            <div className="dj-stats dj-position-categories" data-testid="position-category-cards">{D.positionCategoryCards.map(category => <button type="button" key={category} aria-pressed={options.category === category} onClick={() => changeFilter({ category: options.category === category ? '' : category })} className="dj-stat"><span className="dj-stat-label">{category}</span><div className="flex items-baseline justify-between gap-2 mt-0.5"><div className="dj-stat-number text-[#a78bfa]">{positionCategoryCounts[category] || 0}</div><p className="dj-stat-hint">{category === 'ОВгП' ? 'мінометні + вогневі' : 'записів за період'}</p></div></button>)}</div>
            <div className="mb-1.5 rounded-sm border border-[#2e3138] bg-[#17181b] px-3 py-1.5 flex flex-wrap items-center justify-between gap-2 text-xs">
                <div className="flex flex-wrap items-center gap-1.5"><span className="text-[11px] font-semibold text-[#9aa6b8] mr-1">Звірка:</span>
                    <button type="button" className="h-7 px-2 rounded-sm border inline-flex items-center text-[11px] font-mono font-semibold tabular-nums cursor-pointer" style={tagStyle('rose')} onClick={() => changePrefs(tab, { ...viewFilters, [tab]: { ...D.filters(), missingDoc: true } })}>Без номера донесення: {missingDocCount}</button>
                    <button type="button" className="h-7 px-2 rounded-sm border inline-flex items-center text-[11px] font-mono font-semibold tabular-nums cursor-pointer" style={tagStyle('amber')} onClick={() => changePrefs(tab, { ...viewFilters, [tab]: { ...D.filters(), needsReview: true } })}>Потребує звірки: {positionRegister.issues.size}</button>
                    <button type="button" aria-pressed={options.category === '__uncategorized'} style={options.category === '__uncategorized' ? tagStyle('emerald') : undefined} className="h-7 px-2 rounded-sm border border-[#2e3138] bg-[#222429] text-[#cbd5e1] inline-flex items-center text-[11px] font-mono font-semibold tabular-nums cursor-pointer" onClick={() => changeFilter({ category: options.category === '__uncategorized' ? '' : '__uncategorized' })}>Без категорії: {uncategorizedCount}</button>
                    <span className="text-[#2e3138] mx-0.5">|</span>
                    <label className="flex items-center gap-1.5 whitespace-nowrap text-[11px] text-[#cbd5e1] cursor-pointer"><input type="checkbox" checked={options.missingDoc} onChange={event => changeFilter({ missingDoc: event.target.checked })} />Лише без номера донесення</label>
                    <label className="flex items-center gap-1.5 whitespace-nowrap text-[11px] text-[#cbd5e1] cursor-pointer"><input type="checkbox" checked={options.onlyActual} onChange={event => changeFilter({ onlyActual: event.target.checked })} />Лише актуальні</label>
                    <label className="flex items-center gap-1.5 whitespace-nowrap text-[11px] text-[#cbd5e1] cursor-pointer"><input type="checkbox" checked={options.needsReview} onChange={event => changeFilter({ needsReview: event.target.checked })} />Лише потребують звірки</label>
                </div>
                <label className="flex items-center gap-2 text-xs text-[#b8bec8]"><span className="text-[11px] whitespace-nowrap">Історія:</span><select aria-label="Відкрити історію позиції" className="dj-input max-w-full text-xs tabular-nums" style={{ minHeight: '28px', padding: '2px 8px' }} value="" onChange={event => { const entry = positionRegister.entries.find(item => item.id === event.target.value); if (entry) { setNotice(''); setHistoryRow(entry.records[0]); } }}><option value="">Реєстр виставлень ({positionRegister.entries.length})</option>{positionRegister.entries.map(entry => <option key={entry.id} value={entry.id}>{entry.name} · {D.dateLabel(entry.records[0].date)} · № {entry.records[0].docNumber || 'очікується'}</option>)}</select></label>
            </div>
        </>}
        <div className="dj-toolbar">
            <div className="dj-filter-main">
                <label className="text-xs text-[#b8bec8]"><span>Пошук у документах</span><input aria-label="Пошук у документах" className={control} value={options.search} onChange={event => changeFilter({ search: event.target.value })} placeholder="Назва, номер донесення, примітка…" /></label>
                <div className="text-xs text-[#b8bec8] shrink-0"><span>Період</span><div className="flex items-center gap-1.5"><span className="!inline text-[11px] font-mono text-[#9aa6b8]">Від:</span><input aria-label="Дата від" type="date" className={control} value={options.from} onChange={event => changeFilter({ from: event.target.value })} /><span className="!inline text-[11px] font-mono text-[#9aa6b8]">До:</span><input aria-label="Дата до" type="date" className={control} value={options.to} onChange={event => changeFilter({ to: event.target.value })} /></div></div>
                <div className="flex gap-1 items-center shrink-0">
                    {[['За добу', 0], ['3 дні', 2], ['7 днів', 6]].map(([lbl, days]) => <button key={lbl} aria-label={lbl} onClick={() => changeFilter(window.SuiteDates.recent(days))} className="h-8 px-2.5 rounded-sm bg-[#222429] hover:bg-[#282b31] border border-[#2e3138] text-[#cbd5e1] text-[11px] uppercase font-semibold transition-colors whitespace-nowrap">{lbl}</button>)}
                    <button aria-label="Скинути" title="Скинути період" onClick={() => changeFilter({ from: '', to: '' })} className="px-1.5 py-1 rounded-sm bg-[#222429] hover:bg-[#282b31] border border-[#2e3138] text-[#b8bec8] hover:text-[#f3f4f6] transition-colors"><DocumentJournalIcon name="X" size={12} /></button>
                </div>
                <label className="text-xs text-[#b8bec8] shrink-0"><span>Статус / Дія</span><select aria-label="Фільтр статусу журналу" className={control} value={options.status} onChange={event => changeFilter({ status: event.target.value })}><option value="">Усі статуси</option>{statusOptions.map(status => <option key={status}>{status}</option>)}</select></label>
            </div>
            <div className="dj-filter-extra text-xs">
                <label className="flex items-center gap-1 text-[#b8bec8] shrink-0"><span className="sr-only">Показувати:</span><select aria-label="Рядків на сторінці" className={button} value={options.pageSize || 50} onChange={event => changeFilter({ pageSize: parseInt(event.target.value, 10) || 50 })}><option value={20}>20 рядків</option><option value={50}>50 рядків</option><option value={100}>100 рядків</option><option value={500}>500 рядків</option></select></label>
                {hasPbd && <label className="flex items-center gap-1.5 whitespace-nowrap shrink-0 text-[11px] text-[#cbd5e1]"><input type="checkbox" checked={options.unreported} onChange={event => changeFilter({ unreported: event.target.checked })} />Лише не подані в ПБД</label>}
                {tab === 'ovt' && <label className="flex items-center gap-1.5 whitespace-nowrap shrink-0 text-[11px] text-[#cbd5e1]"><input type="checkbox" checked={options.missingDoc} onChange={event => changeFilter({ missingDoc: event.target.checked })} />Лише без номера донесення</label>}
                {tab === 'positions' && <select aria-label="Фільтр категорії позицій" className={button} value={options.category} onChange={event => changeFilter({ category: event.target.value })}><option value="">Усі категорії позицій</option><option value="ОВгП">ОВгП — мінометні та вогневі</option>{POSITION_CATEGORIES.map(category => <option key={category}>{category}</option>)}<option value="__uncategorized">Без категорії</option></select>}
                {tab === 'ovt' && <select aria-label="Фільтр категорії ОВТ" className={button} value={options.category} onChange={event => changeFilter({ category: event.target.value })}><option value="">Усі категорії</option>{[...new Set([...schema.fields.find(([key]) => key === 'category')[2], ...data.ovt.map(row => row.category)])].filter(Boolean).map(category => <option key={category}>{category}</option>)}</select>}
                {tab === 'ovt' && <select aria-label="Фільтр помітки ОВТ" className={button} value={options.event} onChange={event => changeFilter({ event: event.target.value })}><option value="">Усі записи ОВТ</option><option value="real">Без помітки *</option><option value="marked">З поміткою *</option></select>}
                <button onClick={() => changePrefs(tab, { ...viewFilters, [tab]: D.filters() })} className="text-[#4c8ed9] hover:text-[#7db3ed] underline text-[11px] whitespace-nowrap shrink-0">Скинути фільтри</button>
            </div>
            <div className="dj-toolbar-actions">
                {tab === 'positions' && <button type="button" disabled={busy} onClick={() => { setNotice(''); setBatchOpen(true); }} className="dj-button"><DocumentJournalIcon name="ListPlus" size={14} />Масове внесення / перейменування</button>}
                {tab === 'tasks' && <button type="button" disabled={busy || !rows.length} onClick={copyFilteredTasks} className="dj-button" title="Копіювати текст усіх показаних завдань"><DocumentJournalIcon name="Copy" size={14} />Копіювати текст завдань</button>}
                <button type="button" disabled={busy || !rows.length} onClick={() => exportExcel(true)} className="dj-button dj-green" title="Згенерувати Excel звіт по вибірці"><DocumentJournalIcon name="FileDown" size={14} />Експорт вибірки</button>
            </div>
            {options.from && options.to && options.from > options.to && <p role="alert" className="text-[#d99b26] text-sm">Дата «від» пізніша за дату «до». Перевірте період.</p>}
        </div>
        <div className="text-[11px] font-mono text-[#b8bec8] flex justify-between tabular-nums"><h2>{schema.title} · показано <b className="text-[#f3f4f6]">{rows.length}</b> із {data[tab].length}</h2><span>{options.from || options.to ? 'За обраний період' : 'За весь період'}</span></div>
        {tab === 'positions' && selectedIds.length > 0 && (
            <div className="mt-1.5 px-3 py-2 rounded-sm bg-[#17181b] border border-[#4c8ed9]/55 flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-2.5 text-xs">
                    <span className="font-mono font-bold text-[#93c5fd] tabular-nums">Обрано: {selectedIds.length}</span>
                    <button type="button" disabled={busy} className="text-[#9aa6b8] hover:text-[#f3f4f6] underline cursor-pointer" onClick={() => setSelectedIds([])}>Зняти вибір</button>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                    <input
                        aria-label="№ донесення для вибраних"
                        className="dj-input w-56 font-mono"
                        maxLength={1000}
                        disabled={busy}
                        value={bulkDocNumber}
                        onChange={e => setBulkDocNumber(e.target.value)}
                        placeholder="№ Позатермінового донесення…"
                    />
                    <button type="button" disabled={busy || !bulkDocNumber.trim()} className="dj-button dj-primary" onClick={() => applyBulkPositionUpdate({ setDoc: true })}>Присвоїти №</button>
                    <button type="button" disabled={busy} className="dj-button dj-green" onClick={() => applyBulkPositionUpdate({ setPbd: true })}>Подано в ПБД</button>
                </div>
            </div>
        )}
        <div className="dj-table-wrap">
            <table className="dj-table" data-testid="document-journal-table"><thead><tr>{tab === 'positions' && <th className="text-center w-9"><input type="checkbox" aria-label="Вибрати всі показані позиції" disabled={busy || !visible.length} checked={visible.length > 0 && visible.every(r => selectedIds.includes(r.id))} onChange={e => { const visIds = visible.map(r => r.id); setSelectedIds(prev => e.target.checked ? Array.from(new Set([...prev, ...visIds])) : prev.filter(id => !visIds.includes(id))); }} /></th>}<th className="text-center w-10">#</th>{allFields.map(([key, title]) => <th key={key} style={tab === 'tasks' ? (key === 'date' ? { width: '125px' } : key === 'task' ? { width: 'auto' } : key === 'reportedInPbd' ? { width: '105px' } : key === 'status' ? { width: '140px' } : key === 'comment' ? { width: '28%' } : {}) : {}}>{columnTitle(key) || title}</th>)}<th className="text-right w-14">Дії</th></tr></thead><tbody>{visible.map((row, index) => <tr key={row.id} data-document-id={row.id} className={tab === 'positions' && !D.hasDoc(row) ? 'dj-missing-doc' : row.isEvent ? 'dj-marked' : ''}>{tab === 'positions' && <td className="text-center"><input type="checkbox" aria-label={`Вибрати запис ${row.name || row.id}`} disabled={busy} checked={selectedIds.includes(row.id)} onChange={e => setSelectedIds(prev => e.target.checked ? [...prev, row.id] : prev.filter(id => id !== row.id))} /></td>}<td className="text-center text-[#989fa9] font-mono text-[11px] tabular-nums">{(shownPage - 1) * (options.pageSize || 50) + index + 1}</td>{allFields.map(([key, , type]) => <td key={key} data-field={key} className={type === 'textarea' && tab !== 'tasks' ? 'min-w-[200px] max-w-md whitespace-pre-wrap break-words' : ''}>
                {tab === 'tasks' ? <TaskInlineEditor row={row} fieldKey={key} type={type} options={Array.isArray(type) ? [...new Set([...type, row[key]])].filter(Boolean) : null} onSave={changeField} disabled={false} getStyle={key === 'status' ? val => tagStyle(statusTone(val)) : null} autoFocus={key === 'task' && lastAddedTaskIdRef.current === row.id} onAutoFocusDone={() => { lastAddedTaskIdRef.current = null; }} /> :
                    key === 'name' && tab === 'positions' ? <span className="inline-flex flex-col items-start gap-0.5"><span className="text-[#38bdf8] font-semibold">{row.name}</span>{row.newName && <span className="text-xs text-[#fbbf24]">→ {row.newName || 'нова назва не вказана'}</span>}{row.destinationPositionId && <span className="text-xs text-[#b8bec8]">на місце: {row.destinationName || 'зв’язок із записом'}</span>}</span> : key === 'serialNumber' && tab === 'ovt' ? (() => { const s = ovtCellText(row, 'serialNumber'), p = (row.category === 'Транспорт' || row.plateNumber || row.boardNumber) ? ovtCellText(row, 'plateNumber') : ''; if (!s && !p) return '—'; if (row.category !== 'Транспорт' && !p) return s; return <span className="inline-flex flex-col gap-0.5 leading-tight">{s && <span>{row.category === 'Транспорт' && !s.includes(':') ? `VIN: ${s}` : s}</span>}{p && <span className="text-[11px] text-[#d4d8e0]">{!p.includes(':') ? `Номер: ${p}` : p}</span>}</span>; })() : key === 'reportedInPbd' ? <label className="inline-flex items-center gap-2 cursor-pointer whitespace-nowrap"><input type="checkbox" aria-label={`Подано в ПБД: ${row.name || row.task}`} disabled={busy} checked={row.reportedInPbd} onChange={() => togglePbd(row)} /><span className={`font-mono text-[11.5px] font-semibold ${row.reportedInPbd ? 'text-[#34d399]' : 'text-[#989fa9]'}`}>{row.reportedInPbd ? 'Подано' : 'Не подано'}</span></label> : type === 'checkbox' ? <span className="dj-tag" style={tagStyle(row[key] ? 'blue' : 'emerald')}>{row[key] ? 'Подія (*)' : 'Реальна'}</span> : type === 'date' ? <span className="font-mono font-normal text-[#d4d8e0] whitespace-nowrap tabular-nums">{D.dateLabel(row[key])}</span> : key === 'status' && tab === 'positions' ? <div className="space-y-1"><span className="dj-tag" style={tagStyle(statusTone(row.status))}>{row.status}</span>{positionRegister.issues.has(row.id) && <p className="text-[#fbbf24] text-[11px] max-w-[250px]" title={positionRegister.issues.get(row.id)}>Потребує звірки</p>}</div> : key === 'status' && Array.isArray(type) ? <div className="inline-flex items-center gap-1.5"><select aria-label={`Статус: ${row.name || row.task || ''}`} value={row[key]} onChange={e => changeField(row, key, e.target.value)} disabled={busy} className="dj-tag bg-transparent outline-none cursor-pointer font-semibold appearance-none px-2 pr-4" style={{ ...tagStyle(statusTone(row[key])), backgroundImage: 'url("data:image/svg+xml;charset=US-ASCII,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2214%22%20height%3D%2214%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20stroke%3D%22currentColor%22%20stroke-width%3D%222%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%3E%3Cpath%20d%3D%22M6%209l6%206%206-6%22%2F%3E%3C%2Fsvg%3E")', backgroundRepeat: 'no-repeat', backgroundPosition: 'right 4px center', backgroundSize: '12px' }}>{(tab === 'ovt' && row.category === 'Транспорт' ? [...new Set([...OVT_STATUSES, row.status])] : type).map(opt => <option key={opt} value={opt} className="bg-[#17181b] text-[#f3f4f6]">{opt}</option>)}</select>{tab === 'ovt' && row.isEvent && <span className="dj-tag" style={tagStyle('blue')} title="Подія з поміткою *">Подія (*)</span>}</div> : key === 'category' ? <span className="text-xs font-medium text-[#a5b4fc] whitespace-nowrap">{row[key] || 'Не визначено'}</span> : key === documentKey && !D.hasDoc(row) ? <span className={tab === 'positions' ? 'text-[#f87171] font-semibold' : 'text-[#fbbf24]'}>{tab === 'positions' ? 'Очікується номер' : (row[key] || 'Не вказано')}</span> : ((tab === 'ovt' ? ovtCellText(row, key) : row[key]) || '—')}
            </td>)}<td><div className="flex gap-1 justify-end items-center">{tab === 'positions' && <button className="dj-button" title="Історія позиції за всіма документами" aria-label={`Історія позиції ${row.id}`} onClick={() => { setNotice(''); setHistoryRow(row); }}><DocumentJournalIcon name="History" size={14} />Історія</button>}{tab === 'ovt' && <button title="Сформувати позатермінове донесення" aria-label={`Позатермінове донесення ${row.id}`} onClick={() => openOvtReport(row)} className="dj-button" style={tagStyle('amber')}><DocumentJournalIcon name="Zap" size={12} />Позатерм.</button>}{tab !== 'tasks' && <button disabled={busy} title="Редагувати" aria-label={`Редагувати запис ${row.id}`} className="dj-icon-button" onClick={() => openRecord(row)}><DocumentJournalIcon name="SquarePen" size={15} /></button>}<button disabled={busy} title="Видалити" aria-label={`Видалити запис ${row.id}`} className="dj-icon-button" onClick={() => setPendingDelete(row)}><DocumentJournalIcon name="Trash2" size={15} /></button></div></td></tr>)}
                {!rows.length && <tr><td colSpan={allFields.length + (tab === 'positions' ? 3 : 2)} className="p-10 text-center text-[#989fa9] italic">{data[tab].length ? 'За цими фільтрами записів немає.' : 'Записів ще немає. Додайте запис або імпортуйте Excel із попередньої програми.'}</td></tr>}
            </tbody></table>
        </div>
        <footer className="dj-footer"><p className="flex items-center gap-2"><DocumentJournalIcon name="Database" size={12} />Локальна база · записи та налаштування входять до єдиного AES-256 бекапу</p><div className="flex items-center gap-3"><button className={button} disabled={shownPage <= 1} onClick={() => setPage(shownPage - 1)}>Назад</button><span>{shownPage} / {totalPages}</span><button className={button} disabled={shownPage >= totalPages} onClick={() => setPage(shownPage + 1)}>Далі</button></div></footer>
        {(draft || pendingDelete || importPreview || report || historyRow || batchOpen) && <div className="fixed inset-0 z-[15000] bg-black/80 p-3 sm:p-6 pt-16 flex items-center justify-center overscroll-contain"><section ref={modalRef} role="dialog" aria-modal="true" aria-labelledby="document-dialog-title" className={'dj-modal border rounded-sm w-full max-w-3xl max-h-[calc(100vh-5rem)] overflow-y-auto p-5 sm:p-6 space-y-4' + (draft && tab === 'ovt' ? ' ovt-dialog' : '')}>
            <div className="flex items-center justify-between border-b border-[#2e3138] pb-3.5 gap-3"><h2 id="document-dialog-title" className="text-base font-bold flex items-center gap-2 text-[#f3f4f6]"><DocumentJournalIcon name={report ? 'FileText' : 'ClipboardList'} size={18} />{batchOpen ? 'Масові записи · Статус позицій' : historyRow ? 'Історія позиції' : report ? report.title : draft ? (draft.id ? 'Редагування запису' : 'Новий запис') + ' · ' + schema.title : pendingDelete ? 'Видалення запису' : 'Перевірка імпорту Excel'}</h2><button aria-label="Закрити вікно журналу" disabled={busy} className="dj-icon-button" onClick={() => { setDraft(null); setPendingDelete(null); setImportPreview(null); setReport(null); setHistoryRow(null); setBatchOpen(false); }}><DocumentJournalIcon name="X" size={16} /></button></div>
            {report && <div className="space-y-4">{report.date !== undefined && <label className="flex items-center gap-3 text-xs text-[#b8bec8]">Дата витягу<input aria-label="Дата витягу" type="date" className="dj-input tabular-nums" value={report.date} onChange={event => setReport({ ...report, date: event.target.value, text: dailyText(event.target.value) })} /></label>}<p className="text-xs text-[#b8bec8]">Текст сформовано з наявних записів. Перед поданням перевірте та відредагуйте його. Копіювання не ставить галочку ПБД автоматично.</p><textarea aria-label="Текст витягу" value={report.text} onChange={event => setReport({ ...report, text: event.target.value })} className="dj-input w-full font-mono leading-relaxed" rows={16} /><div className="flex justify-end gap-2"><button className={button} onClick={() => setReport(null)}>Закрити</button><button className="dj-button dj-primary" onClick={copyReport}><DocumentJournalIcon name="Copy" size={14} />Копіювати текст</button></div></div>}
            {historyRow && <PositionHistory row={historyRow} register={positionRegister} audit={data.positionAudit || []} onEdit={openRecord} />}
            {batchOpen && <>{notice && <p role="alert" className="text-[#d99b26] text-sm">{notice}</p>}<PositionBatch rows={data.positions} busy={busy} onApply={applyPositionBatch} /></>}
            {draft && <form onSubmit={saveRecord} className={tab === 'ovt' ? 'ovt-form' : 'space-y-4'}>{tab === 'positions' ? <PositionFields draft={draft} setDraft={setDraft} rows={data.positions} busy={busy} /> : tab === 'ovt' ? <OvtFields draft={draft} setDraft={setDraft} rows={data.ovt} busy={busy} /> : <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">{schema.fields.map(([key, title, type, required]) => <label key={key} className={`text-sm ${type === 'textarea' ? 'sm:col-span-2' : ''}`}>
                {type === 'checkbox' ? <span className="flex gap-2 items-center py-2"><input aria-label={title} type="checkbox" disabled={busy} checked={!!draft[key]} onChange={event => setDraft({ ...draft, [key]: event.target.checked })} />{title}</span> : <><span className="block text-[#cbd5e1] mb-1">{title}{required || key === 'date' ? ' *' : ''}</span>{Array.isArray(type) ? <select aria-label={title} className={control} disabled={busy} value={draft[key]} onChange={event => setDraft({ ...draft, [key]: event.target.value })}>{[...new Set([...type, draft[key]])].filter(Boolean).map(option => <option key={option}>{option}</option>)}</select> : type === 'textarea' ? <textarea aria-label={title} className={control} disabled={busy} rows="3" required={required} maxLength={10000} value={draft[key]} onChange={event => setDraft({ ...draft, [key]: event.target.value })} /> : <><input aria-label={title} type={type} className={control} disabled={busy} required={required || key === 'date'} maxLength={1000} value={draft[key]} onChange={event => setDraft({ ...draft, [key]: event.target.value })} list={key === 'position' ? 'ovt-document-names' : key === 'nomenclature' && tab === 'ovt' ? 'nomenclature-list' : undefined} />{key === 'position' && <datalist id="ovt-document-names">{dictionaryOptions('docPlaces', data.ovt.map(row => row.position), draft.position).map(name => <option key={name} value={name} />)}</datalist>}{key === 'nomenclature' && tab === 'ovt' && <datalist id="nomenclature-list">{((prefsRef.current.ovtDict || D.defaultOvtDict)[draft.category] || []).map(opt => <option key={opt} value={opt} />)}</datalist>}</>}</>}
            </label>)}</div>}{formError && <p role="alert" className="text-[#f3a3a0]">{formError}</p>}<div className="flex gap-2 justify-end flex-wrap"><button type="button" disabled={busy} className={button} onClick={() => setDraft(null)}>Скасувати</button>{tab === 'positions' && !draft.id && !draft.multiMode && <button type="button" disabled={busy} className={button} onClick={() => saveRecord(null, true)}>Зберегти і додати ще</button>}<button type="submit" disabled={busy} className="px-4 py-2 rounded-sm bg-[#2b67ab] hover:bg-[#3477c2] border border-[#4c8ed9] text-white font-semibold disabled:opacity-50 tabular-nums">{tab === 'positions' && !draft.id && draft.multiMode ? `Зберегти позицій: ${String(draft.name || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean).length}` : 'Зберегти запис'}</button></div></form>}
            {pendingDelete && <div className="space-y-3"><div className="rounded-sm border border-[#d9534f]/50 bg-[#d9534f]/10 p-3.5 space-y-1.5"><p className="text-sm font-semibold text-[#f3f4f6]">Видалити запис від {D.dateLabel(pendingDelete.date)}: {pendingDelete.name || pendingDelete.task || pendingDelete.nomenclature}?</p><p className="text-xs text-[#f3a3a0]">Для відновлення потрібна раніше збережена резервна копія.</p></div><div className="flex gap-2 justify-end"><button disabled={busy} className={button} onClick={() => setPendingDelete(null)}>Скасувати</button><button disabled={busy} className="h-8 px-3.5 rounded-sm bg-[#d9534f]/20 hover:bg-[#d9534f]/30 border border-[#d9534f]/60 text-[#f3a3a0] text-xs font-semibold cursor-pointer" onClick={async () => { if (await commit(value => { const records = value[tab].filter(row => row.id !== pendingDelete.id); const problem = tab === 'positions' ? positionChangeError(value.positions, records, pendingDelete.id) : ''; if (problem) throw new Error(problem); return { ...value, [tab]: records }; })) { setPendingDelete(null); setNotice('Запис видалено. Відновити його можна з раніше збереженого бекапу.'); } }}>Підтвердити видалення</button></div></div>}
            {importPreview && <><p className="text-sm break-all">Файл: {importPreview.name}</p><p className="tabular-nums">Буде додано: <strong>{importPreview.added}</strong>. Повторів: {importPreview.duplicates}. Некоректних рядків: {importPreview.issues.length}.</p><ul className="space-y-1 text-sm tabular-nums">{D.tabs.map(key => <li key={key}>{D.schemas[key].title}: {importPreview.incoming[key].length}</li>)}</ul>{!!importPreview.positionIssues?.length && <p className="text-sm text-[#d99b26]">Після імпорту {importPreview.positionIssues.length} записів позицій потребуватимуть звірки зв’язків. Історичні записи збережуться; перевірте їх через фільтр «Лише потребують звірки».</p>}<p className="text-sm text-[#cbd5e1]">Імпорт лише доповнює три вкладки. Наявні записи та відмітки ПБД не перезаписуються.</p>{!!importPreview.ignored.length && <p className="text-sm text-[#d99b26]">Не імпортуються аркуші: {importPreview.ignored.join(', ')}.</p>}{!!importPreview.issues.length && <details className="text-sm text-[#d99b26]"><summary>Пропущені рядки — перевірте перед підтвердженням</summary><ul className="mt-2 max-h-40 overflow-auto">{importPreview.issues.map((issue, i) => <li key={i}>{issue}</li>)}</ul></details>}<div className="flex gap-2 justify-end"><button disabled={busy} className={button} onClick={() => setImportPreview(null)}>Скасувати</button><button disabled={busy || !importPreview.added} className="px-4 py-2 rounded-sm bg-[#2b67ab] hover:bg-[#3477c2] border border-[#4c8ed9] text-white font-semibold disabled:opacity-50" onClick={applyImport}>Імпортувати {importPreview.added} записів</button></div></>}
            {busy && <p role="status" className="text-[#4c8ed9] text-sm">Збереження / обробка…</p>}
            {!!notice && <p className="text-sm text-[#d99b26]">{notice}</p>}
        </section></div>}
        {ovtSettingsOpen && <div className="fixed inset-0 z-[16000] bg-black/80 p-3 sm:p-6 flex items-center justify-center overscroll-contain"><section ref={ovtSettingsRef} role="dialog" aria-modal="true" aria-labelledby="ovt-settings-title" className="dj-modal border rounded-sm w-full max-w-2xl max-h-[90vh] overflow-y-auto p-5 sm:p-6 space-y-4 text-[#f3f4f6]">
            <div className="flex items-center justify-between border-b border-[#2e3138] pb-3.5 gap-3"><h2 id="ovt-settings-title" className="text-base font-bold flex items-center gap-2"><DocumentJournalIcon name="Settings" size={18} />Налаштування номенклатури ОВТ</h2><button aria-label="Закрити" disabled={busy} className="dj-icon-button" onClick={() => setOvtSettingsOpen(false)}><DocumentJournalIcon name="X" size={16} /></button></div>
            <p className="text-xs text-[#b8bec8]">Моделі транспорту запам’ятовуються після збереження події та редагуються у «Спільні довідники» → «Шаблони ОВТ» → «Номенклатура / Модель». Нижче — підказки для інших категорій, кожна з нового рядка.</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {['БпЛА', 'Зброя', 'Інше'].map(cat => <label key={cat} className="space-y-1"><span className="text-sm font-semibold" style={{ color: palette[statusTone(cat)] }}>{cat}</span><textarea className={control} rows="3" value={(ovtDictEdit[cat] || []).join('\n')} onChange={e => setOvtDictEdit({ ...ovtDictEdit, [cat]: e.target.value.split('\n').map(s => s.trim()).filter(Boolean) })} /></label>)}
            </div>
            <div className="flex justify-end gap-2"><button type="button" disabled={busy} className={button} onClick={() => setOvtSettingsOpen(false)}>Скасувати</button><button type="button" disabled={busy} className="px-4 py-2 rounded-sm bg-[#2b67ab] hover:bg-[#3477c2] border border-[#4c8ed9] text-white font-semibold disabled:opacity-50" onClick={saveOvtDict}>Зберегти</button></div>
        </section></div>}
    </section>;
};

// --- UNIFIED BACKUP: JSON DATA ONLY, AUTHENTICATED ENCRYPTION ---

export { DocumentJournalIcon, DocumentJournalApp };
