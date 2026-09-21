import React from 'react';
import { DocumentJournal as D } from '../../core/documents.js';
import { POSITION_CATEGORIES, POSITION_ACTIONS, eligiblePositions, preparationChoices, buildPositionRegister } from './position-register.js';
import { PositionPicker } from './PositionPicker.jsx';

export function PositionFields({ draft, setDraft, rows, busy }) {
    const creating = draft.status === 'виставлена';
    const preparing = draft.status === 'облаштовується';
    const choices = preparing ? preparationChoices(rows, draft) : eligiblePositions(rows, draft);
    const preparations = choices.filter(entry => !entry.established);
    const destinations = buildPositionRegister(rows.filter(row => row.id !== draft.id), draft.date).entries.filter(entry => entry.id !== draft.positionId);
    const newPreparation = preparing && (draft.opensRegister || !draft.positionId);
    const nameEditable = (creating && !preparations.some(entry => entry.id === draft.positionId)) || newPreparation;
    const change = (key, value) => setDraft({ ...draft, [key]: value });
    const field = 'dj-input w-full';
    return <div className="space-y-4">
        <p className="text-xs text-slate-400">Фіксуйте вже здійснену дію за датою документа. Облаштування може відкривати історію раніше виставлення. Нова подія доповнює історію, а не переписує попередні назви й дати.</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <label className="text-sm space-y-1"><span>Дата зміни *</span><input aria-label="Дата зміни" type="date" max={!draft.id ? window.SuiteDates.localISO() : undefined} required disabled={busy} className={field} value={draft.date} onChange={event => change('date', event.target.value)} /></label>
            <label className="text-sm space-y-1"><span>Документальна дія *</span><select aria-label="Документальна дія" disabled={busy || !!draft.renameBatchId} className={field} value={draft.status} onChange={event => setDraft({ ...draft, status: event.target.value, positionId: '', name: '', newName: '', opensRegister: event.target.value === 'облаштовується', destinationPositionId: '', destinationName: '' })}>{POSITION_ACTIONS.map(action => <option key={action}>{action}</option>)}</select></label>
            {creating && !!preparations.length && <label className="text-sm space-y-1 sm:col-span-2"><span>Продовжити історію облаштування</span><select aria-label="Продовжити історію облаштування" disabled={busy} className={field} value={preparations.some(entry => entry.id === draft.positionId) ? draft.positionId : ''} onChange={event => {
                const entry = preparations.find(item => item.id === event.target.value);
                setDraft({ ...draft, positionId: entry?.id || '', name: entry?.name || '', category: entry?.category || draft.category, opensRegister: false });
            }}><option value="">Окрема нова історія — без попереднього облаштування</option>{preparations.map(entry => <option key={entry.id} value={entry.id}>{entry.name} · облаштування від {D.dateLabel(entry.records[0].date)}</option>)}</select></label>}
            {!creating && <div className="text-sm space-y-1 sm:col-span-2"><PositionPicker key={draft.status} label="Позиція з реєстру" required={!draft.id && !preparing} disabled={busy || !!draft.renameBatchId} entries={choices} value={newPreparation ? '' : draft.positionId || ''} fallbackName={draft.name} allowUnavailable={!!draft.id} placeholder={preparing ? 'Пошук історії або залиште порожнім для нового облаштування' : 'Почніть вводити назву позиції…'} onSelect={entry => {
                setDraft({ ...draft, positionId: entry?.id || '', name: entry?.name || '', category: entry?.category || draft.category, opensRegister: preparing && !entry, destinationPositionId: '', destinationName: '' });
            }} />
                {preparing && <p className="text-xs text-teal-300">Можна почати окрему історію або пов’язати документ із виставленням, яке відбулося пізніше. Дати документів збережуться.</p>}
                {!choices.length && !preparing && <p className="text-xs text-amber-300">На цю дату немає незакритих записів виставлення. Спершу додайте відсутній документ про виставлення або виправте дату.</p>}
            </div>}
            <label className="text-sm space-y-1"><span>{nameEditable ? 'Назва позиції *' : 'Назва у записі'}</span><input aria-label="Назва позиції" required disabled={busy} readOnly={!nameEditable} maxLength={1000} className={field} value={draft.name} onChange={event => change('name', event.target.value)} /></label>
            <label className="text-sm space-y-1"><span>Категорія позиції {!draft.id && '*'}</span><select aria-label="Категорія позиції" required={!draft.id} disabled={busy} className={field} value={draft.category || ''} onChange={event => change('category', event.target.value)}><option value="">Не визначено</option>{[...new Set([...POSITION_CATEGORIES, draft.category])].filter(Boolean).map(category => <option key={category}>{category}</option>)}</select></label>
            {draft.status === 'переміщена' && <div className="text-sm space-y-1 sm:col-span-2"><PositionPicker key={draft.positionId || 'no-source'} label="На місце іншої позиції" disabled={busy} entries={destinations} value={draft.destinationPositionId || ''} fallbackName={draft.destinationName} allowUnavailable={!!draft.id} placeholder="Пошук за назвою; можна залишити порожнім" onSelect={destination => setDraft({ ...draft, destinationPositionId: destination?.id || '', destinationName: destination?.name || '' })} /><p className="text-xs text-slate-400">Зберігається лише посилання у цьому документі. Інша позиція не знімається, не перейменовується й не закривається автоматично.</p></div>}
            <label className="text-sm space-y-1 sm:col-span-2"><span>Нова назва позиції {draft.status === 'перейменована' ? '*' : '(необов’язково)'}</span><input aria-label="Нова назва позиції" required={draft.status === 'перейменована' && !draft.id} disabled={busy} maxLength={1000} className={field} value={draft.newName || ''} onChange={event => change('newName', event.target.value)} /><p className="text-xs text-slate-400">Можна змінити назву разом із будь-якою документальною дією. Залиште порожнім, щоб не перейменовувати. Попередня назва та зв’язок між записами залишаться в історії.</p></label>
        </div>
        {preparing && draft.id && !draft.positionId && <label className="flex gap-2 items-center text-sm text-amber-200"><input type="checkbox" disabled={busy} checked={!!draft.opensRegister} onChange={event => change('opensRegister', event.target.checked)} />Підтверджую: цей старий запис відкриває окрему історію облаштування</label>}
        <div className={`rounded-xl border p-4 space-y-3 ${D.hasDoc(draft) ? 'border-emerald-800 bg-emerald-950/20' : 'border-rose-800 bg-rose-950/20'}`}>
            <label className="block text-sm space-y-1"><span>№ Позатермінового донесення {!draft.awaitingDoc && '*'}</span><input aria-label="№ Позатермінового донесення" required={!draft.awaitingDoc} disabled={busy} maxLength={1000} className={field} value={draft.docNumber} placeholder="Вкажіть номер отриманого донесення" onChange={event => change('docNumber', event.target.value)} /></label>
            {!D.hasDoc(draft) && <><label className="flex gap-2 items-center text-sm text-rose-200"><input type="checkbox" disabled={busy} checked={!!draft.awaitingDoc} onChange={event => change('awaitingDoc', event.target.checked)} />Очікую номер донесення — зберегти з нагадуванням</label><p className="text-xs text-rose-300">Запис пульсуватиме червоним, доки не буде внесено номер. Він потрапить до фільтра «Лише без номера донесення».</p></>}
        </div>
        <label className="block text-sm space-y-1"><span>Примітка до документа</span><textarea aria-label="Примітка до документа" disabled={busy} rows={3} maxLength={10000} className={field} value={draft.details} onChange={event => change('details', event.target.value)} /></label>
        <label className="flex items-center gap-2 text-sm"><input aria-label="Подано в ПБД" type="checkbox" disabled={busy} checked={draft.reportedInPbd} onChange={event => change('reportedInPbd', event.target.checked)} />Подано в ПБД</label>
    </div>;
}
