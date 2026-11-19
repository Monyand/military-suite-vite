import { localforage } from './vendor.js';

const TRASH_KEY = 'suite_trash_v1';
const MAX_TRASH_ITEMS = 500;

export const TRASH_MODULES = {
    enemy:     { label: 'Втрати Противника', color: '#f87171', border: 'rgba(239,68,68,.45)',  bg: '#2b1719' },
    med:       { label: 'Наші втрати о/с',   color: '#5eead4', border: 'rgba(20,184,166,.45)', bg: '#122624' },
    positions: { label: 'Статус позицій',    color: '#c4b5fd', border: 'rgba(139,92,246,.45)', bg: '#201932' },
    ovt:       { label: 'Втрати ОВТ',        color: '#fdba74', border: 'rgba(249,115,22,.45)', bg: '#2b1c12' },
    tasks:     { label: 'Завдання',          color: '#fde047', border: 'rgba(234,179,8,.45)',  bg: '#272112' },
};

const notifyChanged = (count) => {
    try {
        window.dispatchEvent(new CustomEvent('suite-trash-changed', { detail: { count } }));
    } catch { /* ignore */ }
};

const readList = async () => {
    try {
        const raw = await localforage.getItem(TRASH_KEY);
        return Array.isArray(raw) ? raw : [];
    } catch {
        return [];
    }
};

const writeList = async (items) => {
    const trimmed = items.slice(0, MAX_TRASH_ITEMS);
    if (window.SuiteRuntime?.setItem) {
        await window.SuiteRuntime.setItem(TRASH_KEY, trimmed);
    } else {
        await localforage.setItem(TRASH_KEY, trimmed);
    }
    notifyChanged(trimmed.length);
    return trimmed;
};

const makeTrashId = () =>
    (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
        ? crypto.randomUUID()
        : `trash_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

export const SuiteTrash = {
    KEY: TRASH_KEY,
    list: readList,
    async count() {
        const items = await readList();
        return items.length;
    },
    async add({ module, summary, record }) {
        if (!record || typeof record !== 'object') return null;
        const meta = TRASH_MODULES[module] || { label: String(module || 'Модуль') };
        let cloned;
        try {
            cloned = structuredClone(record);
        } catch {
            cloned = JSON.parse(JSON.stringify(record));
        }
        const entry = {
            trashId: makeTrashId(),
            deletedAt: new Date().toISOString(),
            module,
            moduleLabel: meta.label,
            summary: String(summary || record.name || record.callsign || record.task || record.id || 'Запис').slice(0, 240),
            record: cloned,
        };
        const current = await readList();
        await writeList([entry, ...current]);
        return entry;
    },
    async remove(trashId) {
        const current = await readList();
        const next = current.filter(item => item.trashId !== trashId);
        await writeList(next);
        return next;
    },
    async clear() {
        await writeList([]);
        return [];
    },
};
