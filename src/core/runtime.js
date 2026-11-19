import { localforage } from './vendor.js';

// Normal application writes pass through this barrier. Unified restore
        // alone uses the underlying storage while all modules are suspended.
        window.SuiteRuntime = (() => {
            const TAB_LOCK_KEY = 'suite_active_tab_v1';
            const RESTORE_SIGNAL_KEY = 'suite_backup_restored_v1';
            const CHANNEL_NAME = 'military_suite_tab_sync_v1';
            const tabId = (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
                ? crypto.randomUUID()
                : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
            let restoring = false;
            let staleReason = '';
            let dirtySinceBackup = false;
            let hasUserActivity = false;
            const pending = new Set();
            const listeners = new Set();
            let channel = null;
            const isDataKey = key => /^(enemy_events|enemy_personnel|enemy_daily_losses|med_soldiers|med_episodes|document_journal|tactical_(personnel|positions|journal|rotations))/.test(String(key || ''));
            const markDirtyIfUser = key => {
                if (hasUserActivity && isDataKey(key)) dirtySinceBackup = true;
            };

            const readLockOwner = () => {
                try {
                    const raw = localStorage.getItem(TAB_LOCK_KEY);
                    if (!raw) return null;
                    const parsed = JSON.parse(raw);
                    return parsed && typeof parsed.tabId === 'string' ? parsed.tabId : null;
                } catch {
                    return null;
                }
            };
            const claimLock = () => {
                try {
                    localStorage.setItem(TAB_LOCK_KEY, JSON.stringify({ tabId, ts: Date.now() }));
                } catch { /* ignore private mode / quota */ }
                try { channel?.postMessage({ type: 'tab-opened', tabId, ts: Date.now() }); } catch { }
            };
            const markStale = (reason = 'other-tab') => {
                if (restoring) return;
                if (staleReason === 'restored') return;
                const next = reason === 'restored' ? 'restored' : 'other-tab';
                if (staleReason === next) return;
                staleReason = next;
                for (const fn of listeners) {
                    try { fn(staleReason); } catch { }
                }
                try {
                    window.dispatchEvent(new CustomEvent('suite-tab-conflict', { detail: { reason: staleReason } }));
                } catch { }
            };
            const checkLock = () => {
                if (restoring || staleReason) return Boolean(staleReason);
                const owner = readLockOwner();
                if (owner && owner !== tabId) {
                    markStale('other-tab');
                    return true;
                }
                return false;
            };

            try {
                if (typeof BroadcastChannel === 'function') {
                    channel = new BroadcastChannel(CHANNEL_NAME);
                    channel.onmessage = event => {
                        const msg = event?.data;
                        if (!msg || msg.tabId === tabId) return;
                        if (msg.type === 'backup-restored') markStale('restored');
                        else if (msg.type === 'tab-opened') markStale('other-tab');
                    };
                }
            } catch { channel = null; }

            if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
                window.addEventListener('storage', event => {
                    if (event.key === RESTORE_SIGNAL_KEY && event.newValue) {
                        try {
                            const data = JSON.parse(event.newValue);
                            if (data?.tabId && data.tabId !== tabId) markStale('restored');
                        } catch { markStale('restored'); }
                    } else if (event.key === TAB_LOCK_KEY && event.newValue) {
                        try {
                            const data = JSON.parse(event.newValue);
                            if (data?.tabId && data.tabId !== tabId) markStale('other-tab');
                        } catch { }
                    }
                });
                window.addEventListener('focus', checkLock);
                const markUserActivity = () => { hasUserActivity = true; };
                window.addEventListener('pointerdown', markUserActivity, { once: true, capture: true });
                window.addEventListener('keydown', markUserActivity, { once: true, capture: true });
                window.addEventListener('input', markUserActivity, { once: true, capture: true });
                window.addEventListener('change', markUserActivity, { once: true, capture: true });
                if (typeof document !== 'undefined') {
                    document.addEventListener('visibilitychange', () => {
                        if (document.visibilityState === 'visible') checkLock();
                    });
                }
            }

            claimLock();

            const assertWritable = () => {
                if (restoring) throw new Error('Записи заблоковано на час відновлення. Перезавантажте програму.');
                if (checkLock()) {
                    throw new Error(staleReason === 'restored'
                        ? 'В іншій вкладці відновлено бекап. Запис заблоковано — перезавантажте сторінку.'
                        : 'Відкрито іншу вкладку програми. Запис заблоковано — перезавантажте сторінку.');
                }
            };
            const runAsync = operation => {
                try { assertWritable(); } catch (error) { return Promise.reject(error); }
                let result;
                try { result = Promise.resolve(operation()); } catch (error) { result = Promise.reject(error); }
                pending.add(result);
                result.then(() => pending.delete(result), () => pending.delete(result));
                return result;
            };
            return {
                get tabId() { return tabId; },
                get restoring() { return restoring; },
                get stale() { return Boolean(staleReason); },
                get staleReason() { return staleReason; },
                get hasPending() { return pending.size > 0; },
                get dirtySinceBackup() { return dirtySinceBackup; },
                clearDirty() { dirtySinceBackup = false; },
                freeze() { restoring = true; },
                notifyRestored() {
                    try {
                        localStorage.setItem(RESTORE_SIGNAL_KEY, JSON.stringify({ tabId, ts: Date.now() }));
                    } catch { }
                    try { channel?.postMessage({ type: 'backup-restored', tabId, ts: Date.now() }); } catch { }
                },
                onConflict(fn) {
                    if (typeof fn !== 'function') return () => {};
                    listeners.add(fn);
                    if (staleReason) { try { fn(staleReason); } catch { } }
                    return () => listeners.delete(fn);
                },
                checkLock,
                async drain() { while (pending.size) await Promise.allSettled([...pending]); },
                runAsync,
                setItem: (key, value) => runAsync(() => { markDirtyIfUser(key); return localforage.setItem(key, value); }),
                removeItem: key => runAsync(() => { markDirtyIfUser(key); return localforage.removeItem(key); }),
                setLocalItem(key, value) { assertWritable(); markDirtyIfUser(key); return localStorage.setItem(key, value); },
                removeLocalItem(key) { assertWritable(); markDirtyIfUser(key); return localStorage.removeItem(key); }
            };
        })();
        window.SuiteDates = {
            localISO(date = new Date()) {
                if (isNaN(date.getTime())) return '';
                return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
            },
            fileTimestamp(date = new Date()) {
                const day = this.localISO(date);
                if (!day) return '';
                const time = [date.getHours(), date.getMinutes(), date.getSeconds()].map(value => String(value).padStart(2, '0')).join('-');
                return `${day}_${time}-${String(date.getMilliseconds()).padStart(3, '0')}`;
            },
            localDateTime(value) {
                if (!value) return 'дата невідома';
                const date = new Date(value);
                return isNaN(date.getTime()) ? 'дата невідома' : date.toLocaleString('uk-UA');
            },
            recent(days, now = new Date()) {
                const from = new Date(now);
                from.setDate(from.getDate() - days);
                return { from: this.localISO(from), to: this.localISO(now) };
            }
        };
