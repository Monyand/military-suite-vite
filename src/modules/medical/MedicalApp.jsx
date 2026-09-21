import { default as React, useState, useRef, useEffect, useMemo, useCallback, startTransition } from 'react';
import { Chart, ExcelJS, localforage, CryptoJS } from '../../core/vendor.js';
import { MedicalPersonnelDirectory } from '../../core/personnel-directory.js';
import { MedicalSeriesChart } from './MedicalSeriesChart.jsx';
import { useSharedDictionaries } from '../../core/use-shared-dictionaries.js';

const MedicalApp = (function() {
            

        const DEFAULT_RANKS = ["Солдат", "Старший солдат", "Молодший сержант", "Сержант", "Старший сержант", "Головний сержант", "Молодший лейтенант", "Лейтенант", "Старший лейтенант", "Капітан", "Майор"];
        const DEFAULT_UNITS = ["1-ша рота", "2-га рота", "3-тя рота", "Взвод вогневої підтримки", "Розвідвзвод", "Управління батальйону"];
        const DEFAULT_SECTORS = ["Позиція 'Альфа'", "Позиція 'Браво'", "КСП батальйону", "Точка вивантаження", "Стабпункт"];
        const DEFAULT_CAUSES = [
            "Удар КАБом", "Удар FPV", "Удар FPV (оптоволокно)", "Удар FPV (крило)", "Скид з БПЛА", 
            "Скид горючої суміші з дрона", "Скид з важкого бомбера", "Обстріл з міномета, 82мм", 
            "Обстріл з міномета, 120мм", "Обстріл з ствольної артилерії", "Підрив на ворожому мінуванні", 
            "Стрілецька зброя", "Залишив позицію", "Нещасний випадок / Хвороба", "Інше"
        ];

        const LOSS_TYPES = [
            "Поранення (300)", "Небойове травмування (300)", 
            "Загибель (200)", "Небойова смерть (200)", "Зниклий безвісти (ЗБВ)", "СЗЧ", "Дезертирство"
        ];
        
        const isAny300 = (type) => type && type.includes("(300)");
        const isAwol = (type) => type === "СЗЧ" || type === "Дезертирство";
        const isAny200 = (type) => type && type.includes("(200)");

        const BODY_REGIONS = [
            { id: 'head', name: 'Голова', x: 100, y: 35, r: 22 }, { id: 'neck', name: 'Шия', x: 100, y: 65, r: 10 },
            { id: 'chest', name: 'Грудна клітка', x: 100, y: 105, r: 25 }, { id: 'abdomen', name: 'Живіт/Пах', x: 100, y: 155, r: 20 },
            { id: 'arm_l', name: 'Ліва рука', x: 55, y: 120, r: 18 }, { id: 'arm_r', name: 'Права рука', x: 145, y: 120, r: 18 },
            { id: 'leg_l', name: 'Ліва нога', x: 80, y: 220, r: 25 }, { id: 'leg_r', name: 'Права нога', x: 120, y: 220, r: 25 }
        ];

        const CHART_COLORS = ['#ef4444', '#f97316', '#f59e0b', '#eab308', '#84cc16', '#22c55e', '#10b981', '#14b8a6', '#06b6d4', '#0ea5e9', '#3b82f6', '#6366f1', '#8b5cf6', '#a855f7', '#d946ef', '#ec4899', '#f43f5e'];

        const _iconSvgCache = new Map();
        const getIconSvg = (name, className) => {
            const key = (name || '') + '|' + (className || '');
            if (_iconSvgCache.has(key)) return _iconSvgCache.get(key);
            if (!window.lucide) return '';
            const pascal = (name || '').split('-').map(s => s.charAt(0).toUpperCase() + s.slice(1)).join('');
            const iconDef = window.lucide.icons?.[pascal] || window.lucide.icons?.[name];
            if (!iconDef) return '';
            const svgEl = window.lucide.createElement(iconDef);
            if (className) svgEl.setAttribute('class', className);
            const html = svgEl.outerHTML;
            _iconSvgCache.set(key, html);
            return html;
        };

        const Icon = React.memo(({ name, className }) => {
            const svgHtml = getIconSvg(name, className);
            if (svgHtml) {
                return <span className="inline-flex shrink-0 items-center justify-center pointer-events-none" dangerouslySetInnerHTML={{ __html: svgHtml }} />;
            }
            return <i data-lucide={name} className={className} />;
        });

        const ChartComponent = React.memo(({ type, data, options, className, title, showLabels, showPercentages }) => {
            const chartRef = React.useRef(null);
            const chartInstance = React.useRef(null);

            React.useEffect(() => {
                if (chartInstance.current) chartInstance.current.destroy();
                
                if (window.ChartDataLabels) Chart.register(window.ChartDataLabels);

                const finalOptions = {
                    responsive: true, maintainAspectRatio: false,
                    color: '#cbd5e1', font: { family: 'Inter, sans-serif', size: 11 },
                    animation: { duration: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 250 },
                    layout: { padding: { top: 18, right: 12, bottom: 6, left: 4 } },
                    elements: { bar: { borderRadius: 4 }, arc: { borderWidth: 2, borderColor: '#0b1220', hoverOffset: 5 } },
                    ...options,
                    ...(options?.scales ? { scales: Object.fromEntries(Object.entries(options.scales).map(([key, axis]) => [key, {
                        ...axis, border: { display: false, ...axis.border },
                        grid: { color: '#94a3b81a', drawTicks: false, ...axis.grid },
                        ticks: { color: '#94a3b8', padding: 8, ...axis.ticks },
                    }])) } : {}),
                    plugins: {
                        ...options?.plugins,
                        legend: { position: 'bottom', ...options?.plugins?.legend, labels: { color: '#cbd5e1', usePointStyle: true, boxWidth: 8, boxHeight: 8, padding: 16, font: { size: 11 }, ...options?.plugins?.legend?.labels } },
                        tooltip: { backgroundColor: '#0f172af5', titleColor: '#f8fafc', bodyColor: '#e2e8f0', borderColor: '#475569', borderWidth: 1, padding: 12, cornerRadius: 10, usePointStyle: true, ...options?.plugins?.tooltip },
                        datalabels: {
                            display: showLabels ? function(context) { return context.dataset.data[context.dataIndex] > 0; } : false,
                            color: '#fff',
                            font: { weight: 'bold', size: 10 },
                            textStrokeColor: '#0f172a',
                            textStrokeWidth: 3,
                            formatter: function(value, context) {
                                if (!showPercentages) return value;

                                let sum = 0;
                                const chartType = context.chart.config.type;
                                const isStacked = options?.scales?.x?.stacked || options?.scales?.y?.stacked;

                                if (chartType === 'pie' || chartType === 'doughnut') {
                                    sum = context.chart.data.datasets[context.datasetIndex].data.reduce((a, b) => a + b, 0);
                                } else if (isStacked) {
                                    context.chart.data.datasets.forEach(ds => {
                                        sum += Number(ds.data[context.dataIndex]) || 0;
                                    });
                                } else {
                                    sum = context.chart.data.datasets[context.datasetIndex].data.reduce((a, b) => a + Number(b), 0);
                                }

                                if (sum === 0) return '0%';
                                let pct = (value / sum * 100);
                                return pct < 1 && pct > 0 ? '<1%' : Math.round(pct) + '%';
                            }
                        }
                    }
                };

                const ctx = chartRef.current.getContext('2d');
                chartInstance.current = new Chart(ctx, { type, data, options: finalOptions });
                
                return () => { if (chartInstance.current) chartInstance.current.destroy(); }
            }, [data, options, type, showLabels, showPercentages, title]);

            const downloadImage = () => {
                if (chartRef.current) {
                    const canvas = chartRef.current;
                    const destCanvas = document.createElement('canvas');
                    destCanvas.width = canvas.width;
                    destCanvas.height = canvas.height;
                    const destCtx = destCanvas.getContext('2d');
                    
                    destCtx.fillStyle = '#0b1220';
                    destCtx.fillRect(0, 0, destCanvas.width, destCanvas.height);
                    destCtx.drawImage(canvas, 0, 0);
                    
                    const url = destCanvas.toDataURL('image/png');
                    const link = document.createElement('a');
                    link.download = (title || 'analytics_chart') + '.png';
                    link.href = url;
                    link.click();
                }
            };

            const downloadExcel = async () => {
                if (!chartRef.current || !data) return;
                if (!window.ExcelJS) {
                    alert('Не завантажено бібліотеку ExcelJS. Перевірте підключення до Інтернету та перезавантажте програму.');
                    return;
                }
                try {
                    const canvas = chartRef.current;
                    const destCanvas = document.createElement('canvas');
                    destCanvas.width = canvas.width;
                    destCanvas.height = canvas.height;
                    const destCtx = destCanvas.getContext('2d');
                    destCtx.fillStyle = '#0b1220';
                    destCtx.fillRect(0, 0, destCanvas.width, destCanvas.height);
                    destCtx.drawImage(canvas, 0, 0);
                    const base64Image = destCanvas.toDataURL('image/png');

                    const workbook = new ExcelJS.Workbook();
                    const cleanTitle = (title || 'Аналітика').replace(/[*?:/\\\[\]]/g, '').slice(0, 30);
                    const worksheet = workbook.addWorksheet(cleanTitle);

                    worksheet.mergeCells('A1', 'E1');
                    const titleCell = worksheet.getCell('A1');
                    titleCell.value = title || 'Аналітична діаграма';
                    titleCell.font = { name: 'Arial', size: 14, bold: true, color: { argb: 'FFFFFFFF' } };
                    titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' } };
                    titleCell.alignment = { vertical: 'middle', horizontal: 'center' };

                    const labels = data.labels || [];
                    const datasets = data.datasets || [];
                    
                    const headerRowValues = ['Показник / Категорія', ...datasets.map(ds => ds.exportLabel || ds.label || 'Значення')];
                    if (datasets.length > 1) headerRowValues.push(data.exportTotals ? 'Всього (без повторів)' : 'Всього');
                    
                    worksheet.addRow([]);
                    const headerRow = worksheet.addRow(headerRowValues);
                    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
                    headerRow.eachCell(cell => {
                        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
                        cell.alignment = { vertical: 'middle', horizontal: 'center' };
                    });

                    labels.forEach((label, idx) => {
                        const rowVals = [label];
                        let rowSum = 0;
                        datasets.forEach(ds => {
                            const val = Number(ds.data[idx]) || 0;
                            rowVals.push(val);
                            rowSum += val;
                        });
                        if (datasets.length > 1) rowVals.push(data.exportTotals ? data.exportTotals[idx] : rowSum);
                        const r = worksheet.addRow(rowVals);
                        r.eachCell((cell, colNumber) => {
                            if (colNumber > 1) cell.alignment = { horizontal: 'right' };
                        });
                    });

                    const imageId = workbook.addImage({
                        base64: base64Image,
                        extension: 'png',
                    });

                    const startRow = labels.length + 5;
                    worksheet.addImage(imageId, {
                        tl: { col: 0, row: startRow },
                        ext: { width: 650, height: 360 }
                    });

                    worksheet.columns.forEach(column => {
                        let maxLength = 0;
                        column.eachCell({ includeEmpty: true }, (cell) => {
                            const columnLength = cell.value ? cell.value.toString().length : 10;
                            if (columnLength > maxLength) maxLength = columnLength;
                        });
                        column.width = Math.max(maxLength + 4, 16);
                    });

                    const buffer = await workbook.xlsx.writeBuffer();
                    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
                    const link = document.createElement('a');
                    const objectUrl = URL.createObjectURL(blob);
                    link.href = objectUrl;
                    link.download = `${cleanTitle}.xlsx`;
                    link.click();
                    setTimeout(() => URL.revokeObjectURL(objectUrl), 10000);
                } catch(err) {
                    console.error("Excel export error:", err);
                }
            };

            return (
                <div className={`relative group ${className}`}>
                    <canvas ref={chartRef} role="img" aria-label={(title || 'Діаграма').replace(/_/g, ' ')}></canvas>
                    <div className="absolute top-1 right-1 flex gap-1 opacity-60 hover:opacity-100 focus-within:opacity-100 transition z-10">
                        <button onClick={downloadExcel} className="p-1.5 bg-emerald-800 hover:bg-emerald-600 text-emerald-100 rounded border border-emerald-700 shadow-lg" title="Завантажити звіт в Excel (сирі дані + діаграма)">
                            <Icon name="table" className="w-4 h-4" />
                        </button>
                        <button onClick={downloadImage} className="p-1.5 bg-tactical-800 hover:bg-tactical-600 text-tactical-200 hover:text-white rounded border border-tactical-700 shadow-lg" title="Завантажити графік як зображення (PNG)">
                            <Icon name="download" className="w-4 h-4" />
                        </button>
                    </div>
                </div>
            );
        }, (prev, next) => {
            return JSON.stringify(prev.data) === JSON.stringify(next.data) &&
                   JSON.stringify(prev.options) === JSON.stringify(next.options) &&
                   prev.type === next.type && prev.title === next.title && prev.className === next.className && prev.showLabels === next.showLabels && prev.showPercentages === next.showPercentages;
        });

        // --- ДОПОМІЖНІ ФУНКЦІЇ ---
        const normalizeMilitaryText = (text, options = { toLower: true, replaceHomoglyphs: true }) => {
            if (text === undefined || text === null) return "";
            let str = String(text);

            // 1. Очищення нерозривних та прихованих пробілів
            str = str.replace(/[\u00A0\u1680\u180E\u2000-\u200B\u202F\u205F\u3000\uFEFF]/g, ' ');

            // 2. Стандартизація апострофів та лапок
            str = str.replace(/[`’ʼ‘']/g, "'").replace(/[«»“”„"]/g, '"');

            // 3. Стандартизація дефісів та тире
            str = str.replace(/[—–−‒]/g, '-');

            // 4. Заміна латинських літер-близнюків на українські (омогліфи)
            if (options && options.replaceHomoglyphs) {
                const homoglyphMap = {
                    'a': 'а', 'A': 'А',
                    'b': 'б', 'B': 'В',
                    'c': 'с', 'C': 'С',
                    'e': 'е', 'E': 'Е',
                    'h': 'н', 'H': 'Н',
                    'i': 'і', 'I': 'І',
                    'k': 'к', 'K': 'К',
                    'm': 'м', 'M': 'М',
                    'o': 'о', 'O': 'О',
                    'p': 'р', 'P': 'Р',
                    't': 'т', 'T': 'Т',
                    'x': 'х', 'X': 'Х',
                    'y': 'у', 'Y': 'У'
                };
                str = str.replace(/[a-zA-Z]/g, match => homoglyphMap[match] || match);
            }

            // 5. Очищення зайвих пробілів
            str = str.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();

            return (options && options.toLower) ? str.toLowerCase() : str;
        };

        const parseSafeDate = (dStr) => {
            if (!dStr) return 0;
            if (dStr instanceof Date) return dStr.getTime();
            if (typeof dStr === 'number') return dStr;
            let s = String(dStr).trim();
            if (!s) return 0;

            // Розумне авто-виправлення одруківок року (наприклад, 62026-08-25 або 22026-08-25 -> 2026-08-25)
            s = s.replace(/^[0-9]*(20\d{2}[-\.\/]\d{2}[-\.\/]\d{2})/, '$1');

            if (/^\d{2}\.\d{2}\.\d{4}/.test(s)) {
                const parts = s.split(/[\sT]+/);
                const [d, m, y] = parts[0].split('.').map(Number);
                const timePart = parts[1] || "00:00:00";
                const [h, min, sec] = timePart.split(':').map(Number);
                return new Date(y, m - 1, d, h || 0, min || 0, sec || 0).getTime();
            }
            if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
                const parts = s.split(/[\sT]+/);
                const [y, m, d] = parts[0].split('-').map(Number);
                const timePart = parts[1] || "00:00:00";
                const [h, min, sec] = timePart.split(':').map(Number);
                return new Date(y, m - 1, d, h || 0, min || 0, sec || 0).getTime();
            }
            const t = new Date(s).getTime();
            return isNaN(t) ? 0 : t;
        };

        const calculateWaitTimeUI = (dateStr) => {
            const startMs = parseSafeDate(dateStr);
            if (!startMs) return "Невідомо";
            const diffMs = Date.now() - startMs;
            if (diffMs < 0) return "Щойно";
            const hours = Math.floor(diffMs / (1000 * 60 * 60));
            return hours >= 24 ? `${Math.floor(hours / 24)}д ${hours % 24}г` : `${hours} год`;
        };

        const getBadgeColors = (lossType, severity) => {
            if (lossType === "Загибель (200)") return "bg-zinc-900 text-zinc-300 border-zinc-700";
            if (lossType === "Небойова смерть (200)") return "bg-stone-900 text-stone-300 border-stone-700";
            if (lossType === "Зниклий безвісти (ЗБВ)") return "bg-blue-950 text-blue-300 border-blue-800";
            if (lossType === "СЗЧ") return "bg-fuchsia-950 text-fuchsia-300 border-fuchsia-800";
            if (lossType === "Дезертирство") return "bg-pink-950 text-pink-300 border-pink-800";
            if (severity === "Критичний") return "bg-purple-950 text-purple-300 border-purple-800 animate-pulse";
            if (severity === "Важкий") return "bg-red-950 text-red-400 border-red-800 animate-pulse";
            if (severity === "Середній") return "bg-amber-950 text-amber-300 border-amber-800";
            return "bg-emerald-950 text-emerald-300 border-emerald-800";
        };

        const getLogRowStyle = (action, details) => {
            const aLow = action.toLowerCase(), dLow = details.toLowerCase();
            if (aLow.includes("евак") || dLow.includes("евак")) return "bg-blue-950/40 border-blue-900/60 text-blue-200 hover:bg-blue-950/60";
            if (dLow.includes("200") || dLow.includes("збв") || dLow.includes("сзч") || dLow.includes("дезерт") || dLow.includes("загиб") || dLow.includes("смерть") || aLow.includes("видалення")) return "bg-red-950/40 border-red-900/60 text-red-200 hover:bg-red-950/60";
            if (dLow.includes("300") || dLow.includes("травм") || dLow.includes("поран") || dLow.includes("важк") || dLow.includes("критич")) return "bg-amber-950/30 border-amber-900/40 text-amber-200 hover:bg-amber-950/50";
            return "bg-tactical-900/20 border-tactical-800 text-tactical-300 hover:bg-tactical-900/30";
        };

        const formatLogTime = (isoStr) => {
            try {
                const d = new Date(isoStr);
                const pad = n => String(n).padStart(2, '0');
                return `${pad(d.getDate())}.${pad(d.getMonth()+1)}.${String(d.getFullYear()).slice(2)} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
            } catch { return isoStr.replace('T',' ').substring(0,19); }
        };
        
        const getInjStrUI = (inj) => {
            if(!inj) return "";
            const d = {amputation:'Амп.', rupture:'Розрив', shrapnel:'Уламк.', bullet:'Кульове', fracture:'Перелом', burn:'Опік', akbt:'АКБТ', contusion:'Забій'};
            let p = [];
            Object.entries(inj).forEach(([rId, a]) => {
                let str = Object.keys(a).filter(k=>a[k]).map(k=>d[k]).join(', ');
                if(str) p.push(`${BODY_REGIONS.find(r=>r.id===rId)?.name||rId}: ${str}`);
            });
            return p.join(' | ');
        };

        // --- УНІВЕРСАЛЬНІ UI КОМПОНЕНТИ ---
        const FilterSection = ({ title, isOpen, toggle, onSelectAll, onClearAll, children }) => (
            <div className="space-y-1">
                <div className="flex items-center justify-between cursor-pointer select-none group" onClick={toggle}>
                    <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider group-hover:text-slate-200 transition">{title}</span>
                    <div className="flex items-center gap-1.5">
                        {onSelectAll && onClearAll && isOpen && (
                            <div className="flex items-center gap-1 font-mono text-[9px]">
                                <button type="button" onClick={(e) => { e.stopPropagation(); onSelectAll(); }} className="text-amber-400 hover:text-amber-300 hover:bg-amber-950/60 px-1.5 py-0.5 rounded bg-slate-950 border border-slate-800 transition cursor-pointer" title="Обрати всі">Всі</button>
                                <button type="button" onClick={(e) => { e.stopPropagation(); onClearAll(); }} className="text-slate-400 hover:text-red-400 hover:bg-red-950/60 px-1.5 py-0.5 rounded bg-slate-950 border border-slate-800 transition cursor-pointer" title="Зняти всі">Зняти</button>
                            </div>
                        )}
                        <Icon name={isOpen ? "chevron-up" : "chevron-down"} className="w-3.5 h-3.5 text-slate-500 group-hover:text-slate-300" />
                    </div>
                </div>
                {isOpen && <div className="mt-1">{children}</div>}
            </div>
        );

        const CheckboxList = ({ items, selected, toggle, onSelectOnly, maxH = true }) => (
            <div className={`flex flex-col gap-1.5 bg-slate-950/70 p-2 rounded-xl border border-slate-800/80 ${maxH ? 'max-h-56 overflow-y-auto' : ''}`}>
                {items.map(item => {
                    const key = typeof item === 'object' ? item.k : item;
                    const label = typeof item === 'object' ? item.l : item;
                    const isChecked = selected.includes(key);
                    return (
                        <div key={key} className="flex items-center justify-between group/row text-xs select-none gap-2">
                            <label className="flex items-center gap-2 cursor-pointer flex-1 min-w-0 py-0.5">
                                <input 
                                    type="checkbox" 
                                    checked={isChecked} 
                                    onChange={() => toggle(key)} 
                                    className="rounded bg-slate-900 border-slate-700 text-amber-500 focus:ring-0 w-3.5 h-3.5 cursor-pointer shrink-0" 
                                />
                                <span className={`whitespace-nowrap transition text-xs ${isChecked ? 'text-slate-200 font-medium' : 'text-slate-400'}`}>{label}</span>
                            </label>
                            {onSelectOnly && (
                                <button 
                                    type="button" 
                                    onClick={(e) => { e.stopPropagation(); onSelectOnly(key); }}
                                    className="opacity-0 group-hover/row:opacity-100 text-[9px] font-mono text-amber-400/80 hover:text-amber-300 px-1.5 py-0.5 rounded bg-slate-900 hover:bg-slate-800 border border-slate-700/50 transition cursor-pointer shrink-0"
                                    title={`Вибрати тільки "${label}"`}
                                >
                                    Тільки
                                </button>
                            )}
                        </div>
                    );
                })}
            </div>
        );

        const FilterDropdown = ({ title, count, total, isOpen, onToggle, onSelectAll, onClearAll, children }) => {
            const isCustom = count < total && count > 0;
            const isZero = count === 0;
            
            return (
                <div className="relative shrink-0">
                    <button 
                        type="button" 
                        onClick={onToggle}
                        className={`flex items-center gap-2 px-3 py-1.5 rounded-xl border text-xs font-semibold transition cursor-pointer select-none ${
                            isCustom 
                                ? 'bg-amber-500/15 border-amber-500/50 text-amber-300 shadow-sm' 
                                : isZero 
                                ? 'bg-red-950/30 border-red-800/60 text-red-300' 
                                : 'bg-slate-950/80 border-slate-800 text-slate-300 hover:text-white hover:border-slate-700'
                        }`}
                    >
                        <span>{title}</span>
                        <span className={`font-mono text-[10px] px-1.5 py-0.2 rounded border font-bold ${
                            isCustom 
                                ? 'bg-amber-500/20 text-amber-300 border-amber-500/40' 
                                : isZero 
                                ? 'bg-red-950 text-red-400 border-red-900' 
                                : 'bg-slate-900 text-slate-400 border-slate-700/60'
                        }`}>
                            {count === total ? 'Всі' : count === 0 ? '0' : `${count}`}
                        </span>
                        <Icon name="chevron-down" className={`w-3 h-3 text-slate-400 transition-transform ${isOpen ? 'rotate-180 text-amber-400' : ''}`} />
                    </button>
                    {isOpen && (
                        <>
                            <div className="fixed inset-0 z-40 cursor-default" onClick={onToggle}></div>
                            <div className="absolute top-full left-0 mt-1.5 w-max min-w-[280px] max-w-[calc(100vw-32px)] bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl p-3.5 z-50 space-y-2.5 animate-in fade-in zoom-in-95 duration-150">
                                <div className="flex items-center justify-between pb-2 border-b border-slate-800">
                                    <span className="text-[11px] font-bold text-slate-300 uppercase">{title}</span>
                                    <div className="flex gap-1.5 text-[10px] font-mono">
                                        {onSelectAll && <button type="button" onClick={onSelectAll} className="text-amber-400 hover:text-amber-300 px-2 py-0.5 rounded bg-slate-950 border border-slate-800 hover:bg-slate-800 cursor-pointer">Всі</button>}
                                        {onClearAll && <button type="button" onClick={onClearAll} className="text-red-400 hover:text-red-300 px-2 py-0.5 rounded bg-slate-950 border border-slate-800 hover:bg-slate-800 cursor-pointer">Зняти</button>}
                                    </div>
                                </div>
                                <div className="max-h-60 overflow-y-auto pr-1">
                                    {children}
                                </div>
                            </div>
                        </>
                    )}
                </div>
            );
        };

        
        const formatCallsignUI = (raw) => {
            if (!raw) return '';
            let clean = String(raw).trim();
            clean = clean.replace(/^[\"\'«»\(\)\[\]]+|[\"\'«»\(\)\[\]]+$/g, '').trim();
            if (!clean) return '';
            return clean.split(/([\s\-]+)/).map(part => {
                if (/^[\s\-]+$/.test(part) || !part) return part;
                return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
            }).join('');
        };
        
        const formatEpisodeDateUI = (dStr) => {
            if (!dStr) return '';
            const ms = parseSafeDate(dStr);
            if (!ms) return String(dStr).replace('T', ' ').substring(0, 16);
            const d = new Date(ms);
            const day = String(d.getDate()).padStart(2, '0');
            const month = String(d.getMonth() + 1).padStart(2, '0');
            const year = d.getFullYear();
            const hours = String(d.getHours()).padStart(2, '0');
            const mins = String(d.getMinutes()).padStart(2, '0');
            return `${day}.${month}.${year} ${hours}:${mins}`;
        };

        const formatWeaponStatusUI = (status) => {
            if (!status) return '';
            if (status.includes('позиці')) return 'на позиції';
            if (status.includes('підрозділ')) return 'у підрозділі';
            if (status.includes('зі зброєю')) return 'зі зброєю';
            if (status.includes('втрачен') || status.includes('залишен')) return 'втрачена';
            return status;
        };

        
        const formatSoldierReportLine = (episode, soldier, index = null) => {
            const displayRank = episode.rank || soldier?.rank || '';
            const cleanRank = (!displayRank || displayRank === 'Не вказано' || displayRank === 'Невідомо') ? 'В/сл' : displayRank;
            const sName = soldier?.name || 'Невідомо';
            const sCallsign = soldier?.callsign ? ` «${formatCallsignUI(soldier.callsign)}»` : '';
            const unitStr = episode.unit || soldier?.unit || 'Не вказано';
            const dateStr = formatEpisodeDateUI(episode.date);
            const causeStr = episode.cause ? `, ${episode.cause}` : '';
            const factStr = episode.actualLoc || 'Не вказано';
            const docStr = episode.docLoc ? ` (Док: ${episode.docLoc})` : '';
            const injStr = getInjStrUI(episode.injuries);

            // Характер та стан
            let charStr = episode.lossType;
            if (isAny300(episode.lossType)) {
                const sev = episode.severity || 'Поранення';
                charStr = `300 (${sev})`;
            } else if (isAny200(episode.lossType)) {
                charStr = 'Загибель (200)';
            }

            const injPart = injStr ? ` — ${injStr}` : '';
            const udpPart = episode.inUdp ? ' [УПД]' : '';
            const reportPart = episode.hasReport ? ' [Рапорт]' : '';

            // Статус евакуації
            let evacStr = 'Не евакуйований';
            const isAwolType = isAwol(episode.lossType);
            const isEvac = episode.evacStatus === "Евакуйований";
            if (isAwolType) {
                evacStr = episode.awolStatus || 'СЗЧ';
            } else if (isEvac || episode.awolStatus === "Повернувся") {
                evacStr = 'Евакуйований';
            } else {
                evacStr = 'Не евакуйований';
            }

            const numPrefix = index !== null ? `${index}. ` : '';
            
            // Структурований 2-рядковий блок (Варіант 2)
            return `${numPrefix}${sName}${sCallsign} (${cleanRank}, ${unitStr})\n   • ${charStr}${injPart}${udpPart}${reportPart} | ${evacStr}\n   • Подія: ${dateStr}${causeStr} | Факт: ${factStr}${docStr}`;
        };

        const EpisodeCard = React.memo(({ episode, soldier: baseSoldier, soldierEpisodes = [], onEdit, onNotify, viewMode = 'grid' }) => {
            const soldier = MedicalPersonnelDirectory.forEpisode(episode, baseSoldier);
            const [isCopied, setIsCopied] = React.useState(false);
            const badgeClass = getBadgeColors(episode.lossType, episode.severity);
            const isEvac = episode.evacStatus === "Евакуйований";
            const injStr = getInjStrUI(episode.injuries);
            
            // Евакуація: розрахунок даних для відображення та копіювання
            let evacFormattedDate = "";
            const rawEvacDate = episode.evacTime || episode.evacDate;
            if (rawEvacDate) {
                const eDate = new Date(rawEvacDate);
                if (!isNaN(eDate.getTime())) {
                    evacFormattedDate = eDate.toLocaleDateString('uk-UA', { day: '2-digit', month: '2-digit', year: '2-digit' });
                }
            }

            const waitStr = calculateWaitTimeUI(episode.date);
            const isWaitValid = waitStr && waitStr !== "Невідомо";

            // Рядок для копіювання
            let evacCopyStr = 'Не евакуйований';
            if (isAwol(episode.lossType)) {
                evacCopyStr = episode.awolStatus || 'СЗЧ';
            } else if (isEvac || episode.awolStatus === "Повернувся") {
                evacCopyStr = evacFormattedDate ? `Евакуйований (${evacFormattedDate})` : 'Евакуйований';
            } else {
                evacCopyStr = 'Не евакуйований';
            }

            const displayRank = episode.rank || soldier?.rank || '';
            const displayUnit = episode.unit || soldier?.unit || '';
            const sName = soldier?.name || 'Невідомо';
            const sCallsign = soldier?.callsign || '';
            const dateDisplay = formatEpisodeDateUI(episode.date);

            const leftAccentColor = 
                isAny200(episode.lossType) ? 'bg-zinc-500' :
                episode.lossType === 'Зниклий безвісті (ЗБВ)' ? 'bg-blue-500' :
                isAwol(episode.lossType) ? 'bg-fuchsia-500' :
                episode.severity === 'Критичний' ? 'bg-purple-500' :
                episode.severity === 'Важкий' ? 'bg-red-500' :
                episode.severity === 'Середній' ? 'bg-amber-500' :
                episode.severity === 'Легкий' ? 'bg-emerald-500' : 'bg-slate-700';

            const isRankMissing = !displayRank || displayRank === 'Не вказано' || displayRank === 'Невідомо';
            const cleanRank = isRankMissing ? 'В/сл' : displayRank;

            const handleCopySummary = (e) => {
                e.stopPropagation();
                const epWithWait = { ...episode, waitStr: isWaitValid ? waitStr : '' };
                const textToCopy = formatSoldierReportLine(epWithWait, soldier);
                
                const onDone = () => {
                    setIsCopied(true);
                    setTimeout(() => setIsCopied(false), 2000);
                    if (onNotify) onNotify("Дані бійця скопійовано!", "success");
                };

                if (navigator?.clipboard?.writeText) {
                    navigator.clipboard.writeText(textToCopy).then(onDone).catch(() => {
                        copyFallback(textToCopy);
                    });
                } else {
                    copyFallback(textToCopy);
                }
            };

            const copyFallback = (str) => {
                const ta = document.createElement('textarea');
                ta.value = str;
                document.body.appendChild(ta);
                ta.select();
                document.execCommand('copy');
                document.body.removeChild(ta);
                setIsCopied(true);
                setTimeout(() => setIsCopied(false), 2000);
                if (onNotify) onNotify("Дані бійця скопійовано!", "success");
            };

            const renderEvacBadge = (widthClass = "w-48 xl:w-[200px]") => {
                if (isAwol(episode.lossType)) {
                    return (
                        <div className={`${widthClass} text-center text-xs font-semibold px-2.5 py-1 rounded-xl bg-slate-950/90 border border-slate-800 text-slate-300 shadow-inner flex items-center justify-center gap-1.5`}>
                            <Icon name="user-x" className="w-3.5 h-3.5 text-fuchsia-400 shrink-0" />
                            <span className="text-fuchsia-300 truncate">{episode.awolStatus || 'СЗЧ'}</span>
                        </div>
                    );
                }

                if (isEvac || episode.awolStatus === "Повернувся") {
                    return (
                        <div className={`${widthClass} text-center text-xs font-semibold px-2.5 py-1 rounded-xl bg-slate-950/90 border border-slate-800 text-slate-300 shadow-inner flex items-center justify-center gap-1.5`}>
                            <Icon name="check-circle" className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                            <span className="text-slate-300">Евакуйований</span>
                            {evacFormattedDate && <span className="text-emerald-400 font-mono font-bold text-[11px]">({evacFormattedDate})</span>}
                        </div>
                    );
                }

                // Не евакуйований: темний бейдж з червоним таймером
                return (
                    <div className={`${widthClass} text-center text-xs font-semibold px-2.5 py-1 rounded-xl bg-slate-950/90 border border-slate-800 text-slate-300 shadow-inner flex items-center justify-center gap-1.5`}>
                        <Icon name="ambulance" className="w-3.5 h-3.5 text-red-400 shrink-0" />
                        <span className="text-slate-300">Не евакуйований</span>
                        {isWaitValid && <span className="text-red-400 font-mono font-bold text-[11px]">({waitStr})</span>}
                    </div>
                );
            };

            if (viewMode === 'list') {
                return (
                    <div 
                        onClick={() => onEdit(episode)} 
                        className="bg-slate-900/95 border border-slate-800 hover:border-amber-500/50 hover:bg-slate-900 rounded-2xl p-3 flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-3.5 group transition-all shadow-sm hover:shadow-xl hover:shadow-black/40 relative overflow-hidden cursor-pointer"
                        title="Клікніть для редагування запису"
                    >
                        <div className={`absolute top-0 left-0 w-1.5 h-full ${leftAccentColor}`}></div>
                        
                        {/* 1. Ліва колонка: Боєць + Кнопки дій */}
                        <div className="pl-2 flex items-center gap-2.5 w-full lg:w-[400px] xl:w-[440px] 2xl:w-[470px] shrink-0">
                            <div className="flex items-center gap-1 shrink-0">
                                <button 
                                    type="button" 
                                    onClick={(e) => { e.stopPropagation(); onEdit(episode); }} 
                                    className="w-8 h-8 rounded-xl bg-slate-950/90 hover:bg-amber-500/20 border border-slate-800 hover:border-amber-500/50 text-slate-400 group-hover:text-amber-400 flex items-center justify-center transition shadow-sm cursor-pointer"
                                    title="Редагувати запис"
                                >
                                    <Icon name="edit-3" className="w-3.5 h-3.5" />
                                </button>
                                <button 
                                    type="button" 
                                    onClick={handleCopySummary}
                                    className={`w-8 h-8 rounded-xl border flex items-center justify-center transition shadow-sm cursor-pointer ${
                                        isCopied 
                                            ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-300' 
                                            : 'bg-slate-950/90 hover:bg-slate-800 border-slate-800 text-slate-400 hover:text-slate-200'
                                    }`}
                                    title={isCopied ? "Скопійовано в буфер!" : "Скопіювати короткий звіт по бійцю"}
                                >
                                    <Icon name={isCopied ? "check" : "copy"} className="w-3.5 h-3.5" />
                                </button>
                            </div>

                            <div className="min-w-0 flex-1 space-y-1">
                                <div className="flex items-center gap-2 min-w-0">
                                    <span className="text-slate-300 text-[10px] font-semibold bg-slate-950 border border-slate-800 px-1.5 py-0.5 rounded shadow-sm shrink-0 uppercase tracking-wide">
                                        {cleanRank}
                                    </span>
                                    <span className="text-white group-hover:text-amber-300 font-bold text-sm tracking-tight truncate transition-colors" title={sName}>
                                        {sName}
                                    </span>
                                </div>
                                <div className="flex items-center gap-2 text-[11px] text-slate-400 flex-wrap">
                                    {sCallsign && (
                                        <span className="text-amber-400 text-xs font-mono font-bold bg-amber-500/10 border border-amber-500/30 px-1.5 py-0.5 rounded shadow-sm shrink-0">
                                           «{formatCallsignUI(sCallsign)}»
                                        </span>
                                    )}
                                    <span className="text-slate-300 font-medium flex items-center gap-1 bg-slate-950/60 border border-slate-800/80 px-1.5 py-0.5 rounded text-[11px] truncate max-w-[150px]" title={displayUnit}>
                                        <Icon name="shield" className="w-3 h-3 text-slate-500 shrink-0" />
                                        <span className="truncate">{displayUnit || 'Не вказано'}</span>
                                    </span>
                                    <span className="text-slate-400 font-mono flex items-center gap-1 text-[10px]" title="Дата та час події">
                                        <Icon name="calendar" className="w-3 h-3 text-slate-500 shrink-0" />
                                        <span>{dateDisplay}</span>
                                    </span>
                                    {soldierEpisodes && soldierEpisodes.length > 1 && (
                                        <span 
                                            className="text-[10px] font-mono font-bold bg-amber-950/70 border border-amber-500/40 text-amber-300 px-2 py-0.5 rounded-lg flex items-center gap-1 shrink-0 shadow-sm" 
                                            title={`Ланцюжок статусів бійця (${soldierEpisodes.length} епізоди): ${soldierEpisodes.map(e => e.lossType.split(' ')[0]).join(' ➔ ')}`}
                                        >
                                            <Icon name="history" className="w-3 h-3 text-amber-400 shrink-0" />
                                            <span>{soldierEpisodes.map(e => e.lossType.split(' ')[0]).join(' ➔ ')}</span>
                                        </span>
                                    )}
                                </div>
                            </div>
                        </div>

                        {/* 2. Середня колонка: Обставини/Локації (вгорі) та Травми/Теги (внизу) */}
                        <div className="flex-1 min-w-0 px-1 lg:border-l lg:border-slate-800/80 lg:pl-3 space-y-1.5">
                            {/* Рядок 1: Суворе 3-колонкове вирівнювання (Причина | Факт | Док) */}
                            <div className="grid grid-cols-1 sm:grid-cols-[minmax(180px,250px)_minmax(140px,200px)_1fr] items-center gap-2">
                                <div className="min-w-0 flex items-center">
                                    <div className="w-fit max-w-full flex items-center gap-1.5 bg-slate-950/80 border border-slate-800 px-2.5 py-1 rounded-xl text-xs shadow-inner min-w-0">
                                        <Icon name="target" className="w-3.5 h-3.5 text-red-400 shrink-0" />
                                        <span className="text-slate-400 text-[10px] uppercase font-semibold tracking-wider shrink-0">Причина:</span>
                                        <span className="font-medium text-white truncate" title={episode.cause}>{episode.cause}</span>
                                    </div>
                                </div>

                                <div className="min-w-0 flex items-center">
                                    <div className="w-fit max-w-full flex items-center gap-1.5 bg-amber-950/20 border border-amber-900/40 px-2.5 py-1 rounded-xl text-xs shadow-inner min-w-0">
                                        <Icon name="map-pin" className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                                        <span className="text-amber-400/80 text-[10px] uppercase font-semibold tracking-wider shrink-0">Факт:</span>
                                        <span className="text-amber-200 font-medium truncate" title={episode.actualLoc}>{episode.actualLoc || "-"}</span>
                                    </div>
                                </div>

                                <div className="min-w-0 flex items-center">
                                    {episode.docLoc ? (
                                        <div className="w-fit max-w-full flex items-center gap-1.5 bg-slate-950/80 border border-slate-800 px-2.5 py-1 rounded-xl text-xs shadow-inner min-w-0">
                                            <Icon name="file-text" className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                                            <span className="text-slate-400 text-[10px] uppercase font-semibold tracking-wider shrink-0">Док:</span>
                                            <span className="text-slate-300 font-medium truncate" title={episode.docLoc}>{episode.docLoc}</span>
                                        </div>
                                    ) : null}
                                </div>
                            </div>

                            {/* Рядок 2: Травми (Колонка 1) | Під час УПД (Колонка 2) | Рапорт / Зброя (Колонка 3) */}
                            {(injStr || episode.inUdp || episode.hasReport || episode.weaponStatus) && (
                                <div className="grid grid-cols-1 sm:grid-cols-[minmax(180px,250px)_minmax(140px,200px)_1fr] items-center gap-2 pt-0.5 min-w-0">
                                    {/* Колонка 1: Травми */}
                                    <div className="min-w-0 flex items-center">
                                        {injStr ? (
                                            <div className="w-fit max-w-full flex items-center gap-1.5 bg-red-950/30 border border-red-900/50 px-2.5 py-0.5 rounded-lg text-xs text-red-300 shadow-inner min-w-0">
                                                <Icon name="activity" className="w-3 h-3 text-red-400 shrink-0" />
                                                <span className="font-bold text-red-400 text-[10px] uppercase tracking-wider shrink-0">Травми:</span>
                                                <span className="text-red-200 font-medium text-[11px] truncate" title={injStr}>{injStr}</span>
                                            </div>
                                        ) : null}
                                    </div>

                                    {/* Колонка 2: Під час УПД */}
                                    <div className="min-w-0 flex items-center">
                                        {episode.inUdp ? (
                                            <span className="w-fit text-[10px] bg-red-950/70 text-red-300 border border-red-800/70 px-2 py-0.5 rounded-md font-semibold tracking-wide flex items-center gap-1 shrink-0" title="Отримано під час УПД">
                                                <Icon name="zap" className="w-2.5 h-2.5 text-red-400" /> Під час УПД
                                            </span>
                                        ) : null}
                                    </div>

                                    {/* Колонка 3: Рапорт та Зброя */}
                                    <div className="flex items-center gap-1.5 flex-wrap min-w-0">
                                        {episode.hasReport && (
                                            <span className="text-[10px] bg-blue-950/70 text-blue-300 border border-blue-800/70 px-2 py-0.5 rounded-md font-semibold tracking-wide flex items-center gap-1 shrink-0" title="Складено офіційний рапорт">
                                                <Icon name="file-check-2" className="w-2.5 h-2.5 text-blue-400" /> Рапорт
                                            </span>
                                        )}
                                        {episode.weaponStatus && (
                                            <span 
                                                className={`text-[10px] border px-2 py-0.5 rounded-md font-semibold flex items-center gap-1 shrink-0 ${
                                                    episode.weaponStatus === "СЗЧ/Дезертирство зі зброєю" ? "bg-red-950/70 text-red-300 border-red-800/70" : 
                                                    episode.weaponStatus === "знаходиться у підрозділі" ? "bg-blue-950/70 text-blue-300 border-blue-800/70" :
                                                    "bg-amber-950/70 text-amber-300 border-amber-800/70"
                                                }`}
                                                title={`Статус зброї: ${episode.weaponStatus}`}
                                            >
                                                <Icon name="crosshair" className="w-2.5 h-2.5" /> 
                                                <span className="truncate">Зброя: {formatWeaponStatusUI(episode.weaponStatus)}</span>
                                            </span>
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* 3. Права колонка: Варіант А (Кольоровий статус втрати + темне скло евакуації з акцентним таймером) */}
                        <div className="flex flex-col items-end justify-center gap-1.5 shrink-0 lg:border-l lg:border-slate-800/80 lg:pl-3.5">
                            <span className={`w-48 xl:w-[200px] text-center text-xs uppercase font-bold tracking-wide px-2.5 py-1 rounded-xl border shadow-sm ${badgeClass}`}>
                                {isAny300(episode.lossType) ? `${episode.lossType.split(' ')[0]} (${episode.severity})` : episode.lossType}
                            </span>
                            {renderEvacBadge("w-48 xl:w-[200px]")}
                        </div>
                    </div>
                );
            }

            // Grid (2-col) view
            return (
                <div 
                    onClick={() => onEdit(episode)} 
                    className="bg-slate-900/95 border border-slate-800 hover:border-amber-500/50 hover:bg-slate-900 rounded-2xl p-4 flex flex-col justify-between gap-3 group transition-all shadow-md hover:shadow-xl hover:shadow-black/40 relative overflow-hidden cursor-pointer"
                    title="Клікніть для редагування запису"
                >
                    <div className={`absolute top-0 left-0 w-1.5 h-full ${leftAccentColor}`}></div>

                    {/* Верхня частина: Фіксовані кнопки + Звання, ПІБ, Позивний + Статуси */}
                    <div className="pl-2 flex items-start justify-between gap-3">
                        <div className="flex items-center gap-2.5 min-w-0 flex-1">
                            <div className="flex items-center gap-1 shrink-0">
                                <button 
                                    type="button" 
                                    onClick={(e) => { e.stopPropagation(); onEdit(episode); }} 
                                    className="w-8 h-8 rounded-xl bg-slate-950/90 hover:bg-amber-500/20 border border-slate-800 hover:border-amber-500/50 text-slate-400 group-hover:text-amber-400 flex items-center justify-center transition shadow-sm cursor-pointer"
                                    title="Редагувати запис"
                                >
                                    <Icon name="edit-3" className="w-3.5 h-3.5" />
                                </button>
                                <button 
                                    type="button" 
                                    onClick={handleCopySummary}
                                    className={`w-8 h-8 rounded-xl border flex items-center justify-center transition shadow-sm cursor-pointer ${
                                        isCopied 
                                            ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-300' 
                                            : 'bg-slate-950/90 hover:bg-slate-800 border-slate-800 text-slate-400 hover:text-slate-200'
                                    }`}
                                    title={isCopied ? "Скопійовано в буфер!" : "Скопіювати короткий звіт по бійцю"}
                                >
                                    <Icon name={isCopied ? "check" : "copy"} className="w-3.5 h-3.5" />
                                </button>
                            </div>

                            <div className="min-w-0 flex-1 space-y-1">
                                <div className="flex items-center gap-2 min-w-0">
                                    <span className="text-slate-300 text-[10px] font-semibold bg-slate-950 border border-slate-800 px-1.5 py-0.5 rounded shadow-sm shrink-0 uppercase tracking-wide">
                                        {cleanRank}
                                    </span>
                                    <span className="text-white group-hover:text-amber-300 font-bold text-sm tracking-tight truncate transition-colors" title={sName}>
                                        {sName}
                                    </span>
                                </div>
                                <div className="flex items-center gap-2 text-[11px] text-slate-400 flex-wrap">
                                    {sCallsign && (
                                        <span className="text-amber-400 text-xs font-mono font-bold bg-amber-500/10 border border-amber-500/30 px-1.5 py-0.5 rounded shadow-sm shrink-0">
                                            «{formatCallsignUI(sCallsign)}»
                                        </span>
                                    )}
                                    <span className="text-slate-300 font-medium flex items-center gap-1 bg-slate-950/60 border border-slate-800/80 px-1.5 py-0.5 rounded text-[11px] truncate max-w-[150px]" title={displayUnit}>
                                        <Icon name="shield" className="w-3 h-3 text-slate-500 shrink-0" />
                                        <span className="truncate">{displayUnit || 'Не вказано'}</span>
                                    </span>
                                    <span className="text-slate-400 font-mono flex items-center gap-1 text-[10px]">
                                        <Icon name="calendar" className="w-3 h-3 text-slate-500 shrink-0" />
                                        <span>{dateDisplay}</span>
                                    </span>
                                    {soldierEpisodes && soldierEpisodes.length > 1 && (
                                        <span 
                                            className="text-[10px] font-mono font-bold bg-amber-950/70 border border-amber-500/40 text-amber-300 px-2 py-0.5 rounded-lg flex items-center gap-1 shrink-0 shadow-sm" 
                                            title={`Ланцюжок статусів бійця (${soldierEpisodes.length} епізоди): ${soldierEpisodes.map(e => e.lossType.split(' ')[0]).join(' ➔ ')}`}
                                        >
                                            <Icon name="history" className="w-3 h-3 text-amber-400 shrink-0" />
                                            <span>{soldierEpisodes.map(e => e.lossType.split(' ')[0]).join(' ➔ ')}</span>
                                        </span>
                                    )}
                                </div>
                            </div>
                        </div>

                        {/* Статуси вгорі */}
                        <div className="flex flex-col items-end gap-1.5 shrink-0">
                            <span className={`w-44 text-center text-xs uppercase font-bold tracking-wide px-2 py-0.5 rounded-xl border shadow-sm ${badgeClass}`}>
                                {isAny300(episode.lossType) ? `${episode.lossType.split(' ')[0]} (${episode.severity})` : episode.lossType}
                            </span>
                            {renderEvacBadge("w-44")}
                        </div>
                    </div>

                    {/* Середня частина: Матрична 3-колонкова сітка */}
                    <div className="pl-2 space-y-1.5">
                        {/* Рядок 1: Причина | Факт | Док */}
                        <div className="grid grid-cols-1 sm:grid-cols-[minmax(160px,210px)_minmax(130px,160px)_minmax(130px,1fr)] items-center gap-2">
                            <div className="flex items-center gap-1.5 bg-slate-950/80 border border-slate-800 px-2.5 py-1 rounded-xl text-xs shadow-inner min-w-0">
                                <Icon name="target" className="w-3.5 h-3.5 text-red-400 shrink-0" />
                                <span className="text-slate-400 text-[10px] uppercase font-semibold tracking-wider shrink-0">Причина:</span>
                                <span className="font-medium text-white truncate" title={episode.cause}>{episode.cause}</span>
                            </div>
                            <div className="flex items-center gap-1.5 bg-amber-950/20 border border-amber-900/40 px-2.5 py-1 rounded-xl text-xs shadow-inner min-w-0">
                                <Icon name="map-pin" className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                                <span className="text-amber-400/80 text-[10px] uppercase font-semibold tracking-wider shrink-0">Факт:</span>
                                <span className="text-amber-200 font-medium truncate" title={episode.actualLoc}>{episode.actualLoc || "-"}</span>
                            </div>
                            {episode.docLoc ? (
                                <div className="flex items-center gap-1.5 bg-slate-950/80 border border-slate-800 px-2.5 py-1 rounded-xl text-xs shadow-inner min-w-0">
                                    <Icon name="file-text" className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                                    <span className="text-slate-400 text-[10px] uppercase font-semibold tracking-wider shrink-0">Док:</span>
                                    <span className="text-slate-300 font-medium truncate" title={episode.docLoc}>{episode.docLoc}</span>
                                </div>
                            ) : <div />}
                        </div>

                        {/* Рядок 2: Травми (Колонка 1) | Під час УПД (Колонка 2) | Рапорт / Зброя (Колонка 3) */}
                        {(injStr || episode.inUdp || episode.hasReport || episode.weaponStatus) && (
                            <div className="grid grid-cols-1 sm:grid-cols-[minmax(160px,210px)_minmax(130px,160px)_minmax(130px,1fr)] items-center gap-2 pt-0.5 min-w-0">
                                {/* Колонка 1: Травми */}
                                <div className="min-w-0">
                                    {injStr ? (
                                        <div className="flex items-center gap-1.5 bg-red-950/30 border border-red-900/50 px-2.5 py-0.5 rounded-lg text-xs text-red-300 shadow-inner min-w-0">
                                            <Icon name="activity" className="w-3 h-3 text-red-400 shrink-0" />
                                            <span className="font-bold text-red-400 text-[10px] uppercase tracking-wider shrink-0">Травми:</span>
                                            <span className="text-red-200 font-medium text-[11px] truncate" title={injStr}>{injStr}</span>
                                        </div>
                                    ) : null}
                                </div>

                                {/* Колонка 2: Під час УПД */}
                                <div className="min-w-0">
                                    {episode.inUdp ? (
                                        <span className="w-fit text-[10px] bg-red-950/70 text-red-300 border border-red-800/70 px-2 py-0.5 rounded-md font-semibold tracking-wide flex items-center gap-1 shrink-0" title="Отримано під час УПД">
                                            <Icon name="zap" className="w-2.5 h-2.5 text-red-400" /> Під час УПД
                                        </span>
                                    ) : null}
                                </div>

                                {/* Колонка 3: Рапорт та Зброя */}
                                <div className="flex items-center gap-1.5 flex-wrap min-w-0">
                                    {episode.hasReport && (
                                        <span className="text-[10px] bg-blue-950/70 text-blue-300 border border-blue-800/70 px-2 py-0.5 rounded-md font-semibold tracking-wide flex items-center gap-1 shrink-0" title="Складено офіційний рапорт">
                                            <Icon name="file-check-2" className="w-2.5 h-2.5 text-blue-400" /> Рапорт
                                        </span>
                                    )}
                                    {episode.weaponStatus && (
                                        <span 
                                            className={`text-[10px] border px-2 py-0.5 rounded-md font-semibold flex items-center gap-1 shrink-0 ${
                                                episode.weaponStatus === "СЗЧ/Дезертирство зі зброєю" ? "bg-red-950/70 text-red-300 border-red-800/70" : 
                                                episode.weaponStatus === "знаходиться у підрозділі" ? "bg-blue-950/70 text-blue-300 border-blue-800/70" :
                                                "bg-amber-950/70 text-amber-300 border-amber-800/70"
                                            }`}
                                            title={`Статус зброї: ${episode.weaponStatus}`}
                                        >
                                            <Icon name="crosshair" className="w-2.5 h-2.5" /> 
                                            <span className="truncate">Зброя: {formatWeaponStatusUI(episode.weaponStatus)}</span>
                                        </span>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            );
        });

        const TriageCard = React.memo(({ ep, soldier: baseSoldier, soldierEpisodes = [], onQuickEvac, onEdit, onAlertMIA, onNotify }) => {
            const soldier = MedicalPersonnelDirectory.forEpisode(ep, baseSoldier);
            const [isCopied, setIsCopied] = React.useState(false);
            const waitStr = calculateWaitTimeUI(ep.date);
            const injStr = getInjStrUI(ep.injuries);
            const displayRank = ep.rank || soldier?.rank || '';
            const displayUnit = ep.unit || soldier?.unit || '';
            const sName = soldier?.name || 'Невідомо';
            const sCallsign = soldier?.callsign || '';
            const dateDisplay = formatEpisodeDateUI(ep.date);

            const isRankMissing = !displayRank || displayRank === 'Не вказано' || displayRank === 'Невідомо';
            const cleanRank = isRankMissing ? 'В/сл' : displayRank;

            const leftAccentColor = 
                isAny200(ep.lossType) ? 'bg-zinc-500' :
                ep.lossType === 'Зниклий безвісті (ЗБВ)' ? 'bg-blue-500' :
                isAwol(ep.lossType) ? 'bg-fuchsia-500' :
                ep.severity === 'Критичний' ? 'bg-purple-500 animate-pulse' :
                ep.severity === 'Важкий' ? 'bg-red-500' :
                ep.severity === 'Середній' ? 'bg-amber-500' :
                ep.severity === 'Легкий' ? 'bg-emerald-500' : 'bg-slate-600';

            const timerBadgeColor =
                ep.severity === 'Критичний' ? 'bg-purple-950/80 text-purple-300 border-purple-800/80' :
                ep.severity === 'Важкий' ? 'bg-red-950/80 text-red-300 border-red-800/80' :
                ep.severity === 'Середній' ? 'bg-amber-950/80 text-amber-300 border-amber-800/80' :
                ep.severity === 'Легкий' ? 'bg-emerald-950/80 text-emerald-300 border-emerald-800/80' :
                'bg-slate-950 text-slate-300 border-slate-800';

            const handleCopySummary = (e) => {
                e.stopPropagation();
                const epWithWait = { ...ep, waitStr: waitStr !== 'Невідомо' ? waitStr : '' };
                const textToCopy = formatSoldierReportLine(epWithWait, soldier);
                
                const onDone = () => {
                    setIsCopied(true);
                    setTimeout(() => setIsCopied(false), 2000);
                    if (onNotify) onNotify("Дані бійця скопійовано!", "success");
                };

                if (navigator?.clipboard?.writeText) {
                    navigator.clipboard.writeText(textToCopy).then(onDone).catch(() => {
                        copyFallback(textToCopy);
                    });
                } else {
                    copyFallback(textToCopy);
                }
            };

            const copyFallback = (str) => {
                const ta = document.createElement('textarea');
                ta.value = str;
                document.body.appendChild(ta);
                ta.select();
                document.execCommand('copy');
                document.body.removeChild(ta);
                setIsCopied(true);
                setTimeout(() => setIsCopied(false), 2000);
                if (onNotify) onNotify("Дані бійця скопійовано!", "success");
            };
            
            return (
                <div 
                    onClick={() => onEdit(ep)}
                    className="bg-slate-900/95 border border-slate-800 hover:border-amber-500/50 hover:bg-slate-900 p-3.5 rounded-2xl shadow-md hover:shadow-xl hover:shadow-black/40 flex flex-col gap-2.5 relative overflow-hidden group transition-all cursor-pointer"
                    title="Клікніть для редагування запису"
                >
                    <div className={`absolute top-0 left-0 w-1.5 h-full ${leftAccentColor}`}></div>
                    
                    {/* Верхній рядок: Звання, Позивний, ПІБ + Таймер очікування */}
                    <div className="pl-2 flex justify-between items-start gap-2">
                        <div className="min-w-0 flex-1 space-y-1">
                            <div className="flex items-center gap-1.5 flex-wrap">
                                <span className="text-slate-300 text-[10px] font-semibold bg-slate-950 border border-slate-800 px-1.5 py-0.5 rounded tracking-wide uppercase">
                                    {cleanRank}
                                </span>
                                {sCallsign && (
                                    <span className="text-amber-400 text-xs font-mono font-bold bg-amber-500/10 border border-amber-500/30 px-1.5 py-0.5 rounded shadow-sm">
                                        «{formatCallsignUI(sCallsign)}»
                                    </span>
                                )}
                                <span className="text-slate-300 font-medium text-xs truncate max-w-[120px]" title={displayUnit}>
                                    {displayUnit || 'Не вказано'}
                                </span>
                                {soldierEpisodes && soldierEpisodes.length > 1 && (
                                    <span 
                                        className="text-[9px] font-mono font-bold bg-amber-950/70 border border-amber-500/40 text-amber-300 px-1.5 py-0.5 rounded flex items-center gap-1 shrink-0 shadow-sm" 
                                        title={`Ланцюжок статусів бійця (${soldierEpisodes.length} епізоди): ${soldierEpisodes.map(e => e.lossType.split(' ')[0]).join(' ➔ ')}`}
                                    >
                                        <Icon name="history" className="w-2.5 h-2.5 text-amber-400 shrink-0" />
                                        <span>{soldierEpisodes.map(e => e.lossType.split(' ')[0]).join(' ➔ ')}</span>
                                    </span>
                                )}
                            </div>
                            <div className="text-sm font-bold text-white group-hover:text-amber-300 tracking-tight leading-tight truncate transition-colors" title={sName}>
                                {sName}
                            </div>
                        </div>

                        {/* Таймер очікування */}
                        <div className={`text-[11px] font-bold font-mono px-2 py-1 rounded-xl border shadow-inner flex items-center gap-1 shrink-0 ${timerBadgeColor}`}>
                            <Icon name="clock" className="w-3 h-3 text-amber-400 shrink-0" />
                            <span>{waitStr}</span>
                        </div>
                    </div>

                    {/* Модульні плашки: Локація, Травми, Док */}
                    <div className="pl-2 space-y-1.5">
                        <div className="flex items-center gap-1.5 flex-wrap">
                            <div className="flex items-center gap-1.5 bg-slate-950/80 border border-slate-800 px-2 py-0.5 rounded-lg text-xs text-slate-300 shadow-inner">
                                <Icon name="map-pin" className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                                <span className="text-slate-400 font-semibold uppercase text-[10px] tracking-wider">Факт:</span>
                                <span className="text-amber-200 font-medium truncate max-w-[130px]" title={ep.actualLoc}>{ep.actualLoc || "-"}</span>
                            </div>
                            {ep.docLoc && (
                                <div className="flex items-center gap-1.5 bg-slate-950/80 border border-slate-800 px-2 py-0.5 rounded-lg text-xs text-slate-300 shadow-inner">
                                    <Icon name="file-text" className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                                    <span className="text-slate-400 font-semibold uppercase text-[10px] tracking-wider">Док:</span>
                                    <span className="text-slate-300 font-medium truncate max-w-[100px]" title={ep.docLoc}>{ep.docLoc}</span>
                                </div>
                            )}
                        </div>

                        {isAny300(ep.lossType) ? (
                            injStr && (
                                <div className="w-fit inline-flex items-center gap-1.5 bg-red-950/30 border border-red-900/50 px-2 py-0.5 rounded-lg text-xs text-red-300 shadow-inner">
                                    <Icon name="activity" className="w-3 h-3 text-red-400 shrink-0" />
                                    <span className="font-bold text-red-400 text-[10px] uppercase tracking-wider shrink-0">Травми:</span>
                                    <span className="text-red-200 font-medium text-[11px] truncate max-w-[190px]" title={injStr}>{injStr}</span>
                                </div>
                            )
                        ) : (
                            <div className="w-fit inline-flex items-center gap-1.5 bg-zinc-950/80 border border-zinc-800 px-2 py-0.5 rounded-lg text-xs font-bold text-zinc-300 uppercase tracking-wide shadow-inner">
                                <Icon name="shield-alert" className="w-3 h-3 text-zinc-400 shrink-0" />
                                <span>{ep.lossType}</span>
                            </div>
                        )}

                        {ep.inUdp && (
                            <div className="pt-0.5">
                                <span className="text-[10px] bg-red-950/70 text-red-300 border border-red-800/70 px-2 py-0.5 rounded-md font-semibold tracking-wide inline-flex items-center gap-1">
                                    <Icon name="zap" className="w-2.5 h-2.5 text-red-400" /> Під час УПД
                                </span>
                            </div>
                        )}
                    </div>

                    {/* Нижня панель дій */}
                    <div className="pl-2 pt-1 border-t border-slate-800/70 flex items-center gap-1.5">
                        {ep.lossType === 'Зниклий безвісті (ЗБВ)' ? (
                            <button 
                                type="button"
                                onClick={(e) => { e.stopPropagation(); onAlertMIA(); }} 
                                className="flex-1 py-1.5 px-2.5 bg-slate-950 hover:bg-red-950/80 hover:border-red-700/80 text-slate-300 hover:text-red-200 text-xs font-semibold rounded-xl border border-slate-800 transition-all flex justify-center items-center gap-1.5 cursor-pointer shadow-sm active:scale-95"
                            >
                                <Icon name="alert-triangle" className="w-3.5 h-3.5 text-red-400" /> 
                                <span>Статус ЗБВ</span>
                            </button>
                        ) : (
                            <button 
                                type="button"
                                onClick={(e) => { e.stopPropagation(); onQuickEvac(ep); }} 
                                className="flex-1 py-1.5 px-2.5 bg-slate-950 hover:bg-emerald-600 hover:border-emerald-500 text-slate-300 hover:text-white text-xs font-semibold rounded-xl border border-slate-800 transition-all flex justify-center items-center gap-1.5 cursor-pointer shadow-sm active:scale-95 group/btn"
                            >
                                <Icon name="check-circle" className="w-3.5 h-3.5 text-emerald-400 group-hover/btn:text-white transition-colors" /> 
                                <span>Евакуйовано</span>
                            </button>
                        )}
                        
                        <button 
                            type="button" 
                            onClick={handleCopySummary}
                            className={`w-8 h-8 rounded-xl border flex items-center justify-center transition shadow-sm cursor-pointer shrink-0 ${
                                isCopied 
                                    ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-300' 
                                    : 'bg-slate-950 hover:bg-slate-800 border-slate-800 text-slate-400 hover:text-slate-200'
                            }`}
                            title={isCopied ? "Скопійовано в буфер!" : "Скопіювати звіт по бійцю"}
                        >
                            <Icon name={isCopied ? "check" : "copy"} className="w-3.5 h-3.5" />
                        </button>

                        <button 
                            type="button"
                            onClick={(e) => { e.stopPropagation(); onEdit(ep); }} 
                            className="w-8 h-8 rounded-xl bg-slate-950 hover:bg-amber-500/20 text-slate-400 hover:text-amber-400 border border-slate-800 hover:border-amber-500/50 flex items-center justify-center transition shadow-sm cursor-pointer shrink-0" 
                            title="Редагувати запис"
                        >
                            <Icon name="edit-3" className="w-3.5 h-3.5" />
                        </button>
                    </div>
                </div>
            );
        });

        function App() {
            const dictionaryOptions = useSharedDictionaries();
            const [isLoading, setIsLoading] = useState(true);
            const [soldiers, setSoldiers] = useState([]);
            const [episodes, setEpisodes] = useState([]);
            const [logs, setLogs] = useState([]);
            const logsRef = useRef([]);
            useEffect(() => { logsRef.current = logs; }, [logs]);
            const [settings, setSettings] = useState({
                ranks: DEFAULT_RANKS, units: DEFAULT_UNITS, sectors: DEFAULT_SECTORS, causes: DEFAULT_CAUSES
            });

            const soldiersMap = useMemo(() => {
                const map = new Map();
                soldiers.forEach(s => map.set(s.id, s));
                return map;
            }, [soldiers]);

            useEffect(() => {
                const loadData = async () => {
                    try {
                        let savedSoldiers = await localforage.getItem('med_soldiers_v3');
                        if (!savedSoldiers) {
                            const ls = localStorage.getItem('med_soldiers_v3') || localStorage.getItem('med_soldiers_v2');
                            savedSoldiers = ls ? JSON.parse(ls) : [];
                        }
                        
                        let savedEpisodes = await localforage.getItem('med_episodes_v3');
                        if (!savedEpisodes) {
                            const ls = localStorage.getItem('med_episodes_v3') || localStorage.getItem('med_episodes_v2');
                            savedEpisodes = ls ? JSON.parse(ls) : [];
                        }
                        
                        let savedLogs = await localforage.getItem('med_logs_v3');
                        if (!savedLogs) {
                            const ls = localStorage.getItem('med_logs_v3') || localStorage.getItem('med_logs_v2');
                            savedLogs = ls ? JSON.parse(ls) : [{ id: 'init', timestamp: new Date().toISOString(), action: 'Система', details: 'База створена' }];
                        }
                        
                        let savedSettings = await localforage.getItem('med_settings_v3');
                        if (!savedSettings) {
                            const ls = localStorage.getItem('med_settings_v3') || localStorage.getItem('med_settings_v2');
                            const oldParsed = ls ? JSON.parse(ls) : {};
                            savedSettings = {
                                ...oldParsed,
                                ranks: oldParsed.ranks || DEFAULT_RANKS, units: oldParsed.units || DEFAULT_UNITS,
                                sectors: oldParsed.sectors || DEFAULT_SECTORS, causes: oldParsed.causes || DEFAULT_CAUSES
                            };
                        }

                        let needsEpisodeMigration = false;
                        const cleanedEpisodes = (savedEpisodes || []).map(ep => {
                            if (ep.lossType === "Бойове травмування (300)") {
                                needsEpisodeMigration = true;
                                return { ...ep, lossType: "Поранення (300)" };
                            }
                            return ep;
                        });
                        if (needsEpisodeMigration) {
                            window.SuiteRuntime.setItem('med_episodes_v3', cleanedEpisodes).catch(() => {});
                        }

                        const allLoadedCauses = Array.from(new Set([
                            ...(savedSettings.causes || DEFAULT_CAUSES),
                            ...(cleanedEpisodes || []).map(ep => ep.cause).filter(Boolean)
                        ]));
                        savedSettings.causes = allLoadedCauses;

                        setSoldiers(savedSoldiers || []);
                        setEpisodes(cleanedEpisodes);
                        setLogs(savedLogs?.slice(0, 200) || []);
                        setSettings(savedSettings);
                        setFilterCauses(allLoadedCauses);
                        setIsLoading(false);

                        // Перевірка наявності локального бекапу на диску через службу диспетчера
                        try {
                            fetch('http://127.0.0.1:8765/api/backup/latest?app=med_tactical')
                                .then(res => res.json())
                                .then(data => {
                                    if (data) {
                                        setDiskServiceOnline(true);
                                        if (data.exists) {
                                            setDiskBackupInfo(data);
                                            // Якщо локальна база браузера порожня, пропонуємо миттєве відновлення
                                            if ((!savedSoldiers || savedSoldiers.length === 0) && (!cleanedEpisodes || cleanedEpisodes.length === 0)) {
                                                setShowAutoRestoreModal(true);
                                            }
                                        }
                                    }
                                })
                                .catch(() => setDiskServiceOnline(false));
                        } catch (_) {}
                    } catch (e) {
                        console.error("Помилка завантаження бази", e);
                        setIsLoading(false);
                    }
                };
                loadData();
            }, []);

            const [activeTab, setActiveTab] = useState("list");
            const [showOnlyLatest, setShowOnlyLatest] = useState(true);
            const [sortBy, setSortBy] = useState("date_desc"); // 'date_desc', 'date_asc', 'evac_desc', 'evac_asc', 'name_asc', 'name_desc', 'severity_desc'

            const [filterLossTypes, setFilterLossTypes] = useState([...LOSS_TYPES]);
            const [filterSeverities, setFilterSeverities] = useState(["Легкий", "Середній", "Важкий", "Критичний"]);
            const [filterEvacStatuses, setFilterEvacStatuses] = useState(["Не евакуйований", "Евакуйований", "Не потребує евакуації", "В розшуку", "Повернувся"]);
            const [filterCauses, setFilterCauses] = useState(() => settings.causes);
            const [isListCopied, setIsListCopied] = useState(false);
            const [searchTerm, setSearchTerm] = useState("");
            const [displayLimit, setDisplayLimit] = useState(50);
            const [filterUdp, setFilterUdp] = useState("all");
            const [listDateFrom, setListDateFrom] = useState("");
            const [listDateTo, setListDateTo] = useState("");
            
            const [history, setHistory] = useState([]);

            const undoAction = useCallback(() => {
                setHistory(prev => {
                    if (prev.length === 0) {
                        setTimeout(() => triggerNotification("Немає дій для скасування", "error"), 0);
                        return prev;
                    }
                    const lastState = prev[prev.length - 1];
                    setTimeout(() => {
                        setSoldiers(lastState.soldiers);
                        setEpisodes(lastState.episodes);
                        // Позначаємо закресленими всі логи, що були додані після снапшоту
                        const topId = lastState.topLogId; // null = до будь-якого логу, undefined = стара запис
                        setLogs(currentLogs => {
                            if (topId === undefined) return currentLogs; // стара історія без topLogId
                            let passedAnchor = (topId === null); // null = всі логи після снапшоту
                            return currentLogs.map(log => {
                                if (!passedAnchor) {
                                    // логи що йдуть до topId (новішіці, бо logs в зворотному порядку) — це і є скасовані
                                    if (log.id === topId) { passedAnchor = true; return log; }
                                    return { ...log, undone: true };
                                }
                                return log;
                            });
                        });
                        triggerNotification("Останню дію скасовано (Ctrl+Z)", "success");
                    }, 0);
                    return prev.slice(0, -1);
                });
            }, []);

            const saveHistory = () => {
                // Читаємо topLogId через ref — без вкладених setState
                const topLogId = logsRef.current.length > 0 ? logsRef.current[0].id : null;
                setHistory(prev => {
                    const newHist = [...prev, { 
                        soldiers: JSON.parse(JSON.stringify(soldiers)), 
                        episodes: JSON.parse(JSON.stringify(episodes)),
                        topLogId
                    }];
                    return newHist.slice(-15);
                });
            };

            const [anShowLatest, setAnShowLatest] = useState(true);
            const [anDateFrom, setAnDateFrom] = useState("");
            const [anDateTo, setAnDateTo] = useState("");
            const [anUdp, setAnUdp] = useState("all");
            const [anSector, setAnSector] = useState("all");
            const updateMedicalChartView = (chart, view) => setSettings(previous => ({
                ...previous, medicalChartViews: { ...previous.medicalChartViews, [chart]: view }
            }));
            
            const [logTimeFrom, setLogTimeFrom] = useState("");
            const [logTimeTo, setLogTimeTo] = useState("");
            const [isSidebarOpen, setIsSidebarOpen] = useState(true);
            const [viewMode, setViewMode] = useState(() => localStorage.getItem('med_view_mode') || 'grid');
            const [showMoreFilters, setShowMoreFilters] = useState(false);
            const [openDropdown, setOpenDropdown] = useState(null);

            const handleToggleViewMode = (mode) => {
                setViewMode(mode);
                window.SuiteRuntime.setLocalItem('med_view_mode', mode);
            };

            const [datePreset, setDatePreset] = useState('all'); // 'all', '1', '3', '7', 'custom'

            const applyDatePreset = (preset) => {
                setDatePreset(preset);
                if (preset === 'all') {
                    setListDateFrom("");
                    setListDateTo("");
                    return;
                }
                const now = new Date();
                const toStr = now.toLocaleDateString('en-CA');
                if (preset === '1') {
                    setListDateFrom(toStr);
                    setListDateTo(toStr);
                } else if (preset === '3') {
                    const fromDate = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);
                    setListDateFrom(fromDate.toLocaleDateString('en-CA'));
                    setListDateTo(toStr);
                } else if (preset === '7') {
                    const fromDate = new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000);
                    setListDateFrom(fromDate.toLocaleDateString('en-CA'));
                    setListDateTo(toStr);
                }
            };

            const [anDatePreset, setAnDatePreset] = useState('all'); // 'all', '1', '3', '7', 'custom'

            const applyAnDatePreset = (preset) => {
                setAnDatePreset(preset);
                if (preset === 'all') {
                    setAnDateFrom("");
                    setAnDateTo("");
                    return;
                }
                const now = new Date();
                const toStr = now.toLocaleDateString('en-CA');
                if (preset === '1') {
                    setAnDateFrom(toStr);
                    setAnDateTo(toStr);
                } else if (preset === '3') {
                    const fromDate = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);
                    setAnDateFrom(fromDate.toLocaleDateString('en-CA'));
                    setAnDateTo(toStr);
                } else if (preset === '7') {
                    const fromDate = new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000);
                    setAnDateFrom(fromDate.toLocaleDateString('en-CA'));
                    setAnDateTo(toStr);
                }
            };

            const [isSettingsOpen, setIsSettingsOpen] = useState(false);
            const [isBatchReplaceOpen, setIsBatchReplaceOpen] = useState(false);
            const [batchCategory, setBatchCategory] = useState("sectors"); // 'sectors' | 'units' | 'causes' | 'ranks'
            const [batchMode, setBatchMode] = useState("single"); // 'single' | 'multi'
            const [batchOldVal, setBatchOldVal] = useState("");
            const [batchNewVal, setBatchNewVal] = useState("");
            const [batchFields, setBatchFields] = useState({ actualLoc: true, docLoc: true, updateDict: true });
            const [batchMultiRows, setBatchMultiRows] = useState([{ id: 'row_1', oldVal: '', newVal: '' }]);
            const [batchMultiText, setBatchMultiText] = useState("");
            const [batchMultiInputType, setBatchMultiInputType] = useState("rows"); // 'rows' | 'text'

            const [isAddWoundedOpen, setIsAddWoundedOpen] = useState(false);
            const [isBackupOpen, setIsBackupOpen] = useState(false);
            const [isEditOpen, setIsEditOpen] = useState(false);
            const [isClearDbConfirmOpen, setIsClearDbConfirmOpen] = useState(false);
            const [isChangelogOpen, setIsChangelogOpen] = useState(false);
            const [currentEpisode, setCurrentEpisode] = useState(null);
            const [confirmDelete, setConfirmDelete] = useState(false);

            const [formSoldierType, setFormSoldierType] = useState("new");
            const [selectedSoldierId, setSelectedSoldierId] = useState("");
            const [soldierSearch, setSoldierSearch] = useState("");
            const [searchMatches, setSearchMatches] = useState([]);
            const [personnelDirectory, setPersonnelDirectory] = useState({ entries: [], warning: '' });
            const [rosterSelection, setRosterSelection] = useState(null);
            const [rosterCandidates, setRosterCandidates] = useState([]);
            const [forceNewPerson, setForceNewPerson] = useState(false);
            
            const [newSoldierName, setNewSoldierName] = useState("");
            const [newSoldierCallsign, setNewSoldierCallsign] = useState("");
            const [newSoldierRank, setNewSoldierRank] = useState("");
            const [newSoldierUnit, setNewSoldierUnit] = useState("");

            const [episodeDate, setEpisodeDate] = useState("");
            const [lossType, setLossType] = useState("");
            const [cause, setCause] = useState("");
            const [severity, setSeverity] = useState("");
            const [inUdp, setInUdp] = useState(false);
            const [actualLoc, setActualLoc] = useState("");
            const [docLoc, setDocLoc] = useState("");
            const [notes, setNotes] = useState("");
            const [injuries, setInjuries] = useState({});
            
            const [selectedRegion, setSelectedRegion] = useState("head");
            const [evacStatus, setEvacStatus] = useState("Не евакуйований");
            const [awolStatus, setAwolStatus] = useState("В розшуку");
            const [evacDate, setEvacDate] = useState("");
            
            const [hasReport, setHasReport] = useState(false);
            const [reportDate, setReportDate] = useState("");

            const [weaponStatus, setWeaponStatus] = useState("");
            const [fOpen, setFOpen] = useState({ dates: true, types: true, sev: true, evac: true, causes: true, udp: true, inj: false, wep: false, rep: false });

            const [filterInjuries, setFilterInjuries] = useState([]);
            const [filterWeapon, setFilterWeapon] = useState([]);
            const [filterReport, setFilterReport] = useState("all");

            const [dynFilters, setDynFilters] = useState({ 
                show200: true, showWound: true, showCombatTr: true, 
                showNonCombatTr: true, showMIA: true, showAWOL: true, showNonCombatDead: true 
            });
            const [showChartLabels, setShowChartLabels] = useState(false);
            const [showChartPercentages, setShowChartPercentages] = useState(false);

            const [backupPassword, setBackupPassword] = useState("");
            const [importFile, setImportFile] = useState(null);
            const [importPassword, setImportPassword] = useState("");
            const [diskServiceOnline, setDiskServiceOnline] = useState(false);
            const [diskBackupInfo, setDiskBackupInfo] = useState(null);
            const [lastDiskSaveTime, setLastDiskSaveTime] = useState("");
            const [sessionPassword, setSessionPassword] = useState("");
            const [showAutoRestoreModal, setShowAutoRestoreModal] = useState(false);
            const [diskRestorePassword, setDiskRestorePassword] = useState("");
            const [isSavingToDisk, setIsSavingToDisk] = useState(false);
            const [isRestoringFromDisk, setIsRestoringFromDisk] = useState(false);
            const [notification, setNotification] = useState(null);
            const [newSettingItem, setNewSettingItem] = useState("");
            const [activeSettingsTab, setActiveSettingsTab] = useState("causes");

            const SEVERITY_COLORS = {
                'Легкий': '#10b981',
                'Середній': '#f59e0b',
                'Важкий': '#ef4444',
                'Критичний': '#a855f7',
                'Дані відсутні': '#6b7280'
            };

            const triggerNotification = (text, type = "success") => {
                setNotification({ text, type });
                setTimeout(() => setNotification(null), 4000);
            };

            useEffect(() => { if (!isLoading && !window.SuiteRuntime.restoring) window.SuiteRuntime.setItem('med_soldiers_v3', soldiers); }, [soldiers, isLoading]);
            useEffect(() => {
                if (!isLoading && !window.SuiteRuntime.restoring) window.SuiteRuntime.setItem('med_episodes_v3', episodes)
                    .then(() => window.dispatchEvent(new Event('suite-medical-data-changed')))
                    .catch(error => { console.error('Помилка збереження медичних епізодів', error); triggerNotification('Не вдалося зберегти епізоди. Автоматичні підсумки не оновлено.', 'error'); });
            }, [episodes, isLoading]);
            useEffect(() => { if (!isLoading && !window.SuiteRuntime.restoring) window.SuiteRuntime.setItem('med_logs_v3', logs); }, [logs, isLoading]);
            useEffect(() => { if (!isLoading && !window.SuiteRuntime.restoring) window.SuiteRuntime.setItem('med_settings_v3', settings); }, [settings, isLoading]);

            // Періодичний моніторинг служби локального бекапу
            useEffect(() => {
                const checkService = () => {
                    fetch('http://127.0.0.1:8765/api/backup/latest?app=med_tactical')
                        .then(res => res.json())
                        .then(data => {
                            setDiskServiceOnline(true);
                            if (data && data.exists) setDiskBackupInfo(data);
                        })
                        .catch(() => setDiskServiceOnline(false));
                };
                checkService();
                const interval = setInterval(checkService, 30000);
                return () => clearInterval(interval);
            }, []);

            // Автоматичне фонове збереження бази на локальний диск (d:\ОЧ\Програми\_backups)
            useEffect(() => {
                if (isLoading) return;
                if (soldiers.length === 0 && episodes.length === 0) return;
                const pwd = sessionPassword || backupPassword;
                if (!pwd) return;

                const timer = setTimeout(async () => {
                    if (window.SuiteRuntime.restoring) return;
                    try {
                        const rawJson = JSON.stringify({ soldiers, episodes, logs, settings });
                        const encrypted = CryptoJS.AES.encrypt(rawJson, pwd).toString();
                        const res = await window.SuiteRuntime.runAsync(() => fetch('http://127.0.0.1:8765/api/backup/save', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                app: 'med_tactical',
                                content: encrypted
                            })
                        }));
                        if (res.ok) {
                            setDiskServiceOnline(true);
                            setLastDiskSaveTime(new Date().toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
                        }
                    } catch (_) {
                        setDiskServiceOnline(false);
                    }
                }, 3000);

                return () => clearTimeout(timer);
            }, [soldiers, episodes, logs, settings, sessionPassword, backupPassword, isLoading]);

            useEffect(() => {
                const handleKeyDown = (e) => {
                    if (document.querySelector('[data-suite-module="med"]')?.dataset.suiteActive !== 'true') return;
                    if (e.key === 'Escape') {
                        if (openDropdown) {
                            setOpenDropdown(null);
                            return;
                        }
                        if (isClearDbConfirmOpen) {
                            setIsClearDbConfirmOpen(false);
                            return;
                        }
                        if (isBackupOpen) {
                            setIsBackupOpen(false);
                            return;
                        }
                        if (isBatchReplaceOpen) {
                            setIsBatchReplaceOpen(false);
                            return;
                        }
                        if (isSettingsOpen) {
                            setIsSettingsOpen(false);
                            return;
                        }
                        if (isChangelogOpen) {
                            setIsChangelogOpen(false);
                            return;
                        }
                        if (isAddWoundedOpen || isEditOpen) {
                            setIsAddWoundedOpen(false);
                            setIsEditOpen(false);
                            return;
                        }
                    }
                    if (e.ctrlKey && (e.key === 'z' || e.key === 'Z' || e.key === 'я' || e.key === 'Я' || e.code === 'KeyZ')) {
                        if (document.activeElement && (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA')) return;
                        e.preventDefault();
                        undoAction();
                    }
                };
                window.addEventListener('keydown', handleKeyDown);
                return () => window.removeEventListener('keydown', handleKeyDown);
            }, [undoAction, openDropdown, isClearDbConfirmOpen, isBackupOpen, isBatchReplaceOpen, isSettingsOpen, isChangelogOpen, isAddWoundedOpen, isEditOpen]);

            const addLog = (action, details) => {
                setLogs(prev => [{
                    id: 'log_' + Date.now() + Math.random().toString(36).substring(7),
                    timestamp: new Date().toISOString(), action, details
                }, ...prev].slice(0, 200));
            };

            const timeFilteredEpisodes = useMemo(() => {
                return episodes.filter(ep => {
                    if (!listDateFrom && !listDateTo) return true;
                    const epTime = parseSafeDate(ep.date);
                    if (listDateFrom) {
                        const fromMs = parseSafeDate(listDateFrom.includes(':') ? listDateFrom : `${listDateFrom} 00:00:00`);
                        if (epTime < fromMs) return false;
                    }
                    if (listDateTo) {
                        const toMs = parseSafeDate(listDateTo.includes(':') ? listDateTo : `${listDateTo} 23:59:59`);
                        if (epTime > toMs) return false;
                    }
                    return true;
                });
            }, [episodes, listDateFrom, listDateTo]);

            const latestEpisodesData = useMemo(() => {
                const map = new Map();
                for (let i = 0; i < timeFilteredEpisodes.length; i++) {
                    const ep = timeFilteredEpisodes[i];
                    const existing = map.get(ep.soldierId);
                    if (!existing || parseSafeDate(ep.date) > parseSafeDate(existing.date)) {
                        map.set(ep.soldierId, ep);
                    }
                }
                return Array.from(map.values()).sort((a, b) => parseSafeDate(b.date) - parseSafeDate(a.date));
            }, [timeFilteredEpisodes]);

            const activeDataSource = showOnlyLatest ? latestEpisodesData : timeFilteredEpisodes;

            const roundTime = (timeStr) => {
                if(!timeStr) return "00:00";
                let [h, m] = timeStr.split(':').map(Number);
                if (m >= 30) h = (h + 1) % 24;
                return `${h.toString().padStart(2, '0')}:00`;
            };

            const globalLatestEpisodes = useMemo(() => {
                const map = new Map();
                for (let i = 0; i < episodes.length; i++) {
                    const ep = episodes[i];
                    const existing = map.get(ep.soldierId);
                    if (!existing || parseSafeDate(ep.date) > parseSafeDate(existing.date)) {
                        map.set(ep.soldierId, ep);
                    }
                }
                return Array.from(map.values()).sort((a, b) => parseSafeDate(b.date) - parseSafeDate(a.date));
            }, [episodes]);

            const episodesBySoldier = useMemo(() => {
                const map = new Map();
                episodes.forEach(ep => {
                    if (!map.has(ep.soldierId)) map.set(ep.soldierId, []);
                    map.get(ep.soldierId).push(ep);
                });
                map.forEach(list => list.sort((a, b) => parseSafeDate(a.date) - parseSafeDate(b.date)));
                return map;
            }, [episodes]);

            const stats = useMemo(() => {
                const totalEpisodes = timeFilteredEpisodes.length;
                const uniqueSoldiersCount = latestEpisodesData.length;
                
                // Актуальна черга евакуації розраховується з останнього актуального стану кожного бійця
                const activeEvacNeed300 = globalLatestEpisodes.filter(e => e.evacStatus === "Не евакуйований" && isAny300(e.lossType)).length;
                const activeEvacNeed200_MIA = globalLatestEpisodes.filter(e => e.evacStatus === "Не евакуйований" && (isAny200(e.lossType) || e.lossType === 'Зниклий безвісти (ЗБВ)')).length;
                
                const deadCount = latestEpisodesData.filter(e => isAny200(e.lossType)).length;
                const miaCount = latestEpisodesData.filter(e => e.lossType === 'Зниклий безвісти (ЗБВ)').length;
                const awolCount = latestEpisodesData.filter(e => isAwol(e.lossType) && e.awolStatus === 'В розшуку').length;
                
                return { totalEpisodes, uniqueSoldiersCount, activeEvacNeed300, activeEvacNeed200_MIA, deadCount, miaCount, awolCount };
            }, [timeFilteredEpisodes, latestEpisodesData, globalLatestEpisodes]);

            const evacStats = useMemo(() => {
                const fromMs = anDateFrom ? parseSafeDate(anDateFrom.includes(':') ? anDateFrom : `${anDateFrom} 00:00:00`) : 0;
                const toMs = anDateTo ? parseSafeDate(anDateTo.includes(':') ? anDateTo : `${anDateTo} 23:59:59`) : 0;
                
                let actualEvacTotal = 0, actualEvac300 = 0, actualEvac200 = 0;
                let evacPeriod300 = 0, evacPeriod200 = 0;
                let evacBefore300 = 0, evacBefore200 = 0;
                
                let totalPeriod300 = 0, totalPeriod200 = 0;
                let periodEvacuated300 = 0, periodEvacuated200 = 0;
                let periodWaiting300 = 0, periodWaiting200 = 0;
                
                let sumEvacTimeDays = 0, countEvacTime = 0;

                // 1. Облік фактичних евакуацій за період (по всіх епізодах)
                episodes.forEach(ep => {
                    const isLoss = isAny300(ep.lossType) || isAny200(ep.lossType) || ep.lossType === 'Зниклий безвісти (ЗБВ)';
                    if (!isLoss) return; 

                    let okUdp = anUdp === "all" ? true : (anUdp === "yes" ? ep.inUdp : !ep.inUdp);
                    if (!okUdp) return;

                    if (anSector !== "all") {
                        if (ep.actualLoc !== anSector && ep.docLoc !== anSector) return;
                    }

                    const effType = ep.lossType === 'Бойове травмування (300)' ? 'Поранення (300)' : ep.lossType;
                    const is300 = isAny300(effType);
                    const is200 = isAny200(effType);

                    const epTime = parseSafeDate(ep.date);
                    const isWoundInPeriod = (!fromMs || epTime >= fromMs) && (!toMs || epTime <= toMs);
                    
                    const isEvac = (ep.evacStatus === 'Евакуйований' || ep.awolStatus === 'Повернувся');
                    const epEvacMs = parseSafeDate(ep.evacTime || ep.evacDate || ep.date);

                    if (isEvac && epEvacMs > 0) {
                        const isEvacInPeriod = (!fromMs || epEvacMs >= fromMs) && (!toMs || epEvacMs <= toMs);
                        if (isEvacInPeriod) {
                            actualEvacTotal++;
                            if (is300) actualEvac300++;
                            if (is200) actualEvac200++;
                            
                            if (isWoundInPeriod) {
                                if (is300) evacPeriod300++;
                                if (is200) evacPeriod200++;
                            } else if (fromMs > 0 && epTime < fromMs) {
                                if (is300) evacBefore300++;
                                if (is200) evacBefore200++;
                            }

                            if (epTime > 0 && epEvacMs >= epTime) {
                                const msDiff = epEvacMs - epTime;
                                sumEvacTimeDays += msDiff / (1000 * 60 * 60 * 24);
                                countEvacTime++;
                            }
                        }
                    }

                    if (isWoundInPeriod) {
                        if (is300) {
                            totalPeriod300++;
                            if (isEvac) periodEvacuated300++;
                            else periodWaiting300++;
                        } else if (is200) {
                            totalPeriod200++;
                            if (isEvac) periodEvacuated200++;
                            else periodWaiting200++;
                        }
                    }
                });

                // 2. Актуальна черга неевакуйованих (синхронізована з верхнім табло)
                const globalWaiting300 = globalLatestEpisodes.filter(e => {
                    if (e.evacStatus !== "Не евакуйований" || !isAny300(e.lossType)) return false;
                    if (anUdp !== "all" && ((anUdp === "yes" && !e.inUdp) || (anUdp === "no" && e.inUdp))) return false;
                    if (anSector !== "all" && e.actualLoc !== anSector && e.docLoc !== anSector) return false;
                    return true;
                }).length;

                const globalWaitingCritHeavy = globalLatestEpisodes.filter(e => {
                    if (e.evacStatus !== "Не евакуйований" || !isAny300(e.lossType)) return false;
                    if (e.severity !== 'Критичний' && e.severity !== 'Важкий') return false;
                    if (anUdp !== "all" && ((anUdp === "yes" && !e.inUdp) || (anUdp === "no" && e.inUdp))) return false;
                    if (anSector !== "all" && e.actualLoc !== anSector && e.docLoc !== anSector) return false;
                    return true;
                }).length;

                const globalWaiting200 = globalLatestEpisodes.filter(e => {
                    const effType = e.lossType;
                    if (e.evacStatus !== "Не евакуйований" || !isAny200(effType)) return false;
                    if (anUdp !== "all" && ((anUdp === "yes" && !e.inUdp) || (anUdp === "no" && e.inUdp))) return false;
                    if (anSector !== "all" && e.actualLoc !== anSector && e.docLoc !== anSector) return false;
                    return true;
                }).length;

                const globalWaitingMia = globalLatestEpisodes.filter(e => {
                    if (e.evacStatus !== "Не евакуйований" || e.lossType !== 'Зниклий безвісти (ЗБВ)') return false;
                    if (anUdp !== "all" && ((anUdp === "yes" && !e.inUdp) || (anUdp === "no" && e.inUdp))) return false;
                    if (anSector !== "all" && e.actualLoc !== anSector && e.docLoc !== anSector) return false;
                    return true;
                }).length;

                let avgEvacTimeDays = countEvacTime > 0 ? (sumEvacTimeDays / countEvacTime).toFixed(1) : 0;
                let evacSuccessRate = totalPeriod300 + totalPeriod200 > 0 ? Math.round(((periodEvacuated300 + periodEvacuated200) / (totalPeriod300 + totalPeriod200)) * 100) : 0;

                return { 
                    actualEvacTotal, actualEvac300, actualEvac200,
                    evacPeriod300, evacPeriod200,
                    evacBefore300, evacBefore200,
                    totalPeriod300, periodEvacuated300, periodWaiting300,
                    totalPeriod200, periodEvacuated200, periodWaiting200,
                    globalWaiting300, globalWaiting200, globalWaitingMia, globalWaitingCritHeavy,
                    avgEvacTimeDays, evacSuccessRate
                };
            }, [episodes, globalLatestEpisodes, anDateFrom, anDateTo, anUdp, anSector, anShowLatest]);

            const availableAnSectors = useMemo(() => {
                const map = new Map();
                episodes.forEach(ep => {
                    if (ep.actualLoc && ep.actualLoc.trim()) {
                        map.set(ep.actualLoc, (map.get(ep.actualLoc) || 0) + 1);
                    }
                    if (ep.docLoc && ep.docLoc.trim() && ep.docLoc !== ep.actualLoc) {
                        map.set(ep.docLoc, (map.get(ep.docLoc) || 0) + 1);
                    }
                });
                (settings.sectors || []).forEach(s => {
                    if (s && !map.has(s)) map.set(s, 0);
                });
                return Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
            }, [episodes, settings.sectors]);

            const anFilteredEpisodes = useMemo(() => {
                let filtered = episodes.filter(ep => {
                    const epTime = parseSafeDate(ep.date);
                    if (anDateFrom) {
                        const fromMs = parseSafeDate(anDateFrom.includes(':') ? anDateFrom : `${anDateFrom} 00:00`);
                        if (epTime < fromMs) return false;
                    }
                    if (anDateTo) {
                        const toMs = parseSafeDate(anDateTo.includes(':') ? anDateTo : `${anDateTo} 23:59:59`);
                        if (epTime > toMs) return false;
                    }
                    if (anUdp !== "all") {
                        if (anUdp === "yes" && !ep.inUdp) return false;
                        if (anUdp === "no" && ep.inUdp) return false;
                    }
                    if (anSector !== "all") {
                        if (ep.actualLoc !== anSector && ep.docLoc !== anSector) return false;
                    }
                    return true;
                });
                if (anShowLatest) {
                    const map = new Map();
                    filtered.sort((a, b) => parseSafeDate(a.date) - parseSafeDate(b.date)).forEach(ep => map.set(ep.soldierId, ep));
                    filtered = Array.from(map.values()).sort((a, b) => parseSafeDate(b.date) - parseSafeDate(a.date));
                }
                return filtered;
            }, [episodes, anDateFrom, anDateTo, anUdp, anSector, anShowLatest]);

            const chartData = useMemo(() => {
                const anFiltered = anFilteredEpisodes;

                // Ініціалізація карти часу (24 години)
                const timeMap = {};
                for (let i = 0; i < 24; i++) {
                    const hr = i.toString().padStart(2, '0') + ":00";
                    timeMap[hr] = { '200': 0, 'Неб. смерть': 0, 'Поранення': 0, 'Бойове': 0, 'Небойове': 0, 'ЗБВ': 0, 'СЗЧ': 0, 'Дезертирство': 0 };
                }
                
                let c200 = 0, c200nc = 0, cWound = 0, cCombat = 0, cNonCombat = 0, cMia = 0, cAwol = 0, cDesert = 0;
                const dGroups = {};
                const rCounts = {};
                const uCounts = {};
                const sevCounts = {};
                const aLocCounts = {};
                const aLocSevCounts = {};
                const aLocCauseCounts = {}; 
                const activeCausesSet = new Set();
                
                const injuryStats = { 'Ампутація':0, 'Розрив':0, 'Уламкове':0, 'Кульове':0, 'Перелом':0, 'Опік':0, 'АКБТ':0, 'Забій':0 };

                const evacDaysSum = { 'Критичний': 0, 'Важкий': 0, 'Середній': 0, 'Легкий': 0, '200 (Тіла)': 0 };
                const evacDaysCount = { 'Критичний': 0, 'Важкий': 0, 'Середній': 0, 'Легкий': 0, '200 (Тіла)': 0 };

                let evac200 = 0, evac300 = 0, notEvac200 = 0, notEvac300 = 0;

                anFiltered.forEach(d => {
                    const effType = d.lossType;

                    const isEp200 = isAny200(effType) || effType === 'Зниклий безвісти (ЗБВ)';
                    const isEp300 = isAny300(effType);
                    
                    if (d.evacStatus === 'Евакуйований') {
                        if (isEp200) evac200++;
                        if (isEp300) evac300++;
                    } else if (d.evacStatus === 'Не евакуйований') {
                        if (isEp200) notEvac200++;
                        if (isEp300) notEvac300++;
                    }

                    const epTime = d.date ? (d.date.includes('T') ? d.date.split('T')[1] : d.date.split(' ')[1] || "00:00") : "00:00"; 
                    const roundedHhMm = roundTime(epTime.substring(0, 5));
                    
                    let day = "";
                    if (d.date) {
                        if (d.date.includes('T')) {
                            day = d.date.split('T')[0];
                        } else if (d.date.includes('.')) {
                            const parts = d.date.split(' ')[0].split('.');
                            if (parts.length === 3) day = `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
                        } else {
                            day = d.date.split(' ')[0];
                        }
                    }
                    if (!day) day = new Date().toLocaleDateString('en-CA');
                    if (!dGroups[day]) dGroups[day] = { '200': 0, 'Неб. смерть': 0, 'Поранення': 0, 'Бойове': 0, 'Небойове': 0, 'ЗБВ': 0, 'СЗЧ': 0, 'Дезертирство': 0 };

                    let typeKey = '';
                    if (effType === 'Загибель (200)') { typeKey = '200'; c200++; }
                    else if (effType === 'Небойова смерть (200)') { typeKey = 'Неб. смерть'; c200nc++; }
                    else if (effType === 'Поранення (300)') { typeKey = 'Поранення'; cWound++; }
                    else if (effType === 'Бойове травмування (300)') { typeKey = 'Бойове'; cCombat++; }
                    else if (effType === 'Небойове травмування (300)') { typeKey = 'Небойове'; cNonCombat++; }
                    else if (effType === 'Зниклий безвісти (ЗБВ)') { typeKey = 'ЗБВ'; cMia++; }
                    else if (effType === 'СЗЧ') { typeKey = 'СЗЧ'; cAwol++; }
                    else if (effType === 'Дезертирство') { typeKey = 'Дезертирство'; cDesert++; }

                    if (typeKey) {
                        if (timeMap[roundedHhMm]) timeMap[roundedHhMm][typeKey]++;
                        dGroups[day][typeKey]++;
                    }

                    const soldier = MedicalPersonnelDirectory.forEpisode(d, soldiers.find(s => s.id === d.soldierId));
                    const unit = d.unit || (soldier && soldier.unit ? soldier.unit : 'Невідомо');
                    const causeStr = d.cause || 'Не вказано';
                    if (d.cause) activeCausesSet.add(d.cause);
                    
                    if (!uCounts[unit]) uCounts[unit] = { '200':0, 'Неб. смерть':0, 'Поранення':0, 'Бойове':0, 'Небойове':0, 'ЗБВ':0, 'СЗЧ':0, 'Дезертирство':0 };
                    if (typeKey) uCounts[unit][typeKey]++;

                    if (!rCounts[causeStr]) rCounts[causeStr] = { '200':0, 'Неб. смерть':0, 'Поранення':0, 'Бойове':0, 'Небойове':0, 'ЗБВ':0, 'СЗЧ':0, 'Дезертирство':0 };
                    if (typeKey) rCounts[causeStr][typeKey]++;

                    if (isAny300(d.lossType) && d.severity) sevCounts[d.severity] = (sevCounts[d.severity] || 0) + 1;
                    
                    const loc = d.actualLoc || 'Не вказано';
                    
                    if (!aLocCounts[loc]) aLocCounts[loc] = { '200':0, 'Неб. смерть':0, 'Поранення':0, 'Бойове':0, 'Небойове':0, 'ЗБВ':0, 'СЗЧ':0, 'Дезертирство':0 };
                    if (typeKey) aLocCounts[loc][typeKey]++;

                    if (isAny300(d.lossType) && d.severity) {
                        if (!aLocSevCounts[loc]) aLocSevCounts[loc] = { 'Легкий':0, 'Середній':0, 'Важкий':0, 'Критичний':0 };
                        aLocSevCounts[loc][d.severity]++;
                    }

                    if (!aLocCauseCounts[loc]) aLocCauseCounts[loc] = {};
                    if (!aLocCauseCounts[loc][causeStr]) aLocCauseCounts[loc][causeStr] = 0;
                    aLocCauseCounts[loc][causeStr]++;

                    if (d.injuries) {
                        let epInjs = { 'Ампутація':false, 'Розрив':false, 'Уламкове':false, 'Кульове':false, 'Перелом':false, 'Опік':false, 'АКБТ':false, 'Забій':false };
                        Object.values(d.injuries).forEach(reg => {
                            if(reg.amputation) epInjs['Ампутація'] = true;
                            if(reg.rupture) epInjs['Розрив'] = true;
                            if(reg.shrapnel) epInjs['Уламкове'] = true;
                            if(reg.bullet) epInjs['Кульове'] = true;
                            if(reg.fracture) epInjs['Перелом'] = true;
                            if(reg.burn) epInjs['Опік'] = true;
                            if(reg.akbt) epInjs['АКБТ'] = true;
                            if(reg.contusion) epInjs['Забій'] = true;
                        });
                        Object.keys(epInjs).forEach(k => { if(epInjs[k]) injuryStats[k]++; });
                    }

                    const epEvacStr = d.evacTime || d.evacDate || '';
                    if (d.evacStatus === "Евакуйований" && epEvacStr) {
                        const epMs = parseSafeDate(d.date);
                        const evMs = parseSafeDate(epEvacStr);
                        if (epMs > 0 && evMs > 0 && evMs >= epMs) {
                            let diffDays = Math.round(((evMs - epMs) / (1000 * 60 * 60 * 24)) * 10) / 10;
                            if (diffDays >= 0 && diffDays < 3650) {
                                if (isAny200(d.lossType)) {
                                    evacDaysSum['200 (Тіла)'] += diffDays;
                                    evacDaysCount['200 (Тіла)']++;
                                } else if (isAny300(d.lossType) && d.lossType !== 'Небойове травмування (300)') {
                                    if (d.severity && evacDaysSum[d.severity] !== undefined) {
                                        evacDaysSum[d.severity] += diffDays;
                                        evacDaysCount[d.severity]++;
                                    }
                                }
                            }
                        }
                    }
                });

                const activeDates = Object.keys(dGroups).sort();
                if (activeDates.length > 0) {
                    // Визначаємо початок і кінець в мілісекундах (в UTC для уникнення зсувів часового поясу)
                    const startMs = new Date(activeDates[0] + "T00:00:00Z").getTime();
                    const endMs = new Date(activeDates[activeDates.length - 1] + "T00:00:00Z").getTime();
                    
                    // Крокуємо по 24 години (86400000 мс)
                    for (let t = startMs; t <= endMs; t += 86400000) {
                        const dateStr = new Date(t).toISOString().split('T')[0];
                        // Якщо дати немає в масиві, створюємо її з нульовими показниками
                        if (!dGroups[dateStr]) {
                            dGroups[dateStr] = { '200': 0, 'Неб. смерть': 0, 'Поранення': 0, 'Бойове': 0, 'Небойове': 0, 'ЗБВ': 0, 'СЗЧ': 0, 'Дезертирство': 0 };
                        }
                    }
                }

                const sortByTotal = (obj) => {
                    return Object.keys(obj).sort((a, b) => {
                        const sumA = Object.values(obj[a]).reduce((acc, val) => acc + val, 0);
                        const sumB = Object.values(obj[b]).reduce((acc, val) => acc + val, 0);
                        return sumB - sumA;
                    });
                };

                const evacLabels = ['Критичний', 'Важкий', 'Середній', 'Легкий', '200 (Тіла)'];
                const evacChartDataConfig = {
                    labels: evacLabels,
                    datasets: [{
                        label: 'Середній час (днів)',
                        data: evacLabels.map(l => evacDaysCount[l] > 0 ? (evacDaysSum[l] / evacDaysCount[l]).toFixed(1) : 0),
                        backgroundColor: ['#a855f7', '#ef4444', '#f59e0b', '#10b981', '#71717a'],
                        borderRadius: 4
                    }]
                };

                const evacStatusData = {
                    labels: ['Евакуйовані', 'В черзі (Не евак.)'],
                    datasets: [
                        { label: '200 / ЗБВ', data: [evac200, notEvac200], backgroundColor: '#71717a' },
                        { label: '300 (Всі)', data: [evac300, notEvac300], backgroundColor: '#ef4444' }
                    ]
                };

                const sortedLocs = sortByTotal(aLocCounts);
                const activeCauses = Array.from(activeCausesSet);
                
                const causeColors = {};
                settings.causes.forEach((c, i) => { causeColors[c] = CHART_COLORS[i % CHART_COLORS.length]; });
                let extraIdx = settings.causes.length;
                activeCauses.forEach(c => {
                    if (!causeColors[c]) { causeColors[c] = CHART_COLORS[extraIdx % CHART_COLORS.length]; extraIdx++; }
                });

                const locCauseDatasets = activeCauses.map((cause) => ({
                    label: cause,
                    data: sortedLocs.map(l => aLocCauseCounts[l][cause] || 0),
                    backgroundColor: causeColors[cause]
                }));

                const sortedReasons = sortByTotal(rCounts);

                return {
                    totalEpisodes: anFiltered.length,
                    time: { labels: Object.keys(timeMap).sort(), timeMap },
                    types: { c200, c200nc, cWound, cCombat, cNonCombat, cMia, cAwol, cDesert },
                    dynamics: { dates: Object.keys(dGroups).sort(), dGroups },
                    units: { labels: sortByTotal(uCounts), data: uCounts },
                    reasons: { labels: sortedReasons, data: rCounts },
                    severity: Object.keys(sevCounts).length ? sevCounts : { 'Дані відсутні': 1 },
                    actLocs: { labels: sortedLocs, data: aLocCounts },
                    actLocsSev: { labels: sortByTotal(aLocSevCounts), data: aLocSevCounts },
                    locCause: { labels: sortedLocs, datasets: locCauseDatasets },
                    injuryStats,
                    evacChartDataConfig,
                    evacStatusData,
                    causeColors
                };
            }, [anFilteredEpisodes, soldiers]);

            const soldierHistory = useMemo(() => {
                if (!selectedSoldierId) return [];
                return episodes
                    .filter(ep => ep.soldierId === selectedSoldierId && (!currentEpisode || ep.id !== currentEpisode.id))
                    .sort((a, b) => parseSafeDate(b.date) - parseSafeDate(a.date));
            }, [selectedSoldierId, currentEpisode, episodes]);

            
            const handleCopyFilteredList = () => {
                if (filteredList.length === 0) return;
                const lines = filteredList.map((ep, idx) => {
                    const sol = MedicalPersonnelDirectory.forEpisode(ep, soldiersMap.get(ep.soldierId));
                    const waitStr = calculateWaitTimeUI(ep.date);
                    const epWithWait = { ...ep, waitStr: waitStr !== 'Невідомо' ? waitStr : '' };
                    return formatSoldierReportLine(epWithWait, sol, idx + 1);
                });
                const fullText = lines.join('\n');
                
                const onDone = () => {
                    setIsListCopied(true);
                    setTimeout(() => setIsListCopied(false), 2500);
                    triggerNotification(`Скопійовано ${filteredList.length} записів для доповіді!`, "success");
                };

                const copyFallbackList = (str) => {
                    const ta = document.createElement('textarea');
                    ta.value = str;
                    document.body.appendChild(ta);
                    ta.select();
                    document.execCommand('copy');
                    document.body.removeChild(ta);
                    onDone();
                };

                if (navigator?.clipboard?.writeText) {
                    navigator.clipboard.writeText(fullText).then(onDone).catch(() => copyFallbackList(fullText));
                } else {
                    copyFallbackList(fullText);
                }
            };

            
            // --- DATA INTEGRITY GUARD ---
            const [integrityStatus, setIntegrityStatus] = useState({ checked: false, isHealthy: true, message: 'Не перевірялась', issueCount: 0, details: [] });
            const [hasSnapshot, setHasSnapshot] = useState(false);

            // Check if snapshot exists in localforage
            useEffect(() => {
                localforage.getItem('medtactical_auto_snapshot').then(snap => {
                    if (snap) setHasSnapshot(true);
                }).catch(() => {});
            }, []);

            // Create safety snapshot before major actions
            const createSafetySnapshot = async (actionNote = 'Автоматичний знімок') => {
                try {
                    const snap = {
                        timestamp: new Date().toISOString(),
                        actionNote,
                        episodes: [...episodes],
                        soldiers: [...soldiers],
                        settings: { ...settings }
                    };
                    await window.SuiteRuntime.setItem('medtactical_auto_snapshot', snap);
                    setHasSnapshot(true);
                } catch (e) {
                    console.error('Failed to create snapshot:', e);
                }
            };

            // Restore from snapshot
            const handleRestoreSnapshot = async () => {
                try {
                    const snap = await localforage.getItem('medtactical_auto_snapshot');
                    if (!snap || !snap.episodes || !snap.soldiers) {
                        triggerNotification('Аварійний знімок відсутній або пошкоджений', 'error');
                        return;
                    }
                    if (confirm(`Відновити базу зі знімка від ${formatEpisodeDateUI(snap.timestamp)} (${snap.actionNote})?\nПоточні дані будуть замінені.`)) {
                        setEpisodes(snap.episodes);
                        setSoldiers(snap.soldiers);
                        if (snap.settings) setSettings(snap.settings);
                        await window.SuiteRuntime.setItem('med_episodes_v3', snap.episodes);
                        await window.SuiteRuntime.setItem('med_soldiers_v3', snap.soldiers);
                        if (snap.settings) await window.SuiteRuntime.setItem('med_settings_v3', snap.settings);
                        addLog('RESTORE_SNAPSHOT', 'Відновлено базу з аварійного знімка: ' + snap.timestamp);
                        triggerNotification('Базу успішно відновлено з аварійного знімка!', 'success');
                    }
                } catch (e) {
                    triggerNotification('Помилка відновлення зі знімка', 'error');
                }
            };

            // Run Integrity Check & Repair
            const handleRunIntegrityDiagnosis = async (autoRepair = false) => {
                const issues = [];
                let fixedEpisodes = JSON.parse(JSON.stringify(episodes));
                let fixedSoldiers = JSON.parse(JSON.stringify(soldiers));
                const soldierIdMap = new Map(fixedSoldiers.map(s => [s.id, s]));
                
                let orphansCount = 0;
                let datesFixedCount = 0;
                let duplicateEpisodesCount = 0;

                // 1. Check for orphaned episodes
                fixedEpisodes.forEach(ep => {
                    if (!ep.soldierId || !soldierIdMap.has(ep.soldierId)) {
                        orphansCount++;
                        const sInfo = ep.soldierName || ep.callsign || 'Без імені';
                        const dInfo = ep.date ? ep.date.slice(0, 10) : 'без дати';
                        const tInfo = ep.lossType || 'тип не вказано';
                        issues.push({
                            id: ep.id,
                            episode: ep,
                            text: `Епізод #${(ep.id || '').slice(0, 6)} (${sInfo}, ${dInfo}, ${tInfo}): запис втрати не прив'язаний до реєстру бійців`
                        });
                        if (autoRepair) {
                            const newSid = ep.soldierId || ('soldier_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4));
                            const restoredSoldier = {
                                id: newSid,
                                name: ep.soldierName || 'Невідомий боєць',
                                callsign: ep.callsign || '',
                                rank: ep.rank || 'Солдат',
                                unit: ep.unit || 'Не вказано',
                                created_at: new Date().toISOString()
                            };
                            ep.soldierId = newSid;
                            fixedSoldiers.push(restoredSoldier);
                            soldierIdMap.set(newSid, restoredSoldier);
                        }
                    }
                });

                // 2. Check & normalize date formats and stray typos (e.g. 62026-08-25)
                fixedEpisodes.forEach(ep => {
                    if (ep.date) {
                        const rawDateStr = String(ep.date);
                        if (/^[0-9]*(20\d{2}[-\.\/]\d{2}[-\.\/]\d{2})/.test(rawDateStr) && !/^\d{4}-\d{2}-\d{2}/.test(rawDateStr)) {
                            const cleaned = rawDateStr.replace(/^[0-9]*(20\d{2}[-\.\/]\d{2}[-\.\/]\d{2})/, '$1');
                            datesFixedCount++;
                            issues.push({
                                id: ep.id,
                                episode: ep,
                                text: `Епізод #${(ep.id || '').slice(0, 6)}: одруківка в даті події "${ep.date}" -> виправлено на "${cleaned}"`
                            });
                            if (autoRepair) ep.date = cleaned;
                        }
                    }
                    if (ep.evacTime) {
                        const rawEvacStr = String(ep.evacTime);
                        if (/^[0-9]*(20\d{2}[-\.\/]\d{2}[-\.\/]\d{2})/.test(rawEvacStr) && !/^\d{4}-\d{2}-\d{2}/.test(rawEvacStr)) {
                            const cleaned = rawEvacStr.replace(/^[0-9]*(20\d{2}[-\.\/]\d{2}[-\.\/]\d{2})/, '$1');
                            datesFixedCount++;
                            issues.push({
                                id: ep.id,
                                episode: ep,
                                text: `Епізод #${(ep.id || '').slice(0, 6)}: одруківка в даті евакуації "${ep.evacTime}" -> виправлено на "${cleaned}"`
                            });
                            if (autoRepair) ep.evacTime = cleaned;
                        }
                    }
                });

                // 3. Check & normalize soldier callsigns formatting (Quotes, Title Case)
                let callsignsStandardizedCount = 0;
                fixedSoldiers.forEach(s => {
                    if (s.callsign) {
                        const formatted = formatCallsignUI(s.callsign);
                        if (formatted !== s.callsign) {
                            callsignsStandardizedCount++;
                            issues.push({
                                id: s.id,
                                soldier: s,
                                text: `Позивний бійця ${s.name}: "${s.callsign}" -> стандартизовано до «${formatted}»`
                            });
                            if (autoRepair) s.callsign = formatted;
                        }
                    }
                });

                const isHealthy = issues.length === 0;
                const result = {
                    checked: true,
                    isHealthy,
                    issueCount: issues.length,
                    message: isHealthy ? 'Цілісність 100% — жодних помилок не виявлено' : `Виявлено зауважень: ${issues.length}`,
                    details: issues
                };

                setIntegrityStatus(result);

                if (autoRepair && issues.length > 0) {
                    await createSafetySnapshot('Знімок перед лікуванням бази');
                    setEpisodes(fixedEpisodes);
                    setSoldiers(fixedSoldiers);
                    await window.SuiteRuntime.setItem('med_episodes_v3', fixedEpisodes);
                    await window.SuiteRuntime.setItem('med_soldiers_v3', fixedSoldiers);
                    const logSummary = issues.map(i => typeof i === 'string' ? i : i.text).join('; ');
                    addLog('INTEGRITY_REPAIR', `Вилікувано базу: ${orphansCount} сиріт, ${datesFixedCount} дат, ${callsignsStandardizedCount} позивних. ${logSummary}`);
                    triggerNotification(`Базу поліковано! Виправлено ${issues.length} зауважень.`, 'success');
                    setIntegrityStatus({
                        checked: true,
                        isHealthy: true,
                        message: 'Цілісність 100% (базу щойно вилікувано)',
                        issueCount: 0,
                        details: []
                    });
                } else if (!autoRepair) {
                    if (isHealthy) {
                        triggerNotification('✅ База повністю здорова: 100% цілісності!', 'success');
                    } else {
                        triggerNotification(`⚠️ Знайдено ${issues.length} зауважень. Натисніть "Виправити автоматично".`, 'warning');
                    }
                }
            };

            const handleStandardizeAllCallsigns = async () => {
                let fixedCount = 0;
                const updatedSoldiers = soldiers.map(s => {
                    if (s.callsign) {
                        const std = formatCallsignUI(s.callsign);
                        if (std !== s.callsign) {
                            fixedCount++;
                            return { ...s, callsign: std };
                        }
                    }
                    return s;
                });

                if (fixedCount === 0) {
                    triggerNotification("Усі позивні в базі вже відповідають стандарту Title Case!", "success");
                    return;
                }

                await createSafetySnapshot("Знімок перед стандартизацією позивних");
                setSoldiers(updatedSoldiers);
                await window.SuiteRuntime.setItem('med_soldiers_v3', updatedSoldiers);
                addLog('STANDARDIZE_CALLSIGNS', `Стандартизовано ${fixedCount} позивних до Title Case («Сокіл», «Тайфун»)`);
                triggerNotification(`Успішно стандартизовано ${fixedCount} позивних!`, "success");
            };

            const handleOpenPrintableReport = () => {
                try {
                    const win = window.open('', '_blank');
                    if (!win) {
                        return triggerNotification("Будь ласка, дозвольте відкриття спливаючих вікон у браузері", "error");
                    }

                    const periodStr = (anDateFrom || anDateTo) 
                        ? `${anDateFrom || '...'} — ${anDateTo || '...'}` 
                        : 'За весь період ведення бойових дій';
                    const sectorStr = anSector === 'all' ? 'Усі сектори / позиції' : anSector;
                    const nowStr = new Date().toLocaleString('uk-UA');

                    let count200 = 0, count300 = 0, countMIA = 0, countAWOL = 0;
                    let evac300 = 0, notEvac300 = 0;
                    let evac200 = 0, notEvac200 = 0;
                    const causeMap = {};
                    const unitMap = {};
                    const sevMap = { 'Легкий': 0, 'Середній': 0, 'Важкий': 0, 'Критичний': 0, 'Невідомо': 0 };

                    anFilteredEpisodes.forEach(ep => {
                        const isDead = isAny200(ep.lossType);
                        const isWounded = isAny300(ep.lossType);
                        const isMia = ep.lossType === 'Зниклий безвісти (ЗБВ)';
                        const isAw = isAwol(ep.lossType);
                        const isEvac = ep.evacStatus === 'Евакуйований';

                        if (isDead) {
                            count200++;
                            if (isEvac) evac200++;
                            else notEvac200++;
                        } else if (isWounded) {
                            count300++;
                            const s = ep.severity || 'Невідомо';
                            sevMap[s] = (sevMap[s] || 0) + 1;
                            if (isEvac) evac300++;
                            else notEvac300++;
                        } else if (isMia) {
                            countMIA++;
                        } else if (isAw) {
                            countAWOL++;
                        }

                        if (ep.cause) {
                            causeMap[ep.cause] = (causeMap[ep.cause] || 0) + 1;
                        }
                        const soldier = MedicalPersonnelDirectory.forEpisode(ep, soldiers.find(s => s.id === ep.soldierId));
                        const unit = soldier?.unit || ep.unit || 'Не вказано';
                        unitMap[unit] = (unitMap[unit] || 0) + 1;
                    });

                    const sortedCauses = Object.entries(causeMap).sort((a, b) => b[1] - a[1]);
                    const sortedUnits = Object.entries(unitMap).sort((a, b) => b[1] - a[1]);

                    const rowsHtml = anFilteredEpisodes.map((ep, idx) => {
                        const s = MedicalPersonnelDirectory.forEpisode(ep, soldiers.find(x => x.id === ep.soldierId)) || {};
                        const injuriesText = Object.entries(ep.injuries || {})
                            .filter(([_, types]) => Object.values(types).some(Boolean))
                            .map(([reg, types]) => {
                                const regName = { 
                                    head: 'Голова', 
                                    neck: 'Шия',
                                    chest: 'Груди', 
                                    abdomen: 'Живіт/Пах', 
                                    arm_l: 'Л.рука', 
                                    arm_r: 'П.рука', 
                                    leg_l: 'Л.нога', 
                                    leg_r: 'П.нога' 
                                }[reg] || (BODY_REGIONS.find(r => r.id === reg)?.name || reg);
                                const activeTypes = Object.entries(types).filter(([_, v]) => v).map(([t]) => {
                                    return { 
                                        shrapnel: 'Уламкове',
                                        bullet: 'Кульове',
                                        amputation: 'Ампутація',
                                        amp_hand: 'Ампутація кисті',
                                        amp_foot: 'Ампутація стопи',
                                        amp_fingers: 'Ампутація пальців',
                                        fracture: 'Перелом',
                                        rupture: 'Розрив',
                                        burn: 'Опік',
                                        crush: 'Краш-синдром',
                                        tbi: 'ЧМТ',
                                        eye: 'Травма ока',
                                        akbt: 'АКБТ',
                                        barotrauma: 'Баротравма',
                                        pneumothorax: 'Пневмоторакс',
                                        laceration: 'Рвана рана',
                                        contusion: 'Забій'
                                    }[t] || t;
                                }).join(', ');
                                return `${regName}: ${activeTypes}`;
                            }).join('; ') || '—';

                        const isDead = isAny200(ep.lossType);
                        const isWounded = isAny300(ep.lossType);
                        const isMia = ep.lossType === 'Зниклий безвісти (ЗБВ)';
                        const isAw = isAwol(ep.lossType);
                        const isNotEvac = ep.evacStatus === 'Не евакуйований';
                        const isEv = ep.evacStatus === 'Евакуйований' || ep.awolStatus === 'Повернувся';
                        const statusText = isAw ? (ep.awolStatus || 'В розшуку') : (ep.evacStatus || 'Не евакуйований');

                        let severityBadge = ep.severity ? `<b>${ep.severity}</b>` : '—';
                        if (ep.severity === 'Критичний') {
                            severityBadge = '<span style="color:#7e22ce; font-weight:800; background:#f3e8ff; padding:1px 5px; border-radius:4px; border:1px solid #d8b4fe;">Критичний</span>';
                        } else if (ep.severity === 'Важкий') {
                            severityBadge = '<span style="color:#b91c1c; font-weight:800; background:#fee2e2; padding:1px 5px; border-radius:4px; border:1px solid #fca5a5;">Важкий</span>';
                        } else if (ep.severity === 'Середній') {
                            severityBadge = '<span style="color:#b45309; font-weight:700; background:#fef3c7; padding:1px 5px; border-radius:4px; border:1px solid #fde68a;">Середній</span>';
                        } else if (ep.severity === 'Легкий') {
                            severityBadge = '<span style="color:#15803d; font-weight:600; background:#dcfce7; padding:1px 5px; border-radius:4px; border:1px solid #bbf7d0;">Легкий</span>';
                        }

                        let statusBadge = statusText;
                        if (isNotEvac) {
                            statusBadge = '<span style="background:#fee2e2; color:#991b1b; padding:2px 6px; border-radius:4px; font-weight:800; border:1px solid #f87171; display:inline-block; font-size:7.5pt;">🚨 Не евакуйований</span>';
                        } else if (isEv) {
                            statusBadge = '<span style="background:#dcfce7; color:#166534; padding:2px 6px; border-radius:4px; font-weight:700; border:1px solid #86efac; display:inline-block; font-size:7.5pt;">✓ Евакуйований</span>';
                        } else if (isAw) {
                            statusBadge = `<span style="background:#fae8ff; color:#86198f; padding:2px 6px; border-radius:4px; font-weight:700; border:1px solid #e879f9; display:inline-block; font-size:7.5pt;">${ep.awolStatus || 'СЗЧ'}</span>`;
                        }

                        const rowBg = isNotEvac ? 'style="background-color: #fff1f2;"' : '';
                        const evacVal = isNotEvac ? 'not_evac' : (isEv ? 'evac' : 'other');
                        const causeClean = (ep.cause || '—').replace(/"/g, '&quot;');
                        const unitClean = (s.unit || ep.unit || '—').replace(/"/g, '&quot;');

                        return `
                            <tr ${rowBg} class="reg-row" data-evac="${evacVal}" data-dead="${isDead ? '1':'0'}" data-wound="${isWounded ? '1':'0'}" data-sev="${ep.severity || ''}" data-mia="${isMia ? '1':'0'}" data-cause="${causeClean}" data-unit="${unitClean}">
                                <td class="row-num" style="text-align:center; font-family:'JetBrains Mono',monospace; font-size:8pt;">${idx + 1}</td>
                                <td style="font-family:'JetBrains Mono',monospace; font-size:8pt; white-space:nowrap;">${ep.date.replace('T', ' ')}</td>
                                <td style="font-size:8pt;">${s.rank || '—'}</td>
                                <td style="font-weight:bold; font-size:8.5pt;">${s.name || '—'}</td>
                                <td style="font-family:'JetBrains Mono',monospace; font-size:8pt; color:#b45309;">${s.callsign ? `«${formatCallsignUI(s.callsign)}»` : '—'}</td>
                                <td style="font-size:8pt;">${s.unit || ep.unit || '—'}</td>
                                <td style="font-weight:600; font-size:8pt;">${ep.lossType}</td>
                                <td style="font-size:8pt;">${severityBadge}</td>
                                <td style="font-size:7.5pt; color:#475569;">${injuriesText}</td>
                                <td style="font-size:8pt;">${ep.cause || '—'}</td>
                                <td style="font-size:8pt;">${ep.actualLoc || '—'}</td>
                                <td style="font-size:8pt;">${statusBadge}</td>
                            </tr>
                        `;
                    }).join('');

                    const html = `<!DOCTYPE html>
<html lang="uk">
<head>
    <meta charset="UTF-8">
    <title>Бойове донесення про втрати (${periodStr})</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;600;700&display=swap" rel="stylesheet">
    <style>
        * { box-sizing: border-box; }
        body {
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
            color: #0f172a;
            background: #f1f5f9;
            margin: 0;
            padding: 20px;
            font-size: 8.5pt;
            line-height: 1.35;
        }
        .action-bar {
            background: #0f172a;
            color: #ffffff;
            padding: 12px 18px;
            border-radius: 12px;
            max-width: 1200px;
            margin: 0 auto 18px auto;
            box-shadow: 0 10px 25px -5px rgba(0,0,0,0.3);
            border: 1px solid #1e293b;
        }
        .action-btn {
            background: #16a34a;
            color: #ffffff;
            border: none;
            padding: 7px 16px;
            border-radius: 7px;
            font-weight: 700;
            font-size: 9pt;
            cursor: pointer;
            display: inline-flex;
            align-items: center;
            gap: 6px;
            transition: all 0.15s;
        }
        .action-btn:hover { background: #15803d; }
        .action-btn.secondary { background: #334155; color: #f1f5f9; }
        .action-btn.secondary:hover { background: #475569; }

        .filter-chip {
            background: #1e293b;
            color: #94a3b8;
            border: 1px solid #334155;
            padding: 4px 10px;
            border-radius: 6px;
            font-size: 8pt;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.15s;
            display: inline-flex;
            align-items: center;
            gap: 4px;
        }
        .filter-chip:hover { background: #334155; color: #ffffff; }
        .filter-chip.active {
            background: #0284c7;
            border-color: #38bdf8;
            color: #ffffff;
            box-shadow: 0 0 10px rgba(56, 189, 248, 0.3);
        }
        .filter-chip.preset {
            background: #f59e0b18;
            border-color: #f59e0b55;
            color: #fbbf24;
        }
        .filter-chip.preset:hover {
            background: #f59e0b33;
            color: #fef08a;
        }

        .check-toggle {
            display: inline-flex;
            align-items: center;
            gap: 5px;
            font-size: 8pt;
            color: #cbd5e1;
            cursor: pointer;
            user-select: none;
        }
        .check-toggle input {
            cursor: pointer;
            accent-color: #38bdf8;
        }
        
        .page-container {
            max-width: 1200px;
            margin: 0 auto;
            background: #ffffff;
            padding: 24px 28px;
            box-shadow: 0 4px 20px rgba(0,0,0,0.08);
            border-radius: 8px;
        }
        .header-title {
            text-align: center;
            border-bottom: 2px solid #0f172a;
            padding-bottom: 8px;
            margin-bottom: 14px;
        }
        .header-title h1 {
            font-size: 13pt;
            font-weight: 800;
            letter-spacing: 0.5px;
            text-transform: uppercase;
            margin: 0 0 4px 0;
            color: #0f172a;
            line-height: 1.25;
        }
        .meta-info {
            display: flex;
            justify-content: space-between;
            font-size: 8pt;
            color: #475569;
            font-weight: 500;
        }
        
        .summary-grid {
            display: grid;
            grid-template-columns: repeat(4, 1fr);
            gap: 8px;
            margin-bottom: 14px;
        }
        .summary-card {
            border: 1px solid #cbd5e1;
            border-radius: 6px;
            padding: 8px 10px;
            background: #f8fafc;
        }
        .summary-card .label {
            font-size: 7.5pt;
            text-transform: uppercase;
            font-weight: 700;
            color: #64748b;
            margin-bottom: 2px;
        }
        .summary-card .value {
            font-size: 15pt;
            font-weight: 800;
            color: #0f172a;
            line-height: 1.1;
        }
        .summary-card .sub {
            font-size: 7.5pt;
            color: #64748b;
            margin-top: 2px;
        }

        .section-title {
            font-size: 8.5pt;
            font-weight: 800;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            color: #0f172a;
            border-left: 3px solid #0f172a;
            padding-left: 6px;
            margin: 12px 0 6px 0;
        }

        .two-cols {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 14px;
            margin-bottom: 14px;
        }

        table.data-table {
            width: 100%;
            border-collapse: collapse;
            font-size: 7.5pt;
            margin-bottom: 12px;
        }
        table.data-table th, table.data-table td {
            border: 1px solid #cbd5e1;
            padding: 4px 6px;
            text-align: left;
            vertical-align: middle;
        }
        table.data-table th {
            background-color: #f1f5f9;
            font-weight: 700;
            color: #1e293b;
            font-size: 7.5pt;
            text-transform: uppercase;
        }
        table.data-table tr:nth-child(even) {
            background-color: #f8fafc;
        }
        
        .footer-sign {
            margin-top: 32px;
            padding-top: 14px;
            display: flex;
            justify-content: space-between;
            font-size: 8.5pt;
            font-weight: 600;
        }

        @media print {
            body { background: #ffffff !important; padding: 0 !important; font-size: 8pt !important; }
            .page-container { box-shadow: none !important; padding: 0 !important; max-width: 100% !important; }
            .action-bar { display: none !important; }
            .summary-card { border: 1px solid #94a3b8 !important; }
            table.data-table th, table.data-table td { border: 1px solid #94a3b8 !important; }
            tr { page-break-inside: avoid; break-inside: avoid; }
            @page { size: A4 portrait; margin: 8mm 8mm 8mm 8mm; }
        }
    </style>
</head>
<body>
    <!-- ІНТЕРАКТИВНА ПАНЕЛЬ НАЛАШТУВАННЯ ТА ШВИДКИХ ФІЛЬТРІВ (НЕ ДРУКУЄТЬСЯ) -->
    <div class="action-bar">
        <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #334155; padding-bottom: 10px; margin-bottom: 10px; flex-wrap: wrap; gap: 10px;">
            <div style="display: flex; align-items: center; gap: 10px; flex-wrap: wrap;">
                <span style="font-weight: 800; font-size: 9.5pt; color: #38bdf8; text-transform: uppercase; letter-spacing: 0.5px;">🎛️ Конструктор доповіді:</span>
                
                <div style="display: flex; gap: 4px;">
                    <button class="filter-chip active" id="btn-evac-all" onclick="setEvac('all')">Всі статуси</button>
                    <button class="filter-chip" id="btn-evac-not" onclick="setEvac('not_evac')">🚨 Тільки не евакуйовані</button>
                    <button class="filter-chip" id="btn-evac-yes" onclick="setEvac('evac')">✓ Тільки евакуйовані</button>
                </div>

                <div style="display: flex; gap: 4px;">
                    <button class="filter-chip active" id="btn-type-all" onclick="setType('all')">Всі типи</button>
                    <button class="filter-chip" id="btn-type-200" onclick="setType('200')">💀 Тільки 200</button>
                    <button class="filter-chip" id="btn-type-300" onclick="setType('300')">🩸 Тільки 300</button>
                    <button class="filter-chip" id="btn-type-heavy" onclick="setType('300_heavy')">🟣 Важкі/Крит. 300</button>
                    <button class="filter-chip" id="btn-type-mia" onclick="setType('mia')">❓ ЗБВ</button>
                </div>
            </div>

            <div style="display: flex; gap: 8px;">
                <button class="action-btn" onclick="window.print()">🖨️ Друк / PDF</button>
                <button class="action-btn secondary" onclick="window.close()">✕ Закрити</button>
            </div>
        </div>

        <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px; font-size: 8pt;">
            <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
                <span style="color: #94a3b8; font-weight: 700;">Швидкі виписки:</span>
                <button class="filter-chip preset" id="btn-preset-200" onclick="applyPreset('200_waiting')">⚡ 200 на позиціях</button>
                <button class="filter-chip preset" id="btn-preset-heavy" onclick="applyPreset('300_heavy_waiting')">⚡ Важкі 300 на позиціях</button>
                <button class="filter-chip preset" id="btn-preset-all" onclick="applyPreset('all_waiting')">⚡ Вся черга евакуації</button>
                <button class="filter-chip preset" id="btn-preset-reset" onclick="applyPreset('reset')">↺ Скинути на повний звіт</button>
            </div>

            <div style="display: flex; align-items: center; gap: 12px; flex-wrap: wrap;">
                <span style="color: #94a3b8; font-weight: 700;">Блоки:</span>
                <label class="check-toggle"><input type="checkbox" id="chk-cards" checked onchange="toggleBlock('block-cards', this.checked)"> Зведені картки</label>
                <label class="check-toggle"><input type="checkbox" id="chk-queue" checked onchange="toggleBlock('block-queue', this.checked)"> Черга евакуації</label>
                <label class="check-toggle"><input type="checkbox" id="chk-causes" checked onchange="toggleBlock('block-causes', this.checked)"> Причини та підрозділи</label>
                <label class="check-toggle"><input type="checkbox" id="chk-register" checked onchange="toggleBlock('block-register', this.checked)"> Реєстр втрат</label>
                <label class="check-toggle"><input type="checkbox" id="chk-signs" checked onchange="toggleBlock('block-signs', this.checked)"> Підписи</label>
            </div>
        </div>
    </div>

        <div class="page-container" id="printable-doc">
            <div class="header-title" id="block-header">
                <h1 id="doc-main-title">БОЙОВЕ ДОНЕСЕННЯ / ЗВЕДЕННЯ ПРО ВТРАТИ</h1>
                <div class="meta-info">
                    <div>Період: <b id="doc-period">${periodStr}</b></div>
                    <div>Сектор / Позиція: <b>${sectorStr}</b></div>
                    <div>Сформовано: <b>${nowStr}</b></div>
                </div>
            </div>

            <!-- 1. Зведені картки -->
            <div id="block-cards" class="summary-grid">
                <div class="summary-card">
                    <div class="label">Загиблі (200)</div>
                    <div class="value" id="card-val-200" style="color: #334155;">${count200}</div>
                    <div class="sub">Безповоротні втрати</div>
                </div>
                <div class="summary-card" style="border-left: 3px solid #dc2626;">
                    <div class="label" style="color: #dc2626;">Поранені (300)</div>
                    <div class="value" id="card-val-300" style="color: #dc2626;">${count300}</div>
                    <div style="display:grid; grid-template-columns: 1fr 1fr; gap: 2px 6px; font-size:7.5pt; margin-top:4px; padding-top:3px; border-top:1px solid #e2e8f0;">
                        <div style="color:#7e22ce; font-weight:700;">Критичні: <span id="card-crit">${sevMap['Критичний'] || 0}</span></div>
                        <div style="color:#b91c1c; font-weight:700;">Важкі: <span id="card-heavy">${sevMap['Важкий'] || 0}</span></div>
                        <div style="color:#b45309; font-weight:600;">Середні: <span id="card-med">${sevMap['Середній'] || 0}</span></div>
                        <div style="color:#15803d; font-weight:600;">Легкі: <span id="card-light">${sevMap['Легкий'] || 0}</span></div>
                    </div>
                </div>
                <div class="summary-card">
                    <div class="label">Зниклі безвісти (ЗБВ)</div>
                    <div class="value" id="card-val-mia" style="color: #2563eb;">${countMIA}</div>
                    <div class="sub">Місцезнаходження невідоме</div>
                </div>
                <div class="summary-card" style="border-left: 3px solid #16a34a;">
                    <div class="label" style="color: #16a34a;">Евакуйовано (за період)</div>
                    <div class="value" style="color: #16a34a;">${evacStats.actualEvacTotal}</div>
                    <div style="display:flex; justify-content:space-between; font-weight:600; font-size:8pt; color:#334155; margin-top:4px; padding-top:3px; border-top:1px solid #e2e8f0;">
                        <span>300-х: <b>${evacStats.actualEvac300}</b></span>
                        <span>200-х: <b>${evacStats.actualEvac200}</b></span>
                    </div>
                </div>
            </div>

            <!-- 2. Окремий виділений блок: ЧЕРГА НА ЕВАКУАЦІЮ (НЕ ЕВАКУЙОВАНО) -->
            <div id="block-queue" style="background:#fff1f2; border: 1.5px solid #f87171; border-radius:8px; padding:10px 16px; margin-bottom:14px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px;">
                <div>
                    <div style="font-size:8.5pt; font-weight:800; text-transform:uppercase; color:#991b1b; display:flex; align-items:center; gap:6px; margin-bottom:5px;">
                        <span>🚨 ПОТРЕБУЮТЬ ЕВАКУАЦІЇ / ЧЕРГА НА ПОЗИЦІЯХ:</span>
                    </div>
                    <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
                        <span style="font-size:7.5pt; font-weight:700; color:#7f1d1d; text-transform:uppercase;">Втрати періоду в очікуванні:</span>
                        <span style="background:#ffffff; border:1px solid #fca5a5; color:#dc2626; font-weight:800; font-size:8pt; padding:1px 7px; border-radius:5px; display:inline-flex; align-items:center; gap:3px;">
                            <span>300-х:</span> <b style="font-size:9.5pt;" id="q-period-300">${notEvac300}</b>
                        </span>
                        <span style="background:#ffffff; border:1px solid #cbd5e1; color:#334155; font-weight:800; font-size:8pt; padding:1px 7px; border-radius:5px; display:inline-flex; align-items:center; gap:3px;">
                            <span>200-х:</span> <b style="font-size:9.5pt;" id="q-period-200">${notEvac200}</b>
                        </span>
                    </div>
                </div>
                <div style="display:flex; gap:14px; align-items:center;">
                    <div style="background:#ffffff; border:1px solid #fca5a5; border-radius:6px; padding:5px 12px; text-align:center; min-width: 140px;">
                        <div style="font-size:7.5pt; font-weight:700; color:#dc2626; text-transform:uppercase;">300-х всього очікують</div>
                        <div style="font-size:16pt; font-weight:800; color:#dc2626; line-height:1.1;">${evacStats.globalWaiting300}</div>
                        <div style="font-size:7.5pt; color:#7e22ce; font-weight:700;">${evacStats.globalWaitingCritHeavy} важких/критичних</div>
                    </div>
                    <div style="background:#ffffff; border:1px solid #cbd5e1; border-radius:6px; padding:5px 12px; text-align:center; min-width: 140px;">
                        <div style="font-size:7.5pt; font-weight:700; color:#475569; text-transform:uppercase;">200-х всього очікують</div>
                        <div style="font-size:16pt; font-weight:800; color:#334155; line-height:1.1;">${evacStats.globalWaiting200}</div>
                        <div style="font-size:7.5pt; color:#64748b;">тіл на позиціях</div>
                    </div>
                    ${countMIA > 0 ? `
                    <div style="background:#ffffff; border:1px solid #93c5fd; border-radius:6px; padding:5px 12px; text-align:center; min-width: 130px;">
                        <div style="font-size:7.5pt; font-weight:700; color:#2563eb; text-transform:uppercase;">Зниклі безвісти</div>
                        <div style="font-size:16pt; font-weight:800; color:#1d4ed8; line-height:1.1;">${countMIA}</div>
                        <div style="font-size:7.5pt; color:#64748b;">не встановлено</div>
                    </div>` : ''}
                </div>
            </div>

            <!-- 3. Причини та підрозділи -->
            <div id="block-causes" class="two-cols">
                <div>
                    <div class="section-title">Причини та зброя ураження</div>
                    <table class="data-table">
                        <thead>
                            <tr>
                                <th>Причина / Зброя</th>
                                <th style="text-align:right; width: 70px;">Кількість</th>
                            </tr>
                        </thead>
                        <tbody id="tbody-causes">
                            ${sortedCauses.length > 0 ? sortedCauses.map(([c, cnt]) => `
                                <tr>
                                    <td>${c}</td>
                                    <td style="text-align:right; font-weight:bold; font-family:'JetBrains Mono', monospace;">${cnt}</td>
                                </tr>
                            `).join('') : '<tr><td colspan="2" style="text-align:center; color:#94a3b8;">Дані відсутні</td></tr>'}
                        </tbody>
                    </table>
                </div>

                <div>
                    <div class="section-title">Розподіл за підрозділами</div>
                    <table class="data-table">
                        <thead>
                            <tr>
                                <th>Підрозділ</th>
                                <th style="text-align:right; width: 70px;">Кількість</th>
                            </tr>
                        </thead>
                        <tbody id="tbody-units">
                            ${sortedUnits.length > 0 ? sortedUnits.map(([u, cnt]) => `
                                <tr>
                                    <td>${u}</td>
                                    <td style="text-align:right; font-weight:bold; font-family:'JetBrains Mono', monospace;">${cnt}</td>
                                </tr>
                            `).join('') : '<tr><td colspan="2" style="text-align:center; color:#94a3b8;">Дані відсутні</td></tr>'}
                        </tbody>
                    </table>
                </div>
            </div>

            <!-- 4. Поіменний реєстр -->
            <div id="block-register">
                <div class="section-title" id="register-title">Поіменний реєстр втрат за період (${anFilteredEpisodes.length} записів)</div>
                <table class="data-table">
                    <thead>
                        <tr>
                            <th style="width: 25px; text-align:center;">№</th>
                            <th style="width: 95px;">Дата/Час</th>
                            <th style="width: 65px;">Звання</th>
                            <th>ПІБ</th>
                            <th style="width: 75px;">Позивний</th>
                            <th style="width: 75px;">Підрозділ</th>
                            <th style="width: 85px;">Тип</th>
                            <th style="width: 60px;">Важкість</th>
                            <th>Травми</th>
                            <th>Причина</th>
                            <th>Локація</th>
                            <th style="width: 80px;">Статус</th>
                        </tr>
                    </thead>
                    <tbody id="tbody-register">
                        ${rowsHtml || '<tr><td colspan="12" style="text-align:center; padding: 20px; color:#94a3b8;">За вибраний період та сектор записів немає</td></tr>'}
                    </tbody>
                </table>
            </div>

            <!-- 5. Підписи -->
            <div class="footer-sign" id="block-signs">
                <div>Начальник медичної служби: __________________</div>
                <div>Начальник штабу: __________________</div>
            </div>
        </div>
    </body>
    </html>`;

                    win.document.open();
                    win.document.write(html);
                    win.document.close();

                    // Безпосереднє підключення логіки до вікна у браузері
                    win.curEvac = 'all';
                    win.curType = 'all';

                    win.setEvac = function(val) {
                        win.curEvac = val;
                        var keys = ['all', 'not', 'yes'];
                        for (var i = 0; i < keys.length; i++) {
                            var b = win.document.getElementById('btn-evac-' + keys[i]);
                            if (b) b.classList.remove('active');
                        }
                        var map = { 'all': 'btn-evac-all', 'not_evac': 'btn-evac-not', 'evac': 'btn-evac-yes' };
                        var activeBtn = win.document.getElementById(map[val]);
                        if (activeBtn) activeBtn.classList.add('active');
                        win.applyFilters();
                    };

                    win.setType = function(val) {
                        win.curType = val;
                        var keys = ['all', '200', '300', 'heavy', 'mia'];
                        for (var i = 0; i < keys.length; i++) {
                            var b = win.document.getElementById('btn-type-' + keys[i]);
                            if (b) b.classList.remove('active');
                        }
                        var map = { 'all': 'btn-type-all', '200': 'btn-type-200', '300': 'btn-type-300', '300_heavy': 'btn-type-heavy', 'mia': 'btn-type-mia' };
                        var activeBtn = win.document.getElementById(map[val]);
                        if (activeBtn) activeBtn.classList.add('active');
                        win.applyFilters();
                    };

                    win.applyPreset = function(p) {
                        if (p === '200_waiting') { win.setEvac('not_evac'); win.setType('200'); }
                        else if (p === '300_heavy_waiting') { win.setEvac('not_evac'); win.setType('300_heavy'); }
                        else if (p === 'all_waiting') { win.setEvac('not_evac'); win.setType('all'); }
                        else if (p === 'reset') { win.setEvac('all'); win.setType('all'); }
                    };

                    win.toggleBlock = function(id, show) {
                        var el = win.document.getElementById(id);
                        if (el) el.style.display = show ? '' : 'none';
                    };

                    win.applyFilters = function() {
                        var doc = win.document;
                        var rows = doc.querySelectorAll('.reg-row');
                        var visibleCount = 0;
                        var c200 = 0, c300 = 0, cMia = 0;
                        var notEvac300 = 0, notEvac200 = 0;
                        var crit = 0, heavy = 0, med = 0, light = 0;
                        var causeCounts = {};
                        var unitCounts = {};

                        for (var i = 0; i < rows.length; i++) {
                            var r = rows[i];
                            var ev = r.getAttribute('data-evac');
                            var isDead = r.getAttribute('data-dead') === '1';
                            var isWound = r.getAttribute('data-wound') === '1';
                            var isMia = r.getAttribute('data-mia') === '1';
                            var sev = r.getAttribute('data-sev');
                            var cause = r.getAttribute('data-cause') || '—';
                            var unit = r.getAttribute('data-unit') || '—';

                            var matchEvac = (win.curEvac === 'all') || (win.curEvac === 'not_evac' && ev === 'not_evac') || (win.curEvac === 'evac' && ev === 'evac');
                            var matchType = (win.curType === 'all') || (win.curType === '200' && isDead) || (win.curType === '300' && isWound) || (win.curType === '300_heavy' && isWound && (sev === 'Критичний' || sev === 'Важкий')) || (win.curType === 'mia' && isMia);

                            if (matchEvac && matchType) {
                                r.style.display = '';
                                visibleCount++;
                                var numEl = r.querySelector('.row-num');
                                if (numEl) numEl.innerText = visibleCount;

                                if (isDead) {
                                    c200++;
                                    if (ev === 'not_evac') notEvac200++;
                                } else if (isWound) {
                                    c300++;
                                    if (sev === 'Критичний') crit++;
                                    else if (sev === 'Важкий') heavy++;
                                    else if (sev === 'Середній') med++;
                                    else if (sev === 'Легкий') light++;
                                    if (ev === 'not_evac') notEvac300++;
                                } else if (isMia) {
                                    cMia++;
                                }

                                if (cause && cause !== '—') causeCounts[cause] = (causeCounts[cause] || 0) + 1;
                                if (unit && unit !== '—') unitCounts[unit] = (unitCounts[unit] || 0) + 1;
                            } else {
                                r.style.display = 'none';
                            }
                        }

                        var titleEl = doc.getElementById('doc-main-title');
                        if (titleEl) {
                            if (win.curEvac === 'not_evac' && win.curType === '200') {
                                titleEl.innerText = 'ВІДОМІСТЬ НЕ ЕВАКУЙОВАНИХ ТІЛ ЗАГИБЛИХ (200)';
                            } else if (win.curEvac === 'not_evac' && win.curType === '300_heavy') {
                                titleEl.innerText = 'ВІДОМІСТЬ КРИТИЧНИХ ТА ВАЖКИХ ПОРАНЕНИХ (ПЕРШОЧЕРГОВА ЕВАКУАЦІЯ)';
                            } else if (win.curEvac === 'not_evac' && win.curType === '300') {
                                titleEl.innerText = 'ВІДОМІСТЬ НЕ ЕВАКУЙОВАНИХ ПОРАНЕНИХ (ЧЕРГА 300)';
                            } else if (win.curEvac === 'not_evac') {
                                titleEl.innerText = 'ЗВЕДЕННЯ ЧЕРГИ НА ЕВАКУАЦІЮ (НЕ ЕВАКУЙОВАНІ НА ПОЗИЦІЯХ)';
                            } else if (win.curType === '200') {
                                titleEl.innerText = 'ВІДОМІСТЬ БЕЗПОВОРОТНИХ ВТРАТ (200)';
                            } else if (win.curType === '300') {
                                titleEl.innerText = 'ВІДОМІСТЬ САНІТАРНИХ ВТРАТ (300)';
                            } else if (win.curType === 'mia') {
                                titleEl.innerText = 'ВІДОМІСТЬ ВІЙСЬКОВОСЛУЖБОВЦІВ, ЗНИКЛИХ БЕЗВІСТИ (ЗБВ)';
                            } else {
                                titleEl.innerText = 'БОЙОВЕ ДОНЕСЕННЯ / ЗВЕДЕННЯ ПРО ВТРАТИ';
                            }
                        }

                        var c200El = doc.getElementById('card-val-200'); if (c200El) c200El.innerText = c200;
                        var c300El = doc.getElementById('card-val-300'); if (c300El) c300El.innerText = c300;
                        var cMiaEl = doc.getElementById('card-val-mia'); if (cMiaEl) cMiaEl.innerText = cMia;
                        var critEl = doc.getElementById('card-crit'); if (critEl) critEl.innerText = crit;
                        var hvyEl = doc.getElementById('card-heavy'); if (hvyEl) hvyEl.innerText = heavy;
                        var medEl = doc.getElementById('card-med'); if (medEl) medEl.innerText = med;
                        var lgtEl = doc.getElementById('card-light'); if (lgtEl) lgtEl.innerText = light;
                        var q300 = doc.getElementById('q-period-300'); if (q300) q300.innerText = notEvac300;
                        var q200 = doc.getElementById('q-period-200'); if (q200) q200.innerText = notEvac200;
                        var regTitle = doc.getElementById('register-title'); if (regTitle) regTitle.innerText = 'Поіменний реєстр (' + visibleCount + ' записів)';

                        var causeEntries = Object.entries(causeCounts).sort(function(a, b) { return b[1] - a[1]; });
                        var causeHtml = causeEntries.length > 0
                            ? causeEntries.map(function(pair) { return '<tr><td>' + pair[0] + '</td><td style="text-align:right; font-weight:bold; font-family:\'JetBrains Mono\', monospace;">' + pair[1] + '</td></tr>'; }).join('')
                            : '<tr><td colspan="2" style="text-align:center; color:#94a3b8;">Дані відсутні</td></tr>';
                        var tbCauses = doc.getElementById('tbody-causes'); if (tbCauses) tbCauses.innerHTML = causeHtml;

                        var unitEntries = Object.entries(unitCounts).sort(function(a, b) { return b[1] - a[1]; });
                        var unitHtml = unitEntries.length > 0
                            ? unitEntries.map(function(pair) { return '<tr><td>' + pair[0] + '</td><td style="text-align:right; font-weight:bold; font-family:\'JetBrains Mono\', monospace;">' + pair[1] + '</td></tr>'; }).join('')
                            : '<tr><td colspan="2" style="text-align:center; color:#94a3b8;">Дані відсутні</td></tr>';
                        var tbUnits = doc.getElementById('tbody-units'); if (tbUnits) tbUnits.innerHTML = unitHtml;
                    };

                    // Пряме призначення обробників подій до DOM-елементів нового вікна
                    const bindClick = (id, fn) => {
                        const el = win.document.getElementById(id);
                        if (el) el.onclick = fn;
                    };

                    bindClick('btn-evac-all', () => win.setEvac('all'));
                    bindClick('btn-evac-not', () => win.setEvac('not_evac'));
                    bindClick('btn-evac-yes', () => win.setEvac('evac'));

                    bindClick('btn-type-all', () => win.setType('all'));
                    bindClick('btn-type-200', () => win.setType('200'));
                    bindClick('btn-type-300', () => win.setType('300'));
                    bindClick('btn-type-heavy', () => win.setType('300_heavy'));
                    bindClick('btn-type-mia', () => win.setType('mia'));

                    bindClick('btn-preset-200', () => win.applyPreset('200_waiting'));
                    bindClick('btn-preset-heavy', () => win.applyPreset('300_heavy_waiting'));
                    bindClick('btn-preset-all', () => win.applyPreset('all_waiting'));
                    bindClick('btn-preset-reset', () => win.applyPreset('reset'));

                    const bindChange = (id, blockId) => {
                        const el = win.document.getElementById(id);
                        if (el) el.onchange = (e) => win.toggleBlock(blockId, e.target.checked);
                    };
                    bindChange('chk-cards', 'block-cards');
                    bindChange('chk-queue', 'block-queue');
                    bindChange('chk-causes', 'block-causes');
                    bindChange('chk-register', 'block-register');
                    bindChange('chk-signs', 'block-signs');
                } catch (err) {
                    console.error("handleOpenPrintableReport error:", err);
                    triggerNotification("Помилка формування доповіді: " + err.message, "error");
                }
            };

            const handleExportAnalyticsText = () => {
                const fromMs = anDateFrom ? parseSafeDate(anDateFrom.includes(':') ? anDateFrom : `${anDateFrom} 00:00:00`) : 0;
                const toMs = anDateTo ? parseSafeDate(anDateTo.includes(':') ? anDateTo : `${anDateTo} 23:59:59`) : 0;

                const deadEps = [];
                const miaEps = [];
                const woundedEps = [];
                const periodWoundedEvacEps = [];
                const periodWoundedNotEvacEps = [];
                
                const deadCauses = {};
                let udpCount = 0;
                let broCount = 0;
                const sevCounts = { 'Легкий': 0, 'Середній': 0, 'Важкий': 0, 'Критичний': 0 };
                const injCounts = {};
                const woundCauses = {};
                let totalInjuriesCount = 0;
                let woundedWithInjCount = 0;
                
                const injDict = {
                    shrapnel: 'Уламкове',
                    bullet: 'Кульове',
                    amputation: 'Ампутація',
                    amp_hand: 'Ампутація кисті',
                    amp_foot: 'Ампутація стопи',
                    amp_fingers: 'Ампутація пальців',
                    fracture: 'Перелом',
                    rupture: 'Розрив',
                    burn: 'Опік',
                    crush: 'Краш-синдром',
                    tbi: 'ЧМТ',
                    eye: 'Травма ока',
                    akbt: 'АКБТ',
                    barotrauma: 'Баротравма',
                    pneumothorax: 'Пневмоторакс',
                    laceration: 'Рвана рана',
                    contusion: 'Забій'
                };
                
                anFilteredEpisodes.forEach(ep => {
                    const effType = ep.lossType;
                    
                    const isDead = isAny200(effType);
                    const isMia = effType === 'Зниклий безвісти (ЗБВ)';
                    const isWounded = isAny300(effType);
                    
                    if (isDead) {
                        deadEps.push(ep);
                        deadCauses[ep.cause || "Інше"] = (deadCauses[ep.cause || "Інше"] || 0) + 1;
                    } else if (isMia) {
                        miaEps.push(ep);
                    } else if (isWounded) {
                        woundedEps.push(ep);
                        if (ep.inUdp) udpCount++; else broCount++;
                        sevCounts[ep.severity || 'Легкий'] = (sevCounts[ep.severity || 'Легкий'] || 0) + 1;
                        woundCauses[ep.cause || "Інше"] = (woundCauses[ep.cause || "Інше"] || 0) + 1;
                        
                        if (ep.injuries) {
                            let epHasInj = false;
                            Object.values(ep.injuries).forEach(r => {
                                Object.entries(r).forEach(([k, v]) => {
                                    if (v && injDict[k]) {
                                        injCounts[injDict[k]] = (injCounts[injDict[k]] || 0) + 1;
                                        totalInjuriesCount++;
                                        epHasInj = true;
                                    }
                                });
                            });
                            if (epHasInj) woundedWithInjCount++;
                        }
                        
                        const epEvacMs = parseSafeDate(ep.evacTime || ep.evacDate || '');
                        let evacuatedInPeriod = false;
                        if (ep.evacStatus === 'Евакуйований' && epEvacMs > 0) {
                            let okFrom = !fromMs || epEvacMs >= fromMs;
                            let okTo = !toMs || epEvacMs <= toMs;
                            if (okFrom && okTo) evacuatedInPeriod = true;
                        }
                        
                        if (evacuatedInPeriod) periodWoundedEvacEps.push(ep);
                        else periodWoundedNotEvacEps.push(ep);
                    }
                });

                let allEps = episodes;
                if (anShowLatest) {
                    const map = new Map();
                    [...episodes].sort((a, b) => parseSafeDate(a.date) - parseSafeDate(b.date)).forEach(ep => map.set(ep.soldierId, ep));
                    allEps = Array.from(map.values());
                }

                const actualEvacWoundedEps = [];
                const actualEvacDeadEps = [];
                const globalNotEvacWoundedEps = [];
                const globalNotEvacDeadEps = [];
                const globalNotEvacMiaEps = [];

                allEps.forEach(ep => {
                    const epTime = parseSafeDate(ep.date);
                    if (toMs > 0 && epTime > toMs) return; // Ignore future episodes relative to this report period

                    if (anSector !== "all") {
                        if (ep.actualLoc !== anSector && ep.docLoc !== anSector) return;
                    }

                    const effType = ep.lossType === 'Бойове травмування (300)' ? 'Поранення (300)' : ep.lossType;
                    const isWounded = isAny300(effType);
                    const isDead = isAny200(effType);
                    const isMia = effType === 'Зниклий безвісти (ЗБВ)';

                    let okUdp = anUdp === "all" ? true : (anUdp === "yes" ? ep.inUdp : !ep.inUdp);
                    if (okUdp) {
                        const epEvacMs = parseSafeDate(ep.evacTime || ep.evacDate || '');
                        let isHistoricallyEvacuated = (ep.evacStatus === 'Евакуйований');
                        if (toMs > 0 && epEvacMs > 0 && epEvacMs > toMs) {
                            isHistoricallyEvacuated = false;
                        }

                        if (isHistoricallyEvacuated && epEvacMs > 0) {
                            let okFrom = !fromMs || epEvacMs >= fromMs;
                            let okTo = !toMs || epEvacMs <= toMs;
                            if (okFrom && okTo) {
                                if (isWounded) actualEvacWoundedEps.push(ep);
                                if (isDead) actualEvacDeadEps.push(ep);
                            }
                        }

                        let historicalEvacStatus = ep.evacStatus;
                        if (historicalEvacStatus === 'Евакуйований' && toMs > 0 && epEvacMs > 0 && epEvacMs > toMs) {
                            historicalEvacStatus = 'Не евакуйований';
                        }

                        if (historicalEvacStatus === 'Не евакуйований') {
                            if (isWounded) globalNotEvacWoundedEps.push(ep);
                            if (isDead) globalNotEvacDeadEps.push(ep);
                            if (isMia) globalNotEvacMiaEps.push(ep);
                        }
                    }
                });

                const getCallsigns = (eps) => {
                    if (!eps.length) return "";
                    const calls = eps.map(e => {
                        const s = MedicalPersonnelDirectory.forEpisode(e, soldiers.find(s => s.id === e.soldierId));
                        if (!s) return "";
                        return s.callsign ? `«${formatCallsignUI(s.callsign)}»` : (s.name || "Невідомо");
                    });
                    const uniqueCalls = [...new Set(calls)].filter(Boolean);
                    if (!uniqueCalls.length) return "";
                    return ` (позивні: ${uniqueCalls.join(', ')})`;
                };
                
                let report = `Наші втрати:\n`;
                report += `Безповоротні – ${deadEps.length} в/сл.${getCallsigns(deadEps)}`;
                if (deadEps.length > 0) {
                    report += `, з них:\n`;
                    Object.entries(deadCauses).forEach(([cause, count]) => {
                        report += `${count} в/сл. – ${cause};\n`;
                    });
                } else {
                    report += `\n`;
                }
                
                report += `\nЗниклі безвісти – ${miaEps.length}${getCallsigns(miaEps)}\n\n`;
                
                report += `Поранено – ${woundedEps.length}${getCallsigns(woundedEps)}`;
                if (woundedEps.length > 0) {
                    report += `, з них:\n`;
                    report += `    • На УПД – ${udpCount}; БРО – ${broCount};\n`;
                    let sevStr = [];
                    if (sevCounts['Легкий']) sevStr.push(`Легкі – ${sevCounts['Легкий']}`);
                    if (sevCounts['Середній']) sevStr.push(`Середні – ${sevCounts['Середній']}`);
                    if (sevCounts['Важкий']) sevStr.push(`Важкі – ${sevCounts['Важкий']}`);
                    if (sevCounts['Критичний']) sevStr.push(`Критичні – ${sevCounts['Критичний']}`);
                    report += `    • ${sevStr.join(', ')};\n`;
                    report += `    • Евакуйовано – ${periodWoundedEvacEps.length}${getCallsigns(periodWoundedEvacEps)}, не евакуйовано – ${periodWoundedNotEvacEps.length}${getCallsigns(periodWoundedNotEvacEps)};\n`;
                    
                    let sortedInj = Object.entries(injCounts).sort((a, b) => b[1] - a[1]);
                    if (sortedInj.length > 0) {
                        let injStr = sortedInj.map(([k, v]) => `${k} – ${v}`).join(', ');
                        let multiNote = totalInjuriesCount > woundedWithInjCount 
                            ? ` (всього ${totalInjuriesCount} уражень у ${woundedWithInjCount} в/сл, є поєднані/множинні травми)` 
                            : '';
                        report += `    • Характер уражень: ${injStr}${multiNote};\n`;
                    }
                    
                    let wcStr = Object.entries(woundCauses).map(([k, v]) => `${k} – ${v}`).join(', ');
                    if (wcStr) report += `    • ${wcStr}\n`;
                } else {
                     report += `\n`;
                }

                report += `\nПроведено евакуацію:\n`;
                const activeCritCount = globalNotEvacWoundedEps.filter(e => e.severity === 'Критичний' || e.severity === 'Важкий').length;
                report += `    • Поранених – ${actualEvacWoundedEps.length} в/сл, залишається неевакуйованих поранених – ${globalNotEvacWoundedEps.length} в/сл. (з них ${activeCritCount} в/сл. потребують першочергової евакуації)\n`;
                report += `    • Тіла – ${actualEvacDeadEps.length}${getCallsigns(actualEvacDeadEps)}, залишається неевакуйованих тіл – ${globalNotEvacDeadEps.length}${getCallsigns(globalNotEvacDeadEps)}.\n`;
                if (globalNotEvacMiaEps.length > 0) {
                    report += `    • Зниклі безвісти (місцезнаходження не встановлено) – ${globalNotEvacMiaEps.length}${getCallsigns(globalNotEvacMiaEps)}.\n`;
                }

                navigator.clipboard.writeText(report).then(() => {
                    triggerNotification("Текстовий звіт скопійовано в буфер обміну!", "success");
                }).catch(err => {
                    console.error(err);
                    triggerNotification("Не вдалося скопіювати звіт", "error");
                });
            };

            const handleExportAnalyticsExcel = async () => {
                if (typeof ExcelJS === 'undefined') {
                    triggerNotification("Бібліотека ExcelJS ще не завантажилась. Перевірте з'єднання з Інтернетом.", "error");
                    return;
                }
                const workbook = new ExcelJS.Workbook();
                workbook.creator = 'MedTactical';
                workbook.lastModifiedBy = 'System';
                workbook.created = new Date();
                
                const sheet1 = workbook.addWorksheet('Загальна статистика');
                sheet1.columns = [
                    { header: 'Всього епізодів', key: 'total', width: 20 },
                    { header: 'Бойові (200)', key: 'c200', width: 15 },
                    { header: 'Небойові (200)', key: 'c200nc', width: 15 },
                    { header: 'Поранення (300)', key: 'cWound', width: 20 },
                    { header: 'Бойові травми', key: 'cCombat', width: 15 },
                    { header: 'Небойові травми', key: 'cNonCombat', width: 20 },
                    { header: 'ЗБВ', key: 'cMia', width: 10 },
                    { header: 'СЗЧ', key: 'cAwol', width: 10 },
                    { header: 'Дезертирство', key: 'cDesert', width: 15 }
                ];
                sheet1.getRow(1).font = { bold: true };
                sheet1.addRow({
                    total: chartData.totalEpisodes, c200: chartData.types.c200, c200nc: chartData.types.c200nc,
                    cWound: chartData.types.cWound, cCombat: chartData.types.cCombat, cNonCombat: chartData.types.cNonCombat,
                    cMia: chartData.types.cMia, cAwol: chartData.types.cAwol, cDesert: chartData.types.cDesert
                });

                const sheet2 = workbook.addWorksheet('Дані для графіків');
                sheet2.columns = [
                    { header: 'Тип втрати', key: 'tL', width: 20 }, { header: 'К-сть', key: 'tC', width: 10 }, { header: '', key: 's1', width: 5 },
                    { header: 'Підрозділ', key: 'uL', width: 25 }, { header: 'К-сть', key: 'uC', width: 10 }, { header: '', key: 's2', width: 5 },
                    { header: 'Причина', key: 'cL', width: 25 }, { header: 'К-сть', key: 'cC', width: 10 }, { header: '', key: 's3', width: 5 },
                    { header: 'Час доби', key: 'timeL', width: 15 }, { header: 'К-сть', key: 'timeC', width: 10 }
                ];
                sheet2.getRow(1).font = { bold: true };

                const tL = ['Бойові (200)', 'Небойові (200)', 'Бойові (300)', 'Небойові (300)', 'Поранення', 'ЗБВ', 'СЗЧ', 'Дезертирство'];
                const tC = [chartData.types.c200, chartData.types.c200nc, chartData.types.cCombat, chartData.types.cNonCombat, chartData.types.cWound, chartData.types.cMia, chartData.types.cAwol, chartData.types.cDesert];
                const uL = chartData.units.labels || [];
                const cL = chartData.reasons.labels || [];
                const timeL = chartData.time.labels || [];

                const maxR = Math.max(tL.length, uL.length, cL.length, timeL.length);
                for (let i = 0; i < maxR; i++) {
                    const u = uL[i];
                    let uVal = '';
                    if (u && chartData.units.data[u]) {
                        const d = chartData.units.data[u];
                        uVal = d['200']+d['Неб. смерть']+d['Поранення']+d['Бойове']+d['Небойове']+d['ЗБВ']+d['СЗЧ']+d['Дезертирство'];
                    }
                    sheet2.addRow({
                        tL: tL[i] || '', tC: tC[i] !== undefined ? tC[i] : '',
                        uL: u || '', uC: uVal,
                        cL: cL[i] || '', cC: cL[i] ? chartData.reasons.data[cL[i]] : '',
                        timeL: timeL[i] || '', timeC: timeL[i] ? chartData.time.timeMap[timeL[i]] : ''
                    });
                }

                const sheet3 = workbook.addWorksheet('Детальний реєстр');
                sheet3.columns = [
                    { header: 'Дата/Час', key: 'date', width: 15 },
                    { header: 'Звання', key: 'rank', width: 15 },
                    { header: 'ПІБ', key: 'name', width: 25 },
                    { header: 'Позивний', key: 'callsign', width: 15 },
                    { header: 'Підрозділ', key: 'unit', width: 20 },
                    { header: 'Тип втрати', key: 'lossType', width: 20 },
                    { header: 'Важкість', key: 'severity', width: 15 },
                    { header: 'Причина', key: 'cause', width: 20 },
                    { header: 'Фактичне місце', key: 'loc', width: 25 },
                    { header: 'Евакуація / СЗЧ', key: 'status', width: 20 },
                    { header: 'Зброя', key: 'weapon', width: 15 },
                    { header: 'Рапорт', key: 'report', width: 20 },
                    { header: 'Травми', key: 'inj', width: 35 }
                ];
                sheet3.getRow(1).font = { bold: true };

                anFilteredEpisodes.forEach(ep => {
                    const s = MedicalPersonnelDirectory.forEpisode(ep, soldiers.find(x => x.id === ep.soldierId)) || {};
                    sheet3.addRow({
                        date: ep.date.replace('T', ' '),
                        rank: s.rank || '',
                        name: s.name || '',
                        callsign: s.callsign ? formatCallsignUI(s.callsign) : '',
                        unit: s.unit || '',
                        lossType: ep.lossType || '',
                        severity: ep.severity || '',
                        cause: ep.cause || '',
                        loc: ep.actualLoc || '',
                        status: isAwol(ep.lossType) ? (ep.awolStatus || '') : (ep.evacStatus || ''),
                        weapon: ep.weaponStatus || '-',
                        report: ep.hasReport ? `Складено (${ep.reportDate || "-"})` : "Ні",
                        inj: getInjStrUI(ep.injuries)
                    });
                });

                const buffer = await workbook.xlsx.writeBuffer();
                const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
                const link = document.createElement("a");
                link.href = URL.createObjectURL(blob);
                link.download = `Analytics_Report_${new Date().toLocaleDateString('en-CA')}.xlsx`;
                link.click();
            };

            const toggleFilterItem = (list, setList, item) => {
                if (list.includes(item)) setList(list.filter(i => i !== item));
                else setList([...list, item]);
            };

            const clearAllFilterCheckboxes = () => {
                setFilterLossTypes([]);
                setFilterSeverities([]);
                setFilterEvacStatuses([]);
                setFilterCauses([]);
                setFilterInjuries([]);
                setFilterWeapon([]);
            };

            const resetAllFilters = () => {
                setSearchTerm("");
                setSortBy("date_desc");
                setFilterLossTypes([...LOSS_TYPES]);
                setFilterSeverities(["Легкий", "Середній", "Важкий", "Критичний"]);
                setFilterEvacStatuses(["Не евакуйований", "Евакуйований", "Не потребує евакуації", "В розшуку", "Повернувся"]);
                setFilterCauses(settings.causes);
                setFilterUdp("all");
                setFilterInjuries([]);
                setFilterWeapon([]);
                setFilterReport("all");
                setListDateFrom("");
                setListDateTo("");
                setDatePreset("all");
            };

            const resetAnalyticsFilters = () => {
                setAnDateFrom(""); 
                setAnDateTo(""); 
                setAnDatePreset("all");
                setAnUdp("all"); 
                setAnSector("all");
                setAnShowLatest(true); 
            };

            // Глобальний хоткей Ctrl+F / Cmd+F для миттєвого фокусу на вбудованому пошуку
            useEffect(() => {
                const handleGlobalKeyDown = (e) => {
                    if (document.querySelector('[data-suite-module="med"]')?.dataset.suiteActive !== 'true') return;
                    if ((e.ctrlKey || e.metaKey) && (e.key === 'f' || e.key === 'F' || e.code === 'KeyF' || e.keyCode === 70)) {
                        // Не перехоплювати, якщо користувач вже друкує в текстовому полі модального вікна
                        const activeEl = document.activeElement;
                        const isInsideModal = activeEl && activeEl.closest('.modal, [role="dialog"], form');
                        if (isInsideModal) return;

                        e.preventDefault();
                        if (activeTab !== "list" && activeTab !== "triage") {
                            setActiveTab("list");
                        }
                        setTimeout(() => {
                            const searchInput = document.getElementById('global-search-input');
                            if (searchInput) {
                                searchInput.focus();
                                searchInput.select();
                            }
                        }, 50);
                    }
                };
                window.addEventListener('keydown', handleGlobalKeyDown);
                return () => window.removeEventListener('keydown', handleGlobalKeyDown);
            }, [activeTab]);

            const filteredList = useMemo(() => {
                const normSearch = normalizeMilitaryText(searchTerm, { toLower: true, replaceHomoglyphs: true });
                const list = activeDataSource.filter(episode => {
                    const soldier = MedicalPersonnelDirectory.forEpisode(episode, soldiersMap.get(episode.soldierId));
                    if (!soldier) return false;

                    let matchSearch = true;
                    if (normSearch) {
                        const searchStr = normalizeMilitaryText(`${soldier.name} ${soldier.callsign || ''} ${episode.actualLoc || ''}`, { toLower: true, replaceHomoglyphs: true });
                        matchSearch = searchStr.includes(normSearch);
                    }

                    const matchLoss = filterLossTypes.includes(episode.lossType);
                    const matchSeverity = isAny300(episode.lossType) ? (!episode.severity || filterSeverities.includes(episode.severity)) : true;
                    const currentStatus = isAwol(episode.lossType) ? episode.awolStatus : episode.evacStatus;
                    const matchEvac = filterEvacStatuses.includes(currentStatus);
                    const matchCause = !episode.cause || filterCauses.includes(episode.cause);
                    const matchUdp = filterUdp === "all" ? true : (filterUdp === "yes" ? episode.inUdp : !episode.inUdp);
                    
                    const matchWeapon = filterWeapon.length === 0 || filterWeapon.includes(episode.weaponStatus || "Не вказано");
                    const matchReport = filterReport === "all" ? true : (filterReport === "yes" ? episode.hasReport : !episode.hasReport);
                    const matchInjury = filterInjuries.length === 0 || (
                        isAny300(episode.lossType) && filterInjuries.some(injKey => 
                            episode.injuries && Object.values(episode.injuries).some(region => region[injKey])
                        )
                    );

                    return matchSearch && matchLoss && matchSeverity && matchEvac && matchCause && matchUdp && matchWeapon && matchReport && matchInjury;
                });

                // Багаторежимне сортування (за датою евакуації, датою події, ПІБ, важкістю)
                const sevOrder = { 'Критичний': 4, 'Важкий': 3, 'Середній': 2, 'Легкий': 1 };
                return list.sort((a, b) => {
                    if (sortBy === 'evac_desc' || sortBy === 'evac_asc') {
                        const timeA = parseSafeDate(a.evacTime || a.evacDate || '');
                        const timeB = parseSafeDate(b.evacTime || b.evacDate || '');
                        // Якщо в одного немає дати евакуації - переміщуємо його в кінець
                        if (timeA === 0 && timeB === 0) return parseSafeDate(b.date) - parseSafeDate(a.date);
                        if (timeA === 0) return 1;
                        if (timeB === 0) return -1;
                        return sortBy === 'evac_desc' ? timeB - timeA : timeA - timeB;
                    }
                    if (sortBy === 'date_asc') {
                        return parseSafeDate(a.date) - parseSafeDate(b.date);
                    }
                    if (sortBy === 'name_asc' || sortBy === 'name_desc') {
                        const solA = MedicalPersonnelDirectory.forEpisode(a, soldiersMap.get(a.soldierId))?.name || '';
                        const solB = MedicalPersonnelDirectory.forEpisode(b, soldiersMap.get(b.soldierId))?.name || '';
                        const cmp = solA.localeCompare(solB, 'uk');
                        return sortBy === 'name_asc' ? cmp : -cmp;
                    }
                    if (sortBy === 'severity_desc') {
                        const sA = sevOrder[a.severity] || 0;
                        const sB = sevOrder[b.severity] || 0;
                        if (sA !== sB) return sB - sA;
                        return parseSafeDate(b.date) - parseSafeDate(a.date);
                    }
                    // default: date_desc
                    return parseSafeDate(b.date) - parseSafeDate(a.date);
                });
            }, [activeDataSource, soldiersMap, searchTerm, filterLossTypes, filterSeverities, filterEvacStatuses, filterCauses, filterUdp, filterWeapon, filterReport, filterInjuries, sortBy]);

            // Видима порція списку карток (для максимальної швидкодії)
            const visibleList = useMemo(() => {
                return filteredList.slice(0, displayLimit);
            }, [filteredList, displayLimit]);

            // При зміні будь-яких фільтрів або сортування автоматично повертаємо ліміт до 50
            useEffect(() => {
                setDisplayLimit(50);
            }, [searchTerm, filterLossTypes, filterSeverities, filterEvacStatuses, filterCauses, filterUdp, filterWeapon, filterReport, filterInjuries, listDateFrom, listDateTo, datePreset, showOnlyLatest, sortBy]);

            const filteredLogs = useMemo(() => {
                return logs.filter(log => {
                    if (!logTimeFrom && !logTimeTo) return true;
                    const logDate = new Date(log.timestamp);
                    if (logTimeFrom && logDate < new Date(logTimeFrom)) return false;
                    if (logTimeTo && logDate > new Date(logTimeTo)) return false;
                    return true;
                });
            }, [logs, logTimeFrom, logTimeTo]);

            const handleOpenAddWounded = (preselectedSoldierId = null) => {
                setPersonnelDirectory(MedicalPersonnelDirectory.read());
                setRosterSelection(null); setRosterCandidates([]); setForceNewPerson(false);
                if (preselectedSoldierId) {
                    const s = soldiers.find(x => x.id === preselectedSoldierId);
                    if (s) {
                        setSelectedSoldierId(s.id);
                        setSearchMatches([]);
                        setNewSoldierName(s.name);
                        setNewSoldierCallsign(s.callsign);
                        setNewSoldierRank(s.rank);
                        setNewSoldierUnit(s.unit);
                    }
                } else {
                    setSelectedSoldierId("");
                    setSearchMatches([]);
                    setNewSoldierName("");
                    setNewSoldierCallsign("");
                    setNewSoldierRank("");
                    setNewSoldierUnit("");
                }
                
                setEpisodeDate("");
                setLossType("");
                setCause("");
                setSeverity("");
                setInUdp(false);
                setActualLoc("");
                setDocLoc("");
                setNotes("");
                setInjuries({});
                setEvacStatus("Не евакуйований");
                setAwolStatus("В розшуку");
                setEvacDate(""); 
                setHasReport(false);
                setReportDate("");
                setWeaponStatus("");
                
                setIsAddWoundedOpen(true);
            };

            const handleSmartInput = (field, value) => {
                if (field === 'name') setNewSoldierName(value);
                if (field === 'callsign') setNewSoldierCallsign(value);
                setSelectedSoldierId(""); // clear selected id if user manually types
                setRosterSelection(null); setRosterCandidates([]); setForceNewPerson(false);
                setSearchMatches(MedicalPersonnelDirectory.search(value, soldiers, personnelDirectory.entries));
            };

            const chooseRosterPerson = (roster, existing = null) => {
                setRosterSelection(roster); setRosterCandidates([]); setForceNewPerson(!existing);
                setSelectedSoldierId(existing?.id || ''); setSearchMatches([]);
                setNewSoldierName(roster.name); setNewSoldierCallsign(roster.callsign);
                setNewSoldierRank(roster.rank); setNewSoldierUnit(roster.unit);
            };
            const selectExistingSoldier = (s) => {
                if (s.source === 'roster') {
                    const resolution = MedicalPersonnelDirectory.resolve(s, soldiers);
                    chooseRosterPerson(s, resolution.match);
                    if (resolution.candidates.length) setRosterCandidates(resolution.candidates);
                    return;
                }
                setRosterSelection(null); setRosterCandidates([]); setForceNewPerson(false);
                setSelectedSoldierId(s.id);
                setSearchMatches([]);
                setNewSoldierName(s.name);
                setNewSoldierCallsign(s.callsign);
                setNewSoldierRank(s.rank);
                setNewSoldierUnit(s.unit);
            };

            const clearSelectedSoldier = () => {
                setSelectedSoldierId("");
                setSearchMatches([]);
                setRosterSelection(null); setRosterCandidates([]); setForceNewPerson(false);
            };

            const toggleInjuryType = (regionId, type) => {
                setInjuries(prev => {
                    const regionObj = prev[regionId] || { amputation: false, rupture: false, shrapnel: false, bullet: false, fracture: false, burn: false, akbt: false, contusion: false };
                    return { ...prev, [regionId]: { ...regionObj, [type]: !regionObj[type] } };
                });
            };

            const hasAnyInjury = (regionId) => {
                const reg = injuries && injuries[regionId];
                if (!reg) return false;
                return reg.amputation || reg.rupture || reg.shrapnel || reg.bullet || reg.fracture || reg.burn || reg.akbt || reg.contusion;
            };

            const handleSaveWounded = (e) => {
                e.preventDefault();
                
                if(!episodeDate) return triggerNotification("Вкажіть точну дату та час події", "error");
                if(!lossType) return triggerNotification("Оберіть тип події", "error");
                if(!cause) return triggerNotification("Оберіть причину", "error");
                if(isAny300(lossType) && !severity) return triggerNotification("Оберіть важкість", "error");

                let finalSoldierId = selectedSoldierId;
                if (rosterCandidates.length) return triggerNotification('Уточніть відповідність старій медичній картці або підтвердьте, що це інша особа.', 'error');

                if (!finalSoldierId && !forceNewPerson) {
                    const exactMatches = soldiers.filter(s => {
                        const nameMatches = MedicalPersonnelDirectory.norm(s.name) === MedicalPersonnelDirectory.norm(newSoldierName);
                        if (!nameMatches) return false;
                        if (newSoldierCallsign.trim()) {
                            return MedicalPersonnelDirectory.norm(s.callsign) === MedicalPersonnelDirectory.norm(newSoldierCallsign);
                        }
                        return true;
                    });
                    if (exactMatches.length > 1) return triggerNotification('Є кілька карток із такими даними. Оберіть потрібну зі списку збігів.', 'error');
                    if (exactMatches.length === 1) finalSoldierId = exactMatches[0].id;
                }

                const existingEpisodes = episodes.filter(ep => ep.soldierId === finalSoldierId).sort((a,b) => new Date(b.date) - new Date(a.date));
                if (existingEpisodes.length > 0 && isAny200(existingEpisodes[0].lossType)) return triggerNotification('Боєць зафіксований як 200. Нових подій додавати не можна.', 'error');
                if (!newSoldierName.trim() || !newSoldierUnit) return triggerNotification('ПІБ та Підрозділ є обов’язковими.', 'error');
                saveHistory();

                if (!finalSoldierId) {
                    if (!newSoldierName.trim() || !newSoldierUnit) {
                        return triggerNotification("ПІБ та Підрозділ є обов'язковими (Позивний та Звання — за бажанням)", "error");
                    }

                    const newSoldierId = 'sol_' + crypto.randomUUID();
                    const cleanCallsign = formatCallsignUI(newSoldierCallsign);
                    const newSoldierObj = { id: newSoldierId, name: newSoldierName.trim(), callsign: cleanCallsign, rank: newSoldierRank || "Не вказано", unit: newSoldierUnit, ...(rosterSelection ? { sourceRosterId: rosterSelection.rosterId } : {}) };
                    setSoldiers(prev => [...prev, newSoldierObj]);
                    finalSoldierId = newSoldierId;
                    const callsignDisplay = cleanCallsign ? ` «${cleanCallsign}»` : "";
                    addLog("Новий в/сл", `Створено: ${newSoldierRank || ""} ${newSoldierName}${callsignDisplay}`);
                } else {
                    const cleanCallsign = formatCallsignUI(newSoldierCallsign);
                    setSoldiers(prev => prev.map(s => {
                        if (s.id === finalSoldierId) {
                            if (rosterSelection) return { ...s, sourceRosterId: rosterSelection.rosterId };
                            return { ...s, rank: newSoldierRank || s.rank, unit: newSoldierUnit || s.unit, callsign: cleanCallsign || s.callsign };
                        }
                        return s;
                    }));
                }

                const soldierObj = rosterSelection ? { name: newSoldierName.trim(), callsign: formatCallsignUI(newSoldierCallsign), rank: newSoldierRank, unit: newSoldierUnit } : (soldiers.find(s => s.id === finalSoldierId) || { name: newSoldierName, callsign: newSoldierCallsign.trim() });
                const is300 = isAny300(lossType);
                const todayStrDate = new Date().toLocaleDateString('en-CA');

                const newEpisode = {
                    id: 'ep_' + Date.now(),
                    soldierId: finalSoldierId, date: episodeDate, lossType, cause,
                    ...(rosterSelection ? { personnelSnapshot: { name: newSoldierName.trim(), callsign: formatCallsignUI(newSoldierCallsign), rank: newSoldierRank, unit: newSoldierUnit, sourceRosterId: rosterSelection.rosterId } } : {}),
                    severity: is300 ? severity : null,
                    rank: newSoldierRank || soldierObj.rank || "Не вказано",
                    unit: newSoldierUnit || soldierObj.unit || "Не вказано",
                    inUdp, actualLoc, docLoc,
                    injuries: is300 ? injuries : {},
                    notes, evacStatus, awolStatus, weaponStatus,
                    evacTime: (evacStatus === 'Евакуйований' || awolStatus === 'Повернувся') ? (evacDate || todayStrDate) : "",
                    hasReport, reportDate: hasReport ? (reportDate || todayStrDate) : ""
                };

                setEpisodes(prev => [newEpisode, ...prev]);
                const soldierDisplayName = soldierObj.callsign ? `«${soldierObj.callsign}»` : (soldierObj.name || newSoldierName);
                addLog("Нова подія", `Зафіксовано ${lossType} у в/сл ${soldierDisplayName}. Причина: ${cause}.`);
                
                setIsAddWoundedOpen(false);
                triggerNotification("Запис успішно додано");
            };

            const handleStartEdit = (episode) => {
                const soldier = MedicalPersonnelDirectory.forEpisode(episode, soldiers.find(s => s.id === episode.soldierId));
                setRosterSelection(null); setRosterCandidates([]); setForceNewPerson(false);
                setCurrentEpisode(episode);
                setSelectedSoldierId(episode.soldierId);
                setSoldierSearch(soldier ? `${soldier.name} «${soldier.callsign}»` : "");
                setSearchMatches([]);
                setNewSoldierName(soldier?.name || "");
                setNewSoldierCallsign(soldier?.callsign || "");
                setNewSoldierRank(episode.rank || soldier?.rank || "");
                setNewSoldierUnit(episode.unit || soldier?.unit || "");
                setEpisodeDate(episode.date);
                setLossType(episode.lossType || "");
                setCause(episode.cause || "");
                setSeverity(episode.severity || "");
                setInUdp(episode.inUdp);
                setActualLoc(episode.actualLoc || "");
                setDocLoc(episode.docLoc || "");
                setNotes(episode.notes || "");
                setInjuries(episode.injuries || {});
                setEvacStatus(episode.evacStatus || "Не евакуйований");
                setAwolStatus(episode.awolStatus || "В розшуку");
                
                let evT = episode.evacTime || "";
                if (evT.length > 10) evT = evT.split('T')[0];
                setEvacDate(evT);
                
                setHasReport(episode.hasReport || false);
                setReportDate(episode.reportDate || "");
                setWeaponStatus(episode.weaponStatus || "");
                setConfirmDelete(false);
                setIsEditOpen(true);
            };

            const handleUpdateWounded = (e) => {
                e.preventDefault();
                if (!currentEpisode) return;

                if(!episodeDate) return triggerNotification("Вкажіть точну дату та час події", "error");
                if(!lossType) return triggerNotification("Оберіть тип події", "error");
                if(!cause) return triggerNotification("Оберіть причину", "error");
                if(isAny300(lossType) && !severity) return triggerNotification("Оберіть важкість", "error");
                if (!newSoldierUnit || !newSoldierName.trim()) return triggerNotification("ПІБ та Підрозділ є обов'язковими", "error");

                saveHistory();

                const original = episodes.find(ep => ep.id === currentEpisode.id);
                const is300 = isAny300(lossType);
                const todayStrDate = new Date().toLocaleDateString('en-CA');
                
                const updatedEpisode = {
                    ...currentEpisode,
                    ...(currentEpisode.personnelSnapshot ? { personnelSnapshot: { ...currentEpisode.personnelSnapshot, name: newSoldierName.trim(), callsign: formatCallsignUI(newSoldierCallsign), rank: newSoldierRank, unit: newSoldierUnit } } : {}),
                    date: episodeDate, lossType, cause,
                    severity: is300 ? severity : null,
                    rank: newSoldierRank || original?.rank || "Не вказано",
                    unit: newSoldierUnit || original?.unit || "Не вказано",
                    inUdp, actualLoc, docLoc,
                    injuries: is300 ? injuries : {},
                    notes, evacStatus, awolStatus, weaponStatus,
                    evacTime: (evacStatus === 'Евакуйований' || awolStatus === 'Повернувся') ? (evacDate || todayStrDate) : "",
                    hasReport, reportDate: hasReport ? (reportDate || todayStrDate) : ""
                };

                const cleanCallsign = formatCallsignUI(newSoldierCallsign);
                setEpisodes(prev => prev.map(ep => ep.id === currentEpisode.id ? updatedEpisode : ep));
                if (!currentEpisode.personnelSnapshot) setSoldiers(prev => prev.map(s => s.id === currentEpisode.soldierId ? {
                    ...s, name: newSoldierName.trim(), callsign: cleanCallsign, rank: newSoldierRank, unit: newSoldierUnit
                } : s));

                let changes = [];
                if (original) {
                    if (original.evacStatus !== evacStatus) changes.push(`евакуацію змінено з "${original.evacStatus}" на "${evacStatus}"`);
                    if (original.lossType !== lossType) changes.push(`тип втрати змінено з "${original.lossType}" на "${lossType}"`);
                }

                const detailsText = changes.length > 0 ? `Зміни: ${changes.join(', ')}` : `Оновлено загальні дані картки`;
                const editCallsignDisplay = cleanCallsign ? ` («${cleanCallsign}»)` : "";
                addLog("Редагування", `Оновлено дані для в/сл: ${newSoldierName}${editCallsignDisplay}. ${detailsText}`);
                
                setIsEditOpen(false); setCurrentEpisode(null);
                triggerNotification("Запис оновлено");
            };

            const handleDeleteEpisode = () => {
                saveHistory();
                setEpisodes(prev => prev.filter(ep => ep.id !== currentEpisode.id));
                const delCallsignDisplay = newSoldierCallsign.trim() ? ` («${newSoldierCallsign.trim()}»)` : "";
                addLog("Видалення", `Видалено запис для в/сл: ${newSoldierName}${delCallsignDisplay}`);
                setIsEditOpen(false); setCurrentEpisode(null);
                triggerNotification("Запис видалено");
            };

            const handleClearDatabase = () => {
                saveHistory();
                setSoldiers([]); setEpisodes([]);
                setLogs([{ id: 'init', timestamp: new Date().toISOString(), action: 'Система', details: 'Базу повністю очищено користувачем' }]);
                setIsClearDbConfirmOpen(false); setIsBackupOpen(false);
                triggerNotification("Базу успішно очищено!", "success");
            };

            const handleExport = () => {
                if (!backupPassword) return triggerNotification("Введіть пароль!", "error");
                try {
                    const rawJson = JSON.stringify({ soldiers, episodes, logs, settings });
                    const encrypted = CryptoJS.AES.encrypt(rawJson, backupPassword).toString();
                    const link = document.createElement('a');
                    link.download = `med_backup_${new Date().toISOString().slice(0,10)}.enc`;
                    link.href = URL.createObjectURL(new Blob([encrypted], { type: 'text/plain' }));
                    link.click();
                    addLog("Експорт", "Створено шифрований бекап бази");
                    triggerNotification("Бекап скачано!");
                } catch (e) { triggerNotification("Помилка: " + e.message, "error"); }
            };

            const handleFileChange = (e) => { if (e.target.files && e.target.files[0]) setImportFile(e.target.files[0]); };

            const handleImport = () => {
                if (!importFile || !importPassword) return triggerNotification("Оберіть файл та введіть пароль", "error");
                const reader = new FileReader();
                reader.onload = (e) => {
                    try {
                        const encryptedContent = e.target.result;
                        const decrypted = CryptoJS.AES.decrypt(encryptedContent.trim(), importPassword).toString(CryptoJS.enc.Utf8);
                        if (!decrypted) throw new Error("Невірний пароль");
                        const parsed = JSON.parse(decrypted);
                        if (parsed.soldiers && parsed.episodes) {
                            saveHistory();
                            const cleanedImportEpisodes = (parsed.episodes || []).map(ep => {
                                if (ep.lossType === "Бойове травмування (300)") {
                                    return { ...ep, lossType: "Поранення (300)" };
                                }
                                return ep;
                            });
                            setSoldiers(parsed.soldiers);
                            setEpisodes(cleanedImportEpisodes);
                            if (parsed.logs) setLogs(parsed.logs.slice(0, 200));
                            if (parsed.settings) setSettings(parsed.settings);
                            setSessionPassword(importPassword);
                            setBackupPassword(importPassword);
                            addLog("Імпорт", "Базу успішно відновлено з файлу");
                            triggerNotification("Дані успішно імпортовано!");
                            setIsBackupOpen(false); setImportFile(null); setImportPassword("");
                        } else throw new Error("Пошкоджений або невірний файл");
                    } catch (err) { triggerNotification("Помилка: " + (err.message || "Невірний пароль або файл"), "error"); }
                };
                reader.readAsText(importFile);
            };

            const handleRestoreFromDisk = async (customPwd = "") => {
                const pwd = customPwd || diskRestorePassword || importPassword || sessionPassword;
                if (!pwd) return triggerNotification("Введіть пароль для розшифрування!", "error");
                setIsRestoringFromDisk(true);
                try {
                    let encContent = diskBackupInfo?.content;
                    if (!encContent) {
                        const res = await fetch('http://127.0.0.1:8765/api/backup/latest?app=med_tactical');
                        const data = await res.json();
                        if (!data || !data.exists) throw new Error("Бекап на диску не знайдено");
                        encContent = data.content;
                        setDiskBackupInfo(data);
                    }

                    const decrypted = CryptoJS.AES.decrypt(encContent.trim(), pwd).toString(CryptoJS.enc.Utf8);
                    if (!decrypted) throw new Error("Невірний пароль розшифрування");
                    const parsed = JSON.parse(decrypted);
                    if (parsed.soldiers && parsed.episodes) {
                        saveHistory();
                        const cleanedImportEpisodes = (parsed.episodes || []).map(ep => {
                            if (ep.lossType === "Бойове травмування (300)") {
                                return { ...ep, lossType: "Поранення (300)" };
                            }
                            return ep;
                        });
                        setSoldiers(parsed.soldiers);
                        setEpisodes(cleanedImportEpisodes);
                        if (parsed.logs) setLogs(parsed.logs.slice(0, 200));
                        if (parsed.settings) setSettings(parsed.settings);

                        await window.SuiteRuntime.setItem('med_soldiers_v3', parsed.soldiers);
                        await window.SuiteRuntime.setItem('med_episodes_v3', cleanedImportEpisodes);
                        if (parsed.logs) await window.SuiteRuntime.setItem('med_logs_v3', parsed.logs.slice(0, 200));
                        if (parsed.settings) await window.SuiteRuntime.setItem('med_settings_v3', parsed.settings);

                        setSessionPassword(pwd);
                        setBackupPassword(pwd);
                        setDiskRestorePassword("");
                        setShowAutoRestoreModal(false);
                        setIsBackupOpen(false);
                        addLog("Відновлення", `Базу відновлено з диска (${parsed.soldiers.length} о/с, ${cleanedImportEpisodes.length} епізодів)`);
                        triggerNotification(`✅ Відновлено: ${parsed.soldiers.length} бійців, ${cleanedImportEpisodes.length} епізодів!`, "success");
                    } else {
                        throw new Error("Файл не містить коректних даних бійців чи епізодів");
                    }
                } catch (err) {
                    triggerNotification("Помилка відновлення: " + (err.message || "Невірний пароль"), "error");
                } finally {
                    setIsRestoringFromDisk(false);
                }
            };

            const handleSaveToDisk = async (customPwd = "") => {
                const pwd = customPwd || sessionPassword || backupPassword;
                if (!pwd) {
                    triggerNotification("Введіть пароль для шифрування перед збереженням!", "error");
                    setIsBackupOpen(true);
                    return;
                }
                setIsSavingToDisk(true);
                try {
                    const rawJson = JSON.stringify({ soldiers, episodes, logs, settings });
                    const encrypted = CryptoJS.AES.encrypt(rawJson, pwd).toString();
                    const res = await window.SuiteRuntime.runAsync(() => fetch('http://127.0.0.1:8765/api/backup/save', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            app: 'med_tactical',
                            content: encrypted
                        })
                    }));
                    const result = await res.json();
                    if (result.success) {
                        const timeStr = new Date().toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
                        setLastDiskSaveTime(timeStr);
                        setDiskServiceOnline(true);
                        setSessionPassword(pwd);
                        setBackupPassword(pwd);
                        addLog("Автобекап", "Створено резервну копію на локальному диску");
                        triggerNotification("✅ Базу надійно збережено на локальний диск!", "success");
                        // Оновити інформацію про бекап
                        fetch('http://127.0.0.1:8765/api/backup/latest?app=med_tactical')
                            .then(r => r.json())
                            .then(d => { if (d && d.exists) setDiskBackupInfo(d); })
                            .catch(() => {});
                    } else {
                        throw new Error(result.error || "Не вдалося зберегти файл");
                    }
                } catch (err) {
                    triggerNotification("Помилка збереження на диск: " + err.message, "error");
                } finally {
                    setIsSavingToDisk(false);
                }
            };

            const addSettingItem = () => {
                if (!newSettingItem.trim()) return;
                const item = newSettingItem.trim();
                setSettings(prev => ({ ...prev, [activeSettingsTab]: [...(prev[activeSettingsTab] || []), item] }));
                if (activeSettingsTab === "causes") setFilterCauses(prev => [...prev, item]);
                setNewSettingItem("");
            };

            const removeSettingItem = (item) => {
                setSettings(prev => ({ ...prev, [activeSettingsTab]: prev[activeSettingsTab].filter(i => i !== item) }));
                if (activeSettingsTab === "causes") setFilterCauses(prev => prev.filter(i => i !== item));
            };

            const openBatchReplaceFor = (cat, oldVal = "") => {
                setBatchCategory(cat);
                setBatchOldVal(oldVal);
                setBatchNewVal("");
                setBatchMode("single");
                setIsBatchReplaceOpen(true);
            };

            const batchAvailableOldValues = useMemo(() => {
                const map = new Map();
                if (batchCategory === "sectors") {
                    episodes.forEach(ep => {
                        if (ep.actualLoc && ep.actualLoc.trim()) {
                            map.set(ep.actualLoc, (map.get(ep.actualLoc) || 0) + 1);
                        }
                        if (ep.docLoc && ep.docLoc.trim() && ep.docLoc !== ep.actualLoc) {
                            map.set(ep.docLoc, (map.get(ep.docLoc) || 0) + 1);
                        }
                    });
                    (settings.sectors || []).forEach(s => {
                        if (s && !map.has(s)) map.set(s, 0);
                    });
                } else if (batchCategory === "units") {
                    episodes.forEach(ep => {
                        if (ep.unit && ep.unit.trim()) {
                            map.set(ep.unit, (map.get(ep.unit) || 0) + 1);
                        }
                    });
                    soldiers.forEach(s => {
                        if (s.unit && s.unit.trim() && !map.has(s.unit)) {
                            map.set(s.unit, 0);
                        }
                    });
                    (settings.units || []).forEach(u => {
                        if (u && !map.has(u)) map.set(u, 0);
                    });
                } else if (batchCategory === "causes") {
                    episodes.forEach(ep => {
                        if (ep.cause && ep.cause.trim()) {
                            map.set(ep.cause, (map.get(ep.cause) || 0) + 1);
                        }
                    });
                    (settings.causes || []).forEach(c => {
                        if (c && !map.has(c)) map.set(c, 0);
                    });
                } else if (batchCategory === "ranks") {
                    episodes.forEach(ep => {
                        if (ep.rank && ep.rank.trim()) {
                            map.set(ep.rank, (map.get(ep.rank) || 0) + 1);
                        }
                    });
                    soldiers.forEach(s => {
                        if (s.rank && s.rank.trim() && !map.has(s.rank)) {
                            map.set(s.rank, 0);
                        }
                    });
                    (settings.ranks || []).forEach(r => {
                        if (r && !map.has(r)) map.set(r, 0);
                    });
                }

                return Array.from(map.entries())
                    .map(([val, count]) => ({ val, count }))
                    .sort((a, b) => b.count - a.count || a.val.localeCompare(b.val));
            }, [batchCategory, episodes, soldiers, settings]);

            const singleReplacePreviewCount = useMemo(() => {
                if (!batchOldVal) return 0;
                const target = batchOldVal.trim();
                let count = 0;
                if (batchCategory === "sectors") {
                    episodes.forEach(ep => {
                        if ((batchFields.actualLoc && ep.actualLoc === target) || (batchFields.docLoc && ep.docLoc === target)) {
                            count++;
                        }
                    });
                } else if (batchCategory === "units") {
                    episodes.forEach(ep => { if (ep.unit === target) count++; });
                    soldiers.forEach(s => { if (s.unit === target) count++; });
                } else if (batchCategory === "causes") {
                    episodes.forEach(ep => { if (ep.cause === target) count++; });
                } else if (batchCategory === "ranks") {
                    episodes.forEach(ep => { if (ep.rank === target) count++; });
                    soldiers.forEach(s => { if (s.rank === target) count++; });
                }
                return count;
            }, [batchCategory, batchOldVal, batchFields, episodes, soldiers]);

            const dictionarySuggestions = useMemo(() => {
                if (batchCategory === "sectors") return settings.sectors || [];
                if (batchCategory === "units") return settings.units || [];
                if (batchCategory === "causes") return settings.causes || [];
                if (batchCategory === "ranks") return settings.ranks || [];
                return [];
            }, [batchCategory, settings]);

            const addBatchMultiRow = () => {
                setBatchMultiRows(prev => [...prev, { id: 'row_' + Date.now() + Math.random().toString(36).substring(7), oldVal: '', newVal: '' }]);
            };

            const removeBatchMultiRow = (id) => {
                setBatchMultiRows(prev => prev.length > 1 ? prev.filter(r => r.id !== id) : [{ id: 'row_' + Date.now(), oldVal: '', newVal: '' }]);
            };

            const updateBatchMultiRow = (id, field, val) => {
                setBatchMultiRows(prev => prev.map(r => r.id === id ? { ...r, [field]: val } : r));
            };

            const handleExecuteSingleReplace = (e) => {
                e?.preventDefault?.();
                const oldV = batchOldVal.trim();
                const newV = batchNewVal.trim();
                if (!oldV) return triggerNotification("Оберіть або введіть стару назву", "error");
                if (!newV) return triggerNotification("Введіть нову назву", "error");
                if (oldV === newV) return triggerNotification("Стара та нова назви повністю співпадають", "error");

                saveHistory();
                let affectedEpisodes = 0;
                let affectedSoldiers = 0;

                if (batchCategory === "sectors") {
                    const updActual = batchFields.actualLoc;
                    const updDoc = batchFields.docLoc;
                    setEpisodes(prev => prev.map(ep => {
                        let changed = false;
                        let newEp = { ...ep };
                        if (updActual && ep.actualLoc === oldV) {
                            newEp.actualLoc = newV;
                            changed = true;
                        }
                        if (updDoc && ep.docLoc === oldV) {
                            newEp.docLoc = newV;
                            changed = true;
                        }
                        if (changed) affectedEpisodes++;
                        return changed ? newEp : ep;
                    }));

                    if (batchFields.updateDict) {
                        setSettings(prev => {
                            const currentSectors = prev.sectors || [];
                            const updated = currentSectors.map(s => s === oldV ? newV : s);
                            if (!updated.includes(newV)) updated.push(newV);
                            return { ...prev, sectors: Array.from(new Set(updated)) };
                        });
                    }
                    addLog("Масова заміна", `Позицію "${oldV}" замінено на "${newV}" (Оновлено епізодів: ${affectedEpisodes})`);
                } else if (batchCategory === "units") {
                    setEpisodes(prev => prev.map(ep => {
                        if (ep.unit === oldV) {
                            affectedEpisodes++;
                            return { ...ep, unit: newV };
                        }
                        return ep;
                    }));
                    setSoldiers(prev => prev.map(s => {
                        if (s.unit === oldV) {
                            affectedSoldiers++;
                            return { ...s, unit: newV };
                        }
                        return s;
                    }));
                    if (batchFields.updateDict) {
                        setSettings(prev => {
                            const currentUnits = prev.units || [];
                            const updated = currentUnits.map(u => u === oldV ? newV : u);
                            if (!updated.includes(newV)) updated.push(newV);
                            return { ...prev, units: Array.from(new Set(updated)) };
                        });
                    }
                    addLog("Масова заміна", `Підрозділ "${oldV}" замінено на "${newV}" (Епізодів: ${affectedEpisodes}, Бійців: ${affectedSoldiers})`);
                } else if (batchCategory === "causes") {
                    setEpisodes(prev => prev.map(ep => {
                        if (ep.cause === oldV) {
                            affectedEpisodes++;
                            return { ...ep, cause: newV };
                        }
                        return ep;
                    }));
                    if (batchFields.updateDict) {
                        setSettings(prev => {
                            const currentCauses = prev.causes || [];
                            const updated = currentCauses.map(c => c === oldV ? newV : c);
                            if (!updated.includes(newV)) updated.push(newV);
                            return { ...prev, causes: Array.from(new Set(updated)) };
                        });
                        setFilterCauses(prev => {
                            const updated = prev.map(c => c === oldV ? newV : c);
                            if (!updated.includes(newV)) updated.push(newV);
                            return Array.from(new Set(updated));
                        });
                    }
                    addLog("Масова заміна", `Причину "${oldV}" замінено на "${newV}" (Оновлено епізодів: ${affectedEpisodes})`);
                } else if (batchCategory === "ranks") {
                    setEpisodes(prev => prev.map(ep => {
                        if (ep.rank === oldV) {
                            affectedEpisodes++;
                            return { ...ep, rank: newV };
                        }
                        return ep;
                    }));
                    setSoldiers(prev => prev.map(s => {
                        if (s.rank === oldV) {
                            affectedSoldiers++;
                            return { ...s, rank: newV };
                        }
                        return s;
                    }));
                    if (batchFields.updateDict) {
                        setSettings(prev => {
                            const currentRanks = prev.ranks || [];
                            const updated = currentRanks.map(r => r === oldV ? newV : r);
                            if (!updated.includes(newV)) updated.push(newV);
                            return { ...prev, ranks: Array.from(new Set(updated)) };
                        });
                    }
                    addLog("Масова заміна", `Звання "${oldV}" замінено на "${newV}" (Епізодів: ${affectedEpisodes}, Бійців: ${affectedSoldiers})`);
                }

                triggerNotification(`Заміну успішно виконано! Оновлено записів: ${affectedEpisodes + affectedSoldiers}`, "success");
                setBatchOldVal("");
                setBatchNewVal("");
            };

            const handleExecuteMultiReplace = () => {
                let rules = [];
                if (batchMultiInputType === "rows") {
                    rules = batchMultiRows
                        .map(r => ({ oldVal: r.oldVal.trim(), newVal: r.newVal.trim() }))
                        .filter(r => r.oldVal && r.newVal && r.oldVal !== r.newVal);
                } else {
                    const lines = batchMultiText.split('\n');
                    lines.forEach(line => {
                        const clean = line.trim();
                        if (!clean) return;
                        let parts = [];
                        if (clean.includes('->')) parts = clean.split('->');
                        else if (clean.includes('➔')) parts = clean.split('➔');
                        else if (clean.includes('=>')) parts = clean.split('=>');
                        else if (clean.includes('\t')) parts = clean.split('\t');
                        else if (clean.includes('=')) parts = clean.split('=');
                        else if (clean.includes(':')) parts = clean.split(':');
                        
                        if (parts.length >= 2) {
                            const oldVal = parts[0].trim();
                            const newVal = parts.slice(1).join(':').trim();
                            if (oldVal && newVal && oldVal !== newVal) {
                                rules.push({ oldVal, newVal });
                            }
                        }
                    });
                }

                if (rules.length === 0) {
                    return triggerNotification("Не знайдено правил заміни. Вкажіть пари 'Стара назва -> Нова назва'", "error");
                }

                saveHistory();
                const ruleMap = new Map(rules.map(r => [r.oldVal, r.newVal]));
                let affectedEpisodes = 0;
                let affectedSoldiers = 0;

                if (batchCategory === "sectors") {
                    const updActual = batchFields.actualLoc;
                    const updDoc = batchFields.docLoc;
                    setEpisodes(prev => prev.map(ep => {
                        let changed = false;
                        let newEp = { ...ep };
                        if (updActual && ruleMap.has(ep.actualLoc)) {
                            newEp.actualLoc = ruleMap.get(ep.actualLoc);
                            changed = true;
                        }
                        if (updDoc && ruleMap.has(ep.docLoc)) {
                            newEp.docLoc = ruleMap.get(ep.docLoc);
                            changed = true;
                        }
                        if (changed) affectedEpisodes++;
                        return changed ? newEp : ep;
                    }));

                    if (batchFields.updateDict) {
                        setSettings(prev => {
                            const currentSectors = prev.sectors || [];
                            const updated = currentSectors.map(s => ruleMap.has(s) ? ruleMap.get(s) : s);
                            rules.forEach(r => { if (!updated.includes(r.newVal)) updated.push(r.newVal); });
                            return { ...prev, sectors: Array.from(new Set(updated)) };
                        });
                    }
                } else if (batchCategory === "units") {
                    setEpisodes(prev => prev.map(ep => {
                        if (ruleMap.has(ep.unit)) {
                            affectedEpisodes++;
                            return { ...ep, unit: ruleMap.get(ep.unit) };
                        }
                        return ep;
                    }));
                    setSoldiers(prev => prev.map(s => {
                        if (ruleMap.has(s.unit)) {
                            affectedSoldiers++;
                            return { ...s, unit: ruleMap.get(s.unit) };
                        }
                        return s;
                    }));
                    if (batchFields.updateDict) {
                        setSettings(prev => {
                            const currentUnits = prev.units || [];
                            const updated = currentUnits.map(u => ruleMap.has(u) ? ruleMap.get(u) : u);
                            rules.forEach(r => { if (!updated.includes(r.newVal)) updated.push(r.newVal); });
                            return { ...prev, units: Array.from(new Set(updated)) };
                        });
                    }
                } else if (batchCategory === "causes") {
                    setEpisodes(prev => prev.map(ep => {
                        if (ruleMap.has(ep.cause)) {
                            affectedEpisodes++;
                            return { ...ep, cause: ruleMap.get(ep.cause) };
                        }
                        return ep;
                    }));
                    if (batchFields.updateDict) {
                        setSettings(prev => {
                            const currentCauses = prev.causes || [];
                            const updated = currentCauses.map(c => ruleMap.has(c) ? ruleMap.get(c) : c);
                            rules.forEach(r => { if (!updated.includes(r.newVal)) updated.push(r.newVal); });
                            return { ...prev, causes: Array.from(new Set(updated)) };
                        });
                        setFilterCauses(prev => {
                            const updated = prev.map(c => ruleMap.has(c) ? ruleMap.get(c) : c);
                            rules.forEach(r => { if (!updated.includes(r.newVal)) updated.push(r.newVal); });
                            return Array.from(new Set(updated));
                        });
                    }
                } else if (batchCategory === "ranks") {
                    setEpisodes(prev => prev.map(ep => {
                        if (ruleMap.has(ep.rank)) {
                            affectedEpisodes++;
                            return { ...ep, rank: ruleMap.get(ep.rank) };
                        }
                        return ep;
                    }));
                    setSoldiers(prev => prev.map(s => {
                        if (ruleMap.has(s.rank)) {
                            affectedSoldiers++;
                            return { ...s, rank: ruleMap.get(s.rank) };
                        }
                        return s;
                    }));
                    if (batchFields.updateDict) {
                        setSettings(prev => {
                            const currentRanks = prev.ranks || [];
                            const updated = currentRanks.map(r => ruleMap.has(r) ? ruleMap.get(r) : r);
                            rules.forEach(r => { if (!updated.includes(r.newVal)) updated.push(r.newVal); });
                            return { ...prev, ranks: Array.from(new Set(updated)) };
                        });
                    }
                }

                addLog("Пакетна заміна", `Виконано ${rules.length} правил(а) для категорії "${batchCategory}". Оновлено епізодів: ${affectedEpisodes}, бійців: ${affectedSoldiers}`);
                triggerNotification(`Пакетну заміну успішно виконано! (Оновлено: ${affectedEpisodes + affectedSoldiers} записів за ${rules.length} правилами)`, "success");
                setBatchMultiRows([{ id: 'row_' + Date.now(), oldVal: '', newVal: '' }]);
                setBatchMultiText("");
            };

            const triageEpisodes = useMemo(() => {
                let list = globalLatestEpisodes.filter(ep => ep.evacStatus === "Не евакуйований" && !isAwol(ep.lossType));

                if (filterLossTypes && filterLossTypes.length > 0) {
                    list = list.filter(ep => filterLossTypes.includes(ep.lossType));
                }

                if (searchTerm) {
                    const term = searchTerm.toLowerCase();
                    list = list.filter(ep => {
                        const soldier = MedicalPersonnelDirectory.forEpisode(ep, soldiersMap.get(ep.soldierId));
                        const searchStr = `${soldier?.name || ''} ${soldier?.callsign || ''} ${ep.actualLoc || ''} ${ep.unit || soldier?.unit || ''}`.toLowerCase();
                        return searchStr.includes(term);
                    });
                }

                if (listDateFrom || listDateTo) {
                    const fromMs = listDateFrom ? parseSafeDate(listDateFrom.includes(':') ? listDateFrom : `${listDateFrom} 00:00:00`) : 0;
                    const toMs = listDateTo ? parseSafeDate(listDateTo.includes(':') ? listDateTo : `${listDateTo} 23:59:59`) : 0;
                    list = list.filter(ep => {
                        const epTime = parseSafeDate(ep.date);
                        if (fromMs > 0 && epTime < fromMs) return false;
                        if (toMs > 0 && epTime > toMs) return false;
                        return true;
                    });
                }

                return list;
            }, [globalLatestEpisodes, soldiersMap, filterLossTypes, searchTerm, listDateFrom, listDateTo]);

            const triageCounts = useMemo(() => {
                let crit = 0, heavy = 0, med = 0, light = 0, dead = 0, mia = 0;
                triageEpisodes.forEach(ep => {
                    if (isAny200(ep.lossType)) {
                        dead++;
                    } else if (ep.lossType === 'Зниклий безвісти (ЗБВ)') {
                        mia++;
                    } else if (isAny300(ep.lossType)) {
                        if (ep.severity === 'Критичний') crit++;
                        else if (ep.severity === 'Важкий') heavy++;
                        else if (ep.severity === 'Середній') med++;
                        else light++;
                    } else {
                        dead++;
                    }
                });
                return { crit, heavy, med, light, dead, mia, other: dead };
            }, [triageEpisodes]);

            const quickEvacuate = (episode) => {
                saveHistory();
                const todayStrDate = new Date().toLocaleDateString('en-CA');
                const updated = { ...episode, evacStatus: 'Евакуйований', evacTime: todayStrDate };
                setEpisodes(prev => prev.map(ep => ep.id === episode.id ? updated : ep));
                const soldier = MedicalPersonnelDirectory.forEpisode(episode, soldiers.find(s => s.id === episode.soldierId));
                addLog("Евакуація", `Швидка евакуація підтверджена: ${soldier?.name} («${soldier?.callsign}»)` );
                triggerNotification("Евакуацію успішно оформлено");
            };

            const handleAlertMIA = () => {
                triggerNotification("Щоб евакуювати тіло ЗБВ, спершу змініть статус на 'Загибель (200)' через вікно редагування", "error");
            };

            const renderTriageCard = (ep) => (
                <TriageCard 
                    key={ep.id} 
                    ep={ep} 
                    soldier={soldiersMap.get(ep.soldierId)} 
                    soldierEpisodes={episodesBySoldier.get(ep.soldierId) || []}
                    onQuickEvac={quickEvacuate} 
                    onEdit={handleStartEdit} 
                    onAlertMIA={handleAlertMIA} 
                />
            );

            const locChartHeight = Math.max(300, chartData.actLocs.labels.length * 28);

            if (isLoading) {
                return (
                    <div className="flex-1 flex items-center justify-center bg-slate-950 text-slate-400">
                        <div className="text-center space-y-4">
                            <Icon name="loader-2" className="w-10 h-10 animate-spin mx-auto text-amber-500" />
                            <div className="font-mono text-sm uppercase font-bold tracking-widest text-slate-300">Завантаження бази...</div>
                        </div>
                    </div>
                );
            }

            return (
                <div id="med-app" className="min-h-full min-w-0 flex flex-col p-3 sm:p-6 w-full space-y-5">
                    
                    {/* Single Unified Modern Command Header */}
                    <header className="bg-slate-900/95 border border-slate-800/90 rounded-2xl p-3 sm:p-3.5 flex flex-col xl:flex-row items-stretch xl:items-center justify-between gap-3.5 shadow-2xl backdrop-blur-md">
                        
                        {/* 1. Ліва частина: Логотип + Бренд + Версія */}
                        <div className="flex items-center gap-3 shrink-0">
                            <div className="w-10 h-10 rounded-xl bg-red-500/10 border border-red-500/30 flex items-center justify-center text-red-400 shadow-inner shrink-0">
                                <Icon name="shield-alert" className="w-5 h-5" />
                            </div>
                            <div className="flex items-center gap-2 flex-wrap">
                                <h1 className="text-lg sm:text-xl font-bold text-white tracking-tight">MedTactical</h1>
                                <span className="text-[10px] bg-slate-950 text-red-400 border border-slate-800 px-2 py-0.5 rounded-md font-mono font-bold tracking-wider">
                                    COMBAT_MED
                                </span>
                                <button 
                                    onClick={() => setIsChangelogOpen(true)} 
                                    className="text-[11px] bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border border-amber-500/30 font-mono font-bold px-2 py-0.5 rounded-md transition-all cursor-pointer hover:scale-105 active:scale-95 shadow-sm" 
                                    title="Історія оновлень"
                                >
                                    ⚡ v3.6.0
                                </button>
                                <button
                                    onClick={() => setIsBackupOpen(true)}
                                    className={`text-[11px] font-mono font-bold px-2 py-0.5 rounded-md border transition-all cursor-pointer flex items-center gap-1.5 shadow-sm hover:scale-105 active:scale-95 ${
                                        diskServiceOnline 
                                            ? 'bg-emerald-950/60 hover:bg-emerald-900/60 text-emerald-300 border-emerald-700/60' 
                                            : 'bg-slate-900/80 hover:bg-slate-800 text-slate-400 border-slate-800'
                                    }`}
                                    title={diskServiceOnline ? `Служба бекапу активна на диску (_backups). ${lastDiskSaveTime ? 'Збережено: ' + lastDiskSaveTime : 'Готова'}` : 'Служба бекапу недоступна'}
                                >
                                    <span className={`w-1.5 h-1.5 rounded-full ${diskServiceOnline ? 'bg-emerald-400 animate-pulse' : 'bg-slate-500'}`}></span>
                                    <span>{diskServiceOnline ? (lastDiskSaveTime ? `Диск: ${lastDiskSaveTime}` : 'Диск: OK') : 'Диск: Офлайн'}</span>
                                </button>
                            </div>
                        </div>

                        {/* 2. Центральна частина: Преміальний Segmented Tabs Bar */}
                        <div className="flex items-center gap-1 bg-slate-950/90 border border-slate-800/90 p-1.5 rounded-xl shadow-inner overflow-x-auto self-start xl:self-center">
                            {/* Вкладка: Журнал */}
                            <button 
                                onClick={() => startTransition(() => setActiveTab("list"))} 
                                className={`px-3.5 py-1.5 rounded-lg transition-all flex items-center gap-2 text-xs font-semibold cursor-pointer select-none ${
                                    activeTab === "list" 
                                        ? "bg-slate-800 text-white border border-slate-700 shadow-sm" 
                                        : "text-slate-400 hover:text-slate-200 hover:bg-slate-900/60 border border-transparent"
                                }`}
                            >
                                <Icon name="list" className={`w-4 h-4 ${activeTab === "list" ? "text-amber-400" : "text-slate-400"}`} />
                                <span>Журнал</span>
                                <span className="px-1.5 py-0.2 rounded text-[10px] font-mono font-bold bg-slate-900 border border-slate-800 text-slate-300">
                                    {timeFilteredEpisodes.length}
                                </span>
                            </button>

                            {/* Вкладка: Черга евакуації */}
                            <button 
                                onClick={() => startTransition(() => setActiveTab("triage"))} 
                                className={`px-3.5 py-1.5 rounded-lg transition-all flex items-center gap-2 text-xs font-semibold cursor-pointer select-none ${
                                    activeTab === "triage" 
                                        ? "bg-slate-800 text-amber-300 border border-amber-500/50 shadow-sm" 
                                        : "text-slate-400 hover:text-amber-300 hover:bg-slate-900/60 border border-transparent"
                                }`}
                            >
                                <Icon name="clock-3" className={`w-4 h-4 ${activeTab === "triage" ? "text-amber-400" : "text-slate-400"}`} />
                                <span>Евакуація</span>
                                <div className="flex items-center gap-1 font-mono text-[10px]">
                                    {(triageCounts.crit + triageCounts.heavy + triageCounts.med + triageCounts.light) > 0 && (
                                        <span className="bg-amber-950/80 text-amber-300 border border-amber-800/80 px-1.5 py-0.2 rounded font-bold flex items-center gap-1 shadow-sm">
                                            <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse"></span>
                                            {triageCounts.crit + triageCounts.heavy + triageCounts.med + triageCounts.light} 300
                                        </span>
                                    )}
                                    {triageCounts.dead > 0 && (
                                        <span className="bg-zinc-900 text-zinc-300 border border-zinc-700/80 px-1.5 py-0.2 rounded font-bold shadow-sm">
                                            {triageCounts.dead} 200
                                        </span>
                                    )}
                                    {triageCounts.mia > 0 && (
                                        <span className="bg-blue-950/90 text-blue-300 border border-blue-800/80 px-1.5 py-0.2 rounded font-bold shadow-sm">
                                            {triageCounts.mia} ЗБВ
                                        </span>
                                    )}
                                    {triageEpisodes.length === 0 && <span className="text-slate-500 text-[10px]">0</span>}
                                </div>
                            </button>

                            {/* Вкладка: Аналітика */}
                            <button 
                                onClick={() => startTransition(() => setActiveTab("analytics"))} 
                                className={`px-3.5 py-1.5 rounded-lg transition-all flex items-center gap-2 text-xs font-semibold cursor-pointer select-none ${
                                    activeTab === "analytics" 
                                        ? "bg-slate-800 text-cyan-300 border border-cyan-500/50 shadow-sm" 
                                        : "text-slate-400 hover:text-slate-200 hover:bg-slate-900/60 border border-transparent"
                                }`}
                            >
                                <Icon name="bar-chart-3" className={`w-4 h-4 ${activeTab === "analytics" ? "text-cyan-400" : "text-slate-400"}`} />
                                <span>Аналітика</span>
                            </button>

                            {/* Вкладка: Лог */}
                            <button 
                                onClick={() => startTransition(() => setActiveTab("logs"))} 
                                className={`px-3.5 py-1.5 rounded-lg transition-all flex items-center gap-2 text-xs font-semibold cursor-pointer select-none ${
                                    activeTab === "logs" 
                                        ? "bg-slate-800 text-indigo-300 border border-indigo-500/50 shadow-sm" 
                                        : "text-slate-400 hover:text-slate-200 hover:bg-slate-900/60 border border-transparent"
                                }`}
                            >
                                <Icon name="history" className={`w-4 h-4 ${activeTab === "logs" ? "text-indigo-400" : "text-slate-400"}`} />
                                <span>Лог змін</span>
                            </button>
                        </div>

                        {/* 3. Права частина: Уніфіковані тактичні кнопки дій */}
                        <div className="flex items-center gap-2 flex-wrap">
                            {activeTab === "analytics" && (
                                <>
                                    <button 
                                        onClick={handleOpenPrintableReport} 
                                        className="px-3 py-2 bg-purple-950/80 hover:bg-purple-900/90 text-purple-300 font-semibold border border-purple-700/60 rounded-xl transition-all flex items-center gap-1.5 text-xs shadow-sm hover:shadow-purple-950/50 active:scale-95 cursor-pointer" 
                                        title="Згенерувати офіційне бойове донесення у форматі A4 для друку або збереження в PDF"
                                    >
                                        <Icon name="printer" className="w-3.5 h-3.5 text-purple-400" /> 
                                        <span>Доповідь (A4 / PDF)</span>
                                    </button>
                                    <button 
                                        onClick={handleExportAnalyticsText} 
                                        className="px-3 py-2 bg-blue-950/80 hover:bg-blue-900/90 text-blue-300 font-semibold border border-blue-700/60 rounded-xl transition-all flex items-center gap-1.5 text-xs shadow-sm hover:shadow-blue-950/50 active:scale-95 cursor-pointer" 
                                        title="Згенерувати текстовий звіт в буфер обміну"
                                    >
                                        <Icon name="file-text" className="w-3.5 h-3.5 text-blue-400" /> 
                                        <span>Звіт (Текст)</span>
                                    </button>
                                    <button 
                                        onClick={handleExportAnalyticsExcel} 
                                        className="px-3 py-2 bg-emerald-950/80 hover:bg-emerald-900/90 text-emerald-300 font-semibold border border-emerald-700/60 rounded-xl transition-all flex items-center gap-1.5 text-xs shadow-sm hover:shadow-emerald-950/50 active:scale-95 cursor-pointer" 
                                        title="Експорт в Excel з діаграмами"
                                    >
                                        <Icon name="table" className="w-3.5 h-3.5 text-emerald-400" /> 
                                        <span>Експорт (Excel)</span>
                                    </button>
                                </>
                            )}
                            
                            {/* Головна дія */}
                            <button 
                                onClick={() => handleOpenAddWounded(null)} 
                                className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold rounded-xl shadow-md hover:shadow-emerald-900/40 border border-emerald-500/40 transition-all flex items-center gap-1.5 text-xs cursor-pointer active:scale-95"
                            >
                                <Icon name="plus" className="w-4 h-4" /> 
                                <span>Створити запис</span>
                            </button>

                            {/* Допоміжні тактичні кнопки в єдиному стилі темного скла */}
                            <button 
                                onClick={() => { setBatchCategory("sectors"); setIsBatchReplaceOpen(true); }} 
                                className="px-3 py-2 bg-slate-950/80 hover:bg-slate-800 text-slate-300 hover:text-amber-300 border border-slate-800 hover:border-slate-700 rounded-xl transition-all text-xs font-semibold flex items-center gap-1.5 cursor-pointer shadow-sm active:scale-95" 
                                title="Масова заміна та перейменування позицій / підрозділів у всій базі"
                            >
                                <Icon name="repeat" className="w-3.5 h-3.5 text-amber-400" /> 
                                <span>Масова заміна</span>
                            </button>
                            
                            <button 
                                onClick={() => setIsSettingsOpen(true)} 
                                className="px-3 py-2 bg-slate-950/80 hover:bg-slate-800 text-slate-300 hover:text-white border border-slate-800 hover:border-slate-700 rounded-xl transition-all text-xs font-semibold flex items-center gap-1.5 cursor-pointer shadow-sm active:scale-95" 
                                title="Довідники (Причини, Звання, Підрозділи, Позиції)"
                            >
                                <Icon name="settings" className="w-3.5 h-3.5 text-slate-400" /> 
                                <span>Довідники</span>
                            </button>
                            
                            <button 
                                onClick={() => setIsBackupOpen(true)} 
                                className="px-3 py-2 bg-slate-950/80 hover:bg-slate-800 text-slate-300 hover:text-white border border-slate-800 hover:border-slate-700 rounded-xl transition-all text-xs font-semibold flex items-center gap-1.5 cursor-pointer shadow-sm active:scale-95" 
                                title="Управління базою, шифрований бекап AES-256"
                            >
                                <Icon name="shield-check" className="w-3.5 h-3.5 text-amber-400" /> 
                                <span>База / Бекап</span>
                            </button>
                        </div>
                    </header>

                    {notification && (
                        <div className="fixed top-20 right-6 z-[100] animate-in fade-in slide-in-from-top-4 duration-200">
                            <div className={`px-4 py-3 rounded-xl shadow-2xl border flex items-center gap-2.5 text-xs font-semibold ${notification.type === 'error' ? 'bg-red-950 border-red-700 text-red-200 shadow-red-950/50' : 'bg-slate-900 border-slate-700 text-slate-100 shadow-slate-950/50'}`}>
                                <Icon name={notification.type === 'error' ? 'alert-octagon' : 'check-circle'} className={`w-4 h-4 ${notification.type === 'error' ? 'text-red-400' : 'text-emerald-400'}`} />
                                <span>{notification.text}</span>
                            </div>
                        </div>
                    )}

                    <main className="flex-1 w-full flex flex-col gap-3">
                        {/* ГОРИЗОНТАЛЬНА ВЕРХНЯ ПАНЕЛЬ ФІЛЬТРІВ (ДЛЯ ЖУРНАЛУ ТА ТРІАЖУ) */}
                        {(activeTab === "list" || activeTab === "triage") && (
                            <div className="w-full bg-slate-900 border border-slate-800 rounded-2xl p-2 sm:p-2.5 shadow-lg flex items-center gap-2 flex-wrap">
                                
                                {/* Пошук */}
                                <div className="relative min-w-[150px] max-w-[200px] flex-1 sm:flex-initial">
                                    <input 
                                        id="global-search-input"
                                        type="text" 
                                        placeholder="Пошук... [Ctrl+F]" 
                                        value={searchTerm} 
                                        onChange={(e) => setSearchTerm(e.target.value)} 
                                        className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-7 pr-6 py-1 text-xs text-white placeholder-slate-500 focus:border-amber-500 outline-none transition-colors" 
                                    />
                                    <Icon name="search" className="w-3.5 h-3.5 text-slate-500 absolute left-2 top-2" />
                                    {searchTerm && (
                                        <button onClick={() => setSearchTerm("")} className="absolute right-1.5 top-1.5 text-slate-500 hover:text-white cursor-pointer" title="Очистити">
                                            <Icon name="x" className="w-3.5 h-3.5" />
                                        </button>
                                    )}
                                </div>

                                {/* Фільтр дат: Всі дати + Календар (діапазон) */}
                                <div className="flex items-center gap-0.5 bg-slate-950 p-0.5 rounded-xl border border-slate-800 text-xs font-mono">
                                    <button 
                                        type="button" 
                                        onClick={() => applyDatePreset('all')} 
                                        className={`px-2.5 py-1 rounded-lg transition cursor-pointer select-none text-[11px] ${datePreset === 'all' ? 'bg-amber-500/20 text-amber-300 font-bold border border-amber-500/40 shadow-sm' : 'text-slate-400 hover:text-white'}`}
                                    >
                                        Всі дати
                                    </button>

                                    {/* Точний період (календар-поповер) */}
                                    <div className="relative">
                                        <button 
                                            type="button" 
                                            onClick={() => setOpenDropdown(openDropdown === 'custom_date' ? null : 'custom_date')} 
                                            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg transition cursor-pointer select-none border text-[11px] ${datePreset === 'custom' ? 'bg-amber-500/20 text-amber-300 font-bold border-amber-500/40 shadow-sm' : 'border-transparent text-slate-400 hover:text-white'}`}
                                            title="Вибрати період дат у календарі"
                                        >
                                            <Icon name="calendar" className="w-3.5 h-3.5 text-amber-400" />
                                            <span>{datePreset === 'custom' && listDateFrom ? `${listDateFrom.slice(5)} — ${listDateTo ? listDateTo.slice(5) : '...'}` : 'Календар'}</span>
                                            <Icon name="chevron-down" className="w-2.5 h-2.5 text-slate-500" />
                                        </button>
                                        {openDropdown === 'custom_date' && (
                                            <>
                                                <div className="fixed inset-0 z-40 cursor-default" onClick={() => setOpenDropdown(null)}></div>
                                                <div className="absolute left-0 top-full mt-2 z-50 bg-slate-900 border border-slate-700/80 rounded-2xl shadow-2xl p-4 w-72 max-w-[calc(100vw-32px)] animate-in fade-in zoom-in-95 duration-150 space-y-3.5 font-sans">
                                                    <div className="flex justify-between items-center pb-2 border-b border-slate-800">
                                                        <span className="text-xs font-bold text-white flex items-center gap-1.5">
                                                            <Icon name="calendar" className="w-4 h-4 text-amber-400" />
                                                            <span>Період дат</span>
                                                        </span>
                                                        <button 
                                                            type="button" 
                                                            onClick={() => { applyDatePreset('all'); setOpenDropdown(null); }} 
                                                            className="text-[10px] text-amber-400 hover:text-amber-300 font-semibold cursor-pointer"
                                                        >
                                                            Скинути
                                                        </button>
                                                    </div>
                                                    <div className="space-y-2.5 text-xs">
                                                        <div>
                                                            <span className="text-[10px] font-bold text-slate-400 uppercase font-mono block mb-1">Від дати:</span>
                                                            <input 
                                                                type="date" 
                                                                value={listDateFrom} 
                                                                onChange={(e) => { setListDateFrom(e.target.value); setDatePreset('custom'); }} 
                                                                onClick={(e) => { try { e.target.showPicker(); } catch(err){} }}
                                                                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-2.5 py-1.5 text-xs text-white focus:border-amber-500 outline-none font-mono cursor-pointer" 
                                                            />
                                                        </div>
                                                        <div>
                                                            <span className="text-[10px] font-bold text-slate-400 uppercase font-mono block mb-1">До дати:</span>
                                                            <input 
                                                                type="date" 
                                                                value={listDateTo} 
                                                                onChange={(e) => { setListDateTo(e.target.value); setDatePreset('custom'); }} 
                                                                onClick={(e) => { try { e.target.showPicker(); } catch(err){} }}
                                                                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-2.5 py-1.5 text-xs text-white focus:border-amber-500 outline-none font-mono cursor-pointer" 
                                                            />
                                                        </div>
                                                    </div>
                                                    <div className="pt-2 border-t border-slate-800 flex justify-end">
                                                        <button 
                                                            type="button" 
                                                            onClick={() => setOpenDropdown(null)} 
                                                            className="w-full py-1.5 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs rounded-xl shadow transition cursor-pointer text-center"
                                                        >
                                                            Застосувати
                                                        </button>
                                                    </div>
                                                </div>
                                            </>
                                        )}
                                    </div>
                                </div>

                                {/* Дропдаун: Тип втрати */}
                                <FilterDropdown 
                                    title="Тип втрати" 
                                    count={filterLossTypes.length} 
                                    total={LOSS_TYPES.length} 
                                    isOpen={openDropdown === 'types'} 
                                    onToggle={() => setOpenDropdown(openDropdown === 'types' ? null : 'types')}
                                    onSelectAll={() => setFilterLossTypes([...LOSS_TYPES])}
                                    onClearAll={() => setFilterLossTypes([])}
                                >
                                    <CheckboxList 
                                        items={LOSS_TYPES} 
                                        selected={filterLossTypes} 
                                        toggle={(v) => toggleFilterItem(filterLossTypes, setFilterLossTypes, v)} 
                                        onSelectOnly={(v) => setFilterLossTypes([v])} 
                                    />
                                </FilterDropdown>

                                {/* Дропдаун: Евакуація / СЗЧ */}
                                <FilterDropdown 
                                    title="Евакуація" 
                                    count={filterEvacStatuses.length} 
                                    total={5} 
                                    isOpen={openDropdown === 'evac'} 
                                    onToggle={() => setOpenDropdown(openDropdown === 'evac' ? null : 'evac')}
                                    onSelectAll={() => setFilterEvacStatuses(["Не евакуйований", "Евакуйований", "Не потребує евакуації", "В розшуку", "Повернувся"])}
                                    onClearAll={() => setFilterEvacStatuses([])}
                                >
                                    <div className="flex gap-1 mb-2 p-1 bg-slate-950 rounded-lg border border-slate-800 text-[10px] font-mono">
                                        <button 
                                            type="button" 
                                            onClick={() => setFilterEvacStatuses(["Не евакуйований"])} 
                                            className="flex-1 py-1 rounded bg-red-950/40 hover:bg-red-900/60 text-red-300 font-semibold text-center cursor-pointer transition"
                                            title="Показати тільки тих, хто очікує на евакуацію"
                                        >
                                            ⏳ Очікують
                                        </button>
                                        <button 
                                            type="button" 
                                            onClick={() => setFilterEvacStatuses(["Евакуйований"])} 
                                            className="flex-1 py-1 rounded bg-emerald-950/40 hover:bg-emerald-900/60 text-emerald-300 font-semibold text-center cursor-pointer transition"
                                            title="Показати тільки евакуйованих"
                                        >
                                            ✅ Евакуйовані
                                        </button>
                                    </div>
                                    <CheckboxList 
                                        items={["Не евакуйований", "Евакуйований", "Не потребує евакуації", "В розшуку", "Повернувся"]} 
                                        selected={filterEvacStatuses} 
                                        toggle={(v) => toggleFilterItem(filterEvacStatuses, setFilterEvacStatuses, v)} 
                                        onSelectOnly={(v) => setFilterEvacStatuses([v])} 
                                        maxH={false} 
                                    />
                                </FilterDropdown>

                                {/* Поповер: Додаткові фільтри [ ⚙️ Інше ] */}
                                {(() => {
                                    const otherActiveCount = (
                                        (filterSeverities.length < 4 ? 1 : 0) +
                                        (filterCauses.length < settings.causes.length ? 1 : 0) +
                                        (filterInjuries.length > 0 ? 1 : 0) +
                                        (filterWeapon.length > 0 ? 1 : 0) +
                                        (filterReport !== 'all' ? 1 : 0) +
                                        (filterUdp !== 'all' ? 1 : 0)
                                    );
                                    return (
                                        <div className="relative">
                                            <button 
                                                type="button" 
                                                onClick={() => setOpenDropdown(openDropdown === 'other' ? null : 'other')} 
                                                className={`flex items-center gap-1 px-2.5 py-1.5 rounded-xl border text-xs font-semibold transition cursor-pointer select-none ${
                                                    otherActiveCount > 0
                                                        ? 'bg-amber-500/15 border-amber-500/50 text-amber-300'
                                                        : 'bg-slate-950/80 border-slate-800 text-slate-300 hover:text-white'
                                                }`}
                                            >
                                                <Icon name="sliders-horizontal" className="w-3.5 h-3.5" />
                                                <span>Інше</span>
                                                {otherActiveCount > 0 && (
                                                    <span className="w-4 h-4 rounded-full bg-amber-500 text-slate-950 font-bold text-[10px] flex items-center justify-center font-mono">
                                                        {otherActiveCount}
                                                    </span>
                                                )}
                                                <Icon name={openDropdown === 'other' ? 'chevron-up' : 'chevron-down'} className="w-3 h-3 text-slate-500" />
                                            </button>

                                            {openDropdown === 'other' && (
                                                <>
                                                    <div className="fixed inset-0 z-40 cursor-default" onClick={() => setOpenDropdown(null)}></div>
                                                    <div className="absolute right-0 top-full mt-2 z-50 bg-slate-900 border border-slate-700/80 rounded-2xl shadow-2xl p-4 w-[400px] max-w-[calc(100vw-32px)] animate-in fade-in zoom-in-95 duration-150 space-y-3.5 font-sans">
                                                        <div className="flex justify-between items-center pb-2.5 border-b border-slate-800">
                                                            <div className="flex items-center gap-1.5 font-bold text-xs text-white">
                                                                <Icon name="sliders-horizontal" className="w-3.5 h-3.5 text-amber-400" />
                                                                <span>Додаткові фільтри</span>
                                                            </div>
                                                            <button 
                                                                type="button"
                                                                onClick={() => {
                                                                    setFilterSeverities(["Легкий", "Середній", "Важкий", "Критичний"]);
                                                                    setFilterCauses(settings.causes);
                                                                    setFilterInjuries([]);
                                                                    setFilterWeapon([]);
                                                                    setFilterReport("all");
                                                                    setFilterUdp("all");
                                                                }}
                                                                className="text-[11px] text-amber-400 hover:text-amber-300 font-semibold cursor-pointer"
                                                            >
                                                                Скинути ці
                                                            </button>
                                                        </div>

                                                        {/* 1. Важкість стану */}
                                                        <div className="space-y-1.5">
                                                            <div className="flex justify-between items-center">
                                                                <span className="text-[10px] font-bold text-slate-400 uppercase font-mono">Важкість (300):</span>
                                                                <div className="flex gap-2 text-[10px] font-mono">
                                                                    <button type="button" onClick={() => setFilterSeverities(["Легкий", "Середній", "Важкий", "Критичний"])} className="text-amber-400 hover:underline">Всі</button>
                                                                    <button type="button" onClick={() => setFilterSeverities([])} className="text-slate-400 hover:underline">Зняти</button>
                                                                </div>
                                                            </div>
                                                            <div className="grid grid-cols-2 gap-1.5">
                                                                {["Легкий", "Середній", "Важкий", "Критичний"].map(sev => (
                                                                    <label key={sev} className="flex items-center gap-1.5 text-xs text-slate-300 bg-slate-950 px-2.5 py-1.5 rounded-lg border border-slate-800/80 cursor-pointer hover:text-white select-none">
                                                                        <input type="checkbox" checked={filterSeverities.includes(sev)} onChange={() => toggleFilterItem(filterSeverities, setFilterSeverities, sev)} className="rounded bg-slate-900 border-slate-700 text-amber-500 focus:ring-0 w-3.5 h-3.5 shrink-0"/>
                                                                        <span className="whitespace-nowrap">{sev}</span>
                                                                    </label>
                                                                ))}
                                                            </div>
                                                        </div>

                                                        {/* 2. Причина ураження */}
                                                        <div className="space-y-1.5">
                                                            <div className="flex justify-between items-center">
                                                                <span className="text-[10px] font-bold text-slate-400 uppercase font-mono">Причина ({filterCauses.length}/{settings.causes.length}):</span>
                                                                <div className="flex gap-2 text-[10px] font-mono">
                                                                    <button type="button" onClick={() => setFilterCauses(settings.causes)} className="text-amber-400 hover:underline">Всі</button>
                                                                    <button type="button" onClick={() => setFilterCauses([])} className="text-slate-400 hover:underline">Зняти</button>
                                                                </div>
                                                            </div>
                                                            <div className="max-h-28 overflow-y-auto space-y-1 pr-1 bg-slate-950 p-2 rounded-xl border border-slate-800/80">
                                                                {settings.causes.map(c => (
                                                                    <label key={c} className="flex items-center gap-2 text-xs text-slate-300 hover:text-white cursor-pointer select-none py-0.5">
                                                                        <input type="checkbox" checked={filterCauses.includes(c)} onChange={() => toggleFilterItem(filterCauses, setFilterCauses, c)} className="rounded bg-slate-900 border-slate-700 text-amber-500 focus:ring-0 w-3.5 h-3.5 shrink-0"/>
                                                                        <span className="whitespace-nowrap">{c}</span>
                                                                    </label>
                                                                ))}
                                                            </div>
                                                        </div>

                                                        {/* 3. Рапорт & УПД */}
                                                        <div className="grid grid-cols-2 gap-2">
                                                            <div className="space-y-1">
                                                                <span className="text-[10px] font-bold text-slate-400 uppercase font-mono">Рапорт:</span>
                                                                <select value={filterReport} onChange={(e) => setFilterReport(e.target.value)} className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2 py-1.5 text-xs text-white outline-none cursor-pointer">
                                                                    <option value="all">Всі випадки</option>
                                                                    <option value="yes">Складено</option>
                                                                    <option value="no">Без рапорту</option>
                                                                </select>
                                                            </div>
                                                            <div className="space-y-1">
                                                                <span className="text-[10px] font-bold text-slate-400 uppercase font-mono">УПД:</span>
                                                                <select value={filterUdp} onChange={(e) => setFilterUdp(e.target.value)} className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2 py-1.5 text-xs text-white outline-none cursor-pointer">
                                                                    <option value="all">Всі випадки</option>
                                                                    <option value="yes">Під час УПД</option>
                                                                    <option value="no">Без УПД</option>
                                                                </select>
                                                            </div>
                                                        </div>

                                                        {/* 4. Травми */}
                                                        <div className="space-y-1.5">
                                                            <div className="flex justify-between items-center">
                                                                <span className="text-[10px] font-bold text-slate-400 uppercase font-mono">Типи травм ({filterInjuries.length}):</span>
                                                                {filterInjuries.length > 0 && (
                                                                    <button type="button" onClick={() => setFilterInjuries([])} className="text-[10px] font-mono text-slate-400 hover:underline">Зняти</button>
                                                                )}
                                                            </div>
                                                            <div className="grid grid-cols-2 gap-1.5 max-h-28 overflow-y-auto bg-slate-950 p-2 rounded-xl border border-slate-800/80">
                                                                {[
                                                                    {k:'amputation', l:'Ампутація'}, {k:'rupture', l:'Розрив'}, {k:'shrapnel', l:'Уламкове'}, 
                                                                    {k:'bullet', l:'Кульове'}, {k:'fracture', l:'Перелом'}, {k:'burn', l:'Опік'}, 
                                                                    {k:'akbt', l:'АКБТ'}, {k:'contusion', l:'Забій'}
                                                                ].map(item => (
                                                                    <label key={item.k} className="flex items-center gap-1.5 text-xs text-slate-300 hover:text-white cursor-pointer select-none">
                                                                        <input type="checkbox" checked={filterInjuries.includes(item.k)} onChange={() => toggleFilterItem(filterInjuries, setFilterInjuries, item.k)} className="rounded bg-slate-900 border-slate-700 text-amber-500 focus:ring-0 w-3.5 h-3.5 shrink-0"/>
                                                                        <span className="whitespace-nowrap">{item.l}</span>
                                                                    </label>
                                                                ))}
                                                            </div>
                                                        </div>

                                                        {/* 5. Статус зброї */}
                                                        <div className="space-y-1.5">
                                                            <div className="flex justify-between items-center">
                                                                <span className="text-[10px] font-bold text-slate-400 uppercase font-mono">Статус зброї ({filterWeapon.length}):</span>
                                                                {filterWeapon.length > 0 && (
                                                                    <button type="button" onClick={() => setFilterWeapon([])} className="text-[10px] font-mono text-slate-400 hover:underline">Зняти</button>
                                                                )}
                                                            </div>
                                                            <div className="max-h-24 overflow-y-auto space-y-1 bg-slate-950 p-2 rounded-xl border border-slate-800/80">
                                                                {["втрачена", "знищена", "знаходиться у підрозділі", "знаходиться на позиції", "СЗЧ/Дезертирство зі зброєю", "Не вказано"].map(w => (
                                                                    <label key={w} className="flex items-center gap-1.5 text-xs text-slate-300 hover:text-white cursor-pointer select-none py-0.5">
                                                                        <input type="checkbox" checked={filterWeapon.includes(w)} onChange={() => toggleFilterItem(filterWeapon, setFilterWeapon, w)} className="rounded bg-slate-900 border-slate-700 text-amber-500 focus:ring-0 w-3.5 h-3.5 shrink-0"/>
                                                                        <span className="whitespace-nowrap">{w}</span>
                                                                    </label>
                                                                ))}
                                                            </div>
                                                        </div>

                                                        <div className="pt-2 border-t border-slate-800 flex justify-end">
                                                            <button 
                                                                type="button" 
                                                                onClick={() => setOpenDropdown(null)} 
                                                                className="w-full py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs rounded-xl shadow transition cursor-pointer text-center"
                                                            >
                                                                Застосувати
                                                            </button>
                                                        </div>
                                                    </div>
                                                </>
                                            )}
                                        </div>
                                    );
                                })()}

                                {/* Дропдаун: Сортування списку */}
                                {activeTab === "list" && (
                                    <div className="relative">
                                        <button 
                                            type="button" 
                                            onClick={() => setOpenDropdown(openDropdown === 'sort' ? null : 'sort')} 
                                            className={`flex items-center gap-1 px-2.5 py-1.5 rounded-xl border text-xs font-semibold transition cursor-pointer select-none ${
                                                sortBy.startsWith('evac') 
                                                    ? 'bg-emerald-950/70 border-emerald-500/50 text-emerald-300 shadow-sm' 
                                                    : sortBy !== 'date_desc' 
                                                        ? 'bg-amber-500/15 border-amber-500/50 text-amber-300 shadow-sm' 
                                                        : 'bg-slate-950/80 border-slate-800 text-slate-300 hover:text-white'
                                            }`}
                                            title="Сортування списку втрат"
                                        >
                                            <Icon name="arrow-up-down" className={`w-3.5 h-3.5 ${sortBy.startsWith('evac') ? 'text-emerald-400' : 'text-amber-400'}`} />
                                            <span className="font-bold text-[11px]">
                                                {sortBy === 'evac_desc' && '🚑 Евак ↓'}
                                                {sortBy === 'evac_asc' && '🚑 Евак ↑'}
                                                {sortBy === 'date_desc' && '⏱️ Подія ↓'}
                                                {sortBy === 'date_asc' && '⏱️ Подія ↑'}
                                                {sortBy === 'name_asc' && '👤 А → Я'}
                                                {sortBy === 'name_desc' && '👤 Я → А'}
                                                {sortBy === 'severity_desc' && '🚨 Важкість ↓'}
                                            </span>
                                            <Icon name={openDropdown === 'sort' ? 'chevron-up' : 'chevron-down'} className="w-3 h-3 text-slate-500" />
                                        </button>

                                        {openDropdown === 'sort' && (
                                            <>
                                                <div className="fixed inset-0 z-40 cursor-default" onClick={() => setOpenDropdown(null)}></div>
                                                <div className="absolute right-0 top-full mt-2 z-50 bg-slate-900 border border-slate-700/80 rounded-2xl shadow-2xl p-2 w-64 max-w-[calc(100vw-32px)] animate-in fade-in zoom-in-95 duration-150 space-y-1 font-sans">
                                                    <div className="px-2.5 py-1.5 text-[10px] font-mono uppercase font-bold text-slate-400 border-b border-slate-800 flex items-center justify-between">
                                                        <span>Оберіть сортування</span>
                                                    </div>
                                                    
                                                    <div className="pt-1 space-y-0.5 text-xs">
                                                        <button 
                                                            type="button" 
                                                            onClick={() => { setSortBy('evac_desc'); setOpenDropdown(null); }}
                                                            className={`w-full text-left px-2.5 py-2 rounded-xl flex items-center justify-between transition cursor-pointer ${sortBy === 'evac_desc' ? 'bg-emerald-950/80 text-emerald-300 font-bold border border-emerald-800/60' : 'text-slate-300 hover:bg-slate-800 hover:text-white'}`}
                                                        >
                                                            <span className="flex items-center gap-2">
                                                                <span className="text-emerald-400">🚑</span>
                                                                <span>Дата евакуації (новіші зверху)</span>
                                                            </span>
                                                            {sortBy === 'evac_desc' && <Icon name="check" className="w-3.5 h-3.5 text-emerald-400" />}
                                                        </button>

                                                        <button 
                                                            type="button" 
                                                            onClick={() => { setSortBy('evac_asc'); setOpenDropdown(null); }}
                                                            className={`w-full text-left px-2.5 py-2 rounded-xl flex items-center justify-between transition cursor-pointer ${sortBy === 'evac_asc' ? 'bg-emerald-950/80 text-emerald-300 font-bold border border-emerald-800/60' : 'text-slate-300 hover:bg-slate-800 hover:text-white'}`}
                                                        >
                                                            <span className="flex items-center gap-2">
                                                                <span className="text-emerald-400">🚑</span>
                                                                <span>Дата евакуації (старіші зверху)</span>
                                                            </span>
                                                            {sortBy === 'evac_asc' && <Icon name="check" className="w-3.5 h-3.5 text-emerald-400" />}
                                                        </button>

                                                        <div className="my-1 border-t border-slate-800/60"></div>

                                                        <button 
                                                            type="button" 
                                                            onClick={() => { setSortBy('date_desc'); setOpenDropdown(null); }}
                                                            className={`w-full text-left px-2.5 py-2 rounded-xl flex items-center justify-between transition cursor-pointer ${sortBy === 'date_desc' ? 'bg-amber-500/20 text-amber-300 font-bold border border-amber-500/40' : 'text-slate-300 hover:bg-slate-800 hover:text-white'}`}
                                                        >
                                                            <span className="flex items-center gap-2">
                                                                <span className="text-amber-400">⏱️</span>
                                                                <span>Дата події (новіші зверху)</span>
                                                            </span>
                                                            {sortBy === 'date_desc' && <Icon name="check" className="w-3.5 h-3.5 text-amber-400" />}
                                                        </button>

                                                        <button 
                                                            type="button" 
                                                            onClick={() => { setSortBy('date_asc'); setOpenDropdown(null); }}
                                                            className={`w-full text-left px-2.5 py-2 rounded-xl flex items-center justify-between transition cursor-pointer ${sortBy === 'date_asc' ? 'bg-amber-500/20 text-amber-300 font-bold border border-amber-500/40' : 'text-slate-300 hover:bg-slate-800 hover:text-white'}`}
                                                        >
                                                            <span className="flex items-center gap-2">
                                                                <span className="text-amber-400">⏱️</span>
                                                                <span>Дата події (старіші зверху)</span>
                                                            </span>
                                                            {sortBy === 'date_asc' && <Icon name="check" className="w-3.5 h-3.5 text-amber-400" />}
                                                        </button>

                                                        <div className="my-1 border-t border-slate-800/60"></div>

                                                        <button 
                                                            type="button" 
                                                            onClick={() => { setSortBy('severity_desc'); setOpenDropdown(null); }}
                                                            className={`w-full text-left px-2.5 py-2 rounded-xl flex items-center justify-between transition cursor-pointer ${sortBy === 'severity_desc' ? 'bg-purple-950/80 text-purple-300 font-bold border border-purple-800/60' : 'text-slate-300 hover:bg-slate-800 hover:text-white'}`}
                                                        >
                                                            <span className="flex items-center gap-2">
                                                                <span className="text-purple-400">🚨</span>
                                                                <span>Важкість (Критичні → Легкі)</span>
                                                            </span>
                                                            {sortBy === 'severity_desc' && <Icon name="check" className="w-3.5 h-3.5 text-purple-400" />}
                                                        </button>

                                                        <button 
                                                            type="button" 
                                                            onClick={() => { setSortBy('name_asc'); setOpenDropdown(null); }}
                                                            className={`w-full text-left px-2.5 py-2 rounded-xl flex items-center justify-between transition cursor-pointer ${sortBy === 'name_asc' ? 'bg-blue-950/80 text-blue-300 font-bold border border-blue-800/60' : 'text-slate-300 hover:bg-slate-800 hover:text-white'}`}
                                                        >
                                                            <span className="flex items-center gap-2">
                                                                <span className="text-blue-400">👤</span>
                                                                <span>ПІБ бійця (А → Я)</span>
                                                            </span>
                                                            {sortBy === 'name_asc' && <Icon name="check" className="w-3.5 h-3.5 text-blue-400" />}
                                                        </button>

                                                        <button 
                                                            type="button" 
                                                            onClick={() => { setSortBy('name_desc'); setOpenDropdown(null); }}
                                                            className={`w-full text-left px-2.5 py-2 rounded-xl flex items-center justify-between transition cursor-pointer ${sortBy === 'name_desc' ? 'bg-blue-950/80 text-blue-300 font-bold border border-blue-800/60' : 'text-slate-300 hover:bg-slate-800 hover:text-white'}`}
                                                        >
                                                            <span className="flex items-center gap-2">
                                                                <span className="text-blue-400">👤</span>
                                                                <span>ПІБ бійця (Я → А)</span>
                                                            </span>
                                                            {sortBy === 'name_desc' && <Icon name="check" className="w-3.5 h-3.5 text-blue-400" />}
                                                        </button>
                                                    </div>
                                                </div>
                                            </>
                                        )}
                                    </div>
                                )}

                                {/* РЯДОК 2: Зведена статистика + Записів + Актуальні & Скинути */}
                                <div className="w-full flex items-center justify-between gap-2 border-t border-slate-800/60 pt-2 flex-wrap">
                                    {/* Зведена швидка статистика */}
                                    <div className="flex items-center gap-2 bg-slate-950 px-2.5 py-1 rounded-xl border border-slate-800 text-xs shadow-inner">
                                        <span className="text-slate-300 text-xs font-semibold flex items-center gap-1" title="Унікальних військових у базі">
                                            <Icon name="users" className="w-3.5 h-3.5 text-slate-400" />
                                            <span className="font-mono text-slate-200 font-bold">{stats.uniqueSoldiersCount}</span>
                                            <span className="text-slate-500 text-[10px]">в/сл</span>
                                        </span>
                                        <span className="text-slate-700 font-mono">|</span>
                                        <span className="text-slate-300 text-xs flex items-center gap-1 font-mono" title="Загибель (200)">
                                            <span className="text-slate-400 font-sans text-[10px] font-semibold">200:</span>
                                            <span className="text-slate-200 font-bold">{stats.deadCount}</span>
                                        </span>
                                        <span className="text-slate-700 font-mono">|</span>
                                        <span className="text-blue-300 text-xs flex items-center gap-1 font-mono" title="Зниклі безвісти (ЗБВ)">
                                            <span className="text-blue-400 font-sans text-[10px] font-semibold">ЗБВ:</span>
                                            <span className="text-blue-200 font-bold">{stats.miaCount}</span>
                                        </span>
                                        <span className="text-slate-700 font-mono">|</span>
                                        <span className="text-fuchsia-300 text-xs flex items-center gap-1 font-mono" title="СЗЧ / Дезертирство">
                                            <span className="text-fuchsia-400 font-sans text-[10px] font-semibold">СЗЧ:</span>
                                            <span className="text-fuchsia-200 font-bold">{stats.awolCount}</span>
                                        </span>
                                    </div>

                                    <div className="flex items-center gap-2 flex-wrap">
                                        {activeTab === "list" && (
                                            <div className="flex items-center gap-1.5 bg-slate-950 px-2.5 py-1.5 rounded-xl border border-slate-800 text-xs text-slate-300 shadow-inner" title="Кількість відфільтрованих записів">
                                                <Icon name="list-filter" className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                                                <span className="text-[11px] text-slate-400 font-medium hidden sm:inline">Записів:</span>
                                                <span className="text-amber-400 font-mono font-bold text-xs">
                                                    {filteredList.length > displayLimit ? `${visibleList.length} з ${filteredList.length}` : filteredList.length}
                                                </span>
                                            </div>
                                        )}

                                        <label className="flex items-center gap-1.5 cursor-pointer text-slate-300 hover:text-white bg-slate-950 px-2.5 py-1.5 rounded-xl border border-slate-800 text-xs select-none" title="Показувати тільки один (останній) актуальний стан бійця">
                                            <input type="checkbox" checked={showOnlyLatest} onChange={(e) => setShowOnlyLatest(e.target.checked)} className="rounded bg-slate-900 border-slate-700 text-amber-500 focus:ring-0 w-3.5 h-3.5 cursor-pointer"/>
                                            <span className="font-medium text-[11px]">Актуальні</span>
                                        </label>

                                        <button 
                                            type="button" 
                                            onClick={resetAllFilters} 
                                            className="px-2.5 py-1.5 bg-slate-950 hover:bg-slate-800 text-slate-400 hover:text-white text-xs font-semibold rounded-xl border border-slate-800 transition cursor-pointer flex items-center gap-1"
                                            title="Скинути всі фільтри"
                                        >
                                            <Icon name="rotate-ccw" className="w-3 h-3" />
                                            <span>Скинути</span>
                                        </button>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* ТАБ: ЖУРНАЛ */}
                        {activeTab === "list" && (
                            <div className="w-full space-y-3">
                                {filteredList.length === 0 ? (
                                    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-12 text-center text-slate-500 text-sm shadow-xl">Жодного запису не знайдено за вказаними фільтрами</div>
                                ) : (
                                    <>
                                        <div className="space-y-2.5">
                                            {visibleList.map((episode) => (
                                                <EpisodeCard 
                                                    key={episode.id} 
                                                    episode={episode} 
                                                    soldier={soldiersMap.get(episode.soldierId)} 
                                                    soldierEpisodes={episodesBySoldier.get(episode.soldierId) || []}
                                                    onEdit={handleStartEdit}
                                                    onNotify={triggerNotification}
                                                    viewMode="list"
                                                />
                                            ))}
                                        </div>

                                        {/* Панель порційного підвантаження записів */}
                                        {filteredList.length > displayLimit && (
                                            <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-3 pb-2">
                                                <button
                                                    type="button"
                                                    onClick={() => setDisplayLimit(prev => prev + 50)}
                                                    className="px-5 py-2.5 bg-slate-900 hover:bg-slate-800 border border-slate-700 hover:border-amber-500 text-slate-200 hover:text-amber-300 font-bold text-xs rounded-xl shadow-lg transition-all flex items-center gap-2 cursor-pointer active:scale-95"
                                                >
                                                    <Icon name="chevron-down" className="w-4 h-4 text-amber-400" />
                                                    <span>Показати ще 50 записів (залишилось {filteredList.length - displayLimit})</span>
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => setDisplayLimit(filteredList.length)}
                                                    className="px-4 py-2.5 bg-slate-950 hover:bg-slate-900 border border-slate-800 text-slate-400 hover:text-slate-200 font-medium text-xs rounded-xl transition cursor-pointer"
                                                >
                                                    <span>Показати всі ({filteredList.length})</span>
                                                </button>
                                            </div>
                                        )}
                                    </>
                                )}
                            </div>
                        )}

                        {/* ТАБ: ЧЕРГА ЕВАКУАЦІЇ (TRIAGE) */}
                        {activeTab === "triage" && (() => {
                            const critAndHeavyList = triageEpisodes.filter(ep => isAny300(ep.lossType) && (ep.severity === 'Критичний' || ep.severity === 'Важкий'));
                            const medList = triageEpisodes.filter(ep => isAny300(ep.lossType) && ep.severity === 'Середній');
                            const lightList = triageEpisodes.filter(ep => isAny300(ep.lossType) && (ep.severity === 'Легкий' || !ep.severity));
                            const all300List = [].concat(critAndHeavyList, medList, lightList);
                            const otherList = triageEpisodes.filter(ep => isAny200(ep.lossType) || ep.lossType === 'Зниклий безвісти (ЗБВ)');

                            const copyGroupList = (list, titleLabel) => {
                                if (!list || list.length === 0) return;
                                const lines = list.map((ep, idx) => {
                                    const sol = MedicalPersonnelDirectory.forEpisode(ep, soldiersMap.get(ep.soldierId));
                                    return formatSoldierReportLine(ep, sol, idx + 1);
                                });
                                const header = titleLabel ? `${titleLabel} (${list.length} осіб):\n` : '';
                                const fullText = header + lines.join('\n\n');
                                
                                const onDone = () => {
                                    triggerNotification(`Скопійовано ${list.length} записів (${titleLabel || 'список'})!`, "success");
                                };

                                if (navigator?.clipboard?.writeText) {
                                    navigator.clipboard.writeText(fullText).then(onDone).catch(() => {
                                        const ta = document.createElement('textarea');
                                        ta.value = fullText;
                                        document.body.appendChild(ta);
                                        ta.select();
                                        document.execCommand('copy');
                                        document.body.removeChild(ta);
                                        onDone();
                                    });
                                } else {
                                    const ta = document.createElement('textarea');
                                    ta.value = fullText;
                                    document.body.appendChild(ta);
                                    ta.select();
                                    document.execCommand('copy');
                                    document.body.removeChild(ta);
                                    onDone();
                                }
                            };

                            return (
                                <div className="flex-1 w-full space-y-4 pb-6">
                                    {/* ВЕРХНЯ ШВИДКА ПАНЕЛЬ ДОПОВІДЕЙ ЕВАКУАЦІЇ */}
                                    <div className="w-full bg-slate-900 border border-slate-800/90 rounded-2xl p-3 shadow-lg flex items-center justify-between gap-3 flex-wrap">
                                        <div className="flex items-center gap-2 font-bold text-xs uppercase text-amber-400 font-mono tracking-wider">
                                            <Icon name="clipboard" className="w-4 h-4 text-amber-400" />
                                            <span>Швидкі доповіді:</span>
                                        </div>

                                        <div className="flex items-center gap-2.5 flex-wrap">
                                            {/* Кнопка: Всі 300-ті */}
                                            <button 
                                                type="button" 
                                                onClick={() => copyGroupList(all300List, 'ЧЕРГА ЕВАКУАЦІЇ 300 (ПОРАНЕНІ)')}
                                                disabled={all300List.length === 0}
                                                className={`px-3.5 py-1.5 rounded-xl border flex items-center gap-2 text-xs font-bold transition-all shadow-sm active:scale-95 ${
                                                    all300List.length === 0
                                                        ? 'bg-slate-950/50 text-slate-600 border-slate-800 cursor-not-allowed opacity-50'
                                                        : 'bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 hover:text-amber-200 border-amber-500/50 hover:border-amber-500 cursor-pointer shadow-amber-950/40'
                                                }`}
                                                title="Скопіювати пронумерований список усіх поранених (Червона + Жовта + Зелена зони)"
                                            >
                                                <Icon name="activity" className="w-3.5 h-3.5 text-amber-400" />
                                                <span>📋 Скопіювати всіх 300-х ({all300List.length})</span>
                                            </button>

                                            {/* Кнопка: Всі 200-ті / ЗБВ */}
                                            <button 
                                                type="button" 
                                                onClick={() => copyGroupList(otherList, 'ЗАГИБЛІ ТА ЗБВ (ЧОРНА ЗОНА)')}
                                                disabled={otherList.length === 0}
                                                className={`px-3.5 py-1.5 rounded-xl border flex items-center gap-2 text-xs font-bold transition-all shadow-sm active:scale-95 ${
                                                    otherList.length === 0
                                                        ? 'bg-slate-950/50 text-slate-600 border-slate-800 cursor-not-allowed opacity-50'
                                                        : 'bg-slate-950 hover:bg-slate-800 text-slate-300 hover:text-white border-slate-700 hover:border-slate-500 cursor-pointer shadow-slate-950/40'
                                                }`}
                                                title="Скопіювати пронумерований список полеглих та ЗБВ на позиціях (Чорна зона)"
                                            >
                                                <Icon name="shield-alert" className="w-3.5 h-3.5 text-slate-400" />
                                                <span>📋 Скопіювати всіх 200-х / ЗБВ ({otherList.length})</span>
                                            </button>
                                        </div>
                                    </div>

                                    {/* 4 ЗОНИ СОРТУВАННЯ */}
                                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-5 items-start">
                                        
                                        {/* 1. ЧЕРВОНА ЗОНА */}
                                        <div className="bg-slate-900/95 rounded-2xl border border-red-900/50 shadow-xl flex flex-col min-h-[360px] overflow-hidden">
                                            <div className="p-3.5 border-b border-red-900/50 bg-gradient-to-r from-red-950/80 via-red-900/30 to-slate-900 flex items-center justify-between">
                                                <div className="flex items-center gap-2 font-bold text-red-400 text-xs tracking-wider uppercase font-mono">
                                                    <div className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse shadow-md shadow-red-500/50"></div>
                                                    <span>ЧЕРВОНА ЗОНА</span>
                                                    <span className="bg-red-500/20 text-red-300 border border-red-500/40 px-1.5 py-0.2 rounded font-mono text-[10px] font-bold">
                                                        {critAndHeavyList.length}
                                                    </span>
                                                </div>
                                                <div className="flex items-center gap-1.5">
                                                    {critAndHeavyList.length > 0 && (
                                                        <button 
                                                            type="button" 
                                                            onClick={() => copyGroupList(critAndHeavyList, 'ЧЕРВОНА ЗОНА (КРИТИЧНІ / ВАЖКІ)')}
                                                            className="p-1 rounded-lg bg-red-950 hover:bg-red-900/60 text-red-300 border border-red-800/80 transition cursor-pointer" 
                                                            title="Скопіювати список бійців Червоної зони"
                                                        >
                                                            <Icon name="copy" className="w-3.5 h-3.5" />
                                                        </button>
                                                    )}
                                                    <span className="text-[10px] text-red-300 font-mono font-bold bg-red-950/80 px-2 py-0.5 rounded-lg border border-red-800/80 shadow-inner">
                                                        Критичні / Важкі
                                                    </span>
                                                </div>
                                            </div>
                                            <div className="p-3 flex-1 overflow-y-auto space-y-3">
                                                {critAndHeavyList.map(renderTriageCard)}
                                                {critAndHeavyList.length === 0 && (
                                                    <div className="text-center text-slate-500 text-xs py-14 font-mono flex flex-col items-center gap-1.5">
                                                        <Icon name="shield-check" className="w-6 h-6 text-slate-600" />
                                                        <span>Порожньо</span>
                                                    </div>
                                                )}
                                            </div>
                                        </div>

                                        {/* 2. ЖОВТА ЗОНА */}
                                        <div className="bg-slate-900/95 rounded-2xl border border-amber-900/50 shadow-xl flex flex-col min-h-[360px] overflow-hidden">
                                            <div className="p-3.5 border-b border-amber-900/50 bg-gradient-to-r from-amber-950/80 via-amber-900/30 to-slate-900 flex items-center justify-between">
                                                <div className="flex items-center gap-2 font-bold text-amber-400 text-xs tracking-wider uppercase font-mono">
                                                    <div className="w-2.5 h-2.5 rounded-full bg-amber-500 shadow-md shadow-amber-500/50"></div>
                                                    <span>ЖОВТА ЗОНА</span>
                                                    <span className="bg-amber-500/20 text-amber-300 border border-amber-500/40 px-1.5 py-0.2 rounded font-mono text-[10px] font-bold">
                                                        {medList.length}
                                                    </span>
                                                </div>
                                                <div className="flex items-center gap-1.5">
                                                    {medList.length > 0 && (
                                                        <button 
                                                            type="button" 
                                                            onClick={() => copyGroupList(medList, 'ЖОВТА ЗОНА (СЕРЕДНІ)')}
                                                            className="p-1 rounded-lg bg-amber-950 hover:bg-amber-900/60 text-amber-300 border border-amber-800/80 transition cursor-pointer" 
                                                            title="Скопіювати список бійців Жовтої зони"
                                                        >
                                                            <Icon name="copy" className="w-3.5 h-3.5" />
                                                        </button>
                                                    )}
                                                    <span className="text-[10px] text-amber-300 font-mono font-bold bg-amber-950/80 px-2 py-0.5 rounded-lg border border-amber-800/80 shadow-inner">
                                                        Середні
                                                    </span>
                                                </div>
                                            </div>
                                            <div className="p-3 flex-1 overflow-y-auto space-y-3">
                                                {medList.map(renderTriageCard)}
                                                {medList.length === 0 && (
                                                    <div className="text-center text-slate-500 text-xs py-14 font-mono flex flex-col items-center gap-1.5">
                                                        <Icon name="shield-check" className="w-6 h-6 text-slate-600" />
                                                        <span>Порожньо</span>
                                                    </div>
                                                )}
                                            </div>
                                        </div>

                                        {/* 3. ЗЕЛЕНА ЗОНА */}
                                        <div className="bg-slate-900/95 rounded-2xl border border-emerald-900/50 shadow-xl flex flex-col min-h-[360px] overflow-hidden">
                                            <div className="p-3.5 border-b border-emerald-900/50 bg-gradient-to-r from-emerald-950/80 via-emerald-900/30 to-slate-900 flex items-center justify-between">
                                                <div className="flex items-center gap-2 font-bold text-emerald-400 text-xs tracking-wider uppercase font-mono">
                                                    <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 shadow-md shadow-emerald-500/50"></div>
                                                    <span>ЗЕЛЕНА ЗОНА</span>
                                                    <span className="bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 px-1.5 py-0.2 rounded font-mono text-[10px] font-bold">
                                                        {lightList.length}
                                                    </span>
                                                </div>
                                                <div className="flex items-center gap-1.5">
                                                    {lightList.length > 0 && (
                                                        <button 
                                                            type="button" 
                                                            onClick={() => copyGroupList(lightList, 'ЗЕЛЕНА ЗОНА (ЛЕГКІ)')}
                                                            className="p-1 rounded-lg bg-emerald-950 hover:bg-emerald-900/60 text-emerald-300 border border-emerald-800/80 transition cursor-pointer" 
                                                            title="Скопіювати список бійців Зеленої зони"
                                                        >
                                                            <Icon name="copy" className="w-3.5 h-3.5" />
                                                        </button>
                                                    )}
                                                    <span className="text-[10px] text-emerald-300 font-mono font-bold bg-emerald-950/80 px-2 py-0.5 rounded-lg border border-emerald-800/80 shadow-inner">
                                                        Легкі
                                                    </span>
                                                </div>
                                            </div>
                                            <div className="p-3 flex-1 overflow-y-auto space-y-3">
                                                {lightList.map(renderTriageCard)}
                                                {lightList.length === 0 && (
                                                    <div className="text-center text-slate-500 text-xs py-14 font-mono flex flex-col items-center gap-1.5">
                                                        <Icon name="shield-check" className="w-6 h-6 text-slate-600" />
                                                        <span>Порожньо</span>
                                                    </div>
                                                )}
                                            </div>
                                        </div>

                                        {/* 4. ЧОРНА ЗОНА */}
                                        <div className="bg-slate-900/95 rounded-2xl border border-slate-800 shadow-xl flex flex-col min-h-[360px] overflow-hidden">
                                            <div className="p-3.5 border-b border-slate-800 bg-gradient-to-r from-slate-950 via-slate-900 to-slate-900 flex items-center justify-between">
                                                <div className="flex items-center gap-2 font-bold text-slate-400 text-xs tracking-wider uppercase font-mono">
                                                    <div className="w-2.5 h-2.5 rounded-full bg-zinc-500 shadow-md shadow-zinc-500/50"></div>
                                                    <span>ЧОРНА ЗОНА</span>
                                                    <span className="bg-zinc-800 text-zinc-300 border border-zinc-700 px-1.5 py-0.2 rounded font-mono text-[10px] font-bold">
                                                        {otherList.length}
                                                    </span>
                                                </div>
                                                <div className="flex items-center gap-1.5">
                                                    {otherList.length > 0 && (
                                                        <button 
                                                            type="button" 
                                                            onClick={() => copyGroupList(otherList, 'ЧОРНА ЗОНА (ЗАГИБЛІ / ЗБВ)')}
                                                            className="p-1 rounded-lg bg-slate-950 hover:bg-slate-800 text-slate-300 border border-slate-700 transition cursor-pointer" 
                                                            title="Скопіювати список полеглих та ЗБВ Чорної зони"
                                                        >
                                                            <Icon name="copy" className="w-3.5 h-3.5" />
                                                        </button>
                                                    )}
                                                    <span className="text-[10px] text-slate-400 font-mono font-bold bg-slate-950 border border-slate-800 px-2 py-0.5 rounded-lg shadow-inner">
                                                        200 / ЗБВ
                                                    </span>
                                                </div>
                                            </div>
                                            <div className="p-3 flex-1 overflow-y-auto space-y-3">
                                                {otherList.map(renderTriageCard)}
                                                {otherList.length === 0 && (
                                                    <div className="text-center text-slate-500 text-xs py-14 font-mono flex flex-col items-center gap-1.5">
                                                        <Icon name="shield-check" className="w-6 h-6 text-slate-600" />
                                                        <span>Порожньо</span>
                                                    </div>
                                                )}
                                            </div>
                                        </div>

                                    </div>
                                </div>
                            );
                        })()}

                        {/* ТАБ: АНАЛІТИКА */}
                        {activeTab === "analytics" && (
                            <div className="flex-1 w-full space-y-5 pb-6">
                                
                                {/* ПАНЕЛЬ ФІЛЬТРІВ ТА ПЕРІОДУ АНАЛІТИКИ */}
                                <div className="w-full bg-slate-900 border border-slate-800 rounded-2xl p-3 shadow-lg flex items-center justify-between gap-3 flex-wrap">
                                    <div className="flex items-center gap-3 flex-wrap">
                                        <div className="flex items-center gap-1.5 font-bold text-xs uppercase text-cyan-400 font-mono tracking-wider">
                                            <Icon name="bar-chart-2" className="w-4 h-4 text-cyan-400" />
                                            <span>Аналітика:</span>
                                        </div>

                                        {/* Швидкі пресети періоду дат */}
                                        <div className="flex items-center bg-slate-950 p-1 rounded-xl border border-slate-800 text-xs font-medium">
                                            <button 
                                                type="button" 
                                                onClick={() => applyAnDatePreset('all')} 
                                                className={`px-2.5 py-1 rounded-lg transition cursor-pointer select-none ${anDatePreset === 'all' ? 'bg-cyan-500/20 text-cyan-300 font-bold border border-cyan-500/40 shadow-sm' : 'text-slate-400 hover:text-white'}`}
                                            >
                                                Всі дати
                                            </button>
                                            <button 
                                                type="button" 
                                                onClick={() => applyAnDatePreset('1')} 
                                                className={`px-2.5 py-1 rounded-lg transition cursor-pointer select-none ${anDatePreset === '1' ? 'bg-cyan-500/20 text-cyan-300 font-bold border border-cyan-500/40 shadow-sm' : 'text-slate-400 hover:text-white'}`}
                                            >
                                                За добу
                                            </button>
                                            <button 
                                                type="button" 
                                                onClick={() => applyAnDatePreset('3')} 
                                                className={`px-2.5 py-1 rounded-lg transition cursor-pointer select-none ${anDatePreset === '3' ? 'bg-cyan-500/20 text-cyan-300 font-bold border border-cyan-500/40 shadow-sm' : 'text-slate-400 hover:text-white'}`}
                                            >
                                                3 дні
                                            </button>
                                            <button 
                                                type="button" 
                                                onClick={() => applyAnDatePreset('7')} 
                                                className={`px-2.5 py-1 rounded-lg transition cursor-pointer select-none ${anDatePreset === '7' ? 'bg-cyan-500/20 text-cyan-300 font-bold border border-cyan-500/40 shadow-sm' : 'text-slate-400 hover:text-white'}`}
                                            >
                                                7 днів
                                            </button>

                                            {/* Точний період (календар-поповер) */}
                                            <div className="relative">
                                                <button 
                                                    type="button" 
                                                    onClick={() => setOpenDropdown(openDropdown === 'an_custom_date' ? null : 'an_custom_date')} 
                                                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg transition cursor-pointer select-none border ${anDatePreset === 'custom' ? 'bg-cyan-500/20 text-cyan-300 font-bold border-cyan-500/40 shadow-sm' : 'border-transparent text-slate-400 hover:text-white'}`}
                                                    title="Вибрати точний період дат у календарі"
                                                >
                                                    <Icon name="calendar" className="w-3.5 h-3.5 text-cyan-400" />
                                                    <span>{anDatePreset === 'custom' && anDateFrom ? `${anDateFrom.slice(5)} — ${anDateTo ? anDateTo.slice(5) : '...'}` : 'Календар'}</span>
                                                    <Icon name="chevron-down" className="w-2.5 h-2.5 text-slate-500" />
                                                </button>
                                                {openDropdown === 'an_custom_date' && (
                                                    <>
                                                        <div className="fixed inset-0 z-40 cursor-default" onClick={() => setOpenDropdown(null)}></div>
                                                        <div className="absolute left-0 top-full mt-2 z-50 bg-slate-900 border border-slate-700/80 rounded-2xl shadow-2xl p-4 w-72 animate-in fade-in zoom-in-95 duration-150 space-y-3.5 font-sans">
                                                            <div className="flex justify-between items-center pb-2 border-b border-slate-800">
                                                                <span className="text-xs font-bold text-white flex items-center gap-1.5">
                                                                    <Icon name="calendar" className="w-4 h-4 text-cyan-400" />
                                                                    <span>Період аналітики</span>
                                                                </span>
                                                                <button 
                                                                    type="button" 
                                                                    onClick={() => { applyAnDatePreset('all'); setOpenDropdown(null); }} 
                                                                    className="text-[10px] text-cyan-400 hover:text-cyan-300 font-semibold cursor-pointer"
                                                                >
                                                                    Скинути
                                                                </button>
                                                            </div>
                                                            <div className="space-y-2.5 text-xs">
                                                                <div>
                                                                    <span className="text-[10px] font-bold text-slate-400 uppercase font-mono block mb-1">Від дати:</span>
                                                                    <input 
                                                                        type="date" 
                                                                        value={anDateFrom} 
                                                                        onChange={(e) => { setAnDateFrom(e.target.value); setAnDatePreset('custom'); }} 
                                                                        onClick={(e) => { try { e.target.showPicker(); } catch(err){} }}
                                                                        className="w-full bg-slate-950 border border-slate-800 rounded-xl px-2.5 py-1.5 text-xs text-white focus:border-cyan-500 outline-none font-mono cursor-pointer" 
                                                                    />
                                                                </div>
                                                                <div>
                                                                    <span className="text-[10px] font-bold text-slate-400 uppercase font-mono block mb-1">До дати:</span>
                                                                    <input 
                                                                        type="date" 
                                                                        value={anDateTo} 
                                                                        onChange={(e) => { setAnDateTo(e.target.value); setAnDatePreset('custom'); }} 
                                                                        onClick={(e) => { try { e.target.showPicker(); } catch(err){} }}
                                                                        className="w-full bg-slate-950 border border-slate-800 rounded-xl px-2.5 py-1.5 text-xs text-white focus:border-cyan-500 outline-none font-mono cursor-pointer" 
                                                                    />
                                                                </div>
                                                            </div>
                                                            <div className="pt-2 border-t border-slate-800 flex justify-end">
                                                                <button 
                                                                    type="button" 
                                                                    onClick={() => setOpenDropdown(null)} 
                                                                    className="w-full py-1.5 bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold text-xs rounded-xl shadow transition cursor-pointer text-center"
                                                                >
                                                                    Застосувати
                                                                </button>
                                                            </div>
                                                        </div>
                                                    </>
                                                )}
                                            </div>
                                        </div>

                                        {/* Дропдаун УПД */}
                                        <div className="flex items-center gap-1.5 bg-slate-950 px-3 py-1.5 rounded-xl border border-slate-800 text-xs">
                                            <span className="text-slate-400 font-mono text-[10px] uppercase">УПД:</span>
                                            <select value={anUdp} onChange={(e) => setAnUdp(e.target.value)} className="bg-transparent text-white focus:outline-none cursor-pointer text-xs font-medium">
                                                <option value="all">Всі випадки</option>
                                                <option value="yes">Тільки під час УПД</option>
                                                <option value="no">Без УПД</option>
                                            </select>
                                        </div>

                                        {/* Глибокий фільтр: Сектор / Позиція */}
                                        <div className="flex items-center gap-1.5 bg-slate-950 px-2.5 py-1.5 rounded-xl border border-slate-800 text-xs">
                                            <Icon name="map-pin" className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                                            <span className="text-slate-400 font-mono text-[10px] uppercase hidden sm:inline">Сектор:</span>
                                            <select 
                                                value={anSector} 
                                                onChange={(e) => setAnSector(e.target.value)} 
                                                className="bg-transparent text-amber-300 focus:outline-none cursor-pointer text-xs font-bold max-w-[180px] truncate"
                                            >
                                                <option value="all">Усі позиції / сектори</option>
                                                {availableAnSectors.map(([sec, cnt]) => (
                                                    <option key={sec} value={sec}>{sec} ({cnt})</option>
                                                ))}
                                            </select>
                                            {anSector !== "all" && (
                                                <button 
                                                    type="button" 
                                                    onClick={() => setAnSector("all")} 
                                                    className="text-slate-500 hover:text-red-400 transition ml-0.5 cursor-pointer" 
                                                    title="Скинути фільтр сектора"
                                                >
                                                    <Icon name="x" className="w-3 h-3" />
                                                </button>
                                            )}
                                        </div>

                                        {/* Відбір актуальних епізодів */}
                                        <label className="flex items-center gap-1.5 cursor-pointer bg-slate-950 px-2.5 py-1.5 rounded-xl border border-slate-800 text-slate-300 hover:text-white text-xs select-none" title="Показувати тільки останній стан бійця">
                                            <input type="checkbox" checked={anShowLatest} onChange={(e) => setAnShowLatest(e.target.checked)} className="rounded bg-slate-900 border-slate-700 text-cyan-500 focus:ring-0 w-3.5 h-3.5 cursor-pointer shrink-0"/>
                                            <span className="font-medium text-[11px]">Тільки актуальні</span>
                                        </label>

                                    </div>

                                    <button 
                                        type="button" 
                                        onClick={resetAnalyticsFilters} 
                                        className="px-3 py-1.5 bg-slate-950 hover:bg-slate-800 text-slate-400 hover:text-white text-xs font-semibold rounded-xl border border-slate-800 transition cursor-pointer flex items-center gap-1.5 select-none"
                                        title="Скинути параметри аналітики"
                                    >
                                        <Icon name="rotate-ccw" className="w-3.5 h-3.5" />
                                        <span>Скинути</span>
                                    </button>
                                </div>
                                <div className="bg-slate-900 border border-slate-800 rounded-2xl p-2.5 px-4 shadow-sm flex flex-wrap items-center justify-between gap-3 sticky top-0 z-10">
                                    <div className="flex flex-wrap items-center gap-3">
                                        <span className="text-[10px] text-slate-400 font-bold uppercase mr-1 flex items-center gap-1"><Icon name="eye" className="w-3.5 h-3.5 text-slate-400" /> Відображати:</span>
                                        <label className="flex items-center gap-1.5 cursor-pointer select-none text-zinc-300 text-xs font-bold bg-slate-950 px-2 py-1 rounded-lg border border-slate-800/80 hover:text-white"><input type="checkbox" checked={dynFilters.show200} onChange={e => setDynFilters(p => ({...p, show200: e.target.checked}))} className="rounded bg-slate-900 border-slate-700 text-zinc-500 focus:ring-0 w-3.5 h-3.5"/> Бойові 200</label>
                                        <label className="flex items-center gap-1.5 cursor-pointer select-none text-stone-400 text-xs font-bold bg-slate-950 px-2 py-1 rounded-lg border border-slate-800/80 hover:text-white"><input type="checkbox" checked={dynFilters.showNonCombatDead} onChange={e => setDynFilters(p => ({...p, showNonCombatDead: e.target.checked}))} className="rounded bg-slate-900 border-slate-700 text-stone-500 focus:ring-0 w-3.5 h-3.5"/> Небойові 200</label>
                                        <label className="flex items-center gap-1.5 cursor-pointer select-none text-red-400 text-xs font-bold bg-slate-950 px-2 py-1 rounded-lg border border-slate-800/80 hover:text-white"><input type="checkbox" checked={dynFilters.showWound} onChange={e => setDynFilters(p => ({...p, showWound: e.target.checked}))} className="rounded bg-slate-900 border-slate-700 text-red-500 focus:ring-0 w-3.5 h-3.5"/> Поранення</label>
                                        <label className="flex items-center gap-1.5 cursor-pointer select-none text-amber-500 text-xs font-bold bg-slate-950 px-2 py-1 rounded-lg border border-slate-800/80 hover:text-white"><input type="checkbox" checked={dynFilters.showCombatTr} onChange={e => setDynFilters(p => ({...p, showCombatTr: e.target.checked}))} className="rounded bg-slate-900 border-slate-700 text-amber-500 focus:ring-0 w-3.5 h-3.5"/> Бойові тр.</label>
                                        <label className="flex items-center gap-1.5 cursor-pointer select-none text-yellow-400 text-xs font-bold bg-slate-950 px-2 py-1 rounded-lg border border-slate-800/80 hover:text-white"><input type="checkbox" checked={dynFilters.showNonCombatTr} onChange={e => setDynFilters(p => ({...p, showNonCombatTr: e.target.checked}))} className="rounded bg-slate-900 border-slate-700 text-yellow-500 focus:ring-0 w-3.5 h-3.5"/> Небойові тр.</label>
                                        <label className="flex items-center gap-1.5 cursor-pointer select-none text-blue-400 text-xs font-bold bg-slate-950 px-2 py-1 rounded-lg border border-slate-800/80 hover:text-white"><input type="checkbox" checked={dynFilters.showMIA} onChange={e => setDynFilters(p => ({...p, showMIA: e.target.checked}))} className="rounded bg-slate-900 border-slate-700 text-blue-500 focus:ring-0 w-3.5 h-3.5"/> ЗБВ</label>
                                        <label className="flex items-center gap-1.5 cursor-pointer select-none text-fuchsia-400 text-xs font-bold bg-slate-950 px-2 py-1 rounded-lg border border-slate-800/80 hover:text-white"><input type="checkbox" checked={dynFilters.showAWOL} onChange={e => setDynFilters(p => ({...p, showAWOL: e.target.checked}))} className="rounded bg-slate-900 border-slate-700 text-fuchsia-500 focus:ring-0 w-3.5 h-3.5"/> СЗЧ / Дезерт.</label>
                                    </div>
                                    
                                    <div className="flex items-center gap-2 border-l border-slate-800 pl-3">
                                        <label title={window.ChartDataLabels ? 'Показати значення на діаграмах' : 'Не завантажено бібліотеку підписів. Перевірте Інтернет і перезавантажте програму.'} className="flex items-center gap-1.5 cursor-pointer select-none text-emerald-400 text-xs font-bold bg-slate-950 px-2 py-1 rounded-lg border border-slate-800/80"><input type="checkbox" checked={showChartLabels} disabled={!window.ChartDataLabels} onChange={e => setShowChartLabels(e.target.checked)} className="rounded bg-slate-900 border-slate-700 text-emerald-500 focus:ring-0 w-3.5 h-3.5 disabled:opacity-50"/> Цифри</label>
                                        <label className={`flex items-center gap-1.5 cursor-pointer select-none text-xs font-bold bg-slate-950 px-2 py-1 rounded-lg border border-slate-800/80 ${showChartLabels ? 'text-emerald-400' : 'text-slate-600'}`}><input type="checkbox" checked={showChartPercentages} onChange={e => setShowChartPercentages(e.target.checked)} disabled={!showChartLabels} className="rounded bg-slate-900 border-slate-700 text-emerald-500 focus:ring-0 w-3.5 h-3.5 disabled:opacity-50"/> у %</label>
                                    </div>
                                </div>

                                <p className="text-xs text-slate-400">Галочки вище керують структурою втрат. Для поденної та погодинної діаграм типи й зведення налаштовуються окремо в їхніх картках.</p>
                                <div className="medical-charts-grid grid grid-cols-1 lg:grid-cols-12 gap-6">
                                    <div className="bg-tactical-950/60 border border-tactical-800 rounded-xl p-5 shadow-sm lg:col-span-6 flex flex-col">
                                        <div className="flex items-center gap-2 mb-4">
                                            <div className="p-1.5 bg-indigo-950/50 rounded-lg"><Icon name="timer" className="w-4 h-4 text-indigo-400" /></div>
                                            <h3 className="font-bold text-white text-sm">Середній час евакуації (у днях)</h3>
                                        </div>
                                        <ChartComponent 
                                            title="Середній_час_евакуації" showLabels={showChartLabels} showPercentages={false}
                                            className="flex-1 min-h-[250px] w-full relative" type="bar"
                                            data={chartData.evacChartDataConfig}
                                            options={{ plugins: { legend: { display: false } }, scales: { x: { grid: { display: false } }, y: { grid: { color: '#1f2937' }, title: { display: true, text: 'Дні', color: '#9ca3af' } } } }}
                                        />
                                    </div>

                                    <div className="bg-tactical-950/60 border border-tactical-800 rounded-xl p-5 shadow-sm lg:col-span-6 flex flex-col relative overflow-hidden group">
                                        <div className="absolute top-0 left-0 w-1 h-full bg-cyan-500"></div>
                                        <div className="flex items-center gap-2 mb-4">
                                            <div className="p-1.5 bg-cyan-950/50 rounded-lg"><Icon name="truck" className="w-4 h-4 text-cyan-400" /></div>
                                            <h3 className="font-bold text-white text-sm">Розширений звіт з евакуації за період</h3>
                                        </div>
                                        
                                        <div className="grid grid-cols-2 gap-4 flex-1">
                                            <div className="bg-tactical-900/40 rounded-lg p-4 border border-tactical-800 flex flex-col justify-center">
                                                <div className="text-[10px] text-tactical-400 font-bold uppercase mb-1">Фактично евакуйовано</div>
                                                <div className="text-4xl font-bold text-cyan-400 mb-2">{evacStats.actualEvacTotal}</div>
                                                <div className="space-y-1.5 text-[11px] text-tactical-300 border-t border-tactical-800/50 pt-2">
                                                    <div className="flex justify-between" title="Поранені та евакуйовані в цьому ж періоді">
                                                        <span>З цього періоду:</span>
                                                        <span className="font-bold text-cyan-200">300: {evacStats.evacPeriod300} / 200: {evacStats.evacPeriod200}</span>
                                                    </div>
                                                    <div className="flex justify-between" title="Евакуйовані зараз, але поранені раніше">
                                                        <span>З минулих періодів:</span>
                                                        <span className="font-bold text-cyan-200">300: {evacStats.evacBefore300} / 200: {evacStats.evacBefore200}</span>
                                                    </div>
                                                </div>
                                            </div>

                                            <div className="bg-tactical-900/40 rounded-lg p-4 border border-tactical-800 flex flex-col justify-center relative">
                                                <div className="absolute top-4 right-4 text-right">
                                                    <div className="text-[10px] font-bold text-tactical-500 uppercase">Успішність</div>
                                                    <div className={`text-lg font-bold ${evacStats.evacSuccessRate > 50 ? 'text-emerald-400' : 'text-red-400'}`}>{evacStats.evacSuccessRate}%</div>
                                                </div>
                                                <div className="text-[10px] text-tactical-400 font-bold uppercase mb-1">Втрати цього періоду</div>
                                                <div className="text-2xl font-bold text-white mb-2">Всього: {evacStats.totalPeriod300 + evacStats.totalPeriod200}</div>
                                                <div className="space-y-1.5 text-[11px] text-tactical-300 border-t border-tactical-800/50 pt-2">
                                                    <div className="flex justify-between" title="Вже вивезені">
                                                        <span>Вже евакуйовано:</span>
                                                        <span className="font-bold text-emerald-400">300: {evacStats.periodEvacuated300} / 200: {evacStats.periodEvacuated200}</span>
                                                    </div>
                                                    <div className="flex justify-between" title="Все ще чекають">
                                                        <span>Очікують евакуації:</span>
                                                        <span className="font-bold text-red-400">300: {evacStats.periodWaiting300} / 200: {evacStats.periodWaiting200}</span>
                                                    </div>
                                                </div>
                                            </div>

                                            <div className="bg-red-950/20 rounded-lg p-4 border border-red-900/30 col-span-2 flex justify-between items-center">
                                                <div>
                                                    <div className="text-[11px] text-red-400 font-bold uppercase mb-1 flex items-center gap-1.5"><Icon name="alert-triangle" className="w-3.5 h-3.5"/> Глобальна черга на евакуацію</div>
                                                    <div className="text-[10px] text-tactical-400">Всі, хто залишався неевакуйованим на момент кінця вказаного періоду.</div>
                                                </div>
                                                <div className="text-right border-l border-red-900/30 pl-4">
                                                    <div className="font-bold text-white text-sm whitespace-nowrap mb-0.5">300: <span className="text-red-400 text-lg">{evacStats.globalWaiting300}</span> <span className="text-[9px] text-tactical-500 font-normal">({evacStats.globalWaitingCritHeavy} важкі)</span></div>
                                                    <div className="font-bold text-white text-sm whitespace-nowrap flex items-center justify-end gap-2">
                                                        <span>200: <span className="text-tactical-300 text-lg">{evacStats.globalWaiting200}</span></span>
                                                        {evacStats.globalWaitingMia > 0 && (
                                                            <span className="text-blue-400 font-semibold text-xs ml-1">/ ЗБВ: <span className="text-blue-300 text-base font-bold">{evacStats.globalWaitingMia}</span></span>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    </div>

                                    <MedicalSeriesChart
                                        id="hourly" title="Втрати за часом доби" exportTitle="Втрати_за_часом_доби"
                                        buckets={chartData.time.labels} rows={chartData.time.timeMap}
                                        preferences={settings.medicalChartViews?.hourly} onChange={view => updateMedicalChartView('hourly', view)}
                                        ChartComponent={ChartComponent} showLabels={showChartLabels} showPercentages={showChartPercentages}
                                    />
                                    <MedicalSeriesChart
                                        id="daily" title="Хронологічна динаміка (по днях)" exportTitle="Хронологічна_динаміка" daily
                                        buckets={chartData.dynamics.dates} rows={chartData.dynamics.dGroups}
                                        preferences={settings.medicalChartViews?.daily} onChange={view => updateMedicalChartView('daily', view)}
                                        ChartComponent={ChartComponent} showLabels={showChartLabels} showPercentages={showChartPercentages}
                                    />

                                    {/* ПАРА 1: Локації (Статус) + Структура */}
                                    <div className="bg-tactical-950/60 border border-tactical-800 rounded-xl p-5 shadow-sm lg:col-span-8 flex flex-col overflow-hidden">
                                        <div className="flex items-center gap-2 mb-4 shrink-0">
                                            <div className="p-1.5 bg-tactical-800 rounded-lg"><Icon name="map-pin" className="w-4 h-4 text-tactical-300" /></div>
                                            <h3 className="font-bold text-white text-sm">Фактичне місце (за статусом втрат)</h3>
                                        </div>
                                        <div className="overflow-y-auto pr-2">
                                            <div style={{ height: `${locChartHeight}px` }} className="w-full relative">
                                                <ChartComponent 
                                                    title="Локації_за_статусом" showLabels={showChartLabels} showPercentages={showChartPercentages}
                                                    className="w-full h-full" type="bar"
                                                    data={{
                                                        labels: chartData.actLocs.labels,
                                                        datasets: [
                                                            { label: 'Бойові 200', data: chartData.actLocs.labels.map(l => chartData.actLocs.data[l]['200']), backgroundColor: '#71717a' },
                                                            { label: 'Небойові 200', data: chartData.actLocs.labels.map(l => chartData.actLocs.data[l]['Неб. смерть']), backgroundColor: '#57534e' },
                                                            { label: 'Поранення', data: chartData.actLocs.labels.map(l => chartData.actLocs.data[l]['Поранення']), backgroundColor: '#ef4444' },
                                                            { label: 'Бойові', data: chartData.actLocs.labels.map(l => chartData.actLocs.data[l]['Бойове']), backgroundColor: '#f59e0b' },
                                                            { label: 'Небойові', data: chartData.actLocs.labels.map(l => chartData.actLocs.data[l]['Небойове']), backgroundColor: '#fde047' },
                                                            { label: 'ЗБВ', data: chartData.actLocs.labels.map(l => chartData.actLocs.data[l]['ЗБВ']), backgroundColor: '#3b82f6' },
                                                            { label: 'СЗЧ', data: chartData.actLocs.labels.map(l => chartData.actLocs.data[l]['СЗЧ']), backgroundColor: '#c026d3' },
                                                            { label: 'Дезертирство', data: chartData.actLocs.labels.map(l => chartData.actLocs.data[l]['Дезертирство']), backgroundColor: '#db2777' }
                                                        ]
                                                    }}
                                                    options={{ indexAxis: 'y', plugins: { legend: { position: 'top' }, tooltip: { mode: 'index', axis: 'y', intersect: false } }, scales: { x: { stacked: true, grid: { color: '#1f2937' }, ticks: { precision: 0 } }, y: { stacked: true, grid: { display: false }, ticks: { autoSkip: false } } } }}
                                                />
                                            </div>
                                        </div>
                                    </div>
                                    <div className="bg-tactical-950/60 border border-tactical-800 rounded-xl p-5 shadow-sm lg:col-span-4 flex flex-col">
                                        <div className="flex items-center gap-2 mb-4">
                                            <div className="p-1.5 bg-red-950/50 rounded-lg"><Icon name="pie-chart" className="w-4 h-4 text-red-500" /></div>
                                            <h3 className="font-bold text-white text-sm">Структура втрат</h3>
                                        </div>
                                        <ChartComponent 
                                            title="Структура_втрат" showLabels={showChartLabels} showPercentages={showChartPercentages}
                                            className="flex-1 min-h-[250px] w-full relative flex items-center justify-center" type="doughnut"
                                            data={{
                                                labels: [
                                                    ...(dynFilters.show200 ? ['Бойові 200'] : []), ...(dynFilters.showNonCombatDead ? ['Небойові 200'] : []),
                                                    ...(dynFilters.showWound ? ['Поранення'] : []), ...(dynFilters.showCombatTr ? ['Бойові тр.'] : []), 
                                                    ...(dynFilters.showNonCombatTr ? ['Небойові тр.'] : []), ...(dynFilters.showMIA ? ['ЗБВ'] : []), 
                                                    ...(dynFilters.showAWOL ? ['СЗЧ', 'Дезертирство'] : [])
                                                ],
                                                datasets: [{
                                                    data: [
                                                        ...(dynFilters.show200 ? [chartData.types.c200] : []), ...(dynFilters.showNonCombatDead ? [chartData.types.c200nc] : []),
                                                        ...(dynFilters.showWound ? [chartData.types.cWound] : []), ...(dynFilters.showCombatTr ? [chartData.types.cCombat] : []), 
                                                        ...(dynFilters.showNonCombatTr ? [chartData.types.cNonCombat] : []), ...(dynFilters.showMIA ? [chartData.types.cMia] : []), 
                                                        ...(dynFilters.showAWOL ? [chartData.types.cAwol, chartData.types.cDesert] : [])
                                                    ],
                                                    backgroundColor: [
                                                        ...(dynFilters.show200 ? ['#71717a'] : []), ...(dynFilters.showNonCombatDead ? ['#57534e'] : []),
                                                        ...(dynFilters.showWound ? ['#ef4444'] : []), ...(dynFilters.showCombatTr ? ['#f59e0b'] : []), 
                                                        ...(dynFilters.showNonCombatTr ? ['#fde047'] : []), ...(dynFilters.showMIA ? ['#3b82f6'] : []), 
                                                        ...(dynFilters.showAWOL ? ['#c026d3', '#db2777'] : [])
                                                    ],
                                                    borderColor: '#151e0f', borderWidth: 3, hoverOffset: 4
                                                }]
                                            }}
                                            options={{ cutout: '70%', plugins: { legend: { position: 'bottom', labels: { color: '#9ca3af' } } } }}
                                        />
                                    </div>

                                    {/* ПАРА 2: Локації (Важкість) + Важкість */}
                                    <div className="bg-tactical-950/60 border border-tactical-800 rounded-xl p-5 shadow-sm lg:col-span-8 flex flex-col overflow-hidden">
                                        <div className="flex items-center gap-2 mb-4 shrink-0">
                                            <div className="p-1.5 bg-tactical-800 rounded-lg"><Icon name="activity" className="w-4 h-4 text-amber-500" /></div>
                                            <h3 className="font-bold text-white text-sm">Фактичне місце (за важкістю 300-х)</h3>
                                        </div>
                                        <div className="overflow-y-auto pr-2">
                                            <div style={{ height: `${locChartHeight}px` }} className="w-full relative">
                                                <ChartComponent 
                                                    title="Локації_за_важкістю" showLabels={showChartLabels} showPercentages={showChartPercentages}
                                                    className="w-full h-full" type="bar"
                                                    data={{
                                                        labels: chartData.actLocsSev.labels,
                                                        datasets: [
                                                            { label: 'Легкий', data: chartData.actLocsSev.labels.map(l => chartData.actLocsSev.data[l]['Легкий']), backgroundColor: '#10b981' },
                                                            { label: 'Середній', data: chartData.actLocsSev.labels.map(l => chartData.actLocsSev.data[l]['Середній']), backgroundColor: '#f59e0b' },
                                                            { label: 'Важкий', data: chartData.actLocsSev.labels.map(l => chartData.actLocsSev.data[l]['Важкий']), backgroundColor: '#ef4444' },
                                                            { label: 'Критичний', data: chartData.actLocsSev.labels.map(l => chartData.actLocsSev.data[l]['Критичний']), backgroundColor: '#a855f7' }
                                                        ]
                                                    }}
                                                    options={{ indexAxis: 'y', plugins: { legend: { position: 'top' }, tooltip: { mode: 'index', axis: 'y', intersect: false } }, scales: { x: { stacked: true, grid: { color: '#1f2937' }, ticks: { precision: 0 } }, y: { stacked: true, grid: { display: false }, ticks: { autoSkip: false } } } }}
                                                />
                                            </div>
                                        </div>
                                    </div>
                                    <div className="bg-tactical-950/60 border border-tactical-800 rounded-xl p-5 shadow-sm lg:col-span-4 flex flex-col">
                                        <div className="flex items-center gap-2 mb-4">
                                            <div className="p-1.5 bg-purple-950/50 rounded-lg"><Icon name="heart-pulse" className="w-4 h-4 text-purple-500" /></div>
                                            <h3 className="font-bold text-white text-sm">Важкість (Всі 300-ті)</h3>
                                        </div>
                                        <ChartComponent 
                                            title="Важкість" showLabels={showChartLabels} showPercentages={showChartPercentages}
                                            className="flex-1 min-h-[250px] w-full relative flex items-center justify-center" type="doughnut"
                                            data={{
                                                labels: Object.keys(chartData.severity),
                                                datasets: [{ 
                                                    data: Object.values(chartData.severity), 
                                                    backgroundColor: Object.keys(chartData.severity).map(k => SEVERITY_COLORS[k] || '#6b7280'), 
                                                    borderColor: '#151e0f', 
                                                    borderWidth: 3 
                                                }]
                                            }}
                                            options={{ cutout: '70%', plugins: { legend: { position: 'bottom', labels: { color: '#9ca3af' } } } }}
                                        />
                                    </div>

                                    {/* ПАРА 3: Локації (Причини) + Причини (Бублик) */}
                                    <div className="bg-tactical-950/60 border border-tactical-800 rounded-xl p-5 shadow-sm lg:col-span-8 flex flex-col overflow-hidden">
                                        <div className="flex items-center gap-2 mb-4 shrink-0">
                                            <div className="p-1.5 bg-tactical-800 rounded-lg"><Icon name="crosshair" className="w-4 h-4 text-red-500" /></div>
                                            <h3 className="font-bold text-white text-sm">Фактичне місце (за зброєю / причиною ураження)</h3>
                                        </div>
                                        <div className="overflow-y-auto pr-2">
                                            <div style={{ height: `${locChartHeight}px` }} className="w-full relative">
                                                <ChartComponent 
                                                    title="Локації_за_причинами" showLabels={showChartLabels} showPercentages={showChartPercentages}
                                                    className="w-full h-full" type="bar"
                                                    data={chartData.locCause}
                                                    options={{ indexAxis: 'y', plugins: { legend: { position: 'top', labels: { boxWidth: 12, padding: 15 } }, tooltip: { mode: 'index', axis: 'y', intersect: false } }, scales: { x: { stacked: true, grid: { color: '#1f2937' }, ticks: { precision: 0 } }, y: { stacked: true, grid: { display: false }, ticks: { autoSkip: false } } } }}
                                                />
                                            </div>
                                        </div>
                                    </div>
                                    <div className="bg-tactical-950/60 border border-tactical-800 rounded-xl p-5 shadow-sm lg:col-span-4 flex flex-col">
                                        <div className="flex items-center gap-2 mb-4">
                                            <div className="p-1.5 bg-amber-950/50 rounded-lg"><Icon name="zap" className="w-4 h-4 text-amber-500" /></div>
                                            <h3 className="font-bold text-white text-sm">Причини подій</h3>
                                        </div>
                                        <ChartComponent 
                                            title="Причини_подій" showLabels={showChartLabels} showPercentages={showChartPercentages}
                                            className="flex-1 min-h-[250px] w-full relative flex items-center justify-center" type="doughnut"
                                            data={{
                                                labels: chartData.reasons.labels,
                                                datasets: [{
                                                    data: chartData.reasons.labels.map(r => {
                                                        const d = chartData.reasons.data[r];
                                                        return d['200'] + d['Неб. смерть'] + d['Поранення'] + d['Бойове'] + d['Небойове'] + d['ЗБВ'] + d['СЗЧ'] + d['Дезертирство'];
                                                    }),
                                                    backgroundColor: chartData.reasons.labels.map(r => chartData.causeColors[r]),
                                                    borderColor: '#151e0f', borderWidth: 3
                                                }]
                                            }}
                                            options={{ cutout: '60%', plugins: { legend: { position: 'bottom', labels: { color: '#9ca3af' } } } }}
                                        />
                                    </div>

                                    {/* Інші графіки */}
                                    <div className="bg-tactical-950/60 border border-tactical-800 rounded-xl p-5 shadow-sm lg:col-span-6 flex flex-col">
                                        <div className="flex items-center gap-2 mb-4">
                                            <div className="p-1.5 bg-blue-950/50 rounded-lg"><Icon name="shield" className="w-4 h-4 text-blue-400" /></div>
                                            <h3 className="font-bold text-white text-sm">Втрати по підрозділах</h3>
                                        </div>
                                        <ChartComponent 
                                            title="Втрати_по_підрозділах" showLabels={showChartLabels} showPercentages={showChartPercentages}
                                            className="flex-1 min-h-[260px] w-full relative" type="bar"
                                            data={{
                                                labels: chartData.units.labels,
                                                datasets: [
                                                    { label: 'Бойові 200', data: chartData.units.labels.map(u => chartData.units.data[u]['200']), backgroundColor: '#71717a' },
                                                    { label: 'Небойові 200', data: chartData.units.labels.map(u => chartData.units.data[u]['Неб. смерть']), backgroundColor: '#57534e' },
                                                    { label: 'Поранення', data: chartData.units.labels.map(u => chartData.units.data[u]['Поранення']), backgroundColor: '#ef4444' },
                                                    { label: 'Бойові', data: chartData.units.labels.map(u => chartData.units.data[u]['Бойове']), backgroundColor: '#f59e0b' },
                                                    { label: 'Небойові', data: chartData.units.labels.map(u => chartData.units.data[u]['Небойове']), backgroundColor: '#fde047' },
                                                    { label: 'ЗБВ', data: chartData.units.labels.map(u => chartData.units.data[u]['ЗБВ']), backgroundColor: '#3b82f6' },
                                                    { label: 'СЗЧ', data: chartData.units.labels.map(u => chartData.units.data[u]['СЗЧ']), backgroundColor: '#c026d3' },
                                                    { label: 'Дезертирство', data: chartData.units.labels.map(u => chartData.units.data[u]['Дезертирство']), backgroundColor: '#db2777' }
                                                ]
                                            }}
                                            options={{ plugins: { legend: { display: false }, tooltip: { mode: 'index', intersect: false } }, scales: { x: { stacked: true, grid: { display: false } }, y: { stacked: true, grid: { color: '#1f2937' }, ticks: { precision: 0 } } } }}
                                        />
                                    </div>

                                    <div className="bg-tactical-950/60 border border-tactical-800 rounded-xl p-5 shadow-sm lg:col-span-6 flex flex-col">
                                        <div className="flex items-center gap-2 mb-4">
                                            <div className="p-1.5 bg-red-950/50 rounded-lg"><Icon name="activity" className="w-4 h-4 text-red-400" /></div>
                                            <h3 className="font-bold text-white text-sm">Типи травм (по епізодах)</h3>
                                        </div>
                                        <ChartComponent 
                                            title="Типи_травм" showLabels={showChartLabels} showPercentages={showChartPercentages}
                                            className="flex-1 min-h-[260px] w-full relative" type="bar"
                                            data={{
                                                labels: Object.keys(chartData.injuryStats),
                                                datasets: [{ label: 'К-ть епізодів', data: Object.values(chartData.injuryStats), backgroundColor: '#ef4444', borderRadius: 4 }]
                                            }}
                                            options={{ plugins: { legend: { display: false } }, scales: { x: { grid: { display: false }, ticks: { maxRotation: 45, minRotation: 45 } }, y: { grid: { color: '#1f2937' }, ticks: { precision: 0 } } } }}
                                        />
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* ТАБ: ЛОГИ */}
                        {activeTab === "logs" && (
                            <div className="flex-1 flex flex-col md:flex-row gap-4 overflow-hidden">
                                <div className="w-full md:w-64 bg-tactical-950/60 border border-tactical-800 p-3 rounded-lg shrink-0 flex flex-col gap-3">
                                    <div className="text-[10px] text-tactical-400 uppercase font-bold">Фільтр логів за часом</div>
                                    <div className="space-y-2">
                                        <input type="datetime-local" value={logTimeFrom} onChange={(e) => setLogTimeFrom(e.target.value)} className="w-full bg-tactical-900 border border-tactical-800 rounded px-2 py-1 text-[10px] text-white font-mono focus:outline-none" />
                                        <input type="datetime-local" value={logTimeTo} onChange={(e) => setLogTimeTo(e.target.value)} className="w-full bg-tactical-900 border border-tactical-800 rounded px-2 py-1 text-[10px] text-white font-mono focus:outline-none" />
                                    </div>
                                    {(logTimeFrom || logTimeTo) && (
                                        <button onClick={() => { setLogTimeFrom(""); setLogTimeTo(""); }} className="w-full py-1 bg-tactical-800 hover:bg-tactical-700 text-[10px] text-tactical-300 rounded transition">Очистити часовий фільтр</button>
                                    )}
                                </div>
                                <div className="flex-1 bg-tactical-950/30 border border-tactical-800/60 rounded-lg p-3 overflow-y-auto space-y-2 relative">
                                    {filteredLogs.length === 0 ? (
                                        <div className="m-auto text-center text-tactical-500 text-xs py-10">Немає записів за цей період</div>
                                    ) : (
                                        filteredLogs.map(log => (
                                            <div key={log.id} className={`border p-3 rounded-lg flex flex-col gap-1 transition-all relative ${log.undone ? 'opacity-40 bg-zinc-950/60 border-zinc-800/40' : getLogRowStyle(log.action, log.details)}`}>
                                                {log.undone && (
                                                    <div className="absolute top-1.5 left-2 flex items-center gap-1.5">
                                                        <span className="text-[9px] font-bold text-zinc-500 bg-zinc-900/80 border border-zinc-700/50 px-1.5 py-0.5 rounded uppercase tracking-wider flex items-center gap-1">
                                                            <Icon name="undo-2" className="w-2.5 h-2.5" /> скасовано
                                                        </span>
                                                    </div>
                                                )}
                                                <div className={`flex justify-between items-center text-[10px] opacity-80 border-b border-white/5 pb-1 ${log.undone ? 'mt-4' : ''}`}>
                                                    <span className={`font-mono ${log.undone ? 'line-through text-zinc-500' : ''}`}>{formatLogTime(log.timestamp)}</span>
                                                    <span className={`font-black uppercase tracking-wider ${log.undone ? 'line-through text-zinc-500' : ''}`}>{log.action}</span>
                                                </div>
                                                <p className={`text-xs pt-1 leading-relaxed ${log.undone ? 'line-through text-zinc-500' : ''}`}>{log.details}</p>
                                            </div>
                                        ))
                                    )}
                                </div>
                            </div>
                        )}
                    </main>

                    {/* МОДАЛЬНІ ВІКНА */}
                    {(isAddWoundedOpen || isEditOpen) && (
                        <div onClick={(e) => { if (e.target === e.currentTarget) { setIsAddWoundedOpen(false); setIsEditOpen(false); } }} className="fixed inset-0 z-[200] bg-black/85 backdrop-blur-md flex items-center justify-center p-2 sm:p-4 overflow-hidden animate-in fade-in duration-200">
                            <form onSubmit={isEditOpen ? handleUpdateWounded : handleSaveWounded} className="bg-slate-900 border border-slate-700/80 w-full max-w-7xl max-h-[94vh] rounded-2xl flex flex-col shadow-2xl overflow-hidden animate-in zoom-in-95 duration-150">
                                {/* Header */}
                                <div className="px-6 py-4 bg-slate-950/70 border-b border-slate-800 flex justify-between items-center shrink-0">
                                    <div className="flex items-center gap-3">
                                        <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400 shrink-0">
                                            <Icon name={isEditOpen ? "file-pen-line" : "file-plus-2"} className="w-5 h-5" />
                                        </div>
                                        <div>
                                            <h3 className="font-bold text-white text-base tracking-tight">
                                                {isEditOpen ? 'Редагування та статус запису' : 'Створення нового запису'}
                                            </h3>
                                            <p className="text-[11px] text-slate-400 font-mono">
                                                {isEditOpen ? `ID епізоду: ${currentEpisode?.id || '—'}` : 'Внесення події/поранення військовослужбовця'}
                                            </p>
                                        </div>
                                    </div>
                                    <button 
                                        type="button" 
                                        onClick={() => { setIsAddWoundedOpen(false); setIsEditOpen(false); }} 
                                        className="w-8 h-8 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-400 hover:text-white flex items-center justify-center transition cursor-pointer"
                                    >
                                        <Icon name="x" className="w-4 h-4" />
                                    </button>
                                </div>

                                <div className="p-5 overflow-y-auto flex-1 grid grid-cols-1 lg:grid-cols-12 gap-4">
                                    {/* 1. Ліва колонка */}
                                    <div className={`${isAny300(lossType) ? 'lg:col-span-3' : 'lg:col-span-6'} space-y-4 flex flex-col`}>
                                        <div className="bg-slate-950/60 border border-slate-800 rounded-2xl p-4 space-y-3 relative">
                                            <div className="flex justify-between items-center gap-2 mb-1">
                                                <label className="text-[10px] text-slate-400 font-bold uppercase font-mono tracking-wider flex items-center gap-1.5 whitespace-nowrap shrink-0">
                                                    <Icon name="user-check" className="w-3.5 h-3.5 text-amber-400" />
                                                    <span>Анкетні дані</span>
                                                </label>
                                                {(selectedSoldierId || rosterSelection) && !isEditOpen && (
                                                    <button 
                                                        type="button" 
                                                        onClick={clearSelectedSoldier} 
                                                        className="text-[9px] text-emerald-400 hover:text-red-300 flex items-center gap-1 bg-emerald-950/60 hover:bg-red-950/60 px-1.5 py-0.5 rounded border border-emerald-800/60 hover:border-red-800/60 font-mono font-bold whitespace-nowrap shrink-0 transition cursor-pointer"
                                                        title="Клікніть, щоб відв'язати бійця"
                                                    >
                                                        <Icon name="check-circle" className="w-2.5 h-2.5" />
                                                        <span>Прив'язано ✕</span>
                                                    </button>
                                                )}
                                            </div>
                                            <div className="space-y-2.5">
                                                {!isEditOpen && <p className="text-[10px] text-slate-400">Пошук за ПІБ або позивним у медичній базі та журналі О/С. Довідник О/С: {personnelDirectory.entries.length} записів. Вибір не змінює старі картки.</p>}
                                                {!isEditOpen && personnelDirectory.warning && <p role="alert" className="text-[10px] text-amber-300">{personnelDirectory.warning}</p>}
                                                <input 
                                                    type="text" 
                                                    placeholder="ПІБ повністю..." 
                                                    value={newSoldierName} 
                                                    onChange={(e) => handleSmartInput('name', e.target.value)} 
                                                    className="w-full bg-slate-900 border border-slate-800 focus:border-amber-500/80 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-500 outline-none transition font-sans" 
                                                />
                                                <input 
                                                    type="text" 
                                                    placeholder="Позивний (за наявності)..." 
                                                    value={newSoldierCallsign} 
                                                    onChange={(e) => handleSmartInput('callsign', e.target.value)} 
                                                    className="w-full bg-slate-900 border border-slate-800 focus:border-amber-500/80 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-500 outline-none transition font-sans" 
                                                />
                                                
                                                {searchMatches.length > 0 && !selectedSoldierId && !isEditOpen && (
                                                    <div className="bg-slate-900 border border-slate-700 rounded-xl shadow-2xl max-h-48 overflow-y-auto p-1.5 space-y-1 animate-in fade-in slide-in-from-top-2 duration-150">
                                                        <div className="flex items-center justify-between p-1.5 border-b border-slate-800 bg-slate-950/80 rounded-lg">
                                                            <span className="text-[9px] text-slate-400 uppercase font-bold font-mono">Знайдені збіги в базі:</span>
                                                            <button 
                                                                type="button" 
                                                                onClick={() => setSearchMatches([])} 
                                                                className="text-[10px] text-amber-400 hover:text-white font-semibold flex items-center gap-1 px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 cursor-pointer transition"
                                                            >
                                                                <span>Створити як нового</span>
                                                                <Icon name="x" className="w-2.5 h-2.5" />
                                                            </button>
                                                        </div>
                                                        {searchMatches.map(s => (
                                                            <button type="button" key={`${s.source}:${s.id}`} onClick={() => selectExistingSoldier(s)} data-testid="personnel-match" data-source={s.source} className="block w-full text-left p-2.5 rounded-lg border border-transparent hover:border-amber-500/40 bg-slate-950/50 hover:bg-slate-800 cursor-pointer text-xs transition">
                                                                <div className="font-bold text-white flex items-center justify-between">
                                                                    <span>{s.name}</span>
                                                                    {s.callsign && <span className="text-amber-400 font-mono">«{s.callsign}»</span>}
                                                                </div>
                                                                <div className="text-[10px] text-slate-400 font-mono mt-0.5">{s.rank || '—'} | {s.unit || '—'}</div>
                                                                <div className="text-[10px] text-emerald-400 mt-1">{s.source === 'roster' ? 'Журнал О/С' : 'Медична база'}</div>
                                                            </button>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>
                                            {rosterSelection && <p data-testid="roster-selection" className="text-[10px] text-emerald-300">Обрано з О/С: {rosterSelection.name || rosterSelection.callsign}. {selectedSoldierId ? 'Буде використана існуюча медична картка; її анкетні дані не перезаписуються.' : 'Медична картка створиться лише після збереження події.'}</p>}
                                            {!!rosterCandidates.length && <div role="alert" className="border border-amber-600 rounded-lg p-2 space-y-2 text-xs">
                                                <p className="text-amber-300">Є неоднозначний збіг зі старою базою. Оберіть, чи це та сама людина. Автоматичного об’єднання не буде.</p>
                                                {rosterCandidates.map(person => <button key={person.id} type="button" onClick={() => chooseRosterPerson(rosterSelection, person)} className="block w-full text-left bg-slate-800 p-2 rounded">Це та сама людина: {person.name} · {person.callsign || 'без позивного'} · {person.rank || '—'} · {person.unit || '—'} · ID {person.id}</button>)}
                                                <button type="button" onClick={() => chooseRosterPerson(rosterSelection)} className="text-amber-300 underline">Це інша особа — створити окрему картку</button>
                                            </div>}
                                            <div className="grid grid-cols-2 gap-2 pt-1">
                                                <select aria-label="Звання військовослужбовця" value={newSoldierRank} onChange={(e) => setNewSoldierRank(e.target.value)} className="w-full bg-slate-900 border border-slate-800 focus:border-amber-500/80 rounded-xl px-2.5 py-2 text-xs text-white outline-none cursor-pointer">
                                                    <option value="">-- Звання --</option>
                                                    {dictionaryOptions('ranks', settings.ranks || [], newSoldierRank).map(r => <option key={r} value={r}>{r}</option>)}
                                                </select>
                                                <select aria-label="Підрозділ військовослужбовця" value={newSoldierUnit} onChange={(e) => setNewSoldierUnit(e.target.value)} className="w-full bg-slate-900 border border-slate-800 focus:border-amber-500/80 rounded-xl px-2.5 py-2 text-xs text-white outline-none cursor-pointer">
                                                    <option value="">-- Підрозділ --</option>
                                                    {dictionaryOptions('units', settings.units || [], newSoldierUnit).map(u => <option key={u} value={u}>{u}</option>)}
                                                </select>
                                            </div>
                                        </div>

                                        {/* Попередження про конфлікт статусів при додаванні нового запису */}
                                        {(() => {
                                            const activeUnevac = soldierHistory.find(e => e.evacStatus === 'Не евакуйований');
                                            if (!activeUnevac || isEditOpen) return null;
                                            return (
                                                <div className="bg-amber-950/40 border border-amber-500/50 rounded-2xl p-3.5 space-y-2 text-xs animate-in fade-in duration-150 shadow-lg shadow-amber-950/20">
                                                    <div className="flex items-center gap-2 text-amber-300 font-bold">
                                                        <Icon name="alert-triangle" className="w-4 h-4 text-amber-400 shrink-0 animate-pulse" />
                                                        <span>У бійця вже є відкритий запис у черзі!</span>
                                                    </div>
                                                    <p className="text-[11px] text-slate-300 leading-relaxed">
                                                        Попередній статус: <strong className="text-amber-300 font-mono">{activeUnevac.lossType}</strong> від <span className="font-mono text-slate-200">{formatEpisodeDateUI(activeUnevac.date)}</span> (<span className="text-red-400 font-bold">{activeUnevac.evacStatus}</span>).
                                                    </p>
                                                    <div className="flex items-center justify-between gap-2 pt-1 border-t border-amber-500/20 flex-wrap">
                                                        <span className="text-[10px] text-slate-400 italic">
                                                            Створення нового запису оновить актуальний статус бійця в черзі, зберігши історію.
                                                        </span>
                                                        <button
                                                            type="button"
                                                            onClick={() => handleStartEdit(activeUnevac)}
                                                            className="text-[10px] text-amber-300 hover:text-white bg-amber-900/60 hover:bg-amber-800 border border-amber-700/60 px-2.5 py-1 rounded-lg font-bold transition shrink-0 cursor-pointer flex items-center gap-1"
                                                        >
                                                            <span>Редагувати старий запис</span>
                                                            <Icon name="arrow-right" className="w-3 h-3" />
                                                        </button>
                                                    </div>
                                                </div>
                                            );
                                        })()}

                                        {soldierHistory.length > 0 && (
                                            <div className="bg-slate-950/60 border border-slate-800 rounded-2xl p-4 space-y-2.5">
                                                <label className="text-[10px] text-slate-400 font-bold uppercase font-mono tracking-wider flex items-center justify-between gap-1.5">
                                                    <span className="flex items-center gap-1.5">
                                                        <Icon name="history" className="w-3.5 h-3.5 text-amber-400" />
                                                        <span>Історія епізодів бійця ({soldierHistory.length})</span>
                                                    </span>
                                                    <span className="text-[9px] text-slate-500 font-normal">Клікніть для редагування</span>
                                                </label>
                                                <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1">
                                                    {soldierHistory.map(h => (
                                                        <div key={h.id} className="bg-slate-900/80 hover:bg-slate-900 border border-slate-800/80 hover:border-amber-500/40 p-2.5 rounded-xl text-xs flex justify-between items-start gap-2 transition cursor-pointer group" title="Натисніть для переходу до запису" onClick={() => handleStartEdit(h)}>
                                                            <div>
                                                                <div className="text-white font-bold group-hover:text-amber-300 transition-colors">{h.lossType}</div>
                                                                <div className="text-[10px] text-slate-400 font-mono mt-0.5">{h.date.replace('T', ' ')}</div>
                                                            </div>
                                                            <div className="text-right font-mono">
                                                                {isAny300(h.lossType) && <div className="text-[10px] text-amber-400 font-bold">{h.severity || 'Невідомо'}</div>}
                                                                <div className={`text-[10px] font-semibold mt-0.5 ${h.evacStatus === 'Евакуйований' ? 'text-emerald-400' : 'text-red-400'}`}>{h.evacStatus}</div>
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        )}

                                        <div className="bg-slate-950/60 border border-slate-800 rounded-2xl p-4 space-y-3">
                                            <div>
                                                <label className="text-[10px] text-slate-400 font-bold uppercase font-mono tracking-wider block mb-1.5">Тип події</label>
                                                <select value={lossType} onChange={(e) => {
                                                    const newType = e.target.value;
                                                    if (isEditOpen && currentEpisode) {
                                                        const oldType = currentEpisode.lossType;
                                                        if (isAny300(oldType) && (isAny200(newType) || newType === 'Зниклий безвісти (ЗБВ)')) {
                                                            setHasReport(false);
                                                            setWeaponStatus("");
                                                        }
                                                    }
                                                    setLossType(newType);
                                                }} className="w-full bg-slate-900 border border-slate-800 focus:border-amber-500/80 rounded-xl px-3 py-2 text-xs font-bold text-white outline-none cursor-pointer">
                                                    <option value="">-- Оберіть тип події --</option>
                                                    {LOSS_TYPES.map(type => <option key={type} value={type}>{type}</option>)}
                                                </select>
                                            </div>
                                            
                                            {isAny300(lossType) && (
                                                <div>
                                                    <label className="text-[10px] text-slate-400 font-bold uppercase font-mono tracking-wider block mb-1.5">Важкість ураження</label>
                                                    <select value={severity} onChange={(e) => setSeverity(e.target.value)} className="w-full bg-slate-900 border border-slate-800 focus:border-amber-500/80 rounded-xl px-3 py-2 text-xs text-white outline-none cursor-pointer">
                                                        <option value="">-- Оберіть важкість --</option>
                                                        <option value="Легкий">Легкий</option>
                                                        <option value="Середній">Середній</option>
                                                        <option value="Важкий">Важкий</option>
                                                        <option value="Критичний">Критичний</option>
                                                    </select>
                                                </div>
                                            )}

                                            <div>
                                                <label className="text-[10px] text-slate-400 font-bold uppercase font-mono tracking-wider block mb-1.5">Причина події</label>
                                                <select value={cause} onChange={(e) => setCause(e.target.value)} className="w-full bg-slate-900 border border-slate-800 focus:border-amber-500/80 rounded-xl px-3 py-2 text-xs text-white outline-none cursor-pointer">
                                                    <option value="">-- Оберіть причину --</option>
                                                    {dictionaryOptions('causes', settings.causes, cause).map(c => <option key={c} value={c}>{c}</option>)}
                                                </select>
                                            </div>
                                        </div>
                                    </div>

                                    {/* 2. Середня колонка */}
                                    <div className={`${isAny300(lossType) ? 'lg:col-span-4' : 'lg:col-span-6'} space-y-4`}>
                                        <div className="bg-slate-950/60 border border-slate-800 rounded-2xl p-4 space-y-3">
                                            <div>
                                                <label className="text-[10px] text-slate-400 font-bold uppercase font-mono tracking-wider block mb-1.5">Час події</label>
                                                <input type="datetime-local" value={episodeDate} onChange={(e) => setEpisodeDate(e.target.value)} className="w-full bg-slate-900 border border-slate-800 focus:border-amber-500/80 rounded-xl px-3 py-2 text-xs font-mono text-white outline-none transition" />
                                            </div>
                                            
                                            <label className={`flex items-center gap-2.5 text-xs font-bold p-3 rounded-xl border cursor-pointer select-none transition ${inUdp ? 'bg-red-950/60 border-red-800/80 text-red-300 shadow-sm' : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white'}`}>
                                                <input type="checkbox" checked={inUdp} onChange={(e) => setInUdp(e.target.checked)} className="rounded bg-slate-950 border-slate-700 text-red-500 focus:ring-0 w-4 h-4 cursor-pointer" />
                                                <span className="flex items-center gap-1.5">
                                                    <Icon name="zap" className="w-4 h-4 text-red-400" />
                                                    <span>Отримано під час УПД</span>
                                                </span>
                                            </label>

                                            <div>
                                                <label className="text-[10px] text-slate-400 font-bold uppercase font-mono tracking-wider block mb-1.5">Фактичне місце отримання</label>
                                                <input aria-label="Фактичне місце отримання" list="med-actual-locs" placeholder="Оберіть або введіть своє..." value={actualLoc} onChange={(e) => setActualLoc(e.target.value)} className="w-full bg-slate-900 border border-slate-800 focus:border-amber-500/80 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-500 outline-none transition font-sans" />
                                                <datalist id="med-actual-locs">{dictionaryOptions('actualPlaces', episodes.map(episode => episode.actualLoc), actualLoc).map(name => <option key={name} value={name} />)}</datalist>
                                            </div>
                                            <div>
                                                <label className="text-[10px] text-slate-400 font-bold uppercase font-mono tracking-wider block mb-1.5">Документальне місце</label>
                                                <input aria-label="Документальне місце" list="med-document-locs" placeholder="Оберіть або введіть своє..." value={docLoc} onChange={(e) => setDocLoc(e.target.value)} className="w-full bg-slate-900 border border-slate-800 focus:border-amber-500/80 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-500 outline-none transition font-sans" />
                                                <datalist id="med-document-locs">
                                                    {dictionaryOptions('docPlaces', episodes.map(episode => episode.docLoc), docLoc).map(name => <option key={name} value={name} />)}
                                                </datalist>
                                            </div>
                                            <div>
                                                <label className="text-[10px] text-slate-400 font-bold uppercase font-mono tracking-wider block mb-1.5">Опис / Нотатки</label>
                                                <textarea rows="2" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Короткий опис обставин..." className="w-full bg-slate-900 border border-slate-800 focus:border-amber-500/80 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-500 outline-none transition font-sans resize-none"></textarea>
                                            </div>
                                        </div>

                                        {!isAwol(lossType) && lossType !== "Зниклий безвісти (ЗБВ)" && (
                                            <div className="bg-slate-950/60 border border-slate-800 rounded-2xl p-4 space-y-3">
                                                <div>
                                                    <label className="text-[10px] text-slate-400 font-bold uppercase font-mono tracking-wider block mb-1.5">Статус евакуації</label>
                                                    <select value={evacStatus} onChange={(e) => setEvacStatus(e.target.value)} className="w-full bg-slate-900 border border-slate-800 focus:border-amber-500/80 rounded-xl px-3 py-2 text-xs text-white outline-none cursor-pointer">
                                                        <option value="Не евакуйований">Не евакуйований</option>
                                                        <option value="Евакуйований">Евакуйований</option>
                                                        <option value="Не потребує евакуації">Не потребує евакуації</option>
                                                    </select>
                                                </div>
                                                {evacStatus === "Евакуйований" && (
                                                    <div>
                                                        <div className="flex justify-between items-center mb-1.5">
                                                            <label className="text-[10px] text-slate-400 font-bold uppercase font-mono tracking-wider">Дата евакуації</label>
                                                            <span className="text-[9px] text-slate-500 font-mono">за замовч. сьогодні</span>
                                                        </div>
                                                        <input type="date" value={evacDate} onChange={(e) => setEvacDate(e.target.value)} className="w-full bg-slate-900 border border-slate-800 focus:border-amber-500/80 rounded-xl px-3 py-2 text-xs font-mono text-white outline-none transition" />
                                                    </div>
                                                )}
                                            </div>
                                        )}

                                        {isAwol(lossType) && (
                                            <div className="bg-fuchsia-950/30 border border-fuchsia-800/40 rounded-2xl p-4 space-y-3">
                                                <div>
                                                    <label className="text-[10px] text-fuchsia-400 font-bold uppercase font-mono tracking-wider block mb-1.5">Статус {lossType}</label>
                                                    <select value={awolStatus} onChange={(e) => setAwolStatus(e.target.value)} className="w-full bg-slate-900 border border-slate-800 focus:border-fuchsia-500/80 rounded-xl px-3 py-2 text-xs text-white outline-none cursor-pointer">
                                                        <option value="В розшуку">В розшуку</option>
                                                        <option value="Повернувся">Повернувся</option>
                                                    </select>
                                                </div>
                                                {awolStatus === "Повернувся" && (
                                                    <div>
                                                        <div className="flex justify-between items-center mb-1.5">
                                                            <label className="text-[10px] text-slate-400 font-bold uppercase font-mono tracking-wider">Дата повернення</label>
                                                            <span className="text-[9px] text-slate-500 font-mono">за замовч. сьогодні</span>
                                                        </div>
                                                        <input type="date" value={evacDate} onChange={(e) => setEvacDate(e.target.value)} className="w-full bg-slate-900 border border-slate-800 focus:border-amber-500/80 rounded-xl px-3 py-2 text-xs font-mono text-white outline-none transition" />
                                                    </div>
                                                )}
                                            </div>
                                        )}

                                        <div className="bg-slate-950/60 border border-slate-800 rounded-2xl p-4 space-y-3">
                                            <label className="flex items-center gap-2.5 text-xs font-semibold text-slate-300 hover:text-white cursor-pointer select-none">
                                                <input type="checkbox" checked={hasReport} onChange={(e) => {
                                                    setHasReport(e.target.checked);
                                                    if(!e.target.checked) setWeaponStatus("");
                                                }} className="rounded bg-slate-900 border-slate-700 text-amber-500 focus:ring-0 w-4 h-4 cursor-pointer"/> 
                                                <span>Складено рапорт</span>
                                            </label>
                                            {hasReport && (
                                                <div className="space-y-3 pl-4 border-l-2 border-slate-800 mt-2">
                                                    <div>
                                                        <div className="flex justify-between items-center mb-1.5">
                                                            <label className="text-[10px] text-slate-400 font-bold uppercase font-mono tracking-wider">Дата рапорту</label>
                                                            <span className="text-[9px] text-slate-500 font-mono">за замовч. сьогодні</span>
                                                        </div>
                                                        <input type="date" value={reportDate} onChange={(e) => setReportDate(e.target.value)} className="w-full bg-slate-900 border border-slate-800 focus:border-amber-500/80 rounded-xl px-3 py-2 text-xs font-mono text-white outline-none transition" />
                                                    </div>
                                                    <div>
                                                        <label className="text-[10px] text-slate-400 font-bold uppercase font-mono tracking-wider block mb-1.5 flex items-center gap-1.5">
                                                            <Icon name="crosshair" className="w-3.5 h-3.5 text-amber-400" />
                                                            <span>Статус зброї</span>
                                                        </label>
                                                        <select value={weaponStatus} onChange={(e) => setWeaponStatus(e.target.value)} className="w-full bg-slate-900 border border-slate-800 focus:border-amber-500/80 rounded-xl px-3 py-2 text-xs text-white outline-none cursor-pointer">
                                                            <option value="">-- Все ок / Не вказувати --</option>
                                                            <option value="втрачена">Втрачена</option>
                                                            <option value="знищена">Знищена</option>
                                                            <option value="знаходиться у підрозділі">Знаходиться у підрозділі</option>
                                                            <option value="знаходиться на позиції">Знаходиться на позиції</option>
                                                            <option value="СЗЧ/Дезертирство зі зброєю">СЗЧ/Дезертирство зі зброєю</option>
                                                        </select>
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    </div>

                                    {/* 3. Права колонка: Інтерактивна тактична карта тіла (Органічний анатомічний силует) */}
                                    {isAny300(lossType) ? (
                                        <div className="lg:col-span-5 bg-slate-950/70 border border-slate-800 rounded-2xl p-4 flex flex-col shadow-2xl space-y-3 relative overflow-visible">
                                            
                                            {/* Заголовок анатомічного блоку */}
                                            <div className="w-full flex items-center justify-between border-b border-slate-800/80 pb-2">
                                                <div className="flex items-center gap-2 text-xs font-bold uppercase text-amber-400 font-mono tracking-wider">
                                                    <Icon name="activity" className="w-4 h-4 text-amber-400" />
                                                    <span>Карта уражень</span>
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    <span className="text-[10px] text-slate-500 font-mono">Вигляд спереду</span>
                                                    {Object.keys(injuries).some(k => Object.values(injuries[k] || {}).some(Boolean)) && (
                                                        <button 
                                                            type="button" 
                                                            onClick={() => setInjuries({})} 
                                                            className="text-[10px] text-red-400 hover:text-red-300 font-semibold cursor-pointer flex items-center gap-1 bg-red-950/40 px-1.5 py-0.5 rounded border border-red-900/60 transition"
                                                            title="Скинути всі травми"
                                                        >
                                                            <Icon name="trash-2" className="w-3 h-3" />
                                                            <span>Скинути</span>
                                                        </button>
                                                    )}
                                                </div>
                                            </div>

                                            {/* Тіло блоку: Силует зліва + Панель вибору кнопок справа */}
                                            <div className="w-full flex-1 flex flex-col sm:flex-row items-stretch gap-3.5 min-h-[360px]">
                                                {/* Силует HUD */}
                                                <div className="relative w-full sm:w-[140px] shrink-0 border border-slate-800/80 rounded-2xl bg-gradient-to-b from-slate-950 via-slate-900/95 to-slate-950 p-2 shadow-inner flex items-center justify-center group">
                                                    <div className="absolute inset-0 bg-[radial-gradient(#334155_1px,transparent_1px)] [background-size:12px_12px] opacity-20 pointer-events-none rounded-2xl"></div>

                                                    <span className="absolute top-2.5 left-2.5 text-[9px] font-mono font-bold text-slate-500 bg-slate-950/90 px-1.5 py-0.5 rounded-md border border-slate-800/80 shadow-sm" title="Права сторона бійця">П</span>
                                                    <span className="absolute top-2.5 right-2.5 text-[9px] font-mono font-bold text-slate-500 bg-slate-950/90 px-1.5 py-0.5 rounded-md border border-slate-800/80 shadow-sm" title="Ліва сторона бійця">Л</span>

                                                    <svg viewBox="0 0 220 380" className="w-full h-auto max-h-[350px] drop-shadow-lg select-none">
                                                        <defs>
                                                            <filter id="glow-red-med" x="-20%" y="-20%" width="140%" height="140%">
                                                                <feGaussianBlur stdDeviation="3" result="blur" />
                                                                <feComposite in="SourceGraphic" in2="blur" operator="over" />
                                                            </filter>
                                                        </defs>

                                                        {/* Голова */}
                                                        <g onClick={() => setSelectedRegion('head')} className="cursor-pointer">
                                                            <path 
                                                                d="M110,18 C94,18 84,32 84,48 C84,65 96,78 110,82 C124,78 136,65 136,48 C136,32 126,18 110,18 Z" 
                                                                fill={hasAnyInjury('head') ? '#ef4444' : (selectedRegion === 'head' ? '#1e293b' : '#0f172a')} 
                                                                stroke={selectedRegion === 'head' ? '#f59e0b' : (hasAnyInjury('head') ? '#f87171' : '#334155')} 
                                                                strokeWidth={selectedRegion === 'head' ? '2.5' : '1.5'} 
                                                                filter={hasAnyInjury('head') ? 'url(#glow-red-med)' : undefined}
                                                                className="transition-all hover:stroke-amber-400"
                                                            />
                                                            {hasAnyInjury('head') && (
                                                                <circle cx="110" cy="48" r="5" fill="#fff" className="animate-pulse" />
                                                            )}
                                                        </g>

                                                        {/* Шия */}
                                                        <g onClick={() => setSelectedRegion('neck')} className="cursor-pointer">
                                                            <path 
                                                                d="M102,82 L118,82 L122,96 L98,96 Z" 
                                                                fill={hasAnyInjury('neck') ? '#ef4444' : (selectedRegion === 'neck' ? '#1e293b' : '#0f172a')} 
                                                                stroke={selectedRegion === 'neck' ? '#f59e0b' : (hasAnyInjury('neck') ? '#f87171' : '#334155')} 
                                                                strokeWidth={selectedRegion === 'neck' ? '2.5' : '1.5'} 
                                                                filter={hasAnyInjury('neck') ? 'url(#glow-red-med)' : undefined}
                                                                className="transition-all hover:stroke-amber-400"
                                                            />
                                                        </g>

                                                        {/* Грудна клітка / Торс */}
                                                        <g onClick={() => setSelectedRegion('chest')} className="cursor-pointer">
                                                            <path 
                                                                d="M98,96 L122,96 L148,104 L142,165 L78,165 L72,104 Z" 
                                                                fill={hasAnyInjury('chest') ? '#ef4444' : (selectedRegion === 'chest' ? '#1e293b' : '#0f172a')} 
                                                                stroke={selectedRegion === 'chest' ? '#f59e0b' : (hasAnyInjury('chest') ? '#f87171' : '#334155')} 
                                                                strokeWidth={selectedRegion === 'chest' ? '2.5' : '1.5'} 
                                                                filter={hasAnyInjury('chest') ? 'url(#glow-red-med)' : undefined}
                                                                className="transition-all hover:stroke-amber-400"
                                                            />
                                                            {hasAnyInjury('chest') && (
                                                                <circle cx="110" cy="130" r="5" fill="#fff" className="animate-pulse" />
                                                            )}
                                                        </g>

                                                        {/* Живіт / Пах */}
                                                        <g onClick={() => setSelectedRegion('abdomen')} className="cursor-pointer">
                                                            <path 
                                                                d="M78,165 L142,165 L136,215 L84,215 Z" 
                                                                fill={hasAnyInjury('abdomen') ? '#ef4444' : (selectedRegion === 'abdomen' ? '#1e293b' : '#0f172a')} 
                                                                stroke={selectedRegion === 'abdomen' ? '#f59e0b' : (hasAnyInjury('abdomen') ? '#f87171' : '#334155')} 
                                                                strokeWidth={selectedRegion === 'abdomen' ? '2.5' : '1.5'} 
                                                                filter={hasAnyInjury('abdomen') ? 'url(#glow-red-med)' : undefined}
                                                                className="transition-all hover:stroke-amber-400"
                                                            />
                                                            {hasAnyInjury('abdomen') && (
                                                                <circle cx="110" cy="190" r="5" fill="#fff" className="animate-pulse" />
                                                            )}
                                                        </g>

                                                        {/* Права рука бійця (Viewer left) */}
                                                        <g onClick={() => setSelectedRegion('arm_r')} className="cursor-pointer">
                                                            <path 
                                                                d="M72,104 C60,110 46,135 40,165 C34,195 28,225 34,230 C40,235 48,225 54,195 C60,165 72,140 78,120 Z" 
                                                                fill={hasAnyInjury('arm_r') ? '#ef4444' : (selectedRegion === 'arm_r' ? '#1e293b' : '#0f172a')} 
                                                                stroke={selectedRegion === 'arm_r' ? '#f59e0b' : (hasAnyInjury('arm_r') ? '#f87171' : '#334155')} 
                                                                strokeWidth={selectedRegion === 'arm_r' ? '2.5' : '1.5'} 
                                                                filter={hasAnyInjury('arm_r') ? 'url(#glow-red-med)' : undefined}
                                                                className="transition-all hover:stroke-amber-400"
                                                            />
                                                            {hasAnyInjury('arm_r') && (
                                                                <circle cx="48" cy="165" r="5" fill="#fff" className="animate-pulse" />
                                                            )}
                                                        </g>

                                                        {/* Ліва рука бійця (Viewer right) */}
                                                        <g onClick={() => setSelectedRegion('arm_l')} className="cursor-pointer">
                                                            <path 
                                                                d="M148,104 C160,110 174,135 180,165 C186,195 192,225 186,230 C180,235 172,225 166,195 C160,165 148,140 142,120 Z" 
                                                                fill={hasAnyInjury('arm_l') ? '#ef4444' : (selectedRegion === 'arm_l' ? '#1e293b' : '#0f172a')} 
                                                                stroke={selectedRegion === 'arm_l' ? '#f59e0b' : (hasAnyInjury('arm_l') ? '#f87171' : '#334155')} 
                                                                strokeWidth={selectedRegion === 'arm_l' ? '2.5' : '1.5'} 
                                                                filter={hasAnyInjury('arm_l') ? 'url(#glow-red-med)' : undefined}
                                                                className="transition-all hover:stroke-amber-400"
                                                            />
                                                            {hasAnyInjury('arm_l') && (
                                                                <circle cx="172" cy="165" r="5" fill="#fff" className="animate-pulse" />
                                                            )}
                                                        </g>

                                                        {/* Права нога бійця (Viewer left) */}
                                                        <g onClick={() => setSelectedRegion('leg_r')} className="cursor-pointer">
                                                            <path 
                                                                d="M84,215 L106,215 L100,290 L98,365 L74,365 L72,290 Z" 
                                                                fill={hasAnyInjury('leg_r') ? '#ef4444' : (selectedRegion === 'leg_r' ? '#1e293b' : '#0f172a')} 
                                                                stroke={selectedRegion === 'leg_r' ? '#f59e0b' : (hasAnyInjury('leg_r') ? '#f87171' : '#334155')} 
                                                                strokeWidth={selectedRegion === 'leg_r' ? '2.5' : '1.5'} 
                                                                filter={hasAnyInjury('leg_r') ? 'url(#glow-red-med)' : undefined}
                                                                className="transition-all hover:stroke-amber-400"
                                                            />
                                                            {hasAnyInjury('leg_r') && (
                                                                <circle cx="86" cy="285" r="5" fill="#fff" className="animate-pulse" />
                                                            )}
                                                        </g>

                                                        {/* Ліва нога бійця (Viewer right) */}
                                                        <g onClick={() => setSelectedRegion('leg_l')} className="cursor-pointer">
                                                            <path 
                                                                d="M114,215 L136,215 L148,290 L146,365 L122,365 L120,290 Z" 
                                                                fill={hasAnyInjury('leg_l') ? '#ef4444' : (selectedRegion === 'leg_l' ? '#1e293b' : '#0f172a')} 
                                                                stroke={selectedRegion === 'leg_l' ? '#f59e0b' : (hasAnyInjury('leg_l') ? '#f87171' : '#334155')} 
                                                                strokeWidth={selectedRegion === 'leg_l' ? '2.5' : '1.5'} 
                                                                filter={hasAnyInjury('leg_l') ? 'url(#glow-red-med)' : undefined}
                                                                className="transition-all hover:stroke-amber-400"
                                                            />
                                                            {hasAnyInjury('leg_l') && (
                                                                <circle cx="134" cy="285" r="5" fill="#fff" className="animate-pulse" />
                                                            )}
                                                        </g>
                                                    </svg>
                                                </div>

                                                {/* Панель вибору травм для активної зони з повним текстом */}
                                                <div className="flex-1 bg-slate-900 border border-slate-800 rounded-2xl p-3 flex flex-col justify-start space-y-2.5 shadow-md min-w-0">
                                                    <div className="text-xs font-bold text-amber-400 uppercase font-mono border-b border-slate-800 pb-1.5 flex justify-between items-center shrink-0">
                                                        <span className="flex items-center gap-1.5 min-w-0">
                                                            <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse shrink-0"></span>
                                                            <span className="truncate">{BODY_REGIONS.find(r => r.id === selectedRegion)?.name || 'Зона'}</span>
                                                        </span>
                                                        {hasAnyInjury(selectedRegion) && (
                                                            <button 
                                                                type="button" 
                                                                onClick={() => {
                                                                    const updated = { ...injuries };
                                                                    delete updated[selectedRegion];
                                                                    setInjuries(updated);
                                                                }}
                                                                className="text-[10px] text-amber-400 hover:text-amber-300 font-semibold cursor-pointer hover:underline shrink-0 ml-1"
                                                            >
                                                                Очистити
                                                            </button>
                                                        )}
                                                    </div>

                                                    {(() => {
                                                        let injuryOptions = [
                                                            { key: 'shrapnel', icon: '💥', label: 'Уламкове', desc: 'Ураження уламками снарядів, мін, гранат, ВОГ або FPV-дронів' },
                                                            { key: 'bullet', icon: '🩸', label: 'Кульове', desc: 'Вогнепальне поранення кулями стрілецької зброї' },
                                                            { key: 'fracture', icon: '🦴', label: 'Перелом', desc: 'Закритий або відкритий перелом кісток внаслідок удару, вибуху чи завалу' },
                                                            { key: 'burn', icon: '🔥', label: 'Опік', desc: 'Термічний або хімічний опік шкіри та тканин' },
                                                            { key: 'laceration', icon: '🩹', label: 'Рвана рана', desc: 'Рвана, забійна або різана рана м’яких тканин' },
                                                            { key: 'contusion', icon: '🛡️', label: 'Забій', desc: 'Закрите механічне ушкодження тканин без порушення цілісності шкіри' }
                                                        ];

                                                        if (selectedRegion === 'arm_l' || selectedRegion === 'arm_r') {
                                                            injuryOptions = [
                                                                { key: 'shrapnel', icon: '💥', label: 'Уламкове', desc: 'Ураження уламками снарядів, мін, гранат, ВОГ або FPV-дронів' },
                                                                { key: 'bullet', icon: '🩸', label: 'Кульове', desc: 'Вогнепальне кульове поранення руки' },
                                                                { key: 'amputation', icon: '✂️', label: 'Ампутація руки', desc: 'Повний або неповний травматичний відрив верхньої кінцівки (вище кисті)' },
                                                                { key: 'amp_hand', icon: '🖐️', label: 'Ампутація кисті', desc: 'Травматичний відрив або розтрощення кисті руки' },
                                                                { key: 'amp_fingers', icon: '🤏', label: 'Ампутація пальців', desc: 'Травматичний відрив або розтрощення пальців руки' },
                                                                { key: 'fracture', icon: '🦴', label: 'Перелом', desc: 'Перелом плечової, променевої, ліктьової кістки або пальців' },
                                                                { key: 'rupture', icon: '⚡', label: 'Розрив', desc: 'Тяжке розтрощення та розрив м’яких тканин, м’язів і зв’язок' },
                                                                { key: 'burn', icon: '🔥', label: 'Опік', desc: 'Термічний або хімічний опік верхньої кінцівки' },
                                                                { key: 'laceration', icon: '🩹', label: 'Рвана рана', desc: 'Рвана або різана рана м’яких тканин руки' },
                                                                { key: 'contusion', icon: '🛡️', label: 'Забій', desc: 'Забій, гематома або сильний удар верхньої кінцівки' }
                                                            ];
                                                        } else if (selectedRegion === 'leg_l' || selectedRegion === 'leg_r') {
                                                            injuryOptions = [
                                                                { key: 'shrapnel', icon: '💥', label: 'Уламкове', desc: 'Ураження уламками снарядів, мін, гранат, ВОГ або FPV-дронів' },
                                                                { key: 'bullet', icon: '🩸', label: 'Кульове', desc: 'Вогнепальне кульове поранення ноги' },
                                                                { key: 'amputation', icon: '✂️', label: 'Ампутація ноги', desc: 'Повний або неповний травматичний відрив нижньої кінцівки (гомілка/стегно)' },
                                                                { key: 'amp_foot', icon: '🦶', label: 'Ампутація стопи', desc: 'Травматичний відрив або руйнування стопи (підрив на міні ПМН)' },
                                                                { key: 'amp_fingers', icon: '🤏', label: 'Ампутація пальців', desc: 'Травматичний відрив або розтрощення пальців стопи' },
                                                                { key: 'fracture', icon: '🦴', label: 'Перелом', desc: 'Перелом стегнової, великогомілкової кістки або стопи' },
                                                                { key: 'rupture', icon: '⚡', label: 'Розрив', desc: 'Тяжке розтрощення та розрив м’яких тканин, м’язів і сухожилків' },
                                                                { key: 'burn', icon: '🔥', label: 'Опік', desc: 'Термічний або хімічний опік нижньої кінцівки' },
                                                                { key: 'crush', icon: '🪨', label: 'Краш-синдром', desc: 'Синдром тривалого стиснення ноги (присипання в бліндажі/окопі, небезпека токсикозу нирок)' },
                                                                { key: 'contusion', icon: '🛡️', label: 'Забій', desc: 'Забій, синець або масивна гематома ноги' }
                                                            ];
                                                        } else if (selectedRegion === 'head') {
                                                            injuryOptions = [
                                                                { key: 'shrapnel', icon: '💥', label: 'Уламкове', desc: 'Уламкове поранення м’яких тканин голови або обличчя' },
                                                                { key: 'bullet', icon: '🩸', label: 'Кульове', desc: 'Вогнепальне кульове поранення голови' },
                                                                { key: 'tbi', icon: '🧠', label: 'ЧМТ / Контузія / Струс', desc: 'Закрита/відкрита черепно-мозкова травма, струс або забій головного мозку' },
                                                                { key: 'eye', icon: '👁️', label: 'Травма ока', desc: 'Ураження очного яблука або орбіти уламками, склом, порохом' },
                                                                { key: 'akbt', icon: '💣', label: 'АКБТ', desc: 'Акубаротравма (контузія слуху, різкий перепад тиску, шум у вухах)' },
                                                                { key: 'barotrauma', icon: '💨', label: 'Баротравма', desc: 'Ураження органів слуху та носоглотки вибуховою хвилею' },
                                                                { key: 'fracture', icon: '🦴', label: 'Перелом', desc: 'Перелом кісток черепа, носа або щелепи' },
                                                                { key: 'burn', icon: '🔥', label: 'Опік', desc: 'Опік обличчя, голови чи очей' },
                                                                { key: 'laceration', icon: '🩹', label: 'Рвана рана', desc: 'Рвана рана волосистої частини голови або обличчя' },
                                                                { key: 'contusion', icon: '🛡️', label: 'Забій', desc: 'Забій або гематома м’яких тканин голови' }
                                                            ];
                                                        } else if (selectedRegion === 'chest') {
                                                            injuryOptions = [
                                                                { key: 'shrapnel', icon: '💥', label: 'Уламкове', desc: 'Проникаюче або непроникаюче уламкове поранення грудей' },
                                                                { key: 'bullet', icon: '🩸', label: 'Кульове', desc: 'Кульове поранення грудної клітки' },
                                                                { key: 'pneumothorax', icon: '🫁', label: 'Пневмоторакс', desc: 'Скупчення повітря в плевральній порожнині, колапс легені (загроза життю)' },
                                                                { key: 'rupture', icon: '⚡', label: 'Розрив', desc: 'Розрив м’язів грудної стінки або діафрагми' },
                                                                { key: 'fracture', icon: '🦴', label: 'Перелом ребер', desc: 'Перелом ребер, ключиці або грудини' },
                                                                { key: 'burn', icon: '🔥', label: 'Опік', desc: 'Термічний або хімічний опік грудної клітки' },
                                                                { key: 'crush', icon: '🪨', label: 'Краш-синдром', desc: 'Здавлення грудної клітки завалом або ґрунтом (асфіксія, шок)' },
                                                                { key: 'contusion', icon: '🛡️', label: 'Забій', desc: 'Тупа травма / забій грудної клітки, легень або серця' }
                                                            ];
                                                        } else if (selectedRegion === 'abdomen') {
                                                            injuryOptions = [
                                                                { key: 'shrapnel', icon: '💥', label: 'Уламкове', desc: 'Проникаюче або сліпе уламкове поранення живота/тазу' },
                                                                { key: 'bullet', icon: '🩸', label: 'Кульове', desc: 'Кульове поранення черевної порожнини' },
                                                                { key: 'rupture', icon: '⚡', label: 'Розрив', desc: 'Розрив внутрішніх органів (печінка, селезінка, кишківник)' },
                                                                { key: 'burn', icon: '🔥', label: 'Опік', desc: 'Термічний опік передньої черевної стінки' },
                                                                { key: 'laceration', icon: '🩹', label: 'Рвана рана', desc: 'Рвана рана м’яких тканин черевної стінки' },
                                                                { key: 'contusion', icon: '🛡️', label: 'Забій', desc: 'Тупа травма живота, забій внутрішніх органів' }
                                                            ];
                                                        } else if (selectedRegion === 'neck') {
                                                            injuryOptions = [
                                                                { key: 'shrapnel', icon: '💥', label: 'Уламкове', desc: 'Уламкове поранення шиї (ризик пошкодження сонної артерії, трахеї)' },
                                                                { key: 'bullet', icon: '🩸', label: 'Кульове', desc: 'Кульове поранення шиї' },
                                                                { key: 'laceration', icon: '🩹', label: 'Рвана рана', desc: 'Рвана рана м’яких тканин шиї' },
                                                                { key: 'burn', icon: '🔥', label: 'Опік', desc: 'Термічний опік шиї' },
                                                                { key: 'fracture', icon: '🦴', label: 'Перелом', desc: 'Травма / перелом шийного відділу хребта чи гортані' },
                                                                { key: 'contusion', icon: '🛡️', label: 'Забій', desc: 'Забій або гематома шиї' }
                                                            ];
                                                        }

                                                        return (
                                                            <div className="w-full flex-1 overflow-y-auto space-y-1.5 pr-1 max-h-[310px]">
                                                                {injuryOptions.map(i => {
                                                                    const isChecked = injuries[selectedRegion]?.[i.key] || false;
                                                                    return (
                                                                        <button 
                                                                            type="button"
                                                                            key={i.key} 
                                                                            onClick={() => toggleInjuryType(selectedRegion, i.key)}
                                                                            title={`${i.label}: ${i.desc}`}
                                                                            className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer select-none text-left group/btn ${
                                                                                isChecked 
                                                                                    ? 'bg-red-950/90 border-2 border-red-500 text-white shadow-md shadow-red-950/60 ring-1 ring-red-500/40 font-bold' 
                                                                                    : 'bg-slate-950/80 hover:bg-slate-800/80 border border-slate-800 text-slate-300 hover:text-white'
                                                                            }`}
                                                                        >
                                                                            <span className="flex items-center gap-2.5 min-w-0 flex-1 pr-2">
                                                                                <span className="shrink-0 text-base leading-none group-hover/btn:scale-110 transition-transform">{i.icon}</span>
                                                                                <span className="text-xs font-semibold whitespace-normal leading-snug">{i.label}</span>
                                                                            </span>
                                                                            {isChecked ? (
                                                                                <span className="w-4 h-4 rounded bg-red-500 text-slate-950 flex items-center justify-center font-black text-[10px] shrink-0 shadow-sm">✓</span>
                                                                            ) : (
                                                                                <span className="w-4 h-4 rounded border border-slate-700 bg-slate-900/90 shrink-0"></span>
                                                                            )}
                                                                        </button>
                                                                    );
                                                                })}
                                                            </div>
                                                        );
                                                    })()}
                                                </div>
                                            </div>
                                        </div>
                                    ) : null}
                                </div>
                                
                                {/* Footer */}
                                <div className="px-6 py-4 bg-slate-950/80 border-t border-slate-800 flex items-center justify-between shrink-0">
                                    <div>
                                        {isEditOpen && (
                                            confirmDelete ? (
                                                <div className="flex items-center gap-2">
                                                    <span className="text-xs text-red-400 font-bold">Дійсно видалити запис?</span>
                                                    <button type="button" onClick={handleDeleteEpisode} className="px-3.5 py-1.5 bg-red-600 hover:bg-red-500 text-white text-xs font-bold rounded-xl transition shadow-lg shadow-red-950 cursor-pointer">Так, видалити</button>
                                                    <button type="button" onClick={() => setConfirmDelete(false)} className="px-3.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold rounded-xl transition cursor-pointer">Скасувати</button>
                                                </div>
                                            ) : (
                                                <button type="button" onClick={() => setConfirmDelete(true)} className="px-4 py-2 bg-red-950/60 hover:bg-red-900/80 text-red-400 hover:text-red-300 border border-red-900/60 text-xs font-bold rounded-xl transition cursor-pointer shadow-sm flex items-center gap-1.5">
                                                    <Icon name="trash-2" className="w-3.5 h-3.5" />
                                                    <span>Видалити запис</span>
                                                </button>
                                            )
                                        )}
                                    </div>
                                    <div className="flex items-center gap-3">
                                        <button type="button" onClick={() => { setIsAddWoundedOpen(false); setIsEditOpen(false); }} className="px-5 py-2.5 bg-slate-800/80 hover:bg-slate-700 text-slate-300 hover:text-white text-xs font-bold rounded-xl transition cursor-pointer">
                                            Скасувати
                                        </button>
                                        <button type="submit" className="px-6 py-2.5 bg-gradient-to-r from-amber-500 to-amber-400 hover:from-amber-400 hover:to-amber-300 text-slate-950 text-xs font-bold rounded-xl shadow-lg shadow-amber-950/50 transition cursor-pointer flex items-center gap-2">
                                            <Icon name="check" className="w-4 h-4" />
                                            <span>{isEditOpen ? 'Оновити запис' : 'Зберегти запис'}</span>
                                        </button>
                                    </div>
                                </div>
                            </form>
                        </div>
                    )}

                    {isSettingsOpen && (
                        <div onClick={(e) => { if (e.target === e.currentTarget) setIsSettingsOpen(false); }} className="fixed inset-0 z-[200] bg-black/85 backdrop-blur-md flex items-center justify-center p-3 sm:p-4 animate-in fade-in duration-200">
                            <div className="bg-slate-900 border border-slate-700/80 w-full max-w-lg rounded-2xl overflow-hidden shadow-2xl flex flex-col max-h-[90vh] animate-in zoom-in-95 duration-150">
                                {/* Header */}
                                <div className="px-6 py-4 bg-slate-950/70 border-b border-slate-800 flex justify-between items-center">
                                    <div className="flex items-center gap-3">
                                        <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400 shrink-0">
                                            <Icon name="settings" className="w-5 h-5" />
                                        </div>
                                        <div>
                                            <h3 className="font-bold text-white text-base tracking-tight">Класифікатори довідників</h3>
                                            <p className="text-[11px] text-slate-400">Налаштування списків звань, підрозділів, позицій та причин</p>
                                        </div>
                                    </div>
                                    <button 
                                        type="button" 
                                        onClick={() => setIsSettingsOpen(false)} 
                                        className="w-8 h-8 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-400 hover:text-white flex items-center justify-center transition cursor-pointer"
                                    >
                                        <Icon name="x" className="w-4 h-4" />
                                    </button>
                                </div>

                                {/* Tabs */}
                                <div className="flex border-b border-slate-800 bg-slate-950/40 p-1 gap-1 shrink-0 text-xs font-semibold">
                                    {[
                                        { k: 'causes', l: 'Причини' },
                                        { k: 'ranks', l: 'Звання' },
                                        { k: 'units', l: 'Підрозділи' },
                                        { k: 'sectors', l: 'Позиції' }
                                    ].map(t => (
                                        <button 
                                            key={t.k} 
                                            type="button"
                                            onClick={() => setActiveSettingsTab(t.k)} 
                                            className={`flex-1 py-2 text-center rounded-xl transition cursor-pointer select-none ${
                                                activeSettingsTab === t.k 
                                                    ? 'bg-amber-500/20 text-amber-300 font-bold border border-amber-500/40 shadow-sm' 
                                                    : 'text-slate-400 hover:text-white'
                                            }`}
                                        >
                                            {t.l}
                                        </button>
                                    ))}
                                </div>

                                {/* Content */}
                                <div className="p-5 flex-1 overflow-hidden flex flex-col gap-4">
                                    <div className="flex gap-2 shrink-0">
                                        <input 
                                            type="text" 
                                            value={newSettingItem} 
                                            onChange={(e) => setNewSettingItem(e.target.value)} 
                                            placeholder="Нове значення..." 
                                            className="flex-1 bg-slate-950 border border-slate-800 focus:border-amber-500/80 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-500 outline-none" 
                                        />
                                        <button 
                                            type="button"
                                            onClick={addSettingItem} 
                                            className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs rounded-xl shadow transition cursor-pointer"
                                        >
                                            Додати
                                        </button>
                                    </div>
                                    <div className="flex-1 border border-slate-800 bg-slate-950/60 rounded-xl p-1 overflow-y-auto space-y-1">
                                        {(settings[activeSettingsTab] || []).map((item, idx) => (
                                            <div key={idx} className="flex justify-between items-center px-3 py-2 rounded-lg bg-slate-900/60 hover:bg-slate-900 border border-slate-800/50 text-xs text-slate-200 group">
                                                <span className="truncate pr-2">{item}</span>
                                                <div className="flex items-center gap-1 shrink-0">
                                                    <button 
                                                        type="button"
                                                        onClick={() => { setIsSettingsOpen(false); openBatchReplaceFor(activeSettingsTab, item); }} 
                                                        className="opacity-60 group-hover:opacity-100 text-amber-400 hover:text-amber-300 p-1 hover:bg-amber-950/60 rounded-md transition cursor-pointer"
                                                        title="Перейменувати або замінити у всій базі"
                                                    >
                                                        <Icon name="repeat" className="w-3.5 h-3.5" />
                                                    </button>
                                                    <button 
                                                        type="button"
                                                        onClick={() => removeSettingItem(item)} 
                                                        className="opacity-60 group-hover:opacity-100 text-red-400 hover:text-red-300 p-1 hover:bg-red-950/60 rounded-md transition cursor-pointer"
                                                        title="Видалити з довідника"
                                                    >
                                                        <Icon name="trash-2" className="w-3.5 h-3.5" />
                                                    </button>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                    <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between">
                                        <span className="text-[10px] text-slate-500">Потрібно змінити назву в усіх старих записах?</span>
                                        <button 
                                            type="button" 
                                            onClick={() => { setIsSettingsOpen(false); openBatchReplaceFor(activeSettingsTab, ""); }}
                                            className="px-3 py-1.5 bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/40 text-amber-300 rounded-xl text-xs font-semibold flex items-center gap-1.5 cursor-pointer shadow-sm transition"
                                        >
                                            <Icon name="repeat" className="w-3.5 h-3.5 text-amber-400" />
                                            <span>Масова заміна в базі</span>
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {isBatchReplaceOpen && (
                        <div onClick={(e) => { if (e.target === e.currentTarget) setIsBatchReplaceOpen(false); }} className="fixed inset-0 z-[200] bg-black/85 backdrop-blur-md flex items-center justify-center p-3 sm:p-4 animate-in fade-in duration-200">
                            <div className="bg-slate-900 border border-slate-700/80 w-full max-w-2xl rounded-2xl overflow-hidden shadow-2xl flex flex-col max-h-[92vh] animate-in zoom-in-95 duration-150">
                                {/* Header */}
                                <div className="px-6 py-4 bg-slate-950/70 border-b border-slate-800 flex justify-between items-center shrink-0">
                                    <div className="flex items-center gap-3">
                                        <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400 shrink-0">
                                            <Icon name="repeat" className="w-5 h-5" />
                                        </div>
                                        <div>
                                            <h3 className="font-bold text-white text-base tracking-tight flex items-center gap-2">
                                                <span>Масова заміна та перейменування</span>
                                                <span className="text-[10px] font-mono bg-amber-950/70 text-amber-300 border border-amber-800/70 px-2 py-0.5 rounded-full font-bold">BATCH_UPDATE</span>
                                            </h3>
                                            <p className="text-[11px] text-slate-400">Автоматичне виправлення старих записів, позицій та підрозділів без ручної роботи</p>
                                        </div>
                                    </div>
                                    <button 
                                        type="button" 
                                        onClick={() => setIsBatchReplaceOpen(false)} 
                                        className="w-8 h-8 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-400 hover:text-white flex items-center justify-center transition cursor-pointer"
                                    >
                                        <Icon name="x" className="w-4 h-4" />
                                    </button>
                                </div>

                                {/* Category Tabs */}
                                <div className="flex border-b border-slate-800 bg-slate-950/40 p-1.5 gap-1 shrink-0 text-xs font-semibold">
                                    {[
                                        { k: 'sectors', l: '📍 Позиції (Локації)' },
                                        { k: 'units', l: '🛡️ Підрозділи' },
                                        { k: 'causes', l: '🎯 Причини' },
                                        { k: 'ranks', l: '⭐ Звання' }
                                    ].map(t => (
                                        <button 
                                            key={t.k} 
                                            type="button"
                                            onClick={() => { setBatchCategory(t.k); setBatchOldVal(""); setBatchNewVal(""); }} 
                                            className={`flex-1 py-2 text-center rounded-xl transition cursor-pointer select-none ${
                                                batchCategory === t.k 
                                                    ? 'bg-amber-500/20 text-amber-300 font-bold border border-amber-500/40 shadow-sm' 
                                                    : 'text-slate-400 hover:text-white'
                                            }`}
                                        >
                                            {t.l}
                                        </button>
                                    ))}
                                </div>

                                {/* Mode Switcher (Single vs Multi) */}
                                <div className="px-6 pt-4 flex items-center justify-between shrink-0 gap-3 flex-wrap">
                                    <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-xl border border-slate-800 text-xs font-medium">
                                        <button 
                                            type="button"
                                            onClick={() => setBatchMode('single')}
                                            className={`px-3 py-1.5 rounded-lg transition cursor-pointer flex items-center gap-1.5 ${batchMode === 'single' ? 'bg-amber-500/20 text-amber-300 font-bold border border-amber-500/40 shadow-sm' : 'text-slate-400 hover:text-white'}`}
                                        >
                                            <Icon name="zap" className="w-3.5 h-3.5" />
                                            <span>Швидка заміна (1 назва)</span>
                                        </button>
                                        <button 
                                            type="button"
                                            onClick={() => setBatchMode('multi')}
                                            className={`px-3 py-1.5 rounded-lg transition cursor-pointer flex items-center gap-1.5 ${batchMode === 'multi' ? 'bg-amber-500/20 text-amber-300 font-bold border border-amber-500/40 shadow-sm' : 'text-slate-400 hover:text-white'}`}
                                        >
                                            <Icon name="list" className="w-3.5 h-3.5" />
                                            <span>Пакетний список замін</span>
                                        </button>
                                    </div>

                                    {/* Options Checkboxes */}
                                    <div className="flex items-center gap-3 text-xs text-slate-300 flex-wrap">
                                        {batchCategory === 'sectors' && (
                                            <>
                                                <label className="flex items-center gap-1.5 cursor-pointer select-none" title="Замінити у полі 'Фактична локація'">
                                                    <input 
                                                        type="checkbox" 
                                                        checked={batchFields.actualLoc} 
                                                        onChange={(e) => setBatchFields(p => ({ ...p, actualLoc: e.target.checked }))}
                                                        className="rounded bg-slate-950 border-slate-700 text-amber-500 focus:ring-0 w-3.5 h-3.5"
                                                    />
                                                    <span className="text-[11px]">Фактична</span>
                                                </label>
                                                <label className="flex items-center gap-1.5 cursor-pointer select-none" title="Замінити у полі 'Документальна локація'">
                                                    <input 
                                                        type="checkbox" 
                                                        checked={batchFields.docLoc} 
                                                        onChange={(e) => setBatchFields(p => ({ ...p, docLoc: e.target.checked }))}
                                                        className="rounded bg-slate-950 border-slate-700 text-amber-500 focus:ring-0 w-3.5 h-3.5"
                                                    />
                                                    <span className="text-[11px]">Документальна</span>
                                                </label>
                                            </>
                                        )}
                                        <label className="flex items-center gap-1.5 cursor-pointer select-none" title="Також оновити або додати нове значення в довідник">
                                            <input 
                                                type="checkbox" 
                                                checked={batchFields.updateDict} 
                                                onChange={(e) => setBatchFields(p => ({ ...p, updateDict: e.target.checked }))}
                                                className="rounded bg-slate-950 border-slate-700 text-amber-500 focus:ring-0 w-3.5 h-3.5"
                                            />
                                            <span className="text-[11px]">Оновити довідник</span>
                                        </label>
                                    </div>
                                </div>

                                {/* Body Content */}
                                <div className="p-6 flex-1 overflow-y-auto space-y-4">
                                    {batchMode === 'single' ? (
                                        <form onSubmit={handleExecuteSingleReplace} className="space-y-4">
                                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                                {/* Стара назва */}
                                                <div className="space-y-1.5">
                                                    <label className="text-[11px] font-bold text-slate-300 uppercase tracking-wider block flex items-center justify-between">
                                                        <span>Стара назва (Що замінити)</span>
                                                        <span className="text-[10px] text-amber-400 font-mono font-normal">У базі: {batchAvailableOldValues.length}</span>
                                                    </label>
                                                    
                                                    {/* Select or Type */}
                                                    <select 
                                                        value={batchOldVal} 
                                                        onChange={(e) => setBatchOldVal(e.target.value)}
                                                        className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:border-amber-500 outline-none cursor-pointer"
                                                    >
                                                        <option value="">-- Оберіть значення з бази --</option>
                                                        {batchAvailableOldValues.map(({ val, count }) => (
                                                            <option key={val} value={val}>
                                                                {val} {count > 0 ? `(${count} записів)` : `(в довіднику)`}
                                                            </option>
                                                        ))}
                                                    </select>
                                                    <input 
                                                        type="text" 
                                                        placeholder="Або введіть вручну..." 
                                                        value={batchOldVal} 
                                                        onChange={(e) => setBatchOldVal(e.target.value)}
                                                        className="w-full bg-slate-950/60 border border-slate-800/80 rounded-xl px-3 py-1.5 text-xs text-slate-300 placeholder-slate-600 focus:border-amber-500 outline-none"
                                                    />
                                                </div>

                                                {/* Нова назва */}
                                                <div className="space-y-1.5">
                                                    <label className="text-[11px] font-bold text-slate-300 uppercase tracking-wider block flex items-center justify-between">
                                                        <span>Нова назва (На що замінити)</span>
                                                        <span className="text-[10px] text-emerald-400 font-mono font-normal">Нове значення</span>
                                                    </label>
                                                    <input 
                                                        type="text" 
                                                        placeholder="Введіть нову назву..." 
                                                        value={batchNewVal} 
                                                        onChange={(e) => setBatchNewVal(e.target.value)}
                                                        className="w-full bg-slate-950 border border-slate-800 focus:border-emerald-500/80 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-500 outline-none font-medium"
                                                    />
                                                    {dictionarySuggestions.length > 0 && (
                                                        <div className="flex items-center gap-1 flex-wrap pt-0.5">
                                                            <span className="text-[10px] text-slate-500">З довідника:</span>
                                                            {dictionarySuggestions.slice(0, 4).map((item, i) => (
                                                                <button 
                                                                    key={i} 
                                                                    type="button" 
                                                                    onClick={() => setBatchNewVal(item)}
                                                                    className="text-[10px] bg-slate-950 hover:bg-slate-800 text-slate-300 px-1.5 py-0.5 rounded border border-slate-800 transition cursor-pointer truncate max-w-[120px]"
                                                                    title={item}
                                                                >
                                                                    {item}
                                                                </button>
                                                            ))}
                                                        </div>
                                                    )}
                                                </div>
                                            </div>

                                            {/* Preview & Stats Card */}
                                            <div className="bg-slate-950/70 border border-slate-800/80 rounded-2xl p-4 flex flex-col sm:flex-row items-center justify-between gap-3 shadow-inner">
                                                <div className="flex items-center gap-3">
                                                    <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 border ${singleReplacePreviewCount > 0 ? 'bg-amber-500/15 border-amber-500/30 text-amber-400' : 'bg-slate-800/50 border-slate-700 text-slate-500'}`}>
                                                        <Icon name="target" className="w-5 h-5" />
                                                    </div>
                                                    <div>
                                                        <div className="text-xs font-bold text-white flex items-center gap-2">
                                                            <span>Знайдено записів для оновлення:</span>
                                                            <span className="font-mono text-sm px-2 py-0.5 bg-amber-500/20 text-amber-300 border border-amber-500/40 rounded-lg">
                                                                {singleReplacePreviewCount}
                                                            </span>
                                                        </div>
                                                        <p className="text-[10px] text-slate-400 mt-0.5">
                                                            {batchOldVal && batchNewVal ? (
                                                                <span>Усі записи з «<strong className="text-amber-300">{batchOldVal}</strong>» отримають назву «<strong className="text-emerald-300">{batchNewVal}</strong>»</span>
                                                            ) : (
                                                                <span>Оберіть стару назву та введіть нову для підрахунку</span>
                                                            )}
                                                        </p>
                                                    </div>
                                                </div>
                                                <button 
                                                    type="submit" 
                                                    disabled={!batchOldVal.trim() || !batchNewVal.trim() || batchOldVal.trim() === batchNewVal.trim()}
                                                    className="w-full sm:w-auto px-5 py-2.5 bg-gradient-to-r from-amber-500 to-amber-400 hover:from-amber-400 hover:to-amber-300 disabled:opacity-40 disabled:pointer-events-none text-slate-950 font-bold text-xs rounded-xl shadow-lg shadow-amber-950/50 transition cursor-pointer flex items-center justify-center gap-2 shrink-0 select-none"
                                                >
                                                    <Icon name="repeat" className="w-4 h-4" />
                                                    <span>Замінити у всіх записах</span>
                                                </button>
                                            </div>
                                        </form>
                                    ) : (
                                        <div className="space-y-4">
                                            <div className="flex items-center justify-between border-b border-slate-800 pb-2 flex-wrap gap-2">
                                                <div className="flex items-center gap-2">
                                                    <button 
                                                        type="button" 
                                                        onClick={() => setBatchMultiInputType('rows')}
                                                        className={`text-xs px-2.5 py-1 rounded-lg transition font-medium cursor-pointer ${batchMultiInputType === 'rows' ? 'bg-slate-800 text-white font-bold' : 'text-slate-400 hover:text-white'}`}
                                                    >
                                                        📑 Таблиця пар (Рядки)
                                                    </button>
                                                    <button 
                                                        type="button" 
                                                        onClick={() => setBatchMultiInputType('text')}
                                                        className={`text-xs px-2.5 py-1 rounded-lg transition font-medium cursor-pointer ${batchMultiInputType === 'text' ? 'bg-slate-800 text-white font-bold' : 'text-slate-400 hover:text-white'}`}
                                                    >
                                                        📝 Вставити список текстом
                                                    </button>
                                                </div>
                                                {batchMultiInputType === 'rows' && (
                                                    <button 
                                                        type="button" 
                                                        onClick={addBatchMultiRow} 
                                                        className="text-xs text-amber-400 hover:text-amber-300 font-semibold flex items-center gap-1 cursor-pointer bg-amber-950/40 border border-amber-800/60 px-2.5 py-1 rounded-lg transition"
                                                    >
                                                        <Icon name="plus" className="w-3.5 h-3.5" />
                                                        <span>Додати рядок</span>
                                                    </button>
                                                )}
                                            </div>

                                            {batchMultiInputType === 'rows' ? (
                                                <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                                                    {batchMultiRows.map((row, idx) => (
                                                        <div key={row.id} className="flex items-center gap-2 bg-slate-950/70 p-2 rounded-xl border border-slate-800/80">
                                                            <span className="text-[10px] font-mono text-slate-500 w-5 text-center">{idx + 1}.</span>
                                                            <div className="flex-1">
                                                                <input 
                                                                    type="text" 
                                                                    placeholder="Стара назва..." 
                                                                    value={row.oldVal} 
                                                                    onChange={(e) => updateBatchMultiRow(row.id, 'oldVal', e.target.value)}
                                                                    list={`old_list_${row.id}`}
                                                                    className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-white focus:border-amber-500 outline-none"
                                                                />
                                                                <datalist id={`old_list_${row.id}`}>
                                                                    {batchAvailableOldValues.map(({ val }) => (
                                                                        <option key={val} value={val} />
                                                                    ))}
                                                                </datalist>
                                                            </div>
                                                            <Icon name="arrow-right" className="w-4 h-4 text-slate-500 shrink-0" />
                                                            <div className="flex-1">
                                                                <input 
                                                                    type="text" 
                                                                    placeholder="Нова назва..." 
                                                                    value={row.newVal} 
                                                                    onChange={(e) => updateBatchMultiRow(row.id, 'newVal', e.target.value)}
                                                                    className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-white focus:border-emerald-500 outline-none"
                                                                />
                                                            </div>
                                                            <button 
                                                                type="button" 
                                                                onClick={() => removeBatchMultiRow(row.id)} 
                                                                className="text-slate-500 hover:text-red-400 p-1.5 hover:bg-slate-900 rounded-lg transition cursor-pointer shrink-0"
                                                                title="Видалити правило"
                                                            >
                                                                <Icon name="trash-2" className="w-3.5 h-3.5" />
                                                            </button>
                                                        </div>
                                                    ))}
                                                </div>
                                            ) : (
                                                <div className="space-y-2">
                                                    <textarea 
                                                        rows={6}
                                                        placeholder={`Вставте пари замін по одній на рядок у форматі:\nПозиція 'Альфа' -> ВОП 101\nПозиція 'Браво' -> ВОП 102\nСП 'Хмара' -> СП 'Грім'`}
                                                        value={batchMultiText}
                                                        onChange={(e) => setBatchMultiText(e.target.value)}
                                                        className="w-full bg-slate-950 border border-slate-800 focus:border-amber-500/80 rounded-xl p-3 text-xs text-white placeholder-slate-600 outline-none font-mono"
                                                    />
                                                    <p className="text-[10px] text-slate-500 leading-tight">
                                                        Підтримуються роздільники: <code className="text-amber-400">{'->'}</code>, <code className="text-amber-400">{'➔'}</code>, <code className="text-amber-400">{'=>'}</code>, <code className="text-amber-400">{':'}</code>, <code className="text-amber-400">{'='}</code> або табуляція (копіпаст з Excel).
                                                    </p>
                                                </div>
                                            )}

                                            <div className="pt-2 flex justify-end">
                                                <button 
                                                    type="button" 
                                                    onClick={handleExecuteMultiReplace}
                                                    className="w-full sm:w-auto px-6 py-2.5 bg-gradient-to-r from-amber-500 to-amber-400 hover:from-amber-400 hover:to-amber-300 text-slate-950 font-bold text-xs rounded-xl shadow-lg shadow-amber-950/50 transition cursor-pointer flex items-center justify-center gap-2"
                                                >
                                                    <Icon name="zap" className="w-4 h-4" />
                                                    <span>Застосувати всі правила пакетної заміни</span>
                                                </button>
                                            </div>
                                        </div>
                                    )}
                                </div>

                                {/* Footer */}
                                <div className="px-6 py-3.5 bg-slate-950/80 border-t border-slate-800 flex items-center justify-between shrink-0">
                                    <div className="flex items-center gap-1.5 text-[11px] text-slate-400 font-mono">
                                        <Icon name="history" className="w-3.5 h-3.5 text-amber-400" />
                                        <span>Підказка: якщо помилились — натисніть <strong className="text-amber-300 font-bold">Ctrl+Z</strong> для повернення</span>
                                    </div>
                                    <button 
                                        type="button" 
                                        onClick={() => setIsBatchReplaceOpen(false)} 
                                        className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-xs font-semibold rounded-xl transition cursor-pointer"
                                    >
                                        Закрити
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Модальне вікно авто-відновлення з диска при порожній локальній базі */}
                    {showAutoRestoreModal && diskBackupInfo?.exists && (
                        <div className="fixed inset-0 z-[210] bg-black/85 backdrop-blur-md flex items-center justify-center p-3 sm:p-4 animate-in fade-in duration-200">
                            <div className="bg-slate-900 border border-emerald-500/50 w-full max-w-md rounded-2xl overflow-hidden shadow-2xl flex flex-col p-6 space-y-5 animate-in zoom-in-95 duration-150">
                                <div className="flex items-center gap-3.5">
                                    <div className="w-12 h-12 rounded-2xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400 shrink-0">
                                        <Icon name="shield-check" className="w-6 h-6" />
                                    </div>
                                    <div>
                                        <h3 className="text-base font-bold text-white tracking-tight">Відновлення бази з диска</h3>
                                        <p className="text-xs text-slate-400">Пам'ять браузера порожня, але на ПК знайдено збережену базу.</p>
                                    </div>
                                </div>

                                <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-3.5 text-xs space-y-2">
                                    <div className="flex justify-between items-center">
                                        <span className="text-slate-400">Файл на диску:</span>
                                        <span className="font-mono text-emerald-400 font-bold">{diskBackupInfo.filename}</span>
                                    </div>
                                    <div className="flex justify-between items-center">
                                        <span className="text-slate-400">Дата створення:</span>
                                        <span className="font-mono text-amber-300 font-semibold">{diskBackupInfo.formatted_time || '08.09.2026'}</span>
                                    </div>
                                    <div className="flex justify-between items-center">
                                        <span className="text-slate-400">Розташування:</span>
                                        <span className="font-mono text-slate-400 text-[11px]">d:\ОЧ\Програми\_backups</span>
                                    </div>
                                </div>

                                <div className="space-y-2">
                                    <label className="text-xs font-semibold text-slate-200">Пароль для розшифрування бази:</label>
                                    <div className="relative">
                                        <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-500">
                                            <Icon name="key-round" className="w-4 h-4" />
                                        </div>
                                        <input 
                                            type="password"
                                            autoFocus
                                            value={diskRestorePassword}
                                            onChange={(e) => setDiskRestorePassword(e.target.value)}
                                            onKeyDown={(e) => { if (e.key === 'Enter') handleRestoreFromDisk(); }}
                                            placeholder="Введіть ваш пароль бекапу..."
                                            className="w-full bg-slate-950 border border-slate-700 focus:border-emerald-500 rounded-xl pl-10 pr-4 py-2.5 text-xs text-white placeholder-slate-500 outline-none transition font-sans"
                                        />
                                    </div>
                                </div>

                                <div className="flex gap-2.5 pt-1">
                                    <button
                                        type="button"
                                        onClick={() => setShowAutoRestoreModal(false)}
                                        className="flex-1 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium rounded-xl text-xs transition cursor-pointer"
                                    >
                                        Пропустити
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => handleRestoreFromDisk()}
                                        disabled={isRestoringFromDisk}
                                        className="flex-1 py-2.5 bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-500 hover:to-emerald-400 text-slate-950 font-bold rounded-xl text-xs transition shadow-lg shadow-emerald-950/40 cursor-pointer flex items-center justify-center gap-1.5"
                                    >
                                        <Icon name="refresh-cw" className={`w-3.5 h-3.5 ${isRestoringFromDisk ? 'animate-spin' : ''}`} />
                                        <span>Відновити дані</span>
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}

                    {isBackupOpen && (
                        <div onClick={(e) => { if (e.target === e.currentTarget) setIsBackupOpen(false); }} className="fixed inset-0 z-[200] bg-black/85 backdrop-blur-md flex items-center justify-center p-3 sm:p-4 animate-in fade-in duration-200">
                            <div className="bg-slate-900 border border-slate-700/80 w-full max-w-xl rounded-2xl overflow-hidden shadow-2xl flex flex-col animate-in zoom-in-95 duration-150">
                                {/* Header */}
                                <div className="px-6 py-4 bg-slate-950/70 border-b border-slate-800 flex justify-between items-center">
                                    <div className="flex items-center gap-3">
                                        <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400 shrink-0">
                                            <Icon name="shield-check" className="w-5 h-5" />
                                        </div>
                                        <div>
                                            <h3 className="font-bold text-white text-base tracking-tight">Резервні копії та база</h3>
                                            <p className="text-[11px] text-slate-400">Шифрований експорт AES-256, локальний диск та автозахист</p>
                                        </div>
                                    </div>
                                    <button 
                                        type="button" 
                                        onClick={() => setIsBackupOpen(false)} 
                                        className="w-8 h-8 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-400 hover:text-white flex items-center justify-center transition cursor-pointer"
                                    >
                                        <Icon name="x" className="w-4 h-4" />
                                    </button>
                                </div>

                                <div className="p-6 space-y-5 overflow-y-auto max-h-[80vh]">
                                    {/* 0. Локальний диск (_backups) */}
                                    <div className="bg-slate-950/80 border border-emerald-500/40 rounded-2xl p-4 space-y-3 transition-colors shadow-inner">
                                        <div className="flex justify-between items-center">
                                            <div className="flex items-center gap-2">
                                                <div className="w-7 h-7 rounded-lg bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
                                                    <Icon name="hard-drive" className="w-4 h-4" />
                                                </div>
                                                <span className="text-xs font-bold text-emerald-400 uppercase tracking-wider">Локальний диск (Автозахист)</span>
                                            </div>
                                            <span className={`text-[10px] font-mono px-2 py-0.5 rounded-md font-bold border flex items-center gap-1.5 ${
                                                diskServiceOnline 
                                                    ? 'bg-emerald-950/80 text-emerald-300 border-emerald-800/80' 
                                                    : 'bg-slate-900 text-slate-400 border-slate-800'
                                            }`}>
                                                <span className={`w-1.5 h-1.5 rounded-full ${diskServiceOnline ? 'bg-emerald-400 animate-pulse' : 'bg-slate-500'}`}></span>
                                                {diskServiceOnline ? 'Служба активна' : 'Офлайн'}
                                            </span>
                                        </div>

                                        <div className="text-xs text-slate-300 bg-slate-900/80 rounded-xl p-3 border border-slate-800 space-y-1.5">
                                            <div className="flex justify-between items-center">
                                                <span className="text-slate-400">Папка збереження:</span>
                                                <span className="font-mono text-emerald-400 font-semibold text-[11px]">_backups/</span>
                                            </div>
                                            <div className="flex justify-between items-center">
                                                <span className="text-slate-400">Файл на диску:</span>
                                                <span className="font-mono text-slate-200">{diskBackupInfo?.filename || (diskBackupInfo?.exists ? 'med_tactical_latest.enc' : 'Не знайдено')}</span>
                                            </div>
                                            {diskBackupInfo?.formatted_time && (
                                                <div className="flex justify-between items-center">
                                                    <span className="text-slate-400">Дата створення:</span>
                                                    <span className="font-mono text-amber-300">{diskBackupInfo.formatted_time}</span>
                                                </div>
                                            )}
                                            {lastDiskSaveTime && (
                                                <div className="flex justify-between items-center">
                                                    <span className="text-slate-400">Останнє авто-збереження:</span>
                                                    <span className="font-mono text-emerald-400">{lastDiskSaveTime}</span>
                                                </div>
                                            )}
                                        </div>

                                        {diskServiceOnline && diskBackupInfo?.exists && (
                                            <div className="space-y-2 pt-1">
                                                <div className="relative">
                                                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-500">
                                                        <Icon name="key-round" className="w-3.5 h-3.5" />
                                                    </div>
                                                    <input 
                                                        type="password" 
                                                        value={diskRestorePassword || sessionPassword} 
                                                        onChange={(e) => setDiskRestorePassword(e.target.value)} 
                                                        placeholder="Пароль для розшифрування з диска..." 
                                                        className="w-full bg-slate-900 border border-slate-800 focus:border-emerald-500 rounded-xl pl-9 pr-3 py-2 text-xs text-white placeholder-slate-500 outline-none transition font-sans" 
                                                    />
                                                </div>
                                                <div className="grid grid-cols-2 gap-2">
                                                    <button 
                                                        type="button" 
                                                        onClick={() => handleRestoreFromDisk()} 
                                                        disabled={isRestoringFromDisk}
                                                        className="py-2 px-3 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-slate-950 font-bold rounded-xl text-xs transition cursor-pointer flex items-center justify-center gap-1.5 shadow-sm"
                                                    >
                                                        <Icon name="refresh-cw" className={`w-3.5 h-3.5 ${isRestoringFromDisk ? 'animate-spin' : ''}`} />
                                                        <span>Відновити з диска</span>
                                                    </button>
                                                    <button 
                                                        type="button" 
                                                        onClick={() => handleSaveToDisk()} 
                                                        disabled={isSavingToDisk}
                                                        className="py-2 px-3 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-200 hover:text-white font-semibold rounded-xl text-xs border border-slate-700 transition cursor-pointer flex items-center justify-center gap-1.5 shadow-sm"
                                                    >
                                                        <Icon name="save" className="w-3.5 h-3.5 text-emerald-400" />
                                                        <span>Зберегти на диск</span>
                                                    </button>
                                                </div>
                                            </div>
                                        )}
                                    </div>

                                    {/* 1. Експорт */}
                                    <div className="bg-slate-950/60 border border-emerald-500/20 hover:border-emerald-500/40 rounded-2xl p-4 space-y-3 transition-colors">
                                        <div className="flex justify-between items-center">
                                            <div className="flex items-center gap-2">
                                                <div className="w-7 h-7 rounded-lg bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
                                                    <Icon name="download" className="w-4 h-4" />
                                                </div>
                                                <span className="text-xs font-bold text-emerald-400 uppercase tracking-wider">Створити резервну копію (Експорт)</span>
                                            </div>
                                            <span className="text-[10px] font-mono text-emerald-400/80 bg-emerald-950/60 border border-emerald-800/60 px-2 py-0.5 rounded-md font-bold">AES-256</span>
                                        </div>
                                        
                                        <div className="space-y-2">
                                            <div className="relative">
                                                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-500">
                                                    <Icon name="lock" className="w-3.5 h-3.5" />
                                                </div>
                                                <input 
                                                    type="password" 
                                                    value={backupPassword} 
                                                    onChange={(e) => setBackupPassword(e.target.value)} 
                                                    placeholder="Придумайте пароль для захисту файлу..." 
                                                    className="w-full bg-slate-900 border border-slate-800 focus:border-emerald-500/80 rounded-xl pl-9 pr-3 py-2 text-xs text-white placeholder-slate-500 outline-none transition font-sans" 
                                                />
                                            </div>
                                            <button 
                                                type="button" 
                                                onClick={handleExport} 
                                                className="w-full py-2.5 bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-500 hover:to-emerald-400 text-slate-950 font-bold rounded-xl text-xs transition shadow-lg shadow-emerald-950/50 cursor-pointer flex items-center justify-center gap-2"
                                            >
                                                <Icon name="download" className="w-4 h-4" />
                                                <span>Завантажити зашифрований .enc файл</span>
                                            </button>
                                        </div>
                                    </div>

                                    {/* 2. Імпорт */}
                                    <div className="bg-slate-950/60 border border-blue-500/20 hover:border-blue-500/40 rounded-2xl p-4 space-y-3 transition-colors">
                                        <div className="flex justify-between items-center">
                                            <div className="flex items-center gap-2">
                                                <div className="w-7 h-7 rounded-lg bg-blue-500/15 border border-blue-500/30 flex items-center justify-center text-blue-400">
                                                    <Icon name="upload" className="w-4 h-4" />
                                                </div>
                                                <span className="text-xs font-bold text-blue-400 uppercase tracking-wider">Відновити з файлу (Імпорт)</span>
                                            </div>
                                            <span className="text-[10px] font-mono text-blue-400/80 bg-blue-950/60 border border-blue-800/60 px-2 py-0.5 rounded-md font-bold">.ENC</span>
                                        </div>

                                        <div className="space-y-2">
                                            <div className="flex items-center w-full bg-slate-900 border border-slate-800 rounded-xl p-1.5">
                                                <input 
                                                    type="file" 
                                                    accept=".enc" 
                                                    onChange={handleFileChange} 
                                                    className="w-full text-xs text-slate-300 outline-none file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-slate-800 file:text-slate-200 hover:file:bg-slate-700 cursor-pointer" 
                                                />
                                            </div>
                                            <div className="relative">
                                                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-500">
                                                    <Icon name="key-round" className="w-3.5 h-3.5" />
                                                </div>
                                                <input 
                                                    type="password" 
                                                    value={importPassword} 
                                                    onChange={(e) => setImportPassword(e.target.value)} 
                                                    placeholder="Пароль для розшифрування файлу..." 
                                                    className="w-full bg-slate-900 border border-slate-800 focus:border-blue-500/80 rounded-xl pl-9 pr-3 py-2 text-xs text-white placeholder-slate-500 outline-none transition font-sans" 
                                                />
                                            </div>
                                            <button 
                                                type="button" 
                                                onClick={handleImport} 
                                                className="w-full py-2.5 bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-500 hover:to-blue-400 text-white font-bold rounded-xl text-xs transition shadow-lg shadow-blue-950/50 cursor-pointer flex items-center justify-center gap-2"
                                            >
                                                <Icon name="refresh-cw" className="w-4 h-4" />
                                                <span>Розшифрувати та відновити базу</span>
                                            </button>
                                        </div>
                                    </div>

                                    {/* 3. Data Integrity Guard (Діагностика та лікування бази) */}
                                    <div className="bg-slate-950/60 border border-amber-500/30 hover:border-amber-500/50 rounded-2xl p-4 space-y-3 transition-colors">
                                        <div className="flex justify-between items-center flex-wrap gap-2">
                                            <div className="flex items-center gap-2">
                                                <div className="w-7 h-7 rounded-lg bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400">
                                                    <Icon name="shield-alert" className="w-4 h-4" />
                                                </div>
                                                <span className="text-xs font-bold text-amber-300 uppercase tracking-wider">Data Integrity Guard (Цілісність бази)</span>
                                            </div>
                                            <span className={`text-[10px] font-mono font-bold px-2.5 py-0.5 rounded-full border ${
                                                !integrityStatus.checked 
                                                    ? 'bg-slate-900 text-slate-400 border-slate-800'
                                                    : integrityStatus.isHealthy
                                                        ? 'bg-emerald-950/80 text-emerald-300 border-emerald-800'
                                                        : 'bg-amber-950/80 text-amber-300 border-amber-800'
                                            }`}>
                                                {!integrityStatus.checked ? 'Статус: Не перевірено' : (integrityStatus.isHealthy ? '🟢 100% Цілісність' : `⚠️ Зауважень: ${integrityStatus.issueCount}`)}
                                            </span>
                                        </div>

                                        <p className="text-[11px] text-slate-400 leading-relaxed">
                                            Автоматичний захист від сирітських записів, пошкоджених дат та аварійних помилок синхронізації.
                                        </p>

                                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1">
                                            <button 
                                                type="button" 
                                                onClick={() => handleRunIntegrityDiagnosis(false)} 
                                                className="py-2 px-3 bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-white border border-slate-800 hover:border-slate-700 font-semibold rounded-xl text-xs transition cursor-pointer flex items-center justify-center gap-1.5"
                                            >
                                                <Icon name="search" className="w-3.5 h-3.5 text-amber-400" />
                                                <span>Діагностика</span>
                                            </button>

                                            <button 
                                                type="button" 
                                                onClick={() => handleRunIntegrityDiagnosis(true)} 
                                                className="py-2 px-3 bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 hover:text-amber-200 border border-amber-500/50 font-bold rounded-xl text-xs transition cursor-pointer flex items-center justify-center gap-1.5 shadow-sm"
                                            >
                                                <Icon name="check-circle" className="w-3.5 h-3.5 text-amber-400" />
                                                <span>Полікувати базу</span>
                                            </button>

                                            <button 
                                                type="button" 
                                                onClick={handleStandardizeAllCallsigns} 
                                                className="py-2 px-3 bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 hover:text-white border border-amber-500/40 font-bold rounded-xl text-xs transition cursor-pointer flex items-center justify-center gap-1.5 shadow-sm"
                                                title="Привести всі позивні в базі до єдиного стандарту Title Case («Сокіл», «Тайфун»)"
                                            >
                                                <Icon name="sparkles" className="w-3.5 h-3.5 text-amber-400" />
                                                <span>Стандартизувати позивні</span>
                                            </button>
                                        </div>

                                        {/* Детальний список знайдених зауважень */}
                                        {integrityStatus.checked && integrityStatus.details && integrityStatus.details.length > 0 && (
                                            <div className="pt-2.5 border-t border-slate-800/80 space-y-2">
                                                <div className="flex items-center justify-between text-[11px] font-bold text-amber-300">
                                                    <span className="flex items-center gap-1.5">
                                                        <Icon name="alert-circle" className="w-3.5 h-3.5 text-amber-400" />
                                                        <span>Виявлені невідповідності ({integrityStatus.details.length}):</span>
                                                    </span>
                                                </div>
                                                <div className="max-h-48 overflow-y-auto space-y-1.5 pr-1">
                                                    {integrityStatus.details.map((item, idx) => {
                                                        const text = typeof item === 'string' ? item : item.text;
                                                        const ep = item && typeof item === 'object' ? item.episode : null;
                                                        return (
                                                            <div key={idx} className="p-2 bg-slate-900/90 rounded-xl border border-amber-500/30 text-[11px] font-mono text-slate-200 flex items-center justify-between gap-2 shadow-inner">
                                                                <div className="flex items-start gap-2 overflow-hidden">
                                                                    <span className="text-amber-400 font-bold shrink-0">#{idx + 1}</span>
                                                                    <span className="leading-tight select-text break-words">{text}</span>
                                                                </div>
                                                                {ep && (
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => {
                                                                            setIsBackupOpen(false);
                                                                            setIsSettingsOpen(false);
                                                                            handleStartEdit(ep);
                                                                        }}
                                                                        className="px-2.5 py-1 bg-amber-500/20 hover:bg-amber-500 text-amber-300 hover:text-slate-950 border border-amber-500/50 hover:border-amber-400 font-bold rounded-lg text-[11px] transition cursor-pointer flex items-center gap-1 shrink-0 shadow-sm"
                                                                        title="Відкрити картку редагування цього епізоду"
                                                                    >
                                                                        <Icon name="edit" className="w-3 h-3" />
                                                                        <span>Відкрити</span>
                                                                    </button>
                                                                )}
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            </div>
                                        )}

                                        {hasSnapshot && (
                                            <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between">
                                                <span className="text-[10px] font-mono text-slate-500 flex items-center gap-1">
                                                    <Icon name="history" className="w-3 h-3 text-slate-400" />
                                                    <span>Є аварійний знімок</span>
                                                </span>
                                                <button 
                                                    type="button" 
                                                    onClick={handleRestoreSnapshot} 
                                                    className="text-[11px] text-cyan-400 hover:text-cyan-300 font-semibold cursor-pointer hover:underline"
                                                >
                                                    ↩ Відновити з останнього знімка
                                                </button>
                                            </div>
                                        )}
                                    </div>

                                    {/* 3. Небезпечна зона */}
                                    <div className="bg-red-950/20 border border-red-900/40 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                                        <div className="space-y-0.5">
                                            <div className="text-xs font-bold text-red-400 uppercase flex items-center gap-1.5">
                                                <Icon name="alert-triangle" className="w-4 h-4 text-red-400" />
                                                <span>Небезпечна зона</span>
                                            </div>
                                            <p className="text-[11px] text-slate-400">Повне скидання бази даних (видалить бійців та епізоди)</p>
                                        </div>
                                        <button 
                                            type="button" 
                                            onClick={() => setIsClearDbConfirmOpen(true)} 
                                            className="px-4 py-2 bg-red-950/80 hover:bg-red-900 border border-red-800 text-red-300 hover:text-white font-bold rounded-xl text-xs transition cursor-pointer shrink-0 shadow-sm"
                                        >
                                            Очистити базу
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {isClearDbConfirmOpen && (
                        <div onClick={(e) => { if (e.target === e.currentTarget) setIsClearDbConfirmOpen(false); }} className="fixed inset-0 z-[210] bg-black/90 flex items-center justify-center p-4">
                            <div className="bg-red-950 border border-red-800 w-full max-w-sm rounded-xl overflow-hidden shadow-2xl p-5 text-center">
                                <Icon name="alert-octagon" className="w-12 h-12 text-red-500 mx-auto mb-3" />
                                <h3 className="font-bold text-white text-lg mb-2">УВАГА! Очищення бази</h3>
                                <p className="text-xs text-red-200 mb-6">
                                    Це безповоротно видалить всіх військовослужбовців, події та логи. Ви впевнені, що хочете продовжити?
                                </p>
                                <div className="flex gap-3 justify-center">
                                    <button onClick={() => setIsClearDbConfirmOpen(false)} className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white text-xs font-bold rounded-xl transition cursor-pointer">Скасувати</button>
                                    <button onClick={handleClearDatabase} className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white text-xs font-bold rounded-xl transition shadow-lg shadow-red-900 cursor-pointer">Так, очистити все</button>
                                </div>
                            </div>
                        </div>
                    )}

                    {isChangelogOpen && (
                        <div onClick={(e) => { if (e.target === e.currentTarget) setIsChangelogOpen(false); }} className="fixed inset-0 z-[200] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
                            <div className="bg-slate-900 border border-slate-700/80 w-full max-w-xl rounded-2xl overflow-hidden shadow-2xl flex flex-col max-h-[85vh] animate-in fade-in zoom-in-95 duration-200">
                                <div className="px-6 py-4 border-b border-slate-800 flex justify-between items-center bg-slate-800/40">
                                    <div className="flex items-center gap-3">
                                        <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400">
                                            <Icon name="history" className="w-5 h-5" />
                                        </div>
                                        <div>
                                            <h2 className="text-lg font-bold text-white tracking-tight">Історія оновлень</h2>
                                            <p className="text-xs text-slate-400">MedTactical — Система обліку втрат</p>
                                        </div>
                                    </div>
                                    <button onClick={() => setIsChangelogOpen(false)} className="w-8 h-8 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white flex items-center justify-center transition-colors cursor-pointer">
                                        <Icon name="x" className="w-4 h-4" />
                                    </button>
                                </div>
                                <div className="p-6 overflow-y-auto space-y-6 flex-1 text-xs sm:text-sm">
                                    {/* 09.09.2026 */}
                                    <div className="relative pl-5 border-l-2 border-amber-500 space-y-2">
                                        <div className="flex items-center justify-between">
                                            <span className="font-bold text-amber-400 font-mono text-sm">⚡ v3.6.0 (Штабний Диспетчер, автозапуск та автономний фоновий захист бази)</span>
                                            <span className="text-[11px] font-mono text-slate-400 bg-slate-800/80 px-2 py-0.5 rounded border border-slate-700">09.09.2026</span>
                                        </div>
                                        <ul className="space-y-1.5 text-slate-300 list-disc list-inside">
                                            <li><strong className="text-white">Автономний бекап на локальний диск (_backups):</strong> Повна інтеграція зі службою диспетчера (порт 8765) — будь-яка зміна бійця чи епізоду автоматично та безшумно шифрується AES-256 і зберігається в захищений каталог на ПК.</li>
                                            <li><strong className="text-white">Розумне 1-клік відновлення (Auto-Restore Modal):</strong> При порожній базі браузера (після очищення кешу) додаток миттєво знаходить останній бекап на диску та відкриває зручне вікно відновлення.</li>
                                            <li><strong className="text-white">Індикатор статусу в шапці:</strong> Анімований статус «🟢 Диск: OK» (або час збереження) поруч з бейджем версії з можливістю швидкого переходу до панелі бекапів.</li>
                                            <li><strong className="text-white">Пряме керування в модалці бекапів:</strong> Новий блок «Локальний диск (Автозахист)» для збереження та відновлення бази в 1 клік без діалогових вікон провідника.</li>
                                        </ul>
                                    </div>

                                    {/* 29.08.2026 */}
                                    <div className="relative pl-5 border-l-2 border-slate-700 space-y-2 opacity-80">
                                        <div className="flex items-center justify-between">
                                            <span className="font-bold text-slate-300 font-mono text-sm">⚡ v3.5.2 (Стандартизація позивних Title Case, синхронізація причин та цілісність бази)</span>
                                            <span className="text-[11px] font-mono text-slate-400 bg-slate-800/80 px-2 py-0.5 rounded border border-slate-700">29.08.2026</span>
                                        </div>
                                        <ul className="space-y-1.5 text-slate-300 list-disc list-inside">
                                            <li><strong className="text-white">Єдиний канонічний стандарт позивних (Title Case):</strong> Автоматичне форматування всіх позивних до чистого вигляду «Сокіл», «Байрактар», «Тайфун» (з очищенням зайвих лапок/дужок та підтримкою складних імен на кшталт «Альфа-1») у картках Журналу, Тріажі, Excel, друку та текстових звітах.</li>
                                            <li><strong className="text-white">Швидка стандартизація бази в 1 клік:</strong> Додано кнопку «✨ Стандартизувати позивні» та автоматичну діагностику регістрів у Data Integrity Guard зі створенням точки відновлення.</li>
                                            <li><strong className="text-white">Синхронізація фільтрів при старті:</strong> Повне узгодження чекбоксів причин при завантаженні (loadData) з збереженим довідником та наявними епізодами; «Удар КАБом» включено до системного словника за замовчуванням.</li>
                                            <li><strong className="text-white">Безпечний фільтр причин та важкості:</strong> Усунуто раптове приховування записів з новими або незаповненими полями при перезавантаженні сторінки.</li>
                                        </ul>
                                    </div>

                                    {/* 29.08.2026 */}
                                    <div className="relative pl-5 border-l-2 border-slate-700 space-y-2 opacity-80">
                                        <div className="flex items-center justify-between">
                                            <span className="font-bold text-slate-300 font-mono text-sm">⚡ v3.5.1 (Адаптивна симетрична сітка модалки для 200 / ЗБВ / СЗЧ)</span>
                                            <span className="text-[11px] font-mono text-slate-400 bg-slate-800/80 px-2 py-0.5 rounded border border-slate-700">29.08.2026</span>
                                        </div>
                                        <ul className="space-y-1.5 text-slate-300 list-disc list-inside">
                                            <li><strong className="text-white">Чиста 2-колонкова сітка для 200 / ЗБВ / СЗЧ:</strong> Усунуто некоректну заглушку, яка обрізала силует та залишала порожні 8 колонок. Форма для небойових/безтравматичних епізодів тепер ідеально симетрична та збалансована (6 + 6).</li>
                                            <li><strong className="text-white">Збереження повної 3-колонкової структури 300:</strong> Для поранень та травм продовжує працювати інтерактивна тактична карта тіла (3/4/5).</li>
                                        </ul>
                                    </div>

                                    {/* 29.08.2026 */}
                                    <div className="relative pl-5 border-l-2 border-slate-700 space-y-2 opacity-80">
                                        <div className="flex items-center justify-between">
                                            <span className="font-bold text-slate-300 font-mono text-sm">⚡ v3.5.0 (Розширений Body Map HUD, анатомічні ураження & медичні підказки)</span>
                                            <span className="text-[11px] font-mono text-slate-400 bg-slate-800/80 px-2 py-0.5 rounded border border-slate-700">29.08.2026</span>
                                        </div>
                                        <ul className="space-y-1.5 text-slate-300 list-disc list-inside">
                                            <li><strong className="text-white">Розширений анатомічний блок уражень (Body Map HUD):</strong> Інтерактивна тактична карта тіла з компонуванням «пліч-о-пліч» (силует + повноширинні кнопки уражень) у просторій модалці max-w-7xl без скорочень і трикрапок.</li>
                                            <li><strong className="text-white">Повний військово-медичний класифікатор травм:</strong> Додано ампутації сегментів (рука, нога, стопа, кисть, пальці), краш-синдром, пневмоторакс, травму ока, баротравму, розрив тканин та рвані рани з адаптивним набором для кожної зони тіла.</li>
                                            <li><strong className="text-white">Військово-медичні підказки при наведенні (Tooltips):</strong> Кожна кнопка містить детальне клінічне роз'яснення специфіки ураження та його небезпеки.</li>
                                            <li><strong className="text-white">Збалансована сітка модального вікна 3/4/5:</strong> Охайна фіксація кнопки прив'язки [Прив'язано ✕] у своїй картці та усунення вертикальних пустот.</li>
                                        </ul>
                                    </div>

                                    {/* 28.08.2026 */}
                                    <div className="relative pl-5 border-l-2 border-slate-700 space-y-2 opacity-80">
                                        <div className="flex items-center justify-between">
                                            <span className="font-bold text-slate-300 font-mono text-sm">⚡ v3.4.0 (Сортування за евакуацією, лаконічні фільтри & рок-солід тулбар)</span>
                                            <span className="text-[11px] font-mono text-slate-400 bg-slate-800/80 px-2 py-0.5 rounded border border-slate-700">28.08.2026</span>
                                        </div>
                                        <ul className="space-y-1.5 text-slate-300 list-disc list-inside">
                                            <li><strong className="text-white">Сортування за датою евакуації:</strong> Додано режими сортування за часом/датою евакуації бійців (новіші/старіші зверху), збереження дати евакуації при перегляді та швидкі чіпси [⏳ Очікують] / [✅ Евакуйовані].</li>
                                            <li><strong className="text-white">Лаконічний фільтр дат:</strong> Мінімалістичний інтерфейс із чистим вибором [Всі дати] та календарем точного періоду Від/До.</li>
                                            <li><strong className="text-white">Рок-солід 2-рівневий тулбар:</strong> Повний захист від зсувів при масштабуванні — рядок 1 для фільтрів, повноширинний рядок 2 для статистики та дій.</li>
                                            <li><strong className="text-white">Оптимізація випадаючих меню:</strong> Поповери «Інше» та «Сортування» вирівнюються за правим краєм і не обрізаються екраном.</li>
                                        </ul>
                                    </div>

                                    {/* 26.08.2026 */}
                                    <div className="relative pl-5 border-l-2 border-slate-700 space-y-2 opacity-80">
                                        <div className="flex items-center justify-between">
                                            <span className="font-bold text-slate-300 font-mono text-sm">⚡ v3.3.0 (Авто-відновлення дат, ланцюжки статусів та захист цілісності)</span>
                                            <span className="text-[11px] font-mono text-slate-400 bg-slate-800/80 px-2 py-0.5 rounded border border-slate-700">26.08.2026</span>
                                        </div>
                                        <ul className="space-y-1.5 text-slate-300 list-disc list-inside">
                                            <li><strong className="text-white">Розумне авто-виправлення одруківок дат:</strong> Автоматичне очищення випадкових цифр перед роком (наприклад, 62026-08-25 ➔ 2026-08-25), що гарантує безпомилковий підрахунок періодів.</li>
                                            <li><strong className="text-white">Синхронізація фактичної евакуації:</strong> Точний підрахунок вивезених бійців за період з надійним фолбеком на дату події.</li>
                                            <li><strong className="text-white">Захист від колізій статусів:</strong> Інтерактивне попередження при створенні нового запису на бійця з відкритою чергою та кнопка швидкого переходу до редагування.</li>
                                            <li><strong className="text-white">Бейдж ланцюжка статусів бійця:</strong> Відображення компактного бейджа історії (наприклад, [🔄 ЗБВ ➔ 200]) на картках у Журналі та Евакуації.</li>
                                            <li><strong className="text-white">Оновлення Data Integrity Guard:</strong> Виключення хибних сповіщень по валідних історичних епізодах та автоматичне лікування одруківок дат.</li>
                                        </ul>
                                    </div>

                                    {/* 22.08.2026 */}
                                    <div className="relative pl-5 border-l-2 border-slate-700 space-y-2 opacity-80">
                                        <div className="flex items-center justify-between">
                                            <span className="font-bold text-slate-300 font-mono text-sm">v3.2.0 (Офіційне бойове донесення A4/PDF, точна евакуація & фільтри)</span>
                                            <span className="text-[11px] font-mono text-slate-400 bg-slate-800/80 px-2 py-0.5 rounded border border-slate-700">22.08.2026</span>
                                        </div>
                                        <ul className="space-y-1.5 text-slate-300 list-disc list-inside">
                                            <li><strong className="text-white">Офіційне бойове донесення (A4 / PDF):</strong> Окреме вікно друку та експорту в PDF для штабу: 4 зведені картки (200, 300 з розбивкою за важкістю, ЗБВ, вивезені), акцентний блок черги на евакуацію, причини ураження, підрозділи та поіменний реєстр з українською анатомічною мапою та підписами.</li>
                                            <li><strong className="text-white">Точна синхронізація евакуації 200, 300 та ЗБВ:</strong> 100% математичне узгодження між шапкою, аналітикою, текстовим звітом та друкованою формою. ЗБВ більше не спотворюють кількість тіл на позиціях.</li>
                                            <li><strong className="text-white">Повна підтримка перемикача «Об'єднати групи»:</strong> Гнучке відображення ЗБВ окремо або у складі загальних безповоротних втрат.</li>
                                            <li><strong className="text-white">Глибокий фільтр по секторах:</strong> Можливість повної деталізованої аналітики по конкретній позиції чи рубежу.</li>
                                        </ul>
                                    </div>

                                    {/* 20.08.2026 */}
                                    <div className="relative pl-5 border-l-2 border-slate-700 space-y-2 opacity-80">
                                        <div className="flex items-center justify-between">
                                            <span className="font-bold text-slate-300 font-mono text-sm">v3.1.1 (Оптимізація пошуку, швидкий доступ & Data Guard)</span>
                                            <span className="text-[11px] font-mono text-slate-400 bg-slate-800/80 px-2 py-0.5 rounded border border-slate-700">20.08.2026</span>
                                        </div>
                                        <ul className="space-y-1.5 text-slate-300 list-disc list-inside">
                                            <li><strong className="text-white">Інтерактивний перегляд зауважень Data Guard:</strong> Вивід списку знайдених помилок (дати, незв'язані записи) з кнопкою [✏️ Відкрити] для швидкого переходу до картки в 1 клік.</li>
                                            <li><strong className="text-white">Миттєвий пошук бійців O(1):</strong> Використання кешованого індексу soldiersMap усуває 400 000+ зайвих ітерацій при фільтрації списку.</li>
                                            <li><strong className="text-white">Військова нормалізація:</strong> Стійкість пошуку та модального вікна вибору бійця до нерозривних пробілів та змішаної розкладки клавіатури.</li>
                                            <li><strong className="text-white">Синхронізація ключів сховища:</strong> 100% надійність аварійних знімків та відновлення бази.</li>
                                        </ul>
                                    </div>

                                    {/* 19.08.2026 */}
                                    <div className="relative pl-5 border-l-2 border-slate-700 space-y-2 opacity-80">
                                        <div className="flex items-center justify-between">
                                            <span className="font-bold text-slate-300 font-mono text-sm">v3.1.0 (Формат доповіді, Body Map & Data Integrity)</span>
                                            <span className="text-[11px] font-mono text-slate-400 bg-slate-800/80 px-2 py-0.5 rounded border border-slate-700">19.08.2026</span>
                                        </div>
                                        <ul className="space-y-1.5 text-slate-300 list-disc list-inside">
                                            <li><strong className="text-white">Структурований формат бойової доповіді:</strong> Чистий 2-рядковий вивід для месенджерів та рацій (ПІБ, позивний, рота в заголовку; характер поранення, УПД, статус евакуації; дата, час, причина та рубежі). Повна відсутність сміттєвих символів та скупчень дужок.</li>
                                            <li><strong className="text-white">Швидкий експорт черги евакуації в Triage:</strong> Панель швидких звітів [Скопіювати всіх 300-х] та [Скопіювати 200/ЗБВ] та копіювання за окремими зонами сортування.</li>
                                            <li><strong className="text-white">Інтерактивна тактична карта тіла (Body Map):</strong> Органічний плавний анатомічний силует бійця з неоновою підсвіткою уражень, мітками сторін [П (Права)] / [Л (Ліва)] та швидкими плитками типів травм.</li>
                                            <li><strong className="text-white">Data Integrity Guard (Захист та лікування бази):</strong> Автоматичні аварійні тіньові знімки (Safety Snapshots) перед імпортом чи масовими операціями, модуль діагностики та авто-відновлення цілісності бази даних.</li>
                                        </ul>
                                    </div>

                                    {/* 18.08.2026 */}
                                    <div className="relative pl-5 border-l-2 border-slate-700 space-y-2 opacity-80">
                                        <div className="flex items-center justify-between">
                                            <span className="font-bold text-slate-300 font-mono text-sm">v3.0 (Tactical Dark UI & Оптимізація)</span>
                                            <span className="text-[11px] font-mono text-slate-400 bg-slate-800/80 px-2 py-0.5 rounded border border-slate-700">18.08.2026</span>
                                        </div>
                                        <ul className="space-y-1.5 text-slate-300 list-disc list-inside">
                                            <li><strong className="text-white">Горизонтальний Top Filter Toolbar (1 рядок):</strong> Замість громіздких панелей — компактний тактичний тулбар: швидкий пошук `[✕]`, пресети дат (`За добу`, `3 дні`, `7 днів`), календар-поповер `[ 📅 Період ▾ ]` та поповер `[ ⚙️ Інше ▾ ]` з активними фільтрами.</li>
                                            <li><strong className="text-white">Перемикач карток & швидке редагування:</strong> Тумблер `[ 🗂️ 2 колонки ]` / `[ 📑 1 колонка ]`, клікабельні плашки для відкриття в 1 клік та фіксована кнопка `[ ✏️ ]` на кожному рядку.</li>
                                            <li><strong className="text-white">Повний Tactical Dark редизайн усіх модалок:</strong> Модернізовано форму додавання/редагування запису (3 зоновані колонки, неонова підсвітка анатомічної мапи, тактичний силует для 200/ЗБВ), вікно «База / Бекап» (AES-256) та «Довідники».</li>
                                            <li><strong className="text-white">Аналітика та виправлення евакуації:</strong> Оновлено тулбар аналітики та усунуто помилку розрахунку середнього часу евакуації.</li>
                                            <li><strong className="text-white">Закриття по Escape та кліку на фон:</strong> Реалізовано закриття всіх модальних вікон і випадаючих поповерів по `Esc` та Backdrop click.</li>
                                        </ul>
                                    </div>

                                    {/* 17.08.2026 */}
                                    <div className="relative pl-5 border-l-2 border-slate-700 space-y-2 opacity-75">
                                        <div className="flex items-center justify-between">
                                            <span className="font-bold text-slate-300 font-mono text-sm">v3.0-rc1 (Базовий редизайн)</span>
                                            <span className="text-[11px] font-mono text-slate-500">17.08.2026</span>
                                        </div>
                                        <ul className="space-y-1.5 text-slate-400 list-disc list-inside">
                                            <li><strong className="text-slate-200">Палітра Slate-950:</strong> Уніфікація інтерфейсу з програмами комплексу (Inter, JetBrains Mono).</li>
                                            <li><strong className="text-slate-200">Оновлена дошка Triage:</strong> 4 зони сортування (Червона, Жовта, Зелена, Чорна) з неоновими кольоровими градієнтами.</li>
                                        </ul>
                                    </div>
                                </div>
                                <div className="px-6 py-3 bg-slate-950/60 border-t border-slate-800 text-right">
                                    <button onClick={() => setIsChangelogOpen(false)} className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-xl transition-colors cursor-pointer">
                                        Закрити
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            );
        }
            return App;
        })();
        
        // Selected documentary registers adapted from «Оперативний журнал (1)».
        // Isolated storage and an explicit sheet allowlist: no other source modules are loaded.

export { MedicalApp };
