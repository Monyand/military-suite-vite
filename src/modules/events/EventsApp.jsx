import { default as React, useRef, useEffect, useState, useMemo } from 'react';
import { Chart, localforage, ExcelJS } from '../../core/vendor.js';
import { MedicalDailyTotals } from '../../core/medical-totals.js';
import { useSharedDictionaries } from '../../core/use-shared-dictionaries.js';
import { AssaultReportModal } from './AssaultReportModal.jsx';
import { isCompletedAssault } from './assault-report.js';
import { PersonnelView } from './PersonnelView.jsx';
import { escapeHtml } from '../../core/html.js';

const EventsApp = (function() {
            

        const DEFAULT_WEAPONS = [
            "Стрілецька зброя", "ФПВ", "ФПВ (оптоволокно)", "Скид СВП", 
            "Скид з важкого бомбера", "Міномет 82мм", "Міномет 120мм", 
            "Ствольна артилерія", "Міни/Розтяжки", "Невідомо"
        ];
        
        const DEFAULT_POSITIONS = ["Позиція 'Альфа'", "Позиція 'Браво'", "Спостережник 1"];
        
        const EVENT_TYPES = {
            UDP: 'УПД',
            ASSAULT: 'ШД',
            OTHER: 'Інші ураження'
        };

        const Icon = React.memo(({ name, className }) => {
            if (!window.lucide || !window.lucide.icons) return null;
            
            // Convert kebab-case to PascalCase: 'edit-2' -> 'Edit2', 'trash-2' -> 'Trash2', 'eye' -> 'Eye'
            const pascalName = name.split('-').map(s => s.charAt(0).toUpperCase() + s.slice(1)).join('');
            const iconData = window.lucide.icons[pascalName] || window.lucide.icons[name];
            if (!iconData) return null;
            
            // Older Lucide versions wrap nodes in ["svg", attrs, nodes]; newer
            // versions expose the node list directly. Accept both formats.
            const elements = iconData[0] === 'svg' ? iconData[2] : iconData;
            if (!Array.isArray(elements)) return null;
            
            const children = elements.map((el, i) => {
                const [tag, attrs] = el;
                // Convert SVG attributes to React-compatible camelCase
                const reactAttrs = {};
                if (attrs) {
                    Object.entries(attrs).forEach(([k, v]) => {
                        if (k === 'stroke-width') reactAttrs.strokeWidth = v;
                        else if (k === 'stroke-linecap') reactAttrs.strokeLinecap = v;
                        else if (k === 'stroke-linejoin') reactAttrs.strokeLinejoin = v;
                        else if (k === 'fill-rule') reactAttrs.fillRule = v;
                        else if (k === 'clip-rule') reactAttrs.clipRule = v;
                        else reactAttrs[k] = v;
                    });
                }
                return React.createElement(tag, { key: i, ...reactAttrs });
            });
            
            return React.createElement('svg', {
                xmlns: 'http://www.w3.org/2000/svg',
                width: 24,
                height: 24,
                viewBox: '0 0 24 24',
                fill: 'none',
                stroke: 'currentColor',
                strokeWidth: 2,
                strokeLinecap: 'round',
                strokeLinejoin: 'round',
                className: className
            }, ...children);
        });

        // --- ДОПОМІЖНІ ФУНКЦІЇ ---
        const generateId = () => 'evt_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        const parseSafeDate = (dStr) => {
            if (!dStr) return 0;
            const t = new Date(dStr).getTime();
            return isNaN(t) ? 0 : t;
        };

        const pad2 = n => String(n).padStart(2, '0');
        const toISODate = (d) => `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`;
        const todayISO = () => toISODate(new Date());
        const addDaysISO = (iso, days) => {
            const d = iso ? new Date(iso + 'T12:00:00') : new Date();
            d.setDate(d.getDate() + days);
            return toISODate(d);
        };
        const formatDateUA = (iso) => {
            if (!iso) return '';
            const [y, m, d] = iso.split('-');
            return `${d}.${m}.${y}`;
        };
        const getEventDateStr = (ev) => ev?.actionDetails?.startDate || (ev?.createdAt ? window.SuiteDates.localISO(new Date(ev.createdAt)) : '');
        const eventMatchesQuery = (ev, q) => {
            if (!q) return true;
            const s = q.toLowerCase().trim();
            const chunks = [
                ev.description, ev.types?.join(' '),
                ev.actionDetails?.conductedBy, ev.actionDetails?.docLoc, ev.actionDetails?.factLoc,
                ev.actionDetails?.direction, ev.friendlyLosses?.details,
                ...(ev.enemyLosses || []).flatMap(l => [l.weapon, l.inflicter, l.callsign])
            ];
            return chunks.some(x => String(x || '').toLowerCase().includes(s));
        };

        const formatDateTimeUI = (isoStr) => {
            if (!isoStr) return '';
            try {
                const d = new Date(isoStr);
                return `${pad2(d.getDate())}.${pad2(d.getMonth()+1)}.${d.getFullYear()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
            } catch { return isoStr; }
        };

        const LOSS_SERIES = [
            { id: 'e200', side: 'enemy', label: 'Противник 200', short: 'П 200', color: '#ef4444' },
            { id: 'e200u', side: 'enemy', label: 'Противник 200*', short: 'П 200*', color: '#fb7185' },
            { id: 'e200d', side: 'enemy', label: 'Виявлені 200', short: 'Вияв 200', color: '#a855f7' },
            { id: 'e300', side: 'enemy', label: 'Противник 300', short: 'П 300', color: '#f59e0b' },
            { id: 'epow', side: 'enemy', label: 'Полонені', short: 'Полон', color: '#10b981' },
            { id: 'f200', side: 'ours', label: 'Наші 200', short: 'Н 200', color: '#60a5fa' },
            { id: 'f300', side: 'ours', label: 'Наші 300', short: 'Н 300', color: '#38bdf8' },
            { id: 'fzbv', side: 'ours', label: 'ЗБВ', short: 'ЗБВ', color: '#818cf8' },
        ];

        // --- УНІВЕРСАЛЬНІ UI КОМПОНЕНТИ ---
        const ChartComponent = React.memo(({ type, data, options, className }) => {
            const chartRef = useRef(null);
            const chartInstance = useRef(null);

            useEffect(() => {
                if (chartInstance.current) chartInstance.current.destroy();
                if (window.ChartDataLabels) Chart.register(window.ChartDataLabels);

                Chart.defaults.color = '#94a3b8';
                Chart.defaults.font.family = 'Inter, sans-serif';
                
                const ctx = chartRef.current.getContext('2d');
                const merged = { responsive: true, maintainAspectRatio: false, ...options };
                merged.plugins = { datalabels: { display: false }, ...(options && options.plugins) };
                chartInstance.current = new Chart(ctx, { type, data, options: merged });
                
                return () => { if (chartInstance.current) chartInstance.current.destroy(); }
            }, [data, options, type]);

            return <div className={`relative ${className}`}><canvas ref={chartRef}></canvas></div>;
        });

        // --- ГОЛОВНИЙ ДОДАТОК ---
        const notifyDocument = (message) => window.dispatchEvent(new CustomEvent('document-notice', { detail: message }));
        function DocumentNotice() {
            const [message, setMessage] = useState('');
            useEffect(() => {
                let timer;
                const receive = event => {
                    clearTimeout(timer);
                    setMessage(String(event.detail));
                    timer = setTimeout(() => setMessage(''), 6500);
                };
                window.addEventListener('document-notice', receive);
                return () => { clearTimeout(timer); window.removeEventListener('document-notice', receive); };
            }, []);
            return message ? <div role="status" aria-live="polite" className="fixed bottom-5 left-1/2 -translate-x-1/2 z-[110] bg-slate-800 border border-amber-500/40 text-slate-100 text-sm px-4 py-3 rounded-xl shadow-xl max-w-[90vw] flex gap-4 items-center"><span>{message}</span><button type="button" aria-label="Закрити повідомлення" onClick={() => setMessage('')}>✕</button></div> : null;
        }

        const documentIssues = (record) => {
            const issues = [];
            if (!record.id) issues.push('Немає ідентифікатора');
            if (!record.actionDetails?.startDate) issues.push('Не вказано дату');
            if (!String(record.description || '').trim()) issues.push('Не заповнено опис');
            const isAssault = record.types?.includes(EVENT_TYPES.ASSAULT) || record.types?.includes('ШД');
            if (isAssault) {
                const ad = record.actionDetails || {};
                if (!String(ad.endTime || '').trim()) issues.push('ШД без часу закінчення');
                if (!String(ad.startTime || '').trim()) issues.push('ШД: Не вказано час початку');
                if (!String(ad.conductedBy || '').trim()) issues.push('ШД: Не вказано ким проводилось');
                if (!String(ad.docLoc || '').trim()) issues.push('ШД: Не вказано Док. місце');
                if (!String(ad.factLoc || '').trim()) issues.push('ШД: Не вказано Факт. місце');
                if (!String(ad.direction || '').trim()) issues.push('ШД: Не вказано напрямок');
                if (!ad.friendlyCount || parseInt(ad.friendlyCount) === 0) issues.push('ШД: Не вказано к-ть о/с');
                if (!ad.enemySize || parseInt(ad.enemySize) === 0) issues.push('ШД: Не вказано сили ворога');
                if (ad.hasVehicles && !String(ad.vehicleDetails || '').trim()) issues.push('ШД: Відсутній опис техніки');
            }
            return issues;
        };
        const validateDocumentBackup = (data) => {
            const object = value => value && typeof value === 'object' && !Array.isArray(value);
            if (!object(data) || !Array.isArray(data.events) || !object(data.settings) || !object(data.dailyFriendlyLosses))
                throw new Error('Неповна структура резервної копії');
            if (!['weapons', 'positions'].every(key => Array.isArray(data.settings[key]) && data.settings[key].every(v => typeof v === 'string')))
                throw new Error('Пошкоджено налаштування');
            const ids = new Set();
            for (const record of data.events) {
                if (!object(record) || typeof record.id !== 'string' || !record.id || ids.has(record.id) ||
                    !Array.isArray(record.types) || !record.types.every(v => typeof v === 'string') ||
                    !Array.isArray(record.enemyLosses) || !record.enemyLosses.every(object) ||
                    typeof record.createdAt !== 'string' || !Number.isFinite(Date.parse(record.createdAt)))
                    throw new Error('Некоректний запис або повтор ідентифікатора');
                if (record.documentHistory !== undefined && (!Array.isArray(record.documentHistory) ||
                    !record.documentHistory.every(h => object(h) && typeof h.at === 'string' && Number.isFinite(Date.parse(h.at)) && typeof h.action === 'string')))
                    throw new Error('Пошкоджено історію документа');
                ids.add(record.id);
            }
            for (const [date, counts] of Object.entries(data.dailyFriendlyLosses)) {
                if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !object(counts) ||
                    !['count200', 'count300', 'countZBV'].every(key => counts[key] === undefined || (Number.isSafeInteger(counts[key]) && counts[key] >= 0)))
                    throw new Error('Некоректна щоденна таблиця');
            }
            return data;
        };

        const DOCUMENT_CHECKS = ['Немає ідентифікатора', 'Не вказано дату', 'Не заповнено опис', 'ШД без часу закінчення', 'ШД: Не вказано час початку', 'ШД: Не вказано ким проводилось', 'ШД: Не вказано Док. місце', 'ШД: Не вказано Факт. місце', 'ШД: Не вказано напрямок', 'ШД: Не вказано к-ть о/с', 'ШД: Не вказано сили ворога', 'ШД: Відсутній опис техніки', 'Повтор ідентифікатора'];
        const documentViewDefaults = () => ({
            checks: [...DOCUMENT_CHECKS],
            onlyIssues: false,
            showSummary: true,
            showRecords: true,
            showHistory: true,
            showDescription: true,
            showDetails: true,
            showLosses: true
        });
        function DocumentDesk({ records, onOpen, preferences, onSavePreferences }) {
            const [view, setView] = useState(() => ({
                ...documentViewDefaults(), ...preferences,
                checks: Array.isArray(preferences?.checks) ? preferences.checks.filter(c => DOCUMENT_CHECKS.includes(c)) : [...DOCUMENT_CHECKS]
            }));
            const onlyIssues = view.onlyIssues;
            const setOnlyIssues = value => setView(previous => ({...previous, onlyIssues: value}));
            const [search, setSearch] = useState('');
            const [typeFilter, setTypeFilter] = useState('all');
            const [issueFilter, setIssueFilter] = useState('all');

            const counts = new Map();
            records.forEach(r => counts.set(r.id, (counts.get(r.id) || 0) + 1));
            const rows = records.map(record => ({
                record,
                issues: [...documentIssues(record), ...(counts.get(record.id) > 1 ? ['Повтор ідентифікатора'] : [])].filter(issue => view.checks.includes(issue))
            }));
            const incomplete = rows.filter(row => row.issues.length);
            const revisions = records.flatMap(record => (record.documentHistory || []).map(entry => ({ ...entry, record })))
                .sort((a, b) => b.at.localeCompare(a.at)).slice(0, 15);

            const visible = rows.filter(({record, issues}) => {
                if (onlyIssues && issues.length === 0) return false;
                if (typeFilter !== 'all' && !(record.types || []).includes(typeFilter)) return false;
                if (issueFilter !== 'all' && !issues.includes(issueFilter)) return false;
                if (search) {
                    const s = search.toLocaleLowerCase('uk-UA');
                    const text = `${record.id || ''} ${record.description || ''} ${record.actionDetails?.conductedBy || ''} ${record.actionDetails?.docLoc || ''} ${record.actionDetails?.factLoc || ''}`.toLocaleLowerCase('uk-UA');
                    if (!text.includes(s)) return false;
                }
                return true;
            });

            const unclosedAssaultsCount = rows.filter(r => r.issues.includes('ШД без часу закінчення')).length;

            const downloadReport = () => {
                const report = {
                    report: 'Якість заповнення документації',
                    generatedAt: new Date().toISOString(),
                    total: records.length,
                    withIssues: incomplete.length,
                    checks: view.checks,
                    issues: incomplete.map(({ record, issues }) => ({ id: record.id || null, issues }))
                };
                const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }));
                const link = document.createElement('a');
                link.href = url; link.download = 'document-quality-' + todayISO() + '.json'; link.click();
                setTimeout(() => URL.revokeObjectURL(url), 1000);
            };

            return <section className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4">
                <div className="flex justify-between items-start flex-wrap gap-3">
                    <div>
                        <h2 className="font-bold text-lg text-white flex items-center gap-2">
                            <Icon name="check-circle" className="w-5 h-5 text-amber-500" />
                            Перевірка документації
                        </h2>
                        <p className="text-xs text-slate-400 mt-1">Контроль повноти записів, закриття ШД та історія редагування. Дані перевіряються в реальному часі.</p>
                    </div>
                    <button type="button" onClick={downloadReport} className="border border-slate-600 hover:border-amber-500/60 rounded-lg px-3 py-2 text-sm text-slate-200 hover:text-white flex items-center gap-1.5 transition">
                        <Icon name="download" className="w-4 h-4 text-amber-400" /> Звіт про якість (JSON)
                    </button>
                </div>

                <details className="rounded-xl border border-slate-700 bg-slate-950/40 p-3.5">
                    <summary className="cursor-pointer font-semibold text-sm text-amber-400 flex items-center gap-2 select-none">
                        <Icon name="sliders" className="w-4 h-4" /> Налаштувати перевірки та що відображати у картках
                    </summary>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4 pt-3 border-t border-slate-800">
                        <fieldset>
                            <legend className="text-xs font-bold text-slate-400 mb-2 uppercase tracking-wider">Які зауваження шукати</legend>
                            <div className="flex flex-col gap-2">
                                {DOCUMENT_CHECKS.map(check => (
                                    <label key={check} className="text-xs flex items-center gap-2 cursor-pointer text-slate-300 hover:text-white">
                                        <input type="checkbox" checked={view.checks.includes(check)} onChange={e => setView(previous => ({...previous, checks: e.target.checked ? [...previous.checks, check] : previous.checks.filter(c => c !== check)}))} className="w-4 h-4 rounded bg-slate-900 border-slate-700 text-amber-500" />
                                        <span>{check}</span>
                                    </label>
                                ))}
                            </div>
                        </fieldset>

                        <fieldset>
                            <legend className="text-xs font-bold text-slate-400 mb-2 uppercase tracking-wider">Які блоки показувати</legend>
                            <div className="flex flex-col gap-2">
                                {[['showSummary','Підсумки перевірки'],['showRecords','Список документів'],['showHistory','Історія змін']].map(([key, label]) => (
                                    <label key={key} className="text-xs flex items-center gap-2 cursor-pointer text-slate-300 hover:text-white">
                                        <input type="checkbox" checked={!!view[key]} onChange={e => setView(previous => ({...previous, [key]: e.target.checked}))} className="w-4 h-4 rounded bg-slate-900 border-slate-700 text-amber-500" />
                                        <span>{label}</span>
                                    </label>
                                ))}
                            </div>
                        </fieldset>

                        <fieldset>
                            <legend className="text-xs font-bold text-slate-400 mb-2 uppercase tracking-wider">Що показувати у списку</legend>
                            <div className="flex flex-col gap-2">
                                {[
                                    ['showDescription', 'Короткий опис'],
                                    ['showDetails', 'Локація та виконавці'],
                                    ['showLosses', 'Підсумок втрат']
                                ].map(([key, label]) => (
                                    <label key={key} className="text-xs flex items-center gap-2 cursor-pointer text-slate-300 hover:text-white">
                                        <input type="checkbox" checked={view[key] !== false} onChange={e => setView(previous => ({...previous, [key]: e.target.checked}))} className="w-4 h-4 rounded bg-slate-900 border-slate-700 text-amber-500" />
                                        <span>{label}</span>
                                    </label>
                                ))}
                            </div>
                        </fieldset>
                    </div>

                    <div className="flex flex-wrap gap-3 mt-4 pt-3 border-t border-slate-800">
                        <button type="button" className="rounded-lg bg-amber-600 hover:bg-amber-500 px-3 py-1.5 text-xs font-bold text-white transition" onClick={async () => {
                            try { await onSavePreferences(view); notifyDocument('Налаштування перевірки збережено'); }
                            catch { notifyDocument('Не вдалося зберегти налаштування'); }
                        }}>Зберегти налаштування перевірки</button>
                        <button type="button" className="rounded-lg border border-slate-600 hover:border-slate-500 px-3 py-1.5 text-xs text-slate-300 transition" onClick={() => {setView(documentViewDefaults()); setSearch(''); setTypeFilter('all'); setIssueFilter('all');}}>Скинути за замовчуванням</button>
                    </div>
                </details>

                {!view.checks.length && <p role="status" className="text-sm text-amber-300 bg-amber-950/30 p-2.5 rounded-xl border border-amber-800/50">Усі перевірки вимкнено. Документи відображаються без аналізу зауважень.</p>}

                {view.showSummary && <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div className="rounded-xl bg-slate-950 p-3 border border-slate-800">
                        <div className="text-2xl font-mono font-bold text-slate-100">{records.length}</div>
                        <div className="text-xs text-slate-400 mt-0.5">Всього записів</div>
                    </div>
                    <div className="rounded-xl bg-slate-950 p-3 border border-slate-800">
                        <div className="text-2xl font-mono font-bold text-emerald-400">{rows.length - incomplete.length}</div>
                        <div className="text-xs text-slate-400 mt-0.5">Без зауважень</div>
                    </div>
                    <div className="rounded-xl bg-slate-950 p-3 border border-slate-800">
                        <div className="text-2xl font-mono font-bold text-amber-400">{incomplete.length}</div>
                        <div className="text-xs text-slate-400 mt-0.5">Потребують уваги</div>
                    </div>
                    <div className={`rounded-xl p-3 border ${unclosedAssaultsCount > 0 ? 'bg-red-950/30 border-red-700/60' : 'bg-slate-950 border-slate-800'}`}>
                        <div className={`text-2xl font-mono font-bold ${unclosedAssaultsCount > 0 ? 'text-red-400 animate-pulse' : 'text-slate-400'}`}>{unclosedAssaultsCount}</div>
                        <div className="text-xs text-slate-400 mt-0.5">Незакритих ШД</div>
                    </div>
                </div>}

                {/* Фільтри */}
                <div className="flex flex-wrap items-center gap-3 bg-slate-950/60 p-3 rounded-xl border border-slate-800">
                    <div className="relative flex-1 min-w-[180px]">
                        <Icon name="search" className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-2.5 pointer-events-none" />
                        <input aria-label="Пошук документа" value={search} onChange={e => setSearch(e.target.value)} placeholder="ID, опис, позивний, місце..." className="w-full bg-slate-900 border border-slate-700 rounded-lg pl-8 pr-2.5 py-1.5 text-xs text-slate-200 focus:border-amber-500" />
                    </div>

                    <div className="flex items-center gap-1.5">
                        <span className="text-xs text-slate-400 uppercase font-semibold">Тип:</span>
                        <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)} className="bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 focus:border-amber-500">
                            <option value="all">Усі типи</option>
                            <option value={EVENT_TYPES.ASSAULT}>{EVENT_TYPES.ASSAULT}</option>
                            <option value={EVENT_TYPES.UDP}>{EVENT_TYPES.UDP}</option>
                            <option value={EVENT_TYPES.OTHER}>{EVENT_TYPES.OTHER}</option>
                        </select>
                    </div>

                    <div className="flex items-center gap-1.5">
                        <span className="text-xs text-slate-400 uppercase font-semibold">Зауваження:</span>
                        <select value={issueFilter} onChange={e => setIssueFilter(e.target.value)} className="bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 focus:border-amber-500">
                            <option value="all">Усі зауваження</option>
                            {DOCUMENT_CHECKS.map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                    </div>

                    <label className="text-xs font-semibold text-slate-300 flex items-center gap-1.5 cursor-pointer ml-auto select-none">
                        <input type="checkbox" checked={onlyIssues} onChange={e => setOnlyIssues(e.target.checked)} className="w-4 h-4 rounded bg-slate-900 border-slate-700 text-amber-500" />
                        Лише із зауваженнями
                    </label>
                </div>

                <div className="text-xs text-slate-500 flex justify-between items-center px-1">
                    <span>Показано: <strong className="text-slate-300">{visible.length}</strong> з {records.length}</span>
                    {unclosedAssaultsCount > 0 && (
                        <button type="button" onClick={() => { setTypeFilter(EVENT_TYPES.ASSAULT); setIssueFilter('ШД без часу закінчення'); setOnlyIssues(true); }} className="text-red-400 hover:text-red-300 underline font-semibold flex items-center gap-1">
                            <span className="w-2 h-2 rounded-full bg-red-500 animate-ping"></span> Показати {unclosedAssaultsCount} незакритих ШД
                        </button>
                    )}
                </div>

                {view.showRecords && <div className="max-h-96 overflow-y-auto divide-y divide-slate-800/80 rounded-xl border border-slate-800 bg-slate-950/40">
                    {visible.slice(0, 150).map(({record, issues}, index) => {
                        const isUnclosedAssault = issues.includes('ШД без часу закінчення');
                        const totalE200 = (record.enemyLosses || []).reduce((s, l) => s + (l.count200 || 0) + (l.count200POW || 0), 0);
                        const totalE300 = (record.enemyLosses || []).reduce((s, l) => s + (l.count300 || 0), 0);
                        const totalPOW = (record.enemyLosses || []).reduce((s, l) => s + (l.countPOW || 0), 0);
                        return (
                            <button type="button" key={String(record.id) + index} onClick={() => onOpen(record)} className={`block w-full text-left p-3 hover:bg-slate-800/60 transition ${isUnclosedAssault ? 'bg-red-950/20' : ''}`}>
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                    <div className="flex items-center gap-2">
                                        <span className="text-[11px] font-mono text-slate-400">{record.id || 'Без ID'}</span>
                                        <span className="text-xs text-slate-500">· {getEventDateStr(record) || '—'}</span>
                                        {(record.types || []).map(t => (
                                            <span key={t} className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-slate-800 text-amber-400 border border-slate-700">{t}</span>
                                        ))}
                                    </div>
                                    {view.showLosses !== false && (totalE200 > 0 || totalE300 > 0 || totalPOW > 0) && (
                                        <span className="text-[11px] font-mono text-slate-400 flex gap-2">
                                            {totalE200 > 0 && <span className="text-red-400">200:{totalE200}</span>}
                                            {totalE300 > 0 && <span className="text-amber-400">300:{totalE300}</span>}
                                            {totalPOW > 0 && <span className="text-emerald-400">Полон:{totalPOW}</span>}
                                        </span>
                                    )}
                                </div>

                                {view.showDetails !== false && (record.actionDetails?.docLoc || record.actionDetails?.factLoc || record.actionDetails?.conductedBy) && (
                                    <div className="text-xs text-slate-400 mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
                                        {(record.actionDetails?.factLoc || record.actionDetails?.docLoc) && (
                                            <span>Локація: <strong className="text-slate-300">{record.actionDetails.factLoc || record.actionDetails.docLoc}</strong></span>
                                        )}
                                        {record.actionDetails?.conductedBy && (
                                            <span>Проводили: <strong className="text-slate-300">{record.actionDetails.conductedBy}</strong></span>
                                        )}
                                    </div>
                                )}

                                {view.showDescription !== false && (
                                    <div className="text-xs text-slate-300 mt-1 truncate">{record.description || <span className="text-slate-500 italic">Без опису</span>}</div>
                                )}

                                <div className="mt-1.5 flex flex-wrap gap-1.5">
                                    {issues.map(iss => (
                                        <span key={iss} className={`text-[10px] font-semibold px-2 py-0.5 rounded ${
                                            iss === 'ШД без часу закінчення' ? 'bg-red-900/60 text-red-200 border border-red-500/80 animate-pulse' :
                                            'bg-amber-950/50 text-amber-300 border border-amber-700/50'
                                        }`}>
                                            {iss === 'ШД без часу закінчення' ? '⚠ ' + iss : iss}
                                        </span>
                                    ))}
                                    {issues.length === 0 && view.checks.length > 0 && (
                                        <span className="text-[10px] text-emerald-400 flex items-center gap-1">✓ Зауважень немає</span>
                                    )}
                                </div>
                            </button>
                        );
                    })}
                    {!visible.length && <p className="py-8 text-sm text-slate-400 text-center">Немає записів за цим фільтром.</p>}
                </div>}

                {view.showHistory && <details className="rounded-xl border border-slate-800 bg-slate-950/40 p-3">
                    <summary className="cursor-pointer text-xs font-semibold text-slate-300">Останні зміни документів (аудит редагувань)</summary>
                    <p className="text-[11px] text-slate-500 my-2">До 50 останніх змін на запис. Відображає час та дію над документом.</p>
                    <div className="space-y-1 mt-2">
                        {revisions.map((entry, index) => <div key={index} className="text-xs py-1.5 border-t border-slate-800/60 text-slate-400">{formatDateTimeUI(entry.at)} · <span className="text-amber-400">{entry.action}</span> · <span className="font-mono text-slate-300 break-all">{entry.record.id}</span></div>)}
                        {!revisions.length && <p className="text-xs text-slate-500">Нових змін ще немає.</p>}
                    </div>
                </details>}
            </section>;
        }

        const EnemyAppContext = React.createContext(null);

        const SearchablePowSelect = ({ value, options, onChange, currentLegacy, disabled }) => {
                const [search, setSearch] = useState('');
                const [isOpen, setIsOpen] = useState(false);
                const wrapperRef = useRef(null);

                useEffect(() => {
                    const handleClickOutside = (e) => {
                        if (wrapperRef.current && !wrapperRef.current.contains(e.target)) {
                            setIsOpen(false);
                        }
                    };
                    document.addEventListener('mousedown', handleClickOutside);
                    return () => document.removeEventListener('mousedown', handleClickOutside);
                }, []);
                
                const selectedOpt = options.find(o => o.id === value);
                const displayValue = selectedOpt ? `${selectedOpt.callsign} (${selectedOpt.date})` : (value === 'legacy' || currentLegacy ? 'Невідомий (старі дані)' : '');
                const inputValue = isOpen ? search : displayValue;

                const filtered = options.filter(o => o.callsign.toLowerCase().includes(search.toLowerCase()) || o.date.includes(search));

                return (
                    <div className="relative" ref={wrapperRef}>
                        <input 
                            type="text" 
                            disabled={disabled}
                            value={inputValue}
                            onChange={e => { setSearch(e.target.value); setIsOpen(true); }}
                            onFocus={() => { setIsOpen(true); setSearch(''); }}
                            placeholder="- Ні -"
                            className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2 py-1.5 text-xs font-mono font-bold text-rose-500 focus:border-rose-500 cursor-text disabled:opacity-50 disabled:cursor-not-allowed"
                        />
                        {isOpen && (
                            <div className="absolute z-50 w-full mt-1 bg-slate-800 border border-slate-700 rounded-lg shadow-xl max-h-48 overflow-y-auto">
                                <div className="px-2 py-1.5 hover:bg-slate-700 cursor-pointer text-xs text-slate-300 font-bold border-b border-slate-700" onMouseDown={() => { onChange(''); setIsOpen(false); }}>- Ні -</div>
                                {(value === 'legacy' || currentLegacy) && (
                                    <div className="px-2 py-1.5 hover:bg-slate-700 cursor-pointer text-xs text-rose-400" onMouseDown={() => { onChange('legacy'); setIsOpen(false); }}>Невідомий (старі дані)</div>
                                )}
                                {filtered.map(o => (
                                    <div key={o.id} className="px-2 py-1.5 hover:bg-slate-700 cursor-pointer text-xs text-slate-300 flex justify-between" onMouseDown={() => { onChange(o.id); setIsOpen(false); }}>
                                        <span>{o.callsign}</span>
                                        <span className="text-slate-500 text-[10px]">{o.date}</span>
                                    </div>
                                ))}
                                {filtered.length === 0 && <div className="px-2 py-1.5 text-xs text-slate-500 italic">Нічого не знайдено</div>}
                            </div>
                        )}
                    </div>
                );
            };

        const CallsignArrayInput = ({ count, values = [], onChange, label, colorClass, isRequired = false, listId = "personnel-callsigns-list" }) => {
            if (!count || count < 1) return null;
            
            const handleCallsignChange = (index, newVal) => {
                const newValues = [...values];
                while (newValues.length < count) newValues.push('');
                newValues[index] = newVal;
                onChange(newValues.slice(0, count));
            };

            return (
                <div className="mt-2 space-y-2 border-l-2 pl-3 ml-1" style={{ borderColor: 'var(--border-color, #475569)' }}>
                    <div className={`text-[10px] font-bold uppercase ${colorClass} opacity-80`}>Деталізація: {label}</div>
                    {Array.from({ length: count }).map((_, i) => (
                        <div key={i} className="relative">
                            <input 
                                type="text" 
                                placeholder={isRequired ? "Позивний (ОБОВ'ЯЗКОВО)" : "Позивний (опц.)"}
                                required={isRequired}
                                value={values[i] || ''} 
                                onChange={e => handleCallsignChange(i, e.target.value)}
                                list={listId}
                                className={`w-full bg-slate-900 border ${isRequired && !values[i] ? 'border-amber-500/50' : 'border-slate-700'} rounded-md px-2 py-1 text-xs text-slate-200 focus:outline-none focus:border-slate-500`}
                            />
                        </div>
                    ))}
                </div>
            );
        };

        const EventForm = ({ eventToEdit, onClose, onSave }) => {
                const dictionaryOptions = useSharedDictionaries();
                const { allPOWs, events, settings, personnel } = React.useContext(EnemyAppContext);
                const [formData, setFormData] = useState(eventToEdit || {
                    id: generateId(),
                    createdAt: new Date().toISOString(),
                    types: [],
                    isFireContact: false,
                    isRealEvent: true,
                    enemyLosses: [],
                    friendlyLosses: { count200: 0, count300: 0, countZBV: 0, details: '' },
                    actionDetails: {
                        startDate: window.SuiteDates.localISO(),
                        startTime: '',
                        endDate: '',
                        endTime: '',
                        direction: '',
                        position: '',
                        friendlyCount: 0,
                        enemySize: 0,
                        hasVehicles: false,
                        vehicleDetails: '',
                        conductedBy: '',
                        docLoc: '',
                        factLoc: ''
                    },
                    description: ''
                });

                const toggleType = (type) => {
                    setFormData(prev => ({
                        ...prev,
                        types: prev.types.includes(type) ? prev.types.filter(t => t !== type) : [...prev.types, type]
                    }));
                };

                const isUdp = formData.types.includes(EVENT_TYPES.UDP);
                const isAssault = formData.types.includes(EVENT_TYPES.ASSAULT);

                const uniqueDocLocs = useMemo(() => {
                    const locs = events.map(e => e.actionDetails?.docLoc).filter(Boolean).map(s => s.trim());
                    return [...new Set(locs)].filter(Boolean).sort();
                }, [events]);

                const uniqueFactLocs = useMemo(() => {
                    const locs = events.map(e => e.actionDetails?.factLoc).filter(Boolean).map(s => s.trim());
                    return [...new Set(locs)].filter(Boolean).sort();
                }, [events]);

                const addEnemyLoss = () => {
                    setFormData(prev => ({
                        ...prev,
                        enemyLosses: [...prev.enemyLosses, { 
                            id: generateId(), 
                            weapon: settings.weapons[0], 
                            inflicter: '',
                            callsign: '',
                            time: '',
                            count200: 0, 
                            count200Unconfirmed: 0, 
                            count200Discovered: 0, 
                            count300: 0, 
                            countPOW: 0,
                            count200POW: 0,
                            killedPowId: '',
                            callsigns200: [],
                            callsigns200Unconfirmed: [],
                            callsigns200Discovered: [],
                            callsigns300: [],
                            callsignsPOW: [],
                            callsigns200POW: []
                        }]
                    }));
                };

                const updateEnemyLoss = (id, field, value) => {
                    setFormData(prev => ({
                        ...prev,
                        enemyLosses: prev.enemyLosses.map(l => l.id === id ? { ...l, [field]: value } : l)
                    }));
                };

                const removeEnemyLoss = (id) => {
                    setFormData(prev => ({
                        ...prev,
                        enemyLosses: prev.enemyLosses.filter(l => l.id !== id)
                    }));
                };

                const handleSubmit = (e) => {
                    e.preventDefault();
                    if (formData.types.length === 0) {
                        alert("Оберіть хоча б один тип події (УПД, ШД, Інше)");
                        return;
                    }
                    const dataToSave = { ...formData };
                    if (dataToSave.types.includes(EVENT_TYPES.ASSAULT)) {
                        dataToSave.actionDetails = {
                            ...dataToSave.actionDetails,
                            endDate: dataToSave.actionDetails.startDate || dataToSave.actionDetails.endDate
                        };
                    }
                    onSave(dataToSave);
                };

                return (
                    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4 overflow-y-auto">
                        <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full w-full max-w-[1920px] shadow-2xl flex flex-col max-h-[90vh]">
                            <div className="flex items-center justify-between p-4 border-b border-slate-800 bg-slate-900/50 rounded-t-2xl sticky top-0 z-10">
                                <h2 className="text-lg font-bold text-slate-100 flex items-center gap-2">
                                    <Icon name={eventToEdit ? "edit" : "plus-circle"} className="w-5 h-5 text-amber-500" />
                                    {eventToEdit ? "Редагувати подію" : "Додати нову подію"}
                                </h2>
                                <button onClick={onClose} className="p-1.5 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-white transition">
                                    <Icon name="x" className="w-5 h-5" />
                                </button>
                            </div>
                            
                            <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-4 space-y-6">
                                {/* ТИП ПОДІЇ */}
                                <div className="space-y-3">
                                    <h3 className="text-sm font-bold text-slate-300 uppercase tracking-wider border-b border-slate-800 pb-1">Тип події</h3>
                                    <div className="flex flex-wrap gap-3">
                                        {Object.values(EVENT_TYPES).map(type => (
                                            <label key={type} className={`flex items-center gap-2 px-4 py-2 rounded-xl border cursor-pointer transition-all select-none ${formData.types.includes(type) ? 'bg-amber-900/40 border-amber-500/50 text-amber-200' : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-600 hover:text-slate-200'}`}>
                                                <input type="checkbox" className="hidden" checked={formData.types.includes(type)} onChange={() => toggleType(type)} />
                                                <Icon name={formData.types.includes(type) ? "check-square" : "square"} className="w-4 h-4 shrink-0" />
                                                <span className="font-semibold">{type}</span>
                                            </label>
                                        ))}
                                    </div>
                                    <div className="flex flex-wrap gap-4 mt-2">
                                        <label className="flex items-center gap-2 cursor-pointer text-sm font-semibold text-slate-300 hover:text-white transition">
                                            <input type="checkbox" checked={formData.isFireContact} onChange={e => setFormData(p => ({...p, isFireContact: e.target.checked}))} className="w-4 h-4 rounded bg-slate-900 border-slate-700 text-amber-500 focus:ring-amber-500" />
                                            Вогневий контакт
                                        </label>
                                        <label className="flex items-center gap-2 cursor-pointer text-sm font-semibold text-slate-300 hover:text-white transition">
                                            <input type="checkbox" checked={formData.isRealEvent} onChange={e => setFormData(p => ({...p, isRealEvent: e.target.checked}))} className="w-4 h-4 rounded bg-slate-900 border-slate-700 text-amber-500 focus:ring-amber-500" />
                                            Подія реальна
                                        </label>
                                    </div>
                                </div>

                                {/* ДЕТАЛІ ДІЙ (ШД / УПД) */}
                                {(isAssault || isUdp) && (
                                    <div className="space-y-4 bg-slate-950/50 p-4 rounded-xl border border-slate-800/80">
                                        <h3 className="text-sm font-bold text-amber-400 uppercase tracking-wider flex items-center gap-2">
                                            <Icon name={isAssault ? "shield-alert" : "map"} className="w-4 h-4" /> 
                                            Деталі {isAssault ? "Штурмових Дій (ШД)" : "Ударно-пошукових дій (УПД)"}
                                        </h3>
                                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                                            <div>
                                                <label className="block text-xs font-semibold text-slate-400 mb-1">Дата початку</label>
                                                <input type="date" value={formData.actionDetails.startDate} onChange={e => setFormData(p => ({...p, actionDetails: {...p.actionDetails, startDate: e.target.value}}))} className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-sm focus:border-amber-500 focus:ring-1 focus:ring-amber-500" required={(isAssault || isUdp)} />
                                            </div>
                                            <div>
                                                <label className="block text-xs font-semibold text-slate-400 mb-1">Час початку</label>
                                                <input type="time" value={formData.actionDetails.startTime} onChange={e => setFormData(p => ({...p, actionDetails: {...p.actionDetails, startTime: e.target.value}}))} className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-sm focus:border-amber-500 focus:ring-1 focus:ring-amber-500" />
                                            </div>
                                            {!isAssault && (
                                                <div>
                                                    <label className="block text-xs font-semibold text-slate-400 mb-1">Дата закінчення</label>
                                                    <input type="date" value={formData.actionDetails.endDate} onChange={e => setFormData(p => ({...p, actionDetails: {...p.actionDetails, endDate: e.target.value}}))} className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-sm focus:border-amber-500 focus:ring-1 focus:ring-amber-500" />
                                                </div>
                                            )}
                                            <div className={isAssault ? "md:col-span-2 lg:col-span-2" : ""}>
                                                <label className="block text-xs font-semibold text-slate-400 mb-1 flex items-center justify-between">
                                                    <span>Час закінчення</span>
                                                    {isAssault && !formData.actionDetails.endTime && <span className="text-[10px] text-red-400 font-bold animate-pulse">Обов'язково для закриття ШД</span>}
                                                </label>
                                                <input type="time" value={formData.actionDetails.endTime} onChange={e => setFormData(p => ({...p, actionDetails: {...p.actionDetails, endTime: e.target.value}}))} className={`w-full bg-slate-900 border rounded-lg px-3 py-1.5 text-sm focus:ring-1 ${isAssault && !formData.actionDetails.endTime ? 'border-amber-500/80 text-amber-200' : 'border-slate-700 text-slate-200 focus:border-amber-500 focus:ring-amber-500'}`} />
                                            </div>
                                            
                                            <div className="lg:col-span-2">
                                                <label className="block text-xs font-semibold text-slate-400 mb-1">Хто проводить (Позивні)</label>
                                                <input type="text" value={formData.actionDetails.conductedBy} onChange={e => setFormData(p => ({...p, actionDetails: {...p.actionDetails, conductedBy: e.target.value}}))} placeholder="Напр. Вовк, Сокіл..." className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-sm focus:border-amber-500" />
                                            </div>
                                            <div>
                                                <label className="block text-xs font-semibold text-slate-400 mb-1">Документальне місце</label>
                                                <input type="text" list="docLoc-suggestions" value={formData.actionDetails.docLoc} onChange={e => setFormData(p => ({...p, actionDetails: {...p.actionDetails, docLoc: e.target.value}}))} placeholder="Офіційна назва..." className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-sm focus:border-amber-500" />
                                                <datalist id="docLoc-suggestions">
                                                    {dictionaryOptions('docPlaces', uniqueDocLocs, formData.actionDetails.docLoc).map(loc => <option key={loc} value={loc} />)}
                                                </datalist>
                                            </div>
                                            <div>
                                                <label className="block text-xs font-semibold text-slate-400 mb-1">Фактичне місце</label>
                                                <input type="text" list="factLoc-suggestions" value={formData.actionDetails.factLoc} onChange={e => setFormData(p => ({...p, actionDetails: {...p.actionDetails, factLoc: e.target.value}}))} placeholder="Реальна позиція..." className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-sm focus:border-amber-500" />
                                                <datalist id="factLoc-suggestions">
                                                    {dictionaryOptions('actualPlaces', uniqueFactLocs, formData.actionDetails.factLoc).map(loc => <option key={loc} value={loc} />)}
                                                </datalist>
                                            </div>

                                            {isAssault && (
                                                <>
                                                    <div className="lg:col-span-2">
                                                        <label className="block text-xs font-semibold text-slate-400 mb-1">Напрямок штурму</label>
                                                        <input type="text" value={formData.actionDetails.direction} onChange={e => setFormData(p => ({...p, actionDetails: {...p.actionDetails, direction: e.target.value}}))} placeholder="Напр. З лісу, південний напрямок..." className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-sm focus:border-amber-500" />
                                                    </div>
                                                    <div>
                                                        <label className="block text-xs font-semibold text-slate-400 mb-1">Наш о/с на позиції</label>
                                                        <input type="number" min="0" value={formData.actionDetails.friendlyCount} onChange={e => setFormData(p => ({...p, actionDetails: {...p.actionDetails, friendlyCount: parseInt(e.target.value)||0}}))} className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-sm focus:border-amber-500" />
                                                    </div>
                                                    <div>
                                                        <label className="block text-xs font-semibold text-slate-400 mb-1">Кількість ворогів (група)</label>
                                                        <input type="number" min="0" value={formData.actionDetails.enemySize} onChange={e => setFormData(p => ({...p, actionDetails: {...p.actionDetails, enemySize: parseInt(e.target.value)||0}}))} className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-sm focus:border-amber-500" />
                                                    </div>
                                                    <div className="flex items-center gap-2 mt-2">
                                                        <input type="checkbox" id="hasVehicles" checked={formData.actionDetails.hasVehicles} onChange={e => setFormData(p => ({...p, actionDetails: {...p.actionDetails, hasVehicles: e.target.checked}}))} className="w-4 h-4 rounded bg-slate-900 border-slate-700 text-amber-500 focus:ring-0 cursor-pointer" />
                                                        <label htmlFor="hasVehicles" className="text-sm font-semibold text-slate-300 cursor-pointer">Наявна техніка ворога</label>
                                                    </div>
                                                    {formData.actionDetails.hasVehicles && (
                                                        <div className="lg:col-span-3">
                                                            <label className="block text-xs font-semibold text-slate-400 mb-1">Опис техніки</label>
                                                            <input type="text" value={formData.actionDetails.vehicleDetails} onChange={e => setFormData(p => ({...p, actionDetails: {...p.actionDetails, vehicleDetails: e.target.value}}))} placeholder="Напр. 2 БМП, 1 Танк..." className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-sm focus:border-amber-500" />
                                                        </div>
                                                    )}
                                                </>
                                            )}
                                        </div>
                                    </div>
                                )}

                                {/* ВТРАТИ ПРОТИВНИКА */}
                                <div className="space-y-3">
                                    <div className="flex items-center justify-between border-b border-slate-800 pb-1">
                                        <h3 className="text-sm font-bold text-red-400 uppercase tracking-wider flex items-center gap-2">
                                            <Icon name="crosshair" className="w-4 h-4" /> Втрати Противника
                                        </h3>
                                        <button type="button" onClick={addEnemyLoss} className="text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition">
                                            <Icon name="plus" className="w-3.5 h-3.5" /> Додати ураження
                                        </button>
                                    </div>
                                    
                                    {formData.enemyLosses.length === 0 ? (
                                        <div className="text-center py-6 text-sm text-slate-500 border border-dashed border-slate-800 rounded-xl bg-slate-950/50">
                                            Немає записів про втрати ворога. Натисніть "Додати ураження".
                                        </div>
                                    ) : (
                                        <div className="space-y-2">
                                            {formData.enemyLosses.map((loss, idx) => (
                                                <div key={loss.id} className="flex flex-col bg-slate-950 p-3 rounded-xl border border-slate-800/80 gap-3">
                                                    
                                                    {/* Верхній ряд: Зброя, Хто наносив, Позивний, Час ураження */}
                                                    <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-3 gap-3">
                                                        <div>
                                                            <label className="block text-[10px] font-semibold text-slate-500 mb-1 uppercase">Засіб ураження</label>
                                                            <select value={loss.weapon} onChange={e => updateEnemyLoss(loss.id, 'weapon', e.target.value)} className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-sm focus:border-red-500">
                                                                {dictionaryOptions('weapons', settings.weapons, loss.weapon).map(w => <option key={w} value={w}>{w}</option>)}
                                                            </select>
                                                        </div>
                                                        <div>
                                                            <label className="block text-[10px] font-semibold text-slate-500 mb-1 uppercase">Хто наносив ураження (наші)</label>
                                                            <input type="text" placeholder="Позивний / Підрозділ" value={loss.inflicter} onChange={e => updateEnemyLoss(loss.id, 'inflicter', e.target.value)} className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-sm text-slate-200 focus:border-red-500" />
                                                        </div>
                                                        <div>
                                                            <label className="block text-[10px] font-semibold text-amber-400 mb-1 uppercase flex items-center gap-1">
                                                                <Icon name="clock" className="w-3 h-3 text-amber-400" /> Час ураження
                                                            </label>
                                                            <input type="time" value={loss.time || ''} onChange={e => updateEnemyLoss(loss.id, 'time', e.target.value)} className="w-full bg-slate-900 border border-amber-500/50 rounded-lg px-3 py-1.5 text-sm text-amber-200 focus:border-amber-400" />
                                                        </div>
                                                    </div>

                                                    {/* Нижній ряд: Рахунки (200, 200*, 300, Полонені) */}
                                                    <div className="flex flex-wrap md:flex-nowrap items-center gap-3">
                                                        <div className="flex-1">
                                                            <label className="block text-[10px] font-semibold text-slate-500 mb-1 uppercase">200 (Вбито)</label>
                                                            <input type="number" min="0" value={loss.count200} onChange={e => updateEnemyLoss(loss.id, 'count200', parseInt(e.target.value)||0)} className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-sm font-mono font-bold text-red-500 focus:border-red-500 text-center" />
                                                        </div>
                                                        <div className="flex-1">
                                                            <label className="block text-[10px] font-semibold text-slate-500 mb-1 uppercase" title="Не підтверджено">200* (Ймовірно)</label>
                                                            <input type="number" min="0" value={loss.count200Unconfirmed} onChange={e => updateEnemyLoss(loss.id, 'count200Unconfirmed', parseInt(e.target.value)||0)} className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-sm font-mono font-bold text-rose-300 focus:border-rose-400 text-center" />
                                                        </div>
                                                        <div className="flex-1">
                                                            <label className="block text-[10px] font-semibold text-slate-500 mb-1 uppercase" title="Виявлені тіла, невідомо хто знищив">Виявлений 200</label>
                                                            <input type="number" min="0" value={loss.count200Discovered} onChange={e => updateEnemyLoss(loss.id, 'count200Discovered', parseInt(e.target.value)||0)} className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-sm font-mono font-bold text-purple-400 focus:border-purple-500 text-center" />
                                                        </div>
                                                        <div className="flex-1">
                                                            <label className="block text-[10px] font-semibold text-slate-500 mb-1 uppercase">300 (Поранені)</label>
                                                            <input type="number" min="0" value={loss.count300} onChange={e => updateEnemyLoss(loss.id, 'count300', parseInt(e.target.value)||0)} className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-sm font-mono font-bold text-amber-400 focus:border-amber-500 text-center" />
                                                        </div>
                                                        <div className="flex-1">
                                                            <label className="block text-[10px] font-semibold text-slate-500 mb-1 uppercase" title="Вкажіть кількість вбитих полонених">Загиблі полонені</label>
                                                            <input type="number" min="0" value={loss.count200POW} onChange={e => updateEnemyLoss(loss.id, 'count200POW', parseInt(e.target.value)||0)} className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-sm font-mono font-bold text-rose-500 focus:border-rose-400 text-center" />
                                                        </div>
                                                        <div className="flex-1">
                                                            <label className="block text-[10px] font-semibold text-slate-500 mb-1 uppercase text-center">Полон</label>
                                                            <input type="number" min="0" value={loss.countPOW} onChange={e => updateEnemyLoss(loss.id, 'countPOW', parseInt(e.target.value)||0)} className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-sm font-mono font-bold text-emerald-400 focus:border-emerald-500 text-center" />
                                                        </div>
                                                        <div className="w-auto flex items-end justify-center pt-5">
                                                            <button type="button" onClick={() => removeEnemyLoss(loss.id)} className="p-2 hover:bg-red-900/40 text-red-400 rounded-lg transition" title="Видалити">
                                                                <Icon name="trash-2" className="w-4 h-4" />
                                                            </button>
                                                        </div>
                                                    </div>

                                                    {/* Динамічні інпути для позивних */}
                                                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mt-2 pl-2">
                                                        <CallsignArrayInput count={loss.count200} values={loss.callsigns200} onChange={v => updateEnemyLoss(loss.id, 'callsigns200', v)} label="200 (Вбиті)" colorClass="text-red-500" />
                                                        <CallsignArrayInput count={loss.count200Unconfirmed} values={loss.callsigns200Unconfirmed} onChange={v => updateEnemyLoss(loss.id, 'callsigns200Unconfirmed', v)} label="200* (Ймовірно)" colorClass="text-rose-300" />
                                                        <CallsignArrayInput count={loss.count200Discovered} values={loss.callsigns200Discovered} onChange={v => updateEnemyLoss(loss.id, 'callsigns200Discovered', v)} label="Виявлені 200" colorClass="text-purple-400" />
                                                        <CallsignArrayInput count={loss.count300} values={loss.callsigns300} onChange={v => updateEnemyLoss(loss.id, 'callsigns300', v)} label="300 (Поранені)" colorClass="text-amber-400" />
                                                        <CallsignArrayInput count={loss.countPOW} values={loss.callsignsPOW} onChange={v => updateEnemyLoss(loss.id, 'callsignsPOW', v)} label="Полонені" colorClass="text-emerald-400" isRequired={true} />
                                                        <CallsignArrayInput count={loss.count200POW} values={loss.callsigns200POW} onChange={v => updateEnemyLoss(loss.id, 'callsigns200POW', v)} label="Загиблі полонені" colorClass="text-rose-500" isRequired={true} listId="personnel-pow-callsigns-list" />
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>

                                {(!isAssault && !isUdp) && (
                                    <div className="space-y-3 bg-slate-950/50 p-4 rounded-xl border border-slate-800/80">
                                        <h3 className="text-sm font-bold text-amber-400 uppercase tracking-wider flex items-center gap-2">
                                            <Icon name="calendar-clock" className="w-4 h-4" /> Дата та час події
                                        </h3>
                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                            <div>
                                                <label className="block text-xs font-semibold text-slate-400 mb-1">Дата</label>
                                                <input type="date" value={formData.actionDetails.startDate} onChange={e => setFormData(p => ({...p, actionDetails: {...p.actionDetails, startDate: e.target.value}}))} className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-sm focus:border-amber-500" />
                                            </div>
                                            <div>
                                                <label className="block text-xs font-semibold text-slate-400 mb-1">Час</label>
                                                <input type="time" value={formData.actionDetails.startTime} onChange={e => setFormData(p => ({...p, actionDetails: {...p.actionDetails, startTime: e.target.value}}))} className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-sm focus:border-amber-500" />
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {/* НАШІ ВТРАТИ */}
                                {(isAssault || isUdp) && (
                                    <div className="space-y-3 bg-blue-950/20 p-4 rounded-xl border border-blue-900/30">
                                        <h3 className="text-sm font-bold text-blue-400 uppercase tracking-wider border-b border-blue-900/50 pb-1 flex items-center gap-2">
                                            <Icon name="users" className="w-4 h-4" /> Наші втрати (під час {isAssault ? 'ШД' : 'УПД'})
                                        </h3>
                                        <div className="grid grid-cols-3 md:grid-cols-5 gap-4">
                                            <div>
                                                <label className="block text-xs font-semibold text-blue-300 mb-1">200 (Загиблі)</label>
                                                <input type="number" min="0" value={formData.friendlyLosses.count200} onChange={e => setFormData(p => ({...p, friendlyLosses: {...p.friendlyLosses, count200: parseInt(e.target.value)||0}}))} className="w-full bg-slate-900 border border-blue-900/50 rounded-lg px-3 py-1.5 text-sm focus:border-blue-500 font-mono text-blue-200" />
                                            </div>
                                            <div>
                                                <label className="block text-xs font-semibold text-blue-300 mb-1">300 (Поранені)</label>
                                                <input type="number" min="0" value={formData.friendlyLosses.count300} onChange={e => setFormData(p => ({...p, friendlyLosses: {...p.friendlyLosses, count300: parseInt(e.target.value)||0}}))} className="w-full bg-slate-900 border border-blue-900/50 rounded-lg px-3 py-1.5 text-sm focus:border-blue-500 font-mono text-blue-200" />
                                            </div>
                                            <div>
                                                <label className="block text-xs font-semibold text-blue-300 mb-1">ЗБВ (Зниклі)</label>
                                                <input type="number" min="0" value={formData.friendlyLosses.countZBV} onChange={e => setFormData(p => ({...p, friendlyLosses: {...p.friendlyLosses, countZBV: parseInt(e.target.value)||0}}))} className="w-full bg-slate-900 border border-blue-900/50 rounded-lg px-3 py-1.5 text-sm focus:border-blue-500 font-mono text-blue-200" />
                                            </div>
                                            <div className="col-span-3 md:col-span-2">
                                                <label className="block text-xs font-semibold text-blue-300 mb-1">Деталі / Позивні</label>
                                                <input type="text" value={formData.friendlyLosses.details} onChange={e => setFormData(p => ({...p, friendlyLosses: {...p.friendlyLosses, details: e.target.value}}))} placeholder="Короткий опис..." className="w-full bg-slate-900 border border-blue-900/50 rounded-lg px-3 py-1.5 text-sm focus:border-blue-500 text-blue-100" />
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {/* ДОДАТКОВО */}
                                <div className="space-y-3">
                                    <h3 className="text-sm font-bold text-slate-300 uppercase tracking-wider border-b border-slate-800 pb-1">Короткий опис події</h3>
                                    <textarea value={formData.description} onChange={e => setFormData(p => ({...p, description: e.target.value}))} className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm focus:border-amber-500 h-20 resize-none" placeholder="Додаткова інформація..."></textarea>
                                </div>
                                
                                <datalist id="personnel-callsigns-list">
                                    {personnel.filter(p => ['alive', '300'].includes(p.status)).map(p => (
                                        <option key={p.id} value={p.callsign}>
                                            {p.callsign}
                                        </option>
                                    ))}
                                </datalist>

                                <datalist id="personnel-pow-callsigns-list">
                                    {personnel.filter(p => p.status === 'pow').map(p => (
                                        <option key={p.id} value={p.callsign}>
                                            {p.callsign}
                                        </option>
                                    ))}
                                </datalist>
                                
                            </form>
                            
                            <div className="p-4 border-t border-slate-800 bg-slate-900/50 rounded-b-2xl flex justify-end gap-3 sticky bottom-0 z-10">
                                <button type="button" onClick={onClose} className="px-5 py-2 rounded-xl text-sm font-bold text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition">
                                    Скасувати
                                </button>
                                <button type="button" onClick={handleSubmit} className="px-5 py-2 rounded-xl text-sm font-bold bg-amber-600 hover:bg-amber-500 text-white shadow-lg transition flex items-center gap-2">
                                    <Icon name="save" className="w-4 h-4" />
                                    Зберегти подію
                                </button>
                            </div>
                        </div>
                    </div>
                );
            };

        const EventViewModal = ({ event, onClose }) => {
                if (!event) return null;
                const isAssault = event.types.includes(EVENT_TYPES.ASSAULT);
                const isUdp = event.types.includes(EVENT_TYPES.UDP);
                
                const totalE200 = event.enemyLosses.reduce((sum, l) => sum + (l.count200 || 0) + (l.count200POW || 0), 0);
                const totalE200Unc = event.enemyLosses.reduce((sum, l) => sum + (l.count200Unconfirmed || 0), 0);
                const totalE200Disc = event.enemyLosses.reduce((sum, l) => sum + (l.count200Discovered || 0), 0);
                const totalE300 = event.enemyLosses.reduce((sum, l) => sum + (l.count300 || 0), 0);
                const totalPOW = event.enemyLosses.reduce((sum, l) => sum + (l.countPOW || 0), 0);
                
                return (
                    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4 overflow-y-auto">
                        <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full w-full max-w-5xl shadow-2xl flex flex-col max-h-[90vh]">
                            <div className="flex items-center justify-between p-4 border-b border-slate-700 bg-slate-800/50 rounded-t-2xl sticky top-0 z-10">
                                <h2 className="text-xl font-bold text-slate-100 flex items-center gap-2">
                                    <Icon name="file-text" className="w-5 h-5 text-blue-400" />
                                    Деталі події
                                </h2>
                                <button onClick={onClose} className="p-2 bg-slate-700 text-slate-200 hover:bg-slate-600 rounded-lg transition shadow-md">
                                    <Icon name="x" className="w-5 h-5" />
                                </button>
                            </div>
                            <div className="flex-1 overflow-y-auto p-5 space-y-6">
                                {/* Заголовок */}
                                <div className="flex flex-wrap gap-2 items-center">
                                    {event.types.map(t => <span key={t} className="px-3 py-1 bg-amber-900/40 text-amber-400 border border-amber-700/50 rounded-lg text-sm font-bold uppercase tracking-wide">{t}</span>)}
                                    {event.isFireContact && <span className="px-3 py-1 bg-red-900/40 text-red-400 border border-red-800/50 rounded-lg text-sm font-bold uppercase flex items-center gap-1"><Icon name="flame" className="w-4 h-4"/>Вогневий контакт</span>}
                                    {!event.isRealEvent && <span className="px-3 py-1 bg-slate-800 text-slate-400 border border-slate-700 rounded-lg text-sm font-bold uppercase">Тестова подія</span>}
                                    <div className="ml-auto text-sm text-slate-400 font-medium">Створено: {formatDateTimeUI(event.createdAt)}</div>
                                </div>
                                
                                {/* Деталі дій */}
                                {(isAssault || isUdp) && (
                                    <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-3">
                                        <h3 className="text-amber-500 font-bold uppercase text-xs flex items-center gap-2 mb-2"><Icon name="map" className="w-4 h-4"/> Інформація про дію</h3>
                                        <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
                                            {isAssault ? (
                                                <>
                                                    <div><span className="block text-xs text-slate-500 mb-0.5">Дата проведення</span> <span className="text-slate-200 font-medium">{event.actionDetails.startDate}</span></div>
                                                    <div><span className="block text-xs text-slate-500 mb-0.5">Час проведення</span> <span className="text-slate-200 font-medium">{event.actionDetails.startTime || '—'} — {event.actionDetails.endTime || <span className="text-red-400 font-bold animate-pulse">Триває (не закрито)</span>}</span></div>
                                                </>
                                            ) : (
                                                <>
                                                    <div><span className="block text-xs text-slate-500 mb-0.5">Дата початку</span> <span className="text-slate-200 font-medium">{event.actionDetails.startDate} {event.actionDetails.startTime}</span></div>
                                                    <div><span className="block text-xs text-slate-500 mb-0.5">Дата закінчення</span> <span className="text-slate-200 font-medium">{event.actionDetails.endDate} {event.actionDetails.endTime}</span></div>
                                                </>
                                            )}
                                            <div><span className="block text-xs text-slate-500 mb-0.5">Проводили</span> <span className="text-slate-200 font-medium">{event.actionDetails.conductedBy || '-'}</span></div>
                                            <div className="col-span-2 md:col-span-1"><span className="block text-xs text-slate-500 mb-0.5">Док. місце</span> <span className="text-slate-200 font-medium">{event.actionDetails.docLoc || '-'}</span></div>
                                            <div className="col-span-2 md:col-span-2"><span className="block text-xs text-slate-500 mb-0.5">Факт. місце</span> <span className="text-slate-200 font-medium">{event.actionDetails.factLoc || '-'}</span></div>
                                            {isAssault && (
                                                <>
                                                    <div className="col-span-2 md:col-span-1"><span className="block text-xs text-slate-500 mb-0.5">Напрямок</span> <span className="text-slate-200 font-medium">{event.actionDetails.direction || '-'}</span></div>
                                                    <div><span className="block text-xs text-slate-500 mb-0.5">Наш о/с</span> <span className="text-slate-200 font-medium">{event.actionDetails.friendlyCount || '0'}</span></div>
                                                    <div><span className="block text-xs text-slate-500 mb-0.5">Ворог (група)</span> <span className="text-slate-200 font-medium">{event.actionDetails.enemySize || '0'}</span></div>
                                                    {event.actionDetails.hasVehicles && <div className="col-span-2 md:col-span-3"><span className="block text-xs text-slate-500 mb-0.5">Техніка ворога</span> <span className="text-slate-200 font-medium">{event.actionDetails.vehicleDetails || 'Так'}</span></div>}
                                                </>
                                            )}
                                        </div>
                                    </div>
                                )}
                                
                                {/* Втрати ворога */}
                                <div className="bg-slate-950 p-4 rounded-xl border border-slate-800">
                                    <div className="flex items-center justify-between mb-3 pb-2 border-b border-slate-800">
                                        <h3 className="text-red-500 font-bold uppercase text-xs flex items-center gap-2"><Icon name="crosshair" className="w-4 h-4"/> Втрати противника</h3>
                                        <div className="flex gap-3 text-sm font-mono">
                                            <span className="text-red-400">200: {totalE200}</span>
                                            <span className="text-rose-400">200*: {totalE200Unc}</span>
                                            <span className="text-purple-400">Вияв: {totalE200Disc}</span>
                                            <span className="text-amber-400">300: {totalE300}</span>
                                            <span className="text-emerald-400">Полон: {totalPOW}</span>
                                        </div>
                                    </div>
                                    {event.enemyLosses.length > 0 ? (
                                        <div className="space-y-2">
                                            {event.enemyLosses.map((l, i) => (
                                                <div key={i} className="flex flex-col gap-2 bg-slate-900 p-2.5 rounded-lg border border-slate-700/50 text-sm">
                                                    <div className="flex flex-wrap md:flex-nowrap items-center gap-3 w-full">
                                                        <div className="w-full md:w-1/3 shrink-0 flex items-center gap-1.5">
                                                            {l.time && <span className="font-mono text-xs px-1.5 py-0.5 rounded bg-amber-950/60 text-amber-300 border border-amber-800/60 shrink-0">{l.time}</span>}
                                                            <span className="font-semibold text-slate-300">{l.weapon}</span> 
                                                            {l.inflicter && <span className="text-slate-500 text-xs ml-1">(від: {l.inflicter})</span>}
                                                        </div>
                                                        <div className="flex-1 flex gap-4 justify-end font-mono text-xs md:text-sm">
                                                            {(l.count200 || 0) + (l.count200POW || 0) > 0 && <span className="text-red-400" title="200">200: {(l.count200 || 0) + (l.count200POW || 0)}</span>}
                                                            {l.count200Unconfirmed > 0 && <span className="text-rose-400" title="200*">200*: {l.count200Unconfirmed}</span>}
                                                            {l.count200Discovered > 0 && <span className="text-purple-400" title="Виявлені 200">В: {l.count200Discovered}</span>}
                                                            {l.count300 > 0 && <span className="text-amber-400" title="300">300: {l.count300}</span>}
                                                            {l.countPOW > 0 && <span className="text-emerald-400" title="Полонені">П: {l.countPOW}</span>}
                                                        </div>
                                                    </div>
                                                    
                                                    {((l.callsigns200 && l.callsigns200.some(c=>c)) || (l.callsigns200Unconfirmed && l.callsigns200Unconfirmed.some(c=>c)) || (l.callsigns200Discovered && l.callsigns200Discovered.some(c=>c)) || (l.callsigns300 && l.callsigns300.some(c=>c)) || (l.callsignsPOW && l.callsignsPOW.some(c=>c)) || (l.callsigns200POW && l.callsigns200POW.some(c=>c))) && (
                                                        <div className="pt-1.5 mt-0.5 border-t border-slate-800/60 flex gap-4 text-[11px] font-mono flex-wrap">
                                                            {l.callsigns200 && l.callsigns200.some(c=>c) && <span className="text-red-400/80">200: {l.callsigns200.filter(c=>c).join(', ')}</span>}
                                                            {l.callsigns200Unconfirmed && l.callsigns200Unconfirmed.some(c=>c) && <span className="text-rose-300/80">200*: {l.callsigns200Unconfirmed.filter(c=>c).join(', ')}</span>}
                                                            {l.callsigns200Discovered && l.callsigns200Discovered.some(c=>c) && <span className="text-purple-400/80">Вияв: {l.callsigns200Discovered.filter(c=>c).join(', ')}</span>}
                                                            {l.callsigns300 && l.callsigns300.some(c=>c) && <span className="text-amber-400/80">300: {l.callsigns300.filter(c=>c).join(', ')}</span>}
                                                            {l.callsignsPOW && l.callsignsPOW.some(c=>c) && <span className="text-emerald-400/80">Полон: {l.callsignsPOW.filter(c=>c).join(', ')}</span>}
                                                            {l.callsigns200POW && l.callsigns200POW.some(c=>c) && <span className="text-rose-500/80">Заг.Полон: {l.callsigns200POW.filter(c=>c).join(', ')}</span>}
                                                        </div>
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                    ) : <div className="text-slate-500 text-sm italic">Немає записів про втрати</div>}
                                </div>
                                
                                {/* Наші втрати */}
                                {(event.friendlyLosses.count200 > 0 || event.friendlyLosses.count300 > 0 || event.friendlyLosses.countZBV > 0 || event.friendlyLosses.details) && (
                                    <div className="bg-blue-950/20 p-4 rounded-xl border border-blue-900/40">
                                        <h3 className="text-blue-400 font-bold uppercase text-xs flex items-center gap-2 mb-3"><Icon name="users" className="w-4 h-4"/> Наші втрати</h3>
                                        <div className="flex flex-wrap gap-6 text-sm">
                                            <div className="font-mono text-blue-300"><span className="text-blue-500 text-xs mr-1 block uppercase">Загиблі (200)</span> {event.friendlyLosses.count200}</div>
                                            <div className="font-mono text-blue-300"><span className="text-blue-500 text-xs mr-1 block uppercase">Поранені (300)</span> {event.friendlyLosses.count300}</div>
                                            <div className="font-mono text-blue-300"><span className="text-blue-500 text-xs mr-1 block uppercase">Зниклі (ЗБВ)</span> {event.friendlyLosses.countZBV || 0}</div>
                                            {event.friendlyLosses.details && <div className="w-full text-blue-200 mt-2"><span className="block text-blue-500 text-xs mb-1 uppercase">Деталі</span>{event.friendlyLosses.details}</div>}
                                        </div>
                                    </div>
                                )}
                                
                                {/* Опис */}
                                {event.description && (
                                    <div className="bg-slate-900 p-4 rounded-xl border border-slate-800">
                                        <h3 className="text-slate-500 font-bold uppercase text-xs mb-2">Короткий опис</h3>
                                        <p className="text-slate-300 text-sm whitespace-pre-wrap">{event.description}</p>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                );
            };

        const EventRow = ({ event, onEdit, onDelete, onView, onReport }) => {
                const totalE200 = (event.enemyLosses || []).reduce((sum, l) => sum + (l.count200 || 0) + (l.count200POW || 0), 0);
                const totalE200Unc = (event.enemyLosses || []).reduce((sum, l) => sum + (l.count200Unconfirmed || 0), 0);
                const totalE200Disc = (event.enemyLosses || []).reduce((sum, l) => sum + (l.count200Discovered || 0), 0);
                const totalE300 = (event.enemyLosses || []).reduce((sum, l) => sum + (l.count300 || 0), 0);
                const totalPOW = (event.enemyLosses || []).reduce((sum, l) => sum + (l.countPOW || 0), 0);
                
                const isAssault = (event.types || []).includes(EVENT_TYPES.ASSAULT);
                const isUdp = (event.types || []).includes(EVENT_TYPES.UDP);
                const isUnclosedAssault = isAssault && (!event.actionDetails?.endTime || !String(event.actionDetails.endTime).trim());
                
                const actionDate = event.actionDetails?.startDate ? `${event.actionDetails.startDate} ${event.actionDetails.startTime || ''}` : event.createdAt;
                const docLoc = event.actionDetails?.docLoc;
                const factLoc = event.actionDetails?.factLoc;
                const direction = event.actionDetails?.direction;
                const position = event.actionDetails?.position;
                const conductedBy = event.actionDetails?.conductedBy;
                const friendlyCount = event.actionDetails?.friendlyCount;
                const enemySize = event.actionDetails?.enemySize;
                const hasVehicles = event.actionDetails?.hasVehicles;
                const vehicleDetails = event.actionDetails?.vehicleDetails;

                return (
                    <div className={`relative rounded-2xl p-4 flex flex-col gap-3.5 transition-all shadow-md group overflow-hidden ${
                        isUnclosedAssault 
                            ? 'bg-red-950/30 border-2 border-red-500 shadow-[0_0_25px_rgba(239,68,68,0.35)] animate-pulse' 
                            : 'bg-slate-900/85 border border-slate-800 hover:border-slate-600'
                    }`}>
                        <div className={`absolute top-0 left-0 w-1.5 h-full ${isUnclosedAssault ? 'bg-red-500 animate-pulse' : 'bg-gradient-to-b from-amber-500 to-red-600'}`}></div>

                        {/* Попередження про незакритий ШД */}
                        {isUnclosedAssault && (
                            <div className="flex flex-wrap items-center justify-between gap-2 bg-red-900/70 border border-red-500/80 rounded-xl px-3.5 py-2 text-xs text-red-100 font-bold ml-2">
                                <div className="flex items-center gap-2.5">
                                    <span className="relative flex h-3 w-3 shrink-0">
                                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                                        <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500"></span>
                                    </span>
                                    <span>УВАГА: Штурмові дії (ШД) не закрито! Не вказано час закінчення.</span>
                                </div>
                                <button onClick={() => onEdit(event)} className="bg-red-600 hover:bg-red-500 text-white px-3 py-1 rounded-lg text-xs font-bold transition flex items-center gap-1.5 shadow">
                                    <Icon name="clock" className="w-3.5 h-3.5" /> Вказати час завершення →
                                </button>
                            </div>
                        )}

                        {/* Верхній ряд: Дата/Час, Типи подій, Дії */}
                        <div className="flex flex-wrap items-center justify-between gap-3 pl-2">
                            <div className="flex flex-wrap items-center gap-2">
                                <div className="text-xs font-semibold text-slate-300 flex items-center gap-1.5 bg-slate-950/80 border border-slate-800 px-2.5 py-1 rounded-lg">
                                    <Icon name="calendar" className="w-3.5 h-3.5 text-amber-500" />
                                    <span>{formatDateTimeUI(actionDate)}</span>
                                    {event.actionDetails?.endTime && (
                                        <span className="text-slate-400 font-mono">→ {event.actionDetails.endTime}</span>
                                    )}
                                </div>

                                {(event.types || []).map(t => (
                                    <span key={t} className={`text-[11px] font-extrabold uppercase tracking-wider px-2.5 py-0.5 rounded-lg border shadow-sm ${
                                        t === EVENT_TYPES.ASSAULT ? 'bg-red-950/70 border-red-800 text-red-300' :
                                        t === EVENT_TYPES.UDP ? 'bg-amber-950/70 border-amber-800 text-amber-300' :
                                        'bg-slate-800 border-slate-700 text-slate-300'
                                    }`}>
                                        {t}
                                    </span>
                                ))}

                                {event.isFireContact && (
                                    <span className="text-[10px] font-bold uppercase tracking-wider bg-red-900/50 text-red-300 px-2 py-0.5 rounded-lg border border-red-700 flex items-center gap-1" title="Вогневий контакт">
                                        <Icon name="flame" className="w-3 h-3 text-red-400" /> Контакт
                                    </span>
                                )}

                                {!event.isRealEvent && (
                                    <span className="text-[10px] font-bold uppercase tracking-wider bg-slate-800 text-slate-400 px-2 py-0.5 rounded-lg border border-slate-700">
                                        ТЕСТ
                                    </span>
                                )}
                            </div>

                            {/* Кнопки дій */}
                            <div className="flex flex-wrap items-center gap-1.5">
                                {isAssault && <button type="button" aria-label={`Доповідь ШД ${event.id}`} disabled={!isCompletedAssault(event)} onClick={() => onReport(event)} title={isCompletedAssault(event) ? 'Сформувати чернетку позатермінового донесення' : 'Спочатку вкажіть коректний час завершення ШД'} className="px-2.5 py-1.5 bg-amber-950/50 hover:bg-amber-900/60 text-amber-300 rounded-lg transition border border-amber-700/60 text-xs font-semibold flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"><Icon name="file-text" className="w-4 h-4" />Доповідь</button>}
                                <button onClick={() => onView(event)} className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-blue-400 rounded-lg transition border border-slate-700" title="Переглянути деталі">
                                    <Icon name="eye" className="w-4 h-4" />
                                </button>
                                <button onClick={() => onEdit(event)} className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-amber-400 rounded-lg transition border border-slate-700" title="Редагувати">
                                    <Icon name="edit" className="w-4 h-4" />
                                </button>
                                <button onClick={() => onDelete(event.id)} className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-red-400 rounded-lg transition border border-slate-700" title="Видалити">
                                    <Icon name="trash-2" className="w-4 h-4" />
                                </button>
                            </div>
                        </div>

                        {/* Тактичний контекстний рядок: Локації, Підрозділи, Сили */}
                        {(docLoc || factLoc || direction || position || conductedBy || friendlyCount > 0 || enemySize > 0 || hasVehicles) && (
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 bg-slate-950/70 border border-slate-800/80 rounded-xl p-2.5 text-xs ml-2">
                                {(factLoc || docLoc) && (
                                    <div className="flex items-start gap-1.5 truncate">
                                        <Icon name="map-pin" className="w-3.5 h-3.5 text-amber-500 shrink-0 mt-0.5" />
                                        <div className="truncate">
                                            <span className="text-slate-500 font-semibold block text-[10px] uppercase">Локація</span>
                                            <span className="text-slate-200 font-medium">{factLoc || docLoc}</span>
                                            {factLoc && docLoc && factLoc !== docLoc && <span className="text-slate-400 text-[10px] ml-1">({docLoc})</span>}
                                        </div>
                                    </div>
                                )}
                                {(direction || position) && (
                                    <div className="flex items-start gap-1.5 truncate">
                                        <Icon name="navigation" className="w-3.5 h-3.5 text-blue-400 shrink-0 mt-0.5" />
                                        <div className="truncate">
                                            <span className="text-slate-500 font-semibold block text-[10px] uppercase">Напрямок / Позиція</span>
                                            <span className="text-slate-200 font-medium">{direction || position}</span>
                                        </div>
                                    </div>
                                )}
                                {conductedBy && (
                                    <div className="flex items-start gap-1.5 truncate">
                                        <Icon name="shield" className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
                                        <div className="truncate">
                                            <span className="text-slate-500 font-semibold block text-[10px] uppercase">Хто проводив</span>
                                            <span className="text-slate-200 font-medium">{conductedBy}</span>
                                        </div>
                                    </div>
                                )}
                                {(friendlyCount > 0 || enemySize > 0 || hasVehicles) && (
                                    <div className="flex items-start gap-1.5 truncate">
                                        <Icon name="users" className="w-3.5 h-3.5 text-purple-400 shrink-0 mt-0.5" />
                                        <div className="truncate">
                                            <span className="text-slate-500 font-semibold block text-[10px] uppercase">Сили сторін</span>
                                            <span className="text-slate-300 font-medium">
                                                {friendlyCount > 0 && <span className="text-blue-300 mr-2">Наші: {friendlyCount}</span>}
                                                {enemySize > 0 && <span className="text-red-300 mr-2">Ворог: {enemySize}</span>}
                                                {hasVehicles && <span className="text-amber-300">Техніка: {vehicleDetails || 'Так'}</span>}
                                            </span>
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Підсумок втрат сторін */}
                        <div className="flex flex-col md:flex-row gap-3 items-start md:items-center justify-between pl-2 pt-1 border-t border-slate-800/60">
                            <div className="flex flex-wrap gap-1.5 items-center">
                                {totalE200 > 0 && <div className="bg-red-950/50 border border-red-900/60 px-2.5 py-1 rounded-lg flex items-center gap-1.5 text-xs"><Icon name="skull" className="w-3.5 h-3.5 text-red-500"/> <span className="text-slate-300">200:</span><b className="text-red-400 font-mono">{totalE200}</b></div>}
                                {totalE200Unc > 0 && <div className="bg-rose-950/50 border border-rose-900/60 px-2.5 py-1 rounded-lg flex items-center gap-1.5 text-xs"><Icon name="help-circle" className="w-3.5 h-3.5 text-rose-400"/> <span className="text-slate-300">200*:</span><b className="text-rose-300 font-mono">{totalE200Unc}</b></div>}
                                {totalE200Disc > 0 && <div className="bg-purple-950/50 border border-purple-900/60 px-2.5 py-1 rounded-lg flex items-center gap-1.5 text-xs"><Icon name="eye" className="w-3.5 h-3.5 text-purple-400"/> <span className="text-slate-300">Вияв:</span><b className="text-purple-300 font-mono">{totalE200Disc}</b></div>}
                                {totalE300 > 0 && <div className="bg-amber-950/50 border border-amber-900/60 px-2.5 py-1 rounded-lg flex items-center gap-1.5 text-xs"><Icon name="activity" className="w-3.5 h-3.5 text-amber-500"/> <span className="text-slate-300">300:</span><b className="text-amber-400 font-mono">{totalE300}</b></div>}
                                {totalPOW > 0 && <div className="bg-emerald-950/50 border border-emerald-900/60 px-2.5 py-1 rounded-lg flex items-center gap-1.5 text-xs"><Icon name="users" className="w-3.5 h-3.5 text-emerald-500"/> <span className="text-slate-300">Полон:</span><b className="text-emerald-400 font-mono">{totalPOW}</b></div>}
                                {totalE200 + totalE200Unc + totalE200Disc + totalE300 + totalPOW === 0 && (
                                    <span className="text-xs text-slate-500 italic">Без втрат противника</span>
                                )}
                            </div>

                            {(event.friendlyLosses?.count200 > 0 || event.friendlyLosses?.count300 > 0 || event.friendlyLosses?.countZBV > 0) && (
                                <div className="bg-blue-950/30 border border-blue-900/40 rounded-lg px-2.5 py-1 text-xs flex items-center gap-2">
                                    <span className="font-bold text-blue-400 uppercase text-[10px]">Наші:</span>
                                    <div className="flex gap-2 font-mono">
                                        {event.friendlyLosses.count200 > 0 && <span className="text-blue-300 font-bold">200:{event.friendlyLosses.count200}</span>}
                                        {event.friendlyLosses.count300 > 0 && <span className="text-blue-300">300:{event.friendlyLosses.count300}</span>}
                                        {event.friendlyLosses.countZBV > 0 && <span className="text-indigo-300">ЗБВ:{event.friendlyLosses.countZBV}</span>}
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Деталізація уражень з часовими мітками */}
                        {event.enemyLosses && event.enemyLosses.length > 0 && (
                            <div className="flex flex-wrap gap-1.5 pl-2 text-xs">
                                {event.enemyLosses.map((l, idx) => (
                                    <div key={idx} className="bg-slate-950/80 border border-slate-800 rounded-lg px-2 py-1 text-[11px] text-slate-300 flex items-center gap-1.5">
                                        {l.time && <span className="font-mono text-amber-300 font-bold bg-amber-950/60 px-1 rounded border border-amber-900/50">{l.time}</span>}
                                        <span className="font-semibold text-slate-200">{l.weapon}</span>
                                        {l.inflicter && <span className="text-slate-400">(від: {l.inflicter})</span>}
                                        {((l.callsigns200 && l.callsigns200.some(c=>c)) || (l.callsigns200Unconfirmed && l.callsigns200Unconfirmed.some(c=>c)) || (l.callsigns200Discovered && l.callsigns200Discovered.some(c=>c)) || (l.callsigns300 && l.callsigns300.some(c=>c)) || (l.callsignsPOW && l.callsignsPOW.some(c=>c)) || (l.callsigns200POW && l.callsigns200POW.some(c=>c))) && (
                                            <span className="text-slate-400" title="Деталізовані позивні">
                                                [{[
                                                    ...(l.callsigns200||[]).filter(c=>c).map(c=>`200:${c}`),
                                                    ...(l.callsigns200Unconfirmed||[]).filter(c=>c).map(c=>`200*:${c}`),
                                                    ...(l.callsigns200Discovered||[]).filter(c=>c).map(c=>`Вияв:${c}`),
                                                    ...(l.callsigns300||[]).filter(c=>c).map(c=>`300:${c}`),
                                                    ...(l.callsignsPOW||[]).filter(c=>c).map(c=>`Полон:${c}`),
                                                    ...(l.callsigns200POW||[]).filter(c=>c).map(c=>`Заг.Полон:${c}`)
                                                ].join(', ')}]
                                            </span>
                                        )}
                                        <span className="font-mono text-slate-400 ml-1">
                                            {l.count200 > 0 && <span className="text-red-400 mr-1">200:{l.count200}</span>}
                                            {l.count200Unconfirmed > 0 && <span className="text-rose-400 mr-1">200*:{l.count200Unconfirmed}</span>}
                                            {l.count200Discovered > 0 && <span className="text-purple-400 mr-1">Вияв:{l.count200Discovered}</span>}
                                            {l.count300 > 0 && <span className="text-amber-400 mr-1">300:{l.count300}</span>}
                                            {l.count200POW > 0 && <span className="text-rose-500 mr-1" title="200 з полонених">200(п):{l.count200POW}</span>}
                                            {l.countPOW > 0 && <span className="text-emerald-400">Полон:{l.countPOW}</span>}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        )}

                        {/* Текст опису */}
                        {event.description && (
                            <div className="text-xs text-slate-300 bg-slate-950/50 border border-slate-800/80 rounded-lg p-2.5 ml-2 leading-relaxed whitespace-pre-wrap line-clamp-2 hover:line-clamp-none transition-all">
                                <span className="text-slate-500 font-semibold uppercase text-[10px] block mb-0.5">Опис події:</span>
                                {event.description}
                            </div>
                        )}
                    </div>
                );
            };

        const DatePresets = ({ dateFrom, dateTo, setDateFrom, setDateTo }) => {
                const apply = (from, to) => { setDateFrom(from); setDateTo(to); };
                const t = todayISO();
                const btns = [
                    ['Сьогодні', t, t],
                    ['7 днів', addDaysISO(t, -6), t],
                    ['30 днів', addDaysISO(t, -29), t],
                    ['Увесь час', '', ''],
                ];
                return (
                    <div className="flex flex-wrap gap-1.5">
                        {btns.map(([label, from, to]) => {
                            const active = dateFrom === from && dateTo === to;
                            return (
                                <button key={label} type="button" onClick={() => apply(from, to)} className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition ${active ? 'bg-amber-600/30 border-amber-500/60 text-amber-200' : 'bg-slate-950 border-slate-700 text-slate-400 hover:border-slate-500 hover:text-slate-200'}`}>
                                    {label}
                                </button>
                            );
                        })}
                    </div>
                );
            };

        const ListView = () => {
                const { deleteEvent, events, setEditingEvent, setIsFormOpen, setViewingEvent, setAssaultReportEvent, settings } = React.useContext(EnemyAppContext);
                const [filterType, setFilterType] = useState('all');
                const [filterStatus, setFilterStatus] = useState('all');
                const [filterFireContact, setFilterFireContact] = useState('all');
                const [dateFrom, setDateFrom] = useState('');
                const [dateTo, setDateTo] = useState('');
                const [query, setQuery] = useState('');
                const [weaponFilter, setWeaponFilter] = useState('all');
                const [onlyWithLosses, setOnlyWithLosses] = useState(false);

                const resetFilters = () => {
                    setFilterType('all');
                    setFilterStatus('all');
                    setFilterFireContact('all');
                    setDateFrom('');
                    setDateTo('');
                    setQuery('');
                    setWeaponFilter('all');
                    setOnlyWithLosses(false);
                };

                const filteredEvents = useMemo(() => {
                    return events.filter(ev => {
                        const dateStr = getEventDateStr(ev);
                        if (dateFrom && dateStr < dateFrom) return false;
                        if (dateTo && dateStr > dateTo) return false;
                        if (filterType !== 'all' && !ev.types.includes(filterType)) return false;
                        if (filterStatus !== 'all') {
                            const isReal = ev.isRealEvent !== false;
                            if (filterStatus === 'real' && !isReal) return false;
                            if (filterStatus === 'test' && isReal) return false;
                        }
                        if (filterFireContact !== 'all') {
                            const isFire = ev.isFireContact === true;
                            if (filterFireContact === 'yes' && !isFire) return false;
                            if (filterFireContact === 'no' && isFire) return false;
                        }
                        if (weaponFilter !== 'all' && !(ev.enemyLosses || []).some(l => l.weapon === weaponFilter)) return false;
                        if (!eventMatchesQuery(ev, query)) return false;
                        if (onlyWithLosses) {
                            const eSum = (ev.enemyLosses || []).reduce((s, l) => s + (l.count200||0) + (l.count200Unconfirmed||0) + (l.count200Discovered||0) + (l.count300||0) + (l.countPOW||0), 0);
                            const fSum = (ev.friendlyLosses?.count200||0) + (ev.friendlyLosses?.count300||0) + (ev.friendlyLosses?.countZBV||0);
                            if (eSum + fSum === 0) return false;
                        }
                        return true;
                    });
                }, [events, filterType, filterStatus, filterFireContact, dateFrom, dateTo, query, weaponFilter, onlyWithLosses]);

                const sortedEvents = [...filteredEvents].sort((a, b) => {
                    const dateA = a.actionDetails?.startDate ? new Date(`${a.actionDetails.startDate}T${a.actionDetails.startTime||'00:00'}`) : new Date(a.createdAt);
                    const dateB = b.actionDetails?.startDate ? new Date(`${b.actionDetails.startDate}T${b.actionDetails.startTime||'00:00'}`) : new Date(b.createdAt);
                    return dateB - dateA;
                });
                
                const assaultsCount = filteredEvents.filter(e => e.types.includes(EVENT_TYPES.ASSAULT)).length;
                const udpsCount = filteredEvents.filter(e => e.types.includes(EVENT_TYPES.UDP)).length;
                const unclosedAssaultsCount = filteredEvents.filter(e => e.types.includes(EVENT_TYPES.ASSAULT) && (!e.actionDetails?.endTime || !String(e.actionDetails.endTime).trim())).length;
                const feedTotals = useMemo(() => {
                    let e200=0,e200u=0,e200d=0,e300=0,epow=0;
                    filteredEvents.forEach(ev => (ev.enemyLosses||[]).forEach(l => {
                        e200 += l.count200||0; e200u += l.count200Unconfirmed||0; e200d += l.count200Discovered||0; e300 += l.count300||0; epow += l.countPOW||0;
                    }));
                    return { e200, e200u, e200d, e300, epow };
                }, [filteredEvents]);
                
                return (
                    <div className="flex-1 overflow-y-auto p-4 md:p-6 bg-[#020617]">
                        <div className="w-full max-w-[2400px] px-2 lg:px-4 mx-auto">
                            <div className="flex justify-between items-center mb-6 gap-3">
                                <div>
                                    <h1 className="text-2xl font-bold text-slate-100 tracking-tight">Стрічка подій</h1>
                                    <p className="text-xs text-slate-500 mt-0.5">N — нова подія · пошук по опису, позивних і засобах</p>
                                </div>
                                <button onClick={() => setIsFormOpen(true)} className="bg-amber-600 hover:bg-amber-500 text-white px-4 py-2 rounded-xl font-bold text-sm flex items-center gap-2 shadow-lg shadow-amber-900/20 transition-all active:scale-95">
                                    <Icon name="plus" className="w-4 h-4" /> Додати подію
                                </button>
                            </div>

                            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 mb-4 space-y-3">
                                <div className="flex flex-wrap items-end gap-3">
                                    <label className="flex flex-col gap-1 min-w-[180px] flex-1">
                                        <span className="text-xs text-slate-400 font-semibold uppercase">Пошук</span>
                                        <div className="relative">
                                            <Icon name="search" className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-2.5 pointer-events-none" />
                                            <input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Опис, позивний, зброя..." className="w-full bg-slate-950 border border-slate-700 rounded-lg pl-8 pr-2 py-1.5 text-sm text-slate-200 focus:border-amber-500" />
                                        </div>
                                    </label>
                                    <label className="flex flex-col gap-1">
                                        <span className="text-xs text-slate-400 font-semibold uppercase">Період з</span>
                                        <input type="date" value={dateFrom} onChange={e=>setDateFrom(e.target.value)} className="bg-slate-950 border border-slate-700 rounded-lg px-2 py-1.5 text-sm text-slate-200 focus:border-amber-500" />
                                    </label>
                                    <label className="flex flex-col gap-1">
                                        <span className="text-xs text-slate-400 font-semibold uppercase">По</span>
                                        <input type="date" value={dateTo} onChange={e=>setDateTo(e.target.value)} className="bg-slate-950 border border-slate-700 rounded-lg px-2 py-1.5 text-sm text-slate-200 focus:border-amber-500" />
                                    </label>
                                    <DatePresets dateFrom={dateFrom} dateTo={dateTo} setDateFrom={setDateFrom} setDateTo={setDateTo} />
                                </div>
                                <div className="flex flex-wrap gap-4">
                                    <label className="flex flex-col gap-1">
                                        <span className="text-xs text-slate-400 font-semibold uppercase">Тип події</span>
                                        <select value={filterType} onChange={e=>setFilterType(e.target.value)} className="bg-slate-950 border border-slate-700 rounded-lg px-2 py-1.5 text-sm text-slate-200 focus:border-amber-500">
                                            <option value="all">Усі типи</option>
                                            <option value={EVENT_TYPES.ASSAULT}>{EVENT_TYPES.ASSAULT}</option>
                                            <option value={EVENT_TYPES.UDP}>{EVENT_TYPES.UDP}</option>
                                            <option value={EVENT_TYPES.OTHER}>{EVENT_TYPES.OTHER}</option>
                                        </select>
                                    </label>
                                    <label className="flex flex-col gap-1">
                                        <span className="text-xs text-slate-400 font-semibold uppercase">Статус</span>
                                        <select value={filterStatus} onChange={e=>setFilterStatus(e.target.value)} className="bg-slate-950 border border-slate-700 rounded-lg px-2 py-1.5 text-sm text-slate-200 focus:border-amber-500">
                                            <option value="all">Усі події</option>
                                            <option value="real">Реальні</option>
                                            <option value="test">Тестові</option>
                                        </select>
                                    </label>
                                    <label className="flex flex-col gap-1">
                                        <span className="text-xs text-slate-400 font-semibold uppercase">Вогневий контакт</span>
                                        <select value={filterFireContact} onChange={e=>setFilterFireContact(e.target.value)} className="bg-slate-950 border border-slate-700 rounded-lg px-2 py-1.5 text-sm text-slate-200 focus:border-amber-500">
                                            <option value="all">Будь-що</option>
                                            <option value="yes">Так</option>
                                            <option value="no">Ні</option>
                                        </select>
                                    </label>
                                    <label className="flex flex-col gap-1">
                                        <span className="text-xs text-slate-400 font-semibold uppercase">Засіб ураження</span>
                                        <select value={weaponFilter} onChange={e=>setWeaponFilter(e.target.value)} className="bg-slate-950 border border-slate-700 rounded-lg px-2 py-1.5 text-sm text-slate-200 focus:border-amber-500">
                                            <option value="all">Усі засоби</option>
                                            {settings.weapons.map(w => <option key={w} value={w}>{w}</option>)}
                                        </select>
                                    </label>
                                    <label className="flex items-center gap-2 cursor-pointer text-sm font-semibold text-slate-300 self-end pb-1.5">
                                        <input type="checkbox" checked={onlyWithLosses} onChange={e=>setOnlyWithLosses(e.target.checked)} className="w-4 h-4 rounded bg-slate-900 border-slate-700" />
                                        Лише з втратами
                                    </label>
                                    <button type="button" onClick={resetFilters} className="self-end px-3 py-1.5 rounded-lg text-sm font-semibold bg-slate-800 border border-slate-700 text-slate-300 hover:border-amber-500/50 hover:text-white flex items-center gap-1.5">
                                        <Icon name="rotate-ccw" className="w-3.5 h-3.5" /> Скинути фільтри
                                    </button>
                                </div>
                                <div className="text-xs text-slate-500 flex flex-wrap items-center gap-x-4 gap-y-1.5 mt-1 border-t border-slate-800 pt-3">
                                    <span>Знайдено: <strong className="text-slate-300">{filteredEvents.length}</strong></span>
                                    <span>ШД: <strong className="text-slate-300">{assaultsCount}</strong></span>
                                    {unclosedAssaultsCount > 0 && (
                                        <span className="text-red-300 font-bold flex items-center gap-1.5 bg-red-950/60 border border-red-700/80 px-2 py-0.5 rounded-lg animate-pulse">
                                            <span className="relative flex h-2 w-2">
                                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                                                <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500"></span>
                                            </span>
                                            Незакритих ШД: {unclosedAssaultsCount}
                                        </span>
                                    )}
                                    <span>УПД: <strong className="text-slate-300">{udpsCount}</strong></span>
                                    <span className="text-red-400">200: {feedTotals.e200}</span>
                                    <span className="text-rose-400">200*: {feedTotals.e200u}</span>
                                    <span className="text-purple-400">Вияв: {feedTotals.e200d}</span>
                                    <span className="text-amber-400">300: {feedTotals.e300}</span>
                                    <span className="text-emerald-400">Полон: {feedTotals.epow}</span>
                                </div>
                            </div>
                            
                            {sortedEvents.length === 0 ? (
                                <div className="flex flex-col items-center justify-center h-64 border-2 border-dashed border-slate-800 rounded-3xl text-slate-500">
                                    <Icon name="clipboard-list" className="w-12 h-12 mb-3 text-slate-700" />
                                    <p className="text-lg font-medium">{events.length === 0 ? 'Подій ще немає' : 'Нічого не знайдено за фільтрами'}</p>
                                    <p className="text-sm">{events.length === 0 ? 'Натисніть "Додати подію", щоб розпочати облік.' : 'Змініть період або скиньте фільтри.'}</p>
                                </div>
                            ) : (
                                <div className="flex flex-col gap-2">
                                    {sortedEvents.map(ev => (
                                        <EventRow 
                                            key={ev.id} 
                                            event={ev} 
                                            onEdit={(e) => { setEditingEvent(e); setIsFormOpen(true); }}
                                            onDelete={deleteEvent}
                                            onView={(e) => setViewingEvent(e)}
                                            onReport={setAssaultReportEvent}
                                        />
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                );
            };

        const DashboardView = () => {
                const { dailyFriendlyLosses, events, showToast } = React.useContext(EnemyAppContext);
                const [dateFrom, setDateFrom] = useState(addDaysISO(todayISO(), -29));
                const [dateTo, setDateTo] = useState(todayISO());
                const [statsFilters, setStatsFilters] = useState({ e200: true, e200u: false, e200d: true, e300: true, epow: true });
                const [includeE200, setIncludeE200] = useState(true);
                const [include200Unc, setInclude200Unc] = useState(false);
                const [include200Disc, setInclude200Disc] = useState(false);
                const [include300, setInclude300] = useState(false);
                const [includePOW, setIncludePOW] = useState(false);
                const [includeF200, setIncludeF200] = useState(true);
                const [includeF300, setIncludeF300] = useState(false);
                const [includeFZBV, setIncludeFZBV] = useState(false);
                const [visibleCurves, setVisibleCurves] = useState({ e200: false, e300: false, e200u: false, e200d: false, epow: false, f200: false, f300: false, fzbv: false });
                const [combineEnemy, setCombineEnemy] = useState({ e200: true, e300: true, epow: true, e200u: false, e200d: false });
                const [combineOurs, setCombineOurs] = useState({ f200: true, f300: true, fzbv: false });
                const [showCombined, setShowCombined] = useState(true);
                const [showRatioCurve, setShowRatioCurve] = useState(true);
                const [chartType, setChartType] = useState('line');
                
                const inRange = (dateStr) => {
                    if (!dateStr) return false;
                    if (dateFrom && dateStr < dateFrom) return false;
                    if (dateTo && dateStr > dateTo) return false;
                    return true;
                };

                const filteredEvents = useMemo(() => {
                    return events.filter(ev => inRange(getEventDateStr(ev)));
                }, [events, dateFrom, dateTo]);
                
                const dailyMap = useMemo(() => {
                    const map = {};
                    const ensure = (d) => {
                        if (!map[d]) map[d] = { e200:0, e200u:0, e200d:0, e300:0, epow:0, f200:0, f300:0, fzbv:0 };
                    };
                    filteredEvents.forEach(ev => {
                        const d = getEventDateStr(ev);
                        if (!d) return;
                        ensure(d);
                        (ev.enemyLosses || []).forEach(l => {
                            map[d].e200 += (l.count200 || 0) + (l.count200POW || 0);
                            map[d].e200u += l.count200Unconfirmed || 0;
                            map[d].e200d += Number(l.count200Discovered || 0);
                            map[d].e300 += l.count300 || 0;
                            
                            let shouldSubtractPow = false;
                            if ((l.count200POW || 0) > 0) {
                                if (!l.killedPowId || l.killedPowId === 'legacy') {
                                    shouldSubtractPow = true;
                                } else {
                                    const sourceEventId = l.killedPowId.split('_')[0];
                                    if (filteredEvents.some(e => e.id === sourceEventId)) {
                                        shouldSubtractPow = true;
                                    }
                                }
                            }
                            map[d].epow += (l.countPOW || 0) - (shouldSubtractPow ? (l.count200POW || 0) : 0);
                        });
                    });
                    Object.keys(dailyFriendlyLosses).forEach(dStr => {
                        if (!inRange(dStr)) return;
                        ensure(dStr);
                        const d = dailyFriendlyLosses[dStr] || {};
                        map[dStr].f200 = parseInt(d.count200) || 0;
                        map[dStr].f300 = parseInt(d.count300) || 0;
                        map[dStr].fzbv = parseInt(d.countZBV) || 0;
                    });
                    return map;
                }, [filteredEvents, dailyFriendlyLosses, dateFrom, dateTo]);

                const chartDays = useMemo(() => {
                    const start = dateFrom || Object.keys(dailyMap).sort()[0];
                    const end = dateTo || Object.keys(dailyMap).sort().slice(-1)[0] || todayISO();
                    if (!start) return [];
                    const days = [];
                    let curr = new Date(start + 'T12:00:00');
                    const last = new Date(end + 'T12:00:00');
                    let guard = 0;
                    while (curr <= last && guard < 800) {
                        days.push(toISODate(curr));
                        curr.setDate(curr.getDate() + 1);
                        guard++;
                    }
                    return days;
                }, [dateFrom, dateTo, dailyMap]);
                
                const stats = useMemo(() => {
                    let e200 = 0, e200u = 0, e200d = 0, e300 = 0, epow = 0;
                    let f200 = 0, f300 = 0, fzbv = 0;
                    let weaponsCount = {};
                    let inflicters = {};
                    
                    filteredEvents.forEach(ev => {
                        (ev.enemyLosses || []).forEach(l => {
                            e200 += (l.count200 || 0) + (l.count200POW || 0);
                            e200u += (l.count200Unconfirmed || 0);
                            e200d += Number(l.count200Discovered || 0);
                            e300 += (l.count300 || 0);
                            
                            let shouldSubtractPow = false;
                            if ((l.count200POW || 0) > 0) {
                                if (!l.killedPowId || l.killedPowId === 'legacy') {
                                    shouldSubtractPow = true;
                                } else {
                                    const sourceEventId = l.killedPowId.split('_')[0];
                                    if (filteredEvents.some(e => e.id === sourceEventId)) {
                                        shouldSubtractPow = true;
                                    }
                                }
                            }
                            const effectiveDeadPow = shouldSubtractPow ? (l.count200POW || 0) : 0;
                            epow += (l.countPOW || 0) - effectiveDeadPow;
                            
                            const hit = (statsFilters.e200 ? ((l.count200 || 0) + (l.count200POW || 0)) : 0) + 
                                        (statsFilters.e200u ? (l.count200Unconfirmed || 0) : 0) + 
                                        (statsFilters.e200d ? Number(l.count200Discovered || 0) : 0) + 
                                        (statsFilters.e300 ? (l.count300 || 0) : 0) + 
                                        (statsFilters.epow ? ((l.countPOW || 0) - effectiveDeadPow) : 0);
                            
                            if (hit > 0) {
                                if (!weaponsCount[l.weapon]) weaponsCount[l.weapon] = 0;
                                weaponsCount[l.weapon] += hit;
                                const who = (l.inflicter || '').trim() || 'Не вказано';
                                if (!inflicters[who]) inflicters[who] = 0;
                                inflicters[who] += hit;
                            }
                        });
                    });

                    chartDays.forEach(d => {
                        const row = dailyMap[d];
                        if (!row) return;
                        f200 += row.f200 || 0;
                        f300 += row.f300 || 0;
                        fzbv += row.fzbv || 0;
                    });
                    
                    return { e200, e200u, e200d, e300, epow, f200, f300, fzbv, weaponsCount, inflicters };
                }, [filteredEvents, dailyMap, chartDays, statsFilters]);
                
                const enemyTotal = (includeE200 ? stats.e200 : 0) + 
                                   (include200Unc ? stats.e200u : 0) + 
                                   (include200Disc ? stats.e200d : 0) + 
                                   (include300 ? stats.e300 : 0) + 
                                   (includePOW ? stats.epow : 0);
                const friendlyTotal = (includeF200 ? stats.f200 : 0) + (includeF300 ? stats.f300 : 0) + (includeFZBV ? stats.fzbv : 0);
                const ratio = friendlyTotal > 0 ? (enemyTotal / friendlyTotal).toFixed(1) : (enemyTotal > 0 ? '∞' : '0.0');

                const sumSelected = (row, flags) => Object.keys(flags).reduce((s, id) => flags[id] ? s + (row[id] || 0) : s, 0);
                
                const trendChart = useMemo(() => {
                    const empty = { e200:0, e200u:0, e200d:0, e300:0, epow:0, f200:0, f300:0, fzbv:0 };
                    const labels = chartDays.map(d => formatDateUA(d).slice(0, 5));
                    const datasets = [];
                    LOSS_SERIES.forEach(s => {
                        if (!visibleCurves[s.id]) return;
                        datasets.push({
                            label: s.label,
                            data: chartDays.map(d => (dailyMap[d] || empty)[s.id] || 0),
                            borderColor: s.color,
                            backgroundColor: s.color + '33',
                            tension: 0.25,
                            fill: false,
                            pointRadius: chartDays.length > 40 ? 0 : 3,
                            borderWidth: 2,
                            yAxisID: 'y'
                        });
                    });
                    if (showCombined) {
                        const eIds = Object.keys(combineEnemy).filter(k => combineEnemy[k]);
                        const fIds = Object.keys(combineOurs).filter(k => combineOurs[k]);
                        if (eIds.length) {
                            datasets.push({
                                label: 'Зведення противника (' + eIds.map(id => LOSS_SERIES.find(s=>s.id===id)?.short).join('+') + ')',
                                data: chartDays.map(d => sumSelected(dailyMap[d] || empty, combineEnemy)),
                                borderColor: '#f43f5e',
                                backgroundColor: 'rgba(244,63,94,0.12)',
                                tension: 0.25,
                                fill: true,
                                borderWidth: 3,
                                pointRadius: 0,
                                yAxisID: 'y'
                            });
                        }
                        if (fIds.length) {
                            datasets.push({
                                label: 'Зведення наших (' + fIds.map(id => LOSS_SERIES.find(s=>s.id===id)?.short).join('+') + ')',
                                data: chartDays.map(d => sumSelected(dailyMap[d] || empty, combineOurs)),
                                borderColor: '#38bdf8',
                                backgroundColor: 'rgba(56,189,248,0.12)',
                                tension: 0.25,
                                fill: true,
                                borderWidth: 3,
                                pointRadius: 0,
                                yAxisID: 'y'
                            });
                        }
                        if (showRatioCurve && eIds.length && fIds.length) {
                            datasets.push({
                                label: 'Співвідношення (зведення)',
                                data: chartDays.map(d => {
                                    const e = sumSelected(dailyMap[d] || empty, combineEnemy);
                                    const f = sumSelected(dailyMap[d] || empty, combineOurs);
                                    if (f === 0) return e > 0 ? null : 0;
                                    return +(e / f).toFixed(2);
                                }),
                                borderColor: '#e2e8f0',
                                borderDash: [6, 4],
                                tension: 0.2,
                                fill: false,
                                borderWidth: 2,
                                pointRadius: 0,
                                yAxisID: 'y1',
                                spanGaps: true
                            });
                        }
                    }
                    return { labels, datasets };
                }, [chartDays, dailyMap, visibleCurves, combineEnemy, combineOurs, showCombined, showRatioCurve]);

                const trendOptions = useMemo(() => ({
                    interaction: { mode: 'index', intersect: false },
                    plugins: {
                        legend: { position: 'bottom', labels: { color: '#94a3b8', boxWidth: 12, font: { size: 11 } } },
                        datalabels: { display: false }
                    },
                    scales: {
                        x: { ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 12, color: '#64748b' }, grid: { color: 'rgba(51,65,85,0.35)' } },
                        y: { beginAtZero: true, title: { display: true, text: 'Кількість', color: '#64748b' }, ticks: { color: '#64748b' }, grid: { color: 'rgba(51,65,85,0.35)' } },
                        y1: { beginAtZero: true, position: 'right', title: { display: true, text: 'Співвідношення', color: '#94a3b8' }, ticks: { color: '#94a3b8' }, grid: { drawOnChartArea: false } }
                    }
                }), []);
                
                const weaponLabels = Object.keys(stats.weaponsCount).sort((a,b) => stats.weaponsCount[b] - stats.weaponsCount[a]);
                const weaponData = weaponLabels.map(l => stats.weaponsCount[l]);
                const pieData = {
                    labels: weaponLabels,
                    datasets: [{
                        data: weaponData,
                        backgroundColor: ['#ef4444', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316', '#64748b', '#0ea5e9'],
                        borderWidth: 0
                    }]
                };

                const lossStructureData = useMemo(() => {
                    const labels = ['200 (Вбито)', '200* (Ймов)', 'Виявлені 200', '300 (Поран)', 'Полонені'];
                    const data = [stats.e200, stats.e200u, stats.e200d, stats.e300, stats.epow];
                    const colors = ['#ef4444', '#f43f5e', '#a855f7', '#f59e0b', '#10b981'];
                    return {
                        labels,
                        datasets: [{
                            data,
                            backgroundColor: colors,
                            borderWidth: 0
                        }]
                    };
                }, [stats]);

                const locationStats = useMemo(() => {
                    const counts = {};
                    filteredEvents.forEach(ev => {
                        const loc = (ev.actionDetails?.factLoc || ev.actionDetails?.docLoc || ev.actionDetails?.position || ev.actionDetails?.direction || 'Не вказано').trim() || 'Не вказано';
                        if (!counts[loc]) {
                            counts[loc] = { total: 0, e200: 0, e200u: 0, e200d: 0, e300: 0, epow: 0 };
                        }
                        (ev.enemyLosses || []).forEach(l => {
                            const c200 = l.count200 || 0;
                            const c200u = l.count200Unconfirmed || 0;
                            const c200d = Number(l.count200Discovered || 0);
                            const c300 = l.count300 || 0;
                            const cpow = l.countPOW || 0;
                            counts[loc].e200 += c200;
                            counts[loc].e200u += c200u;
                            counts[loc].e200d += c200d;
                            counts[loc].e300 += c300;
                            counts[loc].epow += cpow;
                            counts[loc].total += (c200 + c200u + c200d + c300 + cpow);
                        });
                    });
                    return Object.entries(counts)
                        .filter(([name, d]) => d.total > 0)
                        .sort((a, b) => b[1].total - a[1].total)
                        .slice(0, 15);
                }, [filteredEvents]);

                const locationsChartData = useMemo(() => {
                    const labels = locationStats.map(([name]) => name.length > 25 ? name.slice(0, 22) + '...' : name);
                    return {
                        labels,
                        datasets: [
                            { label: '200 (Вбито)', data: locationStats.map(([_, d]) => d.e200), backgroundColor: '#ef4444', stack: 'loc' },
                            { label: '200* (Ймов)', data: locationStats.map(([_, d]) => d.e200u), backgroundColor: '#f43f5e', stack: 'loc' },
                            { label: 'Виявлені 200', data: locationStats.map(([_, d]) => d.e200d), backgroundColor: '#a855f7', stack: 'loc' },
                            { label: '300 (Поран)', data: locationStats.map(([_, d]) => d.e300), backgroundColor: '#f59e0b', stack: 'loc' },
                            { label: 'Полон', data: locationStats.map(([_, d]) => d.epow), backgroundColor: '#10b981', stack: 'loc' }
                        ]
                    };
                }, [locationStats]);

                const locationsChartOptions = useMemo(() => ({
                    indexAxis: 'y',
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { position: 'bottom', labels: { color: '#94a3b8', boxWidth: 10, font: { size: 10 } } },
                        datalabels: { display: false }
                    },
                    scales: {
                        x: { stacked: true, grid: { color: 'rgba(51,65,85,0.35)' }, ticks: { color: '#64748b' } },
                        y: { stacked: true, grid: { display: false }, ticks: { autoSkip: false, color: '#cbd5e1', font: { size: 11, weight: '500' } } }
                    }
                }), []);

                const timeStats = useMemo(() => {
                    const hourly = Array(24).fill(0);
                    const periods = { night: 0, morning: 0, day: 0, evening: 0, unknown: 0 };
                    let withTimeCount = 0;
                    
                    filteredEvents.forEach(ev => {
                        (ev.enemyLosses || []).forEach(l => {
                            const hitCount = (l.count200 || 0) + (l.count200Unconfirmed || 0) + Number(l.count200Discovered || 0) + (l.count300 || 0) + (l.countPOW || 0);
                            if (hitCount <= 0) return;
                            
                            const tStr = l.time || ev.actionDetails?.startTime;
                            if (tStr && /^\d{1,2}:\d{2}/.test(tStr.trim())) {
                                const h = parseInt(tStr.trim().split(':')[0], 10);
                                if (h >= 0 && h < 24) {
                                    hourly[h] += hitCount;
                                    withTimeCount += hitCount;
                                    if (h >= 0 && h < 6) periods.night += hitCount;
                                    else if (h >= 6 && h < 12) periods.morning += hitCount;
                                    else if (h >= 12 && h < 18) periods.day += hitCount;
                                    else periods.evening += hitCount;
                                    return;
                                }
                            }
                            periods.unknown += hitCount;
                        });
                    });
                    return { hourly, periods, withTimeCount };
                }, [filteredEvents]);

                const timeChartData = useMemo(() => {
                    const labels = Array.from({ length: 24 }, (_, i) => pad2(i) + ':00');
                    const colors = Array.from({ length: 24 }, (_, i) => {
                        if (i >= 0 && i < 6) return 'rgba(99, 102, 241, 0.75)';
                        if (i >= 6 && i < 12) return 'rgba(245, 158, 11, 0.75)';
                        if (i >= 12 && i < 18) return 'rgba(239, 68, 68, 0.75)';
                        return 'rgba(168, 85, 247, 0.75)';
                    });
                    return {
                        labels,
                        datasets: [{
                            label: 'Уражено ворога (чол)',
                            data: timeStats.hourly,
                            backgroundColor: colors,
                            borderRadius: 4,
                            borderWidth: 0
                        }]
                    };
                }, [timeStats]);

                const timeChartOptions = useMemo(() => ({
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { display: false },
                        datalabels: { display: false }
                    },
                    scales: {
                        x: { grid: { display: false }, ticks: { color: '#64748b', font: { size: 10 } } },
                        y: { beginAtZero: true, grid: { color: 'rgba(51,65,85,0.35)' }, ticks: { color: '#64748b' } }
                    }
                }), []);

                const topInflicters = Object.entries(stats.inflicters).sort((a,b)=>b[1]-a[1]).slice(0, 8);
                const heatMax = Math.max(1, ...chartDays.map(d => {
                    const r = dailyMap[d] || {};
                    return (r.e200||0)+(r.e200u||0)+(r.e200d||0)+(r.e300||0)+(r.epow||0);
                }));

                const applyCurvePreset = (name) => {
                    if (name === '300') {
                        setVisibleCurves({ e200:false, e200u:false, e300:true, epow:false, f200:false, f300:true, fzbv:false });
                        setShowCombined(false);
                    } else if (name === '200') {
                        setVisibleCurves({ e200:true, e200u:false, e300:false, epow:false, f200:true, f300:false, fzbv:false });
                        setShowCombined(false);
                    } else if (name === 'confirmed') {
                        setVisibleCurves({ e200:false, e200u:false, e300:false, epow:false, f200:false, f300:false, fzbv:false });
                        setCombineEnemy({ e200:true, e300:false, epow:true, e200u:false, e200d:false });
                        setCombineOurs({ f200:true, f300:false, fzbv:false });
                        setShowCombined(true);
                        setShowRatioCurve(true);
                    } else if (name === 'noStar') {
                        setVisibleCurves({ e200:false, e200u:false, e300:false, epow:false, f200:false, f300:false, fzbv:false });
                        setCombineEnemy({ e200:true, e300:true, epow:true, e200u:false, e200d:false });
                        setCombineOurs({ f200:true, f300:true, fzbv:true });
                        setShowCombined(true);
                        setShowRatioCurve(true);
                    }
                };

                const copySummary = async (event) => {
                    event?.preventDefault();
                    event?.stopPropagation();
                    const period = `${dateFrom ? formatDateUA(dateFrom) : '…'} — ${dateTo ? formatDateUA(dateTo) : '…'}`;
                    const text = [
                        `Зведення втрат за період ${period}`,
                        `Подій: ${filteredEvents.length}`,
                        `Противник: 200=${stats.e200}, 200*=${stats.e200u}, виявлені 200=${stats.e200d}, 300=${stats.e300}, полон=${stats.epow}`,
                        `Наші: 200=${stats.f200}, 300=${stats.f300}, ЗБВ=${stats.fzbv}`,
                        `Співвідношення (обрані типи в блоці вище): 1 : ${ratio}`
                    ].join('\n');
                    try {
                        await navigator.clipboard.writeText(text);
                        showToast('Зведення скопійовано');
                    } catch {
                        showToast('Не вдалося скопіювати');
                    }
                };

                const toggleCurve = (id) => setVisibleCurves(p => ({ ...p, [id]: !p[id] }));
                
                return (
                    <div className="flex-1 overflow-y-auto p-4 md:p-6 bg-[#020617]">
                        <div className="w-full max-w-[2400px] px-2 lg:px-4 mx-auto space-y-6">
                            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                                <h1 className="text-2xl font-bold text-slate-100 tracking-tight">Дашборд (Звіти)</h1>
                                <div className="flex flex-wrap items-center gap-3 bg-slate-900 p-2 rounded-xl border border-slate-800">
                                    <div className="flex items-center gap-2">
                                        <span className="text-xs text-slate-400 font-semibold pl-2">З:</span>
                                        <input type="date" value={dateFrom} onChange={e=>setDateFrom(e.target.value)} className="bg-slate-950 border border-slate-700 rounded-lg px-2 py-1 text-xs focus:border-amber-500" />
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <span className="text-xs text-slate-400 font-semibold">По:</span>
                                        <input type="date" value={dateTo} onChange={e=>setDateTo(e.target.value)} className="bg-slate-950 border border-slate-700 rounded-lg px-2 py-1 text-xs focus:border-amber-500" />
                                    </div>
                                    <DatePresets dateFrom={dateFrom} dateTo={dateTo} setDateFrom={setDateFrom} setDateTo={setDateTo} />
                                    <button type="button" onClick={copySummary} className="ml-auto px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-slate-800 border border-slate-700 text-slate-200 hover:border-amber-500/50 flex items-center gap-1">
                                        <Icon name="copy" className="w-3.5 h-3.5" /> Копіювати зведення
                                    </button>
                                </div>
                            </div>
                            
                            {/* Блок 1: Співвідношення втрат */}
                            <div className="bg-gradient-to-br from-slate-900 to-slate-950 border border-slate-800 rounded-2xl p-6 shadow-xl relative overflow-hidden">
                                <div className="absolute top-0 right-0 w-64 h-64 bg-amber-500/5 rounded-full blur-3xl -mr-10 -mt-10 pointer-events-none"></div>
                                <h2 className="text-lg font-bold text-slate-200 mb-4 flex items-center gap-2"><Icon name="pie-chart" className="w-5 h-5 text-amber-500"/> Співвідношення втрат (сума за період)</h2>
                                
                                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                                    <div className="col-span-1 lg:col-span-2 flex flex-col md:flex-row items-center justify-around bg-slate-950/50 p-6 rounded-xl border border-slate-800/50 gap-6">
                                        <div className="text-center w-full md:w-auto">
                                            <div className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-2">Наші втрати</div>
                                            <div className="text-4xl font-mono font-bold text-blue-400">{friendlyTotal}</div>
                                            <div className="text-[10px] text-slate-500 mt-2 font-mono">200: {stats.f200} | 300: {stats.f300} | ЗБВ: {stats.fzbv}</div>
                                        </div>
                                        <div className="flex flex-col items-center w-full md:w-auto">
                                            <div className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-1">Співвідношення</div>
                                            <div className="text-5xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-red-500 whitespace-nowrap">1 : {ratio}</div>
                                        </div>
                                        <div className="text-center w-full md:w-auto">
                                            <div className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-2">Втрати ворога</div>
                                            <div className="text-4xl font-mono font-bold text-red-400">{enemyTotal}</div>
                                            <div className="text-[10px] text-slate-500 mt-2 font-mono">200: {stats.e200} | 200*: {stats.e200u} | вияв: {stats.e200d} | 300: {stats.e300} | полон: {stats.epow}</div>
                                        </div>
                                    </div>
                                    
                                    <div className="bg-slate-950/50 p-5 rounded-xl border border-slate-800/50 flex flex-col justify-center space-y-4 relative z-10">
                                        <div>
                                            <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2">Втрати ворога</h3>
                                            <div className="space-y-1.5">
                                                <label className="flex items-center gap-2 cursor-pointer text-sm font-medium text-slate-300 hover:text-white transition">
                                                    <input type="checkbox" checked={includeE200} onChange={e=>setIncludeE200(e.target.checked)} className="w-4 h-4 rounded bg-slate-900 border-slate-700 text-amber-500 focus:ring-amber-500" />
                                                    200 (Вбито)
                                                </label>
                                                <label className="flex items-center gap-2 cursor-pointer text-sm font-medium text-slate-300 hover:text-white transition">
                                                    <input type="checkbox" checked={include200Unc} onChange={e=>setInclude200Unc(e.target.checked)} className="w-4 h-4 rounded bg-slate-900 border-slate-700 text-amber-500 focus:ring-amber-500" />
                                                    200* (Ймовірно)
                                                </label>
                                                <label className="flex items-center gap-2 cursor-pointer text-sm font-medium text-purple-300 hover:text-purple-200 transition">
                                                    <input type="checkbox" checked={include200Disc} onChange={e=>setInclude200Disc(e.target.checked)} className="w-4 h-4 rounded bg-slate-900 border-slate-700 text-purple-500 focus:ring-purple-500" />
                                                    Виявлені 200
                                                </label>
                                                <label className="flex items-center gap-2 cursor-pointer text-sm font-medium text-slate-300 hover:text-white transition">
                                                    <input type="checkbox" checked={include300} onChange={e=>setInclude300(e.target.checked)} className="w-4 h-4 rounded bg-slate-900 border-slate-700 text-amber-500 focus:ring-amber-500" />
                                                    300 (Поранені)
                                                </label>
                                                <label className="flex items-center gap-2 cursor-pointer text-sm font-medium text-slate-300 hover:text-white transition">
                                                    <input type="checkbox" checked={includePOW} onChange={e=>setIncludePOW(e.target.checked)} className="w-4 h-4 rounded bg-slate-900 border-slate-700 text-amber-500 focus:ring-amber-500" />
                                                    Полонені
                                                </label>
                                            </div>
                                        </div>
                                        <div className="border-t border-slate-800 pt-3">
                                            <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2">Наші втрати</h3>
                                            <div className="space-y-1.5">
                                                <label className="flex items-center gap-2 cursor-pointer text-sm font-medium text-slate-300 hover:text-white transition">
                                                    <input type="checkbox" checked={includeF200} onChange={e=>setIncludeF200(e.target.checked)} className="w-4 h-4 rounded bg-slate-900 border-slate-700 text-blue-500 focus:ring-blue-500" />
                                                    Наші 200
                                                </label>
                                                <label className="flex items-center gap-2 cursor-pointer text-sm font-medium text-slate-300 hover:text-white transition">
                                                    <input type="checkbox" checked={includeF300} onChange={e=>setIncludeF300(e.target.checked)} className="w-4 h-4 rounded bg-slate-900 border-slate-700 text-blue-500 focus:ring-blue-500" />
                                                    Наші 300
                                                </label>
                                                <label className="flex items-center gap-2 cursor-pointer text-sm font-medium text-slate-300 hover:text-white transition">
                                                    <input type="checkbox" checked={includeFZBV} onChange={e=>setIncludeFZBV(e.target.checked)} className="w-4 h-4 rounded bg-slate-900 border-slate-700 text-blue-500 focus:ring-blue-500" />
                                                    ЗБВ
                                                </label>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Блок 2: Загальні цифри (противник) - 5 симетричних інтерактивних карток */}
                            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl">
                                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4">
                                    <h2 className="text-sm font-bold text-slate-300 uppercase tracking-wider flex items-center gap-2">
                                        <Icon name="bar-chart" className="w-4 h-4 text-amber-500"/> Загальні цифри (противник)
                                    </h2>
                                    <span className="text-[11px] text-slate-400">💡 Натискайте на картку, щоб активувати/зняти тип у підрахунках нижче</span>
                                </div>
                                <div data-testid="discovered-total" className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-2">
                                    <div onClick={() => setStatsFilters(p => ({...p, e200: !p.e200}))} className={`cursor-pointer transition border p-4 rounded-xl text-center select-none ${statsFilters.e200 ? 'bg-red-950/20 border-red-900/50 shadow-[0_0_15px_rgba(239,68,68,0.15)]' : 'bg-slate-950/50 border-slate-800 opacity-50 hover:opacity-80'}`}>
                                        <div className="flex items-center justify-center gap-1.5 mb-1">
                                            <input type="checkbox" checked={statsFilters.e200} readOnly className="w-3.5 h-3.5 rounded bg-slate-900 border-slate-700 text-red-500 pointer-events-none" />
                                            <div className="text-xs text-slate-400 uppercase font-semibold">200 (Вбито)</div>
                                        </div>
                                        <div className={`text-3xl font-bold font-mono ${statsFilters.e200 ? 'text-red-500' : 'text-slate-500'}`}>{stats.e200}</div>
                                    </div>
                                    <div onClick={() => setStatsFilters(p => ({...p, e200u: !p.e200u}))} className={`cursor-pointer transition border p-4 rounded-xl text-center select-none ${statsFilters.e200u ? 'bg-rose-950/20 border-rose-900/50 shadow-[0_0_15px_rgba(244,63,94,0.15)]' : 'bg-slate-950/50 border-slate-800 opacity-50 hover:opacity-80'}`}>
                                        <div className="flex items-center justify-center gap-1.5 mb-1">
                                            <input type="checkbox" checked={statsFilters.e200u} readOnly className="w-3.5 h-3.5 rounded bg-slate-900 border-slate-700 text-rose-500 pointer-events-none" />
                                            <div className="text-xs text-slate-400 uppercase font-semibold">200* (Ймов)</div>
                                        </div>
                                        <div className={`text-3xl font-bold font-mono ${statsFilters.e200u ? 'text-rose-400' : 'text-slate-500'}`}>{stats.e200u}</div>
                                    </div>
                                    <div onClick={() => setStatsFilters(p => ({...p, e200d: !p.e200d}))} className={`cursor-pointer transition border p-4 rounded-xl text-center select-none ${statsFilters.e200d ? 'bg-purple-950/30 border-purple-800/60 shadow-[0_0_15px_rgba(168,85,247,0.2)]' : 'bg-slate-950/50 border-slate-800 opacity-50 hover:opacity-80'}`}>
                                        <div className="flex items-center justify-center gap-1.5 mb-1">
                                            <input type="checkbox" checked={statsFilters.e200d} readOnly className="w-3.5 h-3.5 rounded bg-slate-900 border-slate-700 text-purple-500 pointer-events-none" />
                                            <div className="text-xs text-purple-300 uppercase font-semibold">Виявлені 200</div>
                                        </div>
                                        <div data-testid="discovered-total-value" className={`text-3xl font-bold font-mono ${statsFilters.e200d ? 'text-purple-300' : 'text-slate-500'}`}>{stats.e200d}</div>
                                    </div>
                                    <div onClick={() => setStatsFilters(p => ({...p, e300: !p.e300}))} className={`cursor-pointer transition border p-4 rounded-xl text-center select-none ${statsFilters.e300 ? 'bg-amber-950/20 border-amber-900/50 shadow-[0_0_15px_rgba(245,158,11,0.15)]' : 'bg-slate-950/50 border-slate-800 opacity-50 hover:opacity-80'}`}>
                                        <div className="flex items-center justify-center gap-1.5 mb-1">
                                            <input type="checkbox" checked={statsFilters.e300} readOnly className="w-3.5 h-3.5 rounded bg-slate-900 border-slate-700 text-amber-500 pointer-events-none" />
                                            <div className="text-xs text-slate-400 uppercase font-semibold">300 (Поран)</div>
                                        </div>
                                        <div className={`text-3xl font-bold font-mono ${statsFilters.e300 ? 'text-amber-500' : 'text-slate-500'}`}>{stats.e300}</div>
                                    </div>
                                    <div onClick={() => setStatsFilters(p => ({...p, epow: !p.epow}))} className={`cursor-pointer transition border p-4 rounded-xl text-center select-none ${statsFilters.epow ? 'bg-emerald-950/20 border-emerald-900/50 shadow-[0_0_15px_rgba(16,185,129,0.15)]' : 'bg-slate-950/50 border-slate-800 opacity-50 hover:opacity-80'}`}>
                                        <div className="flex items-center justify-center gap-1.5 mb-1">
                                            <input type="checkbox" checked={statsFilters.epow} readOnly className="w-3.5 h-3.5 rounded bg-slate-900 border-slate-700 text-emerald-500 pointer-events-none" />
                                            <div className="text-xs text-slate-400 uppercase font-semibold">Полонені</div>
                                        </div>
                                        <div className={`text-3xl font-bold font-mono ${statsFilters.epow ? 'text-emerald-500' : 'text-slate-500'}`}>{stats.epow}</div>
                                    </div>
                                </div>
                                <div className="text-[10px] text-slate-500 italic text-right">«Виявлені 200» — окремий облік виявлених тіл; зніміть галочку, якщо потрібно виключити з аналітичних розподілів.</div>
                            </div>

                            {/* Блок 3: Поденні втрати і співвідношення */}
                            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl">
                                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 mb-4">
                                    <h2 className="text-sm font-bold text-slate-200 uppercase tracking-wider flex items-center gap-2">
                                        <Icon name="trending-up" className="w-4 h-4 text-amber-500"/> Поденні втрати і співвідношення
                                    </h2>
                                    <div className="flex flex-wrap gap-1.5">
                                        <button type="button" onClick={()=>applyCurvePreset('200')} className="px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-slate-950 border border-slate-700 text-slate-300 hover:border-red-500/50">200 vs 200</button>
                                        <button type="button" onClick={()=>applyCurvePreset('300')} className="px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-slate-950 border border-slate-700 text-slate-300 hover:border-amber-500/50">300 vs 300</button>
                                        <button type="button" onClick={()=>applyCurvePreset('confirmed')} className="px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-slate-950 border border-slate-700 text-slate-300 hover:border-emerald-500/50">200+полон vs наші 200</button>
                                        <button type="button" onClick={()=>applyCurvePreset('noStar')} className="px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-slate-950 border border-slate-700 text-slate-300 hover:border-rose-500/50">Усе без 200*</button>
                                        <button type="button" onClick={()=>setChartType(t => t==='line'?'bar':'line')} className="px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-slate-800 border border-slate-600 text-slate-200">{chartType==='line' ? 'Стовпці' : 'Лінії'}</button>
                                    </div>
                                </div>

                                <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
                                    <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-3">
                                        <div className="text-[10px] font-bold text-slate-500 uppercase mb-2">Окремі криві</div>
                                        <div className="flex flex-wrap gap-2">
                                            {LOSS_SERIES.map(s => (
                                                <label key={s.id} className="series-chip flex items-center gap-1.5 text-xs font-semibold cursor-pointer px-2 py-1 rounded-lg border" style={{ borderColor: visibleCurves[s.id] ? s.color : '#334155', color: visibleCurves[s.id] ? s.color : '#94a3b8' }}>
                                                    <input type="checkbox" checked={!!visibleCurves[s.id]} onChange={()=>toggleCurve(s.id)} />
                                                    {s.short}
                                                </label>
                                            ))}
                                        </div>
                                    </div>
                                    <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-3">
                                        <label className="flex items-center gap-2 text-[10px] font-bold text-slate-500 uppercase mb-2 cursor-pointer">
                                            <input type="checkbox" checked={showCombined} onChange={e=>setShowCombined(e.target.checked)} />
                                            Зведення противника (сума обраних)
                                        </label>
                                        <div className="flex flex-wrap gap-2">
                                            {LOSS_SERIES.filter(s=>s.side==='enemy').map(s => (
                                                <label key={s.id} className="flex items-center gap-1.5 text-xs font-semibold cursor-pointer text-slate-300">
                                                    <input type="checkbox" checked={!!combineEnemy[s.id]} onChange={()=>setCombineEnemy(p=>({...p,[s.id]:!p[s.id]}))} />
                                                    {s.short}
                                                </label>
                                            ))}
                                        </div>
                                    </div>
                                    <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-3">
                                        <label className="flex items-center gap-2 text-[10px] font-bold text-slate-500 uppercase mb-2 cursor-pointer">
                                            <input type="checkbox" checked={showRatioCurve} onChange={e=>setShowRatioCurve(e.target.checked)} />
                                            Зведення наших + співвідношення
                                        </label>
                                        <div className="flex flex-wrap gap-2">
                                            {LOSS_SERIES.filter(s=>s.side==='ours').map(s => (
                                                <label key={s.id} className="flex items-center gap-1.5 text-xs font-semibold cursor-pointer text-slate-300">
                                                    <input type="checkbox" checked={!!combineOurs[s.id]} onChange={()=>setCombineOurs(p=>({...p,[s.id]:!p[s.id]}))} />
                                                    {s.short}
                                                </label>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                                <p className="text-[11px] text-slate-500 mb-3">Галочки зліва малюють кожен тип окремо. Зведення складає обрані типи в одну криву. Пунктир — поденне співвідношення зведень. Наші втрати беруться з таблиці аналітики.</p>
                                <div className="h-[340px]">
                                    {chartDays.length > 0 && trendChart.datasets.length > 0 ? (
                                        <ChartComponent type={chartType} data={trendChart} options={trendOptions} className="h-full" />
                                    ) : (
                                        <div className="h-full flex items-center justify-center text-slate-500 text-sm border border-dashed border-slate-800 rounded-xl">Оберіть хоча б одну криву або зведення</div>
                                    )}
                                </div>
                            </div>

                            {/* Блок 4: Теплова карта інтенсивності */}
                            {chartDays.length > 0 && (
                                <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5">
                                    <h2 className="text-sm font-bold text-slate-300 uppercase tracking-wider mb-3 flex items-center gap-2"><Icon name="calendar" className="w-4 h-4 text-amber-500"/> Інтенсивність втрат противника по днях</h2>
                                    <div className="flex flex-wrap gap-1">
                                        {chartDays.map(d => {
                                            const r = dailyMap[d] || {};
                                            const v = (r.e200||0)+(r.e200u||0)+(r.e200d||0)+(r.e300||0)+(r.epow||0);
                                            const a = v === 0 ? 0.08 : 0.18 + 0.82 * (v / heatMax);
                                            return (
                                                <div key={d} className="heat-cell w-3.5 h-3.5 rounded-sm" title={`${formatDateUA(d)}: противник ${v} (200:${r.e200||0} 200*:${r.e200u||0} вияв:${r.e200d||0} 300:${r.e300||0} полон:${r.epow||0})`} style={{ backgroundColor: `rgba(239,68,68,${a})` }} />
                                            );
                                        })}
                                    </div>
                                    <div className="text-[10px] text-slate-500 mt-2">Наведіть на клітинку — побачите розкладку за день.</div>
                                </div>
                            )}
                            
                            {/* Блок 5: Аналітичні графіки (Структура втрат, Засоби ураження, Топ локацій, Час доби) */}
                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                                {/* Графік A: Структура втрат противника */}
                                <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl flex flex-col">
                                    <h2 className="text-sm font-bold text-slate-300 uppercase tracking-wider mb-4 flex items-center gap-2">
                                        <Icon name="pie-chart" className="w-4 h-4 text-rose-500"/> Структура втрат ворога
                                    </h2>
                                    <div className="flex-1 min-h-[260px]">
                                        {stats.e200 + stats.e200u + stats.e200d + stats.e300 + stats.epow > 0 ? (
                                            <ChartComponent type="doughnut" data={lossStructureData} options={{plugins: {legend: {position: 'bottom', labels: {color: '#94a3b8', font: {size: 11, family: 'Inter'}}}, datalabels: {display: false}}, cutout: '55%'}} />
                                        ) : <div className="flex items-center justify-center h-full text-slate-500 text-sm">Немає даних за період</div>}
                                    </div>
                                </div>

                                {/* Графік B: Засоби ураження */}
                                <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl flex flex-col">
                                    <h2 className="text-sm font-bold text-slate-300 uppercase tracking-wider mb-4 flex items-center gap-2">
                                        <Icon name="target" className="w-4 h-4 text-red-500"/> Засоби ураження
                                    </h2>
                                    <div className="flex-1 min-h-[260px]">
                                        {weaponLabels.length > 0 ? (
                                            <ChartComponent type="doughnut" data={pieData} options={{plugins: {legend: {position: 'bottom', labels: {color: '#94a3b8', font: {size: 11, family: 'Inter'}}}, datalabels: {display: false}}, cutout: '55%'}} />
                                        ) : <div className="flex items-center justify-center h-full text-slate-500 text-sm">Немає даних</div>}
                                    </div>
                                </div>

                                {/* Графік C: Топ локацій ураження */}
                                <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl flex flex-col">
                                    <div className="flex items-center justify-between mb-4">
                                        <h2 className="text-sm font-bold text-slate-300 uppercase tracking-wider flex items-center gap-2">
                                            <Icon name="map-pin" className="w-4 h-4 text-emerald-400"/> Топ локацій ураження ворога
                                        </h2>
                                        <span className="text-[10px] text-slate-500 uppercase font-semibold">Місце / Позиція</span>
                                    </div>
                                    <div className="w-full relative mt-2" style={{ height: Math.max(280, locationStats.length * 32) + 'px' }}>
                                        {locationStats.length > 0 ? (
                                            <ChartComponent type="bar" data={locationsChartData} options={locationsChartOptions} className="w-full h-full" />
                                        ) : <div className="flex items-center justify-center h-full text-slate-500 text-sm">Не вказано локацій у подіях</div>}
                                    </div>
                                </div>

                                {/* Графік D: Розподіл за часом доби */}
                                <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl flex flex-col">
                                    <div className="flex items-center justify-between mb-2">
                                        <h2 className="text-sm font-bold text-slate-300 uppercase tracking-wider flex items-center gap-2">
                                            <Icon name="clock" className="w-4 h-4 text-sky-400"/> Розподіл за часом доби
                                        </h2>
                                        <span className="text-[10px] text-slate-400 font-mono bg-slate-800 px-2 py-0.5 rounded">
                                            Уражень з часом: {timeStats.withTimeCount}
                                        </span>
                                    </div>
                                    <div className="grid grid-cols-4 gap-2 mb-3 text-center">
                                        <div className="bg-slate-950/70 border border-indigo-900/40 rounded-lg p-1.5">
                                            <div className="text-[10px] text-indigo-400 font-semibold">🌙 Ніч (00-06)</div>
                                            <div className="text-base font-bold font-mono text-indigo-200">{timeStats.periods.night}</div>
                                        </div>
                                        <div className="bg-slate-950/70 border border-amber-900/40 rounded-lg p-1.5">
                                            <div className="text-[10px] text-amber-400 font-semibold">🌅 Ранок (06-12)</div>
                                            <div className="text-base font-bold font-mono text-amber-200">{timeStats.periods.morning}</div>
                                        </div>
                                        <div className="bg-slate-950/70 border border-red-900/40 rounded-lg p-1.5">
                                            <div className="text-[10px] text-red-400 font-semibold">☀️ День (12-18)</div>
                                            <div className="text-base font-bold font-mono text-red-200">{timeStats.periods.day}</div>
                                        </div>
                                        <div className="bg-slate-950/70 border border-purple-900/40 rounded-lg p-1.5">
                                            <div className="text-[10px] text-purple-400 font-semibold">🌆 Вечір (18-24)</div>
                                            <div className="text-base font-bold font-mono text-purple-200">{timeStats.periods.evening}</div>
                                        </div>
                                    </div>
                                    <div className="flex-1 min-h-[220px]">
                                        <ChartComponent type="bar" data={timeChartData} options={timeChartOptions} />
                                    </div>
                                </div>
                            </div>

                            {/* Блок 6: Хто наносив ураження */}
                            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl">
                                <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider mb-3 flex items-center gap-2">
                                    <Icon name="shield" className="w-4 h-4 text-amber-500"/> Хто наносив ураження (підрозділи / позивні)
                                </h3>
                                {topInflicters.length === 0 ? <div className="text-slate-500 text-sm">Немає даних за позивними</div> : (
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-2">
                                        {topInflicters.map(([name, n]) => (
                                            <div key={name} className="flex items-center gap-3 text-sm">
                                                <span className="w-44 truncate text-slate-300 font-medium">{name}</span>
                                                <div className="flex-1 h-2 bg-slate-800 rounded-full overflow-hidden">
                                                    <div className="h-full bg-amber-500/80 rounded-full" style={{ width: `${(n / topInflicters[0][1]) * 100}%` }} />
                                                </div>
                                                <span className="font-mono text-slate-300 w-10 text-right font-bold">{n}</span>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                );
            };

        const handleOpenPrintableReport = (data) => {
            const { events: rawEvents, allEvents, dateFrom, dateTo, weaponFilter, eventFilters } = data;
            try {
                const win = window.open('', '_blank');
                if (!win) {
                    alert("Будь ласка, дозвольте відкриття спливаючих вікон у браузері");
                    return;
                }

                // Filter logic
                const filteredEvents = rawEvents.filter(ev => {
                    if (weaponFilter !== 'all' && !(ev.enemyLosses || []).some(l => l.weapon === weaponFilter)) return false;
                    
                    const hasActiveFilters = eventFilters ? Object.values(eventFilters).some(v => v) : false;
                    if (hasActiveFilters) {
                        let keep = false;
                        const e200 = ev.enemyLosses.reduce((s,l)=>s+(l.count200||0),0);
                        const e200u = ev.enemyLosses.reduce((s,l)=>s+(l.count200Unconfirmed||0),0);
                        const e200d = ev.enemyLosses.reduce((s,l)=>s+Number(l.count200Discovered||0),0);
                        const e300 = ev.enemyLosses.reduce((s,l)=>s+(l.count300||0),0);
                        const capturedPOW = ev.enemyLosses.some(l => l.countPOW > 0);
                        const killedPOW = ev.enemyLosses.some(l => l.count200POW > 0);
                        
                        if (eventFilters.e200 && e200 > 0) keep = true;
                        if (eventFilters.e200u && e200u > 0) keep = true;
                        if (eventFilters.e200d && e200d > 0) keep = true;
                        if (eventFilters.e300 && e300 > 0) keep = true;
                        if (eventFilters.epow && capturedPOW) keep = true;
                        if (eventFilters.epowDead && killedPOW) keep = true;
                        
                        if (!keep) return false;
                    }
                    return true;
                });

                let e200 = 0, e200u = 0, e200d = 0, e300 = 0, epow = 0;
                const weaponsCount = {};
                const locCount = {};
                
                filteredEvents.forEach(ev => {
                    const lStr = ev.actionDetails?.documentLocation || ev.actionDetails?.actualLocation || 'Невідомо';
                    if (!locCount[lStr]) locCount[lStr] = 0;
                    
                    ev.enemyLosses.forEach(l => {
                        if (weaponFilter !== 'all' && l.weapon !== weaponFilter) return;
                        e200 += (l.count200 || 0) + (l.count200POW || 0);
                        e200u += (l.count200Unconfirmed || 0);
                        e200d += Number(l.count200Discovered || 0);
                        e300 += (l.count300 || 0);
                        
                        let shouldSubtractPow = false;
                        if ((l.count200POW || 0) > 0) {
                            if (!l.killedPowId || l.killedPowId === 'legacy') {
                                shouldSubtractPow = true;
                            } else {
                                const sourceEventId = l.killedPowId.split('_')[0];
                                if ((allEvents || rawEvents).some(e => e.id === sourceEventId)) {
                                    shouldSubtractPow = true;
                                }
                            }
                        }
                        const effDeadPow = shouldSubtractPow ? (l.count200POW || 0) : 0;
                        epow += (l.countPOW || 0) - effDeadPow;
                        
                        const hit = ((l.count200||0)+(l.count200POW||0)) + (l.count200Unconfirmed||0) + Number(l.count200Discovered||0) + (l.count300||0) + ((l.countPOW||0)-effDeadPow);
                        if (hit > 0) {
                            if (!weaponsCount[l.weapon]) weaponsCount[l.weapon] = 0;
                            weaponsCount[l.weapon] += hit;
                            locCount[lStr] += hit;
                        }
                    });
                });

                const topWeapons = Object.entries(weaponsCount).sort((a,b)=>b[1]-a[1]).slice(0, 10);
                const maxW = topWeapons[0] ? topWeapons[0][1] : 1;
                const topWeaponsHtml = topWeapons.map(([w, c]) => {
                    const pct = Math.max(1, Math.round((c / maxW) * 100));
                    return `<tr><td style="padding:4px 6px;">${escapeHtml(w)}<svg width="100%" height="8" style="display:block; margin-top:4px;"><rect width="100%" height="100%" fill="#e2e8f0" rx="3"></rect><rect width="${pct}%" height="100%" fill="#d97706" rx="3"></rect></svg></td><td style="width:40px; text-align:right; font-weight:bold; vertical-align:middle;">${escapeHtml(c)}</td></tr>`;
                }).join('');
                const topLocs = Object.entries(locCount).sort((a,b)=>b[1]-a[1]).slice(0, 10);
                const maxL = topLocs[0] ? topLocs[0][1] : 1;
                const topLocsHtml = topLocs.map(([l, c]) => {
                    const pct = Math.max(1, Math.round((c / maxL) * 100));
                    return `<tr><td style="padding:4px 6px;">${escapeHtml(l)}<svg width="100%" height="8" style="display:block; margin-top:4px;"><rect width="100%" height="100%" fill="#e2e8f0" rx="3"></rect><rect width="${pct}%" height="100%" fill="#475569" rx="3"></rect></svg></td><td style="width:40px; text-align:right; font-weight:bold; vertical-align:middle;">${escapeHtml(c)}</td></tr>`;
                }).join('');

                const periodStr = (dateFrom || dateTo) 
                    ? `${dateFrom ? dateFrom.split('-').reverse().join('.') : 'Початок'} — ${dateTo ? dateTo.split('-').reverse().join('.') : 'Сьогодні'}` 
                    : 'За весь період ведення бойових дій';
                const nowStr = new Date().toLocaleString('uk-UA');

                const rowsHtml = filteredEvents.map(ev => {
                    const dStr = getEventDateStr(ev).split('-').reverse().join('.');
                    const loc = ev.actionDetails?.docLoc || ev.actionDetails?.factLoc || '-';
                    const desc = escapeHtml(ev.description).replace(/\n/g, '<br>');
                    
                    const lossesHtml = ev.enemyLosses.map(l => {
                        if (weaponFilter !== 'all' && l.weapon !== weaponFilter) return '';
                        const parts = [];
                        const c200 = (l.count200||0) + (l.count200POW||0);
                        if (c200 > 0) parts.push(`200: ${c200}`);
                        if (l.count300 > 0) parts.push(`300: ${l.count300}`);
                        if (l.countPOW > 0) parts.push(`ПОЛОН: ${l.countPOW}`);
                        if (l.count200Unconfirmed > 0) parts.push(`200*: ${l.count200Unconfirmed}`);
                        if (l.count200Discovered > 0) parts.push(`ВИЯВ: ${l.count200Discovered}`);
                        if (parts.length === 0) return '';
                        
                        const cList = [
                            ...(l.callsigns200||[]).filter(c=>c),
                            ...(l.callsigns200Unconfirmed||[]).filter(c=>c),
                            ...(l.callsigns200Discovered||[]).filter(c=>c),
                            ...(l.callsigns300||[]).filter(c=>c),
                            ...(l.callsignsPOW||[]).filter(c=>c),
                            ...(l.callsigns200POW||[]).filter(c=>c)
                        ];
                        const cStr = cList.length > 0 ? ` <span style="color:#64748b; font-size:7pt;">[${escapeHtml(cList.join(', '))}]</span>` : '';
                        
                        return `<div style="margin-bottom:2px;"><b>${escapeHtml(parts.join(', '))}</b>${cStr} <span style="color:#475569;">(${escapeHtml(l.weapon)})</span></div>`;
                    }).join('');

                    
                    const total200 = ev.enemyLosses.reduce((s,l) => s + (l.count200||0) + (l.count200POW||0), 0);
                    const total300 = ev.enemyLosses.reduce((s,l) => s + (l.count300||0), 0);
                    const totalPOW = ev.enemyLosses.reduce((s,l) => s + (l.countPOW||0), 0);
                    return `
                        <tr class="event-row" data-h200="${total200>0?'1':'0'}" data-h300="${total300>0?'1':'0'}" data-hpow="${totalPOW>0?'1':'0'}">
                            <td style="font-weight:700; color:#334155; vertical-align:top;">${escapeHtml(dStr)}</td>
                            <td style="vertical-align:top;">${escapeHtml(loc)}</td>
                            <td style="vertical-align:top;">${lossesHtml}</td>
                            <td style="vertical-align:top; text-align:justify;">${desc}</td>
                        </tr>
                    `;
                }).join('');

                const htmlContent = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>Звіт щодо втрат противника</title>
    <style>
        body { font-family: 'Inter', -apple-system, sans-serif; font-size: 10pt; color: #1e293b; line-height: 1.4; background: #f8fafc; padding: 20px; margin: 0; }
        .action-bar {
            background: #0f172a; padding: 12px 20px; border-radius: 8px; margin-bottom: 20px;
            box-shadow: 0 4px 15px rgba(0,0,0,0.1); color: #e2e8f0; font-size: 9pt;
        }
        .action-btn {
            background: #d97706; color: white; border: none; padding: 6px 14px; border-radius: 6px;
            font-weight: 600; cursor: pointer; font-size: 9pt; transition: background 0.2s;
        }
        .action-btn:hover { background: #b45309; }
        .action-btn.secondary { background: #334155; }
        .action-btn.secondary:hover { background: #475569; }
        .check-toggle { display: inline-flex; align-items: center; gap: 4px; cursor: pointer; user-select: none; }
        .check-toggle input { cursor: pointer; accent-color: #d97706; }
        
        .page-container {
            max-width: 1200px; margin: 0 auto; background: #ffffff; padding: 24px 28px;
            box-shadow: 0 4px 20px rgba(0,0,0,0.08); border-radius: 8px;
        }
        .header-title { text-align: center; border-bottom: 2px solid #0f172a; padding-bottom: 8px; margin-bottom: 14px; }
        .header-title h1 { font-size: 13pt; font-weight: 800; text-transform: uppercase; margin: 0 0 4px 0; color: #0f172a; }
        .meta-info { display: flex; justify-content: space-between; font-size: 8pt; color: #475569; font-weight: 500; }
        
        .summary-grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 8px; margin-bottom: 14px; }
        .summary-card { border: 1px solid #cbd5e1; border-radius: 6px; padding: 8px 10px; background: #f8fafc; }
        .summary-card .label { font-size: 7.5pt; text-transform: uppercase; font-weight: 700; color: #64748b; margin-bottom: 2px; }
        .summary-card .value { font-size: 15pt; font-weight: 800; color: #0f172a; line-height: 1.1; }
        
        .section-title {
            font-size: 8.5pt; font-weight: 800; text-transform: uppercase; color: #0f172a;
            border-left: 3px solid #0f172a; padding-left: 6px; margin: 12px 0 6px 0;
        }
        .two-cols { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-bottom: 14px; }
        
        table.data-table { width: 100%; border-collapse: collapse; font-size: 7.5pt; margin-bottom: 12px; }
        table.data-table th, table.data-table td { border: 1px solid #cbd5e1; padding: 4px 6px; text-align: left; vertical-align: top; }
        table.data-table th { background-color: #f1f5f9; font-weight: 700; color: #1e293b; text-transform: uppercase; }
        table.data-table tr:nth-child(even) { background-color: #f8fafc; }
        
        .footer-sign { margin-top: 32px; padding-top: 14px; display: flex; justify-content: space-between; font-size: 8.5pt; font-weight: 600; }

        @media print {
            body { background: #ffffff !important; padding: 0 !important; font-size: 8pt !important; }
            .page-container { box-shadow: none !important; padding: 0 !important; max-width: 100% !important; }
            .action-bar { display: none !important; }
            .summary-card { border: 1px solid #94a3b8 !important; }
            table.data-table th, table.data-table td { border: 1px solid #94a3b8 !important; }
            tr { page-break-inside: avoid; break-inside: avoid; }
            @page { size: A4 portrait; margin: 8mm; }
        }
    </style>
</head>
<body>
    <div class="action-bar">
        <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #334155; padding-bottom: 10px; margin-bottom: 10px; flex-wrap: wrap; gap: 10px;">
            <div style="display: flex; align-items: center; gap: 10px; flex-wrap: wrap;">
                <span style="font-weight: 800; font-size: 9.5pt; color: #f59e0b; text-transform: uppercase; letter-spacing: 0.5px;">🎛️ Конструктор доповіді:</span>
            </div>
            <div style="display: flex; gap: 8px;">
                <button class="action-btn" onclick="window.print()">🖨️ Друк / PDF</button>
                <button class="action-btn secondary" onclick="window.close()">✕ Закрити</button>
            </div>
        </div>
        <div style="display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin-bottom: 8px;">
            <span style="color: #94a3b8; font-weight: 700;">Реєстр:</span>
            <label class="check-toggle"><input type="checkbox" id="f-200" onchange="filterRegister()"> Тільки 200</label>
            <label class="check-toggle"><input type="checkbox" id="f-300" onchange="filterRegister()"> Тільки 300</label>
            <label class="check-toggle"><input type="checkbox" id="f-pow" onchange="filterRegister()"> Тільки полонені</label>
        </div>
        <div style="display: flex; align-items: center; gap: 12px; flex-wrap: wrap;">
            <span style="color: #94a3b8; font-weight: 700;">Блоки:</span>
            <label class="check-toggle"><input type="checkbox" id="chk-cards" checked onchange="toggleBlock('block-cards', this.checked)"> Зведені картки</label>
            <label class="check-toggle"><input type="checkbox" id="chk-analytics" checked onchange="toggleBlock('block-analytics', this.checked)"> Аналітика</label>
            <label class="check-toggle"><input type="checkbox" id="chk-register" checked onchange="toggleBlock('block-register', this.checked)"> Реєстр втрат</label>
            <label class="check-toggle"><input type="checkbox" id="chk-signs" checked onchange="toggleBlock('block-signs', this.checked)"> Підписи</label>
        </div>
    </div>

    <div class="page-container" id="printable-doc">
        <div class="header-title" id="block-header">
            <h1 id="doc-main-title">БОЙОВЕ ДОНЕСЕННЯ / ЗВЕДЕННЯ ПРО ВТРАТИ ПРОТИВНИКА</h1>
            <div class="meta-info">
                <div>Період: <b>${escapeHtml(periodStr)}</b></div>
                <div>Засоби ураження: <b>${escapeHtml(weaponFilter === 'all' ? 'Всі' : weaponFilter)}</b></div>
                <div>Сформовано: <b>${nowStr}</b></div>
            </div>
        </div>

        <div id="block-cards" class="summary-grid">
            <div class="summary-card" style="border-left: 3px solid #0f172a;">
                <div class="label">Загиблі (200)</div>
                <div class="value">${escapeHtml(e200)}</div>
            </div>
            <div class="summary-card" style="border-left: 3px solid #dc2626;">
                <div class="label" style="color: #dc2626;">Поранені (300)</div>
                <div class="value" style="color: #dc2626;">${escapeHtml(e300)}</div>
            </div>
            <div class="summary-card" style="border-left: 3px solid #16a34a;">
                <div class="label" style="color: #16a34a;">Полонені</div>
                <div class="value" style="color: #16a34a;">${escapeHtml(epow)}</div>
            </div>
            <div class="summary-card" style="border-left: 3px solid #8b5cf6;">
                <div class="label" style="color: #8b5cf6;">Виявлені тіла</div>
                <div class="value" style="color: #8b5cf6;">${escapeHtml(e200d)}</div>
            </div>
            <div class="summary-card" style="border-left: 3px solid #f59e0b;">
                <div class="label" style="color: #f59e0b;">Непідтв. (200*)</div>
                <div class="value" style="color: #f59e0b;">${escapeHtml(e200u)}</div>
            </div>
        </div>

        <div id="block-analytics">
            <div class="two-cols">
                <div>
                    <div class="section-title">Топ засобів ураження</div>
                    <table class="data-table">
                        ${topWeapons.length > 0 ? topWeaponsHtml : '<tr><td colspan="2" style="text-align:center; color:#94a3b8;">Дані відсутні</td></tr>'}
                    </table>
                </div>
                <div>
                    <div class="section-title">Топ локацій ураження</div>
                    <table class="data-table">
                        ${topLocs.length > 0 ? topLocsHtml : '<tr><td colspan="2" style="text-align:center; color:#94a3b8;">Дані відсутні</td></tr>'}
                    </table>
                </div>
            </div>
        </div>

        <div id="block-register">
            <div class="section-title">Детальний реєстр подій (<span id="register-count">${filteredEvents.length}</span> записів)</div>
            <table class="data-table" id="register-table">
                <thead>
                    <tr>
                        <th style="width: 50px;">Дата</th>
                        <th style="width: 120px;">Місце</th>
                        <th style="width: 180px;">Втрати</th>
                        <th>Деталі / Опис</th>
                    </tr>
                </thead>
                <tbody>
                    ${rowsHtml || '<tr><td colspan="4" style="text-align:center; color:#94a3b8; padding:10px;">Дані відсутні за обраними критеріями</td></tr>'}
                </tbody>
            </table>
        </div>

        <div id="block-signs" class="footer-sign">
            <div>Посада ______________</div>
            <div>В/звання ______________</div>
            <div>Прізвище, ініціали __________________</div>
            <div>Підпис ______________</div>
        </div>
    </div>

    <script>
        function toggleBlock(blockId, isVisible) {
            var el = document.getElementById(blockId);
            if (el) el.style.display = isVisible ? (blockId === 'block-cards' ? 'grid' : (blockId === 'block-signs' ? 'flex' : 'block')) : 'none';
        }
        function filterRegister() {
            var only200 = document.getElementById('f-200').checked;
            var only300 = document.getElementById('f-300').checked;
            var onlyPow = document.getElementById('f-pow').checked;
            
            var rows = document.querySelectorAll('.event-row');
            var visCount = 0;
            rows.forEach(function(r) {
                var h200 = r.getAttribute('data-h200') === '1';
                var h300 = r.getAttribute('data-h300') === '1';
                var hpow = r.getAttribute('data-hpow') === '1';
                
                var show = true;
                if (only200 && !h200) show = false;
                if (only300 && !h300) show = false;
                if (onlyPow && !hpow) show = false;
                
                r.style.display = show ? '' : 'none';
                if (show) visCount++;
            });
            document.getElementById('register-count').innerText = visCount;
        }
    </script>
</body>
</html>`;
                
                win.document.open();
                win.document.write(htmlContent);
                win.document.close();
            } catch (err) {
                console.error("handleOpenPrintableReport error:", err);
                alert("Помилка формування доповіді: " + err.message);
            }
        };

        const AnalyticsView = ({ onGenerateReport }) => {
                const { dailyFriendlyLosses, events, medicalSync, settings, showToast } = React.useContext(EnemyAppContext);
                const [dateFrom, setDateFrom] = useState('');
                const [dateTo, setDateTo] = useState('');
                const [weaponFilter, setWeaponFilter] = useState('all');
                const [eventFilters, setEventFilters] = useState({ e200: false, e200u: false, e200d: false, e300: false, epow: false, epowDead: false });
                const [expandedDates, setExpandedDates] = useState({});
                
                const toggleFilter = (k) => setEventFilters(p => ({...p, [k]: !p[k]}));

                const toggleExpand = (dateStr) => {
                    setExpandedDates(prev => ({...prev, [dateStr]: !prev[dateStr]}));
                };

                const handleExportExcel = async () => {
                    if (!window.ExcelJS) {
                        showToast("Бібліотека ExcelJS не завантажена");
                        return;
                    }
                    
                    try {
                        const workbook = new window.ExcelJS.Workbook();
                        const sheet = workbook.addWorksheet('Облік втрат');
                        
                        sheet.columns = [
                            { header: 'ID', key: 'id', width: 10 },
                            { header: 'Дата', key: 'date', width: 15 },
                            { header: 'Час', key: 'time', width: 12 },
                            { header: 'Типи', key: 'types', width: 15 },
                            { header: '200', key: 'e200', width: 10 },
                            { header: '200*', key: 'e200u', width: 10 },
                            { header: '300', key: 'e300', width: 10 },
                            { header: 'Полон', key: 'epow', width: 10 },
                            { header: '200(п)', key: 'e200pow', width: 10 },
                            { header: 'Наші 200', key: 'f200', width: 12 },
                            { header: 'Наші 300', key: 'f300', width: 12 },
                            { header: 'ЗБВ', key: 'fzbv', width: 10 },
                            { header: 'Ким проводилось', key: 'conductedBy', width: 20 },
                            { header: 'Док. місце', key: 'docLoc', width: 20 },
                            { header: 'Факт. місце', key: 'factLoc', width: 20 },
                            { header: 'Напрямок', key: 'direction', width: 20 },
                            { header: 'К-ть о/с', key: 'friendlyCount', width: 10 },
                            { header: 'Сили ворога', key: 'enemySize', width: 15 },
                            { header: 'Техніка', key: 'vehicleDetails', width: 20 },
                            { header: 'Позивні ворога', key: 'callsigns', width: 40 },
                            { header: 'Опис', key: 'desc', width: 50 }
                        ];
                        
                        sheet.getRow(1).font = { bold: true };
                        
                        const sortedEvents = [...filteredEvents].sort((a, b) => {
                            const dateA = getEventDateStr(a) || '';
                            const dateB = getEventDateStr(b) || '';
                            if (dateA !== dateB) return dateA.localeCompare(dateB);
                            const timeA = a.actionDetails?.startTime || '';
                            const timeB = b.actionDetails?.startTime || '';
                            return timeA.localeCompare(timeB);
                        });
                        
                        sortedEvents.forEach(ev => {
                            const e200 = (ev.enemyLosses||[]).reduce((s,l)=>s+(l.count200||0)+(l.count200POW||0),0);
                            const e200u = (ev.enemyLosses||[]).reduce((s,l)=>s+(l.count200Unconfirmed||0),0);
                            const e300 = (ev.enemyLosses||[]).reduce((s,l)=>s+(l.count300||0),0);
                            const epow = (ev.enemyLosses||[]).reduce((s,l)=>s+(l.countPOW||0)-(l.count200POW||0),0);
                            const e200pow = (ev.enemyLosses||[]).reduce((s,l)=>s+(l.count200POW||0),0);
                            
                            const cList = [];
                            (ev.enemyLosses||[]).forEach(l => {
                                if(l.callsigns200) cList.push(...l.callsigns200.filter(c=>c).map(c=>`200:${c}`));
                                if(l.callsigns200Unconfirmed) cList.push(...l.callsigns200Unconfirmed.filter(c=>c).map(c=>`200*:${c}`));
                                if(l.callsigns200Discovered) cList.push(...l.callsigns200Discovered.filter(c=>c).map(c=>`Вияв:${c}`));
                                if(l.callsigns300) cList.push(...l.callsigns300.filter(c=>c).map(c=>`300:${c}`));
                                if(l.callsignsPOW) cList.push(...l.callsignsPOW.filter(c=>c).map(c=>`Полон:${c}`));
                                if(l.callsigns200POW) cList.push(...l.callsigns200POW.filter(c=>c).map(c=>`Заг.Полон:${c}`));
                            });
                            const callsStr = String(cList.join(', '));
                            
                            const dStrRaw = getEventDateStr(ev);
                            const dStr = dStrRaw ? dStrRaw.split('-').reverse().join('.') : '';
                            const tStr = ev.actionDetails?.startTime ? ev.actionDetails.startTime + (ev.actionDetails.endTime ? ' - ' + ev.actionDetails.endTime : '') : '';
                            
                            sheet.addRow({
                                id: ev.id,
                                date: dStr,
                                time: tStr,
                                types: (ev.types||[]).join('|'),
                                e200: e200,
                                e200u: e200u,
                                e300: e300,
                                epow: epow,
                                e200pow: e200pow,
                                f200: ev.friendlyLosses?.count200||0,
                                f300: ev.friendlyLosses?.count300||0,
                                fzbv: ev.friendlyLosses?.countZBV||0,
                                conductedBy: ev.actionDetails?.conductedBy || '',
                                docLoc: ev.actionDetails?.docLoc || '',
                                factLoc: ev.actionDetails?.factLoc || '',
                                direction: ev.actionDetails?.direction || '',
                                friendlyCount: ev.actionDetails?.friendlyCount || '',
                                enemySize: ev.actionDetails?.enemySize || '',
                                vehicleDetails: ev.actionDetails?.hasVehicles ? (ev.actionDetails?.vehicleDetails || 'Так') : '',
                                callsigns: callsStr,
                                desc: ev.description||''
                            });
                        });
                        
                        
                        const sheet2 = workbook.addWorksheet('Деталізація по ураженнях');
                        
                        sheet2.columns = [
                            { header: 'ID Події', key: 'id', width: 10 },
                            { header: 'Дата', key: 'date', width: 15 },
                            { header: 'Час', key: 'time', width: 12 },
                            { header: 'Тип (Зброя)', key: 'weapon', width: 25 },
                            { header: '200', key: 'e200', width: 10 },
                            { header: '200*', key: 'e200u', width: 10 },
                            { header: '300', key: 'e300', width: 10 },
                            { header: 'Полон', key: 'epow', width: 10 },
                            { header: '200(п)', key: 'e200pow', width: 10 },
                            { header: 'Наші 200', key: 'f200', width: 12 },
                            { header: 'Наші 300', key: 'f300', width: 12 },
                            { header: 'ЗБВ', key: 'fzbv', width: 10 },
                            { header: 'Позивні ворога', key: 'callsigns', width: 40 },
                            { header: 'Опис події', key: 'desc', width: 50 }
                        ];
                        
                        sheet2.getRow(1).font = { bold: true };
                        
                        sortedEvents.forEach(ev => {
                            const dStrRaw = getEventDateStr(ev);
                            const dStr = dStrRaw ? dStrRaw.split('-').reverse().join('.') : '';
                            const tStr = ev.actionDetails?.startTime ? ev.actionDetails.startTime + (ev.actionDetails.endTime ? ' - ' + ev.actionDetails.endTime : '') : '';
                            const f200 = ev.friendlyLosses?.count200||0;
                            const f300 = ev.friendlyLosses?.count300||0;
                            const fzbv = ev.friendlyLosses?.countZBV||0;
                            const desc = ev.description||'';
                            
                            (ev.enemyLosses||[]).forEach(l => {
                                const e200 = (l.count200||0) + (l.count200POW||0);
                                const e200u = l.count200Unconfirmed||0;
                                const e300 = l.count300||0;
                                const epow = (l.countPOW||0) - (l.count200POW||0);
                                const e200pow = l.count200POW||0;
                                
                                const cList = [];
                                if(l.callsigns200) cList.push(...l.callsigns200.filter(c=>c).map(c=>`200:${c}`));
                                if(l.callsigns200Unconfirmed) cList.push(...l.callsigns200Unconfirmed.filter(c=>c).map(c=>`200*:${c}`));
                                if(l.callsigns200Discovered) cList.push(...l.callsigns200Discovered.filter(c=>c).map(c=>`Вияв:${c}`));
                                if(l.callsigns300) cList.push(...l.callsigns300.filter(c=>c).map(c=>`300:${c}`));
                                if(l.callsignsPOW) cList.push(...l.callsignsPOW.filter(c=>c).map(c=>`Полон:${c}`));
                                if(l.callsigns200POW) cList.push(...l.callsigns200POW.filter(c=>c).map(c=>`Заг.Полон:${c}`));
                                const callsStr = String(cList.join(', '));
                                
                                sheet2.addRow({
                                    id: ev.id,
                                    date: dStr,
                                    time: tStr,
                                    weapon: l.weapon || 'Невідомо',
                                    e200: e200,
                                    e200u: e200u,
                                    e300: e300,
                                    epow: epow,
                                    e200pow: e200pow,
                                    f200: f200,
                                    f300: f300,
                                    fzbv: fzbv,
                                    callsigns: callsStr,
                                    desc: desc
                                });
                            });
                        });
                        
                        const buffer = await workbook.xlsx.writeBuffer();
                        const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
                        const link = document.createElement('a');
                        link.href = URL.createObjectURL(blob);
                        const today = window.SuiteDates.localISO();
                        link.download = `oblik-vtrat-${today}.xlsx`;
                        link.click();
                        URL.revokeObjectURL(link.href);
                        showToast('Експорт в Excel завершено');
                    } catch (err) {
                        console.error("Excel export error:", err);
                        showToast('Помилка при експорті Excel');
                    }
                };

                // Фільтруємо події за датою та зброєю (якщо обрано конкретну)
                const filteredEvents = useMemo(() => {
                    return events.filter(ev => {
                        const dateStr = getEventDateStr(ev);
                        if (dateFrom && dateStr < dateFrom) return false;
                        if (dateTo && dateStr > dateTo) return false;
                        return true;
                    });
                }, [events, dateFrom, dateTo]);

                // Групуємо по днях
                const groupedByDate = useMemo(() => {
                    const groups = {};
                    filteredEvents.forEach(ev => {
                        const dStr = getEventDateStr(ev);
                        if (!groups[dStr]) groups[dStr] = { c200: 0, c200Unc: 0, c200Discovered: 0, c300: 0, pow: 0, losses: [], events: [] };
                        
                        groups[dStr].events.push(ev);
                        
                        ev.enemyLosses.forEach(l => {
                            if (weaponFilter !== 'all' && l.weapon !== weaponFilter) return;
                            
                            groups[dStr].c200 += (l.count200 || 0) + (l.count200POW || 0);
                            groups[dStr].c200Unc += (l.count200Unconfirmed || 0);
                            groups[dStr].c200Discovered += Number(l.count200Discovered || 0);
                            groups[dStr].c300 += (l.count300 || 0);
                            
                            let shouldSubtractPow = false;
                            if ((l.count200POW || 0) > 0) {
                                if (!l.killedPowId || l.killedPowId === 'legacy') {
                                    shouldSubtractPow = true;
                                } else {
                                    const sourceEventId = l.killedPowId.split('_')[0];
                                    if (filteredEvents.some(e => e.id === sourceEventId)) {
                                        shouldSubtractPow = true;
                                    }
                                }
                            }
                            groups[dStr].pow += (l.countPOW || 0) - (shouldSubtractPow ? (l.count200POW || 0) : 0);
                            
                            groups[dStr].losses.push({...l, eventId: ev.id});
                        });
                    });
                    
                    return groups;
                }, [filteredEvents, weaponFilter]);

                const sortedDates = useMemo(() => {
                    const allDates = new Set(Object.keys(groupedByDate));
                    Object.keys(dailyFriendlyLosses).forEach(d => allDates.add(d));
                    
                    let minDate = new Date();
                    let maxDate = new Date();
                    
                    if (allDates.size > 0) {
                        const sorted = Array.from(allDates).sort();
                        minDate = new Date(sorted[0]);
                        maxDate = new Date(sorted[sorted.length - 1]);
                    }
                    
                    if (dateFrom) minDate = new Date(dateFrom);
                    if (dateTo) maxDate = new Date(dateTo);
                    
                    const continuousDates = new Set();
                    let curr = new Date(minDate);
                    
                    if (!isNaN(curr.getTime()) && !isNaN(maxDate.getTime())) {
                        let count = 0;
                        while (curr <= maxDate && count < 3650) {
                            continuousDates.add(toISODate(curr));
                            curr.setDate(curr.getDate() + 1);
                            count++;
                        }
                    } else {
                        allDates.forEach(d => continuousDates.add(d));
                    }
                    
                    const finalDates = Array.from(continuousDates).filter(d => {
                        if (dateFrom && d < dateFrom) return false;
                        if (dateTo && d > dateTo) return false;
                        return true;
                    });
                    
                    const hasActiveFilters = Object.values(eventFilters).some(v => v);
                    let filteredFinalDates = finalDates;
                    
                    if (hasActiveFilters) {
                        filteredFinalDates = finalDates.filter(date => {
                            const dayData = groupedByDate[date] || { c200: 0, c200Unc: 0, c200Discovered: 0, c300: 0, pow: 0, losses: [] };
                            
                            if (eventFilters.e200 && dayData.c200 > 0) return true;
                            if (eventFilters.e200u && dayData.c200Unc > 0) return true;
                            if (eventFilters.e200d && dayData.c200Discovered > 0) return true;
                            if (eventFilters.e300 && dayData.c300 > 0) return true;
                            
                            const capturedPOW = dayData.losses.some(l => l.countPOW > 0);
                            const killedPOW = dayData.losses.some(l => l.count200POW > 0);
                            
                            if (eventFilters.epow && capturedPOW) return true;
                            if (eventFilters.epowDead && killedPOW) return true;
                            
                            return false;
                        });
                    }
                    
                    return filteredFinalDates.sort((a,b) => b.localeCompare(a));
                }, [groupedByDate, dailyFriendlyLosses, dateFrom, dateTo, eventFilters]);

                const activeStats = useMemo(() => {
                    let days = 0;
                    let records = 0;
                    sortedDates.forEach(date => {
                        const dayData = groupedByDate[date] || { c200: 0, c200Unc: 0, c200Discovered: 0, c300: 0, pow: 0, losses: [] };
                        const fLoss = dailyFriendlyLosses[date] || { count200: 0, count300: 0, countZBV: 0 };
                        if(dayData.c200 === 0 && dayData.c200Unc === 0 && dayData.c200Discovered === 0 && dayData.c300 === 0 && dayData.pow === 0 && (!fLoss.count200 && !fLoss.count300 && !fLoss.countZBV) && weaponFilter !== 'all') return;
                        days++;
                        records += dayData.losses.length;
                    });
                    return { days, records };
                }, [sortedDates, groupedByDate, dailyFriendlyLosses, weaponFilter]);

                return (
                    <div className="flex-1 overflow-y-auto p-4 md:p-6 bg-[#020617]">
                        <div className="w-full max-w-[2400px] px-2 lg:px-4 mx-auto space-y-6">
                            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                                <h1 className="text-2xl font-bold text-slate-100 tracking-tight">Аналітика / Звіти <span className="text-sm font-normal text-slate-400">({activeStats.records} записів)</span></h1>
                                <div className="flex flex-wrap items-center gap-3 bg-slate-900 p-2 rounded-xl border border-slate-800">
                                    <div className="flex items-center gap-2">
                                        <span className="text-xs text-slate-400 font-semibold pl-2">З:</span>
                                        <input type="date" value={dateFrom} onChange={e=>setDateFrom(e.target.value)} className="bg-slate-950 border border-slate-700 rounded-lg px-2 py-1 text-xs focus:border-amber-500" />
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <span className="text-xs text-slate-400 font-semibold">По:</span>
                                        <input type="date" value={dateTo} onChange={e=>setDateTo(e.target.value)} className="bg-slate-950 border border-slate-700 rounded-lg px-2 py-1 text-xs focus:border-amber-500" />
                                    </div>
                                    <div className="h-6 w-px bg-slate-800 mx-1"></div>
                                    <select value={weaponFilter} onChange={e=>setWeaponFilter(e.target.value)} className="bg-slate-950 border border-slate-700 rounded-lg px-2 py-1 text-xs focus:border-amber-500">
                                        <option value="all">Усі засоби ураження</option>
                                        {settings.weapons.map(w => <option key={w} value={w}>{w}</option>)}
                                    </select>
                                    <div className="h-6 w-px bg-slate-800 mx-1 hidden lg:block"></div>
                                    <div className="flex gap-1 bg-slate-950 p-1 border border-slate-700 rounded-lg flex-wrap">
                                        <button onClick={() => toggleFilter('e200')} className={`px-2 py-0.5 text-[10px] font-bold rounded transition-colors ${eventFilters.e200 ? 'bg-red-500 text-white' : 'text-slate-500 hover:bg-slate-800'}`}>200</button>
                                        <button onClick={() => toggleFilter('e200u')} className={`px-2 py-0.5 text-[10px] font-bold rounded transition-colors ${eventFilters.e200u ? 'bg-rose-400 text-white' : 'text-slate-500 hover:bg-slate-800'}`}>200*</button>
                                        <button onClick={() => toggleFilter('e200d')} className={`px-2 py-0.5 text-[10px] font-bold rounded transition-colors ${eventFilters.e200d ? 'bg-purple-500 text-white' : 'text-slate-500 hover:bg-slate-800'}`}>ВИЯВ</button>
                                        <button onClick={() => toggleFilter('e300')} className={`px-2 py-0.5 text-[10px] font-bold rounded transition-colors ${eventFilters.e300 ? 'bg-amber-500 text-slate-900' : 'text-slate-500 hover:bg-slate-800'}`}>300</button>
                                        <button onClick={() => toggleFilter('epow')} className={`px-2 py-0.5 text-[10px] font-bold rounded transition-colors ${eventFilters.epow ? 'bg-emerald-500 text-white' : 'text-slate-500 hover:bg-slate-800'}`}>ПОЛОН</button>
                                        <button onClick={() => toggleFilter('epowDead')} className={`px-2 py-0.5 text-[10px] font-bold rounded transition-colors ${eventFilters.epowDead ? 'bg-rose-600 text-white' : 'text-slate-500 hover:bg-slate-800'}`}>200(п)</button>
                                    </div>
                                    <div className="flex-1 min-w-[20px]"></div>
                                    <button onClick={handleExportExcel} className="bg-emerald-700 hover:bg-emerald-600 text-emerald-50 font-bold py-1.5 px-3 rounded-lg text-xs transition whitespace-nowrap shadow-[0_0_15px_rgba(4,120,87,0.4)] flex items-center gap-1.5 border border-emerald-600">
                                        <Icon name="file-spreadsheet" className="w-4 h-4" /> Excel
                                    </button>
                                    <button onClick={() => onGenerateReport({ events: filteredEvents, allEvents: events, dateFrom, dateTo, weaponFilter, eventFilters })} className="bg-amber-600 hover:bg-amber-500 text-white font-bold py-1.5 px-3 rounded-lg text-xs transition whitespace-nowrap shadow-[0_0_15px_rgba(217,119,6,0.4)] flex items-center gap-1.5">
                                        <Icon name="printer" className="w-4 h-4" /> PDF Звіт
                                    </button>
                                    <DatePresets dateFrom={dateFrom} dateTo={dateTo} setDateFrom={setDateFrom} setDateTo={setDateTo} />
                                </div>
                            </div>

                            <div data-testid="medical-sync-status" className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-2">
                                <h2 className="font-bold text-slate-200 flex items-center gap-2"><Icon name="refresh-cw" className="w-5 h-5 text-emerald-400" /> Наші втрати — автоматично з медичного модуля</h2>
                                <p className="text-xs text-slate-400">За датою події: бойові 200, 300 та ЗБВ. Бойові травмування включено до 300. Небойові втрати, СЗЧ і дезертирство не враховуються. Один запис епізоду — одна втрата; зміни вносьте в «Медичній евакуації».</p>
                                <p className="text-xs text-slate-400">Ручне введення й Excel-імпорт вимкнені. Старі ручні та імпортовані підсумки не додаються до автоматичних.</p>
                                {medicalSync.loading ? <p role="status" className="text-xs text-amber-300">Завантаження медичних записів…</p> : medicalSync.error ? <p role="alert" className="text-xs text-red-300">Не вдалося оновити дані: {medicalSync.error} Перейдіть до медичного модуля й перевірте базу.</p> : <p className="text-xs text-emerald-300">Враховано епізодів: {medicalSync.included}. Інших типів пропущено: {medicalSync.excluded}.</p>}
                                {!!medicalSync.invalid && <p role="alert" className="text-xs text-amber-300">Не враховано записів із некоректною датою або структурою: {medicalSync.invalid}. Виправте їх у медичному модулі.</p>}
                                {!!medicalSync.duplicates && <p className="text-xs text-amber-300">Повторних ідентифікаторів епізодів пропущено: {medicalSync.duplicates}.</p>}
                            </div>
                            
                            <p className="text-xs text-purple-200">«Виявлені 200» обліковуються окремо від «200». На вузькому екрані прокрутіть таблицю горизонтально — усі колонки залишаються доступними.</p>
                            <div data-testid="daily-records" className="bg-slate-900 border border-slate-800 rounded-2xl overflow-x-auto shadow-xl">
                                <div className="grid grid-cols-10 min-w-[1050px] gap-2 bg-slate-950 p-3 border-b border-slate-800 text-[10px] sm:text-xs font-bold text-slate-400 uppercase tracking-wider">
                                    <div className="col-span-2 md:col-span-2">Дата</div>
                                    <div className="text-center text-red-500">200 (Вор)</div>
                                    <div className="text-center text-rose-400" title="Не підтверджено">200*</div>
                                    <div className="text-center text-purple-300">Виявлені 200</div>
                                    <div className="text-center text-amber-500">300 (Вор)</div>
                                    <div className="text-center text-emerald-500">Полон</div>
                                    <div className="text-center text-blue-500 border-l border-slate-800 pl-2">Наші 200</div>
                                    <div className="text-center text-blue-400">Наші 300</div>
                                    <div className="text-center text-blue-300">ЗБВ</div>
                                </div>
                                
                                <div className="divide-y divide-slate-800/50">
                                    {sortedDates.length === 0 ? (
                                        <div className="p-6 text-center text-slate-500 text-sm">Немає даних за обраний період/фільтр</div>
                                    ) : (
                                        sortedDates.map(date => {
                                            const dayData = groupedByDate[date] || { c200: 0, c200Unc: 0, c200Discovered: 0, c300: 0, pow: 0, losses: [] };
                                            const fLoss = dailyFriendlyLosses[date] || { count200: 0, count300: 0, countZBV: 0 };
                                            const isExpanded = expandedDates[date];
                                            
                                            // Не показуємо пусті рядки якщо обрано фільтр і за день нічого не знайдено, і немає наших втрат
                                            if(dayData.c200 === 0 && dayData.c200Unc === 0 && dayData.c200Discovered === 0 && dayData.c300 === 0 && dayData.pow === 0 && (!fLoss.count200 && !fLoss.count300 && !fLoss.countZBV) && weaponFilter !== 'all') return null;

                                            return (
                                                <div key={date} data-document-date={date} className="group min-w-[1050px]">
                                                    <div 
                                                        onClick={() => toggleExpand(date)}
                                                        className="grid grid-cols-10 gap-2 p-2 hover:bg-slate-800/50 cursor-pointer transition-colors items-center"
                                                    >
                                                        <div className="col-span-2 flex items-center gap-2 px-1">
                                                            <Icon name={isExpanded ? "chevron-down" : "chevron-right"} className="w-4 h-4 text-slate-500" />
                                                            <span className="font-semibold text-slate-200">{date}</span>
                                                        </div>
                                                        <div className="text-center font-mono font-bold text-red-400 text-sm">{dayData.c200}</div>
                                                        <div className="text-center font-mono font-bold text-rose-300 text-sm">{dayData.c200Unc}</div>
                                                        <div data-testid="daily-discovered" className="text-center font-mono font-bold text-purple-300 text-sm bg-purple-950/30 rounded py-1">{dayData.c200Discovered}</div>
                                                        <div className="text-center font-mono font-bold text-amber-400 text-sm">{dayData.c300}</div>
                                                        <div className="text-center font-mono font-bold text-emerald-400 text-sm">{dayData.pow}</div>
                                                        <div className="text-center border-l border-slate-800 pl-2">
                                                            <span data-testid="daily-friendly-200" className="block font-mono text-sm text-blue-400 py-1">{medicalSync.loading ? '…' : medicalSync.error ? '—' : fLoss.count200 || 0}</span>
                                                        </div>
                                                        <div className="text-center">
                                                            <span data-testid="daily-friendly-300" className="block font-mono text-sm text-blue-300 py-1">{medicalSync.loading ? '…' : medicalSync.error ? '—' : fLoss.count300 || 0}</span>
                                                        </div>
                                                        <div className="text-center pr-2">
                                                            <span data-testid="daily-friendly-zbv" className="block font-mono text-sm text-indigo-300 py-1">{medicalSync.loading ? '…' : medicalSync.error ? '—' : fLoss.countZBV || 0}</span>
                                                        </div>
                                                    </div>
                                                    
                                                    {/* Деталі розгорнутого рядка */}
                                                    {isExpanded && (
                                                        <div className="bg-slate-950/80 p-4 border-t border-slate-800">
                                                            <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Деталізація за день:</h4>
                                                            {dayData.losses.length > 0 ? (
                                                                <div className="overflow-x-auto">
                                                                    <table className="w-full text-sm text-left text-slate-300">
                                                                        <thead className="text-xs text-slate-500 uppercase bg-slate-900 border-b border-slate-800">
                                                                            <tr>
                                                                                <th className="px-3 py-2 rounded-tl-lg text-slate-400">Час</th>
                                                                                <th className="px-4 py-2">Засіб ураження</th>
                                                                                <th className="px-4 py-2">Хто наносив</th>
                                                                                <th className="px-4 py-2">Позивний ворога</th>
                                                                                <th className="px-4 py-2 text-center text-red-400">200</th>
                                                                                <th className="px-4 py-2 text-center text-rose-300">200*</th>
                                                                                <th className="px-4 py-2 text-center text-purple-300">Виявлені 200</th>
                                                                                <th className="px-4 py-2 text-center text-amber-400">300</th>
                                                                                <th className="px-4 py-2 text-center text-rose-500" title="Вбиті полонені">200(п)</th>
                                                                                <th className="px-4 py-2 text-center text-emerald-400 rounded-tr-lg">Полон</th>
                                                                            </tr>
                                                                        </thead>
                                                                        <tbody className="divide-y divide-slate-800/50">
                                                                            {dayData.losses.map((l, i) => (
                                                                                <tr key={i} className="hover:bg-slate-900/50 transition-colors">
                                                                                    <td className="px-3 py-2 font-mono text-xs text-amber-400/90 whitespace-nowrap">{l.time ? `🕒 ${l.time}` : <span className="text-slate-600">—</span>}</td>
                                                                                    <td className="px-4 py-2 font-medium">{l.weapon}</td>
                                                                                    <td className="px-4 py-2">{l.inflicter || <span className="text-slate-600">-</span>}</td>
                                                                                    <td className="px-4 py-2 text-xs">
                                                                                        {[
                                                                                            ...(l.callsigns200||[]).filter(c=>c),
                                                                                            ...(l.callsigns200Unconfirmed||[]).filter(c=>c),
                                                                                            ...(l.callsigns200Discovered||[]).filter(c=>c),
                                                                                            ...(l.callsigns300||[]).filter(c=>c),
                                                                                            ...(l.callsignsPOW||[]).filter(c=>c),
                                                                                            ...(l.callsigns200POW||[]).filter(c=>c)
                                                                                        ].length > 0 ? (
                                                                                            [
                                                                                                ...(l.callsigns200||[]).filter(c=>c),
                                                                                                ...(l.callsigns200Unconfirmed||[]).filter(c=>c),
                                                                                                ...(l.callsigns200Discovered||[]).filter(c=>c),
                                                                                                ...(l.callsigns300||[]).filter(c=>c),
                                                                                                ...(l.callsignsPOW||[]).filter(c=>c),
                                                                                                ...(l.callsigns200POW||[]).filter(c=>c)
                                                                                            ].join(', ')
                                                                                        ) : <span className="text-slate-600">-</span>}
                                                                                    </td>
                                                                                    <td className="px-4 py-2 text-center font-mono">{l.count200 || '-'}</td>
                                                                                    <td className="px-4 py-2 text-center font-mono">{l.count200Unconfirmed || '-'}</td>
                                                                                    <td data-testid="detail-discovered" className="px-4 py-2 text-center font-mono text-purple-300">{l.count200Discovered || 0}</td>
                                                                                    <td className="px-4 py-2 text-center font-mono">{l.count300 || '-'}</td>
                                                                                    <td className="px-4 py-2 text-center font-mono text-rose-400">{l.count200POW || '-'}</td>
                                                                                    <td className="px-4 py-2 text-center font-mono">{l.countPOW || '-'}</td>
                                                                                </tr>
                                                                            ))}
                                                                        </tbody>
                                                                    </table>
                                                                </div>
                                                            ) : (
                                                                <div className="text-slate-500 text-sm italic">За цим фільтром немає деталізованих записів.</div>
                                                            )}
                                                        </div>
                                                    )}
                                                </div>
                                            );
                                        })
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                );
            };

        const SettingsView = () => {
                const { dailyFriendlyLosses, events, personnel, replaceDocumentData, requestPassword, saveSettings, setViewingEvent, settings, showToast } = React.useContext(EnemyAppContext);
                const [newWeapon, setNewWeapon] = useState('');
                const [newPosition, setNewPosition] = useState('');
                const fileRef = useRef(null);
                const backupTextEncoder = new TextEncoder();

                const bytesToBase64 = (bytes) => {
                    let binary = '';
                    bytes.forEach(byte => { binary += String.fromCharCode(byte); });
                    return btoa(binary);
                };

                const base64ToBytes = (value) => {
                    const binary = atob(value);
                    return Uint8Array.from(binary, character => character.charCodeAt(0));
                };

                const deriveBackupKey = async (password, salt, usages) => {
                    if (!window.crypto?.subtle) throw new Error('Web Crypto API недоступний у цьому браузері');
                    const passwordKey = await window.crypto.subtle.importKey(
                        'raw',
                        backupTextEncoder.encode(password),
                        'PBKDF2',
                        false,
                        ['deriveKey']
                    );
                    return window.crypto.subtle.deriveKey(
                        { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 600000 },
                        passwordKey,
                        { name: 'AES-GCM', length: 256 },
                        false,
                        usages
                    );
                };

                const addItem = (key, value, setter) => {
                    const v = value.trim();
                    if (!v) return;
                    if (settings[key].includes(v)) { showToast('Вже є в списку'); return; }
                    saveSettings({ ...settings, [key]: [...settings[key], v] });
                    setter('');
                };
                const removeItem = (key, value) => {
                    saveSettings({ ...settings, [key]: settings[key].filter(x => x !== value) });
                };

                const exportEncryptedBackup = async () => {
                    const password = await requestPassword('Введіть пароль для шифрування', 'Мінімум 4 символи', val => val.length < 4 ? 'Мінімум 4 символи' : null, 'Продовжити');
                    if (!password) return;
                    const confirmation = await requestPassword('Повторіть пароль', 'Мінімум 4 символи', val => val !== password ? 'Паролі не збігаються' : null, 'Зашифрувати та Завантажити');
                    if (!confirmation) return;

                    try {
                        const salt = window.crypto.getRandomValues(new Uint8Array(16));
                        const iv = window.crypto.getRandomValues(new Uint8Array(12));
                        const key = await deriveBackupKey(password, salt, ['encrypt']);
                        const backupData = {
                            format: 'oblik-vtrat-backup',
                            version: 2,
                            exportedAt: new Date().toISOString(),
                            events,
                            settings,
                            dailyFriendlyLosses,
                            personnel
                        };
                        const encrypted = await window.crypto.subtle.encrypt(
                            { name: 'AES-GCM', iv },
                            key,
                            backupTextEncoder.encode(JSON.stringify(backupData))
                        );
                        const envelope = {
                            format: 'oblik-vtrat-encrypted-backup',
                            version: 1,
                            encryption: {
                                algorithm: 'AES-256-GCM',
                                kdf: 'PBKDF2-SHA-256',
                                iterations: 600000,
                                salt: bytesToBase64(salt)
                            },
                            iv: bytesToBase64(iv),
                            ciphertext: bytesToBase64(new Uint8Array(encrypted))
                        };
                        const blob = new Blob([JSON.stringify(envelope)], { type: 'application/json' });
                        const a = document.createElement('a');
                        a.href = URL.createObjectURL(blob);
                        a.download = 'oblik-vtrat-backup-' + todayISO() + '.oblik';
                        a.click();
                        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
                        showToast('Зашифровану AES-256 копію збережено');
                    } catch (error) {
                        console.error('Помилка шифрування резервної копії', error);
                        showToast('Не вдалося зашифрувати резервну копію');
                    }
                };

                
                const importEncryptedBackup = async (file) => {
                    const password = await requestPassword('Введіть пароль від бекапу', 'Ваш пароль', null, 'Розшифрувати');
                    if (!password) return;
                    try {
                        const envelope = JSON.parse(await file.text());
                        if (envelope.format !== 'oblik-vtrat-encrypted-backup' || envelope.version !== 1) {
                            throw new Error('це не підтримувана зашифрована резервна копія');
                        }
                        const encryption = envelope.encryption || {};
                        if (encryption.algorithm !== 'AES-256-GCM' || encryption.kdf !== 'PBKDF2-SHA-256' || encryption.iterations !== 600000 || !encryption.salt || !envelope.iv || !envelope.ciphertext) {
                            throw new Error('у файлі немає потрібних параметрів шифрування');
                        }
                        const salt = base64ToBytes(encryption.salt);
                        const iv = base64ToBytes(envelope.iv);
                        const ciphertext = base64ToBytes(envelope.ciphertext);
                        if (salt.length !== 16 || iv.length !== 12 || ciphertext.length < 16) throw new Error('Некоректні параметри шифрування');
                        const key = await deriveBackupKey(password, salt, ['decrypt']);
                        const decrypted = await window.crypto.subtle.decrypt(
                            { name: 'AES-GCM', iv },
                            key,
                            ciphertext
                        );
                        const data = JSON.parse(new TextDecoder().decode(decrypted));
                        validateDocumentBackup(data);
                        if (!window.confirm('Копію розшифровано та перевірено. Записів: ' + data.events.length +
                            '. Замінити поточні дані й налаштування? Перед заміною буде збережено локальну копію для повернення.')) return;
                        await replaceDocumentData(data);
                    } catch (error) {
                        console.error('Помилка відновлення зашифрованої копії', error);
                        showToast('Не вдалося відновити копію: перевірте пароль і файл');
                    }
                };

                return (
                    <div className="flex-1 overflow-y-auto p-4 md:p-6 bg-[#020617]">
                        <div className="w-full max-w-5xl mx-auto space-y-6">
                            <h1 className="text-2xl font-bold text-slate-100 tracking-tight">Налаштування</h1>
                            <DocumentDesk records={events} onOpen={setViewingEvent} preferences={settings.documentView} onSavePreferences={documentView => saveSettings({...settings, documentView})} />
                            <p className="text-sm text-slate-400">Дані зберігаються локально в браузері. Робіть резервну копію перед зміною комп’ютера.</p>

                            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-3">
                                <h3 className="text-sm font-bold text-slate-300 uppercase">Резерв і обмін</h3>
                                <div className="flex flex-wrap gap-2">
                                    <button type="button" onClick={exportEncryptedBackup} className="px-3 py-2 rounded-xl text-sm font-semibold bg-slate-800 border border-slate-700 hover:border-amber-500/50 flex items-center gap-2"><Icon name="lock-keyhole" className="w-4 h-4"/> Зашифрована копія</button>
                                    
                                    <button type="button" onClick={()=>fileRef.current?.click()} className="px-3 py-2 rounded-xl text-sm font-semibold bg-slate-800 border border-slate-700 hover:border-amber-500/50 flex items-center gap-2"><Icon name="upload" className="w-4 h-4"/> Відновити копію</button>
                                    <input ref={fileRef} type="file" accept=".oblik" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) importEncryptedBackup(f); e.target.value=''; }} />
                                </div>
                                <p className="text-xs text-slate-500">Копія містить усі події, щоденні втрати й налаштування. Для відновлення потрібен пароль, заданий під час її створення.</p>
                                <p className="text-xs text-slate-400">Шифрується файл .oblik. Дані браузера, локальна копія для повернення та CSV не зашифровані. Без пароля відновити зашифрований файл неможливо.</p>
                                <button type="button" className="text-sm text-amber-300 underline underline-offset-4" onClick={async () => {
                                    try {
                                        const previous = await localforage.getItem('document_before_restore_v1');
                                        if (!previous) { showToast('Попередньої копії ще немає'); return; }
                                        validateDocumentBackup(previous);
                                        if (confirm('Повернути дані до попереднього відновлення бекапу?')) await replaceDocumentData(previous);
                                    } catch { showToast('Не вдалося повернути попередню копію'); }
                                }}>Повернути дані до попереднього відновлення</button>
                            </div>

                            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5">
                                <h3 className="text-sm font-bold text-slate-300 uppercase mb-4">Засоби ураження</h3>
                                <div className="flex gap-2 mb-3">
                                    <input value={newWeapon} onChange={e=>setNewWeapon(e.target.value)} onKeyDown={e=>e.key==='Enter' && addItem('weapons', newWeapon, setNewWeapon)} placeholder="Новий засіб..." className="flex-1 bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-sm" />
                                    <button type="button" onClick={()=>addItem('weapons', newWeapon, setNewWeapon)} className="px-3 py-1.5 bg-amber-600 hover:bg-amber-500 rounded-lg text-sm font-bold">Додати</button>
                                </div>
                                <div className="flex flex-wrap gap-2">
                                    {settings.weapons.map(w => (
                                        <span key={w} className="px-3 py-1 bg-slate-800 rounded-lg text-sm text-slate-300 border border-slate-700 flex items-center gap-2">
                                            {w}
                                            <button type="button" onClick={()=>removeItem('weapons', w)} className="text-slate-500 hover:text-red-400"><Icon name="x" className="w-3.5 h-3.5"/></button>
                                        </span>
                                    ))}
                                </div>
                            </div>
                            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5">
                                <h3 className="text-sm font-bold text-slate-300 uppercase mb-4">Позиції</h3>
                                <div className="flex gap-2 mb-3">
                                    <input value={newPosition} onChange={e=>setNewPosition(e.target.value)} onKeyDown={e=>e.key==='Enter' && addItem('positions', newPosition, setNewPosition)} placeholder="Нова позиція..." className="flex-1 bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-sm" />
                                    <button type="button" onClick={()=>addItem('positions', newPosition, setNewPosition)} className="px-3 py-1.5 bg-amber-600 hover:bg-amber-500 rounded-lg text-sm font-bold">Додати</button>
                                </div>
                                <div className="flex flex-wrap gap-2">
                                    {settings.positions.map(p => (
                                        <span key={p} className="px-3 py-1 bg-slate-800 rounded-lg text-sm text-slate-300 border border-slate-700 flex items-center gap-2">
                                            {p}
                                            <button type="button" onClick={()=>removeItem('positions', p)} className="text-slate-500 hover:text-red-400"><Icon name="x" className="w-3.5 h-3.5"/></button>
                                        </span>
                                    ))}
                                </div>
                            </div>
                            <div className="text-xs text-slate-500 leading-relaxed">
                                Клавіші: <span className="text-slate-300">N</span> нова подія · <span className="text-slate-300">1–4</span> вкладки · <span className="text-slate-300">Esc</span> закрити вікно.
                            </div>
                        </div>
                    </div>
                );
            };

        function App() {
            const [events, setEvents] = useState([]);
            const [personnel, setPersonnel] = useState([]);
            const [settings, setSettings] = useState({ weapons: DEFAULT_WEAPONS, positions: DEFAULT_POSITIONS });
            const [isLoading, setIsLoading] = useState(true);
            const [activeTab, setActiveTab] = useState('list'); // 'list', 'analytics', 'dashboard', 'settings'
            const [isFormOpen, setIsFormOpen] = useState(false);
            const [editingEvent, setEditingEvent] = useState(null);
            const [viewingEvent, setViewingEvent] = useState(null);
            const [assaultReportEvent, setAssaultReportEvent] = useState(null);
            const [medicalSync, setMedicalSync] = useState({ daily: {}, included: 0, excluded: 0, invalid: 0, duplicates: 0, loading: true, error: '' });
            const dailyFriendlyLosses = medicalSync.daily;
            const [deletedRecord, setDeletedRecord] = useState(null);
            const [passwordPrompt, setPasswordPrompt] = useState(null);
            const requestPassword = (title, placeholder = 'Пароль...', validate = null, confirmText = 'ОК') => {
                return new Promise((resolve) => {
                    setPasswordPrompt({ title, placeholder, validate, confirmText, resolve });
                });
            };
            const showToast = notifyDocument;

            useEffect(() => {
                let disposed = false, request = 0;
                const refreshMedicalTotals = async () => {
                    const current = ++request;
                    try {
                        const totals = await MedicalDailyTotals.read();
                        if (disposed || current !== request) return;
                        const next = { ...totals, loading: false, error: '' };
                        setMedicalSync(previous => JSON.stringify(previous) === JSON.stringify(next) ? previous : next);
                    } catch (error) {
                        if (!disposed && current === request) setMedicalSync(previous => ({ ...previous, loading: false, error: error.message || 'Не вдалося прочитати медичну базу.' }));
                    }
                };
                const onVisible = () => { if (document.visibilityState === 'visible') refreshMedicalTotals(); };
                refreshMedicalTotals();
                window.addEventListener('suite-medical-data-changed', refreshMedicalTotals);
                window.addEventListener('focus', refreshMedicalTotals);
                document.addEventListener('visibilitychange', onVisible);
                return () => {
                    disposed = true;
                    window.removeEventListener('suite-medical-data-changed', refreshMedicalTotals);
                    window.removeEventListener('focus', refreshMedicalTotals);
                    document.removeEventListener('visibilitychange', onVisible);
                };
            }, []);
            
            useEffect(() => {
                const loadData = async () => {
                    try {
                        const savedEvents = await localforage.getItem('enemy_events_v2') || await localforage.getItem('enemy_events_v1') || [];
                        const savedSettings = await localforage.getItem('enemy_settings_v1') || { weapons: DEFAULT_WEAPONS, positions: DEFAULT_POSITIONS };
                        let savedPersonnel = await localforage.getItem('enemy_personnel_v1') || [];
                        
                        // Migration v1 -> v2 (if needed)
                        const migratedEvents = savedEvents.map(e => {
                            if (e.assaultDetails) {
                                e.actionDetails = e.assaultDetails;
                                e.actionDetails.conductedBy = e.actionDetails.conductedBy || '';
                                e.actionDetails.docLoc = e.actionDetails.docLoc || '';
                                e.actionDetails.factLoc = e.actionDetails.factLoc || '';
                                delete e.assaultDetails;
                            }
                            if (!e.actionDetails) {
                                e.actionDetails = {
                                    startDate: getEventDateStr(e), startTime: '', endDate: '', endTime: '',
                                    direction: '', position: '', friendlyCount: 0, enemySize: 0, hasVehicles: false, vehicleDetails: '',
                                    conductedBy: '', docLoc: '', factLoc: ''
                                };
                            }
                            if (e.enemyLosses) {
                                e.enemyLosses = e.enemyLosses.map(l => ({
                                    ...l,
                                    time: l.time || '',
                                    count200Unconfirmed: l.count200Unconfirmed || 0,
                                    count200Discovered: l.count200Discovered || 0,
                                    countPOW: l.countPOW || 0,
                                    callsign: l.callsign || '',
                                    inflicter: l.inflicter || ''
                                }));
                            }
                            
                            // NEW MIGRATION FIELDS
                            if (e.isFireContact === undefined) e.isFireContact = false;
                            if (e.isRealEvent === undefined) e.isRealEvent = true;
                            if (!e.friendlyLosses) e.friendlyLosses = { count200: 0, count300: 0, countZBV: 0, details: '' };
                            if (e.friendlyLosses.countZBV === undefined) e.friendlyLosses.countZBV = 0;
                            
                            return e;
                        });

                        // Legacy callsign migration to personnel DB and Event format migration
                        let updatedPersonnel = [...savedPersonnel];
                        let personnelChanged = false;
                        let eventsChanged = false;
                        
                        migratedEvents.forEach(e => {
                            if (!e.enemyLosses) return;
                            const eventDate = getEventDateStr(e) || window.SuiteDates.localISO();
                            
                            e.enemyLosses.forEach(loss => {
                                    if (loss.callsign && loss.callsign.trim()) {
                                        const trimmedCs = loss.callsign.trim();
                                        const cleanCs = trimmedCs.toLowerCase();
                                        
                                        let assignedStatus = '200';
                                        if (loss.count200 > 0) { assignedStatus = '200'; loss.callsigns200 = loss.callsigns200 || []; if(!loss.callsigns200.includes(trimmedCs)) loss.callsigns200.push(trimmedCs); }
                                        else if (loss.count200Unconfirmed > 0) { assignedStatus = '200_unc'; loss.callsigns200Unconfirmed = loss.callsigns200Unconfirmed || []; if(!loss.callsigns200Unconfirmed.includes(trimmedCs)) loss.callsigns200Unconfirmed.push(trimmedCs); }
                                        else if (loss.count200Discovered > 0) { assignedStatus = '200_disc'; loss.callsigns200Discovered = loss.callsigns200Discovered || []; if(!loss.callsigns200Discovered.includes(trimmedCs)) loss.callsigns200Discovered.push(trimmedCs); }
                                        else if (loss.count200POW > 0) { assignedStatus = '200_pow'; loss.callsigns200POW = loss.callsigns200POW || []; if(!loss.callsigns200POW.includes(trimmedCs)) loss.callsigns200POW.push(trimmedCs); }
                                        else if (loss.countPOW > 0) { assignedStatus = 'pow'; loss.callsignsPOW = loss.callsignsPOW || []; if(!loss.callsignsPOW.includes(trimmedCs)) loss.callsignsPOW.push(trimmedCs); }
                                        else if (loss.count300 > 0) { assignedStatus = '300'; loss.callsigns300 = loss.callsigns300 || []; if(!loss.callsigns300.includes(trimmedCs)) loss.callsigns300.push(trimmedCs); }
                                        
                                        eventsChanged = true;
                                        delete loss.callsign;
                                        
                                        const pIndex = updatedPersonnel.findIndex(p => p.callsign.toLowerCase().trim() === cleanCs);
                                        const isDeadStatus = ['200', '200_unc', '200_disc', '200_pow'].includes(assignedStatus);
                                        
                                        if (pIndex !== -1) {
                                            const currentStatus = updatedPersonnel[pIndex].status;
                                            const currentIsDead = ['200', '200_unc', '200_disc', '200_pow'].includes(currentStatus);
                                            let newStatus = currentStatus;
                                            
                                            if (isDeadStatus) newStatus = assignedStatus;
                                            else if (assignedStatus === 'pow' && !currentIsDead) newStatus = 'pow';
                                            else if (assignedStatus === '300' && !currentIsDead && currentStatus !== 'pow') newStatus = '300';
                                            
                                            if (newStatus !== currentStatus) {
                                                updatedPersonnel[pIndex] = { ...updatedPersonnel[pIndex], status: newStatus, lastUpdated: new Date().toISOString() };
                                                personnelChanged = true;
                                            }
                                        } else {
                                            updatedPersonnel.push({
                                                id: 'evt_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
                                                callsign: trimmedCs,
                                                status: assignedStatus,
                                                notes: `Імпортовано зі старого запису (подія від ${eventDate})`,
                                                createdAt: new Date().toISOString(),
                                                lastUpdated: new Date().toISOString()
                                            });
                                            personnelChanged = true;
                                        }
                                    }
                                });
                            });
                            
                            if (personnelChanged) {
                                await localforage.setItem('enemy_personnel_v1', updatedPersonnel);
                                savedPersonnel = updatedPersonnel;
                            }
                            if (eventsChanged) {
                                await localforage.setItem('enemy_events_v2', migratedEvents);
                            }
                            
                            savedSettings.hasMigratedLegacyCallsigns = true;
                            await localforage.setItem('enemy_settings_v1', savedSettings);

                        setEvents(migratedEvents);
                        setSettings(savedSettings);
                        setPersonnel(savedPersonnel);
                        setIsLoading(false);
                    } catch (e) {
                        console.error("Помилка завантаження", e);
                        setIsLoading(false);
                    }
                };
                loadData();
            }, []);

            const saveEvents = async (newEvents) => {
                await window.SuiteRuntime.setItem('enemy_events_v2', newEvents);
                setEvents(newEvents);
            };

            const savePersonnel = async (newPersonnel) => {
                await window.SuiteRuntime.setItem('enemy_personnel_v1', newPersonnel);
                setPersonnel(newPersonnel);
            };

            const saveSettings = async (newSettings) => {
                await window.SuiteRuntime.setItem('enemy_settings_v1', newSettings);
                setSettings(newSettings);
            };

            const replaceDocumentData = async (data) => {
                validateDocumentBackup(data);
                const previous = { events, settings, dailyFriendlyLosses, personnel };
                await window.SuiteRuntime.setItem('document_before_restore_v1', previous);
                try {
                    await window.SuiteRuntime.setItem('enemy_events_v2', data.events);
                    await window.SuiteRuntime.setItem('enemy_settings_v1', data.settings);
                    if (data.personnel) await window.SuiteRuntime.setItem('enemy_personnel_v1', data.personnel);
                } catch (error) {
                    try {
                        await window.SuiteRuntime.setItem('enemy_events_v2', previous.events);
                        await window.SuiteRuntime.setItem('enemy_settings_v1', previous.settings);
                        await window.SuiteRuntime.setItem('enemy_personnel_v1', previous.personnel);
                    } catch {
                        showToast('Помилка сховища. Копія попередніх даних збережена для відновлення.');
                    }
                    throw error;
                }
                window.location.reload();
            };

            const deleteEvent = async (id) => {
                if(confirm("Ви впевнені, що хочете видалити цей запис?")) {
                    try {
                        const removed = events.find(e => e.id === id);
                        await saveEvents(events.filter(e => e.id !== id));
                        setDeletedRecord(removed);
                        showToast('Запис видалено. Його можна повернути кнопкою «Скасувати видалення».');
                    } catch {
                        showToast('Не вдалося зберегти зміни. Запис не видалено.');
                    }
                }
            };

            const allPOWs = useMemo(() => {
                const captured = {};
                const killed = new Set();
                
                events.forEach(ev => {
                    const dateStr = getEventDateStr(ev);
                    (ev.enemyLosses || []).forEach(l => {
                        if (l.countPOW > 0) {
                            captured[`${ev.id}_${l.id}`] = {
                                id: `${ev.id}_${l.id}`,
                                callsign: l.callsign || 'Без позивного',
                                date: dateStr,
                                eventId: ev.id,
                                weapon: l.weapon
                            };
                        }
                        if (l.killedPowId && l.killedPowId !== 'legacy') {
                            killed.add(l.killedPowId);
                        }
                    });
                });
                
                return Object.values(captured).map(p => ({ ...p, isAlive: !killed.has(p.id) })).sort((a, b) => b.date.localeCompare(a.date));
            }, [events]);

            

            // --- ФОРМА ПОДІЇ ---
            

            // --- ПЕРЕГЛЯД ПОДІЇ (MODAL) ---
            

            // --- СПИСОК ПОДІЙ (У ВИГЛЯДІ РЯДКІВ) ---
            // --- СПИСОК ПОДІЙ (У ВИГЛЯДІ РЯДКІВ / КАРТОК) ---
            

            

            

            

            

            

            



            useEffect(() => {
                const onKey = (e) => {
                    if (document.querySelector('[data-suite-module="enemy"]')?.dataset.suiteActive !== 'true') return;
                    const tag = (e.target.tagName || '').toLowerCase();
                    if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
                    if (e.key === 'Escape') {
                        setIsFormOpen(false); setEditingEvent(null); setViewingEvent(null);
                    }
                    if (e.key === 'n' || e.key === 'N') { e.preventDefault(); setIsFormOpen(true); }
                    if (e.key === '1') setActiveTab('list');
                    if (e.key === '2') setActiveTab('dashboard');
                    if (e.key === '3') setActiveTab('analytics');
                    if (e.key === '4') setActiveTab('personnel');
                    if (e.key === '5') setActiveTab('settings');
                };
                window.addEventListener('keydown', onKey);
                return () => window.removeEventListener('keydown', onKey);
            }, []);

            useEffect(() => {
                const openReviewed = ({ detail }) => {
                    if (detail?.module !== 'enemy') return;
                    if (detail.kind === 'personnel') { setActiveTab('personnel'); return; }
                    if (!detail.recordId) return;
                    const matches = events.filter(row => String(row.id) === detail.recordId);
                    setActiveTab('list');
                    if (matches.length === 1) { setEditingEvent(matches[0]); setIsFormOpen(true); }
                    else showToast('Неможливо однозначно відкрити запис за ID. Перевірте список.');
                };
                window.addEventListener('suite-review-record', openReviewed);
                return () => window.removeEventListener('suite-review-record', openReviewed);
            }, [events]);
            if (isLoading) return <div className="flex-1 flex items-center justify-center"><div className="animate-spin w-8 h-8 border-4 border-amber-500 border-t-transparent rounded-full"></div></div>;

            return (
                <EnemyAppContext.Provider value={{ allPOWs, dailyFriendlyLosses, deleteEvent, events, medicalSync, replaceDocumentData, requestPassword, saveSettings, setEditingEvent, setIsFormOpen, setViewingEvent, setAssaultReportEvent, settings, showToast, personnel, savePersonnel }}>
                <div className="flex flex-col h-full">
                    {/* Header Nav */}
                    <header className="bg-slate-900/80 backdrop-blur-md border-b border-slate-800 sticky top-0 z-40 shrink-0 print:hidden">
                        <div className="w-full max-w-[2400px] px-2 lg:px-4 mx-auto px-4 h-16 flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-amber-500 to-red-600 flex items-center justify-center shadow-lg">
                                    <Icon name="crosshair" className="w-5 h-5 text-white" />
                                </div>
                                <span className="font-bold text-lg tracking-tight text-white hidden sm:block">Втрати Противника</span>
                                <span className="hidden md:inline text-[10px] font-mono text-slate-500 border border-slate-800 rounded-md px-1.5 py-0.5">{events.filter(e=>e.isRealEvent!==false).length} подій</span>
                            </div>
                            
                            <div className="flex bg-slate-950 p-1 rounded-xl border border-slate-800 overflow-x-auto snap-x hide-scrollbar">
                                <button onClick={() => setActiveTab('list')} className={`shrink-0 px-4 py-1.5 rounded-lg text-sm font-semibold transition flex items-center gap-2 snap-start ${activeTab === 'list' ? 'bg-slate-800 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'}`}>
                                    <Icon name="list" className="w-4 h-4" /> Стрічка
                                </button>
                                <button onClick={() => setActiveTab('dashboard')} className={`shrink-0 px-4 py-1.5 rounded-lg text-sm font-semibold transition flex items-center gap-2 snap-start ${activeTab === 'dashboard' ? 'bg-slate-800 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'}`}>
                                    <Icon name="pie-chart" className="w-4 h-4" /> Дашборд
                                </button>
                                <button onClick={() => setActiveTab('analytics')} className={`shrink-0 px-4 py-1.5 rounded-lg text-sm font-semibold transition flex items-center gap-2 snap-start ${activeTab === 'analytics' ? 'bg-slate-800 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'}`}>
                                    <Icon name="bar-chart-2" className="w-4 h-4" /> Таблиця
                                </button>
                                <button onClick={() => setActiveTab('personnel')} className={`shrink-0 px-4 py-1.5 rounded-lg text-sm font-semibold transition flex items-center gap-2 snap-start ${activeTab === 'personnel' ? 'bg-slate-800 text-amber-400 shadow-sm' : 'text-slate-400 hover:text-amber-400/70'}`}>
                                    <Icon name="users" className="w-5 h-5" /> База в/сл противника
                                </button>
                                <button onClick={() => setActiveTab('settings')} className={`shrink-0 px-4 py-1.5 rounded-lg text-sm font-semibold transition flex items-center gap-2 snap-start ${activeTab === 'settings' ? 'bg-slate-800 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'}`}>
                                    <Icon name="settings" className="w-5 h-5" /> Налаштування
                                </button>
                            </div>
                        </div>
                    </header>

                    {/* Main Content */}
                    {deletedRecord && <div className="px-4 py-2 bg-amber-950/30 border-b border-amber-800/40 text-sm flex justify-between items-center gap-3">
                        <span>Останній видалений запис можна повернути до закриття сторінки.</span>
                        <button type="button" className="rounded-lg px-3 py-2 border border-amber-700 text-amber-200" onClick={async () => {
                            try {
                                if (!events.some(e => e.id === deletedRecord.id)) await saveEvents([deletedRecord, ...events]);
                                setDeletedRecord(null);
                                showToast('Запис відновлено');
                            } catch { showToast('Не вдалося відновити запис'); }
                        }}>Скасувати видалення</button>
                    </div>}
                    <div className="flex-1 overflow-hidden relative print:hidden">
                        <div className={`absolute inset-0 flex flex-col ${activeTab === 'list' ? 'z-10' : 'z-0 invisible pointer-events-none'}`}><ListView /></div>
                        <div className={`absolute inset-0 flex flex-col ${activeTab === 'dashboard' ? 'z-10' : 'z-0 invisible pointer-events-none'}`}><DashboardView /></div>
                        <div className={`absolute inset-0 flex flex-col ${activeTab === 'analytics' ? 'z-10' : 'z-0 invisible pointer-events-none'}`}><AnalyticsView onGenerateReport={handleOpenPrintableReport} /></div>
                        <div className={`absolute inset-0 flex flex-col ${activeTab === 'settings' ? 'z-10' : 'z-0 invisible pointer-events-none'}`}><SettingsView /></div>
                        <div className={`absolute inset-0 flex flex-col ${activeTab === 'personnel' ? 'z-10' : 'z-0 invisible pointer-events-none'}`}><PersonnelView personnel={personnel} savePersonnel={savePersonnel} showToast={showToast} Icon={Icon} generateId={generateId} /></div>
                    </div>

                    {/* Modals */}
                    {assaultReportEvent && <AssaultReportModal key={assaultReportEvent.id} event={assaultReportEvent} onClose={() => setAssaultReportEvent(null)} />}
                    {viewingEvent && (
                        <EventViewModal event={viewingEvent} onClose={() => setViewingEvent(null)} />
                    )}
                    {isFormOpen && (
                        <EventForm 
                            eventToEdit={editingEvent} 
                            onClose={() => { setIsFormOpen(false); setEditingEvent(null); }} 
                            onSave={async (eventData) => {
                                const previous = events.find(e => e.id === eventData.id);
                                const timestamp = new Date().toISOString();
                                eventData = {
                                    ...eventData,
                                    updatedAt: timestamp,
                                    documentHistory: [
                                        ...(previous?.documentHistory || []),
                                        { at: timestamp, action: previous ? 'Редагування' : 'Створення' }
                                    ].slice(-50)
                                };
                                let newEvents = [...events];
                                if (editingEvent) {
                                    newEvents = newEvents.map(e => e.id === eventData.id ? eventData : e);
                                } else {
                                    newEvents = [eventData, ...newEvents];
                                }
                                try { 
                                    await saveEvents(newEvents); 
                                    
                                    if (eventData.enemyLosses && eventData.enemyLosses.length > 0) {
                                        let updatedPersonnel = [...personnel];
                                        let personnelChanged = false;
                                        
                                        eventData.enemyLosses.forEach(loss => {
                                            const checkAndSync = (csArray, assignedStatus) => {
                                                if (!Array.isArray(csArray)) return;
                                                csArray.forEach(cs => {
                                                    if (!cs || !cs.trim()) return;
                                                    const cleanCs = cs.toLowerCase().trim();
                                                    const pIndex = updatedPersonnel.findIndex(p => p.callsign.toLowerCase().trim() === cleanCs);
                                                    
                                                    const isDeadStatus = ['200', '200_unc', '200_disc', '200_pow'].includes(assignedStatus);
                                                    
                                                    if (pIndex !== -1) {
                                                        const currentStatus = updatedPersonnel[pIndex].status;
                                                        const currentIsDead = ['200', '200_unc', '200_disc', '200_pow'].includes(currentStatus);
                                                        let newStatus = currentStatus;
                                                        
                                                        // Dead overrides everything. POW overrides 300.
                                                        if (isDeadStatus) newStatus = assignedStatus;
                                                        else if (assignedStatus === 'pow' && !currentIsDead) newStatus = 'pow';
                                                        else if (assignedStatus === '300' && !currentIsDead && currentStatus !== 'pow') newStatus = '300';
                                                        
                                                        if (newStatus !== currentStatus) {
                                                            updatedPersonnel[pIndex] = { ...updatedPersonnel[pIndex], status: newStatus, lastUpdated: new Date().toISOString() };
                                                            personnelChanged = true;
                                                        }
                                                    } else {
                                                        // Create new personnel
                                                        updatedPersonnel.push({
                                                            id: generateId(),
                                                            callsign: cs.trim(),
                                                            status: assignedStatus,
                                                            notes: 'Імпортовано автоматично з форми втрат',
                                                            createdAt: new Date().toISOString(),
                                                            lastUpdated: new Date().toISOString()
                                                        });
                                                        personnelChanged = true;
                                                    }
                                                });
                                            };
                                            
                                            checkAndSync(loss.callsigns200, '200');
                                            checkAndSync(loss.callsigns200Unconfirmed, '200_unc');
                                            checkAndSync(loss.callsigns200Discovered, '200_disc');
                                            checkAndSync(loss.callsigns200POW, '200_pow');
                                            checkAndSync(loss.callsignsPOW, 'pow');
                                            checkAndSync(loss.callsigns300, '300');
                                            
                                            if (loss.callsign && loss.callsign.trim()) {
                                                let inferredStatus = null;
                                                if (loss.count200 > 0) inferredStatus = '200';
                                                else if (loss.count200Unconfirmed > 0) inferredStatus = '200_unc';
                                                else if (loss.count200Discovered > 0) inferredStatus = '200_disc';
                                                else if (loss.count200POW > 0) inferredStatus = '200_pow';
                                                else if (loss.countPOW > 0) inferredStatus = 'pow';
                                                else if (loss.count300 > 0) inferredStatus = '300';
                                                if (inferredStatus) checkAndSync([loss.callsign], inferredStatus);
                                            }
                                        });
                                        
                                        if (personnelChanged) {
                                            await savePersonnel(updatedPersonnel);
                                        }
                                    }
                                }
                                catch { showToast('Не вдалося зберегти запис. Форма залишається відкритою.'); return; }
                                setIsFormOpen(false);
                                setEditingEvent(null);
                            }}
                        />
                    )}
                    {passwordPrompt && (
                        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
                            <form onSubmit={(e) => {
                                e.preventDefault();
                                const val = e.target.password.value;
                                if (passwordPrompt.validate) {
                                    const err = passwordPrompt.validate(val);
                                    if (err) { showToast(err); return; }
                                }
                                const resolve = passwordPrompt.resolve;
                                setPasswordPrompt(null);
                                resolve(val);
                            }} className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-sm p-6 shadow-2xl space-y-4">
                                <h3 className="text-lg font-bold text-white">{passwordPrompt.title}</h3>
                                <input name="password" type="password" autoFocus placeholder={passwordPrompt.placeholder} className="w-full bg-slate-950 border border-slate-700 rounded-xl px-4 py-2 text-white focus:border-amber-500 outline-none" />
                                <div className="flex justify-end gap-3 pt-2">
                                    <button type="button" onClick={() => { passwordPrompt.resolve(null); setPasswordPrompt(null); }} className="px-4 py-2 rounded-xl text-sm font-semibold text-slate-400 hover:text-white hover:bg-slate-800 transition">Скасувати</button>
                                    <button type="submit" className="px-4 py-2 rounded-xl text-sm font-semibold bg-amber-600 hover:bg-amber-500 text-white shadow-lg shadow-amber-900/20 transition">{passwordPrompt.confirmText}</button>
                                </div>
                            </form>
                        </div>
                    )}
                    <DocumentNotice />
                </div>
                </EnemyAppContext.Provider>
            );
        }
            return React.memo(App);
        })();

export { EventsApp };
