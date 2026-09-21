import { DocumentJournal as D } from '../../core/documents.js';
import { OVT_IDENTIFIERS, OVT_REGISTRATIONS, prepareOvtDraft } from './ovt-form.js';

const text = value => typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
const phrase = value => text(value).replace(/[.!?;,]+$/, '');

export function buildOvtReport(row) {
    const view = prepareOvtDraft(row);
    const [idField, idLabel] = OVT_IDENTIFIERS[view.identifierType], [regField, regLabel] = OVT_REGISTRATIONS[view.registrationType];
    if (row.category !== 'Транспорт') return `ПОЗАТЕРМІНОВЕ ДОНЕСЕННЯ\nщодо обліку ОВТ\n\nДата: ${D.dateLabel(row.date)}${row.time ? ' о ' + row.time : ''}\nДонесення №: ${row.urgentDocNo || 'не вказано'}\n\nЗгідно з обліковим записом:\n• Категорія: ${row.category}\n• Номенклатура / модель: ${row.nomenclature}\n• Статус: ${row.status}\n• ${idLabel}: ${row[idField] || 'не вказано'}\n• ${regLabel}: ${row[regField] || 'не вказано'}\n• ${view.locationMode === 'route' ? 'Маршрут' : 'Позиція, зазначена у документі'}: ${(view.locationMode === 'route' ? row.routeText : row.position) || 'не вказано'}\n• Помітка (*): ${row.isEvent ? 'так' : 'ні'}\n\nОбставини / примітка: ${row.comment || 'не зазначено'}`;
    const primary = OVT_IDENTIFIERS[row.identifierType];
    const registration = OVT_REGISTRATIONS[row.registrationType];
    const identifiers = primary ? [[primary[0], { serial: 'серійний №', vin: 'VIN', factory: 'заводський №' }[row.identifierType]]]
        : [['serialNumber', 'VIN'], ['factoryNumber', 'заводський №']];
    const registrations = registration ? [[registration[0], row.registrationType === 'board' ? 'бортовий №' : 'в/н']]
        : [['plateNumber', 'в/н'], ['boardNumber', 'бортовий №']];
    const ids = [...identifiers, ...registrations]
        .filter(([key]) => text(row[key])).map(([key, label]) => `${label}${label.endsWith('№') ? ' ' : ': '}${text(row[key])}`).join(', ');
    const subject = text(row.equipmentType) || '[ТИП ТРАНСПОРТУ]';
    const mode = row.locationMode || (text(row.routeText) ? 'route' : 'position');
    const location = mode === 'route' ? 'за маршрутом ' + (phrase(row.routeText) || '[МАРШРУТ]') : 'на позиції ' + (phrase(row.position) || '[ПОЗИЦІЯ]');
    return `Доповідаю, що ${D.dateKey(row.date) ? D.dateLabel(row.date) : '[ДАТА]'} близько ${D.timeValue(row.time) || '[ЧАС]'}, під час виконання завдання з ${phrase(row.taskText) || '[ЗАВДАННЯ]'}, ${location}, ${subject} ${text(row.nomenclature) || '[МАРКА/МОДЕЛЬ]'} (${ids || '[ІДЕНТИФІКАЦІЙНІ ДАНІ]'}) ${phrase(row.eventDescription || row.comment) || '[ОПИС ПОДІЇ]'} в районі координат: ${phrase(row.coordinates) || '[КООРДИНАТИ]'}. Унаслідок події ${phrase(row.consequence) || '[НАСЛІДОК]'}.`;
}
