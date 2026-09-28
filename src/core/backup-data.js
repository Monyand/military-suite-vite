import { DocumentJournal as D } from './documents.js';

// Transfer copies never carry the recipient's local PBD workflow state,
// including flags inside audit/recovery snapshots nested in document data.
export function withoutLocalPbd(value) {
    if (Array.isArray(value)) return value.map(withoutLocalPbd);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
        .filter(([key]) => key !== 'reportedInPbd').map(([key, item]) => [key, withoutLocalPbd(item)]));
    return value;
}

export function prepareJournalRestore(incoming, local, localRecovery = false) {
    const next = D.migrate(incoming);
    if (!localRecovery) for (const tab of ['tasks', 'positions']) {
        const flags = new Map((local?.[tab] || []).map(row => [row.id, row.reportedInPbd === true]));
        for (const row of next[tab] || []) row.reportedInPbd = flags.get(row.id) ?? false;
    }
    return D.validate(next);
}

export function validateBackupRecords(data) {
    const journal = data.localforage[D.KEY];
    if (journal !== undefined) D.validate(D.migrate(journal));
    for (const [key, rows] of Object.entries(data.localforage)) {
        if (!/^(enemy_events_v[12]|enemy_personnel_v1|med_(soldiers|episodes)_v[23])$/.test(key)) continue;
        if (!Array.isArray(rows)) throw new Error('Некоректний список: ' + key);
        const ids = new Set();
        for (const row of rows) {
            if (!row || typeof row !== 'object' || Array.isArray(row) || !['string', 'number'].includes(typeof row.id) || !String(row.id).trim()) throw new Error('Запис без коректного ID: ' + key);
            if (ids.has(String(row.id))) throw new Error('Повторний ID у списку: ' + key + ' — ' + row.id);
            ids.add(String(row.id));
            if (key.startsWith('enemy_events') && (!Array.isArray(row.types) || row.types.some(type => typeof type !== 'string') || typeof row.createdAt !== 'string')) throw new Error('Пошкоджений тип або дата події: ' + row.id);
            if (key.startsWith('enemy_events') && (!Array.isArray(row.enemyLosses) || row.enemyLosses.some(loss => !loss || typeof loss !== 'object' || Array.isArray(loss)))) throw new Error('Пошкоджені рядки події: ' + row.id);
            if (key.startsWith('med_episodes') && (typeof row.date !== 'string' || typeof row.lossType !== 'string')) throw new Error('Пошкоджений медичний епізод: ' + row.id);
            if (key === 'enemy_personnel_v1' && (typeof row.callsign !== 'string' || typeof row.status !== 'string')) throw new Error('Пошкоджений запис реєстру осіб: ' + row.id);
            for (const field of ['name', 'unit', 'rank', 'callsign', 'description']) if (row[field] !== undefined && typeof row[field] !== 'string') throw new Error('Некоректне текстове поле ' + field + ' у записі: ' + row.id);
        }
    }
}

export function backupSummary(incoming, current) {
    const lists = snapshot => {
        const lf = snapshot.localforage, ls = snapshot.localstorage;
        const legacy = key => ls[key] == null ? [] : JSON.parse(ls[key]);
        return [
            ['Події', lf.enemy_events_v2 ?? lf.enemy_events_v1 ?? []],
            ['Реєстр осіб у подіях', lf.enemy_personnel_v1 ?? []],
            ['Медична база в/сл', lf.med_soldiers_v3 ?? lf.med_soldiers_v2 ?? legacy('med_soldiers_v3')],
            ['Медичні епізоди', lf.med_episodes_v3 ?? lf.med_episodes_v2 ?? legacy('med_episodes_v3')],
            ['Журнал о/с', legacy('tactical_personnel')],
            ...D.tabs.map(tab => [D.schemas[tab].title, lf[D.KEY]?.[tab] ?? []])
        ];
    };
    const before = new Map(lists(current));
    return lists(incoming).map(([title, rows]) => {
        const previous = before.get(title) || [], oldIds = new Set(previous.map(row => String(row.id))), ids = new Set(rows.map(row => String(row.id)));
        return { title, current: previous.length, incoming: rows.length,
            added: rows.filter(row => !oldIds.has(String(row.id))).length,
            removed: previous.filter(row => !ids.has(String(row.id))).length };
    });
}
