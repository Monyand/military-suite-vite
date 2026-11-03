import { default as React, useState, useRef, useEffect, useMemo } from 'react';
import { DocumentJournal } from '../../core/documents.js';
import { localforage, XLSX } from '../../core/vendor.js';
import { POSITION_CATEGORIES, buildPositionRegister, positionChangeError, withPositionAudit } from './position-register.js';
import { PositionFields } from './PositionFields.jsx';
import { PositionHistory } from './PositionHistory.jsx';
import { useSharedDictionaries } from '../../core/use-shared-dictionaries.js';
import { PositionBatch } from './PositionBatch.jsx';
import { appendPositionBatch } from './position-batch.js';
import { SuiteBackup } from '../../core/backup.js';
import { OvtFields } from './OvtFields.jsx';
import { buildOvtReport } from './ovt-report.js';
import { prepareOvtDraft, ovtCellText } from './ovt-form.js';
import { OVT_STATUSES } from '../../core/ovt-templates.js';
import { SharedDictionaries } from '../../core/dictionary-service.js';

const DocumentJournalIcon = ({ name, size = 16 }) => {
    const nodes = window.lucide?.icons?.[name];
    if (!Array.isArray(nodes)) return null;
    const children = nodes[0] === 'svg' ? nodes[2] : nodes;
    return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0">{children.map(([tag, attrs], i) => React.createElement(tag, { ...attrs, key: i }))}</svg>;
};

