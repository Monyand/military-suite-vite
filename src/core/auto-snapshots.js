import { localforage } from './vendor.js';
import { SuiteBackup } from './backup.js';

const SNAPSHOTS_KEY = 'suite_auto_snapshots_v1';
const MAX_SNAPSHOTS = 5;
const MIN_INTERVAL_MS = 30 * 60 * 1000; // 30 хвилин

const hashString = (str) => {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(16);
};

const computeMeta = (snapshot) => {
    const summary = SuiteBackup.backupSummary(snapshot, snapshot);
    const totalRecords = summary.reduce((sum, row) => sum + (row.current || 0), 0);
    const serialized = JSON.stringify({
        lf: snapshot.localforage,
        ls: snapshot.localstorage,
    });
    const fingerprint = `${totalRecords}:${serialized.length}:${hashString(serialized)}`;
    return { totalRecords, fingerprint };
};

const readList = async () => {
    try {
        const raw = await localforage.getItem(SNAPSHOTS_KEY);
        return Array.isArray(raw) ? raw : [];
    } catch {
        return [];
    }
};

export const AutoSnapshots = {
    KEY: SNAPSHOTS_KEY,
    MAX: MAX_SNAPSHOTS,
    list: readList,
    async capture({ force = false, reason = 'auto' } = {}) {
        if (window.SuiteRuntime?.stale || window.SuiteRuntime?.restoring) return null;
        try {
            if (window.SuiteRuntime?.drain) await window.SuiteRuntime.drain();
            const snapshot = await SuiteBackup.collect({ localState: true, unchecked: true });
            const { totalRecords, fingerprint } = computeMeta(snapshot);
            if (!force && totalRecords === 0) return null;

            const current = await readList();
            const latest = current[0];
            if (!force && latest) {
                if (latest.fingerprint === fingerprint) return null;
                const elapsed = Date.now() - Date.parse(latest.createdAt || '');
                if (Number.isFinite(elapsed) && elapsed < MIN_INTERVAL_MS) return null;
            }

            const entry = {
                id: `snap_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
                createdAt: new Date().toISOString(),
                reason,
                totalRecords,
                fingerprint,
                data: snapshot,
            };
            const next = [entry, ...current.filter(item => item.fingerprint !== fingerprint)].slice(0, MAX_SNAPSHOTS);
            await localforage.setItem(SNAPSHOTS_KEY, next);
            return entry;
        } catch {
            return null;
        }
    },
};
