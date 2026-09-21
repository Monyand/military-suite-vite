// Contextual suggestions for retrospective documents; saved records remain snapshots.
export const OVT_TEMPLATE_LISTS = [
    ['tasks', 'Завдання', 'підвозу будівельних матеріалів'],
    ['routes', 'Маршрут', 'Святогірськ—Соснове—Новоселівка'],
    ['equipmentTypes', 'Тип транспорту', 'вантажний автомобіль'],
    ['models', 'Номенклатура / Модель', 'ГАЗ-3307'],
    ['descriptions', 'Опис події', 'зазнав вогневого ураження'],
    ['consequences', 'Наслідок', 'транспортний засіб був повністю знищений'],
];
export const OVT_STATUSES = ['ЗНИЩЕНО', 'ПОШКОДЖЕНО'];
export const OVT_SUBJECTS = ['транспортний засіб', 'техніка']; // Legacy backup compatibility.
export const emptyOvtTemplates = () => Object.fromEntries(OVT_TEMPLATE_LISTS.map(([key]) => [key, []]));
const norm = text => String(text || '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('uk-UA');
export const ovtTemplateName = entry => typeof entry === 'string' ? entry : entry.name;
const identity = entry => JSON.stringify([norm(ovtTemplateName(entry)), entry.status || '', norm(entry.equipmentType)]);
export function validateOvtTemplates(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Пошкоджені шаблони ОВТ.');
    for (const [key, title] of OVT_TEMPLATE_LISTS) {
        if (key === 'models' && value[key] === undefined) continue; // Older backups have five lists.
        if (!Array.isArray(value[key]) || value[key].length > 1000) throw new Error('Шаблони ОВТ: потрібен список до 1000 варіантів — ' + title);
        const names = new Set();
        for (const entry of value[key]) {
            if (entry == null || (typeof entry !== 'string' && (typeof entry !== 'object' || Array.isArray(entry)))) throw new Error('Пошкоджений шаблон ОВТ.');
            const name = ovtTemplateName(entry);
            if (typeof name !== 'string' || !name.trim() || name.length > 1000) throw new Error('Шаблони ОВТ: порожній або завеликий текст — ' + title);
            if (entry.status !== undefined && entry.status !== '' && !OVT_STATUSES.includes(entry.status)) throw new Error('Невідомий статус шаблону ОВТ.');
            if (entry.equipmentType !== undefined && (typeof entry.equipmentType !== 'string' || entry.equipmentType.length > 1000)) throw new Error('Некоректний тип транспорту шаблону.');
            if (entry.subject !== undefined && !OVT_SUBJECTS.includes(entry.subject)) throw new Error('Невідоме старе формулювання шаблону.');
            const id = key === 'equipmentTypes' ? norm(name) : identity(entry);
            if (names.has(id)) throw new Error('Шаблони ОВТ: повторюється варіант — ' + name);
            names.add(id);
        }
    }
    return value;
}
export function normalizeOvtTemplates(value) {
    const next = structuredClone(validateOvtTemplates(value));
    next.models ??= [];
    for (const key of ['tasks', 'routes', 'descriptions', 'models']) {
        const seen = new Set();
        next[key] = next[key].map(entry => {
            if (typeof entry === 'string') return entry;
            const { status, ...phrase } = entry;
            return phrase;
        }).filter(entry => {
            const id = identity(entry);
            if (seen.has(id)) return false;
            seen.add(id); return true;
        });
    }
    return next;
}
// One-time model import into the dictionary view, never a rewrite of event data.
export function seedOvtModels(templates, rows = [], legacyOptions = []) {
    const next = normalizeOvtTemplates(templates), seen = new Set(next.models.map(identity));
    const add = (name, equipmentType = '') => {
        if (typeof name !== 'string' || !name.trim() || name.length > 1000 || /\[[^\]]+\]/.test(name)) return;
        const entry = { name: name.trim(), equipmentType: typeof equipmentType === 'string' ? equipmentType.trim() : '' };
        const id = identity(entry);
        if (!seen.has(id) && next.models.length < 1000) { seen.add(id); next.models.push(entry); }
    };
    for (const row of Array.isArray(rows) ? rows : []) if (row?.category === 'Транспорт') add(row.nomenclature, row.equipmentType);
    for (const name of Array.isArray(legacyOptions) ? legacyOptions : []) {
        if (!['пікап', 'позашляховик'].includes(norm(name))) add(name);
    }
    return next;
}
export function addOvtTemplateLines(value, key, text, context = {}) {
    if (!OVT_TEMPLATE_LISTS.some(([id]) => id === key)) throw new Error('Невідомий список шаблонів ОВТ.');
    const next = normalizeOvtTemplates(value);
    const lines = String(text).split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    if (!lines.length) throw new Error('Введіть хоча б один варіант: кожен із нового рядка.');
    for (const name of lines) {
        const entry = key === 'equipmentTypes' ? { name, ...(typeof context === 'string' ? { subject: context } : {}) }
            : { name, ...(key === 'consequences' ? { status: context.status || '' } : {}), equipmentType: context.equipmentType?.trim() || '' };
        const id = key === 'equipmentTypes' ? norm(name) : identity(entry);
        if (!next[key].some(item => (key === 'equipmentTypes' ? norm(ovtTemplateName(item)) : identity(item)) === id)) next[key].push(entry);
    }
    return validateOvtTemplates(next);
}
export function ovtTemplateOptions(templates, key, row) {
    return [...new Set((templates[key] || []).filter(entry => {
        if (key === 'equipmentTypes') return true;
        // Legacy consequences must be explicitly classified before suggesting.
        if (key === 'consequences' && !OVT_STATUSES.includes(entry.status)) return false;
        return (key !== 'consequences' || entry.status === row.status) && (!entry.equipmentType || norm(entry.equipmentType) === norm(row.equipmentType));
    }).map(ovtTemplateName))];
}
export function learnOvtTemplates(value, row) {
    let next = normalizeOvtTemplates(value);
    if (row.category !== 'Транспорт' || !OVT_STATUSES.includes(row.status)) return next;
    const context = { status: row.status, equipmentType: row.equipmentType || '' };
    const fields = { equipmentTypes: 'equipmentType', models: 'nomenclature', tasks: 'taskText', descriptions: 'eventDescription', consequences: 'consequence' };
    if (row.locationMode === 'route' || (!row.locationMode && row.routeText)) fields.routes = 'routeText';
    for (const [key, field] of Object.entries(fields)) {
        const name = String(row[field] || '').trim();
        if (!name || /\[[^\]]+\]/.test(name)) continue;
        if (!ovtTemplateOptions(next, key, row).some(item => norm(item) === norm(name))) next = addOvtTemplateLines(next, key, name, context);
    }
    return next;
}
