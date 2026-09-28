import { default as React, useState } from 'react';

export const PersonnelView = ({ personnel, savePersonnel, showToast, Icon, generateId }) => {
    const [search, setSearch] = useState('');
    const [filterStatus, setFilterStatus] = useState('all');
    const [editingId, setEditingId] = useState(null);
    
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
        if (confirm('Видалити цей запис?')) {
            await savePersonnel(personnel.filter(p => p.id !== id));
            showToast('Запис видалено');
        }
    };

    const filtered = personnel.filter(p => {
        if (filterStatus !== 'all' && p.status !== filterStatus) return false;
        if (search && !p.callsign.toLowerCase().includes(search.toLowerCase())) return false;
        return true;
    });

    const getStatusColor = (status) => {
        switch(status) {
            case '200': 
            case '200_disc': 
            case '200_pow':
                return 'text-red-500 border-red-500 bg-red-500/10';
            case '200_unc': return 'text-rose-400 border-rose-400 bg-rose-500/10';
            case '300': return 'text-amber-500 border-amber-500 bg-amber-500/10';
            case 'pow': return 'text-emerald-500 border-emerald-500 bg-emerald-500/10';
            default: return 'text-slate-400 border-slate-600';
        }
    };
    const getStatusLabel = (status) => {
        switch(status) {
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
        <div className="flex-1 flex flex-col md:flex-row gap-4 p-4 overflow-hidden h-full">
            {/* Ліва панель: Список */}
            <div className="flex-[2] flex flex-col gap-3 min-h-0 bg-slate-900/50 rounded-xl border border-slate-800 p-4">
                <div className="flex items-center gap-3">
                    <div className="text-slate-400 text-sm whitespace-nowrap font-medium px-2 py-1.5 bg-slate-950 border border-slate-800 rounded-lg">
                        Всього: {filtered.length}
                    </div>
                    <input type="text" placeholder="Пошук (позивний)..." value={search} onChange={e => setSearch(e.target.value)} className="flex-1 bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-sm text-slate-200" />
                    <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className="bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-sm text-slate-200">
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
                <div className="flex-1 overflow-y-auto space-y-2 pr-1 custom-scrollbar">
                    {filtered.map(p => (
                        <div key={p.id} className="bg-slate-950 border border-slate-800 rounded-lg p-3 flex items-center justify-between hover:border-slate-700 transition group">
                            <div>
                                <div className="flex items-center gap-2">
                                    <span className="font-bold text-slate-200 font-mono text-base">{p.callsign}</span>
                                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${getStatusColor(p.status)} uppercase`}>{getStatusLabel(p.status)}</span>
                                </div>
                                {p.notes && <div className="text-xs text-slate-500 mt-1 italic">{p.notes}</div>}
                            </div>
                            <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition">
                                <button onClick={() => { setEditingId(p.id); setFormData({ callsign: p.callsign, status: p.status, notes: p.notes || '' }); }} className="p-2 text-slate-400 hover:text-amber-400 hover:bg-amber-400/10 rounded-lg">
                                    <Icon name="edit-2" className="w-4 h-4" />
                                </button>
                                <button onClick={() => handleDelete(p.id)} className="p-2 text-slate-400 hover:text-red-400 hover:bg-red-400/10 rounded-lg">
                                    <Icon name="trash-2" className="w-4 h-4" />
                                </button>
                            </div>
                        </div>
                    ))}
                    {filtered.length === 0 && <div className="text-center text-slate-500 text-sm py-8">Нічого не знайдено</div>}
                </div>
            </div>

            {/* Права панель: Форма */}
            <div className="flex-1 flex flex-col gap-3 bg-slate-900/80 rounded-xl border border-slate-800 p-4 h-fit sticky top-4">
                <h3 className="font-bold text-slate-200">{editingId ? 'Редагувати запис' : 'Додати в базу'}</h3>
                <form onSubmit={handleSave} className="space-y-4">
                    <div>
                        <label className="block text-xs font-semibold text-slate-400 mb-1">Позивний <span className="text-red-400">*</span></label>
                        <input type="text" required value={formData.callsign} onChange={e => setFormData({...formData, callsign: e.target.value})} className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 focus:border-amber-500" placeholder="Напр. Тайсон" />
                    </div>
                    <div>
                        <label className="block text-xs font-semibold text-slate-400 mb-1">Статус</label>
                        <select value={formData.status} onChange={e => setFormData({...formData, status: e.target.value})} className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 focus:border-amber-500">
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
                        <label className="block text-xs font-semibold text-slate-400 mb-1">Примітки</label>
                        <textarea value={formData.notes} onChange={e => setFormData({...formData, notes: e.target.value})} className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 focus:border-amber-500 min-h-[80px]" placeholder="Додаткова інформація..."></textarea>
                    </div>
                    <div className="flex gap-2 pt-2">
                        <button type="submit" className="flex-1 bg-amber-600 hover:bg-amber-500 text-white font-bold py-2 rounded-lg transition">{editingId ? 'Зберегти' : 'Додати'}</button>
                        {editingId && (
                            <button type="button" onClick={() => { setEditingId(null); setFormData({ callsign: '', status: 'alive', notes: '' }); }} className="flex-1 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold py-2 rounded-lg transition">Скасувати</button>
                        )}
                    </div>
                </form>
            </div>
        </div>
    );
};

