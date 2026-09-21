

const DocumentJournal = (() => {
            const KEY = 'document_journal_v1';
            const tabs = ['tasks', 'ovt', 'positions'];
            const schemas = {
                tasks: { title: 'Завдання', sheets: ['завдання', 'tasks'], fields: [
                    ['date', 'Дата', 'date'], ['task', 'Зміст завдання', 'textarea', true],
                    ['reportedInPbd', 'Подано в ПБД', 'checkbox'],
                    ['status', 'Статус', ['Заплановано', 'Виконується', 'Виконано', 'Не виконано']], ['comment', 'Коментар', 'textarea']
                ] },
                ovt: { title: 'Втрати ОВТ', sheets: ['втрати овт', 'овт', 'ovt'], fields: [
                    ['date', 'Дата', 'date'], ['time', 'Час', 'time'], ['position', 'Позиція у документі', 'text'],
                    ['category', 'Категорія', ['БпЛА', 'Зброя', 'Транспорт', 'РЕБ', 'Зв\'язок', 'Інше']], ['nomenclature', 'Номенклатура / Модель', 'text', true],
                    ['status', 'Статус', ['ВТРАЧЕНО', 'ЗНИЩЕНО', 'ПОШКОДЖЕНО', 'ЗНАЙДЕНО']],
                    ['serialNumber', 'Серійний номер / VIN', 'text'], ['plateNumber', 'Номер авто', 'text'],
                    ['isEvent', 'Подія з поміткою *', 'checkbox'], ['urgentDocNo', '№ позатермінового донесення', 'text'], ['comment', 'Коментар / Причина', 'textarea'],
                    // Append-only: keep the original eleven Excel columns and legacy rows.
                    ['taskText', 'Завдання', 'text'], ['routeText', 'Маршрут', 'text'], ['equipmentType', 'Тип техніки', 'text'],
                    ['eventDescription', 'Опис події', 'text'], ['consequence', 'Наслідок', 'text'], ['coordinates', 'Координати події', 'text'],
                    ['reportSubject', 'Формулювання у висновку', 'text'], ['factoryNumber', 'Заводський номер', 'text'], ['boardNumber', 'Бортовий номер', 'text'],
                    ['locationMode', 'Спосіб зазначення місця', 'text'], ['identifierType', 'Тип ідентифікатора', 'text'], ['registrationType', 'Тип реєстраційного номера', 'text']
                ] },
                positions: { title: 'Статус позицій', sheets: ['статус позицій', 'позиції', 'positions'], fields: [
                    ['date', 'Дата зміни', 'date'], ['name', 'Назва позиції', 'text', true],
                    ['status', 'Документальна дія', ['виставлена', 'облаштовується', 'знята', 'знищена', 'переміщена', 'перейменована']],
                    ['docNumber', '№ Позатермінового донесення', 'text'], ['details', 'Примітка до документа', 'textarea'],
                    ['reportedInPbd', 'Подано в ПБД', 'checkbox'],
                    ['category', 'Категорія позиції', ['Піхотні', 'Мін. Батр.', 'Вогневі', 'БпЛА', 'Інші', 'Запасні позиції']],
                    ['newName', 'Нова назва позиції', 'text'], ['positionId', 'ID позиції (зв’язок записів)', 'text'],
                    ['opensRegister', 'Нова історія облаштування', 'checkbox'],
                    ['destinationPositionId', 'ID позиції-орієнтира в документі', 'text'], ['destinationName', 'На місце позиції (за документом)', 'text'],
                    ['renameBatchId', 'ID пакета перейменування', 'text']
                ] }
            };
            // Group only the cards/filter; keep original document categories intact.
            const positionCategoryCards = ['Піхотні', 'ОВгП', 'БпЛА', 'Інші', 'Запасні позиції'];
            const matchesPositionCategory = (category, filter) => filter === 'ОВгП' ? ['Мін. Батр.', 'Вогневі', 'ОВгП'].includes(category) : category === filter;
            const filters = () => ({ search: '', from: '', to: '', status: '', category: '', event: '', unreported: false, missingDoc: false, needsReview: false });
            const defaultOvtDict = { 'БпЛА': ['DJI Mavic 3', 'DJI Mavic 3T', 'Autel EVO Max 4T'], 'Зброя': ['АК-74', 'РКК', 'ПКМ'], 'Транспорт': [], 'РЕБ': ['Силует', 'Купол'], 'Зв\'язок': ['Starlink', 'Motorola 4400'], 'Інше': [] };
            const empty = () => ({ version: 1, tasks: [], ovt: [], positions: [], settings: { tab: 'tasks', filters: Object.fromEntries(tabs.map(tab => [tab, filters()])), ovtDict: defaultOvtDict } });
            const settings = value => ({ tab: tabs.includes(value?.tab) ? value.tab : 'tasks', ovtDict: value?.ovtDict || defaultOvtDict, filters: Object.fromEntries(tabs.map(tab => [tab,
                Object.fromEntries(Object.entries(filters()).map(([key, fallback]) => [key, typeof value?.filters?.[tab]?.[key] === typeof fallback ? value.filters[tab][key] : fallback]))
            ])) });
            const norm = value => String(value ?? '').normalize('NFKC').trim().toLocaleLowerCase('uk-UA').replace(/\s+/g, ' ');
            const checked = value => value === true || value === 1 || ['так', 'true', '1', '✓', '✔', '☑'].includes(norm(value));
            const dateKey = value => {
                let text = String(value ?? '').trim();
                if (value instanceof Date && !isNaN(value)) text = value.toISOString().slice(0, 10);
                if (typeof value === 'number' && Number.isFinite(value) && value >= 1 && value < 2958466) text = new Date(Math.round((value - 25569) * 86400000)).toISOString().slice(0, 10);
                const uk = text.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})(?:\s.*)?$/);
                if (uk) text = `${uk[3]}-${uk[2].padStart(2, '0')}-${uk[1].padStart(2, '0')}`;
                if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return '';
                const parsed = new Date(text + 'T00:00:00Z');
                return !isNaN(parsed) && parsed.toISOString().slice(0, 10) === text ? text : '';
            };
            const dateLabel = value => dateKey(value) ? dateKey(value).split('-').reverse().join('.') : String(value || '—');
            const timeValue = value => {
                if (value === '' || value == null) return '';
                if (typeof value === 'number' && Number.isFinite(value)) {
                    const minutes = Math.round(((value % 1) + 1) % 1 * 1440) % 1440;
                    return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
                }
                const match = String(value).trim().match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
                return match && +match[1] < 24 && +match[2] < 60 ? `${match[1].padStart(2, '0')}:${match[2]}` : '';
            };
            const cleanRow = (tab, input) => Object.fromEntries(schemas[tab].fields.map(([key, , type]) => [key,
                type === 'checkbox' ? checked(input[key]) : type === 'date' ? dateKey(input[key]) : type === 'time' ? timeValue(input[key]) : String(input[key] ?? '').trim()
            ]));
            const rowError = (tab, row) => {
                if (!dateKey(row.date)) return 'Вкажіть коректну дату.';
                const missing = schemas[tab].fields.find(([key, , , required]) => required && !String(row[key] || '').trim());
                if (missing) return `Заповніть поле «${missing[1]}».`;
                if (!row.status) return 'Оберіть статус / документальну дію.';
                return '';
            };
            const validate = data => {
                if (!data || data.version !== 1 || typeof data.settings !== 'object' || !data.settings || Array.isArray(data.settings)) throw new Error('Невірний формат документального журналу. Дані не перезаписано.');
                tabs.forEach(tab => {
                    if (!Array.isArray(data[tab])) throw new Error('Пошкоджений розділ: ' + schemas[tab].title);
                    const ids = new Set();
                    data[tab].forEach(row => {
                        if (!row || typeof row.id !== 'string' || !row.id || ids.has(row.id)) throw new Error('Пошкоджені або повторні ID: ' + schemas[tab].title);
                        ids.add(row.id);
                        schemas[tab].fields.forEach(([key, , type], index) => {
                            if (tab === 'ovt' && index >= 11 && row[key] === undefined) return;
                            if (tab === 'positions' && ['category', 'newName', 'positionId', 'opensRegister', 'destinationPositionId', 'destinationName', 'renameBatchId'].includes(key) && row[key] === undefined) return;
                            if (type === 'checkbox' ? typeof row[key] !== 'boolean' : typeof row[key] !== 'string') throw new Error('Пошкоджене поле: ' + key);
                        });
                        if (rowError(tab, row)) throw new Error('Пошкоджений запис: ' + schemas[tab].title);
                    });
                });
                if (data.positionAudit !== undefined && (!Array.isArray(data.positionAudit) || data.positionAudit.some(entry => !entry || typeof entry.id !== 'string' || typeof entry.recordId !== 'string' || typeof entry.positionId !== 'string' || typeof entry.at !== 'string' || ![entry.before, entry.after].every(row => row === null || (row && typeof row === 'object' && !Array.isArray(row)))))) throw new Error('Пошкоджена історія виправлень позицій.');
                return data;
            };
            const fingerprint = (tab, row) => JSON.stringify(schemas[tab].fields.filter(([key]) => !['reportedInPbd', 'positionId', 'renameBatchId'].includes(key)).map(([key, , type]) => type === 'checkbox' ? !!row[key] : norm(row[key])));
            const merge = (current, incoming) => {
                const next = { ...current };
                let added = 0, duplicates = 0;
                tabs.forEach(tab => {
                    const seen = new Set(current[tab].map(row => fingerprint(tab, row)));
                    const fresh = [];
                    (incoming[tab] || []).forEach(input => {
                        const row = cleanRow(tab, input);
                        if (rowError(tab, row)) throw new Error('Імпорт містить некоректний запис.');
                        const key = fingerprint(tab, row);
                        if (seen.has(key)) { duplicates++; return; }
                        seen.add(key); added++;
                        fresh.push({ ...row, id: 'doc_' + crypto.randomUUID(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
                    });
                    next[tab] = [...current[tab], ...fresh];
                });
                return { next, added, duplicates };
            };
            const readWorkbook = (workbook, xlsx) => {
                const incoming = { tasks: [], ovt: [], positions: [] }, ignored = [], issues = [];
                workbook.SheetNames.forEach(sheetName => {
                    const tab = tabs.find(key => schemas[key].sheets.includes(norm(sheetName)));
                    if (!tab) { ignored.push(sheetName); return; }
                    const rows = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: '', raw: true });
                    rows.slice(1).forEach((cells, index) => {
                        if (!cells.some(cell => String(cell ?? '').trim())) return;
                        const input = Object.fromEntries(schemas[tab].fields.map(([key], i) => [key, cells[i] ?? '']));
                        if (workbook.Workbook?.WBProps?.date1904 && typeof input.date === 'number') input.date += 1462;
                        const row = cleanRow(tab, input);
                        const error = rowError(tab, row) || (tab === 'ovt' && input.time !== '' && !timeValue(input.time) ? 'Некоректний час.' : '');
                        if (error) issues.push(`${sheetName}, рядок ${index + 2}: ${error}`);
                        else incoming[tab].push(row);
                    });
                });
                return { incoming, ignored, issues };
            };
            const hasDoc = row => !!norm(row.docNumber ?? row.urgentDocNo) && !['-', '—', '--', '?', 'неофіційно', 'немає', 'ні', 'не вказано', 'очікується', 'невідомо', 'без номера', 'б/н', 'н/д', 'n/a'].includes(norm(row.docNumber ?? row.urgentDocNo));
            const filtered = (tab, rows, options) => rows.filter(row => {
                const haystack = schemas[tab].fields.filter(([, , type]) => type !== 'checkbox').map(([key]) => row[key]).join(' ');
                return (!options.search || norm(haystack).includes(norm(options.search))) &&
                    (!options.from || row.date >= options.from) && (!options.to || row.date <= options.to) &&
                    (!options.status || row.status === options.status) && (!options.category || (options.category === '__uncategorized' ? !row.category : tab === 'positions' ? matchesPositionCategory(row.category, options.category) : row.category === options.category)) && (!options.event || row.isEvent === (options.event === 'marked')) &&
                    (!options.unreported || !row.reportedInPbd) && (!options.missingDoc || !hasDoc(row));
            }).sort((a, b) => b.date.localeCompare(a.date) || (b.createdAt || '').localeCompare(a.createdAt || ''));
            return { KEY, tabs, schemas, positionCategoryCards, matchesPositionCategory, filters, defaultOvtDict, empty, settings, norm, checked, dateKey, dateLabel, timeValue, cleanRow, rowError, validate, fingerprint, merge, readWorkbook, hasDoc, filtered };
        })();

export { DocumentJournal };
