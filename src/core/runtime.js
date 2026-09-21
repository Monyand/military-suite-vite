import { localforage } from './vendor.js';

// Normal application writes pass through this barrier. Unified restore
        // alone uses the underlying storage while all modules are suspended.
        window.SuiteRuntime = (() => {
            let restoring = false;
            const pending = new Set();
            const assertWritable = () => {
                if (restoring) throw new Error('Записи заблоковано на час відновлення. Перезавантажте програму.');
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
                get restoring() { return restoring; },
                freeze() { restoring = true; },
                async drain() { while (pending.size) await Promise.allSettled([...pending]); },
                runAsync,
                setItem: (key, value) => runAsync(() => localforage.setItem(key, value)),
                removeItem: key => runAsync(() => localforage.removeItem(key)),
                setLocalItem(key, value) { assertWritable(); return localStorage.setItem(key, value); },
                removeLocalItem(key) { assertWritable(); return localStorage.removeItem(key); }
            };
        })();
        window.SuiteDates = {
            localISO(date = new Date()) {
                return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
            },
            recent(days, now = new Date()) {
                const from = new Date(now);
                from.setDate(from.getDate() - days);
                return { from: this.localISO(from), to: this.localISO(now) };
            }
        };
