import { DocumentJournal as D } from './documents.js';
import { MedicalDailyTotals } from './medical-totals.js';
import { buildPositionRegister } from '../modules/documents/position-register.js';

// Read-only diagnostics. Unknown values are reported, never silently rewritten.
export function inspectIntegrity(snapshot) {
    const issues = [], lf = snapshot.localforage || {}, ls = snapshot.localstorage || {};
    const add = (module, row, message, severity = 'warning', kind = '') => issues.push({ module, recordId: row?.id == null ? '' : String(row.id), label: String(row?.task || row?.name || row?.nomenclature || row?.callsign || row?.date || ''), message, severity, kind });
    const list = (module, rows, kind = '') => {
        if (!Array.isArray(rows)) { add(module, null, 'Замість списку записів збережено інший тип даних.', 'error', kind); return []; }
        const ids = new Set();
        return rows.filter(row => {
            if (!row || typeof row !== 'object' || Array.isArray(row)) { add(module, null, 'Пошкоджений запис.', 'error', kind); return false; }
            if (!['string', 'number'].includes(typeof row.id) || !String(row.id).trim()) add(module, row, 'Відсутній або некоректний ID запису.', 'error', kind);
            else if (ids.has(String(row.id))) add(module, row, 'Повторний ID. Потрібна ручна перевірка; автоматичного об’єднання немає.', 'error', kind);
            ids.add(String(row.id)); return true;
        });
    };
    const legacy = (key, module) => {
        try { return ls[key] == null ? [] : JSON.parse(ls[key]); }
        catch { add(module, null, 'Пошкоджений JSON: ' + key, 'error'); return []; }
    };
    const journal = lf[D.KEY];
    if (journal !== undefined) {
        let normalized;
        try { normalized = D.migrate(journal); }
        catch (error) { add('tasks', null, error.message, 'error'); }
        if (normalized) for (const tab of D.tabs) {
            const valid = [];
            for (const row of list(tab, normalized[tab])) {
                try { D.validate({ ...D.empty(), [tab]: [row] }); valid.push(row); }
                catch (error) { add(tab, row, error.message, 'error'); }
                for (const [key, title, options] of D.schemas[tab].fields) if (Array.isArray(options) && row[key] && !options.includes(row[key])) add(tab, row, `Нерозпізнане значення «${title}»: ${row[key]}. Збережене значення не змінено.`);
            }
            if (tab === 'positions') {
                const register = buildPositionRegister(valid);
                for (const row of valid) if (register.issues.has(row.id)) add(tab, row, register.issues.get(row.id));
            }
        }
    }
    const soldiers = list('med', lf.med_soldiers_v3 ?? lf.med_soldiers_v2 ?? legacy('med_soldiers_v3', 'med'), 'soldier');
    const ids = new Set(soldiers.map(row => String(row.id)));
    const episodes = list('med', lf.med_episodes_v3 ?? lf.med_episodes_v2 ?? (ls.med_episodes_v3 != null ? legacy('med_episodes_v3', 'med') : legacy('med_episodes_v2', 'med')));
    for (const row of episodes) {
        if (!ids.has(String(row.soldierId))) add('med', row, 'Епізод посилається на відсутню анкету в/сл.', 'error');
        if (!MedicalDailyTotals.dateKey(row.date)) add('med', row, 'Некоректна дата: запис не потрапляє до поденних підсумків.', 'error');
        if (MedicalDailyTotals.classify(row.lossType) === 'unknown') add('med', row, 'Нерозпізнаний тип втрат; запис виключений із міжмодульних підсумків: ' + (row.lossType || '(порожньо)'));
    }
    const medical = MedicalDailyTotals.aggregate(episodes);
    for (const row of list('enemy', lf.enemy_events_v2 ?? lf.enemy_events_v1 ?? [])) {
        if (!Array.isArray(row.types) || row.types.some(type => typeof type !== 'string') || typeof row.createdAt !== 'string') add('enemy', row, 'Пошкоджений тип або дата події.', 'error');
        if (!Array.isArray(row.enemyLosses)) add('enemy', row, 'Пошкоджений список рядків події.', 'error');
    }
    list('enemy', lf.enemy_personnel_v1 ?? [], 'personnel');
    list('tactical', legacy('tactical_personnel', 'tactical'));
    return { issues, medical, checkedAt: new Date().toLocaleString('uk-UA') };
}
