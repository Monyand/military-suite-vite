import { DocumentJournal as D } from '../../core/documents.js';
import { POSITION_CATEGORIES, buildPositionRegister, positionBatchError } from './position-register.js';

const today = () => {
    const date = new Date();
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};

export function preparePositionBatch(existing, options) {
    if (!['create', 'rename'].includes(options.mode)) throw new Error('Невідомий режим масового внесення.');
    if (!D.dateKey(options.date)) throw new Error('Вкажіть дату документальної події.');
    if (options.date > (options.today || today())) throw new Error('Цей журнал фіксує вже здійснені дії. Вкажіть сьогоднішню або минулу дату.');
    const lines = String(options.text || '').split(/\r?\n/).map((text, index) => ({ text, line: index + 1 })).filter(item => item.text.trim());
    if (!lines.length) throw new Error('Вставте список назв або пар для перейменування.');
    if (lines.length > 1000) throw new Error('За один раз можна внести до 1000 записів.');
    const current = buildPositionRegister(existing, options.date);
    const entries = current.entries.filter(entry => !['знята', 'знищена'].includes(entry.status));
    const batchId = 'rename_' + crypto.randomUUID(), now = new Date().toISOString();
    const records = [], errors = [], seen = new Set();
    for (const line of lines) {
        const cells = line.text.split(options.mode === 'rename' ? /\t|\s*(?:→|=>)\s*/ : /\t/).map(text => text.trim());
        const reportError = message => errors.push({ line: line.line, message });
        if ((options.mode === 'rename' && cells.length !== 2) || (options.mode === 'create' && cells.length > 3) || cells.some(value => value.length > 1000)) { reportError(options.mode === 'rename' ? 'Потрібна пара «попередня назва → нова назва» (або дві колонки через Tab).' : 'Допустимі колонки через Tab: назва, категорія, № донесення.'); continue; }
        const name = cells[0], newName = options.mode === 'rename' ? cells[1] : '';
        if (!name || (options.mode === 'rename' && !newName)) { reportError('Назви не можуть бути порожніми.'); continue; }
        if (seen.has(D.norm(name))) { reportError('Повторна вихідна назва в цьому списку: ' + name); continue; }
        seen.add(D.norm(name));
        const matches = entries.filter(entry => D.norm(entry.name) === D.norm(name));
        let source = null;
        if (options.mode === 'rename') {
            if (matches.length !== 1 || !matches[0].established || matches[0].records.some(record => current.issues.has(record.id))) { reportError('Немає однозначного незакритого виставлення на цю дату: ' + name); continue; }
            source = matches[0];
        } else if (matches.length === 1 && !matches[0].established) source = matches[0];
        const id = 'doc_' + crypto.randomUUID();
        const category = options.mode === 'rename' ? source.category || options.category : cells[1] || options.category;
        if (!POSITION_CATEGORIES.includes(category)) { reportError('Невідома або незаповнена категорія: ' + (category || '—')); continue; }
        const row = { ...D.cleanRow('positions', {
            name: source?.name || name, newName, date: options.date, category,
            status: options.mode === 'rename' ? 'перейменована' : 'виставлена',
            docNumber: options.mode === 'create' ? cells[2] || options.docNumber : options.docNumber,
            reportedInPbd: !!options.reportedInPbd, details: options.details || '',
            positionId: source?.id || id, renameBatchId: options.mode === 'rename' ? batchId : '',
        }), id, createdAt: now, updatedAt: now };
        if (!D.hasDoc(row) && !options.awaitingDoc) { reportError('Немає № Позатермінового донесення. Заповніть його або підтвердьте очікування номера.'); continue; }
        records.push(row);
    }
    if (!errors.length) {
        const error = positionBatchError(existing, [...existing, ...records], records.map(row => row.id));
        if (error) errors.push({ line: 'Пакет', message: error });
    }
    return { records, errors, beforeSignature: JSON.stringify(existing), totalLines: lines.length };
}

export function appendPositionBatch(current, plan) {
    if (!plan || plan.errors.length || !plan.records.length) throw new Error('Спочатку усуньте помилки попереднього перегляду.');
    if (JSON.stringify(current.positions) !== plan.beforeSignature) throw new Error('Після перегляду записи змінилися. Сформуйте новий перегляд.');
    const records = [...current.positions, ...plan.records];
    const error = positionBatchError(current.positions, records, plan.records.map(row => row.id));
    if (error) throw new Error(error);
    return D.validate({ ...current, positions: records });
}
