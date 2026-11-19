import { useEffect, useMemo, useRef, useState } from 'react';
import { SuiteTrash, TRASH_MODULES } from '../core/trash.js';
import { bindDialogFocusTrap } from './dialog-focus.js';

const formatDeletedAt = (iso) => {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '—';
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yyyy = d.getFullYear();
    const hh = String(d.getHours()).padStart(2, '0');
    const mi = String(d.getMinutes()).padStart(2, '0');
    return `${dd}.${mm}.${yyyy} ${hh}:${mi}`;
};

export const TrashModal = ({ onClose }) => {
    const dialogRef = useRef(null);
    const [items, setItems] = useState([]);
    const [loading, setLoading] = useState(true);
    const [moduleFilter, setModuleFilter] = useState('all');
    const [search, setSearch] = useState('');
    const [busyId, setBusyId] = useState('');
    const [statusMsg, setStatusMsg] = useState('');
    const [confirmClear, setConfirmClear] = useState(false);

    useEffect(() => bindDialogFocusTrap(dialogRef, onClose), [onClose]);

    const reload = async () => {
        setLoading(true);
        const list = await SuiteTrash.list();
        setItems(list);
        setLoading(false);
    };

    useEffect(() => {
        reload();
        const onChanged = () => { reload(); };
        window.addEventListener('suite-trash-changed', onChanged);
        return () => window.removeEventListener('suite-trash-changed', onChanged);
    }, []);

    const countsByModule = useMemo(() => {
        const map = {};
        for (const item of items) map[item.module] = (map[item.module] || 0) + 1;
        return map;
    }, [items]);

    const filtered = useMemo(() => {
        const q = search.trim().toLowerCase();
        return items.filter(item => {
            if (moduleFilter !== 'all' && item.module !== moduleFilter) return false;
            if (!q) return true;
            return (
                String(item.summary || '').toLowerCase().includes(q) ||
                String(item.moduleLabel || '').toLowerCase().includes(q) ||
                formatDeletedAt(item.deletedAt).includes(q)
            );
        });
    }, [items, moduleFilter, search]);

    const handleRestore = async (entry) => {
        if (busyId) return;
        setBusyId(entry.trashId);
        setStatusMsg('');
        try {
            let handled = false;
            const detail = {
                entry,
                ack: () => { handled = true; },
            };
            window.dispatchEvent(new CustomEvent('suite-trash-restore', { detail }));
            if (!handled) {
                throw new Error('Модуль не зміг прийняти запис. Перезавантажте програму та спробуйте ще раз.');
            }
            const next = await SuiteTrash.remove(entry.trashId);
            setItems(next);
            setStatusMsg(`Відновлено в «${entry.moduleLabel}»: ${entry.summary}`);
        } catch (err) {
            setStatusMsg(err?.message || 'Не вдалося відновити запис.');
        } finally {
            setBusyId('');
        }
    };

    const handleDeleteForever = async (entry) => {
        if (busyId) return;
        setBusyId(entry.trashId);
        setStatusMsg('');
        try {
            const next = await SuiteTrash.remove(entry.trashId);
            setItems(next);
            setStatusMsg('Запис видалено з кошика назавжди.');
        } catch (err) {
            setStatusMsg(err?.message || 'Не вдалося видалити запис.');
        } finally {
            setBusyId('');
        }
    };

    const handleClearAll = async () => {
        if (busyId) return;
        setBusyId('__clear__');
        setStatusMsg('');
        try {
            await SuiteTrash.clear();
            setItems([]);
            setConfirmClear(false);
            setStatusMsg('Кошик очищено.');
        } catch (err) {
            setStatusMsg(err?.message || 'Не вдалося очистити кошик.');
        } finally {
            setBusyId('');
        }
    };

    return (
        <div className="fixed inset-0 z-[20000] bg-black/80 flex items-center justify-center p-3 sm:p-4 overscroll-contain">
            <section
                ref={dialogRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby="suite-trash-title"
                className="bg-[#17181b] text-[#f3f4f6] border border-[#2e3138] rounded-sm w-full max-w-4xl max-h-[88vh] flex flex-col overflow-hidden"
            >
                <div className="px-5 py-3.5 bg-[#101113] border-b border-[#2e3138] flex items-center justify-between gap-3 shrink-0">
                    <div className="flex items-center gap-3 min-w-0">
                        <div className="w-8 h-8 rounded-sm border border-[#d9534f]/45 bg-[#d9534f]/15 text-[#f87171] flex items-center justify-center shrink-0">
                            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6" /><path d="M14 11v6" /><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                            </svg>
                        </div>
                        <div className="min-w-0">
                            <h2 id="suite-trash-title" className="text-sm font-bold text-[#f3f4f6] truncate">
                                Кошик та журнал видалень
                            </h2>
                            <p className="text-[11px] text-[#989fa9] font-mono tabular-nums">
                                Локальний архів видалених записів (до 500 останніх) · записів: {items.length}
                            </p>
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        aria-label="Закрити кошик"
                        className="w-8 h-8 rounded-sm bg-[#17181b] hover:bg-[#222429] border border-[#2e3138] text-[#b8bec8] hover:text-white flex items-center justify-center transition-colors cursor-pointer shrink-0"
                    >
                        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                        </svg>
                    </button>
                </div>

                <div className="px-5 py-2.5 bg-[#131417] border-b border-[#2e3138] flex flex-wrap items-center justify-between gap-2 shrink-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                        <button
                            type="button"
                            onClick={() => setModuleFilter('all')}
                            className={`h-7 px-2.5 rounded-sm border text-[11px] font-semibold tabular-nums cursor-pointer transition-colors ${moduleFilter === 'all' ? 'border-[#4c8ed9] bg-[#222429] text-[#f3f4f6]' : 'border-[#2e3138] bg-[#1a1c20] text-[#b8bec8] hover:border-[#3c404a]'}`}
                        >
                            Усі ({items.length})
                        </button>
                        {Object.entries(TRASH_MODULES).map(([key, meta]) => (
                            <button
                                key={key}
                                type="button"
                                onClick={() => setModuleFilter(key)}
                                className={`h-7 px-2.5 rounded-sm border text-[11px] font-semibold tabular-nums cursor-pointer transition-colors ${moduleFilter === key ? 'border-[#4c8ed9] bg-[#222429] text-[#f3f4f6]' : 'border-[#2e3138] bg-[#1a1c20] text-[#b8bec8] hover:border-[#3c404a]'}`}
                            >
                                {meta.label} ({countsByModule[key] || 0})
                            </button>
                        ))}
                    </div>
                    <input
                        type="text"
                        aria-label="Пошук у кошику"
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        placeholder="Пошук за описом або датою…"
                        className="h-7 px-2.5 rounded-sm border border-[#2e3138] bg-[#101113] text-xs text-[#f3f4f6] focus:border-[#4c8ed9] outline-none w-52"
                    />
                </div>

                <div className="flex-1 overflow-y-auto p-4 space-y-2">
                    {statusMsg && (
                        <div role="status" className="px-3 py-2 rounded-sm border border-[#4c8ed9]/40 bg-[#4c8ed9]/10 text-xs text-[#e6edf3]">
                            {statusMsg}
                        </div>
                    )}
                    {loading ? (
                        <p className="text-center text-xs text-[#989fa9] py-10">Завантаження журналу видалень…</p>
                    ) : !filtered.length ? (
                        <div className="text-center py-12 text-xs text-[#989fa9] border border-dashed border-[#2e3138] rounded-sm bg-[#131417]">
                            {items.length ? 'За обраним фільтром записів у кошику немає.' : 'Кошик порожній. Видалені записи автоматично потраплятимуть сюди.'}
                        </div>
                    ) : (
                        <div className="border border-[#2e3138] rounded-sm overflow-hidden">
                            <table className="w-full text-left text-xs border-collapse tabular-nums">
                                <thead className="bg-[#222429] text-[11px] uppercase text-[#cbd5e1]">
                                    <tr>
                                        <th className="px-3 py-2 border-b border-[#2e3138] w-36">Видалено</th>
                                        <th className="px-3 py-2 border-b border-[#2e3138] w-40">Модуль</th>
                                        <th className="px-3 py-2 border-b border-[#2e3138]">Запис</th>
                                        <th className="px-3 py-2 border-b border-[#2e3138] text-right w-40">Дії</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-[#262930]">
                                    {filtered.map(entry => {
                                        const meta = TRASH_MODULES[entry.module] || { label: entry.moduleLabel, color: '#cbd5e1', border: '#3c404a', bg: '#222429' };
                                        const isBusy = busyId === entry.trashId;
                                        return (
                                            <tr key={entry.trashId} className="bg-[#131417] hover:bg-[#1e2026]">
                                                <td className="px-3 py-2 font-mono text-[11px] text-[#b8bec8] whitespace-nowrap">
                                                    {formatDeletedAt(entry.deletedAt)}
                                                </td>
                                                <td className="px-3 py-2 whitespace-nowrap">
                                                    <span
                                                        className="inline-flex items-center px-2 py-0.5 rounded-sm border text-[11px] font-semibold"
                                                        style={{ color: meta.color, borderColor: meta.border, backgroundColor: meta.bg }}
                                                    >
                                                        {meta.label}
                                                    </span>
                                                </td>
                                                <td className="px-3 py-2 text-[#e6edf3] break-words">
                                                    {entry.summary}
                                                </td>
                                                <td className="px-3 py-2 text-right whitespace-nowrap">
                                                    <div className="inline-flex items-center gap-1.5">
                                                        <button
                                                            type="button"
                                                            disabled={Boolean(busyId)}
                                                            onClick={() => handleRestore(entry)}
                                                            className="h-7 px-2.5 rounded-sm bg-[#2b67ab] hover:bg-[#3577c2] border border-[#4c8ed9] text-white text-[11px] font-semibold cursor-pointer disabled:opacity-50"
                                                        >
                                                            {isBusy ? '…' : 'Відновити'}
                                                        </button>
                                                        <button
                                                            type="button"
                                                            disabled={Boolean(busyId)}
                                                            title="Видалити з кошика назавжди"
                                                            aria-label="Видалити з кошика назавжди"
                                                            onClick={() => handleDeleteForever(entry)}
                                                            className="h-7 px-2 rounded-sm bg-[#222429] hover:bg-[#3a1f22] border border-[#2e3138] hover:border-[#d9534f]/60 text-[#b8bec8] hover:text-[#f87171] text-[11px] cursor-pointer disabled:opacity-50"
                                                        >
                                                            ×
                                                        </button>
                                                    </div>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>

                <div className="px-5 py-3 bg-[#101113] border-t border-[#2e3138] flex items-center justify-between gap-2 flex-wrap shrink-0">
                    <div>
                        {items.length > 0 && !confirmClear && (
                            <button
                                type="button"
                                disabled={Boolean(busyId)}
                                onClick={() => setConfirmClear(true)}
                                className="h-8 px-3 rounded-sm bg-[#222429] hover:bg-[#3a1f22] border border-[#2e3138] hover:border-[#d9534f]/60 text-[#f3a3a0] text-xs font-semibold cursor-pointer disabled:opacity-50"
                            >
                                Очистити кошик
                            </button>
                        )}
                        {confirmClear && (
                            <div className="inline-flex items-center gap-2">
                                <span className="text-xs text-[#f3a3a0]">Очистити всі {items.length} записів назавжди?</span>
                                <button
                                    type="button"
                                    disabled={Boolean(busyId)}
                                    onClick={handleClearAll}
                                    className="h-8 px-3 rounded-sm bg-[#b91c1c] hover:bg-[#dc2626] border border-[#e05252]/60 text-white text-xs font-semibold cursor-pointer"
                                >
                                    Так, очистити
                                </button>
                                <button
                                    type="button"
                                    disabled={Boolean(busyId)}
                                    onClick={() => setConfirmClear(false)}
                                    className="h-8 px-2.5 rounded-sm bg-[#222429] border border-[#2e3138] text-[#cbd5e1] text-xs cursor-pointer"
                                >
                                    Скасувати
                                </button>
                            </div>
                        )}
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        className="h-8 px-3.5 rounded-sm bg-[#222429] hover:bg-[#282b31] border border-[#2e3138] text-xs font-semibold cursor-pointer"
                    >
                        Закрити
                    </button>
                </div>
            </section>
        </div>
    );
};
