import { parseMedicalDate, localMedicalInput, injuryGroups, describeInjuries } from '../../core/medical-records.js';

const DAY = 86400000;
const PVR = new Set(['200 (від ран)', '200 (ПВР)', '200 ПВР']);
const CATEGORIES = [
    ['Загибель (200)', '200 (Бойові)'], ['200 (від ран)', '200 (ПВР)'], ['Небойова смерть (200)', '200 (Небойові)'],
    ['Поранення (300)', '300 (Поранення)'], ['Бойове травмування (300)', '300 (Бойові травми)'],
    ['Небойове травмування (300)', '300 (Небойові)'], ['Зниклий безвісти (ЗБВ)', 'ЗБВ'], ['СЗЧ', 'СЗЧ'], ['Дезертирство', 'Дезертирство']
];
const SEVERITIES = ['Критичний', 'Важкий', 'Середній', 'Легкий'];
const category = ep => PVR.has(ep.lossType) ? '200 (від ран)' : ep.lossType === 'Повернення з СЗЧ' ? 'СЗЧ' : ep.lossType || 'Не вказано';
const is200 = ep => PVR.has(ep.lossType) || ep.lossType?.includes('(200)');
const is300 = ep => ep.lossType?.includes('(300)');
const isMia = ep => ep.lossType === 'Зниклий безвісти (ЗБВ)';
const isAwol = ep => ['СЗЧ', 'Повернення з СЗЧ', 'Дезертирство'].includes(ep.lossType);
const sum = values => values.reduce((total, value) => total + value, 0);
const labelType = ep => PVR.has(ep.lossType) ? '200 (ПВР)' : ep.lossType || 'Не вказано';

function bound(value, end = false) {
    if (!value) return 0;
    const time = parseMedicalDate(/^\d{4}-\d{2}-\d{2}$/.test(value) ? value + (end ? 'T23:59:59.999' : 'T00:00') : value);
    if (!time) throw new Error('Некоректна межа звітного періоду: ' + value);
    return time;
}
// Excel dates represent local wall-clock fields, not UTC instants.
function excelDate(value, dateOnly = false) {
    const time = parseMedicalDate(value);
    if (!time) return value == null ? '' : String(value);
    const date = new Date(time);
    return new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate(), dateOnly ? 0 : date.getHours(), dateOnly ? 0 : date.getMinutes(), dateOnly ? 0 : date.getSeconds()));
}
function excelTime(value) {
    const time = parseMedicalDate(value);
    if (!time) return '';
    const date = new Date(time);
    return (date.getHours() * 3600 + date.getMinutes() * 60 + date.getSeconds()) / 86400;
}

export function medicalReportData({ episodes, allEpisodes = episodes, selection = {}, now = new Date() }) {
    const from = bound(selection.dateFrom), to = bound(selection.dateTo, true), asOf = to || now.getTime();
    if (from && to && from > to) throw new Error('Початок звітного періоду пізніший за кінець.');
    const inScope = ep => (!selection.sector || selection.sector === 'all' || ep.actualLoc === selection.sector || ep.docLoc === selection.sector)
        && (!selection.udp || selection.udp === 'all' || (selection.udp === 'yes' ? !!ep.inUdp : !ep.inUdp));
    const latest = new Map();
    for (const ep of allEpisodes) {
        const time = parseMedicalDate(ep.date);
        if (!time || time > asOf) continue;
        const key = ep.soldierId ?? ep.id, previous = latest.get(key);
        latest.set(key, !previous ? ep : !!is200(previous) !== !!is200(ep) ? (is200(ep) ? ep : previous) : time > parseMedicalDate(previous.date) ? ep : previous);
    }
    const pending = [...latest.values()].filter(ep => inScope(ep) && (is200(ep) || is300(ep) || isMia(ep))
        && (ep.evacStatus === 'Не евакуйований' || (ep.evacStatus === 'Евакуйований' && parseMedicalDate(ep.evacTime || ep.evacDate) > asOf)));
    // Evacuations use their own date, not the injury-date selection or the final
    // status of a person who subsequently died. No mutations of source records.
    const evacuated = allEpisodes.filter(ep => {
        if (!inScope(ep) || !(is200(ep) || is300(ep)) || ep.evacStatus !== 'Евакуйований') return false;
        const event = parseMedicalDate(ep.date), evac = parseMedicalDate(ep.evacTime || ep.evacDate);
        return event > 0 && evac >= event && evac <= asOf && (!from || evac >= from);
    });
    const missingEvacDates = allEpisodes.filter(ep => inScope(ep) && (is200(ep) || is300(ep)) && ep.evacStatus === 'Евакуйований'
        && parseMedicalDate(ep.date) <= asOf && !parseMedicalDate(ep.evacTime || ep.evacDate)).length;
    const wrongIntervals = allEpisodes.filter(ep => inScope(ep) && ep.evacStatus === 'Евакуйований' && (is200(ep) || is300(ep))
        && parseMedicalDate(ep.date) > 0 && parseMedicalDate(ep.date) <= asOf && parseMedicalDate(ep.evacTime || ep.evacDate) > 0
        && parseMedicalDate(ep.evacTime || ep.evacDate) < parseMedicalDate(ep.date)).length;
    return { episodes, evacuated, pending, from, to, asOf, missingEvacDates, wrongIntervals };
}

