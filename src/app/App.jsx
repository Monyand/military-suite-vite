import { useState, useRef, useEffect } from 'react';
import { SuiteBackup } from '../core/backup.js';
import { ReactDOM, localforage } from '../core/vendor.js';
import { SharedDictionariesPanel } from './SharedDictionariesPanel.jsx';
import { IntegrityPanel } from './IntegrityPanel.jsx';
import { GlobalSearchModal } from './GlobalSearchModal.jsx';
import { ChangelogModal, SUITE_VERSION } from './ChangelogModal.jsx';
import { TrashModal } from './TrashModal.jsx';
import { SuiteTrash } from '../core/trash.js';
import { AutoSnapshots } from '../core/auto-snapshots.js';
import { inspectIntegrity } from '../core/integrity.js';
import { bindDialogFocusTrap } from './dialog-focus.js';

const VALID_APPS = ['enemy', 'med', 'tactical', 'tasks', 'ovt', 'positions'];
const getInitialApp = () => {
    try {
        const saved = localStorage.getItem('suite_active_app');
        if (VALID_APPS.includes(saved)) return saved;
    } catch { }
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
        } catch { }
    };
    const [backupMode, setBackupMode] = useState(null);
    const [dictionariesOpen, setDictionariesOpen] = useState(false);
    const [searchOpen, setSearchOpen] = useState(false);
    const [changelogOpen, setChangelogOpen] = useState(false);
    const [trashOpen, setTrashOpen] = useState(false);
    const [trashCount, setTrashCount] = useState(0);
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
    const [tabConflict, setTabConflict] = useState(() => window.SuiteRuntime?.staleReason || '');
    const [lastBackupAt, setLastBackupAt] = useState(null);
    const [lastBackupCounts, setLastBackupCounts] = useState(null);
    const [backupNowMs, setBackupNowMs] = useState(() => Date.now());
    const [exportSummary, setExportSummary] = useState(null);
    const [autoSnapshots, setAutoSnapshots] = useState([]);
    const [isAutoSnapshot, setIsAutoSnapshot] = useState(false);
    const backupLock = useRef(false);
    const backupDialogRef = useRef(null);
    const legacyBackup = !isAutoSnapshot && backupSource?.format === 'military-suite-unified';
    const incomingPbdCount = ['tasks', 'positions'].reduce((count, tab) => count + (backupPreview?.localforage?.document_journal_v1?.[tab] || []).filter(row => typeof row.reportedInPbd === 'boolean').length, 0);

    const openBackup = mode => {
        if (backupLock.current || restoreStarted) return;
        setBackupMode(mode); setBackupPassword(''); setBackupConfirm('');
        setExportPbd(false); setImportPbd(false);
        setBackupSource(null); setBackupPreview(null); setBackupFileName(''); setBackupReport(null); setLocalRecovery(false); setIsAutoSnapshot(false);
        setBackupMessage(''); setRestoreConfirmed(false); setRestoreComplete(false);
        setExportSummary(null);
        if (mode === 'export') {
            window.SuiteRuntime.drain()
                .then(() => SuiteBackup.collect({ localState: true, unchecked: true }))
                .then(snap => setExportSummary(SuiteBackup.backupSummary(snap, snap)))
                .catch(() => {});
        } else if (mode === 'import') {
            AutoSnapshots.list().then(setAutoSnapshots).catch(() => {});
        }
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
        const collected = await SuiteBackup.collect({ includePbd: exportPbd });
        const envelope = await SuiteBackup.encrypt(collected, backupPassword);
        SuiteBackup.download(envelope);
        const ts = new Date().toISOString();
        const counts = Object.fromEntries(SuiteBackup.backupSummary(collected, collected).map(r => [r.title, r.current]));
        try {
            await localforage.setItem('suite_last_backup_at_v1', ts);
            await localforage.setItem('suite_last_backup_counts_v1', counts);
        } catch { /* ignore storage quota/private mode */ }
        setLastBackupAt(ts);
        setLastBackupCounts(counts);
        setBackupNowMs(Date.now());
        window.SuiteRuntime?.clearDirty?.();
        setBackupPassword(''); setBackupConfirm('');
        setBackupMessage('Зашифровану копію підготовлено для завантаження. Збережіть файл і пароль окремо: без пароля відновлення неможливе.');
    });
    const chooseBackup = file => runBackupAction(async () => {
        setLocalRecovery(false); setIsAutoSnapshot(false); setBackupReport(null);
        setImportPbd(false);
        setBackupSource(null); setBackupPreview(null); setRestoreConfirmed(false);
        setBackupPassword(''); setBackupConfirm('');
        setBackupFileName(file?.name || '');
        setBackupSource(await SuiteBackup.readFile(file));
    });
    const chooseRecovery = () => runBackupAction(async () => {
        setLocalRecovery(true); setIsAutoSnapshot(false); setBackupReport(null);
        setImportPbd(false);
        setBackupSource(null); setBackupPreview(null); setRestoreConfirmed(false);
        setBackupPassword(''); setBackupConfirm(''); setBackupFileName('Попередній стан');
        const recovery = await SuiteBackup.getRecovery();
        if (!recovery) throw new Error('Захисної копії попереднього стану ще немає.');
        setBackupSource(recovery);
    });
    const chooseAutoSnapshot = snap => runBackupAction(async () => {
        setLocalRecovery(true); setIsAutoSnapshot(true); setBackupReport(null);
        setImportPbd(false);
        setBackupSource(snap.data); setBackupPreview(null); setRestoreConfirmed(false);
        setBackupPassword(''); setBackupConfirm('');
        setBackupFileName(`Автознімок від ${window.SuiteDates.localDateTime(snap.createdAt)}`);
        const data = SuiteBackup.validate(snap.data);
        await window.SuiteRuntime.drain();
        const current = await SuiteBackup.collect({ localState: true, unchecked: true });
        setBackupReport({ rows: SuiteBackup.backupSummary(data, current), audit: inspectIntegrity(data) });
        setBackupPreview(data);
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
        if (isAutoSnapshot) {
            await AutoSnapshots.capture({ force: true, reason: 'before-rollback' });
        }
        window.SuiteRuntime.freeze();
        // Unmount synchronously: cancel module timers/listeners before
        // draining writes. Stay suspended on both success and failure.
        ReactDOM.flushSync(() => setRestoreStarted(true));
        await SuiteBackup.restore(backupPreview, backupPassword, {
            localRecovery: (localRecovery && importPbd) || (isAutoSnapshot && importPbd),
            importPbd,
            skipEncryptedRecovery: isAutoSnapshot,
        });
        window.SuiteRuntime?.notifyRestored?.();
        setRestoreComplete(true);
        setBackupPassword(''); setBackupConfirm(''); setBackupPreview(null); setBackupSource(null);
        setBackupMessage(isAutoSnapshot
            ? 'Відкат на локальний автознімок завершено. Попередній стан збережено в списку автознімків. Перезавантажте програму.'
            : 'Відновлення завершено. Попередній стан збережено зашифрованим у цьому браузері (кнопка «Попередній стан», той самий пароль). Перезавантажте програму.');
    });

    useEffect(() => {
        let active = true;
        Promise.all([
            localforage.getItem('suite_last_backup_at_v1'),
            localforage.getItem('suite_last_backup_counts_v1')
        ]).then(([val, counts]) => {
            if (!active) return;
            if (typeof val === 'string') setLastBackupAt(val);
            if (counts && typeof counts === 'object' && !Array.isArray(counts)) setLastBackupCounts(counts);
        }).catch(() => {});
        const timer = setInterval(() => setBackupNowMs(Date.now()), 60000);
        const snapInit = setTimeout(() => { AutoSnapshots.capture(); }, 5000);
        const snapTimer = setInterval(() => { AutoSnapshots.capture(); }, 15 * 60 * 1000);
        return () => { active = false; clearInterval(timer); clearTimeout(snapInit); clearInterval(snapTimer); };
    }, []);

    useEffect(() => {
        let active = true;
        SuiteTrash.count().then(n => { if (active) setTrashCount(n); }).catch(() => {});
        const onTrashChanged = (e) => {
            if (typeof e?.detail?.count === 'number') setTrashCount(e.detail.count);
            else SuiteTrash.count().then(n => { if (active) setTrashCount(n); }).catch(() => {});
        };
        window.addEventListener('suite-trash-changed', onTrashChanged);
        return () => { active = false; window.removeEventListener('suite-trash-changed', onTrashChanged); };
    }, []);

    useEffect(() => {
        return window.SuiteRuntime?.onConflict?.(reason => setTabConflict(reason));
    }, []);

    useEffect(() => {
        const handleBeforeUnload = (event) => {
            if (restoreStarted || window.SuiteRuntime?.stale) return;
            if (backupBusy || window.SuiteRuntime?.hasPending || window.SuiteRuntime?.dirtySinceBackup) {
                event.preventDefault();
                event.returnValue = '';
            }
        };
        window.addEventListener('beforeunload', handleBeforeUnload);
        return () => window.removeEventListener('beforeunload', handleBeforeUnload);
    }, [backupBusy, restoreStarted]);

    useEffect(() => {
        const tacContainer = document.getElementById('app-tactical-container');
        if (!tacContainer) return;
        if (activeApp === 'tactical' && !backupMode && !dictionariesOpen && !integrityOpen && !searchOpen && !changelogOpen && !trashOpen && !restoreStarted && !tabConflict) {
            tacContainer.style.display = 'block';
            if (window.TacticalModule && window.TacticalModule.init) {
                window.TacticalModule.init();
            }
        } else {
            tacContainer.style.display = 'none';
        }
    }, [activeApp, backupMode, dictionariesOpen, integrityOpen, searchOpen, changelogOpen, trashOpen, restoreStarted, tabConflict]);

    useEffect(() => {
        if (!backupMode) return;
        return bindDialogFocusTrap(backupDialogRef, closeBackup);
    }, [backupMode]);

    useEffect(() => {
        const handleSwitchTab = (e) => {
            if (e.detail && VALID_APPS.includes(e.detail)) switchApp(e.detail);
        };
        window.addEventListener('suite-switch-tab', handleSwitchTab);
        return () => window.removeEventListener('suite-switch-tab', handleSwitchTab);
    }, [restoreStarted]);

    useEffect(() => {
        const handleGlobalKey = (e) => {
            const isK = e.code === 'KeyK' || e.key?.toLowerCase() === 'k' || e.key?.toLowerCase() === 'л';
            const canToggleSearch = !restoreStarted && !backupBusy && !backupMode && !dictionariesOpen && !integrityOpen && !changelogOpen;
            if ((e.ctrlKey || e.metaKey) && isK) {
                e.preventDefault();
                e.stopPropagation();
                if (canToggleSearch) setSearchOpen(prev => !prev);
                return;
            }
            const isInput = ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target?.tagName) || e.target?.isContentEditable;
            if (!isInput && e.key === '/' && canToggleSearch) {
                e.preventDefault();
                setSearchOpen(true);
            }
        };
        window.addEventListener('keydown', handleGlobalKey, true);
        return () => window.removeEventListener('keydown', handleGlobalKey, true);
    }, [restoreStarted, backupBusy, backupMode, dictionariesOpen, integrityOpen, changelogOpen]);

    const handleSearchNavigate = (record) => {
        if (!record) return;
        const { module, id } = record;
        ReactDOM.flushSync(() => {
            switchApp(module);
            setSearchOpen(false);
        });
        if (module === 'tactical') {
            setTimeout(() => {
                if (typeof window.openSoldierModal === 'function') {
                    window.openSoldierModal(id);
                }
            }, 120);
        } else {
            window.dispatchEvent(new CustomEvent('suite-review-record', { detail: { module, recordId: String(id) } }));
        }
    };

    const EnemyApp = EventsApp;
    const MedApp = MedicalApp;
    const openIntegrityRecord = issue => {
        ReactDOM.flushSync(() => { switchApp(issue.module); setIntegrityOpen(false); });
        window.dispatchEvent(new CustomEvent('suite-review-record', { detail: issue }));
    };

    const MODULE_ACCENTS = {
        enemy:     { active: 'bg-[#2b1719] text-[#fef2f2] border-[#ef4444]/65 [&_svg]:text-[#f87171]', idle: '[&_svg]:text-[#f87171]/80' },
        med:       { active: 'bg-[#122624] text-[#f0fdfa] border-[#14b8a6]/65 [&_svg]:text-[#2dd4bf]', idle: '[&_svg]:text-[#2dd4bf]/80' },
        tactical:  { active: 'bg-[#162235] text-[#eff6ff] border-[#3b82f6]/65 [&_svg]:text-[#60a5fa]', idle: '[&_svg]:text-[#60a5fa]/80' },
        tasks:     { active: 'bg-[#272112] text-[#fefce8] border-[#eab308]/65 [&_svg]:text-[#facc15]', idle: '[&_svg]:text-[#facc15]/80' },
        ovt:       { active: 'bg-[#2b1c12] text-[#fff7ed] border-[#f97316]/65 [&_svg]:text-[#fb923c]', idle: '[&_svg]:text-[#fb923c]/80' },
        positions: { active: 'bg-[#201932] text-[#f5f3ff] border-[#8b5cf6]/65 [&_svg]:text-[#a78bfa]', idle: '[&_svg]:text-[#a78bfa]/80' },
    };
    const navTabClass = (key, isActive) => `px-2.5 py-1 text-xs rounded-sm transition-colors flex items-center gap-1.5 border whitespace-nowrap ${isActive
        ? `${MODULE_ACCENTS[key].active} font-semibold`
        : `text-[#c2c7d0] hover:text-[#ffffff] hover:bg-[#222429] border-transparent font-medium ${MODULE_ACCENTS[key].idle}`}`;
    const utilBtnClass = (primary = false) => `${primary
        ? 'bg-[#2b67ab] hover:bg-[#4c8ed9] text-white border-[#4c8ed9]'
        : 'bg-[#222429] hover:bg-[#282b31] text-[#f3f4f6] border-[#2e3138] hover:border-[#3c404a]'} border px-2.5 py-1 rounded-sm text-xs font-semibold flex items-center gap-1.5 transition-colors disabled:opacity-50`;

    return (
        <div className="flex flex-col h-full w-full relative bg-[#101113] text-[#f3f4f6]">
            <header className="shrink-0 min-h-[3.5rem] bg-[#17181b] border-b border-[#2e3138] flex flex-wrap items-center justify-between gap-2 px-3 py-1.5 z-10 print:hidden select-none">
                <div className="flex items-center gap-2 md:gap-2.5 min-w-0 flex-1">
                    <div className="flex items-center gap-2 shrink-0 pr-1">
                        <div className="w-7 h-7 rounded-sm bg-[#222429] border border-[#2e3138] flex items-center justify-center text-[#4c8ed9]">
                            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                <path d="M12 2L3 7v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V7l-9-5z" />
                            </svg>
                        </div>
                        <div className="hidden xl:flex items-baseline gap-1.5">
                            <span className="font-bold text-[#f3f4f6] tracking-wide text-sm">MILITARY SUITE</span>
                            <span className="text-[11px] font-mono tabular-nums px-1.5 py-0.5 rounded-sm bg-[#222429] text-[#b8bec8] font-semibold border border-[#2e3138]" title="ОЧ / S-3 — Оперативна частина">S3 · ОЧ</span>
                        </div>
                        <button
                            type="button"
                            aria-label="Історія оновлень комплексу"
                            title={`Історія оновлень MILITARY SUITE (v${SUITE_VERSION})`}
                            disabled={restoreStarted}
                            onClick={() => setChangelogOpen(true)}
                            className="text-[11px] font-mono tabular-nums px-1.5 py-0.5 rounded-sm bg-[#101113] hover:bg-[#222429] text-[#989fa9] hover:text-[#e6edf3] border border-[#2e3138] hover:border-[#4c8ed9] font-medium transition-colors cursor-pointer disabled:opacity-50 shrink-0"
                        >
                            v{SUITE_VERSION}
                        </button>
                    </div>

                    <nav aria-label="Головна навігація" className="flex flex-wrap items-center bg-[#101113] rounded-sm border border-[#2e3138] p-0.5 gap-0.5 min-w-0">
                        <button
                            aria-label="Втрати Противника"
                            title="Втрати противника (журнал подій та боєзіткнень)"
                            disabled={restoreStarted}
                            onClick={() => switchApp('enemy')}
                            className={navTabClass('enemy', activeApp === 'enemy')}
                        >
                            <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                <circle cx="12" cy="12" r="10" /><line x1="22" y1="12" x2="18" y2="12" /><line x1="6" y1="12" x2="2" y2="12" /><line x1="12" y1="6" x2="12" y2="2" /><line x1="12" y1="22" x2="12" y2="18" />
                            </svg>
                            <span>Втрати Противника</span>
                        </button>

                        <button
                            aria-label="Медична Евакуація"
                            title="Наші втрати о/с (медична евакуація)"
                            disabled={restoreStarted}
                            onClick={() => switchApp('med')}
                            className={navTabClass('med', activeApp === 'med')}
                        >
                            <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
                            </svg>
                            <span>Наші втрати о/с</span>
                        </button>

                        <button
                            aria-label="Журнал О/С"
                            title="Журнал особового складу підрозділів"
                            disabled={restoreStarted}
                            onClick={() => switchApp('tactical')}
                            className={navTabClass('tactical', activeApp === 'tactical')}
                        >
                            <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
                            </svg>
                            <span>Журнал О/С</span>
                        </button>

                        <button
                            aria-label="Завдання"
                            title="Журнал бойових розпоряджень та завдань"
                            disabled={restoreStarted}
                            onClick={() => switchApp('tasks')}
                            className={navTabClass('tasks', activeApp === 'tasks')}
                        >
                            <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                <path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
                            </svg>
                            <span>Завдання</span>
                        </button>

                        <button
                            aria-label="Втрати ОВТ"
                            title="Облік втрат озброєння та військової техніки"
                            disabled={restoreStarted}
                            onClick={() => switchApp('ovt')}
                            className={navTabClass('ovt', activeApp === 'ovt')}
                        >
                            <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                <rect x="1" y="3" width="15" height="13" /><polygon points="16 8 20 8 23 11 23 16 16 16 16 8" /><circle cx="5.5" cy="18.5" r="2.5" /><circle cx="18.5" cy="18.5" r="2.5" />
                            </svg>
                            <span>Втрати ОВТ</span>
                        </button>

                        <button
                            aria-label="Статус позицій"
                            title="Статус та рубежі позицій"
                            disabled={restoreStarted}
                            onClick={() => switchApp('positions')}
                            className={navTabClass('positions', activeApp === 'positions')}
                        >
                            <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" />
                            </svg>
                            <span>Статус позицій</span>
                        </button>
                    </nav>
                </div>
                <div className="flex items-center flex-wrap gap-1.5 shrink-0">
                    <button
                        aria-label="Перевірка даних"
                        title="Перевірка цілісності даних та зв'язків між записами"
                        disabled={restoreStarted}
                        onClick={() => setIntegrityOpen(true)}
                        className={utilBtnClass(false)}
                    >
                        <svg className="w-3.5 h-3.5 text-[#b8bec8]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /><path d="m9 12 2 2 4-4" />
                        </svg>
                        <span className="hidden sm:inline">Перевірка даних</span>
                    </button>

                    <button
                        aria-label="Спільні довідники"
                        title="Спільні довідники підрозділів, звань та правил замін"
                        disabled={restoreStarted}
                        onClick={() => setDictionariesOpen(true)}
                        className={utilBtnClass(false)}
                    >
                        <svg className="w-3.5 h-3.5 text-[#b8bec8]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
                        </svg>
                        <span className="hidden lg:inline">Спільні довідники</span>
                        <span className="hidden sm:inline lg:hidden">Довідники</span>
                    </button>

                    <button
                        type="button"
                        aria-label="Наскрізний пошук"
                        title="Наскрізний пошук по всіх базах (Ctrl+K)"
                        disabled={restoreStarted}
                        onClick={() => setSearchOpen(true)}
                        className={utilBtnClass(false)}
                    >
                        <svg className="w-3.5 h-3.5 text-[#4c8ed9]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
                        </svg>
                        <span className="hidden xl:inline">Пошук</span>
                        <kbd className="hidden 2xl:inline text-[11px] font-mono tabular-nums bg-[#101113] border border-[#2e3138] rounded-sm px-1 text-[#b8bec8]">Ctrl K</kbd>
                    </button>

                    <button
                        type="button"
                        aria-label="Кошик та журнал видалень"
                        title="Кошик та журнал видалень (відновлення видалених записів)"
                        disabled={restoreStarted}
                        onClick={() => setTrashOpen(true)}
                        className={utilBtnClass(false)}
                    >
                        <svg className="w-3.5 h-3.5 text-[#f87171]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6" /><path d="M14 11v6" /><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                        </svg>
                        <span className="hidden xl:inline">Кошик</span>
                        {trashCount > 0 && (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded-sm text-[11px] font-mono font-bold tabular-nums leading-none border bg-[#d9534f]/20 border-[#d9534f]/50 text-[#fca5a5]">
                                {trashCount}
                            </span>
                        )}
                    </button>

                    <div className="h-4 w-[1px] bg-[#2e3138] hidden sm:block mx-0.5" aria-hidden="true" />

                    {(() => {
                        const lastMs = lastBackupAt ? Date.parse(lastBackupAt) : NaN;
                        const hasTs = Number.isFinite(lastMs);
                        const diffHours = hasTs ? Math.max(0, Math.floor((backupNowMs - lastMs) / 3600000)) : null;
                        const lastDate = hasTs ? new Date(lastMs) : null;
                        const badgeLabel = !lastDate
                            ? 'не було'
                            : `${String(lastDate.getDate()).padStart(2, '0')}.${String(lastDate.getMonth() + 1).padStart(2, '0')} ${String(lastDate.getHours()).padStart(2, '0')}:${String(lastDate.getMinutes()).padStart(2, '0')}`;
                        const stale = !hasTs || diffHours >= 24;
                        const badgeCls = stale
                            ? 'bg-[#d99b26]/20 border-[#d99b26]/50 text-[#fde68a]'
                            : 'bg-[#3da372]/20 border-[#3da372]/50 text-[#8ad8ae]';
                        const exactLabel = hasTs
                            ? `Останній Єдиний Бекап: ${lastDate.toLocaleString('uk-UA', { dateStyle: 'short', timeStyle: 'short' })}`
                            : 'Єдиний Бекап у цьому браузері ще не створювався';
                        return (
                            <button
                                aria-label="Створити Єдиний Бекап"
                                title={`${exactLabel} — створити зашифрований бекап (AES-256-GCM)`}
                                onClick={() => openBackup('export')}
                                className={utilBtnClass(true)}
                            >
                                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
                                </svg>
                                <span className="hidden lg:inline">Створити Єдиний Бекап</span>
                                <span className="hidden sm:inline lg:hidden">Бекап</span>
                                <span className={`hidden xl:inline-flex items-center px-1.5 py-0.5 rounded-sm text-[11px] font-mono font-bold tabular-nums leading-none border ${badgeCls}`}>
                                    {badgeLabel}
                                </span>
                            </button>
                        );
                    })()}

                    <button
                        aria-label="Відновити бекап"
                        title="Відновити базу даних із зашифрованого файлу бекапу"
                        onClick={() => openBackup('import')}
                        className={utilBtnClass(false)}
                    >
                        <svg className="w-3.5 h-3.5 text-[#b8bec8]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" />
                        </svg>
                        <span className="hidden lg:inline">Відновити бекап</span>
                        <span className="hidden sm:inline lg:hidden">Відновити</span>
                    </button>
                </div>
            </header>
            <div id="suite-content" className="flex-1 min-h-0 min-w-0 relative bg-[#101113] overflow-hidden">
                {!restoreStarted && <>
                    <div data-suite-module="enemy" data-suite-active={!backupMode && activeApp === 'enemy'} className={`absolute inset-0 ${!backupMode && activeApp === 'enemy' ? 'z-20' : 'z-0 invisible pointer-events-none'}`}><EnemyApp /></div>
                    <div data-suite-module="med" data-suite-active={!backupMode && activeApp === 'med'} className={`absolute inset-0 overflow-y-auto ${!backupMode && activeApp === 'med' ? 'z-20' : 'z-0 invisible pointer-events-none'}`}><MedApp /></div>
                    <div data-suite-module="documents" data-suite-active={!backupMode && ['tasks', 'ovt', 'positions'].includes(activeApp)} className={`absolute inset-0 bg-[#101113] overflow-y-auto ${!backupMode && ['tasks', 'ovt', 'positions'].includes(activeApp) ? 'z-20' : 'z-0 invisible pointer-events-none'}`}><DocumentJournalApp onBackup={openBackup} activeTab={['tasks', 'ovt', 'positions'].includes(activeApp) ? activeApp : undefined} /></div>
                </>}
            </div>
            {dictionariesOpen && <SharedDictionariesPanel onClose={() => setDictionariesOpen(false)} onSuspend={() => ReactDOM.flushSync(() => setRestoreStarted(true))} />}
            {integrityOpen && <IntegrityPanel onClose={() => setIntegrityOpen(false)} onOpen={openIntegrityRecord} />}
            {searchOpen && <GlobalSearchModal onClose={() => setSearchOpen(false)} onNavigate={handleSearchNavigate} />}
            {changelogOpen && <ChangelogModal onClose={() => setChangelogOpen(false)} />}
            {trashOpen && <TrashModal onClose={() => setTrashOpen(false)} />}
            {tabConflict && !restoreStarted && (
                <div className="fixed inset-0 z-[25000] bg-black/85 flex items-center justify-center p-4 overscroll-contain">
                    <section role="alertdialog" aria-modal="true" aria-labelledby="suite-tab-conflict-title" className="bg-[#17181b] text-[#f3f4f6] border border-[#d9534f]/65 rounded-sm w-full max-w-lg overflow-hidden">
                        <div className="px-5 py-3.5 bg-[#101113] border-b border-[#2e3138] flex items-center gap-3">
                            <div className="w-8 h-8 rounded-sm border border-[#d9534f]/50 bg-[#d9534f]/15 text-[#f87171] flex items-center justify-center shrink-0">
                                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
                                </svg>
                            </div>
                            <h2 id="suite-tab-conflict-title" className="text-sm font-bold text-[#f3f4f6]">
                                {tabConflict === 'restored' ? 'Базу оновлено в іншій вкладці' : 'Виявлено іншу відкриту вкладку'}
                            </h2>
                        </div>
                        <div className="p-5 space-y-3 text-xs text-[#cbd5e1] leading-relaxed">
                            <p>
                                {tabConflict === 'restored'
                                    ? 'В іншій вкладці браузера щойно відновлено резервну копію. Запис у цій вкладці автоматично заблоковано, щоб старий стан не перезаписав відновлені дані.'
                                    : 'Програма відкрита в іншій вкладці браузера. Запис у цій вкладці автоматично заблоковано, щоб уникнути конфлікту та втрати нових записів.'}
                            </p>
                            <p className="text-[#989fa9]">
                                Закрийте зайву вкладку або натисніть «Перезавантажити й працювати тут», щоб підвантажити актуальну базу.
                            </p>
                        </div>
                        <div className="px-5 py-3 bg-[#101113] border-t border-[#2e3138] flex justify-end gap-2">
                            <button
                                type="button"
                                onClick={() => location.reload()}
                                className="h-8 px-3.5 rounded-sm bg-[#2b67ab] hover:bg-[#3577c2] border border-[#4c8ed9] text-white font-semibold text-xs cursor-pointer transition-colors"
                            >
                                Перезавантажити й працювати тут
                            </button>
                        </div>
                    </section>
                </div>
            )}
            {backupMode && <div className="fixed inset-0 z-[20000] bg-black/80 flex items-center justify-center p-3 sm:p-4 overscroll-contain">
                <section ref={backupDialogRef} role="dialog" aria-modal="true" aria-labelledby="suite-backup-title" className="bg-[#17181b] text-[#f3f4f6] border border-[#2e3138] rounded-sm w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden">
                    <div className="px-5 py-3.5 bg-[#101113] border-b border-[#2e3138] flex items-center justify-between gap-3 shrink-0">
                        <div className="flex items-center gap-3 min-w-0">
                            <div className={`w-9 h-9 rounded-sm border flex items-center justify-center shrink-0 ${backupMode === 'export' ? 'bg-[#2b67ab]/15 border-[#4c8ed9]/40 text-[#4c8ed9]' : 'bg-[#d99b26]/15 border-[#d99b26]/40 text-[#e7c574]'}`}>
                                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                    {backupMode === 'export'
                                        ? <><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /><path d="m9 12 2 2 4-4" /></>
                                        : <><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></>}
                                </svg>
                            </div>
                            <div className="min-w-0">
                                <h2 id="suite-backup-title" className="text-base font-bold text-[#e6edf3] tracking-tight truncate">{backupMode === 'export' ? 'Єдиний зашифрований бекап' : 'Відновлення єдиного бекапу'}</h2>
                                <p className="text-[11px] text-[#989fa9] font-mono truncate">AES-256-GCM · PBKDF2-SHA-256 · 600 000 ітерацій</p>
                            </div>
                        </div>
                        {!restoreStarted && <button type="button" disabled={backupBusy} onClick={closeBackup} aria-label="Закрити вікно бекапу" className="w-8 h-8 rounded-sm bg-[#17181b] hover:bg-[#222429] border border-[#2e3138] text-[#b8bec8] hover:text-white flex items-center justify-center transition-colors disabled:opacity-50 cursor-pointer shrink-0"><svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg></button>}
                    </div>
                    <div className="p-5 overflow-y-auto space-y-4">
                        <div className="rounded-sm border border-[#2e3138] bg-[#101113] px-3.5 py-2.5 text-xs space-y-1">
                            <p className="text-[#b8bec8]">Дані та збережені налаштування всіх модулів, включно з документальним журналом. Пароль не записується у файл.</p>
                            <p className="text-[#e7c574]">За замовчуванням відмітки «Подано в ПБД» залишаються локальними. Включення відміток у файл та їх застосування при відновленні вмикаються окремо.</p>
                        </div>
                    {!restoreStarted && <>
                        {backupMode === 'export' && exportSummary && (
                            <div className="space-y-1.5">
                                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                                    {exportSummary.map(row => {
                                        const hasPrev = lastBackupCounts && typeof lastBackupCounts[row.title] === 'number';
                                        const diff = hasPrev ? row.current - lastBackupCounts[row.title] : null;
                                        return (
                                            <div key={row.title} className="bg-[#101113] border border-[#2e3138] rounded-sm px-2.5 py-2">
                                                <div className="text-[11px] text-[#9aa6b8] truncate" title={row.title}>{row.title}</div>
                                                <div className="flex items-baseline justify-between gap-2 mt-0.5 tabular-nums font-mono">
                                                    <span className="text-sm font-bold text-[#f3f4f6]">{row.current}</span>
                                                    {diff !== null && (
                                                        <span className={`text-[11px] font-semibold ${diff > 0 ? 'text-[#8ad8ae]' : diff < 0 ? 'text-[#f3a3a0]' : 'text-[#989fa9]'}`}>
                                                            {diff > 0 ? `+${diff}` : diff < 0 ? `${diff}` : '0'}
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                                {!lastBackupCounts && (
                                    <p className="text-[11px] text-[#989fa9]">Різниця (+ / −) відносно попереднього стану почне показуватися після першого збереження Єдиного Бекапу.</p>
                                )}
                            </div>
                        )}
                        {backupMode === 'export' && <label className="flex gap-2 items-center text-xs text-[#e6edf3] cursor-pointer select-none"><input type="checkbox" disabled={backupBusy} checked={exportPbd} onChange={event => setExportPbd(event.target.checked)} className="w-3.5 h-3.5 accent-[#4c8ed9]" />Включити в бекап відмітки «Подано в ПБД»</label>}
                        {backupMode === 'import' && <div className="space-y-2.5 bg-[#101113] border border-[#2e3138] rounded-sm p-3.5">
                            <div className="flex items-center justify-between gap-2 flex-wrap">
                                <label className="inline-flex items-center gap-2 h-8 px-3 rounded-sm bg-[#222429] hover:bg-[#2b3340] border border-[#3c404a] hover:border-[#4c8ed9] text-xs font-semibold text-[#e6edf3] cursor-pointer transition-colors">
                                    <svg className="w-3.5 h-3.5 text-[#4c8ed9]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>
                                    <span>Обрати файл бекапу (.mils / .enc)</span>
                                    <input aria-label="Файл єдиного бекапу" type="file" accept=".mils,.enc,.json" disabled={backupBusy} onChange={event => { const file = event.target.files[0]; event.target.value = ''; if (file) chooseBackup(file); }} className="sr-only" />
                                </label>
                                <button type="button" disabled={backupBusy} onClick={chooseRecovery} className="h-8 px-3 rounded-sm bg-[#17181b] hover:bg-[#222429] border border-[#2e3138] hover:border-[#4c8ed9] text-[#93c5fd] text-xs font-medium transition-colors cursor-pointer">Попередній стан</button>
                            </div>
                            {backupFileName && <p className="text-xs break-all font-mono tabular-nums text-[#8ad8ae]">Обрано: {backupFileName}</p>}
                            {legacyBackup && <p className="text-[#fcd34d] text-xs">Це стара незашифрована копія. Для неї пароль не потрібен. Задайте новий пароль нижче: ним буде захищено поточні дані перед заміною. Надалі створюйте зашифровані копії.</p>}
                            <div className="pt-2 border-t border-[#2e3138] space-y-1.5">
                                <div className="flex items-center justify-between gap-2">
                                    <span className="text-[11px] font-semibold uppercase tracking-wide text-[#9aa6b8]">Локальні автознімки (останні {AutoSnapshots.MAX})</span>
                                    <button
                                        type="button"
                                        disabled={backupBusy}
                                        onClick={async () => {
                                            await AutoSnapshots.capture({ force: true, reason: 'manual' });
                                            setAutoSnapshots(await AutoSnapshots.list());
                                        }}
                                        className="text-[11px] text-[#4c8ed9] hover:text-[#7db3ed] underline cursor-pointer disabled:opacity-50"
                                    >
                                        Зберегти точку зараз
                                    </button>
                                </div>
                                {autoSnapshots.length === 0 ? (
                                    <p className="text-[11px] text-[#989fa9]">Автознімки створюються автоматично раз на 30 хв при змінах у базі (у цьому браузері).</p>
                                ) : (
                                    <div className="space-y-1">
                                        {autoSnapshots.map(snap => (
                                            <div key={snap.id} className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-sm bg-[#17181b] border border-[#2e3138] text-xs">
                                                <div className="flex items-center gap-2 min-w-0 font-mono tabular-nums text-[11px]">
                                                    <span className="text-[#e6edf3]">{window.SuiteDates.localDateTime(snap.createdAt)}</span>
                                                    <span className="text-[#9aa6b8]">· {snap.totalRecords} записів</span>
                                                    {snap.reason === 'before-rollback' && <span className="text-[#fcd34d]">· перед відкатом</span>}
                                                </div>
                                                <button
                                                    type="button"
                                                    disabled={backupBusy}
                                                    onClick={() => chooseAutoSnapshot(snap)}
                                                    className="h-6 px-2.5 rounded-sm bg-[#222429] hover:bg-[#2b3340] border border-[#3c404a] hover:border-[#4c8ed9] text-[#93c5fd] text-[11px] font-semibold cursor-pointer shrink-0 disabled:opacity-50"
                                                >
                                                    Перевірити
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>}
                        {!backupPreview && <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <label className={`block text-xs text-[#b8bec8] font-medium ${backupMode === 'import' && !legacyBackup ? 'sm:col-span-2' : ''}`}>{legacyBackup ? 'Новий пароль захисної копії' : 'Пароль бекапу'}
                                <input aria-label="Пароль єдиного бекапу" type="password" autoComplete={backupMode === 'export' || legacyBackup ? 'new-password' : 'current-password'} disabled={backupBusy} value={backupPassword} onChange={event => setBackupPassword(event.target.value)} className="block w-full mt-1.5 rounded-sm border border-[#2e3138] bg-[#101113] px-3 py-2 text-xs text-[#f3f4f6] focus:border-[#4c8ed9] outline-none" placeholder="Мінімум 12 символів..." />
                            </label>
                            {(backupMode === 'export' || legacyBackup) && <label className="block text-xs text-[#b8bec8] font-medium">Повторіть пароль (щонайменше 12 символів)
                                <input aria-label="Повтор пароля єдиного бекапу" type="password" autoComplete="new-password" disabled={backupBusy} value={backupConfirm} onChange={event => setBackupConfirm(event.target.value)} className="block w-full mt-1.5 rounded-sm border border-[#2e3138] bg-[#101113] px-3 py-2 text-xs text-[#f3f4f6] focus:border-[#4c8ed9] outline-none" placeholder="Повторіть пароль..." />
                            </label>}
                        </div>}
                        {backupPreview && <div className="rounded-sm border border-[#d99b26]/50 bg-[#d99b26]/10 p-3 space-y-3 text-sm">
                            <p className="tabular-nums">Файл перевірено. Створений: {window.SuiteDates.localDateTime(backupPreview.timestamp)}. Наборів даних: {Object.keys(backupPreview.localforage).length}; параметрів локального сховища: {Object.keys(backupPreview.localstorage).length}.</p>
                            <p className="tabular-nums">Формат даних: {backupPreview.version}; ревізія журналу: {backupPreview.localforage.document_journal_v1?.schemaRevision ?? 0} → 1. Старим записам додаються лише відсутні локальні відмітки, без зміни ID, дат і змісту.</p>
                            {localRecovery && backupPreview.localOnly && <p className="text-[#fcd34d]">Вибрано місцеву захисну копію. Щоб повернути також відмітки ПБД на момент її створення, увімкніть їх завантаження нижче.</p>}
                            <label className="flex gap-2 items-start"><input type="checkbox" disabled={backupBusy || !incomingPbdCount} checked={importPbd} onChange={event => { setImportPbd(event.target.checked); setRestoreConfirmed(false); }} />Завантажити з бекапу відмітки «Подано в ПБД»</label>
                            <p className="text-[#fcd34d] tabular-nums">{!incomingPbdCount ? 'У файлі немає збережених відміток ПБД. Ваші галочки для тих самих ID залишаться; нові записи отримають «не подано».' : importPbd ? `У ${incomingPbdCount} записах будуть застосовані значення з файлу — і встановлені, і зняті галочки. Там, де значення відсутнє, залишиться ваша відмітка.` : 'Відмітки з файлу ігноруватимуться. Ваші галочки для тих самих ID залишаться; нові записи отримають «не подано».'}</p>
                            {backupReport && <>
                                <div className="overflow-x-auto border border-[#2e3138] bg-[#101113]"><table className="w-full text-left tabular-nums text-xs"><thead className="bg-[#222429]"><tr>{['Розділ', 'Зараз', 'Після', 'Нові ID', 'Зникнуть'].map(title => <th key={title} className="p-2 border-b border-[#2e3138] font-semibold">{title}</th>)}</tr></thead><tbody className="divide-y divide-[#2e3138]">{backupReport.rows.map(row => <tr key={row.title}><td className="p-2">{row.title}</td><td className="p-2 font-mono">{row.current}</td><td className="p-2 font-mono">{row.incoming}</td><td className="p-2 font-mono">{row.added}</td><td className={`p-2 font-mono ${row.removed ? 'text-[#fca5a5] font-bold' : ''}`}>{row.removed}</td></tr>)}</tbody></table></div>
                                <p>«Зникнуть» — поточні записи, чиїх ID немає у файлі. Відсутні у файлі розділи будуть очищені; це заміна бази, не об’єднання.</p>
                                {!!backupReport.audit.issues.length && <details><summary className="cursor-pointer text-[#fcd34d] tabular-nums">Потребує звірки: {backupReport.audit.issues.length}</summary><ul className="list-disc pl-5">{backupReport.audit.issues.slice(0, 30).map((issue, index) => <li key={index}>{issue.recordId}: {issue.message}</li>)}</ul>{backupReport.audit.issues.length > 30 && <p>Решта доступна в «Перевірка даних» після відновлення.</p>}</details>}
                            </>}
                            <p>Відновлення замінить дані й налаштування всіх модулів, а не доповнить їх. Поточний стан буде збережено окремо в зашифрованому вигляді з тим самим паролем. Закрийте інші вкладки програми.</p>
                            <label className="flex gap-2 items-start"><input type="checkbox" disabled={backupBusy} checked={restoreConfirmed} onChange={event => setRestoreConfirmed(event.target.checked)} />Я закрив інші вкладки та підтверджую заміну поточних даних</label>
                        </div>}
                    </>}
                    {backupBusy && <p role="status" className="text-[#4c8ed9] text-xs font-mono">Обробка… не закривайте програму.</p>}
                    {backupMessage && <p role="alert" className="text-xs whitespace-pre-wrap break-words rounded-sm border border-[#4c8ed9]/40 bg-[#4c8ed9]/10 px-3 py-2 text-[#e6edf3]">{backupMessage}</p>}
                    {restoreStarted && !backupBusy && !restoreComplete && <p className="text-xs text-[#fcd34d]">Модулі залишено зупиненими для захисту даних. Перезавантажте програму перед подальшою роботою.</p>}
                    </div>
                    <div className="px-5 py-3 bg-[#101113] border-t border-[#2e3138] flex gap-2 justify-end flex-wrap shrink-0">
                        {restoreStarted ? (!backupBusy && <button onClick={() => location.reload()} className="h-8 px-3.5 rounded-sm bg-[#2b67ab] hover:bg-[#3577c2] border border-[#4c8ed9] text-white font-semibold text-xs cursor-pointer">Перезавантажити програму</button>) : <>
                            <button disabled={backupBusy} onClick={closeBackup} className="h-8 px-3.5 rounded-sm bg-[#222429] hover:bg-[#282b31] border border-[#2e3138] text-xs font-semibold disabled:opacity-50 cursor-pointer">Закрити</button>
                            {backupMode === 'export' && <button disabled={backupBusy} onClick={handleBackup} className="h-8 px-3.5 rounded-sm bg-[#2b67ab] hover:bg-[#3577c2] border border-[#4c8ed9] text-white text-xs font-semibold disabled:opacity-50 cursor-pointer">Зашифрувати й завантажити</button>}
                            {backupMode === 'import' && !backupPreview && <button disabled={backupBusy || !backupSource} onClick={checkBackup} className="h-8 px-3.5 rounded-sm bg-[#2b67ab] hover:bg-[#3577c2] border border-[#4c8ed9] text-white text-xs font-semibold disabled:opacity-50 cursor-pointer">Перевірити файл</button>}
                            {backupPreview && <button disabled={backupBusy || !restoreConfirmed} onClick={handleRestore} className="h-8 px-3.5 rounded-sm bg-[#b91c1c] hover:bg-[#dc2626] border border-[#e05252]/60 text-white text-xs font-semibold disabled:opacity-50 cursor-pointer">Відновити всі дані</button>}
                        </>}
                    </div>
                </section>
            </div>}
        </div>
    );
};

export { RootApp };
