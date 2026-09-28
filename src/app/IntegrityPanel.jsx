import { useEffect, useState } from 'react';
import { SuiteBackup } from '../core/backup.js';
import { inspectIntegrity } from '../core/integrity.js';

const titles = { enemy: 'Події', med: 'Медична евакуація', tactical: 'Журнал о/с', tasks: 'Завдання', ovt: 'Втрати ОВТ', positions: 'Документальні позиції' };
export function IntegrityPanel({ onClose, onOpen }) {
    const [result, setResult] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
    const [module, setModule] = useState(''), [severity, setSeverity] = useState(''), [limit, setLimit] = useState(50);
    const refresh = async () => {
        setBusy(true); setError('');
        try { await window.SuiteRuntime.drain(); setResult(inspectIntegrity(await SuiteBackup.collect({ localState: true, unchecked: true }))); }
        catch (failure) { setError(failure.message); }
        finally { setBusy(false); }
    };
    useEffect(() => { refresh(); }, []);
    const rows = (result?.issues || []).filter(issue => (!module || issue.module === module) && (!severity || issue.severity === severity));
    return <div className="fixed inset-0 z-[21000] bg-black/80 flex items-center justify-center p-4">
        <section role="dialog" aria-modal="true" aria-label="Перевірка цілісності даних" className="bg-slate-900 border border-slate-600 rounded-2xl p-5 w-full max-w-4xl max-h-[90vh] overflow-y-auto space-y-4 text-slate-200">
            <div className="flex justify-between gap-3"><h2 className="text-xl font-bold">Перевірка цілісності даних</h2><button className="dj-button" onClick={onClose}>Закрити</button></div>
            <p className="text-sm text-slate-400">Лише перевірка: записи не змінюються. Невідомі значення й пошкоджені зв’язки потребують ручної звірки.</p>
            <div className="flex gap-3 flex-wrap">
                <select aria-label="Модуль перевірки" className="dj-input" value={module} onChange={e => { setModule(e.target.value); setLimit(50); }}><option value="">Усі модулі</option>{Object.entries(titles).map(([key, title]) => <option key={key} value={key}>{title}</option>)}</select>
                <select aria-label="Рівень проблеми" className="dj-input" value={severity} onChange={e => { setSeverity(e.target.value); setLimit(50); }}><option value="">Усі проблеми</option><option value="error">Помилки</option><option value="warning">Попередження</option></select>
                <button className="dj-button" disabled={busy} onClick={refresh}>{busy ? 'Перевірка…' : 'Перевірити повторно'}</button>
            </div>
            {error && <p role="alert" className="text-rose-300">{error}</p>}
            {result && <><p className="text-sm">Перевірено: {result.checkedAt}. Знайдено: {result.issues.length}; за фільтром: {rows.length}.</p>
                <p className="text-sm text-slate-400">Медичні підсумки: враховано {result.medical.included}, виключено за типом {result.medical.excluded}, некоректних {result.medical.invalid}, повторних ID {result.medical.duplicates}. Небойові втрати та СЗЧ виключаються за правилами обліку.</p>
                {!rows.length && <p className="text-emerald-300">За вибраними перевірками проблем не знайдено.</p>}
                {rows.slice(0, limit).map((issue, index) => <article key={index} className="border border-slate-700 rounded-lg p-3 space-y-2">
                    <p className={issue.severity === 'error' ? 'text-rose-300' : 'text-amber-300'}>{titles[issue.module]} · {issue.label || issue.recordId || 'Розділ'}: {issue.message}</p>
                    {issue.recordId && <p className="text-xs text-slate-500 break-all">ID: {issue.recordId}</p>}
                    <button className="dj-button" onClick={() => onOpen(issue)}>{issue.recordId && !issue.kind && issue.module !== 'tactical' ? 'Відкрити запис' : 'Перейти до розділу'}</button>
                </article>)}
                {rows.length > limit && <button className="dj-button" onClick={() => setLimit(limit + 50)}>Показати ще 50</button>}
            </>}
        </section>
    </div>;
}
