import { localforage } from './vendor.js';
import { SuiteBackup } from './backup.js';
import { DICTIONARY_KEY, emptyDictionaries, validateDictionaries, canonicalLabel, inventoryLabels, planLabelReplacement, snapshotSignature, withLearnedOvtTemplates, prepareOvtDictionaries } from './shared-dictionaries.js';
import { positionChangeError, withPositionAudit, documentaryNameCatalog } from '../modules/documents/position-register.js';

let cached = emptyDictionaries();
let documentNames = [];
let useDocumentRegister = false;
let documentRefresh = 0;
let loadError = '';
const publish = () => window.dispatchEvent(new Event('suite-dictionaries-changed'));

async function refreshDocumentNames() {
    const revision = ++documentRefresh;
    const journal = await localforage.getItem('document_journal_v1');
    if (revision !== documentRefresh) return;
    // Latest unclosed names according to recorded documents only. No physical
    // location, assignment, or native personnel position state is synchronized.
    const rows = journal?.positions || [];
    useDocumentRegister = rows.length > 0;
    documentNames = documentaryNameCatalog(rows).names;
    publish();
}

export const SharedDictionaries = {
    async initialize() {
        try {
            const [saved, journal] = await Promise.all([localforage.getItem(DICTIONARY_KEY), localforage.getItem('document_journal_v1')]);
            cached = prepareOvtDictionaries(saved, journal);
            loadError = '';
        } catch (error) { loadError = 'Довідники не завантажено: ' + error.message + ' Вихідні дані не перезаписано.'; }
        try { await refreshDocumentNames(); } catch { documentNames = []; }
        window.addEventListener('suite-document-labels-changed', () => { refreshDocumentNames().catch(() => {}); });
    },
    read() { if (loadError) throw new Error(loadError); return structuredClone(cached); },
    ovtTemplates() { return structuredClone(cached.ovtTemplates ?? emptyDictionaries().ovtTemplates); },
    options(kind, base = [], current = '') {
        if (kind === 'docPlaces' && useDocumentRegister) return [...new Set([...documentNames, current].filter(Boolean))].sort((a, b) => a.localeCompare(b, 'uk'));
        const names = [...cached.dictionaries[kind].canonical, ...(kind === 'docPlaces' ? documentNames : []), ...base];
        const options = names.filter(value => typeof value === 'string' && value.trim()).map(value => canonicalLabel(cached, kind, value) || value.trim());
        // Never blank a legacy select or silently replace an already-open form.
        return [...new Set([...options, current].filter(Boolean))].sort((a, b) => a.localeCompare(b, 'uk'));
    },
    async save(config) {
        if (loadError) throw new Error(loadError);
        const saved = structuredClone(prepareOvtDictionaries(validateDictionaries(config)));
        await window.SuiteRuntime.setItem(DICTIONARY_KEY, saved);
        cached = saved; publish();
    },
    async learnOvt(row) {
        if (loadError) throw new Error(loadError);
        await window.SuiteRuntime.drain();
        const [latest, journal] = await Promise.all([localforage.getItem(DICTIONARY_KEY), localforage.getItem('document_journal_v1')]);
        cached = prepareOvtDictionaries(latest, journal);
        const next = withLearnedOvtTemplates(this.read(), row);
        if (JSON.stringify(next) !== JSON.stringify(latest)) await this.save(next);
    },
    async inspect(config, includeMixed = false) {
        await window.SuiteRuntime.drain();
        const snapshot = await SuiteBackup.collect();
        return { snapshot, inventory: inventoryLabels(snapshot, config, includeMixed) };
    },
    async preview(config, kinds, includeMixed = false) {
        const { snapshot } = await this.inspect(config, includeMixed);
        const plan = planLabelReplacement(snapshot, config, kinds, includeMixed);
        const before = snapshot.localforage.document_journal_v1;
        const after = plan.next.localforage.document_journal_v1;
        if (before && after) {
            for (let i = 0; i < before.positions.length; i++) {
                if (JSON.stringify(before.positions[i]) === JSON.stringify(after.positions[i])) continue;
                const error = positionChangeError(before.positions, after.positions, after.positions[i].id);
                if (error) throw new Error('Не можна застосувати виправлення документальних назв: ' + error);
            }
            plan.next.localforage.document_journal_v1 = withPositionAudit(before, after);
        }
        return plan;
    },
    async apply(plan, password, suspend) {
        if (password.length < 12) throw new Error('Пароль має містити щонайменше 12 символів.');
        if (!plan?.changes?.length) throw new Error('Немає змін для застосування.');
        window.SuiteRuntime.freeze();
        suspend();
        await window.SuiteRuntime.drain();
        if (snapshotSignature(await SuiteBackup.collect()) !== plan.signature) throw new Error('Після перегляду дані змінилися. Нічого не замінено. Перезавантажте програму й сформуйте новий перегляд.');
        // restore creates an encrypted pre-change recovery copy before any write,
        // and rolls the whole snapshot back if a storage write fails.
        return SuiteBackup.restore(plan.next, password);
    },
};
