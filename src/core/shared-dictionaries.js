import { emptyOvtTemplates, validateOvtTemplates, learnOvtTemplates, normalizeOvtTemplates, seedOvtModels } from './ovt-templates.js';

export const prepareOvtDictionaries = (config, journal) => {
    const source = config == null ? emptyDictionaries() : validateDictionaries(config);
    let templates = normalizeOvtTemplates(source.ovtTemplates ?? emptyOvtTemplates());
    if (config?.ovtTemplates?.models === undefined) templates = seedOvtModels(templates, journal?.ovt, journal?.settings?.ovtDict?.['Транспорт']);
    return { ...source, ovtTemplates: templates };
};

export const withLearnedOvtTemplates = (config, row) => ({
    ...config, ovtTemplates: learnOvtTemplates(config.ovtTemplates ?? emptyOvtTemplates(), row),
});

// Text vocabulary maintenance only: no position state, assignments or movements.
export const DICTIONARY_KEY = 'document_dictionaries_v1';
export const DICTIONARY_KINDS = [
    ['docPlaces', 'Документальні назви'],
    ['actualPlaces', 'Фактичні місця'],
    ['units', 'Підрозділи'],
    ['causes', 'Причини'],
    ['weapons', 'Засоби ураження'],
    ['ranks', 'Звання'],
];
export const normalizeLabel = value => String(value ?? '').normalize('NFKC').trim().replace(/[’ʼ`]/g, "'").replace(/\s+/g, ' ').toLocaleLowerCase('uk-UA');
const clean = value => String(value ?? '').trim();
const unique = values => [...new Set(values.map(clean).filter(Boolean))];
export const emptyDictionaries = () => ({ version: 1, dictionaries: Object.fromEntries(DICTIONARY_KINDS.map(([key]) => [key, { canonical: [], aliases: [] }])), ovtTemplates: emptyOvtTemplates(), history: [] });

export function validateDictionaries(value) {
    if (!value || value.version !== 1 || !value.dictionaries || typeof value.dictionaries !== 'object' || !Array.isArray(value.history)) throw new Error('Невірний формат спільних довідників.');
    for (const [kind, title] of DICTIONARY_KINDS) {
        const dictionary = value.dictionaries[kind];
        if (!dictionary || !Array.isArray(dictionary.canonical) || !Array.isArray(dictionary.aliases)) throw new Error('Пошкоджений довідник: ' + title);
        const targets = new Map();
        for (const name of dictionary.canonical) {
            if (typeof name !== 'string' || !normalizeLabel(name) || name.length > 1000) throw new Error('Порожня або завелика стандартна назва: ' + title);
            const key = normalizeLabel(name);
            if (targets.has(key) && targets.get(key) !== name) throw new Error('Дві стандартні назви відрізняються лише регістром або пробілами: ' + name);
            targets.set(key, name);
        }
        const aliases = new Map();
        for (const rule of dictionary.aliases) {
            if (!rule || typeof rule.from !== 'string' || typeof rule.to !== 'string' || !normalizeLabel(rule.from) || rule.from.length > 1000 || !targets.has(normalizeLabel(rule.to))) throw new Error('Правило повинне мати варіант і стандартну назву з довідника: ' + title);
            const from = normalizeLabel(rule.from), to = targets.get(normalizeLabel(rule.to));
            if (aliases.has(from) && aliases.get(from) !== to) throw new Error('Один варіант направлено до різних назв: ' + rule.from);
            if (targets.has(from) && targets.get(from) !== to) throw new Error('Стандартна назва не може водночас замінюватися іншою: ' + rule.from);
            aliases.set(from, to);
        }
    }
    if (value.ovtTemplates !== undefined) validateOvtTemplates(value.ovtTemplates);
    return value;
}

export function canonicalLabel(config, kind, value) {
    const dictionary = config.dictionaries[kind];
    const key = normalizeLabel(value);
    const alias = dictionary.aliases.find(rule => normalizeLabel(rule.from) === key);
    return alias ? dictionary.canonical.find(name => normalizeLabel(name) === normalizeLabel(alias.to)) : dictionary.canonical.find(name => normalizeLabel(name) === key);
}

export function addRules(config, kind, rules) {
    const next = structuredClone(config), dictionary = next.dictionaries[kind];
    for (const rule of rules) {
        const from = clean(rule.from), to = clean(rule.to);
        if (!from || !to) throw new Error('Обидві частини правила мають бути заповнені.');
        const existing = dictionary.canonical.find(name => normalizeLabel(name) === normalizeLabel(to));
        const target = existing || to;
        if (!existing) dictionary.canonical.push(to);
        if (normalizeLabel(from) !== normalizeLabel(target)) dictionary.canonical = dictionary.canonical.filter(name => normalizeLabel(name) !== normalizeLabel(from));
        // Refuse hidden chains; users must resolve conflicting rules explicitly.
        const previous = dictionary.aliases.find(alias => normalizeLabel(alias.from) === normalizeLabel(from));
        if (previous && normalizeLabel(previous.to) !== normalizeLabel(target)) throw new Error('Уже є інше правило для «' + from + '». Спершу видаліть його.');
        if (!previous && from !== target) dictionary.aliases.push({ from, to: target });
    }
    return validateDictionaries(next);
}

export function parseReplacementPairs(text) {
    const rules = [];
    String(text).split(/\r?\n/).forEach((line, index) => {
        if (!line.trim()) return;
        const parts = line.split(/\t|\s*(?:=>|→)\s*/);
        if (parts.length !== 2 || !parts[0].trim() || !parts[1].trim()) throw new Error('Рядок ' + (index + 1) + ': потрібні дві назви через Tab або →.');
        rules.push({ from: parts[0].trim(), to: parts[1].trim() });
    });
    if (!rules.length) throw new Error('Вставте хоча б одну пару назв.');
    return rules;
}

// Explicit field allowlist. Free text, person names, IDs, operational state and
// recovery/audit snapshots are deliberately excluded.
const medPeople = [['units', '*.unit'], ['ranks', '*.rank']];
const medRecords = [...medPeople, ['units', '*.personnelSnapshot.unit'], ['ranks', '*.personnelSnapshot.rank'], ['causes', '*.cause'], ['docPlaces', '*.docLoc'], ['actualPlaces', '*.actualLoc']];
const medSettings = [['units', 'units.*'], ['ranks', 'ranks.*'], ['causes', 'causes.*']];
const eventRecords = [['docPlaces', '*.actionDetails.docLoc'], ['actualPlaces', '*.actionDetails.factLoc'], ['docPlaces', '*.assaultDetails.docLoc'], ['actualPlaces', '*.assaultDetails.factLoc'], ['weapons', '*.enemyLosses.*.weapon'], ['units', '*.enemyLosses.*.inflicter', true]];
const documentFields = [['docPlaces', 'positions.*.name'], ['docPlaces', 'positions.*.newName'], ['docPlaces', 'positions.*.destinationName'], ['docPlaces', 'ovt.*.position']];
const definitions = [
    ['localforage', 'med_soldiers_v3', 'Медичні анкети', medPeople],
    ['localforage', 'med_episodes_v3', 'Медичні записи', medRecords],
    ['localforage', 'med_settings_v3', 'Медичні довідники', medSettings],
    ['localforage', 'enemy_events_v2', 'Журнал подій', eventRecords],
    ['localforage', 'enemy_events_v1', 'Старий журнал подій', eventRecords],
    ['localforage', 'enemy_settings_v1', 'Довідники подій', [['weapons', 'weapons.*'], ['docPlaces', 'positions.*']]],
    ['localforage', 'document_journal_v1', 'Документальний журнал', documentFields],
    ['localstorage', 'tactical_personnel', 'Анкети журналу О/С', medPeople],
    ...['v2', 'v3'].flatMap(version => [
        ['localstorage', 'med_soldiers_' + version, 'Старі медичні анкети', medPeople],
        ['localstorage', 'med_episodes_' + version, 'Старі медичні записи', medRecords],
        ['localstorage', 'med_settings_' + version, 'Старі медичні довідники', medSettings],
    ]),
];

function visit(root, parts, callback, path = [], parent = null, field = null) {
    if (!parts.length) {
        if (root == null || root === '') return;
        if (typeof root !== 'string') throw new Error('Очікувався текст у полі ' + path.join('.'));
        callback({ value: root, parent, field, path });
        return;
    }
    if (root == null) return;
    const [head, ...tail] = parts;
    if (head === '*') {
        if (!Array.isArray(root)) throw new Error('Очікувався список у полі ' + path.join('.'));
        root.forEach((value, index) => visit(value, tail, callback, [...path, index], root, index));
    } else {
        if (typeof root !== 'object' || Array.isArray(root)) throw new Error('Очікувався об’єкт у полі ' + path.join('.'));
        if (Object.hasOwn(root, head)) visit(root[head], tail, callback, [...path, head], root, head);
    }
}

function eachSource(snapshot, callback) {
    for (const [storage, key, module, fields] of definitions) {
        if (!Object.hasOwn(snapshot[storage], key)) continue;
        let value = snapshot[storage][key];
        if (storage === 'localstorage') {
            try { value = JSON.parse(value); } catch { throw new Error('Не вдалося прочитати ' + key + '. Дані не змінено.'); }
        }
        callback({ storage, key, module, fields, value });
    }
}

export function inventoryLabels(snapshot, config, includeMixed = false) {
    const catalog = Object.fromEntries(DICTIONARY_KINDS.map(([kind]) => [kind, new Map()]));
    eachSource(snapshot, source => {
        for (const [kind, field, mixed] of source.fields) {
            if (mixed && !includeMixed) continue;
            visit(source.value, field.split('.'), ({ value }) => {
                const label = clean(value);
                if (!label) return;
                const item = catalog[kind].get(label) || { value: label, count: 0, modules: [], canonical: canonicalLabel(config, kind, label) || '' };
                item.count++;
                if (!item.modules.includes(source.module)) item.modules.push(source.module);
                catalog[kind].set(label, item);
            });
        }
    });
    return Object.fromEntries(Object.entries(catalog).map(([kind, map]) => [kind, [...map.values()].sort((a, b) => b.count - a.count || a.value.localeCompare(b.value, 'uk'))]));
}

export function snapshotSignature(snapshot) {
    // The transaction restores a whole snapshot: guard unrelated edits as well.
    return JSON.stringify(['localforage', 'localstorage'].map(storage => Object.keys(snapshot[storage]).sort().map(key => [key, snapshot[storage][key]])));
}

export function planLabelReplacement(snapshot, config, kinds, includeMixed = false) {
    validateDictionaries(config);
    if (!Array.isArray(kinds) || kinds.some(kind => !DICTIONARY_KINDS.some(([key]) => key === kind))) throw new Error('Невідомий розділ довідника.');
    const next = structuredClone(snapshot), changes = [];
    eachSource(next, source => {
        const touched = new Set();
        for (const [kind, field, mixed] of source.fields) {
            if (!kinds.includes(kind) || (mixed && !includeMixed)) continue;
            visit(source.value, field.split('.'), slot => {
                const target = canonicalLabel(config, kind, slot.value);
                if (target && target !== slot.value) {
                    changes.push({ kind, module: source.module, storage: source.storage, key: source.key, path: slot.path.join('.'), before: slot.value, after: target });
                    slot.parent[slot.field] = target;
                    touched.add(slot.path[0]);
                }
            });
        }
        // Deduplicate option lists only, never medical/personnel/event records.
        if (source.key.includes('settings')) {
            for (const field of touched) if (Array.isArray(source.value?.[field])) source.value[field] = unique(source.value[field]);
        }
        if (touched.size) next[source.storage][source.key] = source.storage === 'localstorage' ? JSON.stringify(source.value) : source.value;
    });
    const saved = structuredClone(config);
    saved.history = [...saved.history, { at: new Date().toISOString(), kinds, changedFields: changes.length, modules: unique(changes.map(change => change.module)), rules: Object.fromEntries(kinds.map(kind => [kind, structuredClone(saved.dictionaries[kind])])) }];
    next.localforage[DICTIONARY_KEY] = saved;
    return { next, changes, signature: snapshotSignature(snapshot) };
}
