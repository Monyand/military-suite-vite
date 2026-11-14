import { useEffect, useRef, useState } from 'react';
import { bindDialogFocusTrap } from './dialog-focus.js';

export const SUITE_VERSION = '2.2.2';

const SCOPE_META = {
    suite:    { label: 'Комплекс',        badge: 'bg-[#172133] text-[#93c5fd] border-[#4c8ed9]/45' },
    med:      { label: 'Наші втрати о/с', badge: 'bg-[#122624] text-[#5eead4] border-[#14b8a6]/45' },
    tactical: { label: 'Журнал О/С',      badge: 'bg-[#162235] text-[#93c5fd] border-[#3b82f6]/45' },
};

const CHANGELOG_ENTRIES = [
    {
        id: 'suite-2.2.2',
        version: 'v2.2.2',
        date: '14.11.2026',
        scope: 'med',
        isCurrent: true,
        title: 'Спрощення обліку СЗЧ/повернень, виправлення лічильників та очищення інтерфейсу',
        items: [
            { label: 'Зручніше оформлення СЗЧ та повернень', text: 'Автопідтягування даних із активного запису СЗЧ при виборі бійця, автозаповнення дат за замовчуванням та швидкі кнопки «Сьогодні» / «Вчора» для дати повернення й рапорту.' },
            { label: 'Точні бейджі, історія та хронологія', text: 'Синхронізовано лічильники вкладок із фільтром «Актуальні», виправлено порядок ланцюжка «СЗЧ → Повернення з СЗЧ» і статус СЗЧ в історії епізодів бійця.' },
            { label: 'Очищення шапки та модалки бекапу', text: 'Прибрано зайві локальні інструменти («Масова заміна», «Довідники», «Локальний диск (Автозахист)») та відновлено кнопку «База / Бекап».' },
        ],
    },
    {
        id: 'suite-2.2.1',
        version: 'v2.2.1',
        date: '14.11.2026',
        scope: 'suite',
        title: 'Очищення шапок модулів, уніфікація бейджів та єдиний бекап',
        items: [
            { label: 'Журнал О/С — навігація та позиції', text: 'Перенесено навігацію в компактну верхню шапку, прибрано дублююче локальне керування базою на користь «Єдиного Бекапу», вирівняно бейджі груп і фіксацію прибуття (< 1д).' },
            { label: 'Наші втрати о/с (MedTactical) — шапка', text: 'Прибрано зайві елементи («HUB», «COMBAT_MED», «Диск: Офлайн», «База / Бекап»), вирівняно висоту вкладок і кнопок дій до 32px та уніфіковано бейджі-лічильники.' },
        ],
    },
    {
        id: 'suite-2.2.0',
        version: 'v2.2.0',
        date: '12.11.2026',
        scope: 'suite',
        title: 'Графітова палітра, єдиний журнал оновлень та вирівнювання реєстрів',
        items: [
            { label: 'Нейтральна палітра та акценти модулів', text: 'Уніфіковано матову темно-графітову палітру (#101113 / #17181b / #222429) із чіткими розділювачами таблиць та окремими акцентами вкладок комплексу.' },
            { label: 'Єдиний журнал оновлень комплексу', text: 'Окремі модульні кнопки версій прибрано — у верхній панелі додано спільне вікно історії оновлень із фільтрацією за розділами.' },
            { label: 'Вирівнювання карток «Наші втрати о/с»', text: 'Вирівняно ширину правого блоку бейджів, висоту вертикальних розділювачів, базову лінію підписів та фіксовану сітку колонок «Причина | Факт | Док».' },
            { label: 'Типографіка «Журналу О/С»', text: 'Назву підрозділів на картках позицій переведено на звичайний шрифт без моноширинності для однорідного вигляду зі списками.' },
        ],
    },
    {
        id: 'suite-2.0.0',
        version: 'v2.0.0',
        date: '01.11.2026',
        scope: 'suite',
        title: 'Єдина платформа MILITARY SUITE (S3 · ОЧ) та офлайн-збірка',
        items: [
            { label: 'Єдина оболонка модулів', text: 'Об\u0027єднано «Втрати Противника», «Наші втрати о/с», «Журнал О/С», «Завдання», «Втрати ОВТ» та «Статус позицій» у спільному вікні зі збереженням стану фільтрів.' },
            { label: 'Наскрізний пошук (Ctrl+K)', text: 'Швидкий пошук записів по всіх базах даних комплексу з переходом безпосередньо до картки запису.' },
            { label: 'Перевірка цілісності та спільні довідники', text: 'Інструмент діагностики зв\u0027язків між базами («Перевірка даних») і централізоване керування довідниками звань, підрозділів та шаблонів ОВТ.' },
            { label: 'Єдиний зашифрований бекап', text: 'Архівування та відновлення всіх баз і налаштувань одним файлом (.mils, AES-256-GCM, PBKDF2-SHA-256) із попереднім аудитом змін і локальним автозахистом.' },
        ],
    },
    {
        id: 'med-3.6.5',
        version: 'v3.6.5',
        date: '26.10.2026',
        scope: 'med',
        title: 'Стабілізація панелі аналітики, повернення нагору та спокійні індикатори',
        items: [
            { label: 'Стабілізація таб-бару аналітики', text: 'Дії експорту («Доповідь A4/PDF», «Звіт Текст», «Експорт Excel») перенесено у внутрішню панель фільтрів, що усунуло зсув вкладок шапки.' },
            { label: 'Швидке повернення нагору', text: 'Плаваюча кнопка повернення на початок сторінки при прокручуванні довгих реєстрів понад 300px.' },
            { label: 'Спокійні індикатори статусу', text: 'Прибрано пульсацію з індикатора зв\u0027язку з диском та мітки черги евакуації для зниження зорового навантаження.' },
        ],
    },
    {
        id: 'med-3.6.4',
        version: 'v3.6.4',
        date: '15.10.2026',
        scope: 'med',
        title: 'Ручне введення дати/часу та стилі фокусу полів',
        items: [
            { label: 'Редагування дати та часу з клавіатури', text: 'Прибрано примусовий showPicker() при кліку на поля дати й часу — числові сегменти редагуються напряму з клавіатури.' },
            { label: 'Стилі фокусу (:focus-visible)', text: 'Усунуто подвійні рамки навколо текстових полів зі збереженням коректної темної теми для datetime-local.' },
        ],
    },
    {
        id: 'tactical-1.6.0',
        version: 'v1.6.0',
        date: '08.10.2026',
        scope: 'tactical',
        title: 'Трьохрівневе збереження даних (Triple-Tier Persistence)',
        items: [
            { label: 'IndexedDB (TacticalTaktDB_v1)', text: 'Локальне сховище без обмеження у 5 МБ, захищене від очищення кешу браузера.' },
            { label: 'Фоновий бекап на диск та Auto-Hydrate', text: 'Синхронізація стану в _backups/takt_oblik_latest.json та автоматичне підтягування бази при старті.' },
        ],
    },
    {
        id: 'med-3.6.3',
        version: 'v3.6.3',
        date: '29.09.2026',
        scope: 'med',
        title: 'Пріоритет 200, валідація хронології та дедуплікація бійців',
        items: [
            { label: 'Термінальний пріоритет статусу «Загибель (200)»', text: 'Усунуто перезапис статусу загибелі іншими епізодами та гарантовано виключення з активної черги евакуації.' },
            { label: 'Ланцюжки статусів і перевірка хронології', text: 'Додано StatusHistoryChainBadge і блокування помилкових часових інверсій при збереженні.' },
            { label: 'Захист від дублювання бійців', text: 'Автоматичне зіставлення з нормалізацією гомогліфів за ПІБ та позивним.' },
        ],
    },
    {
        id: 'med-3.6.2',
        version: 'v3.6.2',
        date: '26.09.2026',
        scope: 'med',
        title: 'Картки тріажу та повна деталізація уражень',
        items: [
            { label: '3-рядковий формат карток тріажу', text: 'Повний огляд позивного, звання, підрозділу, таймера очікування, поранень та локації без обрізань.' },
            { label: 'Специфічні ураження', text: 'Детальне відображення травм ока, краш-синдрому, ЧМТ, ампутацій, баротравм та гемо/пневмотораксу.' },
        ],
    },
    {
        id: 'tactical-1.5.0',
        version: 'v1.5.0',
        date: '22.09.2026',
        scope: 'tactical',
        title: 'Відмовостійкість сховища, логіка змін та стандартизація Z-Index',
        items: [
            { label: 'Захист сховища (Anti-WSOD)', text: 'Безпечне читання JSON, контроль квоти LocalStorage, обмеження стека скасувань до 15 знімків та валідація бекапів.' },
            { label: 'Автоматичний відвід і закриття змін', text: 'При переведенні в санітарні/тилові статуси бійці автоматично переводяться в тил із фіксацією закінчення зміни.' },
        ],
    },
    {
        id: 'med-3.6.1',
        version: 'v3.6.1',
        date: '18.09.2026',
        scope: 'med',
        title: 'Стабільність експорту Excel, числових дат та таймерів тріажу',
        items: [
            { label: 'Конвертація дат і стабільний експорт', text: 'Коректна обробка серійних дат Excel у parseSafeDate та безпечне звільнення тимчасових URL-об\u0027єктів.' },
            { label: 'Точний таймер очікування', text: 'Хвилинна точність і автооновлення таймерів тріажу разом із мемоізацією карток.' },
        ],
    },
    {
        id: 'med-3.6.0',
        version: 'v3.6.0',
        date: '09.09.2026',
        scope: 'med',
        title: 'Служба бекапів на локальний диск та відновлення в 1 клік',
        items: [
            { label: 'Фоновий бекап (_backups)', text: 'Автоматичне шифрування AES-256 і запис на локальний диск через службу диспетчера.' },
            { label: 'Індикатор стану диска та Auto-Restore', text: 'Статус синхронізації у шапці й швидке відновлення при порожньому браузерному сховищі.' },
        ],
    },
    {
        id: 'tactical-1.4.1',
        version: 'v1.4.1',
        date: '04.09.2026',
        scope: 'tactical',
        title: 'Drag-and-Drop індикатори вставки та режим вибору цілі',
        items: [
            { label: 'Покращений Drag-and-Drop', text: 'Точні індикатори місця вставки в 2D-сітці позицій та швидке переміщення через Target Mode.' },
            { label: 'Швидке копіювання (v1.3.2)', text: 'Копіювання ПІБ в один клік, контекстне меню та формування нумерованого списку позиції.' },
        ],
    },
    {
        id: 'med-3.5.0',
        version: 'v3.5.0',
        date: '29.08.2026',
        scope: 'med',
        title: 'Стандартизація позивних, розширена карта тіла та симетрія форм',
        items: [
            { label: 'Title Case для позивних і Body Map HUD', text: 'Канонічний формат позивних («Сокіл», «Альфа-1»), розширений військово-медичний класифікатор травм із клінічними підказками.' },
            { label: 'Донесення A4/PDF і Data Guard (v3.1–v3.4)', text: 'Друкована форма донесення, точний облік евакуації 200/300/ЗБВ, авто-виправлення дат та аварійні тіньові знімки.' },
        ],
    },
    {
        id: 'tactical-1.3.0',
        version: 'v1.3.0',
        date: '18.08.2026',
        scope: 'tactical',
        title: 'Темна палітра, типографіка та базовий реліз модулів',
        items: [
            { label: 'Єдина темна палітра та фільтри', text: 'Впроваджено темний інтерфейс, швидкі фільтри статусів, базові картки тріажу та автономний режим роботи.' },
        ],
    },
];