const COLORS = { navy: 'FF0F172A', header: 'FF1E293B', teal: 'FF0F766E', white: 'FFFFFFFF', ink: 'FF172033', muted: 'FF475569', border: 'FFE2E8F0', total: 'FFF1F5F9' };
function rowColor(ep) {
    if (is300(ep)) return ({ Критичний: 'FFFFE4E6', Важкий: 'FFFFEDD5', Середній: 'FFFEF9C3', Легкий: 'FFECFDF5' })[ep.severity] || 'FFFEF3C7';
    if (is200(ep)) return PVR.has(ep.lossType) ? 'FFE2E8F0' : 'FFF1F5F9';
    if (isMia(ep)) return 'FFEFF6FF';
    return isAwol(ep) ? 'FFF5F3FF' : COLORS.white;
}
function priority(ep) {
    if (is300(ep)) { const index = SEVERITIES.indexOf(ep.severity); return index < 0 ? 5 : index + 1; }
    return is200(ep) ? 6 : 7;
}

export function createMedicalWorkbook(ExcelJS, options) {
    const { episodes, personFor, regions, filters = '', selection = {}, now = new Date() } = options;
    const data = medicalReportData({ ...options, now }), workbook = new ExcelJS.Workbook();
    workbook.creator = 'Military Suite'; workbook.lastModifiedBy = 'Military Suite'; workbook.created = now;
    workbook.calcProperties.fullCalcOnLoad = true;
    const categories = [...CATEGORIES];
    for (const ep of episodes) if (!categories.some(([key]) => key === category(ep))) categories.push([category(ep), category(ep)]);
    const totals = rows => categories.map(([key]) => rows.filter(ep => category(ep) === key).length);
    const formula = (expression, result) => ({ formula: expression, result });
    const person = ep => personFor(ep) || {};

    function sheet(name, widths, freeze = 0) {
        const ws = workbook.addWorksheet(name, { views: [{ showGridLines: false, ...(freeze ? { state: 'frozen', ySplit: freeze } : {}) }] });
        ws.columns = widths.map(width => ({ width })); ws.properties.defaultRowHeight = 22;
        ws.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: widths.length > 14 ? 8 : 9,
            margins: { left: 0.25, right: 0.25, top: 0.4, bottom: 0.4, header: 0.15, footer: 0.15 } };
        ws.headerFooter.oddFooter = '&L' + name + '&RСторінка &P з &N'; return ws;
    }
    function fitHeight(ws, current) {
        let lines = 1;
        current.eachCell(cell => {
            const value = cell.value, text = value instanceof Date ? '30.09.2026 23:59' : value?.formula ? String(value.result ?? '') : String(value ?? '');
            const width = Math.max(6, (ws.getColumn(cell.col).width || 12) - 2);
            lines = Math.max(lines, ...text.split('\n').map(part => Math.max(1, Math.ceil(part.length / width))));
        });
        current.height = Math.min(409, Math.max(23, lines * 15 + 9));
    }
    function row(ws, values, { fill = COLORS.white, header = false, total = false } = {}) {
        const result = ws.addRow(values);
        values.forEach((value, index) => {
            const cell = result.getCell(index + 1);
            cell.font = { name: 'Calibri', size: 11, bold: header || total, color: { argb: header ? COLORS.white : COLORS.ink } };
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: header ? COLORS.header : total ? COLORS.total : fill } };
            cell.alignment = { vertical: 'middle', horizontal: header ? 'center' : typeof value === 'number' || value?.formula || value === '—' ? 'right' : 'left', wrapText: true };
            cell.border = { bottom: { style: total ? 'double' : 'hair', color: { argb: total ? 'FF94A3B8' : COLORS.border } } };
            if (typeof value === 'number' || value?.formula) cell.numFmt = '#,##0';
            if (value instanceof Date) cell.numFmt = 'dd.mm.yyyy hh:mm';
        });
        fitHeight(ws, result); return result;
    }
    function band(ws, title, cols, color = COLORS.navy) {
        const current = ws.addRow([title]); ws.mergeCells(current.number, 1, current.number, cols);
        const cell = current.getCell(1);
        cell.font = { name: 'Calibri', size: 12, bold: true, color: { argb: COLORS.white } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: color } };
        cell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1, wrapText: true }; current.height = 30;
    }
    function note(ws, text, cols) {
        const current = ws.addRow([text]); ws.mergeCells(current.number, 1, current.number, cols);
        current.getCell(1).font = { name: 'Calibri', size: 10, italic: true, color: { argb: COLORS.muted } };
        current.getCell(1).alignment = { vertical: 'middle', wrapText: true };
        const width = sum(Array.from({ length: cols }, (_, i) => ws.getColumn(i + 1).width || 12)) - 8;
        current.height = Math.max(24, Math.ceil(text.length / width) * 14 + 10);
    }
    function percentTable(ws, heading, items, headers, totalLabel) {
        band(ws, heading, 3, COLORS.teal); row(ws, headers, { header: true });
        const records = items.length ? items : [['Немає даних', 0]], start = ws.rowCount + 1, end = start + records.length - 1, totalAt = end + 1;
        const total = sum(records.map(item => item[1]));
        records.forEach(([label, count], index) => {
            const current = row(ws, [label, count, formula(`IF($B$${totalAt}>0,B${start + index}/$B$${totalAt},0)`, total ? count / total : 0)]);
            current.getCell(3).numFmt = '0.0%';
        });
        const last = row(ws, [totalLabel, formula(`SUM(B${start}:B${end})`, total), formula(`IF(B${totalAt}>0,1,0)`, total ? 1 : 0)], { total: true });
        last.getCell(3).numFmt = '0.0%'; ws.addRow([]);
    }
    function grouped(field) {
        const groups = new Map();
        for (const ep of episodes) { const key = field(ep) || 'Не вказано'; if (!groups.has(key)) groups.set(key, []); groups.get(key).push(ep); }
        return [...groups].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0], 'uk')).map(([key, records]) => [key, totals(records)]);
    }
    function breakdown(ws, heading, name, groups, totalLabel, shares = true) {
        const totalCol = categories.length + 2, lastCol = totalCol + (shares ? 1 : 0);
        band(ws, heading, lastCol);
        const header = row(ws, [name, ...categories.map(([, label]) => label), 'Всього', ...(shares ? ['% від загалу'] : [])], { header: true });
        const records = groups.length ? groups : [['Немає даних', categories.map(() => 0)]], start = ws.rowCount + 1, end = start + records.length - 1, totalAt = end + 1;
        const grandTotal = sum(records.map(([, counts]) => sum(counts))), lastTypeLetter = ws.getColumn(totalCol - 1).letter, totalLetter = ws.getColumn(totalCol).letter;
        records.forEach(([label, counts], index) => {
            const at = start + index, count = sum(counts);
            const current = row(ws, [label, ...counts, formula(`SUM(B${at}:${lastTypeLetter}${at})`, count),
                ...(shares ? [formula(`IF($${totalLetter}$${totalAt}>0,${totalLetter}${at}/$${totalLetter}$${totalAt},0)`, grandTotal ? count / grandTotal : 0)] : [])]);
            if (label instanceof Date) current.getCell(1).numFmt = 'dd.mm.yyyy';
            if (shares) current.getCell(lastCol).numFmt = '0.0%';
        });
        const totalValues = [totalLabel, ...categories.map((_, index) => formula(`SUM(${ws.getColumn(index + 2).letter}${start}:${ws.getColumn(index + 2).letter}${end})`, sum(records.map(([, counts]) => counts[index])))), formula(`SUM(${totalLetter}${start}:${totalLetter}${end})`, grandTotal),
            ...(shares ? [formula(`IF(${totalLetter}${totalAt}>0,1,0)`, grandTotal ? 1 : 0)] : [])];
        const last = row(ws, totalValues, { total: true }); if (shares) last.getCell(lastCol).numFmt = '0.0%';
        ws.addRow([]); return { header: header.number, end, lastCol };
    }

    // 1. Original four-section summary, with PVR and accurate reporting periods.
    const summary = sheet('Зведена довідка', [57, 21, 22, 26]);
    summary.pageSetup.orientation = 'portrait';
    band(summary, 'АНАЛІТИЧНИЙ ЗВІТ З ОБЛІКУ ВТРАТ ТА ЕВАКУАЦІЇ', 4);
    const metadata = [
        ['Період звіту', `${selection.dateFrom || 'Вся історія'} — ${selection.dateTo || 'На момент формування'}`],
        ['Сектор / Локація', !selection.sector || selection.sector === 'all' ? 'Всі сектори' : selection.sector],
        ['Умови виконання (УПД)', selection.udp === 'yes' ? 'На УПД' : selection.udp === 'no' ? 'Без УПД' : 'Всі епізоди'],
        ['Вибірка втрат', selection.showLatest ? 'Лише останній стан у вибраному періоді' : 'Всі епізоди у вибраному періоді'],
        ['Дата формування', excelDate(now)], ['Епізодів у вибірці', episodes.length],
        ['Військовослужбовців (унікальні ID)', new Set(episodes.map(ep => ep.soldierId ?? ep.id)).size]
    ];
    if (filters && !Object.keys(selection).length) metadata.splice(1, 0, ['Фільтри', filters]);
    metadata.forEach(values => {
        const current = row(summary, values); summary.mergeCells(current.number, 2, current.number, 4); current.getCell(1).font.bold = true;
        current.height = values[1] instanceof Date ? 24 : Math.max(24, Math.ceil(String(values[1]).length / 65) * 15 + 9);
    });
    note(summary, '200 (ПВР) — померлі від ран (у базі: «200 (від ран)»). У розподілах це окрема категорія; у загальних показниках евакуації тіл входить до 200.', 4);
    summary.addRow([]);
    percentTable(summary, '1. РОЗПОДІЛ ВТРАТ ЗА КАТЕГОРІЯМИ', categories.map(([key, label]) => [label, episodes.filter(ep => category(ep) === key).length]), ['Категорія втрат', 'Кількість епізодів', '% від загалу'], 'РАЗОМ ВТРАТ');
    const severityCounts = SEVERITIES.map(severity => [severity, episodes.filter(ep => is300(ep) && ep.severity === severity).length]);
    const unknownSeverity = episodes.filter(ep => is300(ep) && !SEVERITIES.includes(ep.severity)).length;
    if (unknownSeverity) severityCounts.push(['Важкість не вказана / інша', unknownSeverity]);
    percentTable(summary, '2. СТУПІНЬ ВАЖКОСТІ ПОРАНЕНИХ ТА ТРАВМОВАНИХ (300)', severityCounts, ['Ступінь важкості', 'Кількість епізодів', '% серед 300'], 'ВСЬОГО 300');
    summary.getRow(summary.rowCount).addPageBreak();
    band(summary, '3. СТАТИСТИКА ЕВАКУАЦІЇ ТА ЗАЛИШОК НА ДАТУ', 4, COLORS.teal);
    row(summary, ['Показник', 'Поранені / травмовані (300)', 'Загиблі (всі 200)', 'Зниклі безвісти (ЗБВ)'], { header: true });
    const countKinds = records => [records.filter(is300).length, records.filter(is200).length, records.filter(isMia).length];
    row(summary, ['Евакуйовано за звітний період (епізодів)', ...countKinds(data.evacuated).slice(0, 2), '—']);
    row(summary, ['З них події сталися до початку періоду', ...countKinds(data.evacuated.filter(ep => data.from && parseMedicalDate(ep.date) < data.from)).slice(0, 2), '—']);
    row(summary, ['З них події сталися у звітному періоді', ...countKinds(data.evacuated.filter(ep => !data.from || parseMedicalDate(ep.date) >= data.from)).slice(0, 2), '—']);
    row(summary, ['Залишаються неевакуйованими на дату (осіб)', ...countKinds(data.pending)], { total: true });
    row(summary, ['З них важкі / критичні за записаною важкістю', data.pending.filter(ep => is300(ep) && ['Критичний', 'Важкий'].includes(ep.severity)).length, '—', '—']);
    row(summary, ['З них 200 (ПВР)', '—', data.pending.filter(ep => PVR.has(ep.lossType)).length, '—']);
    note(summary, 'Евакуації рахуються за датою евакуації по всіх епізодах. Черга — один останній статус на особу станом на ' + new Date(data.asOf).toLocaleString('uk-UA') + ', включно з давнішими подіями. Перемикач «останній стан» визначає вибірку втрат, не приховує історичні евакуації.', 4);
    summary.addRow([]);
    band(summary, '4. СЕРЕДНІЙ ЧАС ДО ЕВАКУАЦІЇ ЗА ЗВІТНИЙ ПЕРІОД', 4, COLORS.teal);
    row(summary, ['Категорія / Ступінь важкості', 'Евакуацій із датами', 'Сумарний час (днів)', 'Середній час (днів)'], { header: true });
    const durationGroups = [...SEVERITIES.map(severity => [severity, data.evacuated.filter(ep => is300(ep) && ep.severity === severity)]),
        ['Важкість не вказана / інша (300)', data.evacuated.filter(ep => is300(ep) && !SEVERITIES.includes(ep.severity))], ['200 (Тіла, включно з ПВР)', data.evacuated.filter(is200)]];
    const timeStart = summary.rowCount + 1;
    durationGroups.forEach(([label, records]) => {
        const days = sum(records.map(ep => (parseMedicalDate(ep.evacTime || ep.evacDate) - parseMedicalDate(ep.date)) / DAY)), at = summary.rowCount + 1;
        const current = row(summary, [label, records.length, days, formula(`IF(B${at}>0,C${at}/B${at},"—")`, records.length ? days / records.length : '—')]);
        current.getCell(3).numFmt = '0.0'; current.getCell(4).numFmt = '0.0';
    });
    const timeEnd = summary.rowCount, timeAt = timeEnd + 1, allDays = sum(data.evacuated.map(ep => (parseMedicalDate(ep.evacTime || ep.evacDate) - parseMedicalDate(ep.date)) / DAY));
    const timeTotal = row(summary, ['РАЗОМ / СЕРЕДНЄ', formula(`SUM(B${timeStart}:B${timeEnd})`, data.evacuated.length), formula(`SUM(C${timeStart}:C${timeEnd})`, allDays), formula(`IF(B${timeAt}>0,C${timeAt}/B${timeAt},"—")`, data.evacuated.length ? allDays / data.evacuated.length : '—')], { total: true });
    timeTotal.getCell(3).numFmt = '0.0'; timeTotal.getCell(4).numFmt = '0.0';
    if (data.missingEvacDates || data.wrongIntervals || episodes.some(ep => !parseMedicalDate(ep.date))) note(summary, `Перевірте дати: евакуйовано без дати евакуації — ${data.missingEvacDates}; евакуація раніше події — ${data.wrongIntervals}; некоректні дати подій у вибірці — ${episodes.filter(ep => !parseMedicalDate(ep.date)).length}. Некоректні інтервали не включено до статистики евакуації та середнього часу.`, 4);

    // 2. Original queue fields, recorded-severity order and colour coding.
    const queue = sheet('Черга на евакуацію', [7, 27, 18, 21, 17, 32, 18, 23, 27, 27, 42, 45, 23], 2);
    band(queue, 'ЧЕРГА НА ЕВАКУАЦІЮ ТА ПОШУК — СТАНОМ НА ' + new Date(data.asOf).toLocaleString('uk-UA'), 13, 'FF991B1B');
    row(queue, ['№ з/п', 'Терміновість / Пріоритет', 'Час очікування', 'Дата події', 'Звання', 'ПІБ', 'Позивний', 'Підрозділ', 'Фактичне місце', 'Місце за док.', 'Діагноз / Поранення', "Примітки / Координати / Зв’язок", 'ID епізоду'], { header: true });
    [...data.pending].sort((a, b) => priority(a) - priority(b) || parseMedicalDate(a.date) - parseMedicalDate(b.date)).forEach((ep, index) => {
        const s = person(ep), hours = Math.max(0, Math.floor((data.asOf - parseMedicalDate(ep.date)) / 3600000));
        const label = is300(ep) ? `${priority(ep)} — ${ep.severity || '300, важкість не вказана'}` : is200(ep) ? '6 — Тіла (' + (PVR.has(ep.lossType) ? '200 ПВР' : '200') + ')' : '7 — ЗБВ';
        const current = row(queue, [index + 1, label, `${Math.floor(hours / 24)} дн. ${hours % 24} год.`, excelDate(ep.date), ep.rank || s.rank || '', s.name || ep.soldierName || '', s.callsign || '', ep.unit || s.unit || '', ep.actualLoc || '', ep.docLoc || '', describeInjuries(ep.injuries, regions), ep.notes || ep.description || '', ep.id], { fill: rowColor(ep) });
        current.getCell(2).font.bold = true;
    });
    if (!data.pending.length) note(queue, 'Немає записів зі статусом «Не евакуйований» на вибрану дату за цими фільтрами.', 13);
    queue.autoFilter = { from: 'A2', to: `M${Math.max(2, data.pending.length + 2)}` }; queue.pageSetup.printTitlesRow = '1:2';
    note(queue, 'Порядок відтворює зафіксовані в базі категорію та важкість. У черзі кожна особа врахована один раз.', 13);

    // 3. Separate unit, factual-location and documentary-location sections.
    const widths = [35, ...categories.map(() => 16), 14, 15];
    const units = sheet('Підрозділи та Сектори', widths);
    breakdown(units, 'РОЗПОДІЛ ВТРАТ ЗА ПІДРОЗДІЛАМИ', 'Підрозділ', grouped(ep => ep.unit || person(ep).unit), 'РАЗОМ ПО ПІДРОЗДІЛАХ');
    breakdown(units, 'РОЗПОДІЛ ЗА ФАКТИЧНИМИ ЛОКАЦІЯМИ / СЕКТОРАМИ', 'Локація / Сектор', grouped(ep => ep.actualLoc), 'РАЗОМ ПО СЕКТОРАХ');
    breakdown(units, 'РОЗПОДІЛ ЗА ДОКУМЕНТАЛЬНИМИ МІСЦЯМИ', 'Місце за документами', grouped(ep => ep.docLoc), 'РАЗОМ ПО ДОКУМЕНТАХ');

    // 4. All original sections: causes, injury shares and all 24 hours.
    const causes = sheet('Причини та Травми', widths);
    breakdown(causes, '1. ПРИЧИНИ УРАЖЕНЬ ТА ОБСТАВИНИ', 'Причина / Тип зброї', grouped(ep => ep.cause), 'РАЗОМ ЗА ПРИЧИНАМИ');
    const injuryCounts = new Map(); episodes.forEach(ep => injuryGroups(ep.injuries).forEach(label => injuryCounts.set(label, (injuryCounts.get(label) || 0) + 1)));
    percentTable(causes, '2. ХАРАКТЕР УРАЖЕНЬ ТА ТРАВМ', [...injuryCounts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'uk')), ['Вид ураження / Травма', 'Кількість епізодів', '% серед відмічених типів'], 'РАЗОМ ВІДМІЧЕНИХ ТИПІВ');
    note(causes, 'Кожен тип травми враховано один раз на епізод незалежно від кількості локалізацій. Один епізод може містити кілька різних типів.', categories.length + 3);
    causes.addRow([]);
    causes.getRow(causes.rowCount).addPageBreak();
    const hours = Array.from({ length: 24 }, (_, hour) => { const label = String(hour).padStart(2, '0'); return [label + ':00', totals(episodes.filter(ep => localMedicalInput(ep.date).slice(11, 13) === label))]; });
    const invalidDates = episodes.filter(ep => !parseMedicalDate(ep.date));
    if (invalidDates.length) hours.push(['Некоректна дата / час', totals(invalidDates)]);
    breakdown(causes, '3. РОЗПОДІЛ ЗА ГОДИНАМИ ДОБИ', 'Година доби', hours, 'РАЗОМ ЗА ДОБУ', false);

    // 5. Continuous calendar dates and formula-driven period totals.
    const daily = sheet('Хронологія по днях', widths.slice(0, -1), 2), byDay = new Map();
    episodes.forEach(ep => { const key = localMedicalInput(ep.date).slice(0, 10); if (key) { if (!byDay.has(key)) byDay.set(key, []); byDay.get(key).push(ep); } });
    const dates = [...byDay.keys()].sort();
    const firstDay = selection.dateFrom ? localMedicalInput(selection.dateFrom).slice(0, 10) : dates[0];
    const lastDay = selection.dateTo ? localMedicalInput(selection.dateTo).slice(0, 10) : dates.at(-1);
    const dayGroups = [];
    if (firstDay && lastDay) for (let cursor = Date.parse(firstDay + 'T00:00:00Z'), end = Date.parse(lastDay + 'T00:00:00Z'); cursor <= end; cursor += DAY) {
        const key = new Date(cursor).toISOString().slice(0, 10); dayGroups.push([new Date(cursor), totals(byDay.get(key) || [])]);
    }
    if (invalidDates.length) dayGroups.push(['Некоректна дата', totals(invalidDates)]);
    const dailyTable = breakdown(daily, 'ХРОНОЛОГІЧНА ДИНАМІКА ВТРАТ ПО ДНЯХ', 'Дата', dayGroups, 'РАЗОМ ЗА ПЕРІОД', false);
    daily.autoFilter = { from: { row: dailyTable.header, column: 1 }, to: { row: dailyTable.end, column: dailyTable.lastCol } }; daily.pageSetup.printTitlesRow = '1:2';

    // 6. Restore original register fields; retain date in A and type in F.
    const register = sheet('Детальний реєстр', [15, 8, 10, 32, 18, 26, 17, 23, 16, 26, 27, 27, 9, 24, 21, 21, 23, 42, 45, 23, 23], 1);
    row(register, ['Дата події', '№ з/п', 'Час', 'ПІБ', 'Позивний', 'Тип втрати', 'Звання', 'Підрозділ', 'Важкість', 'Причина / Зброя', 'Фактичне місце', 'Місце за док.', 'УПД', 'Статус евакуації / СЗЧ', 'Дата евакуації', 'Зброя в наявності', 'Рапорт', 'Ураження (детально)', 'Примітки / Опис', 'ID епізоду', 'ID особи'], { header: true });
    episodes.forEach((ep, index) => {
        const s = person(ep), status = isAwol(ep) ? ep.awolStatus || '' : ep.evacStatus || '';
        const report = ep.hasReport ? 'Складено' + (ep.reportDate ? ' (' + (localMedicalInput(ep.reportDate).replace('T', ' ') || ep.reportDate) + ')' : ' (дату не вказано)') : 'Ні';
        const current = row(register, [excelDate(ep.date, true), index + 1, excelTime(ep.date), s.name || ep.soldierName || '', s.callsign || '', labelType(ep), ep.rank || s.rank || '', ep.unit || s.unit || '', ep.severity || '', ep.cause || '', ep.actualLoc || '', ep.docLoc || '', ep.inUdp ? 'Так' : 'Ні', status, excelDate(ep.evacTime || ep.evacDate), ep.weaponStatus || '—', report, describeInjuries(ep.injuries, regions), ep.notes || ep.description || '', ep.id, ep.soldierId], { fill: rowColor(ep) });
        current.getCell(1).numFmt = 'dd.mm.yyyy'; current.getCell(3).numFmt = 'hh:mm';
        if (status === 'Не евакуйований' || status.includes('Розшук')) current.getCell(14).font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FFDC2626' } };
        else if (status === 'Евакуйований' || status.includes('Повернувся')) current.getCell(14).font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FF15803D' } };
    });
    register.autoFilter = { from: 'A1', to: `U${Math.max(1, episodes.length + 1)}` }; register.pageSetup.printTitlesRow = '1:1';
    for (const ws of workbook.worksheets) ws.pageSetup.printArea = `A1:${ws.getColumn(ws.columnCount).letter}${ws.rowCount}`;
    return workbook;
}
