import { localforage } from './vendor.js';
import { withoutLocalPbd, prepareJournalRestore, validateBackupRecords, backupSummary } from './backup-data.js';

const SuiteBackup = (() => {
            const RECOVERY_KEY = 'military_suite_recovery_v1';
            const ITERATIONS = 600000;
            const MAX_BYTES = 100 * 1024 * 1024;
            const ownsLF = key => /^(enemy_|med_|medtactical_|document_)/.test(key);
            const ownsLS = key => /^(tactical_|enemy_|med_|medtactical_|document_)/.test(key);
            const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
            const fail = message => { throw new Error(message); };
            const checkJSON = (value, depth = 0) => {
                if (depth > 80) fail('Файл містить надто вкладені дані.');
                if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
                if (typeof value === 'number' && Number.isFinite(value)) return;
                if (Array.isArray(value)) { value.forEach(item => checkJSON(item, depth + 1)); return; }
                if (!isObject(value) || Object.getPrototypeOf(value) !== Object.prototype) fail('Непідтримуваний тип даних у копії.');
                for (const [key, item] of Object.entries(value)) {
                    if (['__proto__', 'prototype', 'constructor'].includes(key)) fail('Небезпечний ключ у файлі.');
                    checkJSON(item, depth + 1);
                }
            };
            const validate = data => {
                checkJSON(data);
                if (data.format !== 'military-suite-unified' || data.version !== 1 ||
                    !isObject(data.localforage) || !isObject(data.localstorage)) fail('Це не єдина резервна копія Military Suite.');
                for (const [key, value] of Object.entries(data.localforage)) {
                    if (!ownsLF(key)) fail('Невідомий ключ сховища: ' + key);
                    if (/^(enemy_events_v[12]|med_(soldiers|episodes|logs)_v[23])$/.test(key) && !Array.isArray(value)) fail('Некоректний список: ' + key);
                    if (/^(enemy_settings_v1|enemy_daily_losses_v1|med_settings_v[23])$/.test(key) && !isObject(value)) fail('Некоректні налаштування: ' + key);
                    if (key === 'document_journal_v1' && (!isObject(value) || value.version !== 1 || !isObject(value.settings) || !['tasks', 'ovt', 'positions'].every(tab => Array.isArray(value[tab])))) fail('Некоректний документальний журнал.');
                }
                for (const [key, value] of Object.entries(data.localstorage)) {
                    if (!ownsLS(key) || typeof value !== 'string') fail('Некоректний параметр сховища: ' + key);
                    if (/^tactical_(personnel|positions|logs|journal|rotations|groups_order|backup_schedule)$/.test(key)) {
                        let parsed;
                        try { parsed = JSON.parse(value); } catch { fail('Некоректний JSON: ' + key); }
                        if (!Array.isArray(parsed)) fail('Некоректний список: ' + key);
                        checkJSON(parsed);
                    }
                    if (/^tactical_(collapsed_groups|collapsed_positions)$/.test(key)) {
                        let parsed;
                        try { parsed = JSON.parse(value); } catch { fail('Некоректний JSON: ' + key); }
                        if (!isObject(parsed)) fail('Некоректні налаштування: ' + key);
                        checkJSON(parsed);
                    }
                }
                validateBackupRecords(data);
                return data;
            };
            const collect = async ({ localState = false, unchecked = false, includePbd = false } = {}) => {
                const data = { format: 'military-suite-unified', version: 1, timestamp: new Date().toISOString(), localforage: {}, localstorage: {} };
                for (const key of await localforage.keys()) {
                    if (ownsLF(key)) {
                        let val = await localforage.getItem(key);
                        if (!localState && !includePbd) val = withoutLocalPbd(val);
                        data.localforage[key] = val;
                    }
                }
                for (let i = 0; i < localStorage.length; i++) {
                    const key = localStorage.key(i);
                    if (ownsLS(key)) data.localstorage[key] = localStorage.getItem(key);
                }
                if (localState) data.localOnly = true;
                data.pbdIncluded = localState || includePbd;
                return unchecked ? data : validate(data);
            };
            const toBase64 = buffer => {
                const bytes = new Uint8Array(buffer);
                let text = '';
                for (let i = 0; i < bytes.length; i += 8192) text += String.fromCharCode(...bytes.subarray(i, i + 8192));
                return btoa(text);
            };
            const fromBase64 = text => {
                if (typeof text !== 'string' || text.length > MAX_BYTES * 1.4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(text)) fail('Некоректні зашифровані дані.');
                try { return Uint8Array.from(atob(text), char => char.charCodeAt(0)); }
                catch { fail('Некоректне кодування файлу.'); }
            };
            const deriveKey = async (password, salt) => {
                if (!window.crypto?.subtle) fail('Шифрування недоступне. Відкрийте локальний HTML-файл у сучасному браузері або використайте HTTPS.');
                if (typeof password !== 'string' || !password) fail('Введіть пароль.');
                const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
                return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: ITERATIONS }, material,
                    { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
            };
            const encrypt = async (data, password) => {
                validate(data);
                const salt = crypto.getRandomValues(new Uint8Array(16));
                const iv = crypto.getRandomValues(new Uint8Array(12));
                const key = await deriveKey(password, salt);
                const raw = new TextEncoder().encode(JSON.stringify(data));
                if (raw.byteLength > MAX_BYTES / 1.4) fail('Копія перевищує ліміт 100 МБ.');
                const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, tagLength: 128 }, key, raw);
                return { format: 'military-suite-encrypted', version: 2, cipher: 'AES-256-GCM',
                    kdf: 'PBKDF2-SHA-256', iterations: ITERATIONS, salt: toBase64(salt), iv: toBase64(iv), ciphertext: toBase64(ciphertext) };
            };
            const decrypt = async (envelope, password) => {
                if (!isObject(envelope) || envelope.format !== 'military-suite-encrypted' || envelope.version !== 2 ||
                    envelope.cipher !== 'AES-256-GCM' || envelope.kdf !== 'PBKDF2-SHA-256' || envelope.iterations !== ITERATIONS) fail('Непідтримуваний формат шифрування.');
                const salt = fromBase64(envelope.salt), iv = fromBase64(envelope.iv), ciphertext = fromBase64(envelope.ciphertext);
                if (salt.length !== 16 || iv.length !== 12 || ciphertext.length < 16) fail('Пошкоджена зашифрована копія.');
                const key = await deriveKey(password, salt);
                let plain;
                try { plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv, tagLength: 128 }, key, ciphertext); }
                catch { fail('Неправильний пароль або файл пошкоджено. Дані не змінено.'); }
                return validate(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(plain)));
            };
            const readFile = async file => {
                if (!file || file.size > MAX_BYTES) fail('Оберіть файл резервної копії розміром до 100 МБ.');
                let data;
                try { data = JSON.parse(await file.text()); } catch { fail('Не вдалося прочитати JSON резервної копії.'); }
                checkJSON(data);
                if (data.format === 'military-suite-unified') validate(data);
                else if (data.format !== 'military-suite-encrypted') fail('Оберіть єдину копію .mils або .mils.enc, а не копію окремого модуля.');
                return data;
            };
            const download = (envelope, prefix = 'military_suite_backup') => {
                const url = URL.createObjectURL(new Blob([JSON.stringify(envelope)], { type: 'application/octet-stream' }));
                const anchor = document.createElement('a');
                anchor.href = url;
                anchor.download = prefix + '_' + window.SuiteDates.fileTimestamp() + '.mils.enc';
                document.body.appendChild(anchor);
                anchor.click();
                anchor.remove();
                setTimeout(() => URL.revokeObjectURL(url), 30000);
            };
            const applySnapshot = async data => {
                for (const key of await localforage.keys()) {
                    if (ownsLF(key) && !Object.hasOwn(data.localforage, key)) await localforage.removeItem(key);
                }
                for (const [key, value] of Object.entries(data.localforage)) await localforage.setItem(key, value);
                for (const key of Object.keys(localStorage)) {
                    if (ownsLS(key) && !Object.hasOwn(data.localstorage, key)) localStorage.removeItem(key);
                }
                for (const [key, value] of Object.entries(data.localstorage)) localStorage.setItem(key, value);
            };
            const restore = async (data, password, { localRecovery = false, importPbd = false } = {}) => {
                validate(data); // Validate fully before touching persistent data.
                if (window.SuiteRuntime) {
                    window.SuiteRuntime.freeze();
                    await window.SuiteRuntime.drain();
                }
                const before = await collect({ localState: true });
                const prepared = structuredClone(data);
                if (prepared.localforage.document_journal_v1) {
                    prepared.localforage.document_journal_v1 = prepareJournalRestore(
                        prepared.localforage.document_journal_v1, before.localforage.document_journal_v1,
                        localRecovery && data.localOnly === true, importPbd);
                }
                validate(prepared);
                const recovery = await encrypt(before, password);
                await localforage.setItem(RECOVERY_KEY, recovery);
                try { await applySnapshot(prepared); }
                catch {
                    try { await applySnapshot(before); }
                    catch { fail('Збій сховища. Автоматичне повернення не завершено. Не редагуйте записи: використайте «Попередній стан» із тим самим паролем.'); }
                    fail('Не вдалося записати копію. Попередні дані повернуто.');
                }
                return recovery;
            };
            return { collect, encrypt, decrypt, validate, readFile, download, restore, backupSummary,
                getRecovery: () => localforage.getItem(RECOVERY_KEY) };
        })();

        // --- ROOT APP & UNIFIED NAV ---

export { SuiteBackup };
