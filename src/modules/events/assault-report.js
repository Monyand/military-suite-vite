// Retrospective document formatting only. Reads one saved event; never changes it.
const cleanText = value => typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
const clockTime = value => /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(cleanText(value));
const countValue = value => {
    if (typeof value !== 'number' && !(typeof value === 'string' && /^\d+$/.test(value.trim()))) return null;
    const number = Number(value);
    return Number.isSafeInteger(number) && number >= 0 && number <= 999999 ? number : null;
};
const calendarDate = value => {
    const text = cleanText(value);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return '';
    const date = new Date(text + 'T12:00:00Z');
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === text ? text : '';
};
const dateLabel = iso => iso.split('-').reverse().join('.');

export function numberToUkrainianWords(value) {
    const number = countValue(value);
    if (number === null) return '';
    if (number === 0) return 'НУЛЬ';
    const ones = ['', 'один', 'два', 'три', 'чотири', "п'ять", 'шість', 'сім', 'вісім', "дев'ять"];
    const teens = ['десять', 'одинадцять', 'дванадцять', 'тринадцять', 'чотирнадцять', "п'ятнадцять", 'шістнадцять', 'сімнадцять', 'вісімнадцять', "дев'ятнадцять"];
    const tens = ['', '', 'двадцять', 'тридцять', 'сорок', "п'ятдесят", 'шістдесят', 'сімдесят', 'вісімдесят', "дев'яносто"];
    const hundreds = ['', 'сто', 'двісті', 'триста', 'чотириста', "п'ятсот", 'шістсот', 'сімсот', 'вісімсот', "дев'ятсот"];
    const small = (n, feminine = false) => {
        const result = [];
        if (n >= 100) result.push(hundreds[Math.floor(n / 100)]);
        const remainder = n % 100;
        if (remainder >= 10 && remainder < 20) result.push(teens[remainder - 10]);
        else {
            if (remainder >= 20) result.push(tens[Math.floor(remainder / 10)]);
            const unit = remainder % 10;
            if (unit) result.push(feminine && unit <= 2 ? ['', 'одна', 'дві'][unit] : ones[unit]);
        }
        return result.join(' ');
    };
    const thousands = Math.floor(number / 1000), parts = [];
    if (thousands) {
        const ending = thousands % 100 >= 11 && thousands % 100 <= 14 ? 'тисяч' : thousands % 10 === 1 ? 'тисяча' : [2, 3, 4].includes(thousands % 10) ? 'тисячі' : 'тисяч';
        parts.push(small(thousands, true), ending);
    }
    if (number % 1000) parts.push(small(number % 1000));
    return parts.join(' ').toLocaleUpperCase('uk-UA');
}

export function isCompletedAssault(event) {
    return Array.isArray(event?.types) && event.types.includes('ШД') && clockTime(event.actionDetails?.endTime);
}

