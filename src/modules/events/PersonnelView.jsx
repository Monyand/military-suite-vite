import { default as React, useMemo, useState } from 'react';

const HOMOGLYPHS = { a: 'а', c: 'с', e: 'е', i: 'і', o: 'о', p: 'р', x: 'х', y: 'у' };
const normSearchText = (value) => String(value ?? '')
    .normalize('NFKC')
    .trim()
    .toLocaleLowerCase('uk-UA')
    .replace(/[’ʼ`′]/g, "'")
    .replace(/[aceiopxy]/g, ch => HOMOGLYPHS[ch] || ch)
    .replace(/\s+/g, ' ');

export const PersonnelView = ({ personnel, savePersonnel, showToast, Icon, generateId }) => {
    const [search, setSearch] = useState('');
    const [filterStatus, setFilterStatus] = useState('all');
    const [editingId, setEditingId] = useState(null);
    const [pendingDeleteId, setPendingDeleteId] = useState(null);

    const [formData, setFormData] = useState({ callsign: '', status: 'alive', notes: '' });

    const handleSave = async (e) => {
        e.preventDefault();
        if (!formData.callsign.trim()) {
            showToast('Вкажіть позивний'); return;
        }
        const now = new Date().toISOString();
        let newList;
        if (editingId) {
            newList = personnel.map(p => p.id === editingId ? { ...p, ...formData, callsign: formData.callsign.trim(), lastUpdated: now } : p);
            setEditingId(null);
        } else {
            const newEntry = { id: generateId(), ...formData, callsign: formData.callsign.trim(), createdAt: now, lastUpdated: now };
            newList = [newEntry, ...personnel];
        }
        await savePersonnel(newList);
        setFormData({ callsign: '', status: 'alive', notes: '' });
        showToast('Запис збережено');
    };

    const handleDelete = async (id) => {
        await savePersonnel(personnel.filter(p => p.id !== id));
        setPendingDeleteId(prev => (prev === id ? null : prev));
        if (editingId === id) {
            setEditingId(null);
            setFormData({ callsign: '', status: 'alive', notes: '' });
        }
        showToast('Запис видалено');
    };

    const filtered = useMemo(() => {
        const needle = normSearchText(search);
        return personnel.filter(p => {
            if (filterStatus !== 'all' && p.status !== filterStatus) return false;
            if (needle) {
                const hay = normSearchText(`${p.callsign || ''} ${p.notes || ''}`);
                if (!hay.includes(needle)) return false;
            }
            return true;
        });
    }, [personnel, filterStatus, search]);

    const getStatusColor = (status) => {
        switch (status) {
            case '200':
            case '200_disc':
            case '200_pow':
                return 'text-[#f3a3a0] border-[#d9534f]/60 bg-[#d9534f]/15';
            case '200_unc': return 'text-[#e5989b] border-[#d9534f]/40 bg-[#d9534f]/10';
            case '300': return 'text-[#d99b26] border-[#d99b26]/50 bg-[#d99b26]/12';
            case 'pow': return 'text-[#3da372] border-[#3da372]/50 bg-[#3da372]/12';
            default: return 'text-[#b8bec8] border-[#2e3138] bg-[#222429]';
        }
    };
    const getStatusLabel = (status) => {
        switch (status) {
            case '200': return '200 (Вбито)';
            case '200_unc': return '200* (Ймовірно)';
            case '200_disc': return 'Вияв. 200';
            case '200_pow': return '200 (П)';
            case '300': return '300 (Поранено)';
            case 'pow': return 'Полонений';
            default: return 'Живий';
        }
    };

    return (
        <div className="flex-1 flex flex-col md:flex-row gap-4 p-4 overflow-hidden h-full bg-[#101113] text-[#f3f4f6]">
            {/* Ліва панель: Список */}
            <div className="flex-[2] flex flex-col gap-3 min-h-0 bg-[#17181b] rounded-sm border border-[#2e3138] p-4">
                <div className="flex items-center flex-wrap gap-2">
                    <div className="text-[#b8bec8] text-xs whitespace-nowrap font-semibold px-2.5 py-1.5 bg-[#101113] border border-[#2e3138] rounded-sm tabular-nums">
                        Всього: {filtered.length}
                    </div>
                    <input type="text" placeholder="Пошук (позивний або примітки)..." value={search} onChange={e => setSearch(e.target.value)} className="flex-1 min-w-[160px] bg-[#101113] border border-[#2e3138] rounded-sm px-3 py-1.5 text-sm text-[#f3f4f6] placeholder-[#989fa9] focus:outline-none focus:border-[#4c8ed9]" />
                    <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className="bg-[#101113] border border-[#2e3138] rounded-sm px-3 py-1.5 text-sm text-[#f3f4f6] focus:outline-none focus:border-[#4c8ed9]">
                        <option value="all">Всі статуси</option>
                        <option value="alive">Живі</option>
                        <option value="300">300 (Поранені)</option>
                        <option value="pow">Полонені</option>
                        <option value="200">200 (Вбиті)</option>
                        <option value="200_unc">200* (Ймовірно)</option>
                        <option value="200_disc">Вияв. 200</option>
                        <option value="200_pow">200 (Загиблий полонений)</option>
                    </select>
                </div>
                <div className="flex-1 overflow-y-auto divide-y divide-[#2e3138] border border-[#2e3138] rounded-sm bg-[#101113] custom-scrollbar">
                    {filtered.map(p => (
                        <div key={p.id} className="px-3.5 py-2.5 flex items-center justify-between gap-2 hover:bg-[#222429] transition-colors group">
                            <div className="min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                    <span className="font-semibold text-[#f3f4f6] font-mono text-sm">{p.callsign}</span>
                                    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-sm border ${getStatusColor(p.status)} uppercase`}>{getStatusLabel(p.status)}</span>
                                </div>
                                {p.notes && <div className="text-xs text-[#b8bec8] mt-1">{p.notes}</div>}
                            </div>
                            <div className={`flex items-center gap-1.5 shrink-0 transition-opacity ${pendingDeleteId === p.id ? 'opacity-100' : 'opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100'}`}>
                                <button type="button" aria-label="Редагувати запис" title="Редагувати" onClick={() => { setPendingDeleteId(null); setEditingId(p.id); setFormData({ callsign: p.callsign, status: p.status, notes: p.notes || '' }); }} className="p-1.5 text-[#b8bec8] hover:text-[#4c8ed9] hover:bg-[#222429] rounded-sm border border-transparent hover:border-[#2e3138]">
                                    <Icon name="edit-2" className="w-4 h-4" />
                                </button>
                                {pendingDeleteId === p.id ? (
                                    <>
                                        <button type="button" onClick={() => handleDelete(p.id)} className="px-2 py-1 text-xs font-semibold bg-[#d9534f]/20 hover:bg-[#d9534f]/30 border border-[#d9534f]/60 text-[#f3a3a0] rounded-sm transition-colors">
                                            Видалити?
                                        </button>
                                        <button type="button" onClick={() => setPendingDeleteId(null)} className="px-2 py-1 text-xs font-semibold bg-[#222429] hover:bg-[#282b31] border border-[#2e3138] text-[#cbd5e1] rounded-sm transition-colors">
                                            Ні
                                        </button>
                                    </>
                                ) : (
                                    <button type="button" aria-label="Видалити запис" title="Видалити" onClick={() => setPendingDeleteId(p.id)} className="p-1.5 text-[#b8bec8] hover:text-[#f3a3a0] hover:bg-[#d9534f]/10 rounded-sm border border-transparent hover:border-[#d9534f]/40">
                                        <Icon name="trash-2" className="w-4 h-4" />
                                    </button>
                                )}
                            </div>
                        </div>
                    ))}
                    {filtered.length === 0 && <div className="text-center text-[#989fa9] text-sm py-8">Нічого не знайдено</div>}
                </div>
            </div>

            {/* Права панель: Форма */}
            <div className="flex-1 flex flex-col gap-3 bg-[#17181b] rounded-sm border border-[#2e3138] p-4 h-fit sticky top-4">
                <h3 className="font-bold text-sm text-[#f3f4f6] border-b border-[#2e3138] pb-2.5">{editingId ? 'Редагувати запис' : 'Додати в базу'}</h3>
                <form onSubmit={handleSave} className="space-y-3.5">
                    <div>
                        <label className="block text-xs font-semibold text-[#b8bec8] mb-1">Позивний <span className="text-[#f3a3a0]">*</span></label>
                        <input type="text" required value={formData.callsign} onChange={e => setFormData({ ...formData, callsign: e.target.value })} className="w-full bg-[#101113] border border-[#2e3138] rounded-sm px-3 py-1.5 text-sm text-[#f3f4f6] focus:outline-none focus:border-[#4c8ed9]" placeholder="Напр. Тайсон" />
                    </div>
                    <div>
                        <label className="block text-xs font-semibold text-[#b8bec8] mb-1">Статус</label>
                        <select value={formData.status} onChange={e => setFormData({ ...formData, status: e.target.value })} className="w-full bg-[#101113] border border-[#2e3138] rounded-sm px-3 py-1.5 text-sm text-[#f3f4f6] focus:outline-none focus:border-[#4c8ed9]">
                            <option value="alive">Живий / Активний</option>
                            <option value="300">300 (Поранено)</option>
                            <option value="pow">Полонений</option>
                            <option value="200">200 (Вбито)</option>
                            <option value="200_unc">200* (Ймовірно)</option>
                            <option value="200_disc">Вияв. 200</option>
                            <option value="200_pow">200 (Загиблий полонений)</option>
                        </select>
                    </div>
                    <div>
                        <label className="block text-xs font-semibold text-[#b8bec8] mb-1">Примітки</label>
                        <textarea value={formData.notes} onChange={e => setFormData({ ...formData, notes: e.target.value })} className="w-full bg-[#101113] border border-[#2e3138] rounded-sm px-3 py-1.5 text-sm text-[#f3f4f6] focus:outline-none focus:border-[#4c8ed9] min-h-[80px]" placeholder="Додаткова інформація..."></textarea>
                    </div>
                    <div className="flex gap-2 pt-1">
                        <button type="submit" className="flex-1 bg-[#2b67ab] hover:bg-[#3477c2] border border-[#4c8ed9] text-white font-semibold text-xs py-2 rounded-sm transition-colors">{editingId ? 'Зберегти' : 'Додати'}</button>
                        {editingId && (
                            <button type="button" onClick={() => { setEditingId(null); setFormData({ callsign: '', status: 'alive', notes: '' }); }} className="flex-1 bg-[#222429] hover:bg-[#282b31] border border-[#2e3138] text-[#cbd5e1] font-semibold text-xs py-2 rounded-sm transition-colors">Скасувати</button>
                        )}
                    </div>
                </form>
            </div>
        </div>
    );
};

