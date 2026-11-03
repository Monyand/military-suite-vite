import { useState, useRef, useEffect } from 'react';
import { SuiteBackup } from '../core/backup.js';
import { ReactDOM } from '../core/vendor.js';
import { SharedDictionariesPanel } from './SharedDictionariesPanel.jsx';
import { IntegrityPanel } from './IntegrityPanel.jsx';
import { inspectIntegrity } from '../core/integrity.js';

const VALID_APPS = ['enemy', 'med', 'tactical', 'tasks', 'ovt', 'positions'];
const getInitialApp = () => {
    try {
        const saved = localStorage.getItem('suite_active_app');
        if (VALID_APPS.includes(saved)) return saved;
    } catch {}
    return 'enemy';
};

const RootApp = ({ EventsApp, MedicalApp, DocumentJournalApp }) => {
            const [activeApp, setActiveApp] = useState(getInitialApp);
            const switchApp = app => {
                if (restoreStarted || !VALID_APPS.includes(app)) return;
                setActiveApp(app);
                try {
                    if (window.SuiteRuntime?.setLocalItem) {
                        window.SuiteRuntime.setLocalItem('suite_active_app', app);
                    } else {
                        localStorage.setItem('suite_active_app', app);
                    }
                } catch {}
            };
            const [backupMode, setBackupMode] = useState(null);
            const [dictionariesOpen, setDictionariesOpen] = useState(false);
            const [backupPassword, setBackupPassword] = useState('');
            const [backupConfirm, setBackupConfirm] = useState('');
            const [backupSource, setBackupSource] = useState(null);
            const [backupPreview, setBackupPreview] = useState(null);
            const [backupReport, setBackupReport] = useState(null);
            const [localRecovery, setLocalRecovery] = useState(false);
            const [exportPbd, setExportPbd] = useState(false);
            const [importPbd, setImportPbd] = useState(false);
            const [integrityOpen, setIntegrityOpen] = useState(false);
            const [backupFileName, setBackupFileName] = useState('');
            const [backupMessage, setBackupMessage] = useState('');
            const [backupBusy, setBackupBusy] = useState(false);
            const [restoreConfirmed, setRestoreConfirmed] = useState(false);
            const [restoreComplete, setRestoreComplete] = useState(false);
            const [restoreStarted, setRestoreStarted] = useState(false);
            const backupLock = useRef(false);
            const legacyBackup = backupSource?.format === 'military-suite-unified';
            const incomingPbdCount = ['tasks', 'positions'].reduce((count, tab) => count + (backupPreview?.localforage?.document_journal_v1?.[tab] || []).filter(row => typeof row.reportedInPbd === 'boolean').length, 0);

            const openBackup = mode => {
                if (backupLock.current || restoreStarted) return;
                setBackupMode(mode); setBackupPassword(''); setBackupConfirm('');
                setExportPbd(false); setImportPbd(false);
                setBackupSource(null); setBackupPreview(null); setBackupFileName(''); setBackupReport(null); setLocalRecovery(false);
                setBackupMessage(''); setRestoreConfirmed(false); setRestoreComplete(false);
            };
            const closeBackup = () => {
                if (backupLock.current || restoreStarted) return;
                setBackupMode(null); setBackupPassword(''); setBackupConfirm('');
                setBackupSource(null); setBackupPreview(null);
            };
            const runBackupAction = async action => {
                if (backupLock.current) return;
                backupLock.current = true; setBackupBusy(true); setBackupMessage('');
                try { await action(); }
                catch (error) { setBackupMessage(error.message || 'Не вдалося виконати дію.'); }
                finally { backupLock.current = false; setBackupBusy(false); }
            };
            const requireNewPassword = () => {
                if (backupPassword.length < 12) throw new Error('Використайте пароль щонайменше з 12 символів.');
                if (backupPassword !== backupConfirm) throw new Error('Паролі не збігаються.');
            };
            const handleBackup = () => runBackupAction(async () => {
                requireNewPassword();
                const envelope = await SuiteBackup.encrypt(await SuiteBackup.collect({ includePbd: exportPbd }), backupPassword);
                SuiteBackup.download(envelope);
                setBackupPassword(''); setBackupConfirm('');
                setBackupMessage('Зашифровану копію підготовлено для завантаження. Збережіть файл і пароль окремо: без пароля відновлення неможливе.');
            });
            const chooseBackup = file => runBackupAction(async () => {
                setLocalRecovery(false); setBackupReport(null);
                setImportPbd(false);
                setBackupSource(null); setBackupPreview(null); setRestoreConfirmed(false);
                setBackupPassword(''); setBackupConfirm('');
                setBackupFileName(file?.name || '');
                setBackupSource(await SuiteBackup.readFile(file));
            });
            const chooseRecovery = () => runBackupAction(async () => {
                setLocalRecovery(true); setBackupReport(null);
                setImportPbd(false);
                setBackupSource(null); setBackupPreview(null); setRestoreConfirmed(false);
                setBackupPassword(''); setBackupConfirm(''); setBackupFileName('Попередній стан');
                const recovery = await SuiteBackup.getRecovery();
                if (!recovery) throw new Error('Захисної копії попереднього стану ще немає.');
                setBackupSource(recovery);
            });
            const checkBackup = () => runBackupAction(async () => {
                if (legacyBackup) requireNewPassword();
                const data = legacyBackup ? SuiteBackup.validate(backupSource) : await SuiteBackup.decrypt(backupSource, backupPassword);
                await window.SuiteRuntime.drain();
                const current = await SuiteBackup.collect({ localState: true, unchecked: true });
                setBackupReport({ rows: SuiteBackup.backupSummary(data, current), audit: inspectIntegrity(data) });
                setBackupPreview(data); setRestoreConfirmed(false);
            });
            const handleRestore = () => runBackupAction(async () => {
                if (!backupPreview || !restoreConfirmed) throw new Error('Спочатку перевірте файл і підтвердьте заміну даних.');
                window.SuiteRuntime.freeze();
                // Unmount synchronously: cancel module timers/listeners before
                // draining writes. Stay suspended on both success and failure.
                ReactDOM.flushSync(() => setRestoreStarted(true));
                await SuiteBackup.restore(backupPreview, backupPassword, { localRecovery: localRecovery && importPbd, importPbd });
                setRestoreComplete(true);
                setBackupPassword(''); setBackupConfirm(''); setBackupPreview(null); setBackupSource(null);
                setBackupMessage('Відновлення завершено. Попередній стан збережено зашифрованим у цьому браузері (кнопка «Попередній стан», той самий пароль). Перезавантажте програму.');
            });
            
            useEffect(() => {
                const tacContainer = document.getElementById('app-tactical-container');
                if (activeApp === 'tactical' && !backupMode && !dictionariesOpen && !restoreStarted) {
                    tacContainer.style.display = 'block';
                    if (window.TacticalModule && window.TacticalModule.init) {
                        window.TacticalModule.init();
                    }
                } else {
                    tacContainer.style.display = 'none';
                }
            }, [activeApp, backupMode, dictionariesOpen, restoreStarted]);

            useEffect(() => {
                const handleSwitchTab = (e) => {
                    if (e.detail && VALID_APPS.includes(e.detail)) switchApp(e.detail);
                };
                window.addEventListener('suite-switch-tab', handleSwitchTab);
                return () => window.removeEventListener('suite-switch-tab', handleSwitchTab);
            }, [restoreStarted]);
            
            const EnemyApp = EventsApp;
            const MedApp = MedicalApp;
            const openIntegrityRecord = issue => {
                ReactDOM.flushSync(() => { switchApp(issue.module); setIntegrityOpen(false); });
                window.dispatchEvent(new CustomEvent('suite-review-record', { detail: issue }));
            };

            return (
                <div className="flex flex-col h-full w-full relative">
                    <div className="shrink-0 h-14 bg-[#0f172a] border-b border-slate-800 flex items-center justify-between px-4 z-[9999] print:hidden shadow-md">
                        <div className="flex items-center gap-3 min-w-0 flex-1">
                            <div className="font-bold text-amber-500 tracking-wider hidden xl:block shrink-0">MILITARY SUITE</div>
                            <div className="flex bg-slate-950 rounded-lg overflow-x-auto whitespace-nowrap border border-slate-700 p-1 gap-1 min-w-0">
                                <button disabled={restoreStarted} onClick={() => switchApp('enemy')} className={`px-4 py-1 text-sm font-bold rounded-md transition-all ${activeApp==='enemy'?'bg-amber-600 text-white':'text-slate-400 hover:text-slate-200 hover:bg-slate-800'}`}>Втрати Противника</button>
                                <button aria-label="Медична Евакуація" title="Втрати о/с (медична евакуація)" disabled={restoreStarted} onClick={() => switchApp('med')} className={`px-4 py-1 text-sm font-bold rounded-md transition-all ${activeApp==='med'?'bg-rose-600 text-white':'text-slate-400 hover:text-slate-200 hover:bg-slate-800'}`}>Втрати о/с</button>
                                <button disabled={restoreStarted} onClick={() => switchApp('tactical')} className={`px-4 py-1 text-sm font-bold rounded-md transition-all ${activeApp==='tactical'?'bg-indigo-600 text-white':'text-slate-400 hover:text-slate-200 hover:bg-slate-800'}`}>Журнал О/С</button>
                                <button disabled={restoreStarted} onClick={() => switchApp('tasks')} className={`px-4 py-1 text-sm font-bold rounded-md transition-all ${activeApp==='tasks'?'bg-teal-600 text-white':'text-slate-400 hover:text-slate-200 hover:bg-slate-800'}`}>Завдання</button>
                                <button disabled={restoreStarted} onClick={() => switchApp('ovt')} className={`px-4 py-1 text-sm font-bold rounded-md transition-all ${activeApp==='ovt'?'bg-amber-700 text-white':'text-slate-400 hover:text-slate-200 hover:bg-slate-800'}`}>Втрати ОВТ</button>
                                <button disabled={restoreStarted} onClick={() => switchApp('positions')} className={`px-4 py-1 text-sm font-bold rounded-md transition-all ${activeApp==='positions'?'bg-emerald-600 text-white':'text-slate-400 hover:text-slate-200 hover:bg-slate-800'}`}>Статус позицій</button>
                            </div>
                        </div>
                        <div className="flex gap-2 shrink-0 ml-2">
                        <button aria-label="Перевірка даних" disabled={restoreStarted} onClick={() => setIntegrityOpen(true)} className="bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-600 px-3 py-1.5 rounded-lg text-sm font-bold">Перевірка даних</button>
                        <button aria-label="Спільні довідники" disabled={restoreStarted} onClick={() => setDictionariesOpen(true)} className="bg-teal-950 hover:bg-teal-900 text-teal-200 border border-teal-700 px-3 py-1.5 rounded-lg text-sm font-bold"><span className="hidden lg:inline">Спільні довідники</span><span className="lg:hidden">Довідники</span></button>
                        <button aria-label="Створити Єдиний Бекап" onClick={() => openBackup('export')} className="bg-slate-800 hover:bg-slate-700 text-amber-400 border border-amber-900/50 px-3 py-1.5 rounded-lg text-sm font-bold flex items-center gap-2">
                            <span className="hidden lg:inline">Створити Єдиний Бекап</span><span className="lg:hidden">Бекап</span>
                        </button>
                        <button aria-label="Відновити бекап" onClick={() => openBackup('import')} className="bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-600 px-3 py-1.5 rounded-lg text-sm font-bold"><span className="hidden lg:inline">Відновити бекап</span><span className="lg:hidden">Відновити</span></button>
                        </div>
                    </div>
                    <div id="suite-content" className="flex-1 min-h-0 min-w-0 relative bg-slate-950 overflow-hidden">
                        {!restoreStarted && <>
                        <div data-suite-module="enemy" data-suite-active={!backupMode && activeApp === 'enemy'} className={`absolute inset-0 ${!backupMode && activeApp === 'enemy' ? 'z-10' : 'z-0 invisible pointer-events-none'}`}><EnemyApp /></div>
                        <div data-suite-module="med" data-suite-active={!backupMode && activeApp === 'med'} className={`absolute inset-0 overflow-y-auto ${!backupMode && activeApp === 'med' ? 'z-10' : 'z-0 invisible pointer-events-none'}`}><MedApp /></div>
                        <div data-suite-module="documents" data-suite-active={!backupMode && ['tasks', 'ovt', 'positions'].includes(activeApp)} className={`absolute inset-0 bg-slate-950 overflow-y-auto ${!backupMode && ['tasks', 'ovt', 'positions'].includes(activeApp) ? 'z-10' : 'z-0 invisible pointer-events-none'}`}><DocumentJournalApp onBackup={openBackup} activeTab={['tasks', 'ovt', 'positions'].includes(activeApp) ? activeApp : undefined} /></div>
                        </>}
                    </div>
                    {dictionariesOpen && <SharedDictionariesPanel onClose={() => setDictionariesOpen(false)} onSuspend={() => ReactDOM.flushSync(() => setRestoreStarted(true))} />}
                    {integrityOpen && <IntegrityPanel onClose={() => setIntegrityOpen(false)} onOpen={openIntegrityRecord} />}
                    {backupMode && <div className="fixed inset-0 z-[20000] bg-black/80 flex items-center justify-center p-4">
                        <section role="dialog" aria-modal="true" aria-labelledby="suite-backup-title" className="bg-slate-900 text-slate-200 border border-slate-600 rounded-2xl p-6 w-full max-w-3xl max-h-[90vh] overflow-y-auto space-y-4">
                            <h2 id="suite-backup-title" className="text-xl font-bold">{backupMode === 'export' ? 'Єдиний зашифрований бекап' : 'Відновлення єдиного бекапу'}</h2>
                            <p className="text-sm text-slate-300">Дані та збережені налаштування всіх модулів, включно з документальним журналом. AES-256-GCM · PBKDF2-SHA-256 · 600 000 ітерацій. Пароль не записується у файл.</p>
                            <p className="text-sm text-amber-200">За замовчуванням відмітки «Подано в ПБД» залишаються локальними. Включення відміток у файл та їх застосування при відновленні вмикаються окремо.</p>
                            {!restoreStarted && <>
                                {backupMode === 'export' && <label className="flex gap-2 items-start text-sm"><input type="checkbox" disabled={backupBusy} checked={exportPbd} onChange={event => setExportPbd(event.target.checked)} />Включити в бекап відмітки «Подано в ПБД»</label>}
                                {backupMode === 'import' && <div className="space-y-3">
                                    <label className="block text-sm">Файл бекапу
                                        <input aria-label="Файл єдиного бекапу" type="file" accept=".mils,.enc,.json" disabled={backupBusy} onChange={event => { const file = event.target.files[0]; event.target.value = ''; if (file) chooseBackup(file); }} className="block w-full mt-2 text-sm" />
                                    </label>
                                    <button disabled={backupBusy} onClick={chooseRecovery} className="underline text-amber-400 text-sm">Попередній стан</button>
                                    {backupFileName && <p className="text-sm break-all">Обрано: {backupFileName}</p>}
                                    {legacyBackup && <p className="text-amber-300 text-sm">Це стара незашифрована копія. Для неї пароль не потрібен. Задайте новий пароль нижче: ним буде захищено поточні дані перед заміною. Надалі створюйте зашифровані копії.</p>}
                                </div>}
                                {!backupPreview && <>
                                    <label className="block text-sm">{legacyBackup ? 'Новий пароль захисної копії' : 'Пароль бекапу'}
                                        <input aria-label="Пароль єдиного бекапу" type="password" autoComplete={backupMode === 'export' || legacyBackup ? 'new-password' : 'current-password'} disabled={backupBusy} value={backupPassword} onChange={event => setBackupPassword(event.target.value)} className="block w-full mt-1 rounded-lg border border-slate-600 bg-slate-950 p-2" />
                                    </label>
                                    {(backupMode === 'export' || legacyBackup) && <label className="block text-sm">Повторіть пароль (щонайменше 12 символів)
                                        <input aria-label="Повтор пароля єдиного бекапу" type="password" autoComplete="new-password" disabled={backupBusy} value={backupConfirm} onChange={event => setBackupConfirm(event.target.value)} className="block w-full mt-1 rounded-lg border border-slate-600 bg-slate-950 p-2" />
                                    </label>}
                                </>}
                                {backupPreview && <div className="rounded-lg border border-amber-700 bg-amber-950/30 p-3 space-y-3 text-sm">
                                    <p>Файл перевірено. Створений: {window.SuiteDates.localDateTime(backupPreview.timestamp)}. Наборів даних: {Object.keys(backupPreview.localforage).length}; параметрів локального сховища: {Object.keys(backupPreview.localstorage).length}.</p>
                                    <p>Формат даних: {backupPreview.version}; ревізія журналу: {backupPreview.localforage.document_journal_v1?.schemaRevision ?? 0} → 1. Старим записам додаються лише відсутні локальні відмітки, без зміни ID, дат і змісту.</p>
                                    {localRecovery && backupPreview.localOnly && <p className="text-amber-200">Вибрано місцеву захисну копію. Щоб повернути також відмітки ПБД на момент її створення, увімкніть їх завантаження нижче.</p>}
                                    <label className="flex gap-2 items-start"><input type="checkbox" disabled={backupBusy || !incomingPbdCount} checked={importPbd} onChange={event => { setImportPbd(event.target.checked); setRestoreConfirmed(false); }} />Завантажити з бекапу відмітки «Подано в ПБД»</label>
                                    <p className="text-amber-200">{!incomingPbdCount ? 'У файлі немає збережених відміток ПБД. Ваші галочки для тих самих ID залишаться; нові записи отримають «не подано».' : importPbd ? `У ${incomingPbdCount} записах будуть застосовані значення з файлу — і встановлені, і зняті галочки. Там, де значення відсутнє, залишиться ваша відмітка.` : 'Відмітки з файлу ігноруватимуться. Ваші галочки для тих самих ID залишаться; нові записи отримають «не подано».'}</p>
                                    {backupReport && <>
                                        <div className="overflow-x-auto"><table className="w-full text-left"><thead><tr>{['Розділ', 'Зараз', 'Після', 'Нові ID', 'Зникнуть'].map(title => <th key={title} className="p-2 border-b border-slate-600">{title}</th>)}</tr></thead><tbody>{backupReport.rows.map(row => <tr key={row.title}><td className="p-2">{row.title}</td><td>{row.current}</td><td>{row.incoming}</td><td>{row.added}</td><td className={row.removed ? 'text-rose-300 font-bold' : ''}>{row.removed}</td></tr>)}</tbody></table></div>
                                        <p>«Зникнуть» — поточні записи, чиїх ID немає у файлі. Відсутні у файлі розділи будуть очищені; це заміна бази, не об’єднання.</p>
                                        {!!backupReport.audit.issues.length && <details><summary className="cursor-pointer text-amber-200">Потребує звірки: {backupReport.audit.issues.length}</summary><ul className="list-disc pl-5">{backupReport.audit.issues.slice(0, 30).map((issue, index) => <li key={index}>{issue.recordId}: {issue.message}</li>)}</ul>{backupReport.audit.issues.length > 30 && <p>Решта доступна в «Перевірка даних» після відновлення.</p>}</details>}
                                    </>}
                                    <p>Відновлення замінить дані й налаштування всіх модулів, а не доповнить їх. Поточний стан буде збережено окремо в зашифрованому вигляді з тим самим паролем. Закрийте інші вкладки програми.</p>
                                    <label className="flex gap-2 items-start"><input type="checkbox" disabled={backupBusy} checked={restoreConfirmed} onChange={event => setRestoreConfirmed(event.target.checked)} />Я закрив інші вкладки та підтверджую заміну поточних даних</label>
                                </div>}
                            </>}
                            {backupBusy && <p role="status" className="text-amber-300">Обробка… не закривайте програму.</p>}
                            {backupMessage && <p role="alert" className="text-sm whitespace-pre-wrap break-words">{backupMessage}</p>}
                            {restoreStarted && !backupBusy && !restoreComplete && <p className="text-sm text-amber-300">Модулі залишено зупиненими для захисту даних. Перезавантажте програму перед подальшою роботою.</p>}
                            <div className="flex gap-2 justify-end flex-wrap">
                                {restoreStarted ? (!backupBusy && <button onClick={() => location.reload()} className="px-4 py-2 rounded-lg bg-amber-600 text-white font-bold">Перезавантажити програму</button>) : <>
                                    <button disabled={backupBusy} onClick={closeBackup} className="px-4 py-2 rounded-lg bg-slate-700 disabled:opacity-50">Закрити</button>
                                    {backupMode === 'export' && <button disabled={backupBusy} onClick={handleBackup} className="px-4 py-2 rounded-lg bg-amber-600 text-white disabled:opacity-50">Зашифрувати й завантажити</button>}
                                    {backupMode === 'import' && !backupPreview && <button disabled={backupBusy || !backupSource} onClick={checkBackup} className="px-4 py-2 rounded-lg bg-amber-600 text-white disabled:opacity-50">Перевірити файл</button>}
                                    {backupPreview && <button disabled={backupBusy || !restoreConfirmed} onClick={handleRestore} className="px-4 py-2 rounded-lg bg-red-700 text-white disabled:opacity-50">Відновити всі дані</button>}
                                </>}
                            </div>
                        </section>
                    </div>}
                </div>
            );
        };

export { RootApp };
