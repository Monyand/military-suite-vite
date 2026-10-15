import { localforage } from './vendor.js';
import { localMedicalInput } from './medical-records.js';

const MedicalDailyTotals = (() => {
            const fields = new Map([
                ['загибель (200)', 'count200'],
                ['200 (від ран)', 'count200'],
                ['поранення (300)', 'count300'],
                ['бойове травмування (300)', 'count300'],
                ['бойове травмування', 'count300'],
                ['зниклий безвісти (збв)', 'countZBV']
            ]);
            // Same local episode date as the medical UI; never use evacuation date.
            const dateKey = value => localMedicalInput(value).slice(0, 10);
            const aggregate = episodes => {
                if (!Array.isArray(episodes)) throw new Error('Медична база має некоректний формат списку епізодів.');
                const daily = {}, seen = new Set();
                let included = 0, excluded = 0, invalid = 0, duplicates = 0;
                for (const episode of episodes) {
                    if (!episode || typeof episode !== 'object' || Array.isArray(episode)) { invalid++; continue; }
                    if (episode.id != null && String(episode.id)) {
                        const id = String(episode.id);
                        if (seen.has(id)) { duplicates++; continue; }
                        seen.add(id);
                    }
                    const type = String(episode.lossType || '').trim().toLocaleLowerCase('uk-UA').replace(/\s+/g, ' ');
                    const field = fields.get(type);
                    if (!field) { excluded++; continue; }
                    const date = dateKey(episode.date);
                    if (!date) { invalid++; continue; }
                    if (!daily[date]) daily[date] = { count200: 0, count300: 0, countZBV: 0, source: 'medical' };
                    daily[date][field]++;
                    included++;
                }
                return { daily, included, excluded, invalid, duplicates };
            };
            const read = async () => {
                let episodes = await localforage.getItem('med_episodes_v3');
                if (episodes == null) {
                    const legacy = localStorage.getItem('med_episodes_v3') ?? localStorage.getItem('med_episodes_v2');
                    episodes = legacy == null ? [] : JSON.parse(legacy);
                }
                return aggregate(episodes);
            };
            const classify = lossType => {
                const type = String(lossType || '').trim().toLocaleLowerCase('uk-UA').replace(/\s+/g, ' ');
                if (fields.has(type)) return 'included';
                return ['небойова смерть (200)', 'небойове травмування (300)', 'сзч', 'дезертирство'].includes(type) ? 'excluded' : 'unknown';
            };
            return { aggregate, read, dateKey, classify };
        })();

export { MedicalDailyTotals };
