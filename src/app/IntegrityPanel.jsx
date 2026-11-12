import { useEffect, useRef, useState } from 'react';
import { SuiteBackup } from '../core/backup.js';
import { inspectIntegrity } from '../core/integrity.js';
import { bindDialogFocusTrap } from './dialog-focus.js';

const titles = { enemy: 'Події', med: 'Медична евакуація', tactical: 'Журнал о/с', tasks: 'Завдання', ovt: 'Втрати ОВТ', positions: 'Документальні позиції' };
export function IntegrityPanel({ onClose, onOpen }) {
    const [result, setResult] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
    const [module, setModule] = useState(''), [severity, setSeverity] = useState(''), [limit, setLimit] = useState(50);
    const panelRef = useRef(null), busyRef = useRef(false);
    busyRef.current = busy;
    const refresh = async () => {
        setBusy(true); setError('');
        try { await window.SuiteRuntime.drain(); setResult(inspectIntegrity(await SuiteBackup.collect({ localState: true, unchecked: true }))); }
        catch (failure) { setError(failure.message); }
        finally { setBusy(false); }
    };
    useEffect(() => { refresh(); }, []);
    useEffect(() => bindDialogFocusTrap(panelRef, () => { if (!busyRef.current) onClose(); }), []);
    const rows = (result?.issues || []).filter(issue => (!module || issue.module === module) && (!severity || issue.severity === severity));
    return <div className="fixed inset-0 z-[21000] bg-black/80 flex items-center justify-center p-4">
        <section ref={panelRef} role="dialog" aria-modal="true" aria-label="Перевірка цілісності даних" className="bg-[#17181b] border border-[#2e3138] rounded-sm p-5 w-full max-w-4xl max-h-[90vh] overflow-y-auto space-y-4 text-[#f3f4f6]">
            <div className="flex items-center justify-between gap-3 border-b border-[#2e3138] pb-3"><h2 className="text-lg font-semibold">Перевірка цілісності даних</h2><button type="button" className="px-3 py-1.5 rounded-sm bg-[#222429] hover:bg-[#282b31] border border-[#2e3138] text-xs font-semibold text-[#f3f4f6]" onClick={onClose}>Закрити</button></div>
            <p className="text-sm text-[#b8bec8]">Лише перевірка: записи не змінюються. Невідомі значення й пошкоджені зв’язки потребують ручної звірки.</p>
            <div className="flex gap-2 flex-wrap">
                <select aria-label="Модуль перевірки" className="bg-[#222429] border border-[#2e3138] rounded-sm px-2.5 py-1.5 text-xs text-[#f3f4f6]" value={module} onChange={e => { setModule(e.target.value); setLimit(50); }}><option value="">Усі модулі</option>{Object.entries(titles).map(([key, title]) => <option key={key} value={key}>{title}</option>)}</select>
                <select aria-label="Рівень проблеми" className="bg-[#222429] border border-[#2e3138] rounded-sm px-2.5 py-1.5 text-xs text-[#f3f4f6]" value={severity} onChange={e => { setSeverity(e.target.value); setLimit(50); }}><option value="">Усі проблеми</option><option value="error">Помилки</option><option value="warning">Попередження</option></select>
                <button type="button" className="px-3 py-1.5 rounded-sm bg-[#2b67ab] hover:bg-[#4c8ed9] border border-[#4c8ed9] text-xs font-semibold text-white disabled:opacity-50" disabled={busy} onClick={refresh}>{busy ? 'Перевірка…' : 'Перевірити повторно'}</button>
            </div>
            {error && <p role="alert" className="text-sm text-[#fca5a5]">{error}</p>}
            {result && <><p className="text-sm tabular-nums">Перевірено: <span className="font-mono">{result.checkedAt}</span>. Знайдено: <span className="font-mono font-semibold">{result.issues.length}</span>; за фільтром: <span className="font-mono font-semibold">{rows.length}</span>.</p>
                <p className="text-sm text-[#b8bec8] tabular-nums">Медичні підсумки: враховано <span className="font-mono text-[#f3f4f6]">{result.medical.included}</span>, виключено за типом <span className="font-mono text-[#f3f4f6]">{result.medical.excluded}</span>, некоректних <span className="font-mono text-[#f3f4f6]">{result.medical.invalid}</span>, повторних ID <span className="font-mono text-[#f3f4f6]">{result.medical.duplicates}</span>. Небойові втрати та СЗЧ виключаються за правилами обліку.</p>
                {!rows.length && <p className="text-sm text-[#6ee7b7]">За вибраними перевірками проблем не знайдено.</p>}
                {!!rows.length && <div className="border border-[#2e3138] bg-[#101113] divide-y divide-[#2e3138]">
                    {rows.slice(0, limit).map((issue, index) => <div key={index} className="p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                        <div className="min-w-0 space-y-1">
                            <p className={`text-sm ${issue.severity === 'error' ? 'text-[#fca5a5]' : 'text-[#fcd34d]'}`}>{titles[issue.module]} · {issue.label || issue.recordId || 'Розділ'}: {issue.message}</p>
                            {issue.recordId && <p className="text-xs text-[#989fa9] font-mono tabular-nums break-all">ID: {issue.recordId}</p>}
                        </div>
                        <button type="button" className="shrink-0 self-start sm:self-center px-2.5 py-1 rounded-sm bg-[#222429] hover:bg-[#282b31] border border-[#2e3138] hover:border-[#4c8ed9] text-xs font-semibold text-[#f3f4f6]" onClick={() => onOpen(issue)}>{issue.recordId && !issue.kind && issue.module !== 'tactical' ? 'Відкрити запис' : 'Перейти до розділу'}</button>
                    </div>)}
                </div>}
                {rows.length > limit && <button type="button" className="px-3 py-1.5 rounded-sm bg-[#222429] hover:bg-[#282b31] border border-[#2e3138] text-xs font-semibold text-[#f3f4f6]" onClick={() => setLimit(limit + 50)}>Показати ще 50</button>}
            </>}
        </section>
    </div>;
}
