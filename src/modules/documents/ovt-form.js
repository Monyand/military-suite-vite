// UI discriminators are additive: inactive legacy identifier values are never erased.
export const OVT_IDENTIFIERS = { serial: ['serialNumber', 'Серійний номер'], vin: ['serialNumber', 'VIN'], factory: ['factoryNumber', 'Заводський номер'] };
export const OVT_REGISTRATIONS = { plate: ['plateNumber', 'Номер авто'], board: ['boardNumber', 'Бортовий номер'] };
export function prepareOvtDraft(row) {
    return {
        ...row,
        eventDescription: row.eventDescription || ((row.category === 'Транспорт' || row.category === 'БпЛА') ? row.comment || '' : ''),
        locationMode: ['position', 'route'].includes(row.locationMode) ? row.locationMode : row.routeText ? 'route' : 'position',
        identifierType: OVT_IDENTIFIERS[row.identifierType] ? row.identifierType : row.factoryNumber && !row.serialNumber ? 'factory' : row.category === 'Транспорт' ? 'vin' : 'serial',
        registrationType: OVT_REGISTRATIONS[row.registrationType] ? row.registrationType : row.boardNumber && !row.plateNumber ? 'board' : 'plate',
    };
}
export function ovtCellText(row, key) {
    const draft = prepareOvtDraft(row);
    if (key === 'position') return row.category === 'БпЛА' ? (row.crewName || row.position) : draft.locationMode === 'route' ? row.routeText : (row.position || row.crewName);
    if (key === 'serialNumber' && row.identifierType) { const [field, label] = OVT_IDENTIFIERS[draft.identifierType]; return row[field] ? (draft.identifierType === 'factory' ? label + ': ' + row[field] : row[field]) : ''; }
    if (key === 'plateNumber' && row.registrationType) { const [field, label] = OVT_REGISTRATIONS[draft.registrationType]; return row[field] ? (draft.registrationType === 'board' ? label + ': ' + row[field] : row[field]) : ''; }
    if (key === 'comment') return row.eventDescription || row.comment;
    return row[key];
}