const TaskInlineEditor = ({ row, fieldKey, type, options, onSave, disabled, getStyle }) => {
    const [val, setVal] = useState(row[fieldKey] || '');
    useEffect(() => setVal(row[fieldKey] || ''), [row[fieldKey]]);

    if (type === 'checkbox') {
        return <label className="inline-flex items-center gap-2 cursor-pointer whitespace-nowrap"><input type="checkbox" disabled={disabled} checked={!!val} onChange={e => { setVal(e.target.checked); onSave(row, fieldKey, e.target.checked); }} /><span className="dj-tag" style={val ? { background: '#059669', color: '#ecfdf5' } : { background: '#334155', color: '#f8fafc' }}>{val ? 'Подано' : 'Не подано'}</span></label>;
    }
    if (Array.isArray(type)) {
        const customStyle = getStyle ? getStyle(val) : { background: '#1e293b', color: '#e2e8f0', borderColor: '#334155' };
        return <select disabled={disabled} className="dj-tag outline-none cursor-pointer font-bold appearance-none px-2 pr-4 w-full max-w-[150px]" style={{ ...customStyle, backgroundImage: 'url("data:image/svg+xml;charset=US-ASCII,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2214%22%20height%3D%2214%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20stroke%3D%22currentColor%22%20stroke-width%3D%222%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%3E%3Cpath%20d%3D%22M6%209l6%206%206-6%22%2F%3E%3C%2Fsvg%3E")', backgroundRepeat: 'no-repeat', backgroundPosition: 'right 4px center', backgroundSize: '12px' }} value={val} onChange={e => { setVal(e.target.value); onSave(row, fieldKey, e.target.value); }}>{options.map(opt => <option key={opt} value={opt} className="bg-slate-900 text-slate-200">{opt}</option>)}</select>;
    }
    if (type === 'textarea') {
        return <textarea disabled={disabled} className="dj-input p-2 text-xs w-full leading-relaxed resize-y bg-slate-900 focus:bg-slate-800" rows={1} style={{ minHeight: '36px' }} value={val} onChange={e => setVal(e.target.value)} onBlur={e => { if (val !== (row[fieldKey] || '')) onSave(row, fieldKey, val); }} placeholder="Текст..." />;
    }
    if (type === 'date') {
        return <input type="date" disabled={disabled} className="dj-input p-1.5 text-xs w-full font-mono bg-slate-900 focus:bg-slate-800" value={val} onChange={e => { setVal(e.target.value); onSave(row, fieldKey, e.target.value); }} />;
    }
    return <input type="text" disabled={disabled} className="dj-input p-1.5 text-xs w-full bg-slate-900 focus:bg-slate-800" value={val} onChange={e => setVal(e.target.value)} onBlur={e => { if (val !== (row[fieldKey] || '')) onSave(row, fieldKey, val); }} placeholder="..." />;
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
        return entry && entry.latest.id === row.id;
    }), [tab, data?.[tab], viewFilters[tab].from, viewFilters[tab].to, viewFilters[tab].onlyActual, positionRegister, positionEntries]);
    const [periodOpen, setPeriodOpen] = useState(false);
    const [page, setPage] = useState(1);
    const dataRef = useRef(null), lock = useRef(false), fileRef = useRef(null);
    const prefsRef = useRef(D.empty().settings), modalRef = useRef(null);
    const control = 'dj-input w-full';
    const button = 'dj-button';

    useEffect(() => {
        let alive = true;
        localforage.getItem(D.KEY).then(saved => {
            const value = D.validate(D.migrate(saved == null ? D.empty() : saved));
            if (!alive) return;
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
        const last = document.activeElement;
        modalRef.current?.querySelector('input, select, textarea, button')?.focus();
        const keydown = event => {
            if (event.key === 'Escape' && !lock.current) { setDraft(null); setPendingDelete(null); setImportPreview(null); setReport(null); setHistoryRow(null); setBatchOpen(false); }
            if (event.key === 'Tab' && modalRef.current) {
                const items = [...modalRef.current.querySelectorAll('button, input, select, textarea')].filter(el => !el.disabled && el.offsetParent !== null);
                const first = items[0], lastItem = items[items.length - 1];
                if (event.shiftKey && document.activeElement === first) { event.preventDefault(); lastItem?.focus(); }
                else if (!event.shiftKey && document.activeElement === lastItem) { event.preventDefault(); first?.focus(); }
            }
        };
        document.addEventListener('keydown', keydown);
        return () => { document.removeEventListener('keydown', keydown); if (last?.isConnected) last.focus(); };
    }, [!!draft, !!pendingDelete, !!importPreview, !!report, !!historyRow, batchOpen]);

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
    const saveRecord = async event => {
        event.preventDefault();
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
            setDraft(null); setNotice(tab === 'positions' && !D.hasDoc(row) ? 'Запис збережено з червоним нагадуванням: очікується номер донесення.' : 'Запис збережено.');
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
        if (await commit(value => ({ ...value, [tab]: value[tab].map(item => item.id === row.id ? { ...item, [key]: newValue, updatedAt: new Date().toISOString() } : item) }))) setNotice('Поле оновлено.');
    };

    const addTaskRow = async () => {
        if (busy) return;
        const newTask = {
            id: (window.crypto?.randomUUID?.() || ('doc_' + Math.random().toString(36).substring(2) + Date.now().toString(36))),
            date: window.SuiteDates.localISO(),
            task: 'Нове завдання',
            reportedInPbd: false,
            status: 'Заплановано',
            comment: '',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };
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
    const exportExcel = onlyFiltered => {
        try {
            if (!window.XLSX) throw new Error('Бібліотека Excel не завантажена.');
            const workbook = XLSX.utils.book_new();
            (onlyFiltered ? [tab] : D.tabs).forEach(key => {
                const fields = D.schemas[key].fields, records = onlyFiltered ? filteredRecords(key) : data[key];
                const rows = [fields.map(([, title]) => title), ...records.map(row => fields.map(([field, , type]) => field === 'positionId' ? (positionRegister.links.get(row.id) || row.positionId || '') : type === 'checkbox' ? (row[field] ? 'Так' : 'Ні') : type === 'date' ? D.dateLabel(row[field]) : row[field]))];
                const sheet = XLSX.utils.aoa_to_sheet(rows);
                sheet['!cols'] = fields.map(([, , type]) => ({ wch: type === 'textarea' ? 48 : 25 }));
                XLSX.utils.book_append_sheet(workbook, sheet, D.schemas[key].title);
            });
            XLSX.writeFile(workbook, 'Документальний_журнал_' + (onlyFiltered ? tab + '_' : '') + window.SuiteDates.localISO() + '.xlsx');
            setNotice('Excel підготовлено. Це незашифрований звіт; для захищеної копії використовуйте єдиний бекап.');
        } catch (error) { setNotice('Експорт не виконано: ' + error.message); }
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


    if (loadError) return <section id="document-journal" className="p-6 text-slate-100 space-y-3"><h1 className="text-xl font-bold">Документальний журнал</h1><p role="alert" className="text-rose-300">{loadError}</p><p>Редагування вимкнено, щоб не перезаписати наявні дані. Використайте єдиний бекап для відновлення.</p></section>;
    if (!data) return <p className="p-6 text-slate-300" role="status">Завантаження журналу…</p>;
    const schema = D.schemas[tab], options = viewFilters[tab];
    const filteredRecords = key => filteredByTab[key];
    const rows = filteredRecords(tab), totalPages = Math.max(1, Math.ceil(rows.length / (options.pageSize || 50))), shownPage = Math.min(page, totalPages);
    const pageSize = options.pageSize || 50;
    const start = tab === 'tasks' ? Math.max(0, rows.length - shownPage * pageSize) : (shownPage - 1) * pageSize;
    const end = tab === 'tasks' ? rows.length - (shownPage - 1) * pageSize : start + pageSize;
    const visible = rows.slice(start, end);
    const hasPbd = tab !== 'ovt', documentKey = tab === 'positions' ? 'docNumber' : 'urgentDocNo';
    const statusOptions = [...new Set([...schema.fields.find(([key]) => key === 'status')[2], ...data[tab].map(row => row.status)])];
    const ovtOrder = ['date', 'time', 'position', 'category', 'nomenclature', 'status', 'isEvent', 'serialNumber', 'plateNumber', 'urgentDocNo', 'comment'];
    const allFields = tab === 'ovt' ? ovtOrder.map(key => schema.fields.find(field => field[0] === key)) : tab === 'positions' ? ['date', 'name', 'category', 'status', 'docNumber', 'details', 'reportedInPbd'].map(key => schema.fields.find(field => field[0] === key)) : schema.fields;
    const palette = { teal: '#2dd4bf', emerald: '#34d399', blue: '#60a5fa', amber: '#fbbf24', rose: '#fb7185', purple: '#c084fc', slate: '#94a3b8' };
    const tabTheme = { tasks: ['teal', 'Truck'], ovt: ['amber', 'Flame'], positions: ['emerald', 'MapPin'] };
    const tone = palette[tabTheme[tab][0]];
    const tagStyle = color => ({ color: palette[color], background: palette[color] + '18', borderColor: palette[color] + '55' });
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
    const columnTitle = key => ({ date: 'Дата', time: 'Час', position: 'Позиція', nomenclature: 'Модель', isEvent: 'Подія (*)', serialNumber: 'Серійний № / VIN', plateNumber: 'Номер авто', urgentDocNo: 'Позатермінове №', docNumber: 'Позатермінове №', status: tab === 'positions' ? 'Статус / Дія' : 'Статус' }[key]);

    const copyFilteredTasks = async () => {
        if (!rows.length) return;
        const text = rows.map(r => r.task).join('\n');
        try {
            await navigator.clipboard.writeText(text);
            setNotice('Вибірку завдань скопійовано в буфер обміну.');
        } catch {
            setNotice('Не вдалося скопіювати автоматично. Ваш браузер блокує буфер.');
        }
    };

    return <section id="document-journal" data-tab={tab} data-period-open={periodOpen || options.from !== options.to} style={{ '--dj-accent': tone, '--dj-solid': { tasks: '#0d9488', ovt: '#d97706', positions: '#059669' }[tab] }} className="w-full min-w-0 text-slate-200">
        <style>{`
                    #document-journal{min-height:100%;background:radial-gradient(ellipse at 50% 0%,#0d1b38 0%,#020617 70%);padding:0 24px 24px;font-family:Inter,sans-serif}
                    #document-journal .dj-header{margin:0 -24px 20px;padding:16px 24px 0;background:#090e1aeF;backdrop-filter:blur(12px);border-bottom:1px solid #1e293b;box-shadow:0 8px 24px #0003}
                    #document-journal .dj-headline{display:flex;align-items:center;justify-content:space-between;gap:18px;flex-wrap:wrap}
                    #document-journal .dj-logo{display:flex;align-items:center;justify-content:center;width:42px;height:42px;background:linear-gradient(135deg,#10b981,#0f766e);border-radius:12px;box-shadow:0 4px 16px #10b98130;color:white}
                    #document-journal h1{font-size:20px;font-weight:800;letter-spacing:-.025em;line-height:1.3}
                    #document-journal .dj-actions{display:flex;align-items:center;flex-wrap:wrap;gap:8px}
                    #document-journal .dj-button{display:inline-flex;align-items:center;justify-content:center;gap:6px;padding:7px 11px;border:1px solid #334155;border-radius:11px;background:#172237;color:#cbd5e1;font-size:11px;font-weight:600;white-space:nowrap;transition:background .15s,transform .15s}
                    #document-journal .dj-button:hover{background:#25334b;color:white}#document-journal button:disabled{opacity:.4;cursor:not-allowed}
                    #document-journal .dj-blue{background:#2563ebcc;border-color:#3b82f670;color:white}#document-journal .dj-green{background:#059669cc;border-color:#10b98170;color:white}#document-journal .dj-indigo{background:#4f46e5cc;border-color:#6366f170;color:white}
                    #document-journal .dj-primary{background:var(--dj-solid);border-color:var(--dj-solid);color:white;font-weight:700}
                    #document-journal .dj-nav{display:flex;gap:8px;overflow-x:auto;padding:12px 0;margin-top:14px;border-top:1px solid #1e293b}
                    #document-journal .dj-tab{display:flex;align-items:center;gap:10px;white-space:nowrap;padding:11px 16px;border:1px solid #1e293b;border-radius:15px;background:#090e1a;color:#cbd5e1;font-size:12px;font-weight:700;text-transform:uppercase;transition:transform .15s,background .15s}
                    #document-journal .dj-tab:hover{transform:translateY(-1px);border-color:var(--tab-tone)}
                    #document-journal .dj-tab[aria-pressed=true]{background:linear-gradient(135deg,var(--tab-tint),#090e1a);border-color:var(--tab-tone);color:var(--tab-tone);box-shadow:0 4px 18px -3px var(--tab-tint)}
                    #document-journal .dj-tab-count{font-family:'JetBrains Mono',monospace;border-radius:20px;padding:2px 8px;background:var(--tab-tint);color:var(--tab-tone);font-size:11px}
                    #document-journal .dj-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:12px;margin-bottom:14px}
                    #document-journal .dj-stat{text-align:left;background:#090e1a;border:1px solid;border-radius:16px;padding:14px;box-shadow:0 5px 14px #0002;min-height:118px}
                    #document-journal .dj-stat-label{font-size:11px;text-transform:uppercase;color:#94a3b8;font-weight:700;letter-spacing:.035em}
                    #document-journal .dj-stat-number{font:800 26px 'JetBrains Mono',monospace;line-height:1.2;margin-top:5px}
                    #document-journal .dj-stat-hint{font:10px 'JetBrains Mono',monospace;color:#94a3b8;margin-top:7px}
                    #document-journal .dj-stat-icon{padding:7px;border-radius:10px}
                    #document-journal .dj-toolbar{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:12px 14px;border:1px solid #1e293b;border-radius:15px;background:#090e1a;margin:0 0 10px}
                    #document-journal .dj-filter-main,#document-journal .dj-filter-extra{display:contents}
                    #document-journal .dj-filter-main>label{flex:0 1 auto}#document-journal .dj-filter-main>label:first-child{flex:0 1 255px}
                    #document-journal[data-period-open=false] .dj-filter-main>label:nth-child(2),#document-journal[data-period-open=false] .dj-filter-main>label:nth-child(3){display:none}
                    #document-journal .dj-toolbar-actions{display:flex;gap:7px;margin-left:auto;align-items:center}
                    #document-journal .dj-filter-main label>span{display:none}#document-journal .dj-filter-main label:nth-child(2)>span,#document-journal .dj-filter-main label:nth-child(3)>span{display:inline;margin-right:6px;font-size:10px}
                    #document-journal .dj-filter-main label:nth-child(2) input,#document-journal .dj-filter-main label:nth-child(3) input{width:145px}
                    #document-journal .dj-input{padding:8px 10px;border:1px solid #334155;background:#111b2e;color:#e2e8f0;border-radius:10px;font-size:12px;outline:none}
                    #document-journal .dj-input:focus{border-color:var(--dj-accent);box-shadow:0 0 0 2px #ffffff08}#document-journal input[type=checkbox]{accent-color:var(--dj-accent);width:15px;height:15px;flex-shrink:0}
                    #document-journal .dj-table-wrap{overflow:auto;max-height:calc(100vh - 350px);background:#090e1a;border:1px solid #1e293b;border-radius:16px;box-shadow:0 6px 20px #0003;margin-top:12px}
                    #document-journal .dj-table{width:100%;font-size:12px;text-align:left;border-collapse:separate;border-spacing:0}
                    #document-journal .dj-table th{position:sticky;top:0;background:#0f172a;z-index:2;padding:12px;color:#94a3b8;font-weight:600;font-size:11px;white-space:nowrap;border-bottom:1px solid #26344b}
                    #document-journal .dj-table td{padding:12px;border-bottom:1px solid #1e293b88;vertical-align:middle}#document-journal .dj-table tr:last-child td{border-bottom:0}
                    #document-journal .dj-table tbody tr:nth-child(odd){background:#080d1a}#document-journal .dj-table tbody tr:nth-child(even){background:#0c1424}#document-journal .dj-table tbody tr:hover{background:#1e293b80}
                    #document-journal .dj-table tr.dj-marked{background:#3b076424;border-left:2px solid #a855f7}
                    #document-journal .dj-table td[data-field=name],#document-journal .dj-table td[data-field=position]{color:#34d399;font-weight:600;white-space:nowrap}
                    #document-journal .dj-table td[data-field=serialNumber]{color:#fcd34d;font-family:'JetBrains Mono',monospace;white-space:nowrap}
                    #document-journal .dj-table td[data-field=docNumber],#document-journal .dj-table td[data-field=urgentDocNo]{color:#a5b4fc;font-family:'JetBrains Mono',monospace;white-space:nowrap}
                    #document-journal .dj-table td[data-field=nomenclature]{color:white;font-family:'JetBrains Mono',monospace;font-weight:700;white-space:nowrap}
                    #document-journal .dj-tag{display:inline-flex;align-items:center;gap:5px;font:600 10px 'JetBrains Mono',monospace;padding:4px 7px;border:1px solid;border-radius:6px;white-space:nowrap}
                    #document-journal .dj-icon-button{display:inline-flex;align-items:center;justify-content:center;padding:7px;border-radius:8px;color:#94a3b8}#document-journal .dj-icon-button:hover{background:#1e293b;color:var(--dj-accent)}
                    #document-journal .dj-footer{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:12px;padding-top:14px;color:#64748b;font:10px 'JetBrains Mono',monospace}
                    #document-journal .dj-modal{background:#090e1a;border-color:#334155;box-shadow:0 24px 80px #0009}
                    @media(prefers-reduced-motion:reduce){#document-journal .dj-tab,#document-journal .dj-button{transition:none}}
                    @media(max-width:800px){#document-journal{padding:0 12px 16px}#document-journal .dj-header{margin:0 -12px 14px;padding:14px 12px 0}#document-journal .dj-stats{grid-template-columns:repeat(2,minmax(0,1fr))}#document-journal .dj-filter-main>label:first-child{max-width:none}#document-journal .dj-tab{padding:10px 12px}}
                    #document-journal .dj-position-categories .dj-stat{min-height:100px}
                    #document-journal .dj-stat[aria-pressed=true]{outline:2px solid var(--dj-accent);outline-offset:-2px;background:#0b272a}
                    #document-journal .dj-table tbody tr.dj-missing-doc{background:#451a1a;animation:dj-document-reminder 2.8s ease-in-out infinite}
                    #document-journal .dj-table tbody tr.dj-missing-doc td:first-child{border-left:3px solid #fb7185}
                    @keyframes dj-document-reminder{0%,100%{background-color:#361822}50%{background-color:#662331}}
                    @media(prefers-reduced-motion:reduce){#document-journal .dj-table tbody tr.dj-missing-doc{animation:none;background:#451a1a}}
                `}</style>
        <header className="dj-header">
            <div className="dj-headline"><div className="flex items-center gap-3"><div className="dj-logo"><DocumentJournalIcon name={tabTheme[tab][1]} size={22} /></div><div><div className="flex items-center gap-2 flex-wrap"><h1>{schema.title}</h1><span className="dj-tag" style={tagStyle(tabTheme[tab][0])}>ЖБД · ОБЛІК</span></div><p className="text-xs text-slate-400 mt-1">Документальний журнал</p></div></div>
                <div className="dj-actions"><input ref={fileRef} aria-label="Імпорт Excel документального журналу" type="file" accept=".xlsx,.xls" className="hidden" onChange={event => { const file = event.target.files[0]; event.target.value = ''; chooseImport(file); }} /><button aria-label="Імпорт Excel" disabled={busy} className="dj-button dj-blue" onClick={() => fileRef.current.click()}><DocumentJournalIcon name="FileUp" size={14} />Імпорт (.xlsx)</button><button aria-label="Експорт трьох вкладок" disabled={busy} className="dj-button dj-green" onClick={() => exportExcel(false)}><DocumentJournalIcon name="FileDown" size={14} />Експорт (.xlsx)</button><button disabled={busy} className="dj-button dj-indigo" onClick={openDailyReport}><DocumentJournalIcon name="FileText" size={14} />Добовий витяг</button>{tab === 'ovt' && <button aria-label="Налаштування номенклатури ОВТ" disabled={busy} className="dj-button" style={{ borderColor: 'var(--dj-accent)', color: 'var(--dj-accent)' }} onClick={() => { setOvtDictEdit(prefsRef.current.ovtDict || D.defaultOvtDict); setOvtSettingsOpen(true); }}><DocumentJournalIcon name="Settings" size={14} />Налаштування ОВТ</button>}<button className={button} onClick={() => onBackup?.('export')}><DocumentJournalIcon name="Database" size={14} />Бекап & БД</button></div>
            </div>
        </header>
        {notice && <div role="status" className="flex justify-between gap-3 p-3 rounded-xl bg-slate-900 border border-slate-700 text-sm"><span>{notice}</span><button aria-label="Закрити повідомлення журналу" onClick={() => setNotice('')}>×</button></div>}
        <div className="dj-stats" data-testid="document-action-cards">{cards.map(([title, value, hint, icon, color, filter]) => {
            const isFilterable = Object.keys(filter).length > 0;
            const CardTag = isFilterable ? 'button' : 'div';
            const isActive = isFilterable && Object.entries(filter).every(([k, v]) => options[k] === v);
            return <CardTag key={title} className="dj-stat" style={{ borderColor: palette[color] + '44', ...(isFilterable ? { cursor: 'pointer' } : {}) }} {...(isFilterable ? {
                type: 'button', 'aria-pressed': isActive, onClick: () => {
                    const newFilter = {};
                    for (const key of Object.keys(filter)) newFilter[key] = isActive ? D.filters()[key] : filter[key];
                    changeFilter(newFilter);
                }, title: 'Фільтрувати записи: ' + title
            } : {})}><div className="flex items-center justify-between gap-2"><span className="dj-stat-label">{title}</span><span className="dj-stat-icon" style={tagStyle(color)}><DocumentJournalIcon name={icon} /></span></div><div className="dj-stat-number" style={{ color: palette[color] }}>{value}</div><p className="dj-stat-hint">{hint}</p></CardTag>;
        })}</div>
        {tab === 'positions' && <>
            <div className="dj-stats dj-position-categories" data-testid="position-category-cards">{D.positionCategoryCards.map(category => <button type="button" key={category} aria-pressed={options.category === category} onClick={() => changeFilter({ category: options.category === category ? '' : category })} className="dj-stat" style={{ borderColor: '#334155' }}><span className="dj-stat-label">{category}</span><div className="dj-stat-number text-emerald-300">{periodRows.filter(row => D.matchesPositionCategory(row.category, category)).length}</div><p className="dj-stat-hint">{category === 'ОВгП' ? 'мінометні + вогневі · записів' : 'записів за період'}</p></button>)}</div>
            <div className="mb-4 rounded-xl border border-slate-700 bg-slate-900/70 p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-sm font-bold text-emerald-300">Звірка документального реєстру</h2><p className="text-xs text-slate-400 mt-1">Картки рахують записи за період. Історія пов’язує документи, а не підтверджує фактичний стан позиції.</p></div><label className="text-xs text-slate-400 space-y-1"><span className="block">Відкрити історію позиції</span><select aria-label="Відкрити історію позиції" className="dj-input max-w-full" value="" onChange={event => { const entry = positionRegister.entries.find(item => item.id === event.target.value); if (entry) { setNotice(''); setHistoryRow(entry.records[0]); } }}><option value="">Реєстр виставлень ({positionRegister.entries.length})</option>{positionRegister.entries.map(entry => <option key={entry.id} value={entry.id}>{entry.name} · {D.dateLabel(entry.records[0].date)} · № {entry.records[0].docNumber || 'очікується'}</option>)}</select></label></div>
                <div className="flex flex-wrap gap-2">
                    <button className="dj-button" style={tagStyle('rose')} onClick={() => changePrefs(tab, { ...viewFilters, [tab]: { ...D.filters(), missingDoc: true } })}>Без номера донесення: {data.positions.filter(row => !D.hasDoc(row)).length}</button>
                    <button className="dj-button" style={tagStyle('amber')} onClick={() => changePrefs(tab, { ...viewFilters, [tab]: { ...D.filters(), needsReview: true } })}>Потребує звірки: {positionRegister.issues.size}</button>
                    <button className="dj-button" onClick={() => changeFilter({ category: '__uncategorized' })}>Без категорії: {periodRows.filter(row => !row.category).length}</button>
                </div>
            </div>
        </>}
        <div className="dj-toolbar">
            <div className="dj-filter-main">
                <label className="text-xs text-slate-400 space-y-1"><span>Пошук у документах</span><input aria-label="Пошук у документах" className={control} value={options.search} onChange={event => changeFilter({ search: event.target.value })} placeholder="Назва, номер донесення, примітка…" /></label>
                <div className="text-xs text-slate-400 space-y-1"><span>Період</span><div className="flex items-center gap-1"><input aria-label="Дата від" type="date" className={control} value={options.from} onChange={event => changeFilter({ from: event.target.value })} /><span className="text-slate-600">-</span><input aria-label="Дата до" type="date" className={control} value={options.to} onChange={event => changeFilter({ to: event.target.value })} /></div></div>
                <div className="flex gap-1 self-end pb-1">
                    {[['За добу', 0], ['3 дні', 2], ['7 днів', 6]].map(([lbl, days]) => <button key={lbl} aria-label={lbl} onClick={() => changeFilter(window.SuiteDates.recent(days))} className="px-2 py-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10px] uppercase font-bold transition-colors">{lbl}</button>)}
                    <button aria-label="Скинути" title="Скинути період" onClick={() => changeFilter({ from: '', to: '' })} className="px-2 py-1.5 rounded bg-slate-800/50 hover:bg-slate-800 text-slate-500 text-[10px] uppercase font-bold transition-colors"><DocumentJournalIcon name="X" size={12} /></button>
                </div>
                <label className="text-xs text-slate-400 space-y-1"><span>Статус / Дія</span><select aria-label="Фільтр статусу журналу" className={control} value={options.status} onChange={event => changeFilter({ status: event.target.value })}><option value="">Усі статуси</option>{statusOptions.map(status => <option key={status}>{status}</option>)}</select></label>
            </div>
            <div className="dj-filter-extra text-xs">
                <label className="flex items-center gap-2 text-slate-400">Показувати:<select aria-label="Рядків на сторінці" className={button} value={options.pageSize || 50} onChange={event => changeFilter({ pageSize: parseInt(event.target.value, 10) || 50 })}><option value={20}>20 рядків</option><option value={50}>50 рядків</option><option value={100}>100 рядків</option><option value={500}>500 рядків</option></select></label>
                {hasPbd && <label className="flex items-center gap-2"><input type="checkbox" checked={options.unreported} onChange={event => changeFilter({ unreported: event.target.checked })} />Лише не подані в ПБД</label>}
                {tab !== 'tasks' && <label className="flex items-center gap-2"><input type="checkbox" checked={options.missingDoc} onChange={event => changeFilter({ missingDoc: event.target.checked })} />Лише без номера донесення</label>}
                {tab === 'positions' && <><label className="flex items-center gap-2"><input type="checkbox" checked={options.onlyActual} onChange={event => changeFilter({ onlyActual: event.target.checked })} />Лише актуальні</label><label className="flex items-center gap-2"><input type="checkbox" checked={options.needsReview} onChange={event => changeFilter({ needsReview: event.target.checked })} />Лише потребують звірки</label><select aria-label="Фільтр категорії позицій" className={button} value={options.category} onChange={event => changeFilter({ category: event.target.value })}><option value="">Усі категорії позицій</option><option value="ОВгП">ОВгП — мінометні та вогневі</option>{POSITION_CATEGORIES.map(category => <option key={category}>{category}</option>)}<option value="__uncategorized">Без категорії</option></select></>}
                {tab === 'ovt' && <select aria-label="Фільтр категорії ОВТ" className={button} value={options.category} onChange={event => changeFilter({ category: event.target.value })}><option value="">Усі категорії</option>{[...new Set([...schema.fields.find(([key]) => key === 'category')[2], ...data.ovt.map(row => row.category)])].filter(Boolean).map(category => <option key={category}>{category}</option>)}</select>}
                {tab === 'ovt' && <select aria-label="Фільтр помітки ОВТ" className={button} value={options.event} onChange={event => changeFilter({ event: event.target.value })}><option value="">Усі записи ОВТ</option><option value="real">Без помітки *</option><option value="marked">З поміткою *</option></select>}
                <button onClick={() => changePrefs(tab, { ...viewFilters, [tab]: D.filters() })} className="text-teal-300 underline">Скинути фільтри</button>
            </div>
            <div className="dj-toolbar-actions">
                {tab === 'positions' && <button type="button" disabled={busy} onClick={() => { setNotice(''); setBatchOpen(true); }} className="dj-button dj-indigo"><DocumentJournalIcon name="ListPlus" size={14} />Масове внесення / перейменування</button>}
                {tab === 'tasks' && <button type="button" disabled={busy || !rows.length} onClick={copyFilteredTasks} className="dj-button dj-indigo px-4 py-2" title="Копіювати текст усіх показаних завдань"><DocumentJournalIcon name="Copy" size={16} /> Копіювати текст завдань</button>}
                <button type="button" disabled={busy || !rows.length} onClick={() => exportExcel(true)} className="dj-button dj-green px-4 py-2" title="Згенерувати Excel звіт по вибірці"><DocumentJournalIcon name="FileDown" size={16} /> Експорт вибірки</button>
                {tab !== 'tasks' && <button aria-label="Додати запис" disabled={busy} onClick={() => openRecord(null)} className="dj-button dj-primary"><DocumentJournalIcon name="Plus" size={14} />{tab === 'ovt' ? 'Додати запис ОВТ' : 'Додати подію позиції'}</button>}
            </div>
            {options.from && options.to && options.from > options.to && <p role="alert" className="text-amber-300 text-sm">Дата «від» пізніша за дату «до». Перевірте період.</p>}
        </div>
        <div className="text-[10px] font-mono text-slate-500 flex justify-between"><h2>{schema.title} · показано <b style={{ color: tone }}>{rows.length}</b> із {data[tab].length}</h2><span>{options.from || options.to ? 'За обраний період' : 'За весь період'}</span></div>
        <div className="dj-table-wrap">
            <table className="dj-table" data-testid="document-journal-table"><thead><tr><th className="text-center w-10">#</th>{allFields.map(([key, title]) => <th key={key} style={tab === 'tasks' ? (key === 'date' ? { width: '130px' } : key === 'task' ? { width: 'auto' } : key === 'reportedInPbd' ? { width: '110px' } : key === 'status' ? { width: '150px' } : key === 'comment' ? { width: '30%' } : {}) : {}}>{columnTitle(key) || title}</th>)}<th className="text-right w-16">Дії</th></tr></thead><tbody>{visible.map((row, index) => <tr key={row.id} data-document-id={row.id} className={tab === 'positions' && !D.hasDoc(row) ? 'dj-missing-doc' : row.isEvent ? 'dj-marked' : ''}><td className="text-center text-slate-500 font-mono">{(shownPage - 1) * (options.pageSize || 50) + index + 1}</td>{allFields.map(([key, , type]) => <td key={key} data-field={key} className={type === 'textarea' && tab !== 'tasks' ? 'min-w-[200px] max-w-md whitespace-pre-wrap break-words' : tab === 'tasks' ? 'p-1' : ''}>
                {tab === 'tasks' ? <TaskInlineEditor row={row} fieldKey={key} type={type} options={Array.isArray(type) ? [...new Set([...type, row[key]])].filter(Boolean) : null} onSave={changeField} disabled={busy} getStyle={key === 'status' ? val => tagStyle(statusTone(val)) : null} /> :
                    key === 'name' && tab === 'positions' ? <span className="inline-flex flex-col gap-1"><span>{row.name}</span>{row.newName && <span className="text-xs text-purple-300">→ {row.newName || 'нова назва не вказана'}</span>}{row.destinationPositionId && <span className="text-xs text-cyan-300">на місце: {row.destinationName || 'зв’язок із записом'}</span>}</span> : key === 'reportedInPbd' ? <label className="inline-flex items-center gap-2 cursor-pointer whitespace-nowrap"><input type="checkbox" aria-label={`Подано в ПБД: ${row.name || row.task}`} disabled={busy} checked={row.reportedInPbd} onChange={() => togglePbd(row)} /><span className="dj-tag" style={tagStyle(row.reportedInPbd ? 'emerald' : 'slate')}>{row.reportedInPbd ? 'Подано' : 'Не подано'}</span></label> : type === 'checkbox' ? <span className="dj-tag" style={tagStyle(row[key] ? 'purple' : 'emerald')}>{row[key] ? '★ Подія (*)' : '● Реальна'}</span> : type === 'date' ? <span className="font-mono font-semibold whitespace-nowrap">{D.dateLabel(row[key])}</span> : key === 'status' && tab === 'positions' ? <div className="space-y-1"><span className="dj-tag" style={tagStyle(statusTone(row.status))}>{row.status}</span>{positionRegister.issues.has(row.id) && <p className="text-amber-300 text-[10px] max-w-[250px]" title={positionRegister.issues.get(row.id)}>⚠ Потребує звірки</p>}</div> : key === 'status' && Array.isArray(type) ? <select aria-label={`Статус: ${row.name || row.task || ''}`} value={row[key]} onChange={e => changeField(row, key, e.target.value)} disabled={busy} className="dj-tag bg-transparent outline-none cursor-pointer font-bold appearance-none px-2 pr-4" style={{ ...tagStyle(statusTone(row[key])), backgroundImage: 'url("data:image/svg+xml;charset=US-ASCII,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2214%22%20height%3D%2214%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20stroke%3D%22currentColor%22%20stroke-width%3D%222%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%3E%3Cpath%20d%3D%22M6%209l6%206%206-6%22%2F%3E%3C%2Fsvg%3E")', backgroundRepeat: 'no-repeat', backgroundPosition: 'right 4px center', backgroundSize: '12px' }}>{(tab === 'ovt' && row.category === 'Транспорт' ? [...new Set([...OVT_STATUSES, row.status])] : type).map(opt => <option key={opt} value={opt} className="bg-slate-900 text-slate-200">{opt}</option>)}</select> : key === 'category' ? <span className="dj-tag" style={tagStyle(statusTone(row[key]))}><span className="w-1.5 h-1.5 rounded-full" style={{ background: 'currentColor' }} />{row[key] || 'Не визначено'}</span> : key === documentKey && !D.hasDoc(row) ? <span className={tab === 'positions' ? 'text-rose-200 font-bold' : 'text-amber-300'}>{tab === 'positions' ? '⚠ Очікується номер' : (row[key] || 'Не вказано')}</span> : ((tab === 'ovt' ? ovtCellText(row, key) : row[key]) || '—')}
            </td>)}<td><div className="flex gap-1 justify-end items-center">{tab === 'positions' && <button className="dj-button" title="Історія позиції за всіма документами" aria-label={`Історія позиції ${row.id}`} onClick={() => { setNotice(''); setHistoryRow(row); }}><DocumentJournalIcon name="History" size={14} />Історія</button>}{tab === 'ovt' && <button title="Сформувати позатермінове донесення" aria-label={`Позатермінове донесення ${row.id}`} onClick={() => openOvtReport(row)} className="dj-button" style={tagStyle('amber')}><DocumentJournalIcon name="Zap" size={12} />Позатерм.</button>}{tab !== 'tasks' && <button disabled={busy} title="Редагувати" aria-label={`Редагувати запис ${row.id}`} className="dj-icon-button" onClick={() => openRecord(row)}><DocumentJournalIcon name="SquarePen" size={15} /></button>}<button disabled={busy} title="Видалити" aria-label={`Видалити запис ${row.id}`} className="dj-icon-button" onClick={() => setPendingDelete(row)}><DocumentJournalIcon name="Trash2" size={15} /></button></div></td></tr>)}
                {!rows.length && <tr><td colSpan={allFields.length + 2} className="p-10 text-center text-slate-500 italic">{data[tab].length ? 'За цими фільтрами записів немає.' : 'Записів ще немає. Додайте запис або імпортуйте Excel із попередньої програми.'}</td></tr>}
                {tab === 'tasks' && (
                    <tr>
                        <td colSpan={allFields.length + 2} className="p-2 text-center">
                            <button type="button" onClick={addTaskRow} disabled={busy} className="dj-button w-full justify-center bg-slate-800/50 hover:bg-slate-700/50 border border-dashed border-slate-600 text-slate-400 py-2">
                                <DocumentJournalIcon name="Plus" size={16} /> Додати нове завдання
                            </button>
                        </td>
                    </tr>
                )}
            </tbody></table>
        </div>
        <footer className="dj-footer"><p className="flex items-center gap-2"><DocumentJournalIcon name="Database" size={12} />Локальна база · записи та налаштування входять до єдиного AES-256 бекапу</p><div className="flex items-center gap-3"><button className={button} disabled={shownPage <= 1} onClick={() => setPage(shownPage - 1)}>Назад</button><span>{shownPage} / {totalPages}</span><button className={button} disabled={shownPage >= totalPages} onClick={() => setPage(shownPage + 1)}>Далі</button></div></footer>
        {(draft || pendingDelete || importPreview || report || historyRow || batchOpen) && <div className="fixed inset-0 z-[15000] bg-black/80 backdrop-blur-sm p-3 sm:p-6 flex items-center justify-center"><section ref={modalRef} role="dialog" aria-modal="true" aria-labelledby="document-dialog-title" className={'dj-modal border rounded-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto p-5 sm:p-6 space-y-4' + (draft && tab === 'ovt' ? ' ovt-dialog' : '')}>
            <div className="flex items-center justify-between border-b border-slate-800 pb-4 gap-3"><h2 id="document-dialog-title" className="text-lg font-bold flex items-center gap-2"><DocumentJournalIcon name={report ? 'FileText' : 'ClipboardList'} size={20} />{batchOpen ? 'Масові записи · Статус позицій' : historyRow ? 'Історія позиції' : report ? report.title : draft ? (draft.id ? 'Редагування запису' : 'Новий запис') + ' · ' + schema.title : pendingDelete ? 'Видалення запису' : 'Перевірка імпорту Excel'}</h2><button aria-label="Закрити вікно журналу" disabled={busy} className="dj-icon-button" onClick={() => { setDraft(null); setPendingDelete(null); setImportPreview(null); setReport(null); setHistoryRow(null); setBatchOpen(false); }}><DocumentJournalIcon name="X" size={18} /></button></div>
            {report && <div className="space-y-4">{report.date !== undefined && <label className="flex items-center gap-3 text-xs text-slate-400">Дата витягу<input aria-label="Дата витягу" type="date" className="dj-input" value={report.date} onChange={event => setReport({ ...report, date: event.target.value, text: dailyText(event.target.value) })} /></label>}<p className="text-xs text-slate-400">Текст сформовано з наявних записів. Перед поданням перевірте та відредагуйте його. Копіювання не ставить галочку ПБД автоматично.</p><textarea aria-label="Текст витягу" value={report.text} onChange={event => setReport({ ...report, text: event.target.value })} className="dj-input w-full font-mono leading-relaxed" rows={16} /><div className="flex justify-end gap-2"><button className={button} onClick={() => setReport(null)}>Закрити</button><button className="dj-button dj-indigo" onClick={copyReport}><DocumentJournalIcon name="Copy" size={14} />Копіювати текст</button></div></div>}
            {historyRow && <PositionHistory row={historyRow} register={positionRegister} audit={data.positionAudit || []} onEdit={openRecord} />}
            {batchOpen && <>{notice && <p role="alert" className="text-amber-300 text-sm">{notice}</p>}<PositionBatch rows={data.positions} busy={busy} onApply={applyPositionBatch} /></>}
            {draft && <form onSubmit={saveRecord} className={tab === 'ovt' ? 'ovt-form' : 'space-y-4'}>{tab === 'positions' ? <PositionFields draft={draft} setDraft={setDraft} rows={data.positions} busy={busy} /> : tab === 'ovt' ? <OvtFields draft={draft} setDraft={setDraft} rows={data.ovt} modelOptions={(() => { const templates = SharedDictionaries.ovtTemplates(); return [...new Set(templates.models.filter(m => (m.category || 'Транспорт') === draft.category).map(m => typeof m === 'string' ? m : m.name))]; })()} busy={busy} /> : <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">{schema.fields.map(([key, title, type, required]) => <label key={key} className={`text-sm ${type === 'textarea' ? 'sm:col-span-2' : ''}`}>
                {type === 'checkbox' ? <span className="flex gap-2 items-center py-2"><input aria-label={title} type="checkbox" disabled={busy} checked={!!draft[key]} onChange={event => setDraft({ ...draft, [key]: event.target.checked })} />{title}</span> : <><span className="block text-slate-300 mb-1">{title}{required || key === 'date' ? ' *' : ''}</span>{Array.isArray(type) ? <select aria-label={title} className={control} disabled={busy} value={draft[key]} onChange={event => setDraft({ ...draft, [key]: event.target.value })}>{[...new Set([...type, draft[key]])].filter(Boolean).map(option => <option key={option}>{option}</option>)}</select> : type === 'textarea' ? <textarea aria-label={title} className={control} disabled={busy} rows="3" required={required} maxLength={10000} value={draft[key]} onChange={event => setDraft({ ...draft, [key]: event.target.value })} /> : <><input aria-label={title} type={type} className={control} disabled={busy} required={required || key === 'date'} maxLength={1000} value={draft[key]} onChange={event => setDraft({ ...draft, [key]: event.target.value })} list={key === 'position' ? 'ovt-document-names' : key === 'nomenclature' && tab === 'ovt' ? 'nomenclature-list' : undefined} />{key === 'position' && <datalist id="ovt-document-names">{dictionaryOptions('docPlaces', data.ovt.map(row => row.position), draft.position).map(name => <option key={name} value={name} />)}</datalist>}{key === 'nomenclature' && tab === 'ovt' && <datalist id="nomenclature-list">{((prefsRef.current.ovtDict || D.defaultOvtDict)[draft.category] || []).map(opt => <option key={opt} value={opt} />)}</datalist>}</>}</>}
            </label>)}</div>}{formError && <p role="alert" className="text-rose-300">{formError}</p>}<div className="flex gap-2 justify-end"><button type="button" disabled={busy} className={button} onClick={() => setDraft(null)}>Скасувати</button><button type="submit" disabled={busy} className="px-4 py-2 rounded-lg bg-teal-500 text-slate-950 font-bold disabled:opacity-50">Зберегти запис</button></div></form>}
            {pendingDelete && <><p>Видалити запис від {D.dateLabel(pendingDelete.date)}: {pendingDelete.name || pendingDelete.task || pendingDelete.nomenclature}?</p><p className="text-sm text-slate-400">Для відновлення потрібна раніше збережена резервна копія.</p><div className="flex gap-2 justify-end"><button disabled={busy} className={button} onClick={() => setPendingDelete(null)}>Скасувати</button><button disabled={busy} className="px-4 py-2 rounded-lg bg-rose-700 font-bold" onClick={async () => { if (await commit(value => { const records = value[tab].filter(row => row.id !== pendingDelete.id); const problem = tab === 'positions' ? positionChangeError(value.positions, records, pendingDelete.id) : ''; if (problem) throw new Error(problem); return { ...value, [tab]: records }; })) { setPendingDelete(null); setNotice('Запис видалено. Відновити його можна з раніше збереженого бекапу.'); } }}>Підтвердити видалення</button></div></>}
            {importPreview && <><p className="text-sm break-all">Файл: {importPreview.name}</p><p>Буде додано: <strong>{importPreview.added}</strong>. Повторів: {importPreview.duplicates}. Некоректних рядків: {importPreview.issues.length}.</p><ul className="space-y-1 text-sm">{D.tabs.map(key => <li key={key}>{D.schemas[key].title}: {importPreview.incoming[key].length}</li>)}</ul>{!!importPreview.positionIssues?.length && <p className="text-sm text-amber-300">Після імпорту {importPreview.positionIssues.length} записів позицій потребуватимуть звірки зв’язків. Історичні записи збережуться; перевірте їх через фільтр «Лише потребують звірки».</p>}<p className="text-sm text-teal-200">Імпорт лише доповнює три вкладки. Наявні записи та відмітки ПБД не перезаписуються.</p>{!!importPreview.ignored.length && <p className="text-sm text-amber-300">Не імпортуються аркуші: {importPreview.ignored.join(', ')}.</p>}{!!importPreview.issues.length && <details className="text-sm text-amber-300"><summary>Пропущені рядки — перевірте перед підтвердженням</summary><ul className="mt-2 max-h-40 overflow-auto">{importPreview.issues.map((issue, i) => <li key={i}>{issue}</li>)}</ul></details>}<div className="flex gap-2 justify-end"><button disabled={busy} className={button} onClick={() => setImportPreview(null)}>Скасувати</button><button disabled={busy || !importPreview.added} className="px-4 py-2 rounded-lg bg-teal-500 text-slate-950 font-bold disabled:opacity-50" onClick={applyImport}>Імпортувати {importPreview.added} записів</button></div></>}
            {busy && <p role="status" className="text-teal-300 text-sm">Збереження / обробка…</p>}
            {!!notice && <p className="text-sm text-amber-200">{notice}</p>}
        </section></div>}
        {ovtSettingsOpen && <div className="fixed inset-0 z-[16000] bg-black/80 backdrop-blur-sm p-3 sm:p-6 flex items-center justify-center"><section role="dialog" aria-modal="true" aria-labelledby="ovt-settings-title" className="dj-modal border rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto p-5 sm:p-6 space-y-4 text-slate-200">
            <div className="flex items-center justify-between border-b border-slate-800 pb-4 gap-3"><h2 id="ovt-settings-title" className="text-lg font-bold flex items-center gap-2"><DocumentJournalIcon name="Settings" size={20} />Налаштування номенклатури ОВТ</h2><button aria-label="Закрити" disabled={busy} className="dj-icon-button" onClick={() => setOvtSettingsOpen(false)}><DocumentJournalIcon name="X" size={18} /></button></div>
            <p className="text-xs text-slate-400">Моделі транспорту запам’ятовуються після збереження події та редагуються у «Спільні довідники» → «Шаблони ОВТ» → «Номенклатура / Модель». Нижче — підказки для інших категорій, кожна з нового рядка.</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {['БпЛА', 'Зброя', 'Інше'].map(cat => <label key={cat} className="space-y-1"><span className="text-sm font-bold" style={{ color: palette[statusTone(cat)] }}>{cat}</span><textarea className={control} rows="3" value={(ovtDictEdit[cat] || []).join('\n')} onChange={e => setOvtDictEdit({ ...ovtDictEdit, [cat]: e.target.value.split('\n').map(s => s.trim()).filter(Boolean) })} /></label>)}
            </div>
            <div className="flex justify-end gap-2"><button type="button" disabled={busy} className={button} onClick={() => setOvtSettingsOpen(false)}>Скасувати</button><button type="button" disabled={busy} className="px-4 py-2 rounded-lg bg-teal-500 text-slate-950 font-bold disabled:opacity-50" onClick={saveOvtDict}>Зберегти</button></div>
        </section></div>}
    </section>;
};

// --- UNIFIED BACKUP: JSON DATA ONLY, AUTHENTICATED ENCRYPTION ---

export { DocumentJournalIcon, DocumentJournalApp };
