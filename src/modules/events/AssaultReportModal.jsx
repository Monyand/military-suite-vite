import React, { useEffect, useRef, useState } from 'react';
import { buildAssaultReport } from './assault-report.js';

export function AssaultReportModal({ event, onClose }) {
    const [report] = useState(() => buildAssaultReport(event));
    const [text, setText] = useState(report.text);
    const [notice, setNotice] = useState('');
    const [copying, setCopying] = useState(false);
    const dialog = useRef(null), editor = useRef(null);
    useEffect(() => {
        const previous = document.activeElement;
        editor.current?.focus();
        return () => { if (previous?.isConnected) previous.focus(); };
    }, []);
    const copy = async () => {
        setCopying(true); setNotice('');
        try { await navigator.clipboard.writeText(text); setNotice('Текст скопійовано. Подія та фільтри не змінені.'); }
        catch { editor.current?.focus(); editor.current?.select(); setNotice('Автоматичне копіювання недоступне. Текст виділено — натисніть Ctrl+C.'); }
        finally { setCopying(false); }
    };
    const handleKey = e => {
        // Do not trigger the app's N / 1–4 shortcuts while editing a report.
        e.stopPropagation();
        if (e.key === 'Escape') { e.preventDefault(); onClose(); }
        if (e.key === 'Tab') {
            const controls = [...dialog.current.querySelectorAll('button:not(:disabled), textarea:not(:disabled)')];
            const first = controls[0], last = controls.at(-1);
            if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
            else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
        }
    };
    return <div className="fixed inset-0 z-[100] bg-black/75 backdrop-blur-sm p-3 sm:p-6 flex items-center justify-center" onKeyDown={handleKey}>
        <section ref={dialog} role="dialog" aria-modal="true" aria-labelledby="assault-report-title" className="w-full max-w-4xl max-h-[90vh] overflow-y-auto rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl text-slate-100 p-4 sm:p-6 space-y-4">
            <div className="flex items-start justify-between gap-3 border-b border-slate-700 pb-3">
                <div><h2 id="assault-report-title" className="text-lg font-bold text-amber-300">Позатермінове донесення · ШД</h2><p className="text-xs text-slate-400 mt-1">Чернетка зі збереженого запису завершеної події</p></div>
                <button type="button" aria-label="Закрити доповідь ШД" className="rounded-lg px-3 py-1.5 text-slate-300 hover:bg-slate-800" onClick={onClose}>✕</button>
            </div>
            <p className="text-sm text-slate-300">Перевірте дані та відредагуйте текст перед поданням. Редагування цієї чернетки й копіювання не змінюють запис події або відмітки ПБД. Після закриття правки чернетки не зберігаються.</p>
            {!!report.warnings.length && <div className="rounded-xl border border-amber-700/60 bg-amber-950/30 p-3 text-xs text-amber-100 space-y-2"><p className="font-bold">Зверніть увагу</p><ul className="list-disc pl-4 space-y-1">{report.warnings.map(warning => <li key={warning}>{warning}</li>)}</ul></div>}
            <label className="block text-sm space-y-2"><span className="font-semibold">Текст доповіді</span><textarea ref={editor} aria-label="Текст доповіді ШД" rows={10} value={text} onChange={e => { setText(e.target.value); setNotice(''); }} className="w-full rounded-xl border border-slate-600 bg-slate-950 p-4 text-sm leading-7 text-slate-100 focus:outline-none focus:ring-2 focus:ring-amber-500 resize-y" /></label>
            <div role="status" aria-live="polite" className="text-sm text-amber-200 min-h-5">{notice}</div>
            <div className="flex flex-wrap justify-end gap-3">
                <button type="button" className="rounded-xl px-4 py-2 border border-slate-600 hover:bg-slate-800 text-sm font-semibold" onClick={onClose}>Закрити</button>
                <button type="button" disabled={copying || !text.trim() || !report.available} onClick={copy} className="rounded-xl px-4 py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 text-sm font-bold disabled:opacity-40 disabled:cursor-not-allowed">{copying ? 'Копіювання…' : 'Копіювати текст'}</button>
            </div>
        </section>
    </div>;
}
