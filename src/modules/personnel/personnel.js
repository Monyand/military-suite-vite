import { lucide, XLSX } from '../../core/vendor.js';
import { SharedDictionaries } from '../../core/dictionary-service.js';

const createPersonnelModule = () => {
    if (window.TacticalModule) return;

        window.TacticalModule = (function() {
    

    // ─── ПЕРЕВІРКА ОФЛАЙНУ ПЕРЕД ЗАПУСКОМ ─────────────────────────────────────
    function bootstrapPersonnel() {
        if (typeof lucide === 'undefined') {
            document.getElementById('offline-setup-warning').style.display = 'block';
            document.getElementById('app-wrapper').style.display = 'none';
            document.body.className = '';
            document.body.style.backgroundColor = '#e5e7eb';
            return; 
        }
        
        runMigrations();
        rebuildPersonnelMap();
        initSelects();
        applyTheme();
        applySidebarState();
        buildPosCache();
        
        if (typeof sortRotations === 'function') sortRotations();
        
        updateRotationsBadge(); // БЕЗ ЗАТРИМКИ!
        
        renderTab(activeTab);
        
        checkBackupReminders();
        setInterval(checkBackupReminders, 60000);

        initTaktStorageAndSync();
    }

    // ─── УТИЛІТИ ──────────────────────────────────────────────────────────────
    const el  = id => document.getElementById(id);
    const val = id => el(id).value;

    function openModal(id)  { 
        const m = el(id);
        if (m) {
            m.style.display = 'flex';
            if (typeof lucide !== 'undefined') lucide.createIcons();
        }
    }
    function closeModal(id) { 
        const m = el(id);
        if (m) m.style.display = 'none'; 
    }

    // ─── ТЕМА ТА САЙДБАР ──────────────────────────────────────────────────────
    let isDarkMode = localStorage.getItem('tactical_dark_mode') !== 'false'; // Dark mode default
    let isSidebarCollapsed = localStorage.getItem('tactical_sidebar_collapsed') === 'true';

    function applyTheme() {
        if (isDarkMode) {
            document.documentElement.classList.add('dark');
        } else {
            document.documentElement.classList.remove('dark');
        }
    }

    function toggleDarkMode() {
        isDarkMode = !isDarkMode;
        if (window.SuiteRuntime?.setLocalItem) window.SuiteRuntime.setLocalItem('tactical_dark_mode', isDarkMode ? 'true' : 'false');
        else localStorage.setItem('tactical_dark_mode', isDarkMode ? 'true' : 'false');
        applyTheme();
        if (typeof lucide !== 'undefined') lucide.createIcons();
        showToast(isDarkMode ? 'Темну тему увімкнено' : 'Світлу тему увімкнено');
    }

    function applySidebarState() {
        const sb = el('sidebar');
        if (!sb) return;
        if (isSidebarCollapsed) {
            sb.classList.add('sidebar-collapsed');
            document.body.classList.add('sidebar-hidden');
        } else {
            sb.classList.remove('sidebar-collapsed');
            document.body.classList.remove('sidebar-hidden');
        }
    }

    function toggleSidebar() {
        isSidebarCollapsed = !isSidebarCollapsed;
        if (window.SuiteRuntime?.setLocalItem) window.SuiteRuntime.setLocalItem('tactical_sidebar_collapsed', isSidebarCollapsed ? 'true' : 'false');
        else localStorage.setItem('tactical_sidebar_collapsed', isSidebarCollapsed ? 'true' : 'false');
        applySidebarState();
        if (typeof lucide !== 'undefined') lucide.createIcons();
    }

    // ─── КОНСТАНТИ ────────────────────────────────────────────────────────────
    const RANKS = ['Солдат','Ст. солдат','Мл. сержант','Сержант','Ст. сержант','Мл. лейтенант','Лейтенант','Ст. лейтенант','Капітан','Майор'];
    const STATUSES = {
        '200':      { label: '200 (Загиблий)',     color: 'bg-[rgba(224,82,82,0.14)] text-[#fca5a5] border-[rgba(224,82,82,0.45)]',      icon: 'crosshair' },
        'mia':      { label: 'Зниклий',            color: 'bg-[#222429] text-[#b8bec8] border-[#3c404a]',                                  icon: 'alert-triangle' },
        '300':      { label: '300 (Поранений)',    color: 'bg-[rgba(234,88,12,0.14)] text-[#fdba74] border-[rgba(234,88,12,0.42)]',      icon: 'heart-pulse' },
        'sick':     { label: 'Хворий/травма',      color: 'bg-[rgba(217,155,38,0.12)] text-[#fcd34d] border-[rgba(217,155,38,0.40)]',    icon: 'activity' },
        'detached': { label: 'Відрив',             color: 'bg-[rgba(76,142,217,0.14)] text-[#93c5fd] border-[rgba(76,142,217,0.40)]',    icon: 'plane-takeoff' },
        'ok':       { label: 'В строю',            color: 'bg-[rgba(52,168,115,0.14)] text-[#6ee7b7] border-[rgba(52,168,115,0.40)]',    icon: 'shield' }
    };
    const STATUS_KEYS    = ['200', 'mia', '300', 'sick', 'detached', 'ok'];
    const POSITION_TYPES = [{id:'combat',label:'Бойова'},{id:'non_combat',label:'Не бойова'}];
    const COMBAT_TYPES   = new Set(['combat']);
    const ICONS          = ['crosshair','target','plane','flame','shield','radio','tent','plus-square','map-pin'];
    const ICON_MAP       = {combat:'crosshair',non_combat:'tent'};
    const TASKS          = ['піхота','бойовий медик','БПЛА','МБ','вогнева підтримка','облаштування','бронегрупа','резерв','медевак',"зв'язок",'провідник','рекон','ППО','Логістика','ІСВ','Штурмовик','*'];

    // ─── СТАН (БЕЗПЕЧНИЙ ЗАВАНТАЖУВАЧ ANTI-WSOD) ──────────────────────────────
    function safeGetJSON(key, fallback) {
        try {
            const raw = localStorage.getItem(key);
            if (!raw) return fallback;
            return JSON.parse(raw);
        } catch (e) {
            console.error(`Помилка читання ключа [${key}] з LocalStorage. Встановлено резервне значення.`, e);
            return fallback;
        }
    }

    let personnel          = safeGetJSON('tactical_personnel', []);
    let positions          = safeGetJSON('tactical_positions', [
        { id:'pos_ppd',  name:'ППД',                    type:'non_combat', rop:'Тилові',   icon:'tent',         equipment:[] },
        { id:'pos_hosp', name:'Госпіталь / Евакуація',   type:'non_combat', rop:'Медицина', icon:'plus-square', equipment:[] }
    ]);
    let logs               = safeGetJSON('tactical_logs', []);
    let journal            = safeGetJSON('tactical_journal', []);
    let plannedRotations   = safeGetJSON('tactical_rotations', []);
    let groupOrder         = safeGetJSON('tactical_groups_order', []);
    let collapsedGroups    = safeGetJSON('tactical_collapsed_groups', {});
    let collapsedPositions = safeGetJSON('tactical_collapsed_positions', {});

    let backupSchedule     = safeGetJSON('tactical_backup_schedule', ['10:00', '17:30', '20:00']);
    let lastBackupTime     = parseInt(localStorage.getItem('tactical_last_backup_time')) || 0;

    let isSortingLocked    = localStorage.getItem('tactical_sorting_locked') !== 'false';

    let activeTab           = 'dashboard';
    let currentPage         = 1;
    let itemsPerPage        = 50;
    let currentMoveSoldierId = null;
    let selectedMoveStatus   = '';
    let tempEquipment        = [];
    let searchTimeout;
    let journalSearchTimeout;
    let targetAddToPosId     = null;
    let currentPosIcon       = 'crosshair';

    // Змінні для Ctrl+Z
    let undoStack = [];
    let isUndoing = false;

    function updateUndoButton() {
        const btn = el('floating-undo-btn');
        if (btn) {
            if (undoStack.length > 0) { btn.classList.remove('hidden'); btn.classList.add('flex'); }
            else { btn.classList.add('hidden'); btn.classList.remove('flex'); }
        }
    }

    function getActiveRotationMap() {
        const activeMap = new Map();
        if (plannedRotations) {
            plannedRotations.forEach(rot => {
                rot.members.forEach(m => {
                    if (!isMemberDone(m)) activeMap.set(m.soldierId, m.dir);
                });
            });
        }
        return activeMap;
    }

    // ─── КЕШ ПОЗИЦІЙ (ПРОДУКТИВНІСТЬ) ─────────────────────────────────────────
    let posCache  = null;
    let posMap    = {};
    let groupedPosCache = {}; // ОПТИМІЗАЦІЯ: Кешуємо групи
    let _posDirty = true;

    let personnelMap = new Map();

    function rebuildPersonnelMap() {
        personnelMap.clear();
        personnel.forEach(p => personnelMap.set(p.id, p));
    }
    function getPersonById(id) { return personnelMap.get(id); }

    function buildPosCache() {
        if (!_posDirty) return;
        posMap = {};
        groupedPosCache = {};

        // 1. Будуємо мапу ID->Назва і групуємо локації
        positions.forEach(pos => {
            posMap[pos.id] = pos.name;
            const g = pos.rop?.trim() || 'Основні / Без групи';
            (groupedPosCache[g] = groupedPosCache[g] || []).push(pos);
        });

        // 2. Оновлюємо список груп (groupOrder), щоб там були всі існуючі групи
        Object.keys(groupedPosCache).forEach(g => { 
            if (!groupOrder.includes(g)) groupOrder.push(g); 
        });
        
        // 3. Чистимо groupOrder від порожніх (видалених) груп
        groupOrder = groupOrder.filter(g => groupedPosCache[g]);

        // 4. Створюємо плаский кеш для швидкого доступу
        posCache = [];
        groupOrder.forEach(gName => { posCache.push(...groupedPosCache[gName]); });
        
        _posDirty = false;
    }

    function getOrderedPositions() { buildPosCache(); return posCache; }
    function getPosName(id)        { buildPosCache(); return posMap[id] || 'Невідомо'; }
    function findBasePpdPosition() {
        return positions.find(p => p.id === 'pos_ppd')
            || positions.find(p => (p.name || '').toUpperCase().includes('ППД'))
            || positions.find(p => p.type === 'non_combat')
            || positions[0]
            || null;
    }

    // ─── КЕШОВАНІ ФОРМАТЕРИ ДАТ ───────────────────────────────────────────────
    const _dtFmt = new Intl.DateTimeFormat('uk-UA', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    const _dFmt  = new Intl.DateTimeFormat('uk-UA', { day: '2-digit', month: '2-digit', year: 'numeric' });

    function fmtDT(iso) {
        if (!iso) return '—';
        const parts = _dtFmt.formatToParts(new Date(iso));
        const p = {};
        parts.forEach(x => { p[x.type] = x.value; });
        return `${p.day}.${p.month} ${p.hour}:${p.minute}`;
    }
    function fmtDate(iso) {
        if (!iso) return '—';
        return _dFmt.format(new Date(iso));
    }
    function formatDuration(ms) {
        const safeMs = Math.max(0, ms || 0);
        const ds = Math.floor(safeMs / 86400000);
        const hs = Math.floor((safeMs % 86400000) / 3600000);
        const mins = Math.floor((safeMs % 3600000) / 60000);
        if (ds > 0) return `${ds}д ${hs}г`;
        if (hs > 0) return mins > 0 ? `${hs}г ${mins}хв` : `${hs}г`;
        return `${Math.max(1, mins)}хв`;
    }

    function toLocalISO(iso) {
        if (!iso) return '';
        const d = new Date(iso);
        return new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    }

    const ESC_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    function esc(str) {
        if (!str) return '';
        return String(str).replace(/[&<>"']/g, m => ESC_MAP[m]);
    }
    
    function jsEsc(str) { return JSON.stringify(str).replace(/"/g, '&quot;'); }

    const HOMOGLYPHS = { 'i': 'і', 'c': 'с', 'p': 'р', 'o': 'о', 'a': 'а', 'e': 'е', 'x': 'х', 'y': 'у', 'k': 'к', 'm': 'м', 't': 'т', 'b': 'в', 'h': 'н' };
    function normSearchText(str) {
        if (!str) return '';
        return String(str)
            .toLowerCase()
            .replace(/[\u2018\u2019\u02BC\u0060\u00B4']/g, "'")
            .replace(/[icpoaexykmtbh]/g, ch => HOMOGLYPHS[ch] || ch)
            .replace(/\s+/g, ' ')
            .trim();
    }
    function normPersonName(str) {
        return (str || '').toLowerCase().replace(/[\u2018\u2019\u02BC\u0060\u00B4']/g, "'").replace(/\s+/g, ' ').trim();
    }

    // ─── ІКОНКИ ───────────────────────────────────────────────────────────────
    function scheduleIcons() {
        if (typeof lucide !== 'undefined') {
            lucide.createIcons();
        }
    }

    // ─── CHIP FILTERS ────────────────────────────────────────────────────────
    let currentQuickStatus = 'all';

    function setQuickStatusFilter(statusKey) {
        currentQuickStatus = statusKey;
        const filterStatusSelect = el('filter-status');
        const filterPosSelect = el('filter-pos');
        
        if (statusKey === 'combat') {
            if (filterStatusSelect) filterStatusSelect.value = 'all';
            if (filterPosSelect) filterPosSelect.value = 'combat_only';
        } else {
            if (filterStatusSelect) filterStatusSelect.value = statusKey;
            if (filterPosSelect && filterPosSelect.value === 'combat_only') filterPosSelect.value = 'all';
        }
        
        updateChipActiveState();
        resetPageAndRender();
    }

    function updateChipActiveState() {
        document.querySelectorAll('.chip-btn').forEach(btn => {
            const st = btn.getAttribute('data-status');
            if (st === currentQuickStatus) {
                btn.className = 'chip-btn px-2.5 py-1 rounded-sm text-xs font-semibold tabular-nums transition-colors border bg-[#2b67ab] text-white border-[#4c8ed9] cursor-pointer inline-flex items-center gap-1.5';
            } else {
                btn.className = 'chip-btn px-2.5 py-1 rounded-sm text-xs font-semibold tabular-nums transition-colors border bg-[#222429] text-[#b8bec8] border-[#2e3138] hover:border-[#3c404a] hover:text-[#f3f4f6] cursor-pointer inline-flex items-center gap-1.5';
            }
        });
    }

    function updateChipCounts() {
        const total = personnel.length;
        const okCount = personnel.filter(p => p.status === 'ok').length;
        const c300Count = personnel.filter(p => p.status === '300').length;
        const sickCount = personnel.filter(p => p.status === 'sick').length;
        const detachedCount = personnel.filter(p => p.status === 'detached').length;
        
        const combatPosIds = new Set(positions.filter(p => p.type === 'combat').map(p => p.id));
        const combatCount = personnel.filter(p => combatPosIds.has(p.positionId)).length;
        
        if (el('chip-count-all')) el('chip-count-all').innerText = `(${total})`;
        if (el('chip-count-ok')) el('chip-count-ok').innerText = `(${okCount})`;
        if (el('chip-count-combat')) el('chip-count-combat').innerText = `(${combatCount})`;
        if (el('chip-count-300')) el('chip-count-300').innerText = `(${c300Count})`;
        if (el('chip-count-sick')) el('chip-count-sick').innerText = `(${sickCount})`;
        if (el('chip-count-detached')) el('chip-count-detached').innerText = `(${detachedCount})`;
    }

    // ─── INIT ТА СЛУХАЧІ КЛАВІШ ───────────────────────────────────────────────
    document.addEventListener('keydown', e => {
        if (e.key === 'Escape')
            document.querySelectorAll('.modal-overlay:not([style*="display: none"])').forEach(m => closeModal(m.id));
            
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return; 
            e.preventDefault();
            handleUndo();
        }
    });

    // ─── ТЕМИ / SIDEBAR ───────────────────────────────────────────────────────
    function toggleSortingLock() {
        isSortingLocked = !isSortingLocked;
        if (window.SuiteRuntime?.setLocalItem) window.SuiteRuntime.setLocalItem('tactical_sorting_locked', isSortingLocked); else localStorage.setItem('tactical_sorting_locked', isSortingLocked);
        renderPositions();
    }

    // ─── ЗБЕРЕЖЕННЯ ───────────────────────────────────────────────────────────
    function saveLocalUI() {
        if (window.SuiteRuntime?.setLocalItem) {
            window.SuiteRuntime.setLocalItem('tactical_collapsed_groups',    JSON.stringify(collapsedGroups));
            window.SuiteRuntime.setLocalItem('tactical_collapsed_positions', JSON.stringify(collapsedPositions));
        } else {
            localStorage.setItem('tactical_collapsed_groups',    JSON.stringify(collapsedGroups));
            localStorage.setItem('tactical_collapsed_positions', JSON.stringify(collapsedPositions));
        }
    }

    // ─── ТРЬОХРІВНЕВЕ ЗБЕРЕЖЕННЯ (LOCALSTORAGE + INDEXEDDB + ДИСПЕТЧЕР) ────────
    const IDB_TAKT_CONFIG = {
        dbName: 'TacticalTaktDB_v1',
        storeName: 'takt_state_store',
        version: 1
    };

    function openTaktIndexedDB() {
        return new Promise((resolve, reject) => {
            if (!window.indexedDB) {
                return reject(new Error("IndexedDB не підтримується"));
            }
            const request = window.indexedDB.open(IDB_TAKT_CONFIG.dbName, IDB_TAKT_CONFIG.version);
            request.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains(IDB_TAKT_CONFIG.storeName)) {
                    db.createObjectStore(IDB_TAKT_CONFIG.storeName, { keyPath: 'id' });
                }
            };
            request.onsuccess = () => resolve(request.result);
            request.onerror = (e) => reject(e.target.error);
        });
    }

    async function saveToTaktIndexedDB(stateData) {
        try {
            const db = await openTaktIndexedDB();
            return new Promise((resolve, reject) => {
                const tx = db.transaction([IDB_TAKT_CONFIG.storeName], 'readwrite');
                const store = tx.objectStore(IDB_TAKT_CONFIG.storeName);
                const record = {
                    id: 'current_state',
                    data: stateData,
                    updatedAt: Date.now()
                };
                store.put(record);
                tx.oncomplete = () => resolve(true);
                tx.onerror = (e) => reject(e.target.error);
            });
        } catch (err) {
            console.warn("[IndexedDB] Помилка збереження Такт-Облік:", err);
        }
    }

    async function loadFromTaktIndexedDB() {
        try {
            const db = await openTaktIndexedDB();
            return new Promise((resolve, reject) => {
                const tx = db.transaction([IDB_TAKT_CONFIG.storeName], 'readonly');
                const store = tx.objectStore(IDB_TAKT_CONFIG.storeName);
                const req = store.get('current_state');
                req.onsuccess = () => resolve(req.result ? req.result.data : null);
                req.onerror = (e) => reject(e.target.error);
            });
        } catch (err) {
            console.warn("[IndexedDB] Помилка завантаження Такт-Облік:", err);
            return null;
        }
    }

    async function clearTaktIndexedDB() {
        try {
            const db = await openTaktIndexedDB();
            return new Promise((resolve, reject) => {
                const tx = db.transaction([IDB_TAKT_CONFIG.storeName], 'readwrite');
                const store = tx.objectStore(IDB_TAKT_CONFIG.storeName);
                store.clear();
                tx.oncomplete = () => resolve(true);
                tx.onerror = (e) => reject(e.target.error);
            });
        } catch (err) {
            console.warn("[IndexedDB] Помилка очищення Такт-Облік:", err);
        }
    }

    // Рівень 3: Dispatcher Disk Sync Bridge (_backups/takt_oblik_latest.json)
    const DISPATCHER_API_BASE = 'http://127.0.0.1:8780/api/backup';
    let diskServiceOnline = false;
    let lastDiskBackupTime = null;
    let diskSaveDebounceTimer = null;

    function updateDiskStatusUI(status, labelText) {
        const btn = document.getElementById('diskSyncBtn');
        const dot = document.getElementById('diskSyncDot');
        const label = document.getElementById('diskSyncLabel');
        if (!btn || !dot || !label) return;

        if (status === 'synced') {
            diskServiceOnline = true;
            dot.className = "w-2 h-2 rounded-full bg-[#34a873] shrink-0";
            label.innerText = labelText || (lastDiskBackupTime ? `Диск: ${lastDiskBackupTime}` : 'Диск: Збережено');
            btn.className = "w-full flex items-center space-x-2.5 px-3 py-2 bg-[rgba(52,168,115,0.12)] hover:bg-[rgba(52,168,115,0.20)] text-[#6ee7b7] border border-[rgba(52,168,115,0.38)] rounded-sm text-xs font-mono tabular-nums font-medium transition-colors justify-center md:justify-start cursor-pointer";
            btn.title = `Фізичний диск синхронізовано (${lastDiskBackupTime || 'ОК'}). Натисніть для перевірки.`;
        } else if (status === 'saving') {
            dot.className = "w-2 h-2 rounded-full bg-[#d99b26] shrink-0";
            label.innerText = labelText || "Диск: Запис...";
            btn.className = "w-full flex items-center space-x-2.5 px-3 py-2 bg-[rgba(217,155,38,0.12)] hover:bg-[rgba(217,155,38,0.20)] text-[#fcd34d] border border-[rgba(217,155,38,0.40)] rounded-sm text-xs font-mono tabular-nums font-medium transition-colors justify-center md:justify-start cursor-pointer";
            btn.title = "Збереження копії на жорсткий диск...";
        } else if (status === 'checking') {
            dot.className = "w-2 h-2 rounded-full bg-[#4c8ed9] shrink-0";
            label.innerText = labelText || "Диск: Зв'язок...";
            btn.className = "w-full flex items-center space-x-2.5 px-3 py-2 bg-[#17181b] hover:bg-[#222429] text-[#b8bec8] border border-[#2e3138] rounded-sm text-xs font-mono tabular-nums font-medium transition-colors justify-center md:justify-start cursor-pointer";
        } else {
            diskServiceOnline = false;
            dot.className = "w-2 h-2 rounded-full bg-[#989fa9] shrink-0";
            label.innerText = labelText || "Диск: Офлайн";
            btn.className = "w-full flex items-center space-x-2.5 px-3 py-2 bg-[#17181b] hover:bg-[#222429] text-[#989fa9] border border-[#2e3138] rounded-sm text-xs font-mono tabular-nums font-medium transition-colors justify-center md:justify-start cursor-pointer";
            btn.title = "Диспетчер офлайн. Запустіть Запустити_Диспетчер.bat";
        }
        if (typeof lucide !== 'undefined') lucide.createIcons();
    }

    async function checkDiskBackupStatus(interactive = false) {
        try {
            updateDiskStatusUI('checking');
            const res = await fetch(`${DISPATCHER_API_BASE}/latest?app=takt_oblik`, { cache: 'no-cache' });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            
            if (data && data.exists) {
                lastDiskBackupTime = data.formatted_time || 'Збережено';
                const timeOnly = data.formatted_time ? data.formatted_time.split(' ')[1] : 'ОК';
                updateDiskStatusUI('synced', `Диск: ${timeOnly}`);
                if (interactive) {
                    showToast(`Диск активний! Останній бекап: ${data.formatted_time || data.filename}`);
                }
                return data;
            } else {
                diskServiceOnline = true;
                updateDiskStatusUI('synced', 'Диск: Готовий');
                if (personnel && personnel.length > 0) {
                    saveToDiskBackup(true);
                }
                if (interactive) {
                    showToast("Диспетчер активний. Бекап на диску готовий до запису.");
                }
                return { exists: false, online: true };
            }
        } catch (err) {
            updateDiskStatusUI('offline');
            if (interactive) {
                showToast("Диспетчер офлайн. Запустіть Запустити_Диспетчер.bat");
            }
            return { exists: false, online: false };
        }
    }

    function getTaktStatePayload() {
        return {
            personnel,
            positions,
            logs,
            journal,
            groupOrder,
            plannedRotations,
            collapsedGroups,
            collapsedPositions
        };
    }

    function saveToDiskBackup(immediate = false) {
        if (diskSaveDebounceTimer) clearTimeout(diskSaveDebounceTimer);
        const delay = immediate ? 0 : 800;

        diskSaveDebounceTimer = setTimeout(async () => {
            if (!personnel || (personnel.length === 0 && positions.length <= 2)) return;
            try {
                updateDiskStatusUI('saving');
                const payload = JSON.stringify({
                    app: 'takt_oblik',
                    content: JSON.stringify(getTaktStatePayload(), null, 2)
                });
                const res = await fetch(`${DISPATCHER_API_BASE}/save`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: payload
                });
                if (res.ok) {
                    const now = new Date();
                    lastDiskBackupTime = now.toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
                    updateDiskStatusUI('synced');
                } else {
                    updateDiskStatusUI('offline');
                }
            } catch (err) {
                updateDiskStatusUI('offline');
            }
        }, delay);
    }

    async function forceSaveToDisk() {
        if (!personnel || personnel.length === 0) {
            showToast("База особового складу порожня, немає що зберігати на диск");
            return;
        }
        showToast("Збереження на фізичний диск...");
        saveToDiskBackup(true);
        setTimeout(() => {
            checkDiskBackupStatus(true);
        }, 500);
    }

    async function restoreFromDiskBackup() {
        showToast("Перевірка найсвіжішої копії на диску...");
        const data = await checkDiskBackupStatus(false);
        if (!data || !data.exists || !data.content) {
            alert("На диску ще немає збереженої копії бази Такт-Облік (або Диспетчер вимкнено).\n\nЗапустіть Диспетчер через «Запустити_Диспетчер.bat».");
            return;
        }
        try {
            let parsed;
            let raw = data.content.trim();
            if (raw.startsWith('TACT_ENC_V1:')) {
                const pwd = prompt("Ця резервна копія на диску зашифрована паролем. Введіть пароль:");
                if (!pwd) return;
                const b64 = raw.replace('TACT_ENC_V1:', '');
                const dec = await decryptData(b64, pwd);
                parsed = JSON.parse(dec);
            } else {
                parsed = JSON.parse(raw);
            }

            if (parsed && Array.isArray(parsed.personnel)) {
                if (confirm(`Знайдено збережену копію від ${data.formatted_time || 'нещодавно'} (${parsed.personnel.length} бійців, ${parsed.positions ? parsed.positions.length : 0} позицій).\n\nВідновити цю базу з диска?`)) {
                    loadDataFromJsonString(typeof raw === 'string' && !raw.startsWith('TACT_ENC_V1:') ? raw : JSON.stringify(parsed));
                    showToast(`Базу успішно відновлено з диска (${parsed.personnel.length} осіб)!`);
                }
            } else {
                alert("Помилка структури файлу на диску: відсутній масив personnel.");
            }
        } catch (e) {
            console.error("Помилка читання бекапу з диска:", e);
            alert("Помилка читання резервної копії з диска: " + e.message);
        }
    }

    async function initTaktStorageAndSync() {
        // Якщо LocalStorage виявився порожнім (після скидання кешу чи зміни браузера), відновлюємо з IndexedDB або диска
        if (!personnel || personnel.length === 0) {
            try {
                const idbState = await loadFromTaktIndexedDB();
                if (idbState && Array.isArray(idbState.personnel) && idbState.personnel.length > 0) {
                    console.log("[Auto-Hydrate] Відновлено дані з IndexedDB:", idbState.personnel.length, "бійців");
                    personnel = idbState.personnel;
                    if (idbState.positions && idbState.positions.length > 0) positions = idbState.positions;
                    if (idbState.logs) logs = idbState.logs;
                    if (idbState.journal) journal = idbState.journal;
                    if (idbState.groupOrder) groupOrder = idbState.groupOrder;
                    if (idbState.plannedRotations) plannedRotations = idbState.plannedRotations;
                    if (idbState.collapsedGroups) collapsedGroups = idbState.collapsedGroups;
                    if (idbState.collapsedPositions) collapsedPositions = idbState.collapsedPositions;
                    
                    _posDirty = true;
                    runMigrations();
                    rebuildPersonnelMap();
                    saveState();
                    showToast(`Дані автоматично відновлено з IndexedDB (${personnel.length} осіб)!`);
                    checkDiskBackupStatus(false);
                    return;
                }
            } catch (e) {
                console.warn("[Auto-Hydrate] Помилка завантаження з IndexedDB:", e);
            }

            // Якщо й в IndexedDB порожньо, перевіримо диск через Диспетчер
            try {
                const diskData = await checkDiskBackupStatus(false);
                if (diskData && diskData.exists && diskData.content && !diskData.content.startsWith('TACT_ENC_V1:')) {
                    const parsed = JSON.parse(diskData.content);
                    if (parsed && Array.isArray(parsed.personnel) && parsed.personnel.length > 0) {
                        console.log("[Auto-Hydrate] Авто-відновлення з диска Диспетчера:", parsed.personnel.length, "бійців");
                        loadDataFromJsonString(diskData.content);
                        showToast(`Дані автоматично відновлено з диску Диспетчера (${parsed.personnel.length} осіб)!`);
                        return;
                    }
                }
            } catch (e) {
                console.warn("[Auto-Hydrate] Помилка авто-відновлення з диска:", e);
            }
        }

        // Завжди перевіряємо стан диска на старті
        checkDiskBackupStatus(false);
    }

    function saveStateSilent() {
        if (typeof sortRotations === 'function') sortRotations();

        if (!isUndoing) {
            undoStack.push({
                personnel: JSON.stringify(personnel),
                positions: JSON.stringify(positions),
                logs: JSON.stringify(logs),
                journal: JSON.stringify(journal),
                groupOrder: JSON.stringify(groupOrder),
                rotations: JSON.stringify(plannedRotations)
            });
            if (undoStack.length > 15) undoStack.shift();
        }

        const stateObj = getTaktStatePayload();

        try {
            if (window.SuiteRuntime?.setLocalItem) {
                window.SuiteRuntime.setLocalItem('tactical_personnel',    JSON.stringify(personnel));
                window.SuiteRuntime.setLocalItem('tactical_positions',    JSON.stringify(positions));
                window.SuiteRuntime.setLocalItem('tactical_logs',         JSON.stringify(logs));
                window.SuiteRuntime.setLocalItem('tactical_journal',      JSON.stringify(journal));
                window.SuiteRuntime.setLocalItem('tactical_groups_order', JSON.stringify(groupOrder));
                window.SuiteRuntime.setLocalItem('tactical_rotations',    JSON.stringify(plannedRotations));
            } else {
                localStorage.setItem('tactical_personnel',    JSON.stringify(personnel));
                localStorage.setItem('tactical_positions',    JSON.stringify(positions));
                localStorage.setItem('tactical_logs',         JSON.stringify(logs));
                localStorage.setItem('tactical_journal',      JSON.stringify(journal));
                localStorage.setItem('tactical_groups_order', JSON.stringify(groupOrder));
                localStorage.setItem('tactical_rotations',    JSON.stringify(plannedRotations));
            }
        } catch (err) {
            console.error('Помилка запису в LocalStorage (переповнення квоти):', err);
            showToast("УВАГА: Пам'ять сховища переповнена! Зробіть терміновий бекап.");
        }

        // Рівень 2: Збереження в IndexedDB (без обмеження 5МБ, стійке до закриття сесій)
        saveToTaktIndexedDB(stateObj);

        // Рівень 3: Автоматичний фоновий бекап на жорсткий диск через Диспетчер
        saveToDiskBackup(false);
        
        updateUndoButton();
        if (typeof updateRotationsBadge === 'function') updateRotationsBadge();
    }

    function saveState(tabsToRender = [activeTab]) {
        saveStateSilent();
        tabsToRender.forEach(tab => renderTab(tab));
    }

    function handleUndo() {
        if (undoStack.length === 0) return showToast('Немає дій для скасування');
        
        isUndoing = true;
        const snap = undoStack.pop();
        
        personnel        = JSON.parse(snap.personnel);
        positions        = JSON.parse(snap.positions);
        logs             = JSON.parse(snap.logs);
        journal          = JSON.parse(snap.journal);
        groupOrder       = JSON.parse(snap.groupOrder);
        plannedRotations = JSON.parse(snap.rotations);

        _posDirty = true;
        rebuildPersonnelMap();
        saveStateSilent();
        
        renderTab(activeTab);
        if (activeTab === 'dashboard') renderRotationsWidget();
        
        isUndoing = false;
        updateUndoButton();
        showToast('Дію скасовано (Ctrl+Z)');
    }

    // ─── ЛОГИ / ТОСТ ──────────────────────────────────────────────────────────
    function addLog(msg, name) {
        logs.unshift({ id: Date.now().toString(), timestamp: new Date().toISOString(), message: msg, callsign: name });
        if (logs.length > 500) logs.length = 500;
    }

    let toastTimer;
    function showToast(msg) {
        const toastEl = el('toast');
        if (!toastEl) return;
        toastEl.classList.remove('top-4');
        toastEl.classList.add('top-16');
        el('toast-msg').innerText = msg;
        toastEl.classList.remove('hidden');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => toastEl.classList.add('hidden'), 3000);
    }

    // ─── ШВИДКЕ КОПІЮВАННЯ В БУФЕР ───────────────────────────────────────────
    function copyToClipboard(text, customLabel = '') {
        if (!text) return;
        const notify = () => {
            showToast(customLabel ? customLabel : `Скопійовано: ${text}`);
        };

        if (navigator.clipboard && window.isSecureContext) {
            navigator.clipboard.writeText(text).then(notify).catch(() => fallbackCopy(text, customLabel));
        } else {
            fallbackCopy(text, customLabel);
        }
    }

    function fallbackCopy(text, customLabel = '') {
        try {
            const ta = document.createElement('textarea');
            ta.value = text;
            ta.style.position = 'fixed';
            ta.style.left = '-9999px';
            ta.style.top = '-9999px';
            document.body.appendChild(ta);
            ta.focus();
            ta.select();
            document.execCommand('copy');
            document.body.removeChild(ta);
            showToast(customLabel ? customLabel : `Скопійовано: ${text}`);
        } catch (e) {
            showToast('Помилка копіювання в буфер');
        }
    }

    function copySoldierPib(sId) {
        const s = getPersonById(sId);
        if (!s) return;
        const pib = s.fullName || s.callsign || '';
        if (!pib) return showToast('ПІБ відсутнє');
        copyToClipboard(pib, `Скопійовано ПІБ: ${pib}`);
    }

    function copySoldierFull(sId) {
        const s = getPersonById(sId);
        if (!s) return;
        const parts = [];
        if (s.rank) parts.push(s.rank);
        if (s.fullName) parts.push(s.fullName);
        if (s.callsign) parts.push(`("${s.callsign}")`);
        if (s.unit) parts.push(`• ${s.unit}`);
        const posName = getPosName(s.positionId);
        if (posName) parts.push(`• [${posName}]`);
        if (s.currentTask) parts.push(`(${s.currentTask})`);
        const fullInfo = parts.join(' ');
        copyToClipboard(fullInfo, `Скопійовано картку бійця`);
    }

    function copyPositionPersonnel(posId) {
        const pos = positions.find(p => p.id === posId);
        if (!pos) return;
        const sol = personnel.filter(p => p.positionId === posId && p.status === 'ok').sort((a, b) => {
            if (pos.commanderId === a.id) return -1;
            if (pos.commanderId === b.id) return 1;
            return 0;
        });

        if (sol.length === 0) return showToast('Позиція порожня');

        const lines = [];
        lines.push(`📍 ${pos.name} (${sol.length} чол.):`);
        sol.forEach((s, idx) => {
            const isCom = pos.commanderId === s.id;
            const star = isCom ? ' ⭐' : '';
            const rankStr = s.rank ? s.rank + ' ' : '';
            const nameStr = s.fullName || s.callsign || 'Невідомий';
            const callStr = (s.callsign && s.fullName) ? ` ("${s.callsign}")` : '';
            const taskStr = (s.currentTask && s.currentTask !== 'піхота') ? ` — ${s.currentTask}` : '';
            const unitStr = s.unit ? ` [${s.unit}]` : '';
            lines.push(`${idx + 1}. ${rankStr}${nameStr}${callStr}${unitStr}${taskStr}${star}`);
        });

        copyToClipboard(lines.join('\n'), `Скопійовано о/с позиції «${pos.name}» (${sol.length} чол.)`);
    }

    // ─── WEB CRYPTO API (НАТИВНЕ ШИФРУВАННЯ БЕЗ ІНТЕРНЕТУ) ────────────────────
    async function deriveKey(password, salt) {
        const enc = new TextEncoder();
        const keyMaterial = await crypto.subtle.importKey(
            "raw", enc.encode(password), { name: "PBKDF2" }, false, ["deriveKey"]
        );
        return crypto.subtle.deriveKey(
            { name: "PBKDF2", salt: salt, iterations: 100000, hash: "SHA-256" },
            keyMaterial, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]
        );
    }

    async function encryptData(plainText, password) {
        const enc = new TextEncoder();
        const salt = crypto.getRandomValues(new Uint8Array(16));
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const key = await deriveKey(password, salt);
        const encrypted = await crypto.subtle.encrypt(
            { name: "AES-GCM", iv: iv }, key, enc.encode(plainText)
        );
        const combined = new Uint8Array(salt.byteLength + iv.byteLength + encrypted.byteLength);
        combined.set(salt, 0);
        combined.set(iv, salt.byteLength);
        combined.set(new Uint8Array(encrypted), salt.byteLength + iv.byteLength);
        
        let binary = '';
        for (let i = 0; i < combined.byteLength; i++) {
            binary += String.fromCharCode(combined[i]);
        }
        return btoa(binary);
    }

    async function decryptData(base64Data, password) {
        const raw = atob(base64Data);
        const combined = new Uint8Array(new ArrayBuffer(raw.length));
        for (let i = 0; i < raw.length; i++) combined[i] = raw.charCodeAt(i);
        
        const salt = combined.slice(0, 16);
        const iv = combined.slice(16, 28);
        const encrypted = combined.slice(28);
        
        const key = await deriveKey(password, salt);
        const decrypted = await crypto.subtle.decrypt(
            { name: "AES-GCM", iv: iv }, key, encrypted
        );
        const dec = new TextDecoder();
        return dec.decode(decrypted);
    }

    // ─── ЕКСПОРТ / ІМПОРТ З ШИФРУВАННЯМ ───────────────────────────────────────
    function openExportModal() {
        el('export-pwd').value = '';
        openModal('modal-export-password');
    }

    async function executeEncryptedExport(e) {
        e.preventDefault();
        const pwd = val('export-pwd');
        if (!pwd) return showToast('Введіть пароль!');
        
        showToast('Шифрування даних...');
        closeModal('modal-export-password');

        try {
            const dataObj = { personnel, positions, logs, journal, groupOrder, plannedRotations };
            const jsonStr = JSON.stringify(dataObj);
            
            const encryptedBase64 = await encryptData(jsonStr, pwd);
            const finalFileContent = `TACT_ENC_V1:${encryptedBase64}`;
            
            // Отримуємо локальний час пристрою, а не UTC (по Гринвічу)
            const d = new Date();
            const pad = n => n.toString().padStart(2, '0');
            const nowStr = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}`;
            
            const a = document.createElement('a');
            a.href = URL.createObjectURL(new Blob([finalFileContent], { type: 'text/plain' }));
            a.download = `takt_backup_${nowStr}.enc`;
            a.click();
            setTimeout(() => URL.revokeObjectURL(a.href), 1000);
            
            lastBackupTime = Date.now();
            if (window.SuiteRuntime?.setLocalItem) window.SuiteRuntime.setLocalItem('tactical_last_backup_time', lastBackupTime.toString()); else localStorage.setItem('tactical_last_backup_time', lastBackupTime.toString());
            checkBackupReminders(); 
            
            showToast('Зашифрована копія збережена!');
        } catch (err) {
            console.error("Деталі помилки шифрування:", err);
            if (!window.isSecureContext) {
                showToast('Помилка: Браузер вимагає HTTPS або локальний файл (file://)');
            } else {
                showToast('Помилка шифрування! Перевірте консоль (F12).');
            }
        }
    }

    let pendingImportFile = null;

    function handleFileSelect(e) {
        const f = e.target.files[0]; 
        if (!f) return;
        pendingImportFile = f;
        
        if (f.name.endsWith('.enc')) {
            el('import-pwd').value = '';
            openModal('modal-import-password');
        } else if (f.name.endsWith('.json')) {
            processUnencryptedImport(f);
        } else {
            showToast('Невідомий формат файлу');
        }
        e.target.value = '';
    }

    function closeImportPasswordModal() {
        pendingImportFile = null;
        closeModal('modal-import-password');
    }

    async function executeEncryptedImport(e) {
        e.preventDefault();
        const pwd = val('import-pwd');
        if (!pwd || !pendingImportFile) return;

        showToast('Розшифровка...');
        closeModal('modal-import-password');

        const reader = new FileReader();
        reader.onload = async (ev) => {
            try {
                const content = ev.target.result;
                if (!content.startsWith('TACT_ENC_V1:')) {
                    throw new Error('Невірний формат зашифрованого файлу');
                }
                const b64 = content.split('TACT_ENC_V1:')[1];
                const decJsonStr = await decryptData(b64, pwd);
                loadDataFromJsonString(decJsonStr);
            } catch (err) {
                console.error(err);
                showToast('Помилка! Невірний пароль або пошкоджений файл.');
            }
        };
        reader.readAsText(pendingImportFile);
        pendingImportFile = null;
    }

    function processUnencryptedImport(file) {
        const reader = new FileReader();
        reader.onload = (ev) => {
            try {
                loadDataFromJsonString(ev.target.result);
            } catch (err) {
                showToast('Помилка: невірний файл JSON');
            }
        };
        reader.readAsText(file);
    }

    function loadDataFromJsonString(jsonStr) {
        const d = JSON.parse(jsonStr);
        if (!d || typeof d !== 'object' || !Array.isArray(d.personnel)) {
            throw new Error('Невірна структура файлу бекапу (відсутній список о/с)');
        }
        personnel          = d.personnel;
        positions          = Array.isArray(d.positions) && d.positions.length > 0 ? d.positions : [
            { id:'pos_ppd',  name:'ППД',                    type:'non_combat', rop:'Тилові',   icon:'tent',         equipment:[] },
            { id:'pos_hosp', name:'Госпіталь / Евакуація',   type:'non_combat', rop:'Медицина', icon:'plus-square', equipment:[] }
        ];
        logs               = Array.isArray(d.logs) ? d.logs : [];
        journal            = Array.isArray(d.journal) ? d.journal : [];
        plannedRotations   = Array.isArray(d.plannedRotations) ? d.plannedRotations : [];
        groupOrder         = Array.isArray(d.groupOrder) ? d.groupOrder : [];
        if (d.collapsedGroups) collapsedGroups = d.collapsedGroups;
        if (d.collapsedPositions) collapsedPositions = d.collapsedPositions;
        
        _posDirty = true;
        runMigrations();
        rebuildPersonnelMap();
        saveState();
        showToast('Дані успішно відновлено!');
    }

    // ─── ОЧИЩЕННЯ БАЗИ ДАНИХ (БЕЗПЕКА) ────────────────────────────────────────
    function wipeAllDataPrompt() {
        askConfirm('УВАГА! Ви збираєтесь ПОВНІСТЮ ВИДАЛИТИ всі дані з цього пристрою. Ви точно зробили та зберегли бекап?', () => {
            if (confirm('Остаточне попередження! Знищити всі бойові дані в цьому браузері? Дію неможливо скасувати.')) {
                wipeAllData();
            }
        });
    }

    function wipeAllData() {
        const keys = [
            'tactical_personnel', 'tactical_positions', 'tactical_logs',
            'tactical_journal', 'tactical_groups_order',
            'tactical_collapsed_groups', 'tactical_collapsed_positions',
            'tactical_last_backup_time', 'tactical_rotations', 'tactical_sorting_locked'
        ];
        keys.forEach(k => {
            if (window.SuiteRuntime?.removeLocalItem) window.SuiteRuntime.removeLocalItem(k);
            else localStorage.removeItem(k);
        });
        clearTaktIndexedDB();

        personnel = [];
        positions = [
            { id:'pos_ppd',  name:'ППД',              type:'non_combat',     rop:'Тилові',   icon:'tent',         equipment:[] },
            { id:'pos_hosp', name:'Госпіталь / Евакуація',   type:'non_combat', rop:'Медицина', icon:'plus-square', equipment:[] }
        ];
        logs = []; journal = []; groupOrder = []; collapsedGroups = {}; collapsedPositions = {}; plannedRotations = [];
        isSortingLocked = true;

        _posDirty = true;
        rebuildPersonnelMap();
        switchTab('dashboard');
        
        lastBackupTime = 0;
        checkBackupReminders();
        
        showToast('БАЗУ ДАНИХ ПОВНІСТЮ ЗНИЩЕНО!');
    }

    // ─── СИСТЕМА НАГАДУВАНЬ ПРО БЕКАП ─────────────────────────────────────────
    function openBackupSettingsModal() {
        renderBackupTimesList();
        el('new-backup-time').value = '';
        openModal('modal-backup-settings');
    }

    function renderBackupTimesList() {
        const list = el('backup-times-list');
        if (!backupSchedule || backupSchedule.length === 0) {
            list.innerHTML = '<li class="text-sm text-[#989fa9] text-center py-2">Нагадувань немає</li>';
            return;
        }
        
        backupSchedule.sort((a, b) => a.localeCompare(b));
        
        list.innerHTML = backupSchedule.map((time, idx) => `
            <li class="flex justify-between items-center bg-[#101113] p-2 rounded-sm border border-[#2e3138]">
                <span class="font-bold font-mono tabular-nums text-[#f3f4f6] text-base ml-2"><i data-lucide="clock" class="w-4 h-4 inline mr-1.5 text-[#4c8ed9]"></i>${time}</span>
                <button onclick="removeBackupTime(${idx})" class="p-1.5 text-[#fca5a5] hover:bg-[rgba(224,82,82,0.16)] rounded-sm cursor-pointer"><i data-lucide="trash-2" class="w-4 h-4"></i></button>
            </li>
        `).join('');
        scheduleIcons();
    }

    function addBackupTime() {
        const timeVal = val('new-backup-time');
        if (!timeVal) return showToast('Виберіть час!');
        if (backupSchedule.includes(timeVal)) return showToast('Такий час вже є!');
        
        backupSchedule.push(timeVal);
        if (window.SuiteRuntime?.setLocalItem) window.SuiteRuntime.setLocalItem('tactical_backup_schedule', JSON.stringify(backupSchedule)); else localStorage.setItem('tactical_backup_schedule', JSON.stringify(backupSchedule));
        renderBackupTimesList();
        checkBackupReminders();
        el('new-backup-time').value = '';
    }

    function removeBackupTime(idx) {
        backupSchedule.splice(idx, 1);
        if (window.SuiteRuntime?.setLocalItem) window.SuiteRuntime.setLocalItem('tactical_backup_schedule', JSON.stringify(backupSchedule)); else localStorage.setItem('tactical_backup_schedule', JSON.stringify(backupSchedule));
        renderBackupTimesList();
        checkBackupReminders();
    }

    function checkBackupReminders() {
        if (window.SuiteRuntime.restoring) return;
        const banner = el('backup-reminder-banner');
        if (!backupSchedule || backupSchedule.length === 0) {
            banner.classList.add('hidden');
            banner.classList.remove('flex');
            return;
        }

        const now = new Date();
        const lastBackupDate = new Date(lastBackupTime);
        let shouldRemind = false;

        for (let timeStr of backupSchedule) {
            const [hours, minutes] = timeStr.split(':').map(Number);
            const scheduledTimeToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hours, minutes, 0);
            
            if (now >= scheduledTimeToday && lastBackupDate < scheduledTimeToday) {
                shouldRemind = true;
                break;
            }
        }

        if (shouldRemind) {
            banner.classList.remove('hidden');
            banner.classList.add('flex');
        } else {
            banner.classList.add('hidden');
            banner.classList.remove('flex');
        }
    }

    function applyStyles(ws, opts = {}) {
        if (!ws['!ref']) return ws;
        const range = XLSX.utils.decode_range(ws['!ref']);
        const colWidths = [];
        const thinBorder = {
            top: { style: "thin", color: { rgb: "CBD5E1" } },
            bottom: { style: "thin", color: { rgb: "CBD5E1" } },
            left: { style: "thin", color: { rgb: "CBD5E1" } },
            right: { style: "thin", color: { rgb: "CBD5E1" } }
        };

        for (let R = range.s.r; R <= range.e.r; ++R) {
            for (let C = range.s.c; C <= range.e.c; ++C) {
                const cellRef = XLSX.utils.encode_cell({ c: C, r: R });
                const cell = ws[cellRef];
                if (!cell) continue;

                if (!cell.s) cell.s = {};
                if (!cell.s.font) cell.s.font = { name: "Times New Roman", sz: 12 };
                cell.s.border = thinBorder;

                // Заголовки (перший рядок + додаткові)
                if (R === 0 || (opts.extraHeaderRows && opts.extraHeaderRows.includes(R))) {
                    cell.s.font.bold = true;
                    cell.s.font.color = { rgb: "FFFFFF" };
                    cell.s.fill = { fgColor: { rgb: "1E293B" } };
                    cell.s.alignment = { horizontal: "center", vertical: "center" };
                } else {
                    // Кастомні налаштування для даних
                    if (opts.boldCols && opts.boldCols.includes(C)) cell.s.font.bold = true;
                    if (opts.centerCols && opts.centerCols.includes(C)) cell.s.alignment = { ...(cell.s.alignment || {}), horizontal: "center" };
                    if (opts.commanderCells && opts.commanderCells.includes(cellRef)) {
                        cell.s.font.bold = true;
                        cell.s.fill = { fgColor: { rgb: "FEF3C7" } };
                    }
                }

                // Розрахунок оптимальної ширини колонки
                const valStr = cell.v != null ? cell.v.toString() : '';
                let len = valStr.length;
                if (R === 0 || (opts.extraHeaderRows && opts.extraHeaderRows.includes(R))) len += 4; else len += 2;
                if ((opts.boldCols && opts.boldCols.includes(C)) || (opts.commanderCells && opts.commanderCells.includes(cellRef))) len += 1;

                colWidths[C] = Math.max(colWidths[C] || 10, Math.min(len, 60)); // мін 10, макс 60 символів
            }
        }
        
        ws['!cols'] = colWidths.map(w => ({ wch: w }));
        ws['!views'] = [{ state: 'frozen', ySplit: 1 }];
        if (!opts.noAutoFilter && range.e.r > 0) {
            ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: 0, c: range.e.c } }) };
        }
        return ws;
    }

    // ─── EXCEL EXPORTS ────────────────────────────────────────────────────────
    function exportDetailedReport() {
        if (typeof XLSX === 'undefined') return showToast('Бібліотека Excel недоступна');
        
        const activePos = getOrderedPositions().filter(p => p.type === 'combat');
        const uC = {}, tC = {};

        let currentRowPers = 1; // 1, бо 0 це рядок заголовків
        const commanderCells = [];

        const dataPers = activePos.flatMap(pos => {
            return personnel
                .filter(p => p.positionId === pos.id && (p.status === 'ok' || p.status === '300'))
                .sort((a, b) => {
                    if (pos.commanderId === a.id) return -1;
                    if (pos.commanderId === b.id) return  1;
                    return (a.fullName || '').localeCompare(b.fullName || '');
                })
                .map(s => {
                    const isCom = pos.commanderId === s.id;
                    if (isCom) {
                        commanderCells.push(`B${currentRowPers + 1}`, `E${currentRowPers + 1}`); // B - ПІБ, E - Позивний
                    }
                    currentRowPers++;

                    const dSince = s.deploymentStartTime ? fmtDate(s.deploymentStartTime) : '—';
                    const unit   = s.unit || 'Без підрозділу';
                    const task   = s.currentTask || 'піхота';
                    uC[unit] = (uC[unit] || 0) + 1;
                    tC[task]  = (tC[task]  || 0) + 1;
                    const taskLabel = (s.status === '300' ? task + ' (300)' : task) + (isCom ? ' (Старший ⭐)' : '');
                    return {
                        "Звання":        s.rank || '',
                        "ПІБ":           s.fullName || '',
                        "РОП/Група":     pos.rop?.trim() || 'Без групи',
                        "Позиція":       pos.name,
                        "Позивний":      s.callsign || '',
                        "Підрозділ":     s.unit || '',
                        "Завдання":      taskLabel,
                        "На позиції з":  dSince
                    };
                });
        });

        const dataApp2 = activePos.map(pos => ({
            "РОП/Група":    pos.rop?.trim() || 'Без групи',
            "Позиція":      pos.name,
            "К-ть О/С":     personnel.filter(p => p.positionId === pos.id && (p.status === 'ok' || p.status === '300')).length,
            "ОВТ та Майно": (pos.equipment || []).map(e => `${e.name} (${e.quantity})`).join(', ')
        }));

        const summaryData = [];
        summaryData.push(["ПО ПІДРОЗДІЛАХ", "К-ть"]);
        Object.keys(uC).sort().forEach(u => summaryData.push([u, uC[u]]));
        summaryData.push(["", ""]);
        summaryData.push(["ПО ЗАВДАННЯХ", "К-ть"]);
        const taskHeaderRowIndex = summaryData.length - 1;
        Object.keys(tC).sort().forEach(t => summaryData.push([t, tC[t]]));

        const wb = XLSX.utils.book_new();
        
        const wsPers = XLSX.utils.json_to_sheet(dataPers);
        applyStyles(wsPers, { commanderCells });
        XLSX.utils.book_append_sheet(wb, wsPers, "Особовий склад");
        
        const wsApp2 = XLSX.utils.json_to_sheet(dataApp2);
        applyStyles(wsApp2, { boldCols: [2], centerCols: [2] }); // Індекс 2 - це "К-ть О/С"
        XLSX.utils.book_append_sheet(wb, wsApp2, "Додаток 2");
        
        const wsSummary = XLSX.utils.aoa_to_sheet(summaryData);
        applyStyles(wsSummary, { boldCols: [1], extraHeaderRows: [taskHeaderRowIndex], noAutoFilter: true }); // Індекс 1 - це "К-ть"
        XLSX.utils.book_append_sheet(wb, wsSummary, "Зведення");

        // --- ДОДАЄМО ЛОГ 100 ---
        const dataLogs = logs.slice(0, 100).map(l => {
            let msg = l.message
                .replace('⚠️ БЕЗ ЗАЯВКИ: ', '[Позапланово] ')
                .replace('🗑️ ВИДАЛЕНО ЗАЯВКУ: ', '[Скасовано] ')
                .replace('✅ ЗАВЕРШЕНО ЗАЯВКУ: ', '[Завершено] ');
            return {
                "Дата та Час": fmtDT(l.timestamp),
                "Боєць / Позивний": l.callsign || 'Система',
                "Опис події": msg
            };
        });
        const wsLogs = XLSX.utils.json_to_sheet(dataLogs.length ? dataLogs : [{"Інфо": "Немає подій"}]);
        applyStyles(wsLogs, { boldCols: [0, 1] }); // Робимо Час і Позивний жирними
        XLSX.utils.book_append_sheet(wb, wsLogs, "Лог подій");

        XLSX.writeFile(wb, `Звіт_${new Date().toLocaleDateString('uk-UA')}.xlsx`);
        showToast('Експортовано');
    }

    function exportJournalExcel() {
        if (typeof XLSX === 'undefined') return showToast('Бібліотека Excel недоступна');
        if (journal.length === 0) return showToast('Журнал порожній');

        const active = [], history = [];
        const now = Date.now();

        journal.forEach(r => {
            const s  = getPersonById(r.soldierId) || {};
            const sN = s.fullName ? `${s.fullName}${s.callsign ? ` ("${s.callsign}")` : ''}` : s.callsign || 'Видалений';
            const ia = !r.endTime;
            const displayStartTime = r.startTime; 
            const ms = (ia ? now : new Date(r.endTime)) - new Date(displayStartTime);
            const row = {
                "Звання":           s.rank || '',
                "Боєць / Позивний": sN,
                "Підрозділ":        s.unit || '',
                "Поточна позиція":  r.positionName || getPosName(r.positionId),
                "Захід (Час)":      fmtDT(displayStartTime),
                "Повернення":       ia ? 'НА ПОЗИЦІЇ' : fmtDT(r.endTime),
                "Тривалість":       formatDuration(ms)
            };
            ia ? active.push(row) : history.push(row);
        });

        const wb = XLSX.utils.book_new();
        
        const wsActive = XLSX.utils.json_to_sheet(active.length ? active : [{ "Інфо": "Немає активних" }]);
        applyStyles(wsActive);
        XLSX.utils.book_append_sheet(wb, wsActive, "Зараз на позиціях");
        
        const wsHistory = XLSX.utils.json_to_sheet(history.length ? history : [{ "Інфо": "Немає історії" }]);
        applyStyles(wsHistory);
        XLSX.utils.book_append_sheet(wb, wsHistory, "Історія (Вийшли)");
        
        XLSX.writeFile(wb, `Журнал_${new Date().toLocaleDateString('uk-UA')}.xlsx`);
        showToast('Журнал експортовано');
    }

    // ─── TABS ─────────────────────────────────────────────────────────────────
    function switchTab(t) {
        activeTab = t;
        const activeClasses = ['bg-[#162235]', 'text-[#eff6ff]', 'border-[#3b82f6]/65', 'font-semibold'];
        const inactiveClasses = ['text-[#c2c7d0]', 'hover:text-[#ffffff]', 'hover:bg-[#222429]', 'border-transparent', 'font-medium'];

        ['dashboard','personnel','positions','journal','rotations'].forEach(id => {
            const elTab = el('tab-'+id);
            if (elTab) elTab.classList.add('hidden');
            const btn = el('nav-'+id);
            if (btn) {
                btn.classList.remove(...activeClasses);
                btn.classList.remove('bg-olive-600', 'text-white');
                btn.classList.add(...inactiveClasses);
            }
        });
        const activeEl = el('tab-'+t);
        if (activeEl) {
            activeEl.classList.remove('hidden');
        }
        const activeBtn = el('nav-'+t);
        if (activeBtn) {
            activeBtn.classList.remove(...inactiveClasses);
            activeBtn.classList.add(...activeClasses);
        }
        renderTab(t);
        scheduleIcons();
    }

    function renderTab(t) {
        if      (t === 'dashboard')  renderDashboard();
        else if (t === 'personnel')  { fillDynamicLists(); renderPersonnel(); }
        else if (t === 'positions')  { fillDynamicLists(); renderPositions(); }
        else if (t === 'journal')    renderJournal();
        else if (t === 'rotations')  { fillDynamicLists(); renderRotations(); }
    }

    // ─── DASHBOARD (ОПТИМІЗОВАНО) ─────────────────────────────────────────────
    function renderDashboard() {
        let cr = 0, wia = 0, kia = 0, inField = 0;
        const pc = {}, bu = {}, bt = {};
        TASKS.forEach(t => { bt[t] = 0; });
        const activePosIds = new Set(positions.filter(p => p.type === 'combat').map(p => p.id));
        
        for (const p of personnel) {
            if (p.status === 'ok')  { 
                cr++; 
                pc[p.positionId] = (pc[p.positionId] || 0) + 1; 
                if (activePosIds.has(p.positionId)) {
                    inField++;
                    const u = p.unit || 'Без підрозділу';
                    const t = p.currentTask || 'піхота';
                    bu[u] = (bu[u] || 0) + 1;
                    bt[t] = (bt[t] || 0) + 1;
                }
            }
            else if (p.status === '300') wia++;
            else if (p.status === '200') kia++;
        }
        
        el('stat-total').innerText  = personnel.length;
        el('stat-combat').innerText = cr;
        el('stat-field').innerText  = inField;
        el('stat-wia').innerText    = wia;
        el('stat-kia').innerText    = kia;

        el('stat-positions-table').innerHTML = getOrderedPositions().filter(p => p.type === 'combat').map(pos => {
            const cnt = pc[pos.id] || 0;
            return `<tr class="hover:bg-[#222429] transition-colors">
                <td class="px-4 py-2 text-sm font-medium text-[#f1f5f9]">${esc(pos.name)}</td>
                <td class="px-4 py-2 text-[11px] uppercase tracking-wide text-[#989fa9]">Бойова</td>
                <td class="px-4 py-2 text-sm text-right font-mono tabular-nums ${cnt > 0 ? 'font-bold text-[#93c5fd]' : 'text-[#989fa9]'}">${cnt} чол.</td>
            </tr>`;
        }).join('');

        el('log-list').innerHTML = logs.length === 0
            ? '<li class="p-4 text-[#989fa9] text-center text-sm">Подій немає</li>'
            : logs.slice(0, 100).map(l => {
                const isWarn = l.message.includes('⚠️ БЕЗ ЗАЯВКИ: ');
                const isCheat = l.message.includes('🗑️ ВИДАЛЕНО ЗАЯВКУ: ') || l.message.includes('✅ ЗАВЕРШЕНО ЗАЯВКУ: ');
                
                let rowClass = 'hover:bg-[#222429]';
                let textClass = 'text-[#f1f5f9]';
                let badgeHtml = '';

                if (isWarn) {
                    rowClass = 'bg-[rgba(224,82,82,0.08)] hover:bg-[rgba(224,82,82,0.14)]';
                    textClass = 'text-[#fca5a5]';
                    badgeHtml = '<span class="ml-2 text-[9px] bg-[rgba(224,82,82,0.16)] text-[#fca5a5] border border-[rgba(224,82,82,0.45)] px-1.5 py-0.5 rounded-sm uppercase font-bold tracking-wider">Без заявки</span>';
                } else if (isCheat) {
                    rowClass = 'bg-[rgba(217,155,38,0.08)] hover:bg-[rgba(217,155,38,0.14)]';
                    textClass = 'text-[#fcd34d]';
                    const isDel = l.message.includes('🗑️');
                    badgeHtml = isDel
                        ? '<span class="ml-2 text-[9px] bg-[rgba(234,88,12,0.16)] text-[#fdba74] border border-[rgba(234,88,12,0.42)] px-1.5 py-0.5 rounded-sm uppercase font-bold tracking-wider">Скасовано</span>'
                        : '<span class="ml-2 text-[9px] bg-[rgba(52,168,115,0.16)] text-[#6ee7b7] border border-[rgba(52,168,115,0.40)] px-1.5 py-0.5 rounded-sm uppercase font-bold tracking-wider">Завершено</span>';
                }

                const msg = l.message.replace('⚠️ БЕЗ ЗАЯВКИ: ', '').replace('🗑️ ВИДАЛЕНО ЗАЯВКУ: ', '').replace('✅ ЗАВЕРШЕНО ЗАЯВКУ: ', '');
                
                return `<li class="px-4 py-2 flex justify-between items-start transition-colors ${rowClass}">
                    <div><span class="font-bold text-sm ${textClass}">${esc(l.callsign)}</span>${badgeHtml}<p class="text-xs text-[#c2cedc] mt-0.5">${esc(msg)}</p></div>
                    <span class="text-[11px] text-[#989fa9] font-mono tabular-nums ml-2 shrink-0">${fmtDT(l.timestamp)}</span>
                </li>`;
              }).join('');

        const tot = Object.values(bu).reduce((a, b) => a + b, 0);
        el('stat-units-table').innerHTML = tot === 0
            ? '<tr><td colspan="2" class="px-6 py-4 text-center text-[#989fa9] text-sm">Порожньо</td></tr>'
            : Object.keys(bu).sort().map(u =>
                `<tr class="hover:bg-[#222429] transition-colors"><td class="px-4 py-2 text-sm font-semibold text-[#f1f5f9]">${esc(u)}</td><td class="px-4 py-2 text-sm text-right text-[#93c5fd] font-mono tabular-nums font-bold">${bu[u]}</td></tr>`
              ).join('')
              + `<tr class="bg-[#222429] border-t border-[#2e3138]"><td class="px-4 py-2 text-xs font-bold uppercase text-[#f1f5f9]">Разом</td><td class="px-4 py-2 text-right font-bold font-mono tabular-nums text-[#f1f5f9]">${tot}</td></tr>`;

        const allDashboardTasks = [...new Set([...TASKS, ...Object.keys(bt)])];
        const tt = allDashboardTasks.reduce((s, t) => s + (bt[t] || 0), 0);
        el('stat-tasks-table').innerHTML =
            allDashboardTasks.map(t => {
                const cnt = bt[t] || 0;
                return `<tr class="hover:bg-[#222429] transition-colors"><td class="px-4 py-1.5 text-sm capitalize ${cnt > 0 ? 'text-[#f1f5f9] font-semibold' : 'text-[#b8bec8]'}">${esc(t)}</td><td class="px-4 py-1.5 text-sm text-right font-mono tabular-nums ${cnt > 0 ? 'font-bold text-[#93c5fd]' : 'text-[#989fa9]'}">${cnt}</td></tr>`;
            }).join('')
            + `<tr class="bg-[#222429] border-t border-[#2e3138] sticky bottom-0"><td class="px-4 py-2 text-xs font-bold uppercase text-[#f1f5f9]">РАЗОМ:</td><td class="px-4 py-2 text-right font-bold font-mono tabular-nums text-[#f1f5f9]">${tt}</td></tr>`;

        // ОПТИМІЗАЦІЯ: Прибрали подвійний виклик scheduleIcons()
        renderRotationsWidget();
    }

    // ─── PERSONNEL ────────────────────────────────────────────────────────────
    function handleSearch()       { clearTimeout(searchTimeout); searchTimeout = setTimeout(() => { currentPage = 1; renderPersonnel(); }, 300); }
    function resetPageAndRender() {
        const fP = val('filter-pos'), fS = val('filter-status');
        if (fP === 'combat_only' && fS === 'all') currentQuickStatus = 'combat';
        else if (fP === 'all' && fS !== 'all') currentQuickStatus = fS;
        else if (fP === 'all' && fS === 'all') currentQuickStatus = 'all';
        currentPage = 1;
        renderPersonnel();
    }
    function changePerPage()      { itemsPerPage = val('per-page') === 'all' ? 999999 : parseInt(val('per-page')); currentPage = 1; renderPersonnel(); }
    function prevPage()           { if (currentPage > 1) { currentPage--; renderPersonnel(); } }

    function getFilteredPersonnel() {
        const q  = normSearchText(val('search-input'));
        const fU = val('filter-unit'), fP = val('filter-pos'), fS = val('filter-status');
        const combatPosIds = fP === 'combat_only' ? new Set(positions.filter(pos => pos.type === 'combat').map(pos => pos.id)) : null;

        return personnel.filter(p => {
            const matchesUnit = (fU === 'all' || p.unit === fU);
            if (!matchesUnit) return false;
            const matchesStatus = (fS === 'all' || p.status === fS);
            if (!matchesStatus) return false;
            const matchesPos = fP === 'combat_only' ? combatPosIds.has(p.positionId) : (fP === 'all' || p.positionId === fP);
            if (!matchesPos) return false;
            if (!q) return true;
            const posName = getPosName(p.positionId);
            const hay = normSearchText(`${p.fullName || ''} ${p.callsign || ''} ${p.unit || ''} ${posName} ${p.currentTask || ''}`);
            return hay.includes(q);
        });
    }

    function nextPage() {
        const filt = getFilteredPersonnel();
        const maxPage = Math.ceil(filt.length / itemsPerPage) || 1;
        if (currentPage < maxPage) { currentPage++; renderPersonnel(); }
    }

    function renderPersonnel() {
        updateNotesBadge(); 
        updateChipCounts();
        updateChipActiveState();

        const filt = getFilteredPersonnel();

        filt.sort((a, b) => {
            if (a.status === 'ok' && b.status !== 'ok') return -1;
            if (a.status !== 'ok' && b.status === 'ok') return  1;
            return (a.fullName || '').localeCompare(b.fullName || '');
        });

        const tp    = Math.ceil(filt.length / itemsPerPage) || 1;
        if (currentPage > tp) currentPage = tp;
        const start = (currentPage - 1) * itemsPerPage;
        const items = filt.slice(start, start + itemsPerPage);

        el('page-info').innerText = filt.length > 0
            ? `${start + 1}-${Math.min(start + itemsPerPage, filt.length)} з ${filt.length}` : '0 з 0';

        if (items.length === 0) {
            el('personnel-tbody').innerHTML = '<tr><td colspan="5" class="px-6 py-10 text-center text-[#989fa9]">Не знайдено.</td></tr>';
            return;
        }
        
        const activeRotMap = getActiveRotationMap();

        el('personnel-tbody').innerHTML = items.map(s => {
            const st = STATUSES[s.status] || STATUSES.ok;
            const rotDir = activeRotMap.get(s.id);
            const inRot = rotDir ? `<span class="inline-flex h-2 w-2 ml-2 shrink-0 rounded-full ${rotDir==='in'?'bg-[#d99b26]':'bg-[#4c8ed9]'}" title="В ротації"></span>` : '';
            
            const noteIcon = s.note ? `<button type="button" onclick="event.stopPropagation(); viewNote('${s.id}')" class="ml-2 text-[#93c5fd] hover:text-[#f3f4f6] shrink-0 bg-[rgba(76,142,217,0.12)] p-1 rounded-sm border border-[rgba(76,142,217,0.35)] transition-colors cursor-pointer" title="Переглянути примітку"><i data-lucide="info" class="w-3.5 h-3.5"></i></button>` : '';

            return `<tr draggable="true" ondragstart="handleDragStart(event, '${s.id}')" class="odd:bg-[#131417] even:bg-[#1a1c20] hover:bg-[#25272d] divide-x divide-[#262930] cursor-context-menu transition-colors" oncontextmenu="openSoldierContextMenu(event, '${s.id}')">
                <td class="px-6 py-3 whitespace-nowrap">
                    <div class="font-semibold text-sm text-[#f9fafb] flex items-center"><span onclick="event.stopPropagation(); copySoldierPib('${s.id}')" class="hover:text-[#38bdf8] hover:underline cursor-pointer transition-colors" title="Клік — скопіювати ПІБ">${esc(s.fullName) || 'Не вказано'}</span> ${inRot} ${noteIcon}</div>
                    <div class="text-xs text-[#9ca3af] mt-0.5 flex items-center gap-1.5 flex-wrap"><span>${esc(s.rank)}</span>${s.callsign ? `<span class="text-[#525866]">·</span><span class="text-[#fbbf24] font-mono font-bold text-xs">«${esc(s.callsign)}»</span>` : ''}</div>
                </td>
                <td class="px-6 py-3 text-sm font-medium text-[#a5b4fc]">${esc(s.unit) || '—'}</td>
                <td class="px-6 py-3 text-sm text-[#38bdf8] font-medium"><div class="flex items-center"><i data-lucide="map-pin" class="w-3.5 h-3.5 mr-1.5 text-[#38bdf8]/80"></i>${esc(getPosName(s.positionId))}</div></td>
                <td class="px-6 py-3"><span class="px-2 py-1 text-[10px] font-bold rounded-sm border ${st.color}">${st.label}</span></td>
                <td class="px-6 py-3 text-right">
                    <button onclick="openMoveModal('${s.id}')"    class="p-1.5 text-[#93c5fd] bg-[#222429] hover:bg-[#2e3138] border border-[#2e3138] rounded-sm mr-1 cursor-pointer"><i data-lucide="arrow-right-left" class="w-4 h-4"></i></button>
                    <button onclick="openSoldierModal('${s.id}')" class="p-1.5 text-[#93c5fd] bg-[#222429] hover:bg-[#2e3138] border border-[#2e3138] rounded-sm cursor-pointer"><i data-lucide="edit-2" class="w-4 h-4"></i></button>
                </td>
            </tr>`;
        }).join('');
        scheduleIcons();
    }

    // ─── POSITIONS (ОПТИМІЗОВАНО) ─────────────────────────────────────────────
    function togglePos(id)  { collapsedPositions[id] = !collapsedPositions[id]; saveLocalUI(); renderPositions(); }
    function toggleGroup(g) { collapsedGroups[g]     = !collapsedGroups[g];     saveLocalUI(); renderPositions(); }

    function toggleAllInGroup(g) {
        buildPosCache();
        const gp = groupedPosCache[g] || [];
        const shouldCollapse = gp.some(p => !collapsedPositions[p.id]);
        gp.forEach(p => collapsedPositions[p.id] = shouldCollapse);
        saveLocalUI(); 
        renderPositions();
    }

    function toggleCommander(pId, sId) {
        const p = positions.find(x => x.id === pId);
        if (p) { p.commanderId = (p.commanderId === sId) ? null : sId; saveState(['positions']); }
    }

    function moveGroupOrder(g, dir) {
        if (isSortingLocked) return;
        const i = groupOrder.indexOf(g); if (i === -1) return;
        if (dir === -1 && i > 0)                        [groupOrder[i], groupOrder[i-1]] = [groupOrder[i-1], groupOrder[i]];
        else if (dir === 1 && i < groupOrder.length - 1) [groupOrder[i], groupOrder[i+1]] = [groupOrder[i+1], groupOrder[i]];
        _posDirty = true; // ОПТИМІЗАЦІЯ: Кеш груп зламався, треба оновити
        saveState(['positions']);
    }

    function movePositionOrder(pId, dir) {
        if (isSortingLocked) return;
        const i = positions.findIndex(p => p.id === pId); if (i === -1) return;
        const p  = positions[i];
        const gp = positions.filter(x => (x.rop?.trim() || 'Основні / Без групи') === (p.rop?.trim() || 'Основні / Без групи'));
        const gi = gp.findIndex(x => x.id === pId);
        if (dir === -1 && gi > 0) {
            const ti = positions.findIndex(x => x.id === gp[gi-1].id);
            [positions[i], positions[ti]] = [positions[ti], positions[i]];
        } else if (dir === 1 && gi < gp.length - 1) {
            const ti = positions.findIndex(x => x.id === gp[gi+1].id);
            [positions[i], positions[ti]] = [positions[ti], positions[i]];
        }
        _posDirty = true; saveState(['positions']);
    }

    function viewEquipment(pId) {
        const p = positions.find(x => x.id === pId); if (!p) return;
        el('eq-view-title').innerHTML = `<i data-lucide="package" class="w-4 h-4 mr-2 text-[#4c8ed9]"></i> ОВТ: ${esc(p.name)}`;
        el('eq-view-list').innerHTML  = (!p.equipment || p.equipment.length === 0)
            ? '<p class="text-[#989fa9] py-4 text-center text-sm">ОВТ відсутнє.</p>'
            : p.equipment.map(e =>
                `<li class="flex justify-between py-2 border-b border-[#2e3138] text-sm"><span class="text-[#f3f4f6]">${esc(e.name)}</span><b class="text-[#93c5fd] bg-[rgba(76,142,217,0.12)] border border-[rgba(76,142,217,0.35)] px-2 rounded-sm font-mono tabular-nums">${esc(e.quantity)}</b></li>`
              ).join('');
        openModal('modal-equipment-view'); scheduleIcons();
    }

        function formatTaskShortLabel(task) {
        if (!task) return '';
        const t = task.trim();
        const lower = t.toLowerCase();
        if (lower.includes('вогнева підтримка') || lower.includes('вогнева підтр')) return 'ВОГН. ПІДТР.';
        if (lower.includes('облаштування')) return 'ОБЛАШТУВ.';
        if (lower.includes('гранатомет')) return 'ГРАНАТОМЕТ';
        if (lower.includes('кулемет')) return 'КУЛЕМЕТ';
        return t;
    }

    function getTaskChipColor(task) {
        const t = (task || '').toLowerCase().trim();
        if (!t) return 'bg-[#222429] text-[#b8bec8] border-[#3c404a]';

        // 1. Піхота / Стрільці
        if (t === 'піхота' || t.includes('стріл') || t.includes('піхот')) 
            return 'bg-[rgba(20,184,166,0.12)] text-[#5eead4] border-[rgba(20,184,166,0.38)]';

        // 2. Медицина / Медевак
        if (t.includes('мед') || t.includes('евак') || t.includes('госп')) 
            return 'bg-[rgba(52,168,115,0.12)] text-[#6ee7b7] border-[rgba(52,168,115,0.38)]';

        // 3. БПЛА / Аеро / Дрони / Рекон / Розвідка / РЕР
        if (t.includes('бпла') || t.includes('дрон') || t.includes('рекон') || t.includes('розвід') || t.includes('рер') || t.includes('аеро')) 
            return 'bg-[rgba(76,142,217,0.14)] text-[#93c5fd] border-[rgba(76,142,217,0.40)]';

        // 4. Облаштування / Інженер / ІСВ / Сапери / Фортифікація
        if (t.includes('облаштування') || t.includes('інженер') || t.includes('ісв') || t.includes('сапер') || t.includes('фортифік')) 
            return 'bg-[rgba(234,88,12,0.14)] text-[#fdba74] border-[rgba(234,88,12,0.42)]';

        // 5. Зв'язок / РЕБ / Радіо / IT
        if (t.includes('зв') || t.includes('реб') || t.includes('радіо') || t.includes('it')) 
            return 'bg-[rgba(99,102,241,0.14)] text-[#a5b4fc] border-[rgba(99,102,241,0.40)]';

        // 6. Вогнева підтримка / МБ / Міномет / ТСП / Арта / ППО / ПТРК / Гранатомет / Кулемет / Вогн
        if (t.includes('вогн') || t.includes('мб') || t.includes('тсп') || t.includes('ппо') || t.includes('міномет') || t.includes('арт') || t.includes('птрк') || t.includes('кулемет') || t.includes('гранат') || t.includes('штурм')) 
            return 'bg-[rgba(224,82,82,0.12)] text-[#fca5a5] border-[rgba(224,82,82,0.45)]';

        // 7. Бронегрупа / Танк / БМП / БТР / Мехвод / Водій
        if (t.includes('брон') || t.includes('танк') || t.includes('бмп') || t.includes('бтр') || t.includes('водій') || t.includes('мехвод')) 
            return 'bg-[rgba(217,155,38,0.12)] text-[#fcd34d] border-[rgba(217,155,38,0.40)]';

        // 8. Логістика / Постачання / Склад / Забезпечення
        if (t.includes('лог') || t.includes('постач') || t.includes('склад') || t.includes('забезп') || t.includes('кухар')) 
            return 'bg-[rgba(76,142,217,0.12)] text-[#93c5fd] border-[rgba(76,142,217,0.35)]';

        // 9. Резерв / Охорона / Черговий
        if (t.includes('резерв') || t.includes('охорон') || t.includes('чергов')) 
            return 'bg-[rgba(168,85,247,0.12)] text-[#d8b4fe] border-[rgba(168,85,247,0.38)]';

        // 10. Детермінований колір для інших завдань
        const colors = [
            'bg-[rgba(76,142,217,0.12)] text-[#93c5fd] border-[rgba(76,142,217,0.35)]',
            'bg-[rgba(139,92,246,0.12)] text-[#c4b5fd] border-[rgba(139,92,246,0.38)]',
            'bg-[rgba(52,168,115,0.12)] text-[#6ee7b7] border-[rgba(52,168,115,0.38)]',
            'bg-[rgba(217,155,38,0.12)] text-[#fcd34d] border-[rgba(217,155,38,0.40)]',
            'bg-[#222429] text-[#f3f4f6] border-[#3c404a]'
        ];
        let hash = 0;
        for (let i = 0; i < t.length; i++) hash = (hash * 31 + t.charCodeAt(i)) >>> 0;
        return colors[hash % colors.length];
    }

    function buildPosSoldierRowHtml(s, pos, isCom, activeRotMap) {
        let tB = '';
        if (s.deploymentStartTime && isCom) {
            const d = Math.floor((Date.now() - new Date(s.deploymentStartTime)) / 86400000);
            if (d > 0) {
                let col = 'bg-[rgba(52,168,115,0.12)] text-[#6ee7b7] border-[rgba(52,168,115,0.38)]';
                if (d > 30) col = 'bg-[rgba(224,82,82,0.16)] text-[#fca5a5] border-[rgba(224,82,82,0.50)] font-bold';
                else if (d > 20) col = 'bg-[rgba(217,155,38,0.16)] text-[#fcd34d] border-[rgba(217,155,38,0.45)]';
                else if (d > 10) col = 'bg-[rgba(217,155,38,0.10)] text-[#fde68a] border-[rgba(217,155,38,0.35)]';
                
                tB = `<span class="text-[11px] font-mono tabular-nums font-bold px-1.5 py-0.5 rounded-sm border flex items-center shrink-0 ${col}" title="Днів на позиції: ${d}"><i data-lucide="clock" class="w-3 h-3 mr-1"></i>${d}д</span>`;
            }
        }
        
        const taskShort = (s.currentTask && s.currentTask !== 'піхота') ? formatTaskShortLabel(s.currentTask) : '';
        const tH = taskShort ? `<span class="uppercase font-mono font-bold ${getTaskChipColor(s.currentTask)} px-1.5 py-0.5 rounded-sm text-[10px] whitespace-nowrap border" title="${esc(s.currentTask)}">${esc(taskShort)}</span>` : '';
        const rotDir = activeRotMap.get(s.id);
        const inRot = rotDir ? `<span class="inline-flex h-2 w-2 ml-1 shrink-0 rounded-full ${rotDir==='in'?'bg-[#d99b26]':'bg-[#4c8ed9]'}" title="В ротації"></span>` : '';
        const noteIcon = s.note ? `<button type="button" onclick="event.stopPropagation(); viewNote('${s.id}')" class="text-[#93c5fd] hover:text-[#f3f4f6] shrink-0 bg-[rgba(76,142,217,0.12)] p-0.5 rounded-sm border border-[rgba(76,142,217,0.35)] transition-colors cursor-pointer" title="Примітка: ${esc(s.note ? (s.note.text || s.note) : '')}"><i data-lucide="info" class="w-3 h-3"></i></button>` : '';

        const isPosCom = pos.commanderId === s.id;
        const hasCallsign = !!s.callsign?.trim();
        const displayCallsign = hasCallsign ? esc(s.callsign.trim()) : '';
        const displayFullName = esc(s.fullName) || 'Невідомий';
        
        const mainTitle = hasCallsign ? displayCallsign : displayFullName;
        const titleClass = hasCallsign
            ? (isPosCom ? 'font-mono font-bold text-[14px] text-[#fde047] tracking-wide' : 'font-mono font-bold text-[13.5px] text-[#fbbf24] tracking-wide')
            : (isPosCom ? 'font-sans font-bold text-[13.5px] text-[#fde047]' : 'font-sans font-bold text-[13.5px] text-[#f9fafb]');

        const mainTitleHtml = `<span onclick="event.stopPropagation(); copySoldierPib('${s.id}')" class="${titleClass} max-w-full truncate hover:underline cursor-pointer transition-colors" title="Клік — скопіювати ПІБ">${mainTitle}</span>`;

        const subText = hasCallsign && s.fullName 
            ? `<span onclick="event.stopPropagation(); copySoldierPib('${s.id}')" class="text-[#e5e7eb] font-normal hover:text-[#ffffff] hover:underline cursor-pointer transition-colors truncate" title="Клік — скопіювати ПІБ">${displayFullName}</span>` 
            : '';
        const unitText = s.unit ? `<span class="text-[#a5b4fc] text-[11px] font-sans font-medium shrink-0 ml-1.5">· ${esc(s.unit)}</span>` : '';
        
        return `<li draggable="true" ondragstart="handleDragStart(event, '${s.id}')" class="group/row flex justify-between items-center py-2 px-2.5 hover:bg-[#25272d] rounded-sm border border-transparent hover:border-[#3c404a] text-xs leading-tight gap-2 cursor-context-menu transition-colors" oncontextmenu="openSoldierContextMenu(event, '${s.id}')">
            <div class="flex items-start flex-1 min-w-0 pr-1 gap-1.5">
                <button onclick="toggleCommander('${pos.id}','${s.id}')" class="p-1 shrink-0 mt-0.5 cursor-pointer" title="${isPosCom ? 'Старший позиції' : 'Призначити старшим'}"><i data-lucide="star" class="w-3.5 h-3.5 ${isPosCom ? 'text-[#fcd34d] fill-[#fcd34d]' : 'text-[#989fa9] hover:text-[#fcd34d]'}"></i></button>
                <div class="flex-1 min-w-0">
                    <div class="flex items-center gap-1.5 flex-wrap leading-snug">
                        ${mainTitleHtml}
                        ${inRot}
                        ${noteIcon}
                        ${tH}
                    </div>
                    ${(subText || unitText) ? `<div class="flex items-center text-[11.5px] mt-1 font-sans min-w-0">${subText}${unitText}</div>` : ''}
                </div>
            </div>
            <div class="flex items-center gap-1.5 shrink-0">
                ${tB}
                ${s.status !== 'ok' ? `<span class="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded-sm bg-[rgba(224,82,82,0.14)] text-[#fca5a5] border border-[rgba(224,82,82,0.45)] shrink-0">${esc(s.status)}</span>` : ''}
                <button onclick="openMoveModal('${s.id}')" class="text-[#b8bec8] hover:text-[#f3f4f6] hover:bg-[#2e3138] border border-transparent hover:border-[#3c404a] p-1.5 rounded-sm shrink-0 transition-colors opacity-40 group-hover/row:opacity-100 cursor-pointer" title="Перемістити бійця"><i data-lucide="arrow-right-left" class="w-3.5 h-3.5"></i></button>
            </div>
        </li>`;
    }

    function renderPositions() {
        const lockBtn = el('btn-lock-sort');
        if (lockBtn) {
            lockBtn.innerHTML = isSortingLocked 
                ? '<i data-lucide="lock" class="w-4 h-4 mr-2"></i><span>Закріплено</span>' 
                : '<i data-lucide="unlock" class="w-4 h-4 mr-2"></i><span>Ред. порядок</span>';
            lockBtn.className = isSortingLocked 
                ? 'bg-[#222429] hover:bg-[#2e3138] text-[#f3f4f6] border border-[#2e3138] hover:border-[#3c404a] px-3.5 py-2 rounded-sm flex items-center text-xs font-medium transition-colors flex-1 sm:flex-none justify-center cursor-pointer'
                : 'bg-[rgba(217,155,38,0.14)] text-[#fcd34d] border border-[rgba(217,155,38,0.45)] px-3.5 py-2 rounded-sm flex items-center text-xs font-bold transition-colors flex-1 sm:flex-none justify-center cursor-pointer';
        }

        // ОПТИМІЗАЦІЯ: Використовуємо готовий кеш замість перебудови
        buildPosCache();
        const groups = groupedPosCache;
        const sbp = {};
        
        personnel.forEach(p => { (sbp[p.positionId] = sbp[p.positionId] || []).push(p); });

        const activePosIds = new Set(positions.filter(p => p.type === 'combat').map(p => p.id));
        const inFieldCount = personnel.filter(p => p.status === 'ok' && activePosIds.has(p.positionId)).length;
        if (el('pos-combat-count-badge')) el('pos-combat-count-badge').innerText = inFieldCount;

        const taskCounts = {};
        personnel.forEach(p => {
            if (p.status === 'ok' && activePosIds.has(p.positionId)) {
                const t = p.currentTask || 'піхота';
                if (!t.toUpperCase().startsWith('ППД')) {
                    taskCounts[t] = (taskCounts[t] || 0) + 1;
                }
            }
        });

        const activeRotMap = getActiveRotationMap();

        const gl = groupOrder.length;
        el('positions-container').innerHTML = groupOrder.map((gName, gi) => {
            const groupPositions = groups[gName] || [];
            const gCount  = groupPositions.reduce((s, p) => s + (sbp[p.id] || []).length, 0);
            const isC     = collapsedGroups[gName];

            const activeGroupPosCount = groupPositions.filter(p => (sbp[p.id] || []).length > 0).length;

            let groupRibbon = '';
            if (gName.toUpperCase() !== 'ТИЛ' && gName.toUpperCase() !== 'ВІДРИВ') {
                const groupTaskCounts = {};
                groupPositions.forEach(p => {
                    const sol = sbp[p.id] || [];
                    sol.forEach(s => {
                        if (s.status === 'ok') {
                            const t = s.currentTask || 'піхота';
                            if (!t.toUpperCase().startsWith('ППД')) {
                                groupTaskCounts[t] = (groupTaskCounts[t] || 0) + 1;
                            }
                        }
                    });
                });
                if (Object.keys(groupTaskCounts).length > 0) {
                    const ribbonContent = Object.keys(groupTaskCounts).sort((a,b) => groupTaskCounts[b] - groupTaskCounts[a]).map(t => {
                        const chipClass = getTaskChipColor(t);
                        return `<span class="flex items-center text-[9px] font-mono font-bold border px-1.5 py-0.5 rounded-sm shrink-0 uppercase tracking-wide cursor-default transition-colors ${chipClass}">${esc(t)} <span class="ml-1 text-[11px] font-bold tabular-nums opacity-90">${groupTaskCounts[t]}</span></span>`;
                    }).join('');
                    groupRibbon = `<div class="ml-4 flex gap-1.5 overflow-x-auto custom-scrollbar pb-1">${ribbonContent}</div>`;
                }
            }

            const posCards = groupPositions.map((pos, pi) => {
                const sol   = (sbp[pos.id] || []).slice().sort((a, b) => {
                    if (pos.commanderId === a.id) return -1;
                    if (pos.commanderId === b.id) return  1;
                    return 0;
                });
                const isCom = COMBAT_TYPES.has(pos.type);

                let sh = '';
                if (!collapsedPositions[pos.id]) {
                    if (sol.length === 0) {
                        sh = '<div class="p-3 text-center text-xs text-[#989fa9] italic font-mono">── Порожня ──</div>';
                    } else {
                        const lis = sol.map(s => buildPosSoldierRowHtml(s, pos, isCom, activeRotMap)).join('');
                        sh = `<div class="p-2 overflow-y-auto max-h-80 custom-scrollbar"><ul class="space-y-0.5 divide-y divide-[#2e3847]">${lis}</ul></div>`;
                    }
                }

                const eqBtn = (pos.equipment || []).length > 0
                    ? `<button onclick="viewEquipment('${pos.id}')" class="text-[10px] font-mono font-bold tabular-nums text-[#93c5fd] bg-[rgba(76,142,217,0.12)] px-1.5 py-0.5 rounded-sm border border-[rgba(76,142,217,0.35)] flex items-center shrink-0 cursor-pointer" title="ОВТ"><i data-lucide="package" class="w-3 h-3 mr-1 text-[#4c8ed9]"></i>${pos.equipment.length}</button>` : '';

                const copyPosBtn = sol.length > 0
                    ? `<button onclick="copyPositionPersonnel('${pos.id}')" class="text-[#c2c7d0] bg-[#101113] hover:bg-[#2a3444] hover:text-[#6ee7b7] border border-[#3a475c] p-1 rounded-sm transition-colors hidden group-hover:inline-flex cursor-pointer" title="Скопіювати список о/с позиції (${sol.length} чол.)"><i data-lucide="copy" class="w-3 h-3"></i></button>` : '';

                const hasRot = sol.some(s => activeRotMap.has(s.id));
                const rotBadge = hasRot ? `<span class="absolute -top-1 -right-1 flex h-2.5 w-2.5 rounded-full bg-[#d99b26] border border-[#17181b]" title="Є активна ротація!"></span>` : '';

                const isMovingThis = window.isMovingPosId === pos.id;
                const cardClasses = isMovingThis
                    ? 'bg-[#17181b] border-2 border-[#4c8ed9] transition-colors rounded-sm'
                    : 'bg-[#17181b] border border-[#3a3e47] hover:border-[#464b57] transition-colors rounded-sm';
                
                const headerClasses = isCom ? 'bg-[#25272d] border-b border-[#3b495e]' : 'bg-[#25272d] border-b border-[#3b495e]';

                const targetBtnClasses = isMovingThis
                    ? 'text-white bg-[#2b67ab] hover:bg-[#4c8ed9] border border-[#4c8ed9] p-1 rounded-sm transition-colors inline-flex cursor-pointer'
                    : 'text-[#c2c7d0] bg-[#101113] hover:bg-[#2a3444] hover:text-[#93c5fd] border border-[#3a475c] p-1 rounded-sm transition-colors hidden group-hover:inline-flex cursor-pointer';

                return `<div data-pos-id="${pos.id}" ondragover="handleDragOver(event)" ondragleave="handleDragLeave(event)" ondrop="handleDrop(event, '${pos.id}')" onclick="if(window.isMovingSoldierId) handleTargetModeDrop('${pos.id}'); else if(window.isMovingPosId) handlePosTargetModeDrop('${pos.id}');" class="rounded-sm border flex flex-col relative tactical-card group transition-colors ${cardClasses}">
                    ${rotBadge}
                    <div class="px-3 py-2 flex items-center justify-between ${headerClasses} rounded-t-sm gap-2 min-h-[42px] select-none">
                        <div class="flex items-center gap-2 min-w-0 flex-1 cursor-grab active:cursor-grabbing hover:opacity-90" draggable="true" ondragstart="handlePosDragStart(event, '${pos.id}')" title="Перетягнути позицію (Drag-and-Drop)">
                            <i data-lucide="grip-vertical" class="w-3.5 h-3.5 text-[#989fa9] hover:text-[#ffffff] shrink-0"></i>
                            <i data-lucide="${pos.icon || 'crosshair'}" class="w-4 h-4 ${isCom ? 'text-[#e05252]' : 'text-[#b8bec8]'} shrink-0"></i>
                            <h3 class="font-bold text-sm text-[#38bdf8] leading-tight truncate" title="${esc(pos.name)}">${esc(pos.name)}</h3>
                            <span class="bg-[#101113] text-[#f1f5f9] border border-[#3c404a] px-1.5 py-0.5 rounded-sm font-mono tabular-nums text-[11px] font-bold flex items-center shrink-0" title="Кількість бійців"><i data-lucide="users" class="w-2.5 h-2.5 mr-1 text-[#b8bec8]"></i>${sol.length}</span>
                            ${eqBtn}
                        </div>
                        <div class="flex items-center gap-1 shrink-0" draggable="false" ondragstart="event.stopPropagation()" onclick="event.stopPropagation()">
                            ${copyPosBtn}
                            <button onclick="event.stopPropagation(); openAddToPosModal('${pos.id}')" class="text-[#c2c7d0] bg-[#101113] hover:bg-[#282b31] hover:text-[#ffffff] border border-[#3c404a] px-1.5 py-0.5 rounded-sm text-[11px] font-medium transition-colors hidden group-hover:inline-flex items-center gap-0.5 cursor-pointer" title="Додати бійця"><i data-lucide="user-plus" class="w-3 h-3"></i><span>+ Боєць</span></button>
                            <button onclick="event.stopPropagation(); startPosTargetMode('${pos.id}', event)" class="${targetBtnClasses}" title="${isMovingThis ? 'Скасувати вибір' : 'Перемістити позицію (кліком)'}"><i data-lucide="crosshair" class="w-3 h-3 ${isMovingThis ? 'text-white' : 'text-[#4c8ed9]'}"></i></button>
                            <button onclick="event.stopPropagation(); openPositionModal('${pos.id}')" class="text-[#c2c7d0] bg-[#101113] hover:bg-[#282b31] hover:text-[#ffffff] border border-[#3c404a] p-1 rounded-sm transition-colors hidden group-hover:inline-flex cursor-pointer" title="Налаштування"><i data-lucide="settings" class="w-3 h-3"></i></button>
                            ${!isSortingLocked ? `
                            <button onclick="event.stopPropagation(); movePositionOrder('${pos.id}',-1)" class="${pi === 0 ? 'hidden' : ''} p-0.5 text-[#b8bec8] hover:text-[#f3f4f6] rounded-sm cursor-pointer"><i data-lucide="arrow-up" class="w-3.5 h-3.5"></i></button>
                            <button onclick="event.stopPropagation(); movePositionOrder('${pos.id}',1)" class="${pi === groupPositions.length-1 ? 'hidden' : ''} p-0.5 text-[#b8bec8] hover:text-[#f3f4f6] rounded-sm cursor-pointer"><i data-lucide="arrow-down" class="w-3.5 h-3.5"></i></button>
                            ` : ''}
                            <button onclick="event.stopPropagation(); togglePos('${pos.id}')" class="p-0.5 text-[#b8bec8] hover:text-[#f3f4f6] rounded-sm ml-0.5 cursor-pointer"><i data-lucide="${collapsedPositions[pos.id] ? 'chevron-down' : 'chevron-up'}" class="w-4 h-4"></i></button>
                        </div>
                    </div>${sh}
                </div>`;
            }).join('');

            return `<div class="bg-[#141518] p-4 rounded-sm border border-[#3a3e47] mb-6">
                <div class="flex justify-between items-center mb-4">
                    <div class="flex items-center min-w-0 flex-1">
                        <h3 class="text-base font-bold text-[#f3f4f6] flex items-center cursor-pointer hover:text-[#4c8ed9] transition-colors overflow-hidden" onclick="if(window.isMovingPosId) handlePosTargetModeDropGroup(${jsEsc(gName)}); else toggleGroup(${jsEsc(gName)});">
                            <i data-lucide="${isC ? 'folder-closed' : 'folder-open'}" class="w-4 h-4 mr-2 text-[#4c8ed9] shrink-0"></i>
                            <span class="shrink-0">${esc(gName)}</span> 
                            <span class="ml-3 text-[11px] font-mono tabular-nums font-bold bg-[#222429] text-[#f3f4f6] border border-[#2e3138] px-2 py-0.5 rounded-sm shrink-0">${activeGroupPosCount} поз.</span>
                            <span class="ml-2 text-[11px] font-mono tabular-nums font-bold text-[#6ee7b7] bg-[rgba(52,168,115,0.12)] border border-[rgba(52,168,115,0.38)] px-2 py-0.5 rounded-sm shrink-0">${gCount} чол.</span>
                            ${groupRibbon}
                        </h3>
                        <button onclick="openGroupModal(${jsEsc(gName)})" class="ml-3 text-[#b8bec8] hover:text-[#f3f4f6] p-1 rounded-sm border border-[#2e3138] bg-[#17181b] hover:bg-[#222429] transition-colors cursor-pointer" title="Налаштування групи"><i data-lucide="edit-3" class="w-3.5 h-3.5"></i></button>
                        <button onclick="toggleAllInGroup(${jsEsc(gName)})" class="ml-1.5 text-[#b8bec8] hover:text-[#f3f4f6] p-1 rounded-sm border border-[#2e3138] bg-[#17181b] hover:bg-[#222429] transition-colors cursor-pointer" title="Згорнути/Розгорнути всі позиції"><i data-lucide="chevrons-up-down" class="w-3.5 h-3.5"></i></button>
                    </div>
                    <div class="flex items-center gap-1 shrink-0">
                        ${!isSortingLocked ? `
                        <button onclick="moveGroupOrder(${jsEsc(gName)},-1)" class="${gi === 0 ? 'hidden' : ''} p-1 text-[#b8bec8] hover:text-[#f3f4f6] rounded-sm cursor-pointer"><i data-lucide="arrow-up" class="w-4 h-4"></i></button>
                        <button onclick="moveGroupOrder(${jsEsc(gName)},1)"  class="${gi === gl - 1 ? 'hidden' : ''} p-1 text-[#b8bec8] hover:text-[#f3f4f6] rounded-sm cursor-pointer"><i data-lucide="arrow-down" class="w-4 h-4"></i></button>
                        ` : ''}
                    </div>
                </div>
                <div class="grid gap-3 ${isC ? 'hidden' : ''} rounded-sm p-1 transition-colors" style="grid-template-columns: repeat(auto-fill, minmax(380px, 1fr));" ondragover="handleGroupGridDragOver(event)" ondragleave="handleGroupGridDragLeave(event)" ondrop="handleGroupGridDrop(event, ${jsEsc(gName)})">${posCards}</div>
            </div>`;
        }).join('');

        scheduleIcons();
    }

    // ─── JOURNAL TRACKING ─────────────────────────────────────────────────────
    function handleJournalTracking(sId, fId, tId) {
        if (fId === tId) return;
        if (fId) {
            const oldPos = positions.find(p => p.id === fId);
            if (oldPos && oldPos.commanderId === sId) {
                oldPos.commanderId = null;
            }
        }
        const s  = getPersonById(sId);
        const tP = positions.find(p => p.id === tId);

        const isC  = tP && tP.type === 'combat';
        const now  = new Date().toISOString();

        const aj   = journal.find(j => j.soldierId === sId && !j.endTime);

        if (isC) {
            if (aj) {
                aj.positionId = tId;
                aj.positionName = tP.name;
            } else {
                journal.unshift({ id: 'jrn_' + Date.now(), soldierId: sId, positionId: tId, positionName: tP.name, startTime: now, endTime: null });
                if (s) s.deploymentStartTime = now;
            }
        } else {
            if (aj) {
                aj.endTime = now;
                if (s) s.deploymentStartTime = null;
            }
        }

        if (journal.length > 2000) journal.length = 2000;
    }

    function renderJournal() {
        const q = normSearchText(val('journal-search'));
        const f = val('journal-filter');

        const filt = journal.filter(r => {
            const ia = !r.endTime;
            if (f === 'active'  && !ia) return false;
            if (f === 'history' &&  ia) return false;
            if (!q) return true;
            const s = getPersonById(r.soldierId) || {};
            const posName = r.positionName || getPosName(r.positionId);
            const hay = normSearchText(`${s.fullName || ''} ${s.callsign || ''} ${s.unit || ''} ${posName}`);
            return hay.includes(q);
        });

        filt.sort((a, b) => {
            const timeA = new Date(a.endTime || a.startTime).getTime();
            const timeB = new Date(b.endTime || b.startTime).getTime();
            return timeB - timeA;
        });

        if (filt.length === 0) {
            el('journal-tbody').innerHTML = '<tr><td colspan="5" class="px-6 py-6 text-center text-[#989fa9]">Немає записів</td></tr>';
            return;
        }

        const now = Date.now();
        el('journal-tbody').innerHTML = filt.map(r => {
            const s  = getPersonById(r.soldierId) || {};
            const sN = s.fullName
                ? `${esc(s.fullName)}${s.callsign ? ` (${esc(s.callsign)})` : ''}`
                : esc(s.callsign) || 'Видалений';
            const ia  = !r.endTime;
            
            const displayStartTime = r.startTime;
            const ms  = (ia ? now : new Date(r.endTime)) - new Date(displayStartTime);
            const durStr = formatDuration(ms);
            const dur = ia
                ? `<span class="text-[#6ee7b7] font-mono tabular-nums font-bold flex gap-1 justify-end items-center"><i data-lucide="activity" class="w-3 h-3"></i> ${durStr}</span>`
                : `<span class="text-[#b4c0d0] font-mono tabular-nums">${durStr}</span>`;
            return `<tr class="${ia ? 'bg-[rgba(52,168,115,0.06)]' : ''} hover:bg-[#222429] transition-colors">
                <td class="px-6 py-3"><div class="text-sm font-bold text-[#f1f5f9]">${sN}</div><div class="text-xs text-[#b4c0d0]">${esc(s.unit) || '—'}</div></td>
                <td class="px-6 py-3 text-sm text-[#f3f4f6]"><div class="flex gap-1.5 items-center"><i data-lucide="map-pin" class="w-3.5 h-3.5 text-[#989fa9]"></i>${esc(r.positionName || getPosName(r.positionId))}</div></td>
                <td class="px-6 py-3 text-sm font-mono tabular-nums text-[#f3f4f6]">${fmtDT(displayStartTime)}</td>
                <td class="px-6 py-3 text-sm font-mono tabular-nums text-[#f3f4f6]">${ia ? '<span class="text-[#6ee7b7] text-[10px] font-bold bg-[rgba(52,168,115,0.14)] border border-[rgba(52,168,115,0.40)] px-2 py-0.5 rounded-sm">НА ПОЗИЦІЇ</span>' : fmtDT(r.endTime)}</td>
                <td class="px-6 py-3 text-right"><div class="flex justify-end gap-2 items-center">${dur}<button onclick="openJournalModal('${r.id}')" class="p-1.5 bg-[#222429] hover:bg-[#2e3138] border border-[#2e3138] rounded-sm cursor-pointer"><i data-lucide="edit-3" class="w-3.5 h-3.5 text-[#b8bec8]"></i></button><button onclick="deleteJournalEntry('${r.id}')" class="p-1.5 bg-[rgba(224,82,82,0.12)] hover:bg-[rgba(224,82,82,0.22)] border border-[rgba(224,82,82,0.40)] rounded-sm cursor-pointer"><i data-lucide="trash-2" class="w-3.5 h-3.5 text-[#fca5a5]"></i></button></div></td>
            </tr>`;
        }).join('');
        scheduleIcons();
    }

    function deleteJournalEntry(id) {
        askConfirm('Видалити цей запис з журналу?', () => {
            const r = journal.find(j => j.id === id);
            if (r && !r.endTime) {
                const s = getPersonById(r.soldierId);
                if (s) s.deploymentStartTime = null;
            }
            journal = journal.filter(j => j.id !== id);
            saveStateSilent();
            renderJournal();
            showToast('Запис видалено');
        });
    }

    function clearJournal() {
        askConfirm('Очистити журнал (крім активних)?', () => {
            journal = journal.filter(j => !j.endTime);
            saveState(['journal']);
            showToast('Очищено');
        });
    }

    function handleJournalSearch() {
        clearTimeout(journalSearchTimeout);
        journalSearchTimeout = setTimeout(() => { renderJournal(); }, 300);
    }

    // ─── CONFIRM DIALOG ───────────────────────────────────────────────────────
    let confCb = null;
    function askConfirm(m, cb) { el('confirm-msg').innerText = m; confCb = cb; openModal('modal-confirm'); }
    el('confirm-btn').addEventListener('click', () => { if (confCb) confCb(); closeModal('modal-confirm'); });

    // ─── SELECTS INIT ─────────────────────────────────────────────────────────
    function refreshSharedPersonnelInputs(currentRank = el('s-rank')?.value || '') {
        const ranks = el('s-rank');
        if (ranks) {
            ranks.innerHTML = SharedDictionaries.options('ranks', RANKS, currentRank).map(value => `<option value="${esc(value)}">${esc(value)}</option>`).join('');
            if (currentRank) ranks.value = currentRank;
        }
        const units = el('unit-datalist');
        if (units) units.innerHTML = SharedDictionaries.options('units', personnel.map(person => person.unit)).map(value => `<option value="${esc(value)}">`).join('');
    }
    window.addEventListener('suite-dictionaries-changed', () => refreshSharedPersonnelInputs());

    function initSelects() {
        const fill = (id, arr) => { const x = el(id); if (x) x.innerHTML = arr.map(a => `<option value="${a}">${a}</option>`).join(''); };
        refreshSharedPersonnelInputs('Солдат');
        fill('m-task', TASKS);
        const pt = el('p-type');
        if (pt) pt.innerHTML = POSITION_TYPES.map(p => `<option value="${p.id}">${p.label}</option>`).join('');
        const bs = el('bulk-status-select');
        if (bs) bs.innerHTML = STATUS_KEYS.map(k => `<option value="${k}">${STATUSES[k].label}</option>`).join('');
    }

    function fillDynamicLists() {
        const posOpts  = positions.map(p => `<option value="${esc(p.name)}">`).join('');
        const ropOpts  = [...new Set(positions.map(p => p.rop).filter(Boolean))].map(r => `<option value="${esc(r)}">`).join('');
        const units    = [...new Set(personnel.map(p => p.unit).filter(Boolean))];
        const unitOpts = SharedDictionaries.options('units', units).map(u => `<option value="${esc(u)}">`).join('');

        const pl = el('pos-datalist');  if (pl) pl.innerHTML = posOpts;
        const rl = el('rop-datalist');  if (rl) rl.innerHTML = ropOpts;
        const ul = el('unit-datalist'); if (ul) ul.innerHTML = unitOpts;

        const restoreSelect = (id, html) => {
            const x = el(id); if (!x) return;
            const cv = x.value;
            x.innerHTML = html;
            if ([...x.options].some(o => o.value === cv)) x.value = cv;
        };
        restoreSelect('filter-unit',   `<option value="all">Всі підрозділи</option>${units.map(u => `<option value="${esc(u)}">${esc(u)}</option>`).join('')}`);
        restoreSelect('filter-pos',    `<option value="all">Всі локації</option><option value="combat_only">Тільки бойові позиції</option>${positions.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}`);
        restoreSelect('filter-status', `<option value="all">Всі статуси</option>${STATUS_KEYS.map(k => `<option value="${k}">${STATUSES[k].label}</option>`).join('')}`);

        const sS = el('s-status');
        if (sS) sS.innerHTML = STATUS_KEYS.map(k => `<option value="${k}">${STATUSES[k].label}</option>`).join('');
    }

    // ─── SOLDIER MODAL ────────────────────────────────────────────────────────
    function openSoldierModal(id = null) {
        el('modal-soldier').querySelector('form').reset();
        refreshSharedPersonnelInputs(id ? getPersonById(id)?.rank || '' : 'Солдат');
        el('s-id').value = id || '';
        if (id) {
            const s = getPersonById(id);
            el('soldier-modal-title').innerText = 'Редагувати';
            el('s-fullname').value = s.fullName || '';
            el('s-callsign').value = s.callsign || '';
            el('s-rank').value     = s.rank;
            el('s-unit').value     = s.unit || '';
            el('s-init-block').style.display  = 'none';
            el('s-delete-btn').style.display  = 'flex';
        } else {
            el('soldier-modal-title').innerText = 'Додати бійця';
            el('s-rank').value = 'Солдат';
            const defPos = positions.find(p => p.id === 'pos_ppd') || positions.find(p => (p.name || '').toUpperCase().includes('ППД')) || positions.find(p => p.type === 'non_combat') || positions[0];
            el('s-pos-input').value = defPos ? defPos.name : (positions.length ? positions[0].name : '');
            if (el('s-status')) el('s-status').value = 'ok';
            el('s-init-block').style.display = 'grid';
            el('s-delete-btn').style.display = 'none';
        }
        openModal('modal-soldier');
    }

    function saveSoldier(e) {
        e.preventDefault();
        const id = val('s-id');
        const d  = { 
            fullName: val('s-fullname').trim(), 
            callsign: val('s-callsign').trim(), 
            rank: val('s-rank'), 
            unit: val('s-unit').trim()
        };
        if (id) {
            const i = personnel.findIndex(p => p.id === id);
            personnel[i] = { ...personnel[i], ...d };
            personnelMap.set(id, personnel[i]);
            addLog('Оновлено бійця', d.fullName);
        } else {
            d.id = 's_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
            d.status = val('s-status');
            d.currentTask = 'піхота';
            const p = positions.find(x => x.name === val('s-pos-input'));
            if (!p) return showToast('Помилка: позицію не знайдено!');
            d.positionId = p.id;
            personnel.push(d);
            personnelMap.set(d.id, d);
            addLog('Додано', d.fullName);
            handleJournalTracking(d.id, null, p.id);
        }
        saveState();
        closeModal('modal-soldier');
        showToast('Збережено');
    }

    function deleteSoldier() {
        askConfirm('Видалити бійця?', () => {
            const id = val('s-id'), s = getPersonById(id);
            personnel = personnel.filter(p => p.id !== id);
            personnelMap.delete(id);
            journal.filter(j => j.soldierId === id && !j.endTime).forEach(j => { j.endTime = new Date().toISOString(); });
            addLog('Видалено', s.fullName || s.callsign);
            saveState();
            closeModal('modal-soldier');
            showToast('Видалено');
        });
    }

    // ─── MOVE MODAL ТА ПРИМІТКИ ───────────────────────────────────────────────
    function setMoveStatus(k) {
        selectedMoveStatus = k;
        document.querySelectorAll('.status-btn').forEach(b => {
            const bk = b.dataset.status;
            const bStyle = (STATUSES[bk] || STATUSES.ok).color;
            b.className = bk === k
                ? `status-btn p-2 text-xs font-semibold rounded-sm border flex items-center space-x-2 transition-colors ${bStyle} outline outline-1 outline-[#4c8ed9] cursor-pointer`
                : 'status-btn p-2 text-xs font-medium rounded-sm border border-[#2e3138] flex items-center space-x-2 transition-colors bg-[#101113] text-[#b8bec8] hover:bg-[#222429] hover:text-[#f3f4f6] cursor-pointer';
        });
    }

    function setMoveToPPD() {
        const ppd = findBasePpdPosition();
        if (ppd) { el('m-pos-input').value = ppd.name; }
    }

    function openMoveModal(id) {
        currentMoveSoldierId = id;
        const s = getPersonById(id);
        el('move-modal-title').innerText = `Рух: ${s.fullName || s.callsign}`;
        el('m-pos-input').value = '';
        el('m-current-pos-label').innerText = getPosName(s.positionId);
        
        // Завантажуємо існуючу примітку, якщо є
        el('m-notes').value  = s.note ? s.note.text : '';
        
        el('m-task').value   = s.currentTask || 'піхота';
        el('move-status-grid').innerHTML = STATUS_KEYS.map(k =>
            `<button type="button" data-status="${k}" onclick="setMoveStatus('${k}')" class="status-btn p-2 text-xs rounded-sm border flex items-center space-x-2"><i data-lucide="${STATUSES[k].icon}" class="w-4 h-4"></i><span class="truncate">${STATUSES[k].label}</span></button>`
        ).join('');
        scheduleIcons();
        setMoveStatus(STATUSES[s.status] ? s.status : 'ok');
        openModal('modal-move');
    }

    function saveMove(e) {
        e.preventDefault();
        const s  = getPersonById(currentMoveSoldierId);
        const no = val('m-notes').trim(), ta = val('m-task'), pi = val('m-pos-input').trim();
        let npId = s.positionId, npN = getPosName(s.positionId);
        if (pi !== '') {
            const np = positions.find(p => p.name === pi);
            if (!np) return showToast('Неіснуюча локація!');
            npId = np.id; npN = np.name;
        }

        const hasRotation = getActiveRotationMap().has(s.id);
        const oldType = positions.find(p => p.id === s.positionId)?.type;
        const newType = positions.find(p => p.id === npId)?.type;
        const isDeploymentShift = oldType !== newType;
        const isPosChanged = s.positionId !== npId;

        const executeMove = () => {
            // Якщо боєць переходить у недієздатний статус (300, 200, sick тощо) і локацію вручну не змінено:
            if (pi === '' && selectedMoveStatus !== 'ok') {
                const hospPos = positions.find(p => p.id === 'pos_hosp') || positions.find(p => p.type === 'non_combat');
                const ppdPos  = positions.find(p => p.id === 'pos_ppd')  || positions.find(p => p.type === 'non_combat');
                const retreatPos = (selectedMoveStatus === '300' || selectedMoveStatus === 'sick') ? (hospPos || ppdPos) : ppdPos;
                if (retreatPos && positions.find(p => p.id === s.positionId)?.type === 'combat') {
                    npId = retreatPos.id;
                    npN  = retreatPos.name;
                }
            }

            const l = [];
            if (s.status     !== selectedMoveStatus) l.push(`Статус:[${STATUSES[selectedMoveStatus].label}]`);
            if (s.positionId !== npId)               l.push(`[${getPosName(s.positionId)}] ➔ [${npN}]`);
            if (s.currentTask !== ta)                l.push(`Завд:[${ta}]`);
            
            // Логіка оновлення примітки
            if (no !== '') {
                if (!s.note || s.note.text !== no) {
                    s.note = { text: no, timestamp: new Date().toISOString() };
                }
                l.push(`Прим:${no}`);
            } else if (s.note) {
                delete s.note; // Якщо користувач стер текст — видаляємо примітку
                l.push(`Прим:видалено`);
            }
            
            if (l.length > 0) {
                handleJournalTracking(s.id, s.positionId, npId);
                s.status = selectedMoveStatus; 
                s.positionId = npId; 
                s.currentTask = ta;
                
                const logPrefix = (!hasRotation && isDeploymentShift && isPosChanged) ? '⚠️ БЕЗ ЗАЯВКИ: ' : '';
                addLog(logPrefix + l.join('|'), s.fullName || s.callsign);
                saveState();
            }
            closeModal('modal-move');
            showToast(l.length > 0 ? 'Збережено' : 'Без змін');
        };

        if (isPosChanged && !hasRotation && isDeploymentShift) {
            askConfirm(`🛑 УВАГА: ПОЗАПЛАНОВЕ ПЕРЕМІЩЕННЯ!\n\nПо в/с ${s.fullName || s.callsign} відсутня активна заявка на ротацію.\n\nВи впевнені, що хочете перевести його на позицію "${npN}"?`, executeMove);
            return;
        }

        executeMove();
    }

    // Відображення вікна примітки
    function viewNote(sId) {
        const s = getPersonById(sId);
        if (!s || !s.note) return;
        el('note-view-title').innerHTML = `<i data-lucide="info" class="w-5 h-5 mr-2"></i>Примітка: ${esc(s.callsign || s.fullName)}`;
        el('note-view-text').innerText = s.note.text;
        el('note-view-date-text').innerText = `Додано/Змінено: ${fmtDT(s.note.timestamp)}`;
        el('note-delete-btn').onclick = () => deleteNote(sId);
        openModal('modal-note-view');
        if (typeof scheduleIcons === 'function') scheduleIcons();
    }

    // Швидке видалення примітки
    function deleteNote(sId) {
        const s = getPersonById(sId);
        if (s) {
            delete s.note;
            saveStateSilent();
            renderTab(activeTab); // Перемальовуємо поточну вкладку, щоб оновити іконки
            closeModal('modal-note-view');
            addLog(`Примітку видалено`, s.fullName || s.callsign);
            showToast('Примітку видалено');
        }
    }

    function updateNotesBadge() {
        const count = personnel.filter(p => p.note && p.note.text).length;
        const badge = el('all-notes-badge');
        if (badge) {
            badge.innerText = count;
            if (count > 0) badge.classList.remove('hidden');
            else badge.classList.add('hidden');
        }
        const modalBadge = el('all-notes-modal-badge');
        if (modalBadge) modalBadge.innerText = count;
    }

    function openAllNotesModal() {
        renderAllNotesList();
        openModal('modal-all-notes');
    }

    function renderAllNotesList() {
        updateNotesBadge();
        const list = el('all-notes-list');
        const soldiersWithNotes = personnel.filter(p => p.note && p.note.text).sort((a,b) => new Date(b.note.timestamp) - new Date(a.note.timestamp));
        
        if (soldiersWithNotes.length === 0) {
            list.innerHTML = '<li class="p-8 text-center text-[#989fa9] font-medium">Активних приміток немає</li>';
            return;
        }

        list.innerHTML = soldiersWithNotes.map(s => {
            const pName = getPosName(s.positionId);
            return `<li class="p-4 hover:bg-[#222429] transition-colors">
                <div class="flex justify-between items-start gap-4">
                    <div class="flex-1 min-w-0">
                        <div class="flex items-center gap-2 mb-2 flex-wrap">
                            <span class="font-bold text-sm text-[#f3f4f6]">${esc(s.fullName || 'Невідомо')}</span>
                            ${s.callsign ? `<span class="text-[#93c5fd] font-bold text-sm">"${esc(s.callsign)}"</span>` : ''}
                            <span class="text-[10px] px-1.5 py-0.5 bg-[#222429] border border-[#2e3138] text-[#b8bec8] rounded-sm whitespace-nowrap"><i data-lucide="map-pin" class="w-3 h-3 inline pb-0.5"></i> ${esc(pName)}</span>
                        </div>
                        <p class="text-sm text-[#f3f4f6] whitespace-pre-wrap bg-[#101113] p-3 rounded-sm border border-[#2e3138] inline-block w-full">${esc(s.note.text)}</p>
                        <div class="text-[10px] text-[#989fa9] font-mono tabular-nums mt-2 flex items-center gap-1"><i data-lucide="clock" class="w-3 h-3"></i> Додано: ${fmtDT(s.note.timestamp)}</div>
                    </div>
                    <div class="flex flex-col sm:flex-row gap-2 shrink-0 border-l border-[#2e3138] pl-4 ml-2">
                        <button onclick="openMoveModal('${s.id}'); closeModal('modal-all-notes')" class="p-2 text-[#93c5fd] bg-[#222429] hover:bg-[#2e3138] rounded-sm transition-colors border border-[#2e3138] cursor-pointer" title="Перемістити / Редагувати"><i data-lucide="arrow-right-left" class="w-4 h-4"></i></button>
                        <button onclick="deleteNoteFromList('${s.id}')" class="p-2 text-[#fca5a5] bg-[rgba(224,82,82,0.12)] hover:bg-[rgba(224,82,82,0.22)] rounded-sm transition-colors border border-[rgba(224,82,82,0.45)] cursor-pointer" title="Видалити примітку"><i data-lucide="trash-2" class="w-4 h-4"></i></button>
                    </div>
                </div>
            </li>`;
        }).join('');
        scheduleIcons();
    }

    function deleteNoteFromList(sId) {
        const s = getPersonById(sId);
        if (s && s.note) {
            delete s.note;
            saveStateSilent();
            renderAllNotesList();
            renderTab(activeTab);
            addLog('Примітку видалено', s.fullName || s.callsign);
            showToast('Примітку видалено');
        }
    }

    function submitBulkStatus() {
        const t = val('bulk-names').trim(), st = val('bulk-status-select');
        if (!t) return;
        const ns = t.split('\n').map(n => n.trim()).filter(Boolean);
        let up = 0;
        const nf = [];
        const nameMap = new Map(personnel.map(p => [normPersonName(p.fullName), p]));
        
        const hospPos = positions.find(p => p.id === 'pos_hosp') || positions.find(p => p.type === 'non_combat');
        const ppdPos  = findBasePpdPosition();
        const targetNonCombatPos = (st === '300' || st === 'sick') ? (hospPos || ppdPos) : ppdPos;

        ns.forEach(n => {
            const s = nameMap.get(normPersonName(n));
            if (s) {
                if (s.status !== st) {
                    addLog(`Мас.статус ➔ ${STATUSES[st].label}`, s.fullName);
                    s.status = st;

                    if (st !== 'ok' && targetNonCombatPos) {
                        const currentPos = positions.find(p => p.id === s.positionId);
                        if (currentPos && currentPos.type === 'combat') {
                            handleJournalTracking(s.id, s.positionId, targetNonCombatPos.id);
                            s.positionId = targetNonCombatPos.id;
                            s.deploymentStartTime = null;
                            if (currentPos.commanderId === s.id) {
                                currentPos.commanderId = null;
                            }
                        }
                    }
                    up++;
                }
            } else {
                nf.push(n);
            }
        });

        _posDirty = true;
        saveState();
        closeModal('modal-bulk-status');
        if (nf.length > 0) askConfirm(`Оновлено: ${up}.\nНе знайдено (${nf.length}):\n${nf.slice(0, 5).join('\n')}`, null);
        else showToast(`Оновлено ${up}`);
        el('bulk-names').value = '';
    }

    function submitBulkUnit() {
        const t = val('bulk-unit-names').trim(), u = val('bulk-unit-input').trim();
        if (!t || !u) return showToast('Заповніть підрозділ та список ПІБ!');
        
        const ns = t.split('\n').map(n => n.trim()).filter(Boolean);
        let up = 0, added = 0;
        const now = Date.now();
        const defaultPos = findBasePpdPosition()?.id || 'pos_ppd';
        
        const nameMap = new Map();
        personnel.forEach(p => {
            if (p.fullName) nameMap.set(normPersonName(p.fullName), p);
        });

        ns.forEach((n, i) => {
            const s = nameMap.get(normPersonName(n));
            if (s) {
                if (s.unit !== u) {
                    addLog(`Мас.підрозділ ➔ ${u}`, s.fullName);
                    s.unit = u;
                    up++;
                }
            } else {
                const newId = `s_${now}_bulk_${i}`;
                const nd = {
                    id: newId,
                    fullName: n, callsign: '', rank: 'Солдат', unit: u,
                    status: 'ok', positionId: defaultPos,
                    currentTask: 'піхота', deploymentStartTime: null
                };
                personnel.push(nd);
                personnelMap.set(nd.id, nd);
                handleJournalTracking(nd.id, null, defaultPos);
                addLog(`Швидко додано (${u})`, n);
                added++;
            }
        });
        
        saveState();
        closeModal('modal-bulk-unit');
        el('bulk-unit-names').value = '';
        el('bulk-unit-input').value = '';
        showToast(`Оновлено: ${up}, Додано: ${added}`);
    }

    // ─── POSITION MODAL ───────────────────────────────────────────────────────
    function openPositionModal(id = null) {
        el('modal-position').querySelector('form').reset();
        el('p-id').value = id || '';
        if (id) {
            const p = positions.find(x => x.id === id);
            el('pos-modal-title').innerText = 'Редагувати';
            el('p-name').value = p.name;
            el('p-rop').value  = p.rop || '';
            el('p-type').value = p.type;
            currentPosIcon  = p.icon || 'crosshair';
            tempEquipment   = JSON.parse(JSON.stringify(p.equipment || []));
            el('p-delete-btn').style.display = 'flex';
        } else {
            el('pos-modal-title').innerText = 'Нова';
            el('p-type').value = 'combat';
            currentPosIcon  = 'crosshair';
            tempEquipment   = [];
            el('p-delete-btn').style.display = 'none';
        }
        renderIconGrid();
        renderEquipmentList();
        openModal('modal-position');
    }

    function renderIconGrid() {
        el('p-icon-grid').innerHTML = ICONS.map(i => {
            const a = currentPosIcon === i
                ? 'bg-[rgba(76,142,217,0.16)] border-[#4c8ed9] text-[#93c5fd]'
                : 'bg-[#101113] border-[#2e3138] text-[#b8bec8] hover:bg-[#222429] hover:text-[#f3f4f6]';
            return `<button type="button" onclick="currentPosIcon='${i}'; renderIconGrid()" class="p-2 flex justify-center rounded-sm border cursor-pointer ${a}"><i data-lucide="${i}" class="w-4 h-4"></i></button>`;
        }).join('');
        scheduleIcons();
    }

    function autoSelectIcon() { const t = val('p-type'); if (ICON_MAP[t]) { currentPosIcon = ICON_MAP[t]; renderIconGrid(); } }

    function renderEquipmentList() {
        const l = el('p-equipment-list');
        if (tempEquipment.length === 0) {
            l.innerHTML = '<div class="text-center py-4 text-xs text-[#989fa9]">Порожньо</div>';
        } else {
            l.innerHTML = tempEquipment.map((eq, i) =>
                `<div class="flex gap-2 items-center bg-[#101113] p-2 rounded-sm border border-[#2e3138] mb-2">
                    <input type="text" value="${esc(eq.name)}"     onchange="tempEquipment[${i}].name=this.value"     class="flex-1 p-1.5 border border-[#2e3138] bg-[#17181b] text-[#f3f4f6] rounded-sm text-sm focus:border-[#4c8ed9] outline-none">
                    <input type="text" value="${esc(eq.quantity)}" onchange="tempEquipment[${i}].quantity=this.value" class="w-16 p-1.5 border border-[#2e3138] bg-[#17181b] text-[#f3f4f6] font-mono tabular-nums rounded-sm text-sm text-center focus:border-[#4c8ed9] outline-none">
                    <button type="button" onclick="tempEquipment.splice(${i},1); renderEquipmentList();" class="p-1.5 text-[#fca5a5] hover:bg-[rgba(224,82,82,0.16)] rounded-sm cursor-pointer"><i data-lucide="trash-2" class="w-4 h-4"></i></button>
                </div>`
            ).join('');
        }
        scheduleIcons();
    }

    function addEquipmentRow() { tempEquipment.push({ id: Date.now(), name: '', quantity: '' }); renderEquipmentList(); }

    function savePosition(e) {
        e.preventDefault();
        const id = val('p-id');
        const d  = { name: val('p-name').trim(), rop: val('p-rop').trim(), type: val('p-type'), icon: currentPosIcon, equipment: tempEquipment };
        if (!d.name) return showToast('Введіть назву позиції!');
        if (id) {
            const i = positions.findIndex(p => p.id === id);
            positions[i] = { ...positions[i], ...d };
            addLog('Оновлено позицію', d.name);
        } else {
            d.id = 'p_' + Date.now();
            positions.push(d);
            addLog('Створено', d.name);
        }
        _posDirty = true;
        saveState(['positions']);
        closeModal('modal-position');
        showToast('Збережено');
    }

    function delPos() {
        const id = val('p-id');
        if (personnel.some(p => p.positionId === id)) return showToast('Помилка: На позиції є люди!');
        askConfirm('Видалити позицію?', () => {
            positions = positions.filter(p => p.id !== id);
            _posDirty = true;
            saveState(['positions']);
            closeModal('modal-position');
            showToast('Видалено');
        });
    }

    // ─── ADD TO POS MODAL ─────────────────────────────────────────────────────
    function openAddToPosModal(id) {
        targetAddToPosId = id;
        const p = positions.find(x => x.id === id);
        el('add-to-pos-title').innerText = `Додати на: ${p.name}`;
        el('add-to-pos-search').value = '';
        handleAddToPosSearch();
        openModal('modal-add-to-pos');
    }

    function handleAddToPosSearch() {
        const q = val('add-to-pos-search').toLowerCase();
        const r = el('add-to-pos-results');
        let f = personnel.filter(p => p.positionId !== targetAddToPosId);
        if (q) {
            f = f.filter(p =>
                (p.fullName  || '').toLowerCase().includes(q) ||
                (p.callsign  || '').toLowerCase().includes(q)
            );
        } else {
            f.sort((a, b) => {
                if (a.status === 'ok' && b.status !== 'ok') return -1;
                if (a.status !== 'ok' && b.status === 'ok') return  1;
                return (a.fullName || '').localeCompare(b.fullName || '');
            });
        }
        const pg = f.slice(0, 40);
        if (pg.length === 0) {
            r.innerHTML = '<li class="p-4 text-center text-sm text-[#989fa9]">Не знайдено</li>';
            return;
        }
        const activeRotMap = getActiveRotationMap();
        const to = TASKS.map(t => `<option value="${t}">${t}</option>`).join('');
        r.innerHTML = pg.map(s => {
            const ct = s.currentTask || 'піхота';
            const toSel = to.replace(`value="${ct}"`, `value="${ct}" selected`);
            const rotDir = activeRotMap.get(s.id);
            const inRot = rotDir ? `<span class="inline-flex h-2 w-2 ml-2 shrink-0 rounded-full ${rotDir==='in'?'bg-[#d99b26]':'bg-[#4c8ed9]'}" title="В ротації"></span>` : '';
            return `<li class="flex justify-between p-2 hover:bg-[#222429] border-b border-[#2e3138] gap-2 transition-colors">
                <div class="truncate">
                    <p class="font-bold text-sm truncate text-[#f3f4f6] flex items-center">${esc(s.fullName || 'Невідомо')}${s.callsign ? ` <span class="text-[#93c5fd] font-bold ml-1">"${esc(s.callsign)}"</span>` : ''} ${inRot}</p>
                    <p class="text-xs text-[#b8bec8] truncate">${esc(s.unit) || '—'} | <span class="text-[#93c5fd]">${esc(getPosName(s.positionId))}</span></p>
                </div>
                <div class="flex items-center gap-2">
                    <select id="qt-${s.id}" class="p-1 border border-[#2e3138] bg-[#101113] text-[#f3f4f6] rounded-sm text-xs w-20 focus:border-[#4c8ed9] outline-none">${toSel}</select>
                    <button onclick="confirmAddToPos('${s.id}')" class="px-2.5 py-1 bg-[#2b67ab] hover:bg-[#4c8ed9] text-white border border-[#4c8ed9] rounded-sm text-xs font-semibold cursor-pointer">Додати</button>
                </div>
            </li>`;
        }).join('');
    }

    function confirmAddToPos(sId) {
        const s = getPersonById(sId);
        const p = positions.find(x => x.id === targetAddToPosId);
        const t = val(`qt-${sId}`);
        if (!s || !p) return;

        const hasRotation = getActiveRotationMap().has(s.id);
        const oldType = positions.find(pos => pos.id === s.positionId)?.type;
        const newType = p.type;
        const isDeploymentShift = oldType !== newType;

        const executeAdd = () => {
            const oid = s.positionId;
            s.positionId  = p.id;
            s.currentTask = t;
            handleJournalTracking(s.id, oid, p.id);
            
            const logPrefix = (!hasRotation && isDeploymentShift) ? '⚠️ БЕЗ ЗАЯВКИ: ' : 'Швидко: ';
            addLog(`${logPrefix}[${getPosName(oid)}] ➔ [${p.name}]`, s.fullName);
            
            saveState(['positions']);
            showToast('Додано!');
            handleAddToPosSearch();
        };

        if (!hasRotation && isDeploymentShift) {
            askConfirm(`🛑 УВАГА: ПОЗАПЛАНОВЕ ПЕРЕМІЩЕННЯ!\n\nПо в/с ${s.fullName || s.callsign} відсутня активна заявка.\n\nВи впевнені, що хочете перевести його на "${p.name}"?`, executeAdd);
            return;
        }

        executeAdd();
    }

    // ─── GROUP MODAL ──────────────────────────────────────────────────────────
    function openGroupModal(g) {
        el('g-old-name').value = g;
        el('g-new-name').value = g === 'Основні / Без групи' ? '' : g;
        openModal('modal-group-edit');
    }

    function saveGroupEdit(e) {
        e.preventDefault();
        const o = val('g-old-name'), n = val('g-new-name').trim() || 'Основні / Без групи';
        if (n !== o) {
            positions.forEach(p => {
                if ((p.rop?.trim() || 'Основні / Без групи') === o)
                    p.rop = n === 'Основні / Без групи' ? '' : n;
            });
            const i = groupOrder.indexOf(o);
            if (i !== -1) groupOrder[i] = n;
            if (collapsedGroups[o] !== undefined) { collapsedGroups[n] = collapsedGroups[o]; delete collapsedGroups[o]; }
            _posDirty = true;
            saveState(['positions']);
            showToast('Оновлено');
        }
        closeModal('modal-group-edit');
    }

    function deleteGroupPrompt() {
        const g  = val('g-old-name');
        buildPosCache();
        const gp = groupedPosCache[g] || [];
        if (personnel.some(p => gp.some(x => x.id === p.positionId))) return showToast('Є люди в цій групі!');
        askConfirm(`Видалити групу і ${gp.length} поз.?`, () => {
            const ids = new Set(gp.map(p => p.id));
            positions  = positions.filter(p => !ids.has(p.id));
            groupOrder = groupOrder.filter(x => x !== g);
            delete collapsedGroups[g];
            _posDirty = true;
            saveState(['positions']);
            closeModal('modal-group-edit');
            showToast('Видалено!');
        });
    }

    // ─── JOURNAL MODAL ────────────────────────────────────────────────────────
    function openJournalModal(id) {
        const r = journal.find(j => j.id === id); if (!r) return;
        el('j-id').value    = r.id;
        const displayStartTime = r.startTime;
        el('j-start').value = toLocalISO(displayStartTime);
        el('j-end').value   = toLocalISO(r.endTime);
        openModal('modal-journal-edit');
    }

    function saveJournalEdit(e) {
        e.preventDefault();
        const r  = journal.find(j => j.id === val('j-id'));
        const sv = val('j-start'), ev = val('j-end');
        if (sv) r.startTime = new Date(sv).toISOString();
        r.endTime = ev ? new Date(ev).toISOString() : null;
        const s  = getPersonById(r.soldierId);
        const aj = journal.find(j => j.soldierId === s?.id && !j.endTime);
        if (s && aj && aj.id === r.id) s.deploymentStartTime = r.startTime;
        saveState(['journal','positions']);
        closeModal('modal-journal-edit');
        showToast('Час оновлено!');
    }

    // ─── IMPORT ───────────────────────────────────────────────────────────────
    function submitImport() {
        const t = val('import-text').trim(); if (!t) return;
        let a = 0;
        const now = Date.now();
        const ppdPos = positions.find(p => p.id === 'pos_ppd') 
            || positions.find(p => (p.name || '').toUpperCase().includes('ППД')) 
            || positions.find(p => p.type === 'non_combat') 
            || positions[0];
        const defaultImportPosId = ppdPos ? ppdPos.id : 'pos_ppd';

        t.split('\n').forEach((l, i) => {
            const sep = l.includes('\t') ? '\t' : l.includes(';') ? ';' : ',';
            const c   = l.split(sep).map(x => x.replace(/"/g, '').trim());
            if (c.length >= 1 && c[0]) {
                const fullName = c[0];
                const unit     = c[1] || '';
                const rankRaw  = c[2] || 'Солдат';
                const callsign = c[3] || '';
                
                const r  = RANKS.find(x => x.toLowerCase() === rankRaw.toLowerCase()) || rankRaw;
                const normName = str => (str || '').toLowerCase().replace(/[\u2018\u2019\u02BC\u0060\u00B4']/g, "'").replace(/\s+/g, ' ').trim();
                const ei = personnel.findIndex(p => normName(p.fullName) === normName(fullName));
                if (ei !== -1) {
                    personnel[ei].rank = r;
                    personnel[ei].unit = unit;
                    if (callsign) personnel[ei].callsign = callsign;
                    personnelMap.set(personnel[ei].id, personnel[ei]);
                } else {
                    const nd = {
                        id: `s_${now}_${i}`,
                        fullName: fullName, callsign: callsign, rank: r, unit: unit,
                        status: 'ok', positionId: defaultImportPosId,
                        currentTask: 'піхота', deploymentStartTime: null
                    };
                    personnel.push(nd);
                    personnelMap.set(nd.id, nd);
                    a++;
                }
            }
        });
        addLog(`Імпорт Excel: +${a}`, 'Система');
        saveState();
        closeModal('modal-import');
        el('import-text').value = '';
        showToast(`Додано нових: ${a}`);
    }

    // ─── МІГРАЦІЇ ТА АВТОВІДНОВЛЕННЯ ──────────────────────────────────────────
    function runMigrations() {
        let changed = false;
        
        personnel.forEach(p => {
            if (!p.currentTask) { p.currentTask = 'піхота'; changed = true; }
            
            if (p.status === 'rest') { p.status = 'ok'; changed = true; }
            if (p.status === '500')  { p.status = 'mia'; changed = true; }
            
            if (p.deploymentStartTime === undefined) {
                const pos = positions.find(x => x.id === p.positionId);
                if (pos && pos.type === 'combat') {
                    const activeJ = journal.find(j => j.soldierId === p.id && !j.endTime);
                    p.deploymentStartTime = activeJ ? activeJ.startTime : new Date().toISOString();
                } else {
                    p.deploymentStartTime = null;
                }
                changed = true;
            }
        });
        
        positions.forEach(p => {
            if (p.type === 'base' || p.type === 'hospital') {
                p.type = 'non_combat';
                changed = true;
            } else if (p.type !== 'combat' && p.type !== 'non_combat') {
                p.type = 'combat';
                changed = true;
            }
        });

        journal.forEach(j => {
            if (!j.positionName) {
                const pos = positions.find(x => x.id === j.positionId);
                if (pos) { j.positionName = pos.name; changed = true; }
            }
            if (!j.endTime) {
                const s = getPersonById(j.soldierId);
                if (s && s.deploymentStartTime && new Date(s.deploymentStartTime) < new Date(j.startTime)) {
                    j.startTime = s.deploymentStartTime;
                    changed = true;
                }
            }
        });

        if (changed) saveStateSilent();
    }
    // ─── ROTATIONS (ПЛАНОВІ ЗАМІНИ) ───────────────────────────────────────────
    let tempRotMembers = [];
    let editingRotationIdx = null;

    function sortRotations() {
        if (!plannedRotations || plannedRotations.length === 0) return;
        plannedRotations.sort((a, b) => {
            let aDone = a.members.length > 0;
            a.members.forEach(m => { if (!isMemberDone(m)) aDone = false; });
            let bDone = b.members.length > 0;
            b.members.forEach(m => { if (!isMemberDone(m)) bDone = false; });

            if (aDone && !bDone) return 1;
            if (!aDone && bDone) return -1;
            if (aDone && bDone) return new Date(b.plannedTime) - new Date(a.plannedTime);
            return new Date(a.plannedTime) - new Date(b.plannedTime);
        });
    }

    function updateRotationsBadge() {
        let lateCount = 0;
        const now = new Date();
        plannedRotations.forEach(rot => {
            const isLate = new Date(rot.plannedTime) < now;
            if (isLate) {
                let allDone = true;
                rot.members.forEach(m => { if (!isMemberDone(m)) allDone = false; });
                if (!allDone) lateCount++;
            }
        });
        const badge = el('rotations-badge');
        if (badge) {
            if (lateCount > 0) {
                badge.innerText = lateCount;
                badge.classList.remove('hidden');
            } else {
                badge.classList.add('hidden');
            }
        }
    }

    function isMemberDone(member) {
        const s = getPersonById(member.soldierId);
        if (!s) return true;
        const pos = positions.find(p => p.id === s.positionId);
        const isAtCombat = pos && pos.type === 'combat';
        
        if (member.dir === 'in') return isAtCombat;
        if (member.dir === 'out') return !isAtCombat;
        return false;
    }

    function renderRotations() {
        const c = el('rotations-container');
        if (!c) return;

        let lateCount = 0;
        const now = new Date();

        if (plannedRotations.length === 0) {
            c.innerHTML = '<div class="col-span-full py-10 text-center text-gray-500">Немає запланованих ротацій</div>';
            el('rotations-badge').classList.add('hidden');
            return;
        }

        c.innerHTML = plannedRotations.map((rot, rIdx) => {
            const isLate = new Date(rot.plannedTime) < now;
            let allDone = true;

            const membersHtml = rot.members.map(m => {
                const s = getPersonById(m.soldierId) || { fullName: 'Видалено', callsign: '', positionId: null };
                const done = isMemberDone(m);
                if (!done) allDone = false;
                
                const fullNameStr = s.fullName || 'Невідомо';
                const lastName = fullNameStr.trim().split(/\s+/)[0]; 
                
                const icon = m.dir === 'in' 
                    ? `<i data-lucide="arrow-right-circle" class="w-4 h-4 text-[#fdba74]"></i>` 
                    : `<i data-lucide="arrow-left-circle" class="w-4 h-4 text-[#4c8ed9]"></i>`;
                
                const statusColor = done 
                    ? 'bg-[rgba(52,168,115,0.14)] text-[#6ee7b7] border-[rgba(52,168,115,0.40)]' 
                    : (isLate ? 'bg-[rgba(224,82,82,0.14)] text-[#fca5a5] border-[rgba(224,82,82,0.45)]' : 'bg-[#222429] text-[#b8bec8] border-[#2e3138]');
                
                const statusIcon = done ? '<i data-lucide="check" class="w-3 h-3"></i>' : (isLate ? '<i data-lucide="alert-circle" class="w-3 h-3"></i>' : '<i data-lucide="clock" class="w-3 h-3"></i>');

                const currPosName = s.positionId ? getPosName(s.positionId) : 'Невідомо';
                const targetPosName = m.targetPosId ? getPosName(m.targetPosId) : null;
                
                let currPosColor = 'text-[#f3f4f6]';
                if (m.dir === 'in' && m.targetPosId) {
                    currPosColor = (s.positionId === m.targetPosId) 
                        ? 'text-[#6ee7b7]' 
                        : 'text-[#fdba74]';
                }
                
                let routeInfo = `Зараз: <b class="${currPosColor}">${esc(currPosName)}</b>`;
                if (targetPosName && m.dir === 'in') {
                    routeInfo += ` <span class="text-[#989fa9] mx-1">→</span> План: <b class="text-[#93c5fd]">${esc(targetPosName)}</b>`;
                }

                return `<li class="py-1.5 border-b border-[#2e3138] last:border-0">
                    <div class="flex justify-between items-start gap-2 w-full">
                        <div class="flex items-start gap-1.5 min-w-0 flex-1">
                            <div class="mt-0.5 shrink-0">${icon}</div>
                            <div class="min-w-0 flex-1">
                                <div class="font-bold text-[13px] text-[#f3f4f6] leading-none truncate" title="${esc(fullNameStr)}">
                                    ${esc(lastName)}${s.callsign ? ` <span class="text-[#93c5fd] ml-1">"${esc(s.callsign)}"</span>` : ''}
                                </div>
                                <div class="text-[10px] text-[#b8bec8] mt-1 truncate leading-none">
                                    ${routeInfo}
                                </div>
                            </div>
                        </div>
                        <div class="px-1.5 py-0.5 rounded-sm border text-[9px] font-bold flex items-center gap-1 shrink-0 ${statusColor} self-center">
                            ${statusIcon} 
                            <span class="hidden sm:inline">${done ? 'ВИКОНАНО' : (m.dir === 'in' ? 'ЩЕ НА ППД' : 'ЩЕ НА ПОЗИЦІЇ')}</span>
                            <span class="sm:hidden">${done ? 'ОК' : 'ЧЕКАЄ'}</span>
                        </div>
                    </div>
                </li>`;
            }).join('');

            if (isLate && !allDone) lateCount++;

            const headerColor = allDone ? 'bg-[rgba(52,168,115,0.10)]' : (isLate ? 'bg-[rgba(224,82,82,0.10)]' : 'bg-[#222429]');
            const borderColor = allDone ? 'border-[rgba(52,168,115,0.45)]' : (isLate ? 'border-[rgba(224,82,82,0.50)]' : 'border-[#2e3138]');

            return `<div class="bg-[#17181b] rounded-sm border ${borderColor} overflow-hidden flex flex-col relative">
                <div class="px-4 py-3 border-b ${borderColor} ${headerColor} flex justify-between items-start">
                    <div>
                        <h3 class="font-bold text-sm leading-tight text-[#f3f4f6]">${esc(rot.name)}</h3>
                        <p class="text-[11px] text-[#b8bec8] font-mono tabular-nums flex items-center mt-1"><i data-lucide="clock" class="w-3 h-3 mr-1"></i>План: ${fmtDT(rot.plannedTime)}</p>
                    </div>
                    <div class="flex gap-1 z-10">
                        <button onclick="openRotationModal(${rIdx})" class="text-[#b8bec8] hover:text-[#93c5fd] bg-[#17181b] border border-[#2e3138] p-1 rounded-sm cursor-pointer"><i data-lucide="edit-2" class="w-4 h-4"></i></button>
                        <button onclick="deleteRotation(${rIdx})" class="text-[#b8bec8] hover:text-[#fca5a5] bg-[#17181b] border border-[#2e3138] p-1 rounded-sm cursor-pointer"><i data-lucide="trash-2" class="w-4 h-4"></i></button>
                    </div>
                </div>
                <div class="p-3">
                    <ul class="space-y-1">${membersHtml}</ul>
                </div>
                ${allDone ? `<div class="p-3 border-t border-[#2e3138] bg-[#222429]"><button onclick="completeRotation(${rIdx})" class="w-full bg-[#2b67ab] hover:bg-[#4c8ed9] text-white px-4 py-2 rounded-sm font-semibold transition-colors text-xs border border-[#4c8ed9] cursor-pointer">Всі на місцях. Завершити!</button></div>` : ''}
            </div>`;
        }).join('');

        updateRotationsBadge();
        scheduleIcons();
    }

    function renderRotationsWidget() {
        const w = el('dashboard-rotations-widget');
        const l = el('widget-rotations-list');
        if (!w || !l) return;

        if (plannedRotations.length === 0) {
            w.classList.add('hidden');
            return;
        }

        w.classList.remove('hidden');
        const now = new Date();
        
        const activeRots = plannedRotations.slice(0, 3);

        l.innerHTML = activeRots.map(rot => {
            const isLate = new Date(rot.plannedTime) < now;
            let allDone = true;
            rot.members.forEach(m => { if(!isMemberDone(m)) allDone = false; });

            const border = allDone ? 'border-[rgba(52,168,115,0.45)]' : (isLate ? 'border-[rgba(224,82,82,0.50)]' : 'border-[rgba(76,142,217,0.40)]');
            const bg = allDone ? 'bg-[rgba(52,168,115,0.08)]' : (isLate ? 'bg-[rgba(224,82,82,0.08)]' : 'bg-[rgba(76,142,217,0.08)]');
            const icon = allDone ? '<i data-lucide="check-circle" class="w-4 h-4 text-[#34a873]"></i>' : (isLate ? '<i data-lucide="alert-triangle" class="w-4 h-4 text-[#e05252]"></i>' : '<i data-lucide="clock" class="w-4 h-4 text-[#4c8ed9]"></i>');

            return `<div class="p-3 rounded-sm border ${border} ${bg} flex justify-between items-center cursor-pointer hover:bg-[#222429] transition-colors" onclick="switchTab('rotations')">
                <div>
                    <p class="font-bold text-sm text-[#f3f4f6] truncate max-w-[150px]">${esc(rot.name)}</p>
                    <p class="text-[10px] text-[#b8bec8] font-mono tabular-nums">${fmtDT(rot.plannedTime)} • ${rot.members.length} чол.</p>
                </div>
                ${icon}
            </div>`;
        }).join('');
        scheduleIcons();
    }

    function openRotationModal(idx = null) {
        fillDynamicLists();
        editingRotationIdx = idx;
        
        if (idx !== null) {
            const rot = plannedRotations[idx];
            el('rot-name').value = rot.name;
            el('rot-time').value = toLocalISO(rot.plannedTime);
            tempRotMembers = JSON.parse(JSON.stringify(rot.members)); 
        } else {
            el('rot-name').value = '';
            const d = new Date();
            d.setHours(d.getHours() + 2);
            el('rot-time').value = toLocalISO(d.toISOString());
            tempRotMembers = [];
        }
        
        el('rot-search').value = '';
        el('rot-search-results').innerHTML = '';
        renderTempRotMembers();
        openModal('modal-rotation');
    }

    function handleRotSearch() {
        const q = val('rot-search').toLowerCase();
        const r = el('rot-search-results');
        if (q.length < 2) { r.innerHTML = ''; return; }

        const f = personnel.filter(p => 
            (p.fullName || '').toLowerCase().includes(q) || 
            (p.callsign || '').toLowerCase().includes(q)
        ).slice(0, 5);

        if (f.length === 0) { r.innerHTML = '<li class="p-2 text-xs text-[#989fa9]">Не знайдено</li>'; return; }

        r.innerHTML = f.map(s => `
            <li class="flex justify-between items-center p-2 hover:bg-[#222429] cursor-pointer transition-colors" onclick="addMemberToRot('${s.id}')">
                <div class="truncate"><span class="font-bold text-sm text-[#f3f4f6]">${esc(s.fullName || 'Невідомо')}</span>${s.callsign ? ` <span class="text-[#93c5fd] font-bold text-sm ml-1">"${esc(s.callsign)}"</span>` : ''} <span class="text-xs text-[#b8bec8] ml-1 truncate">(${esc(getPosName(s.positionId))})</span></div>
                <i data-lucide="plus-circle" class="w-4 h-4 text-[#4c8ed9] shrink-0"></i>
            </li>
        `).join('');
        scheduleIcons();
    }

    function addMemberToRot(sId) {
        if (tempRotMembers.some(m => m.soldierId === sId)) return showToast('Вже у списку!');
        const dir = val('rot-dir');
        tempRotMembers.push({ soldierId: sId, dir: dir, targetPosId: '' });
        el('rot-search').value = '';
        el('rot-search-results').innerHTML = '';
        renderTempRotMembers();
    }

    function removeMemberFromRot(idx) {
        tempRotMembers.splice(idx, 1);
        renderTempRotMembers();
    }

    function updateTempRotPosByName(idx, posName) {
        const p = positions.find(x => x.name === posName);
        tempRotMembers[idx].targetPosId = p ? p.id : '';
        renderTempRotMembers(); 
    }

    function renderTempRotMembers() {
        const list = el('rot-members-list');
        if (tempRotMembers.length === 0) {
            list.innerHTML = '<li class="text-xs text-[#989fa9] text-center py-2">Додайте бійців через пошук вище</li>';
            return;
        }

        list.innerHTML = tempRotMembers.map((m, i) => {
            const s = getPersonById(m.soldierId);
            const dirHtml = m.dir === 'in' 
                ? '<span class="bg-[rgba(234,88,12,0.14)] text-[#fdba74] border border-[rgba(234,88,12,0.42)] text-[10px] px-2 py-0.5 rounded-sm font-bold shrink-0">ЗАХОДИТЬ →</span>' 
                : '<span class="bg-[rgba(76,142,217,0.14)] text-[#93c5fd] border border-[rgba(76,142,217,0.40)] text-[10px] px-2 py-0.5 rounded-sm font-bold shrink-0">← ВИХОДИТЬ</span>';
            
            const currPosName = m.targetPosId ? getPosName(m.targetPosId) : '';
            const searchInput = `<input type="text" list="pos-datalist" placeholder="Пошук позиції..." value="${esc(currPosName)}" onchange="updateTempRotPosByName(${i}, this.value)" class="text-[11px] p-1.5 rounded-sm border border-[#2e3138] bg-[#17181b] text-[#f3f4f6] placeholder-[#989fa9] w-[140px] outline-none focus:border-[#4c8ed9]">`;

            return `<li class="flex justify-between items-center bg-[#101113] p-2 rounded-sm border border-[#2e3138] gap-2">
                <div class="flex items-center gap-2 flex-1 min-w-0 flex-wrap">
                    ${dirHtml}
                    <span class="font-bold text-sm text-[#f3f4f6] truncate">${esc(s.fullName || 'Невідомо')}${s.callsign ? ` <span class="text-[#93c5fd] font-bold ml-1">"${esc(s.callsign)}"</span>` : ''}</span>
                    ${m.dir === 'in' ? searchInput : ''}
                </div>
                <button onclick="removeMemberFromRot(${i})" class="text-[#fca5a5] hover:bg-[rgba(224,82,82,0.22)] p-1 shrink-0 bg-[rgba(224,82,82,0.12)] border border-[rgba(224,82,82,0.45)] rounded-sm cursor-pointer"><i data-lucide="x" class="w-4 h-4"></i></button>
            </li>`;
        }).join('');
        scheduleIcons();
    }

    function saveRotation() {
        const n = val('rot-name').trim();
        const t = val('rot-time');
        
        if (!n) return showToast('Введіть назву ротації!');
        if (!t) return showToast('Оберіть плановий час!');
        if (tempRotMembers.length === 0) return showToast('Додайте хоча б одного бійця!');

        if (editingRotationIdx !== null) {
            plannedRotations[editingRotationIdx].name = n;
            plannedRotations[editingRotationIdx].plannedTime = new Date(t).toISOString();
            plannedRotations[editingRotationIdx].members = [...tempRotMembers];
            addLog(`📝 Оновлено заявку: ${n}`, 'Система');
        } else {
            plannedRotations.push({
                id: 'rot_' + Date.now(),
                name: n,
                plannedTime: new Date(t).toISOString(),
                createdAt: new Date().toISOString(),
                members: [...tempRotMembers]
            });
            addLog(`📝 Створено заявку: ${n}`, 'Система');
        }

        saveStateSilent();
        closeModal('modal-rotation');
        renderRotations();
        renderRotationsWidget();
        showToast(editingRotationIdx !== null ? 'Ротацію оновлено!' : 'Ротацію заплановано!');
    }

    function deleteRotation(idx) {
        askConfirm('Видалити цю ротацію з плану?', () => {
            const rotName = plannedRotations[idx].name;
            addLog(`🗑️ ВИДАЛЕНО ЗАЯВКУ: ${rotName}`, 'Система');
            plannedRotations.splice(idx, 1);
            saveStateSilent();
            renderRotations();
            renderRotationsWidget();
            showToast('Видалено');
        });
    }

    function completeRotation(idx) {
        askConfirm('Всі на місцях. Завершити ротацію?', () => {
            const rotName = plannedRotations[idx].name;
            addLog(`✅ ЗАВЕРШЕНО ЗАЯВКУ: ${rotName}`, 'Система');
            plannedRotations.splice(idx, 1);
            saveStateSilent();
            renderRotations();
            renderRotationsWidget();
            showToast('Завершено');
        });
    }

    // --- CONTEXT MENU LOGIC ---
    let currentCtxSoldierId = null;
    function openSoldierContextMenu(e, soldierId) {
        e.preventDefault();
        currentCtxSoldierId = soldierId;
        const s = personnel.find(x => x.id === soldierId);
        if(!s) return;

        const cm = el('soldier-context-menu');
        cm.classList.remove('hidden');
        
        // Position it near mouse
        let x = e.pageX;
        let y = e.pageY;
        // Keep it inside viewport
        if(x + 200 > window.innerWidth) x -= 200;
        if(y + 250 > window.innerHeight) y -= 250;
        
        cm.style.left = x + 'px';
        cm.style.top = y + 'px';

        // Populate tasks dropdown
        const tSel = el('ctx-task-select');
        tSel.innerHTML = '<option value="" disabled selected>-- Обрати завдання --</option>' + 
                         TASKS.map(t => `<option value="${t}">${t}</option>`).join('');
    }

    document.addEventListener('click', (e) => {
        const cm = el('soldier-context-menu');
        if(cm && !cm.contains(e.target)) {
            cm.classList.add('hidden');
        }
    });

    function cmAction(action) {
        const s = personnel.find(x => x.id === currentCtxSoldierId);
        if(!s) return;
        
        el('soldier-context-menu').classList.add('hidden');

        if (action === 'copy_pib') {
            copySoldierPib(s.id);
            return;
        }

        if (action === 'copy_full') {
            copySoldierFull(s.id);
            return;
        }
        
        if (action === 'move') {
            startTargetMode(s);
            return;
        }
        
        if (action === 'commander') {
            const pos = positions.find(p => p.id === s.positionId);
            if (pos) { pos.commanderId = s.id; saveState(); showToast('Призначено старшим'); }
        } else if (action === 'ppd') {
            const basePos = findBasePpdPosition();
            if (basePos) {
                const oldPosId = s.positionId;
                handleJournalTracking(s.id, oldPosId, basePos.id);
                s.positionId = basePos.id;
                s.currentTask = 'ППД';
                s.deploymentStartTime = null;
                addLog(`[${getPosName(oldPosId)}] ➔ [${basePos.name}]`, s.fullName || s.callsign);
                saveState(); showToast('Переміщено на ППД');
            } else {
                showToast('Позицію ППД не знайдено!');
            }
        } else if (action === 'edit') {
            openMoveModal(s.id);
        }
    }

    function renderUI() {
        renderTab(activeTab);
    }

    function cmChangeTask(task) {
        if(!task) return;
        const s = personnel.find(x => x.id === currentCtxSoldierId);
        if(!s) return;
        el('soldier-context-menu').classList.add('hidden');
        s.currentTask = task;
        saveState();
        renderUI();
    }

    // --- TARGET MODE ---
    window.isMovingSoldierId = null;
    window.isMovingPosId = null;

    function startTargetMode(soldier) {
        window.isMovingPosId = null;
        window.isMovingSoldierId = soldier.id;
        document.body.classList.add('target-mode-active');
        const banner = el('target-mode-banner');
        if (banner) {
            banner.classList.remove('top-0', 'hidden');
            banner.classList.add('top-14');
        }
        el('target-mode-text').innerText = `Клікніть на позицію, щоб перемістити туди: ${soldier.fullName || 'Бійця'}`;
    }

    function startPosTargetMode(posId, event) {
        if (event) {
            event.stopPropagation();
        }
        if (window.isMovingPosId === posId) {
            cancelTargetMode();
            showToast('Режим переміщення скасовано');
            return;
        }
        window.isMovingSoldierId = null;
        window.isMovingPosId = posId;
        const p = positions.find(x => x.id === posId);
        document.body.classList.add('target-mode-active');
        const banner = el('target-mode-banner');
        if (banner) {
            banner.classList.remove('top-0', 'hidden');
            banner.classList.add('top-14');
        }
        el('target-mode-text').innerText = `Клікніть на іншу позицію чи заголовок групи для переміщення: ${p ? p.name : 'Позиції'}`;
        showToast(`Виберіть куди перемістити «${p ? p.name : 'позицію'}»`);
        renderPositions();
    }

    function cancelTargetMode() {
        const hadPos = !!window.isMovingPosId;
        window.isMovingSoldierId = null;
        window.isMovingPosId = null;
        document.body.classList.remove('target-mode-active');
        el('target-mode-banner').classList.add('hidden');
        if (hadPos) {
            renderPositions();
        }
    }

    function handleTargetModeDrop(posId) {
        if (!window.isMovingSoldierId) return;
        const s = personnel.find(x => x.id === window.isMovingSoldierId);
        if (s && s.positionId !== posId) {
            const oldPosId = s.positionId;
            handleJournalTracking(s.id, oldPosId, posId);
            s.positionId = posId;
            s.inRotation = false;
            addLog(`[${getPosName(oldPosId)}] ➔ [${getPosName(posId)}]`, s.fullName || s.callsign);
            saveState();
            showToast(`${s.fullName || 'Бійця'} переміщено!`, 'success');
        }
        cancelTargetMode();
    }

    function handlePosTargetModeDrop(targetPosId) {
        if (!window.isMovingPosId) return;
        const srcPosId = window.isMovingPosId;
        if (srcPosId === targetPosId) {
            cancelTargetMode();
            return;
        }
        const srcPos = positions.find(p => p.id === srcPosId);
        const tgtPos = positions.find(p => p.id === targetPosId);
        if (srcPos && tgtPos) {
            const origSrcIdx = positions.findIndex(p => p.id === srcPosId);
            const origTgtIdx = positions.findIndex(p => p.id === targetPosId);
            if (origSrcIdx !== -1 && origTgtIdx !== -1) {
                const [movedPos] = positions.splice(origSrcIdx, 1);
                const oldRop = movedPos.rop?.trim() || 'Основні / Без групи';
                const newRop = tgtPos.rop?.trim() || 'Основні / Без групи';
                const ropChanged = oldRop !== newRop;
                movedPos.rop = tgtPos.rop;
                
                positions.splice(origTgtIdx, 0, movedPos);
                _posDirty = true;
                saveState(['positions']);
                if (ropChanged) {
                    addLog(`[${movedPos.name}] ➔ переміщено в [${newRop}]`, 'Позиції');
                    showToast(`Позицію "${movedPos.name}" переміщено в [${newRop}]!`, 'success');
                } else {
                    addLog(`[${movedPos.name}] ➔ змінено порядок`, 'Позиції');
                    showToast(`Порядок позиції "${movedPos.name}" змінено!`, 'success');
                }
            }
        }
        cancelTargetMode();
    }

    function handlePosTargetModeDropGroup(groupName) {
        if (!window.isMovingPosId) return;
        const srcPosId = window.isMovingPosId;
        const srcPos = positions.find(p => p.id === srcPosId);
        if (srcPos) {
            const oldRop = srcPos.rop?.trim() || 'Основні / Без групи';
            const newRop = groupName?.trim() || 'Основні / Без групи';
            if (oldRop !== newRop) {
                const srcIdx = positions.findIndex(p => p.id === srcPosId);
                if (srcIdx !== -1) {
                    const [movedPos] = positions.splice(srcIdx, 1);
                    movedPos.rop = groupName;
                    positions.push(movedPos);
                    _posDirty = true;
                    saveState(['positions']);
                    addLog(`[${movedPos.name}] ➔ переміщено в [${newRop}]`, 'Позиції');
                    showToast(`Позицію "${movedPos.name}" переміщено в [${newRop}]!`, 'success');
                }
            }
        }
        cancelTargetMode();
    }
    
    document.addEventListener('keydown', e => {
        if (e.key === 'Escape' && (window.isMovingSoldierId || window.isMovingPosId)) cancelTargetMode();
    });



    // --- DRAG AND DROP LOGIC ---
    let draggedSoldierId = null;
    let draggedPosId = null;
    let autoScrollDir = 0;
    let autoScrollInterval = null;

    function clearAutoScroll() {
        if (autoScrollInterval) {
            clearInterval(autoScrollInterval);
            autoScrollInterval = null;
        }
        autoScrollDir = 0;
    }

    document.addEventListener('dragend', clearAutoScroll);
    document.addEventListener('drop', clearAutoScroll);

    // FIX: Manual mouse wheel scrolling during drag and drop (might not fire in all browsers, kept just in case)
    document.addEventListener('wheel', (e) => {
        if (draggedSoldierId || draggedPosId) {
            const scrollContainer = document.querySelector('.overflow-y-auto.flex-1');
            if (scrollContainer) {
                scrollContainer.scrollTop += e.deltaY;
            }
        }
    }, { passive: true });

    // Глобальний обробник перетягування для автоскролу (працює завжди)
    document.addEventListener('dragover', (e) => {
        if (!draggedSoldierId && !draggedPosId) return;
        
        const scrollContainer = document.querySelector('.overflow-y-auto.flex-1');
        if (scrollContainer) {
            const rect = scrollContainer.getBoundingClientRect();
            const threshold = 120; // Чутлива зона автоскролу
            
            if (e.clientY < rect.top + threshold) {
                autoScrollDir = -1;
            } else if (e.clientY > rect.bottom - threshold) {
                autoScrollDir = 1;
            } else {
                autoScrollDir = 0;
            }
            
            if (autoScrollDir !== 0 && !autoScrollInterval) {
                autoScrollInterval = setInterval(() => {
                    if(document.querySelector('.overflow-y-auto.flex-1')) {
                        document.querySelector('.overflow-y-auto.flex-1').scrollTop += autoScrollDir * 25;
                    }
                }, 30);
            } else if (autoScrollDir === 0 && autoScrollInterval) {
                clearAutoScroll();
            }
        }
    });

    function handleDragStart(e, soldierId) {
        draggedSoldierId = soldierId;
        draggedPosId = null;
        lastDropSide = null;
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', soldierId);
        setTimeout(() => e.target.classList.add('opacity-50'), 0);
    }

    function handlePosDragStart(e, posId) {
        e.stopPropagation();
        draggedPosId = posId;
        draggedSoldierId = null;
        lastDropSide = null;
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', 'pos:' + posId);
        const card = e.target.closest('.tactical-card');
        if (card) {
            if (e.dataTransfer.setDragImage) {
                e.dataTransfer.setDragImage(card, 50, 25);
            }
            setTimeout(() => card.classList.add('opacity-40'), 0);
        }
    }

    let lastHoveredCard = null;
    let lastDropSide = null; // 'before' | 'after'

    function cleanCardHoverIndicators() {
        if (lastHoveredCard) {
            lastHoveredCard.classList.remove(
                'border-[#34a873]', 'border-[#4c8ed9]', 'bg-[#222429]',
                'border-r-2', '!border-r-[#4c8ed9]', 'border-l-2', '!border-l-[#4c8ed9]'
            );
            lastHoveredCard = null;
        }
        lastDropSide = null;
    }

    function handleDragOver(e) {
        e.preventDefault(); 
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'move';
        
        const card = e.target.closest('.tactical-card');
        if (!card) return;

        if (draggedSoldierId) {
            if (card !== lastHoveredCard) {
                cleanCardHoverIndicators();
                card.classList.add('border-[#34a873]', 'bg-[#222429]');
                lastHoveredCard = card;
            }
            return;
        }

        if (draggedPosId) {
            const targetPosId = card.getAttribute('data-pos-id');
            if (targetPosId === draggedPosId) {
                cleanCardHoverIndicators();
                return;
            }

            const rect = card.getBoundingClientRect();
            // В сітці орієнтуємося на ліву або праву половину картки
            const isAfter = (e.clientX > rect.left + rect.width / 2);
            const side = isAfter ? 'after' : 'before';

            if (card !== lastHoveredCard || side !== lastDropSide) {
                cleanCardHoverIndicators();
                
                if (isAfter) {
                    card.classList.add('border-r-2', '!border-r-[#4c8ed9]', 'bg-[#222429]');
                } else {
                    card.classList.add('border-l-2', '!border-l-[#4c8ed9]', 'bg-[#222429]');
                }
                lastHoveredCard = card;
                lastDropSide = side;
            }
        }
    }

    function handleDragLeave(e) {
        const card = e.target.closest('.tactical-card');
        if (card && card === lastHoveredCard && !card.contains(e.relatedTarget)) {
            cleanCardHoverIndicators();
        }
    }

    function handleDrop(e, targetPosId) {
        e.preventDefault();
        e.stopPropagation();
        const dropSide = lastDropSide;
        cleanCardHoverIndicators();

        if (draggedSoldierId) {
            const s = personnel.find(x => x.id === draggedSoldierId);
            draggedSoldierId = null;
            if (!s) return;

            if (s.positionId !== targetPosId) {
                const oldPosId = s.positionId;
                s.positionId = targetPosId;
                
                const targetPos = positions.find(p => p.id === targetPosId);
                if (targetPos && targetPos.type === 'non_combat') {
                    s.currentTask = 'ППД';
                    s.deploymentStartTime = null;
                }

                handleJournalTracking(s.id, oldPosId, targetPosId);
                addLog(`[${getPosName(oldPosId)}] ➔ [${getPosName(targetPosId)}]`, s.fullName || s.callsign);
                saveState(); // includes re-render
                showToast('Переміщено!');
            }
            return;
        }

        if (draggedPosId) {
            const srcPosId = draggedPosId;
            draggedPosId = null;
            if (srcPosId === targetPosId) return;

            const srcPos = positions.find(p => p.id === srcPosId);
            const tgtPos = positions.find(p => p.id === targetPosId);
            if (!srcPos || !tgtPos) return;

            const srcIdx = positions.findIndex(p => p.id === srcPosId);
            if (srcIdx === -1) return;
            const [movedPos] = positions.splice(srcIdx, 1);

            const oldRop = movedPos.rop?.trim() || 'Основні / Без групи';
            const newRop = tgtPos.rop?.trim() || 'Основні / Без групи';
            const ropChanged = oldRop !== newRop;
            movedPos.rop = tgtPos.rop;

            // Знаходимо точний індекс цілі у списку після вилучення
            const newTgtIdx = positions.findIndex(p => p.id === targetPosId);
            if (newTgtIdx !== -1) {
                const insertIdx = (dropSide === 'after') ? newTgtIdx + 1 : newTgtIdx;
                positions.splice(insertIdx, 0, movedPos);
                _posDirty = true;
                saveState(['positions']);
                if (ropChanged) {
                    addLog(`[${movedPos.name}] ➔ переміщено в [${newRop}]`, 'Позиції');
                    showToast(`Позицію "${movedPos.name}" переміщено в [${newRop}]!`, 'success');
                } else {
                    addLog(`[${movedPos.name}] ➔ змінено порядок`, 'Позиції');
                    showToast(`Порядок позиції "${movedPos.name}" змінено!`, 'success');
                }
            }
        }
    }

    function handleGroupGridDragOver(e) {
        if (!draggedPosId) return;
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'move';
        const grid = e.currentTarget;
        if (grid && !grid.classList.contains('border-[#4c8ed9]')) {
            grid.classList.add('border', 'border-[#4c8ed9]', 'bg-[#17181b]');
        }
    }

    function handleGroupGridDragLeave(e) {
        const grid = e.currentTarget;
        if (grid && !grid.contains(e.relatedTarget)) {
            grid.classList.remove('border', 'border-[#4c8ed9]', 'bg-[#17181b]');
        }
    }

    function handleGroupGridDrop(e, targetGroupName) {
        if (!draggedPosId) return;
        e.preventDefault();
        e.stopPropagation();
        const grid = e.currentTarget;
        if (grid) {
            grid.classList.remove('border', 'border-[#4c8ed9]', 'bg-[#17181b]');
        }
        cleanCardHoverIndicators();
        const srcPosId = draggedPosId;
        draggedPosId = null;

        const srcPos = positions.find(p => p.id === srcPosId);
        if (!srcPos) return;

        const oldRop = srcPos.rop?.trim() || 'Основні / Без групи';
        const newRop = targetGroupName?.trim() || 'Основні / Без групи';
        if (oldRop === newRop) return;

        const srcIdx = positions.findIndex(p => p.id === srcPosId);
        if (srcIdx !== -1) {
            const [movedPos] = positions.splice(srcIdx, 1);
            movedPos.rop = targetGroupName;
            positions.push(movedPos);
            _posDirty = true;
            saveState(['positions']);
            addLog(`[${movedPos.name}] ➔ переміщено в [${newRop}]`, 'Позиції');
            showToast(`Позицію "${movedPos.name}" переміщено в [${newRop}]!`, 'success');
        }
    }
    
    document.addEventListener('dragend', (e) => {
        draggedSoldierId = null;
        draggedPosId = null;
        clearAutoScroll();
        cleanCardHoverIndicators();
        document.querySelectorAll('.tactical-card').forEach(c => {
            c.classList.remove(
                'opacity-40', 'opacity-50',
                'border-[#34a873]', 'border-[#4c8ed9]', 'bg-[#222429]',
                'border-r-2', '!border-r-[#4c8ed9]', 'border-l-2', '!border-l-[#4c8ed9]'
            );
        });
        document.querySelectorAll('.grid').forEach(g => {
            g.classList.remove('border', 'border-[#4c8ed9]', 'bg-[#17181b]');
        });
    });


    

            
            // HTML event attributes resolve names on window, not inside this IIFE.
            // Export the existing UI callbacks only; keep application data private.
            Object.assign(window, {
                addBackupTime, addEquipmentRow, addMemberToRot, autoSelectIcon,
                cancelTargetMode, changePerPage, checkDiskBackupStatus, clearJournal, closeImportPasswordModal,
                closeModal, cmAction, cmChangeTask, completeRotation, confirmAddToPos,
                copyPositionPersonnel, copySoldierPib, deleteGroupPrompt, deleteJournalEntry,
                deleteNoteFromList, deleteRotation, deleteSoldier, delPos,
                executeEncryptedExport, executeEncryptedImport, exportDetailedReport,
                exportJournalExcel, forceSaveToDisk, handleAddToPosSearch, handleDragLeave, handleDragOver,
                handleDragStart, handleDrop, handleFileSelect, handleGroupGridDragLeave,
                handleGroupGridDragOver, handleGroupGridDrop, handleJournalSearch,
                handlePosDragStart, handlePosTargetModeDrop, handlePosTargetModeDropGroup,
                handleRotSearch, handleSearch, handleTargetModeDrop, handleUndo,
                moveGroupOrder, movePositionOrder, nextPage, openAddToPosModal,
                openAllNotesModal, openBackupSettingsModal,
                openExportModal, openGroupModal, openJournalModal, openModal,
                openMoveModal, openPositionModal, openRotationModal, openSoldierContextMenu,
                openSoldierModal, prevPage, removeBackupTime, removeMemberFromRot,
                renderEquipmentList, renderIconGrid, renderJournal, resetPageAndRender, restoreFromDiskBackup,
                saveGroupEdit, saveJournalEdit, saveMove, savePosition, saveRotation,
                saveSoldier, setMoveStatus, setMoveToPPD, setQuickStatusFilter,
                startPosTargetMode, submitBulkStatus, submitBulkUnit, submitImport,
                switchTab, toggleAllInGroup, toggleCommander, toggleDarkMode, toggleGroup,
                togglePos, toggleSidebar, toggleSortingLock, updateTempRotPosByName,
                viewEquipment, viewNote, wipeAllDataPrompt
            });
            Object.defineProperties(window, {
                currentPosIcon: { configurable: true, get: () => currentPosIcon, set: value => { currentPosIcon = value; } },
                tempEquipment: { configurable: true, get: () => tempEquipment }
            });
            bootstrapPersonnel();
            return {
                init: () => {
                    if (typeof applyTheme === 'function') applyTheme();
                    scheduleIcons();
                }
            };
        })();
    
};

export { createPersonnelModule };