const FILTERS = [
    { key: 'all',      label: 'Усі' },
    { key: 'suite',    label: 'Комплекс' },
    { key: 'med',      label: 'Наші втрати о/с' },
    { key: 'tactical', label: 'Журнал О/С' },
];

export function ChangelogModal({ onClose }) {
    const [scopeFilter, setScopeFilter] = useState('all');
    const panelRef = useRef(null);

    useEffect(() => bindDialogFocusTrap(panelRef, onClose), [onClose]);

    const visibleEntries = scopeFilter === 'all'
        ? CHANGELOG_ENTRIES
        : CHANGELOG_ENTRIES.filter(entry => entry.scope === scopeFilter);

    return (
        <div
            onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
            className="fixed inset-0 z-[21000] bg-black/80 flex items-center justify-center p-4 overscroll-contain"
        >
            <section
                ref={panelRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby="suite-changelog-title"
                className="bg-[#17181b] border border-[#2e3138] rounded-sm w-full max-w-3xl max-h-[88vh] flex flex-col overflow-hidden text-[#f3f4f6]"
            >
                <div className="px-5 py-3.5 border-b border-[#2e3138] bg-[#101113] flex items-center justify-between gap-3 shrink-0">
                    <div className="flex items-center gap-3 min-w-0">
                        <div className="w-8 h-8 rounded-sm bg-[#222429] border border-[#2e3138] flex items-center justify-center text-[#4c8ed9] shrink-0">
                            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                                <path d="M3 3v5h5" />
                                <path d="M12 7v5l3 2" />
                            </svg>
                        </div>
                        <div className="min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                                <h2 id="suite-changelog-title" className="text-sm sm:text-base font-semibold text-[#f3f4f6] tracking-tight">
                                    Історія оновлень
                                </h2>
                                <span className="text-[10px] font-mono tabular-nums px-1.5 py-0.5 rounded-sm bg-[#222429] text-[#93c5fd] border border-[#2e3138] font-semibold">
                                    v{SUITE_VERSION}
                                </span>
                            </div>
                            <p className="text-xs text-[#989fa9] truncate">MILITARY SUITE · S3 / ОЧ — хронологія змін комплексу та модулів</p>
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        aria-label="Закрити історію оновлень"
                        className="px-2.5 py-1.5 rounded-sm bg-[#222429] hover:bg-[#282b31] border border-[#2e3138] hover:border-[#3c404a] text-xs font-semibold text-[#f3f4f6] transition-colors cursor-pointer shrink-0"
                    >
                        Закрити
                    </button>
                </div>

                <div className="px-5 py-2.5 border-b border-[#2e3138] bg-[#17181b] flex items-center justify-between gap-2 flex-wrap shrink-0">
                    <div className="flex items-center bg-[#101113] border border-[#2e3138] rounded-sm p-0.5 gap-0.5 flex-wrap" role="tablist" aria-label="Фільтр оновлень за модулем">
                        {FILTERS.map(filter => {
                            const active = scopeFilter === filter.key;
                            return (
                                <button
                                    key={filter.key}
                                    type="button"
                                    role="tab"
                                    aria-selected={active}
                                    onClick={() => setScopeFilter(filter.key)}
                                    className={`px-2.5 py-1 rounded-sm text-xs transition-colors cursor-pointer whitespace-nowrap ${
                                        active
                                            ? 'bg-[#222429] text-[#f3f4f6] font-semibold border border-[#3c404a]'
                                            : 'text-[#989fa9] hover:text-[#e6edf3] border border-transparent font-medium'
                                    }`}
                                >
                                    {filter.label}
                                </button>
                            );
                        })}
                    </div>
                    <span className="text-[11px] font-mono tabular-nums text-[#989fa9]">
                        Релізів: {visibleEntries.length}
                    </span>
                </div>

                <div className="overflow-y-auto overscroll-contain flex-1 bg-[#101113] divide-y divide-[#2e3138]">
                    {visibleEntries.map(entry => {
                        const scope = SCOPE_META[entry.scope] || SCOPE_META.suite;
                        return (
                            <article
                                key={entry.id}
                                className={`px-5 py-4 space-y-2.5 ${entry.isCurrent ? 'border-l-2 border-l-[#4c8ed9] bg-[#17181b]/60' : ''}`}
                            >
                                <div className="flex items-start justify-between gap-3">
                                    <div className="flex items-center gap-2 flex-wrap min-w-0">
                                        <span className="font-mono font-semibold text-xs text-[#f3f4f6] tabular-nums">
                                            {entry.version}
                                        </span>
                                        <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-sm border ${scope.badge}`}>
                                            {scope.label}
                                        </span>
                                        {entry.isCurrent && (
                                            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-sm border bg-[#3da372]/15 text-[#6ee7b7] border-[#3da372]/40">
                                                Поточна
                                            </span>
                                        )}
                                        <h3 className="text-xs sm:text-[13px] font-semibold text-[#e6edf3] leading-snug">
                                            {entry.title}
                                        </h3>
                                    </div>
                                    <span className="text-[11px] font-mono tabular-nums text-[#989fa9] shrink-0 pt-0.5">
                                        {entry.date}
                                    </span>
                                </div>
                                <ul className="space-y-1.5 text-xs text-[#b8bec8] list-disc pl-4 leading-relaxed">
                                    {entry.items.map((item, idx) => (
                                        <li key={idx}>
                                            <strong className="font-semibold text-[#e6edf3]">{item.label}:</strong>{' '}
                                            <span>{item.text}</span>
                                        </li>
                                    ))}
                                </ul>
                            </article>
                        );
                    })}
                </div>

                <div className="px-5 py-2.5 border-t border-[#2e3138] bg-[#17181b] flex items-center justify-between text-[11px] text-[#989fa9] shrink-0">
                    <span>Автономний офлайн-комплекс · MILITARY SUITE</span>
                    <button
                        type="button"
                        onClick={onClose}
                        className="px-3 py-1 rounded-sm bg-[#222429] hover:bg-[#282b31] border border-[#2e3138] hover:border-[#3c404a] text-xs font-semibold text-[#f3f4f6] transition-colors cursor-pointer"
                    >
                        Закрити
                    </button>
                </div>
            </section>
        </div>
    );
}

