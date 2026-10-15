// Calendar fields have no timezone; ISO timestamps do. Never rewrite stored dates.
export function parseMedicalDate(value) {
    if (value == null || value === '') return 0;
    if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : 0;
    if (typeof value === 'number' || /^\d{4,5}(\.\d+)?$/.test(String(value).trim())) {
        const number = Number(value);
        if (!Number.isFinite(number)) return 0;
        if (number >= 1 && number < 100000) {
            // Excel serials are wall-clock values, not UTC instants.
            const date = new Date(Math.round((number - 25569) * 86400000));
            return new Date(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), date.getUTCHours(), date.getUTCMinutes(), date.getUTCSeconds(), date.getUTCMilliseconds()).getTime();
        }
        return typeof value === 'number' ? number : 0;
    }
    const text = String(value).trim().replace(/^[0-9]*(20\d{2}[-./]\d{2}[-./]\d{2})/, '$1');
    const uk = text.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?)?$/);
    const iso = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:?\d{2})?)?$/i);
    const match = uk || iso;
    if (!match) return 0;
    const [year, month, day] = uk ? [+match[3], +match[2], +match[1]] : [+match[1], +match[2], +match[3]];
    const hour = +(match[4] || 0), minute = +(match[5] || 0), second = +(match[6] || 0), ms = +(match[7] || '').padEnd(3, '0');
    const check = new Date(Date.UTC(year, month - 1, day));
    if (year < 1900 || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day || hour > 23 || minute > 59 || second > 59) return 0;
    if (iso?.[8]) { const time = Date.parse(text.replace(' ', 'T')); return Number.isFinite(time) ? time : 0; }
    const date = new Date(year, month - 1, day, hour, minute, second, ms);
    return date.getHours() === hour && date.getMinutes() === minute ? date.getTime() : 0;
}

export const isMedicalDeath = type => typeof type === 'string' && (type.includes('(200)') || type === '200 (від ран)');
export function pickMedicalEpisode(existing, candidate) {
    if (!existing) return candidate;
    if (isMedicalDeath(existing.lossType) !== isMedicalDeath(candidate.lossType)) return isMedicalDeath(candidate.lossType) ? candidate : existing;
    return parseMedicalDate(candidate.date) > parseMedicalDate(existing.date) ? candidate : existing;
}
export function chronologyIssues(episodes) {
    const deaths = new Map(), issues = [];
    episodes.forEach(ep => {
        const time = parseMedicalDate(ep.date);
        if (!time) issues.push({ type: 'date', episode: ep, message: 'Некоректна дата події' });
        if (time && isMedicalDeath(ep.lossType) && (!deaths.has(ep.soldierId) || time < parseMedicalDate(deaths.get(ep.soldierId).date))) deaths.set(ep.soldierId, ep);
    });
    episodes.forEach(ep => {
        const death = deaths.get(ep.soldierId);
        if (death && !isMedicalDeath(ep.lossType) && parseMedicalDate(ep.date) > parseMedicalDate(death.date)) issues.push({ type: 'after-death', episode: ep, death, message: 'Дата події пізніша за дату загибелі' });
    });
    return issues;
}
export function localMedicalInput(value) {
    const time = parseMedicalDate(value);
    if (!time) return '';
    const date = new Date(time), pad = n => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
export function medicalWaitTime(value, now = Date.now()) {
    const time = parseMedicalDate(value);
    if (!time) return 'Невідомо';
    if (now < time) return 'Щойно';
    const minutes = Math.floor((now - time) / 60000), hours = Math.floor(minutes / 60);
    return hours >= 24 ? `${Math.floor(hours / 24)}д ${hours % 24}г` : hours ? `${hours}г ${minutes % 60}хв` : `${minutes} хв`;
}

export const INJURY_LABELS = {
    amputation: 'Ампутація', amp_hand: 'Ампутація кисті', amp_foot: 'Ампутація стопи', amp_fingers: 'Ампутація пальців',
    rupture: 'Розрив', shrapnel: 'Уламкове', bullet: 'Кульове', fracture: 'Перелом', burn: 'Опік', akbt: 'АКБТ', contusion: 'Забій',
    laceration: 'Рвана рана', crush: 'Краш-синдром', tbi: 'ЧМТ', eye: 'Травма ока', barotrauma: 'Баротравма', pneumothorax: 'Пневмоторакс', hemothorax: 'Гемоторакс'
};
export const INJURY_GROUPS = Object.fromEntries(Object.entries(INJURY_LABELS).map(([key, label]) => [key, key.startsWith('amp_') ? 'Ампутація' : label]));
export const injuryGroups = injuries => [...new Set(Object.values(injuries || {}).flatMap(region => Object.keys(region || {}).filter(key => region[key]).map(key => INJURY_GROUPS[key] || key)))];
export const describeInjuries = (injuries, regions) => Object.entries(injuries || {}).map(([id, region]) => {
    const text = Object.keys(region || {}).filter(key => region[key]).map(key => INJURY_LABELS[key] || key).join(', ');
    return text ? `${regions.find(item => item.id === id)?.name || id}: ${text}` : '';
}).filter(Boolean).join(' | ');
