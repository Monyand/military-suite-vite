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
    return <div className="fixed inset-0 z-[100] bg-black/80 p-3 sm:p-6 flex items-center justify-center overscroll-contain" onKeyDown={handleKey}>
        <section ref={dialog} role="dialog" aria-modal="true" aria-labelledby="assault-report-title" className="w-full max-w-4xl max-h-[90vh] overflow-y-auto rounded-sm border border-[#2e3138] bg-[#17181b] text-[#f3f4f6] p-4 sm:p-5 space-y-4 overscroll-contain">
            <div className="flex items-start justify-between gap-3 border-b border-[#2e3138] pb-3">
                <div><h2 id="assault-report-title" className="text-base font-bold text-[#f3f4f6]">Позатермінове донесення · ШД</h2><p className="text-xs text-[#b8bec8] mt-1">Чернетка зі збереженого запису завершеної події</p></div>
                <button type="button" aria-label="Закрити доповідь ШД" className="rounded-sm p-1.5 text-[#b8bec8] hover:text-[#f3f4f6] hover:bg-[#222429] border border-transparent hover:border-[#2e3138] transition-colors inline-flex items-center justify-center" onClick={onClose}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
            </div>
            <p className="text-sm text-[#cbd5e1]">Перевірте дані та відредагуйте текст перед поданням. Редагування цієї чернетки й копіювання не змінюють запис події або відмітки ПБД. Після закриття правки чернетки не зберігаються.</p>
            {!!report.warnings.length && <div className="rounded-sm border border-[#d99b26]/50 bg-[#d99b26]/10 p-3 text-xs text-[#f3f4f6] space-y-1.5"><p className="font-semibold text-[#d99b26]">Зверніть увагу</p><ul className="list-disc pl-4 space-y-1 text-[#cbd5e1]">{report.warnings.map(warning => <li key={warning}>{warning}</li>)}</ul></div>}
            <label className="block text-sm space-y-1.5"><span className="font-semibold text-[#f3f4f6]">Текст доповіді</span><textarea ref={editor} aria-label="Текст доповіді ШД" rows={10} value={text} onChange={e => { setText(e.target.value); setNotice(''); }} className="w-full rounded-sm border border-[#2e3138] bg-[#101113] p-3.5 text-sm leading-7 text-[#f3f4f6] font-mono focus:outline-none focus:border-[#4c8ed9] resize-y" /></label>
            <div role="status" aria-live="polite" className="text-sm text-[#d99b26] min-h-5">{notice}</div>
            <div className="flex flex-wrap justify-end gap-2">
                <button type="button" className="rounded-sm px-3.5 py-1.5 border border-[#2e3138] bg-[#222429] hover:bg-[#282b31] hover:border-[#3c404a] text-[#f3f4f6] text-xs font-semibold transition-colors" onClick={onClose}>Закрити</button>
                <button type="button" disabled={copying || !text.trim() || !report.available} onClick={copy} className="rounded-sm px-3.5 py-1.5 bg-[#2b67ab] hover:bg-[#3477c2] border border-[#4c8ed9] text-white text-xs font-semibold disabled:opacity-40 disabled:cursor-not-allowed transition-colors">{copying ? 'Копіювання…' : 'Копіювати текст'}</button>
            </div>
        </section>
    </div>;
}