export function buildAssaultReport(event) {
    if (!isCompletedAssault(event)) return { available: false, text: '', warnings: ['Доповідь доступна для ШД із зазначеним коректним часом завершення.'] };
    const details = event.actionDetails || {}, warnings = [];
    const requiredText = (value, label) => {
        const text = cleanText(value);
        if (!text) warnings.push('Не заповнено: ' + label + '.');
        return text || '[' + label + ' уточнюється]';
    };
    const startDate = calendarDate(details.startDate), endDate = calendarDate(details.endDate);
    const startTime = clockTime(details.startTime) ? cleanText(details.startTime) : '[час початку уточнюється]';
    const endTime = cleanText(details.endTime);
    if (!startDate) warnings.push('Дата події не заповнена або некоректна; дата створення запису замість неї не підставляється.');
    if (!clockTime(details.startTime)) warnings.push('Перевірте час початку події.');
    let period = `${startTime} - ${endTime} ${startDate ? dateLabel(startDate) : '[дата уточнюється]'}`;
    if (startDate && endDate && endDate > startDate) period = `${startTime} ${dateLabel(startDate)} - ${endTime} ${dateLabel(endDate)}`;
    else if (cleanText(details.endDate) && (!endDate || (startDate && endDate < startDate))) warnings.push('Дата завершення некоректна або передує початку. Перевірте дати в тексті.');
    else if (clockTime(details.startTime) && endTime < cleanText(details.startTime)) warnings.push('Час завершення раніше початку. Перевірте перехід через північ і за потреби допишіть дату завершення.');
    const strength = (value, label) => {
        const count = countValue(value);
        if (count === null || count === 0) { warnings.push('Уточніть: ' + label + '.'); return '[кількість уточнюється]'; }
        return String(count);
    };
    const direction = requiredText(details.direction, 'напрямок');
    // Use the historical documentary name, not an actual location or today's renamed position.
    const position = requiredText(details.docLoc, 'документальна позиція');
    const friendlySize = strength(details.friendlyCount, 'чисельність о/с у документі');
    const enemySize = strength(details.enemySize, 'чисельність групи противника у документі');
    let vehicles;
    if (details.hasVehicles === false) vehicles = 'без техніки';
    else if (details.hasVehicles === true) vehicles = cleanText(details.vehicleDetails) ? `з технікою (${cleanText(details.vehicleDetails)})` : 'з технікою (тип та кількість уточнюються)';
    else { vehicles = '[наявність техніки уточнюється]'; warnings.push('Наявність або відсутність техніки не зазначена.'); }

    const counted = value => value === null ? '[кількість уточнюється]' : `${value} (${numberToUkrainianWords(value)})`;
    const lossTypes = [['count200', 'безповоротні'], ['count300', 'санітарні'], ['countZBV', 'зниклі безвісти']];
    const friendly = lossTypes.map(([key, label]) => {
        const count = countValue(event.friendlyLosses?.[key]);
        if (count === null) warnings.push('Не заповнено або некоректно: наші втрати, ' + label + '.');
        return { label, count };
    });
    const losses = friendly.every(item => item.count === 0) ? 'Втрати о/с відсутні.' : 'Втрати: ' + friendly.filter(({ count }) => count !== 0).map(({ label, count }) => `${label} - ${counted(count)} в/сл`).join('; ') + '.';
    let result = 'уточнюється';
    if (Array.isArray(event.enemyLosses)) {
        const totals = { count200: 0, count200Unconfirmed: 0, count200Discovered: 0, count300: 0 };
        let valid = true;
        for (const loss of event.enemyLosses) {
            for (const key of Object.keys(totals)) {
                // Older records may omit these two optional categories entirely.
                const missingOptional = loss?.[key] === undefined && ['count200Unconfirmed', 'count200Discovered'].includes(key);
                const count = countValue(missingOptional ? 0 : loss?.[key]);
                if (count === null || totals[key] + count > 999999) valid = false;
                else totals[key] += count;
            }
        }
        const combined200 = totals.count200 + totals.count200Unconfirmed + totals.count200Discovered;
        if (combined200 > 999999) valid = false;
        if (valid) {
            const parts = [];
            if (combined200) parts.push(`ЗНИЩЕНО – ${counted(combined200)} В/СЛ ЗС рф`);
            if (totals.count300) parts.push(`ПОРАНЕНО – ${counted(totals.count300)} В/СЛ ЗС рф`);
            if (parts.length) result = parts.join(', ');
            if (totals.count200Unconfirmed || totals.count200Discovered) warnings.push(`Об’єднаний підсумок 200: звичайні — ${totals.count200}; непідтверджені — ${totals.count200Unconfirmed}; виявлені — ${totals.count200Discovered}. Категорії в записах не змінено.`);
        } else warnings.push('Підсумок втрат противника неповний або некоректний. Результат залишено «уточнюється».');
        if (event.enemyLosses.some(loss => ['countPOW', 'count200POW'].some(key => countValue(loss?.[key]) > 0))) {
            warnings.push('Дані щодо полонених не додано до «ЗНИЩЕНО / ПОРАНЕНО». За потреби опишіть їх окремо.');
        }
    } else warnings.push('Перелік втрат противника відсутній або некоректний. Результат залишено «уточнюється».');
    if (event.isRealEvent === false) warnings.unshift('ТЕСТОВА ПОДІЯ: цей текст не є доповіддю про підтверджену реальну подію.');
    warnings.push('«Позиція не втрачена. Противник успіху не мав» — формулювання з вашого шаблону, а не окремі поля запису. Перевірте та за потреби змініть їх.');
    return {
        available: true,
        text: `${period} бойове зіткнення з напрямку ${direction} на ${position} (${friendlySize} в/с), ШГр до ${enemySize} в/сл противника ${vehicles}. ${losses} Позиція не втрачена. Противник успіху не мав. результат: ${result}.`,
        warnings: [...new Set(warnings)]
    };
}
