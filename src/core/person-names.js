import { snapshotSignature } from './shared-dictionaries.js';

export const NAME_STANDARDS_KEY = 'document_name_standards_v1';
// Formatting only: never infer missing names or replace similar letters.
export function formatPersonName(value) {
    const words = String(value || '').trim().split(/\s+/);
    return words.map((word, index) => index === 0 ? word.toLocaleUpperCase('uk-UA') : word.toLocaleLowerCase('uk-UA')
        .replace(/(^|[-‐‑–.])(\p{L})/gu, (_, separator, letter) => separator + letter.toLocaleUpperCase('uk-UA'))).join(' ');
}
export function normalizePersonName(value) {
    const lookalikes = { a: 'а', b: 'в', c: 'с', e: 'е', h: 'н', i: 'і', k: 'к', m: 'м', o: 'о', p: 'р', t: 'т', x: 'х', y: 'у' };
    return String(value || '').normalize('NFKC').toLocaleLowerCase('uk-UA').replace(/[abcehikmoptxy]/g, char => lookalikes[char])
        .replace(/['`’‘ʼ"\u200B-\u200D\uFEFF]/g, '').replace(/\./g, ' ').replace(/\s+/g, ' ').trim();
}
function distance(a, b, limit) {
    if (Math.abs(a.length - b.length) > limit) return limit + 1;
    let row = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
        const next = [i];
        for (let j = 1; j <= b.length; j++) next[j] = Math.min(next[j - 1] + 1, row[j] + 1, row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        if (Math.min(...next) > limit) return limit + 1;
        row = next;
    }
    return row[b.length];
}
export function similarPersonNames(left, right) {
    const a = normalizePersonName(left), b = normalizePersonName(right);
    if (!a || !b) return false;
    if (a === b) return true;
    const aa = a.split(' '), bb = b.split(' ');
    if (aa.length >= 2 && bb.length >= 2 && aa[0] === bb[0] && aa[1] === bb[1] && (aa.length === 2 || bb.length === 2)) return true;
    if (a[0] !== b[0] || String(a.match(/\d+/g)) !== String(b.match(/\d+/g))) return false;
    return distance(a, b, Math.min(a.length, b.length) < 14 ? 1 : 2) <= (Math.min(a.length, b.length) < 14 ? 1 : 2);
}
export function personCandidates(input, medical, roster = []) {
    const name = normalizePersonName(input.name), call = normalizePersonName(input.callsign);
    return [...medical.map(person => ({ ...person, source: 'medical' })), ...roster].filter(person => {
        if (similarPersonNames(name, person.name)) return true;
        return call && normalizePersonName(person.callsign) === call && normalizePersonName(person.unit) === normalizePersonName(input.unit);
    }).sort((a, b) => Number(normalizePersonName(b.name) === name) - Number(normalizePersonName(a.name) === name));
}

// Only structured person-name fields. Never substring-replace comments, reports,
// audit messages, equipment names or recovery snapshots; never merge IDs.
const sources = [
    ['localstorage', 'tactical_personnel', 'Журнал О/С', ['fullName']],
    ...['localforage', 'localstorage'].flatMap(storage => ['v2', 'v3'].flatMap(version => [
        [storage, 'med_soldiers_' + version, 'Медичні анкети', ['name']],
        [storage, 'med_episodes_' + version, 'Медичні епізоди', ['soldierName', 'personnelSnapshot.name']]
    ])),
    ['localforage', 'enemy_personnel_v1', 'Реєстр подій', ['fullName', 'name']],
];
function visitNames(snapshot, visit) {
    for (const [storage, key, module, fields] of sources) {
        if (!Object.hasOwn(snapshot[storage] || {}, key)) continue;
        const rows = storage === 'localstorage' ? JSON.parse(snapshot[storage][key]) : structuredClone(snapshot[storage][key]);
        if (!Array.isArray(rows)) throw new Error('Невірний формат списку: ' + key);
        rows.forEach((row, index) => {
            for (const field of fields) {
                const parts = field.split('.'), leaf = parts.pop();
                const parent = parts.reduce((value, part) => value?.[part], row);
                if (typeof parent?.[leaf] !== 'string' || !parent[leaf].trim()) continue;
                visit({ storage, key, module, path: `${index}.${field}`, id: row.id, personId: row.soldierId || row.id, value: parent[leaf], unit: row.unit || row.personnelSnapshot?.unit || '', callsign: row.callsign || row.personnelSnapshot?.callsign || '', parent, field: leaf });
            }
        });
        snapshot[storage][key] = storage === 'localstorage' ? JSON.stringify(rows) : rows;
    }
}
export function inventoryPersonNames(snapshot) {
    const result = [];
    visitNames(structuredClone(snapshot), ({ parent, field, ...item }) => result.push(item));
    return result;
}
export function duplicateNameGroups(items) {
    const unique = new Map();
    items.forEach(item => { const key = normalizePersonName(item.value); if (!unique.has(key)) unique.set(key, []); unique.get(key).push(item); });
    const keys = [...unique.keys()], processed = new Set(), groups = [];
    for (const key of keys) {
        if (processed.has(key)) continue;
        const matches = keys.filter(other => !processed.has(other) && key[0] === other[0] && similarPersonNames(key, other));
        matches.forEach(other => processed.add(other));
        const entries = matches.flatMap(other => unique.get(other));
        if (entries.length > 1) groups.push({ key, entries });
    }
    return groups;
}
export function planPersonNames(snapshot, selections, target) {
    const standard = String(target || '').trim().replace(/\s+/g, ' ');
    if (standard.split(' ').length < 2 || standard.length > 300) throw new Error('Введіть повне стандартне ПІБ (щонайменше прізвище та ім’я).');
    if (!selections.length) throw new Error('Оберіть конкретні записи для виправлення.');
    const keys = new Set(selections), next = structuredClone(snapshot), changes = [];
    visitNames(next, slot => {
        if (!keys.has(`${slot.storage}/${slot.key}/${slot.path}`) || slot.value === standard) return;
        changes.push({ kind: 'names', module: slot.module, storage: slot.storage, key: slot.key, path: slot.path, before: slot.value, after: standard });
        slot.parent[slot.field] = standard;
    });
    return finishNamePlan(snapshot, next, changes, { target: standard });
}
export function planPersonNameFormatting(snapshot) {
    const next = structuredClone(snapshot), changes = [];
    visitNames(next, slot => {
        const standard = formatPersonName(slot.value);
        if (slot.value === standard) return;
        changes.push({ kind: 'names', module: slot.module, storage: slot.storage, key: slot.key, path: slot.path, before: slot.value, after: standard });
        slot.parent[slot.field] = standard;
    });
    return finishNamePlan(snapshot, next, changes, { mode: 'surname-uppercase' });
}
function finishNamePlan(snapshot, next, changes, details) {
    if (!changes.length) return { next, changes, signature: snapshotSignature(snapshot) };
    const saved = next.localforage[NAME_STANDARDS_KEY] || { version: 1, history: [] };
    if (saved.version !== 1 || !Array.isArray(saved.history)) throw new Error('Невідомий формат історії стандартизації ПІБ.');
    next.localforage[NAME_STANDARDS_KEY] = { ...saved, history: [...saved.history, { at: new Date().toISOString(), ...details, changes }] };
    return { next, changes, signature: snapshotSignature(snapshot) };
}
