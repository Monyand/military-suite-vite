import { useState, useEffect, useRef, useMemo } from 'react';
import { SuiteBackup } from '../core/backup.js';

const MODULE_META = {
    tactical:  { label: 'Журнал О/С',         badgeColor: 'bg-indigo-500/20 text-indigo-300 border-indigo-500/40', icon: 'users' },
    med:       { label: 'Наші втрати о/с',     badgeColor: 'bg-rose-500/20 text-rose-300 border-rose-500/40',     icon: 'heart-pulse' },
    tasks:     { label: 'Завдання',            badgeColor: 'bg-teal-500/20 text-teal-300 border-teal-500/40',     icon: 'clipboard' },
    ovt:       { label: 'Втрати ОВТ',          badgeColor: 'bg-amber-600/20 text-amber-300 border-amber-500/40',   icon: 'truck' },
    positions: { label: 'Статус позицій',      badgeColor: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40', icon: 'map-pin' },
    enemy:     { label: 'Втрати Противника',   badgeColor: 'bg-red-500/20 text-red-300 border-red-500/40',         icon: 'crosshair' },
};

export function GlobalSearchModal({ onClose, onNavigate }) {
    const [query, setQuery] = useState('');
    const [activeCategory, setActiveCategory] = useState('all');
    const [loading, setLoading] = useState(true);
    const [selectedIndex, setSelectedIndex] = useState(0);
    const [dataSnapshot, setDataSnapshot] = useState(null);
    const inputRef = useRef(null);
    const listRef = useRef(null);

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

    // Фокус на полі вводу
    useEffect(() => {
        const timer = setTimeout(() => {
            if (inputRef.current) inputRef.current.focus();
        }, 50);
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
                    searchStr: `${p.fullName || ''} ${p.callsign || ''} ${p.rank || ''} ${p.unit || ''} ${p.currentTask || ''} ${p.note || ''} ${p.id || ''}`.toLowerCase(),
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
                const name = ep.name || soldier.name || ep.fullName || 'Без імені';
                const callsign = ep.callsign || soldier.callsign || '';
                const rank = ep.rank || soldier.rank || '';
                const unit = ep.unit || soldier.unit || '';
                const dateStr = ep.date ? ep.date.replace('T', ' ') : '';
                records.push({
                    id: String(ep.id),
                    module: 'med',
                    title: `${rank ? rank + ' ' : ''}${name}${callsign ? ` («${callsign}»)` : ''} — ${ep.lossType || 'Втрата'}`,
                    meta: `${dateStr ? dateStr + ' · ' : ''}${ep.severity ? 'Важкість: ' + ep.severity + ' · ' : ''}${ep.evacStatus ? 'Статус: ' + ep.evacStatus + ' · ' : ''}Підрозділ: ${unit || '—'}${ep.cause ? ' · Причина: ' + ep.cause : ''}${ep.notes ? ' · ' + ep.notes : ''}`,
                    searchStr: `${name} ${callsign} ${rank} ${unit} ${ep.lossType || ''} ${ep.severity || ''} ${ep.cause || ''} ${ep.evacStatus || ''} ${ep.actualLoc || ''} ${ep.docLoc || ''} ${ep.notes || ''} ${dateStr} ${ep.id || ''}`.toLowerCase(),
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
                    const num = t.number || t.id || '';
                    records.push({
                        id: String(t.id),
                        module: 'tasks',
                        title: `БР / Завдання №${num}${t.date ? ' від ' + t.date : ''}`,
                        meta: `Підрозділ: ${t.unit || '—'} · Виконавець: ${t.executor || '—'}${t.text ? ' · ' + (t.text.length > 90 ? t.text.slice(0, 90) + '…' : t.text) : ''}`,
                        searchStr: `${num} ${t.date || ''} ${t.unit || ''} ${t.executor || ''} ${t.text || ''} ${t.status || ''} ${t.notes || ''} ${t.id || ''}`.toLowerCase(),
                        raw: t,
                    });
                }
            }

            // Втрати ОВТ
            if (Array.isArray(docJournal.ovt)) {
                for (const o of docJournal.ovt) {
                    if (!o || typeof o !== 'object') continue;
                    records.push({
                        id: String(o.id),
                        module: 'ovt',
                        title: `${o.name || o.nomenclature || 'ОВТ'}${o.status ? ' [' + o.status + ']' : ''}`,
                        meta: `Категорія: ${o.category || '—'} · Дата: ${o.date || '—'} · Підрозділ: ${o.unit || '—'}${o.notes ? ' · ' + o.notes : ''}`,
                        searchStr: `${o.name || ''} ${o.nomenclature || ''} ${o.category || ''} ${o.status || ''} ${o.unit || ''} ${o.date || ''} ${o.notes || ''} ${o.id || ''}`.toLowerCase(),
                        raw: o,
                    });
                }
            }

            // Позиції
            if (Array.isArray(docJournal.positions)) {
                for (const pos of docJournal.positions) {
                    if (!pos || typeof pos !== 'object') continue;
                    records.push({
                        id: String(pos.id),
                        module: 'positions',
                        title: `Позиція «${pos.name || pos.callsign || pos.id}»`,
                        meta: `Рубіж: ${pos.rubizh || '—'} · Підрозділ: ${pos.unit || '—'} · Статус: ${pos.status || '—'}${pos.coordinates ? ' · Координати: ' + pos.coordinates : ''}`,
                        searchStr: `${pos.name || ''} ${pos.callsign || ''} ${pos.rubizh || ''} ${pos.unit || ''} ${pos.status || ''} ${pos.coordinates || ''} ${pos.id || ''}`.toLowerCase(),
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
                const dateStr = ev.createdAt ? ev.createdAt.replace('T', ' ').slice(0, 16) : '';
                records.push({
                    id: String(ev.id),
                    module: 'enemy',
                    title: `${ev.title || typesStr || 'Подія противника'}${dateStr ? ' (' + dateStr + ')' : ''}`,
                    meta: `Напрямок: ${ev.direction || '—'} · Підрозділ: ${ev.unit || '—'}${ev.description ? ' · ' + (ev.description.length > 90 ? ev.description.slice(0, 90) + '…' : ev.description) : ''}`,
                    searchStr: `${ev.title || ''} ${typesStr} ${ev.direction || ''} ${ev.unit || ''} ${ev.description || ''} ${dateStr} ${ev.id || ''}`.toLowerCase(),
                    raw: ev,
                });
            }
        }

        return records;
    }, [dataSnapshot]);

    // Фільтрація за пошуковим рядком і категорією
    const filteredResults = useMemo(() => {
        const q = query.trim().toLowerCase();
        if (!q) return [];
        
        // Розбиваємо запит на слова (щоб "сокіл 300" шукало записи, де є і те, і інше)
        const terms = q.split(/\s+/).filter(Boolean);

        return allRecords.filter(rec => {
            if (activeCategory !== 'all' && rec.module !== activeCategory) return false;
            return terms.every(term => rec.searchStr.includes(term));
        });
    }, [allRecords, query, activeCategory]);

    // Підрахунок за категоріями для поточного запиту
    const categoryCounts = useMemo(() => {
        const q = query.trim().toLowerCase();
        const counts = { all: 0, tactical: 0, med: 0, tasks: 0, ovt: 0, positions: 0, enemy: 0 };
        if (!q) return counts;

        const terms = q.split(/\s+/).filter(Boolean);
        for (const rec of allRecords) {
            if (terms.every(term => rec.searchStr.includes(term))) {
                counts.all++;
                if (counts[rec.module] !== undefined) counts[rec.module]++;
            }
        }
        return counts;
    }, [allRecords, query]);

    // Керування вибором з клавіатури
    useEffect(() => {
        setSelectedIndex(0);
    }, [filteredResults.length, activeCategory]);

    const handleKeyDown = (e) => {
        if (e.key === 'Escape') {
            e.preventDefault();
            onClose();
        } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            setSelectedIndex(prev => (prev < filteredResults.length - 1 ? prev + 1 : prev));
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setSelectedIndex(prev => (prev > 0 ? prev - 1 : 0));
        } else if (e.key === 'Enter') {
            e.preventDefault();
            if (filteredResults[selectedIndex]) {
                handleSelect(filteredResults[selectedIndex]);
            }
        }
    };

    const handleSelect = (record) => {
        onNavigate(record);
        onClose();
    };

    return (
        <div 
            className="fixed inset-0 z-[22000] bg-black/80 backdrop-blur-sm flex items-start justify-center p-3 sm:p-6 overflow-y-auto"
            onClick={e => { if (e.target === e.currentTarget) onClose(); }}
        >
            <section 
                role="dialog" 
                aria-modal="true" 
                aria-label="Наскрізний пошук по всіх базах"
                className="bg-slate-900 border border-slate-700/80 rounded-2xl w-full max-w-3xl overflow-hidden shadow-2xl flex flex-col text-slate-200 mt-4 sm:mt-10 animate-fade-in"
                onKeyDown={handleKeyDown}
            >
                {/* 1. Пошуковий ввід */}
                <div className="p-4 border-b border-slate-800 bg-slate-950/70 flex items-center gap-3">
                    <svg className="w-5 h-5 text-amber-400 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
                    </svg>
                    <input
                        ref={inputRef}
                        type="text"
                        value={query}
                        onChange={e => setQuery(e.target.value)}
                        placeholder="Пошук позивного, ПІБ, номеру наказу, дати, позиції, типу втрат..."
                        className="bg-transparent text-slate-100 placeholder-slate-500 text-sm sm:text-base w-full focus:outline-none font-medium"
                    />
                    {query && (
                        <button 
                            type="button"
                            onClick={() => { setQuery(''); inputRef.current?.focus(); }}
                            className="p-1 rounded-md text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors text-xs"
                            title="Очистити"
                        >
                            ✕
                        </button>
                    )}
                    <kbd className="hidden sm:inline-block text-[10px] font-mono bg-slate-800 text-slate-400 px-2 py-0.5 rounded border border-slate-700">
                        ESC
                    </kbd>
                </div>

                {/* 2. Категорії-фільтри (таби) */}
                {query.trim() && (
                    <div className="flex items-center gap-1.5 px-4 py-2 border-b border-slate-800/80 bg-slate-900/50 overflow-x-auto text-xs no-scrollbar">
                        <button
                            type="button"
                            onClick={() => setActiveCategory('all')}
                            className={`px-2.5 py-1 rounded-lg font-semibold transition-all shrink-0 ${
                                activeCategory === 'all'
                                    ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 shadow-sm'
                                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800 border border-transparent'
                            }`}
                        >
                            Усі ({categoryCounts.all})
                        </button>
                        {Object.entries(MODULE_META).map(([key, meta]) => (
                            <button
                                key={key}
                                type="button"
                                onClick={() => setActiveCategory(key)}
                                className={`px-2.5 py-1 rounded-lg font-semibold transition-all shrink-0 flex items-center gap-1.5 ${
                                    activeCategory === key
                                        ? 'bg-slate-800 text-white border border-slate-600 shadow-sm'
                                        : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60 border border-transparent'
                                }`}
                            >
                                <span>{meta.label}</span>
                                <span className="text-[10px] opacity-75 font-mono">({categoryCounts[key] || 0})</span>
                            </button>
                        ))}
                    </div>
                )}

                {/* 3. Список знайдених результатів */}
                <div ref={listRef} className="max-h-[60vh] min-h-[160px] overflow-y-auto divide-y divide-slate-800/50 p-2">
                    {loading && (
                        <div className="flex items-center justify-center p-12 text-slate-400 gap-2">
                            <div className="w-5 h-5 border-2 border-amber-400 border-t-transparent rounded-full animate-spin" />
                            <span>Індексація баз даних...</span>
                        </div>
                    )}

                    {!loading && !query.trim() && (
                        <div className="p-8 text-center text-slate-400 space-y-2">
                            <p className="text-sm font-medium">Введіть пошуковий запит для наскрізного пошуку по системі.</p>
                            <p className="text-xs text-slate-500">
                                Шукає за позивним, прізвищем, номером бойового розпорядження (БР), технікою, позицією або типом втрати (наприклад: <code className="text-amber-400">Сокіл</code>, <code className="text-amber-400">300 важкий</code>, <code className="text-amber-400">БР 45</code>, <code className="text-amber-400">БТР</code>).
                            </p>
                        </div>
                    )}

                    {!loading && query.trim() && filteredResults.length === 0 && (
                        <div className="p-10 text-center text-slate-400">
                            <p className="text-sm">За запитом <span className="text-amber-300 font-semibold">«{query}»</span> нічого не знайдено.</p>
                            <p className="text-xs text-slate-500 mt-1">Спробуйте змінити слово або вибрати вкладку «Усі».</p>
                        </div>
                    )}

                    {!loading && query.trim() && filteredResults.map((item, idx) => {
                        const meta = MODULE_META[item.module] || { label: item.module, badgeColor: 'bg-slate-800 text-slate-300 border-slate-700' };
                        const isSelected = idx === selectedIndex;
                        return (
                            <div
                                key={`${item.module}_${item.id}_${idx}`}
                                onClick={() => handleSelect(item)}
                                onMouseEnter={() => setSelectedIndex(idx)}
                                className={`p-3 rounded-xl cursor-pointer transition-all flex items-start gap-3 select-none ${
                                    isSelected 
                                        ? 'bg-slate-800/90 border border-slate-700 shadow-md translate-x-1' 
                                        : 'hover:bg-slate-800/40 border border-transparent'
                                }`}
                            >
                                <span className={`shrink-0 text-[10px] font-bold px-2 py-0.5 rounded border ${meta.badgeColor}`}>
                                    {meta.label}
                                </span>
                                <div className="flex-1 min-w-0">
                                    <div className="font-bold text-sm text-slate-100 truncate flex items-center justify-between gap-2">
                                        <span>{item.title}</span>
                                        {isSelected && (
                                            <span className="text-[11px] text-amber-400 font-normal shrink-0 hidden sm:inline">
                                                Перейти ↵
                                            </span>
                                        )}
                                    </div>
                                    <div className="text-xs text-slate-400 truncate mt-0.5">
                                        {item.meta}
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>

                {/* 4. Підвал із підказками */}
                <div className="p-3 border-t border-slate-800 bg-slate-950/80 flex items-center justify-between text-[11px] text-slate-400 px-4">
                    <div className="flex items-center gap-3">
                        <span>Навігація: <kbd className="font-mono bg-slate-800 px-1 py-0.5 rounded border border-slate-700 text-slate-300">↑</kbd> <kbd className="font-mono bg-slate-800 px-1 py-0.5 rounded border border-slate-700 text-slate-300">↓</kbd></span>
                        <span>Відкрити: <kbd className="font-mono bg-slate-800 px-1 py-0.5 rounded border border-slate-700 text-slate-300">Enter</kbd></span>
                        <span>Закрити: <kbd className="font-mono bg-slate-800 px-1 py-0.5 rounded border border-slate-700 text-slate-300">Esc</kbd></span>
                    </div>
                    {filteredResults.length > 0 && (
                        <div className="font-mono text-slate-500">
                            Знайдено: {filteredResults.length}
                        </div>
                    )}
                </div>
            </section>
        </div>
    );
}
