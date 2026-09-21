

const MedicalPersonnelDirectory = (() => {
            const clean = value => typeof value === 'string' ? value.trim() : '';
            const norm = value => clean(value).normalize('NFKC').toLocaleLowerCase('uk-UA').replace(/[’ʼ`]/g, "'").replace(/\s+/g, ' ');
            const read = () => {
                try {
                    const rows = JSON.parse(localStorage.getItem('tactical_personnel') || '[]');
                    if (!Array.isArray(rows)) throw new Error('Невірний формат довідника О/С.');
                    const ids = new Map();
                    const validId = row => row && ((typeof row.id === 'string' && row.id.trim()) || (typeof row.id === 'number' && Number.isFinite(row.id)));
                    rows.forEach(row => { if (validId(row)) ids.set(String(row.id), (ids.get(String(row.id)) || 0) + 1); });
                    const entries = rows.filter(row => validId(row) && ids.get(String(row.id)) === 1 && (clean(row.fullName) || clean(row.callsign)))
                        .map(row => ({ id: 'roster:' + row.id, rosterId: String(row.id), source: 'roster', name: clean(row.fullName), callsign: clean(row.callsign), rank: clean(row.rank), unit: clean(row.unit) }));
                    return { entries, warning: entries.length < rows.length ? 'У довіднику О/С є порожні записи або повторні ID; їх пропущено.' : '' };
                } catch { return { entries: [], warning: 'Не вдалося прочитати довідник О/С. Медична база доступна; перевірте журнал О/С.' }; }
            };
            const search = (query, medical, roster) => {
                const q = norm(query);
                if (q.length < 2) return [];
                const tokens = q.split(' ');
                return [...roster, ...medical.map(person => ({ ...person, source: 'medical' }))]
                    .filter(person => tokens.every(token => norm(person.name).includes(token)) || norm(person.callsign).includes(q))
                    .slice(0, 50);
            };
            const resolve = (roster, medical) => {
                const linked = medical.filter(person => person.sourceRosterId != null && String(person.sourceRosterId) === roster.rosterId);
                if (linked.length === 1) return { match: linked[0], candidates: [] };
                if (linked.length > 1) return { match: null, candidates: linked };
                const sameName = medical.filter(person => norm(roster.name) && norm(person.name) === norm(roster.name) && person.sourceRosterId == null);
                const exact = sameName.filter(person => norm(roster.callsign) && norm(person.callsign) === norm(roster.callsign));
                if (exact.length === 1) return { match: exact[0], candidates: [] };
                return { match: null, candidates: sameName };
            };
            const forEpisode = (episode, person) => episode?.personnelSnapshot ? { ...(person || {}), ...episode.personnelSnapshot } : person;
            return { read, search, resolve, forEpisode, norm };
        })();

export { MedicalPersonnelDirectory };
