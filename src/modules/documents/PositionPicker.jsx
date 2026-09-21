import React, { useEffect, useId, useRef, useState } from 'react';
import { DocumentJournal as D } from '../../core/documents.js';

const normalize = value => String(value || '').normalize('NFKC').trim().toLocaleLowerCase('uk-UA').replace(/\s+/g, ' ');

// Text is only a search query. A document link always stores the selected stable ID.
export function PositionPicker({ label, entries, value, fallbackName = '', onSelect, disabled, required, placeholder, allowUnavailable = false }) {
    const listId = useId();
    const input = useRef(null), list = useRef(null);
    const [query, setQuery] = useState(null);
    const [expanded, setExpanded] = useState(false);
    const [active, setActive] = useState(0);
    const selected = entries.find(entry => entry.id === value);
    const needle = normalize(query);
    const matches = entries.filter(entry => !needle || normalize(entry.name).includes(needle))
        .sort((a, b) => a.name.localeCompare(b.name, 'uk') || a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
    const open = expanded && !disabled;
    const activeIndex = Math.min(active, Math.max(0, matches.length - 1));
    const unresolved = query !== null && !!query.trim();
    const unavailable = !!value && !selected;
    const error = unresolved ? 'Оберіть позицію зі списку підказок або очистіть поле.' : unavailable && !allowUnavailable ? 'Зв’язок недоступний на цю дату. Перевірте дату й виберіть позицію.' : '';
    useEffect(() => { input.current?.setCustomValidity(error); }, [error]);
    useEffect(() => {
        if (open) list.current?.querySelector(`[data-index="${activeIndex}"]`)?.scrollIntoView({ block: 'nearest' });
    }, [open, activeIndex, query]);
    const choose = entry => { onSelect(entry); setQuery(null); setActive(0); setExpanded(false); };
    return <div className="relative text-sm space-y-1" onBlur={event => {
        if (!event.currentTarget.contains(event.relatedTarget)) setExpanded(false);
    }}>
        <label htmlFor={listId + '-input'}>{label}{required ? ' *' : ' (необов’язково)'}</label>
        <div className="flex gap-2">
            <input id={listId + '-input'} ref={input} role="combobox" aria-label={label} aria-autocomplete="list" aria-expanded={open}
                aria-controls={listId} aria-activedescendant={open && matches.length ? listId + '-' + activeIndex : undefined}
                aria-describedby={listId + '-hint'} aria-invalid={!!error} autoComplete="off" maxLength={1000}
                required={required} disabled={disabled} className="dj-input w-full min-w-0" placeholder={placeholder || 'Почніть вводити назву…'}
                value={query === null ? (selected?.name || (value ? fallbackName : '') || '') : query}
                onFocus={() => { setExpanded(true); setActive(0); }}
                onChange={event => {
                    setQuery(event.target.value); setExpanded(true); setActive(0);
                    if (value) onSelect(null);
                }}
                onKeyDown={event => {
                    if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); setExpanded(false); }
                    else if (['ArrowDown', 'ArrowUp'].includes(event.key)) {
                        event.preventDefault(); setExpanded(true);
                        setActive(open ? Math.max(0, Math.min(matches.length - 1, activeIndex + (event.key === 'ArrowDown' ? 1 : -1))) : 0);
                    } else if (event.key === 'Enter' && open) {
                        event.preventDefault(); if (matches[activeIndex]) choose(matches[activeIndex]);
                    }
                }} />
            {(value || query) && <button type="button" className="dj-button shrink-0" disabled={disabled} aria-label={'Очистити: ' + label}
                onClick={() => { choose(null); input.current?.focus(); }}>×</button>}
        </div>
        {open && <div ref={list} id={listId} role="listbox" aria-label={'Варіанти: ' + label}
            className="absolute z-50 left-0 right-0 max-h-56 overflow-y-auto rounded-xl border border-slate-600 bg-slate-900 shadow-2xl p-1">
            {matches.map((entry, index) => <button type="button" role="option" tabIndex={-1} id={listId + '-' + index} key={entry.id}
                data-position-id={entry.id} data-index={index} aria-selected={entry.id === value}
                className={`block w-full text-left rounded-lg px-3 py-2 ${index === activeIndex ? 'bg-teal-900 text-teal-100' : 'text-slate-200 hover:bg-slate-800'}`}
                onMouseDown={event => event.preventDefault()} onClick={() => choose(entry)}>
                <span className="block font-semibold break-words">{entry.name}</span>
                <span className="block text-xs text-slate-400">{entry.category || 'Без категорії'} · {entry.futureDocument ? 'пізніший документ' : entry.status} · {D.dateLabel(entry.records[0]?.date || entry.date)}{entry.records[0]?.docNumber ? ' · № ' + entry.records[0].docNumber : ''}</span>
            </button>)}
            {!matches.length && <p className="px-3 py-3 text-slate-400">Збігів немає. Перевірте назву та дату документа.</p>}
        </div>}
        <p id={listId + '-hint'} className={`text-xs ${unresolved || unavailable ? 'text-amber-300' : 'text-slate-400'}`}>
            {unresolved ? 'Натисніть на потрібну підказку — введений текст ще не є вибраною позицією.' : unavailable ? 'Зв’язок недоступний на цю дату — перевірте історію.' : selected ? 'Вибрано запис реєстру. Можна почати вводити іншу назву.' : 'Пошук за частиною назви · ↑ ↓ та Enter або натискання на підказку.'}
        </p>
    </div>;
}
