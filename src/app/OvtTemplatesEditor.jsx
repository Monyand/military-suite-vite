import { useEffect, useState } from 'react';
import { OVT_TEMPLATE_LISTS, OVT_STATUSES, ovtTemplateName, addOvtTemplateLines, emptyOvtTemplates, validateOvtTemplates, normalizeOvtTemplates } from '../core/ovt-templates.js';

export function OvtTemplatesEditor({ value, onChange, onPendingChange }) {
    const templates = normalizeOvtTemplates(value ?? emptyOvtTemplates());
    const [buffers, setBuffers] = useState({});
    const [equipmentType, setEquipmentType] = useState('');
    const [message, setMessage] = useState('');
    const pending = Object.values(buffers).some(text => text.trim());
    useEffect(() => { onPendingChange(pending); }, [pending, onPendingChange]);
    const change = action => {
        try { onChange(validateOvtTemplates(action())); setMessage(''); return true; }
        catch (error) { setMessage(error.message); return false; }
    };
    const types = templates.equipmentTypes.map(ovtTemplateName);
    const sections = OVT_TEMPLATE_LISTS.flatMap(([key, title, example]) => key === 'consequences'
        ? [...OVT_STATUSES, ''].map(status => ({ key, title: status ? 'Наслідок · ' + status : 'Наслідок · Нерозподілені', example: status === 'ПОШКОДЖЕНО' ? 'транспортний засіб був пошкоджений' : example, status, id: key + status }))
        : [{ key, title, example, id: key }]);
    const updateEntry = (key, index, patch) => change(() => {
        const next = structuredClone(templates), entry = next[key][index];
        next[key][index] = { ...(typeof entry === 'string' ? { name: entry } : entry), ...patch };
        return next;
    });
    return <div data-testid="ovt-template-editor">
        <h3>Шаблони ОВТ</h3>
        <p className="sd-note">Моделі, завдання, маршрути й описи — спільні для обох статусів, з прив’язкою лише до типу транспорту. Тільки наслідки поділені на «ЗНИЩЕНО» та «ПОШКОДЖЕНО». Власні варіанти запам’ятовуються після збереження події. Старі події не змінюються.</p>
        <div className="sd-columns">
            <label>Тип транспорту для нових фраз<select aria-label="Прив’язка нових фраз до типу" value={equipmentType} onChange={event => setEquipmentType(event.target.value)}><option value="">Для всіх типів</option>{types.map(name => <option key={name}>{name}</option>)}</select></label>
        </div>
        <p className="sd-note">Наслідки розділені нижче. Нерозподілені старі тексти не пропонуються у формі, доки ви не оберете їм статус. Вводьте повну фразу після «Унаслідок події», наприклад «транспортний засіб був повністю знищений».</p>
        {message && <p role="alert" className="sd-notice">{message}</p>}
        <div className="sd-columns">{sections.map(({ key, title, example, status: sectionStatus, id }) => {
            const entries = templates[key].map((entry, index) => ({ entry, index })).filter(({ entry }) => key !== 'consequences' || (entry.status || '') === sectionStatus);
            return <section className="sd-card" key={id}>
                <h3>{title} <span className="sd-badge">{entries.length}</span></h3>
                {(key !== 'consequences' || sectionStatus) && <>
                    <label>Додати варіанти<textarea aria-label={'Шаблони: ' + title} rows={3} value={buffers[id] || ''} placeholder={example} maxLength={100000} onChange={event => setBuffers({ ...buffers, [id]: event.target.value })} /></label>
                    <button type="button" aria-label={'Додати: ' + title} onClick={() => {
                        if (change(() => addOvtTemplateLines(templates, key, buffers[id] || '', { equipmentType, status: sectionStatus || '' }))) setBuffers({ ...buffers, [id]: '' });
                    }}>Додати</button>
                </>}
                <div className="sd-list">{entries.map(({ entry, index }) => {
                    const name = ovtTemplateName(entry);
                    return <div key={index}><span>{name}</span><div className="sd-actions">
                        {key !== 'equipmentTypes' && <>
                            {key === 'consequences' && <select aria-label={'Статус шаблону ' + name} value={entry.status || ''} onChange={event => updateEntry(key, index, { status: event.target.value })}><option value="">Нерозподілений</option>{OVT_STATUSES.map(status => <option key={status}>{status}</option>)}</select>}
                            <select aria-label={'Тип для шаблону ' + name} value={entry.equipmentType || ''} onChange={event => updateEntry(key, index, { equipmentType: event.target.value })}><option value="">Усі типи транспорту</option>{[...new Set([...types, entry.equipmentType].filter(Boolean))].map(type => <option key={type}>{type}</option>)}</select>
                        </>}
                        <button type="button" aria-label={'Видалити шаблон ' + title + ': ' + name} onClick={() => change(() => ({ ...templates, [key]: templates[key].filter((_, i) => i !== index) }))}>×</button>
                    </div></div>;
                })}</div>
                {!entries.length && <p className="sd-note">Варіантів поки немає.</p>}
            </section>;
        })}</div>
    </div>;
}
