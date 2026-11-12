import { useState, useEffect, useRef, useMemo } from 'react';
import { SuiteBackup } from '../core/backup.js';
import { bindDialogFocusTrap } from './dialog-focus.js';

const SEARCH_HOMOGLYPHS = { a: 'а', c: 'с', e: 'е', i: 'і', o: 'о', p: 'р', x: 'х', y: 'у' };
const MAX_VISIBLE_RESULTS = 150;

const normSearchText = (value) => String(value ?? '')
    .normalize('NFKC')
    .trim()
    .toLocaleLowerCase('uk-UA')
    .replace(/[’ʼ`′]/g, "'")
    .replace(/[aceiopxy]/g, ch => SEARCH_HOMOGLYPHS[ch] || ch)
    .replace(/\s+/g, ' ');

const MODULE_META = {
    tactical:  { label: 'Журнал О/С',         badgeColor: 'bg-[#4c8ed9]/12 text-[#93c5fd] border-[#4c8ed9]/45', icon: 'users' },
    med:       { label: 'Наші втрати о/с',     badgeColor: 'bg-[#e05252]/12 text-[#fca5a5] border-[#e05252]/45', icon: 'heart-pulse' },
    tasks:     { label: 'Завдання',            badgeColor: 'bg-[#34a873]/12 text-[#6ee7b7] border-[#34a873]/45', icon: 'clipboard' },
    ovt:       { label: 'Втрати ОВТ',          badgeColor: 'bg-[#d99b26]/12 text-[#fcd34d] border-[#d99b26]/45', icon: 'truck' },
    positions: { label: 'Статус позицій',      badgeColor: 'bg-[#34a873]/12 text-[#6ee7b7] border-[#34a873]/45', icon: 'map-pin' },
    enemy:     { label: 'Втрати Противника',   badgeColor: 'bg-[#e05252]/12 text-[#fca5a5] border-[#e05252]/45', icon: 'crosshair' },
};

export function GlobalSearchModal({ onClose, onNavigate }) {
    const [query, setQuery] = useState('');
    const [activeCategory, setActiveCategory] = useState('all');
    const [loading, setLoading] = useState(true);
    const [selectedIndex, setSelectedIndex] = useState(0);
    const [dataSnapshot, setDataSnapshot] = useState(null);
    const inputRef = useRef(null);
    const listRef = useRef(null);
    const dialogRef = useRef(null);

    // Завантаження актуальних даних при відкритті
    useEffect(() => {
        let isMounted = true;
        const loadSnapshot = async () => {
            try {
                if (window.SuiteRuntime?.drain) {
                    await window.SuiteRuntime.drain();
                }
                const snap = await SuiteBackup.collect({ localState: true, unchecked: true });
                if (isMounted) {
                    setDataSnapshot(snap);
                    setLoading(false);
                }
            } catch (err) {
                console.warn('Помилка збору даних для пошуку:', err);
                if (isMounted) setLoading(false);
            }
        };
        loadSnapshot();
        return () => { isMounted = false; };
    }, []);

    // Focus trap, Escape та відновлення фокусу при закритті
    useEffect(() => {
        return bindDialogFocusTrap(dialogRef, onClose);
    }, [onClose]);

    // Фокус на полі вводу
    useEffect(() => {
        const timer = setTimeout(() => {
            if (inputRef.current) inputRef.current.focus();
        }, 20);
        return () => clearTimeout(timer);
    }, []);

    // Індексація та пошук по всіх базах
    const allRecords = useMemo(() => {
        if (!dataSnapshot) return [];
        const records = [];
        const lf = dataSnapshot.localforage || {};
        const ls = dataSnapshot.localstorage || {};

        // 1. Журнал О/С (tactical_personnel)
        let personnel = [];
        try {
            if (ls.tactical_personnel) personnel = JSON.parse(ls.tactical_personnel);
        } catch {}
        if (Array.isArray(personnel)) {
            for (const p of personnel) {
                if (!p || typeof p !== 'object') continue;
                records.push({
                    id: String(p.id),
                    module: 'tactical',
                    title: `${p.rank ? p.rank + ' ' : ''}${p.fullName || 'Без імені'}${p.callsign ? ` («${p.callsign}»)` : ''}`,
                    meta: `Підрозділ: ${p.unit || '—'} · Стан: ${p.status || 'ok'} · Завдання: ${p.currentTask || '—'}${p.note ? ` · Примітка: ${p.note}` : ''}`,
                    searchStr: normSearchText(`${p.fullName || ''} ${p.callsign || ''} ${p.rank || ''} ${p.unit || ''} ${p.status || ''} ${p.currentTask || ''} ${p.note || ''} ${p.id || ''}`),
                    raw: p,
                });
            }
        }

        // 2. Наші втрати о/с (med_episodes_v3 / med_soldiers_v3)
        const episodes = lf.med_episodes_v3 || lf.med_episodes_v2 || [];
        const soldiers = lf.med_soldiers_v3 || lf.med_soldiers_v2 || [];
        const soldierMap = new Map();
        if (Array.isArray(soldiers)) {
            for (const s of soldiers) {
                if (s && s.id != null) soldierMap.set(String(s.id), s);
            }
        }
        if (Array.isArray(episodes)) {
            for (const ep of episodes) {
                if (!ep || typeof ep !== 'object') continue;
                const soldier = soldierMap.get(String(ep.soldierId)) || {};
                const snap = ep.personnelSnapshot || {};
                const name = ep.soldierName || ep.name || snap.name || soldier.name || ep.fullName || 'Без імені';
                const callsign = ep.callsign || snap.callsign || soldier.callsign || '';
                const rank = ep.rank || snap.rank || soldier.rank || '';
                const unit = ep.unit || snap.unit || soldier.unit || '';
                const rawDate = ep.lossDate || ep.date || '';
                const dateStr = rawDate ? String(rawDate).replace('T', ' ') : '';
                records.push({
                    id: String(ep.id),
                    module: 'med',
                    title: `${rank ? rank + ' ' : ''}${name}${callsign ? ` («${callsign}»)` : ''} — ${ep.lossType || 'Втрата'}`,
                    meta: `${dateStr ? dateStr + ' · ' : ''}${ep.severity ? 'Важкість: ' + ep.severity + ' · ' : ''}${ep.evacStatus ? 'Статус: ' + ep.evacStatus + ' · ' : ''}Підрозділ: ${unit || '—'}${ep.cause ? ' · Причина: ' + ep.cause : ''}${ep.notes ? ' · ' + ep.notes : ''}`,
                    searchStr: normSearchText(`${name} ${callsign} ${rank} ${unit} ${ep.lossType || ''} ${ep.severity || ''} ${ep.cause || ''} ${ep.evacStatus || ''} ${ep.actualLoc || ''} ${ep.docLoc || ''} ${ep.notes || ''} ${dateStr} ${ep.id || ''}`),
                    raw: ep,
                });
            }
        }

        // 3. Документальний журнал: Завдання, Втрати ОВТ, Позиції
        const docJournal = lf.document_journal_v1;
        if (docJournal && typeof docJournal === 'object') {
            // Завдання
            if (Array.isArray(docJournal.tasks)) {
                for (const t of docJournal.tasks) {
                    if (!t || typeof t !== 'object') continue;
                    const taskText = t.task || t.text || '';
                    const comment = t.comment || t.notes || '';
                    const headline = taskText ? (taskText.length > 72 ? taskText.slice(0, 72) + '…' : taskText) : `№${t.number || t.id || '—'}`;
                    records.push({
                        id: String(t.id),
                        module: 'tasks',
                        title: `Завдання${t.date ? ' від ' + t.date : ''}: ${headline}`,
                        meta: `Статус: ${t.status || '—'}${t.reportedInPbd ? ' · Подано в ПБД' : ''}${t.unit ? ' · Підрозділ: ' + t.unit : ''}${t.executor ? ' · Виконавець: ' + t.executor : ''}${comment ? ' · ' + (comment.length > 90 ? comment.slice(0, 90) + '…' : comment) : ''}`,
                        searchStr: normSearchText(`${taskText} ${t.date || ''} ${t.status || ''} ${comment} ${t.reportedInPbd ? 'пбд' : ''} ${t.number || ''} ${t.unit || ''} ${t.executor || ''} ${t.id || ''}`),
                        raw: t,
                    });
                }
            }

            // Втрати ОВТ
            if (Array.isArray(docJournal.ovt)) {
                for (const o of docJournal.ovt) {
                    if (!o || typeof o !== 'object') continue;
                    const titleName = o.nomenclature || o.equipmentType || o.name || 'ОВТ';
                    const loc = o.position || o.unit || '—';
                    const noteText = o.comment || o.eventDescription || o.consequence || o.notes || '';
                    records.push({
                        id: String(o.id),
                        module: 'ovt',
                        title: `${titleName}${o.status ? ' [' + o.status + ']' : ''}`,
                        meta: `Категорія: ${o.category || '—'} · Дата: ${o.date || '—'}${o.time ? ' ' + o.time : ''} · Позиція: ${loc}${o.serialNumber ? ' · Сер. № ' + o.serialNumber : ''}${o.plateNumber ? ' · НЗ ' + o.plateNumber : ''}${noteText ? ' · ' + (noteText.length > 80 ? noteText.slice(0, 80) + '…' : noteText) : ''}`,
                        searchStr: normSearchText(`${titleName} ${o.name || ''} ${o.equipmentType || ''} ${o.category || ''} ${o.status || ''} ${o.position || ''} ${o.unit || ''} ${o.date || ''} ${o.time || ''} ${o.serialNumber || ''} ${o.plateNumber || ''} ${o.factoryNumber || ''} ${o.boardNumber || ''} ${o.urgentDocNo || ''} ${o.crewName || ''} ${o.taskText || ''} ${o.routeText || ''} ${o.coordinates || ''} ${o.eventDescription || ''} ${o.consequence || ''} ${o.reportSubject || ''} ${o.comment || ''} ${o.notes || ''} ${o.id || ''}`),
                        raw: o,
                    });
                }
            }

            // Позиції
            if (Array.isArray(docJournal.positions)) {
                for (const pos of docJournal.positions) {
                    if (!pos || typeof pos !== 'object') continue;
                    const baseName = pos.name || pos.newName || pos.callsign || pos.id;
                    const renamePart = pos.newName && pos.name && pos.newName !== pos.name ? ` → «${pos.newName}»` : '';
                    records.push({
                        id: String(pos.id),
                        module: 'positions',
                        title: `Позиція «${baseName}»${renamePart}`,
                        meta: `Категорія: ${pos.category || '—'} · Дата: ${pos.date || '—'} · Статус: ${pos.status || '—'}${pos.docNumber ? ' · Док. № ' + pos.docNumber : ''}${pos.details ? ' · ' + (pos.details.length > 80 ? pos.details.slice(0, 80) + '…' : pos.details) : ''}`,
                        searchStr: normSearchText(`${pos.name || ''} ${pos.newName || ''} ${pos.destinationName || ''} ${pos.category || ''} ${pos.status || ''} ${pos.date || ''} ${pos.docNumber || ''} ${pos.details || ''} ${pos.reportedInPbd ? 'пбд' : ''} ${pos.callsign || ''} ${pos.rubizh || ''} ${pos.unit || ''} ${pos.coordinates || ''} ${pos.id || ''}`),
                        raw: pos,
                    });
                }
            }
        }

        // 4. Втрати противника (enemy_events_v2 / v1)
        const enemyEvents = lf.enemy_events_v2 || lf.enemy_events_v1 || [];
        if (Array.isArray(enemyEvents)) {
            for (const ev of enemyEvents) {
                if (!ev || typeof ev !== 'object') continue;
                const typesStr = Array.isArray(ev.types) ? ev.types.join(', ') : '';
                const ad = ev.actionDetails || {};
                const dateStr = ad.startDate
                    ? `${ad.startDate}${ad.startTime ? ' ' + ad.startTime : ''}`
                    : (ev.createdAt ? ev.createdAt.replace('T', ' ').slice(0, 16) : '');
                const dirStr = ad.direction || ev.direction || '—';
                const locStr = ad.factLoc || ad.docLoc || ad.position || ev.unit || '—';
                const enemyLosses = Array.isArray(ev.enemyLosses) ? ev.enemyLosses : [];
                const callsigns = enemyLosses.flatMap(l => [
                    l?.callsign || '',
                    ...(Array.isArray(l?.callsigns200) ? l.callsigns200 : []),
                    ...(Array.isArray(l?.callsigns200Unconfirmed) ? l.callsigns200Unconfirmed : []),
                    ...(Array.isArray(l?.callsigns200Discovered) ? l.callsigns200Discovered : []),
                    ...(Array.isArray(l?.callsigns300) ? l.callsigns300 : []),
                    ...(Array.isArray(l?.callsignsPOW) ? l.callsignsPOW : []),
                    ...(Array.isArray(l?.callsigns200POW) ? l.callsigns200POW : []),
                ]).filter(Boolean);
                const weapons = enemyLosses.flatMap(l => [l?.weapon || '', l?.inflicter || '']).filter(Boolean);
                records.push({
                    id: String(ev.id),
                    module: 'enemy',
                    title: `${ev.title || typesStr || 'Подія противника'}${dateStr ? ' (' + dateStr + ')' : ''}`,
                    meta: `Напрямок: ${dirStr} · Місце: ${locStr}${ad.conductedBy ? ' · ' + ad.conductedBy : ''}${ev.description ? ' · ' + (ev.description.length > 90 ? ev.description.slice(0, 90) + '…' : ev.description) : ''}`,
                    searchStr: normSearchText(`${ev.title || ''} ${typesStr} ${ad.startDate || ''} ${ad.startTime || ''} ${ad.endTime || ''} ${ad.conductedBy || ''} ${ad.docLoc || ''} ${ad.factLoc || ''} ${ad.direction || ''} ${ad.position || ''} ${ad.vehicleDetails || ''} ${callsigns.join(' ')} ${weapons.join(' ')} ${ev.friendlyLosses?.details || ''} ${ev.direction || ''} ${ev.unit || ''} ${ev.description || ''} ${dateStr} ${ev.id || ''}`),
                    raw: ev,
                });
            }
        }

        return records;
    }, [dataSnapshot]);

    // Однопрохідна фільтрація та підрахунок категорій для поточного запиту
    const { matchingAll, categoryCounts } = useMemo(() => {
        const counts = { all: 0, tactical: 0, med: 0, tasks: 0, ovt: 0, positions: 0, enemy: 0 };
        const q = normSearchText(query);
        if (!q) return { matchingAll: [], categoryCounts: counts };

        const terms = q.split(/\s+/).filter(Boolean);
        const matched = [];
        for (const rec of allRecords) {
            if (terms.every(term => rec.searchStr.includes(term))) {
                matched.push(rec);
                counts.all++;
                if (counts[rec.module] !== undefined) counts[rec.module]++;
            }
        }
        return { matchingAll: matched, categoryCounts: counts };
    }, [allRecords, query]);

    const filteredResults = useMemo(() => {
        if (activeCategory === 'all') return matchingAll;
        return matchingAll.filter(rec => rec.module === activeCategory);
    }, [matchingAll, activeCategory]);

    const visibleResults = useMemo(
        () => filteredResults.slice(0, MAX_VISIBLE_RESULTS),
        [filteredResults]
    );

    // Керування вибором з клавіатури та прокрутка активного рядка
    useEffect(() => {
        setSelectedIndex(0);
    }, [filteredResults.length, activeCategory, query]);

    useEffect(() => {
        const el = listRef.current?.querySelector(`[data-search-index="${selectedIndex}"]`);
        el?.scrollIntoView({ block: 'nearest' });
    }, [selectedIndex, visibleResults.length]);

    const handleKeyDown = (e) => {
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            setSelectedIndex(prev => (prev < visibleResults.length - 1 ? prev + 1 : prev));
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setSelectedIndex(prev => (prev > 0 ? prev - 1 : 0));
        } else if (e.key === 'Enter') {
            e.preventDefault();
            if (visibleResults[selectedIndex]) {
                handleSelect(visibleResults[selectedIndex]);
            }
        }
    };

    const handleSelect = (record) => {
        onNavigate(record);
        onClose();
    };

    return (
        <div
            className="fixed inset-0 z-[22000] bg-black/80 flex items-start justify-center p-3 sm:p-6 overflow-y-auto overscroll-contain"
            onClick={e => { if (e.target === e.currentTarget) onClose(); }}
        >
            <section
                ref={dialogRef}
                role="dialog"
                aria-modal="true"
                aria-label="Наскрізний пошук по всіх базах"
                className="bg-[#17181b] border border-[#2e3138] rounded-sm w-full max-w-3xl overflow-hidden flex flex-col text-[#f3f4f6] mt-4 sm:mt-10 animate-fade-in overscroll-contain"
                onKeyDown={handleKeyDown}
            >
                {/* 1. Пошуковий ввід */}
                <div className="px-4 py-3 border-b border-[#2e3138] bg-[#101113] flex items-center gap-3">
                    <svg className="w-4 h-4 text-[#4c8ed9] shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
                    </svg>
                    <input
                        ref={inputRef}
                        type="text"
                        value={query}
                        onChange={e => setQuery(e.target.value)}
                        placeholder="Пошук позивного, ПІБ, номера розпорядження, дати, позиції, типу втрат..."
                        className="bg-transparent text-[#f1f5f9] placeholder-[#989fa9] text-sm sm:text-[15px] w-full focus:outline-none font-medium"
                    />
                    {query && (
                        <button
                            type="button"
                            aria-label="Очистити пошук"
                            onClick={() => { setQuery(''); inputRef.current?.focus(); }}
                            className="p-1 rounded-sm text-[#b8bec8] hover:text-[#f3f4f6] hover:bg-[#222429] border border-transparent hover:border-[#2e3138] transition-colors inline-flex items-center justify-center"
                            title="Очистити"
                        >
                            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                            </svg>
                        </button>
                    )}
                    <kbd className="hidden sm:inline-block text-[10px] font-mono bg-[#222429] text-[#b8bec8] px-1.5 py-0.5 rounded-sm border border-[#2e3138]">
                        ESC
                    </kbd>
                </div>

                {/* 2. Категорії-фільтри (таби) */}
                {query.trim() && (
                    <div className="flex items-center flex-wrap gap-1.5 px-4 py-2 border-b border-[#2e3138] bg-[#17181b] text-xs">
                        <button
                            type="button"
                            onClick={() => setActiveCategory('all')}
                            className={`px-2.5 py-1 rounded-sm font-medium transition-colors shrink-0 border tabular-nums ${
                                activeCategory === 'all'
                                    ? 'bg-[#2b67ab]/25 text-[#f3f4f6] border-[#4c8ed9]'
                                    : 'text-[#b8bec8] hover:text-[#f3f4f6] hover:bg-[#222429] border-transparent'
                            }`}
                        >
                            Усі ({categoryCounts.all})
                        </button>
                        {Object.entries(MODULE_META).map(([key, meta]) => (
                            <button
                                key={key}
                                type="button"
                                onClick={() => setActiveCategory(key)}
                                className={`px-2.5 py-1 rounded-sm font-medium transition-colors shrink-0 flex items-center gap-1.5 border tabular-nums ${
                                    activeCategory === key
                                        ? 'bg-[#222429] text-[#f3f4f6] border-[#4c8ed9]'
                                        : 'text-[#b8bec8] hover:text-[#f3f4f6] hover:bg-[#222429] border-transparent'
                                }`}
                            >
                                <span>{meta.label}</span>
                                <span className="text-[11px] text-[#b8bec8] font-mono">({categoryCounts[key] || 0})</span>
                            </button>
                        ))}
                    </div>
                )}

                {/* 3. Список знайдених результатів */}
                <div ref={listRef} className="max-h-[60vh] min-h-[160px] overflow-y-auto divide-y divide-[#2e3138] bg-[#101113]">
                    {loading && (
                        <div className="flex items-center justify-center p-12 text-[#b8bec8] gap-2.5 text-sm">
                            <span className="w-4 h-4 border-2 border-[#4c8ed9] border-t-transparent rounded-full animate-spin" aria-hidden="true" />
                            <span>Індексація баз даних...</span>
                        </div>
                    )}

                    {!loading && !query.trim() && (
                        <div className="p-8 text-center text-[#b8bec8] space-y-2">
                            <p className="text-sm font-medium text-[#f1f5f9]">Введіть пошуковий запит для наскрізного пошуку по системі.</p>
                            <p className="text-xs text-[#989fa9]">
                                Шукає за позивним, прізвищем, номером бойового розпорядження (БР), технікою, позицією або типом запису (наприклад: <code className="text-[#93c5fd] font-mono">Сокіл</code>, <code className="text-[#93c5fd] font-mono">300</code>, <code className="text-[#93c5fd] font-mono">БР 45</code>, <code className="text-[#93c5fd] font-mono">БТР</code>).
                            </p>
                        </div>
                    )}

                    {!loading && query.trim() && filteredResults.length === 0 && (
                        <div className="p-10 text-center text-[#b8bec8]">
                            <p className="text-sm">За запитом <span className="text-[#f1f5f9] font-semibold">«{query}»</span> нічого не знайдено.</p>
                            <p className="text-xs text-[#989fa9] mt-1">Спробуйте змінити слово або вибрати вкладку «Усі».</p>
                        </div>
                    )}

                    {!loading && query.trim() && visibleResults.map((item, idx) => {
                        const meta = MODULE_META[item.module] || { label: item.module, badgeColor: 'bg-[#222429] text-[#b8bec8] border-[#2e3138]' };
                        const isSelected = idx === selectedIndex;
                        return (
                            <div
                                key={`${item.module}_${item.id}_${idx}`}
                                data-search-index={idx}
                                onClick={() => handleSelect(item)}
                                onMouseEnter={() => setSelectedIndex(idx)}
                                className={`px-4 py-2.5 cursor-pointer transition-colors flex items-start gap-3 select-none border-l-2 ${
                                    isSelected
                                        ? 'bg-[#222429] border-l-[#4c8ed9]'
                                        : 'bg-transparent hover:bg-[#17181b] border-l-transparent'
                                }`}
                            >
                                <span className={`shrink-0 text-[10px] font-semibold px-2 py-0.5 rounded-sm border mt-0.5 ${meta.badgeColor}`}>
                                    {meta.label}
                                </span>
                                <div className="flex-1 min-w-0">
                                    <div className="font-semibold text-[13px] text-[#f1f5f9] truncate flex items-center justify-between gap-2">
                                        <span className="truncate">{item.title}</span>
                                        {isSelected && (
                                            <span className="text-[11px] text-[#93c5fd] font-medium shrink-0 hidden sm:inline font-mono">
                                                Перейти [Enter]
                                            </span>
                                        )}
                                    </div>
                                    <div className="text-xs text-[#b4c0d0] truncate mt-0.5 tabular-nums">
                                        {item.meta}
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>

                {/* 4. Підвал із підказками */}
                <div className="px-4 py-2.5 border-t border-[#2e3138] bg-[#17181b] flex flex-wrap items-center justify-between gap-2 text-[11px] text-[#b8bec8]">
                    <div className="flex items-center gap-3 flex-wrap">
                        <span>Навігація: <kbd className="font-mono bg-[#222429] px-1.5 py-0.5 rounded-sm border border-[#2e3138] text-[#f3f4f6]">↑</kbd> <kbd className="font-mono bg-[#222429] px-1.5 py-0.5 rounded-sm border border-[#2e3138] text-[#f3f4f6]">↓</kbd></span>
                        <span>Відкрити: <kbd className="font-mono bg-[#222429] px-1.5 py-0.5 rounded-sm border border-[#2e3138] text-[#f3f4f6]">Enter</kbd></span>
                        <span>Закрити: <kbd className="font-mono bg-[#222429] px-1.5 py-0.5 rounded-sm border border-[#2e3138] text-[#f3f4f6]">Esc</kbd></span>
                    </div>
                    {filteredResults.length > 0 && (
                        <div className="font-mono text-[#b8bec8] tabular-nums">
                            {filteredResults.length > MAX_VISIBLE_RESULTS
                                ? `Показано ${MAX_VISIBLE_RESULTS} з ${filteredResults.length}`
                                : `Знайдено: ${filteredResults.length}`}
                        </div>
                    )}
                </div>
            </section>
        </div>
    );
}
